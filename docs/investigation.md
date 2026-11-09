# Background and design decisions

Why Crema is built the way it is. Everything here has been checked against
Decaid's published API docs and the simulator in this repo (`dev/mock-decaid.ts`).
Behaviour on real hardware still needs confirming.

## 1. Where custom DE1 interfaces live

| Option | What it is | Verdict |
|---|---|---|
| **de1app** (Tcl/Tk) | The original tablet app, with skins such as DSx and Insight | Mature, but Tcl/Tk skins are awkward to build and style |
| **Decaid** (previously REA → ReaPrime → Streamline Bridge) | Open-source Flutter app on the tablet. Talks to the DE1 over BLE/USB and serves a REST + WebSocket API on `:8080`; skins are ordinary web apps | **Crema builds on this.** Decent's Streamline skin uses it, as do several community skins (Passione, Beanie, NSX, OverDose, WorkFlow, an Insight port) |
| Decenza, despresso, pyDE1 | Alternative community controllers | Smaller ecosystems |

Decaid features Crema relies on:

- **Beans and batches API**: roaster, name, country, process, variety and altitude, then per-bag roast date, weight remaining and frozen state.
- **Workflow API**: one `PUT` sets the profile, dose, yield, grinder setting and bean batch, so every shot records which bag it came from.
- **Shot history filtered by `beanBatchId`**: the dial-in loop learns per bag.
- **Snapshot WebSocket**: pressure, flow, temperatures and state, around 10 times a second.
- **Camera access for skins**: `getUserMedia` for the installed skin on `localhost`, and `<input capture>` on Android, so a tablet skin can photograph a bag itself.

There is no official Home Assistant integration for the DE1. With Decaid's API, one would mostly be a thin REST/WebSocket client (see the roadmap).

## 2. Identifying a coffee: bag photo, web lookup, or both

Crema identifies from the bag and enriches from the roaster's page, in one step.

| Fact | Bag photo | Roaster's web page |
|---|---|---|
| Which coffee it is | ✅ the label | ✅ if the name is known |
| **Roast date** | ✅ **only here** | ❌ |
| The exact lot (lots rotate, harvests change) | ✅ | ⚠️ may describe a newer or older lot |
| Origin, producer, variety, altitude, process detail | ⚠️ often partial | ✅ usually richer |
| Tasting notes | ✅ | ✅ |
| Roaster's recommended espresso recipe | sometimes | sometimes |
| Small roasters with little web presence | ✅ | ❌ |
| A clean product photo for the shelf | ❌ glare, crumpled bags | ✅ the roaster's packshot |

The roast date matters most. It drives the rest window (light roasts often taste best from about day 14), which is one of the biggest factors in how a shot tastes, and no website knows when a particular bag was roasted.

So the model gets the photos plus web search, and every field records where it came from (`bag`, `web` or `inferred`). Guesses are flagged for the user to check. When the bag and the website disagree on a lot-specific fact, the bag wins.

**Product photos** come from the product page's metadata (Open Graph `og:image`, JSON-LD `Product.image` or the Twitter card), which nearly every roaster shop publishes, rather than from a URL the model guesses. The image is downloaded once and cached, so the shelf works offline. The user picks between the roaster's photo and their own. Lookups only go to public addresses, never the local network.

Describe-it and paste-a-link use the same pipeline. They help when browsing before buying, re-adding a past coffee, or when the bag isn't to hand.

**Describing the bag** is often quicker than a photo: "ONA La Fincona, roasted on the 2nd, 250 grams" covers what matters, and the roast date comes from the user, read off the bag, so it counts as a `bag` fact. The model is told the text may be dictated, so it matches misheard names to real roasters by sound, resolves relative dates ("last Tuesday") against the tablet's date, and ignores false starts. A plain name works the same way, so this mode replaces the old search box.

**Speaking** goes to Gemini when the Crema server has a `GEMINI_API_KEY`. The app records a voice note, stops after a 1.6 s pause (or at 30 s), and sends it as 16 kHz mono WAV, which every Gemini model accepts and which avoids the browsers' differing compressed formats. Gemini hears the audio itself and is told it's about a coffee bag, so it spells roaster names, origins and varieties properly where general dictation writes them by sound. Its reply has a fixed JSON shape, so silence comes back empty rather than as a made-up sentence. The text then goes through the description pipeline above, with whichever provider is configured, so a Claude or ChatGPT setup can add voice with only a Gemini key. Gemini's text models were chosen over a separate speech service (Whisper and the like) because one key does it, the free tier covers home use, and the domain hint in the prompt matters more than raw accuracy for names like "Gesha" and "Kirinyaga".

