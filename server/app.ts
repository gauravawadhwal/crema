import { Hono } from "hono";
import { cors } from "hono/cors";
import { z, ZodError } from "zod";
import { identify } from "./identify.js";
import { cacheImage, findProductImage, isPlaceholderImage, isSafeUrl, readCachedImage } from "./images.js";
import type { ProviderChain } from "./llm/index.js";
import type { AudioInput, ImageInput } from "./llm/types.js";
import { dialIn, recommend } from "./recommend/index.js";
import { BeanInfo, Recipe, TasteFeedback } from "./schema.js";

const IdentifyText = z.object({
  query: z.string().max(300).optional(),
  description: z.string().max(2000).optional(),
  url: z.string().max(2000).optional(),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * The Crema server is an optional AI add-on. It is stateless: the web app keeps
 * its data in Decaid (beans, shots, workflow) and Decaid's key-value store
 * (Crema's records and settings), and sends whatever an AI call needs with the
 * request. Everything here can be unavailable and the app keeps working with
 * its built-in rules (skin/engine.js).
 *
 * It also serves the web app for phones, with a same-origin proxy to Decaid
 * at /decaid/* when DECAID_URL is set.
 */

const MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const AUDIO = new Set(["audio/wav", "audio/mpeg", "audio/ogg", "audio/flac", "audio/aac"]);
/** About two minutes of the 16 kHz mono WAV the app sends; the app stops at 30 s. */
const MAX_AUDIO = 4 * 1024 * 1024;

const PastShot = z.object({
  timestamp: z.string(),
  profileTitle: z.string().optional(),
  doseG: z.number().optional(),
  yieldG: z.number().optional(),
  timeS: z.number().optional(),
  grinderSetting: z.string().optional(),
  enjoyment: z.number().optional(),
  notes: z.string().optional(),
});

const Preferences = z.object({
  drink: z.enum(["milk", "straight", "both"]).optional(),
  hasScale: z.boolean().optional(),
  burrs: z.enum(["flat", "conical", "unknown"]).optional(),
  experience: z.enum(["new", "comfortable", "advanced"]).optional(),
  basketDoseG: z.number().min(5).max(30).optional(),
});

const RecommendBody = z.object({
  bean: BeanInfo,
  profileTitles: z.array(z.string()).optional(),
  history: z.array(PastShot).max(50).optional(),
  preferences: Preferences.optional(),
});

const DialInBody = z.object({
  bean: BeanInfo,
  recipe: Recipe,
  shot: PastShot,
  feedback: TasteFeedback,
  history: z.array(PastShot).max(50).optional(),
});

export function createApp(deps: { llm: ProviderChain; decaidUrl?: string | null }) {
  const { llm } = deps;
  const decaidUrl = deps.decaidUrl?.replace(/\/+$/, "") || null;
  const app = new Hono();
  // The tablet skin is served by Decaid from another origin, so allow cross-origin calls.
  app.use("/api/*", cors());

  app.onError((err, c) => {
    if (err instanceof ZodError) return c.json({ error: "invalid request", issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
    console.error(err);
    return c.json({ error: err.message }, 500);
  });

  /** What this server offers. The app reads it to decide what to switch on. */
  app.get("/api/config", (c) => {
    let decaidWs: string | null = null;
    if (decaidUrl) {
      const ws = new URL(decaidUrl);
      ws.protocol = ws.protocol === "https:" ? "wss:" : "ws:";
      decaidWs = `${ws.origin}/ws/v1/machine/snapshot`;
    }
    return c.json({
      crema: true,
      ai: true,
      providers: llm.providers.map((p) => ({ id: p.id, billing: p.billing })),
      // Which provider turns speech into text, or null when none can (no GEMINI_API_KEY).
      voice: llm.transcribers[0]?.id ?? null,
      decaidUrl,
      decaidWs,
    });
  });

  /** A short voice note describing a coffee bag → text, for the "Describe it" box. */
  app.post("/api/transcribe", async (c) => {
    if (!llm.transcribers.length) return c.json({ error: "Speaking needs a Gemini API key on the Crema server (GEMINI_API_KEY)." }, 501);
    const form = await c.req.parseBody();
    const f = form["audio"];
    if (!(f instanceof File)) return c.json({ error: "send the recording as the audio field" }, 400);
    const type = f.type.split(";")[0] as AudioInput["mediaType"];
    if (!AUDIO.has(type)) return c.json({ error: `unsupported audio type ${f.type || "(none)"}` }, 400);
    if (f.size > MAX_AUDIO) return c.json({ error: "recording too long" }, 413);
    const out = await llm.transcribe({
      audio: { data: Buffer.from(await f.arrayBuffer()), mediaType: type },
      context: "The speaker is describing a bag of specialty coffee they own: the roaster, the coffee's name, and maybe the origin, process, roast date, bag weight or tasting notes.",
    });
    return c.json(out);
  });

  /** Photo(s), search text, a spoken or typed description, or a URL → BeanInfo. */
  app.post("/api/identify", async (c) => {
    const form = await c.req.parseBody({ all: true });
    const files = ([] as unknown[]).concat(form["images"] ?? []).filter((f): f is File => f instanceof File);
    const images: ImageInput[] = [];
    for (const f of files) {
      if (!MEDIA.has(f.type)) return c.json({ error: `unsupported image type ${f.type}` }, 400);
      images.push({ data: Buffer.from(await f.arrayBuffer()), mediaType: f.type as ImageInput["mediaType"] });
    }
    const str = (k: string) => (typeof form[k] === "string" && form[k] ? (form[k] as string).trim() || undefined : undefined);
    const text = IdentifyText.parse({ query: str("query"), description: str("description"), url: str("url"), today: str("today") });
    const info = await identify(llm, { images, ...text, offline: str("offline") === "true" });
    // The roaster's own packshot: prefer what the page's metadata says over a URL the model may have guessed.
    if (info.imageUrl && (!isSafeUrl(info.imageUrl) || isPlaceholderImage(info.imageUrl))) info.imageUrl = null;
    if (info.productUrl && str("offline") !== "true") {
      const found = await findProductImage(info.productUrl);
      info.imageUrl = (found && !isPlaceholderImage(found) ? found : null) ?? info.imageUrl;
    }
    return c.json({ info, provider: llm.lastUsed });
  });

  /** Coffee + installed profiles + past shots + setup → recipe (rules ranking, then AI choice). */
  app.post("/api/recommend", async (c) => {
    const body = RecommendBody.parse(await c.req.json());
    return c.json(await recommend(llm, body));
  });

  /** Taste feedback on a shot → the one change to make next. */
  app.post("/api/dialin", async (c) => {
    const body = DialInBody.parse(await c.req.json());
    return c.json({ advice: await dialIn(llm, body) });
  });

  /** Download a roaster product photo once and serve it from here (works when the tablet is offline). */
  app.post("/api/images/cache", async (c) => {
    const { url } = z.object({ url: z.string().url() }).parse(await c.req.json());
    const path = await cacheImage(url);
    if (!path) return c.json({ error: "couldn't download that image" }, 502);
    return c.json({ path });
  });
  app.get("/api/images/:name", async (c) => {
    const img = await readCachedImage(c.req.param("name"));
    if (!img) return c.json({ error: "not found" }, 404);
    return c.body(new Uint8Array(img.data), 200, { "content-type": img.type, "cache-control": "public, max-age=31536000, immutable" });
  });

  /** Same-origin proxy to Decaid's REST API, for the phone app served from here. */
  app.all("/decaid/*", async (c) => {
    if (!decaidUrl) return c.json({ error: "DECAID_URL isn't set on the Crema server" }, 503);
    const target = new URL(c.req.path.replace(/^\/decaid/, "") + (new URL(c.req.url).search || ""), decaidUrl);
    const init: RequestInit = { method: c.req.method, headers: { "content-type": c.req.header("content-type") ?? "application/json" } };
    if (!["GET", "HEAD"].includes(c.req.method)) init.body = await c.req.arrayBuffer();
    try {
      const res = await fetch(target, init);
      return new Response(res.body, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
    } catch (e) {
      return c.json({ error: `Couldn't reach the machine: ${(e as Error).message}` }, 502);
    }
  });

  return app;
}
