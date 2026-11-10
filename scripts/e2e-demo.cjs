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

// One device's click-through; returns its errors. Tablet and phone run side by side,
// each page in its own browser context, so their demo data doesn't mix.
async function clickThrough(b, url, [name, vp, scheme]) {
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
  // Ratings are Decaid's 0–10, shown as half stars: the left part of a star is a half.
  const starAt = async (sel, n, frac) => { await p.locator(sel).scrollIntoViewIfNeeded(); const b = await p.locator(`${sel} > span:not(.stars-fill) i[data-n="${n}"]`).boundingBox(); return [b.x + b.width * frac, b.y + b.height / 2]; };
  const rating = (sel) => p.getAttribute(sel, "aria-valuenow");
  const expectRating = async (sel, v, how) => { const got = await rating(sel); if (got !== v) throw new Error(`${how}: rating ${got}, expected ${v}`); };
  await step("rate by tap and drag", async () => {
    await p.mouse.click(...(await starAt("#afterStars", 3, 0.3))); await expectRating("#afterStars", "5", "tap left half of star 3");
    await p.mouse.move(...(await starAt("#afterStars", 1, 0.8))); await p.mouse.down();
    await p.mouse.move(...(await starAt("#afterStars", 5, 0.9)), { steps: 6 }); await p.mouse.up(); await expectRating("#afterStars", "10", "drag to the end");
    await p.focus("#afterStars"); await p.keyboard.press("ArrowLeft"); await expectRating("#afterStars", "9", "arrow key");
    await p.mouse.click(...(await starAt("#afterStars", 4, 0.85))); await expectRating("#afterStars", "8", "tap right of star 4");
  });
  await step("taste", async () => {
    await p.click('#sb [data-v="-1"]'); await p.click('#bd [data-v="0"]'); await p.click("#reviewShot");
    await p.waitForSelector("#reviewBox .advice", { timeout: 5000 }); await snap("3-after", true);
  });
  await step("steam", async () => {
    await p.click('[data-preset="steam:0"]'); await p.click('[data-run="steam"]');
    await p.waitForSelector("#opOverlay:not([hidden])", { timeout: 5000 }); await snap("4-steam");
    await p.click("#opStop"); await p.waitForTimeout(600);
  });
  await step("favourite", async () => { await p.locator('#addFav').scrollIntoViewIfNeeded(); await p.click('#addFav'); await p.waitForSelector('[data-fav="0"]'); });
  for (const v of ["profiles", "shelf", "shots", "settings"]) {
    await step(v, async () => { await p.goto(url + "#" + v); await p.waitForTimeout(1300); await snap(`5-${v}`, true); });
  }
  await step("rating saved", async () => {
    await p.goto(url + "#shots"); await p.waitForTimeout(800);
    const label = await p.getAttribute("[data-rating] .stars >> nth=0", "aria-label");
    if (label !== "4 of 5 stars") throw new Error(`newest shot shows "${label}"`);
    await expectRating("#detailStars", "8", "shot detail");
  });
  await step("compare", async () => {
    await p.goto(url + "#shots"); await p.waitForTimeout(800);
    await p.click("[data-cmp]:not([disabled]) >> nth=1"); await p.waitForTimeout(500); await snap("6-compare", true);
  });
  // The demo shows the Decaid exit so it can be seen; it only explains itself.
  await step("leave for Decaid", async () => {
    await p.goto(url + "#settings"); await p.waitForSelector("#exitDash", { timeout: 5000 });
    await p.click("#exitDash");
    const msg = await p.textContent("#toast");
    if (!/closes Crema/.test(msg)) throw new Error(`toast says "${msg}"`);
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
  await p.close();
  return errs;
}

(async () => {
  const url = pageUrl();
  const b = await chromium.launch();
  const devices = [["tablet", { width: 1340, height: 800 }, "dark"], ["phone", { width: 390, height: 844 }, "light"]];
  const results = await Promise.all(devices.map((d) => clickThrough(b, url, d)));
  devices.forEach(([name], i) => console.log(`${name}: ${results[i].length ? "FAIL\n  " + results[i].join("\n  ") : "ok"}`));
  await b.close();
  process.exit(results.some((e) => e.length) ? 1 : 0);
})();
