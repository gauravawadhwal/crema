// Brewing modes against the local simulator only. No physical machine commands.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const checkFavourites = require('./favourites-checks.cjs');
const root = path.resolve(__dirname, '..');
const mockPort = 20500 + Math.floor(Math.random() * 1000);
const mock = spawn('npx', ['tsx', 'dev/mock-decaid.ts'], { cwd: root, env: { ...process.env, PORT: String(mockPort) }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
const ready = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('mock did not start')), 15000); mock.stdout.on('data', d => { if (String(d).includes('mock-decaid on')) { clearTimeout(timer); resolve(); } }); });
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname;
  if (name === '/built') {
    res.setHeader('Content-Type', 'text/html');
    return res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>${fs.readFileSync(path.join(root, 'demo/crema-demo.html'), 'utf8')}</body></html>`);
  }
  const file = path.join(root, 'skin', name === '/' ? 'index.html' : name);
  if (!file.startsWith(path.join(root, 'skin')) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream'); fs.createReadStream(file).pipe(res);
});
const check = (ok, label) => { assert.ok(ok, label); console.log('ok  ', label); };
(async () => {
  let browser, page;
  const errors = [];
  const artifacts = '/tmp/crema-brewing'; fs.mkdirSync(artifacts, { recursive: true });
  try {
    await ready;
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const url = `${origin}/?full&decaid=http://localhost:${mockPort}`;
    browser = await chromium.launch(); page = await browser.newPage({ viewport: { width: 1340, height: 800 } });
    page.on('pageerror', e => errors.push(e.message));
    if (process.argv.includes('--favourites-only')) {
      await page.goto(url + '#profiles'); await page.waitForFunction(() => S.library?.some(p => !p.manual));
      await page.evaluate(() => showProfile(S.library.find(p => !p.manual).id)); await page.click('#baglessProfile');
      await checkFavourites(page, check);
      await page.goto(origin + '/built?full&demo#brew'); await page.waitForFunction(() => S.api?.demo && S.next && S.shelfLoaded);
      // The two backends share this test origin's localStorage, but installed IDs
      // belong to their own libraries. Start the built demo with its own coffee.
      await page.evaluate(() => selectBean(S.shelf[0].key, { quiet: true }));
      await checkFavourites(page, check);
      check(!errors.length, 'no live/built carousel page errors: ' + errors.join('; '));
      return;
    }
    const evaluate = fn => page.evaluate(fn);
    const wf = () => evaluate(() => fetch(S.api.info.decaidUrl + '/api/v1/workflow').then(r => r.json()));
    const loaded = async () => { await page.click('#loadBtn'); await page.waitForFunction(() => S.loaded); };
    await page.goto(url + '#brew'); await page.waitForSelector('#noBagBrew');
    check(await evaluate(() => {
      const p = { title: 'Same', steps: [{ temperature: 90 }, { temperature: 80 }] };
      return brewProfileShape(p) === brewProfileShape(E.withTemperature(p, 93)) && brewProfileShape(p) !== brewProfileShape({ ...p, steps: [{ temperature: 90 }, { temperature: 70 }] });
    }), 'profile identity tolerates a temperature shift but preserves a declining curve');
    await page.click('#noBagBrew');
    check(await page.isDisabled('[data-run="espresso"]'), 'No bag without a selected profile cannot start a stale recipe');
    await page.click('a[href="#profiles"].primary');
    await page.waitForFunction(() => S.library?.length);
    await evaluate(() => showProfile(S.library.find(p => !p.manual).id)); await page.click('#baglessProfile');
    check(await evaluate(() => { const lp = S.library.find(p => !p.manual); return S.noBag && !S.current && S.next.direct && S.next.tempC === lp.tempC && S.next.yieldG === lp.targetWeight; }), 'empty shelf brews from the installed profile settings');
    await loaded();
    let current = await wf();
    check(current.context.beanBatchId === null && current.context.targetWaterVolume === null, 'bagless load clears coffee association and inherited volume override');
    await page.waitForFunction(() => S.plan?.steps.length > 1);
    check(await evaluate(() => S.plan.timed === 'limits' && document.querySelector('#chartEmpty').textContent.includes('time limit')), 'before any shot, the Brew chart shows the installed profile at its step time limits');
    await page.reload(); await page.waitForFunction(() => S.shelfLoaded && S.next && S.loaded);
    check(await evaluate(() => S.noBag && !S.current), 'No bag and its recipe survive a reload');
    // Add a coffee while intentionally bagless; a background refresh must keep the choice.
    const bag = await evaluate(async () => {
      const base = S.api.info.decaidUrl + '/api/v1';
      const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
      const bean = await post('/beans', { name: 'Mode Test', roaster: 'Test Roaster' });
      const batch = await post(`/beans/${bean.id}/batches`, { weight: 250 });
      await syncShelf(); return { bean: bean.id, batch: batch.id };
    });
    check(await evaluate(() => S.noBag && S.shelf.length === 1), 'a new bag and shelf refresh do not exit No bag');
    await page.route(/\/api\/v1\/beans$/, route => route.fulfill({ status: 503, body: '{}' }));
    await evaluate(() => syncShelf());
    check(await evaluate(() => S.noBag && S.next), 'shelf read failures preserve bagless setup');
    await page.unroute(/\/api\/v1\/beans$/);
    // Existing bag brew baseline, complete with a saved shot.
    await page.evaluate(key => selectBean(key, { quiet: true }), bag.batch);
    await evaluate(() => { S.next.yieldG = 6; S.next.grind = '12'; S.loaded = false; renderNextShot(); });
    await loaded(); await page.click('[data-run="espresso"]');
    await page.waitForFunction(() => S.lastShotId, null, { timeout: 25000 });
    const first = await evaluate(() => S.api.latestShot());
    check(first.batch === bag.batch && first.doseG === 18 && first.yieldG > 0, 'a complete bag-based brew saves its correct workflow and output');
    // Switching the next selection during a pour must not reassign its shot.
    await page.click('[data-run="espresso"]'); await page.waitForFunction(() => S.snap.state.state === 'espresso');
    await evaluate(() => selectBean(NO_BAG));
    await page.waitForFunction(id => S.lastShotId !== id, first.id, { timeout: 25000 });
    check(await evaluate(() => !document.querySelector('#pinShot').hidden), 'post-shot reference belongs to the completed bag brew after switching to No bag');
    const afterBag = await evaluate(() => S.api.latestShot());
    check(afterBag.batch === bag.batch, 'changing the next coffee does not reassign the running shot');
    // Same title, distinct installed profile: identity must survive selection and favourite.
    await page.route(/\/api\/v1\/profiles\?/, async route => {
      const response = await route.fetch(); const profiles = await response.json();
      const duplicate = JSON.parse(JSON.stringify(profiles[0])); duplicate.id = 'duplicate-mode-test'; duplicate.profile.notes = 'Distinct installed profile'; duplicate.profile.steps[0].temperature = 89;
      profiles.push(duplicate); await route.fulfill({ response, json: profiles });
    });
    await page.goto(url + '#profiles'); await page.waitForFunction(() => S.api && S.shelfLoaded); await evaluate(() => renderProfiles()); await page.waitForFunction(() => S.library?.some(p => p.id === 'duplicate-mode-test'));
    await evaluate(() => showProfile('duplicate-mode-test')); await page.click('#baglessProfile');
    await loaded();
    current = await wf();
    check(current.profile.notes === 'Distinct installed profile' && current.profile.steps[0].temperature === 89 && current.context.coffeeName === null && current.context.coffeeRoaster === null && current.context.grinderSetting === '10', 'bag → No bag clears stale metadata (grind falls back to the default start) and loads the precise duplicate profile');
    const before = await evaluate(() => S.api.shelf().then(s => s[0].remaining));
    await evaluate(() => { S.next.yieldG = 6; S.loaded = false; renderNextShot(); }); await loaded();
    await page.click('[data-run="espresso"]'); await page.waitForFunction(id => S.lastShotId && S.lastShotId !== id, afterBag.id, { timeout: 25000 });
    const baglessShot = await evaluate(() => S.api.latestShot());
    check(!baglessShot.batch && !baglessShot.coffee && !baglessShot.roaster, 'bagless shots save without coffee metadata');
    check(await evaluate(() => S.api.shelf().then(s => s[0].remaining)) === before, 'bagless brewing does not deduct bag inventory');
    check(await page.isHidden('#pinShot') && await page.isVisible('#reviewShot'), 'bagless shots offer review without a bag-specific reference action');
    await page.fill('#afterNotes', 'Bagless note'); await page.locator('#afterNotes').press('Tab');
    await page.waitForFunction(async id => (await S.api.shot(id)).notes === 'Bagless note', baglessShot.id);
    await evaluate(() => S.api.annotate(S.lastShotId, { enjoyment: 8 }));
    check((await evaluate(() => S.api.latestShot())).enjoyment === 8, 'bagless shot notes and ratings are saved');
    await evaluate(async () => { S.favourites = [null, null, null, null, null]; await useFav(0); });
    await page.evaluate(key => selectBean(key, { quiet: true }), bag.batch);
    await page.click('[data-fav="0"]'); await page.waitForFunction(() => S.noBag && S.loaded);
    check(await evaluate(() => S.next.profileId === 'duplicate-mode-test' && S.noBag), 'bagless favourites restore identity without inheriting the selected bag');
    const edit = await page.locator('#editFavs').boundingBox(), load = await page.locator('[data-fav="0"]').boundingBox();
    check(edit.width >= 48 && edit.height >= 48 && edit.x + edit.width <= load.x, 'favourites edit target is at least 48 × 48 and separate from Load');
    await page.click('#editFavs'); await page.click('[data-favedit="0"]'); await page.waitForSelector('#favSave'); await evaluate(() => closeSheet());
    // Both manual profiles, including zero targets and unchanged limits/steps.
    for (const kind of ['flow', 'pressure']) {
      await page.goto(url + '#profiles'); await page.waitForFunction(() => S.api && S.shelfLoaded); await evaluate(() => renderProfiles()); await page.waitForSelector(`[data-manual="${kind}"]`); await page.click(`[data-manual="${kind}"]`); await page.click('#baglessProfile');
      await loaded(); current = await wf();
      check(current.profile.beverage_type === 'manual' && current.profile.steps.every(s => Number(s[kind]) === 0) && current.context.targetYield === 0 && current.context.targetWaterVolume === 0, `manual ${kind} preserves zero targets and disables inherited stops`);
      check(kind !== 'flow' || current.profile.steps.every(s => Number(s.limiter.value) === 9), 'manual flow keeps Decaid pressure limit');
      await page.click('[data-step="temp:1"]'); await loaded(); current = await wf();
      check(current.profile.steps.every(s => Number(s.temperature) === 88.5), 'temperature changes shift every manual step');
      await page.click('#stopMode'); await page.fill('#weightTarget', '40'); await page.click('#saveWeight'); await loaded();
      check((await wf()).context.targetYield === 40, `manual ${kind} writes an explicit weight target without modifying the controller steps`);
    }
    await page.evaluate(key => selectBean(key, { quiet: true }), bag.batch);
    await page.goto(url + '#profiles'); await evaluate(() => renderProfiles());
    await page.click('[data-manual="pressure"]'); await page.click('#useProfile'); await loaded();
    check((await wf()).context.beanBatchId === bag.batch && await evaluate(() => S.next.manual === 'pressure' && S.next.targetTimeS === null), 'manual brewing can retain a selected bag without inheriting recommendation timing');
    await page.route(/\/api\/v1\/machine\/info$/, route => route.fulfill({ json: { GHC: false } }));
    await page.goto(url + '#profiles'); await page.waitForFunction(() => S.api && S.shelfLoaded); await evaluate(() => renderProfiles()); await page.waitForSelector('[data-manual="flow"]'); await page.click('[data-manual="flow"]');
    check(await page.isDisabled('#baglessProfile'), 'manual modes are unavailable on a machine reporting no GHC'); await evaluate(() => closeSheet());
    await page.unroute(/\/api\/v1\/machine\/info$/);
    await page.unroute(/\/api\/v1\/profiles\?/);
    await page.route(/\/api\/v1\/profiles\?/, async route => { const response = await route.fetch(); await route.fulfill({ response, json: (await response.json()).filter(p => p.profile.beverage_type !== 'manual') }); });
    await page.goto(url + '#profiles'); await page.waitForFunction(() => S.api && S.shelfLoaded); await evaluate(() => renderProfiles()); await page.waitForFunction(() => S.library && !S.library.some(p => p.manual)); await page.click('[data-manual="flow"]');
    check((await page.textContent('#sheet')).includes("isn't visible"), 'missing manual profiles have show/restore guidance'); await evaluate(() => closeSheet());
    await page.unroute(/\/api\/v1\/profiles\?/);
    // Fit the actual new modes, including the saved-shot panel at tight sizes.
    for (const size of [[1340, 800], [1005, 552], [390, 844]]) {
      await page.setViewportSize({ width: size[0], height: size[1] });
      await page.goto(url + '#profiles'); await page.waitForFunction(() => S.api && S.shelfLoaded); await evaluate(() => renderProfiles()); await page.waitForFunction(() => S.library?.some(p => p.manual)); await page.click('[data-manual="flow"]'); await page.click('#baglessProfile');
      await page.waitForTimeout(2900);
      const fit = await evaluate(() => ({ x: document.documentElement.scrollWidth <= innerWidth, y: document.documentElement.scrollHeight <= innerHeight + 1 && [...document.querySelectorAll("#view-brew > .stack")].every(c => c.scrollHeight <= c.clientHeight + 1) }));
      check(fit.x && (size[0] < 760 || fit.y), `manual/bagless mode fits ${size.join(' × ')}`);
      await page.screenshot({ path: `${artifacts}/manual-${size.join('x')}.png`, fullPage: true });
    }
    check(!errors.length, 'no page errors: ' + errors.join('; '));
    await page.setViewportSize({ width: 1340, height: 800 });
    await page.goto(url + '#brew'); await page.waitForFunction(() => S.next && S.shelfLoaded);
    await checkFavourites(page, check);
    // Exercise the same new behavior through the committed built demo, whose
    // simulated controller motions illustrate the chart rather than real GHC input.
    await page.goto(origin + '/built?full&demo#brew');
    await page.waitForFunction(() => S.api?.demo && S.shelfLoaded && S.next);
    await evaluate(() => selectBean(NO_BAG));
    await page.goto(origin + '/built?full&demo#profiles'); await page.waitForFunction(() => S.library?.some(p => p.manual));
    await page.click('[data-manual="flow"]'); await page.click('#baglessProfile'); await loaded();
    check(await evaluate(() => S.noBag && S.next.manual === 'flow' && S.next.yieldG === 0), 'built demo loads manual flow with No bag and no weight target');
    await page.click('[data-run="espresso"]'); await page.waitForFunction(() => S.snap.state.state === 'espresso');
    await page.waitForTimeout(2500); await page.click('#stopBtn');
    await page.waitForFunction(() => S.lastShotId);
    const demoShot = await evaluate(() => S.api.latestShot());
    check(!demoShot.beanId && !demoShot.batch && demoShot.manual === 'flow', 'built demo records bagless manual shots without attaching its first coffee');
    await page.screenshot({ path: `${artifacts}/built-manual-after.png`, fullPage: true });
    // The profile's graph, and a reference shot that can be removed (the demo has coffees and history).
    await page.goto(origin + '/built?full&demo#brew'); await page.waitForFunction(() => S.api?.demo && S.shelfLoaded);
    // Until its review is closed, the chart keeps the shot just pulled; closing it brings back the plan.
    check(await evaluate(() => S.live.length > 0), 'built demo: the finished shot stays on the chart while its review is open');
    await page.click('#closeAfter');
    await evaluate(() => selectBean(S.shelf[0].key, { quiet: true }));
    await page.waitForFunction(() => S.plan?.timed === 'shot' && /Dashed: what .* timed from your last shot/.test(document.querySelector('#chartEmpty').textContent), null, { timeout: 8000 });
    check(await evaluate(() => !S.ghost && document.querySelector('#chartEmpty').textContent.includes('timed from your last shot')), 'built demo: the Brew chart shows the profile, timed from the last shot with it, and no reference by default');
    await evaluate(() => showProfile(nextProfile().id));
    await page.waitForFunction(() => document.querySelectorAll('#planSteps li').length > 1 && /Step times from your shot/.test(document.querySelector('#planNote').textContent));
    check(true, 'built demo: the profile sheet lists the steps, timed from a shot');
    await evaluate(() => closeSheet());
    await evaluate(async () => { const s = (await S.api.shotPage(0, 40)).items.find(x => x.batch === S.current.batch); await setReference(S.current, s.id); });
    check(await evaluate(() => !!S.ghost && !!document.querySelector('#clearRef')), 'built demo: a reference shot shows faintly with Remove in the legend');
    await page.click('#clearRef'); await page.waitForFunction(() => !S.ghost);
    check(await evaluate(async () => (await S.api.shelf()).find(b => b.id === S.current.id).bestShotId === null), 'built demo: removing the reference shot is saved');
    await checkFavourites(page, check);
    check(!errors.length, 'no page errors after live/built carousel checks: ' + errors.join('; '));
  } catch (e) { console.error(e); if (page) await page.screenshot({ path: '/tmp/crema-brewing/failure.png', fullPage: true }).catch(() => {}); process.exitCode = 1; }
  finally { await browser?.close(); server.close(); try { process.kill(-mock.pid, 'SIGTERM'); } catch {} }
})().catch(e => { console.error(e); process.exitCode = 1; try { process.kill(-mock.pid, 'SIGTERM'); } catch {} });
