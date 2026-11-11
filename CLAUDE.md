# Crema: notes for agents

Crema is a custom home screen and companion app for the **Decent DE1** espresso machine. It is a web "skin" that runs on the DE1's Android tablet through **Decaid** (Decent's open-source tablet app, formerly REA / ReaPrime / Streamline Bridge), plus an optional, stateless Node server that adds AI: identifying coffees and choosing espresso profiles with an LLM. The tablet works without the server, using rules that run in the browser. The same web app is the iPhone companion (added to the home screen from Safari) and a self-contained demo.

## Documentation index

- `docs/implementation-plan.md`: Current handoff and implementation plan. "Where things stand" and "Next" list active tasks.
- `docs/history.md`: Historical log of dated status updates, past code reviews, and merged release notes.
- `docs/architecture.md`: Architecture, data ownership, API contract, and Decaid endpoints.
- `docs/design.md`: Design system, layouts, themes, and copy guidelines.
- `docs/install.md`: User-facing install guide (skin in Decaid, optional server, phone companion).
- `docs/investigation.md`: Background research and product design choices.
- `docs/parity.md`: Feature checklist and source audit against stock Decent / Streamline.

## Repo layout

| Path | What |
|---|---|
| `server/` | Crema server (TypeScript, Hono), optional and stateless. `main.ts` entry, `app.ts` routes (identify, recommend, dial-in, images, `/decaid/*` proxy) |
| `server/engine.ts` | Entry for `skin/engine.js`: catalog, ranking, recipes, dial-in rules, and defaults bundled for browser |
| `server/control/` | Pure machine decisions and shared record logic (reconcile, load-hold, shot state, bag weight, record merges). Bundled into `skin/engine.js` |
| `server/shared/defaults.ts` | Defaults for Crema records in Decaid's key-value store |
| `server/llm/` | AI provider chain: `claude-cli`, `codex-cli`, `anthropic-api`, `gemini-api`, `mock` |
| `server/profiles/` | `catalog.ts` (31 community profiles), `match.ts` (ranking), `curve.ts` (profile steps and puck simulation) |
| `server/recommend/` | `rules.ts` (baseline rules), `local.ts` (rules recipe and dial-in), `index.ts` (AI choice and dial-in) |
| `server/identify.ts`, `images.ts` | Coffee identification and roaster product photos |
| `server/safe-fetch.ts` | Safe outbound URL fetching (public IPs only, DNS/redirect checks, size and time limits) |
| `skin/` | The web app: `index.html` (markup + CSS), `app.js` (UI & live API), `demo.js` (in-browser mock), `engine.js` & `demo-data.js` (generated) |
| `dev/mock-decaid.ts` | Simulated DE1 + scale + Decaid API (including KV store) on :8080 |
| `samples/` | Sample coffee and recipe data for the demo |
| `scripts/` | Build scripts, Playwright checks, screenshots, and media generators |
| `evals/` | AI eval suite: test cases for identify, recommend, dial-in, and review (see `evals/README.md`) |
| `demo/` | Built single-file standalone demo (`crema-demo.html`) and story reel (`walkthrough.html`) |

## Key commands

```bash
npm install
npm test                    # vitest: unit tests, server flow, and engine bundle freshness
npm run typecheck           # TypeScript checks for server/
npm run build:engine        # Rebuild skin/engine.js after changing server logic, ranking, or defaults
npm run package:skin && node scripts/check-skin-zip.mjs   # Build and validate dist/crema-skin.zip
npm run mock:decaid         # Simulated DE1 machine on :8080
DECAID_URL=http://localhost:8080 LLM_PROVIDERS=mock npm start   # Run Crema server on :8787
```

### Agent skills & workflows
- **`verify-crema` skill** (`.claude/skills/verify-crema/SKILL.md`): Full verification checklist before finishing any change (unit tests, Playwright checks, tablet fit, built demo, live simulator mode).
- **`refresh-demo-assets` skill** (`.claude/skills/refresh-demo-assets/SKILL.md`): Regenerating demo data, screenshots, and walkthrough media.
- **`ai-evals` skill** (`.claude/skills/ai-evals/SKILL.md`): Running and comparing AI evals (`npm run eval -- --task all --provider ...`).

