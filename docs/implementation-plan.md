# Crema implementation handoff

Created: 6 November 2026. Status: **in progress** (last updated 10 November 2026). The
progress table and the ticked items say what is done; everything else is still planned.
Dated status updates and superseded orderings are in [history.md](history.md).

## Where things stand (10 November 2026)

Phases 1, 2 and 5 are done in software, and phase 6 mostly. The current release is
v0.4.1 (shot review fixed for real shots). The user reports the tablet was upgraded in
place through each release to v0.4.1 and is in daily use without problems, so a
supervised tablet session is not planned and agents should not ask for tablet access
unless the user offers it. A code review the same day found problems this plan had not
listed (see "Code review and findings"). The fixes for F1 to F5 and the control logic
under unit tests (phase 4 re-scoped) were merged into `main` on 10 November 2026 as
PRs #42 to #46 and #48, with the review itself (#41) and the plan trim (#47). Nothing
has been released or tagged since v0.4.1, and none of it has run on the tablet: it is
checked against the simulator and CI only. Agents open a PR per piece of work and do
not merge; tagging a release is the user's call. Software checks use
`dev/mock-decaid.ts` and desktop Decaid 0.9.1 with its
simulated machine. The [review record](review-2026-11-06.md) separates reproductions,
source findings and untested assumptions; read it before changing behaviour.

## Next

Each item is its own PR, and all of it can be verified with the simulator and desktop
Decaid.

