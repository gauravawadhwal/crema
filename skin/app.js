/* Crema web app: the DE1 tablet skin, the iPhone companion and the demo.

   Live mode talks to Decaid (the tablet app that runs the machine) for
   everything, and keeps Crema's own records in Decaid's key-value store. The
   Crema server is an optional AI add-on; without it, or with AI switched off,
   Crema uses the rules in engine.js. When Decaid can't be reached, the page
   runs the self-contained demo from demo.js.

   API interface (implemented by makeLiveApi below and makeDemoApi in demo.js):
     info, ai { available, on, healthy }, settings { get, set },
     shelf, identify, saveBean, setBeanState, pinBest, recommend, rank, catalog,
     apply, shots, annotate, feedback, review, prefs, favourites, presets, maintenance,
     machine { setState, tare, recipe, workflowSettings, settings, waterThreshold, presence,
               schedules, display, plugins, info, heartbeat }, subscribe */
"use strict";

/* ================= utilities ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Like el.innerHTML = html, but keeps the elements already there wherever the markup
// has the same shape, changing only text and attributes. For anything redrawn on every
// machine or scale update (several times a second): a tap only counts if the finger
// goes down and up on the same element, so a button replaced mid-tap loses the tap.
function patchHtml(el, html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  patchChildren(el, t.content);
}
function patchChildren(el, from) {
  const want = [...from.childNodes];
  want.forEach((n, i) => {
    const cur = el.childNodes[i];
    if (!cur || cur.nodeName !== n.nodeName || (n.nodeType === 1 && cur.id !== n.id)) {
      if (cur) el.replaceChild(n, cur); else el.appendChild(n);
    } else if (n.nodeType !== 1) {
      if (cur.nodeValue !== n.nodeValue) cur.nodeValue = n.nodeValue;
    } else {
      for (const a of [...cur.attributes]) if (!n.hasAttribute(a.name)) cur.removeAttribute(a.name);
      for (const a of n.attributes) if (cur.getAttribute(a.name) !== a.value) cur.setAttribute(a.name, a.value);
      patchChildren(cur, n);
    }
  });
  while (el.childNodes.length > want.length) el.lastChild.remove();
}
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

// A failed request in plain words. The browser's own text for an unreachable address is not.
const failText = (e) => {
  const m = String(e?.message ?? e ?? "").trim();
  return !m || /failed to fetch|load failed|networkerror|network request failed|aborted/i.test(m) ? "Decaid didn't answer" : m;
};
// Runs a write that has a button behind it. On failure it says so, runs `undo` to put the
// screen back, and returns `undefined`; a success returns the write's own value (or true).
async function attempt(what, write, undo) {
  try { return (await write()) ?? true; }
  catch (e) { try { undo?.(); } catch {} toast(`Couldn't ${what}: ${failText(e)}`); return undefined; }
}
// Anything that still fails without anyone catching it (a button nobody wrote handling for)
// shows up instead of doing nothing.
window.addEventListener("unhandledrejection", (e) => {
  e.preventDefault();
  console.error(e.reason);
  toast(`Couldn't do that: ${failText(e.reason)}`);
});

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

/* ================= rest window (rules from server/recommend/rules via the engine) ================= */
const REST_LABEL = { resting: "Resting", peak: "In its window", fading: "Past its best", unknown: "No roast date" };
function restOf(info) {
  const r = E.restOf(info || {});
  return { days: r.daysOffRoast, window: r.window, status: r.status, label: REST_LABEL[r.status] };
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
const NO_BAG = "__no_bag__";
const manualKind = (p) => p?.beverage_type === "manual" ? ({ "ghc/manual flow control": "flow", "ghc/manual pressure control": "pressure" }[p.title?.toLowerCase()] ?? null) : null;
// Ignore only temperature/yield edits; retain step structure, limits and notes so
// two installed profiles with the same title cannot be mistaken for one another.
function brewProfileShape(profile) {
  if (!profile) return null;
  const first = Number(profile.steps?.[0]?.temperature);
  const relative = { ...profile, steps: profile.steps?.map((s) => ({ ...s, temperature: s.temperature == null ? null : Math.round((Number(s.temperature) - first) * 1e6) / 1e6 })) };
  const ordered = (v) => Array.isArray(v) ? v.map(ordered) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().filter((k) => k !== "target_weight").map((k) => [k, ordered(v[k])])) : v;
  return JSON.stringify(ordered(relative));
}
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
  // Every request has a time limit, so a stuck one can't hold up whatever waits on it.
  // Decaid answers in milliseconds; the Crema server's AI calls pass longer limits.
  const j = async (url, opts = {}) => {
    const { timeoutMs = 15000, ...init } = opts;
    if (opts.body && !(opts.body instanceof FormData)) init.headers = { "content-type": "application/json" };
    init.signal = AbortSignal.timeout(timeoutMs);
    let res;
    try { res = await fetch(url, init); }
    catch (e) { if (e.name === "TimeoutError") throw new Error(`no answer within ${Math.round(timeoutMs / 1000)} s`); throw e; }
    const text = await res.text();
    const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
    if (!res.ok) { const e = new Error((data && data.error) || `${res.status} ${res.statusText}`); e.status = res.status; throw e; }
    return data;
  };
  const put = (url, body) => j(url, { method: "PUT", body: JSON.stringify(body) });
  const post = (url, body, opts = {}) => j(url, { method: "POST", body: JSON.stringify(body ?? {}), ...opts });
  // The server gives a CLI model up to 300 s per attempt (Gemini 90 s). Identifying a
  // coffee can search the web, so it gets one attempt's worth; a recipe or dial-in
  // falls back to the rules, so waiting longer than 2 minutes isn't worth it.
  const AI_WAIT = { identify: 330000, transcribe: 60000, recommend: 120000, dialin: 120000, review: 120000 };
  const D = (p) => `${conn.decaid}/api/v1${p}`;
  const C = (p) => `${conn.crema}${p}`;
  const wsBase = conn.decaidWs;

  // ---- Crema's data in Decaid's key-value store ----
  const kvUrl = (key) => D(`/store/${KV_NS}/${encodeURIComponent(key)}`);
  // Decaid's docs say a missing key is a 404; Decaid 0.9.1 answers 200 with null. Treat both as missing.
  const kvGet = async (key, fallback) => { try { return (await j(kvUrl(key))) ?? fallback; } catch (e) { if (e.status === 404) return fallback; throw e; } };
  const kvSet = (key, value) => post(kvUrl(key), value);
  const recordOf = (beanId) => kvGet(`bean:${beanId}`, null);
  // Shared with other devices and with no revision in Decaid's store: re-read right before
  // writing and change only the fields in the patch. `patch` may be a function of the fresh
  // record (return null to write nothing), so a caller's decision uses the record it merges into.
  const patchRecord = async (beanId, patch) => {
    const fresh = await recordOf(beanId);
    const p = typeof patch === "function" ? patch(fresh) : patch;
    if (!p) return fresh;
    const next = E.mergeRecord(fresh, p);
    await kvSet(`bean:${beanId}`, next);
    return next;
  };

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

  // Serialize this client's annotation merges so rapid taste taps cannot overwrite each other.
  const annotationWrites = new Map();
  const optionalNumber = (value) => value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);

  // ---- shots ----
  const shotPoints = (full) => {
    const m = full.measurements || [];
    const t0 = m.map((x) => Date.parse(x.machine?.timestamp)).find(Number.isFinite);
    if (t0 == null) return [];
    const points = m.filter((x) => x.machine).map((x) => ({ t: (Date.parse(x.machine.timestamp) - t0) / 1000, p: x.machine.pressure ?? null, f: x.machine.flow ?? null, w: x.scale?.weight ?? null, temp: x.machine.mixTemperature ?? null, tp: x.machine.targetPressure ?? null, tf: x.machine.targetFlow ?? null,
      targetTemp: x.machine.targetMixTemperature ?? null, groupTemp: x.machine.groupTemperature ?? null, targetGroupTemp: x.machine.targetGroupTemperature ?? null, frame: x.machine.profileFrame ?? null, substate: x.machine.state?.substate ?? null, weightFlow: x.scale?.weightFlow ?? null }));
    const ordered = [];
    for (const point of points) {
      if (!Number.isFinite(point.t) || point.t < 0) continue;
      if (ordered.length && point.t === ordered.at(-1).t) ordered[ordered.length - 1] = point;
      else if (!ordered.length || point.t > ordered.at(-1).t) ordered.push(point);
    }
    return ordered;
  };
  const toShot = (s, full) => {
    const ctx = s.workflow?.context || {};
    const points = full ? shotPoints(full) : [];
    return { id: s.id, timestamp: s.timestamp, beanId: null, batch: ctx.beanBatchId, coffee: ctx.coffeeName, roaster: ctx.coffeeRoaster, profileTitle: s.workflow?.profile?.title ?? s.workflow?.name,
      manual: manualKind(s.workflow?.profile), doseG: s.annotations?.actualDoseWeight ?? ctx.targetDoseWeight ?? null, yieldG: s.annotations?.actualYield ?? (points.length ? points.at(-1).w : null), timeS: points.length ? Math.round(points.at(-1).t) : null,
      enjoyment: s.annotations?.enjoyment ?? null, notes: s.annotations?.espressoNotes ?? "", grinderSetting: ctx.grinderSetting, points,
      profile: s.workflow?.profile ?? null, stopReason: s.stopReason ?? s.annotations?.stopReason ?? null,
      review: s.annotations?.extras?.crema?.review ?? null,
      taste: { sourBitter: s.annotations?.extras?.crema?.sourBitter ?? null, body: s.annotations?.extras?.crema?.body ?? null } };
  };
  // Decaid's shot list gives at most 100 per page and echoes whatever limit was asked
  // for, so a bigger request silently comes back short. Pages are asked for 100 at a
  // time and `total` says when to stop. List items are summaries (no measurements),
  // which is all counting needs. Decaid lists newest first, so `since` can stop early.
  const SHOT_PAGE = 100;
  const shotSummaries = async ({ batchId = null, since = 0 } = {}) => {
    const out = [];
    for (let offset = 0, pages = 0; pages < 100; offset += SHOT_PAGE, pages++) {
      const q = new URLSearchParams({ limit: String(SHOT_PAGE), offset: String(offset) });
      if (batchId) q.set("beanBatchId", batchId);
      const page = await j(D(`/shots?${q}`));
      const items = page?.items ?? [];
      for (const s of items) { if (since && Date.parse(s.timestamp) <= since) return out; out.push(s); }
      if (!items.length || offset + items.length >= (page.total ?? 0)) return out;
    }
    return out;
  };
  // A few recent shots of one bag, for the AI's context. Failures mean no context.
  const batchShots = async (batchId, limit) => (batchId ? (await j(D(`/shots?beanBatchId=${encodeURIComponent(batchId)}&limit=${Math.min(limit, SHOT_PAGE)}`)).catch(() => ({ items: [] }))).items : []);
  const fullShot = async (id) => {
    try { return await j(D(`/shots/${encodeURIComponent(id)}`)); } catch (e) { if (e.status === 404) return null; throw e; }
  };

  // ---- one coffee, assembled from Decaid + Crema's record ----
  // A coffee is Decaid's bean plus Crema's record (identification, recipe, reference
  // shot, photos), shared by all its bags. A bag is one of Decaid's batches: roast date,
  // weight, frozen and finished belong to it. `batchId` picks the bag; without one, the
  // bag Crema last added.
  async function coffee(beanId, batchId = null) {
    const [bean, rec, batches] = await Promise.all([j(D(`/beans/${beanId}`)), recordOf(beanId), j(D(`/beans/${beanId}/batches?includeArchived=false`)).catch(() => [])]);
    const batch = (batchId && batches.find((x) => x.id === batchId)) || batches.find((x) => x.id === rec?.batchId) || batches[0] || null;
    return { bean, rec, batch, info: rec?.info ?? infoFromDecaidBean(bean, batch) };
  }
  // How much of a bag is left. Decaid doesn't reduce a batch's weightRemaining when a
  // shot is pulled, so Crema counts it: the bag's weight, less the doses of espresso
  // shots recorded against it (from any skin that records the bag), plus a correction.
  // syncRemaining writes the result to weightRemaining so Decaid and other skins see it,
  // and remembers what it wrote; if weightRemaining has changed since (set in Decaid or
  // another skin), that change becomes the correction instead of being overwritten.
  // Each bag's correction is its own key, so the tablet and a phone writing a recipe
  // and a bag at the same time can't overwrite each other's change.
  const bagKey = (batchId) => `bag:${batchId}`;
  const bagUse = async (batch) => {
    const shots = await shotSummaries({ batchId: batch.id }).then((all) => all.filter((s) => isEspresso(s.workflow?.profile?.title ?? s.workflow?.name)), () => null);
    const used = E.gramsUsed(shots);
    const state = await kvGet(bagKey(batch.id), {}).catch(() => ({}));
    // Reading only: a change made elsewhere is applied in memory, so every device gets
    // the same figure. It is stored by syncRemaining (after a shot, or when you set
    // what's left), not here, so devices polling the shelf never write.
    const { adjust, remaining } = E.bagRemaining({ used, weight: batch.weight ?? null, weightRemaining: batch.weightRemaining, state });
    return { shots, used, adjust, remaining, state };
  };
  const installedProfiles = async () => (await j(D("/profiles?visibility=visible"))).filter((p) => (p.profile.beverage_type ?? "espresso") === "espresso");
  const installedTitles = async () => (await installedProfiles()).map((p) => p.profile.title);

  // Steam, hot water and flush live in Decaid's workflow (steamSettings, hotWaterData,
  // rinseData), its recommended route: it sends them to the machine itself, and a
  // write may carry only the fields that change (Decaid merges them; checked on 0.9.1).
  // Writing the machine's shot settings directly would leave the workflow, which other
  // skins read, saying something else. Only these three keys are ever sent, never the
  // profile, so a write is safe during a shot.
  const WORKFLOW_SETTINGS = ["steamSettings", "hotWaterData", "rinseData"];
  const pickSettings = (o) => Object.fromEntries(WORKFLOW_SETTINGS.filter((k) => o?.[k]).map((k) => [k, o[k]]));

  let heartbeatAt = 0;
  const api = {
    demo: false,
    info: {
      providers: conn.cremaInfo?.providers ?? [],
      voice: conn.cremaInfo?.voice ?? null,
      decaidUrl: conn.decaid === "/decaid" ? conn.cremaInfo?.decaidUrl : conn.decaid,
      server: conn.crema == null ? null : conn.crema || location.origin,
      serverError: conn.cremaError || null,
    },
    ai: { get available() { return conn.crema != null; }, get enabled() { return settings.aiEnabled !== false; }, get on() { return aiOn(); }, get healthy() { return healthy; },
      // The server can turn a voice note into text (Gemini).
      get voice() { return aiOn() && !!conn.cremaInfo?.voice; } },
    // Decaid's WebView adds window.decentApp to the skin's page; a phone or desktop
    // browser doesn't have it. Checked each time, not cached, in case it arrives late.
    host: {
      get canExit() { return typeof window.decentApp?.exitToDashboard === "function"; },
      exitToDashboard() { window.decentApp.exitToDashboard(); },
    },
    settings: {
      async get() { settings = { ...E.DEFAULT_SETTINGS, ...(await kvGet("settings", {})) }; return { ...settings }; },
      // Re-read first so a field another device changed since this one loaded survives.
      async set(p) {
        const fresh = await kvGet("settings", {});
        await kvSet("settings", E.mergeRecord(fresh, p));
        settings = { ...E.DEFAULT_SETTINGS, ...fresh, ...p };
        return { ...settings };
      },
    },

    // A cheap read for the 5 s poll: the open coffees, their open bags (which carry
    // each bag's remaining weight, frozen and finished state) and the newest shot. It
    // differs whenever the shelf changed on another device, except for Crema's own
    // records (recipe, photo, reference shot), which the minute check picks up.
    async shelfSignal() {
      const beans = await j(D("/beans?includeArchived=false"));
      const [batches, latest] = await Promise.all([
        Promise.all(beans.map((b) => j(D(`/beans/${b.id}/batches?includeArchived=false`)))),
        j(D("/shots?limit=1")).catch(() => null),
      ]);
      return JSON.stringify([beans, batches, latest?.items?.[0]?.id ?? null, latest?.total ?? null]);
    },
    // One row per open bag. `id` is the coffee (shared data), `batch` and `key` the bag.
    async shelf() {
      const beans = await j(D("/beans?includeArchived=false"));
      const rows = await Promise.all(beans.map(async (b) => {
        const [rec, batches] = await Promise.all([recordOf(b.id).catch(() => null), j(D(`/beans/${b.id}/batches?includeArchived=false`)).catch(() => [])]);
        const open = batches.filter((x) => !x.archived);
        if (rec?.finished && !open.length) return [];
        const info = rec?.info ?? infoFromDecaidBean(b, open[0] ?? null);
        const bags = open.length ? open : [null];
        return Promise.all(bags.map(async (batch, i) => {
          const use = batch ? await bagUse(batch) : { shots: [], remaining: null };
          const weight = batch ? batch.weight ?? null : info.weightGrams ?? null;
          return {
            key: batch?.id ?? `bean:${b.id}`, id: b.id, batch: batch?.id ?? null, bags: bags.length, bagNo: i + 1,
            info: { ...info, ...(batch?.roastDate ? { roastDate: { value: batch.roastDate.slice(0, 10), source: info.roastDate?.source ?? "bag" } } : {}), weightGrams: weight },
            recipe: rec?.recipe ?? null, recipeSource: rec?.recipeSource ?? (rec?.recipe ? "saved" : null),
            photo: rec?.photo ?? null, productImage: rec?.productImage ?? info.imageUrl ?? null, art: rec?.art,
            weight, remaining: use.remaining, frozen: batch?.frozen ?? false, bestShotId: rec?.bestShotId ?? null, shots: use.shots ? use.shots.length : null,
          };
        }));
      }));
      return rows.flat();
    },
    async identify({ files, query, description, url, offline }, onStep) {
      if (!aiOn()) throw new Error(conn.crema == null ? "Identifying needs a Crema server. Enter the details by hand instead." : "AI features are off. Enter the details by hand, or switch AI on in Settings.");
      onStep(0, [files?.length ? "Reading the bag and finding the roaster's page" : "Looking up the coffee", "Building the record"]);
      const fd = new FormData();
      (files || []).forEach((f) => fd.append("images", f));
      if (query) fd.set("query", query); if (url) fd.set("url", url); if (offline) fd.set("offline", "true");
      // The tablet's own date, so "roasted last Tuesday" resolves in the user's time zone.
      if (description) { fd.set("description", description); fd.set("today", new Date().toLocaleDateString("en-CA")); }
      return (await cremaCall(() => j(C("/api/identify"), { method: "POST", body: fd, timeoutMs: AI_WAIT.identify }))).info;
    },

    async transcribe(wav) {
      if (!this.ai.voice) throw new Error("Speaking needs a Crema server with a Gemini API key.");
      const fd = new FormData(); fd.append("audio", wav, "voice.wav");
      return (await cremaCall(() => j(C("/api/transcribe"), { method: "POST", body: fd, timeoutMs: AI_WAIT.transcribe }))).text;
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
      // Another bag of a coffee already known: keep its recipe, reference shot and photos.
      const prev = await recordOf(bean.id).catch(() => null);
      const batch = await post(D(`/beans/${bean.id}/batches`), {
        roastDate: info.roastDate.value ? `${info.roastDate.value}T00:00:00Z` : null, roastLevel: info.roastLevel.value, weight: info.weightGrams,
      });
      // Keep a copy of the roaster's photo on the Crema server when there is one, so it shows offline.
      let productImage = info.imageUrl || null;
      if (productImage && conn.crema != null && /^https?:/.test(productImage)) {
        // The server couldn't fetch it (a dead link, a shop placeholder): don't keep a
        // picture that will show as broken; the bag photo or the initial tile stands in.
        try { productImage = conn.crema + (await post(C("/api/images/cache"), { url: productImage })).path; }
        catch { productImage = null; info = { ...info, imageUrl: null }; if (art === "product") art = photo ? "photo" : null; }
      }
      // Re-read and merge: a reference shot or recipe another device wrote meanwhile stays.
      await patchRecord(bean.id, (fresh) => E.saveBeanPatch(fresh, { info, photo: photo || null, productImage, art: art || null, batchId: batch.id, now: new Date().toISOString() }));
      return { id: bean.id, batch: batch.id, key: batch.id, anotherBag: !!prev };
    },
    // Another bag of a coffee on the shelf (or finished): a new batch, same record.
    async addBag(beanId, { roastDate = null, weight = null } = {}) {
      const bean = await j(D(`/beans/${beanId}`));
      if (bean.archived) await put(D(`/beans/${beanId}`), { archived: false });
      const batch = await post(D(`/beans/${beanId}/batches`), { roastDate: roastDate ? `${roastDate}T00:00:00Z` : null, weight: weight ?? null });
      await patchRecord(beanId, { finished: false, batchId: batch.id });
      return { id: beanId, batch: batch.id, key: batch.id };
    },
    // After a shot, or when you say how much is left: write the bag's remaining to Decaid.
    async syncRemaining(beanId, batchId, setTo = null) {
      if (!batchId) return null;
      const batch = await j(D(`/bean-batches/${batchId}`));
      const use = await bagUse(batch);
      let remaining = use.remaining;
      if (setTo != null && batch.weight != null && use.used != null) {
        remaining = Math.max(0, Math.round(setTo));
        await kvSet(bagKey(batchId), { ...use.state, adjust: remaining - (batch.weight - use.used), written: remaining });
      } else await kvSet(bagKey(batchId), { ...use.state, adjust: use.adjust, written: remaining });
      if (remaining != null) await put(D(`/bean-batches/${batchId}`), { weightRemaining: remaining });
      return remaining;
    },
    // Frozen and finished are a bag's. Finishing one bag leaves the coffee's others on
    // the shelf; the coffee itself is archived only when its last open bag is finished.
    async setBeanState(id, patch, batchId = null) {
      const { batch } = await coffee(id, batchId);
      if (patch.frozen !== undefined && batch) await put(D(`/bean-batches/${batch.id}`), { frozen: patch.frozen, freezeDate: patch.frozen ? new Date().toISOString() : null });
      if (patch.finished === true) {
        if (batch) await put(D(`/bean-batches/${batch.id}`), { archived: true });
        const others = (await j(D(`/beans/${id}/batches?includeArchived=false`)).catch(() => [])).filter((x) => x.id !== batch?.id && !x.archived);
        if (!others.length) { await put(D(`/beans/${id}`), { archived: true }); await patchRecord(id, { finished: true }); }
      }
      if (patch.finished === false) { await put(D(`/beans/${id}`), { archived: false }); await patchRecord(id, { finished: false }); }
    },
    pinBest: (id, shotId) => patchRecord(id, { bestShotId: shotId }),

    async recommend(beanId, opts = {}) {
      const [{ info, batch, rec: read }, titles, prefs] = await Promise.all([coffee(beanId, opts.batchId), installedTitles(), api.prefs.get()]);
      const history = (await batchShots(batch?.id, 15)).map(E.toPastShot);
      let out = null, aiFailed = false;
      if (!opts.rulesOnly && aiOn()) {
        try { out = await cremaCall(() => post(C("/api/recommend"), { bean: info, profileTitles: titles, history, preferences: prefs }, { timeoutMs: AI_WAIT.recommend })); }
        catch { aiFailed = true; }
      }
      if (!out) {
        const ranked = E.rankProfiles(info, prefs, titles);
        out = { recipe: E.rulesRecipe({ bean: info, preferences: prefs, profileTitles: titles }, ranked), candidates: ranked.slice(0, 8).map(E.strip), source: aiFailed ? "rules (AI unavailable)" : "rules" };
      }
      // Never recommend a profile the machine doesn't have: with no installed match there
      // is no recipe, and the app asks you to pick one of the installed profiles.
      const installed = new Set(titles.map((t) => t.toLowerCase()));
      if (out.recipe && !installed.has(out.recipe.profileTitle.toLowerCase())) out = { ...out, recipe: null, source: "none" };
      await patchRecord(beanId, (fresh) => E.recommendPatch(fresh, { recipe: out.recipe, source: out.source, info, batchId: batch?.id ?? null }, read));
      return out;
    },
    // Preferences change what's recommended. Drop the saved recipe of every coffee except the
    // one named (it is worked out again at once), so each is recomputed the next time it is
    // picked, instead of coming back from Decaid's store with the old answer.
    async resetRecipes(exceptBeanId = null) {
      const beans = await j(D("/beans?includeArchived=true"));
      await Promise.all(beans.filter((b) => b.id !== exceptBeanId).map(async (b) => {
        await patchRecord(b.id, (fresh) => (fresh?.recipe ? { recipe: null, recipeSource: null } : null));
      }));
    },
    async rank(beanId) {
      const [{ info }, titles, prefs] = await Promise.all([coffee(beanId), installedTitles(), api.prefs.get()]);
      return E.rankProfiles(info, prefs, titles).map(E.strip);
    },
    async catalog() {
      const installed = await installedTitles().then((t) => new Set(t.map((x) => x.toLowerCase()))).catch(() => null);
      return E.CATALOG.map((p) => ({ ...p, installed: installed ? installed.has(p.title.toLowerCase()) : null }));
    },
    // The profiles installed in Decaid (espresso ones), with Crema's guide entry where
    // the catalogue knows the profile. This is the library; the catalogue only adds notes.
    async library() {
      const guide = new Map(E.CATALOG.map((p) => [p.title.toLowerCase(), p]));
      return (await j(D("/profiles?visibility=visible"))).filter((p) => (p.profile.beverage_type ?? "espresso") === "espresso" || manualKind(p.profile)).map((p) => ({
        id: p.id, title: p.profile.title, author: p.profile.author || "", notes: p.profile.notes || "",
        steps: p.profile.steps?.length ?? 0, targetWeight: p.profile.target_weight == null ? null : Number(p.profile.target_weight),
        tempC: p.profile.steps?.[0]?.temperature == null ? null : Number(p.profile.steps[0].temperature),
        manual: manualKind(p.profile), profileShape: brewProfileShape(p.profile), profile: p.profile,
        guide: guide.get(p.profile.title.toLowerCase()) ?? null,
      }));
    },
    async apply(beanId, recipe, grinderSetting, batchId = null) {
      const [bean, profiles] = await Promise.all([beanId ? coffee(beanId, batchId) : null, j(D("/profiles?visibility=visible"))]);
      // By id when the recipe has one (two installed profiles can share a title), else by title.
      const profile = recipe.profileId ? profiles.find((p) => p.id === recipe.profileId) : profiles.find((p) => p.profile.title === recipe.profileTitle);
      if (!profile) throw new Error(`The profile "${recipe.profileTitle}" isn't on the machine`);
      if ((profile.profile.beverage_type ?? "espresso") !== "espresso" && !manualKind(profile.profile)) throw new Error("Choose an espresso or supported manual profile");
      if (manualKind(profile.profile) && (await api.machine.info()).GHC !== true) throw new Error("Manual brewing needs a connected group-head controller");
      if (![recipe.doseG, recipe.yieldG, recipe.tempC].every((v) => typeof v === "number" && Number.isFinite(v)) || recipe.doseG <= 0 || recipe.yieldG < 0) throw new Error("Check the dose, yield and temperature");
      return put(D("/workflow"), {
        profile: E.withTemperature({ ...profile.profile, target_weight: recipe.yieldG }, recipe.tempC),
        context: { targetDoseWeight: recipe.doseG, targetYield: recipe.yieldG, targetWaterVolume: manualKind(profile.profile) ? 0 : null, beanBatchId: bean?.batch?.id ?? null, coffeeName: bean?.info.name.value ?? null, coffeeRoaster: bean?.info.roaster.value ?? null, grinderSetting: grinderSetting || null },
      });
    },

    // One page of history, with each shot's measurements for its chart.
    async shotPage(offset = 0, limit = 20) {
      const page = await j(D(`/shots?limit=${Math.min(limit, SHOT_PAGE)}&offset=${offset}`));
      const items = await Promise.all((page?.items ?? []).map(async (s) => {
        const full = await fullShot(s.id).catch(() => null);
        return toShot(full ?? s, full);
      }));
      return { items, total: page?.total ?? items.length };
    },
    async shots(limit = 15) { return (await api.shotPage(0, limit)).items; },
    // The newest shot (of the last page of summaries) pulled with a profile, in full: its
    // recorded steps time the profile's graph. Summaries carry the profile, not samples.
    async lastShotWith(title, profileShape = null) {
      const items = (await j(D(`/shots?limit=${SHOT_PAGE}&offset=0`)))?.items ?? [];
      const matches = items.find((s) => (s.workflow?.profile?.title ?? s.workflow?.name) === title && (!profileShape || brewProfileShape(s.workflow?.profile) === profileShape));
      return matches ? api.shot(matches.id) : null;
    },
    // One shot by id (a reference shot can be older than any page loaded), or null.
    async shot(id) { const full = await fullShot(id); return full ? toShot(full, full) : null; },
    async latestShot() { const s = await j(D("/shots/latest")).catch((e) => { if (e.status === 404) return null; throw e; }); return s?.id ? api.shot(s.id) : null; },
    async annotate(id, a) {
      const pending = (annotationWrites.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
        let patch = a;
        if (a.extras) {
          const full = await j(D(`/shots/${encodeURIComponent(id)}`));
          const current = full.annotations?.extras ?? {};
          const extras = { ...current, ...a.extras, ...(a.extras.crema ? { crema: { ...(current.crema ?? {}), ...a.extras.crema } } : {}) };
          patch = { ...a, extras };
        }
        return put(D(`/shots/${encodeURIComponent(id)}`), { annotations: patch });
      });
      annotationWrites.set(id, pending);
      try { return await pending; }
      finally { if (annotationWrites.get(id) === pending) annotationWrites.delete(id); }
    },
    // `bean` is the coffee's record (info) from the caller's shelf, for the model's context.
    async review(shotId, feedback = null, bean = null) {
      await annotationWrites.get(shotId);
      const full = await j(D(`/shots/${encodeURIComponent(shotId)}`));
      const recorded = shotPoints(full);
      const points = recorded.length <= 1800 ? recorded : Array.from({ length: 1800 }, (_, i) => recorded[Math.round(i * (recorded.length - 1) / 1799)]);
      const ctx = full.workflow?.context ?? {};
      const profile = full.workflow?.profile ?? null;
      const batchId = ctx.beanBatchId ?? null;
      const installed = await api.library().then((items) => items.map((p) => p.title)).catch(() => []);
      const history = batchId ? (await batchShots(batchId, 10)).filter((s) => s.id !== shotId && Date.parse(s.timestamp) < Date.parse(full.timestamp)).map((s) => {
        const saved = s.annotations?.extras?.crema?.review;
        return { timestamp: s.timestamp, profileTitle: s.workflow?.profile?.title, doseG: s.annotations?.actualDoseWeight ?? s.workflow?.context?.targetDoseWeight, yieldG: s.annotations?.actualYield, enjoyment: s.annotations?.enjoyment, notes: s.annotations?.espressoNotes?.slice(0, 500), review: (saved?.review?.summary ?? saved?.summary)?.slice(0, 1000) };
      }).slice(0, 10) : [];
      const targetYieldG = optionalNumber(ctx.targetYield ?? profile?.target_weight);
      const targetTimeS = full.annotations?.extras?.crema?.targetTimeS ?? ctx.targetTimeS ?? null;
      const input = {
        points, profile, doseG: full.annotations?.actualDoseWeight ?? ctx.targetDoseWeight ?? null,
        yieldG: full.annotations?.actualYield ?? (points.at(-1)?.w ?? null), targetYieldG,
        targetTimeS: Array.isArray(targetTimeS) && targetTimeS.length === 2 ? targetTimeS : null,
        stopReason: full.stopReason ?? full.annotations?.stopReason ?? ctx.stopReason ?? null,
        feedback, notes: full.annotations?.espressoNotes?.slice(0, 1000) ?? null, bean: bean ?? null, installedProfiles: installed, history,
      };
      let result = null;
      if (aiOn() && points.length) {
        try { result = await cremaCall(() => post(C("/api/review"), input, { timeoutMs: AI_WAIT.review })); }
        catch (e) { console.warn("AI shot review failed; using the rules review", e); }
      }
      if (!result?.review) result = { review: E.rulesReview(input), source: "rules" };
      const saved = { version: 1, review: result.review, source: result.source || "rules", createdAt: new Date().toISOString() };
      const crema = { review: saved };
      if (feedback) { crema.sourBitter = feedback.sourBitter; crema.body = feedback.body; }
      await api.annotate(shotId, { extras: { crema } });
      return saved;
    },
    async feedback(shotId, beanId, fb, batchId = null) {
      const full = await j(D(`/shots/${encodeURIComponent(shotId)}`));
      await api.annotate(shotId, { ...(fb.enjoyment != null ? { enjoyment: fb.enjoyment } : {}), ...(fb.notes != null ? { espressoNotes: fb.notes } : {}), extras: { crema: { sourBitter: fb.sourBitter, body: fb.body } } });
      const [{ info, batch }, rec] = await Promise.all([coffee(beanId, batchId), recordOf(beanId)]);
      const shot = E.toPastShot(full);
      const fallback = rec?.recipe ?? E.rulesRecipe({ bean: info });
      const recordedProfile = full.workflow?.profile;
      const sameProfile = recordedProfile?.title === fallback.profileTitle;
      const recipe = recordedProfile ? {
        ...fallback, profileTitle: recordedProfile.title, profileId: null,
        doseG: full.annotations?.actualDoseWeight ?? full.workflow?.context?.targetDoseWeight ?? fallback.doseG,
        yieldG: full.workflow?.context?.targetYield ?? fallback.yieldG,
        tempC: Number.isFinite(Number(recordedProfile.steps?.[0]?.temperature)) ? Number(recordedProfile.steps[0].temperature) : fallback.tempC,
        targetTimeS: sameProfile ? fallback.targetTimeS : [0, 600],
      } : fallback;
      if (aiOn()) {
        try {
          const history = (await batchShots(batch?.id, 10)).map(E.toPastShot);
          const { advice, source } = await cremaCall(() => post(C("/api/dialin"), { bean: info, recipe, shot, feedback: fb, history }, { timeoutMs: AI_WAIT.dialin }));
          return { advice, source: source || "ai" };
        } catch {}
      }
      return { advice: E.rulesDialIn(fb, shot, recipe), source: "rules" };
    },

    prefs: { get: () => kvGet("preferences", {}), set: async (p) => { const next = { ...(await kvGet("preferences", {})), ...p }; await kvSet("preferences", next); return next; } },
    favourites: {
      get: async () => { const f = await kvGet("favourites", []); return Array.isArray(f) ? f.map((x) => x ?? null) : []; },
      set: async (slot, fav) => {
        const f = await api.favourites.get();
        // A null slot adds against a fresh read, so a stale phone doesn't overwrite
        // a favourite another device just added. Keep legacy empty slots and indices.
        const empty = f.findIndex((x) => x == null);
        f[slot ?? (empty < 0 ? f.length : empty)] = fav;
        await kvSet("favourites", f); return f;
      },
    },
    presets: { get: () => kvGet("presets", E.DEFAULT_PRESETS), set: async (p) => { await kvSet("presets", p); return p; } },
    maintenance: {
      async get() {
        const m = { ...E.DEFAULT_MAINTENANCE, ...(await kvGet("maintenance", {})) };
        let shotsSinceBackflush = null; // unknown if the shots can't be read
        try {
          const since = m.lastBackflush ? Date.parse(m.lastBackflush) : 0;
          shotsSinceBackflush = (await shotSummaries({ since })).filter((s) => isEspresso(s.workflow?.profile?.title ?? s.workflow?.name)).length;
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
      // Decaid 0.9.1 passes skipStep to the DE1 (move on to the next profile step).
      // Read at source only; not yet run against a real machine (UI plan, decision 4).
      skipStep: () => j(D("/machine/state/skipStep"), { method: "PUT" }),
      tare: () => j(D("/scale/tare"), { method: "PUT" }),
      workflowSettings: { get: async () => pickSettings(await j(D("/workflow"))), set: (p) => put(D("/workflow"), pickSettings(p)) },
      // What the machine holds now, in the next-shot panel's terms. Decaid has no
      // stream or revision for the workflow, so the app re-reads it (reconcileWorkflow).
      async recipe() {
        const w = await j(D("/workflow")), c = w.context ?? {};
        const n = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
        return {
          profileTitle: w.profile?.title ?? null,
          profileShape: brewProfileShape(w.profile), manual: manualKind(w.profile),
          coffeeName: c.coffeeName ?? null, coffeeRoaster: c.coffeeRoaster ?? null,
          doseG: n(c.targetDoseWeight ?? w.doseData?.doseIn),
          yieldG: n(c.targetYield ?? w.doseData?.doseOut ?? w.profile?.target_weight),
          tempC: n(w.profile?.steps?.[0]?.temperature),
          grind: String(c.grinderSetting ?? w.grinderData?.setting ?? ""),
          batchId: c.beanBatchId ?? null,
          profile: w.profile ?? null, // its steps name what pour mode shows
        };
      },
      settings: { get: () => j(D("/machine/settings")), set: (p) => post(D("/machine/settings"), p) },
      // `mm` is already validated and clamped by the settings view.
      waterThreshold: (mm) => post(D("/machine/waterLevels"), { refillLevel: mm }),
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
    // One slot per stream, each holding at most one socket. A replacement opens only
    // after the old socket is closed and its handlers detached, so a discarded socket
    // can't deliver frames twice or report a disconnect that isn't real. A closed
    // socket reconnects with backoff and jitter (1 s growing to 15 s), reset once a
    // connection has stayed up 5 s. Returns { close, reopenMachine }. Approach from
    // Streamline's socket-slot.js, reimplemented here.
    subscribe(h) {
      let closed = false;
      const slots = [];
      const detach = (ws) => { if (!ws) return; ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; try { ws.close(); } catch {} };
      const open = (path, fn, onLost) => {
        const slot = { path, ws: null, tries: 0, timer: null };
        const retry = () => {
          if (closed) return;
          clearTimeout(slot.timer);
          const wait = Math.min(15000, 1000 * 1.6 ** slot.tries++) * (0.7 + Math.random() * 0.3);
          slot.timer = setTimeout(connect, wait);
        };
        const connect = () => {
          if (closed) return;
          detach(slot.ws); slot.ws = null;
          let ws;
          try { ws = new WebSocket(wsBase + path); } catch { return retry(); }
          slot.ws = ws;
          let stable = null;
          ws.onopen = () => { stable = setTimeout(() => (slot.tries = 0), 5000); };
          ws.onmessage = (e) => { try { fn(JSON.parse(e.data)); } catch {} };
          ws.onclose = () => { clearTimeout(stable); if (slot.ws !== ws) return; slot.ws = null; onLost?.(); retry(); };
        };
        slot.reopen = () => { clearTimeout(slot.timer); slot.tries = 0; connect(); };
        slot.close = () => { clearTimeout(slot.timer); detach(slot.ws); slot.ws = null; };
        slots.push(slot);
        connect();
      };
      // A shot that was running when the socket dropped may end before it comes back, so the
      // first snapshot that isn't espresso after a reconnect is the end of that shot.
      let track = { prev: null, across: false };
      open("/ws/v1/machine/snapshot", (s) => {
        const frame = E.socketFrame(track, s.state?.state);
        if (frame.finished) s.finished = "latest";
        track = frame.track; h.snapshot?.(s);
      }, () => { track = E.socketLost(track); h.lost?.("machine"); });
      open("/ws/v1/scale/snapshot", (s) => h.scale?.(s.status ? { connected: s.status === "connected" } : { connected: true, weight: s.weight, batteryLevel: s.batteryLevel }));
      open("/ws/v1/machine/waterLevels", (s) => h.water?.(s));
      open("/ws/v1/plugins/time-to-ready.reaplugin/timeToReady", (s) => h.ready?.(s));
      // Machine link state. A Decaid without this stream leaves it unknown, and
      // the app behaves as it did before.
      let devicesSeen = false;
      open("/ws/v1/devices", (d) => { devicesSeen = true; h.devices?.(d); }, () => h.lost?.("devices"));
      j(D("/devices")).then((d) => !devicesSeen && h.devices?.(d)).catch(() => {});
      return {
        close() { closed = true; slots.forEach((s) => s.close()); },
        // Reopen the machine-bound sockets, for a Decaid that doesn't re-attach them.
        reopenMachine() { slots.filter((s) => s.path.startsWith("/ws/v1/machine/")).forEach((s) => s.reopen()); },
      };
    },
  };
  return api;
}

/* ================= app state ================= */
const S = {
  api: null,
  newRows: new Map(), // shelf rows that appeared recently with no recipe yet (E.trackNewRows)
  snap: null, scale: { connected: false, weight: null }, water: null, ready: null,
  streams: null, // subscribe()'s handle: { close, reopenMachine }
  recommending: null, // id of the coffee whose recipe is being worked out
  shelf: [], shelfLoaded: false, shelfError: null, current: null, next: null, loaded: false, heldLoad: false,
  noBag: local.get("current", null) === NO_BAG, machineInfo: null, loadedRecipe: null,
  link: { connected: null, error: null }, // from Decaid's ws/v1/devices; null until it says
  prefs: {}, favourites: [], presets: null, maint: null,
  appSettings: null, // S.api.settings, once read
  live: [], ghost: null, lastShotId: null, opStart: 0, opKind: null, starting: null,
  catalog: null, ranking: null, ghc: local.get("ghc", false), saver: local.get("saver", true),
  shots: [], selShot: null, cmpShot: null, reviewPending: new Set(), afterViewToken: 0,
};

/* ================= chart ================= */
function drawChart(canvas, pts, o = {}) {
  const { maxT = 40, maxW = 50, compact = false, ghost = null, targets = true, plan = null, weightAxis = true, ahead = null, shade = null, endLabels = false } = o;
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
      if (weightAxis) { ctx.textAlign = "left"; ctx.fillText(String(Math.round((v / 12) * maxW)), W - pad.r + 6, yB(v) + 4); }
    }
    ctx.textAlign = "center";
    const step = maxT > 60 ? 20 : 10;
    for (let t = 0; t <= maxT; t += step) ctx.fillText(`${t}s`, x(t), H - 5);
  }
  const line = (data, key, color, y, width, { alpha = 1, dash = null } = {}) => {
    if (!data?.length || !data.some((d) => d[key] != null && Number.isFinite(Number(d[key])))) return;
    ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = "round";
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    let drawing = false;
    data.forEach((d) => {
      if (d[key] == null || !Number.isFinite(Number(d[key]))) { drawing = false; return; }
      if (drawing) ctx.lineTo(x(d.t), y(d[key])); else { ctx.moveTo(x(d.t), y(d[key])); drawing = true; }
    });
    ctx.stroke(); ctx.restore();
  };
  // The profile's plan (E.profileCurve), dashed: pressure and flow targets, each only
  // for the steps that drive it, the temperature, and faint lines where steps change.
  // Pour mode passes `ahead` (now, in s): the plan is drawn only after it, behind a
  // "now" line, and `shade` ([start, end] in s) marks the step being poured.
  if (plan && !compact) {
    ctx.save(); ctx.beginPath(); ctx.rect(pad.l, 0, iw, H); ctx.clip();
    ctx.strokeStyle = css("--line"); ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
    for (const st of plan.steps.slice(1)) if (st.end > st.start && st.start > 0) { ctx.beginPath(); ctx.moveTo(x(st.start), pad.t); ctx.lineTo(x(st.start), pad.t + ih); ctx.stroke(); }
    if (shade && shade[1] > shade[0]) { ctx.globalAlpha = .1; ctx.fillStyle = css("--accent"); ctx.fillRect(x(shade[0]), pad.t, x(shade[1]) - x(shade[0]), ih); ctx.globalAlpha = 1; }
    if (ahead != null) { ctx.beginPath(); ctx.rect(x(ahead), 0, W, H); ctx.clip(); }
    const planLine = (key, color, y, width, alpha) => {
      ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash([5, 4]); ctx.lineJoin = "round"; ctx.beginPath();
      let down = false;
      for (const d of plan.points) {
        if (d[key] == null) { down = false; continue; }
        if (down) ctx.lineTo(x(d.t), y(d[key])); else { ctx.moveTo(x(d.t), y(d[key])); down = true; }
      }
      ctx.stroke(); ctx.restore();
    };
    planLine("temp", css("--temp"), yT, 1.2, .55);
    planLine("tp", css("--pressure"), yB, 1.8, .85);
    planLine("tf", css("--flow"), yB, 1.8, .85);
    ctx.restore();
    if (ahead != null) { ctx.save(); ctx.strokeStyle = css("--muted"); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x(ahead), pad.t); ctx.lineTo(x(ahead), pad.t + ih); ctx.stroke(); ctx.restore(); }
    if (!pts.length) {
      const used = [];
      ctx.font = `${css("--t-xs")} ${css("--font-mono")}`; ctx.textAlign = "left";
      for (const [key, color, y, title, unit] of [["tp", "--pressure", yB, "pressure ", " bar"], ["tf", "--flow", yB, "flow ", " ml/s"], ["temp", "--temp", yT, "", " °C"]]) {
        const point = plan.points.find((p) => p[key] != null && p.t > 0 && p.t <= maxT);
        if (!point) continue;
        const label = `${title}${fmtC(point[key])}${unit}`, width = ctx.measureText(label).width;
        if (width > iw) continue;
        const yy = clamp(y(point[key]) - 6, pad.t + 12, H - pad.b - 4), xx = Math.min(x(point.t) + 6, W - pad.r - width);
        if (used.some((r) => Math.abs(r.y - yy) < 16 && xx < r.x + r.w && xx + width > r.x)) continue;
        ctx.fillStyle = css("--surface"); ctx.fillRect(xx - 2, yy - 11, width + 4, 14);
        ctx.fillStyle = css(color); ctx.fillText(label, xx, yy); used.push({ x: xx, y: yy, w: width });
      }
    }
  }
  if (ghost?.length) {
    line(ghost, "p", css("--pressure"), yB, 1.5, { alpha: .25 });
    line(ghost, "f", css("--flow"), yB, 1.5, { alpha: .25 });
    line(ghost, "w", css("--weight"), yW, 1.5, { alpha: .25 });
  }
  if (pts.length && !compact && pts.some((d) => d.w != null)) {
    const weights = pts.filter((d) => d.w != null);
    ctx.globalAlpha = .12; ctx.fillStyle = css("--weight"); ctx.beginPath();
    ctx.moveTo(x(weights[0].t), yW(0)); weights.forEach((d) => ctx.lineTo(x(d.t), yW(d.w))); ctx.lineTo(x(weights.at(-1).t), yW(0)); ctx.fill(); ctx.globalAlpha = 1;
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
    const e = [...pts].reverse().find((d) => d.p != null || d.f != null || d.w != null);
    if (!e) return;
    for (const [k, c, y] of [["p", "--pressure", yB], ["f", "--flow", yB], ["w", "--weight", yW]]) {
      if (e?.[k] == null) continue;
      ctx.fillStyle = css(c); ctx.beginPath(); ctx.arc(x(e.t), y(e[k]), 3.5, 0, Math.PI * 2); ctx.fill();
    }
    // Pour mode: each line's value at its end, in place of a legend.
    if (endLabels) {
      const items = [["p", "--pressure", yB, " bar"], ["f", "--flow", yB, " ml/s"], ["w", "--weight", yW, " g"], ["temp", "--temp", yT, " °C"]]
        .filter(([k]) => e[k] != null && Number.isFinite(Number(e[k])))
        .map(([k, c, y, u]) => ({ text: `${fmt1(e[k])}${u}`, c, y: y(e[k]) + 4 }))
        .sort((a, b) => a.y - b.y);
      for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < 14) items[i].y = items[i - 1].y + 14;
      ctx.font = `${css("--t-xs")} ${css("--font-mono")}`; ctx.textAlign = "left";
      for (const it of items) {
        const width = ctx.measureText(it.text).width;
        let xx = x(e.t) + 8;
        if (xx + width > W - pad.r) xx = x(e.t) - 8 - width;
        const yy = clamp(it.y, pad.t + 10, H - pad.b);
        ctx.fillStyle = css("--surface"); ctx.fillRect(xx - 2, yy - 11, width + 4, 14);
        ctx.fillStyle = css(it.c); ctx.fillText(it.text, xx, yy);
      }
    }
  }
}
// Who chose a recipe, in words for the person at the machine; the provider id belongs in Settings.
function pickLabel(src) { return src === "rules" ? "Rules pick" : src === "saved" ? "Saved pick" : "AI pick"; }
// brief: Brew's own legend leaves out the line names, which the readouts above already carry.
function legendHtml(withGhost, withPlan = false, removable = false, brief = false) {
  const item = (c, t, dash) => `<span><span class="swatch" style="background:var(${c})${dash ? ";opacity:.6" : ""}"></span>${t}</span>`;
  return [...(brief ? [] : [item("--pressure", "Pressure (bar)"), item("--flow", "Flow (ml/s)"), item("--weight", "Weight (g, right)"), item("--temp", "Temp (70–100 °C)")]),
    `<span class="muted">${withPlan ? "Dashed: the profile" : "Dashed: targets"}</span>`,
    withGhost ? `<span class="muted">Faint: reference shot${removable ? ' <button type="button" class="linkish" id="clearRef">Remove</button>' : ""}</span>` : ""].join("");
}