Gemini only writes the voice note down. Identifying the coffee always takes the main path (`LLM_PROVIDERS`), so a spoken description and a typed one reach the same model and behave the same way.

Each device chooses how it hears you, in Settings → AI features → "Speaking a description": **Gemini** (the default) or **This device**, which keeps audio off the Crema server. The choice is stored per device, like the theme, because a tablet and a phone differ in what they can do.

Without a Gemini key, or with "This device" chosen, the Speak button uses the browser's own speech recognition (Chrome sends audio to Google, Safari to Apple) where it exists. Recording and browser recognition both need the microphone, which browsers allow only on https or localhost pages. A phone on the tablet's plain-http address gets neither, so the button stays hidden there and the keyboard's own microphone fills the same box. On the tablet the page is on localhost, but whether Decaid's WebView grants the microphone is untested.

Ideas not yet built:
- **Order emails**: roasters' order confirmations name the exact product, so a coffee could be added before the bag arrives, leaving only the roast-date sticker to photograph.
- **Barcode or QR codes**: some bags carry them. They work as a search query today, but aren't decoded on the device.

## 3. AI providers and billing

Crema can call an LLM through a subscription CLI or a pay-per-use API key:

| Provider | How | Billing |
|---|---|---|
| `claude-cli` | `claude -p --json-schema … --tools Read,WebSearch,WebFetch` | A Claude Pro/Max plan. Run `claude setup-token` on the host and set `CLAUDE_CODE_OAUTH_TOKEN` |
| `codex-cli` | `codex --search exec --output-schema … -i photo.jpg` | A ChatGPT plan. Run `codex login` on the host |
| `anthropic-api` | Anthropic SDK: structured outputs, server-side web search and fetch | API key, per token |
| `gemini-api` | REST `generateContent` with Google Search grounding | Gemini API key (has a free tier) |
| `mock` | Canned answers | Free; used by the demo and tests |

`LLM_PROVIDERS=claude-cli,codex-cli,gemini-api` tries each in order, so a provider that fails or hits a usage limit falls through to the next.

Notes:
- Subscription auth through these CLIs suits a personal installation. It isn't meant for serving other people; a shared deployment should use API keys.
- The CLI providers depend on each tool's flags. Each one is a small adapter (`server/llm/*-cli.ts`), so a flag change is a one-file fix.
- `claude-cli` has been exercised with real calls: identification with web search took 20–43 s per coffee, and recommendations 7–14 s. Claude Code rejects Zod's `$schema` key in `--json-schema`, so `jsonSchemaFor()` strips it.
- `codex-cli` and `gemini-api` haven't been run against real accounts yet.

## 4. How a recipe is chosen

The approach is to match what the roaster says about the coffee against what community profiles are designed to do, then let the AI make the final call.

1. **Profile catalog** (`server/profiles/catalog.ts`): 31 community espresso profiles. Each is described from its author's own notes in the profile files Decaid ships (so they're already on the tablet), plus Decent's guidance. Decent notes that successful users favour Londinium, D-Flow, Adaptive, Extractamundo Dos and Allongé, and that Adaptive v2 is its showroom's most-used profile. Each entry records:
   - its style (adaptive, blooming, lever, flow, allongé, turbo, low-contact, scale-driven)
   - the roasts it was written for, and whether it suits milk
   - the traits it brings forward (fruit, florals, clarity, sweetness, body, chocolate)
   - a typical recipe, difficulty, whether it needs a scale or flat burrs, and popularity
   - the author's dial-in guidance
2. **Rules ranking** (`server/profiles/match.ts`): each profile is scored against the coffee and the user's setup.
   - From the coffee: roast fit, the processes it suits, tasting-note traits, blend or single origin, altitude and freshness.
   - From the setup: milk or straight, scale, burrs and experience.
   - Every point comes with a reason or caution that the app shows. Profiles not installed on the machine are marked.
