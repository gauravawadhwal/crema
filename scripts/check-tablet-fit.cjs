// Checks that the Brew home screen fits the DE1 tablet (1340x800 landscape) without
// scrolling, at 1x and at scaled sizes, with and without the Android nav bar, before
// and after a shot. Exits nonzero if the page scrolls in either direction, a column
// clips its content, or the page throws. Needs Playwright.
//
//   node scripts/check-tablet-fit.cjs [screenshotDir] [url]
//
// Screenshots go to a temporary folder unless a directory is given.
const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SIZES = [
  [1340, 800, "tablet at 1x"],
  [1340, 752, "1x with nav bar"],
  [1206, 720, "tablet at ~1.1x"],
  [1005, 600, "tablet at 1.33x"],
  [1005, 552, "1.33x with nav bar"],
];

const out = process.argv[2] ? path.resolve(process.argv[2]) : fs.mkdtempSync(path.join(os.tmpdir(), "crema-fit-"));
const url = process.argv[3] || "file://" + path.resolve(__dirname, "../skin/index.html") + "?demo&full";
fs.mkdirSync(out, { recursive: true });

// Page height and width against the viewport, and each Brew column's overflow in px.
const measure = (p) => p.evaluate(() => ({
  sh: document.documentElement.scrollHeight,
  sw: document.documentElement.scrollWidth,
  ih: innerHeight,
  iw: innerWidth,
  cols: [...document.querySelectorAll("#view-brew > .stack")].map((c) => ({ name: c.className.split(" ")[1], over: c.scrollHeight - c.clientHeight })),
}));

(async () => {
  const b = await chromium.launch();
  const problems = [];
  for (const [w, h, label] of SIZES) {
    const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: "dark" });
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    const check = (stage, m) => {
      const where = `${w}x${h} (${label}) ${stage}`;
      if (m.sh > m.ih) problems.push(`${where}: page scrolls (${m.sh}px in ${m.ih}px)`);
      if (m.sw > m.iw) problems.push(`${where}: page scrolls sideways (${m.sw}px in ${m.iw}px)`);
      for (const c of m.cols) if (c.over > 1) problems.push(`${where}: ${c.name} column clipped by ${c.over}px`);
      const cols = m.cols.map((c) => `${c.name} ${c.over > 1 ? `CLIPPED ${c.over}px` : "ok"}`).join(", ");
      console.log(`${where}: ${m.sh}/${m.ih}${m.sh > m.ih ? " SCROLLS" : " fits"}; columns: ${cols}`);
    };
    try {
      await p.goto(url + "#brew");
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(1200);
      check("home", await measure(p));
      await p.screenshot({ path: `${out}/fit-${w}x${h}-home.png` });
      await p.click('[data-run="espresso"]');
      await p.waitForSelector("#afterShot:not([hidden])", { timeout: 30000 });
      await p.waitForTimeout(400);
      check("after shot", await measure(p));
      await p.screenshot({ path: `${out}/fit-${w}x${h}-after.png` });
    } catch (e) {
      errs.push(e.message.split("\n")[0]);
    }
    for (const e of errs) problems.push(`${w}x${h} (${label}): ${e}`);
    await p.close();
  }
  await b.close();
  console.log(`Screenshots in ${out}`);
  if (problems.length) {
    console.error(`\nFAIL: ${problems.length} problem(s)\n  ` + problems.join("\n  "));
    process.exit(1);
  }
  console.log("OK: the Brew screen fits at every tablet size, before and after a shot.");
})();