/* ================= bag art + rest ================= */
function artSrc(b) {
  const product = b.productImage || b.info?.imageUrl;
  return b.art === "photo" ? b.photo || product : product || b.photo;
}
function bagArt(b, size = "") {
  const src = artSrc(b), initial = esc((b.info?.name?.value || "?").trim()[0]);
  // A picture that fails to load (a link that has since died) falls back to the initial tile.
  if (src) return `<div class="bag ${size}"><img src="${esc(src)}" alt="" loading="lazy" data-initial="${initial}" onerror="artFailed(this)"></div>`;
  return `<div class="bag ${size}" style="background:#c99a6b"><span class="initial">${initial}</span></div>`;
}
function artFailed(img) {
  const bag = img.parentNode; if (!bag) return;
  bag.style.background = "#c99a6b";
  bag.innerHTML = `<span class="initial">${esc(img.dataset.initial || "?")}</span>`;
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
const STATE_LABEL = { idle: "Ready", sleeping: "Asleep", heating: "Warming up", preheating: "Preheating", espresso: "Espresso", steam: "Steaming", hotWater: "Hot water", flush: "Flushing", steamRinse: "Purging steam", cleaning: "Cleaning", descaling: "Descaling", needsWater: "Refill the tank", error: "Error", booting: "Starting", transportMode: "Transport mode", fwUpgrade: "Updating firmware" };
/* ================= machine link (Decaid's ws/v1/devices) ================= */
// Decaid can stay up while its DE1 drops off Bluetooth or is power-cycled. Its
// machine sockets then stay open but go quiet, so a last reading isn't proof of a
// link; Decaid's device list is. The first message sets the baseline; only later
// changes count as the machine dropping or coming back (a power cycle keeps the
// same device id, so watch the state, not the id). Approach from Streamline's
// machine-link.js, reimplemented here.
const unlinked = () => S.link.connected === false;
function machineConnectedIn(payload) {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.devices) ? payload.devices : null;
  if (!list) return null; // a frame without a device list says nothing about the link
  return list.some((d) => d?.type === "machine" && d.state === "connected");
}
function onDevices(payload) {
  const now = machineConnectedIn(payload), was = S.link.connected;
  if (now != null) S.link.connected = now;
  if (payload && !Array.isArray(payload) && payload.connectionStatus) {
    const err = payload.connectionStatus.error ?? null;
    // Scale problems are a passing note, once per event; the rest stay as banners.
    if (err && /^scale/.test(err.kind) && err.timestamp !== S.link.error?.timestamp) toast(err.suggestion ? `${err.message} ${err.suggestion}` : err.message);
    S.link.error = err;
  }
  if (was === true && now === false) S.loaded = false; // what the machine holds is unknown until it's back
  if (was === false && now === true) { toast("The machine is connected again"); reconcileWorkflow(); }
  renderStatus(); renderAlerts(); renderControls();
  if (!$("#view-brew").hidden) { renderReadouts(); renderNextShot(); renderLive(); }
}

