// End-to-end check of live mode against the simulator: the app served the way
// Decaid serves a skin, talking to the simulated machine directly, with and
// without the optional Crema server. Needs Playwright.
//
//   node scripts/e2e-live.cjs
//
// It checks that:
//   1. with no Crema server, the app runs live: coffees are typed in by hand,
//      and the rules pick the profile and give dial-in advice
//   2. with a Crema server (mock AI), identify and the AI recipe work
//   3. when the server stops, recipes fall back to the rules and the status bar says so
//   4. with AI switched off in Settings, the server isn't used even when it's up
//   5. the phone app served by the Crema server reaches the machine through its
//      proxy and shares the tablet's coffees and settings
//   6. speaking into "Describe it": the microphone (a generated stand-in) is recorded, stopped after the pause, sent to the server as
//      16 kHz WAV, written down (mock transcriber) and looked up
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const base = 19000 + Math.floor(Math.random() * 500);
const MOCK = base, SKIN = base + 1, CREMA = base + 2;
const procs = [];

function start(cmd, args, env, ready) {
  return new Promise((resolve, reject) => {
    // Its own process group, so stopping it also stops the node process npx starts.
    const p = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
    procs.push(p);
    const t = setTimeout(() => reject(new Error(`${args.join(" ")} did not start`)), 30000);
    p.stdout.on("data", (d) => { if (String(d).includes(ready)) { clearTimeout(t); resolve(p); } });
    p.stderr.on("data", (d) => process.env.DEBUG && process.stderr.write(d));
  });
}
const stop = (p) => { try { process.kill(-p.pid, "SIGTERM"); } catch {} };
// A stand-in microphone, generated in the page: 1.5 s of syllable-like tone bursts, then
// silence, so the app hears speech and then a pause. Everything after getUserMedia is the
// app's own code (recording, pause detection, downsampling, WAV, upload).
const FAKE_MIC = `navigator.mediaDevices.getUserMedia = async () => {
  const ac = new AudioContext(), rate = ac.sampleRate, n = Math.round(rate * 6), buf = ac.createBuffer(1, n, rate), x = buf.getChannelData(0);
  for (let i = 0; i < n; i++) { const t = i / rate, env = t < 1.5 ? Math.max(0, Math.sin(Math.PI * t * 4)) : 0, f = 140 + 40 * Math.sin(2 * Math.PI * 3 * t);
    x[i] = env * 0.3 * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t)); }
  const src = ac.createBufferSource(), out = ac.createMediaStreamDestination(); src.buffer = buf; src.connect(out); src.start();
  return out.stream;
};`;
// Decaid serves skins as plain static files from their own origin.
function skinServer() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = path.join(root, "skin", p === "/" ? "index.html" : p);
    if (!file.startsWith(path.join(root, "skin")) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => srv.listen(SKIN, () => r(srv)));
}

