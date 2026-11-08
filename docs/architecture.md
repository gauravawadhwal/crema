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

| What | Where |
|---|---|
| Beans, batches, profiles, workflow, shots, annotations | Decaid |
| Crema's record per bean: `info` (BeanInfo), `recipe`, `recipeSource`, `photo`, `productImage`, `art`, `bestShotId`, `finished`, `batchId` | Decaid KV `crema/bean:<beanId>` |
| `settings` (`aiEnabled`), `preferences`, `favourites[5]`, `presets`, `maintenance` | Decaid KV `crema/<key>` |
| Theme, device frame, saved server and Decaid addresses, group-head mode, screen saver | `localStorage` on each device |
| Cached roaster product photos | Crema server, `CREMA_IMAGES` |

Defaults for the KV entries are in `server/shared/defaults.ts`.

## The rules engine (`skin/engine.js`)

`server/engine.ts` re-exports the profile catalog, ranking, recipes, dial-in rules and defaults. `scripts/build-engine.mjs` bundles it with esbuild into `skin/engine.js`, a classic script that sets `window.CremaEngine`. The file is committed so the skin has no build step. `npm test` fails if it's stale; rebuild with `npm run build:engine`.

## The web app's API contract

`skin/app.js` talks to one object, `S.api`, with two implementations:
- `makeLiveApi(conn)` in `app.js`, backed by Decaid, the engine and the optional Crema server.
- `makeDemoApi()` in `demo.js`, backed by an in-browser simulated machine and `demo-data.js`.

Both must provide:

| Member | Purpose |
|---|---|
| `demo`, `info.{providers, voice, decaidUrl, server, serverError}` | Mode and display info |
| `ai.{available, enabled, on, healthy, voice}` | A server is connected; the switch is on; both; the last call succeeded; the server can transcribe voice notes |
| `settings.get()`, `settings.set(patch)` | `{aiEnabled}` |
| `shelf()` | Coffees on the shelf: `{id, batch, info, recipe, recipeSource, photo, productImage, art, weight, remaining, frozen, bestShotId, shots}` |
| `identify(input, onStep)` | Photos, a typed or spoken description, or a link → BeanInfo. Throws when AI is off |
| `transcribe(wav)` | A voice note (16 kHz mono WAV) → text, through the server's Gemini. The demo throws: it uses the browser's speech recognition |
| `saveBean(info, photo, art)` | Returns `{id}` |
| `setBeanState(id, {frozen?, finished?})`, `pinBest(id, shotId)` | Bag state and reference shot |
| `recommend(beanId, {rulesOnly})` | `{recipe, candidates, source}`. `source` is the AI provider, `"rules"`, or `"rules (AI unavailable)"` |
| `rank(beanId)`, `catalog()` | Candidate ranking, profile catalog |
| `apply(beanId, recipe, grinderSetting)` | Load the recipe onto the machine |
| `shots(limit)`, `annotate(id, a)` | History (with `points` for charts), ratings and notes |
| `feedback(shotId, beanId, fb)` | `{advice, source}`, `source` `"ai"` or `"rules"` |
| `prefs`, `favourites`, `presets`, `maintenance` | `get`/`set` (and `maintenance.done(kind)`); `set` returns the stored value |
| `machine.*` | `setState`, `tare`, `shotSettings`, `settings`, `waterThreshold`, `presence`, `schedules`, `display`, `plugins`, `info`, `heartbeat` |
| `subscribe({snapshot, scale, water, ready})` | Live streams |

Snapshots carry `state.state` and `state.substate`, pressure, flow, targets, temperatures and steam temperature. Shot end is detected by `finished` (from the demo) or by espresso → another state (live).

**AI fallback:** every call to the Crema server goes through `cremaCall`. A network error or 5xx marks the server unhealthy and fires a `crema:ai` event; the status bar then shows "AI offline" and the rules answer. The next successful call clears it.

## Decaid endpoints used

| Area | Endpoints |
|---|---|
| Machine | `GET /api/v1/machine/state`, `PUT /api/v1/machine/state/{idle\|sleeping\|espresso\|steam\|hotWater\|flush}`, `GET /api/v1/machine/info`, `POST /api/v1/machine/heartbeat` |
| Settings | `GET/POST /api/v1/machine/shotSettings` (steam temp and duration, hot water temp and volume), `GET/POST /api/v1/machine/settings` (flows, flush time and temp, fan, USB), `POST /api/v1/machine/waterLevels` |
| Scale | `PUT /api/v1/scale/tare` |
| Library | `/api/v1/beans`, `/api/v1/beans/{id}/batches`, `/api/v1/bean-batches/{id}`, `/api/v1/profiles`, `/api/v1/workflow` (profile + dose, yield, grinder setting, bean batch) |
| Shots | `GET /api/v1/shots?beanBatchId=`, `GET/PUT /api/v1/shots/{id}` (annotations) |
| Key-value store | `GET /api/v1/store/crema` (keys), `GET/POST/DELETE /api/v1/store/crema/{key}` |
| Presence and display | `/api/v1/presence/settings`, `/api/v1/presence/schedules[/{id}]`, `/api/v1/display`, `PUT /api/v1/display/brightness` |
| Plugins | `GET /api/v1/plugins` (Visualizer upload, Time To Ready, Decent Profile Generator) |
| WebSockets | `ws/v1/machine/snapshot`, `ws/v1/scale/snapshot`, `ws/v1/machine/waterLevels`, `ws/v1/plugins/time-to-ready.reaplugin/timeToReady` |

`dev/mock-decaid.ts` implements all of these, and `demo.js` implements the same behaviour in the browser.

## Crema server

- **Routes** (`server/app.ts`) are listed in the README. Every body is validated with Zod; a validation error is a 400. CORS is open on `/api/*` so the skin, served from the tablet, can call it.
- **Product photos** (`server/images.ts`) are read from the roaster page's Open Graph, JSON-LD or Twitter metadata, and `/api/images/cache` keeps a copy. Only public hosts are fetched (no LAN or reserved names).
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
