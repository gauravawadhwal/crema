# UI plan: briefs for the remaining workstreams

Self-contained instructions for whoever continues [ui-plan.md](ui-plan.md), in any
tool. Give an agent "Common instructions" plus one workstream section. Read the
handoff log at the top of ui-plan.md first: it says which branches and PRs exist.

Written 10 November 2026, when WS 1, 2, 4a (logic) and 10 were open as PRs #56, #58,
#55 and #57, WS 7 and WS 9 were part-done on WIP branches, and the rest not started.

## Common instructions (every workstream)

**Project.** Crema is a web skin for the Decent DE1 espresso machine. The app is plain
JS in `skin/` with no framework and no build step: `skin/index.html` holds the markup
and all CSS, `skin/app.js` the UI and live API, `skin/demo.js` a simulated backend.
Shared logic is TypeScript in `server/` and reaches the browser as the generated,
committed bundle `skin/engine.js` (global `E`).

**Read first.** `CLAUDE.md` (all of it; the Conventions and Gotchas sections matter),
`docs/design.md`, and in `docs/ui-plan.md`: "Decisions", "Rules for every workstream",
"Layout specifications", "Notes from WS 1" (on the WS 1 branch) and your workstream.

**Branching.** Work on the branch named in your section. If it does not exist, create
it from the base named there. If the base has been merged, use `main`. Open one PR
against `main` (stacked PRs in this repo always target `main`). Do not merge. Do not
push to `main`.

**What WS 1 gave you** (on `ui/ws1-guard-rails` and everything cut from it):
- Tokens on `:root`: `--t-xs` 11 px, `--t-s` 12.5, `--t-m` 14, `--t-l` 16, `--t-xl` 20,
  `--t-hero` 84; `--s-4`, `--s-8`, `--s-12`, `--s-16`, `--s-24`; `--hit` 44 px,
  `--hit-tight` 40 px (only at the two shortest tablet heights). Use them; add no
  literal colours or ad-hoc font sizes.
- `node scripts/check-targets.cjs`: fails on controls under the hit size, overlapping
  controls, controls covering text, and clipped text, on every view at five tablet
  sizes and 390×844, with the demo's coffees and with the `?stress` fixture.
- `scripts/check-targets.allow.json`: known failures, each tagged with the workstream
  (`ws`) that fixes it. The check fails on an unlisted failure **and** on a stale
  entry, so delete the entries you fix. Add none; fix new failures instead.
- `?stress` on the demo URL: coffees with an 82-character name, a 57-letter single
  word, a long profile name and no roaster.

**Hard rules.**
- `app.js` and `demo.js` are classic scripts sharing globals: never redeclare a
  top-level name.
- A new member on the app's API object must exist in `makeLiveApi` (app.js),
  `makeDemoApi` (demo.js) and usually `dev/mock-decaid.ts`.
- Never write the workflow's profile during a shot. Loads go through
  `loadOntoMachine`. Use `shotRunning()`, never `state === "espresso"` alone.
- Shared key-value records are written by re-reading and merging (`patchRecord`, the
  settings merge), never from a stale copy.
- Everything except AI must work with no Crema server and with AI switched off.
- The tablet home screen must fit one screen, no page scroll, at 1340×800, 1340×752,
  1206×720, 1005×600 and 1005×552, before and after a shot, with Stop visible.
- The primary action is bottom right on every screen and sheet. Stop's rectangle must
  not move between states (`e2e-controls.cjs` section 12 asserts it, from WS 2).
- Freeform text: one smaller size if needed, a line limit, then an ellipsis.
  Containers never grow; nothing overlaps.
- Copy is plain, from the user's side. No emoji, no provider or internal ids.
- Public repo: no personal data, emails, hostnames, IPs or tokens. No screenshots
  committed. Do not reach the tablet or NAS; demo and simulator only.
- Mono (no licence) and Streamline (GPL-3.0) are references for ideas only. Copy no
  code or artwork.
- Manual flow and pressure control stay as they are. No on-screen dial.

