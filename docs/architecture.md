# Architecture

```
 DE1 tablet (Crema skin in Decaid) ──┐
                                     ├── REST + WebSocket ──► Decaid :8080 on the tablet ──BLE/USB──► DE1 + scale
 Phone (home-screen web app) ────────┘                          beans, profiles, workflow, shots,
          │                                                     key-value store (namespace "crema")
          │  optional: AI, when switched on
          └──► Crema server :8787 ──► LLM provider chain: claude-cli → codex-cli → anthropic-api → gemini-api
                  /api/*, and /decaid/* (proxy) when DECAID_URL is set
```

- **Decaid** owns the machine and scale connection. It stores beans, batches, grinders, profiles, the current workflow and shots, keeps a key-value store for skins, and serves REST and WebSocket APIs. Its docs: `doc/Skins.md` in [decentespresso/decaid](https://github.com/decentespresso/decaid). Its 74 bundled default profiles (`assets/defaultProfiles`) are the source of the profile catalog.
- **Web app** (`skin/`) is the UI on the tablet and phones. It talks to Decaid for everything, and to the Crema server only for AI.
- **Crema server** (`server/`) is optional and stateless. It identifies coffees, makes the AI profile choice and gives AI dial-in advice. When `DECAID_URL` is set, it also serves the app and proxies Decaid's REST API at `/decaid/*`, so a phone can open the app from the server.

## Connections (`discoverConnections` in app.js)

- **Crema server:** this page's own origin if `/api/config` answers with `crema: true`, otherwise the address saved on this device (`?server=…` or Settings → Connections), otherwise none.
- **Decaid:** through `/decaid` when the page came from a Crema server with `DECAID_URL` set; otherwise the saved address, or the page's own host on port 8080 (right for the skin served by Decaid). WebSockets always go to Decaid directly.
- If Decaid doesn't answer, the page runs the demo, with a Connect button when it's served over http. On a wide desktop window the demo opens in the device frame.
- On an https page (such as the hosted demo) with nothing saved, Decaid isn't probed, since a browser blocks http calls from https pages.

## Data

Visible live clients check the shelf every five seconds and on focus/resume, so a bag
added from a phone appears on an already-open tablet. The five-second check reads a
cheap signal (the open coffees, their open bags and the newest shot, which changes
whenever the shelf changes on another device) and reads the whole shelf only when it
differs. Crema's own records (recipe, photo, reference shot) are not in the signal, so
focus, the minute check and the end of a shot read in full, as does every poll while a
coffee that just appeared is still waiting for its recipe (up to about two minutes).
Reads do not overlap; failed background reads keep the last shelf, and refreshes retain
the selected bag and unsaved next-shot edits. “Brew this” selects a bag on that device;
loading its recipe onto the machine remains a separate action.

Records that several devices share (`settings`, `bean:<id>`) are never written from a
copy read earlier. Decaid's key-value store has no revisions, so each writer re-reads
the record right before writing and merges only the fields it changes
(`server/control/record.ts`). Other keys are per-device or written whole.

| What | Where |
|---|---|
| Beans, batches, profiles, workflow, shots, annotations | Decaid |
| Crema's record per bean: `info` (BeanInfo), `recipe`, `recipeSource`, `photo`, `productImage`, `art`, `bestShotId`, `finished`, `batchId` | Decaid KV `crema/bean:<beanId>` |
| `settings` (`aiEnabled`, `grindStart`, `grindStep`), `preferences`, `favourites[5]`, `presets`, `maintenance` | Decaid KV `crema/<key>` |
| Theme, device frame, saved server and Decaid addresses, group-head mode, screen saver | `localStorage` on each device |
| Cached roaster product photos | Crema server, `CREMA_IMAGES` |

Defaults for the KV entries are in `server/shared/defaults.ts`.

Coffee association is optional. The local `current` choice distinguishes an
intentional No bag selection from an empty/loading shelf; `baglessRecipe` remembers
that device's standalone next shot. Refresh/retry never auto-select a bag over
that choice. New favourites explicitly record whether they are bagless, their
installed profile id and manual mode; older favourites retain their behavior.

The installed library includes espresso profiles and Decaid's two GHC manual
profiles. Manual profiles remain excluded from recommendation candidates. Manual
selection requires `machine.info().GHC === true` and uses the installed step data,
not a generated paddle profile. Its initial zero weight target means manual stop;
an explicit weight target is optional and physical validation remains pending.

Every profile load, with or without a bag, goes through the same serialized,
mid-shot-gated path. Bagless loads explicitly clear coffee identity and grind
notes; omitted nullable context fields would retain stale Decaid values. Loads
reset the workflow's water-volume override to inherit the installed profile (or
disable it for the manual profiles). Reconciliation distinguishes same-title
profiles using their structure and relative temperature curve. The completed
shot's stored context determines inventory and reference/feedback attribution;
the next selected bag is never used to identify the shot just finished.

