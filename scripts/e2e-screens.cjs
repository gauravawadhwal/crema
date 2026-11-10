// Focused checks for the Shelf, Shots and Settings changes of UI plan WS 9, in the demo at
// tablet size: the More sheet still runs Freeze and Set what's left, the shelf filters, the
// Shots coffee filter (and that it keeps paging), the labelled Compare control, and the
// Settings section index. Needs Playwright.   node scripts/e2e-screens.cjs
const { chromium } = require("playwright");
const path = require("path");
const assert = require("assert");

const url = "file://" + path.resolve(__dirname, "../skin/index.html") + "?demo&full";

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1340, height: 800 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  const open = async (view) => { await p.goto(`${url}#${view}`); await p.waitForTimeout(900); };

  // Shelf: the card keeps one primary action and a More button.
  await open("shelf");
  const card = p.locator(".bean-card").nth(1);
  assert.equal(await card.locator(".btn").count(), 2, "a shelf card has Brew this and More only");
  const first = await card.locator("[data-more]").getAttribute("data-more");
  await card.locator("[data-more]").click();
  assert.match(await p.locator("#sheet").textContent(), /Freeze/);
  await p.click('#sheet [data-act="freeze"]');
  await p.waitForFunction((k) => S.shelf.find((x) => x.key === k)?.frozen === true, first, { timeout: 5000 });
  await p.click(`[data-more="${first}"]`);
  assert.match(await p.locator('#sheet [data-act="freeze"]').textContent(), /Thaw/, "a frozen bag offers Thaw");
  await p.click('#sheet [data-act="left"]');
  await p.fill("#leftG", "123"); await p.click("#confirmLeft");
  await p.waitForSelector("#sheetBack", { state: "hidden", timeout: 5000 });
  assert.match(await p.textContent("#toast"), /Saved/, "Set what's left saves from the More sheet");

  // Shelf filters: the chips are a radio group, and an empty result says so.
  assert.equal(await p.locator('#shelfFilters [role="radio"]').count(), 4);
  await p.click('[data-sf="low"]');
    assert((await p.textContent("#shelf")).match(/Running low|No coffees running low/), "the Running low filter shows only low coffees or says none");
  await p.click('[data-sf="resting"]');
  assert.equal(await p.locator("#shelf .pill.resting").count(), await p.locator(".bean-card").count(), "Resting shows only resting coffees");
  if (!(await p.locator(".bean-card").count())) assert.match(await p.textContent("#shelf"), /No coffees resting right now/);

  // Shots: filter by coffee, with Compare as a labelled control.
  await open("shots");
  const chips = p.locator('#shotFilters [role="radio"]');
  assert((await chips.count()) >= 3, "All plus one chip per coffee");
  const cmp = await p.locator(".cmp-label").nth(1).boundingBox();
  assert(cmp.height >= 44 && cmp.width >= 44, "Compare is a full-size control");
  const name = (await chips.nth(1).textContent()).trim();
  await chips.nth(1).click();
  const names = await p.locator("#shotList .shot-row strong").allTextContents();
  assert(names.length > 0 && names.every((n) => n === name), "the list shows only the chosen coffee");
  if (await p.locator("#moreShots").count()) {
    await p.click("#moreShots"); await p.waitForTimeout(600);
    assert((await p.locator("#shotList .shot-row strong").allTextContents()).every((n) => n === name), "the filter holds after loading older shots");
  }
  await p.locator('#shotFilters [role="radio"]').first().click();
  assert((await p.locator("#shotList .shot-row").count()) >= names.length, "All shows every loaded shot again");
  await p.locator(".cmp-label input:not([disabled])").first().check();
  assert(await p.evaluate(() => !!S.cmpShot), "Compare overlays a second shot");

  // Filtering to the compared coffee must not compare its new selection with itself.
  const filtered = await p.evaluate(() => {
    shotCoffeeFilter = null;
    S.selShot = S.shots[0].id;
    const other = S.shots.find(s => shotCoffee(s) !== shotCoffee(S.shots[0]));
    S.cmpShot = other.id;
    renderShotList(); // Queue charts for All, then replace their canvases in this frame.
    shotCoffeeFilter = shotCoffee(other);
    renderShotList(0);
    return { selected: S.selShot, compared: S.cmpShot, expected: other.id };
  });
  assert.equal(filtered.selected, filtered.expected);
  assert.equal(filtered.compared, null, "filtering clears comparison with the selected shot");
  await p.waitForTimeout(100); // Let both queued chart callbacks run; pageerror is checked below.

  // Settings: the section index scrolls its card into view.
  await open("settings");
  const goto = p.locator("#settingsIndex [data-goto]");
  const n = await goto.count();
  assert(n >= 6, "the index lists the cards");
  const last = goto.nth(3);
  const id = await last.getAttribute("data-goto");
  await last.click(); await p.waitForTimeout(900);
  const top = await p.evaluate((i) => document.getElementById(i).getBoundingClientRect().top, id);
  assert(top < 200, `the chosen card is at the top (${Math.round(top)} px)`);

  // Phone: no index.
  await p.setViewportSize({ width: 390, height: 844 }); await open("settings");
  assert(!(await p.locator("#settingsIndex").isVisible()), "no section index on the phone");

  assert.deepEqual(errors, []);
  console.log("OK: More sheet, shelf filters, shots coffee filter and Compare, settings index");
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
