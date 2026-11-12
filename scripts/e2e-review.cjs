// Shot review through the tablet and phone surfaces, using the local Decaid
// simulator and a tiny stand-in Crema review endpoint. No physical machine.
//
//   node scripts/e2e-review.cjs
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const base = 23800 + Math.floor(Math.random() * 500);
const MOCK = base, SKIN = base + 1;
let failReview = false, reviewCalls = [];
const proc = spawn("npx", ["tsx", "dev/mock-decaid.ts"], { cwd: root, env: { ...process.env, PORT: String(MOCK) }, stdio: ["ignore", "pipe", "pipe"], detached: true });
const ready = new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("mock Decaid did not start")), 20000);
  proc.stdout.on("data", (d) => { if (String(d).includes("mock-decaid on")) { clearTimeout(t); resolve(); } });
});
const reviewResult = { summary: "The recorded shot is available for review.", wentWell: ["The simulator recorded the shot."], issues: [], nextShot: null, confidence: "low", askTaste: true };
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/api/config") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ crema: true, decaidUrl: `http://localhost:${MOCK}` })); }
  if (pathname === "/api/review" && req.method === "POST") {
    let raw = ""; req.on("data", (x) => raw += x); req.on("end", () => {
      reviewCalls.push(JSON.parse(raw));
      if (failReview) { res.writeHead(503, { "content-type": "application/json" }); return res.end('{"error":"review service unavailable"}'); }
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ review: reviewResult, source: "mock-review-provider" }));
    });
    return;
  }
  const file = path.join(root, "skin", pathname === "/" ? "index.html" : pathname);
  const ext = path.extname(file), types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };
  if (!file.startsWith(path.join(root, "skin")) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[ext] || "application/octet-stream" }); fs.createReadStream(file).pipe(res);
});
const check = (ok, label, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok || !detail ? "" : ` (${detail})`}`); if (!ok) throw new Error(label); };
// Opening a shot reloads the list before redrawing the detail, so the previous shot's detail
// stays on screen meanwhile; wait until the list marks this shot selected.
const openShot = async (page, id, selector) => {
  await page.click(`[data-open="${id}"]`);
  await page.waitForSelector(`.shot-row.sel [data-open="${id}"]`);
  await page.waitForSelector(selector);
};

(async () => {
  let browser, page;
  try {
    await ready;
    await new Promise((resolve) => server.listen(SKIN, "127.0.0.1", resolve));
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1340, height: 800 } });
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    const evalPage = (fn, ...args) => page.evaluate(fn, ...args);
    const waitForPage = async (fn, arg, timeout = 12000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (await evalPage(fn, arg)) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("Timed out waiting for page condition");
    };
    const decaid = `http://localhost:${MOCK}`;
    await page.goto(`http://localhost:${SKIN}/?full&decaid=${encodeURIComponent(decaid)}#brew`);
    await page.waitForFunction(() => S.api && !S.api.demo && S.link.connected && S.shelfLoaded, null, { timeout: 20000 });
    await evalPage(async () => S.api.settings.set({ aiEnabled: false }));
    await page.evaluate(async () => fetch(`${S.api.info.decaidUrl}/dev/shots/seed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ count: 2, profileTitle: "Adaptive v2", dose: 18 }) }));
    const shotId = (await (await fetch(`${decaid}/api/v1/shots?limit=100`)).json()).items.find((s) => s.id.startsWith("seed-"))?.id;
    check(!!shotId, "simulator seeded a reviewable shot");
    console.log("seeded shot", shotId);
    await page.evaluate(async () => fetch(`${S.api.info.decaidUrl}/dev/shots/seed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ count: 1, profileTitle: "GHC/Manual Flow Control", dose: 18 }) }));
    const manualId = (await (await fetch(`${decaid}/api/v1/shots?limit=100`)).json()).items.find((s) => s.workflow?.profile?.title === "GHC/Manual Flow Control")?.id;
    check(!!manualId, "simulator seeded a manual review shot");
    await page.route(new RegExp(`/api/v1/shots/([^/]+)$`), async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch(); const data = await response.json();
      const id = new URL(route.request().url()).pathname.split("/").at(-1);
      if (id === shotId && data.measurements?.[0]) { data.measurements[0].machine.pressure = null; data.measurements[0].scale.weight = null; }
      if (data.workflow?.profile?.title === "GHC/Manual Flow Control") data.workflow.profile = { title: "GHC/Manual Flow Control", beverage_type: "manual", target_weight: 0, steps: [{ pump: "flow", flow: 0, seconds: 60, temperature: 93 }] };
      await route.fulfill({ response, json: data });
    });
    await page.evaluate(async (id) => {
      await S.api.annotate(id, { extras: { thirdParty: { keep: "plugin-value" }, crema: { sourBitter: null, body: null, keep: "existing-crema-data" } } });
    }, shotId);
    await page.goto(`http://localhost:${SKIN}/?full&decaid=${encodeURIComponent(decaid)}#shots`);
    await page.waitForFunction((id) => S.api && S.shots.some((s) => s.id === id), shotId, { timeout: 20000 });
    await openShot(page, shotId, "#reviewDetail");
    await page.click("#reviewDetail");
    await waitForPage(async (id) => !!(await S.api.shot(id))?.review, shotId);
    const stored = await evalPage(async (id) => S.api.shot(id), shotId);
    check(stored.review.source === "rules" && stored.review.review.askTaste, "AI off uses shot checks and keeps taste explicitly missing");
    check(reviewCalls.length === 0, "AI off sends no review request to the server");
    let raw = await (await fetch(`${decaid}/api/v1/shots/${encodeURIComponent(shotId)}`)).json();
    check(raw.annotations.extras.thirdParty.keep === "plugin-value" && raw.annotations.extras.crema.keep === "existing-crema-data", "review preserves Decaid and Crema annotation extras");

    // Reload at phone size; the same Decaid record is used by both surfaces.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.waitForFunction(() => S.api && S.shelfLoaded, null, { timeout: 20000 });
    await page.goto(`http://localhost:${SKIN}/?full&decaid=${encodeURIComponent(decaid)}#shots`);
    await page.waitForFunction((id) => S.shots.some((s) => s.id === id), shotId);
    await openShot(page, shotId, "#detailReview");
    check((await page.textContent("#detailReview")).includes("From Crema's shot checks"), "saved review reappears on the phone after reload");
    await page.goto(`http://localhost:${SKIN}/?full&decaid=${encodeURIComponent(decaid)}#shots`);
    await page.waitForFunction((id) => S.shots.some((s) => s.id === id), manualId);
    await openShot(page, manualId, "#reviewDetail");
    const manualUI = await evalPage((id) => ({ manual: S.shots.find((s) => s.id === id)?.manual, title: S.shots.find((s) => s.id === id)?.profileTitle, tasteControls: document.querySelectorAll("#detailSb").length, reviewButton: !!document.querySelector("#reviewDetail") }), manualId);
    check(manualUI.reviewButton && manualUI.manual === "flow" && manualUI.tasteControls === 0, "bagless manual shot can be reviewed without fabricated taste controls", JSON.stringify(manualUI));
    await page.click("#reviewDetail");
    await waitForPage(async (id) => !!(await S.api.shot(id))?.review, manualId);
    check((await evalPage(async (id) => S.api.shot(id), manualId)).review.source === "rules", "manual shot uses its recorded profile with the local rules review");

    await page.goto(`http://localhost:${SKIN}/?full&decaid=${encodeURIComponent(decaid)}#shots`);
    await page.waitForFunction((id) => S.shots.some((s) => s.id === id), shotId);
    await openShot(page, shotId, "#detailSb");
    await page.click('#detailSb [data-v="0"]');
    await page.click('#detailBody [data-v="0"]');
    await waitForPage(async (id) => { const s = await S.api.shot(id); return s.taste?.sourBitter === 0 && s.taste?.body === 0; }, shotId);
    await evalPage(async () => S.api.settings.set({ aiEnabled: true }));
    // Review immediately after the two taste taps: both values and other extras
    // must survive their independent annotation writes.
    const machineRecipe = await evalPage(() => S.api.machine.recipe());
    const serverReview = page.waitForResponse((r) => r.url().endsWith("/api/review"), { timeout: 10000 });
    await page.click("#reviewDetail");
    await serverReview;
    check(reviewCalls.length === 1, "AI enabled sends one explicit review request");
    await waitForPage(async (id) => (await S.api.shot(id))?.review?.source === "mock-review-provider", shotId);
    check(reviewCalls[0].profile.title === "Adaptive v2" && reviewCalls[0].targetYieldG === 36, "server review receives the completed shot's recorded profile and target");
    check(reviewCalls[0].feedback?.sourBitter === 0 && reviewCalls[0].feedback?.body === 0 && reviewCalls[0].points.some((p) => p.p === null && p.w === null), "both rapid taste taps arrive, while missing measurements stay null");
    raw = await (await fetch(`${decaid}/api/v1/shots/${encodeURIComponent(shotId)}`)).json();
    check(raw.annotations.extras.thirdParty.keep === "plugin-value" && raw.annotations.extras.crema.keep === "existing-crema-data" && raw.annotations.extras.crema.sourBitter === 0 && raw.annotations.extras.crema.body === 0, "rapid taste updates preserve each other and unrelated extras");
    check(JSON.stringify(await evalPage(() => S.api.machine.recipe())) === JSON.stringify(machineRecipe), "review leaves the loaded machine recipe unchanged");

    // Reviewing an older shot must find the shots before it, hydrate their
    // measurements (the list has none), and never borrow today's recipe draft.
    const historyBag = "review-history-bag", selectedAt = "2026-10-01T12:00:00Z", callsBeforeHistory = reviewCalls.length;
    const capturedProfile = { title: "Adaptive v2", beverage_type: "espresso", target_weight: 36, steps: [{ name: "Pour", pump: "pressure", pressure: "9", seconds: "40", temperature: "94", limiter: { value: "3", range: "1" } }] };
    let savedHistoryRecipe = { profileTitle: capturedProfile.title, doseG: 20, yieldG: 54, tempC: 94, targetTimeS: [40, 50] }, currentRecordedWindow = null, failedYield = false;
    const historyMeasurements = (timestamp) => Array.from({ length: 45 }, (_, t) => ({
      machine: { timestamp: new Date(Date.parse(timestamp) + t * 1000).toISOString(), state: { state: "espresso", substate: t < 5 ? "preparingForShot" : t <= 35 ? "pouring" : "ending" }, pressure: 9, flow: 2, targetPressure: 9, targetFlow: -1, profileFrame: 0, mixTemperature: 94 },
      scale: { weight: Math.max(0, t - 5) * 1.2 },
    }));
    const historicalShots = Array.from({ length: 10 }, (_, i) => {
      const timestamp = new Date(Date.parse(selectedAt) - (i + 1) * 60000).toISOString();
      const profile = { ...capturedProfile, target_weight: 38, steps: [{ ...capturedProfile.steps[0], pressure: i === 1 ? "8" : "9", temperature: i === 2 ? undefined : "91" }] };
      return { id: `review-history-old-${i}`, timestamp, stopReason: "targetWeight", workflow: { profile, context: { beanBatchId: historyBag, targetDoseWeight: 18, targetYield: 36, grinderSetting: i === 2 ? undefined : "10" } },
        annotations: { actualDoseWeight: 18, actualYield: 36 }, measurements: i === 2 ? [] : historyMeasurements(timestamp) };
    });
    const newer = Array.from({ length: 102 }, (_, i) => ({ id: `review-history-new-${i}`, timestamp: new Date(Date.parse(selectedAt) + (i + 1) * 60000).toISOString(), workflow: { context: { beanBatchId: historyBag } } }));
    const historicalSummaries = [...newer, { id: shotId, timestamp: selectedAt, workflow: { context: { beanBatchId: historyBag } } },
      ...historicalShots.map(({ measurements, ...rest }) => rest)];
    const historyPages = [], historyReads = [];
    const listHistory = async (route) => {
      const u = new URL(route.request().url());
      if (u.searchParams.get("beanBatchId") !== historyBag) return route.fallback();
      const offset = Number(u.searchParams.get("offset") ?? 0), limit = Number(u.searchParams.get("limit") ?? 20);
      historyPages.push(offset);
      await route.fulfill({ json: { items: historicalSummaries.slice(offset, offset + Math.min(100, limit)), total: historicalSummaries.length } });
    };
    const readHistory = async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const id = new URL(route.request().url()).pathname.split("/").at(-1);
      if (id === shotId) {
        const response = await route.fetch(), data = await response.json();
        data.timestamp = selectedAt; data.workflow = { profile: capturedProfile, context: { beanBatchId: historyBag, targetDoseWeight: 18, targetYield: 36, grinderSetting: "11.25" } };
        data.measurements = historyMeasurements(selectedAt);
        data.annotations.extras.crema.targetTimeS = currentRecordedWindow;
        if (failedYield) data.annotations.actualYield = 4;
        return route.fulfill({ response, json: data });
      }
      const shot = historicalShots.find((s) => s.id === id);
      if (!shot) return route.fallback();
      historyReads.push(id);
      return route.fulfill(id === "review-history-old-3" ? { status: 404, json: { error: "removed shot" } } : { json: shot });
    };
    const historyRecipe = (route) => route.fulfill({ json: new URL(route.request().url()).pathname.includes("/bean-batches/") ? { beanId: "review-history-coffee" } : { recipe: savedHistoryRecipe } });
    await page.route(/\/api\/v1\/shots\?/, listHistory);
    await page.route(/\/api\/v1\/shots\/[^/]+$/, readHistory);
    await page.route(/\/api\/v1\/(?:bean-batches\/review-history-bag|store\/crema\/bean%3Areview-history-coffee)$/i, historyRecipe);
    const savedNext = await evalPage(() => { const before = JSON.parse(JSON.stringify(S.next)); S.next = { ...S.next, grind: "999", tempC: 70, doseG: 10, yieldG: 100 }; return before; });
    await evalPage(async (id) => S.api.review(id), shotId);
    const historyInput = reviewCalls.at(-1), prior = historyInput.history[0], unknown = historyInput.history.find((s) => s.tempC === null);
    check(historyPages.includes(100) && historyReads.length === 10 && historyInput.history.length === 9, "older-shot review pages past newer shots and bounds full reads, omitting a removed shot");
    check(historyInput.history.every((s) => Date.parse(s.timestamp) < Date.parse(historyInput.timestamp)), "review history contains only shots earlier than the selected shot");
    check(historyInput.grinderSetting === "11.25" && historyInput.tempC === 94 && historyInput.doseG === 18 && historyInput.targetYieldG === 36, "review context uses the captured shot instead of next-shot edits");
    const guideWindow = await evalPage(() => E.findProfile("Adaptive v2").recipe.timeS);
    check(historyInput.timeBasis === "guide" && JSON.stringify(historyInput.targetTimeS) === JSON.stringify(guideWindow), "an older 18 g / 36 g shot ignores today's same-title 20 g / 54 g recipe window");
    check(prior.durationS === 30 && prior.grinderSetting === "10" && prior.tempC === 91 && prior.targetYieldG === 36 && prior.stopReason === "targetWeight", "prior history carries measured brew duration, recorded grind, temperature, target and stop");
    check(unknown && unknown.durationS === null && unknown.grinderSetting === null, "missing historical measurements and grind remain unknown");
    check(prior.profileShape === historyInput.profileShape && historyInput.history[1].profileShape !== historyInput.profileShape, "profile comparison ignores absolute temperature and yield but distinguishes same-title pressure changes");
    savedHistoryRecipe = { ...savedHistoryRecipe, doseG: 18, yieldG: 36, targetTimeS: [26, 34] }; failedYield = true;
    await evalPage(async (id) => S.api.review(id), shotId);
    check(reviewCalls.at(-1).timeBasis === "recipe" && reviewCalls.at(-1).yieldG === 4 && JSON.stringify(reviewCalls.at(-1).targetTimeS) === "[26,34]", "matching recorded recipe uses its time window even when the actual yield failed");
    savedHistoryRecipe.profileShape = "a-different-profile-with-the-same-title";
    await evalPage(async (id) => S.api.review(id), shotId);
    check(reviewCalls.at(-1).timeBasis === "guide", "a saved recipe with a different profile shape cannot supply the old shot's time window");
    currentRecordedWindow = [20, 26];
    await evalPage(async (id) => S.api.review(id), shotId);
    check(reviewCalls.at(-1).timeBasis === "recorded" && JSON.stringify(reviewCalls.at(-1).targetTimeS) === "[20,26]", "the shot's recorded time window wins over recipe and guide fallbacks");
    currentRecordedWindow = [0, 600]; capturedProfile.title = "Recorded custom profile";
    await evalPage(async (id) => S.api.review(id), shotId);
    check(reviewCalls.at(-1).timeBasis === null && reviewCalls.at(-1).targetTimeS === null, "an unknown custom profile with only a legacy unknown-window sentinel stays unknown");
    await page.unroute(/\/api\/v1\/shots\?/, listHistory);
    await page.unroute(/\/api\/v1\/shots\/[^/]+$/, readHistory);
    await page.unroute(/\/api\/v1\/(?:bean-batches\/review-history-bag|store\/crema\/bean%3Areview-history-coffee)$/i, historyRecipe);
    await evalPage((next) => { S.next = next; }, savedNext);
    reviewCalls.length = callsBeforeHistory;

    failReview = true;
    const failedReview = page.waitForResponse((r) => r.url().endsWith("/api/review"), { timeout: 10000 });
    await page.click("#reviewDetail");
    await failedReview;
    check(reviewCalls.length === 2, "Review again makes one server request");
    await waitForPage(async (id) => (await S.api.shot(id))?.review?.source === "rules", shotId);
    check(true, "server failure falls back to saved rules review");
    const final = await evalPage(async (id) => S.api.shot(id), shotId);
    check(final.review?.review?.summary && final.review.version === 1 && final.review.createdAt, "review envelope stores version, result, source and time");
    // Taste taps stick in the after-shot panel too: saved on tap, no review needed (same code as the detail).
    await page.goto(`http://localhost:${SKIN}/?full&decaid=${encodeURIComponent(decaid)}`);
    await page.waitForFunction(() => typeof showAfterShot === "function" && S.api);
    await evalPage(async (id) => showAfterShot(await S.api.shot(id), [], {}), shotId);
    const calls = reviewCalls.length;
    await page.click('#sb [data-v="-2"]');
    await waitForPage(async (id) => (await S.api.shot(id)).taste?.sourBitter === -2, shotId);
    check((await (await fetch(`${decaid}/api/v1/shots/${encodeURIComponent(shotId)}`)).json()).annotations.extras.crema.sourBitter === -2, "a taste tap in the after-shot panel is saved without asking for a review");
    check(reviewCalls.length === calls && await page.getAttribute('#bd [data-v="0"]', "aria-pressed") === "true", "and it sends no review request, keeping the other scale's saved answer");
    const failTaste = (route) => (route.request().method() === "PUT" ? route.abort() : route.fallback());
    await page.route(new RegExp(`/api/v1/shots/${shotId}$`), failTaste);
    await page.click('#sb [data-v="2"]');
    await page.waitForFunction(() => /Couldn't save taste feedback/.test(document.querySelector("#toast").textContent), null, { timeout: 5000 }).catch(() => {});
    check(/Couldn't save taste feedback/.test(await page.textContent("#toast")) && await page.getAttribute('#sb [data-v="-2"]', "aria-pressed") === "true" && await page.getAttribute('#sb [data-v="2"]', "aria-pressed") === "false", "a failed taste write says so and puts the previous answer back", await page.textContent("#toast"));
    await page.unroute(new RegExp(`/api/v1/shots/${shotId}$`), failTaste);
    await page.goto(`http://localhost:${SKIN}/?full&decaid=${encodeURIComponent(decaid)}#shots`);
    await page.waitForFunction((id) => S.shots.some((s) => s.id === id), shotId);
    // Notes: "Notes saved" only when Decaid took the write. A failed write says so and keeps nothing.
    await page.goto(`http://localhost:${SKIN}/?full&decaid=${encodeURIComponent(decaid)}#shots`);
    await page.waitForFunction((id) => S.shots.some((s) => s.id === id), shotId);
    await openShot(page, shotId, "#shotNotes");
    const failPut = (route) => (route.request().method() === "PUT" ? route.abort() : route.fallback());
    await page.route(new RegExp(`/api/v1/shots/${shotId}$`), failPut);
    await page.fill("#shotNotes", "should not be saved");
    await page.dispatchEvent("#shotNotes", "change");
    await page.waitForFunction(() => /Couldn't save the notes/.test(document.querySelector("#toast").textContent), null, { timeout: 5000 }).catch(() => {});
    const failedToast = await page.textContent("#toast");
    check(/Couldn't save the notes/.test(failedToast) && !/Notes saved/.test(failedToast), "a failed notes write says so instead of \"Notes saved\"", failedToast);
    check((await (await fetch(`${decaid}/api/v1/shots/${encodeURIComponent(shotId)}`)).json()).annotations?.espressoNotes !== "should not be saved", "and Decaid didn't store the notes");
    // The rating goes back too, in the detail's stars and in the list row.
    const ratingBefore = await page.getAttribute("#detailStars", "aria-valuenow");
    await page.focus("#detailStars");
    await page.keyboard.press(ratingBefore === "10" ? "Home" : "End");
    await page.waitForFunction(() => /Couldn't save the rating/.test(document.querySelector("#toast").textContent), null, { timeout: 5000 }).catch(() => {});
    await page.waitForSelector("#detailStars", { timeout: 5000 });
    check(/Couldn't save the rating/.test(await page.textContent("#toast")) && await page.getAttribute("#detailStars", "aria-valuenow") === ratingBefore && await evalPage((id) => String(S.shots.find((s) => s.id === id).enjoyment ?? 0), shotId) === ratingBefore, "a failed rating write says so and restores the previous rating", await page.textContent("#toast"));
    await page.unroute(new RegExp(`/api/v1/shots/${shotId}$`), failPut);
    await page.fill("#shotNotes", "tastes fine");
    await page.dispatchEvent("#shotNotes", "change");
    await page.waitForFunction(() => /Notes saved/.test(document.querySelector("#toast").textContent), null, { timeout: 5000 }).catch(() => {});
    check(/Notes saved/.test(await page.textContent("#toast")), "a notes write that works still says \"Notes saved\"");
    // A numeric suggestion changes the draft once, never the Decaid workflow.
    await page.goto(`http://localhost:${SKIN}/?full&decaid=${encodeURIComponent(decaid)}#brew`);
    await page.waitForFunction(() => S.shelfLoaded && S.library);
    await evalPage(async () => { await selectBean(NO_BAG, { quiet: true }); await chooseInstalledProfile(S.library.find((p) => !manualKind(p.profile)), true); });
    const beforeApply = await evalPage(async () => {
      S.next.grind = "10";
      const fixture = { id: "after-shot-apply", timestamp: new Date().toISOString(), batch: S.current?.batch, beanId: S.current?.id, profileTitle: S.next.profileTitle, doseG: S.next.doseG, yieldG: 41.6, timeS: 26.4, targetYieldG: 42, stopReason: "targetWeight", points: [], review: { source: "rules", review: { summary: "One small change.", nextShot: { change: "Grind finer", grindDelta: "finer", yieldDeltaG: 0, tempDeltaC: 0, switchProfile: null, reasoning: "The shot tasted sour." } } } };
      S.shots.unshift(fixture);
      showAfterShot(fixture, [], {});
      renderNextShot();
      return { workflow: await S.api.machine.recipe(), grind: S.next.grind };
    });
    await page.click('[data-apply-review]');
    check(await evalPage(() => S.next.grind === String(+(10 - grindSettings().step).toFixed(3))) && (await page.textContent("#nextShot")).includes("Changed from 10 after the last shot"), "Apply takes one grind step and marks the changed field");
    check(JSON.stringify(await evalPage(() => S.api.machine.recipe())) === JSON.stringify(beforeApply.workflow), "Apply leaves the machine workflow unchanged");
    check(await page.locator('[data-apply-review]').count() === 0, "an applied suggestion cannot be applied twice");
    await page.click('#resetRecipe');
    check(await evalPage(() => S.next.grind === "10" && !S.reviewEdit), "Reset restores the recipe value before Apply");
    // The review can stay visible while its recipe is edited in another panel.
    // A stale label must never apply a freshly recomputed, differently named value.
    await evalPage(() => { S.next.grind = "11"; recipeEdited(); renderNextShot(); });
    await page.click('[data-apply-review]');
    check(await evalPage(() => S.next.grind === "11" && !S.reviewEdit), "stale Apply leaves the edited recipe unchanged");
    check(await evalPage(() => document.querySelector('[data-apply-review]').textContent.includes(String(+(11 - grindSettings().step).toFixed(3)))), "stale Apply refreshes its label to the new target");
    await page.click('[data-apply-review]');
    check(await evalPage(() => S.next.grind === String(+(11 - grindSettings().step).toFixed(3))), "fresh Apply uses the exact displayed target");
    await page.click('#resetRecipe');
    check(await evalPage(() => S.next.grind === "11"), "Reset after refreshed Apply preserves the user's prior edit");
    check((await page.textContent('#afterResult')).includes('41.6 g in 26.4 s') && (await page.textContent('#afterResult')).includes('Stopped at weight'), "result line and recorded stop reason are shown");
    await page.setViewportSize({ width: 1340, height: 800 });
    check((await page.locator('#liveChart').boundingBox()).height >= 190, "finished chart is at least 190 px at tablet size");
    await page.screenshot({ path: "/tmp/crema-ws5-after-shot.png" });
    // The standalone demo uses the same recorded history contract, even when
    // the prepared recipe has moved on from the shot being reviewed.
    await page.goto(`http://localhost:${SKIN}/?demo&full#shots`);
    await page.waitForFunction(() => S.api?.demo && S.shelfLoaded);
    const demoHistory = await evalPage(async () => {
      const shots = await S.api.shots(100), current = shots.find((s) => shots.some((p) => p.id !== s.id && p.batch === s.batch));
      const previous = shots.find((s) => s.id !== current.id && s.batch === current.batch);
      const profile = { title: "Recorded demo pour", beverage_type: "espresso", target_weight: 36, steps: [{ name: "Pour", pump: "pressure", pressure: "9", seconds: "40", temperature: "92" }] };
      const points = (seconds) => Array.from({ length: seconds + 1 }, (_, t) => ({ t, p: 9, f: 2, tp: 9, tf: null, w: t / seconds * 36, temp: 92, targetTemp: 92, frame: 0, substate: "pouring", weightFlow: 36 / seconds }));
      for (const s of [current, previous]) Object.assign(s, { profile, profileTitle: profile.title, doseG: 18, yieldG: 36, targetYieldG: 36, targetTimeS: [26, 34], stopReason: "targetWeight" });
      Object.assign(current, { timestamp: "2026-10-01T12:00:00Z", points: points(30), grinderSetting: "9.75" });
      Object.assign(previous, { timestamp: "2026-10-01T11:00:00Z", points: points(22), grinderSetting: "10" });
      S.next = { ...S.next, grind: "999", tempC: 70 };
      const recorded = await S.api.review(current.id);
      previous.points = []; previous.grinderSetting = null;
      const unknown = await S.api.review(current.id);
      const bag = (await S.api.shelf()).find((b) => b.batch === current.batch);
      Object.assign(bag.recipe, { profileTitle: "Adaptive v2", doseG: 20, yieldG: 54, tempC: 92, targetTimeS: [40, 50] });
      current.profile = { ...profile, title: "Adaptive v2" }; current.profileTitle = "Adaptive v2"; current.targetTimeS = null;
      const guide = await S.api.review(current.id);
      current.profile = { ...profile, title: "Recorded custom profile" }; current.profileTitle = "Recorded custom profile";
      const noWindow = await S.api.review(current.id);
      return { recorded: recorded.review.summary, unknown: unknown.review.summary, guide: guide.review.summary, noWindow: noWindow.review.summary };
    });
    check(/22(?: → | to )30 s/.test(demoHistory.recorded) && demoHistory.recorded.includes("10 → 9.75") && !demoHistory.recorded.includes("999"), "demo reviews compare recorded shot time and grind rather than the next-shot draft", demoHistory.recorded);
    check(!/22(?: → | to )30 s/.test(demoHistory.unknown) && !demoHistory.unknown.includes("10 → 9.75"), "demo history does not invent missing duration or grinder settings", demoHistory.unknown);
    check(/guide/i.test(demoHistory.guide) && !/40[–-]50/.test(demoHistory.guide), "demo ignores a newer changed recipe and labels the profile guide as an approximation", demoHistory.guide);
    check(!/target window|profile guide|40[–-]50/.test(demoHistory.noWindow), "demo custom profile without a recorded matching recipe has no invented expected window", demoHistory.noWindow);
    check(!errors.length, "no browser errors", errors.join("; "));
  } catch (e) {
    console.error(e);
    if (page) await page.screenshot({ path: "/tmp/crema-review-failure.png", fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser?.close(); server.close(); try { process.kill(-proc.pid, "SIGTERM"); } catch {}
  }
})().catch((e) => { console.error(e); process.exitCode = 1; try { process.kill(-proc.pid, "SIGTERM"); } catch {} });