## Conventions

- **Server**: TypeScript ESM, Zod for all inputs across boundaries, Hono routes. Zod errors return 400.
- **Web app**: Plain JS, no framework, no build step. One HTML file holds all CSS. `app.js` and `demo.js` share globals; do not collide top-level identifiers.
- **Two backends, one interface**: `makeLiveApi` (`app.js`) and `makeDemoApi` (`demo.js`) implement the same interface. Any new feature must update both and usually `dev/mock-decaid.ts`.
- **The server is optional**: All core brewing features must work with no Crema server, with the server down, and with AI disabled (`settings.aiEnabled`). Non-AI features must never depend on server routes.
- **Decaid owns all data**: Beans, batches, profiles, workflow, shots, and settings live in Decaid (KV namespace `crema`). The server stores nothing but cached product photos.
- **Shared logic in `server/`**: Logic shared between server and browser lives in `server/` and compiles to `skin/engine.js`. Never duplicate it in `app.js`.
- **UI copy**: Plain, lowercase/sentence-case, user-facing ("Load onto machine", "Grind finer"). No emoji in the UI.
- **Repo hygiene**: No secrets, IPs, tokens, personal data, or deployment-specific URLs in code, docs, or sample data.

## Gotchas

- **Claude Code `--json-schema` rejects `$schema`**: Strip `$schema` using `jsonSchemaFor()` in `server/llm/types.ts`.
- **`String.replace` expands `$$`, `$&`, `$'`**: `build-demo.mjs` inlines `app.js` (which contains `$$`); use replacer functions when injecting code.
- **Never write workflow profile during a shot**: Decaid immediately sends profiles to the DE1. Always route profile writes through `loadOntoMachine`, which holds loads during an active shot (`S.heldLoad`).
- **`shotRunning()` during drops**: `shotRunning()` remains true even if machine socket disconnects mid-shot (`S.shotAcross`). Do not replace with a simple `state === "espresso"` check.
- **Shared KV writes require read-and-merge**: Decaid KV has no concurrency checks. Always use `patchRecord` or `E.mergeRecord` (`server/control/record.ts`); never overwrite from stale state.
- **Ratings are 0–10**: Decaid ratings are 0–10 (rendered as half-stars). Do not convert to 1–5 in code, prompts, or evals.
- **Profile temperatures apply across all steps**: DE1 profiles set temperature per step. Adjust temperature by shifting all steps (`withTemperature` in `server/recommend/local.ts`), never just step 1.
- **Workflow settings for steam/water/flush**: Use `machine.workflowSettings` (`steamSettings`, `hotWaterData`, `rinseData`), not `POST /machine/shotSettings` (which Decaid does not copy into workflow). Constrain to `WF_LIMITS`.
- **Decaid profile licensing**: Decaid profiles and Streamline code are GPL-3.0. Do not copy their code into this repo. Crema uses its own outline profiles and simulator puck models.
- **Prompt descriptions**: Models only see prompt text. Describe all numeric scales and enum meanings in system prompts; Zod `.describe()` on input schemas is not seen by the LLM.
- **Theme token specificity**: Themes use `html:root[data-skin="..."]` to outrank light/dark blocks. Charts read CSS variables at render time; trigger `route(false)` after theme changes.
- **Tablet viewport sizing**: Home screen must fit 1340×800 down to 1005×552 without scrolling. Run `check-tablet-fit.cjs` after layout changes.
- **Committed engine bundle**: `skin/engine.js` is generated but checked into git. Run `npm run build:engine` if `test/flow.test.ts` reports it is stale.
- **HTTPS to Decaid**: Browsers block mixed-content requests from HTTPS pages to Decaid (plain HTTP). `discoverConnections` does not probe local Decaid from HTTPS.
