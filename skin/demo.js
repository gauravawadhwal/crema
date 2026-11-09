/* Crema demo backend: the same interface as the live API (see app.js), backed
   by an in-browser simulated DE1 + scale and the coffees in demo-data.js, which
   were identified and matched by the real Crema pipeline. */
"use strict";

function packshot({ roaster, name, origin, bag, label, ink, accent }) {
  const n = name.replace(/, .*$/, "");
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 480">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="#f4f2ee"/><stop offset="1" stop-color="#d9d6d0"/></radialGradient>
    <linearGradient id="sh" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".18"/><stop offset=".22" stop-color="#fff" stop-opacity=".12"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient>
  </defs>
  <rect width="400" height="480" fill="url(#bg)"/>
  <ellipse cx="200" cy="438" rx="128" ry="14" fill="#000" opacity=".16"/>
  <path d="M92 70 L308 70 L318 96 L322 418 Q322 432 308 432 L92 432 Q78 432 78 418 L82 96 Z" fill="${bag}"/>
  <path d="M92 70 L308 70 L310 84 L90 84 Z" fill="#000" opacity=".18"/>
  <path d="M92 70 L308 70 L318 96 L322 418 Q322 432 308 432 L92 432 Q78 432 78 418 L82 96 Z" fill="url(#sh)"/>
  <circle cx="200" cy="122" r="11" fill="#000" opacity=".22"/><circle cx="200" cy="122" r="6" fill="#fff" opacity=".18"/>
  <rect x="112" y="168" width="176" height="200" rx="6" fill="${label}"/>
  <text x="200" y="206" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="13" letter-spacing="2.5" font-weight="700" fill="${accent}">${esc(roaster.toUpperCase())}</text>
  <line x1="140" y1="222" x2="260" y2="222" stroke="${ink}" stroke-opacity=".25"/>
  <text x="200" y="${n.length > 13 ? 262 : 270}" text-anchor="middle" font-family="Georgia, serif" font-size="${n.length > 16 ? 18 : n.length > 13 ? 22 : 30}" fill="${ink}">${esc(n)}</text>
  <text x="200" y="300" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="12" letter-spacing="1.5" fill="${ink}" fill-opacity=".7">${esc(String(origin || "").toUpperCase().slice(0, 26))}</text>
</svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function makeDemoApi() {
  const D = window.CREMA_DEMO;
  const CE = window.CremaEngine;
  const titles = D.catalog.map((p) => p.title);
  const DAY = 864e5;
  const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const clone = (x) => JSON.parse(JSON.stringify(x));

  let prefs = { drink: "both", hasScale: true, burrs: "unknown", experience: "comfortable", basketDoseG: 18 };
  const all = D.beans.map((b) => {
    const info = clone(b.info);
    info.roastDate = { value: iso(b.daysAgo), source: "bag" };
    info.weightGrams = b.weight;
    const art = packshot({ roaster: info.roaster.value.replace(/ Coffee$/, ""), name: info.name.value, origin: info.country.value, ...b.pack });
    info.imageUrl = art;
    return { ...b, info, productImage: art, art: "product", frozen: false, finished: false, bestShotId: null, recipe: null, recipeSource: null };
  });
  let aiEnabled = true;
  // The AI recipes in demo-data.js are from real runs. With AI off, or for a coffee typed in by hand, the browser rules decide, as they do live.
  const rulesFor = (b) => {
    const ranked = CE.rankProfiles(b.info, prefs, titles);
    return { recipe: CE.rulesRecipe({ bean: b.info, preferences: prefs, profileTitles: titles }, ranked), source: "rules", candidates: ranked.slice(0, 8).map(CE.strip) };
  };
  const recipeFor = (b) => {
    if (!aiEnabled || !b.byDrink) return rulesFor(b);
    const r = b.byDrink[prefs.drink] || b.byDrink.both;
    return { recipe: clone(r.recipe), source: r.source, candidates: r.ranking };
  };
  for (const b of all) {
    const r = recipeFor(b);
    b.recipe = r.recipe;
    b.recipeSource = r.source;
  }
  const shelf = () => all.filter((b) => b.shelf && !b.finished);

  // ---------- simulated machine ----------
  const sim = {
    state: "idle", substate: "idle", group: 92.6, steamTemp: 150, water: 46, refill: 7,
    scale: 0, scaleOffset: 0, battery: 84, live: { p: 0, f: 0, tp: 0, tf: 0, t: 0 }, timer: null, samples: [], heatLeft: 0,
  };
  // Steam, hot water and flush, shaped like Decaid's workflow fields. Kept apart from
  // `workflow` below because loading a recipe replaces that.
  const wf = {
    steamSettings: { targetTemperature: 150, duration: 25, flow: 1.5, stopAtTemperature: 0 },
    hotWaterData: { targetTemperature: 85, duration: 60, volume: 120, flow: 6 },
    rinseData: { targetTemperature: 88, duration: 5, flow: 6 },
  };
  let settings = { usb: false, fan: 50, tankTemp: 0 };
  let presence = { userPresenceEnabled: true, sleepTimeoutMinutes: 30 };
  const schedules = [{ id: "w1", time: "06:45", daysOfWeek: [1, 2, 3, 4, 5], enabled: true }, { id: "w2", time: "08:30", daysOfWeek: [6, 7], enabled: true }];
  let display = { brightness: 80, platformSupported: { brightness: true } };
  let workflow = { profile: { title: all[0].recipe.profileTitle }, context: { targetDoseWeight: 18, targetYield: 36, beanBatchId: all[0].batch } };
  let presets = {
    steam: [{ label: "Cortado", seconds: 15 }, { label: "Flat white", seconds: 25 }, { label: "Latte", seconds: 35 }, { label: "Manual", seconds: 0 }],
    water: [{ label: "Rinse", ml: 60 }, { label: "Long black", ml: 120 }, { label: "Tea", ml: 250 }],
    flush: [{ label: "3 s", seconds: 3 }, { label: "5 s", seconds: 5 }, { label: "8 s", seconds: 8 }],
    selected: { steam: 1, water: 1, flush: 1 },
  };
  let favourites = [null, null, null, null, null];
  let maintenance = { backflushEveryShots: 100, descaleEveryDays: 90, lastBackflush: iso(9), lastDescale: iso(76) };
  const listeners = [];
  const emit = (kind, data) => listeners.forEach((l) => l[kind] && l[kind](data));
  const isLever = (t) => /londinium|lrv|lever|leva|cremina|80's|forge|gentle/i.test(t || "");

  // ---------- shot history ----------
  const shots = [];
  function curve(target, seconds, lever, seed) {
    const pts = []; let w = 0;
    const rnd = (i) => Math.sin(seed * 977 + i * 12.9898) * 0.5;
    const pi = lever ? 9 : 7;
    for (let t = 0; t <= seconds; t += 0.25) {
      let p, f;
      if (t < pi) { p = Math.min(lever ? 4 : 3, t * 0.7); f = Math.max(1, 4 - t * 0.45); }
      else if (t < pi + 2) { p = 3 + (t - pi) * 3; f = 1.5; }
      else { p = lever ? Math.max(4, 9 - (t - pi - 2) * 0.28) : Math.max(5.5, 8.9 - (t - pi - 2) * 0.13); f = 1.7 + Math.sin(t / 4) * 0.12 + (t - pi) * 0.025; }
      p += rnd(t * 4) * 0.1; f += rnd(t * 7) * 0.05;
      if (t > pi - 1) w = Math.min(target, w + Math.max(0, f) * 0.25 * 0.93);
      pts.push({ t, p: Math.max(0, p), f: Math.max(0, f), w, temp: 92.4 + rnd(t) * 0.3, tp: t < pi ? 3 : 9, tf: t < pi ? 4 : 2 });
    }
    return pts;
  }
  const onShelf = all.filter((b) => b.shelf);
  const history = [[0, 2, 31, 8], [0, 26, 27, 7], [1, 5, 30, 9], [1, 29, 34, 10], [4, 50, 29, 8], [4, 52, 32, 6], [2, 74, 28, 7], [5, 98, 30, 8], [3, 120, 33, 9], [5, 140, 36, 4]];
  history.forEach(([bi, hoursAgo, secs, rating], i) => {
    const b = onShelf[bi % onShelf.length], r = b.recipe;
    shots.push({
      id: `s${i}`, timestamp: new Date(Date.now() - hoursAgo * 36e5).toISOString(), beanId: b.id, batch: b.batch,
      coffee: b.info.name.value, roaster: b.info.roaster.value, profileTitle: r.profileTitle, doseG: r.doseG,
      yieldG: r.yieldG - 0.4 + (i % 3) * 0.3, timeS: secs, enjoyment: rating, notes: "", points: curve(r.yieldG, secs, isLever(r.profileTitle), i + 1),
    });
  });
  onShelf[0].bestShotId = "s1";

  function stop(next = "idle") {
    clearInterval(sim.timer); sim.timer = null;
    const was = sim.state;
    if (was === "espresso" && sim.samples.length > 20) {
      const b = all.find((x) => x.batch === workflow.context.beanBatchId) || all[0];
      const last = sim.samples.at(-1);
      shots.push({ id: `s${shots.length}`, timestamp: new Date().toISOString(), beanId: b.id, batch: b.batch, coffee: b.info.name.value, roaster: b.info.roaster.value, profileTitle: workflow.profile.title, doseG: workflow.context.targetDoseWeight, yieldG: Math.round(last.w * 10) / 10, timeS: Math.round(last.t), enjoyment: null, notes: "", points: sim.samples.slice() });
      b.used += workflow.context.targetDoseWeight;
    }
    sim.state = next; sim.substate = "idle";
    sim.live = { p: 0, f: 0, tp: 0, tf: 0, t: 0 };
    snapshot(was === "espresso" && sim.samples.length > 20 ? shots.at(-1).id : null);
  }

  function run(state) {
    if (sim.state === "sleeping") return;
    if (sim.water <= sim.refill) { sim.state = "needsWater"; snapshot(); return; }
    if (sim.timer) stop();
    sim.state = state; sim.samples = [];
    const target = Number(workflow.context.targetYield || 36);
    const lever = isLever(workflow.profile.title);
    const pi = lever ? 9 : 7;
    const limit = state === "steam" ? (wf.steamSettings.duration || 600) : state === "hotWater" ? wf.hotWaterData.volume / wf.hotWaterData.flow : state === "flush" ? wf.rinseData.duration : 120;
    let t = 0;
    if (state === "espresso") sim.scaleOffset = sim.scale;
    const speed = state === "espresso" ? 3 : 1; // espresso runs 3× faster in the demo; steam, water and flush run in real time
    sim.timer = setInterval(() => {
      t += 0.1 * speed;
      let p = 0, f = 0;
      if (state === "espresso") {
        if (t < pi) { p = Math.min(lever ? 4 : 3, t * 0.7); f = Math.max(1, 4 - t * 0.45); sim.substate = "preinfusion"; }
        else if (t < pi + 2) { p = 3 + (t - pi) * 3; f = 1.5; sim.substate = "pouring"; }
        else { p = lever ? Math.max(4, 9 - (t - pi - 2) * 0.28) : Math.max(5.5, 9 - (t - pi - 2) * 0.13); f = 1.7 + Math.sin(t / 4) * 0.12 + (t - pi) * 0.025; }
        p += (Math.random() - 0.5) * 0.08; f += (Math.random() - 0.5) * 0.04;
        if (t > pi - 1) sim.scale += Math.max(0, f) * 0.1 * speed * 0.93;
        sim.live = { p, f, tp: t < pi ? 3 : 9, tf: t < pi ? 4 : 2, t };
        const w = sim.scale - sim.scaleOffset;
        sim.samples.push({ t, p, f, w, temp: sim.group - 0.3, tp: sim.live.tp, tf: sim.live.tf });
        if (w >= target - 1.2 || t > 60) { sim.substate = "pouringDone"; return stop(); }
      } else if (state === "steam") {
        p = 1.9 + Math.random() * 0.2; f = settings.steamFlow; sim.steamTemp = Math.max(135, sim.steamTemp - 0.08); sim.substate = "pouring";
        sim.live = { p, f, tp: 0, tf: 0, t };
      } else {
        f = state === "hotWater" ? settings.hotWaterFlow : settings.flushFlow; p = 0.3;
        if (state === "hotWater") sim.scale += f * 0.1 * speed;
        sim.live = { p, f, tp: 0, tf: 0, t };
      }
      sim.water = Math.max(0, sim.water - (f * 0.1 * speed) / 40);
      snapshot();
      if (state !== "espresso" && t >= limit) stop();
    }, 100);
  }

  function snapshot(finished = null) {
    emit("snapshot", {
      state: { state: sim.state, substate: sim.substate },
      pressure: sim.live.p, flow: sim.live.f, targetPressure: sim.live.tp, targetFlow: sim.live.tf,
      mixTemperature: sim.group - (sim.state === "espresso" ? 0.3 : 0), groupTemperature: sim.group, targetGroupTemperature: 92.8,
      steamTemperature: sim.steamTemp, elapsed: sim.live.t, finished,
    });
  }
  setInterval(() => {
    if (sim.state === "heating") {
      sim.group = Math.min(92.8, sim.group + 1.2);
      if (sim.group >= 92.8) sim.state = "idle";
      emit("ready", sim.state === "heating" ? { status: "heating", remainingTimeMs: ((92.8 - sim.group) / 1.2) * 1000 } : { status: "reached" });
    } else if (sim.state === "sleeping") { sim.group = Math.max(30, sim.group - 1.5); emit("ready", { status: "not_heating" }); }
    else if (sim.state === "idle") { sim.group = 92.5 + Math.random() * 0.3; sim.steamTemp = Math.min(150, sim.steamTemp + 0.6); }
    if (!sim.timer) snapshot();
    emit("water", { currentLevel: Math.round(sim.water), refillLevel: sim.refill });
    emit("scale", { connected: true, weight: Math.round((sim.scale - sim.scaleOffset) * 10) / 10, batteryLevel: sim.battery });
  }, 1000);
  setInterval(() => { if (sim.timer) emit("scale", { connected: true, weight: Math.round((sim.scale - sim.scaleOffset) * 10) / 10, batteryLevel: sim.battery }); }, 200);

  // One entry per bag; a coffee's bags share its id (and its recipe and reference shot).
  const byId = (id) => all.find((b) => b.id === id);
  const byBag = (id, batch) => (batch && all.find((b) => b.id === id && b.batch === batch)) || byId(id);
  const sameCoffee = (id) => all.filter((b) => b.id === id);
  const shelfItem = (b) => ({
    key: b.batch, id: b.id, batch: b.batch, info: b.info, recipe: b.recipe, recipeSource: b.recipeSource, photo: b.photo || null,
    productImage: b.productImage, art: b.art, weight: b.weight, remaining: Math.max(0, b.weight - b.used),
    frozen: b.frozen, bestShotId: b.bestShotId, shots: shots.filter((s) => (s.batch ? s.batch === b.batch : s.beanId === b.id)).length,
    bags: shelf().filter((x) => x.id === b.id).length, bagNo: shelf().filter((x) => x.id === b.id).indexOf(b) + 1,
  });
  let bagSeq = 0;
  const newBag = (b, { roastDate = null, weight = null } = {}) => {
    const n = { ...clone({ ...b, timer: undefined }), batch: `${b.batch}-bag${++bagSeq}`, weight: weight ?? b.weight, used: 0, frozen: false, finished: false, shelf: true,
      info: { ...clone(b.info), ...(roastDate ? { roastDate: { value: roastDate, source: "bag" } } : {}) } };
    all.push(n);
    return n;
  };

  return {
    demo: true,
    info: { providers: [{ id: "claude-cli", billing: "Claude subscription (recipes in this demo are from real runs)" }], decaidUrl: "simulated", server: null, serverError: null },
    // No Crema server here, so no Gemini voice notes; "Describe it" uses the browser's speech recognition.
    ai: { available: true, get enabled() { return aiEnabled; }, get on() { return aiEnabled; }, healthy: true, voice: false },
    // Shown in the demo so the control can be seen; on the tablet it closes the skin.
    host: { canExit: true, exitToDashboard() { toast("On the tablet, this closes Crema and shows Decaid's dashboard"); } },
    settings: {
      get: async () => ({ aiEnabled }),
      set: async (p) => { if (p.aiEnabled != null) aiEnabled = !!p.aiEnabled; return { aiEnabled }; },
    },
    async shelf() { return shelf().map(shelfItem); },
    async identify({ files, query, description, url }, onStep) {
      if (!aiEnabled) throw new Error("AI features are off. Enter the details by hand, or switch AI on in Settings.");
      const steps = files?.length ? ["Reading the bag", "Finding the roaster's page", "Matching community profiles"] : ["Searching for the coffee", "Reading the roaster's page", "Matching community profiles"];
      for (let i = 0; i < steps.length; i++) { onStep(i, steps); await wait(850); }
      const pool = all.filter((b) => !b.shelf || b.finished);
      const q = (query || description || url || "").toLowerCase();
      // A description carries extra words ("roasted last week"), so take the coffee that matches the most of them.
      const words = q.split(/[\s/,.-]+/).filter((w) => w.length > 2);
      const score = (b) => words.filter((w) => (b.info.name.value + " " + b.info.roaster.value).toLowerCase().includes(w)).length;
      const best = pool.reduce((top, b) => (score(b) > (top ? score(top) : 0) ? b : top), null);
      const hit = best || pool[Math.floor(Math.random() * pool.length)] || all[0];
      const info = clone(hit.info);
      if (!files?.length) { info.roastDate = { value: null, source: null }; info.needsConfirmation = [...new Set([...(info.needsConfirmation || []), "roastDate"])]; }
      info.__demoId = hit.id;
      return info;
    },
    async transcribe() { throw new Error("Speaking to Gemini needs a Crema server. This demo uses the browser's speech recognition."); },
    async saveBean(info, photo, art) {
      if (!info.__demoId) {
        // Typed in by hand: a new coffee, matched by the rules.
        const n = all.length + 1;
        const b = { id: `manual-${n}`, batch: `manual-batch-${n}`, info: clone(info), weight: info.weightGrams ?? 250, used: 0, shelf: true, finished: false, frozen: false,
          photo: photo || null, productImage: null, art: "photo", bestShotId: null, byDrink: null, recipe: null, recipeSource: null };
        all.push(b);
        return { id: b.id, batch: b.batch, key: b.batch };
      }
      const b = byId(info.__demoId) || all[0];
      delete info.__demoId;
      // A coffee already on the shelf: this is another bag; its recipe and reference stay.
      if (b.shelf && !b.finished) { const n = newBag(b, { roastDate: info.roastDate?.value, weight: info.weightGrams }); return { id: n.id, batch: n.batch, key: n.batch, anotherBag: true }; }
      Object.assign(b, { info: { ...b.info, ...info, imageUrl: b.info.imageUrl }, shelf: true, finished: false, photo, art: art || "product", used: 0 });
      return { id: b.id, batch: b.batch, key: b.batch };
    },
    async setBeanState(id, patch, batch = null) { Object.assign(byBag(id, batch), patch); },
    async addBag(id, opts = {}) { const n = newBag(byId(id), opts); return { id: n.id, batch: n.batch, key: n.batch }; },
    async syncRemaining(id, batch) { const b = byBag(id, batch); return Math.max(0, b.weight - b.used); },
    async pinBest(id, shotId) { sameCoffee(id).forEach((b) => (b.bestShotId = shotId)); },
    async recommend(id, opts = {}) {
      const b = byId(id);
      await wait(opts.rulesOnly ? 150 : 900);
      const r = recipeFor(b);
      sameCoffee(id).forEach((x) => { x.recipe = r.recipe; x.recipeSource = r.source; });
      return r;
    },
    async rank(id) { return recipeFor(byId(id)).candidates; },
    async catalog() { return D.catalog.map((p) => ({ ...p, installed: true })); },
    async library() {
      return D.catalog.map((p) => ({ id: `demo:${p.title}`, title: p.title, author: p.author, notes: p.character, steps: 0, targetWeight: p.recipe.yieldG, tempC: p.recipe.tempC, guide: p }));
    },
    async apply(id, recipe, grinderSetting, batch = null) {
      const b = byBag(id, batch);
      workflow = { profile: { title: recipe.profileTitle }, context: { targetDoseWeight: recipe.doseG, targetYield: recipe.yieldG, beanBatchId: b.batch, grinderSetting: grinderSetting ?? "" }, tempC: recipe.tempC, applied: true };
      sim.group = recipe.tempC;
      await wait(250);
    },
    async shotPage(offset = 0, limit = 20) {
      const all = shots.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      return { items: all.slice(offset, offset + limit), total: all.length };
    },
    async shots(limit = 40) { return (await this.shotPage(0, limit)).items; },
    async shot(id) { return shots.find((s) => s.id === id) || null; },
    async latestShot() { return shots.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0] || null; },
    async annotate(id, a) { const s = shots.find((x) => x.id === id); if (s) { if (a.enjoyment != null) s.enjoyment = a.enjoyment; if (a.espressoNotes != null) s.notes = a.espressoNotes; } },
    async feedback(shotId, beanId, fb) {
      const s = shots.find((x) => x.id === shotId); const b = byId(beanId);
      if (s && fb.enjoyment != null) s.enjoyment = fb.enjoyment;
      await wait(500);
      const recipe = b.recipe || recipeFor(b).recipe;
      return { advice: CE.rulesDialIn(fb, { timestamp: s?.timestamp ?? new Date().toISOString(), timeS: s?.timeS ?? 30 }, recipe), source: "rules" };
    },
    prefs: { get: async () => ({ ...prefs }), set: async (p) => { prefs = { ...prefs, ...p }; for (const b of all) { const r = recipeFor(b); b.recipe = r.recipe; b.recipeSource = r.source; } return prefs; } },
    favourites: { get: async () => favourites.slice(), set: async (slot, fav) => { favourites[slot] = fav; return favourites.slice(); } },
    presets: { get: async () => clone(presets), set: async (p) => { presets = clone(p); return presets; } },
    maintenance: {
      get: async () => {
        const since = Date.parse(maintenance.lastBackflush || 0);
        const n = 61 + shots.filter((s) => Date.parse(s.timestamp) > since).length;
        const days = maintenance.lastDescale ? Math.floor((Date.now() - Date.parse(maintenance.lastDescale)) / DAY) : null;
        return { ...maintenance, shotsSinceBackflush: n, daysSinceDescale: days, backflushDue: n >= maintenance.backflushEveryShots, descaleDue: days != null && days >= maintenance.descaleEveryDays };
      },
      done: async (kind) => { maintenance[kind === "backflush" ? "lastBackflush" : "lastDescale"] = new Date().toISOString(); },
      set: async (p) => { maintenance = { ...maintenance, ...p }; },
    },
    machine: {
      canStart: true,
      async info() { return { model: "DE1 (simulated)", GHC: false }; },
      async setState(s) {
        if (s === "idle") { if (sim.state === "sleeping") { sim.state = "heating"; snapshot(); } else stop("idle"); }
        else if (s === "sleeping") stop("sleeping");
        else run(s);
      },
      async tare() { sim.scaleOffset = sim.scale; },
      async recipe() {
        if (!workflow.applied) return null; // the demo's starting workflow is a placeholder, not a load
        const c = workflow.context;
        return { profileTitle: workflow.profile.title, doseG: c.targetDoseWeight, yieldG: c.targetYield, tempC: workflow.tempC ?? null, grind: String(c.grinderSetting ?? ""), batchId: c.beanBatchId ?? null };
      },
      workflowSettings: {
        get: async () => clone(wf),
        set: async (p) => { for (const k of Object.keys(wf)) if (p[k]) Object.assign(wf[k], p[k]); },
      },
      settings: { get: async () => ({ ...settings }), set: async (p) => { settings = { ...settings, ...p }; } },
      async waterThreshold(mm) { sim.refill = settingNumber(mm, SETTING_LIMITS.sWaterWarn); snapshot(); },
      async refill() { sim.water = 58; if (sim.state === "needsWater") sim.state = "idle"; snapshot(); },
      presence: { get: async () => ({ ...presence }), set: async (p) => { presence = { ...presence, ...p }; } },
      schedules: {
        list: async () => schedules.slice(),
        add: async (s) => { const n = { id: `w${Date.now()}`, enabled: true, ...s }; schedules.push(n); return n; },
        update: async (id, p) => Object.assign(schedules.find((s) => s.id === id), p),
        remove: async (id) => { schedules.splice(schedules.findIndex((s) => s.id === id), 1); },
      },
      display: { get: async () => ({ ...display }), brightness: async (n) => { display.brightness = n; } },
      async plugins() { return [{ id: "visualizer.reaplugin", name: "Visualizer upload" }, { id: "time-to-ready.reaplugin", name: "Time To Ready" }, { id: "decent-profile.reaplugin", name: "Decent Profile Generator" }]; },
      heartbeat() {},
    },
    subscribe(handlers) {
      listeners.push(handlers); snapshot();
      handlers.devices?.({ devices: [{ name: "DE1", id: "demo", state: "connected", type: "machine" }], scanning: false, connectionStatus: { phase: "ready", error: null } });
      return { close() { const i = listeners.indexOf(handlers); if (i >= 0) listeners.splice(i, 1); }, reopenMachine() {} };
    },
  };
}