function renderStatus() {
  const s = unlinked() ? null : S.snap, st = s?.state?.state || "unknown";
  const busy = ["espresso", "steam", "hotWater", "flush"].includes(st);
  const pouring = shotRunning();
  const linkLost = pouring && (!s || S.shotAcross);
  const tank = S.water ? clamp(((S.water.currentLevel - S.water.refillLevel) / Math.max(1, 58 - S.water.refillLevel)) * 100, 0, 100) : null;
  const low = S.water && S.water.currentLevel <= S.water.refillLevel;
  const readyTxt = st === "heating" && S.ready?.remainingTimeMs ? ` · ready in ${Math.max(1, Math.round(S.ready.remainingTimeMs / 60000))} min` : "";
  const stateTxt = linkLost ? "No link, still pouring" : pouring ? "Pouring" : s ? (STATE_LABEL[st] || st) : unlinked() ? "Machine disconnected" : "Machine offline";
  patchHtml($("#status"), `
    <span class="chip"><span class="dot ${linkLost ? "warn" : !s ? "bad" : busy || pouring ? "live" : st === "sleeping" ? "" : st === "heating" ? "warn" : st === "needsWater" || st === "error" ? "bad" : "ok"}"></span>${esc(stateTxt)}${esc(readyTxt)}${S.api?.demo ? ' <span class="muted">· simulated</span>' : ""}</span>
    <span class="chip"><span class="muted">Group</span><span class="num">${fmt1(s?.groupTemperature ?? s?.mixTemperature)}°</span></span>
    <span class="chip"><span class="muted">Steam</span><span class="num">${s?.steamTemperature != null ? Math.round(s.steamTemperature) : "–"}°</span></span>
    ${S.water ? `<span class="chip ${low ? "bad" : ""}" title="Water tank"><span class="muted">Water</span><span class="tank ${low ? "low" : ""}"><div style="width:${tank}%"></div></span></span>` : ""}
    <span class="chip" id="scaleChip">${S.scale.connected ? `<span class="muted">Scale</span><span class="num">${fmt1(S.scale.weight)} g</span>${S.scale.batteryLevel != null ? `<span class="muted small">${S.scale.batteryLevel}%</span>` : ""}` : '<span class="muted">No scale</span>'}</span>
    ${aiDown() ? '<a class="chip warn" href="#settings" title="Using the rules until the Crema server answers">AI offline</a>' : ""}
    ${S.maint && (S.maint.backflushDue || S.maint.descaleDue) ? `<a class="chip warn" href="#settings">${S.maint.backflushDue ? "Backflush due" : "Descale due"}</a>` : ""}`);

  const asleep = st === "sleeping";
  $("#railSleepLabel").textContent = $("#phoneSleepLabel").textContent = asleep ? "Wake" : "Sleep";
}
// AI is switched on but the Crema server can't be reached: the rules are standing in.
const aiDown = () => !!(S.api && !S.api.demo && S.api.ai.enabled && (S.api.info.serverError || (S.api.ai.available && !S.api.ai.healthy)));
function renderAlerts() {
  const st = S.snap?.state?.state;
  const a = [];
  if (st === "error" && !unlinked()) a.push(`<div class="banner bad"><span><b>The machine reports an error.</b> Check the machine, or open Decaid for details.</span>${S.api.host?.canExit ? '<button class="btn small" data-exit-dash>Open Decaid</button>' : ""}</div>`);
  if (st === "needsWater") a.push(`<div class="banner bad"><span><b>Refill the water tank.</b> The machine stops until it has water.</span>${S.api.demo ? '<button class="btn small" id="refillBtn">Refill (demo)</button>' : ""}</div>`);
  const err = S.link.error;
  const exit = S.api.host?.canExit ? '<button class="btn small" data-exit-dash>Open Decaid</button>' : "";
  if (unlinked()) {
    a.push(`<div class="banner bad"><span><b>The machine isn't connected.</b> Decaid is running but can't reach the DE1. Check it's switched on, or reconnect it in Decaid.</span>${exit}</div>`);
  } else if (!S.snap && !S.api.demo) a.push(`<div class="banner bad"><span><b>Can't reach the machine.</b> Check that Decaid is running on the tablet and on the same network.</span></div>`);
  if (err?.kind === "profileUploadFailed") a.push(`<div class="banner warn"><span><b>The recipe hasn't reached the machine yet.</b> Decaid is trying again. Wait before pulling a shot.</span></div>`);
  else if (err && !/^(scale|machine)/.test(err.kind) && err.severity === "error") a.push(`<div class="banner bad"><span><b>${esc(err.message)}</b>${err.suggestion ? ` ${esc(err.suggestion)}` : ""}</span>${exit}</div>`);
  $("#alerts").innerHTML = a.join("");
  $$("[data-exit-dash]").forEach((b) => (b.onclick = exitToDashboard));
  const r = $("#refillBtn"); if (r) r.onclick = () => S.api.machine.refill();
}
async function tare() {
  try { await S.api.machine.tare(); toast("Scale tared"); } catch (e) { toast(`Couldn't tare: ${e.message}`); }
}

/* ================= next shot (brew home, left) ================= */
function saveBrewChoice() {
  if (S.noBag) local.set("baglessRecipe", S.next);
}
// Grind start and step are shared settings, so every device steps the same grinder alike.
// A coffee with no grind saved yet starts at the start value, so the stepper always has
// a number to move and nobody needs the keyboard.
function grindSettings() {
  const st = { ...E.DEFAULT_SETTINGS, ...S.appSettings };
  const start = Number(st.grindStart), stepBy = Number(st.grindStep);
  return { start: Number.isFinite(start) ? start : E.DEFAULT_SETTINGS.grindStart, step: Number.isFinite(stepBy) && stepBy > 0 ? stepBy : E.DEFAULT_SETTINGS.grindStep };
}
const savedGrind = (beanId) => local.get(`grind:${beanId ?? "bagless"}`, "") || String(grindSettings().start);
function setNextFromRecipe(bean, recipe) {
  const r = recipe || bean?.recipe;
  S.next = r ? { beanId: bean?.id ?? null, profileTitle: r.profileTitle, profileId: r.profileId ?? null, profileShape: r.profileShape ?? null, direct: r.direct ?? false, manual: r.manual ?? null, doseG: r.doseG, yieldG: r.yieldG, tempC: r.tempC, targetTimeS: r.manual ? null : r.targetTimeS, grind: savedGrind(bean?.id) } : null;
  S.loaded = false;
  saveBrewChoice();
}
function coffeePicker() {
  openSheet(`<h2>Coffee</h2><div class="stack"><button class="btn" id="chooseNoBag">No bag</button>${S.shelf.map((b) => `<button class="btn" data-choose-bag="${esc(b.key)}">${esc(b.info.name.value)}${b.bags > 1 ? ` · Bag ${b.bagNo}` : ""}</button>`).join("")}<a class="btn ghost" href="#add" onclick="closeSheet()">Add coffee</a></div>`);
  $("#chooseNoBag").onclick = () => { closeSheet(); selectBean(NO_BAG); };
  $$("[data-choose-bag]").forEach((el) => el.onclick = () => { closeSheet(); selectBean(el.dataset.chooseBag); });
}
function renderNextShot() {
  renderFavs();
  void refreshPlan();
  const el = $("#nextShot"), b = S.current, n = S.next;
  if (!b && !S.noBag && !S.shelfLoaded) { el.innerHTML = `<p class="muted">Loading your coffees…</p>`; return; }
  if (!b && !S.noBag) {
    el.innerHTML = S.shelfError
      ? `<h2>Couldn't load your coffees</h2><p class="muted">Decaid didn't answer (${esc(S.shelfError)}).</p><button class="btn" id="retryShelf">Try again</button>`
      : `<h2>No coffee yet</h2><p class="muted">Add a bag for recommendations, or brew straight from a profile.</p><a class="btn primary" href="#add">Add coffee</a>`;
    el.insertAdjacentHTML("beforeend", `<button class="btn" id="noBagBrew">Brew without a bag</button>`);
    if ($("#retryShelf")) $("#retryShelf").onclick = retryShelf;
    $("#noBagBrew").onclick = () => selectBean(NO_BAG);
    return;
  }
  const r = b?.recipe, i = b?.info, rest = b ? restOf(i) : null;
  const ratio = n?.yieldG > 0 && n?.doseG > 0 ? (n.yieldG / n.doseG).toFixed(1) : null;
  el.innerHTML = `
    <div class="coffee-line ${b ? "" : "bagless"}">${b ? bagArt(b) : ""}<button class="coffee-choice" id="coffeeChoice"><span class="label">${b ? esc(i.roaster.value) : "Coffee"}</span><span class="coffee-name">${b ? esc(i.name.value) : "No bag"} ›</span></button>
      <div class="coffee-meta">${b ? `<span class="pill ${rest.status}">${rest.days != null ? `Day ${rest.days} · ` : ""}${rest.label}${b.bags > 1 ? ` · Bag ${b.bagNo}` : ""}</span>` : `<span class="muted small">${S.loaded ? "Shots saved without a coffee" : "Load a profile to brew without a bag"}</span>`}
      ${b && S.shelf.length > 1 ? `<div class="cycler"><button class="btn icon-only small" id="prevBean" aria-label="Previous coffee">‹</button><button class="btn icon-only small" id="nextBean" aria-label="Next coffee">›</button></div>` : ""}</div>
    </div>
    ${n ? `
    <div class="field-row first"><span class="label">Profile</span><button class="profile-btn" id="profileBtn"><span style="min-width:0"><span class="t">${esc(n.profileTitle)}</span><br><span class="muted small pick-src">${esc(n.manual ? `Adjust ${n.manual} on the group-head controller` : n.fromMachine ? "As set on the machine" : n.direct ? "Selected from installed profiles" : b?.recipeSource ? pickLabel(b.recipeSource) : "Selected from installed profiles")}</span></span><span>›</span></button></div>
    <div class="field-row"><span class="label">Dose</span>${stepper("dose", `${fmt1(n.doseG)}<small>grams in</small>`)}</div>
    <div class="field-row"><span class="label">Yield</span>${n.manual || S.noBag ? `<div class="stepper"><button type="button" data-step="yield:-1" aria-label="Less">−</button><button type="button" class="val stop-choice" id="stopMode">${n.yieldG > 0 ? fmt1(n.yieldG) : "Off"}<small>${n.yieldG > 0 ? "Tap for manual stop" : "Tap to set weight"}</small></button><button type="button" data-step="yield:1" aria-label="More">+</button></div>` : stepper("yield", `${fmt1(n.yieldG)}<small>1:${ratio}${S.scale.connected ? " · auto-stop" : ""}</small>`)}</div>
    <div class="field-row"><span class="label">Temp</span>${stepper("temp", `${fmt1(n.tempC)}<small>°C first step</small>`)}</div>
    <div class="field-row"><span class="label">Grind</span><div class="stepper"><button type="button" data-step="grind:-1" aria-label="Finer">−</button><input id="grindInput" inputmode="decimal" value="${esc(n.grind)}" placeholder="setting" aria-label="Grinder setting"><button type="button" data-step="grind:1" aria-label="Coarser">+</button></div></div>
    <div class="row"><button class="btn ${S.loaded ? "" : "primary"} grow" id="loadBtn">${S.heldLoad ? "Loads after this shot" : S.loaded ? "Loaded ✓" : "Load onto machine"}</button><button class="btn ghost" id="resetRecipe">Reset</button></div>
    ${r && !n.direct && !n.manual ? `<details><summary>Why this profile and how to dial it in</summary><div class="stack" style="gap:8px"><ul class="why">${(r.rationale || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>${r.dialIn ? `<div class="advice small">${esc(r.dialIn)}</div>` : ""}<div class="muted small">Target ${r.targetTimeS?.join("–") ?? "–"} s · ${esc(r.grindHint || "")}</div></div></details>` : ""}
    ` : `<p class="muted">${S.noBag ? "Choose an installed profile. No bag or recommendation needed." : b.recipeSource === "none" ? "There is no recommendation for this coffee. Choose an installed profile." : "Working out a recipe…"}</p><a class="btn primary" href="#profiles">Choose a profile</a>`}`;
  $("#coffeeChoice").onclick = coffeePicker;
  if ($("#prevBean")) {
    const idx = S.shelf.findIndex((x) => x.key === b.key), go = (d) => selectBean(S.shelf[(idx + d + S.shelf.length) % S.shelf.length].key);
    $("#prevBean").onclick = () => go(-1); $("#nextBean").onclick = () => go(1);
  }
  if (!n) return;
  $("#profileBtn").onclick = () => (location.hash = "#profiles");
  $$("[data-step]", el).forEach((btn) => (btn.onclick = () => step(btn.dataset.step)));
  $("#grindInput").onchange = (e) => { n.grind = e.target.value.trim(); local.set(`grind:${b?.id ?? "bagless"}`, n.grind); S.loaded = false; saveBrewChoice(); renderNextShot(); };
  $("#loadBtn").onclick = () => loadOntoMachine();
  $("#resetRecipe").onclick = () => n.direct ? chooseInstalledProfile(S.library?.find((p) => p.id === n.profileId), S.noBag) : (setNextFromRecipe(b), renderNextShot());
  const stopMode = $("#stopMode");
  if (stopMode) stopMode.onclick = () => {
    if (n.yieldG > 0) { n.lastYieldG = n.yieldG; n.yieldG = 0; S.loaded = false; saveBrewChoice(); renderNextShot(); renderControls(); }
    else {
      openSheet(`<h2>Stop at weight</h2><p class="muted">Requires a connected scale. Profile time limits still apply. Manual-profile scale stopping still needs a supervised check on your machine.</p><div class="field"><label for="weightTarget">Grams out</label><input type="number" min="1" id="weightTarget" value="${n.lastYieldG ?? ""}"></div><button class="btn primary" id="saveWeight">Set target</button>`);
      $("#saveWeight").onclick = () => { const v = Number($("#weightTarget").value); if (!Number.isFinite(v) || v <= 0 || v > 1000) return toast("Enter a weight between 1 and 1000 g"); n.yieldG = v; S.loaded = false; saveBrewChoice(); closeSheet(); renderNextShot(); renderControls(); };
    }
  };
}
function stepper(key, valHtml) {
  return `<div class="stepper"><button type="button" data-step="${key}:-1" aria-label="Less">−</button><div class="val">${valHtml}</div><button type="button" data-step="${key}:1" aria-label="More">+</button></div>`;
}
function step(spec) {
  const [key, dir] = spec.split(":"); const d = Number(dir), n = S.next;
  if (key === "dose") n.doseG = clamp(round(n.doseG + d * 0.5, 0.5), 5, 30);
  if (key === "yield") n.yieldG = clamp(round(n.yieldG + d, 0.5), n.direct || n.manual ? 0 : 10, 1000);
  if (key === "temp") n.tempC = clamp(round(n.tempC + d * 0.5, 0.5), 60, 100);
  if (key === "grind") {
    // Empty or not a number (a note like "2.3 turns"): start from the start value.
    const g = grindSettings(), v = parseFloat(n.grind);
    n.grind = String(Number.isFinite(v) ? +(v + d * g.step).toFixed(3) : g.start);
    local.set(`grind:${n.beanId ?? "bagless"}`, n.grind);
  }
  S.loaded = false; saveBrewChoice(); renderNextShot(); renderControls();
}
// Writing the workflow sends its profile to the machine at once, and Decaid doesn't
// wait for a shot to finish: the DE1 runs its steps by index from that table, so a
// write mid-shot replaces the steps it's pouring (Streamline's profile-send-gate
// notes, Decaid's workflow_device_sync). So during espresso the load is held, and
// sent when the shot ends. It reads S.next then, so the latest choice wins. Only
// espresso runs profile steps; steam, hot water and flush don't.
// Also true while the machine socket is down after it dropped mid-shot: the DE1 keeps
// pouring, so the profile must not be written until a snapshot shows the shot is over.
const shotRunning = () => E.shotRunning(S.snap?.state?.state, S.shotAcross);
// Loads run one at a time. A load reads the screen when its turn comes, so the
// latest choice wins, and one queued behind another is skipped if that one already
// left the recipe on the machine (Espresso pressed during a manual load waits for it
// instead of writing twice).
let loadChain = Promise.resolve(), loadsPending = 0;
function loadOntoMachine(silent = false) {
  if (!S.next) return Promise.resolve(false);
  const queued = loadsPending > 0;
  loadsPending++;
  const run = loadChain.then(() => loadNow(silent, queued)).finally(() => { loadsPending--; });
  loadChain = run.catch(() => {});
  return run;
}
async function loadNow(silent, queued) {
  const n = S.next, b = S.current;
  if (!n) return false;
  const decision = E.loadDecision({ shotRunning: shotRunning(), queued, loaded: S.loaded });
  if (decision === "hold") {
    S.heldLoad = true; renderNextShot();
    if (!silent) toast("Loads when this shot ends");
    return "held";
  }
  if (decision === "skip") return true;
  S.heldLoad = false;
  wfWrites++;
  const draft = JSON.stringify(n);
  const recipe = { ...(b?.recipe || {}), ...n, targetTimeS: n.manual ? null : n.targetTimeS ?? null };
  try {
    const workflow = await S.api.apply(b?.id ?? null, recipe, n.grind || undefined, b?.batch ?? null);
    S.loadedRecipe = { ...recipe, profileShape: workflow?.profile ? brewProfileShape(workflow.profile) : recipe.profileShape, batchId: b?.batch ?? null, profile: workflow?.profile ?? null };
    wfWrites++;
    S.loaded = S.next === n && S.current === b && JSON.stringify(n) === draft;
    if (S.loaded) { n.profileShape = S.loadedRecipe.profileShape; saveBrewChoice(); }
    renderNextShot();
    if (!silent) toast(`Loaded ${n.profileTitle}: ${n.doseG} g → ${n.yieldG} g at ${n.tempC} °C`);
    return S.loaded;
  } catch (e) { toast(`Couldn't load the recipe: ${e.message}`); return false; }
}
/* ================= the machine's recipe vs the screen ================= */
// Decaid publishes no workflow stream and no revision, so a change made elsewhere
// (another skin, the phone, Decaid itself, or Decaid restoring after a restart) is
// invisible until the workflow is read again. reconcileWorkflow reads it on boot,
// when the page comes back into view, on link-up, every minute while visible, and
// before an espresso start, and compares only what the next-shot panel shows.
//   - It matches: the recipe is on the machine (S.loaded).
//   - It differs and the panel had unsaved edits: keep them; a start loads them.
//   - It differs and the panel matched the machine (an outside change): if the
//     machine's recipe is recorded for this bag, take its values, label them as set on
//     the machine, and say so. Otherwise (another coffee's bag, or no bag recorded,
//     which is what Streamline and Decaid's defaults leave) keep this coffee's recipe
//     and mark it not loaded, so a start loads it. Nothing is written back.
//   - Before a start (adopt: false): never take the machine's values; a difference
//     only clears S.loaded, so the start loads what the screen shows.
// A read that began before one of our own writes finished is dropped, so it can't
// undo that write. Approach from Streamline's workflow-watch.js, reimplemented here.
let wfWrites = 0, wfReading = null;
// near, sameGrind and recipeMatches live in server/control/workflow.ts (E.recipeMatches).
function reconcileWorkflow({ adopt = true, boot = false } = {}) {
  if (!S.api?.machine.recipe || shotRunning() || unlinked()) return Promise.resolve(null);
  if (wfReading) return wfReading;
  const writesBefore = wfWrites, choiceBefore = JSON.stringify(S.next);
  const timeout = new Promise((_, no) => setTimeout(() => no(new Error("timed out")), 4000));
  wfReading = Promise.race([S.api.machine.recipe(), timeout]).then(async (m) => {
    if (writesBefore !== wfWrites || !m || !S.next) return null;
    const outcome = E.reconcileOutcome({ machine: m, next: S.next, noBag: S.noBag, currentBatch: S.current?.batch, loaded: S.loaded, adopt, boot, editedDuringRead: choiceBefore !== JSON.stringify(S.next) });
    if (outcome.kind === "same") {
      if (outcome.markLoaded) { S.loaded = true; renderNextShot(); }
      return "same";
    }
    S.loaded = false;
    if (outcome.kind === "differs") { renderNextShot(); return "differs"; }
    if (outcome.kind === "other") { toast("The machine has another recipe, set elsewhere. Starting here loads this one"); renderNextShot(); return "other"; }
    let profileId = S.next.profileId;
    if (outcome.lookupProfile) {
      const nextBefore = S.next, choice = JSON.stringify(S.next), beanBefore = S.current;
      const library = await S.api.library().catch(() => []);
      if (writesBefore !== wfWrites || shotRunning() || S.next !== nextBefore || S.current !== beanBefore || JSON.stringify(S.next) !== choice) return null;
      profileId = library.find((p) => p.profileShape === m.profileShape)?.id ?? "unlisted-workflow-profile";
    }
    // A different profile than the recommendation's: its time window no longer applies (adoptPatch).
    Object.assign(S.next, E.adoptPatch(m, S.next, profileId, S.current?.recipe?.profileTitle));
    if (m.grind) local.set(`grind:${S.current?.id ?? "bagless"}`, m.grind);
    saveBrewChoice();
    S.loaded = E.recipeMatches(m, S.next);
    renderNextShot();
    if (!boot) toast(`Recipe changed elsewhere: ${m.profileTitle}, ${fmtC(S.next.doseG)} → ${fmtC(S.next.yieldG)} g`);
    return "adopted";
  }).catch(() => null).finally(() => { wfReading = null; });
  return wfReading;
}

// Shelf rows are bags: `key` picks one; a coffee id (from a favourite, or saved before
// bags) picks that coffee's first bag.
async function selectBean(key, opts = {}) {
  if (key === NO_BAG) {
    S.noBag = true; S.current = null; local.set("current", NO_BAG);
    S.next = local.get("baglessRecipe", null); S.loaded = false; S.ghost = null;
    if (S.next && !S.next.grind) S.next.grind = savedGrind(null);
    renderNextShot(); renderLive(); renderControls(); return;
  }
  S.noBag = false;
  S.current = S.shelf.find((b) => b.key === key) || S.shelf.find((b) => b.id === key) || S.shelf[0] || null;
  local.set("current", S.current?.key);
  if (S.current && !S.current.recipe) {
    const b = S.current;
    S.recommending = b.id;
    renderNextShot();
    if (!$("#view-profiles").hidden) renderProfiles();
    try {
      // Added on another device a moment ago: its recipe is probably being worked out
      // there. Wait for it (up to ~30 s) rather than ask the AI a second time.
      // A shelf read replaces the rows (only the current one is merged in place), so look at the fresh row, not `b`.
      const fresh = () => S.shelf.find((x) => x.key === b.key);
      for (let i = 0; i < 10 && fresh() && !fresh().recipe && E.waitingForRecipe(S.newRows, b.key, Date.now()); i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const previous = S.shelf.map((x) => x.key);
        await refreshShelf().catch(() => {});
        S.newRows = E.trackNewRows(S.newRows, previous, S.shelf, Date.now());
      }
      const row = fresh();
      if (row?.recipe) sameCoffee(b.id, (x) => { x.recipe = row.recipe; x.recipeSource = row.recipeSource; });
      else if (row) { const out = await S.api.recommend(b.id, { batchId: b.batch }); sameCoffee(b.id, (x) => { x.recipe = out.recipe; x.recipeSource = out.source; }); }
    } catch (e) { toast(`Couldn't get a recipe: ${e.message}`); }
    finally { if (S.recommending === b.id) S.recommending = null; }
    // Profiles may have been drawn while waiting (Add sends you there first).
    if (!$("#view-profiles").hidden && S.current === b) renderProfiles();
  }
  if (S.noBag) return;
  setNextFromRecipe(S.current);
  S.ghost = null;
  await loadGhost();
  renderNextShot(); renderLive(); renderControls();
  if (!opts.quiet && S.current) toast(`Now brewing ${S.current.info.name.value}`);
}
async function loadGhost() {
  const b = S.current;
  if (!b?.bestShotId) { S.ghost = null; return; }
  // Fetched by id: the reference can be older than any page of history loaded.
  S.ghost = (S.shots.find((s) => s.id === b.bestShotId) || (await S.api.shot(b.bestShotId).catch(() => null)))?.points || null;
}
// A coffee's reference shot (shared by its bags) is optional: `shotId` null removes it.
async function setReference(bean, shotId, points = null) {
  if (!bean) return;
  try { await S.api.pinBest(bean.id, shotId); } catch (e) { toast(`Couldn't save the reference: ${e.message}`); return false; }
  sameCoffee(bean.id, (x) => (x.bestShotId = shotId));
  if (S.current?.id === bean.id) { if (points && shotId) S.ghost = points; else await loadGhost(); }
  renderLive();
  toast(shotId ? "Set as the reference shot for this coffee" : "Reference shot removed");
  return true;
}

