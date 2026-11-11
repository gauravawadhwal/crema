// Shared by the live simulator and exact built-demo brewing checks.
// Exercises the carousel through its UI; machine commands stay in local simulators.
const assert = require('node:assert/strict');
module.exports = async function checkFavourites(page, check) {
  const live = await page.evaluate(() => !S.api.demo);
  const original = await page.evaluate(() => ({ next: S.next }));
  await page.setViewportSize({ width: 1340, height: 800 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200); // settle phone-to-tablet layout before comparing fixed Stop
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(async () => {
    const base = { ...favouriteRecipe(), name: 'Recipe', profileTitle: S.next.profileTitle, doseG: S.next.doseG, yieldG: S.next.yieldG,
      tempC: S.next.tempC, beanId: S.current?.id ?? null, grinderSetting: S.next.grind || null };
    for (let i = 0; i < 7; i++) await S.api.favourites.set(i, { ...base, name: i === 2 ? 'A favourite with a deliberately long name for the tablet' : `Recipe ${i + 1}`, doseG: 18 + i * .5 });
    // Legacy holes do not hide the entries after the old five-slot boundary.
    await S.api.favourites.set(1, null);
    S.favourites = await S.api.favourites.get(); FAV_UI.editing = false; renderFavs();
  });
  check(await page.locator('[data-fav]').count() === 6 && await page.locator('[data-fav="6"]').count() === 1, `${live ? 'live' : 'built demo'}: reads entries beyond five and preserves legacy holes`);
  await page.screenshot({ path: `/tmp/crema-brewing/carousel-${live ? 'live' : 'built'}.png` });
  const stopBefore = await page.locator('#stopBtn').boundingBox();
  const initial = await page.locator('#favs').evaluate(el => el.scrollLeft);
  await page.click('#favNext');
  await page.waitForFunction(left => document.querySelector('#favs').scrollLeft > left + 50, initial);
  await page.waitForTimeout(500);
  const beforeRedraw = await page.locator('#favs').evaluate(el => el.scrollLeft);
  await page.evaluate(() => renderNextShot());
  assert(Math.abs(await page.locator('#favs').evaluate(el => el.scrollLeft) - beforeRedraw) <= 2, 'recipe redraw preserves carousel position');
  assert.equal((await page.locator('#stopBtn').boundingBox()).y, stopBefore.y);
  check(true, 'arrows advance cards; recipe redraws preserve position and Stop stays put');
  // Mouse drag, including crossing onto a different button, must not load it.
  const loadedBefore = await page.evaluate(() => JSON.stringify(S.next));
  const viewport = await page.locator('#favs').boundingBox();
  await page.mouse.move(viewport.x + 350, viewport.y + 30); await page.mouse.down();
  await page.mouse.move(viewport.x + 210, viewport.y + 30, { steps: 10 }); await page.mouse.up();
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => JSON.stringify(S.next)), loadedBefore);
  check(await page.locator('#favs').evaluate(el => el.scrollLeft) > beforeRedraw + 40, 'drag snaps forward without loading a favourite');
  await page.focus('#favs'); await page.keyboard.press('End'); await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'addFav');
  check(await page.locator('#favNext').isDisabled(), 'keyboard reaches the final card and the next arrow disables');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.focus('#favs'); await page.keyboard.press('Home'); await page.waitForTimeout(100);
  check(await page.locator('#favPrev').isDisabled(), 'Home returns to the first card with reduced motion');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // Save through the actual UI, filling the first legacy hole rather than replacing an entry.
  await page.locator('#addFav').scrollIntoViewIfNeeded(); await page.click('#addFav');
  await page.waitForFunction(() => S.favourites.filter(Boolean).length === 7 && !FAV_UI.saving);
  check(await page.evaluate(() => S.favourites[1]?.doseG === S.next.doseG && S.favourites[6]?.name === 'Recipe 7'), 'Save reuses a legacy empty slot without truncating later entries');
  check(await page.getAttribute('[data-fav="1"]', 'aria-pressed') === 'true', 'saving a duplicate recipe highlights the newly saved favourite');
  if (live) {
    const phone = await page.context().browser().newPage({ viewport: { width: 390, height: 844 } });
    try {
      await phone.goto(page.url()); await phone.waitForFunction(() => S.api && S.shelfLoaded);
      check(await phone.evaluate(async () => (await S.api.favourites.get()).filter(Boolean).length === 7), 'another client reads all saved favourites');
      await phone.evaluate(async () => { const f = (await S.api.favourites.get())[0]; await S.api.favourites.set(null, { ...f, name: 'Added on the phone' }); });
      // The tablet still has the old list. Its Save must append against a fresh read.
      await page.locator('#addFav').scrollIntoViewIfNeeded(); await page.click('#addFav');
      await page.waitForFunction(() => S.favourites.filter(Boolean).length === 9 && !FAV_UI.saving);
      check(await page.evaluate(() => S.favourites.some(f => f?.name === 'Added on the phone')), 'a stale tablet Save preserves a favourite added by another client');
    } finally { await phone.close(); }
    const before = await page.evaluate(() => JSON.stringify(S.favourites));
    const store = /\/api\/v1\/store\/crema\/favourites$/;
    await page.route(store, route => route.request().method() === 'POST' ? route.abort() : route.continue());
    await page.locator('#addFav').scrollIntoViewIfNeeded(); await page.click('#addFav');
    await page.waitForFunction(() => !FAV_UI.saving && /Couldn't save/.test(document.querySelector('#toast').textContent));
    assert.equal(await page.evaluate(() => JSON.stringify(S.favourites)), before);
    check(true, 'failed Save reports the error and leaves all favourites intact');
    await page.click('#editFavs');
    await page.locator('[data-favedit="6"]').scrollIntoViewIfNeeded(); await page.click('[data-favedit="6"]');
    await page.fill('#favName', 'Failed rename'); await page.click('#favSave');
    await page.waitForFunction(() => !FAV_UI.saving && /Couldn't save/.test(document.querySelector('#toast').textContent));
    check(await page.locator('#favName').isVisible() && await page.evaluate(() => S.favourites[6].name === 'Recipe 7'), 'failed rename keeps the editor open and the saved name unchanged');
    await page.unroute(store);
    await page.fill('#favName', 'Renamed after five'); await page.click('#favSave');
    await page.waitForFunction(() => S.favourites[6].name === 'Renamed after five' && document.querySelector('#sheetBack').hidden);
    await page.click('#editFavs');
  }
  // The real UI loads an older-position favourite, with the same shot-time gate.
  await page.evaluate(() => { FAV_UI.editing = false; renderFavs(); });
  await page.locator('[data-fav="6"]').scrollIntoViewIfNeeded(); await page.click('[data-fav="6"]');
  await page.waitForFunction(() => S.loaded && S.next.doseG === 21 && !FAV_UI.loading, null, { timeout: 8000 }).catch(async e => {
    console.error('Favourite load state:', await page.evaluate(() => ({ loaded: S.loaded, dose: S.next?.doseG, profileId: S.next?.profileId, expectedId: S.favourites[6]?.profileId, ui: FAV_UI, toast: document.querySelector('#toast').textContent })));
    throw e;
  });
  check(await page.getAttribute('[data-fav="6"]', 'aria-pressed') === 'true', 'a favourite beyond the fifth slot loads its exact recipe and highlights');
  await page.click('[data-run="espresso"]'); await page.waitForFunction(() => S.snap?.state?.state === 'espresso');
  const machineBefore = await page.evaluate(() => S.api.machine.recipe());
  check(!await page.locator('[data-fav="0"]').isVisible(), 'pour mode hides favourite controls');
  // A queued request can still arrive from an already-open sheet or another client.
  await page.evaluate(() => useFav(0));
  await page.waitForFunction(() => S.heldLoad && !FAV_UI.loading);
  const machineDuring = await page.evaluate(() => S.api.machine.recipe());
  check(machineDuring.doseG === machineBefore.doseG && await page.evaluate(() => S.next.doseG === 18), 'mid-shot favourite selection holds the load instead of changing the running workflow');
  await page.click('#stopBtn'); await page.waitForFunction(() => !shotRunning() && !S.heldLoad && S.loaded);
  check((await page.evaluate(() => S.api.machine.recipe())).doseG === 18, 'the held favourite loads after Stop');
  for (const [width, height] of [[1005, 552], [390, 844], [1340, 800]]) {
    await page.setViewportSize({ width, height }); await page.waitForTimeout(200);
    await page.locator('#addFav').scrollIntoViewIfNeeded();
    const b = await page.locator('#addFav').boundingBox();
    check(b.width >= 180 && b.height >= 96 && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `carousel cards stay readable without page overflow at ${width}×${height}`);
    if (width === 390) {
      await page.evaluate(() => favouriteScroll(0, false));
      const list = await page.locator('#favs').boundingBox(), before = await page.evaluate(() => JSON.stringify(S.next));
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: list.x + 250, y: list.y + 40 }] });
      for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: list.x + 250 - i * 25, y: list.y + 40 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(600);
      assert.equal(await page.evaluate(() => JSON.stringify(S.next)), before);
      check(await page.locator('#favs').evaluate(el => el.scrollLeft) > 40, 'native touch swipe advances the phone carousel without loading');
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await cdp.detach();
    }
  }
  // Replacing a favourite must replace mode/profile identity too, not retain old fields.
  await page.evaluate(async () => {
    await S.api.favourites.set(0, { ...S.favourites[0], noBag: true, manual: 'flow', profileId: 'old-profile', direct: true });
    S.favourites = await S.api.favourites.get(); FAV_UI.editing = true; renderFavs();
  });
  await page.locator('[data-favedit="0"]').scrollIntoViewIfNeeded(); await page.click('[data-favedit="0"]'); await page.click('#favUpdate');
  await page.waitForFunction(() => document.querySelector('#sheetBack').hidden && !FAV_UI.saving);
  check(await page.evaluate(() => S.favourites[0].profileId === S.next.profileId && S.favourites[0].manual === S.next.manual && S.favourites[0].noBag === S.noBag), 'Replace updates bagless/manual mode and installed profile identity');
  const count = await page.evaluate(() => S.favourites.filter(Boolean).length);
  await page.locator('[data-favedit="6"]').scrollIntoViewIfNeeded(); await page.click('[data-favedit="6"]'); await page.click('#favClear');
  await page.waitForFunction(() => document.querySelector('#sheetBack').hidden && !FAV_UI.saving);
  check(await page.evaluate(async expected => { const f = await S.api.favourites.get(); return f[6] === null && f.filter(Boolean).length === expected - 1; }, count), 'Clear removes only the chosen favourite, including beyond five');
  await page.evaluate(async () => {
    for (let i = 0; i < S.favourites.length; i++) if (S.favourites[i]) await S.api.favourites.set(i, null);
    S.favourites = await S.api.favourites.get(); renderFavs();
  });
  check(await page.locator('#editFavs').isEnabled(), 'Done remains available after clearing the last favourite');
  await page.click('#editFavs');
  check(await page.locator('#editFavs').isDisabled() && await page.locator('#addFav').isEnabled(), 'empty carousel still lets a recipe be saved');
  await page.evaluate(next => { S.next = next; FAV_UI.editing = false; renderNextShot(); renderControls(); }, original.next);
};
