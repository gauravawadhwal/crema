// Checks touch targets, overlaps and clipped text in the demo, on every view, at the
// DE1 tablet sizes used by check-tablet-fit.cjs and at phone size. Needs Playwright.
//
//   node scripts/check-targets.cjs            # the source app (skin/index.html)
//   node scripts/check-targets.cjs --built    # the built single-file demo (demo/crema-demo.html)
//   node scripts/check-targets.cjs --all      # also list the failures the allowlist covers
//   node scripts/check-targets.cjs --shots <dir>   # save a screenshot of each state
//
// Each state is checked twice: with the demo's own coffees, and with the `?stress`
// fixture (skin/demo.js: a long coffee name on a long profile name, a name that is one
// unbroken word, a coffee with no roaster). States: Brew (and Brew after a shot),
// Shelf, Profiles, Shots, Settings. Open sheets, toasts and running operations are not
// checked.
//
// The rules (measured in CSS px, on the rendered page):
//
// small        A visible, enabled control is smaller than 44x44 (40x40 at the two
//              shortest tablet heights, 600 and 552). A control is a link, button, form
//              field, summary, or an element with an interactive role or a tab stop.
//              What counts as its hit rectangle is deliberately strict:
//              - its own border box, nothing more. A control inside a bigger clickable
//                row is still measured by itself, because the row may do something else;
//              - except a checkbox, radio or file input, which counts together with its
//                <label> (wrapping it, or pointing at it with for=), since tapping the
//                label does the same thing. A label whose input is hidden is the control;
//              - a link in a run of text (an inline <a> with text beside it) is exempt.
// overlap      Two controls' rectangles overlap by more than 2 px each way. A control
//              nested inside another is ignored, as is a label and its own input.
// covers-text  A control's rectangle overlaps rendered text that is neither inside it
//              nor around it (for example the coffee arrows over the coffee's name).
//              Decorative text (aria-hidden) and visually hidden text are not text here.
// clipped      Text runs past a box that cuts it off (overflow hidden or clip) with no
//              text-overflow: ellipsis (sideways) or line-clamp (downwards) rule on the
//              way, or spills out of its own block with overflow visible. Scrollable
//              boxes don't count: the text can be reached.
// Rectangles are cut to what their scrolling or clipping ancestors show. A fixed or
// sticky bar and the content that scrolls under it are never compared.
//
// The allowlist, scripts/check-targets.allow.json, names today's known failures. Each
// entry has a key ("<tablet|phone> <view> <rule> <selector>", no pixel values), the
// workstream in docs/ui-plan.md that will fix it, and a reason. A key covers that
// failure at every size of its device and in both fixtures. The check fails on any
// failure that is not listed, and on any entry that no longer fails, so a workstream
// deletes its entries as it fixes them. Elements outside the views (rail, status bar,
// tab bar) are reported under the view name "chrome".
const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");

const args = process.argv.slice(2);
const built = args.includes("--built");
const showAll = args.includes("--all");
const shotsDir = args.includes("--shots") ? path.resolve(args[args.indexOf("--shots") + 1]) : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const ALLOW_FILE = path.resolve(__dirname, "check-targets.allow.json");

// The tablet sizes are check-tablet-fit.cjs's; keep the two lists in step.
const SIZES = [
  [1340, 800, "tablet", 44],
  [1340, 752, "tablet", 44],
  [1206, 720, "tablet", 44],
  [1005, 600, "tablet", 40],
  [1005, 552, "tablet", 40],
  [390, 844, "phone", 44],
];
const VIEWS = ["brew", "shelf", "profiles", "shots", "settings"];
// The stress coffees after the first, which Brew opens on (see skin/demo.js).
const STRESS_BAGS = ["stress-batch-2", "stress-batch-3"];

