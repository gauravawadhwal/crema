# Installing Crema

Crema has three parts. Only the first two are needed.

| Part | Where it runs | Needed? |
|---|---|---|
| **Decaid** | The DE1's tablet. It talks to the machine and scale and stores your coffees, profiles, shots and Crema's settings. | Yes |
| **The Crema skin** (`skin/`) | Inside Decaid on the tablet, and in a phone's browser | Yes |
| **The Crema server** (`server/`) | Any always-on computer on your network: a NAS, a home server, a Raspberry Pi | No. Only for the AI features |

Without the server, everything works except identifying coffees from photos, descriptions and links. You add coffees by typing the details from the bag, and Crema's rules pick the profile, recipe and dial-in changes. With the server connected, the AI does those, and if it stops answering, the rules take over again until it's back.

> Crema is built against Decaid's documented API and tested with the simulator in this repo. It hasn't been tested on a real DE1 yet.

## 1. The tablet

1. Install and set up [Decaid](https://github.com/decentespresso/decaid) on the DE1's tablet, and connect it to the machine and scale. (Decaid was previously called REA, ReaPrime and Streamline Bridge.)
2. Get the skin, either way:
   - **From a GitHub release.** Pushing a version tag runs `.github/workflows/release.yml`, which builds `crema-skin.zip` and attaches it to a release. If the repo has no release yet, publish one from `main`:

     ```bash
     git tag v0.1.0 && git push origin v0.1.0
     ```

   - **As a ZIP you build.** Run `npm run package:skin`; the file lands in `dist/crema-skin.zip`. Copy it to the tablet.
3. In Decaid, open the launcher, then **Skins → ⚙ → Install skin**. Choose **GitHub Release** and enter the repo (`gauravawadhwal/crema`, or your fork), or choose **ZIP file** and pick the ZIP. The repo must be public.
4. Select Crema to make it the active skin. Decaid saves it as the default skin, which is also what `http://<tablet-ip>:3000` serves to phones.

The menu names come from Decaid's [`doc/Skins.md`](https://github.com/decentespresso/decaid/blob/main/doc/Skins.md) and haven't been checked on a real tablet, so they may differ slightly by version.

That's a working setup with nothing else to run. Crema keeps its own data (coffee records, recipes, favourites, presets, maintenance and settings) in Decaid's key-value store on the tablet, alongside your beans, profiles and shots. See [Backing up](#backing-up) for copying it off.

Give the tablet a fixed IP address in your router so phones and the server can always find it.

## 2. Phones

Open `http://<tablet-ip>:3000` in the phone's browser. It opens Decaid's default skin, which is Crema once you selected it on the tablet. Add it to the home screen (Safari: Share → Add to Home Screen). The phone talks to Decaid on the tablet directly and shares the tablet's coffees and settings.

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
| `GEMINI_API_KEY`, `GEMINI_MODEL` | none, `gemini-2.5-flash` | For `gemini-api`, billed per token. A key also switches on speaking into "Describe it" (Gemini writes down your voice note), even when `LLM_PROVIDERS` doesn't list `gemini-api` |
| `GEMINI_VOICE_MODEL` | `GEMINI_MODEL` | The Gemini model that transcribes voice notes. Each tablet or phone can switch to its own speech recognition instead, in Settings → AI features |
| `DECAID_URL` | none | Decaid on the tablet, such as `http://<tablet-ip>:8080`. Only needed to open the app from the server. Use an address phones can reach: they connect to its live streams directly |
| `PORT`, `HOST` | `8787`, `0.0.0.0` | Where the server listens |
| `CREMA_IMAGES` | `data/images` | Cached roaster product photos |

Subscription CLIs suit a personal installation. Use API keys for anything shared.

To check a provider works, search for a coffee (no photo needed):

```bash
curl -F query="Square Mile Red Brick" http://<server>:8787/api/identify
```

## Settings Crema doesn't have

Crema covers day-to-day settings: steam, hot water and flush, sleep and wake schedules, display, maintenance reminders, AI and connections. Machine settings it changes are written to Decaid, so other skins see them too. Some things live elsewhere:

- **Decaid:** installing and switching skins, connecting the machine and scale, and plugin settings such as your Visualizer account.
- **The [Streamline Settings](https://github.com/decentespresso/streamline-setting) plugin** (optional): Streamline's full machine settings, including calibration, firmware, cleaning and steam modes. Install it from Decaid's Plugins screen with its release ZIP, or with `curl -X POST http://<tablet-ip>:8080/api/v1/plugins/install/github-release -H 'Content-Type: application/json' -d '{"repo":"decentespresso/streamline-setting"}'`. Then open `http://<tablet-ip>:8080/api/v1/plugins/streamline-settings.reaplugin/ui` in any browser on your network. Its skin preferences (language, units, zoom) apply to Streamline only, not Crema.
- **The Streamline skin:** profile editing and importing profiles from Visualizer. Switch skins in Decaid, then switch back to Crema; Crema's data stays in Decaid.

Crema doesn't have a button back to Decaid's dashboard yet. Use Decaid's own navigation; its **Skin navigation guide** option (Settings → General) shows how it works on your version. [parity.md](parity.md) lists features against the stock app and other skins.

None of these routes has been tested from Crema on a real tablet yet.

## Updating

- **Skin:** publish a new release (push a tag such as `v0.1.1` from `main`), then install it in Decaid again the same way, or install a newly built ZIP. Your data is in Decaid, so it carries over. An upgrade on a real tablet hasn't been tested yet.
- **Server:** pull and rebuild (`docker compose up -d --build`), or `git pull && npm ci --omit=dev` and restart.

## Backing up

Your data lives on the tablet, in Decaid: beans, batches, profiles and shots, plus Crema's records and settings in the key-value store's `crema` namespace. The server holds only a photo cache it can rebuild, and the theme and saved addresses are per device in the browser.

Decaid's API can copy Crema's records and your profiles off the tablet:

```bash
curl "http://<tablet-ip>:8080/api/v1/store/crema?full=1" > crema-store.json
```

```bash
curl http://<tablet-ip>:8080/api/v1/profiles/export > profiles.json
```

Both endpoints come from Decaid's docs. Restoring from these files hasn't been tested. For beans and shots, use Decaid's own export.
