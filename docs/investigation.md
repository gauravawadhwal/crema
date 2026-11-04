# Investigation notes

Research and decisions behind Crema, November 2026. The DE1 hasn't arrived yet, so everything here has been checked against Decaid's published API docs and a simulated machine (`dev/mock-decaid.ts`), not real hardware.

## 1. Where custom DE1 interfaces live now

| Option | What it is | Verdict |
|---|---|---|
| **de1app** (Tcl/Tk) | The original tablet app. Skins like DSx and Insight. | Mature, but Tcl/Tk skins are awkward to build and style. |
| **Decaid** (was REA → ReaPrime → Streamline Bridge) | Open-source Flutter app on the tablet. Talks to the DE1 over BLE/USB and serves a REST + WebSocket API on `:8080`. Skins are ordinary web apps. | **Build on this.** Decent's Streamline skin uses it, and about seven community skins already ship (Passione, Beanie, NSX, OverDose, WorkFlow, an Insight port). |
| Decenza, despresso, pyDE1 | Alternative community controllers | Interesting, but a smaller ecosystem. |

Decaid features that matter here:

- **Beans and batches API**: roaster, name, country, process, variety, altitude, then per-bag roast date, weight remaining, frozen and so on. Crema saves to it directly.
- **Workflow API**: one `PUT` sets the profile, dose, yield, grinder and the bean batch. Every shot then records which bag it came from.
- **Shot history filtered by `beanBatchId`**: the dial-in loop learns per bag.
- **Snapshot WebSocket**: pressure, flow, temperatures and state, several times a second.
- **Camera in skins**: `getUserMedia` for the installed skin on `localhost`, and `<input capture>` on Android. A tablet skin can photograph a bag itself.

There's no official Home Assistant integration for the DE1. With Decaid's API, an HA integration is mostly a thin REST/WebSocket client (see roadmap).

## 2. Photos or search? Both, for different jobs

You asked whether we need bag photos at all, or should just look the coffee up online and use the roaster's own listing. Short answer: **identify from the bag, enrich from the roaster's page.** Crema does both in one step.

| Fact | Bag photo | Roaster's web page |
|---|---|---|
| Which coffee it is | ✅ the label | ✅ if you already know the name |
| **Roast date** | ✅ **only here** | ❌ |
| Your exact lot (lots rotate, harvests change) | ✅ | ⚠️ may describe a newer or older lot |
| Origin, producer, variety, altitude, process detail | ⚠️ often partial | ✅ usually richer |
| Tasting notes | ✅ | ✅ |
| Roaster's recommended espresso recipe | sometimes | sometimes |
| Small local roasters with little web presence | ✅ | ❌ |
| A clean product photo for your shelf | ❌ glare, crumpled bags | ✅ the roaster's packshot |

The roast date matters most. It drives the rest window (light roasts often taste best from about day 14), and that's one of the biggest factors in how a shot tastes. No website can tell you when *your* bag was roasted.

So the model gets the photos plus web search, and every field records where it came from (`bag`, `web`, or `inferred`). Guesses are flagged for you to check, and if the bag and the website disagree on a lot fact, the bag wins.

**Product photos.** The shelf shows the roaster's own packshot rather than your snapshot of a crumpled bag. Crema reads it from the product page's metadata (Open Graph `og:image`, JSON-LD `Product.image`, or Twitter card), which nearly every roaster shop publishes. It doesn't ask the AI to guess an image URL. The image is downloaded once and cached, so the shelf works offline and doesn't keep loading from the roaster's site. When you add a coffee you choose which picture to use, and `POST /api/beans/:id/image` can re-run the lookup or take a specific image URL later. Lookups only go to public addresses, never your home network.

Search and paste-a-link use the same pipeline, so they're there too. They're handy for:
- browsing or a wishlist before you buy,
- re-adding a coffee you've had before,
- adding a coffee when the bag is in the other room.