function pageUrl(stress) {
  const flags = stress ? "&stress" : "";
  if (!built) return "file://" + path.resolve(__dirname, "../skin/index.html") + "?demo&full" + flags;
  // The built demo is a page fragment; wrap it in a minimal document, as an embedding host would.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crema-targets-"));
  const html = fs.readFileSync(path.resolve(__dirname, "../demo/crema-demo.html"), "utf8");
  fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>${html}</body></html>`);
  return "file://" + path.join(dir, "index.html") + "?full" + flags;
}

// Runs in the page. Returns [{ rule, view, sel, label, detail }].
function audit(min) {
  const CONTROLS = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, label, [role="button"], [role="tab"], [role="link"], [role="checkbox"], [role="switch"], [role="radio"], [role="slider"], [role="option"], [role="menuitem"], [contenteditable=""], [contenteditable="true"], [tabindex]:not([tabindex^="-"])';
  const out = [];
  const css = (el) => getComputedStyle(el);
  const shown = (el) => {
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const labelControl = (label) => (label.htmlFor ? document.getElementById(label.htmlFor) : label.querySelector("input, select, textarea"));
  const labelOf = (el) => el.closest("label") || (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
  const box = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
  const cut = (a, b) => ({ l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) });
  const inner = (el) => { const r = el.getBoundingClientRect(); return { l: r.left + el.clientLeft, t: r.top + el.clientTop, r: r.left + el.clientLeft + el.clientWidth, b: r.top + el.clientTop + el.clientHeight }; };
  // What the element's scrolling and clipping ancestors leave on screen, and the fixed
  // or sticky box it rides in (null for ordinary content).
  // `own` is for text: its element's own overflow cuts it too.
  const onScreen = (el, rect, own = false) => {
    let b = box(rect), layer = null;
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const s = css(a);
      if ((own || a !== el) && s.display !== "inline" && (s.overflowX !== "visible" || s.overflowY !== "visible")) {
        const c = inner(a);
        b = cut(b, { l: s.overflowX === "visible" ? -1e6 : c.l, r: s.overflowX === "visible" ? 1e6 : c.r, t: s.overflowY === "visible" ? -1e6 : c.t, b: s.overflowY === "visible" ? 1e6 : c.b });
      }
      if (s.position === "fixed" || s.position === "sticky") { layer = a; break; }
    }
    return { ...b, layer };
  };
  const offscreen = (el) => { for (let a = el; a && a !== document.body; a = a.parentElement) { const s = css(a); if (s.clipPath !== "none" || s.clip !== "auto") return true; } return false; };
  const overlapOf = (a, b) => { const c = cut(a, b); return { w: c.r - c.l, h: c.b - c.t }; };
  const px = (n) => Math.round(n * 10) / 10;

  // A name for the element that survives data changes: its id, or the nearest ancestor
  // with an id plus its tag, first class and the names (not values) of its data
  // attributes. Rows of a list, and the options of one choice, share a name.
  const part = (el) => {
    const tag = el.tagName.toLowerCase();
    const cls = el.classList[0] ? "." + el.classList[0] : "";
    const attrs = [...el.attributes].filter((a) => a.name.startsWith("data-")).map((a) => `[${a.name}]`).sort().join("");
    const href = tag === "a" && (el.getAttribute("href") || "").startsWith("#") ? `[href="${el.getAttribute("href")}"]` : "";
    const type = tag === "input" && el.getAttribute("type") ? `[type="${el.getAttribute("type")}"]` : "";
    return tag + cls + type + href + attrs;
  };
  const stableId = (el) => (el.id && !/\d/.test(el.id) ? el.id : null);
  const name = (el) => {
    if (stableId(el)) return "#" + el.id;
    let host = el.parentElement;
    while (host && !stableId(host)) host = host.parentElement;
    return (host ? "#" + host.id + " " : "") + part(el);
  };
  const viewOf = (el) => el.closest('[id^="view-"]')?.id.slice(5) ?? "chrome";
  const labelText = (el) => (el.getAttribute("aria-label") || el.innerText || el.value || el.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ").slice(0, 36);
  const fail = (rule, el, sel, detail) => out.push({ rule, view: viewOf(el), sel, label: labelText(el), detail });

  // ---- controls ----
  const controls = [...document.querySelectorAll(CONTROLS)].filter((el) => {
    if (!shown(el)) return false;
    if (el.disabled || el.getAttribute("aria-disabled") === "true" || el.closest("[inert], fieldset[disabled]") || css(el).pointerEvents === "none") return false;
    if (el.tagName === "LABEL") { const c = labelControl(el); return !!c && !c.disabled && !shown(c); }
    return true;
  }).map((el) => ({ el, rect: el.getBoundingClientRect(), vis: onScreen(el, el.getBoundingClientRect()) }));

  for (const { el, rect } of controls) {
    let r = box(rect);
    if (el.matches('input[type="checkbox"], input[type="radio"], input[type="file"]')) {
      const label = labelOf(el);
      if (label && shown(label)) { const lr = label.getBoundingClientRect(); r = { l: Math.min(r.l, lr.left), t: Math.min(r.t, lr.top), r: Math.max(r.r, lr.right), b: Math.max(r.b, lr.bottom) }; }
    }
    if (el.tagName === "A" && css(el).display === "inline" && [...el.parentNode.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())) continue;
    const w = r.r - r.l, h = r.b - r.t;
    if (w < min - 0.5 || h < min - 0.5) fail("small", el, name(el), `${px(w)}x${px(h)}, needs ${min}x${min}`);
  }

  const related = (a, b) => a.contains(b) || b.contains(a) || (a.tagName === "LABEL" && labelControl(a) === b) || (b.tagName === "LABEL" && labelControl(b) === a);
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
    const a = controls[i], b = controls[j];
    if (a.vis.layer !== b.vis.layer || related(a.el, b.el)) continue;
    const o = overlapOf(a.vis, b.vis);
    if (o.w > 2 && o.h > 2) fail("overlap", a.el, [name(a.el), name(b.el)].sort().join(" + "), `"${labelText(a.el)}" and "${labelText(b.el)}" share ${px(o.w)}x${px(o.h)}`);
  }

  // ---- text ----
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    // Not text a person reads here: decoration (aria-hidden, such as the star glyphs and
    // their partly shown fill) and visually hidden headings (a clip or clip-path box).
    if (!node.nodeValue.trim() || !parent || parent.closest('script, style, select, canvas, svg, [aria-hidden="true"]') || !shown(parent) || offscreen(parent)) continue;
    range.selectNodeContents(node);
    const lines = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
    if (!lines.length) continue;
    const text = node.nodeValue.trim().replace(/\s+/g, " ").slice(0, 36);

    // Covered by a control it has nothing to do with.
    const visLines = lines.map((r) => onScreen(parent, r, true)).filter((r) => r.r - r.l > 0.5 && r.b - r.t > 0.5);
    for (const c of controls) {
      if (c.el.contains(parent) || parent.contains(c.el)) continue;
      const own = labelOf(c.el); if (own && own.contains(parent)) continue;
      const hit = visLines.map((r) => (r.layer === c.vis.layer ? overlapOf(c.vis, r) : { w: 0, h: 0 })).find((o) => o.w > 2 && o.h > 2);
      if (hit) fail("covers-text", c.el, `${name(c.el)} over ${name(parent)}`, `"${labelText(c.el)}" covers ${px(hit.w)}x${px(hit.h)} of "${text}"`);
    }

    // Cut off by a clipping box, or spilling out of its own block.
    const u = { l: Math.min(...lines.map((r) => r.left)), t: Math.min(...lines.map((r) => r.top)), r: Math.max(...lines.map((r) => r.right)), b: Math.max(...lines.map((r) => r.bottom)) };
    let ellipsis = false, clamp = false, x = true, y = true;
    for (let a = parent; a && a !== document.documentElement && (x || y); a = a.parentElement) {
      const s = css(a);
      ellipsis = ellipsis || s.textOverflow === "ellipsis";
      clamp = clamp || !["", "none"].includes(s.webkitLineClamp);
      if (a !== document.body && s.display !== "inline" && s.display !== "contents") {
        // Past the edge of a box that doesn't clip: its own block, or one further out
        // that the block has pushed through. Glyph boxes are taller than a tight line
        // box, so allow 3 px downwards. The body is the page: running past it scrolls.
        const r = box(a.getBoundingClientRect());
        if (x && s.overflowX === "visible" && (u.r > r.r + 1 || u.l < r.l - 1)) { fail("clipped", parent, name(parent), `"${text}" spills ${px(Math.max(u.r - r.r, r.l - u.l))} px sideways out of ${name(a)}`); x = false; }
        if (y && s.overflowY === "visible" && (u.b > r.b + 3 || u.t < r.t - 3)) { fail("clipped", parent, name(parent), `"${text}" spills ${px(Math.max(u.b - r.b, r.t - u.t))} px out of the height of ${name(a)}`); y = false; }
      }
      const c = inner(a);
      if (x && s.overflowX !== "visible") {
        if (["hidden", "clip"].includes(s.overflowX) && !ellipsis && (u.r > c.r + 1 || u.l < c.l - 1)) fail("clipped", parent, name(parent), `"${text}" is cut off sideways by ${px(Math.max(u.r - c.r, c.l - u.l))} px at ${name(a)}, no ellipsis`);
        if (!["hidden", "clip"].includes(s.overflowX) || u.r > c.r + 1 || u.l < c.l - 1) x = false;
      }
      if (y && s.overflowY !== "visible") {
        if (["hidden", "clip"].includes(s.overflowY) && !clamp && (u.b > c.b + 3 || u.t < c.t - 3)) fail("clipped", parent, name(parent), `"${text}" is cut off by ${px(Math.max(u.b - c.b, c.t - u.t))} px at the edge of ${name(a)}, no line clamp`);
        if (!["hidden", "clip"].includes(s.overflowY) || u.b > c.b + 3 || u.t < c.t - 3) y = false;
      }
      if (s.position === "fixed") break;
    }
  }
  return out;
}

// One size, one fixture: every state in turn. Returns { failures, errors, log }.
async function checkSize(b, [w, h, device, min], stress) {
  const failures = [], errors = [], log = [];
  const where = `${w}x${h}${stress ? " stress" : ""}`;
  const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: "dark" });
  p.on("pageerror", (e) => errors.push(`${where}: ${e.message}`));
  const url = pageUrl(stress);
  const measure = async (state) => {
    // Web fonts come from Google Fonts; measure with them when they arrive in time.
    // Toasts come and go ("Now brewing ..."); measure the settled screen.
    await p.waitForFunction(() => document.querySelector("#toast")?.hidden !== false, null, { timeout: 6000 }).catch(() => {});
    const fonts = await p.evaluate(() => Promise.race([document.fonts.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 5000))]));
    if (!fonts) log.push(`${where} ${state}: web fonts didn't load within 5 s; measured with fallback fonts, so text results may differ`);
    await p.waitForTimeout(300);
    if (shotsDir) await p.screenshot({ path: path.join(shotsDir, `${w}x${h}${stress ? "-stress" : ""}-${state.replace(/\W+/g, "-")}.png`), fullPage: device === "phone" });
    for (const f of await p.evaluate(audit, min)) failures.push({ ...f, device, size: `${w}x${h}`, state, stress, key: `${device} ${f.view} ${f.rule} ${f.sel}` });
  };
  const open = async (view) => { await p.goto(`${url}#${view}`); await p.waitForTimeout(1300); };
  try {
    for (const view of VIEWS) { await open(view); await measure(view); }
    if (stress) {
      // The other awkward coffees, chosen the way a user would: Brew this, on the shelf.
      for (const bag of STRESS_BAGS) {
        await open("shelf");
        await p.click(`[data-brew="${bag}"]`);
        await p.waitForSelector("#view-brew:not([hidden])");
        await p.waitForTimeout(900);
        await measure(`brew ${bag}`);
      }
    }
    await open("brew");
    await p.click('[data-run="espresso"]');
    await p.waitForSelector("#afterShot:not([hidden])", { timeout: 30000 });
    await p.waitForTimeout(400);
    await measure("brew after shot");
  } catch (e) {
    errors.push(`${where}: ${e.message.split("\n")[0]}`);
  }
  await p.close();
  return { failures, errors, log };
}