/* ================= the profile's plan ================= */
// What the next shot's profile asks for, drawn dashed before a shot. Its steps come
// from the installed profile; their timing from the newest shot pulled with it (shots
// record which step was running), else each step's time limit.
function nextProfile() {
  const n = S.next;
  if (!n || !S.library) return null;
  return (n.profileId && S.library.find((p) => p.id === n.profileId)) || S.library.find((p) => p.title === n.profileTitle) || null;
}
// How much of a plan to show: all of it when timed from a shot; limits can add up to
// minutes, so cap those.
const planWindow = (plan, cap = 60) => plan.timed === "shot" ? plan.total : Math.min(plan.total, cap);
const planTimes = new Map();
function planTiming(lp) {
  if (!lp?.profile?.steps?.length || !S.api.lastShotWith) return Promise.resolve(null);
  const key = `${lp.id ?? lp.title}|${lp.profileShape ?? brewProfileShape(lp.profile)}`;
  if (!planTimes.has(key)) planTimes.set(key, S.api.lastShotWith(lp.title, lp.profileShape ?? brewProfileShape(lp.profile)).then((shot) => {
    const durations = shot ? E.stepDurations(shot.points || [], lp.profile.steps.length) : null;
    return durations ? { durations, shot } : null;
  }, () => null));
  return planTimes.get(key);
}
function planBody(lp, tempC) {
  return lp?.profile && tempC != null ? E.withTemperature(lp.profile, tempC) : lp?.profile;
}
let planFor = null;
async function refreshPlan() {
  if (!S.library && !S.libraryLoading) S.libraryLoading = S.api.library().then((l) => { S.library = l; renderFavs(); return l; }, () => null).finally(() => (S.libraryLoading = null));
  if (!S.library) await S.libraryLoading;
  const lp = nextProfile(), tempC = S.next?.tempC;
  const key = lp ? `${lp.id}|${tempC}` : null;
  if (key !== planFor) { planFor = key; S.plan = lp ? E.profileCurve(planBody(lp, tempC)) : null; if (!$("#view-brew").hidden) renderLive(); }
  const timing = await planTiming(lp);
  if (timing && planFor === key && S.plan?.timed !== "shot") { S.plan = E.profileCurve(planBody(lp, tempC), timing.durations); if (!$("#view-brew").hidden) renderLive(); }
}

