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
   - **From a GitHub release.** Pushing a version tag runs `.github/workflows/release.yml`, which runs the CI checks, builds `crema-skin.zip`, checks it, and attaches it to a release. If a check fails, nothing is published. If the repo has no release yet, publish one from `main`:

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

To use a Claude or ChatGPT subscription, the image needs their CLIs. Set `AI_CLIS` in `.env` (Compose passes it to the build), or build with `--build-arg AI_CLIS="@anthropic-ai/claude-code @openai/codex"`. Claude needs only `CLAUDE_CODE_OAUTH_TOKEN` in `.env`. Codex needs a login saved in the container, as below.

#### Logging Codex in

Codex saves its login in `/home/node/.codex`, which Compose keeps on the `codex-home` volume, so it survives rebuilds. The server usually has no browser, so use Codex's device code sign-in:

1. In ChatGPT, turn on device code sign-in for Codex. It's in your account's security settings; a workspace admin turns it on for a workspace account.
2. Log in from the server, once:

   ```bash
   docker compose run --rm crema codex login --device-auth
   ```

   It prints a web address and a code. Open the address on your phone or laptop, sign in to ChatGPT and enter the code.
3. Check it worked:

   ```bash
   docker compose run --rm crema codex login status
   ```

Then start or restart the server (`docker compose up -d`). Codex refreshes the login by itself, so it lasts until you sign out or revoke it.

Without Compose, add `-v crema-codex:/home/node/.codex` to `docker run`, and log in with `docker run --rm -it -v crema-codex:/home/node/.codex crema codex login --device-auth`.