3. **Recipe per candidate**: each candidate starts from the profile's own recipe and temperature, shifted about 1.5 °C per roast step (lighter roasts hotter). A roaster's published recipe overrides dose and yield on conventional profiles. Turbo, allongé and low-contact shots keep their own logic.
4. **AI choice** (`server/recommend/index.ts`):
   - The model reads the roaster's description, the top six installed candidates with their authors' guidance, the setup, and past shots of the bag.
   - It must return one of those candidates, explain the choice in 2–4 bullets, give coffee-specific dial-in guidance and suggest alternatives.
   - If the AI is switched off, there's no server, or the call fails, the top-ranked candidate is used. Steps 1–3 and 5 run in the browser, so this needs no server.
5. **Dial-in loop**: taste feedback, plus the shot's time against the profile's window, gives one next adjustment, using the profile author's guidance.

**Example results** (`samples/recipes.json`, real `claude-cli` calls on nine publicly listed ONA and Haven coffees):
- ONA Maple (milk) → Londonium. The model tied the caramel, biscuit and nut notes to Londonium's body.
- ONA Raspberry Candy (milk) → D-Flow / default at ONA's published 20.5 g → 38 g recipe, warming the temperature toward ONA's 93.5 °C.
- ONA Guji Yabitu Koba G1 (a light natural from 2,100–2,350 masl) → Best practice (light roast).
- Bright, light-to-medium coffees → Adaptive v2, which the model often preferred over the rules' first choice, Extractamundo Dos!.

The sample records were built from web search results without fetching the roaster pages, so some are thinner than a run with full page access would produce.

## 5. Phone companion

The phone app is the same web app, opened from the tablet (`http://<tablet-ip>:3000`) or from the Crema server, and added to the home screen from Safari (`manifest.webmanifest`, `apple-mobile-web-app-*` meta tags). Below 760 px wide, the layout switches to a bottom tab bar. On the phone you get:

- the coffee shelf, rest windows and grams left
- adding a coffee by photo, using the phone camera
- machine status and live shot curves, over Decaid's WebSocket on the local network
- recent shots with their curves and ratings

Remote access is left to whatever the user already runs (a VPN such as Tailscale, or a reverse proxy). A native app would only be worth building for what a web app does poorly: widgets, Live Activities, and voice shortcuts.

## 6. Where things run

The first version kept Crema's records on the server and sent everything through it, so the tablet stopped working whenever the server did. Now:

- **Decaid holds all the data.** Beans, batches, profiles and shots were already there. Crema's own records (identification details, recipes, photos, favourites, presets, maintenance, settings) go in Decaid's key-value store under the `crema` namespace. The tablet and phones share them, and there's one thing to back up.
- **The rules run in the browser.** The profile catalog, ranking, recipes and dial-in rules are TypeScript in `server/`, bundled for the browser as `skin/engine.js`, so the server and the app can't disagree.
- **The server only does AI.** It's stateless apart from a cache of product photos. The app calls it for identify, the AI profile choice and AI dial-in advice when AI is switched on, and falls back to the rules when it fails.
- **AI is a switch** in Settings, stored in Decaid. Off, the app never calls the server, and coffees are added by typing in the bag's details.

Running the server as an Android app on the tablet was considered and rejected: the subscription CLIs need a Node and shell environment, and an always-on home computer (a NAS, a Pi) is the more common place for one.

## 7. A skin, not a fork of Streamline (reviewed 8 November 2026)

