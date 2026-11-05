# Crema

A custom home screen and companion app for the **Decent DE1** espresso machine.

It runs on the DE1's tablet in place of the stock Decent interface, and the same app works on your phone. It identifies coffees from a photo of the bag, picks a community espresso profile to suit each one, and helps you dial it in shot by shot.

[![A walkthrough of Crema: the home screen, adding a bag, the matched profile, pulling and rating a shot, steaming milk, the shelf, settings, the iPhone app and the themes](docs/media/walkthrough.webp)](https://gauravawadhwal.github.io/crema/)

**[▶ Play the interactive walkthrough](https://gauravawadhwal.github.io/crema/)** · **[Try the full demo](https://gauravawadhwal.github.io/crema/app/)** (a simulated DE1, right in your browser) · [MP4 video](docs/media/walkthrough.mp4)

## What it is, in plain terms

- **The DE1** is an espresso machine with an Android tablet mounted on it. The tablet runs the machine's interface.
- **Decaid** is Decent's open-source app on that tablet. It talks to the machine and scale over Bluetooth, stores your coffees, profiles and shots, and lets anyone build their own interface as a web page (a "skin").
- **Crema** is such a skin, plus a small server at home:
  - The skin is the interface you touch: machine controls, live shot chart, coffee shelf, profiles, shot history and settings. It controls the machine through Decaid.
  - The server identifies coffees and chooses profiles with an LLM (a Claude or ChatGPT subscription via their CLIs, or an API key). It also keeps favourites, presets and maintenance reminders.
- **On a phone** it's the same web app, added to the home screen from the browser. There's no app store app.

## Screenshots

All from the demo: a 1340 × 800 landscape tablet (the DE1 tablet size) and an iPhone. The sample coffees are publicly listed ONA and Haven coffees identified by Crema's AI pipeline. The machine is simulated.

| | |
|---|---|
| ![Home screen](docs/screenshots/tablet-home.png) **Home screen.** The next shot with its matched profile and recipe, the live chart, and the machine controls. | ![After a shot](docs/screenshots/tablet-after-shot.png) **After a shot.** Metrics, a too-fast/slow check for the profile, taste feedback and the next adjustment. |
| ![Profiles](docs/screenshots/tablet-profiles.png) **Profiles.** The AI's pick for this coffee with its reasons, the rules' ranking, and 31 community profiles. | ![Add a coffee](docs/screenshots/tablet-add-coffee.png) **Add a coffee.** Every fact is tagged as from the bag, the web, or a guess to check. |
| ![Shelf](docs/screenshots/tablet-shelf.png) **Shelf.** Rest window, grams left and a reorder nudge for each bag. | ![Shots](docs/screenshots/tablet-shots.png) **Shots.** History with metrics, and one shot overlaid on another. |
| ![Steam](docs/screenshots/tablet-steam.png) **Steam.** Jug presets, a countdown and a big Stop button. | ![Settings](docs/screenshots/tablet-settings.png) **Settings.** Your setup, steam and water, wake schedules, display and maintenance. |

<p>
  <img src="docs/screenshots/phone-home.png" width="250" alt="iPhone: home">
  <img src="docs/screenshots/phone-shelf.png" width="250" alt="iPhone: shelf">
  <img src="docs/screenshots/phone-profiles.png" width="250" alt="iPhone: profiles">
</p>

**On a phone:** the same app, laid out for a narrow screen.

Regenerate these with `node scripts/screenshots.cjs` (needs Playwright). `node scripts/check-tablet-fit.cjs` checks that the home screen fits the tablet without scrolling: at 1340 × 800 and the scaled sizes Android may use, with and without the navigation bar, before and after a shot.

## Themes

Six themes, chosen in Settings → Display and remembered per device. The layout stays flat and the chart colours stay readable in every one.

| | | |
|---|---|---|
| ![Crema](docs/screenshots/theme-crema.png) **Crema.** Roasted brown and crema gold. Follows light or dark. | ![Rosso](docs/screenshots/theme-rosso.png) **Rosso.** Italian bar-machine red lacquer on polished steel. | ![Acciaio](docs/screenshots/theme-acciaio.png) **Acciaio.** Industrial black and steel, like the DE1 itself. |
| ![Nordic](docs/screenshots/theme-nordic.png) **Nordic.** A light-roast café: birch, ink and fjord blue. | ![Verde](docs/screenshots/theme-verde.png) **Verde.** Vintage Italian café green and brass. | ![Notte](docs/screenshots/theme-notte.png) **Notte.** True black and dim amber for the first shot of the day. |

## The demo site

The [demo site](https://gauravawadhwal.github.io/crema/) is built from this repo and deployed to GitHub Pages by `.github/workflows/pages.yml` on every push to `main`. In a fork, enable Pages (Settings → Pages → Source: GitHub Actions) to get your own copy:
- `/` is the walkthrough (`demo/walkthrough.html`).
- `/app/` is the full app (`skin/`). With no Crema server to talk to, it runs its built-in demo with a simulated DE1 and scale. On a desktop it opens inside a frame at the tablet's exact screen size (1340 × 800, scaled to fit), with a toggle for the phone layout and a link to open it full window. On a phone it fills the screen as usual.

To build it locally, run `node scripts/build-site.mjs`; the site goes in `_site/`. The README animation and the MP4 are recorded from the walkthrough.

## Features

- **A full home screen for the machine.** It has Espresso, Steam, Hot water, Flush and Stop with presets, live pressure, flow, weight and temperature with profile targets, a reference-shot overlay, five favourites, the water tank, the scale, sleep and wake, and "ready in N minutes". It fits a 1340 × 800 tablet in one screen. See [docs/parity.md](docs/parity.md) for the full comparison with the Decent app.
- **Add a coffee** by photographing the bag, searching, or pasting the roaster's link. Crema reads the bag (including the roast date), finds the roaster's page and product photo, and tags every fact with where it came from.
- **Profile recommendations from the coffee's description.** It ranks 31 community profiles (Adaptive, D-Flow, A-Flow, Londonium, Extractamundo Dos, allongés, turbo shots and more, described from their authors' own notes) against what the roaster and bag say. It also takes your setup into account (milk or straight, scale, burrs, experience). The AI then picks one and explains why in plain words.
- **Dial in**: rate a shot (sour ↔ bitter, thin ↔ heavy, stars) and get the one change to make next. Shots outside the profile's time window are flagged.
- **Shelf**: rest window, grams left (from shot doses), reorder nudges, freeze and finish.
- **Shots**: history with metrics, side-by-side comparison, ratings and notes.
- **Settings**: your setup, steam, water and flush, machine, wake schedules, display, and descale and backflush reminders.
- **Six themes**: Crema, Rosso, Acciaio, Nordic, Verde and Notte (see below).

Research and design decisions: [docs/investigation.md](docs/investigation.md).

## How it fits together

```
 Phone (home-screen web app) ──┐
                               ├──► Crema server :8787 ──► AI provider chain
 DE1 tablet (Decaid skin) ─────┘        │                    claude-cli → codex-cli → gemini-api …
          │                             ▼
          └────── WebSocket ──────► Decaid :8080 (on the tablet) ──BLE──► DE1 + scale
```

- **Decaid** is the open-source app on the DE1 tablet (formerly REA / Streamline Bridge). It owns the machine connection and stores beans, profiles and shots.
- **Crema server** (`server/`, Node + TypeScript) runs on any always-on machine on the same network, such as a home server, a Raspberry Pi or a Home Assistant host. That's where the Claude or Codex CLI is logged in. It adds identification, recipes and dial-in on top of Decaid's API.
- **Web app** (`skin/`): the tablet skin, the phone companion and a self-contained demo, all in one.

## Try it without a machine

```bash
npm install
```

```bash
npm run mock:decaid
```

```bash
LLM_PROVIDERS=mock npm start
```

Then open http://localhost:8787 in a browser. Pull a simulated shot with:

```bash
curl -X PUT localhost:8080/api/v1/machine/state/espresso
```

Opening `skin/index.html?demo` straight from disk runs a fully in-browser demo with a simulated DE1. Its coffees are nine publicly listed ONA and Haven coffees identified by the real pipeline (`samples/beans.json`), and its recommendations come from real AI runs (`samples/recipes.json`). Rebuild them (this makes AI calls) with:

```bash
LLM_PROVIDERS=claude-cli npx tsx scripts/seed-samples.ts
```

```bash
LLM_PROVIDERS=claude-cli npx tsx scripts/seed-recipes.ts
```

```bash
npx tsx scripts/build-demo-data.ts && node scripts/build-demo.mjs
```

## Using real AI

Pick the providers in order of preference. Crema falls through to the next if one fails or hits a usage limit:

```bash
LLM_PROVIDERS=claude-cli,codex-cli npm start
```

| Provider | Setup on the host | Billed to |
|---|---|---|
| `claude-cli` | `npm i -g @anthropic-ai/claude-code`, then `claude setup-token` and export `CLAUDE_CODE_OAUTH_TOKEN` | Claude Pro/Max |
| `codex-cli` | `npm i -g @openai/codex`, then `codex login` | ChatGPT Plus/Pro |
| `anthropic-api` | `ANTHROPIC_API_KEY` | per token |
| `gemini-api` | `GEMINI_API_KEY` (optional `GEMINI_MODEL`) | per token / free tier |

Subscription CLIs suit a personal installation; use API keys for anything shared. Smoke-test a provider with a search (no photo needed):

```bash
curl -F query="Square Mile Red Brick" localhost:8787/api/identify
```

## Pointing at a real DE1

```bash
DECAID_URL=http://<tablet-ip>:8080 LLM_PROVIDERS=claude-cli npm start
```

- **Phone:** open `http://<server-ip>:8787` in the browser, then add it to the home screen (Safari: Share → Add to Home Screen).
- **Tablet skin:** package `skin/` as a Decaid skin (see Decaid's `doc/Skins.md`). It needs to know the Crema server's address; this is on the roadmap.

## Configuration

All configuration is through environment variables on the Crema server. Nothing deployment-specific lives in the repo.

| Variable | Default | Purpose |
|---|---|---|
| `DECAID_URL` | `http://localhost:8080` | Decaid on the DE1 tablet |
| `PORT`, `HOST` | `8787`, `0.0.0.0` | Where the Crema server listens |
| `LLM_PROVIDERS` | `claude-cli,codex-cli` | Provider order: `claude-cli`, `codex-cli`, `anthropic-api`, `gemini-api`, `mock` |
| `CLAUDE_BIN`, `CLAUDE_CLI_MODEL` | `claude`, `opus` | Claude Code CLI binary and model |
| `CODEX_BIN`, `CODEX_MODEL` | `codex`, the CLI's default | Codex CLI binary and model |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | none, `claude-opus-5-5` | Anthropic API provider |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | none, `gemini-2.5-flash` | Gemini API provider |
| `CREMA_DATA` | `data/crema.json` | Crema's own store (gitignored) |
| `CREMA_IMAGES` | `data/images` | Cached roaster product photos (gitignored) |

## API

| Method | Path | Does |
|---|---|---|
| `POST` | `/api/identify` | multipart `images[]`, `query`, `url`, `offline` → coffee record (not saved) |
| `POST` | `/api/beans` | save a confirmed record → Decaid bean + batch |
| `GET` | `/api/shelf` | beans, batches, records and rest status |
| `POST` | `/api/beans/:id/image` | `{lookup: true}` re-find the roaster's photo, `{url}` use a specific image, `{art: "product"\|"photo"}` pick which to show |
| `GET` | `/api/images/:file` | cached roaster product photos |
| `POST` | `/api/recommend` | `{beanId}` → recipe (rules + AI) |
| `POST` | `/api/apply` | `{beanId, recipe?}` → sets the workflow on the machine |
| `GET` | `/api/shots`, `/api/shots/:id` | shot history |
| `POST` | `/api/shots/:id/feedback` | taste feedback → annotation + next adjustment |
| `GET` | `/api/health`, `/api/config` | provider chain, machine state, WebSocket URL |
| `GET` | `/api/profiles/catalog` | community profile catalog, marked installed or not |
| `GET` | `/api/profiles/rank/:beanId` | rules ranking for a coffee (instant, no AI) |
| `GET/PUT` | `/api/preferences` | your setup: drink, scale, burrs, experience, basket |
| `GET/PUT` | `/api/favourites`, `/api/favourites/:slot` | five favourite slots |
| `GET/PUT` | `/api/presets` | steam, hot water and flush presets |
| `PUT` | `/api/beans/:id/best-shot`, `/api/beans/:id/state` | reference shot; freeze, thaw or finish |
| `GET/PUT/POST` | `/api/maintenance`, `/api/maintenance/:kind/done` | backflush and descale reminders |
| any | `/decaid/*` | same-origin proxy to Decaid's REST API (machine control from the phone) |

## Development

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run e2e
```

```bash
npm run check:tablet
```

- `test/flow.test.ts` runs the whole loop against the mock machine: identify → save → recommend → apply → feedback.
- `npm run e2e` clicks through the demo at tablet and phone size. `npm run check:tablet` confirms the home screen fits a 1340 × 800 tablet without scrolling. Both need Playwright.

**For contributors and coding agents:** start with [CLAUDE.md](CLAUDE.md), which covers the layout, commands, conventions and known pitfalls. Then read [docs/architecture.md](docs/architecture.md) and [docs/design.md](docs/design.md). Repeatable workflows are in `.claude/skills/`.

## Roadmap

- [ ] Test on a real DE1 and tablet
- [ ] Package `skin/` as an installable Decaid skin, with the Crema server address set in the app
- [ ] Run the `codex-cli` and `gemini-api` providers against real accounts, and tune the prompts with real bag photos
- [ ] Home Assistant: expose machine state, shot count and the current coffee as sensors, and add warm-up and sleep automations
- [ ] Add coffees from roaster order emails, so only the roast-date sticker needs photographing
- [ ] Grinder entities and a numeric grind advisor
- [ ] Profile editing and Visualizer profile import
- [ ] Optional native phone extras: widgets and a live shot activity

## Acknowledgements

- [Decent Espresso](https://decentespresso.com) for the DE1 and its open ecosystem, and the [Decaid](https://github.com/tadelv/reaprime) project (GPL-3.0), which Crema talks to over its API. Crema contains no Decaid code.
- The community profile authors whose notes the profile catalog is described from: Damian Brakel, Janek, Scott Rao, Jonathan Gagné, Joe D., John Weiss, longpvo, Denis (KafaTek), Luca & Stéphane, Shin and the Decent team.
- The Streamline and Lumen skins, for the feature set a day-to-day interface needs.
- ONA Coffee and Haven Coffee, whose public product listings make up the demo's sample coffees.

Crema is an independent project, not affiliated with or endorsed by Decent Espresso or any roaster. Product and company names belong to their owners.

## License

[MIT](LICENSE)
