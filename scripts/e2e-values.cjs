// Recipe drafts, pointer controls and write coalescing; demo only, no hardware.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1340, height: 800 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const url = 'file://' + path.resolve(__dirname, '../skin/index.html') + '?demo&full';
    await page.goto(url);
    await page.waitForFunction(() => S.next && S.prefs && S.library);
    await page.evaluate(() => { window.valueWrites = 0; const apply = S.api.apply; S.api.apply = (...a) => { valueWrites++; return apply(...a); }; });
    const recipe = () => page.evaluate(() => JSON.stringify(S.next));
    const before = await recipe();
    const open = key => page.click(`[data-value="${key}"]`);
    const value = () => page.locator('#valueRuler').getAttribute('aria-valuenow').then(Number);
    await open('temp');
    assert.equal(await page.locator('[data-value-tab="temp"]').getAttribute('aria-selected'), 'true');
    const temp = await value();
    const box = await page.locator('#valueRuler').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 31, box.y + box.height / 2); await page.mouse.up();
    assert.equal(await value(), temp + 1.5, 'drag snaps to half a degree');
    await page.locator('#valueRuler').press('End'); assert.equal(await value(), 100);
    await page.click('#valuePlus'); assert.equal(await value(), 100);
    await page.locator('#valueRuler').press('Home'); assert.equal(await value(), 60);
    await page.click('#valueMinus'); assert.equal(await value(), 60);
    await page.click('#valueCancel'); assert.equal(await recipe(), before);
    for (const close of ['scrim', 'escape', 'swipe']) {
      await open('dose'); await page.click('#valuePlus');
      if (close === 'scrim') await page.locator('#sheetBack').click({ position: { x: 2, y: 2 } });
      if (close === 'escape') await page.keyboard.press('Escape');
      if (close === 'swipe') { const h = await page.locator('.value-handle').boundingBox(); await page.mouse.move(h.x + 10, h.y + 10); await page.mouse.down(); await page.mouse.move(h.x + 10, h.y + 75); await page.mouse.up(); }
      assert.equal(await recipe(), before, close + ' leaves recipe unchanged');
      await page.locator('#sheetBack').waitFor({ state: 'hidden' });
    }
    await open('dose');
    await page.waitForSelector('[data-recent]');
    const recent = Number(await page.locator('[data-recent]').first().getAttribute('data-recent'));
    await page.locator('[data-recent]').first().click(); assert.equal(await value(), recent);
    await page.click('#valuePlus'); const dose = await value();
    await page.click('[data-value-tab="temp"]'); await page.click('#valueMinus'); const nextTemp = await value();
    await page.click('[data-value-tab="dose"]'); assert.equal(await value(), dose);
    await page.click('#valueSet');
    assert.deepEqual(await page.evaluate(() => [S.next.doseG, S.next.tempC, S.loaded, valueWrites]), [dose, nextTemp, false, 0]);
    const grind = await page.evaluate(() => Number(S.next.grind));
    await page.click('[data-step="grind:1"]');
    assert.equal(await page.evaluate(() => Number(S.next.grind)), grind + .25, 'tap steps once');
    const g = await page.locator('[data-step="grind:1"]').boundingBox();
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down(); await page.waitForTimeout(850); await page.mouse.up();
    const held = await page.evaluate(() => Number(S.next.grind)); assert.ok(held >= grind + 1, 'hold repeats');
    await page.waitForTimeout(450); assert.equal(await page.evaluate(() => Number(S.next.grind)), held, 'release stops');
    await open('dose');
    const plus = await page.locator('#valuePlus').boundingBox(), start = await value();
    await page.mouse.move(plus.x + 10, plus.y + 10); await page.mouse.down(); await page.waitForTimeout(550); await page.mouse.move(plus.x - 30, plus.y); const left = await value(); await page.waitForTimeout(400); assert.equal(await value(), left, 'leave stops'); await page.mouse.up(); assert.ok(left > start); await page.click('#valueCancel');
    // Settings hold changes locally throughout, and persists only the final value.
    await page.evaluate(() => { location.hash = '#settings'; }); await page.waitForSelector('#gStart');
    await page.evaluate(() => { window.settingWrites = []; const set = S.api.settings.set; S.api.settings.set = p => { settingWrites.push(p); return set(p); }; });
    const settingsBefore = Number(await page.inputValue('#gStart'));
    const b = await page.locator('[data-mini="gStart:0.25"]').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(850);
    assert.equal(await page.evaluate(() => settingWrites.length), 0, 'hold does not write intermediate values');
    await page.mouse.up(); await page.waitForFunction(() => settingWrites.length === 1);
    const settingsAfter = Number(await page.inputValue('#gStart'));
    assert.ok(settingsAfter > settingsBefore + .25);
    assert.equal(await page.evaluate(() => settingWrites[0].grindStart), settingsAfter);
    await page.waitForTimeout(300); assert.equal(await page.evaluate(() => settingWrites.length), 1);
    const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : '/tmp/crema-ws6'; fs.mkdirSync(shots, { recursive: true });
    const view = async (name, ready) => {
      await page.evaluate((name) => { location.hash = name; }, name);
      await page.waitForSelector(ready);
    };
    const pickGrinder = async (id) => {
      await page.click('#chooseGrinder');
      await page.selectOption('#grinderSelect', id);
      await page.waitForFunction((id) => grindSettings().id === (id || null), id);
    };
    await pickGrinder('niche-zero');
    await view('brew', '#grindInput');
    assert.equal(await page.inputValue('#grindInput'), '10');
    await page.click('[data-step="grind:1"]');
    assert.equal(await page.inputValue('#grindInput'), '10.25');
    await view('settings', '#chooseGrinder');
    await pickGrinder('lagom-p80');
    await view('brew', '#grindInput');
    assert.equal(await page.inputValue('#grindInput'), '1');
    await page.click('[data-step="grind:-1"]');
    assert.equal(await page.inputValue('#grindInput'), '0.95');
    await view('settings', '#chooseGrinder');
    await pickGrinder('niche-zero');
    await view('brew', '#grindInput');
    assert.equal(await page.inputValue('#grindInput'), '10.25', 'switching back restores the original grinder’s setting');
    await page.setViewportSize({ width: 390, height: 844 });
    await view('settings', '#chooseGrinder');
    await page.click('#chooseGrinder');
    await page.click('#addGrinder');
    await page.fill('#grinderName', 'Custom test grinder');
    await page.fill('#grinderStart', '-2.75');
    await page.fill('#grinderStep', '0.0125');
    await page.selectOption('#grinderDirection', 'higher');
    await page.screenshot({ path: `${shots}/390-844-grinder.png` });
    await page.click('#grinderForm [type="submit"]');
    await page.waitForFunction(() => grindSettings().name === 'Custom test grinder');
    const original = await page.evaluate(() => grindSettings().id);
    await page.click('#chooseGrinder');
    await page.click('#editGrinder');
    await page.fill('#grinderStart', '3');
    await page.click('#grinderForm [type="submit"]');
    await page.waitForFunction(() => grindSettings().start === 3);
    await view('brew', '#grindInput');
    assert.equal(await page.evaluate(() => grindSettings().id), original);
    assert.equal(await page.inputValue('#grindInput'), '3');
    await page.locator('.stepper').getByRole('button', { name: 'Finer' }).click();
    assert.equal(await page.inputValue('#grindInput'), '3.0125');
    await view('settings', '#chooseGrinder');
    await page.click('#chooseGrinder');
    await page.click('#editGrinder');
    await page.click('#removeGrinder');
    await page.waitForFunction(() => grindSettings().id === null);
    await page.click('#chooseGrinder');
    assert.equal(await page.locator('#grinderSelect option').count(), 3, 'custom grinder was removed');
    await page.click('#sheetClose');
    await view('brew', '#grindInput');
    assert.equal(Number(await page.inputValue('#grindInput')), held, 'the original grind setting survives named grinders');
    for (const stress of [false, true]) for (const [width,height] of [[1340,800],[1005,552],[390,844]]) {
      await page.setViewportSize({ width, height }); await page.goto(url + (stress ? '&stress' : ''));
      await page.waitForSelector('[data-value="dose"]');
      if (stress) await page.evaluate(() => selectBean('stress-batch-1', { quiet: true }));
      await page.screenshot({ path: `${shots}/${width}-${height}${stress ? '-stress' : ''}.png`, fullPage: true });
      await open('yield'); await page.screenshot({ path: `${shots}/${width}-${height}${stress ? '-stress' : ''}-sheet.png` });
      assert.ok(await page.locator('#valueSet').isVisible());
      assert.equal(await page.evaluate(() => document.querySelector('#sheet').scrollWidth > document.querySelector('#sheet').clientWidth), false);
    }
    await page.setViewportSize({ width: 1005, height: 552 });
    await page.evaluate(() => { closeSheet(); S.noBag = true; S.current = null; S.next.manual = 'flow'; S.next.yieldG = 0; renderNextShot(); });
    assert.match(await page.locator('[data-value="yield"]').textContent(), /Off/);
    await open('yield'); assert.equal(await value(), 0);
    await page.click('#stopWeight'); assert.ok(await value() > 0);
    await page.click('#stopManual'); assert.equal(await value(), 0);
    await page.screenshot({ path: `${shots}/1005-552-manual-sheet.png` });
    const setBox = await page.locator('#valueSet').boundingBox(); assert.ok(setBox.y >= 0 && setBox.y + setBox.height <= 552, 'Set is visible at compact height');
    await page.click('#valueSet'); assert.equal(await page.evaluate(() => S.next.yieldG), 0);
    // Touch taps on the Brew grind stepper must step once per tap on both phone and tablet layouts.
    for (const cfg of [
      { label: 'phone', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
      { label: 'tablet', viewport: { width: 1340, height: 800 }, hasTouch: true, isMobile: false },
    ]) {
      const tctx = await browser.newContext(cfg);
      try {
        const tp = await tctx.newPage();
        tp.on('pageerror', e => errors.push(e.message));
        await tp.goto(url);
        await tp.waitForFunction(() => S.next && S.prefs && S.library);
        await tp.click('#loadBtn');
        await tp.waitForFunction(() => S.loaded === true);
        assert.equal(await tp.inputValue('#grindInput'), '10');
        await tp.locator('[data-step="grind:1"]').tap();
        await tp.waitForTimeout(100);
        assert.equal(await tp.inputValue('#grindInput'), '10.25', `${cfg.label} touch tap + steps once`);
        assert.equal(await tp.evaluate(() => S.loaded), false, `${cfg.label} touch tap marks recipe unloaded`);
        assert.equal(await tp.locator('#loadBtn').textContent(), 'Load onto machine');
        assert.ok(await tp.locator('#loadBtn').evaluate(el => el.classList.contains('primary')));
        await tp.locator('[data-step="grind:-1"]').tap();
        await tp.waitForTimeout(100);
        assert.equal(await tp.inputValue('#grindInput'), '10', `${cfg.label} touch tap - steps once`);
        // Consecutive taps still register each tap individually.
        await tp.locator('[data-step="grind:1"]').tap();
        await tp.locator('[data-step="grind:1"]').tap();
        await tp.waitForTimeout(100);
        assert.equal(await tp.inputValue('#grindInput'), '10.5', `${cfg.label} two touch taps step twice`);
        // Named grinder with finer step size (Lagom P80: start 1, step 0.05).
        await tp.evaluate(() => { location.hash = '#settings'; });
        await tp.waitForSelector('#chooseGrinder');
        await tp.locator('#chooseGrinder').tap();
        await tp.selectOption('#grinderSelect', 'lagom-p80');
        await tp.waitForFunction(() => grindSettings().id === 'lagom-p80');
        await tp.evaluate(() => { location.hash = '#brew'; });
        await tp.waitForSelector('#grindInput');
        assert.equal(await tp.inputValue('#grindInput'), '1');
        await tp.locator('[data-step="grind:1"]').tap();
        await tp.waitForTimeout(100);
        assert.equal(await tp.inputValue('#grindInput'), '1.05', `${cfg.label} Lagom P80 touch tap + steps once`);
        await tp.locator('[data-step="grind:-1"]').tap();
        await tp.waitForTimeout(100);
        assert.equal(await tp.inputValue('#grindInput'), '1', `${cfg.label} Lagom P80 touch tap - steps once`);
        // Keyboard activation steps once and preserves focus for repeated presses.
        await tp.locator('[data-step="grind:1"]').focus();
        await tp.keyboard.press('Enter');
        await tp.keyboard.press('Enter');
        assert.equal(await tp.inputValue('#grindInput'), '1.1', `${cfg.label} repeated keyboard Enter steps once per press`);
        // Bagless loaded state updates its helper note in place on grind tap.
        await tp.evaluate(() => chooseInstalledProfile(S.library.find((p) => !p.manual), true));
        await tp.waitForFunction(() => S.noBag && S.next);
        await tp.click('#loadBtn');
        await tp.waitForFunction(() => S.loaded === true);
        assert.equal(await tp.locator('#nextShot .coffee-meta .muted.small').textContent(), 'Shots saved without a coffee');
        await tp.locator('[data-step="grind:1"]').tap();
        await tp.waitForTimeout(100);
        assert.equal(await tp.inputValue('#grindInput'), '1.05', `${cfg.label} bagless touch tap + steps once`);
        assert.equal(await tp.locator('#nextShot .coffee-meta .muted.small').textContent(), 'Load a profile to brew without a bag');

        // No-change guard: other pointer/bindRepeat/re-rendering controls execute once per touch tap.
        // Value sheet steppers (#valuePlus/#valueMinus), ruler tap, and handle tap.
        await tp.locator('[data-value="dose"]').tap();
        await tp.waitForSelector('#valuePlus');
        const tv = () => tp.locator('#valueRuler').getAttribute('aria-valuenow').then(Number);
        const dose0 = await tv();
        await tp.locator('#valuePlus').tap();
        await tp.waitForTimeout(100);
        assert.equal(await tv(), dose0 + 0.5, `${cfg.label} value sheet + steps once`);
        await tp.locator('#valueMinus').tap();
        await tp.waitForTimeout(100);
        assert.equal(await tv(), dose0, `${cfg.label} value sheet - steps once`);
        await tp.locator('#valueRuler').tap();
        await tp.waitForTimeout(100);
        assert.equal(await tv(), dose0, `${cfg.label} value sheet ruler tap does not step`);
        await tp.locator('.value-handle').tap();
        await tp.locator('#sheetBack').waitFor({ state: 'hidden' });
        assert.equal(await tp.inputValue('#grindInput'), '1.05', `${cfg.label} value sheet handle tap closes cleanly`);

        // Favourites carousel (#addFav, #editFavs) single-tap actions.
        await tp.evaluate(() => {
          window.__favWrites = 0;
          const orig = S.api.favourites.set;
          S.api.favourites.set = (...a) => { window.__favWrites++; return orig(...a); };
        });
        const favs0 = await tp.locator('#favs .fav:not(.empty)').count();
        await tp.locator('#addFav').scrollIntoViewIfNeeded();
        await tp.locator('#addFav').tap();
        await tp.waitForTimeout(150);
        assert.equal(await tp.locator('#favs .fav:not(.empty)').count(), favs0 + 1, `${cfg.label} addFav touch tap adds once`);
        assert.equal(await tp.evaluate(() => window.__favWrites), 1, `${cfg.label} addFav touch tap writes once`);
        await tp.locator('#editFavs').tap();
        await tp.waitForTimeout(100);
        assert.equal(await tp.locator('#editFavs').getAttribute('aria-pressed'), 'true', `${cfg.label} editFavs touch tap toggles once`);
        await tp.locator('#editFavs').tap();
        await tp.waitForTimeout(100);
        assert.equal(await tp.locator('#editFavs').getAttribute('aria-pressed'), 'false', `${cfg.label} editFavs second touch tap toggles off`);

        // Settings mini steppers ([data-mini], including gStart after clearing named grinder) and #sAi switch.
        await tp.evaluate(() => { location.hash = '#settings'; });
        await tp.waitForSelector('#chooseGrinder');
        await tp.locator('#chooseGrinder').tap();
        await tp.selectOption('#grinderSelect', '');
        await tp.waitForSelector('#gStart');
        await tp.evaluate(() => {
          window.__miniWrites = [];
          const orig = S.api.settings.set;
          S.api.settings.set = (p) => { window.__miniWrites.push(p); return orig(p); };
        });
        const gStart0 = Number(await tp.inputValue('#gStart'));
        await tp.locator('[data-mini="gStart:0.25"]').scrollIntoViewIfNeeded();
        await tp.locator('[data-mini="gStart:0.25"]').tap();
        await tp.waitForTimeout(280);
        assert.equal(Number(await tp.inputValue('#gStart')), gStart0 + 0.25, `${cfg.label} settings gStart + touch tap steps once`);
        assert.equal(await tp.evaluate(() => window.__miniWrites.length), 1, `${cfg.label} settings gStart + writes once`);
        await tp.locator('[data-mini="gStart:-0.25"]').tap();
        await tp.waitForTimeout(280);
        assert.equal(Number(await tp.inputValue('#gStart')), gStart0, `${cfg.label} settings gStart - touch tap steps once`);
        const sSteam0 = Number(await tp.inputValue('#sSteamT'));
        await tp.locator('[data-mini="sSteamT:5"]').scrollIntoViewIfNeeded();
        await tp.locator('[data-mini="sSteamT:5"]').tap();
        await tp.waitForTimeout(280);
        assert.equal(Number(await tp.inputValue('#sSteamT')), sSteam0 + 5, `${cfg.label} settings sSteamT + touch tap steps once`);
        const ai0 = await tp.locator('#sAi').isChecked();
        await tp.locator('#sAi').scrollIntoViewIfNeeded();
        await tp.locator('#sAi').tap();
        await tp.waitForTimeout(150);
        assert.equal(await tp.locator('#sAi').isChecked(), !ai0, `${cfg.label} settings sAi touch tap toggles once`);

        // Shots compare checkbox ([data-cmp] / .cmp-label re-rendering #shotList in onchange) and #detailStars.
        await tp.evaluate(() => { location.hash = '#shots'; });
        await tp.waitForSelector('[data-cmp]:not(:disabled)');
        const cmpLabel = tp.locator('.cmp-label:has([data-cmp]:not(:disabled))').first();
        const cmpId = await cmpLabel.locator('input').getAttribute('data-cmp');
        await cmpLabel.tap();
        await tp.waitForTimeout(120);
        assert.equal(await tp.evaluate(() => S.cmpShot), cmpId, `${cfg.label} shots compare label touch tap toggles on once`);
        await tp.locator(`.cmp-label:has([data-cmp="${cmpId}"])`).tap();
        await tp.waitForTimeout(120);
        assert.equal(await tp.evaluate(() => S.cmpShot), null, `${cfg.label} shots compare label second touch tap toggles off`);
        await tp.evaluate(() => {
          window.__starWrites = 0;
          const orig = S.api.annotate;
          S.api.annotate = (...a) => { window.__starWrites++; return orig(...a); };
        });
        await tp.locator('#detailStars').scrollIntoViewIfNeeded();
        const sbox = await tp.locator('#detailStars').boundingBox();
        const sCur = Number(await tp.locator('#detailStars').getAttribute('aria-valuenow'));
        await tp.touchscreen.tap(sbox.x + sbox.width * (sCur === 8 ? 0.55 : 0.78), sbox.y + sbox.height / 2);
        await tp.waitForTimeout(120);
        assert.notEqual(Number(await tp.locator('#detailStars').getAttribute('aria-valuenow')), sCur, `${cfg.label} detailStars touch tap updates rating`);
        assert.equal(await tp.evaluate(() => window.__starWrites), 1, `${cfg.label} detailStars touch tap writes once`);
      } finally { await tctx.close(); }
    }
    assert.deepEqual(errors, []);
    console.log('ok value sheet: tabs, draft, drag, bounds, recents, cancel routes, Set, tap/hold, settings write coalescing and screenshots');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
