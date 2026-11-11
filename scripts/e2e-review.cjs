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
    check(!errors.length, "no browser errors", errors.join("; "));
  } catch (e) {
    console.error(e);
    if (page) await page.screenshot({ path: "/tmp/crema-review-failure.png", fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser?.close(); server.close(); try { process.kill(-proc.pid, "SIGTERM"); } catch {}
  }
})().catch((e) => { console.error(e); process.exitCode = 1; try { process.kill(-proc.pid, "SIGTERM"); } catch {} });
