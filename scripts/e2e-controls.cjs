// Machine-control races in the demo: Stop must cancel a start that is still
// waiting on a settings write or a recipe load, a start must not run twice,
// Stop pressed while the start command itself is in flight must win, and a
// recipe load during a shot must wait for the shot to end.
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
    wrap(m.workflowSettings, "set", "workflowSettings");
    wrap(m.settings, "set", "settings");
    wrap(S.api, "apply", "apply");
    // Every recipe write, with the machine state at the moment it was sent.
    window.__applies = [];
    const apply = S.api.apply;
    S.api.apply = (id, recipe, grind) => { window.__applies.push({ state: S.snap?.state?.state, dose: recipe.doseG }); return apply(id, recipe, grind); };
  });
  // The espresso cases need a coffee with a recipe; a fresh Decaid (--url) may have none.
  const hasRecipe = await p.evaluate(() => !!S.next);
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
  // A real tap: press, hold about as long as a finger does, release.
  const press = async (sel, ms = 150) => {
    const box = await (await p.$(sel)).boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.down(); await p.waitForTimeout(ms); await p.mouse.up();
  };

  try {
    // 1. Stop while steam's settings write is still pending.
    await reset();
    await hold("workflowSettings");
    await tap('[data-run="steam"]');
    await tap("#stopBtn");
    await release();
    await p.waitForTimeout(800);
    let c = await calls();
    check(!c.includes("steam") && (await state()) !== "steam", "Stop cancels steam that was waiting on its settings", `commands ${c.join(",")}, machine ${await state()}`);

    // 2. Stop while espresso is still loading the recipe.
    if (!hasRecipe) console.log("skip Stop cancels espresso that was loading the recipe (no coffee on the shelf, so no recipe)");
    else {
      await reset();
      await p.evaluate(() => { S.loaded = false; renderNextShot(); renderControls(); });
      await hold("apply");
      await tap('[data-run="espresso"]');
      await tap("#stopBtn");
      await release();
      await p.waitForTimeout(800);
      c = await calls();
      check(!c.includes("espresso") && (await state()) !== "espresso", "Stop cancels espresso that was loading the recipe", `commands ${c.join(",")}, machine ${await state()}`);
    }

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
    await hold("workflowSettings");
    await tap('[data-run="steam"]');
    check(await p.evaluate(() => !document.querySelector("#stopBtn").disabled), "Stop is enabled while a start is pending");
    check(await p.evaluate(() => document.querySelector('[data-run="steam"]').disabled), "start buttons are disabled while a start is pending");
    await tap("#stopBtn");
    await release();

    // 6. Loading a recipe during a shot waits for the shot to end, and the latest
    //    choice is the one sent. Decaid would otherwise rewrite the profile steps
    //    the machine is pouring.
    if (!hasRecipe) console.log("skip recipe loads wait for the shot to end (no coffee on the shelf, so no recipe)");
    else {
      await reset();
      await tap('[data-run="espresso"]');
      await p.waitForFunction(() => S.snap?.state?.state === "espresso", null, { timeout: 10000 });
      await p.evaluate(() => { window.__applies = []; });
      const dose0 = await p.evaluate(() => S.next.doseG);
      await tap('[data-step="dose:1"]');
      await tap("#loadBtn");
      await tap('[data-step="dose:1"]');
      await tap("#loadBtn");
      const during = await p.evaluate(() => ({ applies: window.__applies.slice(), label: document.querySelector("#loadBtn").textContent, toast: document.querySelector("#toast").textContent }));
      check(during.applies.length === 0, "no recipe is written to the machine during a shot", JSON.stringify(during.applies));
      check(/after this shot/.test(during.label) && /shot ends/.test(during.toast), "the app says the recipe loads after the shot", `${during.label} / ${during.toast}`);
      await tap("#stopBtn");
      await p.waitForFunction(() => window.__applies.length > 0, null, { timeout: 10000 }).catch(() => {});
      await p.waitForTimeout(500);
      const after = await p.evaluate(() => ({ applies: window.__applies.slice(), loaded: S.loaded, held: S.heldLoad }));
      check(after.applies.length === 1 && after.applies[0].state !== "espresso" && after.applies[0].dose === dose0 + 1, "once the shot ends, the latest recipe is loaded once", JSON.stringify(after));
      check(after.loaded && !after.held, "and it shows as loaded");
    }

    // 7. Espresso pressed while a manual load is still on its way waits for it,
    //    instead of writing the recipe a second time.
    if (!hasRecipe) console.log("skip a start waits for a load already on its way (no coffee on the shelf, so no recipe)");
    else {
      await reset();
      await tap('[data-step="dose:1"]'); // the recipe now needs loading
      await p.evaluate(() => { window.__applies = []; });
      await hold("apply");
      await tap("#loadBtn");
      await tap('[data-run="espresso"]');
      await p.waitForTimeout(300);
      await release();
      await p.waitForFunction(() => S.snap?.state?.state === "espresso", null, { timeout: 10000 }).catch(() => {});
      const ov = await p.evaluate(() => ({ applies: window.__applies.length, state: S.snap?.state?.state }));
      check(ov.applies === 1 && ov.state === "espresso", "a start waits for a load already on its way, and the recipe is written once", JSON.stringify(ov));
      await tap("#stopBtn");
    }

    // 8. Nothing starts while the machine is in a state that isn't ready (error,
    //    cleaning, firmware update...). Stop stays available.
    await reset();
    const busy = await p.evaluate(async () => {
      const out = {};
      for (const st of ["error", "descaling", "fwUpgrade"]) {
        onSnapshot({ ...S.snap, state: { state: st, substate: "idle" } });
        const sent = window.__calls.length;
        await startOp("flush");
        out[st] = { start: document.querySelector('[data-run="flush"]').disabled, stop: !document.querySelector("#stopBtn").disabled, sent: window.__calls.length - sent, banner: st === "error" ? /reports an error/.test(document.querySelector("#alerts").textContent) : null };
      }
      return out;
    });
    check(Object.values(busy).every((x) => x.start && x.stop && x.sent === 0) && busy.error.banner, "no start in error, descaling or firmware states; Stop stays; an error gets a banner", JSON.stringify(busy));

    // 9. A normal start still works.
    await reset();
    await tap('[data-run="flush"]');
    await p.waitForFunction(() => S.snap?.state?.state === "flush", null, { timeout: 5000 }).catch(() => {});
    check((await state()) === "flush", "a plain start still runs", `machine ${await state()}`);

    // 10. A finger-length tap on the running overlay's Stop lands. Its card is redrawn
    // on every machine update; if the button were replaced between press and release,
    // the tap would be lost (an instant click() never shows this).
    await p.waitForTimeout(400);
    await press("#opStop");
    await p.waitForFunction(() => S.snap?.state?.state !== "flush", null, { timeout: 3000 }).catch(() => {});
    check((await state()) !== "flush", "a held tap on the running overlay's Stop stops the machine", `machine ${await state()}`);

    // 11. The same for the tare buttons, redrawn on every scale and machine update.
    // At idle those come rarely, so redraw as often as a shot does (every 50 ms).
    await reset();
    await p.evaluate(() => {
      window.__tares = 0; const t = S.api.machine.tare; S.api.machine.tare = (...a) => { window.__tares++; return t(...a); };
      window.__redraw = setInterval(() => { S.scale = { ...S.scale, connected: true, weight: (S.scale.weight || 0) + 0.1 }; renderStatus(); renderReadouts(); }, 50);
    });
    for (const sel of ["#scaleChip", "#weightReadout"]) {
      await p.evaluate(() => (window.__tares = 0));
      for (let i = 0; i < 3; i++) { await press(sel); await p.waitForTimeout(150); }
      const n = await p.evaluate(() => window.__tares);
      check(n === 3, `held taps on ${sel} each tare the scale`, `${n} of 3`);
    }
    await p.evaluate(() => clearInterval(window.__redraw));

    // 12. Stop never moves: its rectangle is the same at rest (loaded or not), during a
    // shot and after it, at each DE1 tablet size.
    if (!hasRecipe) console.log("skip Stop keeps its rectangle (no coffee on the shelf, so no recipe)");
    else for (const [w, h] of [[1340, 800], [1340, 752], [1206, 720], [1005, 600], [1005, 552]]) {
      await p.setViewportSize({ width: w, height: h });
      await reset();
      const rect = () => p.evaluate(() => { const r = document.querySelector("#stopBtn").getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10).join(","); });
      await tap('[data-step="dose:1"]'); // recipe not on the machine: the Espresso hint applies
      await p.waitForTimeout(100);
      const notLoaded = await rect();
      await tap("#loadBtn");
      await p.waitForFunction(() => S.loaded, null, { timeout: 5000 }).catch(() => {});
      await p.waitForTimeout(100);
      const atRest = await rect();
      await tap('[data-run="espresso"]');
      await p.waitForFunction(() => S.snap?.state?.state === "espresso", null, { timeout: 10000 }).catch(() => {});
      await p.waitForTimeout(300);
      const during = await rect();
      await tap("#stopBtn");
      await reset();
      const after = await rect();
      check(notLoaded === atRest && atRest === during && during === after, `Stop's rectangle is identical before, during and after a shot at ${w}x${h}`, `${notLoaded} | ${atRest} | ${during} | ${after}`);
    }
    await p.setViewportSize({ width: 1340, height: 800 });
  } catch (e) {
    check(false, e.message.split("\n")[0]);
  }
  check(!errs.length, `no page errors${errs.length ? `: ${errs.join(" | ")}` : ""}`);
  await b.close();
  process.exit(failed ? 1 : 0);
})();
