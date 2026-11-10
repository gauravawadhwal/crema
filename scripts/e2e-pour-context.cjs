// Focused pour-mode checks. Uses only the in-browser demo; no hardware commands.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  let browser, builtDir;
  try {
    let file = path.resolve(__dirname, '../skin/index.html');
    if (process.argv.includes('--built')) {
      builtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crema-pour-'));
      file = path.join(builtDir, 'index.html');
      fs.writeFileSync(file, `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>[hidden]{display:none!important}</style></head><body>${fs.readFileSync(path.resolve(__dirname, '../demo/crema-demo.html'), 'utf8')}</body></html>`);
    }
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1340, height: 800 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`file://${file}?demo&full#brew`);
    await page.waitForFunction(() => S.api?.demo && S.presets && S.snap && S.next && S.shelfLoaded);
    const check = async (label, fn) => { assert.ok(await page.evaluate(fn), label); console.log('ok  ', label); };

    await page.evaluate(async () => {
      S.streams.close(); // The cases below feed their own machine snapshots.
      S.link.connected = true;
      S.snap = { state: { state: 'idle' } };
      const profile = { title: 'Loaded profile', steps: [
        { name: 'Fill', pump: 'pressure', pressure: 3, seconds: 8, temperature: 93 },
        { name: 'Soak', pump: 'pressure', pressure: 2, seconds: 12, temperature: 93 },
        { name: 'Pour', pump: 'pressure', pressure: 8, seconds: 30, temperature: 93 },
      ] };
      window.__workflow = { profile, context: { coffeeName: 'Loaded coffee', coffeeRoaster: 'Loaded roaster' } };
      window.__applies = 0;
      S.api.apply = async () => { window.__applies++; return window.__workflow; };
      S.next = { profileTitle: profile.title, doseG: 18, yieldG: 36, tempC: 93, grind: '8.5' };
      S.loaded = false;
      await loadOntoMachine(true);
      window.__workflow.profile.steps[0].name = 'Changed after apply';
      S.api.machine.recipe = () => new Promise(resolve => { window.__recipeResolve = resolve; });
      onSnapshot({ state: { state: 'espresso' }, elapsed: 0, profileFrame: 0 });
      S.loadedRecipe.profile.steps[1].name = 'Changed after start';
      S.next = { profileTitle: 'Next profile', doseG: 22, yieldG: 60, tempC: 96, grind: '14' };
      renderControls(); renderLive();
      const draw = drawChart;
      drawChart = (canvas, points, options) => { window.__chart = options; return draw(canvas, points, options); };
    });
    await check('a shot keeps a deep copy of the applied recipe and profile while next-shot edits change', () => {
      return S.shotContext.profile.steps[0].name === 'Fill' && S.shotContext.profile.steps[1].name === 'Soak'
        && document.querySelector('#pourProfile').textContent === 'Loaded profile'
        && document.querySelector('#pourRecipe').textContent === 'Loaded coffee · 18 → 36 g · 93 °C · grind 8.5';
    });

    await page.evaluate(() => window.__recipeResolve({ profileTitle: 'Machine profile', profile: S.shotContext.profile, coffeeName: null, coffeeRoaster: null, doseG: 17, yieldG: 34, tempC: 92, grind: '', manual: null }));
    await page.waitForFunction(() => document.querySelector('#pourProfile').textContent === 'Machine profile');
    await check('authoritative bagless/empty machine metadata does not borrow the selected coffee or grind', () => document.querySelector('#pourRecipe').textContent === '17 → 34 g · 92 °C');

    await page.evaluate(() => {
      Object.assign(S.shotContext, { profile: null, doseG: null, yieldG: null, tempC: null, grind: null });
      S.plan = E.profileCurve(window.__workflow.profile);
      renderControls(); renderLive();
    });
    await check('missing current profile and targets stay unknown instead of using the loaded or next plan', () => {
      return activeProfile() === null && document.querySelector('#pourRecipe').textContent === ''
        && document.querySelector('#pourSteps').hidden && document.querySelector('#pourYield').hidden
        && !document.querySelector('#skipBtn') && window.__chart.plan === null && window.__chart.shade === null;
    });

    await page.evaluate(() => {
      S.shotContext.profile = JSON.parse(JSON.stringify(window.__workflow.profile));
      S.live = [{ t: 4, p: 3, f: 1, w: 1, temp: 92, frame: null }];
      renderControls(); renderLive();
    });
    await check('unknown frame does not invent step one, a remaining plan, or a Skip action', () => {
      return document.querySelector('#pourStepCount').textContent === 'Step – of 3'
        && !document.querySelector('#pourSteps .now') && !document.querySelector('#skipBtn')
        && window.__chart.plan === null && window.__chart.shade === null;
    });

    await page.evaluate(() => { S.live.push({ t: 5, p: 2, f: 1, w: 2, frame: 1 }); renderLive(); });
    await check('joining an already-running shot uses the observed step', () => document.querySelector('#pourStepCount').textContent === 'Step 2 of 3' && !!document.querySelector('#skipBtn'));
    await page.evaluate(() => {
      window.__skips = 0;
      S.api.machine.skipStep = () => { window.__skips++; return new Promise(resolve => { window.__skipResolve = resolve; }); };
      window.__skipRequest = skipStep(); skipStep(); renderControls();
    });
    await check('repeat Skip is suppressed while its request is pending', () => window.__skips === 1 && document.querySelector('#skipBtn').disabled);
    await page.evaluate(async () => { window.__skipResolve(); await window.__skipRequest; });
    await check('Skip is available again after its request settles', () => !document.querySelector('#skipBtn').disabled);
    await page.evaluate(async () => { S.live.push({ t: 6, frame: 2 }); renderLive(); await skipStep(); });
    await check('the final step hides and guards Skip', () => !document.querySelector('#skipBtn') && window.__skips === 1);
    await page.evaluate(async () => { S.shotContext.manual = 'flow'; S.live = [{ t: 7, frame: 0 }]; renderLive(); await skipStep(); });
    await check('manual profiles hide and guard Skip', () => !document.querySelector('#skipBtn') && window.__skips === 1);

    await page.evaluate(async () => {
      S.shotContext.manual = null; renderLive(); onStreamLost('machine');
      await skipStep(); await loadOntoMachine(true);
    });
    await check('socket loss keeps Stop available, blocks Skip and holds profile writes', () => {
      return document.body.classList.contains('pouring') && !document.querySelector('#stopBtn').disabled
        && document.querySelector('#skipBtn').disabled && S.heldLoad && window.__applies === 1 && window.__skips === 1;
    });

    await page.evaluate(() => {
      S.shotAcross = false; S.heldLoad = false; S.loadedRecipe = null; S.snap = { state: { state: 'idle' } };
      S.api.machine.recipe = async () => { throw new Error('workflow unavailable'); };
      onSnapshot({ state: { state: 'espresso' }, elapsed: 0, profileFrame: 2 });
    });
    await check('a group-head start with an unavailable workflow keeps unknown context and an enabled Stop', () => {
      return document.querySelector('#pourProfile').textContent === 'Espresso'
        && document.querySelector('#pourRecipe').textContent === '' && !document.querySelector('#skipBtn')
        && window.__chart.plan === null && !document.querySelector('#stopBtn').disabled;
    });
    assert.deepEqual(errors, [], 'no page errors');
  } finally {
    await browser?.close();
    if (builtDir) fs.rmSync(builtDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
