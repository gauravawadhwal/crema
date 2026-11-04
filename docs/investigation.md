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
- **claude-cli is tested with real calls**: identification with web search (20–43 s per coffee) and recommendations (7–14 s). The first real call found a bug: Claude Code rejected Zod's `$schema` marker, so it's now stripped. In the build sandbox, Claude Code's WebFetch was blocked and only its web search worked, so the sample records come from search results. On your home server, page fetching will work and records should be fuller.
- **codex-cli and gemini-api are untested.** There was no ChatGPT login or Gemini key in the build environment.

## 4. How a recipe is chosen

The strategy is to match what the roaster says about the coffee against what community profiles are designed to do, then let the AI make the final call.

1. **Profile catalog** (`server/profiles/catalog.ts`): 31 community espresso profiles. They're described from their authors' own notes in the profile files Decaid ships (so they're already on the tablet), plus Decent's guidance. Successful users favour Londinium, D-Flow, Adaptive, Extractamundo Dos and Allongé, and Adaptive v2 is the showroom's go-to. Each entry records:
   - the style (adaptive, blooming, lever, flow, allongé, turbo, low-contact, scale-driven)
   - the roasts it was written for and whether it suits milk
   - the traits it brings forward (fruit, florals, clarity, sweetness, body, chocolate)
   - a typical recipe, difficulty, whether it needs a scale or flat burrs, and popularity
   - the author's dial-in guidance
2. **Rules ranking** (`server/profiles/match.ts`): each profile is scored against the coffee and your setup. On the coffee side that means roast fit, the processes it suits, tasting-note traits, blend or single origin, altitude and freshness. On your side it means milk or straight, scale, burrs and experience. Every point comes with a reason or a caution the app shows you. Profiles not installed on the machine are marked.
3. **Recipe per candidate**: each candidate starts from the profile's own recipe and temperature, shifted about 1.5 °C per roast step (lighter roasts hotter). A roaster's published recipe overrides dose and yield on conventional profiles. Turbo, allongé and low-contact shots keep their own logic.
4. **AI choice** (`server/recommend/index.ts`): the model reads the roaster's description, the top six installed candidates with their authors' guidance, your setup, and your past shots of the bag. It must return one of those candidates, explain the choice in 2–4 bullets, give coffee-specific dial-in guidance and suggest alternatives. If the AI is unavailable, the top-ranked rule candidate is used.
5. **Dial-in loop**: taste feedback plus the shot's time against the profile's window gives one next adjustment, using the profile author's guidance.

**Verified with real calls** (claude-cli through a Claude subscription) on nine ONA and Haven coffees (`samples/recipes.json`):
- ONA Maple (milk) → Londonium. The AI tied the caramel, biscuit and nut notes to Londonium's body.
- ONA Raspberry Candy (milk) → D-Flow / default at ONA's own 20.5 g → 38 g recipe. It warmed the suggested temperature toward ONA's 93.5 °C.
- ONA Guji Yabitu Koba G1 (light natural from 2,100–2,350 masl, straight and milk) → Best practice (light roast).
- Bright, light-to-medium coffees (straight and milk) → Adaptive v2, which the AI often preferred over the rules' first choice, Extractamundo Dos!.

Each AI call took 7–14 seconds.

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
