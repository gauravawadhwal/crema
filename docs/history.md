# Crema history

Dated status updates and narratives moved out of [implementation-plan.md](implementation-plan.md) on 10 November 2026 so the plan reads as a handoff. They are kept verbatim as the record of what was agreed and done, and some are superseded: where one disagrees with the plan, the plan wins.

## Plan status as it stood before the code review (10 November 2026)

**Where things stand (10 November 2026).** Phases 1, 2 and 5 are done in software, and
phase 6 mostly. v0.2.0 is released and is the first install on the user's DE1 tablet;
v0.3.0 (No bag and manual brewing, profile graphs, removable reference) followed the
same day, then v0.4.0 (10 November 2026: AI shot review, grind stepper, stable buttons)
and v0.4.1 (shot review fixed for real shots); installing a later release on the tablet
is the first in-place upgrade.
One real brew has since been reported successful and its saved workflow/measurements
inspected read-only (see the live-verification note below). Broader tablet acceptance
is pending. Software checks use `dev/mock-decaid.ts` and desktop Decaid 0.9.1 with its
simulated machine.

**Update, later on 10 November 2026.** The user reports the tablet has been upgraded in
place through each release to v0.4.1 and is in daily use without problems, so a
supervised tablet session is no longer the next step, and agents should not ask for
tablet access unless the user offers it. A code review of the server and `skin/app.js`
the same day found problems this plan did not list. **The current order of work is in
[Code review and revised order](#code-review-and-revised-order--10-november-2026)
below; where it disagrees with "Suggested next sessions", it wins.**

Before that update, the order was:
the tablet session (phase 7, next-session item 3), then phase 3 (Streamline Settings and
the profile-editing hand-off), which needs the tablet first. Without the tablet, the
open software work is phase 4 (splitting `skin/app.js`), "why the shot stopped" and the other Streamline improvements, the voice
fix (next-session item 10). AI shot review now has its first software implementation (next-session item 11, recorded in
[shot-review-plan.md](shot-review-plan.md)). The user merges nothing by hand: agents open a PR per piece
of work and merge it once CI's `verify`, `ui` and `docker` jobs pass; tagging a release is the user's call.

This is the execution plan requested by the user after the project review. It covers
all review recommendations, including reuse of Streamline Settings. The supporting
[review record](review-2026-11-06.md) distinguishes reproductions, source findings
and untested assumptions. Read it before changing behaviour.

## Code review opening and conclusions, as first written (10 November 2026)

A review of `main` at PR #40, made by reading `server/` and all of `skin/app.js` rather
than this plan. Checked: 207 unit tests and the typecheck pass locally, and CI is green
on `main`. The Playwright checks were not run locally for this review. **Every finding
below comes from reading the code; none has been reproduced.** Reproduce each one before
fixing it, as this plan asks for all fixes.

### What the review concluded

- **The server is small and well bounded.** No file is over about 630 lines, inputs are
  validated with Zod, and every AI call has a rules fallback. Shot review keeps the
  model's answer inside what the code measured (`validateReview`).
- **`skin/app.js` is large but not messy.** It is about 204 KB in one file: 118
  top-level functions and one global state object (`S`) with about 30 fields. The
  machine-control code (start generations in `startOp`, held loads in `loadOntoMachine`,
  `reconcileWorkflow`, the socket slots in `subscribe`) is careful and well commented.
  Its size is a navigation cost more than a correctness risk.
- **The real gap is unit tests for the app's hardest logic.** The unit tests (11 files,
  about 1,400 lines) cover `server/` only. The control and reconcile logic and the bag
  arithmetic (`bagUse`) are reachable only through Playwright, because they are tied to
  the DOM and to `S`. `skin/app.js` is also outside `tsc`.
- **So phase 4 should be cut by what needs testing, not by file size.** `makeLiveApi`
  is already the cleanest part of the file; extracting it first would move code without
  making the risky logic testable.