**After any change under `skin/`** (including a rebuilt `skin/engine.js`): run
`node scripts/build-demo.mjs` and commit `demo/crema-demo.html`. CI's `verify` job
fails when it is stale. After changing anything in `server/` that the browser uses:
`npm run build:engine` and commit `skin/engine.js`.

**Verification is deliberately light** (the user's instruction: low-stakes personal
repo, slow CI). Always run `npm test`, `npm run typecheck`,
`node scripts/check-targets.cjs` and `node scripts/check-tablet-fit.cjs`. Then run
only the e2e scripts your section names, once, on source. Skip `--built` variants.
For other scripts, grep them for selectors or text you changed and fix those lines by
reading. Rerun a failing script once in isolation before investigating; some flake in
batch runs, and `e2e-live.cjs` has one known intermittent shelf-timeout failure. Look
at your own work: take Playwright screenshots into a temporary directory outside the
repo at 1340×800, 1005×552 and 390×844, normal and `?stress`. Do not wait for CI.

**Docs with every PR.** In `docs/ui-plan.md`: change your row of the status table and
add an entry at the top of the handoff log (what is done, what is not verified, what
is next). Update the sentences in `docs/design.md` that describe what you changed.

**PR.** Title `ui: <what changed> — WS <n>`. The body lists the changes, scripts you
adjusted and why, allowlist entries removed and remaining, the commands you ran with
results, and what you did not run or verify.

---

## WS 9 — Shelf, Profiles, Shots, Settings (resume)

Branch `ui/ws9-other-screens`, cut from `ui/ws1-guard-rails`. It holds one **WIP
commit** (about 500 lines, 9 files) from an agent that was stopped while on its docs
and CI edits. Nothing in it is verified. Start by reading
`git diff origin/ui/ws1-guard-rails...HEAD`, check it against the list below, finish
what is missing and fix what is wrong. Suitable for a cheaper model.

Stay out of: the Brew view, `toast()` and its CSS, `attempt()`, `failText`, and the
helper that produces the "AI pick" label.

1. **Shelf cards.** One primary action, "Brew this" (or the existing "Brewing" state),
   plus a More button (`--hit` square, accessible name "More actions for <coffee>")
   that opens the existing sheet (`openSheet`) with the other actions as full-width
   rows: Freeze/Thaw, Finished, Another bag, Set what's left, Roaster's page. Same
   handlers and behaviour as today; only where they are triggered from changes.
2. Cards in a row have equal height: origin line clamped to two lines, tasting-note
   chips to one row.
3. Filter chips above the grid: All, In its window, Resting, Running low. Reuse the
   logic behind the existing rest and low-stock pills; invent no thresholds.
   `role="radio"` in a radiogroup, `--hit` tall. An empty result says so plainly.
4. Three skeleton cards while the shelf loads. The existing error and timeout text
   must still appear (an `e2e-live.cjs` case checks the shelf timeout message).
5. **Profiles.** A small pressure and flow thumbnail on every candidate card and
   library row, from `E.profileCurve` and the existing chart code (`drawChart` compact
   mode). No thumbnail and no empty box when a profile has no usable steps.
6. Show the AI pick once: keep the Recommended block; do not repeat it as a full card
   in the ranked grid. Keep "Use" reachable.
7. Skeletons while candidates load. "Asking the AI to choose among these…" must still
   appear (checked by `e2e-live.cjs`).
8. **Shots.** Filter chips by coffee ("All" plus one per coffee in the loaded shots),
   scrolling sideways inside their own container. Paging must keep working.
   `scripts/e2e-shot-history.cjs` must pass **unchanged**.
9. A labelled Compare control at least `--hit` tall in place of the bare checkbox.
   Keep the underlying input and selector if scripts use it.
10. Skeleton rows while the list loads.
11. **Fix the Shots detail metrics row**: on `main` the row (time, yield, ratio, peak,
    flow) is squeezed to a 2 px line at all five tablet sizes.
12. **Settings.** On tablet and desktop only, a sticky section index at the top of the
    view that scrolls the chosen card into view. Consistent row heights. Controls here
    are mostly 34–36 px: bring them to `--hit`. Fix the "Experience" row overlapping
    itself on the phone.
