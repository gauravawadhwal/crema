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

## Handoff log

**11 November 2026 — pour chart axis decided:** Mono's rule. 40 s, widening 10 s at a
time one second before the edge. See "WS 4.5". This replaces the earlier wording
that started the axis at the expected shot length.

**11 November 2026 — review of merged `main` (`566b26c`), WS 4.5 defined**

Looked at the merged app in the demo at 1340×800, 1005×552 and 390×844. WS 1, 2, 3, 4,
6 and 9 match the specification at tablet size (Settings, Profiles, the value sheet and
the sleep screen were not looked at). Stop now sits in the screen's bottom-right corner
at rest, not at the bottom of the control column; the user is fine with that. Defects:

- **Phone, pouring: Stop is below the fold** (390×844: Stop at y≈996 on a 1184 px page;
  at rest it is on screen). Assigned to WS 8, which must treat it as its first item.
- **Pour chart axis runs to 80 s** for a 32 s shot. Assigned to WS 4.5, with the small
  Brew defects listed there.
- Next, in order: **WS 4.5**, then WS 5, WS 8, WS 7 (its WIP branch is now behind
  `main`), WS 11.
- `ui/ws4.5-pour-polish` holds one WIP commit from an attempt the user stopped. It is
  a reference only. It has the last-shot timing for steps ahead, "not reached", the
  peak label, the duplicate-preset fix and the control-column fill, none verified. Its
  axis change does **not** work: the early time-to-go estimate is large and noisy, and
  feeding it into an axis that only grows pushed the axis back to 80 s. The built demo
  on that branch is stale.

**11 November 2026 — reviewed UI consolidation, PR #61**

- Consolidates PRs #54–#60 and the completed WS 9 commit in PR #62 with WS 4.
  Merge commits retain each workstream's history. WS 9's old remote WIP is preserved;
  its completed local commit is published as `codex/ws9-other-screens`.
- Review fixed WS 4's Stop position: the enlarged button now contains the entire
  resting hit area at all five tablet sizes. All tablets now use the existing
  compact layout's bottom-right anchor; Favourites spans the two left columns.
  Pour Stop remains 300×96 without an oversized empty footer.
- Shot recipe/profile snapshots are copied and remain independent of next-shot edits.
  Missing metadata and frames stay unknown; Skip requires a known non-final step,
  a live link, a non-manual profile and no pending Skip request. Socket loss keeps Stop.
- Demo and mock records now use Decaid's recorded stop reasons. The favourites
  regression asserts controls are hidden while pouring and separately exercises a
  queued favourite load. This fixes the failed brewing check in the original PR #61.
- WS 9 review fixed self-comparison after changing coffee filters and stale chart
  callbacks after the filtered list is replaced. Shared chart changes preserve both
  pour overlays and profile thumbnails; Settings retains WS 6 hold/save behavior.
- Focused checks passed: control races and Stop coverage, captured pour context
  (source and built), WS 9 screens/filter transitions, WS 6 values, and typecheck.
  The final Stop geometry check passed at all five tablet sizes without scrolling
  or page errors. See PR #61 for the consolidation's CI results.
- Remaining: WS 5 after-shot layout, WS 8 phone and WS 11 finish. WS 7 has a stopped
  WIP branch and is not included. No physical tablet/DE1 or NAS validation or release.

**10 November 2026 — WS 6 completed on `ui/ws6-value-sheet`**

- Dose, Yield and Temp tiles open one draft sheet with tabs, a snapping pointer/keyboard
  ruler, recent shot values and manual/weight stop choices. Set applies all edited
  tabs locally; Cancel, scrim, Escape and handle swipe discard them. Temperature
  continues through the existing `withTemperature` load path.
- Shared hold-to-repeat handles grind, Settings and sheet buttons. Settings saves are
  coalesced after the hold, through the existing handlers. All five WS 6 allowlist
  entries are removed (116 unrelated entries remain on this WS 2-based branch).