- **Evidence still trails the software.** v0.4.0's shot review produced no usable
  review on the first 12 real shots, and that was found only by replaying them
  (v0.4.1). The user's daily use is now the hardware evidence for the main brewing
  loop; the edge cases under "Still unverified on hardware" below have not been seen.

## Revised order of work, as written in the code review (10 November 2026)

Each item is its own PR. All of it can be verified with the repository simulator and
desktop Decaid; none needs the tablet.

1. **Fix the F1 bugs**, with the global failure toast. Add a regression for each to the
   existing Playwright scripts (`e2e-live.cjs` for failed writes and the mid-shot
   reconnect, `e2e-review.cjs` for notes).
2. **Put the control logic and bag arithmetic under unit tests** (phase 4, re-scoped).
   Move the decisions out of the DOM code into functions that take state and return
   what to do: the start/stop sequencing in `startOp`, `loadNow`'s hold-or-send choice,
   `reconcileWorkflow`'s same/differs/adopt outcome with `recipeMatches`, and `bagUse`'s
   remaining-weight sum. Put them in `server/` so they reach the app through
   `skin/engine.js` and are tested by vitest. Keep the single-file skin and the built
   demo working; no framework and no new build step. Do the F4 "API reaches into the
   UI" item here.
3. **Make the shelf poll cheap and move the write out of the read path** (F2), then
   **settings and record writes** (F3). F3's key changes come last because they need a
   migration.
4. **Hide Speak inside Decaid** (next-session item 10). Small, already confirmed.
5. **Trim this plan** (F6) and fix the doc drift (F4).
6. **Server hardening** (F5).
7. **Streamline Settings entry and the parity audit** (phase 3). Build and check it
   against desktop Decaid; the user confirms on the tablet in normal use.
8. **Then, if still wanted:** put `skin/app.js` and `skin/demo.js` under
   `tsc --checkJs` with a shared JSDoc type for the API object, which turns the
   live/demo contract into a type check. Splitting the file further is optional after
   item 2.

Hold until there are more real shots with taste recorded: shot-review threshold
calibration. Hold as before: grinder entities and a numeric grind advisor, Home
Assistant sensors, order-email ingestion (see "Deferred product work").

## Shot review follow-through (10 November 2026)

The first shot-review implementation follows the repository health review: recorded
shot context, local conservative checks, optional AI, persisted reviews and explicit
unknown taste. See [shot-review-plan.md](shot-review-plan.md) for implemented scope
and verification. Review calculations and display never apply settings automatically.

The same change corrects advice source labels, profile-timing identity, and narrow
manual-control layout clipping; horizontal column checks now accompany vertical fit
checks. No broad frontend rewrite, specialist-settings integration, release tag or
NAS/tablet installation is part of this work. Remaining acceptance is the supervised
upgrade/control session and real-shot calibration, not repeating the successful
baseline brew.

## Brewing work pointers (9 November 2026)