## The rules engine (`skin/engine.js`)

`server/engine.ts` re-exports the profile catalog, ranking, recipes, dial-in rules and defaults. `scripts/build-engine.mjs` bundles it with esbuild into `skin/engine.js`, a classic script that sets `window.CremaEngine`. The file is committed so the skin has no build step. `npm test` fails if it's stale; rebuild with `npm run build:engine`.

## Control and record logic (`server/control/`)

Decisions that used to sit inline in `skin/app.js` are pure functions here: they take
state and return what to do, and the app does the reading, writing, toasts and redraws.
They reach the browser through `server/engine.ts` and `skin/engine.js` (as `E.<name>`),
so they are tested by vitest without a DOM: `test/control.test.ts` for the control
modules and `test/record.test.ts` for the record merges.

| Module | Decides |
|---|---|
| `workflow.ts` | Whether the machine's recipe (read back from the workflow) matches the next-shot panel (`recipeMatches`, `sameGrind`), what to do about a difference (`reconcileOutcome`), and the patch that adopts the machine's recipe (`adoptPatch`) |
| `shot.ts` | Whether a shot is running (`shotRunning`: espresso, or the machine socket is down after dropping mid-shot, `S.shotAcross`), whether a recipe load is held, skipped or sent (`loadDecision`), and what a machine snapshot means given the previous one, including the end of a shot (`snapshotDecision`, `socketFrame`, `socketLost`) |
| `start.ts` | Whether a start may go ahead (`startGate`: already starting, machine unlinked, something running, machine not ready), what a start does first (`startSteps`), and how a start or stop settles (`startSettled`, `afterStartSent`) |
| `bag.ts` | How much of a bag is left: grams used from recorded shots, and Crema's correction when `weightRemaining` was changed elsewhere (`gramsUsed`, `bagRemaining`) |
| `shelf.ts` | Which shelf rows are new and still waiting for their recipe, so the poll reads in full (`trackNewRows`, `pruneNewRows`, `waitingForRecipe`) |
| `record.ts` | The patch for a shared-record write, merged into a fresh read (`mergeRecord`, `recommendPatch`, `saveBeanPatch`) |

The rest-window table is in `server/recommend/rules.ts` (`restOf`) and reaches the
shelf through the same bundle.

## The web app's API contract

`skin/app.js` talks to one object, `S.api`, with two implementations:
- `makeLiveApi(conn)` in `app.js`, backed by Decaid, the engine and the optional Crema server.
- `makeDemoApi()` in `demo.js`, backed by an in-browser simulated machine and `demo-data.js`.

Both must provide:

