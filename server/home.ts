import type { Hono } from "hono";
import { z } from "zod";
import type { DecaidClient, ShotSummary } from "./decaid.js";
import { CATALOG } from "./profiles/catalog.js";
import { rankProfiles } from "./profiles/match.js";
import type { Store } from "./store.js";

/**
 * Routes for day-to-day use beyond coffee identification: the machine proxy,
 * preferences, favourites, reference shots, bag state, maintenance and the
 * profile catalog.
 */

const Prefs = z.object({
  drink: z.enum(["milk", "straight", "both"]).optional(),
  hasScale: z.boolean().optional(),
  burrs: z.enum(["flat", "conical", "unknown"]).optional(),
  experience: z.enum(["new", "comfortable", "advanced"]).optional(),
  basketDoseG: z.number().min(5).max(30).optional(),
});

const Fav = z.object({
  name: z.string().min(1).max(40),
  profileTitle: z.string(),
  doseG: z.number(),
  yieldG: z.number(),
  tempC: z.number(),
  beanId: z.string().nullable(),
  grinderSetting: z.string().nullable(),
});

const isEspressoShot = (s: ShotSummary) => !/clean|flush|descal|rinse/i.test(s.workflow?.profile?.title ?? s.workflow?.name ?? "");

export function registerHomeRoutes(app: Hono, { decaid, store }: { decaid: DecaidClient; store: Store }) {
  /**
   * Same-origin proxy to Decaid's REST API, so the iPhone app (served by Crema)
   * can control the machine without cross-origin setup. WebSockets go direct.
   */
  app.all("/decaid/*", async (c) => {
    const target = new URL(c.req.path.replace(/^\/decaid/, "") + (new URL(c.req.url).search || ""), decaid.baseUrl);
    const init: RequestInit = { method: c.req.method, headers: { "content-type": c.req.header("content-type") ?? "application/json" } };
    if (!["GET", "HEAD"].includes(c.req.method)) init.body = await c.req.arrayBuffer();
    try {
      const res = await fetch(target, init);
      return new Response(res.body, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
    } catch (e) {
      return c.json({ error: `Couldn't reach the machine: ${(e as Error).message}` }, 502);
    }
  });

  app.get("/api/preferences", async (c) => c.json(await store.getPreferences()));
  app.put("/api/preferences", async (c) => c.json(await store.setPreferences(Prefs.parse(await c.req.json()))));

  const PresetsSchema = z.object({
    steam: z.array(z.object({ label: z.string().min(1).max(24), seconds: z.number().min(0).max(600) })).max(6),
    water: z.array(z.object({ label: z.string().min(1).max(24), ml: z.number().min(10).max(500) })).max(6),
    flush: z.array(z.object({ label: z.string().min(1).max(24), seconds: z.number().min(1).max(60) })).max(6),
    selected: z.object({ steam: z.number().int().min(0), water: z.number().int().min(0), flush: z.number().int().min(0) }),
  });
  app.get("/api/presets", async (c) => c.json(await store.getPresets()));
  app.put("/api/presets", async (c) => c.json(await store.setPresets(PresetsSchema.parse(await c.req.json()))));

  app.get("/api/favourites", async (c) => c.json(await store.getFavourites()));
  app.put("/api/favourites/:slot", async (c) => {
    const slot = Number(c.req.param("slot"));
    if (!Number.isInteger(slot) || slot < 0 || slot > 4) return c.json({ error: "slot must be 0–4" }, 400);
    const body = await c.req.json();
    return c.json(await store.setFavourite(slot, body === null ? null : Fav.parse(body)));
  });

  /** Pin a reference shot for a bag, or clear it with {shotId: null}. */
  app.put("/api/beans/:id/best-shot", async (c) => {
    const { shotId } = await c.req.json<{ shotId: string | null }>();
    return c.json(await store.patch(c.req.param("id"), { bestShotId: shotId }));
  });

  /** Freeze/unfreeze the current bag, or mark it finished (archives it in Decaid). */
  app.put("/api/beans/:id/state", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ frozen?: boolean; finished?: boolean }>();
    const rec = await store.get(id);
    if (!rec) return c.json({ error: "unknown bean" }, 404);
    if (body.frozen !== undefined && rec.decaidBatchId) await decaid.updateBatch(rec.decaidBatchId, { frozen: body.frozen });
    if (body.finished !== undefined) {
      await decaid.updateBean(id, { archived: body.finished });
      await store.patch(id, { finished: body.finished });
    }
    return c.json({ ok: true });
  });

  /** Shots since the last backflush and days since the last descale. */
  app.get("/api/maintenance", async (c) => {
    const m = await store.getMaintenance();
    let shotsSinceBackflush: number | null = null;
    try {
      const { items } = await decaid.shots({ limit: 500 });
      const since = m.lastBackflush ? Date.parse(m.lastBackflush) : 0;
      shotsSinceBackflush = items.filter((s) => Date.parse(s.timestamp) > since && isEspressoShot(s)).length;
    } catch {
      /* machine offline */
    }
    const daysSinceDescale = m.lastDescale ? Math.floor((Date.now() - Date.parse(m.lastDescale)) / 864e5) : null;
    return c.json({
      ...m,
      shotsSinceBackflush,
      daysSinceDescale,
      backflushDue: shotsSinceBackflush != null && shotsSinceBackflush >= m.backflushEveryShots,
      descaleDue: daysSinceDescale != null && daysSinceDescale >= m.descaleEveryDays,
    });
  });
  app.post("/api/maintenance/:kind/done", async (c) => {
    const kind = c.req.param("kind");
    const now = new Date().toISOString();
    if (kind === "backflush") return c.json(await store.setMaintenance({ lastBackflush: now }));
    if (kind === "descale") return c.json(await store.setMaintenance({ lastDescale: now }));
    return c.json({ error: "kind is backflush or descale" }, 400);
  });
  app.put("/api/maintenance", async (c) => {
    const body = z.object({ backflushEveryShots: z.number().int().min(10).max(1000).optional(), descaleEveryDays: z.number().int().min(7).max(365).optional() }).parse(await c.req.json());
    return c.json(await store.setMaintenance(body));
  });

  /** The community profile catalog, marked with what's installed on the machine. */
  app.get("/api/profiles/catalog", async (c) => {
    const installed = await decaid.listProfiles().then((ps) => new Set(ps.map((p) => p.profile.title.toLowerCase()))).catch(() => null);
    return c.json(CATALOG.map((p) => ({ ...p, installed: installed ? installed.has(p.title.toLowerCase()) : null })));
  });

  /** Rules-only ranking for a bag: instant, no AI. Powers the Profiles view. */
  app.get("/api/profiles/rank/:beanId", async (c) => {
    const rec = await store.get(c.req.param("beanId"));
    if (!rec) return c.json({ error: "unknown bean" }, 404);
    const titles = await decaid.listProfiles().then((ps) => ps.map((p) => p.profile.title)).catch(() => undefined);
    const ranked = rankProfiles(rec.info, await store.getPreferences(), titles);
    return c.json(ranked.map(({ profile: _p, ...r }) => r));
  });
}

/** Grams used from a batch, from the doses of the shots pulled on it. */
export async function batchUsage(decaid: DecaidClient, batchId: string) {
  const { items } = await decaid.shots({ beanBatchId: batchId, limit: 500 });
  const shots = items.filter(isEspressoShot);
  const grams = shots.reduce((sum, s) => sum + (s.annotations?.actualDoseWeight ?? s.workflow?.context?.targetDoseWeight ?? 0), 0);
  return { shots: shots.length, grams: Math.round(grams * 10) / 10 };
}