Crema is its own Decaid skin. Once phase 1 of the [implementation plan](implementation-plan.md) turned out to need lessons from Streamline (Decent's own skin for Decaid), we asked whether forking Streamline would have been the better start. It would not, but the review changed what Crema tries to be.

### The options

| Option | What it means | Verdict |
|---|---|---|
| **Crema as a Decaid skin** (current) | Crema's own home screen, talking to Decaid's REST and WebSocket APIs, as Streamline does | **Keep.** It's the extension point Decaid documents, and the part Crema changes is the UI |
| **Fork Streamline** | Start from Streamline's code and replace its screens | **Rejected.** See below |
| **Crema's AI as a Decaid plugin inside Streamline** | A `.reaplugin` with its own page, shown through Streamline's plugin surfaces | **A hedge, not a replacement.** See below |

### Why not a fork

- **License.** Streamline's `LICENSE.txt` is GPL-3.0-or-later; its `package.json` says ISC. Until its maintainers say which applies, assume GPL. A fork would make Crema GPL and end the MIT repo.
- **Upstream moves fast.** About 1,100 commits, with a release every few days to two weeks (v0.2.20 to v0.2.23 between 29 October and 5 November 2026). A fork that rewrites the UI would conflict with upstream in exactly the files it changes.
- **A fork keeps the wrong half.** What makes Crema different is the home screen (the shelf, and the coffee → recipe → shot → feedback loop), the themes, the AI server, the shared rules engine and the evals. A fork keeps Streamline's machine plumbing and throws away its UI.
- **It's the same layer.** Streamline is itself a skin on Decaid; neither sits below the other.

### What the skin costs

About 40% of `skin/app.js` is plumbing any skin needs: the Decaid adapter (`makeLiveApi`), the controls and live state, and connection discovery. The rest of phase 1 reimplements lessons from five Streamline modules (`machine-link`, `profile-send-gate`, `workflow-watch`, `resync-policy`, `socket-slot`), each written around a Decaid gap such as the missing workflow stream for skins, or the DE1 echoing an old value after a write (Decaid gh-678). Every gap Streamline finds later, Crema has to find again.

That cost is accepted for machine reliability: a skin that pours shots must handle disconnects, outside workflow changes and writes during a shot. It isn't accepted for feature parity. Treating every Streamline feature in `docs/parity.md` as a gap to close is how a skin turns into a fork in all but name.

### The plugin route

A Decaid plugin runs on the tablet in a sandbox (no DOM; fetches only to public hosts and Decaid's own API), stores its own data, receives `shotStored` and `workflowUpdated` events, and serves its own page on Decaid's port (Decaid `doc/Plugins.md`). Streamline shows plugins through a fixed set of surfaces: menu items, header and screensaver buttons, tile hints and lines, and an overlay or full page for the plugin's own UI. Surface actions can set dose, yield, grind and temperature, but not the profile (Streamline `docs/plugin-surfaces.md`). A third-party plugin, `pagratios/bean-journal`, already tracks coffees and dial-in this way.

So Crema's identification, recommendation and dial-in could also ship as a plugin, with Streamline owning the machine. The costs: Streamline's design rather than Crema's, a workflow write for the profile choice, and camera access from a plugin page that isn't documented. It isn't planned; it's worth revisiting if the skin's plumbing proves expensive on the tablet. The rules engine already runs anywhere as `skin/engine.js`, which keeps the option cheap.

### What follows

1. **Crema owns the daily brewing loop and hands off the rest.** Machine settings go to the Streamline Settings plugin; profile editing and Visualizer import to the Streamline skin (switch skins, then switch back); firmware, calibration and cleaning to Decaid. `docs/parity.md` becomes a matrix of who owns each feature (phase 3), not a list of gaps to close.
2. **Finish phase 1, asking upstream first.** Plugins get `workflowUpdated`; skins get no workflow stream, which is why Streamline has `workflow-watch` and `resync-policy` and Crema needs the same. Before building a workaround, check whether Decaid would take the fix: an upstream fix serves every skin.
3. **Ask Streamline's maintainers which license applies.** If it's ISC, its reliability modules could be reused with credit instead of rewritten.
4. **Let the first tablet session set the size of phase 1.** If Decaid on the tablet re-attaches sockets after a power cycle and behaves like the desktop build, phase 1 shrinks. If not, look at the plugin route again.

Read from the public `main` branches of Streamline (`README.md`, `LICENSE.txt`, `package.json`, `docs/plugin-surfaces.md`, commit history) and Decaid (`doc/Skins.md`, `doc/Plugins.md`) on 8 November 2026, not from the versions installed on a tablet. Parts of `Plugins.md` and `plugin-surfaces.md` were read as summaries rather than word for word; confirm details before building on them.

## 8. Sources

- Decaid repo and skin/API docs: https://github.com/decentespresso/decaid (`doc/Skins.md`, `doc/Api.md`, `doc/Plugins.md`)
- Streamline skin, its manual and plugin surfaces: https://github.com/decentespresso/streamline-js (`README.md`, `docs/plugin-surfaces.md`)
- Streamline Settings plugin: https://github.com/decentespresso/streamline-setting
- Decent's 2025 software update: https://decentespresso.com/blog/decent_software_2025_and_beyond_skins_calibration_dflowmore
- Visualizer's AI bag import and Bean Base: https://visualizer.coffee/updates/ai-comes-to-visualizer, https://visualizer.coffee/updates/loffee-labs-meets-coffee-management
- Bean AI (iOS label scanner): https://mwm.ai/apps/bean-ai/6760227144
- Community DE1 REST/HA bridge for the classic app: https://github.com/Memberapple/decent-advanced-rest-api
- Decent Scale HA integration: https://github.com/simon-bd/decent-scale