- Passed: syntax, focused `e2e-values.cjs` (including one Settings write per hold and
  no machine write on Set), tablet fit at all five sizes, and touch-target check.
  Inspected temporary screenshots at 1340×800, 1005×552 and 390×844, including stress
  names and compact manual-yield sheet. The focused test and screenshots run in CI.
- Per the user's latest instruction, broad unit/typecheck/live/brewing/control suites
  and built-demo variants are left to CI; no CI wait, tablet or NAS testing.
- Updated control, brewing and live scripts for the tile/sheet route. Rebuilt the
  demo. WS 3 is a separate sibling branch; combine after it and rebuild the demo
  when resolving generated-file conflicts. WS 9 remains owned by the other agent.

**10 November 2026 — WS 4, `ui/ws4-pour-mode`**

- Full Brew takeover while `shotRunning()` is true: dimmed non-Brew rail tabs, "Pouring"
  status (and "No link, still pouring" across a mid-shot socket drop), top band with
  profile/recipe summary, `Step X of Y`, and live step rail (`E.stepProgress`) showing
  actual elapsed times, current step tracking progress and remaining plan.
- Left pour card with 84 px mono time and weight hero numbers, 10 px yield progress bar
  with percentage and steady-flow ETA, and bottom pressure/flow/temperature readouts.
- Wide live chart card with step boundaries, shaded current step, dashed plan ahead of
  the "now" line, and direct end-of-line value labels.
- Bottom bar with stop-condition copy, `Skip step` (150×96, wired in `makeLiveApi`,
  `makeDemoApi`, `shotSim.skip()` and `dev/mock-decaid.ts` via `PUT /machine/state/skipStep`),
  and a 300×96 red `STOP` covering the at-rest Stop corner. At 1005×552, secondary
  readouts and note drop so time, weight and Stop fit without scrolling.
- Focused verification: `build:engine`, `build-demo`, syntax checks and `e2e-controls.cjs`
  (including the new pour-mode, skip-step, mid-shot socket drop and 1005×552 assertions)
  passed. Full suite left to CI per user instruction.

**10 November 2026 — WS 3, `ui/ws3-brew-at-rest`**

- Split operation buttons open preset sheets; selecting writes the same workflow
  settings without starting. Scale tile owns Tare; status and chart weights are passive.
  Stop is pinned at the bottom, and preserves its rectangle across shot states.
- Added the pre-shot rail and direct chart labels, hidden idle readings, coffee art
  and installed-profile pressure sparklines on favourite cards. No storage changes.
- Removed all eight WS 3 target exceptions; 113 entries remain for other workstreams.
- Focused verification: syntax, tablet fit (all five sizes, before/after/review),
  touch targets (normal/stress), control races, demo click-through, and unchanged
  favourites-only checks (live/built) passed. Reviewed normal/stress screenshots at
  1340×800, 1005×552 and 390×844 plus Nordic and the preset sheet.
- No full unit suite, live suite, hardware checks or CI wait, per the user's lighter
  verification instruction. Long-profile stress at 1005×552 still clips the existing
  next-shot card; WS 6 owns its profile clamp/fields. WS 4 can reuse the rail below.

**To continue in any tool:** give the agent [ui-plan-briefs.md](ui-plan-briefs.md):
its "Common instructions" plus the section for one workstream. Those are the full
briefs, including the two part-done branches.

Newest first. Read this, then the status table, then the open PRs. Each workstream
works in its own branch and updates its own row of the status table in its own PR, so
until those merge, this log is the one place that lists everything in flight.

**10 November 2026, night — all agents stopped by the user to save credits**

Nothing is running. State to resume from:

- Open, complete, unmerged: #54 (plan), #55 (WS 4a logic), #56 (WS 1), #57 (WS 10),
  #58 (WS 2).
- `ui/ws7-feedback-layer` (WS 7): one **WIP commit**, pushed, no PR. About 500 lines
  across 7 files. Stopped part-way: not verified and may not run. Whoever continues
  should read the diff against `ui/ws1-guard-rails`, compare it with the WS 7 scope,
  finish, run the fast checks and open the PR.
