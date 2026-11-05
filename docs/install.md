# Installing Crema

Crema has three parts. Only the first two are needed.

| Part | Where it runs | Needed? |
|---|---|---|
| **Decaid** | The DE1's tablet. It talks to the machine and scale and stores your coffees, profiles, shots and Crema's settings. | Yes |
| **The Crema skin** (`skin/`) | Inside Decaid on the tablet, and in a phone's browser | Yes |
| **The Crema server** (`server/`) | Any always-on computer on your network: a NAS, a home server, a Raspberry Pi | No. Only for the AI features |

Without the server, everything works except identifying coffees from photos, searches and links. You add coffees by typing the details from the bag, and Crema's rules pick the profile, recipe and dial-in changes. With the server connected, the AI does those, and if it stops answering, the rules take over again until it's back.

> Crema is built against Decaid's documented API and tested with the simulator in this repo. It hasn't been tested on a real DE1 yet.

## 1. The tablet

1. Install and set up [Decaid](https://github.com/tadelv/reaprime) on the DE1's tablet, and connect it to the machine and scale.
2. Get the skin: `crema-skin.zip` from this repo's Releases, or build it with `npm run package:skin` (it lands in `dist/`).
3. In Decaid's skin settings, install the skin from the ZIP file, or from the GitHub release. Then make Crema the active skin. Decaid's `doc/Skins.md` has the details.

That's a working setup. Crema keeps its own data (coffee records, recipes, favourites, presets, maintenance and settings) in Decaid's key-value store, so there is nothing else to back up or run.

Give the tablet a fixed IP address in your router so phones and the server can always find it.

## 2. Phones

Open `http://<tablet-ip>:3000` in the phone's browser, choose Crema, and add it to the home screen (Safari: Share → Add to Home Screen). The phone talks to Decaid on the tablet directly and shares the tablet's coffees and settings.

If you run the Crema server, you can open the app from it instead: `http://<server>:8787`. Set `DECAID_URL` on the server (below) so it can reach the machine for you.

If the app can't find the machine, it opens in demo mode with a **Connect** button. Enter the tablet's address there (`http://<tablet-ip>:8080`). It's saved on that device.

## 3. The Crema server (optional, for AI)

The server needs Node.js 22 or later, or Docker. It stores nothing except a cache of roaster product photos.

### With Docker

```bash
cp .env.example .env
```

Fill in `.env` (see [Configuration](#configuration)), then:

```bash
docker compose up -d
```

Or without Compose:

```bash
docker build -t crema .
```

```bash
docker run -d --name crema --restart unless-stopped -p 8787:8787 --env-file .env -v crema-images:/data crema
```

To use a Claude or ChatGPT subscription, the image needs their CLIs. Set `AI_CLIS` in `.env` (Compose passes it to the build), or build with `--build-arg AI_CLIS="@anthropic-ai/claude-code"`. For `codex-cli`, also mount the host's `~/.codex` login at `/home/node/.codex`.

### Without Docker

```bash
npm ci --omit=dev
```

```bash
LLM_PROVIDERS=claude-cli npm start
```

Keep it running with whatever you use for services (systemd, a process manager, your NAS's app runner).

### Connecting the tablet to it

On the tablet, open Crema → Settings → Connections → Crema server → **Change**, and enter `http://<server>:8787`. Each device saves its own server address; phones opened from the server use it automatically.

### Turning AI off

Settings → AI features → **Use AI**. The switch is stored in Decaid, so it applies to every device. With it off, the server isn't called at all, and Add a coffee shows the form for typing the details in.

## Configuration

Everything is set with environment variables on the server.

| Variable | Default | Purpose |
|---|---|---|
| `LLM_PROVIDERS` | `claude-cli,codex-cli` | AI providers, tried in order: `claude-cli`, `codex-cli`, `anthropic-api`, `gemini-api`, `mock` |
| `CLAUDE_CODE_OAUTH_TOKEN` | none | For `claude-cli`: run `claude setup-token` on any computer to get one. Billed to your Claude plan |
| `CLAUDE_BIN`, `CLAUDE_CLI_MODEL` | `claude`, `opus` | Claude Code CLI binary and model |
| `CODEX_BIN`, `CODEX_MODEL` | `codex`, the CLI's default | For `codex-cli`, after `codex login`. Billed to your ChatGPT plan |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | none, `claude-opus-5-5` | For `anthropic-api`, billed per token |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | none, `gemini-2.5-flash` | For `gemini-api`, billed per token |
| `DECAID_URL` | none | Decaid on the tablet, such as `http://<tablet-ip>:8080`. Only needed to open the app from the server. Use an address phones can reach: they connect to its live streams directly |
| `PORT`, `HOST` | `8787`, `0.0.0.0` | Where the server listens |
| `CREMA_IMAGES` | `data/images` | Cached roaster product photos |

Subscription CLIs suit a personal installation. Use API keys for anything shared.

To check a provider works, search for a coffee (no photo needed):

```bash
curl -F query="Square Mile Red Brick" http://<server>:8787/api/identify
```

## Updating

- **Skin:** install the new release ZIP in Decaid the same way. Your data is in Decaid, so it carries over.
- **Server:** pull and rebuild (`docker compose up -d --build`), or `git pull && npm ci --omit=dev` and restart.
