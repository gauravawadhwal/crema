// Checks that the brew home screen fits the DE1 tablet (Galaxy Tab A11, 1340x800 panel)
// at 1x and scaled sizes, with and without the Android nav bar, before and after a shot.
//   node scripts/check-tablet-fit.cjs [screenshotDir] [url]   (needs Playwright)
// Measures whether the brew home screen fits the tablet without scrolling, before and after a shot.
const { chromium } = require('playwright');
const SIZES = [[1340, 800, 'A11 at 1x'], [1340, 752, 'A11 1x with nav bar'], [1206, 720, 'A11 at ~1.1x'], [1005, 600, 'A11 at 1.33x'], [1005, 552, '1.33x with nav bar']];
(async () => {
  const b = await chromium.launch(); const out = process.argv[2] || '.'; const url = process.argv[3] || 'file://' + require('path').resolve(__dirname, '../skin/index.html') + '?demo';
  for (const [w, h, label] of SIZES) {
    const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: 'dark' });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(url + '#brew'); await p.waitForTimeout(1200);
    const m1 = await p.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth }));
    console.log('   home columns:', await p.evaluate(() => [...document.querySelectorAll('#view-brew > .stack')].map((c) => c.className.split(' ')[1] + (c.scrollHeight > c.clientHeight + 1 ? ' CLIPPED ' + (c.scrollHeight - c.clientHeight) + 'px' : ' ok')).join(', ')));
    await p.screenshot({ path: `${out}/fit-${w}x${h}-home.png` });
    await p.click('[data-run="espresso"]'); await p.waitForSelector('#afterShot:not([hidden])', { timeout: 30000 });
    await p.waitForTimeout(400);
    const m2 = await p.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight }));
    await p.screenshot({ path: `${out}/fit-${w}x${h}-after.png` });
    const cols = await p.evaluate(() => [...document.querySelectorAll('#view-brew > .stack')].map((c) => c.className.split(' ')[1] + (c.scrollHeight > c.clientHeight + 1 ? ' CLIPPED ' + (c.scrollHeight - c.clientHeight) + 'px' : ' ok')).join(', '));
    console.log('   after-shot columns:', cols);
    console.log(`${w}x${h} (${label}): home ${m1.sh}/${m1.ih}${m1.sh > m1.ih ? ' SCROLLS' : ' fits'}, after-shot ${m2.sh}/${m2.ih}${m2.sh > m2.ih ? ' SCROLLS' : ' fits'}, hscroll ${m1.sw > w}, errors ${errs.length}`);
    await p.close();
  }
  await b.close();
})();
