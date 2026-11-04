import { Hono } from "hono";
import { cors } from "hono/cors";
import { DecaidClient, type ShotSummary } from "./decaid.js";
import { identify } from "./identify.js";
import type { ProviderChain } from "./llm/index.js";
import type { ImageInput } from "./llm/types.js";
import { dialIn, recommend, type PastShot } from "./recommend/index.js";
import { baseline } from "./recommend/rules.js";
import { BeanInfo, Recipe, TasteFeedback } from "./schema.js";
import type { Store } from "./store.js";

const MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function toPastShot(s: ShotSummary): PastShot {
  const m = s.measurements as { machine?: { timestamp?: string } }[] | undefined;
  let timeS: number | undefined;
  if (m && m.length > 1) {
    const t0 = Date.parse(m[0].machine?.timestamp ?? "");
    const t1 = Date.parse(m.at(-1)!.machine?.timestamp ?? "");
    if (!Number.isNaN(t0) && !Number.isNaN(t1)) timeS = Math.round((t1 - t0) / 1000);
  }
  return {
    timestamp: s.timestamp,
    profileTitle: s.workflow?.profile?.title ?? s.workflow?.name,
    doseG: s.annotations?.actualDoseWeight ?? s.workflow?.context?.targetDoseWeight,
    yieldG: s.annotations?.actualYield ?? s.workflow?.context?.targetYield,
    timeS,
    grinderSetting: s.workflow?.context?.grinderSetting,
    enjoyment: s.annotations?.enjoyment,
    notes: s.annotations?.espressoNotes,
  };
}

