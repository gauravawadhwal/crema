# Bagless and manual brewing: review and implementation plan

Reviewed 9 November 2026. **Implemented in software on `codex/brewing-modes`;
not released to the NAS/tablet.** Requested outcome: brew
directly from installed profiles without registering a bag, and offer manual
flow/pressure brewing using the capabilities Decaid and Streamline already have.

## Implementation record

- No bag selection and its next recipe persist per device, including across
  reload, shelf refresh and failed shelf reads. Installed-profile detail sheets
  offer direct bagless brewing with the profile's own temperature/weight target.
- Nullable coffee/grind context fields are explicitly cleared; zero stopping
  targets are preserved. Profile identity includes the step structure, notes,
  limits and relative temperature curve, distinguishing same-title records.
- New favourites retain profile ids and explicit bagless/manual state. Older
  slots retain their selection behavior. Editing uses a separate 44 × 44 px menu
  button beside the five load buttons, then a full-size slot chooser.
- Manual flow/pressure select the installed GHC profiles and require a reported
  controller. They support a zero target (manual stop) or an explicit weight
  target and shift all step temperatures together. No tablet paddle is added.
- Shot attribution follows the recorded shot, with a shot-start fallback. Ratings
  and notes work without a bag; bag-specific advice/reference actions are hidden.
  All profile loads retain the shared queue and mid-shot gate; a preparation
  changed while loading is not marked loaded or started as if it still matched.
- `scripts/e2e-brewing.cjs`, also run by CI, covers these paths against the local
  simulator and the built demo, including empty shelf, duplicate titles, stale
  metadata clearing, inventory, changing the next bag mid-shot, favourites, missing
  profiles/controller, temperature shifting and the compact tablet/phone layout.

The remaining sections retain the original design and acceptance rationale.
Physical GHC behavior, manual-profile scale stopping and installation on the real
tablet remain supervised acceptance work, not claims made by the demo.

Desktop Decaid 0.9.1 verification: the development ZIP was installed through its
local install API and selected as the active skin. The served app/demo/engine/data
scripts and raw HTML asset were checked byte-for-byte against this checkout.
The initial direct-folder setting reported a path but did not serve readable
files, so this is a verified installed snapshot, not a claimed working live-edit
folder. Reinstall the ZIP after later source changes when repeating this check.
The native window showed the new coffee selector and favourites menu.

With only `MockDe1` and `MockScale` connected, the actual Decaid API accepted
explicitly cleared coffee fields (omitted on serialization), recorded a full
bagless simulated brew, and reported `targetWeight` stopping. A very short
4 g test ended before producing a saved shot; the full 36 g case passed. The
original simulator workflow was restored. That simulator reports `GHC: false`,
and the UI correctly blocks manual selection; it cannot establish physical
controller behavior. No commands were sent to the NAS/tablet or physical machine.

## Evidence and limits

Read-only inspection of the locally installed software established:

| Component | Evidence |
|---|---|
| Decaid | App bundle version 0.9.1, build 3027 |
| Streamline bundled with that app | 0.2.19, from its ZIP manifest |
| Streamline separately installed in Decaid's data directory | 0.2.23, from its manifest; its controls and API source were also inspected |
| Runtime | Local API on port 8080 did not answer during this review. No app was launched, settings changed, workflow written or operation started |