- `ui/ws9-other-screens` (WS 9): one **WIP commit**, pushed, no PR. About 500 lines
  across 9 files; the agent was on its docs and CI edits when stopped, so the code may
  be close to done, but nothing was verified. Same procedure.
- WS 3 and WS 6: stopped before any change. Branches `ui/ws3-brew-at-rest` and
  `ui/ws6-value-sheet` are pushed but identical to `ui/ws2-quick-fixes`. Start them
  from the workstream sections here.
- Not started: WS 4 layout, WS 5, WS 8, WS 11.
- The user wants credits conserved: one or two agents at a time, cheaper models for
  WS 7, 8, 9 and 11, and light verification.

**10 November 2026, night**

- PR #56 `ui/ws1-guard-rails` (WS 1): reviewed, CI passing. `check-targets.cjs`
  passes with 136 allowlisted failures; 60 are in Settings (controls at 34–36 px).
  It also found the Shots detail metrics row squeezed to a 2 px line at every tablet
  size on `main`, and the Settings "Experience" row overlapping itself on the phone.
  Both were added to WS 9's brief.
- PR #57 `ui/ws10-sleep-sound` (WS 10): open. Hold to wake, chime, date on the sleep
  screen, with `scripts/e2e-sleep.cjs`. Diff not reviewed in detail.
- PR #58 `ui/ws2-quick-fixes` (WS 2): open, stacked on #56. Looked at Brew at rest at
  1340×800: header rows, hint in the chart header, "AI pick", fixed Stop all present.
  Stop's rectangle is asserted in `e2e-controls.cjs` section 12. Allowlist is at 121.
- Running, branched from `ui/ws2-quick-fixes`: WS 3 `ui/ws3-brew-at-rest` (control
  column, step rail at rest, favourite cards) and WS 6 `ui/ws6-value-sheet` (tiles
  and sheet in `#nextShot`, hold-to-repeat). Running, branched from
  `ui/ws1-guard-rails`: WS 7 `ui/ws7-feedback-layer` and WS 9 `ui/ws9-other-screens`.
  Skeleton loading rows moved from WS 7 to WS 9; toast position moved from WS 2 to WS 7.
- Next: the layout half of WS 4, cut from `ui/ws3-brew-at-rest` with
  `ui/ws4a-pour-logic` merged in; then WS 5 and WS 8; then WS 11.
- Expect merge conflicts between these branches in `skin/app.js`, `skin/index.html`,
  `demo/crema-demo.html` (always resolve by rebuilding it), `skin/engine.js` (rebuild
  with `npm run build:engine`), `scripts/check-targets.allow.json` and the status
  table here. Suggested merge order: #54, #56, #55, #58, #57, then WS 7, 9, 3, 6.
- Verification is deliberately light (user, 10 November): fast checks plus the e2e
  scripts that cover the change; agents do not wait for CI.

**10 November 2026, late evening**

- PR #54 `docs/ui-plan`: this plan. Open, CI passing. Every branch below is cut from
  it, with its PR against `main`.
- PR #55 `ui/ws4a-pour-logic`: step progress, yield, time-to-go and stop reason as
  tested pure functions (`E.stepProgress`, `E.steadyWeightFlow`, `E.stepTimes`,
  `E.stopReason`). Open, CI passing. Nothing in the app calls them yet. It also
  records two findings: Decaid 0.9.1 has skip-step (`PUT
  /api/v1/machine/state/skipStep`, read at source, never sent), so the button is to
  be built under decision 4; and Decaid's shot record carries `stopReason`.
- PR #56 `ui/ws1-guard-rails`: tokens, `scripts/check-targets.cjs` with its
  allowlist, the `?stress` demo fixture. Open; being reviewed.
- Branch `ui/ws10-sleep-sound`: hold to wake, chime, date on the sleep screen. One
  commit; the agent had not opened a PR or reported when this was written.
- Not started: WS 2, 3, 5, 6, 7, 8, 9, 11 and the layout half of WS 4. Next to start:
  WS 2 and WS 9, each branched from `ui/ws1-guard-rails`.