export function createApp(deps: { llm: ProviderChain; decaid: DecaidClient; store: Store }) {
  const { llm, decaid, store } = deps;
  const app = new Hono();
  // The skin is served by Decaid on the tablet (localhost) and the phone app by
  // this server, so allow cross-origin calls on the LAN.
  app.use("/api/*", cors());

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: err.message }, 500);
  });

  app.get("/api/health", async (c) => {
    let machine: unknown = null;
    try {
      machine = await decaid.machineState();
    } catch (e) {
      machine = { error: (e as Error).message };
    }
    return c.json({
      providers: llm.providers.map((p) => ({ id: p.id, billing: p.billing })),
      decaid: decaid.baseUrl,
      machine,
    });
  });

  app.get("/api/config", (c) => {
    const ws = new URL(decaid.baseUrl);
    ws.protocol = ws.protocol === "https:" ? "wss:" : "ws:";
    return c.json({ decaidUrl: decaid.baseUrl, decaidWs: `${ws.origin}/ws/v1/machine/snapshot` });
  });

  /** Photo(s), search text or a URL → BeanInfo (not saved yet). */
  app.post("/api/identify", async (c) => {
    const form = await c.req.parseBody({ all: true });
    const files = ([] as unknown[]).concat(form["images"] ?? []).filter((f): f is File => f instanceof File);
    const images: ImageInput[] = [];
    for (const f of files) {
      if (!MEDIA.has(f.type)) return c.json({ error: `unsupported image type ${f.type}` }, 400);
      images.push({ data: Buffer.from(await f.arrayBuffer()), mediaType: f.type as ImageInput["mediaType"] });
    }
    const str = (k: string) => (typeof form[k] === "string" && form[k] ? (form[k] as string) : undefined);
    const info = await identify(llm, {
      images,
      query: str("query"),
      url: str("url"),
      offline: str("offline") === "true",
    });
    return c.json({ info, provider: llm.lastUsed });
  });

  /** Save a confirmed BeanInfo to Decaid (bean + batch) and Crema's store. */
  app.post("/api/beans", async (c) => {
    const body = await c.req.json<{ info: unknown; photo?: string | null }>();
    const info = BeanInfo.parse(body.info);
    const existing = (await decaid.listBeans()).find(
      (b) => b.roaster === info.roaster.value && b.name === info.name.value,
    );
    const bean =
      existing ??
      (await decaid.createBean({
        roaster: info.roaster.value ?? "Unknown roaster",
        name: info.name.value ?? "Unknown coffee",
        country: info.country.value,
        region: info.region.value,
        producer: info.producer.value,
        processing: info.process.value,
        variety: info.variety.value,
        altitude: info.altitudeMasl.value,
        notes: info.tastingNotes.value?.join(", ") ?? null,
      }));
    const batch = await decaid.createBatch(bean.id, {
      roastDate: info.roastDate.value ? `${info.roastDate.value}T00:00:00Z` : null,
      roastLevel: info.roastLevel.value,
      weight: info.weightGrams,
    });
    const rec = {
      decaidBeanId: bean.id,
      decaidBatchId: batch.id,
      info,
      recipe: null,
      photo: body.photo ?? null,
      addedAt: new Date().toISOString(),
    };
    await store.put(rec);
    return c.json(rec, 201);
  });

  /** Everything the shelf view needs in one call. */
  app.get("/api/shelf", async (c) => {
    const beans = await decaid.listBeans();
    const records = await Promise.all(beans.map((b) => store.get(b.id)));
    const shelf = await Promise.all(
      beans.map(async (b, i) => {
        const rec = records[i];
        const batches = await decaid.listBatches(b.id).catch(() => []);
        const rest = rec ? baseline(rec.info).rest : null;
        return { bean: b, batches, record: rec, rest };
      }),
    );
    return c.json(shelf);
  });

  app.post("/api/recommend", async (c) => {
    const { beanId, rulesOnly, preferences } = await c.req.json<{ beanId: string; rulesOnly?: boolean; preferences?: Record<string, unknown> }>();
    const rec = await store.get(beanId);
    if (!rec) return c.json({ error: "bean not in Crema's store; add it first" }, 404);
    const [profiles, shots] = await Promise.all([
      decaid.listProfiles(),
      rec.decaidBatchId ? decaid.shots({ beanBatchId: rec.decaidBatchId, limit: 15 }) : Promise.resolve({ items: [], total: 0 }),
    ]);
    const out = await recommend(llm, {
      bean: rec.info,
      profileTitles: profiles.filter((p) => (p.profile.beverage_type ?? "espresso") === "espresso").map((p) => p.profile.title),
      history: shots.items.map(toPastShot),
      preferences,
      rulesOnly,
    });
    out.recipe.profileId = profiles.find((p) => p.profile.title === out.recipe.profileTitle)?.id ?? null;
    await store.patch(beanId, { recipe: out.recipe });
    return c.json(out);
  });

  /** Load the recipe onto the machine: profile + dose/yield + bean context. */
  app.post("/api/apply", async (c) => {
    const { beanId, recipe: raw } = await c.req.json<{ beanId: string; recipe?: unknown }>();
    const rec = await store.get(beanId);
    if (!rec) return c.json({ error: "unknown bean" }, 404);
    const recipe = raw ? Recipe.parse(raw) : rec.recipe;
    if (!recipe) return c.json({ error: "no recipe yet; call /api/recommend" }, 400);
    const profiles = await decaid.listProfiles();
    const profile = profiles.find((p) => p.id === recipe.profileId) ?? profiles.find((p) => p.profile.title === recipe.profileTitle);
    if (!profile) return c.json({ error: `profile "${recipe.profileTitle}" not found on the machine` }, 404);
    const workflow = await decaid.putWorkflow({
      profile: { ...profile.profile, target_weight: recipe.yieldG },
      context: {
        targetDoseWeight: recipe.doseG,
        targetYield: recipe.yieldG,
        beanBatchId: rec.decaidBatchId ?? undefined,
        coffeeName: rec.info.name.value ?? undefined,
        coffeeRoaster: rec.info.roaster.value ?? undefined,
      },
    });
    return c.json({ ok: true, workflow });
  });

  app.get("/api/shots", async (c) => {
    const limit = Number(c.req.query("limit") ?? 10);
    const res = await decaid.shots({ limit });
    return c.json(res);
  });

  app.get("/api/shots/:id", async (c) => c.json(await decaid.shot(c.req.param("id"))));

  /** Taste feedback on a shot → annotation saved + one suggested change. */
  app.post("/api/shots/:id/feedback", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ beanId: string; feedback: unknown }>();
    const feedback = TasteFeedback.parse(body.feedback);
    const rec = await store.get(body.beanId);
    if (!rec?.recipe) return c.json({ error: "bean has no recipe yet" }, 400);
    const shot = await decaid.shot(id);
    await decaid.annotateShot(id, {
      ...(shot.annotations ?? {}),
      enjoyment: feedback.enjoyment,
      espressoNotes: feedback.notes ?? shot.annotations?.espressoNotes,
      extras: { crema: { sourBitter: feedback.sourBitter, body: feedback.body } },
    });
    const history = rec.decaidBatchId ? (await decaid.shots({ beanBatchId: rec.decaidBatchId, limit: 10 })).items.map(toPastShot) : [];
    const advice = await dialIn(llm, { bean: rec.info, recipe: rec.recipe, shot: toPastShot(shot), feedback, history });
    return c.json({ advice });
  });

  return app;
}
