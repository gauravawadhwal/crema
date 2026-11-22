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
  await step("coffee selection feedback", async () => {
    const state = () => p.evaluate(() => ({ name: S.current?.info.name.value, key: S.current?.key, profile: S.next?.profileTitle, text: document.querySelector("#coffeeAnnouncement").textContent, toast: document.querySelector("#toast").textContent }));
    const live = p.locator("#coffeeAnnouncement");
    if (await live.getAttribute("role") !== "status" || await live.getAttribute("aria-atomic") !== "true") throw new Error("selection announcement is not an atomic live status");
    const seen = [];
    for (let i = 0; i < 4; i++) {
      await p.focus("#nextBean"); await p.keyboard.press("Enter"); await p.waitForTimeout(100);
      const s = await state(); seen.push(s.key);
      if (!s.text.includes(s.name) || /Now brewing/.test(s.toast)) throw new Error(`next selection feedback: ${JSON.stringify(s)}`);
    }
    if (new Set(seen).size !== 4) throw new Error("rapid selection did not visit four bags");
    const final = await state();
    if (!(await p.textContent("#coffeeChoice")).includes(final.name) || !(await p.textContent("#profileBtn")).includes(final.profile)) throw new Error("final coffee and recipe do not match selection");
    await p.click("#prevBean"); await p.waitForTimeout(100);
    if ((await state()).key !== seen[2]) throw new Error("previous did not select previous bag");
    await p.click("#coffeeChoice"); await p.click("#chooseNoBag");
    if ((await state()).text !== "Selected: No bag" || !(await p.textContent("#coffeeChoice")).includes("No bag")) throw new Error("No bag feedback missing");
    await p.click("#coffeeChoice"); await p.locator("[data-choose-bag]").first().click(); await p.waitForTimeout(100);
    if (!(await state()).text.includes((await state()).name)) throw new Error("picker feedback missing");
    await p.goto(url + "#shelf"); await p.waitForSelector("[data-brew]");
    await p.locator('[data-brew]:has-text("Brew this")').first().click(); await p.waitForTimeout(100);
    if (!p.url().endsWith("#brew") || !(await state()).text.includes((await state()).name)) throw new Error("shelf selection feedback missing");
    const duplicate = await p.evaluate(() => {
      const b = S.shelf[0]; b.bags = 2; b.bagNo = 1;
      const other = { ...b, key: `${b.key}-test`, bagNo: 2 }; S.shelf.splice(1, 0, other); return other.key;
    });
    await p.click("#coffeeChoice"); await p.locator("[data-choose-bag]").filter({ hasText: "Bag 2" }).first().click(); await p.waitForTimeout(100);
    if ((await state()).key !== duplicate || !(await state()).text.includes("Bag 2") || !(await p.textContent(".coffee-meta")).includes("Bag 2")) throw new Error("same-coffee bag identity missing");
    await p.evaluate(() => { S.shelf.splice(1, 1); S.shelf[0].bags = 1; });
    await p.reload(); await p.waitForTimeout(1200);
    await p.evaluate(() => { const b = S.shelf.find(x => x.key !== S.current.key); b.recipe = null; S.api.recommend = async () => { throw new Error("test failure"); }; });
    await p.click("#nextBean"); await p.waitForTimeout(200);
    const failure = await state();
    if (!/Couldn't get a recipe: test failure/.test(failure.toast) || /Now brewing/.test(failure.toast) || !failure.text.includes(failure.name)) throw new Error(`recipe failure feedback: ${JSON.stringify(failure)}`);
    await p.reload(); await p.waitForTimeout(1200);
  });
  await step("espresso", async () => {
    await p.click('[data-run="espresso"]'); await p.waitForTimeout(3000); await snap("2-pulling");
    await p.waitForSelector("#afterShot:not([hidden])", { timeout: 20000 });
    // The panel is re-rendered once the shot is saved; wait for that so a rating tap is not discarded.
    await p.waitForSelector("#reviewShot:not([disabled])", { timeout: 20000 });
    await p.waitForTimeout(600); // let the chart resize settle so star positions measured next stay valid
  });
  // Ratings are Decaid's 0–10, shown as half stars: the left part of a star is a half.
  const starAt = async (sel, n, frac) => { await p.locator(sel).evaluate(el => el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" })); const b = await p.locator(`${sel} > span:not(.stars-fill) i[data-n="${n}"]`).boundingBox(); return [b.x + b.width * frac, b.y + b.height / 2]; };
  const rating = (sel) => p.getAttribute(sel, "aria-valuenow");
  const expectRating = async (sel, v, how) => { const got = await rating(sel); if (got !== v) throw new Error(`${how}: rating ${got}, expected ${v}`); };
  const expectStarsAligned = async (sel, points) => {
    const geometry = await p.locator(sel).evaluate((el) => {
      const empty = el.querySelector('i').getBoundingClientRect();
      const fill = el.querySelector('.stars-fill');
      const filled = fill.querySelector('i').getBoundingClientRect();
      const clip = fill.getBoundingClientRect();
      const target = el.getBoundingClientRect();
      return { dx: filled.x - empty.x, dy: filled.y - empty.y, width: clip.width, targetWidth: target.width, targetHeight: target.height };
    });
    if (Math.abs(geometry.dx) > 0.5 || Math.abs(geometry.dy) > 0.5 || Math.abs(geometry.width - geometry.targetWidth * points / 10) > 0.5 || geometry.targetHeight < 44)
      throw new Error(`${sel}: misaligned rating or undersized target: ${JSON.stringify(geometry)}`);
  };
  await step("rate by tap and drag", async () => {
    await p.mouse.click(...(await starAt("#afterStars", 3, 0.3))); await expectRating("#afterStars", "5", "tap left half of star 3");
    await expectStarsAligned("#afterStars", 5);
    await p.mouse.move(...(await starAt("#afterStars", 1, 0.8))); await p.mouse.down();
    await p.mouse.move(...(await starAt("#afterStars", 5, 0.9)), { steps: 6 }); await p.mouse.up(); await expectRating("#afterStars", "10", "drag to the end");
    await p.focus("#afterStars"); await p.keyboard.press("ArrowLeft"); await expectRating("#afterStars", "9", "arrow key");
    await p.mouse.click(...(await starAt("#afterStars", 4, 0.85))); await expectRating("#afterStars", "8", "tap right of star 4");
  });
  await step("taste", async () => {
    const notes = p.getByRole("group", { name: "Tasting notes" });
    const sour = notes.getByRole("button", { name: "Sour" });
    const sweet = notes.getByRole("button", { name: "Sweet" });
    await sour.click();
    await sweet.press("Space");
    if (await sour.getAttribute("aria-pressed") !== "true" || await sweet.getAttribute("aria-pressed") !== "true")
      throw new Error("tasting notes did not support multiple selections");
    await sour.click();
    if (await sour.getAttribute("aria-pressed") !== "false") throw new Error("a second tap did not clear the tasting note");
    await p.fill("#afterNotes", "Lingering cocoa");
    await p.locator("#afterNotes").press("Tab");
    await p.click('#sb [data-v="-1"]'); await p.click('#bd [data-v="0"]'); await p.click("#reviewShot");
    await p.waitForSelector("#reviewBox .advice", { timeout: 5000 }); await snap("3-after", true);
    const version = await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem("crema:demo-reviews")))
      .find(entry => entry.shot.id.startsWith("demo-shot-"))?.review);
    if (version?.version !== 4 || version.evidence?.version !== 1 || !version.coach?.headline || !version.coach?.taste) {
      throw new Error("new review did not save both stages and versioned evidence");
    }
    if (version.coach.taste.notes !== "Sweet\nLingering cocoa") throw new Error("review did not receive the selected pill and extra text");
    const labels = await p.locator("#reviewBox .label").allTextContents();
    if (!await p.locator("#reviewBox .coach-headline").count() || !labels.includes("Your tasting") || labels.at(-1) !== "What to try")
      throw new Error("coach review sections are missing or out of order");
    const rows = await p.locator("#reviewBox .coach-phase").allTextContents();
    if (rows.length !== version.coach.stages.length + 1 || rows.some(row => /\b(?:Plan|Recorded):|\bRecorded\s+[-\d]/i.test(row)))
      throw new Error("phase rows should read as coach sentences without measurement readbacks");
  });
  await step("read saved v1, v2 and v3 shot reviews", async () => {
    const result = await p.evaluate(async () => {
      const key = "crema:demo-reviews", before = localStorage.getItem(key);
      try {
        const saved = { version: 1, source: "rules", createdAt: "2000-01-01T00:00:00Z",
          review: { summary: "Synthetic saved review", issues: [], wentWell: [], confidence: "low", nextShot: null, askTaste: true } };
        const evidence = { version: 1, history: { curves: { usableCount: 0 } } };
        localStorage.setItem(key, JSON.stringify({ ...JSON.parse(before ?? "{}"),
          s0: saved, s1: { review: { ...saved, version: 2, evidence } },
          s2: { review: { ...saved, version: 3, evidence, curve: { summary: saved.review.summary }, taste: { summary: "Synthetic saved taste" } } } }));
        const demo = makeDemoApi();
        return await Promise.all(["s0", "s1", "s2"].map(async id => {
          const shot = await demo.shot(id);
          return { html: reviewHtml(shot.review, shot), review: shot.review };
        }));
      } finally {
        if (before == null) localStorage.removeItem(key);
        else localStorage.setItem(key, before);
      }
    });
    if (result[0].review?.version !== 1 || "evidence" in result[0].review || result[1].review?.version !== 2 ||
        result[2].review?.version !== 3 || !result[2].html.includes("Curve read") || !result[2].html.includes("Synthetic saved taste") ||
        result.slice(0, 2).some(entry => !entry.html.includes("Synthetic saved review") || entry.html.includes("Taste alignment"))) {
      throw new Error("legacy reviews did not render as saved");
    }
  });
  await step("steam", async () => {
    await p.click('[data-presets="steam"]'); await p.click('[data-preset="steam:0"]'); await p.click('[data-run="steam"]');
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
    await expectStarsAligned("#detailStars", 8);
    await p.focus("#detailStars"); await p.keyboard.press("ArrowLeft");
    await expectRating("#detailStars", "7", "shot detail half star");
    await expectStarsAligned("#detailStars", 7);
  });
  await step("tasting notes reopen in history", async () => {
    const notes = p.locator("#shotDetail").getByRole("group", { name: "Tasting notes" });
    if (await notes.getByRole("button", { name: "Sweet" }).getAttribute("aria-pressed") !== "true" ||
        await notes.getByRole("button", { name: "Sour" }).getAttribute("aria-pressed") !== "false" ||
        await p.inputValue("#shotNotes") !== "Lingering cocoa")
      throw new Error("saved selection and text did not reopen independently");
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
    if (name === "phone") await p.click("#phoneStatusToggle");
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
