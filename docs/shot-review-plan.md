# AI shot review: research and implementation plan

Planned 9 November; implemented 10 November 2026. **First version implemented; verification recorded below.** Requested outcome: a button that reviews
a finished shot from its curves (pressure, flow, weight, temperature against the
profile's targets), together with taste when the user gives it, and says what
went well, what didn't and the one change to make next. Only run when asked.

Builds on `server/profiles/curve.ts` (profile plan and real step timings from
`profileFrame`), merged in PR #31. Tracked in the
[implementation plan](implementation-plan.md) (history: "Suggested next sessions", item 11, in [history.md](history.md)).

## First-version scope and implementation record

The first version adds explicit Review shot / Review again actions after brewing
and in shot history, including bagless shots. Reviews are stored per shot in
Decaid, and AI is called only on request. Nothing is applied to the machine.

The original design below is research, not a promise that every detector ships.
This implementation deliberately narrows it:

- The recorded workflow/profile and actual yield belong to the completed shot;
  a bag's current recommendation is not substituted. Missing telemetry stays
  unknown. Temperature is compared with its corresponding recorded target.
- Taste starts unset. Both taste and body must be explicitly selected before
  numerical taste feedback is supplied; a balanced selection is distinct from
  no feedback. Notes and ratings retain their normal storage.
- Local checks require sufficiently long, settled, comparable windows. They
  report sustained flow/pressure differences and qualified flow-rise evidence,
  with temperature offsets as observations. There is no automatic failed-puck
  verdict, yield-only choke diagnosis, or general timing rule for manual shots.
- A review may suggest no change or say the evidence is insufficient. Conflicting
  taste and curve evidence must not force a grind direction. Manual/unknown
  profiles receive conservative treatment.
- AI sees bounded history and sampled curves, preserves measured finding evidence,
  and may suggest at most one bounded change. Profile switches must name an
  installed profile. Source labels distinguish AI from local fallback.
- Existing shot annotations, including other plugins' extras, are preserved.
  Stored results carry a version, source and creation time.
- Chart shading, follow-up chat, scores, numeric grinder calibration and
  automatic application remain deferred.

Evaluation cases live in `evals/datasets/review.json`, with deterministic
synthetic telemetry in `evals/lib/review-fixtures.ts`. These test false positives,
missing data, manual/bloom/turbo behavior, early stops and taste conflicts. They
are not evidence of physical diagnostic accuracy. Real-shot calibration and a
supervised tablet acceptance session remain pending; no hardware brew is required
for local implementation.

Verification: pending final integrated checks for this change.

## Why this is new

"Next adjustment" (`dialIn` in `server/recommend/index.ts`) sends the model the
taste sliders and a `PastShot` summary: time, dose, yield, grinder setting. It
never sees the curves, so it can't tell a choked puck from a channelled one, a
skipped preinfusion step from a slow one, or whether the profile was followed.

## How others do it

Researched 9 November 2026 from public repositories and docs. Nobody publishes
evaluations, so treat the quality claims below as claims.

| Project | Shot data given to the model | Output | Trigger |
|---|---|---|---|
| [Decenza](https://github.com/Kulitorum/Decenza) (Qt DE1 controller, `docs/SHOT_REVIEW.md`, `src/ai/`) | Typed observations from deterministic detectors (channeling, grind, pour truncated, skip-first-frame, preinfusion drip, flow trend), per-phase peaks and a few samples, taste, bean, profile. The detectors' verdict line is stripped so it doesn't anchor the model | Advice, with a follow-up "Discuss" conversation | Detectors run on every shot; AI on button |
| [decentespresso-mcp](https://github.com/The-Walker443/decentespresso-mcp) (Decaid, MCP for Claude) | Puck resistance (pressure / flow², settled window, flow ≥ 0.4 ml/s), five channeling indicators with raw values and thresholds, target compliance per held channel, temperature against target, preinfusion end from `substate`, then `profileFrame`, then a pressure heuristic | Conversation; the server computes, Claude interprets | On request |
| [visualizer-lite](https://github.com/TomSchmidtDev/visualizer-lite) (`docs/ai-analysis.md`) | Shot fields, curves downsampled to 50 points per channel, per-phase stats (mean, min, max, σ, trend) from full-resolution phase detection, baseline from up to 100 earlier shots | `{barista: [...], roaster: [...]}`, 3–5 bullets each, stored per shot with token cost | Button; Regenerate button |
| [waevans10/crema](https://github.com/waevans10/crema) (GaggiMate) | Transformed telemetry (temperature stability, resistance, channeling risk, profile compliance), newest 5 shots with the review given after each, 1–5 rating and notes as ground truth | Score, diagnosis, grind change, dose/yield change, profile changes, confidence. The stored score is replaced by a deterministic one | Button; optional auto-review, off by default |
| [yarneo/crema](https://github.com/yarneo/crema) (de1app/Decaid skin, `server/advisor/prompting.py`) | Summary stats, five curves downsampled to 60 points, full profile JSON, four taste taps, earlier shots of the bean with the advice given | Diagnosis, confidence, actions (grind, dose, yield, temperature), keep/switch/create profile, a 160-character screen summary | "Get advice" button |

Common ground:

- Code computes the numbers and the model interprets them. Raw full-rate series
  aren't sent; downsampled curves (50–60 points) or phase summaries are.
- Taste outranks telemetry. Telemetry can't taste sourness or bitterness.
- One change per shot, grind first.
- Reviews are stored with the shot and regenerated only on request.
- Projects that show a score replace the model's score with a computed one.

Notes:

- Decenza's channeling detector judges only windows where the target is steady,
  the actual is within 15% of it, and pressure isn't rising, with pressure goals of
  4.5 bar or more. It trims the first 2 s and last 1.5 s, and skips flow above
  3 ml/s and profiles that expect channeling. It fires on a sustained rise in
  conductance, not on a single spike.
- decentespresso-mcp found its five channeling indicators rarely agree (no two
  fired together across 171 shots). Expect false positives from any single check
  and present findings as observations, not verdicts.
- The first sample's `profileFrame` can hold the previous shot's value; ignore a
  frame change in the first 0.5 s.
- yarneo/crema is also a DE1 skin called "Crema" with AI dial-in. Worth knowing
  for naming in this public repo.

## Design

### 1. Shot checks, no AI

New `server/profiles/analysis.ts`, pure like `curve.ts`, bundled into
`skin/engine.js` so it runs on the tablet with no server.

Input: the shot's points as the app already builds them (`shotPoints` in
`app.js`: `t, p, f, w, temp, tp, tf, frame`), the profile, and the recipe's
targets. Add `substate` and scale weight flow to `shotPoints` if Decaid
snapshots carry them (architecture notes say snapshots have `state.substate`).

Metrics:

- Steps from `stepDurations`; preinfusion end from `substate`, then the
  profile's first pressure-rise step, then the first time pressure reaches 60% of
  its peak (flagged as a guess).
- Time to first drip (weight above 0.5 g after taring), drips during
  preinfusion, peak pressure and when, flow per step.
- Target tracking per step for the channel the step controls (pressure or flow),
  as mean absolute error.
- Puck resistance (p / f²) over the settled part of the pour and its trend.
- Flow in the last 30% of the pour against the first 30%.
- Yield against target, ratio, total time against the recipe's target time,
  temperature against target, and why the shot stopped (weight, time, step
  limits, or the user).

Findings, each with a `kind`, a severity (`info`, `caution`, `warning`), the
numbers behind it and a time range for the chart:

- `puck_failed`: peak pressure below 2.5 bar during the pour. Suppresses the
  grind and channeling findings.
- `choked` and `gushed`: flow far below or above a steady flow target, mean flow
  under 0.5 ml/s at 4 bar or more for 15 s, or yield under 70% or over 120% of
  target.
- `channeling`: resistance falling steadily while pressure is held, judged only
  in steady-target windows as above. Skipped for high-flow and turbo-style
  profiles.
- `preinfusion_drip`: weight landing during preinfusion (information, not a
  fault; some profiles want it).
- `first_step_skipped`: the first step ended well before its time limit without
  a confirmed exit condition.
- `off_target_temp`: mean temperature more than 1 °C from target.

Thresholds start from the projects above and get tuned against the simulator
cases and, later, real shots from the tablet. Unit tests in
`test/analysis.test.ts`.

### 2. AI review

`POST /api/review` → `reviewShot(llm, input)` in `server/recommend/`.

The prompt carries:

- the findings, without any overall verdict;
- curves downsampled to about 50 points (pressure, flow, weight, temperature and
  their targets);
- the profile's steps in words, from `curve.ts`, and the author's dial-in
  guidance from the catalogue;
- the coffee, the recipe and its target time;
- taste (sour–bitter, body, enjoyment 0–10, notes) when given;
- earlier shots of this bag with the review or advice each one got.

The system prompt describes every scale and field (the model only sees what the
prompt says): what each finding kind means, what the targets are, the taste
scales, and that enjoyment is 0–10 in half stars.

Output `ShotReview` (Zod, in `server/schema.ts`):

- `summary`: one or two sentences;
- `wentWell[]`;
- `issues[]`: `{ what, evidence, severity, fromS, toS }`;
- `nextShot`: the `DialInAdvice` fields (`change`, `grindDelta`, `yieldDeltaG`,
  `tempDeltaC`, `switchProfile`, `reasoning`);
- `confidence`: low, medium or high;
- `askTaste`: true when taste is missing and would change the advice.

Code enforces that `switchProfile` names an installed profile, as recommend
already does.

Rules fallback, when AI is off, the server is down or the model fails: the
findings as the issues, `rulesDialIn` for `nextShot` when taste was given (or a
curve-only grind direction from `choked`/`gushed` when it wasn't), and
`source: "rules"`.

### 3. In the app

- One **Review shot** button in the after-shot panel, replacing "Next
  adjustment". The taste sliders feed the review; its `nextShot` is the advice.
  Two AI buttons on one panel would compete.
- The same button on a shot opened from Shots, so older shots can be reviewed.
- Issue time ranges shaded on the shot chart, with the findings listed under it.
- The review is saved in Decaid at `annotations.extras.crema.review` with its
  source and time, next to `sourBitter` and `body`. Opening the shot shows the
  saved review; **Review again** asks the model a second time.
- `review` added to both `makeLiveApi` and `makeDemoApi` (`e2e-live.cjs`
  checks they match). The demo returns a saved sample review from `samples/`.
- Copy: "Review shot", "Review again", "From Crema's shot checks" or "Review from
  the AI". No score.

### 4. Evals

New `review` task in `evals/`:

- Cases from `shotSim` with planted faults: channeling (resistance drops
  mid-pour), choke, gusher, failed puck, a clean shot, and taste that contradicts
  the curves.
- Graders: names the planted fault, `nextShot` direction is right, no invented
  issue on the clean shot, `modelAnswered`.
- Baselines for rules, Haiku and Sonnet; pick the default model from cost
  against quality.

## Order of work

1. `analysis.ts` with unit tests; rebuild `engine.js`.
2. Fault injection in `shotSim` (shared by the simulator, demo and evals).
3. `ShotReview` schema, `reviewShot()` and `/api/review` with the rules fallback.
4. The app: button, saved review, chart shading, demo backend.
5. Evals and baselines; `docs/architecture.md` (new route and stored field).
6. Tablet check on real shots: `profileFrame` numbering, `substate` names and
   threshold tuning.

## Later

- "Discuss this shot": a follow-up conversation on a review.
- Comparing a shot with the reference shot or the best-rated shot of the bag.
- A computed score, if the findings prove reliable on real shots.

## Acceptance

- With AI off or no server, Review shot returns the shot checks and a rules
  change, and saves them.
- The AI review never names a profile that isn't installed and never runs
  without a tap.
- A saved review reappears on reload and on the phone.
- Simulator shots with planted faults are flagged by the checks; the eval
  baselines are committed.
- Tablet fit holds with a review open (`check-tablet-fit.cjs`).

## Real shots — 10 November 2026

The first 12 real shots on the user's DE1 were replayed read-only through v0.4.0's
`/api/review` (the request rebuilt as `skin/app.js` does). None got a usable review:

| Cause | Shots | Fix |
|---|---|---|
| Decaid records `-1` as "no target" (de1app imports, and the pump not in control); `ReviewPoint.tp`/`tf` were `min(0)`, so the server returned 400 and the skin fell back to rules without saying so | 7 | Readings outside a plausible range become null ("unavailable") in `ReviewPoint`, never a 400. The skin logs the failure |
| A scale tare or cup bump reached −124 g, below `w`'s −5 g floor | 1 | Same: the reading becomes null, and so does a negative fallback yield |
| `skippedStep()` skipped any step with a limiter. Every main pour on this machine has one (*Extractamundo Dos!* "6 bar", *Gentle and sweet* "rise and hold"), so no step was graded and `validateReview()` replaced the model's summary with "not enough comparable telemetry" | 4 | Limited steps are graded; no rule calls a fault from a shortfall a limiter could explain. Decaid's preinfusion phase is never graded instead. A well-recorded shot (20+ samples over 10+ s) keeps the model's narrative when nothing can be graded; only a thin shot gets the stock sentence |

Two more problems turned up on the same shots:

- **Temperature findings were wrong.** Most DE1 profiles use sensor "coffee": the
  machine targets the group temperature and deliberately runs the mix water hotter or
  cooler, so mix against its target (what v0.4.0 compared) reported −4.0 and +6.1 °C
  on shots that were fine. Group temperature reads ~20 °C cold in preinfusion, and a
  profile that steps down (82 → 73 °C) runs hot because the machine can't cool. The
  check now uses the reading each step controls (`groupTemp` from skins that send it),
  only during the pour, a few seconds after a target change, and never after a step
  down to cooler water.
- **The model had to estimate everything from 50 samples.** `shotFacts()` measures
  time, preinfusion, first drips, yield, ratio, stop reason and pour pressure and
  flow from every sample; the prompt carries them as SHOT FACTS, and the rules
  summary leads with them ("34.6 g from 18 g (1:1.9) in 26 s, 5 s of it preinfusion,
  stopped at the target weight.").

Replayed again with `claude-cli` (Opus), every well-recorded shot gets a short,
specific narrative and nothing is falsely flagged; the 7-sample shot is still
refused. Released in v0.4.1. Redeploying the server fixes AI reviews even for the v0.4.0
skin; the temperature check and the better rules summary need the v0.4.1 skin.