/* ================= favourites ================= */
const FAV_UI = { editing: false, saving: false, loading: false, bound: false, selectedSlot: null };
function favouriteRecipe() {
  const n = S.next;
  return { noBag: S.noBag, profileId: n.profileId ?? null, profileShape: n.profileShape ?? null, manual: n.manual ?? null, direct: !!n.direct, targetTimeS: n.targetTimeS ?? null };
}
function favouriteSelected(f) {
  const n = S.next;
  return !!n && (f.noBag !== true || S.noBag) && (!f.beanId || f.beanId === S.current?.id)
    && (f.profileId && n.profileId ? f.profileId === n.profileId : f.profileTitle === n.profileTitle)
    && (!f.profileShape || !n.profileShape || f.profileShape === n.profileShape)
    && f.doseG === n.doseG && f.yieldG === n.yieldG && f.tempC === n.tempC
    && E.sameGrind(f.grinderSetting || savedGrind(S.current?.id), n.grind);
}
function favouriteScroll(left, smooth = true) {
  const list = $("#favs");
  list.scrollTo({ left, behavior: smooth && !matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "instant" });
}
function favouriteStops() {
  const list = $("#favs"), max = Math.max(0, list.scrollWidth - list.clientWidth);
  return [...new Set([0, ...[...list.children].map((b) => Math.min(max, b.offsetLeft)), max])].sort((a, b) => a - b);
}
function moveFavourites(dir) {
  const left = $("#favs").scrollLeft, stops = favouriteStops();
  favouriteScroll(dir > 0 ? stops.find((x) => x > left + 2) ?? stops.at(-1) : stops.findLast((x) => x < left - 2) ?? 0);
}
function updateFavouriteNav() {
  const list = $("#favs"), max = list.scrollWidth - list.clientWidth;
  $("#favPrev").disabled = list.scrollLeft <= 1;
  $("#favNext").disabled = list.scrollLeft >= max - 1;
}
function bindFavouriteCarousel() {
  if (FAV_UI.bound) return;
  FAV_UI.bound = true;
  const list = $("#favs");
  $("#favPrev").onclick = () => moveFavourites(-1);
  $("#favNext").onclick = () => moveFavourites(1);
  list.addEventListener("scroll", updateFavouriteNav, { passive: true });
  new ResizeObserver(updateFavouriteNav).observe(list);
  list.addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const buttons = [...list.children], i = Math.max(0, buttons.indexOf(document.activeElement));
    const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : clamp(i + (e.key === "ArrowRight" ? 1 : -1), 0, buttons.length - 1);
    buttons[next]?.focus({ preventScroll: true }); favouriteScroll(buttons[next]?.offsetLeft ?? 0);
  });
  list.addEventListener("focusin", (e) => {
    const b = e.target.closest("button");
    if (b && (b.offsetLeft < list.scrollLeft || b.offsetLeft + b.offsetWidth > list.scrollLeft + list.clientWidth)) favouriteScroll(b.offsetLeft);
  });
  // Touch uses native pan and CSS snapping. Mouse dragging gets the same card
  // navigation; cancel the resulting click so a swipe never loads a recipe.
  let drag = null, ignoreClickUntil = 0;
  list.addEventListener("pointerdown", (e) => {
    if (e.button === 0) drag = { id: e.pointerId, mouse: e.pointerType === "mouse", x: e.clientX, y: e.clientY, left: list.scrollLeft, moved: false };
  });
  list.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(e.clientY - drag.y)) drag.moved = true;
    if (drag.mouse && drag.moved) {
      list.setPointerCapture(e.pointerId); list.style.scrollSnapType = "none";
      list.scrollLeft = drag.left - dx; e.preventDefault();
    }
  });
  const finish = (e) => {
    if (!drag) return;
    if (drag.moved) ignoreClickUntil = performance.now() + 400;
    if (drag.mouse && drag.moved) {
      const stops = favouriteStops(), dx = e.clientX - drag.x;
      const start = stops.reduce((a, b) => Math.abs(a - drag.left) < Math.abs(b - drag.left) ? a : b);
      const target = Math.abs(dx) > 35
        ? (dx < 0 ? stops.find((x) => x > start + 2) ?? stops.at(-1) : stops.findLast((x) => x < start - 2) ?? 0)
        : stops.reduce((a, b) => Math.abs(a - list.scrollLeft) < Math.abs(b - list.scrollLeft) ? a : b);
      list.style.removeProperty("scroll-snap-type"); favouriteScroll(target);
      if (list.hasPointerCapture(drag.id)) list.releasePointerCapture(drag.id);
    }
    drag = null;
  };
  list.addEventListener("pointerup", finish); list.addEventListener("pointercancel", finish);
  list.addEventListener("click", (e) => {
    if (performance.now() < ignoreClickUntil) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
}
function favouriteArt(f) {
  const bean = f.beanId && S.shelf.find((b) => b.id === f.beanId), src = bean && artSrc(bean);
  return `<span class="fav-art" aria-hidden="true">${src ? `<img src="${esc(src)}" alt="">` : esc(bean?.info?.name?.value?.[0] || "·")}</span>`;
}
function favouriteSpark(f) {
  const lp = S.library?.find((p) => f.profileId ? p.id === f.profileId : p.title === f.profileTitle);
  const plan = lp && E.profileCurve(lp.profile);
  const points = plan?.points.filter((p) => p.tp != null);
  if (!points?.length || !plan.total) return "";
  return `<svg class="fav-spark" viewBox="0 0 80 24" aria-hidden="true"><polyline points="${points.map((p) => `${p.t / plan.total * 80},${23 - clamp(p.tp, 0, 12) / 12 * 22}`).join(" ")}"/></svg>`;
}
function renderFavs(revealSlot) {
  bindFavouriteCarousel();
  const list = $("#favs"), left = list.scrollLeft, busy = FAV_UI.saving || FAV_UI.loading;
  const chosen = FAV_UI.selectedSlot;
  const selected = chosen != null && S.favourites[chosen] && favouriteSelected(S.favourites[chosen])
    ? chosen : S.favourites.findIndex((f) => f && favouriteSelected(f));
  patchHtml(list, S.favourites.map((f, i) => f ? `<button class="fav" id="fav-${i}" ${FAV_UI.editing ? `data-favedit="${i}"` : `data-fav="${i}" aria-pressed="${i === selected}"`} title="${esc(f.name)} · ${esc(f.profileTitle)}" aria-label="${FAV_UI.editing ? "Edit" : "Load"} favourite ${esc(f.name)}" ${busy ? "disabled" : ""}>
    ${favouriteArt(f)}<strong>${esc(f.name)}</strong><span class="fav-profile">${esc(f.profileTitle)}</span>${FAV_UI.editing ? '<span class="fav-action">Rename, replace or clear</span>' : `<span class="num fav-recipe">${fmtC(f.doseG)} → ${f.yieldG > 0 ? `${fmtC(f.yieldG)} g` : "manual"}<span class="fav-temp"> · ${fmtC(f.tempC)}°</span></span>`}${favouriteSpark(f)}</button>` : "").join("")
    + `<button class="fav empty" id="addFav" ${busy || !S.next ? "disabled" : ""}><span class="fav-plus" aria-hidden="true">+</span><strong>Save current recipe</strong><span class="fav-profile">${S.next ? esc(S.current?.info.name.value || S.next.profileTitle) : "Choose a recipe first"}</span></button>`);
  favouriteScroll(left, false);
  $("#editFavs").textContent = FAV_UI.editing ? "Done" : "Edit";
  $("#editFavs").setAttribute("aria-pressed", String(FAV_UI.editing));
  $("#editFavs").disabled = busy || (!FAV_UI.editing && !S.favourites.some(Boolean));
  $("#editFavs").onclick = () => { FAV_UI.editing = !FAV_UI.editing; renderFavs(); };
  $("#addFav").onclick = () => saveFavourite();
  $$("[data-fav]", list).forEach((b) => (b.onclick = () => useFav(Number(b.dataset.fav))));
  $$("[data-favedit]", list).forEach((b) => (b.onclick = () => editFav(Number(b.dataset.favedit))));
  if (revealSlot != null) favouriteScroll($(`#fav-${revealSlot}`)?.offsetLeft ?? left);
  requestAnimationFrame(updateFavouriteNav);
}
async function writeFavourite(slot, fav, action) {
  if (FAV_UI.saving) return null;
  FAV_UI.saving = true; renderFavs();
  try {
    const saved = await attempt(action, () => S.api.favourites.set(slot, fav));
    if (saved) S.favourites = saved;
    return saved;
  } finally { FAV_UI.saving = false; renderFavs(); }
}
async function saveFavourite(slot = null) {
  if (!S.next || FAV_UI.saving) return;
  const name = (S.current?.info.name.value || S.next.profileTitle).slice(0, 40);
  const fav = { ...favouriteRecipe(), name, profileTitle: S.next.profileTitle, doseG: S.next.doseG, yieldG: S.next.yieldG, tempC: S.next.tempC, beanId: S.current?.id ?? null, grinderSetting: S.next.grind || null };
  const saved = await writeFavourite(slot, fav, "save the favourite");
  if (saved) { FAV_UI.selectedSlot = saved.indexOf(fav); renderFavs(FAV_UI.selectedSlot); toast(`Saved "${name}" to favourites`); }
}
async function useFav(i) {
  const f = S.favourites[i];
  if (!f) return saveFavourite(i);
  if (FAV_UI.loading || FAV_UI.saving) return;
  FAV_UI.selectedSlot = i;
  FAV_UI.loading = true; renderFavs();
  try { await attempt("load the favourite", async () => {
  if (f.noBag === true) await selectBean(NO_BAG, { quiet: true });
  if (f.beanId && f.beanId !== S.current?.id && S.shelf.some((b) => b.id === f.beanId)) await selectBean(f.beanId, { quiet: true });
  if (f.beanId && !S.shelf.some((b) => b.id === f.beanId)) return toast("That favourite's coffee is no longer on the shelf");
  S.next = { ...S.next, beanId: S.current?.id ?? null, profileTitle: f.profileTitle, profileId: f.profileId ?? null, profileShape: f.profileShape ?? null, manual: f.manual ?? null, direct: f.direct ?? false, targetTimeS: f.targetTimeS ?? null, doseG: f.doseG, yieldG: f.yieldG, tempC: f.tempC, grind: f.grinderSetting || savedGrind(S.current?.id) };
  S.loaded = false; saveBrewChoice();
  renderNextShot();
  const loaded = await loadOntoMachine(true);
  if (loaded === "held") toast(`"${f.name}" loads when this shot ends`);
  else if (loaded) toast(`Loaded favourite "${f.name}"`);
  }); } finally { FAV_UI.loading = false; renderFavs(); }
}
function editFav(i) {
  const f = S.favourites[i];
  if (!f) return;
  openSheet(`<h2>Edit favourite</h2>
    <div class="field"><label class="label" for="favName">Name</label><input type="text" id="favName" value="${esc(f.name)}" maxlength="40"></div>
    <p class="muted small">${esc(f.profileTitle)} · ${fmt1(f.doseG)} g → ${fmt1(f.yieldG)} g · ${fmt1(f.tempC)} °C${f.grinderSetting ? ` · grind ${esc(f.grinderSetting)}` : ""}</p>
    <div class="row"><button class="btn primary" id="favSave">Save name</button><button class="btn" id="favUpdate">Replace with current shot</button><button class="btn ghost" id="favClear">Clear slot</button></div>`);
  // The sheet stays open when the write fails, so the change can be tried again.
  const writeFav = async (what, fav) => {
    const saved = await writeFavourite(i, fav, what);
    if (saved) { S.favourites = saved; closeSheet(); renderFavs(); }
    return !!saved;
  };
  $("#favSave").onclick = () => writeFav("save the name", { ...f, name: $("#favName").value.trim() || f.name });
  $("#favUpdate").onclick = async () => {
    if (!S.next) return;
    if (await writeFav("update the favourite", { ...f, ...favouriteRecipe(), profileTitle: S.next.profileTitle, doseG: S.next.doseG, yieldG: S.next.yieldG, tempC: S.next.tempC, beanId: S.current?.id ?? null, grinderSetting: S.next.grind || null })) toast("Favourite updated");
  };
  $("#favClear").onclick = () => writeFav("clear the slot", null);
}

/* ================= machine controls (brew home, right) ================= */
function activeProfile() {
  return S.shotContext?.profile || S.loadedRecipe?.profile || (nextProfile() && planBody(nextProfile(), S.next?.tempC)) || null;
}
function skipStep() {
  if (!shotRunning()) return;
  return S.api.machine.skipStep().catch((e) => toast(`Couldn't skip the step: ${e.message}`));
}
function renderControls() {
  syncExitButton();
  const pouring = shotRunning() && location.hash !== "#shelf" && location.hash !== "#add" && location.hash !== "#profiles" && location.hash !== "#shots" && location.hash !== "#settings";
  document.body.classList.toggle("pouring", pouring);
  $("#pourTop").hidden = !pouring;
  $("#pourLeft").hidden = !pouring;
  const p = S.presets, st = S.snap?.state?.state;
  if (pouring) {
    const ctx = S.shotContext || S.loadedRecipe || S.next || {};
    const target = ctx.yieldG ?? S.next?.yieldG ?? 0;
    const prof = activeProfile();
    const steps = prof?.steps || [];
    const prog = E.stepProgress({ steps, points: S.live, targetYieldG: target, hasScale: S.scale.connected, manual: !!ctx.manual });
    const canSkip = !ctx.manual && steps.length > 1 && (prog.index == null || prog.index < steps.length - 1);
    const linkDown = unlinked() || !S.snap || S.shotAcross;
    const note = linkDown
      ? "No link, still pouring. Stop stays available."
      : target > 0 && S.scale.connected
        ? `At ${fmt1(target)} g on the scale. Changes you make now load when this shot ends.`
        : "Stops when the profile finishes or when you tap Stop. Changes you make now load when this shot ends.";
    patchHtml($("#controls"), `
      <div class="pour-note muted">${esc(note)}</div>
      <div class="stop-wrap">${canSkip ? `<button class="skip-btn" id="skipBtn" ${linkDown ? "disabled" : ""}>Skip step</button>` : ""}<button class="stop-btn active" id="stopBtn">STOP</button></div>`);
    const skip = $("#skipBtn"); if (skip) skip.onclick = skipStep;
    $("#stopBtn").onclick = stopMachine;
    return;
  }
  if (!p) {
    // Presets come from Decaid's key-value store; until they arrive, Stop is still here.
    $("#controls").innerHTML = `<div class="stop-wrap stack" style="gap:6px"><button class="stop-btn ${["espresso", "steam", "hotWater", "flush"].includes(st) ? "active" : ""}" id="stopBtn" ${S.snap ? "" : "disabled"}>STOP</button></div>`;
    $("#stopBtn").onclick = stopMachine;
    return;
  }
  const busy = ["espresso", "steam", "hotWater", "flush"].includes(st) || isStarting();
  const disabled = S.ghc || !S.snap || unlinked() || NOT_READY.includes(st);
  const sel = p.selected;
  const steam = p.steam[sel.steam] || p.steam[0], water = p.water[sel.water] || p.water[0], flush = p.flush[sel.flush] || p.flush[0];
  const split = (name, run, kind, preset, detail) => `<div class="ctl split-ctl"><button class="ctl-btn two-line" data-run="${run}" ${disabled || busy ? "disabled" : ""}>${name}<span class="sub">${esc(preset.label)} · ${detail}</span></button><button class="preset-open" data-presets="${kind}" aria-label="Choose ${name.toLowerCase()} preset" ${busy ? "disabled" : ""}>⌄</button></div>`;
  patchHtml($("#controls"), `
    <div class="ctl espresso-ctl"><button class="ctl-btn two-line ${st === "espresso" ? "" : "go"}" data-run="espresso" ${disabled || busy || !S.next ? "disabled" : ""}>Espresso<span class="sub">${S.ghc ? "Start at group head" : S.next ? `${fmtC(S.next.doseG)} → ${S.next.yieldG > 0 ? `${fmtC(S.next.yieldG)} g` : "manual stop"}${S.loaded ? "" : " · loads first"}` : "Choose a profile"}</span></button></div>
    ${split("Steam", "steam", "steam", steam, steam.seconds ? `${steam.seconds} s` : "until stopped")}
    ${split("Hot water", "hotWater", "water", water, `${water.ml} ml`)}
    ${split("Flush", "flush", "flush", flush, `${flush.seconds} s`)}
    <div class="ctl split-ctl scale-tile"><div class="scale-reading"><span class="num">${S.scale.connected ? `${fmt1(S.scale.weight)} g` : "No scale"}</span><span class="muted small">${S.scale.connected ? `Scale${S.scale.batteryLevel != null ? ` · ${S.scale.batteryLevel}%` : ""}` : "Connect a scale to tare"}</span></div><button class="preset-open" id="tareBtn" ${S.scale.connected ? "" : "disabled"}>Tare</button></div>
    <div class="stop-wrap"><button class="stop-btn ${busy ? "active" : ""}" id="stopBtn" ${S.snap || isStarting() ? "" : "disabled"}>STOP</button></div>`);
  $("#controls").title = S.ghc ? "Use the group head controller to start. Crema sets the recipe and presets." : "";
  $$("[data-run]").forEach((b) => (b.onclick = () => startOp(b.dataset.run)));
  $$("[data-presets]").forEach((b) => (b.onclick = () => openPresetSheet(b.dataset.presets)));
  $("#tareBtn").onclick = tare;
  $("#stopBtn").onclick = stopMachine;
}
function openPresetSheet(kind) {
  const title = { steam: "Steam", water: "Hot water", flush: "Flush" }[kind];
  openSheet(`<h2>${title} preset</h2><div class="stack">${S.presets[kind].map((p, i) => `<button class="btn preset-choice" data-preset="${kind}:${i}" aria-pressed="${S.presets.selected[kind] === i}"><span>${esc(p.label)}</span><span class="num">${kind === "water" ? `${p.ml} ml` : p.seconds ? `${p.seconds} s` : "Until stopped"}</span></button>`).join("")}</div>`);
  $$("[data-preset]").forEach((b) => (b.onclick = async () => {
    const [k, idx] = b.dataset.preset.split(":");
    S.presets.selected[k] = Number(idx); closeSheet(); renderControls();
    await S.api.presets.set(S.presets).catch(() => {});
    await pushPresetSettings(k).catch((e) => toast(`Couldn't update the machine: ${e.message}`));
  }));
}
// Ranges for the workflow's steam, hot water and flush fields. Decaid accepts any
// number (even a negative volume) and wants integers for temperatures, durations
// and volumes, so Crema keeps values inside these. From Decaid's rest_v1.yml: DE1
// steam 135–160 °C (lower means steam off), hot water flow 1–10 ml/s. From
// Streamline: steam flow at least 0.4, steam at most 255 s. The rest are Crema's
// own sanity limits.
const WF_LIMITS = {
  steamSettings: { targetTemperature: [135, 160, 1], duration: [1, 255, 1], flow: [0.4, 2.5, 0.1] },
  hotWaterData: { targetTemperature: [40, 100, 1], volume: [1, 255, 1], flow: [1, 10, 0.1] },
  rinseData: { targetTemperature: [20, 100, 1], duration: [1, 255, 1], flow: [1, 10, 0.1] },
};
function workflowPatch(group, field, value) {
  const [lo, hi, stepBy] = WF_LIMITS[group][field];
  const v = +clamp(round(Number(value), stepBy), lo, hi).toFixed(stepBy < 1 ? 1 : 0);
  if (!Number.isFinite(v)) throw new Error("that isn't a number");
  return { [group]: { [field]: v } };
}
const setWorkflowSetting = (group, field, value) => S.api.machine.workflowSettings.set(workflowPatch(group, field, value));
async function pushPresetSettings(kind) {
  const p = S.presets, sel = p.selected;
  if (kind === "steam") await setWorkflowSetting("steamSettings", "duration", p.steam[sel.steam].seconds || 255); // 0 = until stopped
  if (kind === "water") await setWorkflowSetting("hotWaterData", "volume", p.water[sel.water].ml);
  if (kind === "flush") await setWorkflowSetting("rinseData", "duration", p.flush[sel.flush].seconds);
}
// Starting can mean writing settings or loading the recipe before the start
// command. Each start takes a generation number and Stop moves it on, so a
// response that arrives after Stop can't start the machine. S.starting blocks a
// second start until the machine reports the first (or a few seconds pass).
// A start command is never retried.
let opGen = 0; // S.starting is { kind, until } while a start is under way
const isStarting = () => E.isStarting(S.starting, Date.now());
// The states in which nothing new should start (Stop is never blocked) are in server/control/start.ts.
const NOT_READY = E.NOT_READY;
async function startOp(kind) {
  const st = S.snap?.state?.state;
  const refused = E.startGate({ starting: S.starting, now: Date.now(), unlinked: unlinked(), state: st });
  if (refused) {
    if (refused.refuse === "unlinked") return toast("The machine isn't connected");
    if (refused.refuse === "running") return toast("Stop the current operation before starting another");
    if (refused.refuse === "notReady") return toast(`Not now: the machine says "${STATE_LABEL[st] || st}"`);
    return;
  }
  const gen = ++opGen, current = () => gen === opGen;
  S.starting = { kind, until: Infinity };
  renderControls();
  let sent = false;
  try {
    const steps = E.startSteps(kind, S.loaded);
    if (steps.reconcileFirst) await reconcileWorkflow({ adopt: false }); // still on the machine?
    if (!current()) return;
    if (E.startSteps(kind, S.loaded).loadFirst) { const ok = await loadOntoMachine(true); if (!ok) return; }
    if (steps.presets) await pushPresetSettings(steps.presets);
    if (!current()) return;
    await S.api.machine.setState(kind);
    sent = true;
    // Stop was pressed while the start command was on its way. The two requests
    // can reach the machine in either order, so stop again now that it has landed.
    if (E.afterStartSent(current()) === "stopAgain") { S.api.machine.setState("idle").catch(() => {}); return; }
    S.api.machine.heartbeat();
  } catch (e) {
    if (current()) toast(`Couldn't start: ${e.message}`);
  } finally {
    const settled = E.startSettled({ stillCurrent: current(), sent, kind, now: Date.now() });
    if (settled.update) {
      S.starting = settled.starting;
      if (settled.redrawLater) setTimeout(renderControls, 3100);
      renderControls();
    }
  }
}
function cancelStart() { opGen++; S.starting = null; }
// Leaving for Decaid's dashboard is blocked while Crema is starting something or the
// machine reports an operation (including cleaning and descaling, which Crema doesn't
// start). Any other state, or no reading at all, allows it: an offline machine is
// when Decaid's own screens are most useful.
const ACTIVE_STATES = ["espresso", "steam", "hotWater", "flush", "steamRinse", "cleaning", "descaling"];
// A machine that has dropped off isn't running anything we know of; its last state is stale.
const exitBlocked = () => isStarting() || (!unlinked() && ACTIVE_STATES.includes(S.snap?.state?.state));
function syncExitButton() { const b = $("#exitDash"); if (b) b.disabled = exitBlocked(); }
function exitToDashboard() {
  if (exitBlocked()) return toast("Stop the machine before leaving Crema");
  S.api.host.exitToDashboard();
}
function stopMachine() {
  cancelStart();
  renderControls();
  return S.api.machine.setState("idle").catch((e) => toast(`Couldn't stop: ${e.message}`));
}

/* ================= live panel + running overlay ================= */
const PHASE = { preinfusion: "Preinfusion", pouring: "Pouring", pouringDone: "Done", preparingForShot: "Preparing" };
function renderScaleTile() {
  const el = $(".scale-reading");
  if (el) { el.firstElementChild.textContent = S.scale.connected ? `${fmt1(S.scale.weight)} g` : "No scale"; el.lastElementChild.textContent = S.scale.connected ? `Scale${S.scale.batteryLevel != null ? ` · ${S.scale.batteryLevel}%` : ""}` : "Connect a scale to tare"; }
  const tareButton = $("#tareBtn"); if (tareButton) tareButton.disabled = !S.scale.connected;
}
// Shared with pour mode: descriptors are { name, detail, weight, state?, progress? }.
function stepsRailHtml(steps) {
  const minimum = steps.reduce((n, step) => n + (Number(step.weight) || 1), 0) * .08;
  return steps.map((step) => `<div class="step ${step.state === "now" ? "now" : step.state === "done" ? "done" : ""}" style="flex-grow:${Math.max(minimum, Number(step.weight) || 1)}"><strong>${esc(step.name)}</strong><span>${esc(step.detail)}</span>${step.progress != null ? `<progress max="1" value="${clamp(step.progress, 0, 1)}"></progress>` : ""}</div>`).join("");
}
function stepDetailText(step) {
  const tgt = step.target ? `${step.target.smooth ? "ramping to " : "holding "}${fmt1(step.target.value)} ${step.target.kind === "flow" ? "ml/s" : "bar"}` : "";
  if (step.state === "done") return `${fmt1(step.elapsedS ?? 0)} s`;
  if (step.state === "now") {
    const tr = step.tracking;
    const trTxt = !tr ? (step.limitS != null ? `${fmt1(step.elapsedS ?? 0)} of ${fmtC(step.limitS)} s` : `${fmt1(step.elapsedS ?? 0)} s`)
      : tr.kind === "time" ? `${fmt1(tr.value)} of ${fmtC(tr.goal)} s`
      : tr.kind === "weight" || tr.kind === "yield" ? `${fmt1(tr.value)} of ${fmt1(tr.goal)} g`
      : tr.kind === "volume" ? `${fmt1(tr.value)} of ${fmtC(tr.goal)} ml`
      : `${fmt1(tr.value)} → ${fmt1(tr.goal)} ${tr.kind.startsWith("pressure") ? "bar" : "ml/s"}`;
    return [trTxt, tgt].filter(Boolean).join(" · ");
  }
  return [step.limitS != null ? `${fmtC(step.limitS)} s` : "", step.target ? `${fmtC(step.target.value)} ${step.target.kind === "flow" ? "ml/s" : "bar"}` : ""].filter(Boolean).join(" · ");
}
function renderPour() {
  const ctx = S.shotContext || S.loadedRecipe || S.next || {};
  const target = ctx.yieldG ?? S.next?.yieldG ?? 0;
  const prof = activeProfile();
  const steps = prof?.steps || [];
  const prog = E.stepProgress({ steps, points: S.live, targetYieldG: target, weightFlow: S.scale.weightFlow ?? null, hasScale: S.scale.connected, manual: !!ctx.manual });
  const coffee = ctx.coffeeName || (!S.noBag && S.current?.info.name.value) || null;
  const dose = ctx.doseG ?? S.next?.doseG;
  const temp = ctx.tempC ?? S.next?.tempC;
  const grind = ctx.grind || S.next?.grind;
  $("#pourProfile").textContent = ctx.profileTitle || prof?.title || S.next?.profileTitle || "Espresso";
  $("#pourRecipe").textContent = [coffee, dose != null ? `${fmtC(dose)} → ${target > 0 ? `${fmtC(target)} g` : "manual"}` : null, temp != null ? `${fmtC(temp)} °C` : null, grind ? `grind ${grind}` : null].filter(Boolean).join(" · ");
  $("#pourStepCount").textContent = prog.count ? `Step ${(prog.index ?? 0) + 1} of ${prog.count}` : "";
  const rail = $("#pourSteps");
  rail.hidden = !prog.steps.length;
  patchHtml(rail, prog.steps.length ? stepsRailHtml(prog.steps.map((s) => ({
    name: s.name,
    detail: stepDetailText(s),
    weight: s.state === "now" ? Math.max(s.limitS || 8, 12) : s.state === "done" ? Math.max(s.elapsedS || 2, 3) : Math.max(s.limitS || 4, 4),
    state: s.state,
    progress: s.state === "now" ? (s.tracking?.progress ?? 0) : null,
  }))) : "");
  const last = S.live.at(-1);
  const t = last ? last.t : S.snap?.elapsed ?? 0;
  const w = S.scale.connected ? (S.scale.weight ?? last?.w ?? 0) : null;
  $("#pourTime").textContent = Number(t || 0).toFixed(1);
  $("#pourWeight").textContent = w == null ? "–" : fmt1(w);
  const yBox = $("#pourYield");
  yBox.hidden = prog.yieldFraction == null;
  if (prog.yieldFraction != null) {
    const pct = Math.round(prog.yieldFraction * 100);
    $("#pourYieldBar").style.width = `${clamp(pct, 0, 100)}%`;
    $("#pourYieldText").textContent = `${pct}% of ${fmt1(target)} g`;
    $("#pourEta").textContent = prog.etaS != null && prog.etaS > 0 ? `about ${Math.round(prog.etaS)} s to go` : "";
  }
  const s = (!unlinked() && S.snap) || last || {};
  const sub = [["Pressure", s.pressure ?? s.p, "bar", "--pressure"], ["Flow", s.flow ?? s.f, "ml/s", "--flow"], ["Temp", s.mixTemperature ?? s.temp, "°C", "--temp"]];
  patchHtml($("#pourSub"), sub.map(([k, v, u, c]) => `<div class="readout"><span class="k label"><span class="swatch" style="background:var(${c})"></span>${k}</span><span class="v">${v == null ? "–" : fmt1(v)}<small>${u}</small></span></div>`).join(""));
  const skip = $("#skipBtn");
  const canSkip = !ctx.manual && steps.length > 1 && (prog.index == null || prog.index < steps.length - 1);
  if (!!skip !== canSkip) renderControls();
  else if (skip) skip.disabled = unlinked() || !S.snap || S.shotAcross;
  const noteEl = $(".pour-note", $("#controls"));
  if (noteEl) {
    const linkDown = unlinked() || !S.snap || S.shotAcross;
    noteEl.textContent = linkDown
      ? "No link, still pouring. Stop stays available."
      : target > 0 && S.scale.connected
        ? `At ${fmt1(target)} g on the scale. Changes you make now load when this shot ends.`
        : "Stops when the profile finishes or when you tap Stop. Changes you make now load when this shot ends.";
  }
  return prog;
}
function renderReadouts() {
  const s = (!unlinked() && S.snap) || {};
  const w = S.scale.connected ? S.scale.weight : null;
  const items = [["Pressure", s.pressure, "bar", "--pressure"], ["Flow", s.flow, "ml/s", "--flow"], ["Weight", w, "g", "--weight"], ["Temp", s.mixTemperature, "°C", "--temp"]];
  if (s.state?.state === "steam") items.push(["Steam", s.steamTemperature, "°C", "--muted"]);
  $("#readouts").style.setProperty("--cols", items.length);
  patchHtml($("#readouts"), items.map(([k, v, u, c]) => `<div class="readout" ${k === "Weight" ? 'id="weightReadout"' : ""}><span class="k label"><span class="swatch" style="background:var(${c})"></span>${k}</span><span class="v">${v == null ? "–" : fmt1(v)}<small>${u}</small></span></div>`).join(""));
  $("#readouts").hidden = !shotRunning() && !["steam", "hotWater", "flush"].includes(s.state?.state) && !S.live.length;
  $("#shotClock").hidden = $("#readouts").hidden;
  renderScaleTile();
  if (shotRunning() && !$("#view-brew").hidden) renderPour();
}
function renderLive() {
  const target = (shotRunning() ? S.shotContext?.yieldG : null) ?? S.next?.yieldG ?? 36;
  const pts = S.live;
  const pouring = shotRunning();
  if (pouring) {
    const prog = renderPour();
    const prof = activeProfile();
    const rawSteps = prof?.steps || [];
    const { start, lastT } = E.stepTimes(pts, rawSteps.length);
    const nowT = lastT ?? (pts.at(-1)?.t ?? 0);
    const curIdx = prog.index ?? 0;
    const curStart = start[curIdx] ?? nowT;
    const durs = rawSteps.map((st, idx) => {
      const lim = Math.max(0, Number(st.seconds) || 0);
      if (idx < curIdx) return Math.max(0, (start[idx + 1] ?? curStart) - (start[idx] ?? 0));
      if (idx === curIdx) return Math.max(lim, nowT - curStart + 2);
      return lim;
    });
    const livePlan = rawSteps.length ? E.profileCurve(prof, durs) : S.plan;
    const curPlanStep = livePlan?.steps[curIdx];
    const shade = curPlanStep ? [curStart, Math.max(nowT, curPlanStep.end)] : null;
    const maxT = Math.max(40, Math.ceil(nowT / 10) * 10, S.ghost ? Math.ceil(S.ghost.at(-1).t / 10) * 10 : 0, livePlan ? Math.ceil(planWindow(livePlan) / 10) * 10 : 0);
    drawChart($("#liveChart"), pts, { maxT, maxW: Math.max(50, target + 10), ghost: S.ghost, plan: livePlan, targets: false, ahead: nowT, shade, endLabels: true });
    return;
  }
  // Before a shot the chart shows what the loaded profile asks for (S.plan); once one
  // starts, the machine's own targets take over.
  const plan = pts.length ? null : S.plan;
  const rail = $("#planSteps");
  rail.hidden = !plan;
  patchHtml(rail, plan ? stepsRailHtml(plan.steps.map((step) => ({ name: step.name, detail: `${fmtC(step.end - step.start)} s · ${fmtC(step.target)} ${step.pump === "flow" ? "ml/s" : "bar"}`, weight: step.end - step.start }))) : "");
  const maxT = Math.max(40, Math.ceil((pts.at(-1)?.t ?? 0) / 10) * 10, S.ghost ? Math.ceil(S.ghost.at(-1).t / 10) * 10 : 0, plan ? Math.ceil(planWindow(plan) / 10) * 10 : 0);
  drawChart($("#liveChart"), pts, { maxT, maxW: Math.max(50, target + 10), ghost: S.ghost, plan });
  const st = S.snap?.state?.state;
  const about = [plan ? `Dashed: what ${S.next.profileTitle} asks for, ${plan.timed === "shot" ? "timed from your last shot with it" : "each step at its time limit (most end sooner)"}.` : "", S.ghost ? "Faint: your reference shot for this coffee." : ""].filter(Boolean).join(" ");
  $("#chartEmpty").hidden = pts.length > 0;
  $("#chartEmpty").textContent = !S.snap || unlinked() ? "Waiting for the machine…" : `${S.ghc ? "Press the espresso button on the group head." : "Tap Espresso to pull a shot."}${about ? ` ${about}` : ""}`;
  patchHtml($("#legend"), legendHtml(!!S.ghost, !!plan, !!S.current?.bestShotId, true));
  const clear = $("#clearRef");
  if (clear) clear.onclick = () => setReference(S.current, null);
  $("#phase").textContent = unlinked() ? "Disconnected" : st === "espresso" ? (PHASE[S.snap.state.substate] || "Espresso") : STATE_LABEL[st] || "Ready";
  $("#phaseSub").textContent = st === "espresso" && S.next ? `${S.next.profileTitle} · target ${fmt1(target)} g` : "";
}
// A stream that closes means Decaid can't be reached: drop what it last said rather
// than show it as live. The socket reconnects on its own.
function onStreamLost(which) {
  if (which === "machine") {
    S.shotAcross = E.shotAcrossOnLoss(S.snap?.state?.state, S.shotAcross);
    S.snap = null;
    renderStatus(); renderAlerts(); renderControls();
    if (!$("#view-brew").hidden) { renderReadouts(); renderLive(); }
  }
  if (which === "devices") { S.link = { connected: null, error: null }; renderAlerts(); }
}
// The machine socket can stay open but go quiet (Streamline saw older Decaid keep
// it bound to a machine that had been replaced). Decaid 0.9.1 re-attaches it, and a
// machine that's unlinked is quiet anyway, so this is only a fallback: no reading for
// 15 s while the machine counts as linked reopens the machine sockets, at most every 30 s.
let lastSnapAt = 0, lastReopenAt = 0;
function checkStaleReadings() {
  if (!S.streams || unlinked() || document.visibilityState !== "visible" || !lastSnapAt) return;
  const now = Date.now();
  if (now - lastSnapAt > 15000 && now - lastReopenAt > 30000) { lastReopenAt = now; S.streams.reopenMachine(); }
}

function onSnapshot(s) {
  const prevState = S.snap?.state?.state;
  lastSnapAt = Date.now();
  S.snap = s;
  const st = s.state?.state;
  // The first snapshot after a drop in mid-shot: still pouring (the same shot goes on), or over.
  const d = E.snapshotDecision({ prevState, state: st, shotAcross: S.shotAcross, heldLoad: S.heldLoad, startingKind: S.starting?.kind });
  S.shotAcross = false;
  if (d.clearStarting) S.starting = null; // the machine has picked up the start
  if (d.changed) { renderControls(); renderAlerts(); updateSaver(); if (d.shotStart) onShotStart(); opOverlay(); }
  if (st === "espresso") {
    // Decaid's snapshot has no timer; the simulators send one. Ignore a stale
    // value carried over from the previous operation on the first frame.
    const local = (Date.now() - S.opStart) / 1000;
    const t = s.elapsed != null && !(S.live.length === 0 && s.elapsed > 2) ? s.elapsed : local;
    S.live.push({ t, p: s.pressure ?? 0, f: s.flow ?? 0, w: S.scale.weight ?? 0, temp: s.mixTemperature, tp: s.targetPressure, tf: s.targetFlow, frame: s.profileFrame ?? null });
    $("#shotClock").textContent = t.toFixed(1);
    if (!$("#view-brew").hidden) renderLive();
  } else if (["steam", "hotWater", "flush"].includes(st)) {
    opOverlay();
  }
  if (s.finished) onShotEnd(s.finished);
  if (d.sendHeldLoad) {
    loadOntoMachine(true).then((ok) => ok === true && toast(`Loaded ${S.next.profileTitle} for the next shot`));
  }
  renderStatus(); renderReadouts();
  if (st === "espresso" || st !== prevState) { if (!$("#view-brew").hidden) renderLive(); }
}
function onShotStart() {
  S.live = []; S.opStart = Date.now();
  const context = { ...S.loadedRecipe };
  S.shotContext = context;
  S.api.machine.recipe().then((r) => { if (r) { Object.assign(context, r); if (shotRunning() && !$("#view-brew").hidden) renderLive(); } }, () => {});
  // Which shot was newest before this one, so the end can tell when Decaid has saved it.
  S.shotBefore = undefined;
  S.api.latestShot().then((s) => { S.shotBefore = s?.id ?? null; }, () => {});
  $("#afterShot").hidden = true;
  $(".live-col").classList.remove("has-after");
  if (location.hash !== "#brew") location.hash = "#brew";
}
async function onShotEnd(finishedId) {
  const pts = S.live.slice();
  const context = { ...S.shotContext };
  const shot = finishedId === "latest" ? await justFinishedShot() : await S.api.shot(finishedId).catch(() => null);
  if (shot && !S.shots.some((s) => s.id === shot.id)) S.shots = [shot, ...S.shots];
  if (shot && context?.targetTimeS && context.profileShape === brewProfileShape(shot.profile)) {
    S.api.annotate(shot.id, { extras: { crema: { targetTimeS: context.targetTimeS } } }).catch(() => {});
  }
  S.lastShotId = shot?.id;
  planTimes.clear(); planFor = null; // the next plan can be timed from this shot
  showAfterShot(shot, pts, context);
  const batch = shot ? shot.batch : context.batchId;
  const b = batch ? S.shelf.find((b) => b.batch === batch) : null;
  if (b && shot) {
    S.api.syncRemaining(b.id, b.batch).then((r) => { if (r != null) b.remaining = r; }).catch(() => {}).finally(() => { void syncShelf(true); });
  }
}
// Decaid saves the shot a moment after the machine stops. Ratings and the reference
// must go to this shot, not the one before it, so wait (up to ~6 s) for a newest shot
// that isn't the one that was newest when this shot started.
async function justFinishedShot() {
  for (let i = 0; i < 8; i++) {
    const s = await S.api.latestShot().catch(() => null);
    if (s && S.shotBefore !== undefined && s.id !== S.shotBefore) return s;
    if (s && S.shotBefore === undefined && Date.parse(s.timestamp) >= S.opStart - 60000) return s; // start-time read failed; fall back to the clock
    await new Promise((r) => setTimeout(r, 750));
  }
  return null;
}
function shotMetrics(points, s) {
  const first = points.find((p) => p.w > 0.5);
  const pressures = points.map(p => p.p).filter(v => v != null && Number.isFinite(v));
  const peak = pressures.length ? Math.max(...pressures) : null;
  const pour = points.filter((p) => first && p.t >= first.t && p.f != null && Number.isFinite(p.f));
  const avgFlow = pour.length ? pour.reduce((a, p) => a + p.f, 0) / pour.length : null;
  const yieldG = s?.yieldG ?? points.at(-1)?.w;
  const doseG = s ? s.doseG : S.next?.doseG;
  return [["Time", points.at(-1) ? `${points.at(-1).t.toFixed(1)}` : s?.timeS, "s"], ["First drops", first ? first.t.toFixed(1) : "–", "s"], ["Yield", fmt1(yieldG), "g"], ["Ratio", doseG && yieldG ? `1:${(yieldG / doseG).toFixed(2)}` : "–", ""], ["Peak", fmt1(peak), "bar"], ["Avg flow", fmt1(avgFlow), "ml/s"]];
}
/* Ratings. Decaid stores enjoyment as 0–10, and Crema shows that as five stars in half
   steps, so one point is half a star and nothing is converted. 0 or missing is "not rated".
   Imported de1app ratings can be fractional; they show to the nearest half star. */
const STAR_ROW = "<i data-n=\"1\">★</i><i data-n=\"2\">★</i><i data-n=\"3\">★</i><i data-n=\"4\">★</i><i data-n=\"5\">★</i>";
const ratingPoints = (v) => Math.max(0, Math.min(10, Math.round(+v || 0)));
const ratingText = (v) => (ratingPoints(v) ? `${ratingPoints(v) / 2} of 5 stars` : "Not rated");
function starsHtml(v, id) {
  const fill = `<span class="stars-fill" style="width:${ratingPoints(v) * 10}%" aria-hidden="true">${STAR_ROW}</span>`;
  if (!id) return `<span class="stars static" role="img" aria-label="${ratingText(v)}">${STAR_ROW}${fill}</span>`;
  return `<div class="stars" id="${id}" role="slider" tabindex="0" aria-label="Rating" aria-valuemin="0" aria-valuemax="10" aria-valuenow="${ratingPoints(v)}" aria-valuetext="${ratingText(v)}"><span aria-hidden="true">${STAR_ROW}</span>${fill}</div>`;
}
// Tap or drag across the stars; the left half of a star is a half star. Arrow keys step by half.
function bindStars(el, v, onChange) {
  let cur = ratingPoints(v), committed = cur;
  const show = (n) => {
    cur = n;
    el.querySelector(".stars-fill").style.width = `${n * 10}%`;
    el.setAttribute("aria-valuenow", String(n)); el.setAttribute("aria-valuetext", ratingText(n));
  };
  const commit = () => { if (cur !== committed) { committed = cur; onChange(cur); } };
  const at = (x) => { const r = el.getBoundingClientRect(), f = ((x - r.left) / r.width) * 10; return f < 0.3 ? 0 : Math.max(1, Math.min(10, Math.ceil(f))); };
  el.onpointerdown = (e) => { el.setPointerCapture?.(e.pointerId); el.dataset.drag = "1"; show(at(e.clientX)); };
  el.onpointermove = (e) => { if (el.dataset.drag) show(at(e.clientX)); };
  el.onpointerup = () => { delete el.dataset.drag; commit(); };
  el.onpointercancel = () => { delete el.dataset.drag; show(committed); };
  el.onkeydown = (e) => {
    const n = { ArrowRight: cur + 1, ArrowUp: cur + 1, ArrowLeft: cur - 1, ArrowDown: cur - 1, Home: 0, End: 10 }[e.key];
    if (n == null) return;
    e.preventDefault(); show(Math.max(0, Math.min(10, n))); commit();
  };
}
function metricsHtml(m) {
  return `<div class="metrics">${m.map(([k, v, u]) => `<div><span class="label">${k}</span><span class="v">${esc(v)}<small class="muted"> ${u}</small></span></div>`).join("")}</div>`;
}
function reviewHtml(saved) {
  if (!saved?.review) return "";
  const review = saved.review;
  const source = String(saved.source || "").toLowerCase().includes("rules") ? "From Crema's shot checks" : "Review from the AI";
  return `<div class="advice shot-review"><div class="row between"><span class="label">${source}</span><span class="muted small">${esc(review.confidence || "")}${review.confidence ? " confidence" : ""}</span></div>
    <p>${esc(review.summary)}</p>${review.wentWell?.length ? `<div class="label">Went well</div><ul>${review.wentWell.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    ${review.issues?.length ? `<div class="label">To watch</div><ul>${review.issues.map((x) => `<li>${esc(x.what)} <span class="muted">${esc(x.evidence)}</span></li>`).join("")}</ul>` : ""}
    ${review.nextShot ? `<div class="label">Next shot</div><strong>${esc(review.nextShot.change)}</strong><div class="muted">${esc(review.nextShot.reasoning)}</div>` : ""}
    ${review.askTaste ? `<p class="muted small">Add taste feedback next time to guide the recommendation.</p>` : ""}</div>`;
}
/* ===== Taste scales and the Review button, shared by the after-shot panel and the shot detail ===== */
const TASTE_SCALES = [
  { key: "sourBitter", label: "Taste", opts: [[-2, "Sour"], [-1, "A bit sour"], [0, "Balanced"], [1, "A bit bitter"], [2, "Bitter"]] },
  { key: "body", label: "Body", opts: [[-2, "Thin"], [-1, "Light"], [0, "Just right"], [1, "Rich"], [2, "Heavy"]] },
];
// ids: { sourBitter: "sb", body: "bd" }, the element id of each scale.
function tasteScalesHtml(taste, ids) {
  const t = taste ?? {};
  return TASTE_SCALES.map(({ key, label, opts }) => `<div class="scale-row"><span class="label">${label}</span><div class="seg tap" id="${ids[key]}" role="radiogroup" aria-label="${label}">${opts.map(([v, text]) => `<button type="button" role="radio" data-v="${v}" aria-checked="${t[key] === v}" aria-pressed="${t[key] === v}">${text}</button>`).join("")}</div></div>`).join("")
    + `<p class="muted small">Tap to save. A review uses taste once both are chosen.</p>`;
}
const markPressed = (group, button) => $$("button", group).forEach((x) => { const on = x === button; x.setAttribute("aria-pressed", String(on)); x.setAttribute("aria-checked", String(on)); });
// A tap marks the answer and saves it on the shot at once (no shot yet: just marks it).
function bindTasteScales(shot, ids) {
  for (const { key } of TASTE_SCALES) {
    const group = $("#" + ids[key]);
    if (!group) continue;
    $$("button", group).forEach((button) => (button.onclick = async () => {
      const value = Number(button.dataset.v);
      const before = shot?.taste?.[key] ?? null;
      const previous = $$("button", group).find((x) => Number(x.dataset.v) === before && before !== null);
      markPressed(group, button);
      if (!shot) return;
      shot.taste = { ...(shot.taste ?? {}), [key]: value };
      await attempt("save taste feedback", () => S.api.annotate(shot.id, { extras: { crema: { [key]: value } } }), () => {
        shot.taste = { ...(shot.taste ?? {}), [key]: before };
        if (previous) markPressed(group, previous); else $$("button", group).forEach((x) => { x.setAttribute("aria-pressed", "false"); x.setAttribute("aria-checked", "false"); });
      });
    }));
  }
}
// Runs a review for `shot`. Taste goes with it once both scales are chosen (never for manual shots).
// buttonSel/boxSel find the live elements again afterwards; isCurrent() says the view still shows this shot.
function bindReviewButton(shot, { buttonSel, boxSel, isCurrent, manual }) {
  const button = $(buttonSel);
  if (!button) return;
  const label = () => (shot?.review ? "Review again" : "Review shot");
  if (!shot || S.reviewPending.has(shot.id)) button.disabled = true;
  button.onclick = async () => {
    if (!shot || S.reviewPending.has(shot.id)) return;
    const sb = shot.taste?.sourBitter, body = shot.taste?.body;
    const feedback = !manual && sb != null && body != null ? { sourBitter: sb, body, enjoyment: shot.enjoyment ?? null, notes: null } : null;
    S.reviewPending.add(shot.id); button.disabled = true; button.textContent = "Reviewing…";
    try {
      const saved = await S.api.review(shot.id, feedback, bagInfoForShot(shot));
      shot.review = saved;
      if (feedback) shot.taste = { sourBitter: feedback.sourBitter, body: feedback.body };
      const listed = S.shots.find((x) => x.id === shot.id);
      if (listed && listed !== shot) { listed.review = saved; if (feedback) listed.taste = shot.taste; }
      if (isCurrent() && $(boxSel)) $(boxSel).innerHTML = reviewHtml(saved);
    } catch (err) {
      if (isCurrent() && $(boxSel)) $(boxSel).innerHTML = `<p class="error">${esc(err.message)}</p>`;
    } finally {
      S.reviewPending.delete(shot.id);
      const now = isCurrent() && $(buttonSel);
      if (now) { now.disabled = false; now.textContent = label(); }
    }
  };
}
function showAfterShot(shot, pts, context = {}) {
  const p = $("#afterShot");
  p.hidden = false;
  const viewToken = ++S.afterViewToken;
  p.dataset.shotId = shot?.id ?? "";
  let rating = shot?.enjoyment ?? null;
  const unsaved = shot ? "" : `<p class="muted small">Decaid hasn't saved this shot yet, so the rating and advice can't be attached. Rate it from Shots in a moment.</p>`;
  const batch = shot ? shot.batch : context.batchId;
  const bean = batch ? S.shelf.find((b) => b.batch === batch) : null;
  const r = bean?.recipe;
  const manual = shot?.manual || context.manual;
  const timeS = pts.at(-1)?.t ?? shot?.timeS ?? null;
  // The recommendation's time window belongs to its profile; a different profile
  // pulled (picked here or set on the machine) isn't judged against it.
  const window = !manual && (shot?.profileTitle ?? context.profileTitle) === r?.profileTitle ? r?.targetTimeS ?? null : null;
  const [lo, hi] = window || [0, 0];
  const timing = timeS == null || !window ? "" : timeS < lo ? `<span class="pill warn">Fast for this profile (${lo}–${hi} s)</span>` : timeS > hi ? `<span class="pill warn">Slow for this profile (${lo}–${hi} s)</span>` : `<span class="pill good">In the target window</span>`;
  p.innerHTML = `
    <div class="row between"><h2>How was it?</h2>${timing}</div>${unsaved}
    ${metricsHtml(shotMetrics(pts.length ? pts : shot?.points || [], shot))}
    <div id="tasteControls">${tasteScalesHtml(shot?.taste, { sourBitter: "sb", body: "bd" })}</div>
    <div class="row between"><div class="row"><span class="label">Enjoyment</span>${starsHtml(rating, "afterStars")}</div>
      <div class="row"><button class="btn primary" id="reviewShot" ${!shot ? "disabled" : ""}>${shot?.review ? "Review again" : "Review shot"}</button><button class="btn" id="pinShot" title="Show this shot faintly on the live chart for this coffee">Set as reference</button><button class="btn ghost icon-only" id="closeAfter" aria-label="Close">✕</button></div></div>
    <div id="reviewBox">${reviewHtml(shot?.review)}</div>`;
  if (manual) {
    $("#tasteControls").hidden = true;
    $("#pinShot").hidden = !bean;
  } else $("#pinShot").hidden = !bean;
  if (!bean && shot) {
    const notes = document.createElement("div"); notes.className = "field";
    notes.innerHTML = `<label class="label" for="afterNotes">Shot notes</label><textarea id="afterNotes" rows="2">${esc(shot.notes || "")}</textarea>`;
    $("#reviewBox").before(notes);
    $("#afterNotes").onchange = (e) => { shot.notes = e.target.value; S.api.annotate(shot.id, { espressoNotes: e.target.value }).catch(() => toast("Couldn't save notes")); };
  }
  bindTasteScales(shot, { sourBitter: "sb", body: "bd" });
  // Closing the review readies the chart for the next shot: the profile again, not this one.
  $("#closeAfter").onclick = () => { p.hidden = true; $(".live-col").classList.remove("has-after"); if (S.snap?.state?.state !== "espresso") S.live = []; renderLive(); };
  $(".live-col").classList.add("has-after");
  requestAnimationFrame(renderLive);
  // The rating saves as soon as it's set; asking for a review is separate.
  bindStars($("#afterStars"), rating, (n) => {
    rating = n;
    if (shot) { shot.enjoyment = n; S.api.annotate(shot.id, { enjoyment: n }).catch(() => toast("Couldn't save the rating")); }
  });
  bindReviewButton(shot, { buttonSel: "#reviewShot", boxSel: "#reviewBox", manual, isCurrent: () => p.dataset.shotId === (shot?.id ?? "") && S.afterViewToken === viewToken });
  const pinBtn = $("#pinShot");
  const pinLabel = () => (pinBtn.textContent = bean?.bestShotId === shot?.id ? "Remove reference" : "Set as reference");
  pinLabel();
  pinBtn.onclick = async () => {
    if (!shot || !bean) return;
    const isRef = bean.bestShotId === shot.id;
    if (await setReference(bean, isRef ? null : shot.id, pts.length ? pts : shot.points)) pinLabel();
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
  patchHtml($("#opCard"), `<span class="label">${title}</span><div class="op-time">${t.toFixed(0)}<small style="font-size:1.4rem" class="muted"> s</small></div>
    ${total ? `<div class="op-bar"><div style="width:${clamp((t / total) * 100, 0, 100)}%"></div></div><div class="muted">${Math.max(0, total - t).toFixed(0)} s left</div>` : '<div class="muted">Runs until you stop it</div>'}
    <div>${esc(detail)}</div><button class="stop-btn active" id="opStop">STOP</button>`);
  $("#opStop").onclick = stopMachine;
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
  cancelStart();
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
    const bagNote = b.bags > 1 ? `<span class="pill plain">Bag ${b.bagNo} of ${b.bags}${i.roastDate?.value ? ` · roasted ${esc(i.roastDate.value)}` : ""}</span>` : "";
    return `<article class="panel bean-card ${S.current?.key === b.key ? "current" : ""}">
      <div class="coffee-head">${bagArt(b, "lg")}<div style="min-width:0" class="stack" style="gap:2px"><div><div class="label">${esc(i.roaster.value)}</div><h2>${esc(i.name.value)}</h2>
        <div class="muted small">${esc([i.country?.value, i.process?.value].filter(Boolean).join(" · "))}</div>${bagNote ? `<div>${bagNote}</div>` : ""}</div>
        ${i.tastingNotes?.value?.length ? `<div class="tags">${i.tastingNotes.value.slice(0, 3).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}</div></div>
      ${restBar(rest)}
      ${b.remaining == null && b.batch && b.shots == null ? `<div class="muted small">Couldn't count what's left: Decaid's shots didn't load.</div>` : ""}
      ${left != null ? `<div class="stack" style="gap:6px"><div class="row between"><span class="label">Left</span><span class="num muted small">${b.remaining} / ${b.weight} g · about ${shotsLeft} shots</span></div><div class="grams"><div style="width:${left}%"></div></div>
        ${shotsLeft != null && shotsLeft <= 4 ? '<span class="pill warn" style="justify-self:start">Running low. Time to reorder</span>' : ""}</div>` : ""}
      <div class="muted small">${esc(b.recipe ? `${b.recipe.profileTitle} · ${fmt1(b.recipe.doseG)}→${fmt1(b.recipe.yieldG)} g · ${fmt1(b.recipe.tempC)} °C` : "No recipe yet")}</div>
      <div class="row">
        <button class="btn small ${S.current?.key === b.key ? "" : "primary"}" data-brew="${esc(b.key)}">${S.current?.key === b.key ? "Brewing" : "Brew this"}</button>
        <button class="btn small ghost" data-freeze="${esc(b.key)}">${b.frozen ? "Thaw" : "Freeze"}</button>
        <button class="btn small ghost" data-finish="${esc(b.key)}">Finished</button>
        <button class="btn small ghost" data-addbag="${esc(b.key)}">Another bag</button>
        ${b.batch && b.weight ? `<button class="btn small ghost" data-left="${esc(b.key)}">Set what's left</button>` : ""}
        ${i.productUrl ? `<a class="btn small ghost" href="${esc(i.productUrl)}" target="_blank" rel="noopener">Roaster's page</a>` : ""}
      </div></article>`;
  }).join("");
  $$("[data-brew]").forEach((btn) => (btn.onclick = async () => { await selectBean(btn.dataset.brew); location.hash = "#brew"; }));
  const bag = (key) => S.shelf.find((x) => x.key === key);
  $$("[data-freeze]").forEach((btn) => (btn.onclick = async () => {
    const b = bag(btn.dataset.freeze);
    if (!(await attempt(b.frozen ? "thaw the bag" : "freeze the bag", () => S.api.setBeanState(b.id, { frozen: !b.frozen }, b.batch)))) return;
    b.frozen = !b.frozen; renderShelf(); toast(b.frozen ? "Marked as frozen" : "Thawed");
  }));
  $$("[data-finish]").forEach((btn) => (btn.onclick = () => {
    const b = bag(btn.dataset.finish);
    const others = S.shelf.filter((x) => x.id === b.id && x.key !== b.key).length;
    openSheet(`<h2>Finished this bag of ${esc(b.info.name.value)}?</h2><p class="muted">${others ? `Your other ${others > 1 ? `${others} bags` : "bag"} of it stay${others > 1 ? "" : "s"} on the shelf, with the same recipe.` : "It moves off your shelf. Its shots stay in your history."}</p><div class="row"><button class="btn primary" id="confirmFinish">Mark finished</button></div>`);
    $("#confirmFinish").onclick = async () => {
      if (!(await attempt("mark the bag finished", () => S.api.setBeanState(b.id, { finished: true }, b.batch)))) return;
      closeSheet(); await refreshShelf();
      if (S.current?.key === b.key) await selectBean(S.shelf.find((x) => x.id === b.id)?.key || S.shelf[0]?.key, { quiet: true });
      renderShelf(); toast(others ? "Bag finished" : "Moved off the shelf");
    };
  }));
  $$("[data-addbag]").forEach((btn) => (btn.onclick = () => {
    const b = bag(btn.dataset.addbag);
    openSheet(`<h2>Another bag of ${esc(b.info.name.value)}</h2><p class="muted">It gets its own roast date, frozen state and weight, and shares this coffee's recipe and reference shot.</p>
      <div class="field"><label class="label" for="bagRoast">Roast date</label><input type="date" id="bagRoast" max="${new Date().toISOString().slice(0, 10)}"></div>
      <div class="field"><label class="label" for="bagWeight">Weight</label><input id="bagWeight" inputmode="decimal" value="${esc(String(b.weight || 250))}" aria-label="Grams"></div>
      <div class="row"><button class="btn primary" id="confirmBag">Add bag</button></div>`);
    $("#confirmBag").onclick = async () => {
      const w = parseFloat($("#bagWeight").value);
      try {
        const added = await S.api.addBag(b.id, { roastDate: $("#bagRoast").value || null, weight: Number.isFinite(w) && w > 0 ? w : null });
        closeSheet(); await refreshShelf(); renderShelf(); toast("Bag added");
        if (!S.current) await selectBean(added.key, { quiet: true });
      } catch (e) { toast(`Couldn't add the bag: ${e.message}`); }
    };
  }));
  $$("[data-left]").forEach((btn) => (btn.onclick = () => {
    const b = bag(btn.dataset.left);
    openSheet(`<h2>How much is left?</h2><p class="muted">Crema counts it from your shots. Correct it here if you've weighed the bag, spilled some or brewed it another way.</p>
      <div class="field"><label class="label" for="leftG">Grams left</label><input id="leftG" inputmode="decimal" value="${esc(String(b.remaining ?? b.weight))}" aria-label="Grams left"></div>
      <div class="row"><button class="btn primary" id="confirmLeft">Save</button></div>`);
    $("#confirmLeft").onclick = async () => {
      const g = parseFloat($("#leftG").value);
      if (!Number.isFinite(g) || g < 0) return toast("Enter the grams left");
      try { b.remaining = await S.api.syncRemaining(b.id, b.batch, g); closeSheet(); renderShelf(); toast("Saved"); } catch (e) { toast(`Couldn't save: ${e.message}`); }
    };
  }));
}
let shelfRequest = 0, shelfSync = null;
async function refreshShelf() {
  const request = ++shelfRequest;
  // The signal is requested first, so a change made while the shelf is read shows up as a
  // difference at the next poll rather than being lost. The two reads overlap, so a
  // Decaid that never answers costs one time limit, not two.
  const signalRead = S.api.shelfSignal().catch(() => null);
  const rows = await S.api.shelf(), signal = await signalRead;
  if (request !== shelfRequest) return;
  S.shelf = rows; S.shelfSignal = signal;
  // Keep the selected object current without resetting edits to the next shot.
  const selected = rows.find((b) => b.key === S.current?.key);
  if (selected) { Object.assign(S.current, selected); rows[rows.indexOf(selected)] = S.current; }
}
// Decaid has no inventory stream. Refresh visible clients without overlapping reads,
// resetting the recipe being edited, or turning a failed read into an empty shelf.
// The 5 s poll reads only a cheap signal and reads the whole shelf when it changed;
// `full` (focus, the minute check, after a shot) reads it regardless.
function syncShelf(full = false) {
  if (S.api.demo || !S.shelfLoaded || shotRunning() || S.recommending || loadsPending) return Promise.resolve();
  if (shelfSync) return shelfSync;
  const before = JSON.stringify(S.shelf), selected = JSON.stringify(S.current);
  // A coffee added on another device gets its recipe a while after it appears, in a
  // record the signal doesn't cover: read in full until it has one (or ~2 minutes pass).
  S.newRows = E.pruneNewRows(S.newRows, Date.now());
  const waiting = S.newRows.size > 0;
  shelfSync = (full || waiting ? Promise.resolve(true) : S.api.shelfSignal().then((s) => s !== S.shelfSignal)).then(async (changed) => {
    if (!changed) return;
    const previous = S.shelf.map((b) => b.key);
    await refreshShelf();
    S.newRows = E.trackNewRows(S.newRows, previous, S.shelf, Date.now());
    S.shelfError = null;
    if ((S.current && !S.shelf.some((b) => b.key === S.current.key)) || (!S.current && !S.noBag && S.shelf.length)) {
      await selectBean(S.shelf[0]?.key, { quiet: true });
    } else if (selected !== JSON.stringify(S.current)) renderNextShot();
    if (before !== JSON.stringify(S.shelf) && !$("#view-shelf").hidden) renderShelf();
  }).catch(() => {}).finally(() => { shelfSync = null; });
  return shelfSync;
}
// A coffee's recipe and reference shot are shared by all its bags on the shelf.
const sameCoffee = (id, fn) => S.shelf.filter((x) => x.id === id).forEach(fn);
async function retryShelf() {
  S.shelfLoaded = false; renderNextShot();
  await refreshShelf().then(() => (S.shelfError = null), (e) => { S.shelf = []; S.shelfError = e.message; });
  S.shelfLoaded = true;
  await selectBean(local.get("current", null) || S.shelf[0]?.key, { quiet: true });
  await reconcileWorkflow({ boot: true });
}

