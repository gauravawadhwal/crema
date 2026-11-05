import { Hono } from "hono";
import { cors } from "hono/cors";
import { z, ZodError } from "zod";
import { identify } from "./identify.js";
import { cacheImage, findProductImage, isSafeUrl, readCachedImage } from "./images.js";
import type { ProviderChain } from "./llm/index.js";
import type { ImageInput } from "./llm/types.js";
import { dialIn, recommend } from "./recommend/index.js";
import { BeanInfo, Recipe, TasteFeedback } from "./schema.js";

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
      decaidUrl,
      decaidWs,
    });
  });

  /** Photo(s), search text or a URL → BeanInfo. */
  app.post("/api/identify", async (c) => {
    const form = await c.req.parseBody({ all: true });
    const files = ([] as unknown[]).concat(form["images"] ?? []).filter((f): f is File => f instanceof File);
    const images: ImageInput[] = [];
    for (const f of files) {
      if (!MEDIA.has(f.type)) return c.json({ error: `unsupported image type ${f.type}` }, 400);
      images.push({ data: Buffer.from(await f.arrayBuffer()), mediaType: f.type as ImageInput["mediaType"] });
    }
    const str = (k: string) => (typeof form[k] === "string" && form[k] ? (form[k] as string) : undefined);
    const info = await identify(llm, { images, query: str("query"), url: str("url"), offline: str("offline") === "true" });
    // The roaster's own packshot: prefer what the page's metadata says over a URL the model may have guessed.
    if (info.imageUrl && !isSafeUrl(info.imageUrl)) info.imageUrl = null;
    if (info.productUrl && str("offline") !== "true") {
      info.imageUrl = (await findProductImage(info.productUrl)) ?? info.imageUrl;
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
