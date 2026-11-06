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
const check = (ok, label) => { console.log(`${ok ? "ok  " : "FAIL"} ${label}`); if (!ok) failed = true; };

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
    check(await page.isHidden("#demoBanner"), "no demo banner");
    check(await S(() => !S.api.ai.available && !S.api.ai.on), "AI reported unavailable");
    await page.goto(`http://localhost:${SKIN}/?full#add`); await page.waitForTimeout(800);
    check(await page.isHidden("#addModes") && await page.isVisible("#mRoaster") && await page.isVisible("#addNoAi"), "Add offers typing the details only");
    await addByHand("Test Roasters", "Hand Entry");
    check(await S(() => S.current.recipeSource === "rules"), "rules chose the recipe");
    const kv = await (await fetch(`http://localhost:${MOCK}/api/v1/store/crema`)).json();
    check(kv.some((k) => k.startsWith("bean:")), "Crema's record is stored in Decaid's key-value store");
    const fb = await S(async () => { const [shot] = await S.api.shots(1); return shot ? S.api.feedback(shot.id, S.current.id, { sourBitter: -1, body: 0, enjoyment: 3, notes: null }) : { source: "no shot" }; });
    check(fb.source === "rules" || fb.source === "no shot", `dial-in advice from the rules (${fb.source})`);
    // Steam and hot water write their preset first. Decaid has no GET for shot
    // settings and rejects a partial write, so this only works if the app reads
    // the stream and sends the whole object.
    const shotSettings = () => new Promise((resolve) => {
      const ws = new (require("ws"))(`ws://localhost:${MOCK}/ws/v1/machine/shotSettings`);
      ws.on("message", (m) => { ws.close(); resolve(JSON.parse(m)); });
    });
    for (const [kind, preset, field] of [["steam", "steam:1", "targetSteamDuration"], ["hotWater", "water:2", "targetHotWaterVolume"]]) {
      await page.goto(`http://localhost:${SKIN}/?full#brew`); await page.waitForTimeout(1000);
      await page.click(`[data-preset="${preset}"]`); await page.waitForTimeout(400);
      await page.click(`[data-run="${kind}"]`);
      const ran = await page.waitForFunction((k) => S.snap?.state?.state === k, kind, { timeout: 5000 }).then(() => true, () => false);
      const want = await page.evaluate((pr) => { const [k, i] = pr.split(":"); const x = S.presets[k][i]; return x.seconds ?? x.ml; }, preset);
      const ss = await shotSettings();
      check(ran && ss[field] === want && ss.groupTemp != null, `${kind} starts with its preset (${field} ${ss[field]}, wanted ${want})`);
      await S(() => stopMachine()); await page.waitForTimeout(800);
    }
    await page.goto(`http://localhost:${SKIN}/?full#settings`); await page.waitForTimeout(1200);
    check((await page.textContent("#settings")).includes("Not connected"), "Settings shows no Crema server");
    const steamT = await page.inputValue("#sSteamT").catch(() => "");
    check(steamT !== "", `Settings shows the steam temperature (${steamT || "missing"})`);
    if (steamT) {
      const before = await shotSettings();
      await page.click('[data-mini="sSteamT:5"]'); await page.waitForTimeout(800);
      const after = await shotSettings();
      check(after.targetSteamTemp === before.targetSteamTemp + 5 && after.targetHotWaterVolume === before.targetHotWaterVolume, "changing steam temperature keeps the other shot settings");
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
    await page.click("#saveBean");
    await page.waitForFunction(() => S.current?.info.name.value === "Kii AA" && S.current.recipe, null, { timeout: 15000 });
    const got = await S(() => ({ name: S.current.info.name.value, source: S.current.recipeSource }));
    check(got.name === "Kii AA" && got.source === "mock", `identified by the server and recipe chosen by the AI (${got.name}, ${got.source})`);
    check(await S(() => S.shelf.length >= 2), "both coffees on the shelf");

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
