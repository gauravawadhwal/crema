/* Crema web app: the DE1 tablet skin, the iPhone companion and the demo.

   Live mode talks to Decaid (the tablet app that runs the machine) for
   everything, and keeps Crema's own records in Decaid's key-value store. The
   Crema server is an optional AI add-on; without it, or with AI switched off,
   Crema uses the rules in engine.js. When Decaid can't be reached, the page
   runs the self-contained demo from demo.js.

   API interface (implemented by makeLiveApi below and makeDemoApi in demo.js):
     info, ai { available, on, healthy }, settings { get, set },
     shelf, identify, saveBean, setBeanState, pinBest, recommend, rank, catalog,
     apply, shots, annotate, feedback, prefs, favourites, presets, maintenance,
     machine { setState, tare, shotSettings, settings, waterThreshold, presence,
               schedules, display, plugins, info, heartbeat }, subscribe */
"use strict";

/* ================= utilities ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const local = {
  get(k, d) { try { const v = localStorage.getItem("crema:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("crema:" + k, JSON.stringify(v)); } catch {} },
};
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const DAY = 864e5;
const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DAY) : null);
const round = (n, step) => Math.round(n / step) * step;
const fmt1 = (n) => (n == null || Number.isNaN(n) ? "–" : Number(n).toFixed(1));
const fmtC = (n) => (n == null || Number.isNaN(n) ? "–" : Number.isInteger(Number(n)) ? String(Number(n)) : Number(n).toFixed(1));
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2800);
}

/* ================= theme ================= */
const HOST_THEME = document.documentElement.getAttribute("data-theme");
// Fixed-look themes. Verde is the default. Crema follows the light/dark setting; the rest set their own.
// The choice is saved only when someone picks a theme, so devices that never chose follow DEFAULT_SKIN.
const DEFAULT_SKIN = "verde";
const SKINS = [
  { id: "verde", name: "Verde", note: "Vintage Italian café: bottle green and brass.", pv: ["#15241e", "#c9a24a", "#1d3128", "#7fd6a6", "#79b4e8", "#d1ab7c"], bg: "#0e1a15" },
  { id: "crema", name: "Crema", note: "Roasted brown and crema gold. Follows light or dark.", pv: ["#211a16", "#e0a458", "#2b231e", "#5cc59a", "#6aa8ea", "#c99a6b"], bg: "#17120f" },
  { id: "rosso", name: "Rosso", note: "Italian bar machine: red lacquer on polished steel.", pv: ["#f7f8f8", "#c3141b", "#dde0e3", "#1b7a52", "#1d60ad", "#7a5230"], bg: "#e6e8ea" },
  { id: "acciaio", name: "Acciaio", note: "Industrial black and steel, like the machine.", pv: ["#171a1d", "#e9edf0", "#21252a", "#4fd19a", "#63a9f2", "#c9a27a"], bg: "#0e1012" },
  { id: "nordic", name: "Nordic", note: "Light-roast café: birch, ink and fjord blue.", pv: ["#fbfbf9", "#2f6a8c", "#e2e6e1", "#2a8a64", "#2f6a8c", "#8a6340"], bg: "#eef0ed" },
  { id: "notte", name: "Notte", note: "True black and dim amber for the first shot.", pv: ["#0b0b0b", "#b8742e", "#151515", "#3f9c75", "#4b7fb3", "#9b7856"], bg: "#000000" },
];
function currentSkin() { return document.documentElement.getAttribute("data-skin") || "crema"; }
function applySkin(id, redraw = true, save = false) {
  const skin = SKINS.find((x) => x.id === id) ? id : DEFAULT_SKIN;
  if (skin === "crema") document.documentElement.removeAttribute("data-skin");
  else document.documentElement.setAttribute("data-skin", skin);
  if (save) local.set("look", skin);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", css("--bg") || "#0e1a15");
  if (redraw && S.api) route(false);
}
function applyTheme(mode, redraw = true) {
  const root = document.documentElement;
  if (mode === "light" || mode === "dark") root.setAttribute("data-theme", mode);
  else if (HOST_THEME) root.setAttribute("data-theme", HOST_THEME);
  else root.removeAttribute("data-theme");
  local.set("theme", mode);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", css("--bg") || "#0e1a15");
  $$("[data-theme-set]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeSet === mode)));
  if (redraw && S.api) route(false);
}

/* ================= rest window (mirror server/profiles/match) ================= */
const REST = { light: [14, 40], "medium-light": [10, 35], medium: [7, 28], "medium-dark": [5, 24], dark: [4, 21] };
function restOf(info) {
  const roast = info?.roastLevel?.value || (info?.isBlend ? "medium" : "medium-light");
  const w = REST[roast] || REST["medium-light"];
  const d = daysSince(info?.roastDate?.value);
  if (d == null) return { days: null, window: w, status: "unknown", label: "No roast date" };
  if (d < w[0]) return { days: d, window: w, status: "resting", label: "Resting" };
  if (d <= w[1]) return { days: d, window: w, status: "peak", label: "In its window" };
  return { days: d, window: w, status: "fading", label: "Past its best" };
}
/* ================= live API =================
   Everything except AI goes straight to Decaid: machine control, beans,
   batches, profiles, workflow and shots through its REST API, and Crema's own
   records and settings in Decaid's key-value store (namespace "crema"), so the
   tablet and phones share them without any other server. Ranking, rules
   recipes and dial-in rules run here (skin/engine.js).

   The Crema server is optional. When it's connected and AI features are on,
   it identifies coffees, makes the AI profile choice and gives AI dial-in
   advice. If it's off, unreachable or fails, the rules take over. */
const E = window.CremaEngine;
const KV_NS = "crema";
const isEspresso = (title) => !/clean|flush|descal|rinse|steam/i.test(title || "");
const PROCESS_KINDS = ["washed", "natural", "honey", "anaerobic", "wet-hulled", "decaf", "experimental"];
function processKindOf(text) {
  const t = String(text || "").toLowerCase();
  return PROCESS_KINDS.find((k) => t.includes(k.replace("-", " ")) || t.includes(k)) || (t ? "other" : null);
}
/** A BeanInfo for a bean Crema didn't add itself (for example one created by another skin). */
function infoFromDecaidBean(b, batch) {
  const v = (x) => ({ value: x == null || (Array.isArray(x) && !x.length) ? null : x, source: x == null ? null : "bag" });
  const notes = typeof b.notes === "string" ? b.notes.split(/,\s*/).filter(Boolean) : null;
  return {
    roaster: v(b.roaster), name: v(b.name), country: v(b.country ?? null), region: v(b.region ?? null), producer: v(b.producer ?? null),
    variety: v(b.variety ?? null), process: v(b.processing ?? null), processKind: processKindOf(b.processing), altitudeMasl: v(b.altitude ?? null),
    roastLevel: v(batch?.roastLevel ?? null), roastedFor: null, roastDate: v(batch?.roastDate ? String(batch.roastDate).slice(0, 10) : null),
    bestBefore: null, weightGrams: batch?.weight ?? null, tastingNotes: v(notes), isBlend: null, blendComponents: null, roasterRecipe: null,
    productUrl: null, imageUrl: null, sources: [], confidence: 1, needsConfirmation: [], summary: "",
  };
}

function makeLiveApi(conn) {
  // conn: { decaid: REST base ("/decaid" via the Crema server's proxy, or "http://host:8080"),
  //         decaidWs: "ws://host:8080", crema: Crema server base ("" same origin, "http://…", or null),
  //         cremaInfo: its /api/config, cremaError: why a saved server couldn't be reached }
  const j = async (url, opts = {}) => {
    const init = { ...opts };
    if (opts.body && !(opts.body instanceof FormData)) init.headers = { "content-type": "application/json" };
    const res = await fetch(url, init);
    const text = await res.text();
    const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
    if (!res.ok) { const e = new Error((data && data.error) || `${res.status} ${res.statusText}`); e.status = res.status; throw e; }
    return data;
  };
  const put = (url, body) => j(url, { method: "PUT", body: JSON.stringify(body) });
  const post = (url, body) => j(url, { method: "POST", body: JSON.stringify(body ?? {}) });
  const D = (p) => `${conn.decaid}/api/v1${p}`;
  const C = (p) => `${conn.crema}${p}`;
  const wsBase = conn.decaidWs;

  // ---- Crema's data in Decaid's key-value store ----
  const kvUrl = (key) => D(`/store/${KV_NS}/${encodeURIComponent(key)}`);
  const kvGet = async (key, fallback) => { try { return await j(kvUrl(key)); } catch (e) { if (e.status === 404) return fallback; throw e; } };
  const kvSet = (key, value) => post(kvUrl(key), value);
  const recordOf = (beanId) => kvGet(`bean:${beanId}`, null);
  const patchRecord = async (beanId, patch) => kvSet(`bean:${beanId}`, { ...((await recordOf(beanId)) || {}), ...patch });

  let settings = { ...E.DEFAULT_SETTINGS };
  const aiOn = () => !!(settings.aiEnabled && conn.crema != null);
  // Calls to the Crema server: any failure marks it unhealthy (the rules stand in), a success clears it.
  let healthy = true;
  const cremaCall = async (fn) => {
    const was = healthy;
    try { const out = await fn(); healthy = true; return out; }
    catch (e) { if (!e.status || e.status >= 500) healthy = false; throw e; }
    finally { if (was !== healthy) window.dispatchEvent(new Event("crema:ai")); }
  };

  // ---- shots ----
  const shotPoints = (full) => {
    const m = full.measurements || [];
    const t0 = m.length ? Date.parse(m[0].machine.timestamp) : 0;
    return m.map((x) => ({ t: (Date.parse(x.machine.timestamp) - t0) / 1000, p: x.machine.pressure ?? 0, f: x.machine.flow ?? 0, w: x.scale?.weight ?? 0, temp: x.machine.mixTemperature, tp: x.machine.targetPressure, tf: x.machine.targetFlow }));
  };
  const toShot = (s, full) => {
    const ctx = s.workflow?.context || {};
    const points = full ? shotPoints(full) : [];
    return { id: s.id, timestamp: s.timestamp, beanId: null, batch: ctx.beanBatchId, coffee: ctx.coffeeName, roaster: ctx.coffeeRoaster, profileTitle: s.workflow?.profile?.title ?? s.workflow?.name,
      doseG: s.annotations?.actualDoseWeight ?? ctx.targetDoseWeight, yieldG: s.annotations?.actualYield ?? ctx.targetYield, timeS: points.length ? Math.round(points.at(-1).t) : null,
      enjoyment: s.annotations?.enjoyment ?? null, notes: s.annotations?.espressoNotes ?? "", grinderSetting: ctx.grinderSetting, points };
  };
  const batchShots = async (batchId, limit = 500) => (batchId ? (await j(D(`/shots?beanBatchId=${encodeURIComponent(batchId)}&limit=${limit}`)).catch(() => ({ items: [] }))).items : []);

  // ---- one coffee, assembled from Decaid + Crema's record ----
  async function coffee(beanId) {
    const [bean, rec, batches] = await Promise.all([j(D(`/beans/${beanId}`)), recordOf(beanId), j(D(`/beans/${beanId}/batches?includeArchived=false`)).catch(() => [])]);
    const batch = batches.find((x) => x.id === rec?.batchId) ?? batches[0] ?? null;
    return { bean, rec, batch, info: rec?.info ?? infoFromDecaidBean(bean, batch) };
  }
  const installedTitles = async () => (await j(D("/profiles?visibility=visible"))).filter((p) => (p.profile.beverage_type ?? "espresso") === "espresso").map((p) => p.profile.title);

  let heartbeatAt = 0;
  const api = {
    demo: false,
    info: {
      providers: conn.cremaInfo?.providers ?? [],
      decaidUrl: conn.decaid === "/decaid" ? conn.cremaInfo?.decaidUrl : conn.decaid,
      server: conn.crema == null ? null : conn.crema || location.origin,
      serverError: conn.cremaError || null,
    },
    ai: { get available() { return conn.crema != null; }, get enabled() { return settings.aiEnabled !== false; }, get on() { return aiOn(); }, get healthy() { return healthy; } },
    settings: {
      async get() { settings = { ...E.DEFAULT_SETTINGS, ...(await kvGet("settings", {})) }; return { ...settings }; },
      async set(p) { settings = { ...settings, ...p }; await kvSet("settings", settings); return { ...settings }; },
    },

    async shelf() {
      const beans = await j(D("/beans?includeArchived=false"));
      const rows = await Promise.all(beans.map(async (b) => {
        const [rec, batches] = await Promise.all([recordOf(b.id).catch(() => null), j(D(`/beans/${b.id}/batches?includeArchived=false`)).catch(() => [])]);
        if (rec?.finished) return null;
        const batch = batches.find((x) => x.id === rec?.batchId) ?? batches[0] ?? null;
        const info = rec?.info ?? infoFromDecaidBean(b, batch);
        const shots = (await batchShots(batch?.id)).filter((s) => isEspresso(s.workflow?.profile?.title ?? s.workflow?.name));
        const grams = shots.reduce((sum, s) => sum + (s.annotations?.actualDoseWeight ?? s.workflow?.context?.targetDoseWeight ?? 0), 0);
        const weight = batch?.weight ?? info.weightGrams ?? null;
        return {
          id: b.id, batch: batch?.id ?? null, info, recipe: rec?.recipe ?? null, recipeSource: rec?.recipeSource ?? (rec?.recipe ? "saved" : null),
          photo: rec?.photo ?? null, productImage: rec?.productImage ?? info.imageUrl ?? null, art: rec?.art,
          weight, remaining: weight != null ? Math.max(0, Math.round(weight - grams)) : batch?.weightRemaining ?? null,
          frozen: batch?.frozen ?? false, bestShotId: rec?.bestShotId ?? null, shots: shots.length,
        };
      }));
      return rows.filter(Boolean);
    },

    async identify({ files, query, url, offline }, onStep) {
      if (!aiOn()) throw new Error(conn.crema == null ? "Identifying needs a Crema server. Enter the details by hand instead." : "AI features are off. Enter the details by hand, or switch AI on in Settings.");
      onStep(0, [files?.length ? "Reading the bag and finding the roaster's page" : "Looking up the coffee", "Building the record"]);
      const fd = new FormData();
      (files || []).forEach((f) => fd.append("images", f));
      if (query) fd.set("query", query); if (url) fd.set("url", url); if (offline) fd.set("offline", "true");
      return (await cremaCall(() => j(C("/api/identify"), { method: "POST", body: fd }))).info;
    },

    async saveBean(info, photo, art) {
      const all = await j(D("/beans?includeArchived=true"));
      let bean = all.find((b) => b.roaster === info.roaster.value && b.name === info.name.value);
      if (!bean) {
        bean = await post(D("/beans"), {
          roaster: info.roaster.value || "Unknown roaster", name: info.name.value || "Unknown coffee",
          country: info.country.value, region: info.region.value, producer: info.producer.value, processing: info.process.value,
          variety: info.variety.value, altitude: info.altitudeMasl.value, notes: info.tastingNotes.value?.join(", ") ?? null,
        });
      } else if (bean.archived) await put(D(`/beans/${bean.id}`), { archived: false });
      const batch = await post(D(`/beans/${bean.id}/batches`), {
        roastDate: info.roastDate.value ? `${info.roastDate.value}T00:00:00Z` : null, roastLevel: info.roastLevel.value, weight: info.weightGrams,
      });
      // Keep a copy of the roaster's photo on the Crema server when there is one, so it shows offline.
      let productImage = info.imageUrl || null;
      if (productImage && conn.crema != null && /^https?:/.test(productImage)) {
        try { productImage = conn.crema + (await post(C("/api/images/cache"), { url: productImage })).path; } catch {}
      }
      await kvSet(`bean:${bean.id}`, { info, recipe: null, recipeSource: null, photo: photo || null, productImage, art: art || (productImage ? "product" : "photo"), bestShotId: null, finished: false, batchId: batch.id, addedAt: new Date().toISOString() });
      return { id: bean.id };
    },
    async setBeanState(id, patch) {
      const { batch } = await coffee(id);
      if (patch.frozen !== undefined && batch) await put(D(`/bean-batches/${batch.id}`), { frozen: patch.frozen });
      if (patch.finished !== undefined) { await put(D(`/beans/${id}`), { archived: patch.finished }); await patchRecord(id, { finished: patch.finished }); }
    },
    pinBest: (id, shotId) => patchRecord(id, { bestShotId: shotId }),

    async recommend(beanId, opts = {}) {
      const [{ info, batch }, titles, prefs] = await Promise.all([coffee(beanId), installedTitles(), api.prefs.get()]);
      const history = (await batchShots(batch?.id, 15)).map(E.toPastShot);
      let out = null, aiFailed = false;
      if (!opts.rulesOnly && aiOn()) {
        try { out = await cremaCall(() => post(C("/api/recommend"), { bean: info, profileTitles: titles, history, preferences: prefs })); }
        catch { aiFailed = true; }
      }
      if (!out) {
        const ranked = E.rankProfiles(info, prefs, titles);
        out = { recipe: E.rulesRecipe({ bean: info, preferences: prefs, profileTitles: titles }, ranked), candidates: ranked.slice(0, 8).map(E.strip), source: aiFailed ? "rules (AI unavailable)" : "rules" };
      }
      await patchRecord(beanId, { info, recipe: out.recipe, recipeSource: out.source, batchId: batch?.id ?? null });
      return out;
    },
    async rank(beanId) {
      const [{ info }, titles, prefs] = await Promise.all([coffee(beanId), installedTitles(), api.prefs.get()]);
      return E.rankProfiles(info, prefs, titles).map(E.strip);
    },
    async catalog() {
      const installed = await installedTitles().then((t) => new Set(t.map((x) => x.toLowerCase()))).catch(() => null);
      return E.CATALOG.map((p) => ({ ...p, installed: installed ? installed.has(p.title.toLowerCase()) : null }));
    },
    async apply(beanId, recipe, grinderSetting) {
      const [{ info, batch }, profiles] = await Promise.all([coffee(beanId), j(D("/profiles?visibility=visible"))]);
      const profile = profiles.find((p) => p.profile.title === recipe.profileTitle);
      if (!profile) throw new Error(`The profile "${recipe.profileTitle}" isn't on the machine`);
      return put(D("/workflow"), {
        profile: E.withTemperature({ ...profile.profile, target_weight: recipe.yieldG }, recipe.tempC),
        context: { targetDoseWeight: recipe.doseG, targetYield: recipe.yieldG, beanBatchId: batch?.id ?? undefined, coffeeName: info.name.value ?? undefined, coffeeRoaster: info.roaster.value ?? undefined, grinderSetting: grinderSetting || undefined },
      });
    },

    async shots(limit = 15) {
      const { items } = await j(D(`/shots?limit=${limit}`));
      return Promise.all(items.map(async (s) => toShot(s, await j(D(`/shots/${encodeURIComponent(s.id)}`)).catch(() => null))));
    },
    annotate: (id, a) => put(D(`/shots/${encodeURIComponent(id)}`), { annotations: a }),
    async feedback(shotId, beanId, fb) {
      const full = await j(D(`/shots/${encodeURIComponent(shotId)}`));
      await put(D(`/shots/${encodeURIComponent(shotId)}`), { annotations: { ...(full.annotations ?? {}), enjoyment: fb.enjoyment, espressoNotes: fb.notes ?? full.annotations?.espressoNotes, extras: { crema: { sourBitter: fb.sourBitter, body: fb.body } } } });
      const [{ info, batch }, rec] = await Promise.all([coffee(beanId), recordOf(beanId)]);
      const shot = E.toPastShot(full);
      const recipe = rec?.recipe ?? E.rulesRecipe({ bean: info });
      if (aiOn()) {
        try {
          const history = (await batchShots(batch?.id, 10)).map(E.toPastShot);
          const { advice } = await cremaCall(() => post(C("/api/dialin"), { bean: info, recipe, shot, feedback: fb, history }));
          return { advice, source: "ai" };
        } catch {}
      }
      return { advice: E.rulesDialIn(fb, shot, recipe), source: "rules" };
    },

    prefs: { get: () => kvGet("preferences", {}), set: async (p) => { const next = { ...(await kvGet("preferences", {})), ...p }; await kvSet("preferences", next); return next; } },
    favourites: {
      get: async () => { const f = await kvGet("favourites", []); return Array.from({ length: 5 }, (_, i) => f[i] ?? null); },
      set: async (slot, fav) => { const f = await api.favourites.get(); f[slot] = fav; await kvSet("favourites", f); return f; },
    },
    presets: { get: () => kvGet("presets", E.DEFAULT_PRESETS), set: async (p) => { await kvSet("presets", p); return p; } },
    maintenance: {
      async get() {
        const m = { ...E.DEFAULT_MAINTENANCE, ...(await kvGet("maintenance", {})) };
        let shotsSinceBackflush = null;
        try {
          const { items } = await j(D("/shots?limit=500"));
          const since = m.lastBackflush ? Date.parse(m.lastBackflush) : 0;
          shotsSinceBackflush = items.filter((s) => Date.parse(s.timestamp) > since && isEspresso(s.workflow?.profile?.title ?? s.workflow?.name)).length;
        } catch {}
        const daysSinceDescale = m.lastDescale ? Math.floor((Date.now() - Date.parse(m.lastDescale)) / DAY) : null;
        return { ...m, shotsSinceBackflush, daysSinceDescale, backflushDue: shotsSinceBackflush != null && shotsSinceBackflush >= m.backflushEveryShots, descaleDue: daysSinceDescale != null && daysSinceDescale >= m.descaleEveryDays };
      },
      async done(kind) { const m = await kvGet("maintenance", {}); m[kind === "backflush" ? "lastBackflush" : "lastDescale"] = new Date().toISOString(); await kvSet("maintenance", m); },
      async set(p) { await kvSet("maintenance", { ...(await kvGet("maintenance", {})), ...p }); },
    },

    machine: {
      canStart: true,
      info: () => j(D("/machine/info")),
      setState: (s) => j(D(`/machine/state/${s}`), { method: "PUT" }),
      tare: () => j(D("/scale/tare"), { method: "PUT" }),
      shotSettings: { get: () => j(D("/machine/shotSettings")).catch(() => null), set: (p) => post(D("/machine/shotSettings"), p) },
      settings: { get: () => j(D("/machine/settings")), set: (p) => post(D("/machine/settings"), p) },
      waterThreshold: (pct) => post(D("/machine/waterLevels"), { warningThresholdPercentage: pct }),
      presence: { get: () => j(D("/presence/settings")), set: (p) => post(D("/presence/settings"), p) },
      schedules: {
        list: () => j(D("/presence/schedules")),
        add: (s) => post(D("/presence/schedules"), s),
        update: (id, p) => put(D(`/presence/schedules/${id}`), p),
        remove: (id) => j(D(`/presence/schedules/${id}`), { method: "DELETE" }),
      },
      display: { get: () => j(D("/display")), brightness: (n) => put(D("/display/brightness"), { brightness: n }) },
      plugins: () => j(D("/plugins")),
      heartbeat() { if (Date.now() - heartbeatAt > 30000) { heartbeatAt = Date.now(); post(D("/machine/heartbeat")).catch(() => {}); } },
    },
    subscribe(h) {
      const open = (path, fn) => {
        const connect = () => {
          let ws;
          try { ws = new WebSocket(wsBase + path); } catch { return; }
          ws.onmessage = (e) => { try { fn(JSON.parse(e.data)); } catch {} };
          ws.onclose = () => setTimeout(connect, 2000);
        };
        connect();
      };
      let prev = null;
      open("/ws/v1/machine/snapshot", (s) => {
        const st = s.state?.state;
        if (prev === "espresso" && st !== "espresso") s.finished = "latest";
        prev = st; h.snapshot?.(s);
      });
      open("/ws/v1/scale/snapshot", (s) => h.scale?.(s.status ? { connected: s.status === "connected" } : { connected: true, weight: s.weight, batteryLevel: s.batteryLevel }));
      open("/ws/v1/machine/waterLevels", (s) => h.water?.(s));
      open("/ws/v1/plugins/time-to-ready.reaplugin/timeToReady", (s) => h.ready?.(s));
    },
  };
  return api;
}

/* ================= app state ================= */
const S = {
  api: null,
  snap: null, scale: { connected: false, weight: null }, water: null, ready: null,
  shelf: [], current: null, next: null, loaded: false,
  prefs: {}, favourites: [null, null, null, null, null], presets: null, maint: null,
  live: [], ghost: null, lastShotId: null, opStart: 0, opKind: null,
  catalog: null, ranking: null, ghc: local.get("ghc", false), saver: local.get("saver", true),
  shots: [], selShot: null, cmpShot: null,
};

/* ================= chart ================= */
function drawChart(canvas, pts, o = {}) {
  const { maxT = 40, maxW = 50, compact = false, ghost = null, targets = true } = o;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = rect.width, H = rect.height;
  const pad = compact ? { l: 2, r: 2, t: 4, b: 4 } : { l: 30, r: 34, t: 10, b: 22 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const x = (t) => pad.l + (t / maxT) * iw;
  const yB = (v) => pad.t + ih - (clamp(v, 0, 12) / 12) * ih;
  const yW = (v) => pad.t + ih - (clamp(v, 0, maxW) / maxW) * ih;
  const yT = (v) => pad.t + ih - ((clamp(v, 70, 100) - 70) / 30) * ih;
  ctx.clearRect(0, 0, W, H);
  if (!compact) {
    ctx.strokeStyle = css("--line"); ctx.lineWidth = 1; ctx.fillStyle = css("--muted");
    ctx.font = `11px ${css("--font-mono") || "monospace"}`;
    for (let v = 0; v <= 12; v += 3) {
      ctx.globalAlpha = .6; ctx.beginPath(); ctx.moveTo(pad.l, yB(v)); ctx.lineTo(W - pad.r, yB(v)); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.textAlign = "right"; ctx.fillText(String(v), pad.l - 6, yB(v) + 4);
      ctx.textAlign = "left"; ctx.fillText(String(Math.round((v / 12) * maxW)), W - pad.r + 6, yB(v) + 4);
    }
    ctx.textAlign = "center";
    const step = maxT > 60 ? 20 : 10;
    for (let t = 0; t <= maxT; t += step) ctx.fillText(`${t}s`, x(t), H - 5);
  }
  const line = (data, key, color, y, width, { alpha = 1, dash = null } = {}) => {
    if (!data?.length || data[0][key] == null) return;
    ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = "round";
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    data.forEach((d, i) => (i ? ctx.lineTo(x(d.t), y(d[key])) : ctx.moveTo(x(d.t), y(d[key]))));
    ctx.stroke(); ctx.restore();
  };
  if (ghost?.length) {
    line(ghost, "p", css("--pressure"), yB, 1.5, { alpha: .25 });
    line(ghost, "f", css("--flow"), yB, 1.5, { alpha: .25 });
    line(ghost, "w", css("--weight"), yW, 1.5, { alpha: .25 });
  }
  if (pts.length && !compact) {
    ctx.globalAlpha = .12; ctx.fillStyle = css("--weight"); ctx.beginPath();
    ctx.moveTo(x(pts[0].t), yW(0)); pts.forEach((d) => ctx.lineTo(x(d.t), yW(d.w))); ctx.lineTo(x(pts.at(-1).t), yW(0)); ctx.fill(); ctx.globalAlpha = 1;
  }
  if (!compact && targets) {
    line(pts, "tp", css("--pressure"), yB, 1.2, { alpha: .7, dash: [4, 4] });
    line(pts, "tf", css("--flow"), yB, 1.2, { alpha: .7, dash: [4, 4] });
  }
  if (!compact) line(pts, "temp", css("--temp"), yT, 1.4, { alpha: .8 });
  line(pts, "w", css("--weight"), yW, compact ? 1.5 : 2);
  line(pts, "f", css("--flow"), yB, compact ? 1.5 : 2);
  line(pts, "p", css("--pressure"), yB, compact ? 1.5 : 2.4);
  if (pts.length && !compact) {
    const e = pts.at(-1);
    for (const [k, c, y] of [["p", "--pressure", yB], ["f", "--flow", yB], ["w", "--weight", yW]]) {
      if (e[k] == null) continue;
      ctx.fillStyle = css(c); ctx.beginPath(); ctx.arc(x(e.t), y(e[k]), 3.5, 0, Math.PI * 2); ctx.fill();
    }
  }
}
function legendHtml(withGhost) {
  const item = (c, t, dash) => `<span><span class="swatch" style="background:var(${c})${dash ? ";opacity:.6" : ""}"></span>${t}</span>`;
  return [item("--pressure", "Pressure (bar)"), item("--flow", "Flow (ml/s)"), item("--weight", "Weight (g, right)"), item("--temp", "Temp (70–100 °C)"),
    `<span class="muted">Dashed: targets</span>`, withGhost ? `<span class="muted">Faint: reference shot</span>` : ""].join("");
}

/* ================= bag art + rest ================= */
function artSrc(b) {
  const product = b.productImage || b.info?.imageUrl;
  return b.art === "photo" ? b.photo || product : product || b.photo;
}
function bagArt(b, size = "") {
  const src = artSrc(b);
  if (src) return `<div class="bag ${size}"><img src="${esc(src)}" alt="" loading="lazy"></div>`;
  return `<div class="bag ${size}" style="background:#c99a6b"><span class="initial">${esc((b.info?.name?.value || "?").trim()[0])}</span></div>`;
}
function restBar(rest) {
  if (rest.days == null) return `<div class="row between"><span class="label">Rest</span><span class="pill unknown">No roast date</span></div>`;
  const span = rest.window[1] + 10, pct = (d) => clamp((d / span) * 100, 0, 100);
  return `<div class="rest">
    <div class="row between"><span class="label">Day <span class="num">${rest.days}</span> off roast</span><span class="pill ${rest.status}">${rest.label}</span></div>
    <div class="rest-track" role="img" aria-label="Day ${rest.days}; best between day ${rest.window[0]} and ${rest.window[1]}">
      <div class="rest-window" style="left:${pct(rest.window[0])}%;width:${pct(rest.window[1]) - pct(rest.window[0])}%"></div>
      <div class="rest-marker" style="left:${pct(rest.days)}%"></div></div>
    <div class="rest-scale num"><span>roast</span><span>day ${rest.window[0]}</span><span>day ${rest.window[1]}</span><span>${span}</span></div></div>`;
}

/* ================= status + alerts ================= */
const STATE_LABEL = { idle: "Ready", sleeping: "Asleep", heating: "Warming up", preheating: "Preheating", espresso: "Espresso", steam: "Steaming", hotWater: "Hot water", flush: "Flushing", steamRinse: "Purging steam", cleaning: "Cleaning", descaling: "Descaling", needsWater: "Refill the tank", error: "Error", booting: "Starting" };
function renderStatus() {
  const s = S.snap, st = s?.state?.state || "unknown";
  const busy = ["espresso", "steam", "hotWater", "flush"].includes(st);
  const tank = S.water ? clamp(((S.water.currentLevel - S.water.refillLevel) / Math.max(1, 58 - S.water.refillLevel)) * 100, 0, 100) : null;
  const low = S.water && tank < (S.water.warningThresholdPercentage ?? 20);
  const readyTxt = st === "heating" && S.ready?.remainingTimeMs ? ` · ready in ${Math.max(1, Math.round(S.ready.remainingTimeMs / 60000))} min` : "";
  $("#status").innerHTML = `
    <span class="chip"><span class="dot ${!s ? "bad" : busy ? "live" : st === "sleeping" ? "" : st === "heating" ? "warn" : st === "needsWater" || st === "error" ? "bad" : "ok"}"></span>${esc(s ? (STATE_LABEL[st] || st) : "Machine offline")}${esc(readyTxt)}${S.api?.demo ? ' <span class="muted">· simulated</span>' : ""}</span>
    <span class="chip"><span class="muted">Group</span><span class="num">${fmt1(s?.groupTemperature ?? s?.mixTemperature)}°</span></span>
    <span class="chip"><span class="muted">Steam</span><span class="num">${s?.steamTemperature != null ? Math.round(s.steamTemperature) : "–"}°</span></span>
    ${S.water ? `<span class="chip ${low ? "bad" : ""}" title="Water tank"><span class="muted">Water</span><span class="tank ${low ? "low" : ""}"><div style="width:${tank}%"></div></span></span>` : ""}
    <button class="chip" type="button" id="scaleChip" title="Tap to tare">${S.scale.connected ? `<span class="muted">Scale</span><span class="num">${fmt1(S.scale.weight)} g</span>${S.scale.batteryLevel != null ? `<span class="muted small">${S.scale.batteryLevel}%</span>` : ""}` : '<span class="muted">No scale</span>'}</button>
    ${aiDown() ? '<a class="chip warn" href="#settings" title="Using the rules until the Crema server answers">AI offline</a>' : ""}
    ${S.maint && (S.maint.backflushDue || S.maint.descaleDue) ? `<a class="chip warn" href="#settings">${S.maint.backflushDue ? "Backflush due" : "Descale due"}</a>` : ""}`;
  $("#scaleChip").onclick = tare;
  const asleep = st === "sleeping";
  $("#railSleepLabel").textContent = $("#phoneSleepLabel").textContent = asleep ? "Wake" : "Sleep";
}
// AI is switched on but the Crema server can't be reached: the rules are standing in.
const aiDown = () => !!(S.api && !S.api.demo && S.api.ai.enabled && (S.api.info.serverError || (S.api.ai.available && !S.api.ai.healthy)));
function renderAlerts() {
  const st = S.snap?.state?.state;
  const a = [];
  if (st === "needsWater") a.push(`<div class="banner bad"><span><b>Refill the water tank.</b> The machine stops until it has water.</span>${S.api.demo ? '<button class="btn small" id="refillBtn">Refill (demo)</button>' : ""}</div>`);
  if (!S.snap && !S.api.demo) a.push(`<div class="banner bad"><span><b>Can't reach the machine.</b> Check that Decaid is running on the tablet and on the same network.</span></div>`);
  $("#alerts").innerHTML = a.join("");
  const r = $("#refillBtn"); if (r) r.onclick = () => S.api.machine.refill();
}
async function tare() {
  try { await S.api.machine.tare(); toast("Scale tared"); } catch (e) { toast(`Couldn't tare: ${e.message}`); }
}

/* ================= next shot (brew home, left) ================= */
function setNextFromRecipe(bean, recipe) {
  const r = recipe || bean?.recipe;
  S.next = bean && r ? { beanId: bean.id, profileTitle: r.profileTitle, doseG: r.doseG, yieldG: r.yieldG, tempC: r.tempC, targetTimeS: r.targetTimeS, grind: local.get(`grind:${bean.id}`, "") } : null;
  S.loaded = false;
}
function renderNextShot() {
  const el = $("#nextShot");
  const b = S.current;
  if (!b) { el.innerHTML = `<h2>No coffee yet</h2><p class="muted">Add a bag to get a profile and recipe matched to it.</p><div><a class="btn primary" href="#add">Add coffee</a></div>`; return; }
  const i = b.info, n = S.next, r = b.recipe, rest = restOf(i);
  const idx = S.shelf.findIndex((x) => x.id === b.id);
  const ratio = n ? (n.yieldG / n.doseG).toFixed(1) : "–";
  el.innerHTML = `
    <div class="coffee-line">${bagArt(b)}
      <div style="min-width:0"><div class="label">${esc(i.roaster.value)}</div><div class="coffee-name">${esc(i.name.value)}</div>
        <div class="row" style="gap:6px;margin-top:3px"><span class="pill ${rest.status}">${rest.days != null ? `Day ${rest.days} · ` : ""}${rest.label}</span>${b.frozen ? '<span class="pill plain">Frozen</span>' : ""}</div></div>
      <div class="cycler">${S.shelf.length > 1 ? `<button class="btn icon-only small" id="prevBean" aria-label="Previous coffee">‹</button><button class="btn icon-only small" id="nextBean" aria-label="Next coffee">›</button>` : ""}</div>
    </div>
    ${n ? `
    <div class="field-row first"><span class="label">Profile</span>
      <button class="profile-btn" id="profileBtn"><span style="min-width:0"><span class="t">${esc(n.profileTitle)}</span><br><span class="muted small pick-src">${esc(b.recipeSource ? `Chosen by ${b.recipeSource}` : "Tap for recommendations")}</span></span><span class="muted">›</span></button></div>
    <div class="field-row"><span class="label">Dose</span>${stepper("dose", `${fmt1(n.doseG)}<small>grams in</small>`)}</div>
    <div class="field-row"><span class="label">Yield</span>${stepper("yield", `${fmt1(n.yieldG)}<small>1:${ratio}${S.scale.connected ? " · auto-stop" : ""}</small>`)}</div>
    <div class="field-row"><span class="label">Temp</span>${stepper("temp", `${fmt1(n.tempC)}<small>°C first step</small>`)}</div>
    <div class="field-row"><span class="label">Grind</span>
      <div class="stepper"><button type="button" data-step="grind:-1" aria-label="Finer">−</button><input id="grindInput" inputmode="decimal" value="${esc(n.grind)}" placeholder="setting" aria-label="Grinder setting"><button type="button" data-step="grind:1" aria-label="Coarser">+</button></div></div>
    <div class="row">
      <button class="btn ${S.loaded ? "" : "primary"} grow" id="loadBtn">${S.loaded ? "Loaded ✓" : "Load onto machine"}</button>
      <button class="btn ghost" id="resetRecipe" title="Back to the recommended recipe">Reset</button>
    </div>
    ${r ? `<details><summary>Why this profile and how to dial it in</summary><div class="stack" style="gap:8px">
      <ul class="why">${(r.rationale || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      ${r.dialIn ? `<div class="advice small"><div class="label">Dial-in</div>${esc(r.dialIn)}</div>` : ""}
      <div class="muted small">Target ${r.targetTimeS?.[0] ?? "–"}–${r.targetTimeS?.[1] ?? "–"} s · ${esc(r.grindHint || "")}</div>
      ${r.alternatives?.length ? `<div class="muted small">Also try: ${r.alternatives.map((a) => esc(a.profileTitle)).join(", ")}</div>` : ""}</div></details>` : ""}
    ` : `<p class="muted">Working out a recipe…</p>`}`;
  const go = (d) => selectBean(S.shelf[(idx + d + S.shelf.length) % S.shelf.length].id);
  if ($("#prevBean")) { $("#prevBean").onclick = () => go(-1); $("#nextBean").onclick = () => go(1); }
  if (!n) return;
  $("#profileBtn").onclick = () => (location.hash = "#profiles");
  $$("[data-step]", el).forEach((btn) => (btn.onclick = () => step(btn.dataset.step)));
  $("#grindInput").onchange = (e) => { n.grind = e.target.value.trim(); local.set(`grind:${b.id}`, n.grind); S.loaded = false; renderNextShot(); };
  $("#loadBtn").onclick = () => loadOntoMachine();
  $("#resetRecipe").onclick = () => { setNextFromRecipe(b); renderNextShot(); };
}
function stepper(key, valHtml) {
  return `<div class="stepper"><button type="button" data-step="${key}:-1" aria-label="Less">−</button><div class="val">${valHtml}</div><button type="button" data-step="${key}:1" aria-label="More">+</button></div>`;
}
function step(spec) {
  const [key, dir] = spec.split(":"); const d = Number(dir), n = S.next;
  if (key === "dose") n.doseG = clamp(round(n.doseG + d * 0.5, 0.5), 5, 30);
  if (key === "yield") n.yieldG = clamp(round(n.yieldG + d * 1, 0.5), 10, 150);
  if (key === "temp") n.tempC = clamp(round(n.tempC + d * 0.5, 0.5), 60, 100);
  if (key === "grind") {
    const v = parseFloat(n.grind);
    n.grind = Number.isFinite(v) ? String(round(v + d * 0.5, 0.5)) : n.grind;
    local.set(`grind:${n.beanId}`, n.grind);
  }
  S.loaded = false; renderNextShot();
}
async function loadOntoMachine(silent = false) {
  const n = S.next, b = S.current;
  if (!n || !b) return false;
  const recipe = { ...(b.recipe || {}), profileTitle: n.profileTitle, profileId: null, doseG: n.doseG, yieldG: n.yieldG, tempC: n.tempC, targetTimeS: n.targetTimeS || b.recipe?.targetTimeS || [25, 35], grindHint: b.recipe?.grindHint || "", restAdvice: null, dialIn: b.recipe?.dialIn || "", rationale: b.recipe?.rationale || [], alternatives: b.recipe?.alternatives || [] };
  try {
    await S.api.apply(b.id, recipe, n.grind || undefined);
    S.loaded = true; renderNextShot();
    if (!silent) toast(`Loaded ${n.profileTitle}: ${n.doseG} g → ${n.yieldG} g at ${n.tempC} °C`);
    return true;
  } catch (e) { toast(`Couldn't load the recipe: ${e.message}`); return false; }
}
async function selectBean(id, opts = {}) {
  S.current = S.shelf.find((b) => b.id === id) || S.shelf[0] || null;
  local.set("current", S.current?.id);
  if (S.current && !S.current.recipe) {
    renderNextShot();
    try { const out = await S.api.recommend(S.current.id); S.current.recipe = out.recipe; S.current.recipeSource = out.source; } catch (e) { toast(`Couldn't get a recipe: ${e.message}`); }
  }
  setNextFromRecipe(S.current);
  S.ghost = null;
  await loadGhost();
  renderNextShot(); renderLive();
  if (!opts.quiet && S.current) toast(`Now brewing ${S.current.info.name.value}`);
}
async function loadGhost() {
  const b = S.current;
  if (!b?.bestShotId) { S.ghost = null; return; }
  if (!S.shots.length) S.shots = await S.api.shots(40).catch(() => []);
  S.ghost = S.shots.find((s) => s.id === b.bestShotId)?.points || null;
}

/* ================= favourites ================= */
function renderFavs() {
  $("#favs").innerHTML = S.favourites.map((f, i) => f
    ? `<div class="fav-wrap"><button class="fav" data-fav="${i}" title="${esc(f.name)}"><strong>${esc(f.name)}</strong><span class="muted num">${fmtC(f.doseG)}→${fmtC(f.yieldG)}</span></button><button class="fav-edit" data-favedit="${i}" aria-label="Edit favourite">⋯</button></div>`
    : `<div class="fav-wrap"><button class="fav empty" data-fav="${i}"><strong>+</strong><span>Save</span></button></div>`).join("");
  $$("[data-fav]").forEach((b) => (b.onclick = () => useFav(Number(b.dataset.fav))));
  $$("[data-favedit]").forEach((b) => (b.onclick = () => editFav(Number(b.dataset.favedit))));
}
async function useFav(i) {
  const f = S.favourites[i];
  if (!f) {
    if (!S.next) return toast("Pick a coffee first");
    const name = (S.current?.info.name.value || S.next.profileTitle).slice(0, 18);
    const fav = { name, profileTitle: S.next.profileTitle, doseG: S.next.doseG, yieldG: S.next.yieldG, tempC: S.next.tempC, beanId: S.current?.id ?? null, grinderSetting: S.next.grind || null };
    S.favourites = await S.api.favourites.set(i, fav);
    renderFavs(); toast(`Saved "${name}" to slot ${i + 1}`);
    return;
  }
  if (f.beanId && f.beanId !== S.current?.id && S.shelf.some((b) => b.id === f.beanId)) await selectBean(f.beanId, { quiet: true });
  S.next = { ...S.next, beanId: S.current?.id, profileTitle: f.profileTitle, doseG: f.doseG, yieldG: f.yieldG, tempC: f.tempC, grind: f.grinderSetting ?? S.next?.grind ?? "" };
  renderNextShot();
  await loadOntoMachine(true);
  toast(`Loaded favourite "${f.name}"`);
}
function editFav(i) {
  const f = S.favourites[i];
  openSheet(`<h2>Favourite ${i + 1}</h2>
    <div class="field"><label class="label" for="favName">Name</label><input type="text" id="favName" value="${esc(f.name)}" maxlength="40"></div>
    <p class="muted small">${esc(f.profileTitle)} · ${fmt1(f.doseG)} g → ${fmt1(f.yieldG)} g · ${fmt1(f.tempC)} °C${f.grinderSetting ? ` · grind ${esc(f.grinderSetting)}` : ""}</p>
    <div class="row"><button class="btn primary" id="favSave">Save name</button><button class="btn" id="favUpdate">Replace with current shot</button><button class="btn ghost" id="favClear">Clear slot</button></div>`);
  $("#favSave").onclick = async () => { S.favourites = await S.api.favourites.set(i, { ...f, name: $("#favName").value.trim() || f.name }); closeSheet(); renderFavs(); };
  $("#favUpdate").onclick = async () => {
    if (!S.next) return;
    S.favourites = await S.api.favourites.set(i, { ...f, profileTitle: S.next.profileTitle, doseG: S.next.doseG, yieldG: S.next.yieldG, tempC: S.next.tempC, beanId: S.current?.id ?? null, grinderSetting: S.next.grind || null });
    closeSheet(); renderFavs(); toast("Favourite updated");
  };
  $("#favClear").onclick = async () => { S.favourites = await S.api.favourites.set(i, null); closeSheet(); renderFavs(); };
}

/* ================= machine controls (brew home, right) ================= */
function renderControls() {
  const p = S.presets, st = S.snap?.state?.state;
  if (!p) return;
  const busy = ["espresso", "steam", "hotWater", "flush"].includes(st);
  const disabled = S.ghc || !S.snap || st === "sleeping" || st === "needsWater";
  const sel = p.selected;
  const steam = p.steam[sel.steam] || p.steam[0], water = p.water[sel.water] || p.water[0], flush = p.flush[sel.flush] || p.flush[0];
  const chips = (kind, list) => `<div class="presets">${list.map((x, i) => `<button class="preset" data-preset="${kind}:${i}" aria-pressed="${i === sel[kind]}">${esc(x.label)}</button>`).join("")}</div>`;
  $("#controls").innerHTML = `
    <div class="ctl"><button class="ctl-btn ${st === "espresso" ? "" : "go"}" data-run="espresso" ${disabled || busy ? "disabled" : ""}>Espresso<span class="sub">${S.next ? `${fmtC(S.next.doseG)}→${fmtC(S.next.yieldG)} g` : ""}</span></button>
      ${S.loaded || !S.next ? "" : '<span class="ghc-note">Starting loads the recipe first</span>'}</div>
    <div class="ctl"><button class="ctl-btn" data-run="steam" ${disabled || busy ? "disabled" : ""}>Steam<span class="sub">${steam.seconds ? `${steam.seconds} s` : "∞"}</span></button>${chips("steam", p.steam)}</div>
    <div class="ctl"><button class="ctl-btn" data-run="hotWater" ${disabled || busy ? "disabled" : ""}>Hot water<span class="sub">${water.ml} ml</span></button>${chips("water", p.water)}</div>
    <div class="ctl"><button class="ctl-btn" data-run="flush" ${disabled || busy ? "disabled" : ""}>Flush<span class="sub">${flush.seconds} s</span></button>${chips("flush", p.flush)}</div>
    <div class="stop-wrap stack" style="gap:6px"><button class="stop-btn ${busy ? "active" : ""}" id="stopBtn" ${S.snap ? "" : "disabled"}>STOP</button>
      ${S.ghc ? '<span class="ghc-note">Your machine starts from the group head controller. Crema sets the recipe and presets; press the group head to start.</span>' : ""}</div>`;
  $$("[data-run]").forEach((b) => (b.onclick = () => startOp(b.dataset.run)));
  $$("[data-preset]").forEach((b) => (b.onclick = async () => {
    const [kind, idx] = b.dataset.preset.split(":");
    S.presets.selected[kind] = Number(idx);
    renderControls();
    await S.api.presets.set(S.presets).catch(() => {});
    await pushPresetSettings(kind).catch((e) => toast(`Couldn't update the machine: ${e.message}`));
  }));
  $("#stopBtn").onclick = () => S.api.machine.setState("idle").catch((e) => toast(e.message));
}
async function pushPresetSettings(kind) {
  const p = S.presets, sel = p.selected;
  if (kind === "steam") await S.api.machine.shotSettings.set({ targetSteamDuration: p.steam[sel.steam].seconds || 255 });
  if (kind === "water") await S.api.machine.shotSettings.set({ targetHotWaterVolume: p.water[sel.water].ml });
  if (kind === "flush") await S.api.machine.settings.set({ flushTimeout: p.flush[sel.flush].seconds });
}
async function startOp(kind) {
  try {
    if (kind === "espresso" && !S.loaded) { const ok = await loadOntoMachine(true); if (!ok) return; }
    if (kind === "steam") await pushPresetSettings("steam");
    if (kind === "hotWater") await pushPresetSettings("water");
    if (kind === "flush") await pushPresetSettings("flush");
    await S.api.machine.setState(kind);
    S.api.machine.heartbeat();
  } catch (e) { toast(`Couldn't start: ${e.message}`); }
}

/* ================= live panel + running overlay ================= */
const PHASE = { preinfusion: "Preinfusion", pouring: "Pouring", pouringDone: "Done", preparingForShot: "Preparing" };
function renderReadouts() {
  const s = S.snap || {};
  const w = S.scale.connected ? S.scale.weight : null;
  const items = [["Pressure", s.pressure, "bar", "--pressure"], ["Flow", s.flow, "ml/s", "--flow"], ["Weight", w, "g", "--weight", true], ["Temp", s.mixTemperature, "°C", "--temp"], ["Steam", s.steamTemperature, "°C", "--muted"]];
  $("#readouts").innerHTML = items.map(([k, v, u, c, tareable]) => `<${tareable ? 'button type="button" title="Tap to tare"' : "div"} class="readout" ${tareable ? 'id="weightReadout"' : ""}><span class="k label"><span class="swatch" style="background:var(${c})"></span>${k}</span><span class="v">${v == null ? "–" : fmt1(v)}<small>${u}</small></span></${tareable ? "button" : "div"}>`).join("");
  const wr = $("#weightReadout"); if (wr) wr.onclick = tare;
}
function renderLive() {
  const target = S.next?.yieldG ?? 36;
  const pts = S.live;
  const maxT = Math.max(40, Math.ceil((pts.at(-1)?.t ?? 0) / 10) * 10, S.ghost ? Math.ceil(S.ghost.at(-1).t / 10) * 10 : 0);
  drawChart($("#liveChart"), pts, { maxT, maxW: Math.max(50, target + 10), ghost: S.ghost });
  const st = S.snap?.state?.state;
  $("#chartEmpty").hidden = pts.length > 0;
  $("#chartEmpty").textContent = !S.snap ? "Waiting for the machine…" : S.ghc ? "Press the espresso button on the group head." : S.ghost ? "Tap Espresso. The faint curves are your reference shot for this coffee." : "Tap Espresso to pull a shot.";
  $("#legend").innerHTML = legendHtml(!!S.ghost);
  $("#phase").textContent = st === "espresso" ? (PHASE[S.snap.state.substate] || "Espresso") : STATE_LABEL[st] || "Ready";
  $("#phaseSub").textContent = st === "espresso" && S.next ? `${S.next.profileTitle} · target ${fmt1(target)} g` : "";
}
function onSnapshot(s) {
  const prevState = S.snap?.state?.state;
  S.snap = s;
  const st = s.state?.state;
  if (st !== prevState) { renderControls(); renderAlerts(); updateSaver(); if (st === "espresso") onShotStart(); opOverlay(); }
  if (st === "espresso") {
    // Decaid's snapshot has no timer; the simulators send one. Ignore a stale
    // value carried over from the previous operation on the first frame.
    const local = (Date.now() - S.opStart) / 1000;
    const t = s.elapsed != null && !(S.live.length === 0 && s.elapsed > 2) ? s.elapsed : local;
    S.live.push({ t, p: s.pressure ?? 0, f: s.flow ?? 0, w: S.scale.weight ?? 0, temp: s.mixTemperature, tp: s.targetPressure, tf: s.targetFlow });
    $("#shotClock").textContent = t.toFixed(1);
    if (!$("#view-brew").hidden) renderLive();
  } else if (["steam", "hotWater", "flush"].includes(st)) {
    opOverlay();
  }
  if (s.finished) onShotEnd(s.finished);
  renderStatus(); renderReadouts();
  if (st === "espresso" || st !== prevState) { if (!$("#view-brew").hidden) renderLive(); }
}
function onShotStart() {
  S.live = []; S.opStart = Date.now();
  $("#afterShot").hidden = true;
  $(".live-col").classList.remove("has-after");
  if (location.hash !== "#brew") location.hash = "#brew";
}
async function onShotEnd(finishedId) {
  const pts = S.live.slice();
  S.shots = await S.api.shots(40).catch(() => S.shots);
  const shot = finishedId === "latest" ? S.shots[0] : S.shots.find((x) => x.id === finishedId) || S.shots[0];
  S.lastShotId = shot?.id;
  showAfterShot(shot, pts);
  if (S.current) S.current.remaining = S.current.remaining != null ? Math.max(0, S.current.remaining - (S.next?.doseG ?? 18)) : null;
}
function shotMetrics(points, s) {
  const first = points.find((p) => p.w > 0.5);
  const peak = points.reduce((m, p) => Math.max(m, p.p), 0);
  const pour = points.filter((p) => first && p.t >= first.t);
  const avgFlow = pour.length ? pour.reduce((a, p) => a + p.f, 0) / pour.length : null;
  const yieldG = s?.yieldG ?? points.at(-1)?.w;
  const doseG = s?.doseG ?? S.next?.doseG;
  return [["Time", points.at(-1) ? `${points.at(-1).t.toFixed(1)}` : s?.timeS, "s"], ["First drops", first ? first.t.toFixed(1) : "–", "s"], ["Yield", fmt1(yieldG), "g"], ["Ratio", doseG && yieldG ? `1:${(yieldG / doseG).toFixed(2)}` : "–", ""], ["Peak", fmt1(peak), "bar"], ["Avg flow", fmt1(avgFlow), "ml/s"]];
}
function metricsHtml(m) {
  return `<div class="metrics">${m.map(([k, v, u]) => `<div><span class="label">${k}</span><span class="v">${esc(v)}<small class="muted"> ${u}</small></span></div>`).join("")}</div>`;
}
function showAfterShot(shot, pts) {
  const p = $("#afterShot");
  p.hidden = false;
  let stars = 0;
  const r = S.current?.recipe;
  const timeS = pts.at(-1)?.t ?? shot?.timeS ?? null;
  const [lo, hi] = r?.targetTimeS || [25, 35];
  const timing = timeS == null ? "" : timeS < lo ? `<span class="pill warn">Fast for this profile (${lo}–${hi} s)</span>` : timeS > hi ? `<span class="pill warn">Slow for this profile (${lo}–${hi} s)</span>` : `<span class="pill good">In the target window</span>`;
  const scale = (id, label, opts) => `<div class="scale-row"><span class="label">${label}</span><div class="seg tap" id="${id}" role="radiogroup" aria-label="${label}">${opts.map(([v, t]) => `<button type="button" role="radio" data-v="${v}" aria-checked="${v === 0}" aria-pressed="${v === 0}">${t}</button>`).join("")}</div></div>`;
  p.innerHTML = `
    <div class="row between"><h2>How was it?</h2>${timing}</div>
    ${metricsHtml(shotMetrics(pts.length ? pts : shot?.points || [], shot))}
    ${scale("sb", "Taste", [[-2, "Sour"], [-1, "A bit sour"], [0, "Balanced"], [1, "A bit bitter"], [2, "Bitter"]])}
    ${scale("bd", "Body", [[-2, "Thin"], [-1, "Light"], [0, "Just right"], [1, "Rich"], [2, "Heavy"]])}
    <div class="row between"><div class="row"><span class="label">Enjoyment</span><div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button class="star" type="button" aria-pressed="false" data-n="${n}" aria-label="${n} of 5">★</button>`).join("")}</div></div>
      <div class="row"><button class="btn primary" id="sendTaste">Next adjustment</button><button class="btn" id="pinShot" title="Show this shot faintly on the live chart for this coffee">Set as reference</button><button class="btn ghost icon-only" id="closeAfter" aria-label="Close">✕</button></div></div>
    <div id="adviceBox"></div>`;
  const val = (id) => Number($(`#${id} [aria-pressed="true"]`)?.dataset.v ?? 0);
  $$(".seg.tap", p).forEach((g) => $$("button", g).forEach((b) => (b.onclick = () => $$("button", g).forEach((x) => { x.setAttribute("aria-pressed", String(x === b)); x.setAttribute("aria-checked", String(x === b)); }))));
  $("#closeAfter").onclick = () => { p.hidden = true; $(".live-col").classList.remove("has-after"); renderLive(); };
  $(".live-col").classList.add("has-after");
  requestAnimationFrame(renderLive);
  $$(".star", p).forEach((b) => (b.onclick = () => { stars = +b.dataset.n; $$(".star", p).forEach((x) => x.setAttribute("aria-pressed", String(+x.dataset.n <= stars))); }));
  $("#sendTaste").onclick = async (e) => {
    if (!shot || !S.current) return;
    e.target.disabled = true;
    try {
      const { advice, source } = await S.api.feedback(shot.id, S.current.id, { sourBitter: val("sb"), body: val("bd"), enjoyment: stars || 3, notes: null });
      $("#adviceBox").innerHTML = `<div class="advice"><div class="label">Next shot</div><strong>${esc(advice.change)}</strong><div class="muted">${esc(advice.reasoning)}</div><div class="muted small">${source === "ai" ? "Advice from the AI" : "From Crema's dial-in rules"}</div></div>`;
    } catch (err) { $("#adviceBox").innerHTML = `<p class="error">${esc(err.message)}</p>`; }
    e.target.disabled = false;
  };
  $("#pinShot").onclick = async () => {
    if (!shot || !S.current) return;
    await S.api.pinBest(S.current.id, shot.id);
    S.current.bestShotId = shot.id; S.ghost = pts.length ? pts : shot.points;
    toast("Pinned as the reference shot for this coffee"); renderLive();
  };
}
function opOverlay() {
  const st = S.snap?.state?.state, o = $("#opOverlay");
  const kind = ["steam", "hotWater", "flush"].includes(st) ? st : null;
  if (!kind) { o.hidden = true; S.opKind = null; return; }
  if (S.opKind !== kind) { S.opKind = kind; S.opStart = Date.now(); }
  const p = S.presets, sel = p?.selected || {};
  const t = (Date.now() - S.opStart) / 1000; // steam/water/flush run in real time
  const total = kind === "steam" ? p?.steam[sel.steam]?.seconds || 0 : kind === "hotWater" ? (p?.water[sel.water]?.ml || 120) / 6 : p?.flush[sel.flush]?.seconds || 5;
  const title = { steam: "Steaming", hotWater: "Hot water", flush: "Flushing" }[kind];
  const detail = kind === "steam" ? `Steam ${Math.round(S.snap.steamTemperature ?? 0)} °C · ${fmt1(S.snap.flow)} ml/s` : kind === "hotWater" ? `${p?.water[sel.water]?.ml ?? "–"} ml · ${S.scale.connected ? `${fmt1(S.scale.weight)} g in the cup` : `${fmt1(S.snap.flow)} ml/s`}` : `Group ${fmt1(S.snap.groupTemperature)} °C`;
  o.hidden = false;
  $("#opCard").innerHTML = `<span class="label">${title}</span><div class="op-time">${t.toFixed(0)}<small style="font-size:1.4rem" class="muted"> s</small></div>
    ${total ? `<div class="op-bar"><div style="width:${clamp((t / total) * 100, 0, 100)}%"></div></div><div class="muted">${Math.max(0, total - t).toFixed(0)} s left</div>` : '<div class="muted">Runs until you stop it</div>'}
    <div>${esc(detail)}</div><button class="stop-btn active" id="opStop">STOP</button>`;
  $("#opStop").onclick = () => S.api.machine.setState("idle").catch(() => {});
}