| Member | Purpose |
|---|---|
| `demo`, `info.{providers, voice, decaidUrl, server, serverError}` | Mode and display info |
| `ai.{available, enabled, on, healthy, voice}` | A server is connected; the switch is on; both; the last call succeeded; the server can transcribe voice notes |
| `settings.get()`, `settings.set(patch)` | `{aiEnabled, grindStart, grindStep}` |
| `shelf()` | Coffees on the shelf: `{id, batch, info, recipe, recipeSource, photo, productImage, art, weight, remaining, frozen, bestShotId, shots}` |
| `identify(input, onStep)` | Photos, a typed or spoken description, or a link → BeanInfo. Throws when AI is off |
| `transcribe(wav)` | A voice note (16 kHz mono WAV) → text, through the server's Gemini. The demo throws: it uses the browser's speech recognition |
| `saveBean(info, photo, art)` | Returns `{id}` |
| `setBeanState(id, {frozen?, finished?})`, `pinBest(id, shotId)` | Bag state and reference shot (`shotId` null removes it) |
| `recommend(beanId, {rulesOnly})` | `{recipe, candidates, source}`. `source` is the AI provider, `"rules"`, or `"rules (AI unavailable)"` |
| `rank(beanId)`, `catalog()` | Candidate ranking, profile catalog |
| `apply(beanId, recipe, grinderSetting, batchId)` | Load the recipe onto the machine; null bean id means No bag |
| `lastShotWith(title, profileShape?)` | The newest shot with the matching title and recorded profile shape, in full, or null. Its `points` carry the step number (`frame`, Decaid's `profileFrame`), which times the profile's graph |
| `shots(limit)`, `annotate(id, a)` | History (with `points` for charts), ratings and notes. Ratings are Decaid's `enjoyment`, 0–10, used as is (the UI shows half stars) |
| `review(shotId, feedback?)` | Recorded curves/profile and optional explicit taste → saved `{version, review, source, createdAt}`. Local checks work without AI; requests never apply settings. Stored in `annotations.extras.crema.review`; unrelated extras are preserved |
| `feedback(shotId, beanId, fb)` | `{advice, source}`, `source` provider id or `"rules"` |
| `prefs`, `favourites`, `presets`, `maintenance` | `get`/`set` (and `maintenance.done(kind)`); `set` returns the stored value |
| `machine.*` | `setState`, `tare`, `recipe`, `workflowSettings`, `settings`, `waterThreshold`, `presence`, `schedules`, `display`, `plugins`, `info`, `heartbeat`. `recipe()` is what the machine holds now, as `{profileTitle, doseG, yieldG, tempC, grind, batchId}` (the demo returns null until something is loaded); `workflowSettings` reads and writes only the workflow's `steamSettings`, `hotWaterData` and `rinseData` (never the profile); `settings` is left with fan and USB |
| `subscribe({snapshot, scale, water, ready, devices, lost})` | Live streams; returns `{close, reopenMachine}`. `lost("machine" \| "devices")` reports a closed stream (it reconnects with backoff). `devices` is Decaid's device list (`ws/v1/devices`, first answered by `GET /api/v1/devices`): the machine's link state and connection errors. The demo sends one "connected" frame |
| `host.{canExit, exitToDashboard()}` | Leave the skin for Decaid's dashboard. Live: `canExit` is true only when Decaid's WebView provides `window.decentApp.exitToDashboard`. Demo: always shown, and only explains itself |

Snapshots carry `state.state` and `state.substate`, pressure, flow, targets, temperatures and steam temperature. Shot end is detected by `finished` (from the demo) or by espresso → another state (live).

**Time limits:** every request has one: 15 s for Decaid, and for the Crema server identify 330 s, recommend and dial-in 120 s, transcribe 60 s. Boot subscribes to the machine streams before loading anything else, so readings and Stop never wait on the shelf or a recipe.

**AI fallback:** every call to the Crema server goes through `cremaCall`. A network error or 5xx marks the server unhealthy and fires a `crema:ai` event; the status bar then shows "AI offline" and the rules answer. The next successful call clears it.

## Decaid endpoints used

| Area | Endpoints |
|---|---|
| Machine | `GET /api/v1/machine/state`, `PUT /api/v1/machine/state/{idle\|sleeping\|espresso\|steam\|hotWater\|flush}`, `GET /api/v1/machine/info`, `POST /api/v1/machine/heartbeat` |
| Settings | `GET/PUT /api/v1/workflow` with only `steamSettings`, `hotWaterData` or `rinseData` (steam, hot water and flush: temperatures, durations, volume, flows; Decaid passes them to the machine), `GET/POST /api/v1/machine/settings` (fan, USB), `POST /api/v1/machine/waterLevels` |
| Scale | `PUT /api/v1/scale/tare` |
| Library | `/api/v1/beans`, `/api/v1/beans/{id}/batches`, `/api/v1/bean-batches/{id}`, `/api/v1/profiles`, `/api/v1/workflow` (profile + dose, yield, grinder setting, bean batch) |
| Shots | `GET /api/v1/shots?beanBatchId=`, `GET/PUT /api/v1/shots/{id}` (annotations) |
| Key-value store | `GET /api/v1/store/crema` (keys), `GET/POST/DELETE /api/v1/store/crema/{key}` |
| Presence and display | `/api/v1/presence/settings`, `/api/v1/presence/schedules[/{id}]`, `/api/v1/display`, `PUT /api/v1/display/brightness` |
| Plugins | `GET /api/v1/plugins` (Visualizer upload, Time To Ready, Decent Profile Generator) |
| WebSockets | `ws/v1/machine/snapshot`, `ws/v1/scale/snapshot`, `ws/v1/machine/waterLevels`, `ws/v1/devices`, `ws/v1/plugins/time-to-ready.reaplugin/timeToReady` |
| Devices | `GET /api/v1/devices` (first answer before the devices socket speaks) |

`dev/mock-decaid.ts` implements all of these, and `demo.js` implements the same behaviour in the browser.

## Crema server

- **Routes** (`server/app.ts`) are listed in the README. Every body is validated with Zod; a validation error is a 400. `/api/*` answers cross-origin calls only from the server's own origin, `http://` pages on port 3000 (Decaid serving the skin on the tablet), `localhost`, and anything in `CORS_ORIGINS`; other browser origins get 403. `/api/identify` accepts at most four photos of 20 MB each (413 or 400 beyond that), and `/api/transcribe` has a body limit. Results say which provider answered. Unexpected errors return a generic 500 and the detail goes to the server log.
- **Product photos** (`server/images.ts`) are read from the roaster page's Open Graph, JSON-LD or Twitter metadata, and `/api/images/cache` keeps a copy. Fetches go through `server/safe-fetch.ts`: only public addresses, checked after DNS resolution and again on every redirect before it's requested, with one 12 s deadline and an 8 MB limit enforced while streaming.
- **LLM chain** (`server/llm/`): each provider implements `structured(req)` and returns Zod-validated output. The chain falls through to the next provider on failure. The CLI providers run the official `claude` and `codex` CLIs headless, so calls bill to whichever account is logged in on the host. That suits a personal installation; shared deployments should use API keys.

## Recommendation pipeline

```
BeanInfo ──► rules baseline (roast, rest, grind hint)                         ┐
        └──► rankProfiles(catalog, bean, preferences, installed titles)       │ in the browser
                 score: roast fit, milk/straight, tasting-note traits, process, │ (skin/engine.js)
                        blend, altitude, scale/burrs/experience, popularity     │
                 per candidate: recipe from the profile's own recipe ± roast    │
                        temperature offset, or the roaster's published recipe   ┘
        └──► with AI on: the server's LLM picks one of the top 6 installed candidates,
             with reasons, dial-in and alternatives. Otherwise, or if it fails, the top-ranked one.
```

`docs/investigation.md` has the reasoning, plus real results for nine ONA and Haven coffees.

## Shot review

`server/profiles/analysis.ts` computes conservative observations from recorded
samples; `server/recommend/review-local.ts` supplies local advice. Both are bundled
into the browser engine. `POST /api/review` validates a bounded `ReviewInput`, calls
the provider chain and returns `{review, source}` with rules fallback. The model
receives sampled curves, the recorded profile, observations and bounded earlier-shot
context. Missing measurements/taste are null. Suggested changes are advisory only.

Saved reviews use version 1 at `annotations.extras.crema.review` and carry creation
time and source. Reopening a shot reads that value without making an AI call;
Review again explicitly replaces it. Chart shading and follow-up chat are deferred.
The legacy `/api/dialin` now also returns source so provider failures cannot be
mislabelled as AI answers.

## Packaging

- `scripts/package-skin.mjs` → `dist/crema-skin.zip`, with `index.html` at the root and a `manifest.json` (skin id `crema`, version from `package.json`).
- `.github/workflows/release.yml` builds that ZIP and attaches it to a GitHub release on every `v*` tag.
- `Dockerfile` and `docker-compose.yml` run the server. See `docs/install.md`.

## Demo and publishing pipeline

```
scripts/seed-samples.ts  (real AI identify) ──► samples/beans.json
scripts/seed-recipes.ts  (real AI recommend) ──► samples/recipes.json
scripts/build-demo-data.ts ──► skin/demo-data.js   (adds bag facts, packshot colours, rankings)
scripts/build-demo.mjs ──► demo/crema-demo.html    (single-file demo, embeddable as one page)
scripts/screenshots.cjs ──► docs/screenshots/*     (and boxes.json for walkthrough highlights)
scripts/build-site.mjs ──► _site/  ──(pages.yml on push)──► https://<owner>.github.io/<repo>/
scripts/record-walkthrough.cjs ──► docs/media/walkthrough.webp (README) and .mp4
```

`demo/walkthrough.html` embeds the highlight boxes from `docs/screenshots/boxes.json` as a `BOXES` constant. If the screenshots change layout, update that constant.