13. Delete every `ws: 9` allowlist entry (93 when WS 1 landed).

Out of scope: result pills on shot rows (WS 5), profile editing, server code.

Run also: `e2e-shot-history.cjs`, `e2e-demo.cjs`, and a few focused new assertions
(More sheet actions still work, shelf filter, shots filter with paging, settings
index). If an existing script clicked a Shelf button now inside More, update it to
open More first.

## WS 7 — Feedback layer (resume)

Branch `ui/ws7-feedback-layer`, cut from `ui/ws1-guard-rails`. One **WIP commit**
(about 500 lines, 7 files), stopped mid-work, unverified and possibly not running.
Read `git diff origin/ui/ws1-guard-rails...HEAD` first. Suitable for a cheaper model.

Stay out of: view layouts, skeleton rows (WS 9), start/stop/load logic, Stop.

1. **Toast stack.** Up to three visible, each on its own timer (about 2.8 s; 6 s with
   an action), container `role="status"`. Top centre on tablet and desktop, below the
   status bar, never over the favourites carousel or Stop; above the tab bar on phone.
   `toast(msg)` keeps working for the roughly 80 call sites; an optional second
   argument is `{ action: { label, run }, duration }`. A message already showing is
   not duplicated. Scripts read toast text: keep their selectors working.
2. **Undo** on: marking a bag Finished, Freeze/Thaw, clearing a favourite, removing a
   reference shot. Undo goes through the same write helpers as the action. If one
   cannot be undone safely, leave it without Undo and say why in the PR.
3. **Pending state.** One helper for async button handlers: further taps are ignored
   while the request is unsettled; after 300 ms the button shows `aria-busy` and a
   `.pending` style. It must survive panel redraws (`patchHtml`) and always clear.
   Apply to: Load onto machine, shelf actions, saving a coffee, Use on Profiles, Ask
   the AI again, Review shot, Set as reference, Settings buttons. Not Stop, and not
   the Espresso/Steam/Hot water/Flush starts.
4. **Connection banner** appears only after the link has been down 1.5 s. Everything
   else about a drop stays immediate (disabled controls, `S.loaded`, `S.shotAcross`,
   reconcile on return).
5. **Plain errors.** A pure classifier in `server/control/` (exported through
   `server/engine.ts`, unit-tested in `test/plain-error.test.ts`): text with HTTP
   codes or verbs, URLs, paths, exception names, JSON, or provider ids
   (`claude-cli`, `codex-cli`, `gemini-api`, `anthropic-api`, `mock`) becomes a plain
   fallback such as "Decaid couldn't do that. Try again." Plain sentences pass
   through. Route the `toast(\`Couldn't …: ${e.message}\`)` call sites through it.
   PR #55 also adds lines to `server/engine.ts` and `server/control/index.ts`; keep
   yours separate so the merge is trivial.

Run also: `e2e-live.cjs`, `e2e-demo.cjs`, `e2e-controls.cjs`. New tests, one each:
Undo restores state in the simulator's data; a slow write tapped twice sends one
request; a 1 s drop shows no banner and a 3 s drop does; an error with a status code
surfaces as a plain sentence.

## WS 3 — Brew at rest (not started)

Branch `ui/ws3-brew-at-rest` exists but equals `ui/ws2-quick-fixes`; work on it. Needs
layout judgement under the tablet-fit limits: use a strong model.

Your regions: the control column `#controls`, the centre panel at rest, favourite
cards. Stay out of the next-shot panel's steppers and fields (WS 6), `toast()`, and
the other four views.

1. **Split buttons.** Steam, Hot water and Flush each become one button about 62 px
   tall. The main part shows the name and the chosen preset ("Flat white · 25 s") and
   starts the operation exactly as today. A disclosure part at least 48 px wide opens
   the existing sheet with presets as rows at least `--hit` tall, the chosen one
   marked. Picking selects it through the same code path as a chip today
   (`pushPresetSettings`) and closes the sheet without starting. Preset editing stays
   in Settings. Keep disabled and busy states, the "Use only the machine's start
   buttons" setting and group-head-controller behaviour. Update scripts that clicked
   preset chips.
