# Crema implementation handoff

Created: 6 November 2026. Status: **in progress** (last updated 8 November 2026). The
progress table and the ticked items below say what is done; everything else is still planned.

This is the execution plan requested by the user after the project review. It covers
all review recommendations, including reuse of Streamline Settings. The supporting
[review record](review-2026-11-06.md) distinguishes reproductions, source findings
and untested assumptions. Read it before changing behaviour.

## Outcome and boundaries

Deliver a dependable custom daily interface for the user's Decent DE1, with clear
access to existing specialist functionality and a small ongoing maintenance burden.

Keep Decaid responsible for machine/scale communication and shared records. Keep
Crema's appearance, coffee workflow, shared rules engine and optional AI server.
Keep the installable static skin, phone access and explicitly labelled demo working.
Do not introduce a required server for non-AI functionality.

Reuse maintained upstream interfaces where practical. Do not fork Streamline or
Decaid, replace the frontend framework, or build a second profile editor merely to
complete this plan. Extract small modules when they make the fixes testable. Any
larger redesign needs a demonstrated incompatibility and a separate decision.

The older `de1app` is a different application. Its plugins are not assumed to work
in Decaid. Streamline's UI is not automatically inherited by installing Crema.

## How the implementing agent should work

1. Read `AGENTS.md`, `CLAUDE.md`, `docs/architecture.md`, `docs/design.md`, the review
   record and this plan. Inspect the current checkout and preserve unrelated work.
2. Establish versions and reproduce each relevant issue before fixing it. Use
   supported Node and the project's verification workflow.
3. Work through the phases below in small reviewable changes. Keep live/demo/mock
   implementations consistent, but treat upstream contracts as authoritative.
4. Mark a task complete only with its acceptance evidence. Record unavailable
   hardware/account checks as pending; continue independent local work.
5. Update this plan's progress table and relevant architecture/install/parity docs
   as the implementation changes. Do not leave planned behaviour described as shipped.

Writing this plan does not install plugins, change a tablet, perform maintenance,
update firmware, publish releases or move user data. Hardware validation is a
separate supervised step; implement and test locally first.

## Progress and order