Follow-up on 9 November: the live tablet API was reached through the existing NAS
Crema proxy (the Mac's localhost API is separate). It reports Crema 0.2.0 and a
DE1Pro with GHC. A read-only inspection of the second-newest saved shot confirmed
its workflow, bag association, measurements and target-weight stop; the latest
shot was excluded at the user's request. See the live-verification note in
[the main plan](implementation-plan.md). This does not establish physical manual
control or scale-stop behavior for manual profiles.

Sources in the app bundle: `Contents/Info.plist` and
`Contents/Frameworks/App.framework/Versions/A/Resources/flutter_assets/assets/`:
`api/rest_v1.yml`, `defaultProfiles/manual_flow.json`,
`defaultProfiles/manual_pressure.json`, and
`bundled_skins/streamline_project.zip`. The separately installed skin was inspected
under Decaid's macOS container, `web-ui/streamline.js/`, especially
`src/modules/{api,app,ui,profile_selector}.js`. These are files shipped/installed on
the computer, not proof of the tablet's version or real-machine behavior.

The installed manual profiles are `GHC/manual flow control` and
`GHC/manual pressure control`, both `beverage_type: manual`. Their notes instruct
the user to hold a finger on the physical group-head controller (GHC) for the
desired flow or pressure. They start at zero targets, 88 °C, with 120 seconds of
profile steps and zero weight/volume targets. Flow mode has a 9-bar limiter;
pressure mode has no flow limiter in the bundled file. Preserve their actual step
definitions and limits rather than inventing equivalents.

Streamline's profile selector supports hidden profiles and does not use Crema's
espresso-only library filter. Its on-screen GHC column provides Coffee, Water,
Steam, Flush and Stop; it is shown for machines reporting `GHC === false`.
It is not a virtual pressure/flow paddle. Streamline also provides skip-step.
No live espresso flow/pressure setter was found in its API/UI source or the
installed Decaid REST specification. This is a finding about inspected interfaces,
not proof that no lower-level implementation could ever support it.

Upstream references: [manual flow](https://github.com/decentespresso/decaid/blob/main/assets/defaultProfiles/manual_flow.json),
[manual pressure](https://github.com/decentespresso/decaid/blob/main/assets/defaultProfiles/manual_pressure.json),
[Decaid API](https://github.com/decentespresso/decaid/blob/main/assets/api/rest_v1.yml),
[Streamline controls](https://github.com/decentespresso/streamline-js/blob/main/src/modules/ui.js).
Local installed files above are the version-specific evidence for this review.

## Product behavior

Keep the existing bag workflow. Add an explicit **No bag** choice in the coffee
selector and **Brew without a bag** on installed-profile details and the empty-shelf
screen. In bagless mode the panel says No bag and shows the selected profile,
dose, yield/stop setting, temperature and optional grind note. No identification
or recommendation is required. Profile choice uses the installed profile's own
steps and temperature; do not silently substitute the guide's recipe. Use the
user's basket dose where the profile has no dose. Preserve a zero weight target as
off; do not replace it with a 1:2 recipe. Missing values and zero are distinct.

Manual brewing is independent of coffee tracking: choose **Manual flow** or
**Manual pressure**, with either a selected bag or No bag. Explain on the panel:
**Adjust flow/pressure on the group-head controller**. Display measured values and
targets on the existing chart. Offer temperature and an explicit **Stop manually /
Stop at weight** choice. Manual stopping still respects profile time limits; it
does not mean unlimited runtime. Scale-based stopping with manual profiles must
be confirmed in real Decaid before describing it as supported.

Use Decaid's reported GHC capability, not Crema's user preference to hide start
buttons, to establish controller availability. Unknown capability gets a clear
unavailable/check-connection state; a machine reporting no GHC must not be offered
a working manual paddle mode. Missing or hidden manual profiles get an explicit
message and instructions to show/restore them in Decaid/Streamline; no automatic
installation, unhide or creation. Keep cleaning/calibration profiles excluded.

Bagless shots retain history, charts, ratings and notes. Hide bag-specific
recommendations and Set as reference actions when no bag is attached. Do not show
a recommended time window for manual shots. Do not deduct any bag's inventory.

## Confirmed implementation gaps

- `skin/app.js`: `installedProfiles` excludes `manual`; profile detail actions,
  `setNextFromRecipe`, `renderNextShot`, `loadOntoMachine`, `loadNow`, `apply` and
  workflow reconciliation require a current bag.
- `syncShelf`, retry and boot automatically select a bag when none is selected.
  An intentional No bag state needs its own persisted choice, distinct from
  loading, missing selection and an empty/failed shelf.
- Workflow updates deep-merge. Omitting `beanBatchId`, `coffeeName` or
  `coffeeRoaster` preserves stale values. Explicit null clears each nullable
  context field; `context: null` is invalid. `targetYield: null` is also invalid:
  use `0` to turn weight stopping off. Reset inherited `targetWaterVolume` when
  applying a new profile so a prior workflow's volume override does not leak.
- Favourites currently inherit the selected bag when their bean id is absent;
  they also omit profile ids. Preserve profile identity for duplicate titles and
  explicitly represent bagless favourites without reinterpreting old slots.
- End-of-shot inventory and feedback use `S.current`. Selection can change while
  brewing or while a shot is being saved. Attribute by the completed shot's stored
  context, with the shot-start context as a bounded fallback, never the next shot.
- Demo shot recording falls back to its first coffee and always deducts it.
  Its apply method also assumes a bag. Fix both rather than letting the demo
  conceal attribution bugs. The mock must model explicit null clearing and zero
  stop targets faithfully.

## Delivery order and acceptance

### 1. Bagless profile brewing

Make next-shot preparation independent of bag lookup, with an optional bag
association and stable installed-profile id. Keep the existing queued load,
mid-shot gate and Stop/start generation guards for every new path. Allow null bag
input to the live/demo apply contract; do not create a placeholder bean or batch.
Clear coffee identity with explicit nulls when bagless, and clear any stale grind
note unless one is explicitly supplied; preserve unrelated machine settings and
grinder identity. Reconcile bagless workflows by profile identity, settings and
absence of coffee metadata, without adopting a bag-bound workflow as bagless.

Persist the deliberate local coffee choice, restore it on boot and keep it through
shelf refresh/retry. Preserve unsaved edits when another client changes the
workflow, following current reconciliation rules. Snapshot the loaded brewing
context at shot start, including starts from the physical controller, and prefer
the saved shot's context for post-shot actions. Scope bagless grind memory
separately from bag grind settings.

Acceptance: empty shelf and failed shelf do not prevent profile browsing/bagless
brewing; bag → No bag clears old metadata in the actual workflow and saved shot;
refresh, restart and a newly added bag do not change the chosen mode; returning to
a bag restores its recipe; duplicate profile titles remain distinct; bagless
favourites do not attach the current bag. Switching the next shot during a pour
does not alter the running profile or misattribute the finished shot. Live,
demo and mock agree, and bagless ratings/notes save normally.

### 2. Manual profiles through the physical controller

Add narrowly scoped manual-profile discovery alongside espresso browsing; keep
manual profiles out of AI recommendation candidates. Use installed records,
including their type and actual step targets/limits. Expose the two manual choices
with controller instructions, capability/missing-profile states and zero-aware
stop controls. Shifting temperature must still shift every step. Manual modes
may use a bag, but must not inherit that bag's recommendation time window or
automatically request recipe advice.

Acceptance: correct installed manual profile and unchanged limiter/step structure
reach the workflow; manual stop writes `targetYield: 0` and deliberate volume
semantics; requested weight stop writes the selected value; no 36 g or 25–35 s
fallback appears. Controller capability and profile availability are handled
without starting anything automatically. Verify Decaid records manual profiles
as normal espresso operations and saves their shots; verify scale stop with a
manual profile in the desktop simulator before the supervised hardware check.
The demo may illustrate telemetry but must not claim to validate GHC interaction.

### 3. Verify and document

Run the applicable `.claude/skills/verify-crema/SKILL.md` checks: syntax, tests and
typecheck, source/built demo click-through, control races, live paths, tablet fit,
and skin packaging. Add targeted coverage for mode persistence, explicit context
clearing, zero targets, duplicate profile ids and shot attribution. Check all
three modes at tablet and phone sizes. Update architecture, install and parity
docs only when the corresponding behavior ships.

Then use desktop Decaid with a verified simulated machine to check actual
workflow round trips, bagless history and scale-stop semantics. Finally, on the
tablet with the user present, verify physical flow/pressure adjustment, Stop,
weight stopping if supported, mode transitions and inventory attribution. Desktop
simulation cannot establish how a physical GHC or pressure limiter behaves.

### 4. Optional later investigation: tablet paddle

The requested physical-controller modes can use existing profiles. A live tablet
flow/pressure paddle needs a supported Decaid command that was not found here.
If desired later, inspect the version-matched device/protocol implementation and
ask upstream about an appropriate API. Do not implement a paddle by repeatedly
replacing the workflow/profile mid-shot: that violates Crema's profile-send guard.
Keep this separate from the first two deliverables and make no tablet-paddle
promise until an interface and its behavior have been verified.