1. **UI feedback, 10 November:** independent shot-history scrolling is implemented
   in [PR #52](https://github.com/gauravawadhwal/crema/pull/52), pending review/merge.
   Implement the inline favourites improvement below before the next release;
   the revised render is the current design proposal.
2. **Startup edit race, fix ready for review:**
   [PR #50](https://github.com/gauravawadhwal/crema/pull/50) explains the intermittent
   `e2e-live.cjs` failure labelled "inventory refresh preserves the tablet's unsaved
   recipe edits". The initial workflow read can overwrite edits made while the read
   is in flight; the shelf refresh is not the cause. The fix preserves those edits.
   **Separate CI issue observed while checking this UI work:** the live suite's
   shelf-request timeout scenario stayed at "Loading your coffees" rather than
   reporting the 15-second timeout. It failed on both the documentation-only
   [PR #51 run](https://github.com/gauravawadhwal/crema/actions/runs/42778043324)
   and the [PR #52 run](https://github.com/gauravawadhwal/crema/actions/runs/42777928669).
   Stop remained available. This predates the history change; whether it is a
   production timeout defect or the check's clock/interception setup is not yet
   established. Investigate separately from the startup-edit race before release.
3. **Package the completed fixes for installation when ready.** The latest release,
   v0.4.1, is a snapshot of older code; the merged fixes are on `main`, not yet in an
   installable GitHub release. A release runs CI and attaches a new skin ZIP for
   Decaid to install. It is distribution work, not a separate feature or a reason
   to pause implementation. Tagging remains the user's call.
4. **Streamline Settings entry and the parity audit** (phase 3). On hold until the user
   is ready with desktop Decaid. Build and check it against desktop Decaid; the user
   confirms on the tablet in normal use.
5. **Optional:** put `skin/app.js` and `skin/demo.js` under `tsc --checkJs` with a
   shared JSDoc type for the API object, which turns the live/demo contract into a type
   check. Splitting the file further is optional after PR #44.
6. **Held until there is a reason:** shot-review threshold calibration (needs more real
   shots with taste recorded); grinder entities and a numeric grind advisor; Home
   Assistant sensors; order-email ingestion (see "Deferred product work").
7. **Still unverified on hardware:** the cases listed next. They are kept visible, not a
   request for a tablet session.

Housekeeping (F6) is the user's call.

## UI feedback — 10 November 2026

### Favourites: larger, readable targets (proposal)

The user still finds the favourites too small to press comfortably. The five slots
plus the 44 px edit button share a 300 px Brew column, leaving some slots less than
40 px wide. Increasing height alone does not fix the cramped names or touch targets.

Reference patterns reviewed on 10 November:

- [Streamline](https://github.com/decentespresso/streamline-js#7-the-main-screen)
  puts five quick-access favourites across a broad top bar. It uses tap to load and
  long-press to reassign. Crema's narrow column cannot accommodate the same row.
- [Home Assistant tiles](https://contributors.home-assistant.io/design/dashboards/tile-card/)
  give a named item a readable primary label and secondary state, with a distinct
  route to more detail. Use the hierarchy, without copying its split icon action.
- [Android touch guidance](https://support.google.com/accessibility/android/answer/7101858)
  recommends at least 48 dp targets and 8 dp separation. For Crema, use at least
  48 CSS px in both dimensions as a layout floor, then check physical size on the
  scaled tablet; CSS px and Android dp are not assumed equivalent.
- [Mono](https://github.com/meldavy/decaid-mono-skin), supplied by the user as a
  general UI reference, not only for favourites. Its
  [style guide](https://github.com/meldavy/decaid-mono-skin/blob/main/docs/STYLE.md)
  keeps action positions consistent, specifies generous touch targets and checks
  freeform text with long names. Its favourites CSS separates fixed controls from
  a scrollable card grid. Use these interaction/review ideas within Crema's existing
  design; do not infer a request to copy its visual theme or implementation.

**Revised after the user's render feedback:** use the available area below
**Load onto machine** for an inline, vertically scrolling list of full-width
favourite tiles. The separate picker was rejected as a waste of space and an
unnecessary extra tap. Keep direct one-tap loading through the existing guarded
path. Show a clear Favourites heading and labelled **Edit** control; edit mode
opens rename/replace/clear from a tile. Empty slots say **Save current recipe**.

Each tile shows the name prominently, followed by profile and dose/yield/temperature;
allow names to wrap. The revised preview uses approximately 92 px-high tiles with
8 px gaps. The list uses the remaining column height and scrolls independently
while the recipe controls stay still at the normal tablet size. At the shortest
viewport, retain the existing left-column scroll if needed to keep a useful list
viewport rather than shrinking touch targets. Check this explicitly at 1005×552,
including access to Load, the final slot and Edit. Keep five slots, saved values
and bagless semantics unchanged. Failed loads/saves remain visible without
silently changing the selected recipe.

Acceptance: all targets meet the size floor at every supported viewport; names
and saved recipe details are legible; load and edit are distinct; no outer-page
overflow or moved machine controls; the deliberate list/left-column scrolling
keeps every control reachable. Test touch scrolling without accidentally loading
a tile, keyboard access, long names, and source/built/live/demo behavior.
This is a rendered proposal, not implemented production behavior.

### Shot history: independent panes (confirmed UI bug)

- [x] On tablet and desktop, constrain Shots to the available viewport and let the
  left shot list and right detail panel scroll independently. Keep the status bar
  and Shots heading visible. Reaching a pane's end must not scroll its neighbour
  or the outer page. Keep the phone's single-column page scrolling normally.
- [x] Preserve list position when selecting/comparing shots or loading older ones;
  selecting a different shot starts its detail at the top. Check long histories
  and long saved reviews, empty/error states, keyboard access, tablet sizes and
  resizing to/from the phone layout. Record source and built-demo verification.

Implemented in PR #52, pending review/merge and not released. Source and built-demo
regressions pass at 1340×800, 1005×552, 1600×1000 and 800×1000, with phone resize,
keyboard, paging, empty/error and scroll-boundary checks. Source/built demo
click-through, all five Brew tablet-fit sizes, the saved-review simulator checks,
typecheck, 293 unit/server tests and skin packaging also pass locally. Physical
tablet behavior has not been checked.

## Backup/restore scope — clarified 10 November 2026

The user does not want a separate backup/restore project unless Crema departs from
normal skin practice. Continue using Decaid-owned beans, profiles, shots and its
skin KV store. Backup/restore testing is not a release blocker or a prerequisite
for ordinary UI work. Revisit only if a proposed storage change or migration
creates a concrete compatibility concern; first check Decaid's standard mechanism
rather than building a Crema backup system. Older unticked backup tasks below are
deferred under this decision, not requirements for the current work.

## Still unverified on hardware

The user's daily use covers installing and upgrading in place, espresso with stop at
weight, the tablet layout and touch, and adding coffees from a phone. These were
reported by the user on 10 November 2026, not audited by an agent. The cases below have
not been reported either way. They are listed so they stay visible, not as a request
for a tablet session:

- Wi-Fi loss or a machine power-cycle mid-session, and tablet sleep and resume.
- Stop pressed at the same moment as a load or a start, on the real machine.
- Manual flow and pressure with the physical group-head controller.
- Whether steam, hot water and flush preset values reach the machine.
- Decaid backup and restore including Crema's key-value records. Deferred under the
  backup/restore scope above; not a requested tablet check or a release blocker.

## Code review and findings — 10 November 2026

A review of `main` at PR #40, made by reading `server/` and all of `skin/app.js` rather
than this plan. 207 unit tests and the typecheck passed locally and CI was green; the
Playwright checks were not run locally. The fixes are PRs #42 to #46 (with
the F4 remainder). All were merged on 10 November 2026 and are not released. They are
verified against the simulator and CI only, not on the tablet. The checkboxes below are
ticked on that basis.

### What the review concluded

- **The server is small and well bounded**, and every AI call has a rules fallback.
  `skin/app.js` (about 204 KB, one global state object) is large but careful; its size
  is a navigation cost more than a correctness risk.
- **The real gap was unit tests for the app's hardest logic** (control, reconcile and
  bag arithmetic were reachable only through Playwright). So phase 4 is cut by what
  needs testing, not by file size.
- **Evidence trails the software.** v0.4.0's shot review produced no usable review on
  the first 12 real shots, found only by replaying them (v0.4.1).

Every finding below comes from reading the code, not from running it. Reproduce each
one before fixing it.

### Findings

**F1. Likely bugs (small, user-visible)**

- [x] **"Notes saved" shows even when the save failed.** The `#shotNotes` handler in
  `renderShotDetail` swallows the error from `api.annotate` and then toasts success.
  Fix: toast success only when the write resolves, and say so when it fails.
  *Done: PR #43 (merged 10 November 2026; simulator and CI, not on the tablet).*
- [x] **"Recommendations updated" is only true for the current coffee.** `savePrefs` in
  `renderSettings` sets `recipe = null` on every shelf row in memory and re-selects the
  current coffee. The next `refreshShelf` reads the other coffees' old recipes back from
  Decaid's key-value store, so they are never recomputed. Fix: either clear the stored
  recipes for the other coffees (so each is recomputed when next selected), or mark
  them stale in the record; then make the toast say what happened.
  *Done: PR #43 (`resetRecipes`; merged 10 November 2026, simulator and CI, not on the tablet).*
- [x] **Many buttons fail silently.** These handlers await a request with no error
  handling: Freeze/Thaw and "Mark finished" (`renderShelf`), wake-schedule day toggles,
  enable switches, Add and Remove, USB charging, sleep-when-idle, "Done today" for
  backflush and descale (`renderSettings`), and saving, renaming, replacing and
  clearing favourites (`useFav`, `editFav`). There is no `unhandledrejection` handler,
  so a failed request shows nothing. Fix: a global handler that toasts "Couldn't do
  that: …", plus explicit handling where the UI must roll back (switches that stay
  flipped after a failed write).
  *Done: PR #43 (global failure toast, with rollback where a switch stays flipped; merged 10 November 2026, simulator and CI, not on the tablet).*
- [x] **A shot whose machine socket drops mid-pour never shows the after-shot panel.**
  `subscribe` marks a snapshot `finished` only when the previous state was `espresso`,
  and the socket's `onLost` resets that previous state. `onSnapshot` has the same
  dependency for sending a held load. After a reconnect the shot ends unnoticed: no
  panel, no bag weight update, and "Loads after this shot" stays until the next load.
  Fix: remember that a shot was running across a reconnect, and treat the first
  non-espresso snapshot after it as the end.
  *Done: PR #43 (it also holds a profile write during the gap; merged 10 November 2026, simulator and CI, not on the tablet).*

**F2. Shelf polling**

- [x] **The shelf is fully re-read every 5 seconds on every visible device.**
  `syncShelf` (the 5 s interval in `boot`) calls `api.shelf()`, which makes one request
  for the beans, then per coffee one for Crema's record (which carries the bag photo as
  a data URL) and one for its batches, then per bag every shot summary for that bag and
  the bag's correction record. `syncShelf` also serialises the whole shelf twice per
  cycle to detect changes. The tablet serves all of this while also running the
  machine. Fix: poll a cheap change signal (the bean list and batch lists), and do the
  full read only when it differs, on focus, and after a shot.
  *Done: PR #45 (merged 10 November 2026; simulator and CI, not on the tablet). Idle poll down from 17 to 6 requests for 4 coffees; full reads only while a just-added coffee waits for its recipe.*
- [x] **A read path writes.** `bagUse` writes a weight correction to the key-value
  store when it sees `weightRemaining` changed elsewhere, and it runs inside the 5 s
  poll on every device, so two devices can write the same correction at once. Fix: do
  the correction in `syncRemaining` (after a shot, or when the user sets what's left),
  not in `shelf()`.
  *Done: PR #45 (correction moved to `syncRemaining`; merged 10 November 2026, simulator and CI, not on the tablet). Bagless shots no longer get another coffee's info in reviews.*

**F3. Shared records can lose updates across devices**

- [x] **Settings merge into a per-device cached copy.** `api.settings.set` spreads the
  patch over the copy this device read earlier, then writes the whole object. A phone
  changing the grind step can undo the tablet's AI switch. Fix: re-read before writing,
  as `prefs.set` and `maintenance.set` already do.
  *Done: PR #46 (merged 10 November 2026; simulator and CI, not on the tablet).*
- [x] **Coffee records are read-modify-write with no guard.** `patchRecord` and
  `saveBean` read `bean:<id>`, merge and write it back; `recommend` rewrites `info` and
  `recipe` together. Two devices acting on the same coffee within a request's time can
  drop one change (a pinned reference shot, for example). Decaid's store has no
  revision, so this cannot be made exact. Fix sized to a household: re-read immediately
  before each write and merge only the fields being changed; consider splitting fields
  that change independently into their own keys, as bags already do (`bag:<batchId>`).
  Any key change needs a migration (phase 4, "define migration versions").
  *Done: PR #46: every `bean:<id>` writer re-reads and merges a patch. Keys not split: judged not worth a migration for now. Merged 10 November 2026; simulator and CI, not on the tablet.*

**F4. Structure and duplication**

- [x] **The rest-window table is copied into `app.js`** (`REST` and `restOf`, marked
  "mirror"). The source is `server/recommend/rules.ts`. Export it through
  `server/engine.ts` and delete the copy, per this repo's own convention.
  *Done: PR #48 (merged 10 November 2026; simulator and CI, not on the tablet). The
  app calls `E.restOf` from `rules.ts`. One difference: the shelf pill now infers the
  roast level as the recommender does (`roastedFor` filter reads as light, omni as
  medium-light) when none is stated.*
- [x] **The live API reaches into the UI.** `api.review` reads `S.shelf` for the coffee,
  and `api.machine.waterThreshold` uses `settingNumber` and `SETTING_LIMITS` from the
  settings view. Pass these in as arguments so the API layer has no dependency on UI
  state; this is a precondition for typing or extracting it.
  *Done: PR #44 (merged 10 November 2026; simulator and CI, not on the tablet).*
- [x] **The taste scales and the Review button are written twice**, in `showAfterShot`
  and `renderShotDetail`, with slightly different behaviour (one saves taste on tap,
  the other only with a review). Make one shared piece.
  *Done: PR #48 (merged 10 November 2026; simulator and CI, not on the tablet). Shared
  `tasteScalesHtml`, `bindTasteScales` and `bindReviewButton`. Taste now saves on tap
  in the after-shot panel too, and a failed save puts the previous answer back.*
- [x] **Doc drift:** `CLAUDE.md` says `withTemperature` is in `server/app.ts`; it is in
  `server/recommend/local.ts`.
  *Done: fixed in the docs trim (this PR).*

**F5. Server hardening, sized to a home LAN**

- [x] **No upload limit on `/api/identify`.** Photos are read into memory with no size
  or count limit. Add a body limit (the app sends at most four photos).
  *Done: PR #42 (merged 10 November 2026; simulator and CI, not on the tablet).*
- [x] **Any web page can call the server.** `/api/*` allows every origin and the server
  listens on all interfaces with no authentication, so a page open in a browser on the
  LAN could spend AI calls. The `/decaid/*` proxy adds no exposure Decaid doesn't
  already have on the LAN. Fix: restrict CORS to configured origins (an environment
  variable, defaulting to the Decaid skin origin and same origin). Authentication is
  not proposed.
  *Done: PR #42 (`CORS_ORIGINS`; merged 10 November 2026, simulator and CI, not on the tablet).*
- [x] **`ProviderChain.lastUsed` is shared between requests.** Two simultaneous
  requests can report each other's provider as the source. Return the provider with the
  result instead.
  *Done: PR #42 (provider returned with each result; merged 10 November 2026, simulator and CI, not on the tablet).*
- [x] **Minor:** 500 responses return the raw error message; `dialInWithSource` falls
  back to rules without logging why (`recommend` and `reviewShot` do log).
  *Done: PR #42 (generic 500s, dial-in fallback logged; merged 10 November 2026, simulator and CI, not on the tablet).*

**F6. This plan and the repository**

- [x] **This plan is hard to use as a handoff.** It is over 1,100 lines with several
  dated status sections above the progress table, and "Suggested next sessions" holds
  two overlapping orderings, the first of which describes bagless work that has
  shipped. Collapse the top into one current status and one ordered list, and move the
  dated narratives to a history file.
  *Done: in the docs trim (this PR): see the top of this file and [history.md](history.md).*
- [ ] **Housekeeping.** Two leftover worktrees under `.claude/worktrees/` and about ten
  merged local branches remain; `.claude/launch.json` and `.claude/worktrees/` are
  untracked and not ignored. Removing worktrees and branches is the user's call.

## Outcome and boundaries

See [Bagless and manual brewing](bagless-manual-plan.md) and [AI shot review](shot-review-plan.md) for those features (released in v0.3.0 and v0.4.0).

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
Why a skin and not a fork, and the Decaid-plugin alternative, are recorded in
[investigation.md, section 7](investigation.md#7-a-skin-not-a-fork-of-streamline-reviewed-8-november-2026)
(8 November 2026): Crema owns the daily brewing loop and hands the rest to Streamline,
its settings plugin or Decaid, rather than closing every parity gap.

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
| 1 | Machine-control reliability | Minimal test setup from 0 | Done in software (PRs #12, #13, #14, #16, #17, #18, and the overlapping-loads and busy-states change): Stop races, no profile writes mid-shot, link state, workflow settings, reconciliation, time limits, sockets. Software work done; all of it unverified on the tablet |
| 2 | Profiles, ratings, bags and history | 0; coordinate with 1 | Done in software: ratings, shot history (#22), installed profiles (#23), bags per batch. Unverified on the tablet |
| 3 | Reuse Streamline Settings and verify feature access | 0, 1; profile work from 2 | Started: dashboard exit in Settings (unverified on the tablet) |
| 4 | Frontend boundaries and stored-data migrations | Incremental alongside 1–3 | In progress. Re-scoped on 10 November 2026: control, load-hold, reconcile, start-gate and bag-weight decisions moved to `server/control/` with vitest (PR #44, merged 10 November 2026; simulator and CI, not on the tablet), with the shelf, record-merge and rest-table logic added by #45, #46 and #48. File splitting and `tsc --checkJs` later (see "Next") |
| 5 | Image-fetch security | Independent after 0 | Done: `server/safe-fetch.ts` (PR #10) |
| 6 | Build, release and installation maintenance | Implemented fixes from 1–5 | Mostly done: CI (`verify`, `ui`, `docker`) gates releases and Pages; tablet fit fails on overflow; skin ZIP checked; Docker image smoke-tested. The complete saved-shot regression is covered by `e2e-brewing.cjs`. Left: backup/restore docs; repository in the manifest |
| 7 | Real Decaid/tablet acceptance and documentation | Local checks passing | Started: one real brew and saved workflow/telemetry checked. User-reported on 10 November 2026: upgraded in place to v0.4.1 and in daily use without problems. Edge cases not yet seen are listed under "Still unverified on hardware" |

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

## Findings: voice input inside Decaid (9 November 2026)

Seen by the user on the Android tablet: tapping Speak in "Describe it" fails, because
the microphone is refused. It isn't a bug or a setting:

- Decaid's `doc/Skins.md` ("Live Camera Access on Android, iOS and macOS") says skins in
  its embedded WebView may use the camera only (`getUserMedia({video: true, audio:
  false})`, with per-skin Ask/Allow/Deny consent); "microphone and combined
  camera/microphone requests are denied", on Android, iOS and macOS alike.
- Decaid's Android manifest (`android/app/src/main/AndroidManifest.xml` on `main`, read
  9 November 2026) doesn't declare `RECORD_AUDIO`, so Android doesn't even offer a
  Microphone permission for the app. Nothing in Android or Decaid settings can turn it on.
- The file-input route (`<input type="file" capture>` opening a recorder) is limited to
  images on Android ("image/non-image mixtures are denied for capture").
- Forking Decaid to change this is out of scope (see "Outcome and boundaries").

What works, and what to do:

- [x] **Hide Speak inside Decaid from the start.** *(Done in PR #43, merged 10 November 2026; simulator and CI, not on the tablet.)* Today Crema shows Speak, the first
  tap fails, then `noMicrophone()` hides it and suggests the keyboard. `window.decentApp`
  exists only in Decaid's WebView, where the microphone is always denied, so Crema can
  skip straight to the hint: "Tap the box, then the microphone on your keyboard." The
  keyboard (Gboard and similar) is a separate app with its own microphone permission, so
  its dictation works in the "Describe it" box and the text goes through the same
  identification as typing. Gemini's coffee-aware transcription is lost there, but the
  identify step already corrects misheard names. Settings' "Speaking a description" row
  should say the same inside Decaid. Test in `e2e-live.cjs` with a stand-in
  `decentApp`, as the dashboard-exit check does.
- [ ] **Optional: HTTPS for the Crema server** (homelab reverse proxy), so the phone app
  is a secure page and gets Speak with Gemini. Browsers allow the microphone only on
  https or localhost; the phone app is served over plain http on the LAN. Document it in
  `docs/install.md` when it's set up; no code change needed.
- [ ] **Optional: ask Decaid for an opt-in microphone for skins**, like the camera's
  per-skin Ask/Allow/Deny. It's a deliberate privacy choice, so a feature request, not a
  bug. The user would post it; Claude can draft it.

## Findings from the skin comparison (8–9 November 2026)

Crema, Streamline.js 0.2.23 and Insight 0.2.7 were compared screen by screen in desktop
Decaid 0.9.1 (macOS, `MockDe1` and `MockScale`). Crema was packaged from `e49b2a9` and
installed through `POST /api/v1/webui/skins/install/url`, and the served `app.js`
matched the commit byte for byte. Skins were switched with `PUT
/api/v1/webui/skins/default` and a restart of the skin server, then screenshotted
headless at 1340×800 and 390×844. One coffee (Haven Ethiopia Guji Gogogu, from "Describe
it") was identified and matched by the real AI server (codex-cli first), loaded, and
pulled from Crema's own buttons. Streamline's shot was started from its Coffee button.

The user has a private web page with the screenshots (Crema vs Streamline). It isn't in
this repo, and its screenshots were saved to a temporary folder, not to the repo. When
these items change, tell the user which parts of that page are out of date.

None of the bugs below reproduce in the demo or `dev/mock-decaid.ts`. They need a
machine recipe set by another skin, a real model's answer, or a slow AI reply. Bugs 1–3
were still present at `c59a538`.

### Bugs

1. **A page load adopts another skin's recipe over the coffee's own (phase 1,
   reconciliation; high).** Codex chose Adaptive v2, 18 → 40 g at 92 °C, and Crema
   stored it in the bean record (the shelf card showed it). Brew then showed the
   machine's leftover recipe from Streamline, Gentle and sweet at 18 → 36 g and 88 °C,
   still labelled "Chosen by codex-cli". Load wrote Gentle and sweet to the workflow,
   tagged with the Haven batch, and the shot ran on it. The after-shot "fast for this
   profile (28–36 s)" flag then used Adaptive v2's time window. Cause, from reading
   `reconcileWorkflow`: with `boot: true`, a machine recipe that has no `batchId` (set by
   Streamline or Decaid, which don't tag one) isn't treated as another coffee's, so it is
   adopted into `S.next`. `recipeSource` is left alone, so the label still names the AI.
   Fix: adopt only a recipe tagged with the current batch. Treat an untagged recipe like
   `otherCoffee` (keep Crema's recipe, toast that the machine has another one), and label
   an adopted recipe as set on the machine, not with the AI's name. Add an `e2e-live`
   case: the simulator holds an untagged recipe, the page reloads, and Brew must keep
   the bean's recipe.
2. **Profiles doesn't redraw when the AI's pick arrives (phase 2; medium).** "Save to
   shelf and match a profile" sets `#profiles` before `selectBean` has the
   recommendation, so `renderProfiles` draws the rules ranking only and never redraws.
   For five minutes it showed no AI pick, until the next visit. Fix: re-render Profiles
   (if it's the current view) when `selectBean`'s recommend call returns, and show
   "Asking the AI…" in the Recommended slot while it waits.
3. **A placeholder product photo is kept as the coffee's picture (phase 5; medium).** The
   model returned the roaster's Shopify `placeholder.jpg` as `imageUrl`. The server's
   download got a 404 (logged), but the URL stayed on the record, so the add review, the
   shelf card and the Brew card show a broken image. Fix: when the download fails, drop
   `imageUrl` and fall back to the bag photo or the initial tile. Also consider
   rejecting URLs whose path names a placeholder.
4. **Not a bug: "Bluetooth is turned off".** Crema's link-state banner reported Decaid's
   Bluetooth notice after the shot, and Streamline showed the same notice. Decaid on the
   Mac reports it because the Mac's Bluetooth is off, even with simulated devices. Both
   skins pass along what Decaid says, which is correct.

*Fixed 9 November 2026 (v0.1.1):*
- *Bug 1: a machine recipe is adopted only when it's recorded for the current bag;
  one with no bag (Streamline, Decaid's defaults) or another coffee's keeps the
  coffee's own recipe, marks it not loaded and says the machine has another one. An
  adopted recipe is labelled "As set on the machine", not with the AI's name, and the
  after-shot fast/slow flag only judges a shot against the time window of the profile
  it belongs to. `e2e-live.cjs`: an untagged recipe and a real reload keep the
  coffee's recipe (fails with the old rule). The earlier "after a reload" check from
  #16 didn't actually reload (a same-URL `goto` with another `#hash` keeps the page);
  both now call `page.reload()`.*
- *Bug 2: Profiles shows "Asking the AI to choose among these…" while the
  recommendation is pending and redraws when it arrives (`e2e-live.cjs`, with the
  recommend call delayed 2.5 s).*
- *Bug 3: the server drops placeholder-looking image URLs (`isPlaceholderImage`, from
  the model or the page metadata); saving a coffee whose photo the server can't fetch
  keeps no image link; and a picture that fails to load in the browser falls back to
  the initial tile (`artFailed`). Unit and `e2e-live.cjs` checks.*

### Improvements seen in Streamline

Not started. Each names the phase it fits. None blocks the tablet session.

1. **Name the running step, and offer skip-step (phase 2, profiles).** During a shot,
   Streamline shows the profile step ("rise and hold"), its countdown, a skip-step button,
   and step boundaries on the chart. Crema shows none of these. Check which snapshot
   field carries the step (`profileFrame`) and whether Decaid has a skip-step command
   before designing it.
2. **Say why the shot stopped (phase 2).** Streamline shows "Stopped by weight". Crema's
   after-shot panel could name weight, volume, time or the user.
3. **Show the profile's steps before choosing it (phase 2, profiles).** Streamline's
   selector previews each profile's step chart and notes. Crema's candidate cards could
   show a small step chart once installed Decaid profiles are the library (next session
   6).
4. **Hand off profile editing (phase 3, ownership).** Streamline's editor (step cards,
   script view, save as new) is its clearest lead over Crema. Prefer a tested hand-off
   to it over building an editor, alongside the Streamline Settings entry.
5. **One-tap preset strips for dose, yield and temperature (deferred product work).**
   Streamline puts a preset strip under each stepper. Crema has strips for steam, water
   and flush only. Check the tablet fit after any change.
6. ~~**Shots from other skins show as "Unknown coffee" (phase 2, history).**~~ The Streamline
   shot's workflow carried no bean. If Decaid records a `coffeeName` or batch in the
   shot's context, use it before falling back to "Unknown coffee". *Done: the coffee
   name, else the shelf coffee whose bag the shot recorded, else "No coffee recorded".*
7. **Capture Decaid's own screens next time (phase 7).** Its dashboard (devices, skins,
   plugins) wasn't captured: the window was on another macOS Space behind a full-screen
   app, so background clicks couldn't reach it. Doing this needs a short spell of
   full-screen control, or the tablet.

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
- Since then the whole phase 1 task list is done in software (#12–#19); see phase 1.

- [ ] Record the Decaid, Streamline and Streamline Settings release versions/commits
  inspected. Identify minimum supported capabilities from evidence, not guesses.
  Record the actual tablet/Android WebView versions when accessible; do not block
  local implementation on obtaining them.
  *Partly done: desktop Decaid 0.9.1 (build 3027, commit `14361a94`), Streamline.js
  0.2.23 and Insight 0.2.7 (skin comparison), and Decaid's and Streamline's `main` as
  read on 8–9 November 2026 are recorded where they were used. Still needed: the
  tablet's Decaid and Android WebView versions, and Streamline Settings' release.*
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
- [x] Exercise the skin in actual desktop Decaid using its supported development
  workflow when available. Keep hardware-free simulation explicitly identified.
  *Done: Decaid 0.9.1 on macOS with `MockDe1`, through live-edit, an installed
  package, and this repo's `skin/` served locally and pointed at `:8080`. Each finding
  says it was the simulated machine. See the phase 0 findings and the skin comparison.*

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
- [x] Prevent duplicate starts and overlapping preparation requests. A response
  failure/timeout must not result in an automatic retry of a machine-start command.
  *Done: a second start is ignored while one is preparing or until the machine
  reports it (`isStarting`), and a failed start only shows a toast; nothing retries
  (checked in the source, not by a test). Recipe loads now run one at a time
  (`loadChain`): each reads the screen when its turn comes, and one queued behind
  another is skipped if that one already left the recipe on the machine, so
  Espresso pressed during a manual load waits for it and the recipe is written once
  (`e2e-controls.cjs`; fails with the queue removed). Preset writes overlapping a
  start only touch steam, hot water or flush fields and are idempotent.*
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
- [x] **Reconcile the workflow instead of trusting `S.loaded`.** Re-read on boot
  (Decaid reloads a skin after 10 minutes in the background), visibility, focus,
  return from Decaid's dashboard, a slow timer and before a start. Compare the shown
  values; adopt an outside change and say so; don't repaint over an edit made in
  the last few hundred milliseconds; ignore our own echo.
  *Done: `machine.recipe()` in both backends normalizes the workflow to the panel's
  terms (profile, dose, yield, first-step temperature, grind, batch).
  `reconcileWorkflow` runs at boot, on `visibilitychange` and `focus`, on link-up,
  every 60 s while visible, and before an espresso start; never during a shot or
  while unlinked; reads time out after 4 s. Boot selects the coffee whose batch the
  machine holds, if it's on the shelf. A match marks the recipe loaded (a reload no
  longer asks to load a recipe the machine already has). A difference with unsaved
  edits on screen keeps them. A difference when the screen matched the machine is an
  outside change: for the same coffee (or none recorded) the panel takes the
  machine's values and a toast says so; for another coffee's batch the recipe is
  marked not loaded. Before a start nothing is adopted, so a difference makes the
  start load what the screen shows. Grind is a note, so a side without one isn't a
  difference, and numbers compare as numbers. A read that began before one of our
  own writes finished is dropped instead of an echo window (the workflow is Decaid's
  stored document, so there's no machine echo to wait out). `e2e-live.cjs` covers
  reload, adoption, unsaved edits, a start after an unnoticed change, another
  coffee, and boot picking the machine's coffee; on desktop Decaid 0.9.1
  `recipe()` reads the real workflow (its other cases need a Crema coffee there).*
- [x] **Socket ownership.** One owner per stream, close and silence before reopening,
  backoff with jitter, and cleanup so reconnects don't accumulate handlers. Reopening
  on link-up isn't needed on Decaid 0.9.1, which re-attached the sockets after a
  `MockDe1` reconnect; confirm after a real DE1 power cycle.
  *Done: the live adapter keeps one slot per stream; a replacement opens only after
  the old socket is closed and its handlers detached (no double frames, no false
  "disconnected"). Reconnects back off with jitter from 1 s to 15 s, reset after 5 s
  up. `subscribe` returns `{ close, reopenMachine }` in both backends. A closed
  machine socket clears the readings (the screen says it can't reach the machine
  instead of showing the last values); a closed devices socket makes the link
  unknown. As a fallback for a Decaid that doesn't re-attach, no reading for 15 s
  while the machine counts as linked reopens the machine sockets, at most every
  30 s, also checked when the page comes back into view. The simulator can freeze
  open machine sockets and count open sockets. `e2e-live.cjs` covers a frozen socket
  being reopened with no extra sockets left (and fails with the watchdog removed),
  Decaid going away (readings dropped, banner) and coming back (reconnects by itself,
  one socket per stream). Desktop Decaid 0.9.1's disconnect/reconnect still resumes
  on the same sockets, so the fallback doesn't fire there.*
- [x] **Bound API waits** and keep optional AI/recipe discovery from delaying machine
  telemetry and Stop availability. Reproduce before choosing the smallest change.
  *Reproduced: boot loaded settings, the shelf and a recipe (possibly an AI call)
  before subscribing to the machine streams, so with Decaid's bean list held for
  15 s the first reading and a usable Stop came at 15.7 s; a request that never
  answered had no limit at all. Done: boot subscribes first and shows the Brew
  screen at once (0.9 s in the same test); the controls column shows Stop even
  before presets load; every request has a limit (15 s for Decaid; identify 330 s,
  recommend and dial-in 120 s, transcribe 60 s, matching the server's own model
  limits); a shelf load that fails says "Couldn't load your coffees" with Try again
  instead of "No coffee yet", and "Loading your coffees…" shows meanwhile.
  `e2e-live.cjs` covers a slow bean list (readings and Stop in under 4 s) and one
  that never answers (gives up at 15 s, says so, Stop works, Try again recovers).
  The Shelf view itself still shows an empty list on a failed load (phase 2,
  "surface fetch failures").*
- [x] Handle missing/error/busy states using documented capabilities. Preserve
  group-head-controller use and stop-at-weight responsibility in Decaid.
  *Done: start buttons are disabled, and `startOp` refuses, in Decaid's not-ready
  states (asleep, needs water, error, booting, steam rinse, cleaning, descaling,
  transport mode, firmware update); heating and preheating are left to the DE1.
  Stop is never blocked. The error state gets a banner (with Open Decaid inside
  Decaid). Missing machine and link were handled earlier (#13, #18). The
  group-head setting and Decaid's stop-at-weight are unchanged. State names come
  from Decaid's API; which ones a real DE1 reports in each situation is unverified.*

Acceptance tests: delay a settings/profile response, press Stop, release it and
assert no start; double-tap start; load a recipe during a shot and assert nothing is
written until it ends; reject/time out a preparation write; disconnect the machine
while leaving its telemetry socket open; close/reopen sockets; resume the page;
change the workflow from a second client. The UI and effective recipe must agree,
and abandoned commands must never run after recovery.

## Phase 2 — profile and data correctness (R4–R7)

### Profiles

- [x] Populate the library from installed Decaid profiles, including custom ones.
  Treat the curated catalogue as optional recommendation metadata.
  *Done: `api.library()` (both backends) lists Decaid's installed espresso profiles,
  each with Crema's guide entry when the catalogue knows it. Profiles shows "N of M
  on this machine"; guide filters apply to known profiles; ones the guide doesn't
  know show Decaid's author, notes and step count and can be used, starting from the
  usual dose, the profile's target weight and first-step temperature. Guide entries
  that aren't installed are listed separately as not usable. Falls back to the guide
  if Decaid's profiles can't be read. The user has no custom profiles, so only the
  read path is covered; ranking still uses the guide.*
- [x] Use stable upstream IDs where available; handle duplicate titles and edited
  profiles. Preserve unsupported/unknown profile fields and full step semantics.
  *Done: recipes carry `profileId` from the library; `apply` loads by id when there
  is one, else by title; duplicates are shown with their author or id. Only
  temperatures and `target_weight` are changed on load.*
- [x] When no supported recommendation is available, say so and allow manual
  selection. Never present an uninstalled profile as an actionable recommendation.
  *Done: the rules fallback could recommend an uninstalled profile. The app now turns
  a recipe for an uninstalled profile into "no recommendation" (Brew says so with
  "Choose a profile"); candidate cards offer Use only for installed profiles ("Not on
  this machine" otherwise); and the server skips the model when no candidate is
  installed. No prompt change; the rules recommend eval matches its baseline (100%
  agreement on the profile).*
- [x] Keep applying temperature offsets across all steps. Test round trips of
  custom profiles with limits, exits and temperature curves, not only mock steps.
  *Done: unit tests on a hand-written profile in Decaid's shape (limits, exits,
  sensors, pumps, unknown fields): every step moves by the same amount and nothing
  else changes. `e2e-live.cjs` covers the library, using a profile outside the guide,
  the id picking between two same-title profiles, and the no-match path.*

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
- [x] Implement bounded pagination for inventory/maintenance and browsing. Fetch
  a pinned reference by its ID instead of searching only the latest 40 shots.
  *Done: counts page through Decaid's list 100 at a time and stop at `total`
  (`shotSummaries`; the echoed `limit` is never trusted), and the backflush count
  stops at the last backflush, since Decaid lists newest first (checked on 0.9.1).
  History loads 20 at a time with "Show more". The reference shot is fetched by id
  (`api.shot`).*
- [x] Respect the distinction between shot summaries and full measurements. Avoid
  fetching every full shot solely to count doses or display a history page.
  *Done: bag consumption and the backflush count use list summaries only. Full shots
  are fetched for the visible history page (for its charts), the reference, and the
  just-finished shot, instead of 40 full shots at each of those points.*
- [x] Surface fetch failures separately from empty history; verify the just-finished
  shot is available before attaching ratings/reference state to it.
  *Done: a failed history load says "Couldn't load your shots" with Try again; a bag
  whose shots can't be read shows remaining and shot count as unknown, not full; the
  backflush count shows "–". At a shot's start the app notes the newest shot id, and
  at the end waits (up to ~6 s) for a newer one before attaching the rating or
  reference; if Decaid hasn't saved it, the after-shot panel says so. The simulator
  now pages like Decaid (100 cap, echoed limit, offset) and can seed old shots.
  `e2e-live.cjs`: 130 extra shots counted per bag and for backflush, an old reference
  shown, 20-at-a-time history, failed history and bag counts, a slow save rated
  correctly, and an unsaved shot explained. Read-only check on desktop Decaid 0.9.1:
  paging, `total`, latest and by-id shots with measurements, a missing id as null.*

Acceptance: five stars writes the upstream maximum and reads back correctly; upstream
ratings display consistently; >100 shots are counted accurately; an old reference
loads; failed history requests do not imply zero consumption. Tests enforce real
pagination behaviour rather than the current permissive mock.

### Beans, batches and persistence

- [x] Make bag-specific state refer to a batch. Support two active bags of the same
  coffee with different roast dates, frozen state and remaining quantity.
  *Done: the shelf has one row per open Decaid batch (`key` = the batch, `id` = the
  coffee). Roast date, weight, frozen, remaining and shot count come from the bag;
  identification, recipe, reference shot and photos from the coffee, shared by its
  bags. Loading a recipe, recommending and dial-in pass the bag, so the workflow and
  history are the bag's. Shelf and Brew say "Bag 2 of 2" when there are several; the
  shelf has Another bag and Set what's left.*
- [x] Finishing one bag must not archive other bags. Buying a new bag must not
  silently discard the existing recipe or reference-shot association.
  *Done: finishing archives that batch; the coffee is archived only with its last
  open bag. Adding a coffee that's already known adds a bag and keeps the record's
  recipe, reference shot and photos (before, it reset them).*
- [x] Define the source of truth for remaining weight, including manual changes
  or consumption recorded through another skin; avoid double counting.
  *Decided: Decaid doesn't reduce `weightRemaining` on a shot (its
  `decrementBatchWeight` has no caller in the app; checked on `main`). So remaining =
  the bag's weight less the doses of espresso shots recorded against the bag (from
  any skin that records it), plus a correction. Crema writes the result to the
  batch's `weightRemaining` after each shot and remembers what it wrote; if the field
  has changed since (Decaid or another skin), that change becomes the correction
  instead of being overwritten. Set what's left sets the correction. Writes set a
  value rather than subtracting, so nothing is counted twice.*
- [x] Introduce versioned, idempotent migration of existing `bean:<id>` records.
  Preserve shared bean data, recipes, reference IDs and unknown fields where possible.
  Test interrupted migration/retry and document backup/rollback implications.
  *Not needed: Crema hasn't been installed anywhere with real data (confirmed with
  the user, 9 November 2026). The record format didn't change: per-bag state lives
  in Decaid's batches plus a new `bag:<batchId>` key, and old records (one coffee,
  one `batchId`) read as before; a coffee with no batch shows as one row.*
- [x] Check tablet/phone read-modify-write conflicts for settings and favourites;
  use upstream concurrency facilities if supported, otherwise document and minimize
  conflict behaviour rather than claiming atomic multi-client updates.
  *Decaid's key-value store has no conditional writes (no If-Match), so updates are
  last-writer-wins. Minimized: each bag's correction is its own key, apart from the
  coffee record that recipes are written to, and record patches re-read just before
  writing. Settings, favourites and presets are whole-object writes: if the tablet
  and a phone change them within the same moment, the later one wins.*
  *`e2e-live.cjs` covers the plan's acceptance case: add a second bag, freeze one,
  brew from each (the workflow records each bag), per-bag remaining written to
  Decaid, a change made elsewhere kept, set by hand, buying another bag through Add
  keeping the recipe and reference, another device seeing the same bags, finishing
  one bag (others stay) and the last (coffee leaves the shelf). Brew fits all five
  tablet sizes with a two-bag coffee.*

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
- [x] Add a dashboard exit using the supported host capability when available,
  with sensible browser-only behaviour. Distinguish the native dashboard from
  Streamline's settings and the separate Decaid settings plugin.
  *Done in software: Settings → Decaid → Open Decaid, tested with a stand-in host (see
  finding 1). Still to confirm in Decaid's WebView on the tablet (phase 7).*
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

**Re-scoped on 10 November 2026** (see "Code review and findings"). **Control logic done
in PR #44** (`server/control/`: reconcile, load-hold, snapshot-transition, start-gate
and bag-weight decisions, with vitest; merged 10 November 2026, simulator and CI, not
on the tablet). Later PRs added the new-row and shared-record modules there. Start with the logic that has no unit tests: move the start/stop,
load-hold, workflow-reconcile and bag-weight decisions into functions in `server/`
that take state and return what to do, shipped to the app through `skin/engine.js` and
tested by vitest. The Decaid adapter (`makeLiveApi`) is already the cleanest part of
`skin/app.js`, so extracting it comes after that, with shared types. The tasks below
still stand; this sets their order.

- [ ] Gradually separate the Decaid adapter, connection/control state, persisted
  schemas and UI views. Avoid changing unrelated visuals during extraction.
- [ ] Enforce the live/demo contract using shared types (TypeScript or checked
  JavaScript/JSDoc are both acceptable). Include relevant frontend code in checks.
  *Partly done: `e2e-live.cjs` compares the live and demo API objects' members, two
  levels deep, and fails on any one-sided member (one documented exception: the
  demo's `machine.refill()`). It catches a member added to one backend only; it
  doesn't check argument shapes or return types, which shared types would.*
- [ ] Validate external/persisted values at adapter boundaries and define migration
  versions. Keep pure recommendation logic in the shared engine, not copied into UI.
- [x] Define subscription cleanup and ownership so reconnects/navigation do not
  accumulate handlers. Keep fixtures and mocks exercising the same public contract.
  *Done with phase 1's socket ownership (#18): one slot per stream, close and detach
  before reopening, `subscribe` returns `{ close, reopenMachine }` in both backends;
  `e2e-live.cjs` checks one socket per stream after reconnects.*
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
- [x] Add a CI verification job and gate skin release/Pages publishing on applicable
  checks. Verify the generated engine before rebuilding it so drift is detected.
  Build and test the exact distributable files, including the extracted skin ZIP.
  *Done: `.github/workflows/ci.yml` runs on pull requests and pushes to `main`:
  `verify` (typecheck, `npm test` including engine freshness, skin syntax, built demo
  matches source, skin ZIP check), `ui` (the Playwright checks, screenshots kept on
  failure) and `docker` (image smoke test). `release.yml` and `pages.yml` call it
  first. The release path has run for v0.1.0, v0.1.1, v0.2.0, v0.3.0, v0.4.0 and v0.4.1.*
- [ ] Preserve root `index.html`, skin metadata, relative asset paths and semantic
  version tags. Include the actual project repository in release metadata where
  appropriate. Do not ship test tooling or credentials inside the skin.
  *Partly done: `scripts/check-skin-zip.mjs` unzips the package and fails on a missing
  root `index.html`, a bad manifest id or version (or one that doesn't match the tag),
  a missing or absolute asset path, a script that doesn't parse, or development files.
  The release workflow rejects tags that aren't semantic versions. Repository in the
  manifest: not done.*
- [x] Build/smoke-test the optional Docker server using mock AI; assert basic config,
  static skin delivery and permitted local proxy behaviour. Account-dependent AI
  provider smoke tests remain separate from ordinary CI and require no CI secrets.
  *Done: `scripts/docker-smoke.mjs` builds the image and runs it with the mock AI
  against the simulator: config, the web app and its scripts at `/`, the `/decaid/*`
  proxy, identification, a private photo URL refused, and a non-root user with a
  writable `/data`. CI's new `docker` job runs it and also builds the image with
  `AI_CLIS` (Claude Code and Codex) and checks both CLIs start; no secrets. Release
  and Pages run it too, through `ci.yml`.*
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

**User report, 10 November 2026:** the tablet has been upgraded in place through each
release to v0.4.1 and is used daily without problems. That covers install and upgrade
without losing records, espresso with stop at weight, tablet fit and touch, and
tablet-plus-phone use, as reported by the user rather than audited. The boxes below
stay unticked because this plan ticks only on recorded evidence; treat those four as
working. A supervised session is not planned, and agents should not ask for tablet
access unless the user offers it. What nobody has seen yet is listed under "Still
unverified on hardware".

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
The exception is AI shot review, which the user asked for (shot review, [shot-review-plan.md](shot-review-plan.md)).

## Upstream references

- [Decaid skin/API guide](https://github.com/decentespresso/decaid/blob/main/doc/Skins.md)
- [Streamline user manual](https://github.com/decentespresso/streamline-js#readme)
- [Streamline Settings plugin and integration instructions](https://github.com/decentespresso/streamline-setting#readme)
- [Decaid shot handling](https://github.com/decentespresso/decaid/blob/main/lib/src/services/webserver/shots_handler.dart)
- [Decaid workflow handling](https://github.com/decentespresso/decaid/blob/main/lib/src/services/webserver/workflow_handler.dart)

Read the selected upstream release rather than assuming `main` matches the tablet.
The external settings plugin is a proposed integration, not an already-installed
dependency or a verified replacement for every specialist screen.
