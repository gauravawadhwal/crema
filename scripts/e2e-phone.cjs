// Phone action and compact pour regression. In-browser simulator only.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch();
  try {
    for (const stress of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto('file://' + path.resolve(__dirname, '../skin/index.html') + '?demo&full' + (stress ? '&stress' : '') + '#brew');
      await page.waitForFunction(() => S.next && S.presets && S.snap);
      const inView = async (selector) => page.evaluate(sel => {
        const el = document.querySelector(sel), r = el.getBoundingClientRect();
        return el.checkVisibility() && r.top >= 0 && r.bottom <= innerHeight - 60 && r.left >= 0 && r.right <= innerWidth;
      }, selector);
      assert.ok(await inView('[data-run="espresso"]'), 'Espresso is above tabs at rest');
      await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
      assert.ok(await inView('[data-run="espresso"]'), 'Espresso stays visible after scrolling');
      await page.evaluate(() => scrollTo(0, 0));
      await page.click('#phoneStatusToggle');
      assert.equal(await page.getAttribute('#phoneStatusToggle', 'aria-expanded'), 'true');
      assert.ok(await page.isVisible('#phoneSleep'), 'expanded status exposes sleep');
      await page.click('#phoneStatusToggle');
      await page.click('[data-run="espresso"]');
      await page.waitForFunction(() => document.body.classList.contains('pouring'));
      await page.waitForTimeout(500);
      for (const selector of ['#pourTime', '#pourWeight', '#pourYield', '#pourSteps .now', '#liveChart', '#stopBtn']) assert.ok(await inView(selector), `${selector} fits without scrolling`);
      fs.mkdirSync('/tmp/crema-ws8', { recursive: true });
      await page.screenshot({ path: `/tmp/crema-ws8/phone-pour${stress ? '-stress' : ''}.png` });
      for (const where of [0, 0.5, 1]) {
        await page.evaluate(frac => scrollTo(0, document.body.scrollHeight * frac), where);
        assert.ok(await inView('#stopBtn'), 'Stop stays above tabs at every scroll position');
      }
      await page.evaluate(() => { location.hash = '#settings'; });
      await page.waitForTimeout(200);
      assert.ok(await inView('#phoneAwayAction'), 'Stop stays visible on another view during a shot');
      assert.equal(await page.textContent('#phoneAwayAction'), 'STOP');
      await page.evaluate(() => { location.hash = '#brew'; });
      await page.waitForTimeout(200);
      await page.evaluate(() => { S.streams.close(); onStreamLost('machine'); });
      assert.ok(await inView('#stopBtn'), 'Stop remains visible across a lost machine socket');
      await page.click('#stopBtn');
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('ok  phone fixed actions, expandable status, compact pour, stress names and socket loss');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