Ideas for later:
- **Order emails**: most roasters send a confirmation with the exact product name. Crema could read these (via a Gmail integration) and add the coffee before the bag even arrives. You'd then only photograph the roast-date sticker.
- **Barcode or QR**: some bags carry them. They work as a search query today, but aren't decoded on-device yet.

## 3. AI providers and billing

You wanted to use your Claude or ChatGPT subscriptions rather than pay per API call. That works through the official command-line tools in headless mode:

| Provider | How | Billing |
|---|---|---|
| `claude-cli` | `claude -p --json-schema … --tools Read,WebSearch,WebFetch` | Your Claude Pro/Max plan. Run `claude setup-token` once on the host and set `CLAUDE_CODE_OAUTH_TOKEN`. |
| `codex-cli` | `codex --search exec --output-schema … -i photo.jpg` | Your ChatGPT plan. Run `codex login` once on the host. |
| `anthropic-api` | Anthropic SDK, structured outputs, server-side web search and fetch | API key, pay per token |
| `gemini-api` | REST `generateContent` with Google Search grounding | Gemini API key (has a free tier) |
| `mock` | Canned answers | Free. Used by the demo and tests. |

`LLM_PROVIDERS=claude-cli,codex-cli,gemini-api` tries each in order, so if you hit a usage limit on one subscription it moves on to the next.

Caveats:
- Subscription auth through these CLIs is fine for your own personal tool. It's not meant for serving other people, so if Crema ever becomes something others use, switch to API keys.
- The CLI routes depend on each tool's current flags. They're wrapped in small adapters (`server/llm/*-cli.ts`) so a flag change is a one-file fix.
- **Not yet tested against live accounts.** This session had none of your credentials. The first thing to do on the real host is one `curl` per provider (see README).

## 4. How a recipe is chosen

1. **Rules baseline** (`server/recommend/rules.ts`, no AI): roast level sets the base temperature and ratio. Process, altitude, filter versus espresso roasts, decaf and rest status adjust it. It works offline and covers about 80% of the job.
2. **AI refinement**: the model gets the coffee record, the baseline, your **actual profile library** from the machine, and your past shots of this bag. It must pick a profile title that exists on the machine (this is enforced in code), and it weighs any recipe the roaster publishes.
3. **Dial-in**: after a shot you give quick taste feedback (sour ↔ bitter, thin ↔ heavy, 1–5 stars). This is saved as a shot annotation in Decaid, and you get back one suggested change for the next shot. There's a rules fallback if the AI is unavailable.

## 5. iPhone companion

It's the same web app, served by the Crema server and added to your iPhone home screen from Safari (`manifest.webmanifest`, `apple-mobile-web-app-*` meta tags). Below 760 px wide the layout switches to a bottom tab bar. On the phone you get:

- the coffee shelf, rest windows and grams left,
- adding a coffee by photo, which opens the iPhone camera,
- machine status and live shot curves (over Decaid's WebSocket on your home network),
- recent shots with their curves and ratings.

Outside the house, use Tailscale or Home Assistant's remote access to reach the Crema server. A native SwiftUI app is only worth building for things a web app can't do well, such as widgets, Live Activities ("shot pulling: 18 s, 24 g") or Siri shortcuts. That's on the roadmap, not needed now.

## 6. Sources

- Decaid repo and skin/API docs: https://github.com/tadelv/reaprime (`doc/Skins.md`, `doc/Api.md`)
- Decent's 2025 software update: https://decentespresso.com/blog/decent_software_2025_and_beyond_skins_calibration_dflowmore
- Visualizer's AI bag import and Bean Base: https://visualizer.coffee/updates/ai-comes-to-visualizer, https://visualizer.coffee/updates/loffee-labs-meets-coffee-management
- Bean AI (iOS label scanner): https://mwm.ai/apps/bean-ai/6760227144
- Community DE1 REST/HA bridge for the classic app: https://github.com/Memberapple/decent-advanced-rest-api
- Decent Scale HA integration: https://github.com/simon-bd/decent-scale