2. **Scale tile** in the control column: weight and battery, with a Tare button (at
   least 48 px wide) as its right part. "No scale" state with Tare disabled. Make the
   status-bar scale chip a non-interactive readout.
3. **Stop** pinned at the bottom of the column, at least 76 px at 1340×800.
   `e2e-controls.cjs` section 12 must still pass.
4. **Step rail at rest**, between the chart header and the chart: one segment per
   profile step, width in proportion to duration with a minimum, showing the name and
   a detail like "4 s · 6 ml/s". Build from the data `E.profileCurve` gives the chart.
   Write it as a standalone function taking step descriptors
   `{ name, detail, weight, state?, progress? }` and returning HTML, with generic
   classes (`.steps-rail`, `.step`, `.now`, `.done`): WS 4 reuses it. Hide it at the
   two tightest heights if it does not fit.
5. **No zero readouts at rest**: hide the live readout row when nothing is running and
   no finished shot is showing. Keep the element ids.
6. **Direct labels** on the pre-shot plan in `drawChart`: "pressure 9 bar",
   "flow 6 ml/s", "90.5 °C", in the series colours, skipped rather than overlapping.
7. **Favourite cards**: 40 px coffee photo or initial tile (look up `beanId` on the
   shelf; a neutral tile if gone or bagless), name (two lines), profile (one line),
   recipe line, and a pressure sparkline from the favourite's installed profile. No
   change to the favourites data, carousel mechanics, Edit mode or the Save card.
   `node scripts/e2e-brewing.cjs --favourites-only` must pass **unchanged**.
8. Delete the `ws: 3` allowlist entries (preset chips, scale chip). Stepper entries
   belong to WS 6.
9. Phone: the same split buttons and tile must work there; no other phone redesign.

Run also: `e2e-controls.cjs`, `e2e-brewing.cjs --favourites-only`, `e2e-demo.cjs`.
Check one light theme (`rosso` or `nordic`). In ui-plan.md, note the rail function's
name and descriptor shape under WS 4.

## WS 6 — Value sheet and steppers (not started)

Branch `ui/ws6-value-sheet` exists but equals `ui/ws2-quick-fixes`; work on it. Strong
model. Your regions: the next-shot panel `#nextShot`, the new sheet, stepper
behaviour. Stay out of the control column, the chart, favourites, `toast()`, and the
layout of other views.

1. **Tiles.** Dose, Yield and Temp become three equal tiles in a row (about 80 px at
   1340×800): label, value in mono at `--t-xl`, one sub-line (basket size; ratio;
   "all steps"). Each is a button that opens the sheet on its tab. For manual profiles
   and No bag, the yield tile shows "Off" at a zero target and the Yield tab offers
   the existing stop-manually or stop-at-weight choice with its existing caution text.
   Grind stays inline with buttons at least `--hit`. Keep `#grindInput`, `#loadBtn`,
   `#resetRecipe`, `#profileBtn`. Update scripts that stepped dose, yield or temp.
2. **Sheet.** The existing sheet component, tabs Dose, Yield, Temp (`role="tablist"`);
   edits on other tabs are kept until Set or Cancel. Per tab: the value at about
   64 px with its unit; the ratio for yield; a horizontal ruler dragged with pointer
   events and pointer capture, snapping to the step, also `role="slider"` with arrow
   keys, Home and End; up to four recent values for this coffee from shot history
   (no new storage, no new API member); minus and plus (56×52) at the left of the
   footer; Cancel and Set at the right, Set in the bottom-right corner. Steps and
   limits come from the existing `step()` clamps, moved into one table. Cancel, scrim
   and Esc change nothing. Set applies all edits through the same state updates
   `step()` makes. Nothing is written to the machine until Load or Espresso.
3. **Hold-to-repeat** on every remaining stepper (grind, Settings, sheets): one step
   per tap; repeats after about 400 ms, accelerating; stops on release, leave or
   cancel; never double-fires. Implement once. Settings writes are debounced so a
   hold writes the final value once, still through the merge helpers.