(async () => {
  const allow = JSON.parse(fs.readFileSync(ALLOW_FILE, "utf8")).entries;
  const problems = [];
  const keys = new Set();
  for (const e of allow) {
    if (!e.key || !e.reason || !Number.isInteger(e.ws)) problems.push(`allowlist entry needs key, ws and reason: ${JSON.stringify(e)}`);
    if (keys.has(e.key)) problems.push(`allowlist lists "${e.key}" twice`);
    keys.add(e.key);
  }

  const b = await chromium.launch();
  const runs = SIZES.flatMap((size) => [false, true].map((stress) => [size, stress]));
  const results = await Promise.all(runs.map(([size, stress]) => checkSize(b, size, stress)));
  await b.close();
  const failures = results.flatMap((r) => r.failures);
  for (const line of new Set(results.flatMap((r) => r.log))) console.log(line);
  problems.push(...results.flatMap((r) => r.errors));

  // One line per element and size, with the states it failed in when not all of them.
  const line = (f) => `${f.view.padEnd(8)} ${f.size.padEnd(9)} ${f.rule.padEnd(11)} ${f.sel}${f.rule === "small" && f.label ? ` "${f.label}"` : ""}: ${f.detail}`;
  const stateOf = (f) => `${f.state}${f.stress ? ", stress" : ""}`;
  const seen = new Set(failures.map((f) => f.key));
  const fresh = failures.filter((f) => !keys.has(f.key));
  const stale = allow.filter((e) => !seen.has(e.key));
  const dedupe = (list) => {
    const states = new Map();
    for (const f of list) states.set(line(f), (states.get(line(f)) ?? new Set()).add(stateOf(f)));
    return [...states].sort(([x], [y]) => x.localeCompare(y)).map(([l, st]) => `${l} [${st.size > 3 ? `${st.size} states` : [...st].join("; ")}]`);
  };
  if (showAll) {
    const known = dedupe(failures.filter((f) => keys.has(f.key)));
    console.log(`Allowed (${known.length} lines, ${seen.size - new Set(fresh.map((f) => f.key)).size} keys):\n  ` + known.join("\n  ") + "\n");
  }
  if (fresh.length) {
    const freshKeys = [...new Set(fresh.map((f) => f.key))].sort();
    problems.push(`${freshKeys.length} failure(s) not in the allowlist:`, ...dedupe(fresh).map((l) => "  " + l), "keys:", ...freshKeys.map((k) => "  " + k));
  }
  for (const e of stale) problems.push(`stale allowlist entry (it no longer fails; delete it): ${e.key}`);

  console.log(`${failures.length} failure(s) measured across ${runs.length} runs (${SIZES.length} sizes, demo and stress fixture, ${built ? "built demo" : "source app"}); ${seen.size} distinct, ${allow.length} allowed.`);
  if (shotsDir) console.log(`Screenshots in ${shotsDir}`);
  if (problems.length) {
    console.error("\nFAIL\n  " + problems.join("\n  "));
    process.exit(1);
  }
  console.log("OK: nothing outside the allowlist, and every allowlist entry still fails.");
})();