/* ================= screen saver ================= */
function updateSaver() {
  const asleep = S.snap?.state?.state === "sleeping";
  clearTimeout(updateSaver._t);
  if (asleep && S.saver) updateSaver._t = setTimeout(() => { $("#saver").hidden = false; tickSaver(); }, 4000);
  else $("#saver").hidden = true;
}
function tickSaver() {
  if ($("#saver").hidden) return;
  $("#saverTime").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  setTimeout(tickSaver, 10000);
}
async function sleepWake() {
  const asleep = S.snap?.state?.state === "sleeping";
  try { await S.api.machine.setState(asleep ? "idle" : "sleeping"); toast(asleep ? "Waking up" : "Going to sleep"); } catch (e) { toast(e.message); }
}

/* ================= sheet ================= */
function openSheet(html) { $("#sheet").innerHTML = html + `<div class="row"><button class="btn ghost small" id="sheetClose">Close</button></div>`; $("#sheetBack").hidden = false; $("#sheetClose").onclick = closeSheet; }
function closeSheet() { $("#sheetBack").hidden = true; }

/* ================= shelf ================= */
async function renderShelf() {
  const el = $("#shelf");
  if (!S.shelf.length) { el.innerHTML = `<div class="panel stack"><h2>Your shelf is empty</h2><p class="muted">Photograph a bag, search for a coffee or paste a roaster's link.</p><div><a class="btn primary" href="#add">Add coffee</a></div></div>`; return; }
  el.innerHTML = S.shelf.map((b) => {
    const i = b.info, rest = restOf(i);
    const left = b.remaining != null && b.weight ? clamp((b.remaining / b.weight) * 100, 0, 100) : null;
    const shotsLeft = b.remaining != null ? Math.floor(b.remaining / (b.recipe?.doseG ?? 18)) : null;
    return `<article class="panel bean-card ${S.current?.id === b.id ? "current" : ""}">
      <div class="coffee-head">${bagArt(b, "lg")}<div style="min-width:0" class="stack" style="gap:2px"><div><div class="label">${esc(i.roaster.value)}</div><h2>${esc(i.name.value)}</h2>
        <div class="muted small">${esc([i.country?.value, i.process?.value].filter(Boolean).join(" · "))}</div></div>
        ${i.tastingNotes?.value?.length ? `<div class="tags">${i.tastingNotes.value.slice(0, 3).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}</div></div>
      ${restBar(rest)}
      ${left != null ? `<div class="stack" style="gap:6px"><div class="row between"><span class="label">Left</span><span class="num muted small">${b.remaining} / ${b.weight} g · about ${shotsLeft} shots</span></div><div class="grams"><div style="width:${left}%"></div></div>
        ${shotsLeft != null && shotsLeft <= 4 ? '<span class="pill warn" style="justify-self:start">Running low. Time to reorder</span>' : ""}</div>` : ""}
      <div class="muted small">${esc(b.recipe ? `${b.recipe.profileTitle} · ${fmt1(b.recipe.doseG)}→${fmt1(b.recipe.yieldG)} g · ${fmt1(b.recipe.tempC)} °C` : "No recipe yet")}</div>
      <div class="row">
        <button class="btn small ${S.current?.id === b.id ? "" : "primary"}" data-brew="${esc(b.id)}">${S.current?.id === b.id ? "Brewing" : "Brew this"}</button>
        <button class="btn small ghost" data-freeze="${esc(b.id)}">${b.frozen ? "Thaw" : "Freeze"}</button>
        <button class="btn small ghost" data-finish="${esc(b.id)}">Finished</button>
        ${i.productUrl ? `<a class="btn small ghost" href="${esc(i.productUrl)}" target="_blank" rel="noopener">Roaster's page</a>` : ""}
      </div></article>`;
  }).join("");
  $$("[data-brew]").forEach((btn) => (btn.onclick = async () => { await selectBean(btn.dataset.brew); location.hash = "#brew"; }));
  $$("[data-freeze]").forEach((btn) => (btn.onclick = async () => {
    const b = S.shelf.find((x) => x.id === btn.dataset.freeze);
    await S.api.setBeanState(b.id, { frozen: !b.frozen }); b.frozen = !b.frozen; renderShelf(); toast(b.frozen ? "Marked as frozen" : "Thawed");
  }));
  $$("[data-finish]").forEach((btn) => (btn.onclick = () => {
    const b = S.shelf.find((x) => x.id === btn.dataset.finish);
    openSheet(`<h2>Finished ${esc(b.info.name.value)}?</h2><p class="muted">It moves off your shelf. Its shots stay in your history.</p><div class="row"><button class="btn primary" id="confirmFinish">Mark finished</button></div>`);
    $("#confirmFinish").onclick = async () => {
      await S.api.setBeanState(b.id, { finished: true });
      closeSheet(); await refreshShelf();
      if (S.current?.id === b.id) await selectBean(S.shelf[0]?.id, { quiet: true });
      renderShelf(); toast("Moved off the shelf");
    };
  }));
}
async function refreshShelf() { S.shelf = await S.api.shelf(); }

/* ================= add coffee ================= */
let addMode = "photo", files = [], pending = null, REVIEW_INTRO = "";
const MANUAL_INTRO = `<h2>Entering a coffee by hand</h2>
  <ul class="steps">
    <li class="done"><span class="tick">1</span><span><b>Copy the bag.</b> Roaster, name, process and roast date are enough. The more you add, the better the match.</span></li>
    <li class="done"><span class="tick">2</span><span><b>Match a profile.</b> Crema ranks the profiles on your machine against the coffee and picks a dose, ratio and temperature.</span></li>
  </ul>`;
const introFor = (m) => (m === "manual" ? MANUAL_INTRO : REVIEW_INTRO);
function setMode(m) {
  addMode = m;
  $$("[data-mode]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === m)));
  $$("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== m));
  $("#offlineRow").hidden = m === "manual";
  $("#identifyBtn").textContent = m === "manual" ? "Review" : "Identify coffee";
  if (!pending) $("#reviewPanel").innerHTML = introFor(m);
}
// Without AI (switched off, or no Crema server) the only way in is typing the details.
function renderAddModes() {
  const ai = S.api.ai.on;
  $$("[data-mode]").forEach((b) => (b.hidden = !ai && b.dataset.mode !== "manual"));
  $("#addModes").hidden = !ai;
  $("#addNoAi").hidden = ai;
  $("#addNoAi").textContent = S.api.ai.enabled
    ? "Identifying from photos, searches and links needs a Crema server. Enter the details from the bag instead."
    : "AI features are off, so enter the details from the bag. Switch AI on in Settings to identify coffees from photos.";
  if (!ai && addMode !== "manual") setMode("manual");
}
function manualInfo() {
  const v = (id) => $(`#${id}`).value.trim() || null;
  const f = (x) => ({ value: x, source: x == null ? null : "bag" });
  const notes = v("mNotes")?.split(/,\s*/).filter(Boolean) ?? null;
  const process = v("mProcess");
  const weight = parseFloat(v("mWeight"));
  return {
    roaster: f(v("mRoaster")), name: f(v("mName")), country: f(v("mCountry")), region: f(null), producer: f(null), variety: f(v("mVariety")),
    process: f(process), processKind: process ? processKindOf(process) : null, altitudeMasl: f(null),
    roastLevel: f(v("mRoast")), roastedFor: f(null), roastDate: f(v("mRoastDate")), bestBefore: f(null),
    weightGrams: Number.isFinite(weight) ? weight : null, tastingNotes: f(notes && notes.length ? notes : null), isBlend: null, blendComponents: null,
    roasterRecipe: null, productUrl: null, imageUrl: null, sources: [], confidence: 1, needsConfirmation: [], summary: "Entered by hand.",
  };
}
async function thumbnail(file, max = 360) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.8);
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}
function factRows(info) {
  const rows = [["Roaster", "roaster"], ["Coffee", "name"], ["Country", "country"], ["Region", "region"], ["Producer", "producer"], ["Variety", "variety"], ["Process", "process"], ["Altitude", "altitudeMasl", (v) => `${v.join("–")} masl`], ["Roast", "roastLevel"], ["Roast date", "roastDate"], ["Tasting notes", "tastingNotes"]];
  return rows.map(([label, key, f]) => {
    const fld = info[key] || {};
    const v = fld.value == null ? null : f ? f(fld.value) : Array.isArray(fld.value) ? fld.value.join(", ") : fld.value;
    const flag = info.needsConfirmation?.includes(key) ? "flag" : "";
    const prov = fld.source ? `<span class="prov src-${fld.source}">${fld.source}</span>` : "";
    if (key === "roastDate") return `<div class="k ${flag}">${label}</div><div class="${flag}"><input type="date" id="roastDateInput" value="${esc(fld.value || "")}" style="background:transparent;border:0;padding:0" aria-label="Roast date"> ${flag ? '<span class="muted small">From the bag</span>' : ""}</div><div class="${flag}">${prov}</div>`;
    return `<div class="k ${flag}">${label}</div><div class="${flag}">${v == null ? '<span class="muted">Not given</span>' : esc(v)}</div><div class="${flag}">${prov}</div>`;
  }).join("");
}
function artPicker(info, photo) {
  const product = info.imageUrl;
  if (!product && !photo) return "";
  if (!product) return `<div class="muted small">No product photo on the roaster's page. Your photo will be used.</div>`;
  const opt = (val, src, text, checked) => `<label><input type="radio" name="art" value="${val}" ${checked ? "checked" : ""}><img src="${esc(src)}" alt="">${text}</label>`;
  return `<div class="stack" style="gap:8px"><span class="label">Picture on your shelf</span><div class="art-pick">${opt("product", product, "Roaster's photo", true)}${photo ? opt("photo", photo, "Your photo", false) : ""}</div></div>`;
}
function renderReview(info, photo) {
  pending = { info, photo };
  $("#reviewPanel").innerHTML = `
    <div class="coffee-line" style="grid-template-columns:76px minmax(0,1fr)">${bagArt({ photo, info, art: "product" }, "xl")}<div style="min-width:0"><div class="label">${esc(info.roaster.value)}</div><h2>${esc(info.name.value)}</h2><div class="muted small">${esc(info.summary)}</div></div></div>
    <div class="row" ${info.summary === "Entered by hand." ? "hidden" : ""}><span class="label">Match confidence</span><span class="num">${Math.round((info.confidence ?? 0) * 100)}%</span><span class="prov src-bag">bag</span><span class="prov src-web">web</span><span class="prov src-inferred">inferred</span></div>
    ${artPicker(info, photo)}
    <div class="facts">${factRows(info)}</div>
    ${info.roasterRecipe?.text ? `<div class="advice"><div class="label">Roaster's recipe</div>${esc(info.roasterRecipe.text)}</div>` : ""}
    ${info.sources?.length ? `<div class="muted small" style="overflow-wrap:anywhere">Sources: ${info.sources.map((s) => /^https?:/.test(s) ? `<a href="${esc(s)}" target="_blank" rel="noopener">${esc(s.replace(/^https?:\/\//, ""))}</a>` : esc(s)).join(", ")}</div>` : ""}
    <div class="row"><button class="btn primary" id="saveBean">Save to shelf and match a profile</button><button class="btn ghost" id="discardBean">Discard</button></div>`;
  $("#saveBean").onclick = async (e) => {
    e.target.disabled = true;
    const d = $("#roastDateInput").value;
    if (d) { pending.info.roastDate = { value: d, source: "bag" }; pending.info.needsConfirmation = (pending.info.needsConfirmation || []).filter((k) => k !== "roastDate"); }
    try {
      const art = document.querySelector('input[name="art"]:checked')?.value ?? (pending.info.imageUrl ? "product" : "photo");
      const saved = await S.api.saveBean(pending.info, pending.photo, art);
      files = []; $("#thumbs").innerHTML = ""; pending = null; $("#reviewPanel").innerHTML = introFor(addMode);
      $("#addForm").reset();
      await refreshShelf();
      const b = S.shelf.find((x) => x.id === saved.id); if (b) b.recipe = null;
      location.hash = "#profiles";
      await selectBean(saved.id);
    } catch (err) { toast(`Couldn't save: ${err.message}`); e.target.disabled = false; }
  };
  $("#discardBean").onclick = () => { pending = null; $("#reviewPanel").innerHTML = introFor(addMode); };
}
async function onIdentify(e) {
  e.preventDefault();
  const query = $("#queryInput").value.trim(), url = $("#urlInput").value.trim(), offline = $("#offlineInput").checked;
  const input = addMode === "photo" ? { files } : addMode === "search" ? { query } : { url };
  if (addMode === "manual") {
    const info = manualInfo();
    if (!info.roaster.value || !info.name.value) return toast("Enter at least the roaster and the coffee's name");
    return renderReview(info, null);
  }
  if (addMode === "photo" && !files.length) return toast("Add a photo of the bag first");
  if (addMode === "search" && !query) return toast("Type a roaster and coffee name");
  if (addMode === "link" && !url) return toast("Paste a product link");
  const btn = $("#identifyBtn"); btn.disabled = true;
  const panel = $("#reviewPanel");
  const draw = (i, steps) => { panel.innerHTML = `<h2>Identifying…</h2><ul class="steps">${steps.map((s, n) => `<li class="${n < i ? "done" : n === i ? "active" : ""}"><span class="tick">${n < i ? "✓" : ""}</span>${esc(s)}</li>`).join("")}</ul>`; };
  try {
    const info = await S.api.identify({ ...input, offline }, draw);
    renderReview(info, files[0] ? await thumbnail(files[0]) : null);
  } catch (err) {
    panel.innerHTML = `<h2>Couldn't identify it</h2><p class="error">${esc(err.message)}</p><p class="muted">Try a photo with the label in focus, or search by roaster and name.</p>`;
  }
  btn.disabled = false;
}

/* ================= profiles ================= */
const ROASTS = ["light", "medium-light", "medium", "medium-dark", "dark"];
let catFilter = { roast: null, milk: false, easy: false, scale: null };
async function renderProfiles() {
  const b = S.current;
  $("#profilesTitle").textContent = b ? `Profiles for ${b.info.name.value}` : "Profiles";
  $("#profilesSub").textContent = b ? `Matched against what ${b.info.roaster.value} says about it: ${[b.info.roastLevel?.value, b.info.processKind, (b.info.tastingNotes?.value || []).slice(0, 3).join(", ")].filter(Boolean).join(" · ")}` : "Add a coffee to see recommendations.";
  const rec = $("#recommended");
  if (b) {
    rec.innerHTML = `<p class="muted">Ranking profiles…</p>`;
    try {
      const cands = await S.api.rank(b.id);
      const top = cands[0]?.score || 1;
      const chosen = b.recipe?.profileTitle;
      rec.innerHTML = `${b.recipe ? `<div class="panel stack"><div class="row between"><span class="label">Recommended</span><span class="muted small">${esc(b.recipeSource ? `Chosen by ${b.recipeSource}` : "")}</span></div>
          <div class="row between"><h2>${esc(chosen)}</h2><span class="num">${fmt1(b.recipe.doseG)} g → ${fmt1(b.recipe.yieldG)} g · ${fmt1(b.recipe.tempC)} °C · ${b.recipe.targetTimeS?.join("–")} s</span></div>
          <ul class="why">${(b.recipe.rationale || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
          ${b.recipe.dialIn ? `<div class="advice small"><div class="label">Dial-in</div>${esc(b.recipe.dialIn)}</div>` : ""}
          <div class="row"><button class="btn primary" data-use="${esc(chosen)}" data-rec="1">Use this</button><button class="btn" id="askAgain">Ask the AI again</button></div></div>` : ""}
        <div class="row between"><span class="label">Ranked by the rules</span><span class="muted small">The AI chooses among the top candidates</span></div>
        <div class="cands">${cands.slice(0, 6).map((c, i) => `<div class="cand ${c.title === chosen ? "top" : ""}">
          <div class="row between"><h3>${esc(c.title)}</h3>${c.title === chosen ? '<span class="pill accent">AI pick</span>' : `<span class="muted small num">#${i + 1}</span>`}</div>
          <div class="scorebar" aria-label="Match score ${c.score}"><div style="width:${clamp((c.score / top) * 100, 5, 100)}%"></div></div>
          <ul>${c.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}${c.cautions.map((r) => `<li class="caution">${esc(r)}</li>`).join("")}</ul>
          <div class="row between"><span class="num small">${fmt1(c.recipe.doseG)}→${fmt1(c.recipe.yieldG)} g · ${fmt1(c.recipe.tempC)} °C</span><button class="btn small" data-use="${esc(c.title)}">Use</button></div></div>`).join("")}</div>`;
      $$("[data-use]", rec).forEach((btn) => (btn.onclick = () => {
        const c = cands.find((x) => x.title === btn.dataset.use);
        const r = btn.dataset.rec ? b.recipe : { ...b.recipe, profileTitle: c.title, doseG: c.recipe.doseG, yieldG: c.recipe.yieldG, tempC: c.recipe.tempC, targetTimeS: c.recipe.timeS };
        setNextFromRecipe(b, r);
        location.hash = "#brew";
        toast(`${r.profileTitle} set for the next shot. Tap Load or Espresso.`);
      }));
      const again = $("#askAgain");
      if (again) again.onclick = async () => {
        again.disabled = true; again.textContent = "Asking…";
        try { const out = await S.api.recommend(b.id); b.recipe = out.recipe; b.recipeSource = out.source; setNextFromRecipe(b); renderProfiles(); } catch (e) { toast(e.message); again.disabled = false; }
      };
    } catch (e) { rec.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  } else rec.innerHTML = "";
  if (!S.catalog) S.catalog = await S.api.catalog().catch(() => []);
  renderCatalog();
}
function renderCatalog() {
  const f = catFilter;
  $("#catFilters").innerHTML = [
    ...ROASTS.map((r) => `<button class="fchip" data-f="roast:${r}" aria-pressed="${f.roast === r}">${r}</button>`),
    `<button class="fchip" data-f="milk" aria-pressed="${f.milk}">Good with milk</button>`,
    `<button class="fchip" data-f="easy" aria-pressed="${f.easy}">Easy to dial</button>`,
    `<button class="fchip" data-f="scale" aria-pressed="${f.scale === false}">No scale needed</button>`,
  ].join("");
  $$("[data-f]").forEach((b) => (b.onclick = () => {
    const [k, v] = b.dataset.f.split(":");
    if (k === "roast") f.roast = f.roast === v ? null : v; else if (k === "scale") f.scale = f.scale === false ? null : false; else f[k] = !f[k];
    renderCatalog();
  }));
  const list = (S.catalog || []).filter((p) => (!f.roast || p.roasts.includes(f.roast)) && (!f.milk || p.milk === "great") && (!f.easy || p.difficulty === "easy") && (f.scale !== false || !p.needsScale))
    .sort((a, b) => b.popularity - a.popularity);
  $("#catCount").textContent = `${list.length} of ${(S.catalog || []).length}`;
  $("#catalog").innerHTML = list.map((p) => `<button class="cat-card" data-p="${esc(p.title)}">
      <div class="row between"><h3>${esc(p.title)}</h3>${p.installed === false ? '<span class="pill plain">Not installed</span>' : ""}</div>
      <div class="roastbar" aria-label="Roasts: ${p.roasts.join(", ")}">${ROASTS.map((r) => `<span class="${p.roasts.includes(r) ? "on" : ""}"></span>`).join("")}</div>
      <div class="muted small">${esc(p.author)} · ${esc(p.style)} · ${p.difficulty}${p.milk === "great" ? " · milk" : ""}</div>
      <div class="small">${esc(p.character)}</div></button>`).join("");
  $$("[data-p]").forEach((b) => (b.onclick = () => showProfile(b.dataset.p)));
}
function showProfile(title) {
  const p = S.catalog.find((x) => x.title === title);
  openSheet(`<div class="stack" style="gap:4px"><span class="label">${esc(p.author)} · ${esc(p.style)}</span><h2>${esc(p.title)}</h2></div>
    <p>${esc(p.character)}</p>
    <div class="metrics">${[["Dose", fmt1(p.recipe.doseG), "g"], ["Yield", fmt1(p.recipe.yieldG), "g"], ["Temp", fmt1(p.recipe.tempC), "°C"], ["Time", p.recipe.timeS.join("–"), "s"]].map(([k, v, u]) => `<div><span class="label">${k}</span><span class="v">${v}<small class="muted"> ${u}</small></span></div>`).join("")}</div>
    <div class="small"><b>Written for:</b> ${p.roasts.join(", ")} roasts · <b>Milk:</b> ${p.milk} · <b>Difficulty:</b> ${p.difficulty}${p.needsScale ? " · works best with a scale" : ""}${p.wantsFlatBurrs ? " · high-extraction flat burrs" : ""}</div>
    <div class="advice small"><div class="label">Author's dial-in guidance</div>${esc(p.dialIn)}</div>
    <div class="muted small">Source: ${esc(p.source)}</div>
    ${S.current ? `<div class="row"><button class="btn primary" id="useProfile">Use for ${esc(S.current.info.name.value)}</button></div>` : ""}`);
  const u = $("#useProfile");
  if (u) u.onclick = async () => {
    const cands = await S.api.rank(S.current.id).catch(() => []);
    const c = cands.find((x) => x.title === p.title);
    const r = { ...S.current.recipe, profileTitle: p.title, doseG: c?.recipe.doseG ?? p.recipe.doseG, yieldG: c?.recipe.yieldG ?? p.recipe.yieldG, tempC: c?.recipe.tempC ?? p.recipe.tempC, targetTimeS: p.recipe.timeS, dialIn: p.dialIn };
    setNextFromRecipe(S.current, r); closeSheet(); location.hash = "#brew"; toast(`${p.title} set for the next shot`);
  };
}

/* ================= shots ================= */
async function renderShots() {
  const list = $("#shotList");
  list.innerHTML = `<p class="muted">Loading…</p>`;
  S.shots = await S.api.shots(40).catch(() => []);
  if (!S.shots.length) { list.innerHTML = `<p class="muted">No shots yet.</p>`; $("#shotDetail").innerHTML = ""; return; }
  if (!S.shots.some((s) => s.id === S.selShot)) S.selShot = S.shots[0].id;
  list.innerHTML = S.shots.map((s, i) => `<div class="shot-row ${s.id === S.selShot ? "sel" : ""} ${s.id === S.cmpShot ? "cmp" : ""}">
      <input type="checkbox" data-cmp="${esc(s.id)}" ${s.id === S.cmpShot ? "checked" : ""} aria-label="Compare with this shot" ${s.id === S.selShot ? "disabled" : ""}>
      <canvas data-spark="${i}" aria-hidden="true"></canvas>
      <button class="open" data-open="${esc(s.id)}"><strong>${esc(s.coffee || "Unknown coffee")}</strong>
        <span class="shot-meta"><span>${new Date(s.timestamp).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}</span><span class="num">${fmt1(s.doseG)}→${fmt1(s.yieldG)} g</span><span class="num">${s.timeS ?? "–"} s</span><span>${s.enjoyment ? "★".repeat(s.enjoyment) : "Not rated"}</span>${S.shelf.some((b) => b.bestShotId === s.id) ? '<span class="pill accent">Reference</span>' : ""}</span></button></div>`).join("");
  requestAnimationFrame(() => S.shots.forEach((s, i) => drawChart(list.querySelector(`[data-spark="${i}"]`), s.points, { compact: true, maxT: 50, maxW: 60 })));
  $$("[data-open]").forEach((b) => (b.onclick = () => { S.selShot = b.dataset.open; if (S.cmpShot === S.selShot) S.cmpShot = null; renderShots(); }));
  $$("[data-cmp]").forEach((b) => (b.onchange = () => { S.cmpShot = b.checked ? b.dataset.cmp : null; renderShots(); }));
  renderShotDetail();
}
function renderShotDetail() {
  const s = S.shots.find((x) => x.id === S.selShot), c = S.shots.find((x) => x.id === S.cmpShot);
  const bean = S.shelf.find((b) => b.id === s.beanId || (s.batch && b.batch === s.batch));
  $("#shotDetail").innerHTML = `
    <div class="row between"><div><span class="label">${esc(new Date(s.timestamp).toLocaleString())}</span><h2>${esc(s.coffee || "Shot")}</h2></div><span class="muted small">${esc(s.profileTitle || "")}</span></div>
    ${metricsHtml(shotMetrics(s.points, s))}
    <div class="chart-box"><canvas id="detailChart"></canvas></div>
    <div class="legend">${legendHtml(false)}${c ? `<span><span class="swatch" style="background:var(--muted)"></span>Faint: ${esc(c.coffee || "")} ${new Date(c.timestamp).toLocaleDateString()}</span>` : ""}</div>
    <div class="row"><span class="label">Rating</span><div class="stars" id="detailStars">${[1, 2, 3, 4, 5].map((n) => `<button class="star" type="button" aria-pressed="${(s.enjoyment || 0) >= n}" data-n="${n}" aria-label="${n} of 5">★</button>`).join("")}</div></div>
    <div class="field"><label class="label" for="shotNotes">Notes</label><input type="text" id="shotNotes" value="${esc(s.notes || "")}" placeholder="How did it taste?"></div>
    <div class="row">${bean ? `<button class="btn" id="pinDetail">${bean.bestShotId === s.id ? "Reference shot ✓" : "Make this the reference shot"}</button>` : ""}<span class="muted small">Uploads to Visualizer through Decaid's Visualizer plugin (Settings).</span></div>`;
  requestAnimationFrame(() => drawChart($("#detailChart"), s.points, { maxT: Math.max(40, Math.ceil(Math.max(s.timeS || 0, c?.timeS || 0) / 10) * 10), maxW: Math.max(50, (s.yieldG || 36) + 10), ghost: c?.points }));
  $$("#detailStars .star").forEach((b) => (b.onclick = async () => { s.enjoyment = +b.dataset.n; await S.api.annotate(s.id, { enjoyment: s.enjoyment }).catch(() => {}); renderShotDetail(); }));
  $("#shotNotes").onchange = async (e) => { s.notes = e.target.value; await S.api.annotate(s.id, { espressoNotes: s.notes }).catch(() => {}); toast("Notes saved"); };
  const pin = $("#pinDetail");
  if (pin) pin.onclick = async () => { await S.api.pinBest(bean.id, s.id); bean.bestShotId = s.id; if (S.current?.id === bean.id) await loadGhost(); renderShots(); toast("Reference shot set"); };
}

/* ================= settings ================= */
function sw(id, checked) { return `<label class="switch"><input type="checkbox" id="${id}" ${checked ? "checked" : ""}><span></span></label>`; }
function mini(id, value, stepV, unit) { return `<div class="mini"><button type="button" data-mini="${id}:-${stepV}" aria-label="Less">−</button><input id="${id}" inputmode="decimal" value="${value ?? ""}" aria-label="${unit}"><button type="button" data-mini="${id}:${stepV}" aria-label="More">+</button></div>`; }
function seg(id, options, value) { return `<div class="seg" id="${id}">${options.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${String(v) === String(value)}">${l}</button>`).join("")}</div>`; }
async function renderSettings() {
  const el = $("#settings");
  el.innerHTML = `<p class="muted">Loading…</p>`;
  const m = S.api.machine;
  const [ss, ms, pres, scheds, disp, plugins, maint] = await Promise.all([m.shotSettings.get().catch(() => null), m.settings.get().catch(() => null), m.presence.get().catch(() => null), m.schedules.list().catch(() => []), m.display.get().catch(() => null), m.plugins().catch(() => []), S.api.maintenance.get().catch(() => null)]);
  S.maint = maint;
  const p = S.prefs, theme = local.get("theme", "auto");
  const ai = { enabled: (await S.api.settings.get().catch(() => ({ aiEnabled: true }))).aiEnabled !== false };
  const viz = plugins.find((x) => /visualizer/i.test(x.id));
  const DAYS = ["M", "T", "W", "T", "F", "S", "S"];
  el.innerHTML = `
  <div class="panel stack"><h2>Your setup</h2><p class="muted small">Used to match profiles to your coffee.</p>
    <div class="set-row first"><span>How you drink it</span>${seg("pDrink", [["straight", "Straight"], ["milk", "Milk"], ["both", "Both"]], p.drink ?? "both")}</div>
    <div class="set-row"><span>Bluetooth scale<span class="hint">Needed for D-Flow, A-Flow, blooming and allongé profiles</span></span>${sw("pScale", p.hasScale !== false)}</div>
    <div class="set-row"><span>Grinder burrs</span>${seg("pBurrs", [["flat", "Flat"], ["conical", "Conical"], ["unknown", "Not sure"]], p.burrs ?? "unknown")}</div>
    <div class="set-row"><span>Experience</span>${seg("pExp", [["new", "New"], ["comfortable", "Comfortable"], ["advanced", "Advanced"]], p.experience ?? "comfortable")}</div>
    <div class="set-row"><span>Basket dose<span class="hint">Grams your basket holds</span></span>${mini("pDose", p.basketDoseG ?? 18, 0.5, "grams")}</div>
  </div>

  <div class="panel stack"><h2>Steam, hot water and flush</h2>
    ${ss ? `<div class="set-row first"><span>Steam temperature</span>${mini("sSteamT", ss.targetSteamTemp, 5, "°C")}</div>` : ""}
    ${ms ? `<div class="set-row"><span>Steam flow<span class="hint">ml/s. Higher steams faster</span></span>${mini("sSteamF", ms.steamFlow, 0.1, "ml/s")}</div>` : ""}
    ${ss ? `<div class="set-row"><span>Hot water temperature</span>${mini("sWaterT", ss.targetHotWaterTemp, 1, "°C")}</div>` : ""}
    ${ms ? `<div class="set-row"><span>Hot water flow</span>${mini("sWaterF", ms.hotWaterFlow, 0.5, "ml/s")}</div>
    <div class="set-row"><span>Flush flow</span>${mini("sFlushF", ms.flushFlow, 0.5, "ml/s")}</div>
    <div class="set-row"><span>Flush temperature</span>${mini("sFlushT", ms.flushTemp, 1, "°C")}</div>` : ""}
    <div class="set-row"><span>Presets<span class="hint">Steam jugs, hot water volumes and flush times on the home screen</span></span><button class="btn small" id="editPresets">Edit presets</button></div>
    ${!ss && !ms ? '<p class="muted">The machine isn\'t reachable right now.</p>' : ""}
  </div>

  <div class="panel stack"><h2>Machine</h2>
    <div class="set-row first"><span>Start from the group head<span class="hint">For machines with a group head controller: Crema sets recipes and presets, and you start shots on the machine</span></span>${sw("sGhc", S.ghc)}</div>
    <div class="set-row"><span>Low water warning<span class="hint">Percent of the tank</span></span>${mini("sWaterWarn", 20, 5, "%")}</div>
    ${ms ? `<div class="set-row"><span>Tablet USB charging</span>${sw("sUsb", ms.usb === true || ms.usb === "enable")}</div>
    <div class="set-row"><span>Fan threshold</span>${mini("sFan", ms.fan, 5, "°C")}</div>` : ""}
  </div>

  <div class="panel stack"><h2>Sleep and wake</h2>
    ${pres ? `<div class="set-row first"><span>Sleep when idle</span>${sw("sPresence", pres.userPresenceEnabled)}</div>
    <div class="set-row"><span>After<span class="hint">Minutes without use</span></span>${mini("sSleepMin", pres.sleepTimeoutMinutes, 5, "minutes")}</div>` : ""}
    <span class="label">Wake schedules</span>
    <div class="stack" style="gap:6px" id="scheds">${scheds.map((s) => `<div class="sched"><span class="num">${esc(s.time)}</span><div class="days">${DAYS.map((d, i) => `<button type="button" data-day="${esc(s.id)}:${i + 1}" aria-pressed="${!s.daysOfWeek.length || s.daysOfWeek.includes(i + 1)}">${d}</button>`).join("")}</div>${sw(`en-${s.id}`, s.enabled)}<button class="btn small ghost" data-del="${esc(s.id)}">Remove</button></div>`).join("") || '<p class="muted small">None yet.</p>'}</div>
    <div class="row"><div class="field" style="flex:1"><label class="label" for="newWake">Add a wake time</label><input type="time" id="newWake" value="06:45"></div><button class="btn" id="addWake" style="align-self:end">Add</button></div>
  </div>

  <div class="panel stack"><h2>Display</h2>
    <div class="stack" style="gap:8px"><span class="label">Theme</span>
      <div class="skins">${SKINS.map((k) => `<button type="button" class="skin" data-skin="${k.id}" aria-pressed="${currentSkin() === k.id}">
        <span class="pv" style="background:${k.bg}">${k.pv.map((c) => `<i style="background:${c}"></i>`).join("")}</span><b>${k.name}</b><span>${k.note}</span></button>`).join("")}</div></div>
    <div class="set-row" ${currentSkin() === "crema" ? "" : "hidden"} id="modeRow"><span>Light or dark<span class="hint">For the Crema theme</span></span><div class="seg">${["auto", "light", "dark"].map((t) => `<button type="button" data-theme-set="${t}" aria-pressed="${theme === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div></div>
    <div class="set-row"><span>Clock when asleep<span class="hint">A dark screen saver while the machine sleeps; tap to wake</span></span>${sw("sSaver", S.saver)}</div>
    ${disp?.platformSupported?.brightness ? `<div class="set-row"><span>Tablet brightness</span><input type="range" id="sBright" min="5" max="100" value="${disp.brightness}" aria-label="Brightness" style="accent-color:var(--accent)"></div>` : ""}
  </div>

  <div class="panel stack"><h2>Maintenance</h2>
    ${maint ? `<div class="set-row first"><span>Backflush<span class="hint">${maint.shotsSinceBackflush ?? "–"} shots since the last one · reminder every ${maint.backflushEveryShots}</span></span><div class="row">${maint.backflushDue ? '<span class="pill warn">Due</span>' : ""}<button class="btn small" id="doneBackflush">Done today</button></div></div>
    <div class="set-row"><span>Remind after<span class="hint">Shots</span></span>${mini("mBack", maint.backflushEveryShots, 10, "shots")}</div>
    <div class="set-row"><span>Descale<span class="hint">${maint.daysSinceDescale != null ? `${maint.daysSinceDescale} days ago` : "Not recorded yet"} · reminder every ${maint.descaleEveryDays} days</span></span><div class="row">${maint.descaleDue ? '<span class="pill warn">Due</span>' : ""}<button class="btn small" id="doneDescale">Done today</button></div></div>
    <div class="set-row"><span>Remind after<span class="hint">Days. Depends on your water</span></span>${mini("mDesc", maint.descaleEveryDays, 15, "days")}</div>` : '<p class="muted">Unavailable.</p>'}
  </div>

  <div class="panel stack"><h2>AI features</h2>
    <div class="set-row first"><span>Use AI<span class="hint">${aiHint(ai)}</span></span>${sw("sAi", ai.enabled)}</div>
    ${ai.enabled && S.api.ai.available ? `<div class="set-row"><span>AI providers<span class="hint">Tried in order. Set with LLM_PROVIDERS on the Crema server</span></span><span class="num small">${esc((S.api.info.providers || []).map((x) => x.id).join(" → ") || "none")}</span></div>` : ""}
  </div>

  <div class="panel stack"><h2>Connections</h2>
    <div class="set-row first"><span>Machine<span class="hint">Decaid on the tablet</span></span><span class="num small">${esc(S.api.info.decaidUrl || "")}</span></div>
    <div class="set-row"><span>Crema server<span class="hint">${S.api.demo ? "Simulated in the demo" : S.api.info.server ? `Connected · ${esc(S.api.info.server)}` : S.api.info.serverError ? `Can't reach ${esc(S.api.info.serverError)}` : "Not connected. Optional, for AI features"}</span></span><button class="btn small" id="changeServer">${S.api.demo ? "Connect" : "Change"}</button></div>
    <div class="set-row"><span>Visualizer upload<span class="hint">${viz ? "Decaid's Visualizer plugin uploads shots. Set your account in Decaid's plugin settings" : "Install Decaid's Visualizer plugin to upload shots"}</span></span>${viz ? '<span class="pill good">Available</span>' : '<span class="pill plain">Not found</span>'}</div>
  </div>`;

  // ---- wire up ----
  const savePrefs = async (patch) => { S.prefs = await S.api.prefs.set(patch); for (const b of S.shelf) b.recipe = null; S.current && (await selectBean(S.current.id, { quiet: true })); toast("Saved. Recommendations updated"); };
  const segWire = (id, key) => $$(`#${id} button`).forEach((b) => (b.onclick = () => { $$(`#${id} button`).forEach((x) => x.setAttribute("aria-pressed", String(x === b))); savePrefs({ [key]: b.dataset.v }); }));
  segWire("pDrink", "drink"); segWire("pBurrs", "burrs"); segWire("pExp", "experience");
  $("#pScale").onchange = (e) => savePrefs({ hasScale: e.target.checked });
  const num = (id) => parseFloat($(`#${id}`)?.value);
  const handlers = {
    pDose: () => savePrefs({ basketDoseG: num("pDose") }),
    sSteamT: () => m.shotSettings.set({ targetSteamTemp: num("sSteamT") }),
    sSteamF: () => m.settings.set({ steamFlow: num("sSteamF") }),
    sWaterT: () => m.shotSettings.set({ targetHotWaterTemp: num("sWaterT") }),
    sWaterF: () => m.settings.set({ hotWaterFlow: num("sWaterF") }),
    sFlushF: () => m.settings.set({ flushFlow: num("sFlushF") }),
    sFlushT: () => m.settings.set({ flushTemp: num("sFlushT") }),
    sWaterWarn: () => m.waterThreshold(num("sWaterWarn")),
    sFan: () => m.settings.set({ fan: num("sFan") }),
    sSleepMin: () => m.presence.set({ sleepTimeoutMinutes: num("sSleepMin") }),
    mBack: () => S.api.maintenance.set({ backflushEveryShots: num("mBack") }),
    mDesc: () => S.api.maintenance.set({ descaleEveryDays: num("mDesc") }),
  };
  for (const [id, fn] of Object.entries(handlers)) {
    const input = $(`#${id}`); if (!input) continue;
    const run = async () => { try { await fn(); if (!id.startsWith("p")) toast("Saved"); } catch (e) { toast(`Couldn't save: ${e.message}`); } };
    input.onchange = run;
    $$(`[data-mini^="${id}:"]`).forEach((b) => (b.onclick = () => { const d = parseFloat(b.dataset.mini.split(":")[1]); input.value = String(round((parseFloat(input.value) || 0) + d, Math.abs(d) < 1 ? 0.1 : 1)); run(); }));
  }
  $("#sGhc").onchange = (e) => { S.ghc = e.target.checked; local.set("ghc", S.ghc); renderControls(); };
  const usb = $("#sUsb"); if (usb) usb.onchange = (e) => m.settings.set({ usb: e.target.checked ? "enable" : "disable" }).then(() => toast("Saved"));
  const pr = $("#sPresence"); if (pr) pr.onchange = (e) => m.presence.set({ userPresenceEnabled: e.target.checked }).then(() => toast("Saved"));
  $("#sSaver").onchange = (e) => { S.saver = e.target.checked; local.set("saver", S.saver); updateSaver(); };
  const br = $("#sBright"); if (br) br.onchange = (e) => m.display.brightness(Number(e.target.value)).catch(() => {});
  $$("[data-skin]", el).forEach((b) => (b.onclick = () => {
    applySkin(b.dataset.skin, false, true);
    $$("[data-skin]", el).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    $("#modeRow").hidden = b.dataset.skin !== "crema";
    toast(`${SKINS.find((k) => k.id === b.dataset.skin).name} theme`);
  }));
  $$("[data-theme-set]", el).forEach((b) => (b.onclick = () => { applyTheme(b.dataset.themeSet, false); $$("[data-theme-set]", el).forEach((x) => x.setAttribute("aria-pressed", String(x === b))); }));
  $$("[data-day]").forEach((b) => (b.onclick = async () => {
    const [id, d] = b.dataset.day.split(":"); const s = scheds.find((x) => x.id === id);
    const days = s.daysOfWeek.length ? s.daysOfWeek.slice() : [1, 2, 3, 4, 5, 6, 7];
    const i = days.indexOf(+d); i >= 0 ? days.splice(i, 1) : days.push(+d);
    s.daysOfWeek = days.sort(); await m.schedules.update(id, { daysOfWeek: s.daysOfWeek }); renderSettings();
  }));
  scheds.forEach((s) => { const t = $(`#en-${CSS.escape(s.id)}`); if (t) t.onchange = (e) => m.schedules.update(s.id, { enabled: e.target.checked }); });
  $$("[data-del]").forEach((b) => (b.onclick = async () => { await m.schedules.remove(b.dataset.del); renderSettings(); }));
  $("#addWake").onclick = async () => { const t = $("#newWake").value; if (!t) return; await m.schedules.add({ time: t, daysOfWeek: [1, 2, 3, 4, 5], enabled: true }); toast(`Wakes at ${t} on weekdays`); renderSettings(); };
  const db = $("#doneBackflush"); if (db) db.onclick = async () => { await S.api.maintenance.done("backflush"); S.maint = await S.api.maintenance.get(); renderStatus(); renderSettings(); toast("Backflush recorded"); };
  const dd = $("#doneDescale"); if (dd) dd.onclick = async () => { await S.api.maintenance.done("descale"); S.maint = await S.api.maintenance.get(); renderStatus(); renderSettings(); toast("Descale recorded"); };
  $("#editPresets").onclick = editPresets;
  $("#changeServer").onclick = () => connectSheet();
  $("#sAi").onchange = async (e) => {
    try { await S.api.settings.set({ aiEnabled: e.target.checked }); } catch (err) { toast(`Couldn't save: ${err.message}`); }
    renderStatus(); renderSettings();
    toast(e.target.checked ? "AI features on" : "AI features off. Crema uses its rules");
  };
}
function aiHint(ai) {
  if (!ai.enabled) return "Off. Add coffees by typing the details, and Crema picks profiles and dial-in steps with its rules";
  if (S.api.demo) return "Identifies coffees from photos, searches and links, picks profiles and gives dial-in advice. Simulated in the demo";
  if (!S.api.ai.available) return "Needs a Crema server, which isn't connected. Crema uses its rules until then";
  if (!S.api.ai.healthy) return "The Crema server isn't answering, so Crema is using its rules for now";
  return "Identifies coffees from photos, searches and links, picks profiles and gives dial-in advice. Falls back to the rules if it fails";
}
function editPresets() {
  const p = JSON.parse(JSON.stringify(S.presets));
  const rows = (kind, unit, key) => p[kind].map((x, i) => `<div class="row"><input class="input" style="flex:1;min-width:0" data-pl="${kind}:${i}" value="${esc(x.label)}" maxlength="24" aria-label="Name"><input class="input" style="width:90px" data-pv="${kind}:${i}:${key}" inputmode="numeric" value="${x[key]}" aria-label="${unit}"><span class="muted small" style="width:30px">${unit}</span></div>`).join("");
  openSheet(`<h2>Presets</h2>
    <span class="label">Steam (seconds, 0 = until you stop)</span>${rows("steam", "s", "seconds")}
    <span class="label">Hot water (ml)</span>${rows("water", "ml", "ml")}
    <span class="label">Flush (seconds)</span>${rows("flush", "s", "seconds")}
    <div class="row"><button class="btn primary" id="savePresets">Save presets</button></div>`);
  $("#savePresets").onclick = async () => {
    $$("[data-pl]").forEach((i) => { const [k, n] = i.dataset.pl.split(":"); p[k][n].label = i.value.trim() || p[k][n].label; });
    $$("[data-pv]").forEach((i) => { const [k, n, key] = i.dataset.pv.split(":"); const v = parseFloat(i.value); if (Number.isFinite(v)) p[k][n][key] = v; });
    try { S.presets = await S.api.presets.set(p); closeSheet(); renderControls(); toast("Presets saved"); } catch (e) { toast(e.message); }
  };
}

/* ================= device frame (demo on a desktop) =================
   On a wide desktop window the demo shows inside a frame at the DE1 tablet's
   exact screen size (or an iPhone's), scaled to fit. The app runs in an iframe
   of that size, so its own layout rules see the real device dimensions.
   Phones, tablets and pages that are already embedded are left alone. */
const DEVICES = {
  tablet: { w: 1340, h: 800, bezel: 18, radius: 30, label: "Tablet · 1340 × 800 landscape" },
  phone: { w: 390, h: 844, bezel: 12, radius: 52, label: "iPhone · 390 × 844" },
};
const wantsDeviceFrame = () =>
  window.top === window && !/[?&](embed|full)\b/.test(location.search) && matchMedia("(min-width: 1100px) and (pointer: fine)").matches;
function showDeviceFrame() {
  const inApp = /\/app\/(index\.html)?$/.test(location.pathname);
  document.body.innerHTML = `<div class="dev-host">
    <header class="dev-bar">
      <div class="row"><span class="dev-brand">crema</span><span class="muted small" id="devLabel"></span></div>
      <div class="row"><div class="seg" id="devSeg" role="group" aria-label="Device">${Object.keys(DEVICES).map((k) => `<button type="button" data-dev="${k}">${k === "tablet" ? "Tablet" : "iPhone"}</button>`).join("")}</div>
        <a class="btn small ghost" href="?full${esc(location.hash)}">Full window</a>${inApp ? '<a class="btn small ghost" href="../">Walkthrough</a>' : ""}</div>
    </header>
    <div class="dev-stage" id="devStage"><div class="dev" id="dev"><iframe id="devFrame" title="Crema demo"></iframe></div></div>
    <p class="muted small dev-note">A simulated DE1 and scale with real ONA and Haven coffees. Try Espresso, Steam, the shelf, profiles and themes.</p>
  </div>`;
  const frame = $("#devFrame"), dev = $("#dev"), stage = $("#devStage");
  frame.src = `${location.pathname}?embed&demo${location.hash}`;
  let mode = local.get("device", "tablet");
  const fit = () => {
    const d = DEVICES[mode];
    const ow = d.w + d.bezel * 2, oh = d.h + d.bezel * 2;
    const s = Math.min(1, (stage.clientWidth - 24) / ow, (stage.clientHeight - 24) / oh);
    Object.assign(dev.style, { width: `${ow}px`, height: `${oh}px`, padding: `${d.bezel}px`, borderRadius: `${d.radius}px`, transform: `translate(-50%, -50%) scale(${s})` });
    Object.assign(frame.style, { width: `${d.w}px`, height: `${d.h}px`, borderRadius: `${Math.max(8, d.radius - d.bezel)}px` });
    $("#devLabel").textContent = `${d.label}${s < 1 ? ` · shown at ${Math.round(s * 100)}%` : ""}`;
    $$("[data-dev]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.dev === mode)));
  };
  $$("[data-dev]").forEach((b) => (b.onclick = () => { mode = b.dataset.dev; local.set("device", mode); fit(); }));
  window.addEventListener("resize", fit);
  // Keep the frame's background in step with the theme chosen inside the app.
  window.addEventListener("storage", (e) => {
    try {
      if (e.key === "crema:look") applySkin(JSON.parse(e.newValue), false);
      if (e.key === "crema:theme") applyTheme(JSON.parse(e.newValue), false);
    } catch {}
  });
  fit();
}

/* ================= connections =================
   The machine (Decaid) is required for live use; the Crema server is optional.
   - Decaid: through the Crema server's /decaid proxy when Crema serves this
     page (the phone app), otherwise directly. By default that's the same host
     on port 8080, which is right when Decaid serves this page (the tablet skin,
     or http://<tablet-ip>:3000 on a phone). It can be changed in the app.
   - Crema server: this page's own origin if it answers, otherwise a saved
     address (?server=… or entered in the app), otherwise none. */
const cleanAddr = (a) => String(a || "").trim().replace(/\/+$/, "").replace(/^(?!https?:\/\/)/, "http://");
const wsFrom = (http) => http.replace(/^http/, "ws").replace(/\/+$/, "");
async function probe(url, ms = 4000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}
const defaultDecaid = () => (location.protocol.startsWith("http") && location.hostname ? `${location.protocol}//${location.hostname}:8080` : "http://localhost:8080");

async function discoverConnections() {
  const q = new URLSearchParams(location.search);
  if (q.get("server")) local.set("server", cleanAddr(q.get("server")));
  if (q.get("decaid")) local.set("decaid", cleanAddr(q.get("decaid")));
  const conn = { decaid: null, decaidWs: null, crema: null, cremaInfo: null, cremaError: null, decaidError: null };

  if (location.protocol.startsWith("http")) {
    try { conn.cremaInfo = await probe("/api/config", 3000); if (conn.cremaInfo?.crema) conn.crema = ""; else conn.cremaInfo = null; } catch {}
  }
  const saved = local.get("server", "");
  if (conn.crema == null && saved) {
    try { conn.cremaInfo = await probe(`${saved}/api/config`); conn.crema = saved; } catch { conn.cremaError = saved; }
  }

  const savedDecaid = local.get("decaid", "");
  if (conn.crema === "" && conn.cremaInfo?.decaidUrl && !savedDecaid) {
    conn.decaid = "/decaid";
    conn.decaidWs = wsFrom(conn.cremaInfo.decaidUrl);
  } else {
    conn.decaid = savedDecaid || defaultDecaid();
    conn.decaidWs = wsFrom(conn.decaid);
  }
  // Decaid speaks plain http, which an https page (like a hosted demo) can't call, so don't try unless asked to.
  if (location.protocol === "https:" && !savedDecaid && conn.decaid !== "/decaid") { conn.decaid = null; return conn; }
  try { await probe(`${conn.decaid}/api/v1/profiles?visibility=visible`); }
  catch { conn.decaidError = conn.decaid === "/decaid" ? conn.cremaInfo?.decaidUrl : conn.decaid; conn.decaid = null; }
  return conn;
}

// A real reload (a hash-only change wouldn't reload), without stale ?server= or ?decaid= in the address.
function reloadClean() {
  const u = new URL(location.href);
  u.searchParams.delete("server");
  u.searchParams.delete("decaid");
  history.replaceState(null, "", u);
  location.reload();
}

function connectSheet(message = "") {
  const server = local.get("server", "");
  const decaid = local.get("decaid", "") || (S.api && !S.api.demo ? S.api.info.decaidUrl : "") || defaultDecaid();
  openSheet(`<h2>Connections</h2>
    ${message ? `<p class="error small">${esc(message)}</p>` : ""}
    <div class="field"><label class="label" for="decaidAddr">Machine (Decaid on the tablet)</label><input type="url" id="decaidAddr" value="${esc(decaid)}" placeholder="http://192.168.1.50:8080" autocomplete="off">
      <span class="muted small">Required. On the tablet itself this is <span class="num">http://localhost:8080</span>.</span></div>
    <div class="field"><label class="label" for="serverAddr">Crema server (optional, for AI features)</label><input type="url" id="serverAddr" value="${esc(server)}" placeholder="http://192.168.1.20:8787" autocomplete="off">
      <span class="muted small">Leave empty to run without AI. Everything else works without it.</span></div>
    <div class="row"><button class="btn primary" id="connSave">Save and connect</button></div>
    <p class="muted small" id="connStatus"></p>`);
  $("#connSave").onclick = async () => {
    const d = cleanAddr($("#decaidAddr").value), s = $("#serverAddr").value.trim() ? cleanAddr($("#serverAddr").value) : "";
    $("#connStatus").textContent = "Checking…";
    try { await probe(`${d}/api/v1/profiles?visibility=visible`); }
    catch { $("#connStatus").textContent = `Couldn't reach the machine at ${d}. Check the tablet's address and that Decaid is running.`; return; }
    if (s) {
      try { await probe(`${s}/api/config`); }
      catch { $("#connStatus").textContent = `The machine answered, but the Crema server at ${s} didn't. Check its address, or leave it empty to run without AI.`; return; }
    }
    local.set("decaid", d === defaultDecaid() ? "" : d);
    local.set("server", s);
    $("#connStatus").textContent = "Connected. Reloading…";
    reloadClean();
  };
}

/* ================= routing + boot ================= */
const VIEWS = ["brew", "shelf", "add", "profiles", "shots", "settings"];
function route(scroll = true) {
  const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "brew";
  VIEWS.forEach((n) => ($(`#view-${n}`).hidden = n !== v));
  document.body.classList.toggle("on-brew", v === "brew");
  $$(".tab[data-view]").forEach((t) => (t.dataset.view === v || (v === "add" && t.dataset.view === "shelf") ? t.setAttribute("aria-current", "page") : t.removeAttribute("aria-current")));
  if (v === "brew") { renderNextShot(); renderFavs(); renderControls(); renderReadouts(); requestAnimationFrame(renderLive); }
  if (v === "shelf") renderShelf();
  if (v === "add") renderAddModes();
  if (v === "profiles") renderProfiles();
  if (v === "shots") renderShots();
  if (v === "settings") renderSettings();
  if (scroll) window.scrollTo(0, 0);
}

async function boot() {
  REVIEW_INTRO = $("#reviewPanel").innerHTML;
  applyTheme(local.get("theme", "auto"), false);
  applySkin(window.CREMA_SKIN || local.get("look", DEFAULT_SKIN), false);
  const forceDemo = window.CREMA_FORCE_DEMO || /[?&]demo\b/.test(location.search);
  const conn = forceDemo ? null : await discoverConnections();
  if (conn?.decaid) S.api = makeLiveApi(conn);
  else if (wantsDeviceFrame() && !local.get("decaid", "")) return showDeviceFrame();
  else S.api = makeDemoApi();
  await S.api.settings.get().catch(() => {});
  $("#demoBanner").hidden = !S.api.demo;
  // Offer to connect when this page could reach a machine (not the hosted demos).
  if (S.api.demo && !forceDemo && location.protocol === "http:") {
    $("#demoBanner").innerHTML = `Demo mode: no machine connected. <button class="btn small" id="connectBtn" type="button">Connect</button>`;
    $("#connectBtn").onclick = () => connectSheet();
    if (conn?.decaidError) setTimeout(() => connectSheet(`Couldn't reach the machine at ${conn.decaidError}, so this is the demo.`), 300);
  }

  document.addEventListener("pointerdown", () => S.api.machine.heartbeat(), { passive: true });
  $$("[data-mode]").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  $("#photoInput").onchange = async (e) => {
    files = [...files, ...e.target.files].slice(0, 4);
    const thumbs = await Promise.all(files.map((f) => thumbnail(f, 200)));
    $("#thumbs").innerHTML = thumbs.filter(Boolean).map((t) => `<img src="${t}" alt="Bag photo">`).join("");
    e.target.value = "";
  };
  $("#addForm").addEventListener("submit", onIdentify);
  $("#railSleep").onclick = $("#phoneSleep").onclick = sleepWake;
  $("#saver").onclick = () => { $("#saver").hidden = true; S.api.machine.setState("idle").catch(() => {}); };
  $("#sheetBack").onclick = (e) => { if (e.target === $("#sheetBack")) closeSheet(); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

  const [prefs, favs, presets, maint] = await Promise.all([S.api.prefs.get().catch(() => ({})), S.api.favourites.get().catch(() => S.favourites), S.api.presets.get().catch(() => null), S.api.maintenance.get().catch(() => null)]);
  Object.assign(S, { prefs, favourites: favs, presets, maint });
  await refreshShelf().catch(() => (S.shelf = []));
  await selectBean(local.get("current", null) || S.shelf[0]?.id, { quiet: true });

  S.api.subscribe({
    snapshot: onSnapshot,
    scale: (s) => { S.scale = { ...S.scale, ...s }; renderStatus(); if (!$("#view-brew").hidden) renderReadouts(); },
    water: (w) => { S.water = w; renderStatus(); },
    ready: (r) => { S.ready = r; },
  });
  window.addEventListener("hashchange", () => route());
  window.addEventListener("crema:ai", () => renderStatus());
  window.addEventListener("resize", () => { if (!$("#view-brew").hidden) renderLive(); });
  renderStatus(); renderAlerts();
  route();
}
boot();
