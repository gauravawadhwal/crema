// Takes the README screenshots from the demo: a 1340×800 landscape tablet
// (the DE1 tablet size) and an iPhone. Needs Playwright.
//   node scripts/screenshots.cjs            → docs/screenshots/*.png
const { chromium } = require("playwright");
const path = require("path");

const url = "file://" + path.resolve(__dirname, "../skin/index.html") + "?demo&full";
const out = path.resolve(__dirname, "../docs/screenshots");
const fs = require("fs");
// Where the key element sits in each screenshot (percent of the image), for the walkthrough's highlights.
const boxes = {};
async function mark(p, name, selector) {
  const vp = p.viewportSize();
  const r = await p.locator(selector).first().boundingBox();
  if (r) {
    const x = Math.max(0, r.x), y = Math.max(0, r.y);
    boxes[name] = { x: x / vp.width * 100, y: y / vp.height * 100, w: Math.max(0, Math.min(vp.width, r.x + r.width) - x) / vp.width * 100, h: Math.max(0, Math.min(vp.height, r.y + r.height) - y) / vp.height * 100 };
  }
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const tablet = await b.newPage({ viewport: { width: 1340, height: 800 }, colorScheme: "dark" });
  const shot = async (p, name, full = false) => {
    await p.evaluate(() => document.fonts.ready);
    return p.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  };

  await tablet.goto(url + "#brew"); await tablet.waitForTimeout(1200);
  await shot(tablet, "tablet-home"); await mark(tablet, "tablet-home", "#nextShot");
  await tablet.click('[data-run="espresso"]'); await tablet.waitForTimeout(4200);
  await shot(tablet, "tablet-pulling"); await mark(tablet, "tablet-pulling", ".live-col > .panel");
  await tablet.waitForSelector("#afterShot:not([hidden])", { timeout: 30000 });
  await tablet.click('#sb [data-v="-1"]'); await tablet.click('#bd [data-v="0"]'); await tablet.locator('#afterStars > span:not(.stars-fill) i[data-n="4"]').click({ position: { x: 24, y: 14 } }); await tablet.click("#reviewShot");
  await tablet.waitForTimeout(800);
  await shot(tablet, "tablet-after-shot"); await mark(tablet, "tablet-after-shot", "#afterShot");
  await tablet.click('[data-presets="steam"]'); await tablet.click('[data-preset="steam:2"]'); await tablet.click('[data-run="steam"]'); await tablet.waitForTimeout(6200);
  await shot(tablet, "tablet-steam"); await mark(tablet, "tablet-steam", "#opCard");
  await tablet.click("#opStop"); await tablet.waitForTimeout(500);
  for (const v of ["profiles", "shelf", "settings"]) {
    await tablet.goto(url + "#" + v); await tablet.waitForTimeout(1200);
    await shot(tablet, `tablet-${v}`);
    await mark(tablet, `tablet-${v}`, { profiles: "#recommended > .panel", shelf: ".bean-card", settings: "#settings > .panel" }[v]);
  }
  await tablet.goto(url + "#shots"); await tablet.waitForTimeout(900);
  await tablet.click("[data-cmp]:not([disabled]) >> nth=1"); await tablet.waitForTimeout(500);
  await shot(tablet, "tablet-shots"); await mark(tablet, "tablet-shots", "#shotDetail .chart-box");
  await tablet.goto(url + "#add"); await tablet.waitForTimeout(400);
  await tablet.click("#mode-describe"); await tablet.fill("#describeInput", "ONA La Fincona"); await tablet.click("#identifyBtn");
  await tablet.waitForSelector("#saveBean", { timeout: 10000 });
  await shot(tablet, "tablet-add-coffee"); await mark(tablet, "tablet-add-coffee", "#reviewPanel");

  const phone = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "light", isMobile: true, hasTouch: true });
  await phone.goto(url + "#brew"); await phone.waitForTimeout(1200);
  await shot(phone, "phone-home");
  await phone.click('[data-run="espresso"]'); await phone.waitForTimeout(3000);
  await shot(phone, "phone-pulling");
  await phone.waitForSelector("#afterShot:not([hidden])", { timeout: 30000 });
  await shot(phone, "phone-after-shot");
  await phone.goto(url + "#shelf"); await phone.waitForTimeout(900);
  await shot(phone, "phone-shelf");
  await phone.goto(url + "#profiles"); await phone.waitForTimeout(1200);
  await shot(phone, "phone-profiles");
  // One after-shot home screen per theme, for the README and walkthrough.
  for (const skin of ["verde", "crema", "rosso", "acciaio", "nordic", "notte"]) {
    const p = await b.newPage({ viewport: { width: 1340, height: 800 }, deviceScaleFactor: 0.5, colorScheme: "dark" });
    await p.addInitScript((s) => { window.CREMA_SKIN = s; }, skin);
    await p.goto(url + "#brew"); await p.waitForTimeout(900);
    await p.click('[data-run="espresso"]'); await p.waitForSelector("#afterShot:not([hidden])", { timeout: 30000 }); await p.waitForTimeout(300);
    await shot(p, `theme-${skin}`);
    await p.close();
  }
  fs.writeFileSync(`${out}/boxes.json`, JSON.stringify(boxes, null, 1));
  await b.close();
  console.log(`screenshots written to ${out}`);
})();
