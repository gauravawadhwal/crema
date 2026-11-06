// Clicks through the whole demo at tablet and phone sizes and fails on any
// page error, failed step or sideways scroll. Needs Playwright.
//
//   node scripts/e2e-demo.cjs                 # the source app (skin/index.html)
//   node scripts/e2e-demo.cjs --built         # the built single-file demo (demo/crema-demo.html)
//   node scripts/e2e-demo.cjs --shots <dir>   # also save a screenshot per step
//
// --built matters: the single-file demo is produced by scripts/build-demo.mjs,
// and a bug in that step once shipped a blank page while the source app worked.
const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");

const args = process.argv.slice(2);
const built = args.includes("--built");
const shotsDir = args.includes("--shots") ? path.resolve(args[args.indexOf("--shots") + 1]) : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

function pageUrl() {
  if (!built) return "file://" + path.resolve(__dirname, "../skin/index.html") + "?demo&full";
  // The built demo is a page fragment; wrap it in a minimal document, as an embedding host would.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crema-e2e-"));
  const html = fs.readFileSync(path.resolve(__dirname, "../demo/crema-demo.html"), "utf8");
  fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>${html}</body></html>`);
  return "file://" + path.join(dir, "index.html") + "?full";
}

(async () => {
  const url = pageUrl();
  const b = await chromium.launch();
  let failed = false;
  for (const [name, vp, scheme] of [["tablet", { width: 1340, height: 800 }, "dark"], ["phone", { width: 390, height: 844 }, "light"]]) {
    const p = await b.newPage({ viewport: vp, colorScheme: scheme });
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    const snap = (label, full = false) => shotsDir && p.screenshot({ path: `${shotsDir}/${name}-${label}.png`, fullPage: full });
    const step = async (label, fn) => { try { await fn(); } catch (e) { errs.push(`${label}: ${e.message.split("\n")[0]}`); } };

    await p.goto(url + "#brew"); await p.waitForTimeout(1200); await snap("1-home");
    await step("espresso", async () => {
      await p.click('[data-run="espresso"]'); await p.waitForTimeout(3000); await snap("2-pulling");
      await p.waitForSelector("#afterShot:not([hidden])", { timeout: 20000 });
    });
    await step("taste", async () => {
      await p.click('#afterShot .star[data-n="4"]'); await p.click('#sb [data-v="-1"]'); await p.click("#sendTaste");
      await p.waitForSelector("#adviceBox .advice", { timeout: 5000 }); await snap("3-after", true);
    });
    await step("steam", async () => {
      await p.click('[data-preset="steam:0"]'); await p.click('[data-run="steam"]');
      await p.waitForSelector("#opOverlay:not([hidden])", { timeout: 5000 }); await snap("4-steam");
      await p.click("#opStop"); await p.waitForTimeout(600);
    });
    await step("favourite", async () => { await p.click('[data-fav="0"]'); await p.waitForTimeout(300); });
    for (const v of ["profiles", "shelf", "shots", "settings"]) {
      await step(v, async () => { await p.goto(url + "#" + v); await p.waitForTimeout(1300); await snap(`5-${v}`, true); });
    }
    await step("compare", async () => {
      await p.goto(url + "#shots"); await p.waitForTimeout(800);
      await p.click("[data-cmp]:not([disabled]) >> nth=1"); await p.waitForTimeout(500); await snap("6-compare", true);
    });
    await step("theme", async () => {
      await p.goto(url + "#settings"); await p.waitForTimeout(900);
      await p.click('[data-skin="rosso"]');
      if ((await p.evaluate(() => document.documentElement.dataset.skin)) !== "rosso") throw new Error("theme not applied");
      await p.click('[data-skin="verde"]');
      if ((await p.evaluate(() => document.documentElement.dataset.skin)) !== "verde") throw new Error("default theme not restored");
    });
    await step("add coffee", async () => {
      await p.goto(url + "#add"); await p.waitForTimeout(500);
      await p.click("#mode-describe"); await p.fill("#describeInput", "ONA La Fincona, roasted last week, 250 grams"); await p.click("#identifyBtn");
      await p.waitForSelector("#saveBean", { timeout: 8000 }); await snap("7-review", true);
      await p.click("#saveBean"); await p.waitForTimeout(2000); await snap("8-after-add", true);
    });
    await step("sleep", async () => {
      await p.goto(url + "#brew"); await p.waitForTimeout(600);
      await p.click(name === "phone" ? "#phoneSleep" : "#railSleep");
      await p.waitForSelector("#saver:not([hidden])", { timeout: 8000 }); await snap("9-saver");
    });
    const hscroll = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (hscroll) errs.push("page scrolls sideways");
    console.log(`${name}: ${errs.length ? "FAIL\n  " + errs.join("\n  ") : "ok"}`);
    failed ||= errs.length > 0;
    await p.close();
  }
  await b.close();
  process.exit(failed ? 1 : 0);
})();