- Lesson for every later PR: CI's `verify` job fails when `demo/crema-demo.html` is
  stale. After any change under `skin/` (including a rebuilt `skin/engine.js`), run
  `node scripts/build-demo.mjs` and commit the result.
- Model choice: the user asked for cheaper agents where the work is well specified
  (WS 2, 7, 8, 9, 10, 11) and the strongest model for WS 3 to 6.
- Out of scope, confirmed by the user: manual flow and pressure control stay as they
  are. No on-screen dial.

To continue from another tool: check out the branch named for the workstream (or cut
a new one from the latest merged or open predecessor), read that workstream's section
and "Rules for every workstream", do the work, run the checks, open a PR against
`main`, and add an entry at the top of this log.

## Status

| WS | Work | Size | Depends on | Status / evidence |
|---|---|---|---|---|
| 1 | Guard rails: tokens, target check, stress fixture | S | none | Included via PR #56 in consolidation #61; guard rails and stress fixture. |
| 2 | Quick fixes for measured defects | S | 1 | Included via PR #58 in consolidation #61; Brew quick fixes. |
| 3 | Brew at rest | M | 2 | Included via PR #59 in consolidation #61; Brew controls, idle plan and favourites. |
| 4 | Pour mode | L | 3 | Implemented and reviewed in #61 with WS 4a (#55); Stop containment, captured shot context, guarded Skip and socket-loss checks pass. |
| 4.5 | Pour chart axis and Brew polish | S | 4 | **Next.** Not started. A stopped WIP exists on `ui/ws4.5-pour-polish` (reference only, known flaw; see the log) |
| 5 | After the shot | M | 4 | WS 4a stop-reason logic integrated; layout on hold |
| 6 | Value sheet and steppers | M | 3 | Included via PR #60 in consolidation #61; value sheets and hold controls; focused integration checks pass. |
| 7 | Feedback layer | M | 2 | Stopped WIP branch; not included in consolidation. Resume against consolidated main. |
| 8 | Phone | M | 4 | Not started. Now also owns a regression: on the phone Stop is below the fold while pouring |
| 9 | Shelf, Profiles, Shots, Settings | M | 2 | Completed commit 4a4123c published in PR #62 and included in #61; Shelf, Profiles, Shots and Settings. Filter regressions fixed during review. Result pills wait for WS 5. |
| 10 | Sleep screen and sound | S | 2 | Included via PR #57 in consolidation #61; opt-in hold-to-wake and chime. Real tablet touch/audio unverified. |
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

   **Finding (10 November 2026, read at source for Decaid v0.9.1; not run):** the
   command exists. The request is `PUT /api/v1/machine/state/skipStep` with no body,
   the same route Crema uses for `idle` and `espresso`. `skipStep` is a value of
   `MachineState` in the
   [REST spec](https://github.com/decentespresso/decaid/blob/v0.9.1/assets/api/rest_v1.yml)
   (path `/api/v1/machine/state/{newState}`), the
   [handler](https://github.com/decentespresso/decaid/blob/v0.9.1/lib/src/services/webserver/de1handler.dart)
   (`_requestStateHandler`) passes any `MachineState` name to the machine and answers
   200, and
   [`de1.models.dart`](https://github.com/decentespresso/decaid/blob/v0.9.1/lib/src/models/device/impl/de1/de1.models.dart)
   maps it to the DE1's skip-to-next state request (`0x0E`). Decaid's simulated
   machine advances one step and stays in `espresso`
   ([`mock_de1.dart`](https://github.com/decentespresso/decaid/blob/v0.9.1/lib/src/models/device/impl/mock_de1/mock_de1.dart));
   on the last step it does nothing. Streamline v0.2.24 sends the same request
   (`setMachineState('skipStep')` in
   [`ui.js`](https://github.com/decentespresso/streamline-js/blob/v0.2.24/src/modules/ui.js),
   a `PUT` in
   [`api.js`](https://github.com/decentespresso/streamline-js/blob/v0.2.24/src/modules/api.js)).
   The value is in the spec at the earliest tag, v0.1.0, so it was not added recently.
   Not established: the handler's behaviour on a real DE1, whether a real machine
   ever reports `skipStep` as its state for a moment (the spec lists it as a state,
   and `shotRunning()` treats only `espresso` as a shot), and what a skip does
   outside espresso. The layout agent should check those on desktop Decaid before
   building the button.
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

Shared rail from WS 3: `stepsRailHtml(descriptors)` returns escaped HTML for
`{ name, detail, weight, state?, progress? }` entries. Put it in `.steps-rail`;
children use `.step`, `.now`, `.done`. `weight` controls proportional width with a
minimum share; `progress` is a clamped 0–1 native progress bar. WS 4 can supply its
own step state/detail while retaining this markup and styles.


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

**Logic done (WS 4a), not yet called by the app.** `server/control/steps.ts`, tested in
`test/steps.test.ts`. Call it on each frame of a shot:

```js
E.stepProgress({ steps, points: S.live, targetYieldG, weightFlow, hasScale, manual })
// steps: the loaded profile's steps as Decaid stores them; points: { t, w, p, f, frame }
// weightFlow, hasScale and manual are optional. Pass hasScale: false with no scale,
// because S.live records a missing weight as 0.
→ {
  steps: [{ index, name, state: "done" | "now" | "ahead",
            elapsedS,   // seconds spent; 0 for a step that was jumped over; null when ahead
            limitS,     // the step's time limit, or null
            target: { kind: "pressure" | "flow", value, smooth } | null,   // null when manual
            tempC,
            tracking: { kind, progress, value, goal } | null }],   // on the "now" step only
  index,          // current step, 0-based, or null (no steps, or no usable frame yet)
  count,
  yieldFraction,  // 0..1, null with no target or no scale
  etaS            // 0..120 s, null until weight flow is steady
}
```

`tracking.kind` is `time`, `weight` (the step's own weight exit), `volume`,
`pressureOver`, `pressureUnder`, `flowOver`, `flowUnder` or `yield` (the shot's target);
it is the exit with the most progress, with `value` and `goal` in that exit's unit.
Volume is summed from flow readings, so it is an estimate. The step only moves forward:
a frame that is null, lower than one already seen, or beyond the profile is ignored.
`etaS` needs 2 g in the cup and about 2 s of samples whose two halves both rise faster
than 0.3 g/s and agree within 35%, and the scale's own flow (if passed) within 50% of
that. `E.stepTimes(points, count)` and `E.steadyWeightFlow(points, weightFlow)` are the
parts, exported for reuse. All values are data; the layout formats them.

Done when: `e2e-controls.cjs` passes on source, built demo and desktop Decaid; a new
check starts a shot, asserts hero numbers, the step name and Stop's size, drops the
socket mid-shot and asserts the layout holds; no workflow write happens mid-shot;
1005×552 shows time, weight and Stop without scrolling.

### WS 4.5 — Pour chart axis and Brew polish (S)

Found reviewing merged `main` on 11 November 2026. Small, all in `skin/app.js` and
`skin/index.html`. Do this before WS 5.

**1. Pour chart time axis is dynamic (decided 11 November).** Today the axis is sized
to the plan with every step still ahead drawn at its time *limit*, so Londonium's
trailing 30 s "Flow limit" step stretches the axis to 80 s and a 32 s shot uses the
left quarter of the chart. How the reference skins do it: Streamline v0.2.24 keeps the
live trace at a fixed fraction of the width and rescales the axis continuously
(`liveXRange` in its `src/modules/chart.js`: range `[0, time / LIVE_X_DATA_FRACTION]`),
so drawn lines keep sliding left; Mono starts at 40 s and widens 10 s at a time, a
second before the edge, so lines hold still between steps. **Crema does it Mono's way** (user's choice,
11 November 2026):

- The axis shows the first 40 s.
- A longer shot widens it by 10 s at a time, one second before the trace reaches the
  edge, so the "now" line never leaves the chart and drawn lines hold still between
  widenings. It never shrinks within a shot; reset it to 40 s when a new shot starts.
- Seconds are labelled every 10 s.
- Nothing else sizes the axis: not the plan's length, not the reference shot, not the
  time-to-go estimate (`etaS` is large and unstable early in a shot, which is what
  broke the stopped attempt).
- Plan and reference-shot lines beyond the right edge are clipped, not squeezed in.
  Cap the axis at 120 s.
- Steps still ahead are drawn, on the chart and in the rail, at the last shot's
  duration when known, not at their limit. The pour rail currently says "Decline 30 s"
  where the rest rail says 14.9 s; both should agree. Say "up to 30 s" when only the
  limit is known.

**2. Small defects.**
- Flush's button reads "5 s · 5 s": when a preset's name is just its value, show it once.
- At rest, a step the last shot never reached shows "0 s · 2…" clipped in the rail:
  show "not reached", and give rail segments enough minimum width for their detail.
- The plan label says "pressure 3 bar" on the soak: label the peak ("pressure 9 bar").
- At rest there is a gap of about 270 px between the scale tile and Stop at 1340×800:
  let the tiles share the spare height (with a maximum), without moving Stop.
- "about N s to go" was not seen during the review at 16 s into a shot; check when it
  appears and that it does.

Done when: at 1340×800 and 1005×552 the axis reads 40 s for a demo shot that ends
under 39 s, and 50 s once a shot passes 39 s; the axis value never decreases during a shot (assert in
`e2e-controls.cjs` or the pour check); the rest and pour rails agree on step
durations; Stop's rectangle checks in `e2e-controls.cjs` section 12 still pass; tablet
fit and the target check pass.

### WS 5 — After the shot (M)

- Result line and pills. Check whether Decaid's shot record carries a stop reason; if
  not, infer weight, user or profile in a tested pure function, and say "stopped near
  target" when unsure.
- Chart at least 190 px at 1340×800, scaling down at the compact sizes.
- Apply button: edits `S.next` only, marks the field, and Reset undoes it. One stepper
  step per change type (grind, yield, temperature, dose); no button for a change with
  no numeric form.

**Stop reason: found and logic done (WS 4a), not yet called by the app.** Decaid 0.9.1's
shot record does carry one: `stopReason` on `ShotRecord` in the
[REST spec](https://github.com/decentespresso/decaid/blob/v0.9.1/assets/api/rest_v1.yml),
an open set with known values `targetWeight`, `targetVolume`, `apiStop`, `appStop`,
`machineEnded` and `error`, and null for older shots and shots Decaid did not sequence.
`history.md` notes a real shot from the tablet recorded `targetWeight`. The app already
reads it into the review input (`s.stopReason ?? s.annotations?.stopReason`). The
simulator and demo do not set it. `server/control/stop.ts`, tested in
`test/steps.test.ts`:

```js
E.stopReason({ recorded, stoppedByCrema, finalWeightG, targetYieldG, stopAtWeight, steps, points })
→ { reason: "weight" | "volume" | "user" | "profile" | "machine" | "error" | "unknown",
    source: "recorded" | "inferred",
    nearTarget }   // final weight within 3 g of the target; null when either is missing
```

A known recorded value wins (`apiStop` and `appStop` are both `user`). `machineEnded`
is `machine`, since it covers the group-head control, the profile ending and firmware
stop-at-weight, and becomes `profile` only when the samples show the last step ran to
its time limit away from the target. With no record: a Stop from Crema is `user`; near
the target with stop-at-weight on is `weight`; the last step running out is `profile`;
near the target as the last step ran out, or anything else, is `unknown`. Show "stopped
near target" for `unknown` with `nearTarget` true.

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

**First item, a regression since pour mode merged:** at 390×844 Stop is below the fold
while pouring (y≈996 on a 1184 px page), so stopping a shot needs a scroll. Fix this
before anything else here; the sticky action bar below is the intended fix.

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

Anything on the real tablet; the six themes on the new layouts; a skip-step request
actually run against Decaid or a machine (the command was read at source only, see
decision 4); `stepProgress` and `stopReason` against real shot records.
