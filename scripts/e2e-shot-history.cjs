// Independent history panes, paging and selection; source and exact built demo.
// Only local demo data. Run with --built to check the shipped single-file page.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  let url = 'file://' + path.resolve(__dirname, '../skin/index.html') + '?demo&full#shots';
  let temp;
  if (process.argv.includes('--built')) {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'crema-history-'));
    fs.writeFileSync(path.join(temp, 'index.html'), `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}</style></head><body>${fs.readFileSync(path.resolve(__dirname, '../demo/crema-demo.html'), 'utf8')}</body></html>`);
    url = 'file://' + path.join(temp, 'index.html') + '?full#shots';
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1340, height: 800 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await page.waitForSelector('#detailChart');
    await page.evaluate(() => document.fonts.ready);
    // A long history and saved review exercise both real render paths, not a CSS-only fixture.
    await page.evaluate(async () => {
      const seed = S.shots[0];
      window.historyRows = Array.from({ length: 60 }, (_, i) => ({ ...seed, id: `history-${i}`,
        review: { source: 'rules', review: { summary: 'Recorded shot. '.repeat(300), wentWell: [], issues: [], nextShot: null } } }));
      window.historyReads = 0;
      S.api.shotPage = async (offset, limit) => {
        window.historyReads++;
        return { items: window.historyRows.slice(offset, offset + limit), total: 60 };
      };
      await renderShots();
    });
    const positions = () => page.evaluate(() => ({
      list: document.querySelector('#shotList').scrollTop,
      detail: document.querySelector('#shotDetail').scrollTop,
      main: document.querySelector('main').scrollTop,
      outer: document.scrollingElement.scrollTop,
    }));
    const wheel = async (selector, delta) => {
      await page.locator(selector).hover({ position: { x: 40, y: 40 } });
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(200);
    };
    for (const [width, height] of [[1340, 800], [1005, 552], [1600, 1000], [800, 1000]]) {
      await page.setViewportSize({ width, height });
      // Allow the responsive layout and chart canvas sizing to settle.
      await page.waitForTimeout(300);
      await page.evaluate(() => { document.querySelector('#shotList').scrollTop = 0; document.querySelector('#shotDetail').scrollTop = 0; });
      await wheel('#shotList', 350);
      let p = await positions();
      assert(p.list > 0 && p.detail === 0 && p.main === 0 && p.outer === 0, `${width}x${height}: list must scroll alone: ${JSON.stringify(p)}`);
      const listBefore = p.list;
      await wheel('#shotDetail', 350);
      p = await positions();
      assert(p.detail > 0 && p.list === listBefore && p.main === 0 && p.outer === 0, `${width}x${height}: detail must scroll alone`);
      for (const selector of ['#shotList', '#shotDetail']) {
        await page.locator(selector).evaluate(el => { el.scrollTop = el.scrollHeight; });
        const before = await positions();
        await wheel(selector, 600);
        const after = await positions();
        const own = selector === '#shotList' ? 'list' : 'detail';
        assert(Math.abs(after[own] - before[own]) <= 1, 'pane remains at its scroll boundary');
        for (const key of Object.keys(before).filter(key => key !== own)) assert.equal(after[key], before[key], 'pane boundary must not chain scrolling');
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), 'history must fit viewport');
      console.log(`${width}x${height}: independent panes and scroll boundaries ok`);
    }
    // Older rows stay loaded when selecting and comparing them; the list stays put.
    await page.click('#moreShots');
    await page.waitForSelector('[data-open="history-30"]');
    await page.locator('[data-open="history-30"]').scrollIntoViewIfNeeded();
    const before = await positions();
    const reads = await page.evaluate(() => window.historyReads);
    await page.click('[data-open="history-30"]');
    assert.equal(await page.evaluate(() => S.selShot), 'history-30');
    assert.equal((await positions()).list, before.list, 'selection preserves list position');
    assert.equal((await positions()).detail, 0, 'new shot detail starts at top');
    await page.locator('[data-cmp="history-31"]').check();
    assert.equal(await page.evaluate(() => S.cmpShot), 'history-31');
    assert.equal(await page.evaluate(() => window.historyReads), reads, 'selection and comparison must not reload page one');
    // Both panes can be reached and scrolled by keyboard.
    await page.focus('#shotDetail');
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(200);
    assert((await positions()).detail > 0, 'detail is keyboard scrollable');
    await page.focus('#shotList');
    await page.keyboard.press('Home');
    await page.waitForTimeout(200);
    assert.equal((await positions()).list, 0, 'list is keyboard scrollable');
    // Phone keeps ordinary stacked page scrolling, including after resizing.
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => {
      const list = document.querySelector('#shotList'), detail = document.querySelector('#shotDetail');
      return list.clientHeight >= list.scrollHeight - 1 && detail.getBoundingClientRect().top >= list.getBoundingClientRect().bottom;
    }), 'phone uses stacked, unbounded panes');
    await page.locator('#shotNotes').scrollIntoViewIfNeeded();
    assert(await page.locator('#shotNotes').isVisible(), 'phone can reach shot details');
    await page.setViewportSize({ width: 1340, height: 800 });
    // Empty/error states should remain readable without making the shell scroll.
    await page.evaluate(async () => { S.api.shotPage = async () => ({ items: [], total: 0 }); await renderShots(); });
    assert.match(await page.locator('#shotList').textContent(), /No shots yet/);
    await page.evaluate(async () => { S.api.shotPage = async () => { throw new Error('Unavailable'); }; await renderShots(); });
    assert(await page.locator('#retryShots').isVisible());
    assert.deepEqual(errors, []);
    console.log('paging, selection, comparison, keyboard, phone resize and empty/error states ok');
  } finally {
    await browser.close();
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
