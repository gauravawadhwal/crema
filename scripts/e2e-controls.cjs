// Machine-control races in the demo: Stop must cancel a start that is still
// waiting on a settings write or a recipe load, a start must not run twice,
// and Stop pressed while the start command itself is in flight must win.
// Needs Playwright.
//
//   node scripts/e2e-controls.cjs            # the source app
//   node scripts/e2e-controls.cjs --built    # the built single-file demo
//   node scripts/e2e-controls.cjs --url http://localhost:3000/
//       # the skin as served by desktop Decaid with its simulated machine
//
// --url sends real start and stop commands to whatever machine that Decaid is
// connected to, so it only accepts a page on this computer. Don't point it at a
// Decaid that controls a real DE1.
//
// Each case holds one of the app's machine requests open, presses buttons the
// way a person would, then releases the request and checks which commands the
// app sent and what state the (simulated) machine ended in.
const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");

const built = process.argv.includes("--built");
const urlArg = process.argv.includes("--url") ? process.argv[process.argv.indexOf("--url") + 1] : null;
function pageUrl() {
  if (urlArg) {
    const u = new URL(urlArg);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) { console.error("--url must be a page on this computer (localhost)"); process.exit(2); }
    u.searchParams.set("full", ""); u.hash = "";
    return u.toString().replace("full=", "full");
  }
  if (!built) return "file://" + path.resolve(__dirname, "../skin/index.html") + "?demo&full";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crema-ctl-"));
  const html = fs.readFileSync(path.resolve(__dirname, "../demo/crema-demo.html"), "utf8");
  fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>${html}</body></html>`);
  return "file://" + path.join(dir, "index.html") + "?full";
}

let failed = false;
const check = (ok, label, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok || !detail ? "" : ` (${detail})`}`); if (!ok) failed = true; };

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1340, height: 800 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(pageUrl() + "#brew");
  await p.waitForFunction(() => typeof S !== "undefined" && S.api && S.snap && S.presets, null, { timeout: 15000 });

  // Record every state command, and let a test hold any machine request open.
  await p.evaluate(() => {
    const m = S.api.machine;
    window.__calls = [];
    window.__holds = {};
    window.__hold = (name) => { let release; const gate = new Promise((r) => (release = r)); window.__holds[name] = gate; return () => { delete window.__holds[name]; release(); }; };
    const wrap = (obj, key, name) => { const orig = obj[key].bind(obj); obj[key] = async (...a) => { const g = window.__holds[typeof name === "function" ? name(...a) : name]; if (g) await g; return orig(...a); }; };
    const setState = m.setState.bind(m);
    m.setState = async (s) => { window.__calls.push(s); const g = window.__holds[`state:${s}`]; if (g) await g; return setState(s); };
    wrap(m.shotSettings, "set", "shotSettings");
    wrap(m.settings, "set", "settings");
    wrap(S.api, "apply", "apply");
  });
  const state = () => p.evaluate(() => S.snap?.state?.state);
  const calls = () => p.evaluate(() => window.__calls.slice());
  const reset = async () => {
    await p.evaluate(() => { window.__holds = {}; if (["espresso", "steam", "hotWater", "flush", "sleeping"].includes(S.snap?.state?.state)) return S.api.machine.setState("idle"); });
    await p.waitForFunction(() => !["espresso", "steam", "hotWater", "flush", "sleeping"].includes(S.snap?.state?.state), null, { timeout: 15000 });
    await p.waitForTimeout(3200); // past the double-start guard
    await p.evaluate(() => { window.__calls = []; renderControls(); });
  };
  const hold = (name) => p.evaluate((n) => { window.__release = window.__hold(n); }, name);
  const release = () => p.evaluate(() => window.__release());
  const tap = (sel) => p.evaluate((s) => document.querySelector(s).click(), sel); // a tap, even on a disabled-looking button

  try {
    // 1. Stop while steam's settings write is still pending.
    await reset();
    await hold("shotSettings");
    await tap('[data-run="steam"]');
    await tap("#stopBtn");
    await release();
    await p.waitForTimeout(800);
    let c = await calls();
    check(!c.includes("steam") && (await state()) !== "steam", "Stop cancels steam that was waiting on its settings", `commands ${c.join(",")}, machine ${await state()}`);

    // 2. Stop while espresso is still loading the recipe.
    await reset();
    await p.evaluate(() => { S.loaded = false; renderNextShot(); renderControls(); });
    await hold("apply");
    await tap('[data-run="espresso"]');
    await tap("#stopBtn");
    await release();
    await p.waitForTimeout(800);
    c = await calls();
    check(!c.includes("espresso") && (await state()) !== "espresso", "Stop cancels espresso that was loading the recipe", `commands ${c.join(",")}, machine ${await state()}`);

    // 3. Stop while the start command itself is in flight: the stop can reach the
    //    machine first, so the app has to stop again once the start lands.
    await reset();
    await hold("state:flush");
    await tap('[data-run="flush"]');
    await p.waitForFunction(() => window.__calls.includes("flush"));
    await tap("#stopBtn");
    await release();
    await p.waitForTimeout(800);
    c = await calls();
    check((await state()) !== "flush" && c[c.length - 1] === "idle", "Stop wins over a start command already in flight", `commands ${c.join(",")}, machine ${await state()}`);

    // 4. A double tap starts once.
    await reset();
    await hold("settings");
    await tap('[data-run="flush"]');
    await tap('[data-run="flush"]');
    await release();
    await p.waitForFunction(() => window.__calls.includes("flush"), null, { timeout: 5000 }).catch(() => {});
    await tap('[data-run="flush"]'); // after the start, before the machine reports it
    await p.waitForTimeout(500);
    c = await calls();
    check(c.filter((s) => s === "flush").length === 1, "a double tap starts flush once", `commands ${c.join(",")}`);
    await tap("#stopBtn");

    // 5. Stop is available while a start is pending.
    await reset();
    await hold("shotSettings");
    await tap('[data-run="steam"]');
    check(await p.evaluate(() => !document.querySelector("#stopBtn").disabled), "Stop is enabled while a start is pending");
    check(await p.evaluate(() => document.querySelector('[data-run="steam"]').disabled), "start buttons are disabled while a start is pending");
    await tap("#stopBtn");
    await release();

    // 6. A normal start still works.
    await reset();
    await tap('[data-run="flush"]');
    await p.waitForFunction(() => S.snap?.state?.state === "flush", null, { timeout: 5000 }).catch(() => {});
    check((await state()) === "flush", "a plain start still runs", `machine ${await state()}`);
    await tap("#opStop");
  } catch (e) {
    check(false, e.message.split("\n")[0]);
  }
  check(!errs.length, `no page errors${errs.length ? `: ${errs.join(" | ")}` : ""}`);
  await b.close();
  process.exit(failed ? 1 : 0);
})();
