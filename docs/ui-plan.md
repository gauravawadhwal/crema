# UI plan: one layout per state of the brewing loop

Created 10 November 2026 from a UI review of `main` at `8834dd7`. Status: **in
progress**. The status table below is the handoff: update it in the same PR as the
work, so another agent can pick up from it.

The review compared Crema's Brew, Shelf, Profiles, Shots and Settings screens in the
demo at 1340×800 and 390×844 with [Mono](https://github.com/meldavy/decaid-mono-skin)
(its style guide, scenario list and screenshots) and with the items already listed in
[implementation-plan.md](implementation-plan.md). The user has a private page with the
renders; it is not in this repo. The layout specifications below replace it for
agents. Checked against the demo and simulator only, not the tablet.

Mono's repository has no licence file. Use it for ideas only: copy no code, icons or
artwork from it. The same applies to Streamline (GPL-3.0).

## Status

| WS | Work | Size | Depends on | Status / evidence |
|---|---|---|---|---|
| 1 | Guard rails: tokens, target check, stress fixture | S | none | PR #56 open, not merged. Tokens defined and unused; `check-targets.cjs` passes on source and built demo with 136 allowlisted failures; unit tests, typecheck, tablet fit, `e2e-demo` (source and built) and `e2e-live` pass. Simulator and demo only. See "Notes from WS 1" |
| 2 | Quick fixes for measured defects | S | 1 | Not started |
| 3 | Brew at rest | M | 2 | Not started |
| 4 | Pour mode | L | 3 | Not started |
| 5 | After the shot | M | 4 | Not started |
| 6 | Value sheet and steppers | M | 3 | Not started |
| 7 | Feedback layer | M | 2 | Not started |
| 8 | Phone | M | 4 | Not started |
| 9 | Shelf, Profiles, Shots, Settings | M | 2 | Not started |
| 10 | Sleep screen and sound | S | 2 | Not started |
| 11 | Motion and finish | S | all | Not started |

Order: 1, then 2, then 3 with 7, then 4 with 9, then 5 with 6, then 8 with 10, then 11.
Nearly everything lands in `skin/app.js` and `skin/index.html`, so run at most two
agents at a time, on different views, each in its own worktree. Each workstream is one
PR against `main`. When an earlier PR is not merged yet, branch from its branch and
still open the PR against `main`. Agents do not merge.

## Decisions (user, 10 November 2026)

1. **Pour mode is a full takeover** of the Brew screen while a shot runs, not just
   larger numbers inside the three columns.
2. **Dose, yield and temperature open a value sheet**; grind stays an inline stepper.
3. **Chime and hold-to-wake default to off.** Both are per-device settings.
4. **Skip step is built only if Decaid 0.9.1 exposes the command.** The WS 4 agent
   checks Decaid's REST spec first. Streamline sends `skipStep` (see `parity.md`) and
   Mono tests a skip against Decaid's simulator, which suggests it exists; neither was
   read at source level for this plan. `dev/mock-decaid.ts` has no skip command today.
   Without the command, leave the button out; Stop takes the corner alone.
5. Machine keyboard shortcuts stay out unless the user asks.

## Defects measured on `main` (demo, 1340×800)

- All ten steam, hot water and flush preset chips are 28 px tall. `design.md` sets a
  44 px floor. Stepper buttons are 40×38, the coffee arrows 40×40, the grind input and
  the weight readout button 40 px tall.
- Stop moves 23 px up when a shot starts (top 484 to 461), because the hint under
  Espresso ("Starting loads the recipe first") disappears.
- The coffee arrows (`#prevBean`, `#nextBean`) sit over the name and the rest pill:
  "Compass House Blend" is cut off and the pill is clipped.
- Brew uses 25 distinct font size and family combinations, 10.2 px to 25.6 px.
- The shot clock is 20.8 px and the weight readout 19.2 px.
- The chart hint is drawn over the plan lines, and the legend repeats readout labels.
- After a shot the chart is about 115 px tall.
- "Chosen by claude-cli, real run" shows a provider id on Brew and Profiles.
- The toast covers the favourites carousel.
- Shelf cards carry up to six equal-weight buttons, so card heights differ.
- Phone: status chips and the demo banner take the first 185 px; during a shot the
  chart is below the fold and Stop scrolls away.
- Five readouts show 0.0 at rest; steam temperature stays in the row during espresso.

## Rules for every workstream

- Plain JS, no framework, no build step. All CSS stays in `skin/index.html`.
- Use the type, spacing and hit-size tokens from WS 1. No new literal sizes or colours.
- **The primary action is bottom right, in the same place on every screen and sheet**:
  Stop, Set, Save. Stop's rectangle at rest must lie inside its rectangle while pouring.
- **Freeform text** (coffee, roaster, profile, favourite names): one smaller size for
  long text, a line limit, then an ellipsis. Containers never grow and nothing overlaps.
- Any new API member goes in `makeLiveApi`, `makeDemoApi` and `dev/mock-decaid.ts`.
- Shared logic goes in `server/` and reaches the app through `skin/engine.js`; run
  `npm run build:engine` and commit the bundle.
- Never write the workflow's profile during a shot; loads go through `loadOntoMachine`.
  Use `shotRunning()`, not `state === "espresso"`.
- Everything except AI works with no server and with AI switched off.
- Copy is plain and from the user's side. No emoji, no internal ids.
- Do not reach the tablet or NAS.
- Before opening the PR: the `verify-crema` skill, `check-tablet-fit.cjs`,
  `check-targets.cjs` (after WS 1) and the e2e scripts named in "Done when", on source
  and on the built demo. Attach screenshots at 1340×800, 1005×552 and 390×844 to the
  PR, not to the repo. Say what you could not verify. Update the status table here.

## Layout specifications (1340×800, design pixels)

Shared frame, unchanged from today: rail 0–88 px wide; status bar at top 12, height 32;
main area from top 54 to 640; a rule at 652; bottom bar 664–786. Columns in the main
area: left 104–404 (300 wide), centre 418–1114 (696 wide), right 1128–1324 (196 wide).

### Brew at rest (WS 2, 3, 6)

- **Left, the next shot.** Row 1: 56 px photo, roaster eyebrow, coffee name across the
  full remaining width with a two-line clamp. Row 2: rest pill on the left, the two
  coffee arrows (44×44) on the right. Then the profile row (72 px): a pressure and flow
  sparkline of the profile, its name, and a pill reading "AI pick" or "Rules pick";
  tapping opens Profiles as today. Then three equal tiles (80 px tall) for dose, yield
  and temperature, each a label, the value in mono at about 21 px, and one sub-line
  (basket size; ratio; "all steps"); a tile opens the value sheet. Then grind: label,
  52×52 minus, value, 52×52 plus. Load onto machine and Reset sit at the bottom of the
  card; the "Why this profile" disclosure is below them.
- **Centre, the plan.** Header: state on the left, on the right one muted line such as
  "Plan for Londonium, timed from your last shot with it" (this replaces the hint drawn
  over the plot). Below it a step rail: one segment per profile step, width in
  proportion to its duration, with the step name and "4 s · 6 ml/s" style detail.
  Then the chart with the plan dashed and a label at each line ("pressure 9 bar",
  "flow 6 ml/s", "90.5 °C") in place of a legend. No zero readouts at rest.
- **Right, controls.** Espresso: 96 px tall accent tile, name plus one mono line
  "18 → 42 g · loads first". Steam, Hot water, Flush: one 62 px split button each; the
  main part shows the name and the chosen preset ("Flat white · 25 s") and starts it,
  a 48 px disclosure on the right opens the preset list in the existing sheet. A scale
  tile of the same shape: weight and battery, with a Tare button as its right part.
  Stop: 76 px tall, pinned to the bottom of the column (top 564, bottom 640) in every
  state.
- **Bottom, favourites.** As the carousel is today, with cards showing a 40 px coffee
  photo or initial tile, name, profile, the recipe line, and a pressure sparkline at
  the lower right. The header column (title, arrows, Edit) is about 104 px wide.

### Pour mode (WS 4)

Shown while `shotRunning()` is true, however the shot started.

- Rail stays, with the other destinations dimmed. Status bar shows "Pouring".
- **Top band, 54–140.** Profile name with a muted recipe summary ("Compass House Blend
  · 18 → 42 g · 90.5 °C · grind 10"), "Step 3 of 4" on the right, then the step rail
  across the full width: finished steps filled and showing their actual time; the
  current step larger, with a progress bar and what it is tracking ("2.4 of 4 s ·
  holding 9.0 bar"); later steps showing their plan.
- **Left card, 104–404 × 150–640.** Time, then weight, both in mono at 84 px, the same
  size. Under weight a 10 px yield bar with "27% of 42.0 g" and, once flow is steady,
  "about 17 s to go". At the bottom of the card: pressure, flow and temperature at
  about 22 px.
- **Chart card, 418–1324 × 150–640.** The live chart, with step boundaries, the current
  step shaded, the rest of the plan dashed ahead of a "now" line, and each line's
  current value labelled at its end. No legend.
- **Bottom bar, 664–786.** Left: what ends the shot ("At 42.0 g on the scale. Changes
  you make now load when this shot ends."). Right: Stop, 300×96, red, covering the
  corner where Stop sits at rest. Skip step (150×96, quiet) to its left only under
  decision 4. Favourites and the other operations are not shown.
- With the machine socket down mid-shot, keep the layout and say "No link, still
  pouring"; Stop stays available.
- At 1005×552, time, weight and Stop must be visible without scrolling; drop the
  secondary readouts and the "stops by itself" text first.

### After the shot (WS 5)

- Left, right and bottom as at rest. A recipe field changed by the Apply button gets an
  accent border and a line such as "Changed from 10 after the last shot".
- **Centre.** Header: "Last shot · 7:43", then "41.6 g in 26.4 s" in mono at about
  26 px, with pills on the right: ratio, stop reason ("Stopped at weight"), and the
  window verdict ("Fast · 28–36 s expected"). Chart at least 190 px tall with the plan
  dashed behind the real curves. Taste and body scales, then rating with Set as
  reference and Review again on the right. At the bottom, the review's next-shot change
  as a block: label, the change ("Grind finer"), one sentence of evidence, and a
  primary button naming the result ("Set grind to 9.75").

### Value sheet (WS 6)

Bottom sheet with a handle. Tabs: Dose, Yield, Temp; ratio shown at the right for
yield. The value in mono at about 64 px. A horizontal ruler that drags and snaps to the
step. A row of recent values for this coffee as 44 px presets. Footer: minus and plus
(hold to repeat, accelerating) on the left; Cancel and Set on the right, Set at the
bottom-right corner.

### Phone, 390×844 (WS 8)

One status line (state, group temperature, water; a "Demo" chip in the demo) that
expands on tap. While pouring: time and weight side by side at about 52 px, the yield
bar, the step name and progress, then the chart. A bar fixed above the tabs holds
Espresso at rest and Stop while anything runs.

## Workstreams

### WS 1 — Guard rails (S)

Files: `skin/index.html`, `scripts/check-targets.cjs` (new), `skin/demo.js`,
`scripts/screenshots.cjs`, `.github/workflows/ci.yml`.

- Add tokens to `:root`: a type scale (11, 12.5, 14, 16, 20 px and a hero size),
  spacing steps (4, 8, 12, 16, 24) and control heights (`--hit: 44px`,
  `--hit-tight: 40px` for the two shortest tablet sizes). Define only; do not restyle.
- `scripts/check-targets.cjs`: at every size in `check-tablet-fit.cjs` and at 390×844,
  on each view, fail when a visible, enabled control is smaller than the hit size, when
  two controls overlap, or when text is clipped without an ellipsis rule.
- A `?stress` demo fixture: a 60-character coffee name, one unbroken long word, a long
  profile name, an empty roaster.
- Land the check with an allowlist of today's failures, each with a reason. Later
  workstreams empty it.

Done when: the check runs in CI's `ui` job; the allowlist names every current failure
(including the 28 px chips, the 38 px steppers and the coffee-header overlap); no
screen looks different; `npm test`, typecheck and the existing UI checks pass.

#### Notes from WS 1

- **Tokens** (`:root` in `skin/index.html`, nothing uses them yet): type `--t-xs` 11 px,
  `--t-s` 12.5, `--t-m` 14, `--t-l` 16, `--t-xl` 20, `--t-hero` 84, written in rem like
  the rest of the sheet; spacing `--s-4`, `--s-8`, `--s-12`, `--s-16`, `--s-24`; control
  heights `--hit` 44 px and `--hit-tight` 40 px.
- **Run the check**: `node scripts/check-targets.cjs` (`--built` for the built demo,
  `--all` to print the allowlisted failures with sizes, `--shots <dir>` for a screenshot
  of every state). Its rules are in the comment at the top of the script. It checks
  Brew, Brew after a shot, Shelf, Profiles, Shots and Settings at the five tablet sizes
  and 390×844, each with the demo's coffees and with the stress fixture. It does not
  check open sheets, toasts, a running shot or operation, Add coffee, or themes.
- **Allowlist**: `scripts/check-targets.allow.json`. A key is
  `<tablet|phone> <view> <rule> <selector>` and covers every size of that device and
  both fixtures; `ws` is the workstream expected to fix it. Delete entries as you fix
  them (a stale entry fails the check) and do not add any. Entries are tagged by the
  component's workstream, so phone entries for a shared component sit with WS 2, 3, 5,
  6 or 9, not WS 8. By workstream: WS 2 15, WS 3 8, WS 5 14, WS 6 5, WS 8 1, WS 9 93.
- **Stress fixture**: add `stress` to the demo's URL
  (`skin/index.html?demo&full&stress`; the device frame passes it on). It puts three
  coffees first on the shelf: an 82-character name on a recipe with an 87-character
  profile name, a name that is one 57-letter word, and a coffee with no roaster. It
  also saves one favourite with the long names. Bags `stress-batch-1` to `-3`.
- **WS 3 and WS 6**: WS 3's "no Brew entries" cannot hold while the dose, yield and
  temperature steppers stay until WS 6. The stepper and grind-input entries are tagged
  WS 6, and the after-shot entries WS 5.
- **Found by the check, not in the defect list above**: on the tablet the shot detail's
  metrics row (time, yield, ratio, peak, flow) is squeezed to a 2 px line at all five
  sizes (WS 9). At 1005 px wide the "Pressure" readout label is wider than its cell
  (WS 2). The taste scale's "Balanced" is wider than its button at 1005 px and on the
  phone, in Brew and Shots (WS 5, WS 9). On the phone the Settings "Experience" row's
  label and buttons overlap (WS 9). The coffee arrows cover the name only for long
  names; with the demo's own first coffee they cover the rest pill. The preset chips
  are 28 px and the steppers 38 px (32 px at the two shortest sizes).
- **Not caught**: the toast over the carousel (WS 7), since toasts are waited out and
  fixed layers are not compared with the content under them. A long unbroken word also
  overflows the "Now brewing" toast on the phone.
- `scripts/screenshots.cjs` was left alone: no stress or pour states were added.

### WS 2 — Quick fixes (S)

- Coffee header as specified above (name row, then pill and arrows row).
- Stop keeps its position: move the Espresso hint into the button's sub-label.
- Chart hint into the chart header; drop legend entries that repeat readout labels.
- "AI pick" or "Rules pick" in place of the provider id. The provider name stays in
  Settings.
- Hide the steam readout unless steaming. Toasts never cover the carousel or Stop.
- Snap Brew's font sizes to the WS 1 scale.

Done when: Stop's rectangle is identical before, during and after a shot at all five
tablet sizes (asserted in `e2e-controls.cjs`); the stress fixture shows no overlap;
tablet fit passes.

### WS 3 — Brew at rest (M)

Split operation buttons with presets in the sheet (preset editing stays in Settings);
scale tile with Tare; step rail and direct labels at rest, from `E.profileCurve`;
favourite cards with photo and sparkline. Dose, yield and temperature keep steppers
until WS 6.

Done when: the allowlist has no Brew entries; `e2e-brewing.cjs --favourites-only`
passes unchanged; the screen fits from 1340×800 to 1005×552 with Stop visible.

### WS 4 — Pour mode (L)

- Pure logic first: `server/control/steps.ts`, tested in `test/control.test.ts`. From
  the profile's steps, the current frame index and the live points, return each step's
  name, state, elapsed time and limit, which exit it is tracking, the yield fraction,
  and a time-to-go estimate (null until weight flow is steady). Rebuild the bundle.
- Each live point already carries `frame` (from `profileFrame`). Step names come from
  the loaded profile's steps.
- Layout as specified. Enter from `shotRunning()`; leave when a snapshot shows the shot
  ended, then show the after-shot view.
- Skip step under decision 4, in both API objects and the simulator.
- Make the demo and `dev/mock-decaid.ts` advance `profileFrame` through named steps.

Done when: `e2e-controls.cjs` passes on source, built demo and desktop Decaid; a new
check starts a shot, asserts hero numbers, the step name and Stop's size, drops the
socket mid-shot and asserts the layout holds; no workflow write happens mid-shot;
1005×552 shows time, weight and Stop without scrolling.

### WS 5 — After the shot (M)

- Result line and pills. Check whether Decaid's shot record carries a stop reason; if
  not, infer weight, user or profile in a tested pure function, and say "stopped near
  target" when unsure.
- Chart at least 190 px at 1340×800, scaling down at the compact sizes.
- Apply button: edits `S.next` only, marks the field, and Reset undoes it. One stepper
  step per change type (grind, yield, temperature, dose); no button for a change with
  no numeric form.

Done when: `e2e-review.cjs` passes; a new case taps Apply and asserts the recipe
changed and the machine workflow did not; the feedback panel still scrolls inside its
own bounds at 1005×552.

### WS 6 — Value sheet and steppers (M)

The sheet as specified; recent values read from shot history (no new storage); closes
by Set, Cancel, scrim, swipe down and Esc, and only Set changes the recipe. Tiles
replace the three steppers on Brew. Hold-to-repeat on every remaining stepper,
including Settings. This delivers the preset strips listed under "Improvements seen in
Streamline".

Done when: a Playwright check covers drag, snap, clamping at both limits, hold-repeat,
every cancel route leaving the recipe unchanged, and temperature still shifting every
step through `withTemperature`.

### WS 7 — Feedback layer (M)

- Toast stack at the top centre on tablet, above the tab bar on phone. Undo on
  Finished, Freeze, clearing a favourite and removing a reference, using the rollback
  `attempt()` already has.
- Pending state on a button whose request runs past 300 ms; repeat taps ignored.
- Connection banner only after 1.5 s without Decaid or the machine.
- Plain-error mapper with unit tests: no status codes, paths or provider ids on screen.
- Skeleton rows for Shelf, Shots and Profiles while loading.

Done when: `e2e-live.cjs` passes with its failure and timeout cases; new cases cover
Undo, a slow write tapped twice sending one request, and a 1 s drop showing no banner.

### WS 8 — Phone (M)

As specified, with the same split buttons as the tablet.

Done when: `e2e-demo.cjs` passes at phone size on source and built demo; Stop is in the
viewport at every scroll position during a shot; the phone-via-proxy case in
`e2e-live.cjs` passes.

### WS 9 — Shelf, Profiles, Shots, Settings (M)

- Shelf: Brew this plus a More menu for the other actions; equal card heights; origin
  text clamped to two lines; filter chips for In window, Resting and Running low.
- Profiles: a step thumbnail on every candidate and library row; the AI pick shown
  once, not as both a block and a card.
- Shots: filter by coffee; a labelled Compare button in place of the bare checkbox;
  result pills on each row once WS 5 has them.
- Settings: a section index on tablet; consistent row heights.

Done when: `e2e-shot-history.cjs` passes unchanged; the target check passes on all four
views; the stress fixture shows no growth or overlap.

### WS 10 — Sleep screen and sound (S)

Clock and date on the sleep screen, and "Heating, ready in 4 min" after waking when the
Time To Ready plugin reports it. Hold to wake with a ring that fills; releasing early
does nothing. A short Web Audio chime when a shot ends and when the machine reaches
temperature. Both off by default (decision 3), stored per device.

Done when: both settings persist per device and respect reduced motion; a check covers
a hold released early leaving the machine asleep.

### WS 11 — Motion and finish (S)

One motion rule: 160 ms ease-out for panels entering and leaving; numbers never
animate; reduced motion turns it off. Update `design.md` (type scale, primary-action
rule, freeform-text rule, pour layout). Run the `refresh-demo-assets` skill. Check all
six themes on the new screens.

Done when: `verify-crema` passes; the allowlist is empty and deleted; README
screenshots match the app.

## Not verified

Anything on the real tablet; the six themes on the new layouts; whether Decaid's shot
record carries a stop reason; whether Decaid 0.9.1 has a skip-step command.