4. Temperature still shifts every profile step (`withTemperature`); only how the
   number is edited changes.
5. Delete the `ws: 6` allowlist entries.

Run also: whichever of `e2e-live.cjs`, `e2e-brewing.cjs`, `e2e-controls.cjs` stepped
those values (the "unsaved recipe edits survive a refresh" case in `e2e-live.cjs`
almost certainly does), and one new check: opens on the right tab; drag snaps; clamps
at both limits; a recent value sets it; Cancel, scrim and Esc leave the recipe
unchanged; Set applies two tabs at once; a hold repeats and a tap steps once.

## WS 4 — Pour mode layout (not started)

Base: `ui/ws3-brew-at-rest` once WS 3 is done, with `ui/ws4a-pour-logic` (PR #55)
merged into your branch. Branch name `ui/ws4-pour-mode`. This touches shot state and
Stop: use the strongest model and do run `e2e-controls.cjs`.

The logic already exists (see PR #55 and its notes in ui-plan.md):
- `E.stepProgress({ steps, points, targetYieldG, weightFlow?, hasScale?, manual? })`
  returns `{ steps[], index, count, yieldFraction, etaS }`; each step has `name`,
  `state` ("done" | "now" | "ahead"), `elapsedS`, `limitS`, `target`, and for the
  current step `tracking: { kind, progress, value, goal }`. Pass `hasScale: false`
  with no scale, because the live points record a missing weight as 0.
- Each live point already carries `frame` (Decaid's `profileFrame`).

1. Enter pour mode while `shotRunning()` is true, however the shot started (Crema,
   group head). Leave when a snapshot shows the shot ended, then show the after-shot
   view. With the socket down mid-shot (`S.shotAcross`) keep the layout, say "No link,
   still pouring", and keep Stop available.
2. Layout as in "Layout specifications → Pour mode": step rail across the top (reuse
   WS 3's rail function with live state), a left card with time and weight at
   `--t-hero` and the same size, the yield bar with percentage and time-to-go, small
   pressure, flow and temperature; the wide chart with step boundaries, the remaining
   plan dashed ahead of a now line, and values labelled at the line ends; the bottom
   bar with what ends the shot and a 300×96 Stop covering the corner where Stop sits
   at rest. Favourites and the other operations are hidden; the rail is dimmed.
3. **Skip step** (decision 4; Decaid 0.9.1 has it): `PUT
   /api/v1/machine/state/skipStep`, no body, the same route as `idle` and `espresso`.
   Add it to `makeLiveApi`, `makeDemoApi` and `dev/mock-decaid.ts` (advance one step,
   stay in espresso, do nothing on the last step). Before building the button, check
   on desktop Decaid whether the machine briefly reports `skipStep` as its state: if
   it does, `shotRunning()` must treat it as still pouring, or the screen will think
   the shot ended. Hide the button on the last step and for manual profiles.
4. Make the demo and `dev/mock-decaid.ts` advance `profileFrame` through named steps,
   and set `stopReason` on finished shots (values in PR #55's notes).
5. At 1005×552, time, weight and Stop are visible without scrolling; drop the
   secondary readouts and the explanatory text first.
6. Update `e2e-controls.cjs` section 12 so the invariant becomes: Stop's rest
   rectangle lies inside its pouring rectangle.

Run also: `e2e-controls.cjs`, `e2e-demo.cjs`, `e2e-live.cjs`, and a new check: start a
shot; assert the hero numbers, the step name and Stop's size; drop the socket mid-shot
and assert the layout holds; assert no workflow write happens mid-shot.

## WS 4.5 — Pour chart axis and Brew polish (next)

Base: `main`. Branch: a new one, for example `ui/ws4.5-pour-chart`. The scope, the
decision on the axis and the "Done when" line are in ui-plan.md under "WS 4.5". Small
and well specified; a mid-range model is fine, but it touches the pour screen, so run
`e2e-controls.cjs`.

Where to look in `skin/app.js`: `renderLive` (the `pouring` branch builds `durs`, the
live plan and `maxT`), `renderPour` and `stepDetailText` (the pour rail), the rest
branch of `renderLive` (the rest rail), `stepsRailHtml` (minimum segment width),
`drawChart` (the plan labels, in the `!pts.length` block), and the `split` helper in
`renderControls` (the preset sub-label). The control-column rules are in
`skin/index.html` under the `max-height: 860px` landscape block.

`ui/ws4.5-pour-polish` has a stopped attempt as one WIP commit. Read its diff for the
small fixes, which may be usable as they are, but rewrite the axis to the rule in
ui-plan.md (40 s, widening 10 s at a time one second before the edge, nothing else
sizing it). The attempt fed `etaS` and the plan length into it and still reached 80 s.
Verify everything yourself.

Run also: `e2e-controls.cjs`, `e2e-demo.cjs`. Look at pour mode at about 5 s, 15 s and
the end of a demo shot (the demo runs about three times faster than real time), at
1340×800 and 1005×552.

## WS 5 — After the shot (not started)

Base: the WS 4 branch. Branch `ui/ws5-after-shot`. Strong model.

1. Result header: "Last shot · 7:43", then "41.6 g in 26.4 s" in mono, with pills for
   ratio, stop reason and the window verdict. Stop reason comes from
   `E.stopReason(...)` (PR #55), which returns `{ reason, source, nearTarget }`; map
   `weight`, `volume`, `user`, `profile`, `machine`, `error` to plain words and show
   "Stopped near target" when the reason is unknown and `nearTarget` is true.
2. Chart at least 190 px tall at 1340×800, with the plan dashed behind the curves;
   smaller at the compact sizes.
3. The review's single next-shot change becomes a block with a primary button naming
   the result ("Set grind to 9.75"). It edits `S.next` only, marks the changed field
   and adds a line such as "Changed from 10 after the last shot"; Reset undoes it. One
   stepper step per change type (grind, yield, temperature, dose). No button when the
   change has no numeric form.
4. Taste, body and rating keep their saving behaviour. Fix "Balanced" being wider than
   its button at 1005 px and on the phone. Add the result pills to Shots rows.
5. Delete the `ws: 5` allowlist entries.

Run also: `e2e-review.cjs`, and a new case: tap Apply, assert the recipe changed and
the machine workflow did not.

## WS 8 — Phone (not started)

Base: the WS 4 branch (or WS 5). Branch `ui/ws8-phone`. Cheaper model is fine.

0. **Regression to fix first:** since pour mode merged, Stop is below the fold on the
   phone while pouring (y≈996 on a 1184 px page at 390×844). Item 2 is the fix.
1. One status line (state, group temperature, water) that expands on tap; the demo
   banner becomes a "Demo" chip.
2. A bar fixed above the tabs: Espresso at rest, Stop while anything runs. Stop is
   inside the viewport at every scroll position during a shot.
3. Pour mode on the phone: time and weight side by side at about 52 px, yield bar,
   step name and progress, then the chart, all visible at 390×844 without scrolling.
4. Delete the `ws: 8` allowlist entry (`#phoneSleep`) and any phone entries left.

Run also: `e2e-demo.cjs` (it runs at phone size too) and the phone-via-proxy case in
`e2e-live.cjs`.

## WS 11 — Motion and finish (last)

Base: `main` after everything is merged. Cheaper model is fine.

1. One motion rule: 160 ms ease-out for panels entering and leaving (pour mode,
   sheets, toasts). Numbers never animate. The existing reduced-motion rule turns it
   all off.
2. Check all six themes on the new screens (contrast on the chart and primary button).
3. `docs/design.md`: the type scale, the primary-action rule, the freeform-text rule,
   the pour layout. Update the progress notes in `docs/implementation-plan.md` and
   the status section of `CLAUDE.md`.
4. Regenerate the demo assets in the order given in
   `.claude/skills/refresh-demo-assets/SKILL.md`: demo data, built demo, screenshots,
   walkthrough boxes, Pages site.
5. The allowlist must be empty; delete it and the allowlist handling.

Here, do run the full check list in `.claude/skills/verify-crema/SKILL.md` once.