let failed = false;
const check = (ok, label, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok || !detail ? "" : ` (${detail})`}`); if (!ok) failed = true; };

(async () => {
  await start("npx", ["tsx", "dev/mock-decaid.ts"], { PORT: String(MOCK) }, "mock-decaid on");
  const skin = await skinServer();
  const crema = () => start("npx", ["tsx", "server/main.ts"], { PORT: String(CREMA), LLM_PROVIDERS: "mock", DECAID_URL: "" }, "crema on");

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1340, height: 800 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  const S = (fn) => page.evaluate(fn);
  const open = async (query) => {
    await page.goto(`http://localhost:${SKIN}/?full&${query}`);
    await page.waitForFunction(() => window.S?.api || (typeof S !== "undefined" && S.api), null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200);
  };
  const addByHand = async (roaster, name) => {
    await page.goto(`http://localhost:${SKIN}/?full#add`); await page.waitForTimeout(1200);
    await page.evaluate(() => setMode("manual"));
    await page.fill("#mRoaster", roaster); await page.fill("#mName", name);
    await page.selectOption("#mProcess", "Natural"); await page.selectOption("#mRoast", "light");
    await page.click("#identifyBtn");
    await page.click("#saveBean");
    await page.waitForFunction((n) => S.current?.info.name.value === n && S.current.recipe, name, { timeout: 15000 });
  };

  try {
    // ---- 1. machine only ----
    await open(`decaid=http://localhost:${MOCK}`);
    check(await S(() => S.api && !S.api.demo), "runs live against the machine with no Crema server");
    // The live and demo backends implement one interface (CLAUDE.md, "Two backends, one
    // interface"). Compare their members, two levels deep, so adding a capability to one
    // and forgetting the other fails here. `info` holds display values, not members.
    const DEMO_ONLY = ["machine.refill()"]; // the demo's "Refill (demo)" button; a real tank is refilled by hand
    const contract = await S(() => {
      const shape = (o, pre = "", depth = 0, out = []) => {
        for (const k of Object.keys(o)) {
          const v = o[k], path = pre ? `${pre}.${k}` : k;
          if (typeof v === "function") out.push(`${path}()`);
          else if (v && typeof v === "object" && !Array.isArray(v) && depth < 2 && k !== "info") shape(v, path, depth + 1, out);
          else out.push(path);
        }
        return out;
      };
      const live = new Set(shape(S.api)), demo = new Set(shape(makeDemoApi()));
      return { onlyLive: [...live].filter((x) => !demo.has(x)), onlyDemo: [...demo].filter((x) => !live.has(x)) };
    });
    const drift = [...contract.onlyLive.map((x) => `live only: ${x}`), ...contract.onlyDemo.filter((x) => !DEMO_ONLY.includes(x)).map((x) => `demo only: ${x}`)];
    check(!drift.length, "the live and demo backends have the same members", drift.join(", "));
    check(await page.isHidden("#demoBanner"), "no demo banner");
    check(await S(() => !S.api.ai.available && !S.api.ai.on), "AI reported unavailable");
    await page.goto(`http://localhost:${SKIN}/?full#add`); await page.waitForTimeout(800);
    check(await page.isHidden("#addModes") && await page.isVisible("#mRoaster") && await page.isVisible("#addNoAi"), "Add offers typing the details only");
    await addByHand("Test Roasters", "Hand Entry");
    check(await S(() => S.current.recipeSource === "rules"), "rules chose the recipe");

    // The machine's recipe vs the screen. Decaid has no workflow stream, so the app
    // re-reads the workflow: on boot, on focus, on link-up, every minute, before a start.
    const wfPut = (b) => fetch(`http://localhost:${MOCK}/api/v1/workflow`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    const wfGet = async () => (await fetch(`http://localhost:${MOCK}/api/v1/workflow`)).json();
    const recheck = async () => { await S(() => window.dispatchEvent(new Event("focus"))); await page.waitForTimeout(600); };
    await S(() => loadOntoMachine(true));
    // A real reload: goto to the same URL with another #hash wouldn't reload the page.
    await page.goto(`http://localhost:${SKIN}/?full#brew`); await page.reload(); await page.waitForFunction(() => S.next && S.link.connected && S.shelfLoaded, null, { timeout: 15000 }); await page.waitForTimeout(800);
    check(await S(() => S.loaded) && /Loaded/.test(await page.textContent("#loadBtn")), "after a reload, a recipe already on the machine shows as loaded");
    const dose0 = await S(() => S.next.doseG);
    await wfPut({ context: { targetDoseWeight: dose0 + 1.5 } }); // another client changes the dose
    await recheck();
    const adopted = await S(() => ({ dose: S.next.doseG, loaded: S.loaded, toast: document.querySelector("#toast").textContent, label: document.querySelector(".pick-src")?.textContent }));
    check(adopted.dose === dose0 + 1.5 && adopted.loaded && /changed elsewhere/.test(adopted.toast) && /set on the machine/.test(adopted.label), "a change made elsewhere for this coffee's bag is taken, labelled and announced", JSON.stringify(adopted));
    await S(() => step("dose:1")); // an unsaved edit here...
    const mine = await S(() => S.next.doseG);
    await wfPut({ context: { targetDoseWeight: 15 } }); // ...and another change elsewhere
    await recheck();
    check(await S(() => S.next.doseG) === mine && !(await S(() => S.loaded)), "an unsaved edit on screen isn't overwritten by a change elsewhere");
    await S(() => loadOntoMachine(true));
    const otherProfile = await S(async () => (await fetch(`${S.api.info.decaidUrl}/api/v1/profiles?visibility=visible`).then((r) => r.json())).map((x) => x.profile).find((x) => x.title !== S.next.profileTitle));
    await wfPut({ profile: otherProfile }); // changed elsewhere, not yet noticed here
    await S(() => startOp("espresso"));
    await page.waitForFunction(() => S.snap?.state?.state === "espresso", null, { timeout: 10000 }).catch(() => {});
    const started = { machine: (await wfGet()).profile.title, screen: await S(() => S.next.profileTitle) };
    check(started.machine === started.screen, "starting espresso loads the screen's recipe if the machine has changed", JSON.stringify(started));
    await S(() => stopMachine()); await page.waitForFunction(() => S.snap?.state?.state !== "espresso", null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(600);
    // A recipe with no bag recorded (what Streamline and Decaid's defaults leave) isn't
    // this coffee's: a reload keeps the coffee's own recipe instead of taking it.
    const own = await S(() => ({ title: S.current.recipe.profileTitle, dose: S.current.recipe.doseG }));
    const untagged = await S(async () => (await fetch(`${S.api.info.decaidUrl}/api/v1/profiles?visibility=visible`).then((r) => r.json())).map((x) => x.profile).find((x) => x.title !== S.current.recipe.profileTitle));
    await wfPut({ profile: untagged, context: { beanBatchId: null, targetDoseWeight: 15.5 } });
    const afterPut = await wfGet();
    await page.reload(); await page.waitForFunction(() => S.next && S.link.connected && S.shelfLoaded, null, { timeout: 15000 }); await page.waitForTimeout(800);
    const kept = { ...(await S(() => ({ title: S.next.profileTitle, dose: S.next.doseG, loaded: S.loaded, label: document.querySelector(".pick-src")?.textContent }))), own, putMachine: { t: afterPut.profile.title, d: afterPut.context.targetDoseWeight, b: afterPut.context.beanBatchId }, nowMachine: await wfGet().then((w) => ({ t: w.profile.title, d: w.context.targetDoseWeight, b: w.context.beanBatchId })) };
    check(kept.title === own.title && kept.dose !== 15.5 && !kept.loaded && !/set on the machine/.test(kept.label), "after a reload, a recipe left by another skin doesn't replace the coffee's own", JSON.stringify(kept));
    await S(() => loadOntoMachine(true));
    await wfPut({ context: { beanBatchId: "someone-elses-batch" } });
    await recheck();
    const other = await S(() => ({ loaded: S.loaded, toast: document.querySelector("#toast").textContent }));
    check(!other.loaded && /another recipe/.test(other.toast), "another coffee's recipe on the machine marks this one as not loaded", JSON.stringify(other));
    await S(() => loadOntoMachine(true));
    // Leaving for Decaid's dashboard: only inside Decaid's WebView, and not mid-operation.
    await page.goto(`http://localhost:${SKIN}/?full#settings`); await page.waitForSelector("#sGhc", { timeout: 10000 });
    check(await page.locator("#exitDash").count() === 0, "no Decaid exit in an ordinary browser");

    // Slow or stuck requests mustn't hold up the machine. Boot subscribes to the
    // machine streams before it loads the shelf (which can mean an AI recipe), and every
    // request has a time limit.
    {
      const slow = await browser.newPage({ viewport: { width: 1340, height: 800 } });
      slow.on("pageerror", (e) => errs.push(`slow: ${e.message}`));
      let held = true;
      await slow.route(/\/api\/v1\/beans/, async (route) => { const t = Date.now(); while (held && Date.now() - t < 6000) await new Promise((r) => setTimeout(r, 100)); route.continue().catch(() => {}); });
      const t0 = Date.now();
      await slow.goto(`http://localhost:${SKIN}/?full&decaid=http://localhost:${MOCK}#brew`);
      await slow.waitForFunction(() => S.snap && !document.querySelector("#stopBtn").disabled, null, { timeout: 5000 }).catch(() => {});
      const ready = (Date.now() - t0) / 1000;
      const loading = await slow.textContent("#nextShot");
      check(ready < 4 && /Loading your coffees/.test(loading), `readings and Stop arrive while the shelf is still loading (${ready.toFixed(1)} s; "${loading.trim()}")`);
      await slow.waitForFunction(() => S.shelfLoaded && S.current, null, { timeout: 15000 }).catch(() => {});
      check(await slow.evaluate(() => !!S.current && !S.shelfError), "the shelf fills in once Decaid answers");
      await slow.close();

      const stuck = await browser.newPage({ viewport: { width: 1340, height: 800 } });
      stuck.on("pageerror", (e) => errs.push(`stuck: ${e.message}`));
      let release = null;
      await stuck.route(/\/api\/v1\/beans/, (route) => { if (release === null) return; route.continue().catch(() => {}); }); // never answers
      await stuck.goto(`http://localhost:${SKIN}/?full&decaid=http://localhost:${MOCK}#brew`);
      await stuck.waitForFunction(() => /Couldn't load your coffees/.test(document.querySelector("#nextShot").textContent), null, { timeout: 25000 }).catch(() => {});
      const failed = await stuck.evaluate(() => ({ err: S.shelfError, text: document.querySelector("#nextShot").textContent, stop: !document.querySelector("#stopBtn").disabled }));
      check(/no answer within 15 s/.test(failed.err || "") && /Couldn't load your coffees/.test(failed.text) && failed.stop, "a request that never answers gives up after 15 s and says so; Stop still works", JSON.stringify(failed));
      release = true; // Decaid answers again
      await stuck.click("#retryShelf");
      await stuck.waitForFunction(() => S.current && !S.shelfError, null, { timeout: 15000 }).catch(() => {});
      check(await stuck.evaluate(() => !!S.current), "Try again loads the shelf");
      await stuck.close();
    }
    const tablet = await browser.newPage({ viewport: { width: 1340, height: 800 } });
    tablet.on("pageerror", (e) => errs.push(`tablet: ${e.message}`));
    await tablet.addInitScript(() => { window.__exits = 0; window.decentApp = { exitToDashboard() { window.__exits++; } }; });
    await tablet.goto(`http://localhost:${SKIN}/?full&decaid=http://localhost:${MOCK}#settings`);
    await tablet.waitForSelector("#exitDash", { timeout: 15000 });
    await tablet.evaluate(() => S.api.machine.setState("steam"));
    await tablet.waitForFunction(() => S.snap?.state?.state === "steam", null, { timeout: 5000 });
    check(await tablet.isDisabled("#exitDash"), "Open Decaid is disabled while the machine steams");
    await tablet.evaluate(() => exitToDashboard());
    check(await tablet.evaluate(() => window.__exits) === 0 && /Stop the machine/.test(await tablet.textContent("#toast")), "and refuses to leave if called anyway");
    await tablet.evaluate(() => S.api.machine.setState("idle"));
    await tablet.waitForFunction(() => !document.querySelector("#exitDash").disabled, null, { timeout: 5000 });
    await tablet.click("#exitDash");
    check(await tablet.evaluate(() => window.__exits) === 1, "inside Decaid, Open Decaid calls decentApp.exitToDashboard() once the machine is idle");
    await tablet.close();
    // Machine link from Decaid's ws/v1/devices: Decaid stays up while the DE1 drops off.
    // Its machine sockets go quiet but stay open, so only the device list tells.
    const dev = (what, b) => fetch(`http://localhost:${MOCK}/dev/${what}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) });
    await page.goto(`http://localhost:${SKIN}/?full#brew`); await page.waitForFunction(() => S.link.connected === true && S.snap, null, { timeout: 15000 });
    check(true, "the device list says the machine is connected");
    await S(() => { window.__sent = []; const set = S.api.machine.setState; S.api.machine.setState = (st) => { window.__sent.push(st); return set(st); }; });
    await dev("machine/disconnect");
    await page.waitForFunction(() => S.link.connected === false, null, { timeout: 5000 });
    const down = await S(() => ({
      banner: document.querySelector("#alerts").textContent,
      status: document.querySelector("#status").textContent,
      start: document.querySelector('[data-run="espresso"]').disabled,
      stop: document.querySelector("#stopBtn").disabled,
      pressure: [...document.querySelectorAll("#readouts .readout")].find((r) => /Pressure/.test(r.textContent))?.querySelector(".v").textContent,
    }));
    check(/machine isn't connected/.test(down.banner) && /Machine disconnected/.test(down.status), "a dropped machine is shown as disconnected", `${down.banner} / ${down.status}`);
    check(down.start && !down.stop, "start buttons are disabled, Stop isn't", JSON.stringify(down));
    check(/^–/.test(down.pressure || ""), `no stale readings (${down.pressure})`);
    await S(() => startOp("espresso"));
    check(await S(() => window.__sent.length === 0), "no start command is sent while it's disconnected");
    await dev("machine/connect");
    await page.waitForFunction(() => S.link.connected === true, null, { timeout: 5000 });
    await page.waitForTimeout(400);
    const up = await S(() => ({ toast: document.querySelector("#toast").textContent, start: document.querySelector('[data-run="espresso"]').disabled, banner: document.querySelector("#alerts").textContent }));
    check(/connected again/.test(up.toast) && !up.start && !/isn't connected/.test(up.banner), "it recovers when the machine is back", JSON.stringify(up));
    await dev("connection-error", { kind: "profileUploadFailed", severity: "warning", message: "Profile upload failed" });
    await page.waitForFunction(() => S.link.error?.kind === "profileUploadFailed", null, { timeout: 5000 });
    check(/hasn't reached the machine/.test(await page.textContent("#alerts")), "a recipe Decaid is still retrying is shown");
    await dev("connection-error", {});
    await page.waitForFunction(() => !S.link.error, null, { timeout: 5000 });
    check(!/hasn't reached/.test(await page.textContent("#alerts")), "and cleared when Decaid says so");

    // Sockets: one per stream, recovered when they go quiet, and no stale readings when
    // Decaid goes away.
    {
      const sockets = async (port = MOCK) => (await fetch(`http://localhost:${port}/dev/sockets`)).json();
      await page.goto(`http://localhost:${SKIN}/?full#brew`); await page.waitForFunction(() => S.snap && S.link.connected, null, { timeout: 15000 });
      await page.waitForTimeout(1000);
      const before = (await sockets())["/ws/v1/machine/snapshot"];
      // Older Decaid kept the machine socket open but quiet after a machine swap.
      await dev("machine/freeze-sockets");
      const frozenAt = await S(() => S.snap.timestamp);
      await page.waitForTimeout(2000);
      check(await S(() => S.snap.timestamp) === frozenAt, "a frozen machine socket stops sending (simulated)");
      const back = await page.waitForFunction((t) => S.snap?.timestamp !== t, frozenAt, { timeout: 35000 }).then(() => true, () => false);
      check(back, "a quiet machine socket is reopened and readings resume");
      await page.waitForTimeout(1000);
      const after = (await sockets())["/ws/v1/machine/snapshot"];
      check(after === before, `reopening doesn't leave extra sockets open (${before} before, ${after} after)`);

      // Decaid goes away entirely, then comes back.
      const PORT2 = base + 7;
      let mock2 = await start("npx", ["tsx", "dev/mock-decaid.ts"], { PORT: String(PORT2) }, "mock-decaid on");
      const gone = await browser.newPage({ viewport: { width: 1340, height: 800 } });
      gone.on("pageerror", (e) => errs.push(`gone: ${e.message}`));
      await gone.goto(`http://localhost:${SKIN}/?full&decaid=http://localhost:${PORT2}#brew`);
      await gone.waitForFunction(() => S.snap && S.link.connected, null, { timeout: 15000 });
      stop(mock2);
      await gone.waitForFunction(() => !S.snap, null, { timeout: 10000 }).catch(() => {});
      const lost = await gone.evaluate(() => ({ snap: !!S.snap, banner: document.querySelector("#alerts").textContent, status: document.querySelector("#status").textContent }));
      check(!lost.snap && /Can't reach the machine/.test(lost.banner) && /offline/i.test(lost.status), "when Decaid goes away, readings are dropped and the screen says so", JSON.stringify(lost));
      mock2 = await start("npx", ["tsx", "dev/mock-decaid.ts"], { PORT: String(PORT2) }, "mock-decaid on");
      const recovered = await gone.waitForFunction(() => S.snap && S.link.connected, null, { timeout: 30000 }).then(() => true, () => false);
      check(recovered && !/Can't reach/.test(await gone.textContent("#alerts")), "when Decaid is back, it reconnects by itself");
      await gone.waitForTimeout(1000);
      const counts = await sockets(PORT2);
      check(counts["/ws/v1/machine/snapshot"] === 1 && counts["/ws/v1/devices"] === 1, `one socket per stream after reconnecting (${JSON.stringify(counts)})`);
      await gone.close();
      stop(mock2);
    }

    // Shot history. Decaid gives at most 100 shots a page (and echoes the limit asked
    // for), so counts and the reference shot must page and fetch by id.
    {
      await page.goto(`http://localhost:${SKIN}/?full#brew`); await page.reload();
      await page.waitForFunction(() => S.current && S.shelfLoaded && S.link.connected, null, { timeout: 15000 });
      const batchId = await S(() => S.current.batch);
      const before = await S(async () => (await S.api.shelf()).find((b) => b.id === S.current.id).shots);
      await dev("shots/seed", { count: 130, batchId, dose: 18 });
      const after = await S(async () => (await S.api.shelf()).find((b) => b.id === S.current.id));
      check(after.shots === before + 130, `all of a bag's shots are counted past 100 (${before} + 130 → ${after.shots})`);
      const total = (await (await fetch(`http://localhost:${MOCK}/api/v1/shots?limit=1`)).json()).total;
      const since = await S(async () => (await S.api.maintenance.get()).shotsSinceBackflush);
      check(since === total && total > 100, `shots since the last backflush are counted past 100 (${since} of ${total})`);

      // A reference shot older than any page that's loaded.
      const oldest = await S(async () => { const p = await S.api.shotPage(0, 1); const last = await S.api.shotPage(p.total - 1, 1); return last.items[0].id; });
      await page.evaluate((id) => S.api.pinBest(S.current.id, id), oldest);
      await page.reload(); await page.waitForFunction(() => S.current && S.shelfLoaded, null, { timeout: 15000 }); await page.waitForTimeout(800);
      const ref = await page.evaluate(async (id) => ({ best: S.current.bestShotId, want: id, ghost: S.ghost?.length ?? null, fetched: (await S.api.shot(id).catch((e) => ({ err: e.message })))?.points?.length }), oldest);
      check(ref.best === oldest && ref.ghost > 0, "a reference shot older than the loaded history still shows on the chart", JSON.stringify(ref));

      // The history page loads 20 at a time.
      await page.goto(`http://localhost:${SKIN}/?full#shots`); await page.waitForSelector("#moreShots", { timeout: 15000 }).catch(() => {});
      const first = await S(() => ({ n: S.shots.length, more: document.querySelector("#moreShots")?.textContent }));
      await page.click("#moreShots").catch(() => {}); await page.waitForFunction(() => S.shots.length > 20, null, { timeout: 15000 }).catch(() => {});
      check(first.n === 20 && /Show more/.test(first.more || "") && await S(() => S.shots.length) === 40, `history loads 20 at a time with Show more (${first.n}, "${first.more}")`);

      // Failures aren't zero: history and a bag's count say so instead.
      await page.route(/\/api\/v1\/shots\?/, (r) => r.abort());
      await page.goto(`http://localhost:${SKIN}/?full#brew`); await page.goto(`http://localhost:${SKIN}/?full#shots`);
      await page.waitForSelector("#retryShots", { timeout: 15000 }).catch(() => {});
      check(/Couldn't load your shots/.test(await page.textContent("#shotList")), "a failed history load says so, not \"No shots yet\"");
      const unknown = await S(async () => { const b = (await S.api.shelf()).find((x) => x.id === S.current.id); return { remaining: b.remaining, shots: b.shots }; });
      check(unknown.remaining === null && unknown.shots === null, `if a bag's shots can't be read, how much is left is unknown, not full (${JSON.stringify(unknown)})`);
      await page.unroute(/\/api\/v1\/shots\?/);
      await page.click("#retryShots").catch(() => {});
      await page.waitForFunction(() => !document.querySelector("#retryShots") && document.querySelectorAll(".shot-row").length > 0, null, { timeout: 15000 }).catch(() => {});
      check(await S(() => document.querySelectorAll(".shot-row").length) === 20, "Try again loads the history");

      // After a shot, the rating goes to that shot, even if Decaid is slow to save it.
      await page.goto(`http://localhost:${SKIN}/?full#brew`); await page.waitForTimeout(800);
      const prevLatest = (await (await fetch(`http://localhost:${MOCK}/api/v1/shots/latest`)).json()).id;
      let stale = 0;
      await page.route(/\/api\/v1\/shots\/latest/, async (r) => {
        // Hold back the new shot for the first two reads after the shot ends.
        const real = await (await fetch(`http://localhost:${MOCK}/api/v1/shots/latest`)).json();
        if (real.id !== prevLatest && stale < 2) { stale++; return r.fulfill({ json: { id: prevLatest, timestamp: new Date(0).toISOString() } }); }
        return r.continue();
      });
      await S(() => startOp("espresso"));
      await page.waitForFunction(() => S.snap?.state?.state === "espresso", null, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await S(() => stopMachine());
      await page.waitForSelector("#afterShot:not([hidden])", { timeout: 20000 }).catch(() => {});
      await page.waitForFunction((p) => S.lastShotId && S.lastShotId !== p, prevLatest, { timeout: 10000 }).catch(() => {});
      const newest = (await (await fetch(`http://localhost:${MOCK}/api/v1/shots/latest`)).json()).id;
      check(stale === 2 && await S(() => S.lastShotId) === newest && newest !== prevLatest, `the after-shot panel waits for Decaid to save the shot and rates that one (${stale} stale reads)`);
      await page.unroute(/\/api\/v1\/shots\/latest/);
      // Never saved: the panel says the rating can't be attached yet.
      await page.route(/\/api\/v1\/shots\/latest/, (r) => r.fulfill({ json: { id: "never-the-new-one", timestamp: new Date(0).toISOString() } }));
      await S(() => startOp("espresso"));
      await page.waitForFunction(() => S.snap?.state?.state === "espresso", null, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await S(() => stopMachine());
      await page.waitForFunction(() => /hasn't saved this shot yet/.test(document.querySelector("#afterShot").textContent), null, { timeout: 20000 }).catch(() => {});
      check(/hasn't saved this shot yet/.test(await page.textContent("#afterShot")), "if Decaid hasn't saved the shot, the panel says the rating can't be attached yet");
      await page.unroute(/\/api\/v1\/shots\/latest/);
    }

    // Profiles: the library is what's installed in Decaid; Crema's guide only adds notes.
    {
      const profilesUrl = /\/api\/v1\/profiles\?visibility=visible/;
      const installed = await (await fetch(`http://localhost:${MOCK}/api/v1/profiles?visibility=visible`)).json();
      await page.goto(`http://localhost:${SKIN}/?full#brew`); await page.goto(`http://localhost:${SKIN}/?full#profiles`);
      await page.waitForFunction(() => /on this machine/.test(document.querySelector("#catCount")?.textContent || ""), null, { timeout: 15000 }).catch(() => {});
      const lib = await S(() => ({ count: document.querySelector("#catCount").textContent, unknown: [...document.querySelectorAll(".cat-card")].filter((c) => /Not in Crema's guide/.test(c.textContent)).length, size: S.library?.length }));
      check(lib.size === installed.length && new RegExp(`of ${installed.length} on this machine`).test(lib.count) && lib.unknown > 0, `the library lists every installed profile, including ones Crema's guide doesn't know (${JSON.stringify(lib)})`);
      // One the guide doesn't know can be chosen and loaded.
      const pick = await S(() => S.library.find((p) => !p.guide));
      await page.click(`.cat-card[data-p="${pick.id}"]`); await page.click("#useProfile");
      await page.waitForFunction((t) => S.next?.profileTitle === t, pick.title, { timeout: 5000 }).catch(() => {});
      await S(() => loadOntoMachine(true));
      const loaded = await wfGet();
      check(await page.evaluate((id) => S.next.profileId === id, pick.id) && loaded.profile.title === pick.title, `an installed profile outside the guide can be chosen and loaded (${pick.title})`);
      // Two installed profiles with one title: the id decides which is loaded.
      const twin = installed.find((x) => x.profile.title === pick.title);
      await page.route(profilesUrl, (r) => r.fulfill({ json: [{ id: "profile:twin", profile: { ...twin.profile, notes: "the other one" } }, ...installed] }));
      await page.evaluate((id) => { S.next.profileId = id; S.loaded = false; }, twin.id);
      await S(() => loadOntoMachine(true));
      check((await wfGet()).profile.notes !== "the other one", "with two installed profiles of one title, the recipe's profile id picks the right one");
      await page.unroute(profilesUrl);
      // Nothing installed is in the guide: no recommendation, and nothing uninstalled offers Use.
      const outside = installed.filter((x) => !/^(Adaptive|Blooming|A-Flow|D-Flow|Gagn|Extractamundo|Turbo|Rao|Londonium|Damian|80's|Default|Gentle|Flow profile|Best practice|Easy blooming|Espresso Forge|Classic Italian|Trendy|I got your back|Cremina|Traditional lever|Baseline)/.test(x.profile.title));
      await page.route(profilesUrl, (r) => r.fulfill({ json: outside.length ? outside : [{ id: "profile:solo", profile: { title: "Nobody's Profile", author: "Test", beverage_type: "espresso", steps: [{ temperature: 90 }], target_weight: 38 } }] }));
      const none = await S(async () => { S.library = null; S.current.recipe = null; const out = await S.api.recommend(S.current.id, { rulesOnly: true }); S.current.recipe = out.recipe; S.current.recipeSource = out.source; setNextFromRecipe(S.current); renderNextShot(); return { recipe: out.recipe, source: out.source, brew: document.querySelector("#nextShot").textContent }; });
      check(none.recipe === null && none.source === "none" && /no recommendation/.test(none.brew), `with no installed match there's no recommendation, and Brew says so (${none.source})`);
      await page.goto(`http://localhost:${SKIN}/?full#brew`); await page.goto(`http://localhost:${SKIN}/?full#profiles`);
      await page.waitForFunction(() => /no recommendation/.test(document.querySelector("#recommended")?.textContent || ""), null, { timeout: 15000 }).catch(() => {});
      const rec = await S(() => ({ text: document.querySelector("#recommended").textContent, use: document.querySelectorAll("#recommended [data-use]").length }));
      check(/no recommendation/.test(rec.text) && rec.use === 0 && /Not on this machine/.test(rec.text), "Profiles says there's no recommendation, and uninstalled candidates can't be used");
      await page.unroute(profilesUrl);
      await S(async () => { S.library = null; S.current.recipe = null; await selectBean(S.current.id, { quiet: true }); });
    }

    // Bags: each is one of Decaid's batches with its own roast date, frozen state and
    // weight; the coffee's recipe and reference shot are shared.
    {
      const batchOf = async (id) => (await fetch(`http://localhost:${MOCK}/api/v1/bean-batches/${id}`)).json();
      await page.goto(`http://localhost:${SKIN}/?full#brew`); await page.reload();
      await page.waitForFunction(() => S.current?.recipe && S.shelfLoaded, null, { timeout: 15000 });
      const coffeeId = await S(() => S.current.id), bag1 = await S(() => S.current.key);
      await S(() => loadOntoMachine(true));
      const pinnedShot = (await (await fetch(`http://localhost:${MOCK}/api/v1/shots?limit=1`)).json()).items[0].id;
      await page.evaluate(async (id) => { await S.api.pinBest(S.current.id, id); }, pinnedShot);
      // Add a second bag from the shelf.
      await page.goto(`http://localhost:${SKIN}/?full#shelf`); await page.waitForSelector(`[data-addbag="${bag1}"]`, { timeout: 10000 });
      await page.click(`[data-addbag="${bag1}"]`); await page.fill("#bagRoast", "2026-11-01"); await page.fill("#bagWeight", "500"); await page.click("#confirmBag");
      await page.waitForFunction((id) => S.shelf.filter((b) => b.id === id).length === 2, coffeeId, { timeout: 10000 }).catch(() => {});
      const two = await page.evaluate((id) => S.shelf.filter((b) => b.id === id).map((b) => ({ key: b.key, bag: `${b.bagNo}/${b.bags}`, roast: b.info.roastDate?.value, weight: b.weight, recipe: b.recipe?.profileTitle })), coffeeId);
      const bag2 = two.find((b) => b.key !== bag1)?.key;
      check(two.length === 2 && two.every((b) => b.recipe && b.recipe === two[0].recipe) && two.some((b) => b.roast === "2026-11-01" && b.weight === 500), `a second bag gets its own roast date and weight and shares the recipe (${JSON.stringify(two)})`);
      check(await page.evaluate(() => /Bag 2 of 2/.test(document.querySelector("#shelf").textContent)), "the shelf says which bag is which");
      // Freeze one.
      await page.click(`[data-freeze="${bag2}"]`); await page.waitForTimeout(400);
      check((await batchOf(bag2)).frozen === true && (await batchOf(bag1)).frozen !== true, "freezing one bag leaves the other alone");
      // Brew from each: the workflow records the bag.
      await page.evaluate((k) => selectBean(k, { quiet: true }), bag2); await S(() => { S.loaded = false; return loadOntoMachine(true); });
      const w2 = (await wfGet()).context.beanBatchId;
      await page.evaluate((k) => selectBean(k, { quiet: true }), bag1); await S(() => { S.loaded = false; return loadOntoMachine(true); });
      const w1 = (await wfGet()).context.beanBatchId;
      check(w2 === bag2 && w1 === bag1, "loading from each bag records that bag in the workflow");
      // What's left is per bag, counted from its shots, written back to Decaid.
      await dev("shots/seed", { count: 3, batchId: bag2, dose: 18 });
      const left2 = await page.evaluate(async (k) => { const b = S.shelf.find((x) => x.key === k); return S.api.syncRemaining(b.id, b.batch); }, bag2);
      check(left2 === 500 - 54 && (await batchOf(bag2)).weightRemaining === 446, `a bag's remaining is its weight less its own shots, and Decaid gets it (${left2})`);
      // Changed elsewhere (Decaid or another skin): taken as a correction, not overwritten.
      await fetch(`http://localhost:${MOCK}/api/v1/bean-batches/${bag2}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ weightRemaining: 400 }) });
      await dev("shots/seed", { count: 1, batchId: bag2, dose: 18 });
      const adopted = await page.evaluate(async (k) => (await S.api.shelf()).find((x) => x.key === k).remaining, bag2);
      check(adopted === 400 - 18 || adopted === 400, `a remaining weight changed elsewhere is kept (${adopted})`);
      // Set by hand.
      await page.evaluate(async () => { await refreshShelf(); }); await page.goto(`http://localhost:${SKIN}/?full#brew`); await page.goto(`http://localhost:${SKIN}/?full#shelf`);
      await page.waitForSelector(`[data-left="${bag2}"]`, { timeout: 10000 }); await page.click(`[data-left="${bag2}"]`); await page.fill("#leftG", "300"); await page.click("#confirmLeft"); await page.waitForTimeout(500);
      check((await batchOf(bag2)).weightRemaining === 300 && await page.evaluate(async (k) => (await S.api.shelf()).find((x) => x.key === k).remaining, bag2) === 300, "what's left can be set by hand, and Decaid gets it");
      // Buying another bag through Add keeps the recipe and the reference shot.
      const again = await page.evaluate(async () => { const info = JSON.parse(JSON.stringify(S.current.info)); info.roastDate = { value: "2026-11-05", source: "bag" }; info.weightGrams = 250; return S.api.saveBean(info, null, "photo"); });
      const kept = await page.evaluate(async (id) => (await S.api.shelf()).filter((b) => b.id === id).map((b) => ({ recipe: b.recipe?.profileTitle, best: b.bestShotId })), coffeeId);
      check(again.anotherBag && kept.length === 3 && kept.every((b) => b.recipe && b.best === pinnedShot), `buying another bag keeps the coffee's recipe and reference shot (${JSON.stringify(kept)})`);
      // Another device sees the same bags.
      const other = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await other.goto(`http://localhost:${SKIN}/?full&decaid=http://localhost:${MOCK}#shelf`);
      await other.waitForFunction(() => S.shelfLoaded, null, { timeout: 15000 });
      const seen = await other.evaluate((id) => S.shelf.filter((b) => b.id === id).map((b) => ({ key: b.key, frozen: b.frozen })), coffeeId);
      check(seen.length === 3 && seen.find((b) => b.key === bag2)?.frozen === true, "another device sees the same bags and their state");
      await other.close();
      // Finish one bag: the others stay, with the recipe.
      await page.evaluate(async () => { await refreshShelf(); renderShelf(); });
      await page.click(`[data-finish="${bag2}"]`); await page.click("#confirmFinish"); await page.waitForTimeout(800);
      const afterFinish = await page.evaluate((id) => S.shelf.filter((b) => b.id === id).map((b) => b.key), coffeeId);
      const bean = await (await fetch(`http://localhost:${MOCK}/api/v1/beans/${coffeeId}`)).json();
      check(afterFinish.length === 2 && !afterFinish.includes(bag2) && (await batchOf(bag2)).archived === true && !bean.archived, "finishing one bag leaves the coffee's other bags on the shelf");
      // Finish the rest: the coffee moves off the shelf.
      for (const k of afterFinish) { await page.evaluate(async (key) => { const b = S.shelf.find((x) => x.key === key); await S.api.setBeanState(b.id, { finished: true }, b.batch); await refreshShelf(); }, k); }
      const gone = await page.evaluate((id) => S.shelf.some((b) => b.id === id), coffeeId);
      check(!gone && (await (await fetch(`http://localhost:${MOCK}/api/v1/beans/${coffeeId}`)).json()).archived === true, "finishing its last bag moves the coffee off the shelf");
      // Bring it back for the steps that follow.
      await page.evaluate(async (id) => { const r = await S.api.addBag(id, { weight: 250 }); await refreshShelf(); await selectBean(r.key, { quiet: true }); }, coffeeId);
    }
    const kv = await (await fetch(`http://localhost:${MOCK}/api/v1/store/crema`)).json();
    check(kv.some((k) => k.startsWith("bean:")), "Crema's record is stored in Decaid's key-value store");
    const fb = await S(async () => { const [shot] = await S.api.shots(1); return shot ? S.api.feedback(shot.id, S.current.id, { sourBitter: -1, body: 0, enjoyment: 6, notes: null }) : { source: "no shot" }; });
    check(fb.source === "rules" || fb.source === "no shot", `dial-in advice from the rules (${fb.source})`);
    // Steam, hot water and flush write their preset first, through the workflow's
    // steamSettings / hotWaterData / rinseData, which Decaid (and the simulator) pass on
    // to the machine. The machine's own shot settings are checked to see it arrive.
    const workflowNow = async () => (await fetch(`http://localhost:${MOCK}/api/v1/workflow`)).json();
    const wfPuts = [];
    page.on("request", (r) => { if (r.method() === "PUT" && r.url().endsWith("/api/v1/workflow")) wfPuts.push(JSON.parse(r.postData() || "{}")); });
    const shotSettings = () => new Promise((resolve) => {
      const ws = new (require("ws"))(`ws://localhost:${MOCK}/ws/v1/machine/shotSettings`);
      ws.on("message", (m) => { ws.close(); resolve(JSON.parse(m)); });
    });
    for (const [kind, preset, field, group, wfField] of [["steam", "steam:1", "targetSteamDuration", "steamSettings", "duration"], ["hotWater", "water:2", "targetHotWaterVolume", "hotWaterData", "volume"], ["flush", "flush:2", null, "rinseData", "duration"]]) {
      await page.goto(`http://localhost:${SKIN}/?full#brew`); await page.waitForTimeout(1000);
      await page.click(`[data-preset="${preset}"]`); await page.waitForTimeout(400);
      await page.click(`[data-run="${kind}"]`);
      const ran = await page.waitForFunction((k) => S.snap?.state?.state === k, kind, { timeout: 5000 }).then(() => true, () => false);
      const want = await page.evaluate((pr) => { const [k, i] = pr.split(":"); const x = S.presets[k][i]; return x.seconds ?? x.ml; }, preset);
      const ss = await shotSettings(), wf = await workflowNow();
      check(ran && wf[group][wfField] === want && (!field || ss[field] === want), `${kind} starts with its preset (workflow ${group}.${wfField} ${wf[group][wfField]}${field ? `, machine ${field} ${ss[field]}` : ""}, wanted ${want})`);
      await S(() => stopMachine()); await page.waitForTimeout(800);
    }
    check(wfPuts.length >= 3 && wfPuts.every((b) => !("profile" in b) && !("context" in b)), `preset writes carry only steam, hot water or flush, never the profile (${wfPuts.map((b) => Object.keys(b).join("+")).join(", ")})`);
    await page.goto(`http://localhost:${SKIN}/?full#settings`); await page.waitForTimeout(1200);
    check((await page.textContent("#settings")).includes("Not connected"), "Settings shows no Crema server");
    const steamT = await page.inputValue("#sSteamT").catch(() => "");
    check(steamT !== "", `Settings shows the steam temperature (${steamT || "missing"})`);
    if (steamT) {
      const before = await shotSettings(), wfBefore = await workflowNow();
      await page.click('[data-mini="sSteamT:5"]'); await page.waitForTimeout(800);
      const after = await shotSettings(), wfAfter = await workflowNow();
      check(wfAfter.steamSettings.targetTemperature === wfBefore.steamSettings.targetTemperature + 5 && after.targetSteamTemp === before.targetSteamTemp + 5, "changing steam temperature reaches the workflow and the machine");
      check(wfAfter.steamSettings.duration === wfBefore.steamSettings.duration && JSON.stringify(wfAfter.hotWaterData) === JSON.stringify(wfBefore.hotWaterData) && after.targetHotWaterVolume === before.targetHotWaterVolume, "and keeps the other settings");
      // Decaid takes any number; Crema keeps steam inside the DE1's 135–160 °C.
      await page.fill("#sSteamT", "200"); await page.dispatchEvent("#sSteamT", "change"); await page.waitForTimeout(800);
      check((await workflowNow()).steamSettings.targetTemperature === 160, `an out-of-range steam temperature is held at 160 °C (${(await workflowNow()).steamSettings.targetTemperature})`);
      await page.fill("#sFlushF", "6.25"); await page.dispatchEvent("#sFlushF", "change"); await page.waitForTimeout(800);
      check((await workflowNow()).rinseData.flow === 6.3, `flows are rounded to 0.1 (${(await workflowNow()).rinseData.flow})`);
    }

    // ---- 2. with the Crema server ----
    const server = await crema();
    await open(`decaid=http://localhost:${MOCK}&server=http://localhost:${CREMA}`);
    check(await S(() => S.api.ai.on), "AI on with the server connected");
    await page.goto(`http://localhost:${SKIN}/?full#add`); await page.waitForTimeout(800);
    await page.click("#mode-describe");
    await page.fill("#describeInput", "Example Roasters Kii AA");
    await page.click("#identifyBtn");
    await page.waitForSelector("#saveBean", { timeout: 15000 }).catch(async () => { throw new Error(`identify: ${await page.textContent("#reviewPanel")}`); });
    // A slow AI: Add sends you to Profiles before the recommendation arrives.
    await page.route(/\/api\/recommend/, async (route) => { await new Promise((r) => setTimeout(r, 2500)); route.continue().catch(() => {}); });
    await page.click("#saveBean");
    await page.waitForFunction(() => location.hash === "#profiles" && /Asking the AI/.test(document.querySelector("#recommended").textContent), null, { timeout: 8000 }).catch(() => {});
    check(/Asking the AI/.test(await page.textContent("#recommended")), "Profiles says it's asking the AI while the recommendation is on its way");
    await page.waitForFunction(() => /AI pick/.test(document.querySelector("#recommended").textContent), null, { timeout: 15000 }).catch(() => {});
    check(/AI pick/.test(await page.textContent("#recommended")) && await page.evaluate(() => location.hash) === "#profiles", "and shows the AI's pick when it arrives, without leaving the page");
    await page.unroute(/\/api\/recommend/);
    await page.waitForFunction(() => S.current?.info.name.value === "Kii AA" && S.current.recipe, null, { timeout: 15000 });
    const got = await S(() => ({ name: S.current.info.name.value, source: S.current.recipeSource }));
    check(got.name === "Kii AA" && got.source === "mock", `identified by the server and recipe chosen by the AI (${got.name}, ${got.source})`);
    check(await S(() => S.shelf.length >= 2), "both coffees on the shelf");
    // A product photo the server can't fetch (a dead link, a shop placeholder) isn't kept.
    const noPhoto = await S(async () => {
      const info = JSON.parse(JSON.stringify(S.current.info));
      info.name = { value: "Broken Photo", source: "bag" }; info.imageUrl = "https://127.0.0.1/placeholder.jpg";
      const { id } = await S.api.saveBean(info, null, "product");
      const b = (await S.api.shelf()).find((x) => x.id === id);
      const html = bagArt({ info: { name: { value: "Zed" } }, productImage: "http://localhost:9/nothing.png", art: "product" });
      const box = document.createElement("div"); box.innerHTML = html; document.body.appendChild(box);
      await new Promise((r) => setTimeout(r, 800));
      const tile = box.querySelector(".initial")?.textContent; box.remove();
      await S.api.setBeanState(id, { finished: true });
      return { productImage: b?.productImage ?? null, imageUrl: b?.info.imageUrl ?? null, tile };
    });
    check(!noPhoto.productImage && !noPhoto.imageUrl, `a photo the server couldn't fetch isn't saved with the coffee (${JSON.stringify(noPhoto)})`);
    check(noPhoto.tile === "Z", "a picture that fails to load falls back to the initial tile");
    // Boot starts on the coffee the machine holds, not the one last viewed here.
    const onMachine = await S(() => S.current.id);
    await S(() => loadOntoMachine(true));
    const elsewhere = await S(() => S.shelf.find((b) => b.id !== S.current.id).id);
    await page.evaluate((id) => local.set("current", id), elsewhere);
    await open(`decaid=http://localhost:${MOCK}&server=http://localhost:${CREMA}`);
    check(await S(() => S.current.id) === onMachine && await S(() => S.loaded), "on boot, the coffee whose recipe is on the machine is selected and shown as loaded");

    // ---- 6. speaking (Gemini path, mock transcriber) ----
    await page.goto(`http://localhost:${SKIN}/?full#add`); await page.waitForTimeout(800);
    // When to stop: fed 48 kHz chunks of tone and silence with made-up timestamps.
    const gate = await S(() => {
      const chunk = (amp) => Float32Array.from({ length: 2048 }, (_, i) => amp * Math.sin(i / 5));
      const run = (pattern) => {                         // pattern(t) → amplitude; returns [why, when]
        const g = voiceGate(0);
        for (let t = 0; t < 40000; t += 2048 / 48) { g.push(chunk(pattern(t)), t); const why = g.check(t); if (why) return [why, Math.round(t)]; }
        return [null, 40000];
      };
      return { talk: run((t) => (t > 300 && t < 2500 ? 0.2 : 0.002)), quiet: run(() => 0.002), long: run(() => 0.2), noisyRoom: run((t) => (t < 3000 ? 0.03 : 0.03 + (t < 4500 ? 0.2 : 0))) };
    });
    check(gate.talk[0] === "pause" && gate.talk[1] > 4000 && gate.talk[1] < 4300, `stops 1.6 s after the speaker pauses (${gate.talk})`);
    check(gate.quiet[0] === "silent" && gate.quiet[1] >= 8000 && gate.quiet[1] < 8100, `gives up after 8 s with no speech (${gate.quiet})`);
    check(gate.long[0] === "max" && gate.long[1] >= 30000 && gate.long[1] < 30100, `stops at 30 s (${gate.long})`);
    check(gate.noisyRoom[0] === "pause" && gate.noisyRoom[1] > 6000 && gate.noisyRoom[1] < 6300, `a steady background noise isn't speech (${gate.noisyRoom})`);

    // The microphone itself. Headless and sandboxed browsers often don't run audio at all (the
    // audio clock stands still), so the generated stand-in mic is used only where it does;
    // otherwise only the recording step is replaced, with a WAV the app encodes itself.
    const audioRuns = await S(async () => { const ac = new AudioContext(); await ac.resume(); const t = ac.currentTime; await new Promise((r) => setTimeout(r, 500)); const ok = ac.currentTime - t > 0.3; ac.close(); return ok; });
    if (audioRuns) { await page.addInitScript(FAKE_MIC); await page.reload(); await page.waitForTimeout(800); }
    else {
      console.log("     (this browser doesn't run audio: recording is replaced, the rest is real)");
      await S(() => { window.recordVoice = async () => { await new Promise((r) => setTimeout(r, 300)); return encodeWav(downsample([Float32Array.from({ length: 48000 * 2 }, (_, i) => 0.3 * Math.sin(i / 20))], 48000, 16000), 16000); }; });
    }
    await page.click("#mode-describe");
    check(await S(() => S.api.ai.voice), "the server offers voice notes");
    // Keep a copy of the upload (Playwright doesn't expose multipart blob bodies).
    await S(() => { const f = window.fetch; window.fetch = (u, o) => { if (String(u).endsWith("/api/transcribe")) window.__sentWav = o.body.get("audio"); return f(u, o); }; });
    await page.fill("#describeInput", "");
    await page.click("#speakBtn");
    check((await page.textContent("#speakBtn")).trim() === "Stop", "Speak turns to Stop while recording");
    await page.waitForSelector("#saveBean", { timeout: 20000 }).catch(async () => { throw new Error(`voice: ${await page.textContent("#speakHint")} / ${await page.inputValue("#describeInput")}`); });
    check((await page.inputValue("#describeInput")) === "Example Roasters Kii AA, roasted last Tuesday, 250 grams", "the transcript fills the box and the coffee is looked up without a tap");
    const wav = await S(async () => {
      const b = window.__sentWav; if (!b) return null;
      const v = new DataView(await b.arrayBuffer());
      return { type: b.type, riff: String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)), rate: v.getUint32(24, true), channels: v.getUint16(22, true), bits: v.getUint16(34, true), seconds: +(v.getUint32(40, true) / 32000).toFixed(2) };
    });
    check(wav && wav.type === "audio/wav" && wav.riff === "RIFF" && wav.rate === 16000 && wav.channels === 1 && wav.bits === 16, `sent as 16 kHz mono 16-bit WAV (${JSON.stringify(wav)})`);
    check(wav && (audioRuns ? wav.seconds > 1.5 && wav.seconds < 6 : wav.seconds === 2), `the recording is the right length (${wav?.seconds} s)`);
    check((await page.textContent("#speakBtn")).trim() === "Speak", "Speak is ready again");
    await page.click("#discardBean");

    // Settings → "Speaking a description": this device instead of Gemini, kept per device.
    const voiceSetting = async (v) => {
      await page.goto(`http://localhost:${SKIN}/?full#settings`); await page.waitForSelector("#sVoice", { timeout: 10000 });
      await page.click(`#sVoice [data-v="${v}"]`);
      const hint = await page.textContent("#voiceHint");
      await page.goto(`http://localhost:${SKIN}/?full#add`); await page.waitForTimeout(800); await page.click("#mode-describe");
      return { hint, kind: await S(() => voiceKind()), stored: await S(() => localStorage.getItem(Object.keys(localStorage).find((k) => /voice$/.test(k)))) };
    };
    const onDevice = await voiceSetting("device");
    check(onDevice.kind !== "gemini" && /Nothing goes to Gemini/.test(onDevice.hint), `"This device" keeps voice off the server (${onDevice.kind}; ${onDevice.hint})`);
    check(/device/.test(onDevice.stored || ""), `the choice is saved on this device (${onDevice.stored})`);
    const backToGemini = await voiceSetting("gemini");
    check(backToGemini.kind === "gemini" && /goes to Gemini/.test(backToGemini.hint), `"Gemini" sends voice notes to the server again (${backToGemini.kind})`);

    // ---- 3. the server stops ----
    stop(server); await new Promise((r) => setTimeout(r, 800));
    const out = await S(() => S.api.recommend(S.current.id));
    check(out.source === "rules (AI unavailable)", `falls back to the rules (${out.source})`);
    await page.waitForTimeout(300);
    check((await page.textContent("#status")).includes("AI offline"), "status bar says AI is offline");
    check(await S(async () => (await S.api.machine.info()).model.includes("simulated")), "machine still works");
    await open(`decaid=http://localhost:${MOCK}`); // server saved but down: still live
    check(await S(() => S.api && !S.api.demo && !!S.api.info.serverError), "reload with the server down still runs live");

    // ---- 4. AI switched off ----
    await crema();
    await open(`decaid=http://localhost:${MOCK}`);
    check(await S(() => S.api.ai.on), "server back, AI on again");
    await page.goto(`http://localhost:${SKIN}/?full#settings`); await page.waitForTimeout(1200);
    await page.click("label.switch:has(#sAi)");
    await page.waitForTimeout(800);
    check(await S(async () => (await S.api.settings.get()).aiEnabled === false && !S.api.ai.on), "AI switched off in Settings");
    const off = await S(() => S.api.recommend(S.current.id));
    check(off.source === "rules", `rules used with AI off (${off.source})`);
    await page.goto(`http://localhost:${SKIN}/?full#add`); await page.waitForTimeout(800);
    check(await page.isHidden("#addModes") && (await page.textContent("#addNoAi")).includes("AI features are off"), "Add offers typing only, and says AI is off");
    check(!(await page.textContent("#status")).includes("AI offline"), "no AI warning when it's switched off");
    await open(`decaid=http://localhost:${MOCK}`);
    check(await S(() => !S.api.ai.on), "the switch is remembered (in Decaid)");

    // ---- 5. the phone app, served by the Crema server through its Decaid proxy ----
    procs.filter((p) => p.spawnargs.includes("server/main.ts")).forEach(stop);
    await new Promise((r) => setTimeout(r, 800));
    await start("npx", ["tsx", "server/main.ts"], { PORT: String(CREMA), LLM_PROVIDERS: "mock", DECAID_URL: `http://localhost:${MOCK}` }, "crema on");
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
    phone.on("pageerror", (e) => errs.push(`phone: ${e.message}`));
    await phone.goto(`http://localhost:${CREMA}/?full`); await phone.waitForTimeout(2000);
    const ph = await phone.evaluate(() => ({ live: !!S.api && !S.api.demo, decaid: S.api.info.decaidUrl, shelf: S.shelf.length, ai: S.api.ai.enabled }));
    check(ph.live && ph.decaid === `http://localhost:${MOCK}`, "phone app runs live through the server's proxy");
    check(ph.shelf >= 2 && ph.ai === false, "phone sees the tablet's coffees and settings (shared through Decaid)");
  } catch (e) {
    check(false, e.message.split("\n")[0]);
  }
  check(!errs.length, `no page errors${errs.length ? `: ${errs.join(" | ")}` : ""}`);
  await browser.close();
  skin.close();
  procs.forEach(stop);
  process.exit(failed ? 1 : 0);
})();
