// Sleep screen and sound in the demo: the date and wake text, tap to wake (the default),
// hold to wake (a tap or an early release leaves the machine asleep, a full hold wakes it),
// the chime (off by default, rings once when a shot ends), and that both settings are
// kept on this device across a reload. Needs Playwright.
//
//   node scripts/e2e-sleep.cjs            # the source app
//   node scripts/e2e-sleep.cjs --built    # the built single-file demo
//
// The chime is counted without any test hook in the app: an init script wraps the browser's
// own AudioContext.createOscillator, so each note the app starts is counted.
const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");

const built = process.argv.includes("--built");
function pageUrl() {
  if (!built) return "file://" + path.resolve(__dirname, "../skin/index.html") + "?demo&full";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crema-sleep-"));
  const html = fs.readFileSync(path.resolve(__dirname, "../demo/crema-demo.html"), "utf8");
  fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>${html}</body></html>`);
  return "file://" + path.join(dir, "index.html") + "?full";
}

let failed = false;
const check = (ok, label, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok || !detail ? "" : ` (${detail})`}`); if (!ok) failed = true; };

(async () => {
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await b.newContext({ viewport: { width: 1340, height: 800 } });
  await ctx.addInitScript(() => {
    window.__notes = 0;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const orig = AC.prototype.createOscillator;
    AC.prototype.createOscillator = function (...a) { window.__notes++; return orig.apply(this, a); };
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  const load = async () => {
    await p.goto("about:blank"); // a true reload, not a hash change
    await p.goto(pageUrl() + "#brew");
    await p.waitForFunction(() => typeof S !== "undefined" && S.api && S.snap && S.presets, null, { timeout: 15000 });
  };
  const state = () => p.evaluate(() => S.snap?.state?.state);
  const wake = () => p.evaluate(() => S.api.machine.setState("idle"));
  const sleep = async () => {
    await p.evaluate(() => S.api.machine.setState("sleeping"));
    await p.waitForFunction(() => S.snap?.state?.state === "sleeping");
    await p.waitForSelector("#saver:not([hidden])", { timeout: 8000 });
  };
  const settle = async () => {
    if ((await state()) !== "idle") await wake();
    await p.waitForFunction(() => S.snap?.state?.state === "idle", null, { timeout: 30000 });
  };
  const centre = async () => { const bx = await (await p.$("#saver")).boundingBox(); return [bx.x + bx.width / 2, bx.y + bx.height / 2]; };
  const flip = async (id) => {
    await p.evaluate(() => (location.hash = "#settings"));
    await p.waitForSelector(`#${id}`);
    await p.evaluate((i) => document.getElementById(i).click(), id);
  };

  try {
    await load();
    check(await p.evaluate(() => S.holdWake === false && S.chime === false), "hold to wake and chime default to off");
    check(await p.evaluate(() => localStorage.getItem("crema:holdWake") === null && localStorage.getItem("crema:chime") === null), "nothing is stored until the user changes them");

    // Default: a tap wakes.
    await sleep();
    const date = await p.textContent("#saverDate");
    check(/\d/.test(date) && date.trim().split(/\s+/).length >= 3, "the sleep screen shows the date in words", date);
    check(/\d/.test(await p.textContent("#saverTime")), "the sleep screen shows the time");
    check((await p.textContent("#saverHint")).includes("tap to wake"), "the wake text says tap to wake by default");
    let [x, y] = await centre();
    await p.mouse.click(x, y);
    await p.waitForFunction(() => S.snap?.state?.state !== "sleeping", null, { timeout: 5000 }).catch(() => {});
    check((await state()) !== "sleeping", "a tap wakes the machine by default", await state());
    await settle();

    // Hold to wake on.
    await flip("sHoldWake");
    check(await p.evaluate(() => S.holdWake === true && localStorage.getItem("crema:holdWake") === "true"), "turning hold to wake on is saved on this device");
    await sleep();
    check((await p.textContent("#saverHint")).includes("hold to wake"), "the wake text says hold to wake");
    [x, y] = await centre();
    await p.mouse.click(x, y);
    await p.waitForTimeout(1500);
    check((await state()) === "sleeping" && (await p.isVisible("#saver")), "a tap does not wake the machine", await state());
    await p.mouse.move(x, y); await p.mouse.down();
    await p.waitForTimeout(400);
    check(await p.evaluate(() => document.getElementById("saver").classList.contains("holding")), "the ring starts filling while held");
    await p.mouse.up();
    await p.waitForTimeout(1500);
    check((await state()) === "sleeping" && (await p.isVisible("#saver")), "a hold released early leaves the machine asleep", await state());
    check(await p.evaluate(() => !document.getElementById("saver").classList.contains("holding")), "the ring resets on release");
    await p.mouse.move(x, y); await p.mouse.down();
    await p.waitForFunction(() => S.snap?.state?.state !== "sleeping", null, { timeout: 4000 }).catch(() => {});
    await p.mouse.up();
    check((await state()) !== "sleeping" && !(await p.isVisible("#saver")), "a full hold wakes the machine", await state());
    await settle();

    // Keyboard.
    await sleep();
    await p.focus("#saver"); await p.keyboard.press("Enter");
    await p.waitForFunction(() => S.snap?.state?.state !== "sleeping", null, { timeout: 4000 }).catch(() => {});
    check((await state()) !== "sleeping", "Enter on the focused sleep screen wakes the machine", await state());
    await settle();

    // Reduced motion: the hold still works.
    await p.emulateMedia({ reducedMotion: "reduce" });
    await sleep();
    await p.mouse.move(x, y); await p.mouse.down();
    await p.waitForFunction(() => S.snap?.state?.state !== "sleeping", null, { timeout: 4000 }).catch(() => {});
    await p.mouse.up();
    check((await state()) !== "sleeping", "with reduced motion a full hold still wakes", await state());
    await settle();
    await p.emulateMedia({ reducedMotion: "no-preference" });

    // Persistence across a reload.
    await load();
    check(await p.evaluate(() => S.holdWake === true), "hold to wake survives a reload");
    await p.evaluate(() => (location.hash = "#settings"));
    await p.waitForSelector("#sHoldWake");
    check(await p.evaluate(() => document.getElementById("sHoldWake").checked), "the switch shows it on after a reload");

    // Chime.
    check((await p.evaluate(() => S.chime === false)) && (await p.evaluate(() => window.__notes)) === 0, "the chime is off and silent by default");
    await p.evaluate(() => S.api.machine.setState("espresso").catch(() => {}));
    await p.waitForFunction(() => S.snap?.state?.state === "espresso", null, { timeout: 10000 }).catch(() => {});
    await p.evaluate(() => S.api.machine.setState("idle"));
    await p.waitForTimeout(1500);
    check((await p.evaluate(() => window.__notes)) === 0, "no chime for a shot while the setting is off");
    await settle();
    await flip("sChime");
    await p.waitForTimeout(300);
    check(await p.evaluate(() => S.chime === true && localStorage.getItem("crema:chime") === "true"), "turning the chime on is saved on this device");
    const preview = await p.evaluate(() => window.__notes);
    check(preview === 2, "switching it on plays the two notes once as a preview", String(preview));
    await p.evaluate(() => { window.__notes = 0; });
    await p.evaluate(() => S.api.machine.setState("espresso").catch(() => {}));
    await p.waitForFunction(() => S.snap?.state?.state === "espresso", null, { timeout: 10000 }).catch(() => {});
    check((await state()) === "espresso", "a shot started in the demo");
    check((await p.evaluate(() => window.__notes)) === 0, "no chime while the shot runs");
    await p.evaluate(() => S.api.machine.setState("idle"));
    await p.waitForFunction(() => window.__notes > 0, null, { timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(500);
    check((await p.evaluate(() => window.__notes)) === 2, "the chime plays once when the shot ends", String(await p.evaluate(() => window.__notes)));

    // Heating to ready.
    await settle();
    await p.evaluate(() => { window.__notes = 0; });
    await p.evaluate(() => S.api.machine.setState("sleeping"));
    await p.waitForFunction(() => S.snap?.state?.state === "sleeping");
    await wake();
    await p.waitForFunction(() => S.snap?.state?.state === "heating", null, { timeout: 5000 }).catch(() => {});
    if ((await state()) === "heating") {
      const txt = await p.textContent("#status");
      await p.waitForFunction(() => S.snap?.state?.state === "idle", null, { timeout: 30000 });
      await p.waitForTimeout(500);
      check((await p.evaluate(() => window.__notes)) === 2, "the chime plays once when the machine reaches temperature", String(await p.evaluate(() => window.__notes)));
      console.log("note status while heating:", txt.replace(/\s+/g, " ").trim().slice(0, 80));
    } else console.log("skip heating chime (machine did not pass through heating)");
    // The ready-in text: the demo warms up too fast to catch, so feed the status bar a heating reading.
    const ready = await p.evaluate(() => { const was = [S.snap, S.ready]; S.snap = { ...S.snap, state: { state: "heating" } }; S.ready = { status: "heating", remainingTimeMs: 240000 }; renderStatus(); const t = document.getElementById("status").textContent; [S.snap, S.ready] = was; renderStatus(); return t; });
    check(/Warming up · ready in 4 min/.test(ready.replace(/\s+/g, " ")), "a heating machine with a Time To Ready reading shows the ready-in time", ready.replace(/\s+/g, " ").slice(0, 60));
    await load();
    await p.waitForTimeout(1500);
    const after = await p.evaluate(() => [S.chime, window.__notes, S.snap?.state?.state]);
    check(after[0] === true && after[1] === 0, "the chime setting survives a reload, and a reload is silent", JSON.stringify(after));
    check(errs.length === 0, "no page errors", errs.join("; "));
  } catch (e) {
    console.log("FAIL script error:", e.message); failed = true;
  }
  await b.close();
  process.exit(failed ? 1 : 0);
})();