Notes:
- **Log the server in on its own** rather than copying `~/.codex/auth.json` from another computer. A copy shares one login between two machines that each refresh it; a separate login can be revoked by itself. If device code sign-in isn't available, copying works. While the container runs, `docker compose exec -T crema sh -c 'umask 077 && cat > /home/node/.codex/auth.json' < ~/.codex/auth.json` writes it as the container's user.
- **Mounting a host folder instead of a volume**: the container runs as the `node` user (uid 1000), so the folder must be writable by that uid, or Codex can't save refreshed tokens.
- **The volume holds tokens for your ChatGPT account.** Treat it like a password: keep it out of shared backups.
- An OpenAI API key works too (`codex login --with-api-key`), billed per token instead of to your plan.
- **"error sending request for url (https://auth.openai.com/…)"** after about 5 seconds usually means the Docker host's DNS doesn't answer IPv6 (AAAA) lookups. Node only asks for IPv4, so the rest of Crema works, but Codex waits for both and gives up. Check with `docker compose run --rm crema node -e 'require("dns").promises.resolve6("auth.openai.com").then(console.log,console.error)'`. If that fails, give the container working DNS servers (`dns:` in `docker-compose.yml`, or the Docker daemon's `dns` setting). Colima on a Mac has this problem; `colima start --dns 1.1.1.1` fixes it.

### Without Docker

```bash
npm ci --omit=dev
```

```bash
LLM_PROVIDERS=claude-cli npm start
```

Keep it running with whatever you use for services (systemd, a process manager, your NAS's app runner).

### Brewing without a bag

On Brew, tap the coffee name and choose **No bag**. Open Profiles, choose an
installed profile and tap **Brew without a bag**. Adjust dose, yield, temperature
and the optional grind note, then **Load onto machine** before using the physical
start button. Crema's Espresso button loads unsaved changes before starting.
Choosing No bag on screen does not change the profile already on the machine
until you load one. With no selected profile, Crema's Espresso button is disabled.

The profile's own temperature and target are used. An Off yield means manual
stopping; tap it to set a weight target. Weight targets require a working scale.
No bag is remembered on that device, including across reloads and shelf updates.
Shots still appear in history with ratings and notes, and no bag inventory is
deducted. Select a bag from the coffee name to return to bag-based brewing.

### Manual flow and pressure

Open Profiles and choose **Manual flow** or **Manual pressure**. Use it with the
selected bag, or tap **Brew without a bag**. These load Decaid's installed
`GHC/manual flow control` or `GHC/manual pressure control` profile: adjust the
extraction on the physical group-head controller. They do not add tablet paddles.
Load before starting; adjust temperature as usual. The initial weight target is
Off; tap it for an optional weight target. Manual stop still respects the
profile's time limits. Scale stopping with a manual profile needs a supervised
check on the physical machine before relying on it.

Manual choices are unavailable when Decaid reports no group-head controller or
cannot confirm one. If a manual profile isn't visible, show/restore it in Decaid
or Streamline and reopen Profiles. Crema does not install or unhide it for you.
The demo's controller movements are simulated, not a physical-controller test.

### Editing favourites

The bottom of Brew has a favourites carousel. Swipe it, drag with a mouse, or use
the arrows to see more recipes; the cards snap into place. Tap a recipe to load
it. During a pour, it loads after the shot ends. The graph is shorter to leave
room for the carousel, and Stop stays available.

The last card is **Save current recipe**. You can keep adding recipes; there is no
five-slot limit. Tap **Edit**, then a recipe, to rename, replace or clear it; tap
**Done** to return to loading recipes. A favourite saved in No bag mode restores
that mode rather than attaching whichever bag is currently selected.

Existing favourites stay in Decaid without a data migration. After upgrading the
skin, reload any open phone tabs so all devices use the current favourites UI.

### Connecting the tablet to the server

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
| `CODEX_BIN`, `CODEX_MODEL`, `CODEX_REASONING_EFFORT` | `codex`, the CLI's defaults | For `codex-cli`, after `codex login`. Billed to your ChatGPT plan. Effort is `low`, `medium` or `high`; coffee identification needs little, so `low` keeps it fast and cheap |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | none, `claude-opus-5-5` | For `anthropic-api`, billed per token |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | none, `gemini-2.5-flash` | For `gemini-api`, billed per token. A key also switches on speaking into "Describe it" (Gemini writes down your voice note), even when `LLM_PROVIDERS` doesn't list `gemini-api` |
| `GEMINI_VOICE_MODEL` | `GEMINI_MODEL` | The Gemini model that transcribes voice notes. Each tablet or phone can switch to its own speech recognition instead, in Settings → AI features |
| `DECAID_URL` | none | Decaid on the tablet, such as `http://<tablet-ip>:8080`. Only needed to open the app from the server. Use an address phones can reach: they connect to its live streams directly |
| `CORS_ORIGINS` | none | Extra web pages allowed to call `/api/*`, as exact origins separated by commas (`http://nas.local:9000,https://crema.example.org`). Always allowed without setting it: the server's own address, any `http://` page on port 3000 (Decaid serving the skin on the tablet) and `localhost`/`127.0.0.1` on any port. Other pages get 403, so a website open on your network can't spend your AI calls. `*` allows every page |
| `PORT`, `HOST` | `8787`, `0.0.0.0` | Where the server listens |
| `CREMA_IMAGES` | `data/images` | Cached roaster product photos |

Subscription CLIs suit a personal installation. Use API keys for anything shared.

To check a provider works, search for a coffee (no photo needed):

```bash
curl -F query="Square Mile Red Brick" http://<server>:8787/api/identify
```

## Settings Crema doesn't have

Crema covers day-to-day settings: steam, hot water and flush, sleep and wake schedules, display, maintenance reminders, AI and connections. Machine settings it changes are written to Decaid, so other skins see them too. Some things live elsewhere:

Live fan, steam/hot-water temperatures and flows, flush settings and idle-sleep
values are read from Decaid. Opening Settings does not apply Crema defaults or
reset these values. A missing machine value is unavailable, not replaced by a
guessed number. Existing Decaid values may include earlier user or skin changes;
they are not necessarily factory defaults.

Crema's named steam durations, hot-water volumes and flush-time presets are
convenience recipes defined by Crema (or edited by you), not Decaid factory
defaults. Tapping a preset or starting that operation from Crema applies its
duration/volume, while keeping the workflow's temperature and flow settings.
The manual steam preset uses a 255-second cap, not unlimited steaming.

“Use only the machine's start buttons” is a preference for this device: it
disables Crema's Espresso, Steam, Hot water and Flush start buttons and leaves Stop
available. It does not change the physical group-head controls. Theme and clock
choices are also saved separately on each device. Machine settings are shared
through Decaid. Sleep timeout follows Decaid's 0–240 minute range (0 disables the
idle timer); the refill warning is a water height in millimetres, not a percentage.

- **Decaid:** installing and switching skins, connecting the machine and scale, and plugin settings such as your Visualizer account.
- **The [Streamline Settings](https://github.com/decentespresso/streamline-setting) plugin** (optional): specialist machine settings, including calibration, firmware and cleaning. Its released version can lag behind the Streamline skin. Install it from Decaid's Plugins screen with its release ZIP, or with `curl -X POST http://<tablet-ip>:8080/api/v1/plugins/install/github-release -H 'Content-Type: application/json' -d '{"repo":"decentespresso/streamline-setting"}'`. Then open `http://<tablet-ip>:8080/api/v1/plugins/streamline-settings.reaplugin/ui` in a browser on your network. Its skin preferences (language, units, zoom) do not apply to Crema, and Streamline runtime features such as eco steam and wake-profile loading are not inherited. The [source audit](parity.md#integration-findings) records an unresolved saved-settings restore conflict to check before integrating it into Crema.
- **The Streamline skin:** profile editing and importing profiles from Visualizer. Switch skins in Decaid, then switch back to Crema; Crema's data stays in Decaid.

To get to Decaid's dashboard from Crema on the tablet, open **Settings → Decaid → Open Decaid**. It calls Decaid's `exitToDashboard()`, which closes the skin. The row appears only inside Decaid (not on a phone or in a desktop browser) and is greyed out while the machine is running. If it's missing on your Decaid version, use Decaid's own navigation; its **Skin navigation guide** option (Settings → General) shows how it works. [parity.md](parity.md) lists features against the stock app and other skins.

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