/* ================= add coffee ================= */
let addMode = "photo", files = [], pending = null, REVIEW_INTRO = "";
const MANUAL_INTRO = `<h2>Entering a coffee by hand</h2>
  <ul class="steps">
    <li class="done"><span class="tick">1</span><span><b>Copy the bag.</b> Roaster, name, process and roast date are enough. The more you add, the better the match.</span></li>
    <li class="done"><span class="tick">2</span><span><b>Match a profile.</b> Crema ranks the profiles on your machine against the coffee and picks a dose, ratio and temperature.</span></li>
  </ul>`;
const introFor = (m) => (m === "manual" ? MANUAL_INTRO : REVIEW_INTRO);
function setMode(m) {
  if (m !== "describe") stopListening(false);
  addMode = m;
  $$("[data-mode]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === m)));
  $$("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== m));
  $("#offlineRow").hidden = m === "manual";
  $("#identifyBtn").textContent = m === "manual" ? "Review" : "Identify coffee";
  if (!pending) $("#reviewPanel").innerHTML = introFor(m);
  if (m === "describe") renderSpeak();
}

/* Speaking into "Describe it". Two ways, chosen per device in Settings → AI features:
   - Gemini: record a voice note, stop after a pause, send it to the Crema server as 16 kHz mono
     WAV, and Gemini writes it down knowing it's about a coffee bag (roaster names and origins).
     Used when chosen and the server has a Gemini key; otherwise the next one.
   - This device: the browser's own speech recognition (Chrome, Safari).
   Both need the microphone, which browsers allow only on https or localhost pages. Elsewhere, such
   as a phone on the tablet's plain-http address, the keyboard's microphone fills the same box.
   Either way the text then takes the same path as typing: /api/identify with LLM_PROVIDERS. */
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
const AudioCtx = window.AudioContext || window.webkitAudioContext;
// A refused microphone hides Speak on this device until the voice setting is changed. Decaid
// never gives skins the microphone (camera only), so inside Decaid this happens on the first tap.
let listening = null, speechBroken = local.get("speechDenied", false), micBroken = local.get("micDenied", false);
function noMicrophone() {
  micBroken = speechBroken = true;
  local.set("micDenied", true); local.set("speechDenied", true);
  toast("The microphone isn't available here, so Speak is hidden. Use your keyboard's microphone instead.");
}
// Decaid's WebView adds window.decentApp. It never hands skins the microphone, so there
// Speak isn't offered at all and the keyboard's own microphone is the way to dictate.
const inDecaid = () => !!window.decentApp;
const canRecord = () => !!(navigator.mediaDevices?.getUserMedia && AudioCtx && window.isSecureContext && !micBroken && !inDecaid());
const canSpeak = () => !!SpeechRec && window.isSecureContext && !speechBroken && !inDecaid();
const voicePref = () => (local.get("voice", "gemini") === "device" ? "device" : "gemini");
const voiceKind = () => (voicePref() === "gemini" && S.api.ai.voice && canRecord() ? "gemini" : canSpeak() ? "browser" : null);
const KEYBOARD_MIC = "Tap the box, then the microphone on your keyboard.";
function voiceHint() {
  if (inDecaid()) return `Decaid doesn't give Crema the microphone. ${KEYBOARD_MIC}`;
  const fallback = canSpeak() ? "this device's speech recognition" : "your keyboard's microphone";
  if (micBroken && window.isSecureContext) return "The microphone isn't available to this page (Decaid doesn't give skins one), so use your keyboard's microphone. Choose an option to try again";
  if (voicePref() === "device") return `Uses ${fallback}. Nothing goes to Gemini. Set on each device`;
  if (!S.api.ai.voice) return `Needs a Gemini API key on the Crema server. Until then, uses ${fallback}`;
  if (!canRecord()) return `This page can't use the microphone (it needs https or the tablet itself), so it uses ${fallback}`;
  return "Your voice note goes to Gemini through the Crema server, which spells coffee names well. Set on each device";
}
function renderSpeak() {
  const btn = $("#speakBtn"), kind = voiceKind(), state = listening?.state;
  btn.hidden = !kind && !listening;
  btn.disabled = state === "writing";
  btn.setAttribute("aria-pressed", String(state === "listening"));
  btn.querySelector("span").textContent = state === "listening" ? "Stop" : state === "writing" ? "Writing…" : "Speak";
  if (state !== "listening") btn.style.removeProperty("--level");
  $("#speakHint").textContent = state === "listening" ? "Listening. Say the roaster and name, plus the roast date and weight if you have them."
    : state === "writing" ? "Writing down what you said…"
    : kind ? "Tap Speak and say what's on the bag. Crema looks it up when you stop talking."
    : `${inDecaid() ? KEYBOARD_MIC : "Type it, or dictate with your keyboard's microphone."} Roaster and name are enough; add the roast date and weight if you have them.`;
}
const describeAndGo = () => { if (addMode === "describe" && !$("#view-add").hidden) $("#identifyBtn").click(); };
const appendToBox = (text) => { const box = $("#describeInput"); box.value = [box.value.trim(), text.trim()].filter(Boolean).join(" "); };
function startListening() { return voiceKind() === "gemini" ? startRecording() : startBrowserSpeech(); }
// go=false cancels: nothing is sent or looked up.
function stopListening(go = true) {
  if (listening?.state === "listening") listening.stop(go);
  else if (!go && listening?.state === "writing") { listening = null; renderSpeak(); }   // its transcript is dropped
}

async function startRecording() {
  // Until the microphone is open, Stop cancels; recordVoice replaces this.
  const me = { kind: "gemini", state: "listening", stop: () => { me.cancelled = true; if (listening === me) listening = null; renderSpeak(); } };
  listening = me; renderSpeak();
  let wav;
  try {
    wav = await recordVoice(me, (level) => $("#speakBtn").style.setProperty("--level", level.toFixed(2)));
  } catch (err) {
    if (listening === me) listening = null;
    if (err.name === "NotAllowedError" || err.name === "SecurityError") noMicrophone();
    else { micBroken = true; toast("Couldn't use the microphone here. Use your keyboard's microphone instead."); }
    return renderSpeak();
  }
  if (listening !== me) return;                          // cancelled
  if (!wav) { listening = null; renderSpeak(); return toast("Didn't hear anything. Try again a little closer."); }
  me.state = "writing"; renderSpeak();
  try {
    const text = await S.api.transcribe(wav);
    if (listening !== me) return;
    listening = null; renderSpeak();
    if (!text) return toast("Didn't catch any words. Try again a little closer.");
    appendToBox(text);
    describeAndGo();
  } catch (err) {
    if (listening === me) listening = null;
    renderSpeak();
    toast(`Couldn't write that down: ${err.message}. Type it instead.`);
  }
}

/* Records until the speaker pauses (or Stop, or 30 s) and returns a WAV blob, or null when
   nobody spoke. ctl.stop(go) ends it early; go=false throws the recording away. */
async function recordVoice(ctl, onLevel) {
  const ac = new AudioCtx();                             // made inside the tap, so iOS lets it run
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch (e) { ac.close(); throw e; }
  if (ctl.cancelled) { stream.getTracks().forEach((t) => t.stop()); ac.close(); return null; }
  await ac.resume();
  const src = ac.createMediaStreamSource(stream), mute = ac.createGain(); mute.gain.value = 0;
  const chunks = [], gate = voiceGate(performance.now());
  let tap;
  return new Promise((resolve) => {
    let done = false, timer = null;
    const finish = (keep) => {
      if (done) return; done = true;
      clearInterval(timer);
      try { tap.disconnect(); src.disconnect(); } catch {}
      stream.getTracks().forEach((t) => t.stop()); ac.close();
      resolve(keep && gate.heard ? encodeWav(downsample(chunks, ac.sampleRate, 16000), 16000) : null);
    };
    ctl.stop = (go = true) => { if (!go && listening === ctl) listening = null; finish(go); renderSpeak(); };
    const onChunk = (buf) => {
      if (done) return;
      chunks.push(buf);
      onLevel(gate.push(buf, performance.now()));
    };
    // Checked on a clock, not per chunk, so it still ends if the microphone stops sending.
    timer = setInterval(() => { if (gate.check(performance.now())) finish(true); }, 100);
    stream.getAudioTracks()[0]?.addEventListener("ended", () => finish(true));
    // An AudioWorklet where there is one; the older ScriptProcessor otherwise.
    (async () => {
      if (ac.audioWorklet && window.AudioWorkletNode) {
        try {
          const code = `registerProcessor("crema-tap", class extends AudioWorkletProcessor {
            constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
            process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) for (let i = 0; i < ch.length; i++) { this.buf[this.n++] = ch[i]; if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice()); this.n = 0; } } return true; } });`;
          const url = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
          await ac.audioWorklet.addModule(url); URL.revokeObjectURL(url);
          if (done) return;
          tap = new AudioWorkletNode(ac, "crema-tap");
          tap.port.onmessage = (e) => onChunk(e.data);
        } catch { tap = null; }
      }
      if (done) return;
      if (!tap) { tap = ac.createScriptProcessor(2048, 1, 1); tap.onaudioprocess = (e) => onChunk(new Float32Array(e.inputBuffer.getChannelData(0))); }
      if (done) return;
      src.connect(tap); tap.connect(mute); mute.connect(ac.destination);
    })().catch(() => finish(false));
  });
}
/* When to stop recording: after a 1.6 s pause once someone has spoken, after 8 s if nobody
   has, or at 30 s. Speech is anything well above the room's noise floor (the quietest moment
   so far, drifting up slowly), so a fan or the machine's pump doesn't count. */
function voiceGate(t0) {
  let floor = null, quietSince = null;
  const g = {
    heard: false,
    push(buf, now) {                                     // → level for the meter, 0–1
      let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      floor = floor == null ? rms : Math.min(rms, floor * 1.002);
      // Capped, so a voice that starts the moment recording does still counts as speech.
      if (rms > Math.max(0.012, Math.min(floor * 3, 0.06))) { g.heard = true; quietSince = null; } else if (quietSince == null) quietSince = now;
      return Math.min(1, rms / 0.12);
    },
    check(now) {                                         // → why to stop, or null
      if (g.heard && quietSince != null && now - quietSince > 1600) return "pause";
      if (!g.heard && now - t0 > 8000) return "silent";
      if (now - t0 > 30000) return "max";
      return null;
    },
  };
  return g;
}
// Averages each output sample's span of input: a crude low-pass that's plenty for speech.
function downsample(chunks, from, to) {
  const len = chunks.reduce((n, c) => n + c.length, 0), all = new Float32Array(len);
  let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  if (from <= to) return all;
  const ratio = from / to, out = new Float32Array(Math.floor(len / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio), b = Math.min(len, Math.floor((i + 1) * ratio));
    let sum = 0; for (let k = a; k < b; k++) sum += all[k];
    out[i] = sum / Math.max(1, b - a);
  }
  return out;
}
function encodeWav(samples, rate) {
  const v = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const x = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
  return new Blob([v], { type: "audio/wav" });
}

function startBrowserSpeech() {
  const box = $("#describeInput"), before = box.value.trim();
  const r = new SpeechRec();
  r.lang = navigator.language || "en-US"; r.continuous = true; r.interimResults = true;
  const me = { kind: "browser", state: "listening", stop: (go) => { if (!go) { me.cancelled = true; r.abort(); } else r.stop(); } };
  let heard = false, silence = null;
  r.onresult = (e) => {
    const said = Array.from(e.results, (x) => x[0].transcript).join("").trim();
    box.value = [before, said].filter(Boolean).join(" ");
    heard = !!said;
    clearTimeout(silence); silence = setTimeout(() => r.stop(), 2500);
  };
  r.onerror = (e) => {
    me.failed = true;
    if (["not-allowed", "service-not-allowed", "audio-capture"].includes(e.error)) {
      if (e.error === "not-allowed") noMicrophone();
      else { speechBroken = true; toast("Speech recognition isn't available here. Use your keyboard's microphone instead."); }
    } else if (e.error === "no-speech") toast("Didn't hear anything. Try again a little closer.");
    else if (e.error === "network") toast("Speech recognition needs an internet connection. Type it instead.");
  };
  r.onend = () => {
    clearTimeout(silence);
    if (listening === me) listening = null;
    renderSpeak();
    if (heard && !me.failed && !me.cancelled) describeAndGo();
  };
  try { r.start(); } catch { toast("Couldn't start listening. Type it instead."); return; }
  listening = me; renderSpeak();
}
// Without AI (switched off, or no Crema server) the only way in is typing the details.
function renderAddModes() {
  const ai = S.api.ai.on;
  $$("[data-mode]").forEach((b) => (b.hidden = !ai && b.dataset.mode !== "manual"));
  $("#addModes").hidden = !ai;
  $("#addNoAi").hidden = ai;
  $("#addNoAi").textContent = S.api.ai.enabled
    ? "Identifying from photos, descriptions and links needs a Crema server. Enter the details from the bag instead."
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
      if (saved.anotherBag) {
        // Another bag of a coffee you have: its recipe and reference shot carry over.
        location.hash = "#brew";
        await selectBean(saved.key);
        toast(`Added another bag of ${S.current?.info.name.value ?? "this coffee"}. Its recipe carries over`);
      } else {
        const b = S.shelf.find((x) => x.key === saved.key); if (b) b.recipe = null;
        location.hash = "#profiles";
        await selectBean(saved.key);
      }
    } catch (err) { toast(`Couldn't save: ${err.message}`); e.target.disabled = false; }
  };
  $("#discardBean").onclick = () => { pending = null; $("#reviewPanel").innerHTML = introFor(addMode); };
}
async function onIdentify(e) {
  e.preventDefault();
  stopListening(false);
  const description = $("#describeInput").value.trim(), url = $("#urlInput").value.trim(), offline = $("#offlineInput").checked;
  const input = addMode === "photo" ? { files } : addMode === "describe" ? { description } : { url };
  if (addMode === "manual") {
    const info = manualInfo();
    if (!info.roaster.value || !info.name.value) return toast("Enter at least the roaster and the coffee's name");
    return renderReview(info, null);
  }
  if (addMode === "photo" && !files.length) return toast("Add a photo of the bag first");
  if (addMode === "describe" && !description) return toast(canSpeak() ? "Say or type the roaster and coffee name" : "Type the roaster and coffee name");
  if (addMode === "link" && !url) return toast("Paste a product link");
  const btn = $("#identifyBtn"); btn.disabled = true;
  const panel = $("#reviewPanel");
  const draw = (i, steps) => { panel.innerHTML = `<h2>Identifying…</h2><ul class="steps">${steps.map((s, n) => `<li class="${n < i ? "done" : n === i ? "active" : ""}"><span class="tick">${n < i ? "✓" : ""}</span>${esc(s)}</li>`).join("")}</ul>`; };
  try {
    const info = await S.api.identify({ ...input, offline }, draw);
    renderReview(info, files[0] ? await thumbnail(files[0]) : null);
  } catch (err) {
    panel.innerHTML = `<h2>Couldn't identify it</h2><p class="error">${esc(err.message)}</p><p class="muted">Try a photo with the label in focus, or describe it again with the roaster's name first.</p>`;
  }
  btn.disabled = false;
}