| Phase | Work | Dependencies | Status / evidence |
|---|---|---|---|
| 0 | Establish compatibility and reproducible tests | None | Started: desktop Decaid set up, findings below; Playwright declared and the UI checks run in CI |
| 1 | Machine-control reliability | Minimal test setup from 0 | Started: Stop cancels pending starts, double starts blocked (`scripts/e2e-controls.cjs`) |
| 2 | Profiles, ratings, bags and history | 0; coordinate with 1 | Started: ratings use Decaid's 0–10 directly, shown as half stars |
| 3 | Reuse Streamline Settings and verify feature access | 0, 1; profile work from 2 | Started: dashboard exit in Settings (unverified on the tablet) |
| 4 | Frontend boundaries and stored-data migrations | Incremental alongside 1–3 | Not started |
| 5 | Image-fetch security | Independent after 0 | Done: `server/safe-fetch.ts` (PR #10) |
| 6 | Build, release and installation maintenance | Implemented fixes from 1–5 | Started: CI gates releases and Pages, with a `ui` job for the Playwright checks; tablet fit fails on overflow; skin ZIP checked before publishing |
| 7 | Real Decaid/tablet acceptance and documentation | Local checks passing | Not started |

### Suggested next sessions

Each is a self-contained piece of work that ends in its own PR. Order agreed with the
user on 8 November 2026: get the UI checks into CI and a way back to Decaid in place,
then tag a release and take a first, short look on the tablet before the rest of
phase 1, so real-hardware findings can reshape phases 1–3.

1. ~~**Reproducible UI checks**~~ (phase 0, finding 7; phase 6). *Done: Playwright
   declared, the UI checks run in CI, tablet fit fails on overflow.*
2. ~~**Dashboard exit**~~ (finding 1, phase 3). *Done in Settings; still to confirm
   on the tablet (item 3). PR #9 was merged into #8's branch after #8 had landed, so it
   reached `main` in a follow-up PR.*
3. **Tag `v0.1.0` as a normal GitHub release** from `main`. The release workflow runs CI
   and checks the ZIP first. Not a pre-release: Decaid's GitHub Release install asks for
   `releases/latest` unless `includePrerelease` is set (`lib/src/util/github_archive.dart`
   on Decaid's `main`, read 8 November 2026), and GitHub's latest skips pre-releases, so
   the tablet would find nothing. The `0.x` version and the release notes say it's early. Then a short first look on the tablet: install through
   Decaid's GitHub Release route, record the Decaid and WebView versions, the install
   path labels (finding 5), whether the key-value store and shot-settings stream behave
   as on desktop, the dashboard exit, and the tablet fit. Not yet for daily brewing.
4. **Rest of phase 1**, reworked after checking Decaid and Streamline (see phase 1,
   "What to reuse"): profile writes held during a shot (done), then link state from
   `/ws/v1/devices`, steam/hot water/flush through the workflow, workflow
   reconciliation, socket ownership and bounded waits. Needed before relying on Crema
   at the machine every day.
5. ~~**Image-fetch security**~~ (phase 5). *Done in PR #10.*
6. **Rest of phase 2**: installed Decaid profiles as the library, shot pagination and
   pinned references by ID, then per-batch bag state with a migration.
7. **Streamline Settings entry and the parity audit** (phase 3), after items 2 and 4.
8. **Supervised tablet session** (phase 7), once 2–4 are in.

Items 2 and 4 both edit `skin/app.js`, so run them one after the other.

Small follow-up: the README screenshots and walkthrough still show the old boxed
rating buttons (`refresh-demo-assets` skill; no AI reseeding needed).

## Findings from writing the user setup guide (7 November 2026)

Writing a step-by-step setup guide for the user surfaced these gaps. Each one belongs
to a phase below, and none has been implemented. `docs/install.md` was corrected
at the same time (docs only). The user also has a private web version of the guide,
which isn't in this repo. When behaviour changes, update `docs/install.md` and tell
the user which parts of the web guide are now out of date.

Upstream details came from Decaid's `doc/Skins.md` on `main` (fetched 7 November 2026).
The install, skin-exit and port sections of that file were read only as a tool summary,
not word for word. Confirm them against the Decaid release on the tablet before
building on them.

1. **No way back to Decaid from Crema (phase 3, "dashboard exit").** Crema has no
   control that leaves the skin. Skins.md documents `window.decentApp.exitToDashboard()`,
   which closes the skin and shows Decaid's dashboard in the embedded WebView and does
   nothing in an external browser. Add a control in Settings (and possibly the rail)
   that calls it only when `window.decentApp?.exitToDashboard` exists. In a phone
   browser, hide the control or show guidance instead. Block it during an active machine
   operation. Install docs currently send users to Decaid's "Skin navigation guide"
   setting (Settings → General) instead.
   *Implemented: Settings → Decaid → Open Decaid, through a new `host` member of the
   app's API (live: present only when `window.decentApp.exitToDashboard` exists, checked
   at render time; demo: always shown, explains itself in a toast). Greyed out and
   refused while Crema is starting something or the machine reports espresso, steam,
   hot water, flush, steam rinse, cleaning or descaling; allowed with no reading, since
   an offline machine is when Decaid's screens matter most. Not added to the rail.
   `e2e-live.cjs` checks it's absent in a browser, and with a stand-in `decentApp` that
   it's disabled and refuses while steaming, then calls the host once idle;
   `e2e-demo.cjs` checks the demo toast. `docs/install.md` updated, keeping the skin
   navigation setting as the fallback. Unverified in Decaid's real WebView: whether
   `decentApp` is present when the page loads, and the state names Decaid reports.*
2. **Streamline Settings entry point (phase 3).** Specifics from the plugin's README:
   - It installs with `POST /api/v1/plugins/install/github-release` and the body
     `{"repo":"decentespresso/streamline-setting"}`, or from its release ZIP on
     Decaid's Plugins screen.
   - To detect it, look for its plugin ID in `GET /api/v1/plugins`.
   - The page lives on the API port (`:8080`). Each skin is served from its own origin:
     `:3000` redirects to the selected skin's origin, which uses ports from 24800 up.
   - Decaid sends `X-Frame-Options: SAMEORIGIN`, so the skin can't show the page in an
     iframe. Navigate the whole page there instead, with `return=` set to
     `location.href`. Without `return`, Save and Cancel go to `http://<host>:3000/`.
   - It stores its own values in the key-value namespace `streamlineSettings`.
     Language, units and zoom there are Streamline preferences that Crema doesn't read.
     Decide whether Crema should follow any of them.
   - Crema's Settings → Machine and Steam sections duplicate some machine settings.
     Decide which control is the source of truth (see phase 3).
3. **No GitHub release exists yet (phase 6).** Decaid's "Install skin → GitHub Release"
   route has nothing to install until a `v*` tag is pushed. *Gates added:* `release.yml`
   now runs the CI checks and checks the ZIP before publishing. Merged in PR #6 and
   passing on GitHub; `v0.1.0` hasn't been tagged yet.
4. **Backup and restore are unverified (phase 6).** `docs/install.md` now gives
   `GET /api/v1/store/crema?full=1` and `GET /api/v1/profiles/export` for backups,
   both from Decaid's docs. Neither has been run against real Decaid. No restore
   procedure exists, and beans and shots depend on Decaid's own export. Verify both
   commands and write a restore procedure (phase 7, on disposable data).
5. **Install path labels are unverified (phase 7).** The docs give Launcher → Skins →
   ⚙ → Install skin → GitHub Release / ZIP file, and say that selecting a skin makes it
   the default served at `:3000`. Check both on the tablet, with the Decaid version
   recorded, and correct `docs/install.md`.
6. **Profile editing and other specialist features (phase 3, ownership audit).** The
   docs now route profile editing, Visualizer import and hiding built-in profiles to
   the Streamline skin (switch skins, then switch back). Firmware, calibration,
   cleaning cycles and eco steam go to Streamline Settings, and scale pairing to
   Decaid. Treat these as the working assumption for the `docs/parity.md` rewrite,
   not as verified routes.
7. **Playwright is installed globally, not declared (phase 0, R11).** The UI scripts
   only work where `playwright` is installed globally. A fresh checkout can't run them.
   *Fixed: Playwright is a dev dependency and CI's `ui` job runs the UI checks.*

## Phase 0 — compatibility baseline and test setup

### Findings from desktop Decaid (6 November 2026)

Tested with Decaid 0.9.1 for macOS (build 3027, commit `14361a94`) using its
simulated DE1 (`MockDe1`) and scale (`MockScale`), with Crema served from `skin/`
through "Live-edit from folder". This is simulated hardware in macOS WebKit, not
the Android tablet.

- Crema runs live in Decaid's window: REST, the machine/scale/water WebSockets and
  the time-to-ready plugin stream all work.
- **Missing key-value keys return `200` with `null`, not the documented `404`.**
  Crema treated `null` as the stored value, so on a fresh Decaid it had no presets
  and showed no machine controls. Fixed: `kvGet` treats `null` as missing, and
  `dev/mock-decaid.ts` now answers like Decaid.
- **`POST /api/v1/machine/shotSettings` rejects partial updates** with a `500`
  (it parses every field), and there is no `GET` route; current values come from
  the `ws/v1/machine/shotSettings` stream. Crema sent one field at a time, so
  Steam and Hot water couldn't start from Crema on real Decaid, and Settings hid
  the steam and hot-water temperatures. Fixed: the live adapter reads the stream
  (first frame, 3 s limit), merges and posts the whole object, one write at a
  time. The simulator now has no GET and rejects partial writes, and
  `e2e-live.cjs` checks both presets and a temperature change. On Decaid's
  simulated DE1 the stream shows a write immediately; a real DE1 over Bluetooth
  is unverified. *Superseded 8 November 2026: Crema no longer writes shot settings
  directly; steam, hot water and flush go through the workflow (phase 1).*
- **Workflow settings (checked 8 November 2026, same Decaid, `MockDe1`).** A `PUT
  /api/v1/workflow` carrying only `{"steamSettings": {"duration": 33}}` merges into
  the stored group and reaches the machine: the shot-settings stream showed 33 at
  once. Steam temperature and flow, and hot water volume, temperature and flow, reach
  the shot settings and machine settings the same way. `rinseData.flow` reached
  `flushFlow`; `rinseData.duration` and `targetTemperature` didn't change
  `flushTimeout` or `flushTemp`, but a direct `POST /machine/settings {flushTimeout}`
  didn't either, and Decaid's `_updateFlushSettingsFor` calls `setFlushTimeout`,
  `setFlushFlow` and `setFlushTemperature` from `rinseData`, so this is `MockDe1` not
  reflecting flush writes. A direct shot-settings write doesn't flow back into the
  workflow (the two drift); a recipe load (profile and context only) doesn't revert
  it. Decaid accepts any number (a volume of −5 was stored and sent); only a wrong
  type gets a 400. A settings-only PUT logs "Processing shot settings update" and no
  profile upload. After a `disconnect`/`connect` of `MockDe1` through
  `ws/v1/devices`, machine readings resumed on the already-open sockets, so 0.9.1
  re-attaches them (a power cycle of a real DE1 is still unverified). All values
  were restored afterwards.
- `GET /api/v1/shots` caps pages at 100 but echoes the requested `limit` (500) in
  its reply, so a truncated result looks complete (R6).
- Ratings are 0–10 in 0.9.1's docs; out-of-range values are rejected (R5).
- Snapshot sockets send `{"status":"connected"}` before the first reading. Crema
  shows "Machine offline" until that reading arrives, which reads as a failure (R2).
- With no Crema server, the same-origin `/api/config` probe gets a 404 from Decaid's
  skin server. Harmless.

### Phase 1 progress

- Done: `startOp` takes a generation number that Stop and Sleep advance, so a start
  waiting on a settings write or recipe load is abandoned, and a start command
  still in flight when Stop is pressed is followed by another stop. A second start
  is ignored until the machine reports the first (or 3 s pass). Stop stays enabled
  while a start is pending. `scripts/e2e-controls.cjs` covers this in the demo, the
  built demo and (`--url`) desktop Decaid.
- Also done: recipe loads are held during a shot (see phase 1).
- Remaining: see phase 1's task list, reordered after checking Decaid and Streamline.

- [ ] Record the Decaid, Streamline and Streamline Settings release versions/commits
  inspected. Identify minimum supported capabilities from evidence, not guesses.
  Record the actual tablet/Android WebView versions when accessible; do not block
  local implementation on obtaining them.
- [x] Make browser tests reproducible from the repository: declare Playwright,
  document browser installation, and use a Node version supported by all test tools.
  *Done: `playwright` is a dev dependency (locked in `package-lock.json`); README,
  `CLAUDE.md` and the verify skill give `npx playwright install chromium`. CI's `ui` job
  installs Chromium on Node 22 (the `engines` minimum) and runs `e2e-demo` (source and
  `--built`), `e2e-controls` (both), `check-tablet-fit` and `e2e-live`; locally they
  also pass on Node 25.*
- [ ] Capture small, anonymized upstream fixtures or schema-based contract tests
  for workflow, machine/device/scale streams, profiles, shots and store values.
  Note each fixture's upstream version. Do not create fixtures solely from Crema's mock.
- [ ] Exercise the skin in actual desktop Decaid using its supported development
  workflow when available. Keep hardware-free simulation explicitly identified.

Acceptance: a fresh checkout can install dependencies and run the documented local
checks; fixtures identify their provenance; supported and unverified combinations
are distinguishable. The existing tests (93 passing on 8 November 2026) are a baseline, not a parity claim.

## Phase 1 — machine-control reliability (R1–R3)

Primary code: `skin/app.js` (`startOp`, `loadOntoMachine`, `renderControls`,
`makeLiveApi.subscribe`, `onSnapshot`, boot); matching demo/mock paths.

### What to reuse (decided 8 November 2026)

Before building the rest of this phase we checked what Decaid already provides and
how Streamline (Decent's own skin for Decaid) solves the same problems. Sources:
Decaid's `doc/Skins.md` and `assets/api/websocket_v1.yml`, and Streamline's
`src/modules/` (`machine-link.js`, `profile-send-gate.js`, `workflow-watch.js`,
`resync-policy.js`, `socket-slot.js`) and `docs/AI_RUNTIME_NOTES.md`, all on `main`
as of 8 November 2026. Check them against the Decaid version on the tablet.

- **Use Decaid's facilities rather than building our own.** Machine link state comes
  from `/ws/v1/devices`, which Decaid documents as the authority (a telemetry gap
  doesn't prove the link is down). Steam, hot water and flush settings belong in the
  workflow (`steamSettings`, `hotWaterData`, `rinseData`), Decaid's recommended
  route and the one Streamline uses, instead of Crema's read-merge-post of
  `shotSettings`. Decaid retries profile uploads itself and reports
  `profileUploadFailed` on the devices stream; Crema shows it rather than retrying.
- **Learn from Streamline, don't copy it.** Streamline is GPL-3.0 and Crema is MIT,
  so its code isn't copied (and its ES modules wouldn't drop into Crema's classic
  scripts). Its lessons are reimplemented and credited in comments: hold profile
  writes during a shot; read link state as edges, with the first frame only a
  baseline (the USB device id is unchanged across a power cycle); re-read the
  workflow on visibility, focus and a slow timer, since Decaid has no workflow
  stream or revision; compare only the shown values (grind numerically); adopt
  outside changes rather than overwrite them; ignore the DE1 echoing an old value
  for up to 10 s after our own write (Decaid gh-678); one socket per stream, closed
  and silenced before a replacement opens, with backoff and jitter.
- **Version caveat.** Streamline's notes describe a Decaid that didn't re-attach
  machine sockets after a power cycle; Decaid's current docs say it does. Which one
  the tablet runs decides whether Crema needs to reopen sockets on link-up.

### Tasks, in order

- [x] Cancel pending starts when Stop is requested. Use an explicit operation state
  or generation token so a late settings/profile response cannot start the machine.
  Ensure Stop can be sent while another operation is awaiting a response.
  *Done: `opGen` in `startOp`/`cancelStart`, covered by `scripts/e2e-controls.cjs`.*
- [x] **Never write a profile mid-shot.** Decaid sends a workflow's profile to the
  machine as soon as it changes, even during a shot, and the DE1 runs its steps by
  index from that table, so a write replaces the steps being poured.
  *Done: `loadOntoMachine` holds the load while the machine reports espresso
  (`S.heldLoad`), the Load button says "Loads after this shot", a favourite says so
  too, and the load is sent once when the shot ends, reading the recipe then so the
  latest choice wins. Steam, hot water and flush don't run profile steps and aren't
  held. `e2e-controls.cjs` checks no write during a shot (two edits and loads), the
  message, and exactly one write of the latest recipe after; with the gate removed
  it fails. Remaining gap: a load already in flight when the machine starts a shot
  (from the group head) still lands.*
- [ ] Prevent duplicate starts and overlapping preparation requests. A response
  failure/timeout must not result in an automatic retry of a machine-start command.
  *Partly done: a second start is ignored while one is preparing or until the machine
  reports it (`isStarting`), and a failed start only shows a toast; nothing retries
  (checked in the source, not by a test). Not yet covered: preparation started from
  other paths, such as Load onto machine or a settings write, overlapping a start.*
- [x] **Link state from `/ws/v1/devices`.** Edge-triggered, first frame a baseline.
  Show "Machine disconnected" (not stale numbers), block new starts but never Stop,
  and show `profileUploadFailed` while Decaid retries. The simulator needs the stream.
  Keep a liveness fallback only for actual socket closure.
  *Done: the live adapter opens `ws/v1/devices` (and reads `GET /api/v1/devices` if
  the socket hasn't answered yet); `S.link` holds the machine's connected state and
  Decaid's `connectionStatus.error`. While the machine is unlinked the status chip
  says "Machine disconnected", readouts and the live panel show no stale values, the
  start buttons are disabled and `startOp` refuses (Stop is untouched), and a banner
  explains, with Open Decaid inside Decaid. The dashboard exit ignores a stale
  running state while unlinked. A link drop marks the recipe as not loaded; coming
  back shows a toast. `profileUploadFailed` shows a banner until Decaid retracts it;
  scale errors are a toast once per event; other errors (Bluetooth off, permission)
  are banners with Decaid's own message. A Decaid without the stream leaves the link
  unknown and the app behaves as before. The simulator now has the stream, the REST
  list, silent machine sockets while disconnected, 503s for machine commands, and
  `POST /dev/machine/{disconnect,connect}` and `/dev/connection-error`. `e2e-live.cjs`
  covers drop, no start sent, recovery, and the upload-failure banner; the
  disconnected Brew screen fits at 1340×800 and 1005×552. Not done: reopening machine
  sockets on link-up (only needed if the tablet's Decaid doesn't re-attach them), and
  the liveness fallback for a socket that closes.*
- [x] **Steam, hot water and flush through the workflow.** Replace the `shotSettings`
  read-merge-post queue and the `flushTimeout` write. Confirm on desktop Decaid 0.9.1
  first that the workflow fields reach the machine's shot settings.
  *Done: confirmed on 0.9.1 (see phase 0 findings). The app's API has
  `machine.workflowSettings` (both backends), which sends only `steamSettings`,
  `hotWaterData` and `rinseData`, never the profile, so it's safe mid-shot. Presets
  and Settings' temperatures and flows use it; the shot-settings stream reader and
  write queue are gone, and `machine.settings` keeps only fan and USB. Values are
  clamped and rounded in the app (`WF_LIMITS`): DE1 steam 135–160 °C and hot water
  flow 1–10 ml/s from Decaid's schema, steam flow ≥ 0.4 and steam ≤ 255 s from
  Streamline, the rest Crema's own limits; temperatures, durations and volumes are
  integers, as Decaid's schema requires. The simulator's workflow now carries and
  applies these groups. Against desktop Decaid 0.9.1 (this branch's skin served
  locally, pointed at :8080): presets reach the workflow and the machine, Settings
  shows the workflow's values and a change reaches the machine, and the link-state
  drop and recovery work; `e2e-controls.cjs --url` passes the steam, flush and Stop
  cases (its espresso cases now report "skip" when Decaid has no Crema coffee,
  instead of passing without testing anything).*
- [ ] **Reconcile the workflow instead of trusting `S.loaded`.** Re-read on boot
  (Decaid reloads a skin after 10 minutes in the background), visibility, focus,
  return from Decaid's dashboard, a slow timer and before a start. Compare the shown
  values; adopt an outside change and say so; don't repaint over an edit made in
  the last few hundred milliseconds; ignore our own echo.
- [ ] **Socket ownership.** One owner per stream, close and silence before reopening,
  backoff with jitter, and cleanup so reconnects don't accumulate handlers. Reopening
  on link-up isn't needed on Decaid 0.9.1, which re-attached the sockets after a
  `MockDe1` reconnect; confirm after a real DE1 power cycle.
- [ ] **Bound API waits** and keep optional AI/recipe discovery from delaying machine
  telemetry and Stop availability. Reproduce before choosing the smallest change.
- [ ] Handle missing/error/busy states using documented capabilities. Preserve
  group-head-controller use and stop-at-weight responsibility in Decaid.

Acceptance tests: delay a settings/profile response, press Stop, release it and
assert no start; double-tap start; load a recipe during a shot and assert nothing is
written until it ends; reject/time out a preparation write; disconnect the machine
while leaving its telemetry socket open; close/reopen sockets; resume the page;
change the workflow from a second client. The UI and effective recipe must agree,
and abandoned commands must never run after recovery.

## Phase 2 — profile and data correctness (R4–R7)

### Profiles

- [ ] Populate the library from installed Decaid profiles, including custom ones.
  Treat the curated catalogue as optional recommendation metadata.
- [ ] Use stable upstream IDs where available; handle duplicate titles and edited
  profiles. Preserve unsupported/unknown profile fields and full step semantics.
- [ ] When no supported recommendation is available, say so and allow manual
  selection. Never present an uninstalled profile as an actionable recommendation.
- [ ] Keep applying temperature offsets across all steps. Test round trips of
  custom profiles with limits, exits and temperature curves, not only mock steps.

Acceptance: an installed custom profile can be selected and used without catalogue
membership; empty/nonmatching libraries do not produce a fake usable recipe;
existing profiles are not unexpectedly rewritten.

### Ratings and shot history

- [x] Convert between Crema's five-star UI and Decaid's rating scale at the adapter
  boundary, consistently for detail edits, feedback, reads and AI history inputs.
  Specify handling for fractional ratings and unrated values.
  *Done by removing the conversion: Crema uses Decaid's 0–10 everywhere (app, demo,
  simulator, server schema, AI prompts, eval datasets) and shows it as five stars in
  half steps, so one point is half a star. The control is tapped or dragged, or set
  with arrow keys, and saves as soon as it changes. Fractional values (de1app imports
  are rescaled from 0–100) show to the nearest half star; 0 or missing is "Not rated";
  an unrated shot sends `null` to dial-in and writes no rating. The simulator rejects
  values outside 0–10 like Decaid's `_enjoymentRangeError`. Covered by
  `scripts/e2e-demo.cjs` (tap, half tap, drag, keys, list and detail after save) and
  `test/flow.test.ts`.*
- [x] Do not bulk-double historical ratings: existing values cannot be assumed to
  have come from Crema. Preserve data unless provenance supports a migration.
  *No migration: stored values are read as they are. Crema hasn't been released, so
  only test installs can hold old 1–5 ratings, which now show at half their stars.*
- [ ] Implement bounded pagination for inventory/maintenance and browsing. Fetch
  a pinned reference by its ID instead of searching only the latest 40 shots.
- [ ] Respect the distinction between shot summaries and full measurements. Avoid
  fetching every full shot solely to count doses or display a history page.
- [ ] Surface fetch failures separately from empty history; verify the just-finished
  shot is available before attaching ratings/reference state to it.

Acceptance: five stars writes the upstream maximum and reads back correctly; upstream
ratings display consistently; >100 shots are counted accurately; an old reference
loads; failed history requests do not imply zero consumption. Tests enforce real
pagination behaviour rather than the current permissive mock.

### Beans, batches and persistence

- [ ] Make bag-specific state refer to a batch. Support two active bags of the same
  coffee with different roast dates, frozen state and remaining quantity.
- [ ] Finishing one bag must not archive other bags. Buying a new bag must not
  silently discard the existing recipe or reference-shot association.
- [ ] Define the source of truth for remaining weight, including manual changes
  or consumption recorded through another skin; avoid double counting.
- [ ] Introduce versioned, idempotent migration of existing `bean:<id>` records.
  Preserve shared bean data, recipes, reference IDs and unknown fields where possible.
  Test interrupted migration/retry and document backup/rollback implications.
- [ ] Check tablet/phone read-modify-write conflicts for settings and favourites;
  use upstream concurrency facilities if supported, otherwise document and minimize
  conflict behaviour rather than claiming atomic multi-client updates.

Acceptance: add two bags, freeze one, brew from each, finish one, reload from another
device and retain the other bag plus its history. Existing installations migrate
without silently losing records. See phase 4 for shared schema work.

## Phase 3 — reuse settings and preserve feature access (R12)

### Streamline Settings integration

The proposed dependency is
[decentespresso/streamline-setting](https://github.com/decentespresso/streamline-setting).
Its documented plugin ID is `streamline-settings.reaplugin`, page endpoint is
`/api/v1/plugins/streamline-settings.reaplugin/ui`, and `return` specifies navigation
back to the skin. Its machine settings apply through Decaid; skin preferences need
explicit support in the calling skin. Verify these against the selected release.

- [ ] Add an obvious machine-settings entry in Crema. Detect the installed plugin
  through Decaid; handle missing, disabled, incompatible and unreachable cases.
  Provide setup guidance and a dashboard route rather than a broken link.
- [ ] Keep Crema-specific appearance, AI, favourites and connection preferences
  separate from delegated machine settings. Avoid duplicate controls disagreeing
  about the saved value. Decide the fate of each existing control explicitly.
- [ ] Use a validated Decaid base URL and the upstream return mechanism. Prefer
  full-page navigation for different origins. Do not assume the skin and API ports
  share an origin or that an iframe can inspect another origin's location.
- [ ] Verify the embedded WebView actually opens the plugin in place and returns
  to Crema. A working external-browser link is insufficient; do not assume all
  plugin pages receive the same native navigation treatment.
- [ ] Reconcile settings/workflow when returning (phase 1), without resetting
  changes to remembered Crema defaults. Retain the selected bag and appropriate
  unsaved work. Avoid navigating away during an active machine operation.
- [ ] Add a dashboard exit using the supported host capability when available,
  with sensible browser-only behaviour. Distinguish the native dashboard from
  Streamline's settings and the separate Decaid settings plugin.
  *Implemented and tested with a stand-in host (see finding 1); tick once it works in
  Decaid's WebView on the tablet.*
- [ ] Test the tablet-served skin, phone direct to Decaid, phone through Crema's
  proxy, no AI server, AI off, demo mode and plugin removal/update.

Do not vendor/copy the settings implementation into Crema by default. Verify
installation and update compatibility; any upstream integration bug should first
be isolated rather than worked around with a new private settings fork.

### Feature ownership and profile-editor decision

- [ ] Revise `docs/parity.md` into an evidence-backed matrix: feature, actual owner,
  route from Crema, minimum capability/version, supported device and verification.
  Separate “implemented locally”, “accessible elsewhere”, “unverified” and “missing”.
- [ ] Cover every existing parity row, including profile editing/import/hide/restore,
  Profile Generator, grinder entities, scale reconnect/required/power behaviour,
  Visualizer, shot deletion, cleaning/descaling, calibration, firmware, language,
  units, steam modes, help and keyboard controls. Distinguish reminders from an
  actual machine maintenance workflow.
- [ ] Investigate a maintained profile-editor entry point independently. A settings
  plugin is not evidence of an editor. If no supported reusable route exists,
  document a tested switch-to-Streamline-and-return flow as the initial solution.
  Record this decision before proposing a new editor or copying upstream code.
- [ ] Identify classic `de1app` functions/plugins without Decaid equivalents. Do
  not claim full parity because shared storage exists. Ask the user about priorities
  only where a real unresolved feature tradeoff remains.

Acceptance: the user can open machine settings from Crema, save/cancel and return
without changing the active skin, on verified supported surfaces. Advanced features
have accurate, tested access instructions or are explicitly marked missing. Do not
mark the whole matrix complete based on one working link.

## Phase 4 — maintainable boundaries (R9)

- [ ] Gradually separate the Decaid adapter, connection/control state, persisted
  schemas and UI views. Avoid changing unrelated visuals during extraction.
- [ ] Enforce the live/demo contract using shared types (TypeScript or checked
  JavaScript/JSDoc are both acceptable). Include relevant frontend code in checks.
- [ ] Validate external/persisted values at adapter boundaries and define migration
  versions. Keep pure recommendation logic in the shared engine, not copied into UI.
- [ ] Define subscription cleanup and ownership so reconnects/navigation do not
  accumulate handlers. Keep fixtures and mocks exercising the same public contract.
- [ ] Preserve static packaging and the single-file demo. If build inputs change,
  update packaging and demo tools in the same change.

Acceptance: adding or removing an API member produces a useful check failure in
both adapters; critical state logic can be tested without DOM rendering; migration
tests protect old records. A framework migration is not an acceptance criterion.

## Phase 5 — image fetching (R8)

Primary code: `server/images.ts`, its routes in `server/app.ts`, image tests.

- [x] Validate public destinations before making each request, including redirects.
  Resolve and reject private/reserved IPv4/IPv6 addresses; ensure the connection
  uses the vetted destination rather than re-resolving unsafely.
  *Done in `server/safe-fetch.ts`, used by `images.ts` (product pages and photos) and
  `dropDeadLinks` in `identify.ts`. Requests go through `node:http`/`https` with a
  custom `lookup` that resolves once, refuses the name if any address is reserved,
  and is the lookup the socket connects with. Redirects are followed by hand, each
  target checked before it's requested. Reserved ranges are a `BlockList` (IPv4 and
  IPv6 kept separate) covering private, shared, loopback, link-local, documentation,
  benchmarking, multicast, IPv4-mapped, NAT64 and 6to4. `isSafeUrl` moved there,
  also refuses credentials in URLs and single-label names, and is re-exported from
  `images.ts`. `resolveGroundingLinks` still uses `fetch`: it only requests Google's
  fixed grounding host, with manual redirects. The Decaid proxy is unchanged (its
  target is the configured `DECAID_URL`).*
- [x] Bound redirects, time and streamed response bytes; stop reading once the
  limit is reached even without a trustworthy `Content-Length`.
  *Done: 5 redirects (3 for dead-link checks), one deadline across all hops, and the
  body streamed and abandoned past the limit, counted after decompression.*
- [x] Test allowed public fetches, redirect-to-private attempts, private DNS results,
  address variants, oversized/chunked bodies and timeouts using controlled fixtures.
  No probing of real private infrastructure is needed.
  *Done: `test/safe-fetch.test.ts` runs local servers reached through an injected
  resolver (62 cases, including a gzip bomb and a mixed public/private DNS answer),
  and `test/identify.test.ts` checks dead links the same way. A manual smoke run
  against real roaster sites (https, http→https and cross-host redirects, gzip/brotli,
  Open Graph image) worked; it isn't part of CI.*

Acceptance: rejected destinations receive no outgoing request; oversized downloads
are aborted while streaming; normal product image caching and fallback still work.
Do not expand this targeted fix into an unrelated authentication/platform redesign.

## Phase 6 — verification and distribution (R10–R12)

- [x] Make tablet-fit checks exit nonzero for page/column overflow, horizontal
  scrolling and page errors. Check both before and after a shot. Correct the
  verification skill's claim once the behaviour is actually enforced.
  *Done: `check-tablet-fit.cjs` lists every problem and exits 1. Checked against a copy
  of the skin with a column padded to overflow (fails at all five sizes) and against
  `main` (passes). It also waits for web fonts before measuring.*
- [ ] Extend live browser tests to pull/stop a shot and verify the recorded workflow,
  rating and reference. Add phase 1 failure/race cases, API-contract cases, two-client
  changes, multiple bags and settings round trips. Remove success-on-missing-data
  shortcuts where they can hide a broken scenario.
- [ ] Add a CI verification job and gate skin release/Pages publishing on applicable
  checks. Verify the generated engine before rebuilding it so drift is detected.
  Build and test the exact distributable files, including the extracted skin ZIP.
  *Partly done: `.github/workflows/ci.yml` runs on pull requests and pushes to `main`
  (typecheck, `npm test` including engine freshness, skin syntax, built demo matches
  source, skin ZIP check), and `release.yml` and `pages.yml` call it first. It passed
  on GitHub for PR #6 and the merge to `main` (8 November 2026); the release path
  hasn't run yet because no tag exists. The Playwright UI checks run in a parallel
  `ui` job and upload screenshots when one fails.*
- [ ] Preserve root `index.html`, skin metadata, relative asset paths and semantic
  version tags. Include the actual project repository in release metadata where
  appropriate. Do not ship test tooling or credentials inside the skin.
  *Partly done: `scripts/check-skin-zip.mjs` unzips the package and fails on a missing
  root `index.html`, a bad manifest id or version (or one that doesn't match the tag),
  a missing or absolute asset path, a script that doesn't parse, or development files.
  The release workflow rejects tags that aren't semantic versions. Repository in the
  manifest: not done.*
- [ ] Build/smoke-test the optional Docker server using mock AI; assert basic config,
  static skin delivery and permitted local proxy behaviour. Account-dependent AI
  provider smoke tests remain separate from ordinary CI and require no CI secrets.
- [ ] Document GitHub Release installation and Decaid-managed updates as the normal
  path, with ZIP installation for offline/manual use. Do not add a custom updater.
- [ ] Document and test what Decaid backup/export includes, especially Crema's KV
  namespace and plugin state. Keep backup guidance distinct from the optional
  server's regenerable image cache; remove “nothing else to back up” ambiguity.

Acceptance: a fresh install can run all required checks; a known failing check blocks
publication; stale generated assets are detected; release ZIP and container smoke
tests pass; install/update/backup instructions state what was actually verified.

## Phase 7 — real application and tablet acceptance

First test actual Decaid on desktop, then a supervised session on the user's DE1
tablet. Discover existing connections through direct tools/configuration first.
Do not claim these checks passed using the repository simulator.

- [ ] Install the packaged skin, restart Decaid, switch skins, return and upgrade
  the skin without losing Crema records or local connection preferences.
- [ ] Open/save/cancel delegated settings in the embedded WebView and phone browser;
  verify effective values after return and plugin update.
- [ ] Verify the profile-editing route and a custom profile round trip.
- [ ] Check espresso, Stop, scale tare/required behaviour and stop-at-weight with
  suitable supervision. Confirm steam/hot water/flush presets and physical group-head
  controls as applicable. Do not run firmware or cleaning cycles merely to verify links.
- [ ] Check network loss, machine disconnect/reconnect, app background/resume and
  simultaneous tablet/phone use. Ensure no delayed command starts after recovery.
- [ ] Verify no-server, server-unavailable and AI-disabled operation; a known live
  installation must not misleadingly appear connected when it is showing a demo.
- [ ] Check target tablet fit, touch interaction and offline font/asset behaviour;
  bundle fonts only if needed to make the existing design reliable offline.
- [ ] Verify backup/restore on disposable test data before any live migration.

Record versions, date, procedure and results without publishing private hostnames,
addresses, account details or user shot data. Hardware-pending work must remain
visible even when all software checks pass.

## Completion evidence

Follow `.claude/skills/verify-crema/SKILL.md` for applicable changes. At minimum,
the final implementation report should include results for type checks/unit tests,
frontend syntax/types, source and built demo checks, tablet fit, live simulator
tests, upstream contract tests, packaged-skin tests, Docker smoke tests and the
actual-Decaid/hardware matrix. State unavailable checks explicitly.

For each phase, record changed files, tests, upstream versions, remaining limitations
and any data migration. Update `docs/architecture.md`, `docs/install.md`,
`docs/parity.md`, README and `CLAUDE.md` where claims changed. Refresh demo assets
only where affected, following the existing workflow; real AI reseeding is not
required merely because UI/control code changed.

## Deferred product work

Catalogue gaps, grinder entities and numeric advice, a Crema-native profile editor,
new shortcuts/help, extra steam workflows and translations remain feature decisions
after the ownership audit. Prefer existing tools for specialist functions. Bengle-only
features, Home Assistant integration, order-email ingestion, new themes and additional
AI features are not required to close this review. Do not build them by inference.

## Upstream references

- [Decaid skin/API guide](https://github.com/decentespresso/decaid/blob/main/doc/Skins.md)
- [Streamline user manual](https://github.com/decentespresso/streamline-js#readme)
- [Streamline Settings plugin and integration instructions](https://github.com/decentespresso/streamline-setting#readme)
- [Decaid shot handling](https://github.com/decentespresso/decaid/blob/main/lib/src/services/webserver/shots_handler.dart)
- [Decaid workflow handling](https://github.com/decentespresso/decaid/blob/main/lib/src/services/webserver/workflow_handler.dart)

Read the selected upstream release rather than assuming `main` matches the tablet.
The external settings plugin is a proposed integration, not an already-installed
dependency or a verified replacement for every specialist screen.
