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
    // Leaving for Decaid's dashboard: only inside Decaid's WebView, and not mid-operation.
    await page.goto(`http://localhost:${SKIN}/?full#settings`); await page.waitForSelector("#sGhc", { timeout: 10000 });
    check(await page.locator("#exitDash").count() === 0, "no Decaid exit in an ordinary browser");
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
    await page.click("#saveBean");
    await page.waitForFunction(() => S.current?.info.name.value === "Kii AA" && S.current.recipe, null, { timeout: 15000 });
    const got = await S(() => ({ name: S.current.info.name.value, source: S.current.recipeSource }));
    check(got.name === "Kii AA" && got.source === "mock", `identified by the server and recipe chosen by the AI (${got.name}, ${got.source})`);
    check(await S(() => S.shelf.length >= 2), "both coffees on the shelf");

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