/* ================= profiles ================= */
const ROASTS = ["light", "medium-light", "medium", "medium-dark", "dark"];
let catFilter = { roast: null, milk: false, easy: false, scale: null };
async function renderProfiles() {
  const b = S.current;
  $("#profilesTitle").textContent = b ? `Profiles for ${b.info.name.value}` : "Profiles";
  $("#profilesSub").textContent = b ? `Matched against what ${b.info.roaster.value} says about it: ${[b.info.roastLevel?.value, b.info.processKind, (b.info.tastingNotes?.value || []).slice(0, 3).join(", ")].filter(Boolean).join(" · ")}` : "Choose an installed profile, with or without a bag.";
  const rec = $("#recommended");
  if (b) {
    rec.innerHTML = `<p class="muted">Ranking profiles…</p>`;
    const waiting = !b.recipe && S.recommending === b.id
      ? `<div class="panel stack"><span class="label">Recommended</span><p class="muted">${S.api.ai.on ? "Asking the AI to choose among these…" : "Working out a recipe…"}</p></div>` : "";
    try {
      const cands = await S.api.rank(b.id);
      if (S.current !== b) return;
      const top = cands[0]?.score || 1;
      const chosen = b.recipe?.profileTitle;
      rec.innerHTML = `${waiting}${b.recipe ? `<div class="panel stack"><div class="row between"><span class="label">Recommended</span><span class="muted small">${esc(b.recipeSource ? pickLabel(b.recipeSource) : "")}</span></div>
          <div class="row between"><h2>${esc(chosen)}</h2><span class="num">${fmt1(b.recipe.doseG)} g → ${fmt1(b.recipe.yieldG)} g · ${fmt1(b.recipe.tempC)} °C · ${b.recipe.targetTimeS?.join("–")} s</span></div>
          <ul class="why">${(b.recipe.rationale || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
          ${b.recipe.dialIn ? `<div class="advice small"><div class="label">Dial-in</div>${esc(b.recipe.dialIn)}</div>` : ""}
          <div class="row"><button class="btn primary" data-use="${esc(chosen)}" data-rec="1">Use this</button><button class="btn" id="askAgain">Ask the AI again</button></div></div>` : ""}
        <div class="row between"><span class="label">Ranked by the rules</span><span class="muted small">The AI chooses among the top candidates</span></div>
        <div class="cands">${cands.slice(0, 6).map((c, i) => `<div class="cand ${c.title === chosen ? "top" : ""}">
          <div class="row between"><h3>${esc(c.title)}</h3>${c.title === chosen ? '<span class="pill accent">AI pick</span>' : `<span class="muted small num">#${i + 1}</span>`}</div>
          <div class="scorebar" aria-label="Match score ${c.score}"><div style="width:${clamp((c.score / top) * 100, 5, 100)}%"></div></div>
          <ul>${c.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}${c.cautions.map((r) => `<li class="caution">${esc(r)}</li>`).join("")}</ul>
          <div class="row between"><span class="num small">${fmt1(c.recipe.doseG)}→${fmt1(c.recipe.yieldG)} g · ${fmt1(c.recipe.tempC)} °C</span>${c.installed === false ? '<span class="pill plain">Not on this machine</span>' : `<button class="btn small" data-use="${esc(c.title)}">Use</button>`}</div></div>`).join("")}</div>`;
      if (!cands.some((c) => c.installed !== false)) rec.insertAdjacentHTML("afterbegin", `<div class="panel stack"><span class="label">Recommended</span><p class="muted">None of the profiles on this machine is in Crema's guide, so there's no recommendation. Choose one of the installed profiles below.</p></div>`);
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
        try { const out = await S.api.recommend(b.id, { batchId: b.batch }); sameCoffee(b.id, (x) => { x.recipe = out.recipe; x.recipeSource = out.source; }); setNextFromRecipe(b); renderProfiles(); } catch (e) { toast(e.message); again.disabled = false; }
      };
    } catch (e) { rec.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  } else rec.innerHTML = "";
  if (!S.catalog) S.catalog = await S.api.catalog().catch(() => []);
  [S.library, S.machineInfo] = await Promise.all([S.api.library().catch(() => null), S.api.machine.info().catch(() => null)]);
  renderCatalog();
}
function renderCatalog() {
  const f = catFilter;
  $("#catFilters").innerHTML = [
    ...["flow", "pressure"].map((kind) => `<button class="fchip" data-manual="${kind}">Manual ${kind}</button>`),
    ...ROASTS.map((r) => `<button class="fchip" data-f="roast:${r}" aria-pressed="${f.roast === r}">${r}</button>`),
    `<button class="fchip" data-f="milk" aria-pressed="${f.milk}">Good with milk</button>`,
    `<button class="fchip" data-f="easy" aria-pressed="${f.easy}">Easy to dial</button>`,
    `<button class="fchip" data-f="scale" aria-pressed="${f.scale === false}">No scale needed</button>`,
  ].join("");
  $$("[data-manual]").forEach((btn) => btn.onclick = () => {
    const p = S.library?.find((p) => p.manual === btn.dataset.manual);
    if (p) showInstalledProfile(p);
    else openSheet(`<h2>Manual ${esc(btn.dataset.manual)}</h2><p>The matching manual profile isn't visible in Decaid. Show or restore it in Decaid or Streamline, then reopen Profiles.</p>`);
  });
  $$("[data-f]").forEach((b) => (b.onclick = () => {
    const [k, v] = b.dataset.f.split(":");
    if (k === "roast") f.roast = f.roast === v ? null : v; else if (k === "scale") f.scale = f.scale === false ? null : false; else f[k] = !f[k];
    renderCatalog();
  }));
  // The library is what's installed in Decaid. Crema's guide adds notes and the filters
  // to the profiles it knows; with a filter on, profiles it doesn't know are left out.
  const matches = (p) => (!f.roast || p.roasts.includes(f.roast)) && (!f.milk || p.milk === "great") && (!f.easy || p.difficulty === "easy") && (f.scale !== false || !p.needsScale);
  const filtering = !!(f.roast || f.milk || f.easy || f.scale === false);
  const lib = S.library;
  if (!lib) {
    // Couldn't read Decaid's profiles: fall back to Crema's guide, as before.
    const list = (S.catalog || []).filter(matches).sort((a, b) => b.popularity - a.popularity);
    $("#catCount").textContent = `${list.length} of ${(S.catalog || []).length}`;
    $("#catalog").innerHTML = list.map((p) => guideCard(p, p.title)).join("");
  } else {
    const shown = lib.filter((p) => (p.guide ? matches(p.guide) : !filtering)).sort((a, b) => (b.guide?.popularity ?? -1) - (a.guide?.popularity ?? -1) || a.title.localeCompare(b.title));
    const dup = (t) => lib.filter((x) => x.title === t).length > 1;
    const missing = (S.catalog || []).filter((p) => p.installed === false && matches(p));
    $("#catCount").textContent = `${shown.length} of ${lib.length} on this machine`;
    $("#catalog").innerHTML = shown.map((p) => p.guide ? guideCard(p.guide, p.id, dup(p.title) ? p.author : "") : `<button class="cat-card" data-p="${esc(p.id)}">
        <div class="row between"><h3>${esc(p.title)}</h3><span class="pill plain">Not in Crema's guide</span></div>
        <div class="muted small">${esc(p.author || "Unknown author")}${p.steps ? ` · ${p.steps} steps` : ""}${dup(p.title) ? ` · ${esc(p.id.slice(-6))}` : ""}</div>
        <div class="small">${esc((p.notes || "").slice(0, 140))}</div></button>`).join("")
      + (missing.length ? `<details class="cat-missing"><summary class="muted small">${missing.length} more in Crema's guide that aren't on this machine</summary><div class="small muted">Install them in Decaid to use them: ${missing.map((p) => esc(p.title)).join(", ")}.</div></details>` : "");
  }
  $$("[data-p]").forEach((b) => (b.onclick = () => showProfile(b.dataset.p)));
}
function guideCard(p, key, note = "") {
  return `<button class="cat-card" data-p="${esc(key)}">
      <div class="row between"><h3>${esc(p.title)}</h3>${p.installed === false ? '<span class="pill plain">Not installed</span>' : ""}</div>
      <div class="roastbar" aria-label="Roasts: ${p.roasts.join(", ")}">${ROASTS.map((r) => `<span class="${p.roasts.includes(r) ? "on" : ""}"></span>`).join("")}</div>
      <div class="muted small">${esc(p.author)} · ${esc(p.style)} · ${p.difficulty}${p.milk === "great" ? " · milk" : ""}${note ? ` · ${esc(note)}` : ""}</div>
      <div class="small">${esc(p.character)}</div></button>`;
}
// `key` is a library id (a profile installed in Decaid) or, when Decaid's profiles
// couldn't be read, a catalogue title.
function showProfile(key) {
  const lp = S.library?.find((x) => x.id === key) ?? null;
  const p = lp ? lp.guide : S.catalog.find((x) => x.title === key);
  if (!p) return lp && showInstalledProfile(lp);
  const usable = lp || p.installed !== false;
  openSheet(`<div class="stack" style="gap:4px"><span class="label">${esc(p.author)} · ${esc(p.style)}</span><h2>${esc(p.title)}</h2></div>
    <p>${esc(p.character)}</p>
    <div class="metrics">${[["Dose", fmt1(p.recipe.doseG), "g"], ["Yield", fmt1(p.recipe.yieldG), "g"], ["Temp", fmt1(p.recipe.tempC), "°C"], ["Time", p.recipe.timeS.join("–"), "s"]].map(([k, v, u]) => `<div><span class="label">${k}</span><span class="v">${v}<small class="muted"> ${u}</small></span></div>`).join("")}</div>
    ${profilePlanHtml(lp)}
    <div class="small"><b>Written for:</b> ${p.roasts.join(", ")} roasts · <b>Milk:</b> ${p.milk} · <b>Difficulty:</b> ${p.difficulty}${p.needsScale ? " · works best with a scale" : ""}${p.wantsFlatBurrs ? " · high-extraction flat burrs" : ""}</div>
    <div class="advice small"><div class="label">Author's dial-in guidance</div>${esc(p.dialIn)}</div>
    <div class="muted small">Source: ${esc(p.source)}</div>
    ${lp ? `<div class="row"><button class="btn" id="baglessProfile">Brew without a bag</button></div>` : ""}${S.current && usable ? `<div class="row"><button class="btn primary" id="useProfile">Use for ${esc(S.current.info.name.value)}</button></div>` : !usable ? `<p class="muted small">Not installed in Decaid. Install it there to use it.</p>` : ""}`);
  const bagless = $("#baglessProfile");
  if (bagless) bagless.onclick = () => chooseInstalledProfile(lp, true);
  const u = $("#useProfile");
  if (u) u.onclick = async () => {
    const cands = await S.api.rank(S.current.id).catch(() => []);
    const c = cands.find((x) => x.title === p.title);
    const r = { ...S.current.recipe, profileTitle: p.title, profileId: lp?.id ?? null, doseG: c?.recipe.doseG ?? p.recipe.doseG, yieldG: c?.recipe.yieldG ?? p.recipe.yieldG, tempC: c?.recipe.tempC ?? p.recipe.tempC, targetTimeS: p.recipe.timeS, dialIn: p.dialIn };
    setNextFromRecipe(S.current, r); closeSheet(); location.hash = "#brew"; toast(`${p.title} set for the next shot`);
  };  drawProfilePlan(lp);
}
// An installed profile Crema's guide doesn't know: show what Decaid knows about it.
// Using it starts from your usual dose and the profile's own target weight and first-step
// temperature; there's no time window to judge the shot against.
async function chooseInstalledProfile(lp, withoutBag = false) {
  if (!lp) return toast("Reopen Profiles to choose an installed profile");
  if (lp.manual) {
    S.machineInfo = await S.api.machine.info().catch(() => null);
    if (S.machineInfo?.GHC !== true) return toast("Manual brewing needs a connected group-head controller");
  }
  if (lp.tempC == null || !Number.isFinite(lp.tempC)) return toast("This profile has no usable first-step temperature. Check it in Decaid");
  if (withoutBag) { S.noBag = true; S.current = null; S.ghost = null; local.set("current", NO_BAG); }
  const b = S.current;
  const recipe = { profileTitle: lp.title, profileId: lp.id, profileShape: lp.profileShape, manual: lp.manual, direct: true, doseG: b?.recipe?.doseG ?? S.prefs?.basketDoseG ?? 18, yieldG: lp.targetWeight ?? 0, tempC: lp.tempC, targetTimeS: null };
  setNextFromRecipe(b, recipe); closeSheet(); location.hash = "#brew"; renderNextShot(); renderControls();
  toast(`${lp.title} set for the next shot`);
}
// An installed profile's graph and steps, for its sheet. Drawn first from each step's
// time limit, then redrawn with real timings if a shot with it is found.
function profilePlanHtml(lp) {
  if (!lp?.profile?.steps?.length) return "";
  return `<div class="plan-box"><div class="row between"><span class="label">What it asks the machine for</span><span class="muted small" id="planNote"></span></div>
    <canvas class="plan-chart" id="planChart" role="img" aria-label="Pressure and flow targets of ${esc(lp.title)}, step by step"></canvas>
    <div class="legend small"><span><span class="swatch" style="background:var(--pressure)"></span>Pressure (bar)</span><span><span class="swatch" style="background:var(--flow)"></span>Flow (ml/s)</span><span><span class="swatch" style="background:var(--temp)"></span>Temp (70–100 °C)</span></div>
    <ol class="plan-steps small" id="planSteps"></ol></div>`;
}
function drawProfilePlan(lp) {
  const canvas = $("#planChart");
  if (!canvas) return;
  const unit = (st) => (st.pump === "flow" ? "ml/s" : "bar");
  const draw = (plan, timing) => {
    if (!canvas.isConnected) return;
    const shown = planWindow(plan, 90);
    drawChart(canvas, [], { maxT: Math.max(20, Math.ceil(shown / 10) * 10), plan, weightAxis: false });
    $("#planNote").textContent = plan.timed === "shot"
      ? `Step times from your shot of ${new Date(timing.shot.timestamp).toLocaleDateString([], { day: "numeric", month: "short" })}`
      : `Each step at its time limit${plan.total > shown ? `; first ${shown} s shown` : ""}. Most end sooner.`;
    $("#planSteps").innerHTML = plan.steps.map((st) => `<li><b>${esc(st.name)}</b>: ${st.pump} ${st.smooth ? "ramps to" : "at"} ${fmt1(st.target)} ${unit(st)}${st.tempC != null ? `, ${fmt1(st.tempC)} °C` : ""}, up to ${fmt1(st.limitS)} s${plan.timed === "shot" ? ` (took ${fmt1(st.end - st.start)} s)` : ""}.${st.exit ? ` ${esc(st.exit)}.` : ""}${st.cap ? ` ${esc(st.cap)}.` : ""}</li>`).join("");
  };
  requestAnimationFrame(() => draw(E.profileCurve(lp.profile)));
  planTiming(lp).then((timing) => { if (timing) requestAnimationFrame(() => draw(E.profileCurve(lp.profile, timing.durations), timing)); });
}
function showInstalledProfile(lp) {
  const capable = !lp.manual || S.machineInfo?.GHC === true;
  openSheet(`<div class="stack" style="gap:4px"><span class="label">${esc(lp.author || "Unknown author")} · installed in Decaid</span><h2>${esc(lp.title)}</h2></div>
    ${lp.notes ? `<p>${esc(lp.notes)}</p>` : ""}
    <div class="metrics" style="grid-template-columns:repeat(3,1fr)">${[["Steps", lp.steps || "–", ""], ["Target", lp.targetWeight > 0 ? fmt1(lp.targetWeight) : "Off", "g"], ["First step", lp.tempC == null ? "–" : fmt1(lp.tempC), "°C"]].map(([k, v, u]) => `<div><span class="label">${k}</span><span class="v">${v}<small class="muted"> ${u}</small></span></div>`).join("")}</div>
    ${profilePlanHtml(lp)}
    <p class="muted small">${lp.manual ? `Adjust ${lp.manual} on the physical group-head controller. Profile time limits still apply.${capable ? "" : " A connected machine with a group-head controller is required."}` : "Uses this installed profile's own settings. No recommended time window."}</p>
    <div class="row">${S.current ? `<button class="btn primary" id="useProfile" ${capable ? "" : "disabled"}>Use for ${esc(S.current.info.name.value)}</button>` : ""}<button class="btn" id="baglessProfile" ${capable ? "" : "disabled"}>Brew without a bag</button></div>`);
  const u = $("#useProfile");
  if (u) u.onclick = () => chooseInstalledProfile(lp);
  $("#baglessProfile").onclick = () => chooseInstalledProfile(lp, true);
  drawProfilePlan(lp);
}

/* ================= shots ================= */
const SHOTS_PER_PAGE = 20;
// The coffee record of the bag a shot was pulled from, for the review's context. A shot
// with no bag matches a shelf row with no bag, as it always has.
// A shot with no bag has no coffee info (a bagless row would match any other bagless row).
const bagInfoForShot = (s) => (s.batch ? S.shelf.find((b) => b.batch === s.batch)?.info ?? null : null);
// A shot pulled from another skin may record a bag but no coffee name: name it from the shelf.
const shotCoffee = (s) => s.coffee || S.shelf.find((b) => b.batch && b.batch === s.batch)?.info.name.value || "No coffee recorded";
async function renderShots(more = false) {
  const list = $("#shotList");
  const scrollTop = list.scrollTop;
  if (!more) list.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    const page = await S.api.shotPage(more ? S.shots.length : 0, SHOTS_PER_PAGE);
    S.shots = more ? [...S.shots, ...page.items.filter((x) => !S.shots.some((s) => s.id === x.id))] : page.items;
    S.shotsTotal = page.total;
  } catch (e) {
    // A failed load isn't an empty history.
    list.innerHTML = `<p class="muted">Couldn't load your shots (${esc(e.message)}).</p><button class="btn" id="retryShots">Try again</button>`;
    $("#retryShots").onclick = () => renderShots(); $("#shotDetail").innerHTML = ""; return;
  }
  renderShotList(scrollTop);
}
function renderShotList(scrollTop = $("#shotList").scrollTop) {
  const list = $("#shotList");
  if (!S.shots.length) { list.innerHTML = `<p class="muted">No shots yet.</p>`; $("#shotDetail").innerHTML = ""; return; }
  if (!S.shots.some((s) => s.id === S.selShot)) S.selShot = S.shots[0].id;
  list.innerHTML = S.shots.map((s, i) => `<div class="shot-row ${s.id === S.selShot ? "sel" : ""} ${s.id === S.cmpShot ? "cmp" : ""}">
      <input type="checkbox" data-cmp="${esc(s.id)}" ${s.id === S.cmpShot ? "checked" : ""} aria-label="Compare with this shot" ${s.id === S.selShot ? "disabled" : ""}>
      <canvas data-spark="${i}" aria-hidden="true"></canvas>
      <button class="open" data-open="${esc(s.id)}"><strong>${esc(shotCoffee(s))}</strong>
        <span class="shot-meta"><span>${new Date(s.timestamp).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}</span><span class="num">${fmt1(s.doseG)}→${fmt1(s.yieldG)} g</span><span class="num">${s.timeS ?? "–"} s</span><span data-rating="${esc(s.id)}">${ratingPoints(s.enjoyment) ? starsHtml(s.enjoyment) : "Not rated"}</span>${S.shelf.some((b) => b.bestShotId === s.id) ? '<span class="pill accent">Reference</span>' : ""}</span></button></div>`).join("")
    + (S.shots.length < (S.shotsTotal ?? 0) ? `<button class="btn" id="moreShots">Show more (${S.shotsTotal - S.shots.length} older)</button>` : "");
  list.scrollTop = scrollTop;
  const moreBtn = $("#moreShots"); if (moreBtn) moreBtn.onclick = () => { moreBtn.disabled = true; moreBtn.textContent = "Loading…"; renderShots(true); };
  requestAnimationFrame(() => S.shots.forEach((s, i) => drawChart(list.querySelector(`[data-spark="${i}"]`), s.points, { compact: true, maxT: 50, maxW: 60 })));
  $$("[data-open]").forEach((b) => (b.onclick = () => { S.selShot = b.dataset.open; if (S.cmpShot === S.selShot) S.cmpShot = null; renderShotList(); list.querySelector(`[data-open="${CSS.escape(S.selShot)}"]`)?.focus({ preventScroll: true }); }));
  $$("[data-cmp]").forEach((b) => (b.onchange = () => { const id = b.dataset.cmp; S.cmpShot = b.checked ? id : null; renderShotList(); list.querySelector(`[data-cmp="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }); }));
  renderShotDetail();
}
function renderShotDetail() {
  const s = S.shots.find((x) => x.id === S.selShot), c = S.shots.find((x) => x.id === S.cmpShot);
  if (!s) { $("#shotDetail").innerHTML = ""; return; }
  const detail = $("#shotDetail"), changedShot = detail.dataset.shotId !== s.id, scrollTop = detail.scrollTop;
  detail.dataset.shotId = s.id;
  const bean = S.shelf.find((b) => b.id === s.beanId || (s.batch && b.batch === s.batch));
  $("#shotDetail").innerHTML = `
    <div class="row between"><div><span class="label">${esc(new Date(s.timestamp).toLocaleString())}</span><h2>${esc(s.coffee || "Shot")}</h2></div><span class="muted small">${esc(s.profileTitle || "")}</span></div>
    ${metricsHtml(shotMetrics(s.points, s))}
    <div class="chart-box"><canvas id="detailChart"></canvas></div>
    <div class="legend">${legendHtml(false)}${c ? `<span><span class="swatch" style="background:var(--muted)"></span>Faint: ${esc(c.coffee || "")} ${new Date(c.timestamp).toLocaleDateString()}</span>` : ""}</div>
    <div class="row"><span class="label">Rating</span>${starsHtml(s.enjoyment, "detailStars")}</div>
    <div class="field"><label class="label" for="shotNotes">Notes</label><input type="text" id="shotNotes" value="${esc(s.notes || "")}" placeholder="How did it taste?"></div>
    ${s.manual ? "" : tasteScalesHtml(s.taste, { sourBitter: "detailSb", body: "detailBody" })}
    <div class="row">${bean ? `<button class="btn" id="pinDetail">${bean.bestShotId === s.id ? "Remove as reference" : "Make this the reference shot"}</button>` : ""}<span class="muted small">Uploads to Visualizer through Decaid's Visualizer plugin (Settings).</span></div>
    <div class="row"><button class="btn primary" id="reviewDetail">${s.review ? "Review again" : "Review shot"}</button></div>
    <div id="detailReview">${reviewHtml(s.review)}</div>`;
  detail.scrollTop = changedShot ? 0 : scrollTop;
  requestAnimationFrame(() => drawChart($("#detailChart"), s.points, { maxT: Math.max(40, Math.ceil(Math.max(s.timeS || 0, c?.timeS || 0) / 10) * 10), maxW: Math.max(50, (s.yieldG || 36) + 10), ghost: c?.points }));
  bindStars($("#detailStars"), s.enjoyment, async (n) => {
    const before = s.enjoyment;
    const draw = () => {
      const row = $$("[data-rating]").find((x) => x.dataset.rating === s.id);
      if (row) row.innerHTML = s.enjoyment ? starsHtml(s.enjoyment) : "Not rated";
    };
    s.enjoyment = n; draw();
    // On failure, put the old rating back in the list and redraw the detail's stars.
    await attempt("save the rating", () => S.api.annotate(s.id, { enjoyment: n }), () => { s.enjoyment = before; draw(); if (S.selShot === s.id) renderShotDetail(); });
  });
  $("#shotNotes").onchange = async (e) => {
    const before = s.notes, text = e.target.value;
    try { await S.api.annotate(s.id, { espressoNotes: text }); s.notes = text; toast("Notes saved"); }
    catch (err) { s.notes = before; toast(`Couldn't save the notes: ${failText(err)}. They're still in the box`); }
  };
  bindTasteScales(s, { sourBitter: "detailSb", body: "detailBody" });
  bindReviewButton(s, { buttonSel: "#reviewDetail", boxSel: "#detailReview", manual: s.manual, isCurrent: () => S.selShot === s.id });
  const pin = $("#pinDetail");
  if (pin) pin.onclick = async () => { if (await setReference(bean, bean.bestShotId === s.id ? null : s.id)) renderShotList(); };
}

/* ================= settings ================= */
function sw(id, checked) { return `<label class="switch"><input type="checkbox" id="${id}" ${checked ? "checked" : ""}><span></span></label>`; }
// Decaid 0.9.1 REST: sleep 0..240 (0 disables idle sleep). DE1 fan MMR:
// 0..50, also enforced by installed Streamline 0.2.23. Decaid's water-level
// form uses 0..30 mm. These are edit limits, never replacement machine defaults.
const SETTING_LIMITS = { sFan: [0, 50, 1], sSleepMin: [0, 240, 1], sWaterWarn: [0, 30, 1], gStart: [-100, 1000, 0.01] };
function settingNumber(value, limits) {
  if (value == null || String(value).trim() === "" || !Number.isFinite(Number(value))) throw new Error("Enter a number");
  const n = Number(value);
  return limits ? clamp(round(n, limits[2]), limits[0], limits[1]) : n;
}
function mini(id, value, stepV, unit) {
  const available = value != null && Number.isFinite(Number(value)), limits = SETTING_LIMITS[id];
  const disabled = available ? "" : "disabled";
  return `<div class="mini"><button type="button" data-mini="${id}:-${stepV}" aria-label="Less" ${disabled}>−</button><input id="${id}" type="number" step="${stepV}" ${limits ? `min="${limits[0]}" max="${limits[1]}"` : ""} inputmode="decimal" value="${available ? value : ""}" placeholder="Unavailable" aria-label="${unit}" ${disabled}><button type="button" data-mini="${id}:${stepV}" aria-label="More" ${disabled}>+</button></div>`;
}
function seg(id, options, value) { return `<div class="seg" id="${id}">${options.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${String(v) === String(value)}">${l}</button>`).join("")}</div>`; }
async function renderSettings() {
  const el = $("#settings");
  el.innerHTML = `<p class="muted">Loading…</p>`;
  const m = S.api.machine;
  const [wf, ms, pres, scheds, disp, plugins, maint] = await Promise.all([m.workflowSettings.get().catch(() => null), m.settings.get().catch(() => null), m.presence.get().catch(() => null), m.schedules.list().catch(() => []), m.display.get().catch(() => null), m.plugins().catch(() => []), S.api.maintenance.get().catch(() => null)]);
  S.maint = maint;
  const p = S.prefs, theme = local.get("theme", "auto");
  S.appSettings = await S.api.settings.get().catch(() => S.appSettings);
  const ai = { enabled: S.appSettings?.aiEnabled !== false }, grind = grindSettings();
  const viz = plugins.find((x) => /visualizer/i.test(x.id));
  const DAYS = ["M", "T", "W", "T", "F", "S", "S"];
  el.innerHTML = `
  <div class="panel stack"><h2>Your setup</h2><p class="muted small">Used to match profiles to your coffee.</p>
    <div class="set-row first"><span>How you drink it</span>${seg("pDrink", [["straight", "Straight"], ["milk", "Milk"], ["both", "Both"]], p.drink ?? "both")}</div>
    <div class="set-row"><span>Bluetooth scale<span class="hint">Needed for D-Flow, A-Flow, blooming and allongé profiles</span></span>${sw("pScale", p.hasScale !== false)}</div>
    <div class="set-row"><span>Grinder burrs</span>${seg("pBurrs", [["flat", "Flat"], ["conical", "Conical"], ["unknown", "Not sure"]], p.burrs ?? "unknown")}</div>
    <div class="set-row"><span>Grind to start from<span class="hint">For a coffee with no grind saved yet</span></span>${mini("gStart", grind.start, grind.step, "grind setting")}</div>
    <div class="set-row"><span>Grind step<span class="hint">How far one tap of − or + moves the grind</span></span>${seg("gStep", E.GRIND_STEPS.map((v) => [v, String(v)]), grind.step)}</div>
    <div class="set-row"><span>Experience</span>${seg("pExp", [["new", "New"], ["comfortable", "Comfortable"], ["advanced", "Advanced"]], p.experience ?? "comfortable")}</div>
    <div class="set-row"><span>Basket dose<span class="hint">Grams your basket holds</span></span>${mini("pDose", p.basketDoseG ?? 18, 0.5, "grams")}</div>
  </div>

  <div class="panel stack"><h2>Steam, hot water and flush</h2>
    ${wf?.steamSettings ? `<div class="set-row first"><span>Steam temperature<span class="hint">135–160 °C</span></span>${mini("sSteamT", wf.steamSettings.targetTemperature, 5, "°C")}</div>
    <div class="set-row"><span>Steam flow<span class="hint">ml/s. Higher steams faster</span></span>${mini("sSteamF", wf.steamSettings.flow, 0.1, "ml/s")}</div>` : ""}
    ${wf?.hotWaterData ? `<div class="set-row"><span>Hot water temperature</span>${mini("sWaterT", wf.hotWaterData.targetTemperature, 1, "°C")}</div>
    <div class="set-row"><span>Hot water flow</span>${mini("sWaterF", wf.hotWaterData.flow, 0.5, "ml/s")}</div>` : ""}
    ${wf?.rinseData ? `<div class="set-row"><span>Flush flow</span>${mini("sFlushF", wf.rinseData.flow, 0.5, "ml/s")}</div>
    <div class="set-row"><span>Flush temperature</span>${mini("sFlushT", wf.rinseData.targetTemperature, 1, "°C")}</div>` : ""}
    <div class="set-row"><span>Presets<span class="hint">Steam jugs, hot water volumes and flush times on the home screen</span></span><button class="btn small" id="editPresets">Edit presets</button></div>
    ${!wf ? '<p class="muted">The machine isn\'t reachable right now.</p>' : ""}
  </div>

  <div class="panel stack"><h2>Machine</h2>
    <div class="set-row first"><span>Use only the machine's start buttons<span class="hint">Disables Crema's Espresso, Steam, Hot water and Flush buttons on this device. The group-head controls always work; Stop stays available</span></span>${sw("sGhc", S.ghc)}</div>
    <div class="set-row"><span>Refill warning level<span class="hint">Water height in mm, as reported by Decaid</span></span>${mini("sWaterWarn", S.water?.refillLevel, 5, "mm")}</div>
    ${ms ? `<div class="set-row"><span>Tablet USB charging</span>${sw("sUsb", ms.usb === true || ms.usb === "enable")}</div>
    <div class="set-row"><span>Fan threshold<span class="hint">Current Decaid value. DE1 accepts 0–50 °C; Crema does not set a default</span></span>${mini("sFan", ms.fan, 5, "°C")}</div>` : ""}
  </div>

  <div class="panel stack"><h2>Sleep and wake</h2>
    ${pres ? `<div class="set-row first"><span>Sleep when idle</span>${sw("sPresence", pres.userPresenceEnabled)}</div>
    <div class="set-row"><span>After<span class="hint">0–240 minutes without use. 0 turns off the idle sleep timer</span></span>${mini("sSleepMin", pres.sleepTimeoutMinutes, 5, "minutes")}</div>` : ""}
    <span class="label">Wake schedules</span>
    <div class="stack" style="gap:6px" id="scheds">${scheds.map((s) => `<div class="sched"><span class="num">${esc(s.time)}</span><div class="days">${DAYS.map((d, i) => `<button type="button" data-day="${esc(s.id)}:${i + 1}" aria-pressed="${!s.daysOfWeek.length || s.daysOfWeek.includes(i + 1)}">${d}</button>`).join("")}</div>${sw(`en-${s.id}`, s.enabled)}<button class="btn small ghost" data-del="${esc(s.id)}">Remove</button></div>`).join("") || '<p class="muted small">None yet.</p>'}</div>
    <div class="row"><div class="field" style="flex:1"><label class="label" for="newWake">Add a wake time</label><input type="time" id="newWake" value="06:45"></div><button class="btn" id="addWake" style="align-self:end">Add</button></div>
  </div>

  <div class="panel stack"><h2>Display</h2><p class="muted small">Theme and clock choices are saved on this device. Machine settings are shared through Decaid.</p>
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
    ${ai.enabled ? `<div class="set-row"><span>Speaking a description<span class="hint" id="voiceHint">${esc(voiceHint())}</span></span>${inDecaid() ? "" : seg("sVoice", [["gemini", "Gemini"], ["device", "This device"]], voicePref())}</div>` : ""}
  </div>

  <div class="panel stack"><h2>Connections</h2>
    <div class="set-row first"><span>Machine<span class="hint">Decaid on the tablet</span></span><span class="num small">${esc(S.api.info.decaidUrl || "")}</span></div>
    <div class="set-row"><span>Crema server<span class="hint">${S.api.demo ? "Simulated in the demo" : S.api.info.server ? `Connected · ${esc(S.api.info.server)}` : S.api.info.serverError ? `Can't reach ${esc(S.api.info.serverError)}` : "Not connected. Optional, for AI features"}</span></span><button class="btn small" id="changeServer">${S.api.demo ? "Connect" : "Change"}</button></div>
    <div class="set-row"><span>Visualizer upload<span class="hint">${viz ? "Decaid's Visualizer plugin uploads shots. Set your account in Decaid's plugin settings" : "Install Decaid's Visualizer plugin to upload shots"}</span></span>${viz ? '<span class="pill good">Available</span>' : '<span class="pill plain">Not found</span>'}</div>
  </div>
  ${S.api.host.canExit ? `<div class="panel stack"><h2>Decaid</h2>
    <div class="set-row first"><span>Leave Crema<span class="hint">Closes Crema and shows Decaid's dashboard, for scale pairing, plugins and skins. Not while the machine is running</span></span><button class="btn small" id="exitDash" ${exitBlocked() ? "disabled" : ""}>Open Decaid</button></div>
  </div>` : ""}`;

  // ---- wire up ----
  // A new preference changes what's recommended. The coffee on screen is worked out again now;
  // the others have their saved recipe cleared and get a new one when picked.
  const savePrefs = async (patch) => {
    S.prefs = await S.api.prefs.set(patch);
    const hasOthers = S.shelf.some((b) => b.id !== S.current?.id);
    let cleared = true;
    try { await S.api.resetRecipes(S.current?.id ?? null); } catch { cleared = false; }
    for (const b of S.shelf) if (cleared || b.id === S.current?.id) b.recipe = null;
    S.current && (await selectBean(S.current.key, { quiet: true }));
    toast(!hasOthers ? "Saved. Recommendation updated"
      : cleared ? "Saved. This coffee's recommendation is updated, and the others update when you pick them"
      : "Saved. This coffee's recommendation is updated, but the others may keep their old ones");
  };
  const segWire = (id, key) => $$(`#${id} button`).forEach((b) => (b.onclick = () => { $$(`#${id} button`).forEach((x) => x.setAttribute("aria-pressed", String(x === b))); savePrefs({ [key]: b.dataset.v }); }));
  segWire("pDrink", "drink"); segWire("pBurrs", "burrs"); segWire("pExp", "experience");
  $("#pScale").onchange = (e) => savePrefs({ hasScale: e.target.checked });
  const num = (id) => settingNumber($(`#${id}`)?.value, SETTING_LIMITS[id]);
  const handlers = {
    pDose: () => savePrefs({ basketDoseG: num("pDose") }),
    gStart: async () => { S.appSettings = await S.api.settings.set({ grindStart: num("gStart") }); },
    sSteamT: () => setWorkflowSetting("steamSettings", "targetTemperature", num("sSteamT")),
    sSteamF: () => setWorkflowSetting("steamSettings", "flow", num("sSteamF")),
    sWaterT: () => setWorkflowSetting("hotWaterData", "targetTemperature", num("sWaterT")),
    sWaterF: () => setWorkflowSetting("hotWaterData", "flow", num("sWaterF")),
    sFlushF: () => setWorkflowSetting("rinseData", "flow", num("sFlushF")),
    sFlushT: () => setWorkflowSetting("rinseData", "targetTemperature", num("sFlushT")),
    sWaterWarn: () => m.waterThreshold(num("sWaterWarn")),
    sFan: async () => { await m.settings.set({ fan: num("sFan") }); return (await m.settings.get()).fan; },
    sSleepMin: async () => { await m.presence.set({ sleepTimeoutMinutes: num("sSleepMin") }); return (await m.presence.get()).sleepTimeoutMinutes; },
    mBack: () => S.api.maintenance.set({ backflushEveryShots: num("mBack") }),
    mDesc: () => S.api.maintenance.set({ descaleEveryDays: num("mDesc") }),
  };
  for (const [id, fn] of Object.entries(handlers)) {
    const input = $(`#${id}`); if (!input) continue;
    let saved = input.value, saving = false;
    const run = async () => {
      if (saving) return;
      const buttons = $$(`[data-mini^="${id}:"]`);
      saving = true; input.disabled = true; buttons.forEach((b) => (b.disabled = true));
      try {
        input.value = String(num(id));
        const actual = await fn();
        if (id === "sFan" || id === "sSleepMin") {
          if (actual == null || !Number.isFinite(Number(actual))) throw new Error("Decaid didn't return the saved value");
          input.value = String(actual);
        }
        saved = input.value;
        if (!id.startsWith("p")) toast("Saved");
      } catch (e) { input.value = saved; toast(`Couldn't save: ${e.message}`); }
      finally { saving = false; input.disabled = false; buttons.forEach((b) => (b.disabled = false)); }
    };
    input.onchange = run;
    $$(`[data-mini^="${id}:"]`).forEach((b) => (b.onclick = () => { if (saving || input.disabled) return; const d = Number(b.dataset.mini.split(":")[1]); const dp = (x) => (String(Math.abs(x)).split(".")[1] ?? "").length, places = Math.min(3, Math.max(dp(d), dp(Number(input.value)))); input.value = String(+(Number(input.value) + d).toFixed(places)); run(); }));
  }
  $$("#gStep button").forEach((b) => (b.onclick = async () => {
    const v = Number(b.dataset.v);
    $$("#gStep button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    try {
      S.appSettings = await S.api.settings.set({ grindStep: v });
      $$('[data-mini^="gStart:"]').forEach((x) => (x.dataset.mini = `gStart:${x.dataset.mini.includes("-") ? -v : v}`));
      $("#gStart").step = String(v);
      toast("Saved");
    } catch (e) { toast(`Couldn't save: ${e.message}`); renderSettings(); }
  }));
  $("#sGhc").onchange = (e) => { S.ghc = e.target.checked; local.set("ghc", S.ghc); renderControls(); };
  // A switch that can't be saved goes back to where it was.
  const flip = (el) => () => { el.checked = !el.checked; };
  const usb = $("#sUsb"); if (usb) usb.onchange = async (e) => { if (await attempt("save USB charging", () => m.settings.set({ usb: e.target.checked ? "enable" : "disable" }), flip(e.target))) toast("Saved"); };
  const pr = $("#sPresence"); if (pr) pr.onchange = async (e) => { if (await attempt("save sleep when idle", () => m.presence.set({ userPresenceEnabled: e.target.checked }), flip(e.target))) toast("Saved"); };
  $("#sSaver").onchange = (e) => { S.saver = e.target.checked; local.set("saver", S.saver); updateSaver(); };
  $$("#sVoice button").forEach((b) => (b.onclick = () => {
    local.set("voice", b.dataset.v);
    // Choosing again retries a microphone that was refused earlier.
    local.set("micDenied", false); local.set("speechDenied", false); micBroken = speechBroken = false;
    $$("#sVoice button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    $("#voiceHint").textContent = voiceHint();
    toast("Saved on this device");
  }));
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
    s.daysOfWeek = days.sort();
    // On failure, draw again from Decaid's schedules, not from the edit that didn't take.
    if (await attempt("change the wake days", () => m.schedules.update(id, { daysOfWeek: s.daysOfWeek }), renderSettings)) renderSettings();
  }));
  scheds.forEach((s) => { const t = $(`#en-${CSS.escape(s.id)}`); if (t) t.onchange = (e) => attempt("change the wake schedule", () => m.schedules.update(s.id, { enabled: e.target.checked }), flip(e.target)); });
  $$("[data-del]").forEach((b) => (b.onclick = async () => { if (await attempt("remove the wake time", () => m.schedules.remove(b.dataset.del))) renderSettings(); }));
  $("#addWake").onclick = async () => { const t = $("#newWake").value; if (!t) return; if (await attempt("add the wake time", () => m.schedules.add({ time: t, daysOfWeek: [1, 2, 3, 4, 5], enabled: true }))) { toast(`Wakes at ${t} on weekdays`); renderSettings(); } };
  const markDone = (kind, noun) => async () => {
    if (!(await attempt(`record the ${noun}`, () => S.api.maintenance.done(kind)))) return;
    S.maint = await S.api.maintenance.get(); renderStatus(); renderSettings(); toast(`${noun[0].toUpperCase()}${noun.slice(1)} recorded`);
  };
  const db = $("#doneBackflush"); if (db) db.onclick = markDone("backflush", "backflush");
  const dd = $("#doneDescale"); if (dd) dd.onclick = markDone("descale", "descale");
  $("#editPresets").onclick = editPresets;
  $("#changeServer").onclick = () => connectSheet();
  const ex = $("#exitDash"); if (ex) ex.onclick = exitToDashboard;
  $("#sAi").onchange = async (e) => {
    try { S.appSettings = await S.api.settings.set({ aiEnabled: e.target.checked }); } catch (err) { renderSettings(); return toast(`Couldn't save: ${failText(err)}`); }
    renderStatus(); renderSettings();
    toast(e.target.checked ? "AI features on" : "AI features off. Crema uses its rules");
  };
}
function aiHint(ai) {
  if (!ai.enabled) return "Off. Add coffees by typing the details, and Crema picks profiles and dial-in steps with its rules";
  if (S.api.demo) return "Identifies coffees from photos, descriptions and links, picks profiles and gives dial-in advice. Simulated in the demo";
  if (!S.api.ai.available) return "Needs a Crema server, which isn't connected. Crema uses its rules until then";
  if (!S.api.ai.healthy) return "The Crema server isn't answering, so Crema is using its rules for now";
  return "Identifies coffees from photos, descriptions and links, picks profiles and gives dial-in advice. Falls back to the rules if it fails";
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
  frame.src = `${location.pathname}?embed&demo${/[?&]stress\b/.test(location.search) ? "&stress" : ""}${location.hash}`;
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
  document.body.classList.toggle("on-shots", v === "shots");
  document.body.classList.toggle("pouring", v === "brew" && shotRunning());
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
  // Machine streams first: readings and Stop mustn't wait for settings, the shelf or
  // a recipe (which can mean an AI call).
  S.streams = S.api.subscribe({
    lost: onStreamLost,
    snapshot: onSnapshot,
    scale: (s) => { S.scale = { ...S.scale, ...s }; renderStatus(); if (!$("#view-brew").hidden) renderReadouts(); },
    water: (w) => { S.water = w; renderStatus(); },
    ready: (r) => { S.ready = r; },
    devices: onDevices,
  });
  setInterval(checkStaleReadings, 5000);
  document.addEventListener("visibilitychange", checkStaleReadings);
  // Show the Brew screen (readings, Stop) now; the rest of it fills in as data arrives.
  if (!location.hash || location.hash === "#brew") route(false);
  S.appSettings = await S.api.settings.get().catch(() => null);
  S.machineInfo = await S.api.machine.info().catch(() => null);
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
  $("#speakBtn").onclick = () => (listening ? stopListening(true) : startListening());
  $("#describeInput").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#identifyBtn").click(); } });
  $("#railSleep").onclick = $("#phoneSleep").onclick = sleepWake;
  $("#saver").onclick = () => { $("#saver").hidden = true; S.api.machine.setState("idle").catch(() => {}); };
  $("#sheetBack").onclick = (e) => { if (e.target === $("#sheetBack")) closeSheet(); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

  const [prefs, favs, presets, maint] = await Promise.all([S.api.prefs.get().catch(() => ({})), S.api.favourites.get().catch(() => S.favourites), S.api.presets.get().catch(() => null), S.api.maintenance.get().catch(() => null)]);
  Object.assign(S, { prefs, favourites: favs, presets, maint });
  await refreshShelf().then(() => (S.shelfError = null), (e) => { S.shelf = []; S.shelfError = e.message; });
  S.shelfLoaded = true;
  // Start on the coffee the machine holds, if it's on the shelf, then take its recipe.
  const onMachine = await S.api.machine.recipe?.().catch(() => null);
  const machineBean = onMachine?.batchId && S.shelf.find((b) => b.batch === onMachine.batchId);
  await selectBean(local.get("current", null) === NO_BAG ? NO_BAG : machineBean?.key || local.get("current", null) || S.shelf[0]?.key, { quiet: true });
  await reconcileWorkflow({ boot: true });
  const recheck = () => {
    if (document.visibilityState !== "visible") return;
    void syncShelf(true);
    void reconcileWorkflow();
  };
  document.addEventListener("visibilitychange", recheck);
  window.addEventListener("focus", recheck);
  setInterval(recheck, 60000);
  setInterval(() => { if (document.visibilityState === "visible") void syncShelf(); }, 5000);

  window.addEventListener("hashchange", () => { if (location.hash !== "#add") stopListening(false); route(); });
  window.addEventListener("crema:ai", () => renderStatus());
  window.addEventListener("resize", () => { if (!$("#view-brew").hidden) renderLive(); });
  renderStatus(); renderAlerts();
  route();
}
boot();