Additional brewing work requested on 9 November 2026: see
[Bagless and manual brewing](bagless-manual-plan.md) for the installed-Decaid
review, product behavior, implementation order and acceptance checks. This is
merged (PR #30) and released in v0.3.0; tablet acceptance is pending.

AI shot review, requested 9 November 2026: see [AI shot review](shot-review-plan.md)
for how other DE1 projects do it, the design (shot checks with no AI, then a
button-triggered AI review that sees the curves), implementation order and
acceptance checks. First version merged (PR #35) and released in v0.4.0; real-shot calibration and tablet acceptance remain pending. It builds on the profile graph (PR #31).

## Current UI delivery (9 November 2026)

The user authorized all four changes together. Implemented in software:

1. Settings corrections: upstream-derived fan/sleep bounds and readback, correct
   refill-warning units, explicit device-local group-head toggle wording. Existing
   live machine temperatures/flows are read, never replaced on settings entry.
2. Favourites editing: one separate 44 × 44 px “⋯” menu beside the five slots,
   followed by full-size slot actions. Per-slot 44 px edit buttons would crowd out
   the favourite names; this layout keeps load and edit targets separate.
3. No bag brewing: persistent selection, direct installed-profile defaults,
   explicit metadata clearing, history/notes/ratings and no inventory deductions.
4. Manual flow/pressure: installed GHC profiles, controller-capability gating,
   zero-aware stopping and all-step temperature edits. Physical controller input
   and manual-profile scale stopping still need supervised hardware acceptance.

The new brewing regression is in CI and exercises source live mode plus the built
demo. NAS/tablet installation and tagging a release remain separate from this work.
Desktop Decaid was also updated to a verified copy of the current source and
completed a bagless brew with its own simulated machine/scale and weight stopping;
its original workflow was restored. Its mock reports no GHC, so manual UI gating
was checked there; real manual interaction remains pending. Details and the
installed-snapshot versus live-edit distinction are in the bagless/manual record.

## Profile graph and removable reference (9 November 2026)

User report: a reference shot, once set, could not be removed, and nothing showed
what a profile is meant to do. Streamline (checked in `decentespresso/streamline-js`)
keeps no pinned reference: between shots it shows the last shot, and its profile
picker draws each profile's graph from its steps. Implemented:

- `server/profiles/curve.ts`: a profile's steps as a plan (pressure or flow target,
  fast or smooth, time limit, exit and limiter in words) and real step timings from
  a saved shot's `profileFrame`. Steps often end early, so a plan drawn from limits
  is labelled as such.
- Profiles sheet: graph and step list for every installed profile, timed from the
  newest shot with it when there is one (`api.lastShotWith`).
- Brew chart: before a shot, the loaded profile's plan, dashed. Closing the shot
  review returns the chart to it.
- Reference shot: optional; removable from the chart legend, the shot review and
  Shots. The demo no longer starts with one.
- Simulator and demo: profiles from Crema's own step outlines per style, and shots
  run through a shared puck model that follows the steps and records them.

Released in v0.3.0 (PR #31). Unverified on the tablet: real profiles' `profileFrame` numbering is assumed to match
step indexes (shots with other numbers, such as firmware extension frames, fall back
to time limits).

## Suggested next sessions (superseded 10 November 2026)

**Superseded on 10 November 2026** by "Revised order of work" under
[Code review and revised order](#code-review-and-revised-order--10-november-2026).
The lists below are kept as the record of what was agreed and done before it.

**Recommended immediate order after the bagless/manual review (9 November 2026).**
This recommendation updates the priority of the older numbered list below; it
does not mark tablet checks complete or authorize a release.

**User-reported brewing baseline (9 November 2026):** the user completed an
existing brew on the real machine and reports that it appeared to work and the
coffee came out quite good. If reviewing history, exclude the latest shot; the
relevant brew is the one immediately before it at the time of this report. No
shot ID or independent workflow/telemetry audit was captured here. Treat this as
the practical baseline for proceeding with bagless development, not completion
of all phase 7 checks. Do not require the user to repeat this baseline brew.
The automated saved-shot regression in item 1 remains part of implementation.

**Live read-only verification (9 November 2026):** subsequently reached the NAS
Crema server and the tablet's Decaid API through its existing proxy. The tablet
reports Crema 0.2.0 installed from its release and a DE1Pro with GHC. Excluding
the latest shot as requested, the second-newest saved shot has the expected
coffee/batch association, Extractamundo Dos! profile, 21 g dose and 45 g target.
Its annotations record 43.5 g actual yield; Decaid records `targetWeight` as the
stop reason. Its 116 measurements span about 28.8 seconds. The final captured
scale sample is 42.29 g, distinct from the annotated final yield; scale-stop
projection and trailing drips were not independently audited. This verifies a
real completed shot with recorded workflow and telemetry, not every control,
inventory or reconnection case. All requests were GETs; no settings or machine
state changed. No need to repeat the baseline brew.

1. **Establish a complete bag-based shot regression, then develop bagless brewing.**
   Use the current installed-profile workflow to check load → start → stop → saved
   shot, including profile, dose, yield and bag attribution. Extend that same check
   for No bag, metadata clearing and unchanged inventory. This closes the relevant
   phase 6 verification gap as part of the feature, rather than postponing the
   feature for an unrelated cleanup project. Keep existing Stop/start and mid-shot
   profile guards. Detailed scope: [bagless/manual plan](bagless-manual-plan.md).
2. **Validate bagless brewing in desktop Decaid's simulator, then on the tablet.**
   Retest the existing phone-to-tablet shelf-refresh fix in that tablet session.
   A confirmed failure in profile loading, Stop, history or attribution takes
   priority over adding further brewing modes. Local implementation can proceed
   while the supervised tablet session is pending; daily-use/release readiness
   still needs the applicable validation.
3. **Add the two physical-controller manual modes as a separate change.** Build on
   the optional bag association from item 1; verify controller capability,
   zero-target semantics and scale-stop behavior as described in the feature plan.
4. **Resume specialist-settings access and the remaining maintenance work.**
   Streamline Settings/profile-editor hand-off (phase 3), broader frontend splitting
   (phase 4), stop reasons, step previews and refreshed demo media need not precede
   bagless brewing. Extract only small boundaries needed by the feature. The
   already-confirmed Speak-button issue is a small independent fix and can ship
   separately without holding up bagless work.

The feature extends phase 2 (profiles, bags and shot correctness), uses phase 1's
existing control safeguards, and carries phase 6/7 verification. Its new work is
planned even though the original phase 2 scope is marked done in software.

Each is a self-contained piece of work that ends in its own PR. Order agreed with the
user on 8 November 2026: get the UI checks into CI and a way back to Decaid in place,
then tag a release and take a first, short look on the tablet before the rest of
phase 1, so real-hardware findings can reshape phases 1–3.

1. ~~**Reproducible UI checks**~~ (phase 0, finding 7; phase 6). *Done: Playwright
   declared, the UI checks run in CI, tablet fit fails on overflow.*
2. ~~**Dashboard exit**~~ (finding 1, phase 3). *Done in Settings; still to confirm
   on the tablet (item 3). PR #9 was merged into #8's branch after #8 had landed, so it
   reached `main` in a follow-up PR.*
3. ~~**Tag `v0.1.0` as a normal GitHub release**~~ *Done 9 November 2026 (release
   workflow passed, `crema-skin.zip` checked); v0.1.1 fixed comparison bugs 1–3, and
   v0.2.0 (9 November 2026: phase 2 done in software, Docker in CI) is the first
   install, so the tablet session covers phases 1 and 2. v0.3.0 (9 November 2026) and
   v0.4.0 and v0.4.1 (10 November 2026) followed; upgrading the tablet to the latest tests phase 7's
   "upgrade without losing records".* From `main`. The release workflow runs CI
   and checks the ZIP first. Not a pre-release: Decaid's GitHub Release install asks for
   `releases/latest` unless `includePrerelease` is set (`lib/src/util/github_archive.dart`
   on Decaid's `main`, read 8 November 2026), and GitHub's latest skips pre-releases, so
   the tablet would find nothing. The `0.x` version and the release notes say it's early. Then a short first look on the tablet: install through
   Decaid's GitHub Release route, record the Decaid and WebView versions, the install
   path labels (finding 5), whether the key-value store and shot-settings stream behave
   as on desktop, the dashboard exit, and the tablet fit. Not yet for daily brewing.
4. **Rest of phase 1**, reworked after checking Decaid and Streamline (see phase 1,
   "What to reuse"). *Done on 8–9 November 2026: profile writes held during a shot
   (#12), link state from `/ws/v1/devices` (#13), steam/hot water/flush through the
   workflow (#14), workflow reconciliation (#16), time limits (#17), sockets (#18),
   then overlapping loads and busy/error states. Phase 1's software
   work is complete; the tablet session (item 8) has to confirm it on real
   hardware.*
5. ~~**Image-fetch security**~~ (phase 5). *Done in PR #10.*
6. **Rest of phase 2**: installed Decaid profiles as the library, shot pagination and
   pinned references by ID, then per-batch bag state with a migration.
7. **Streamline Settings entry and the parity audit** (phase 3), after items 2 and 4.
8. **Supervised tablet session** (phase 7), once 2–4 are in.
9. ~~**Comparison bugs 1–3**~~ (see "Findings from the skin comparison"). *Fixed for
   v0.1.1.*

10. **Voice input inside Decaid** (see "Findings: voice input inside Decaid"). Hide Speak
   from the start in Decaid's WebView and point to the keyboard's microphone. Small; for
   0.3.0. Optionally, HTTPS for the Crema server so a phone gets Speak, and a feature
   request to Decaid for an opt-in microphone (the user posts it).
11. **AI shot review** ([shot-review-plan.md](shot-review-plan.md)). Requested by the
   user on 9 November 2026. One "Review shot" button replaces "Next adjustment": shot
   checks in `server/profiles/analysis.ts` (no AI, the fallback), then `/api/review`
   with the curves, findings and taste. Saved on the shot in Decaid. No score and no
   follow-up chat yet. Released in v0.4.0 (PR #35). The first 12 real shots, replayed
   on 10 November 2026, showed it never produced a usable review in v0.4.0: Decaid's
   `-1` "no target" and cup bumps made the server reject 8 of them, the rules
   fallback took over silently, and the rest graded no step (each main pour had a
   flow limiter) so the model's answer was replaced. Fixed in v0.4.1 (PR #38); see "Real
   shots" in [shot-review-plan.md](shot-review-plan.md). Thresholds still need
   calibration on more shots, especially with taste recorded.

Items 2 and 4 both edit `skin/app.js`, so run them one after the other.

Small follow-up: the README screenshots and walkthrough still show the old boxed
rating buttons (`refresh-demo-assets` skill; no AI reseeding needed).

## UI revision reported 9 November 2026

Settings correctness takes priority over the planned bagless feature. See the
[settings review](settings-review.md) for upstream defaults, steam recommendations,
fan-threshold behavior and local fixes for numeric bounds, refill-warning units
and the misleading group-head-toggle label. No live machine defaults were reset;
NAS/tablet deployment is pending.

- [x] **Make the favourites edit button easier to tap.** The user reports that
  the “⋯” button next to each favourite is too small. Current `.fav-edit` is only
  24 × 22 px. Enlarge its tap target to at least 44 × 44 px without overlapping
  the favourite's load action, keep the edit affordance obvious, and verify it
  on the tablet and phone plus the tight tablet-fit sizes. Implemented as a separate
  full-size menu beside the five load buttons, with a slot chooser; not an overlay
  covering each favourite's load target.

## First tablet feedback (9 November 2026)

The user added a second bag from a phone. The already-open tablet did not show it
until leaving and reopening the skin. Confirmed in source: no background shelf
refresh existed. A reported “Brew this” failure remains unconfirmed: the user later
found the bag with the Brew screen's arrow, and a recipe lookup may have been pending.
Keep selection and machine loading behaviour unchanged until reproduced.

Fix in this checkout: refresh visible live clients' shelves every five seconds and
on focus/resume. Preserve the selected bag and unsaved recipe values, retain the
last shelf on failures, and avoid overlapping background reads. The live browser
regression keeps two clients open before adding a bag, checks the automatic update,
and clicks “Brew this” on both phone and tablet. Real tablet upgrade/retest pending;
this feedback does not complete phase 7.

Local verification: typecheck and all 167 unit tests passed; app/demo/engine syntax,
source and built demo click-throughs at phone/tablet sizes, live simulator checks,
and skin ZIP validation passed. The new two-client regression covers automatic bag
arrival, preserved unsaved recipe edits, retained inventory on read failure, and
both “Brew this” buttons. The built demo was regenerated and screenshots reviewed.
No CSS/layout, upstream API, engine or Docker changes; no real-machine commands or
live data migration. Real Decaid/tablet validation and release installation pending.
