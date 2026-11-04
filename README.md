# Crema

A custom interface and companion service for a Decent DE1 espresso machine.

- **Add a coffee** by photographing the bag, searching for it, or pasting the roaster's link. Crema reads the bag (including the roast date), finds the roaster's own page for the details, and tags every fact with where it came from.
- **Get a starting recipe**: a profile from the machine's own library, plus dose, yield, temperature and grind guidance, with the reasons. Load it onto the machine in one tap.
- **Dial in**: rate a shot (sour ↔ bitter, thin ↔ heavy, stars) and get the one change to make next.
- **Roaster product photos** on your shelf, read from the roaster's product page and cached locally. You can use your own photo instead.
- **Light, dark or auto theme**, remembered on each device.
- **Watch shots live**: pressure, flow and weight curves, plus recent-shot history.
- **Runs on the DE1 tablet as a skin and on your iPhone** as a home-screen app.

Research and design decisions: [docs/investigation.md](docs/investigation.md).

## How it fits together

```
 iPhone (home-screen web app) ─┐
                               ├──► Crema server :8787 ──► AI provider chain
 DE1 tablet (Decaid skin) ─────┘        │                    claude-cli → codex-cli → gemini-api …
          │                             ▼
          └────── WebSocket ──────► Decaid :8080 (on the tablet) ──BLE──► DE1 + scale
```

- **Decaid** is the open-source app on the DE1 tablet (formerly REA / Streamline Bridge). It owns the machine connection and stores beans, profiles and shots.
- **Crema server** (`server/`, Node + TypeScript) runs on your Home Assistant box or any always-on machine. That's where the Claude or Codex CLI is logged in. It adds identification, recipes and dial-in on top of Decaid's API.
- **Web app** (`skin/index.html`): one file that works as the tablet skin, the iPhone companion, and a self-contained demo.

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
curl -X PUT localhost:8080/api/v1/machine/state -d '{"state":"espresso"}'
```

Opening `skin/index.html?demo` straight from disk runs a fully in-browser demo with sample coffees and a simulated DE1.

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

Subscription routes are for personal use. Smoke-test a provider with a search (no photo needed):

```bash
curl -F query="Square Mile Red Brick" localhost:8787/api/identify
```

## Pointing at the real DE1

```bash
DECAID_URL=http://<tablet-ip>:8080 LLM_PROVIDERS=claude-cli npm start
```

- **iPhone:** open `http://<server-ip>:8787` in Safari, then Share → Add to Home Screen.
- **Tablet skin:** package `skin/` as a Decaid skin (see Decaid's `doc/Skins.md`). It needs to know the Crema server's address; this is on the roadmap.

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

## Development

```bash
npm test
```

```bash
npm run typecheck
```

`test/flow.test.ts` runs the whole loop against the mock machine: identify → save → recommend → apply → feedback.

## Roadmap

- [ ] Test the `claude-cli` and `codex-cli` adapters against real accounts, and tune the prompts with real bag photos
- [ ] Package `skin/` as an installable Decaid skin, with the Crema server address set in-app
- [ ] Home Assistant: expose machine state, shot count and the current coffee as sensors, and add warm-up and sleep automations
- [ ] Coffee bags from roaster order emails (Gmail), so you only photograph the roast-date sticker
- [ ] Ghost overlay of your best shot of the same bag on the live chart
- [ ] Grams-left tracking from actual doses; reorder nudge
- [ ] Theme tokens matched to your Home Assistant dashboard
- [ ] Optional native iOS extras: widgets and a Live Activity for shots
