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
    assert.deepEqual(errors, []);
    console.log('ok value sheet: tabs, draft, drag, bounds, recents, cancel routes, Set, tap/hold, settings write coalescing and screenshots');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
