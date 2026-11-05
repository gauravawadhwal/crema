# Architecture

```
 iPhone (Safari, home screen) ─┐
                               ├─ HTTP ─► Crema server :8787 ──► LLM provider chain
 DE1 tablet (Decaid skin) ─────┘           │  /api/*        claude-cli → codex-cli → anthropic-api → gemini-api
          │                                │  /decaid/* (proxy)
          │                                ▼
          └──────── WebSocket ─────► Decaid :8080 on the tablet ──BLE/USB──► DE1 + scale
```

- **Decaid** owns the machine and scale connection. It stores beans, batches, grinders, profiles, the current workflow and shots, and it serves REST and WebSocket APIs. Its docs: `doc/Skins.md` in [tadelv/reaprime](https://github.com/tadelv/reaprime). Its 74 bundled default profiles (`assets/defaultProfiles`) are the source of the profile catalog.
- **Crema server** (`server/`) adds coffee identification, profile recommendation, dial-in advice and a few stores Decaid lacks. It also proxies Decaid's REST API at `/decaid/*`, so the phone can control the machine from the same origin.
- **Web app** (`skin/`) is the UI on both devices. It calls the Crema server for `/api/*`, calls Decaid's REST API through `/decaid/*`, and opens Decaid's WebSockets directly.

## The web app's API contract

`skin/app.js` talks to one object, `S.api`, with two implementations:
- `makeLiveApi(cfg, health)` in `app.js`, backed by the Crema server and Decaid.
- `makeDemoApi()` in `demo.js`, backed by an in-browser simulated machine and `demo-data.js`.

The app picks live when `/api/config` answers and demo otherwise (or with `?demo`). Both must provide:

| Member | Purpose |
|---|---|
| `demo`, `info.providers`, `info.decaidUrl` | Mode and display info |
| `shelf()` | Coffees on the shelf: `{id, batch, info, recipe, recipeSource, photo, productImage, art, weight, remaining, frozen, bestShotId, shots}` |
| `identify(input, onStep)` | Photo, search or link → BeanInfo |
| `saveBean(info, photo, art)` | Returns `{id}` |
| `setBeanState(id, {frozen?, finished?})`, `pinBest(id, shotId)` | Bag state and reference shot |
| `recommend(beanId, {rulesOnly})`, `rank(beanId)`, `catalog()` | Recipe, candidate ranking, profile catalog |
| `apply(beanId, recipe, grinderSetting)` | Load the recipe onto the machine |
| `shots(limit)`, `annotate(id, a)`, `feedback(shotId, beanId, fb)` | History (with `points` for charts), ratings and notes, dial-in advice |
| `prefs`, `favourites`, `presets`, `maintenance` | `get`/`set` (and `maintenance.done(kind)`) |
| `machine.*` | `setState`, `tare`, `shotSettings`, `settings`, `waterThreshold`, `presence`, `schedules`, `display`, `plugins`, `info`, `heartbeat` |
| `subscribe({snapshot, scale, water, ready})` | Live streams |

Snapshots carry `state.state` and `state.substate`, pressure, flow, targets, temperatures and steam temperature. Shot end is detected by `finished` (from the demo) or by espresso → another state (live).

## Decaid endpoints used

| Area | Endpoints |
|---|---|
| Machine | `GET /api/v1/machine/state`, `PUT /api/v1/machine/state/{idle\|sleeping\|espresso\|steam\|hotWater\|flush}`, `GET /api/v1/machine/info`, `POST /api/v1/machine/heartbeat` |
| Settings | `GET/POST /api/v1/machine/shotSettings` (steam temp and duration, hot water temp and volume), `GET/POST /api/v1/machine/settings` (flows, flush time and temp, fan, USB), `POST /api/v1/machine/waterLevels` |
| Scale | `PUT /api/v1/scale/tare` |
| Library | `/api/v1/beans`, `/api/v1/beans/{id}/batches`, `/api/v1/bean-batches/{id}`, `/api/v1/profiles`, `/api/v1/workflow` (profile + dose, yield, grinder setting, bean batch) |
| Shots | `GET /api/v1/shots?beanBatchId=`, `GET/PUT /api/v1/shots/{id}` (annotations) |
| Presence and display | `/api/v1/presence/settings`, `/api/v1/presence/schedules[/{id}]`, `/api/v1/display`, `PUT /api/v1/display/brightness` |
| Plugins | `GET /api/v1/plugins` (Visualizer upload, Time To Ready, Decent Profile Generator) |
| WebSockets | `ws/v1/machine/snapshot`, `ws/v1/scale/snapshot`, `ws/v1/machine/waterLevels`, `ws/v1/plugins/time-to-ready.reaplugin/timeToReady` |

`dev/mock-decaid.ts` implements all of these, and `demo.js` implements the same behaviour in the browser.

## Crema server

- **Routes** are listed in the README. `app.ts` handles identification, beans, the shelf, recommendations, applying recipes, shots and feedback. `home.ts` handles the proxy, preferences, favourites, presets, reference shots, bag state, maintenance and the catalog.
- **Store** (`server/store.ts`): one JSON file (`CREMA_DATA`, default `data/crema.json`), written atomically. Keyed by Decaid bean id, it holds `info` (BeanInfo), `recipe`, `photo`, `productImage`, `art`, `bestShotId` and `finished`, plus `preferences`, `favourites[5]`, `presets` and `maintenance`.
- **Product photos** (`server/images.ts`) are read from the roaster page's Open Graph, JSON-LD or Twitter metadata and cached in `data/images`. Only public hosts are fetched (no LAN or reserved names).
- **LLM chain** (`server/llm/`): each provider implements `structured(req)` and returns Zod-validated output. The chain falls through to the next provider on failure. The CLI providers run the official `claude` and `codex` CLIs headless, so calls bill to the owner's subscription; that's for personal use only.

## Recommendation pipeline

```
BeanInfo ──► rules baseline (roast, rest, grind hint)
        └──► rankProfiles(catalog, bean, preferences, installed titles)
                 score: roast fit, milk/straight, tasting-note traits, process, blend, altitude,
                        scale/burrs/experience, popularity, installed
                 per candidate: recipe from the profile's own recipe ± roast temperature offset,
                                or the roaster's published recipe on conventional profiles
        └──► LLM picks one of the top 6 installed candidates, with reasons, dial-in and alternatives
             (falls back to the top-ranked candidate)
```

`docs/investigation.md` has the reasoning, plus real results for nine ONA and Haven coffees.

## Demo and publishing pipeline

```
scripts/seed-samples.ts  (real AI identify) ──► samples/beans.json
scripts/seed-recipes.ts  (real AI recommend) ──► samples/recipes.json
scripts/build-demo-data.ts ──► skin/demo-data.js   (adds bag facts, packshot colours, rankings)
scripts/build-demo.mjs ──► demo/crema-demo.html    (single-file fragment for Claude artifacts)
scripts/screenshots.cjs ──► docs/screenshots/*     (and boxes.json for walkthrough highlights)
scripts/build-site.mjs ──► _site/  ──(pages.yml on push)──► https://gauravawadhwal.github.io/crema/
scripts/record-walkthrough.cjs ──► docs/media/walkthrough.webp (README) and .mp4
```

`demo/walkthrough.html` embeds the highlight boxes from `docs/screenshots/boxes.json` as a `BOXES` constant. If the screenshots change layout, update that constant.
