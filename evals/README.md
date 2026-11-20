# Crema AI evals

Crema calls a model in four places. This suite measures each one against
labelled cases, so you can change a prompt, a provider or a model and know
whether the result got better or worse, and by how much it costs.

| Task | Code under test | Output | Cases |
|---|---|---|---|
| `identify` | `identify()` in `server/identify.ts` | `BeanInfo` from bag photos, a fetched product page, a typed or dictated description, and/or a query | 27 self-contained + 9 live web |
| `recommend` | `recommend()` in `server/recommend/index.ts` | `Recipe`: one profile among the installed candidates, plus dose, yield, temperature and guidance | 32 |
| `dialin` | `dialIn()` in `server/recommend/index.ts` | `DialInAdvice`: the one change to make after a shot | 28 |
| `review` | `reviewShot()` in `server/recommend/review.ts` | Grounded interpretation, recorded history and one next decision | 41 synthetic |

The runner calls those real functions, with the real prompts and the real
post-processing (rules fallback, profile-title matching), and swaps only the
provider. A prompt edit in `server/` is therefore what gets measured.

## Quick start

```bash
npm run eval -- --task all --provider rules                     # free: the no-AI baseline
```

```bash
npm run eval -- --task recommend --provider claude-cli --model haiku
```

```bash
npm run eval -- --task dialin --provider claude-cli --model sonnet --repeat 3 --judge claude-cli:sonnet
```

```bash
npm run eval:compare -- <reference-with-manifest.json> <candidate-with-manifest.json> --fail-on-regression
```

Each run writes `evals/results/<time>-<task>-<subject>.json` (every output,
every check, every call's tokens, cost and latency) and a `.md` report next to
it. `evals/results/` is gitignored; promote a run to `evals/baselines/` when it
becomes the reference to beat.

Options include `--filter <id-substring|tag:name>`, `--split dev|holdout`,
`--date YYYY-MM-DD` to pin relative case dates,
`--repeat N`, `--concurrency N`, `--live` (adds the web-search identify cases),
`--judge provider[:model]`, `--label "prompt v2"`, and `--regrade <file>`, which
creates a new report with current graders and labels. It records the source
file's SHA-256 and preserves that file. Regrading requires a manifest and
refuses removed cases or changed inputs. Add `--judge` to run a new judge
against the saved answer. The older committed reports without manifests remain
available for descriptive comparison. Review defaults to the dev split.
Select the historical panel explicitly with `--split holdout`.

Any provider in `server/llm/` works: `claude-cli`, `codex-cli`,
`anthropic-api`, `gemini-api` (e.g. `--provider gemini-api --model
gemini-2.5-flash-lite`), and `mock`. `--provider rules` runs Crema's
deterministic fallback in place of a model.

## Shot-review quality — 12 November 2026

The legacy review suite has **41 synthetic cases**. Of these, 30 were authored
for development and 11 carry the historical `holdout` split name. Their committed
final score comes from rescoring already-viewed model outputs, so all 41 count as
development evidence. The split names and baselines are preserved for historical
comparisons. The suite tests
recorded-history comparisons and confounds, timing/target interpretation, useful
abstention, high-flow tracking and limiter behavior, notes-driven advice, negation
and embedded instructions. The design,
comparison tolerances and limitations are in
[shot-review-quality.md](../docs/shot-review-quality.md).

Factual/decision checks are independent authored expectations. With `--judge`,
review contradictions, invented figures and specificity/actionability/plain-language
scores are independent gates. The score average cannot compensate for an unusable
next step. The lexical explanation/experiment checks remain diagnostics; they are
not a substitute for semantic judging. Reports without a judge establish the code
checks only. Missing judge replies are reported as failures, never as successful
quality validation.

The judge receives the system instructions and case input the subject actually saw,
including computed comparisons, and rejudging uses saved historical prompt text.
Illustrative prompt examples are not measurements. Grader tests include known good
paraphrases and intentionally wrong answers, not just the rules output.

For controlled Codex evals, use an explicit model and the eval-only wrapper to avoid
loading desktop integrations. Production provider defaults are unchanged:

```bash
CODEX_BIN="$PWD/scripts/codex-eval-isolated.cjs" CODEX_REASONING_EFFORT=medium npm run eval -- --task review --provider codex-cli --model gpt-6.1-terra --split dev --repeat 3 --judge codex-cli:gpt-6.1-sol
CODEX_BIN="$PWD/scripts/codex-eval-isolated.cjs" CODEX_REASONING_EFFORT=medium npm run eval -- --task review --provider codex-cli --model gpt-6.1-terra --split holdout --judge codex-cli:gpt-6.1-sol
```

Use these commands to reproduce legacy comparisons. Compare runs with matching
datasets, providers, judge and gate versions to isolate a prompt change.

Measured baselines (Terra subject, Sol judge; isolated, medium reasoning):

| Baseline | Result |
|---|---|
| `review.rules.json` | 36/39; conservatively abstains on semantic notes cases |
| `review.codex-cli-gpt-6.1-terra-dev.json` | 84/84 dev trials; all model/judge calls answered |
| `review.codex-cli-gpt-6.1-terra-initial-holdout.json` | First holdout: 9/11; two factual-check coverage errors |
| `review.codex-cli-gpt-6.1-terra-holdout.json` | Same saved outputs rescored 11/11 after grader corrections; **not fresh** |

The original holdout and corrected rescore are both committed. The corrections
recognize correctly assigned numeric comparisons and recorded setting labels,
without changing the prompt or intended decisions. The 32 quota-failed dev trials
were retried with exact system/input guards; the initial 52 completed trials were
preserved. See the quality record for provenance, confidence limits and diagnostic
heuristic rates. These synthetic results do not establish physical diagnostic accuracy.

Claude Haiku/Opus revalidation is deferred after a subscription-limit failure.
Interrupted reference runs and a stale-desktop-MCP Codex run are not promoted as
complete quality baselines. The older Haiku results below measure earlier prompts.

## Curve-first review harness

The curve harness uses independent labels for mechanical events. The checked-in
[demonstration dataset](fixtures/review-ablation/demonstration.json) has one
synthetic dev case and one synthetic holdout case to exercise the tooling. A later
stage will author and freeze new, unseen cases for the actual holdout.

### Run crossed checks and ablations

```bash
npx tsx evals/review.ts cross --fixture history-grind-progress
npx tsx evals/review.ts cross --fixture history-grind-progress --provider mock
npx tsx evals/review.ts run --dataset evals/fixtures/review-ablation/demonstration.json --provider rules
npx tsx evals/review.ts run --dataset evals/fixtures/review-ablation/comparable-history.json --provider rules
npx tsx evals/review.ts run --dataset evals/fixtures/review-ablation/taste-alignment.json --variant two-stage --provider rules
```

`cross` takes a synthetic fixture from `evals/lib/review-fixtures.ts`. It crosses
eight current taste settings with three recorded history taste settings. All
24 cells keep telemetry and mechanical history fixed. Bag descriptors and prior
review prose also vary. The adapter compares the serialized curve-stage input
and output byte for byte. `--provider mock` also compares the actual curve
narrative prompt and the resulting mechanical stage.

`run` defaults to dev/tuning and tries every registered variant. `old` and
`facts-plus-anchored` retain the pre-split reviewer with its 50-point and
event-anchored samplers, respectively. `two-stage` runs the current review.
`facts-only` remains pending. The taste-alignment dataset labels agreeing,
conflicting, absent and ambiguous notes-only feedback under the same curve.

Results are a JSON file and matching Markdown report in `evals/results/` or a
directory supplied with `--out`. Synthetic reference runs can be promoted to
`evals/baselines/` within this report format. `eval:compare` continues to compare
the legacy wording/decision reports.

The ablation reports carry case, input, label and repeat digests alongside the
scorer fingerprint. Detector and evidence metrics check code-generated findings
and figures, with precision and recall by profile family. The legacy adapter
uses issue window starts for windowed timing and has no raw onset or peak
timestamps. A peak value can still be checked. Comparable-history figures
assess the code's same-mass pressure, pressure crest and reference count.

Reviewer assessment uses only model-authored content that reached the answer.
For the staged variant this includes the accepted curve interpretation and
any note attribution or adjustment the model supplied and the review adopted.
The reviewer gets no credit for detector figures, deterministic history prose
or a change chosen by rules. A scripted independent judge can assess the
authored answer through the library. The rules and mock CLI reports are
diagnostic and ineligible for promotion. Missing semantic coverage and invalid
citations are reported separately. Failed model requests contribute to model
coverage and fallback rate. Useful fallback decisions have their own labelled
denominator.

Prompt size and landmark visibility for model runs come from the captured
subject request. Rules output labels prompt rendering as counterfactual.
These measurements describe what a request carried. Reviewer assessment
measures the interpretation the answer actually gives.

### Label sources and groups

The strict schema is in `evals/lib/review-labels.ts`. Give each case one
`labels.source` and cite its evidence in the corresponding field.

| Source | Evidence | Storage |
|---|---|---|
| `synthetic-injected` | `injection` describes the feature or control deliberately set in a made-up recording. | Synthetic datasets |
| `measured-reference` | `reference` describes the physical measurement and how the reference was obtained. | Private replay sidecars |
| `sensory` | `taste` captures the taster's ratings or notes. Enjoyment uses Decaid's 0–10 scale. | Private replay, or simulated sensory reports in synthetic datasets |

Mechanical labels use `observations` with unique `id`, `kind`, and
`expected` (`required` or `forbidden`). Add `phase` and `controlledVariable`
where they are known. A `timing` label specifies `onsetS` and optional
`peakS` as inclusive `[earliest, latest]` bounds on the shot's sample clock.
Timing bounds must fit the recording. `raw-landmark` bounds must contain a
sample. Adjacent samples can extend the match by one sample when the gap is
within the machine telemetry limit. `windowed-event` bounds accept ±1 s beyond
each edge. Matching maximizes the number of paired events, then minimizes
total timing error. Unsupported timing has its own coverage count. Use
`figures` with an ID, value, recognized unit and bounded absolute tolerance.
Observation and figure IDs are unique within a case, and required and
forbidden observations must have non-overlapping reference predicates.

Declare `exhaustiveEventKinds` to assess all predictions of those kinds,
including ones with no expected detections. Omit it to retain coverage for
the kinds explicitly labelled. Unmatched predictions outside assessed coverage
are unknown. Set `exhaustiveFigures: true` to reject extra figure IDs in a fully
adjudicated case. Any label source may declare `supportedOutcomes` and
`forbiddenClaims`. Sensory reports supply decision and claim evidence.

Label the input independently of the review under test. Synthetic cases have
an inline `input` in the API's review payload shape, a `profileFamily` and
`pumpMode`, and stable `session` and `recipe` group IDs. Group repeated or
closely related shots by session and recipe. Cases that share either group must
stay in the same split, including chains linked by both kinds of group. The
loader rejects crossed groups and repeated case IDs.

### Independent synthetic recordings

The `independent` dataset replays 12 independently authored Decaid
recordings from [six matched pairs](fixtures/review-independent/design.md).
Both arms of each public pair are in the dev split. The runner uses the Decaid
recording mapper and validates the sidecar labels as synthetic injected truth.

```sh
proof=$(mktemp -d)
npx tsx evals/review.ts cross --dataset independent --provider rules
npx tsx evals/review.ts cross --dataset independent --provider mock
npx tsx evals/review.ts run --dataset independent --provider rules --out "$proof"
npx tsx evals/review.ts run --dataset independent --provider mock --out "$proof"
```

Mock crossing checks that the curve output, any narrative prompt and the
decision to call the narrative provider stay invariant. The short `f2`
recording takes the rules path. The [fixture notes](fixtures/review-independent/README.md)
cover regeneration, and the [design report](fixtures/review-independent/design.md#production-evidence)
records the baseline coverage gaps.

### Seeded synthetic shot gym

```sh
scenarios=evals/fixtures/review-gym
proof=$(mktemp -d)
npx tsx evals/gym.ts validate --scenarios "$scenarios" --seeds 8
npx tsx evals/gym.ts generate --scenarios "$scenarios" --seeds 8 --out "$proof/gym"
npx tsx evals/gym.ts replay-check --out "$proof/gym"
npx tsx evals/review.ts run --dataset "$proof/gym/dataset.json" \
  --provider rules --variant old --variant facts-plus-anchored --out "$proof/rules"
```

Generation uses no network or model calls. `--seeds N` runs seeds 0 through
N−1 for every design. Use a new output directory whose parent already exists.
`dataset.json` is the existing inline review dataset. The adjacent
`replay.json` pins the generator version, seed count, resolved plans and
grader-only context. Keep both for byte-for-byte verification. Pass only the
case's `input` to a reviewer. Keep the case ID, group IDs, seed, labels and
intervention parameters in the eval harness. Keep generated holdout files
with the custodian until evaluation.

Author one JSON object per file using the [strict scenario schema](lib/gym/scenario.ts).
The [worked manifests](fixtures/review-gym/) supply a matched high-flow pair
and a normal lever decline. Eight seeds each yield 24 dev cases.

| Field | Authoring contract |
|---|---|
| `version`, `id`, `family` | Use schema version 1, a unique lowercase fixture ID and one of `flat-pressure`, `lever`, `fixed-flow`, `allonge`, `bloom`, `turbo`, `adaptive`. |
| `session`, `recipe`, `split` | Share group IDs across linked variants, place the group in one split and use `dev` or `holdout`. Matched variants with the same session and seed share the random streams. |
| `profile` | Omit `steps` to use Crema's outline for the family. Custom steps declare `name`, `pump`, `target` and maximum `seconds`. Targets use bar for pressure and mL/s for flow. Set `transition: "smooth"` for a ramp, `sensor` to `coffee` or `water`, and optionally override `temperatureC` or set `substate: "preinfusion"`. The `limiter.value` and optional `range` use the other pump channel's units. `exit` takes `type`, `condition` (`over` or `under`) and `value`. An optional `weightG` also advances the step. |
| `doseG`, `stop`, `puck` | Default dose is 18 g. `stop.timeS` defaults to 90 s and can be set up to 180 s. `stop.weightG` is optional. `puck.resistance` is the baseline wet load in bar per (mL/s) before throughput-dependent softening. |
| `interventions` | Use an empty list for a clean control. `low-resistance` and `restriction` take a load multiplier `factor`. `flow-cap` takes a hidden pump capacity `maxMlS`. `onset-dynamics` sets `fillMl` and outlet charge `delayMl`. `tare-jump` offsets scale mass by `deltaG`, `scale-loss` removes scale readings through the optional `untilS` (exclusive), `sensor-lag` delays the named pressure, flow or temperature channel by `delayS`, and `thermal-recovery` applies a `dropC` with decay constant `recoveryS` to the active sensor. `atS` is on the shot clock where provided, with the tare and loss applied on the scale sampling clock. |
| `grading` | Describe the expected sampled `consequence` and the conditions in `unknowableWhen`. Use the existing `observations`, `figures`, `supportedOutcomes` and `forbiddenClaims`. Grade the observed regime under a limiter and accept uncertainty about the cause. `acceptCauseAbstention` records that expectation for graders. Include `abstain` in `supportedOutcomes` when omitting a numeric change is valid. |

Clean controls use the existing synthetic label source with `injection: "none"`.
Author bounds on the irregular machine sample clock in seconds from brew start.
Validation checks that every raw landmark interval contains a sample for each
requested seed. Check the actual landmark brackets and phase coverage when
adding a scenario. The legacy review runner scores event kinds emitted as
review issues. Descriptive labels such as `planned_decline` and
`cap_like_start` can be checked against the production analysis landmarks
with the same label scorer, as in [the kernel tests](../test/review-gym.test.ts).

The v1 kernel advances at 10 ms. It uses Mulberry32 streams keyed with SHA-256
over the generator version, session, seed and stream name. Scenario variation,
pump noise, sampling jitter and sensor faults have independent keys. Machine
and scale have separate sampling and fault streams. The model fills a retained
volume, varies wet resistance with throughput and couples group pressure to
pump flow through that resistance. A soft limiter tapers response in its
configured range and enforces a hard ceiling. The pump approaches the
constrained flow with a finite response time. Steps advance on the first
applicable time, threshold or weight exit. Threshold and step weight exits
arm after 0.5 s. A global weight stop uses latent cup mass. A global clock
stop appears as a controller `apiStop`.

Cup flow starts after the outlet charges and can continue during a pause.
The fixed synthetic conversion is 0.98 g/mL. Inlet volume equals retained
volume plus delivered mass divided by that density at every tick. This
idealization keeps the mechanism auditable when recorded inlet estimates
and scale rates differ. The machine clock samples every 190–300 ms and
pairs the latest snapshot from an independent 80–120 ms scale clock. Both
can have missing observations. Tare and other reporting faults leave the
latent state and controller stops unchanged. The mix and group readings
recover toward separate targets and record the active profile sensor target.
Changes to the kernel or replay mapping that alter fixture bytes require a new
generator version. Keep the matching revision to replay earlier outputs.

### Freeze and verify a holdout

The demonstration exercises the commands without creating the fresh holdout.

```bash
dataset=evals/fixtures/review-ablation/demonstration.json
proof=$(mktemp -d)
npx tsx evals/review.ts freeze --dataset "$dataset" --manifest "$proof/holdout.json"
npx tsx evals/review.ts check --dataset "$dataset" --manifest "$proof/holdout.json"
npx tsx evals/review.ts run --dataset "$dataset" --manifest "$proof/holdout.json" \
  --split holdout --purpose evaluate --provider rules --out "$proof"
```

`freeze` writes canonical SHA-256 hashes of the full holdout cases and refuses
to overwrite the manifest. The check rejects changed, added and removed
cases. Identical normalized recordings cannot cross splits even under
different session or recipe IDs.

All holdout runs require `--split holdout --purpose evaluate --manifest <file>`.
The public demonstration records attempts beside the manifest in JSONL and
can be reused. For a protected panel, the custodian keeps the dataset,
manifest and results private and sets `CREMA_HOLDOUT_ATTEMPTS_DIR` to one
durable, access-controlled directory. Nominate a single explicit `--variant`.
The evaluator reserves the attempt before execution. The ledger records the
sealed panel digest and keys the reservation on the normalized recording
cohort, so a copied manifest or relabelled copy cannot restart it in the same
ledger. A failed or interrupted attempt still counts. The current rules/mock
CLI returns only an inconclusive promotion verdict and the seal for protected
panels. A custodian-approved, separately calibrated judge is still required
for promotion.

### Replay private Decaid recordings

Set `CREMA_LOCAL_SHOTS_DIR` to an absolute directory outside Git worktrees.
Place one full Decaid shot object per `.json` file, in the format returned by
`/shots/<id>`. For example:

```bash
CREMA_LOCAL_SHOTS_DIR="/path/to/private/crema-local-shots" npx tsx evals/review.ts replay --provider rules
```

Replay mirrors the live skin's point mapping, timestamp ordering, sample cap,
recorded recipe context, notes and ratings. It reconstructs earlier same-batch
history from the available recordings and validates the payload as the server
does. Standalone exports lack the installed profile library, bean snapshot and
saved recipe, so the CLI uses captured metadata and the catalogue when available.

For optional real-shot labels, place `<stem>.local-review-labels.json` beside
`<stem>.json`, with `profileFamily`, `pumpMode`, and one `labels` object.
Measured and sensory labels use separate cases. Replay prints aggregate metrics
by source to stdout. Keep real recordings and their labels outside the worktree.
Git ignores `crema-local-shots/`, `*.decaid-shot.json` and `*.local-review-labels.json`
as an extra safeguard. Public fixtures and labels must be synthetic.

## Shot review baseline — 10 November 2026

The first review baseline uses synthetic telemetry, not calibrated physical shots.
Findings and their time ranges are computed by code; the model writes the narrative
and next step. The runner exercises the shipped validation and rules fallback.

| Run | Pass | Model answered | Grounded ranges / one change / no false alarms |
|---|---|---|---|
| Rules, all 20 cases | 20/20 (100%) | n/a | 100% / 100% / 100% |
| Haiku, 14 development cases × 3 | 40/42 (95%) | 42/42 (100%) | 100% / 100% / 100% |
| Haiku, 6 original holdout cases rechecked × 1 | 6/6 (100%) | 6/6 (100%) | 100% / 100% / 100% |

Saved as `review.rules.json`, `review.claude-cli-haiku-dev.json` and
`review.claude-cli-haiku-holdout.json` in `baselines/`, with reports alongside.
The remaining development misses were two conservative abstentions on a gusher.
The first untouched holdout scored 5/6 (83%): the model asked for taste despite
supplied ratings. Final code derives that flag from the input; a regression test
covers both directions. The original holdout was then rechecked and passed 6/6.
That recheck is **not a fresh holdout**; its first run is also committed as
`review.claude-cli-haiku-initial-holdout.json`. No prompt tuning used holdout content,
and no provider default changed.

The earlier development prompt allowed model-authored issues and caused excessive
fallbacks. Restricting the model to narrative, while retaining canonical findings
in code, raised development pass rate from 26% to 93% before the taste-state correction.
The final development and holdout recheck together reported $0.028 at the CLI's list-price estimate. These small
synthetic sets establish software behavior, not diagnostic accuracy or prose quality;
real-shot calibration and human review remain required.

### Real-shot fixes — 10 November 2026

Replaying the first 12 real Decaid shots showed the v0.4.0 review never helped: 8
requests were rejected (Decaid's `-1` "no target" and a cup bump below −5 g), and
the rest graded no step, because every main pour carried a flow limiter, so the
model's answer was replaced with "not enough comparable telemetry". Limited steps
and smooth phases are now graded, Decaid's preinfusion phase is not, temperature
is compared on the sensor each step controls and only during a settled pour, and
a well-recorded shot keeps the model's narrative even when no step can be graded.
The prompt now carries measured shot facts (time, yield, ratio, phases). Two cases
model the real shape (`review-limited-pour`, dev; `review-limited-pour-sour`,
holdout).

| Run | Pass | Model answered | Grounded ranges / one change / no false alarms |
|---|---|---|---|
| Rules, all 26 cases | 26/26 (100%) | n/a | 100% / 100% / 100% |
| Haiku, 15 development cases × 3 | 42/45 (93%) | 44/45 (98%) | 100% / 100% / 100% |
| Haiku, 7 holdout cases × 1 | 7/7 (100%) | 7/7 (100%) | 100% / 100% / 100% |

Four additional cases (11 November 2026) cover expected-window pace (`review-fast-time`,
`review-slow-time`) and step-level pressure/flow shortfalls under an engaged limiter
(`review-limited-pressure-shortfall`, `review-flow-shortfall`), along with grader checks
for diagnostic summary insight (`insightfulSummary`) and explained grind direction
(`grindDirectionMatchesIssue`). The rules baseline (`review.rules.json` / `.md`) passes
all 26 cases (100%).

Against the previous development baseline (95%), the shared cases agree on the
move 93% of the time; the misses are two conservative abstentions (one choke, one
gusher) and one rules fallback on an unknown-profile case, each in one of three
repeats. These replace the baselines above; the holdout has now been seen once
more, so it is not fresh.

```bash
npm run eval -- --task review --provider rules
npm run eval -- --task review --provider claude-cli --model haiku --split dev --repeat 3
npm run eval:compare -- evals/baselines/review.claude-cli-haiku-dev.json evals/results/<new>.json
```

## Current results

Reference runs, committed in `evals/baselines/`. Opus is the reference
("teacher"); Haiku is the cheap candidate; rules is what Crema does with no
model at all. Cost is list price as the Claude CLI reports it.

<!-- results:start -->
Run on 2026-11-05 with the `claude-cli` provider. Haiku ran each case three
times, the others once. Recommend and dial-in text was judged by Sonnet. "Cost
per run" is one case, at list price as the CLI reports it.

| | Opus (reference) | Sonnet | Haiku | Rules, no AI |
|---|---|---|---|---|
| identify: pass (21 cases) | 100% | 100% | 100% | n/a |
| identify: cost per coffee | 3.7¢ | 2.6¢ | **0.20¢** | n/a |
| recommend: pass (32 cases) | 100% | 100% | 100% | 91% |
| recommend: preferred profile | **87%** | 78% | 68% | 61% |
| recommend: no invented figures (judge) | 38% | 66% | **82%** | n/a |
| recommend: cost per recipe | 6.2¢ | 2.7¢ | **0.14¢** | free |
| dial-in: pass (28 cases) | **100%** | 96% | 94% | 86% |
| dial-in: cost per piece of advice | 3.5¢ | 1.4¢ | **0.07¢** | free |
| live web lookup: pass (9 coffees) | 100% | not run | 100% | n/a |
| live web lookup: cost, p50 time | 13.6¢, 37 s | not run | 4.0¢, 50 s | n/a |

What these runs found:

- **A prompt bug.** The dial-in prompt passed the taste sliders as bare
  numbers without saying what they mean. Haiku read `sourBitter: 1` as "sour"
  and advised grinding finer on a bitter shot, all three times; Opus guessed
  right. One sentence describing the scales fixed it: Haiku's dial-in pass
  rate went from 91% to 94%, and that case from 0/3 to 3/3 (prompt
  `b903214b57` → `425434c354`).
- **The rules are a strong baseline.** On static matching (roast, milk,
  scale, burrs) the deterministic ranking already picks an acceptable profile
  94% of the time. Models add value on what rules can't read: past shots
  (`rec-history-*`), notes-only signals (`dial-astringent-notes`), and
  conflicting signals (`dial-sour-but-slow`, `dial-bitter-but-fast`). They
  also pick the best fit (preferred) more often.
- **Haiku is the cheap option for identification and recommendation.** It
  matches Opus on every critical check at 1/18 to 1/44 of the cost. It picks
  the best-fit profile less often (68% against 87%). Its remaining dial-in
  misses: on a turbo shot it confuses the author's *end* flow target with
  *average* flow (2 of 3 runs), and after six failed shots it splits the grind
  difference again instead of changing another variable (3 of 3; arguably a
  label to revisit).
- **The bigger models invent profile targets.** 62% of Opus recipes state
  figures that aren't in the profile notes they were given ("first drips at
  8–12 s", "peak around 8–9 bar"). The figures are plausible, but no source
  backs them, and users act on them. The judge also caught a real
  contradiction: "you're about four days into this bag" for a coffee with no
  roast date. Either put authoritative targets in the catalog or tell the
  model to quote only given figures, then re-run.
- **Identification is saturated for Claude models.** Every tier passes every
  self-contained case, including the hard ones (Japanese label, foil bag with
  only a production code, packed and roasted dates on one stamp). The set
  still matters as the floor a cheaper model must clear.

### Cheapest model per provider (8 November 2026)

Haiku, Codex `gpt-6-luna` at low reasoning effort (`CODEX_REASONING_EFFORT=low`) and
Gemini `gemini-3.5-flash-lite`, each case three times, no judge, self-contained cases
only. Identify ran with the new prompt (roaster's own site first, describe-it input,
fewer flags) and the 6 new `id-describe-*` cases; recommend and dial-in prompts are
unchanged.

Cost is the API list price of the tokens each call used, so the three are comparable.
What you actually pay differs: through the Claude and Codex CLIs, calls count against
your Claude or ChatGPT plan's limits rather than being charged per call; Gemini is
billed per token to the API key. The CLIs also send their own agent instructions with
every call (about 14–16k tokens, mostly cached), which a direct API call wouldn't.
Prices per 1M tokens (input / cached / output), checked 8 November 2026: Haiku 5.5
$0.10 / $0.01 / $0.50 (the CLI's own cost report, which splits cache writes from
reads); GPT-6-Luna $0.10 / $0.01 / $0.50 (OpenAI standard tier); Gemini 3.5
Flash-Lite $0.30 / $0.03 / $2.50 (paid tier; Google Search grounding, which live
lookups use, is 5,000 requests a month free, then $14 per 1,000). Codex's cost comes
from a separate single-repeat run that recorded its tokens (`codex exec --json`);
`compare.ts` still shows "–" for Codex and Gemini because only the Claude CLI reports
a cost itself.

| | Haiku | Codex GPT-6-Luna | Gemini 3.5 Flash-Lite |
|---|---|---|---|
| identify: pass (27 cases) | **100%** | 95% | 96% |
| recommend: pass (32) | 100% | 100% | 99% |
| recommend: preferred profile | 71% | 68% | **83%** |
| dial-in: pass (28) | **93%** | 82% | 92% |
| p50 time (identify / recommend / dial-in) | 12.5 / 9.7 / 5.8 s | 11.0 / 10.7 / 7.0 s | **2.4 / 1.9 / 1.2 s** |
| cost per call (identify / recommend / dial-in) | 0.20 / 0.13 / 0.064¢ | **0.061 / 0.078 / 0.044¢** | 0.18 / 0.18 / 0.050¢ |
| 1,000 coffees added (identify + recommend) | $3.33 | **$1.38** | $3.56 |

For scale, Opus 5.5 (the reference above) costs about $98 per 1,000 coffees at list price.

What these runs found:

- **Two provider bugs, fixed before the numbers above.** Codex never received
  bag photos: `-i` takes several files and swallowed the prompt, so every photo
  case failed (identify 65% → 95% once fixed). Gemini Flash-Lite sometimes
  returned malformed JSON or numbers as text; Gemini now enforces the schema
  when there's no web search, and repairs type slips and retries once when there
  is (identify 84% → 96%).
- **Today's identify changes didn't regress anything.** Haiku matches its old
  identify baseline on all 21 shared cases and passes the 6 new ones.
- **Gemini Flash-Lite reads US dates day-first.** `id-bag-us-date` fails 3/3:
  10/03/2026 from a US roaster becomes 10 March, not 3 October. It's otherwise
  the fastest by 5x and picks the best-fit profile nearly as often as Opus.
- **Codex Luna at low effort is weakest on dial-in.** It adds yield to a thin
  shot (`dial-lost-in-milk`, `dial-balanced-thin`, 3/3), and its `change` text
  sometimes contradicts `grindDelta`; the dial-in schema fields have no
  descriptions. On identify it ignores the product page when a bag photo is
  also given (`id-bag-plus-page-enrich`, 3/3).

Mean score includes the judge's checks where a run has them, so compare pass
rates and headline rows across judged and unjudged runs, not mean score.

<details><summary>Full tables (from <code>npm run eval:compare -- --markdown</code>)</summary>

**identify**

|  | claude-cli:opus (reference) | claude-cli:sonnet | claude-cli:haiku (describe+roaster-first) | codex-cli:gpt-6-luna (describe+roaster-first, provider fixes) | gemini-api:gemini-3.5-flash-lite (describe+roaster-first, provider fixes) |
|---|---|---|---|---|---|
| cases × repeats | 21 × 1 | 21 × 1 | 27 × 3 | 27 × 3 | 27 × 3 |
| pass rate | 100% (85%–100%) | 100% (85%–100%) | 100% (96%–100%) | 95% (88%–98%) | 96% (90%–99%) |
| passed every repeat | 100% | 100% | 100% | 93% | 96% |
| mean score | 0.994 | 1.000 | 0.991 | 0.973 | 0.992 |
| roaster+name right | 100% | 100% | 100% | 100% | 100% |
| process right | 100% | 100% | 100% | 98% | 100% |
| roast date read right | 100% | 100% | 100% | 100% | 91% |
| roast date invented | 0% | 0% | 0% | 0% | 0% |
| recipe invented | 0% | 0% | 0% | 0% | 0% |
| injection resisted | 100% | 100% | 100% | 100% | 100% |
| tasting notes | 100% | 100% | 100% | 97% | 100% |
| errors | 0 | 0 | 0 | 0 | 0 |
| latency p50 / p95 | 11.1 s / 15.2 s | 7.3 s / 12.6 s | 12.5 s / 16.1 s | 11.0 s / 12.5 s | 2.4 s / 3.2 s |
| cost per run | $0.0369 | $0.0258 | $0.0020 | – | – |
| prompts | b20cff0514 | b20cff0514 | f6d42c189f | f6d42c189f | f6d42c189f |

**recommend**

|  | claude-cli:opus (reference) | claude-cli:sonnet | claude-cli:haiku | codex-cli:gpt-6-luna (describe+roaster-first) | gemini-api:gemini-3.5-flash-lite (describe+roaster-first) | rules |
|---|---|---|---|---|---|---|
| cases × repeats | 32 × 1 | 32 × 1 | 32 × 3 | 32 × 3 | 32 × 3 | 32 × 1 |
| pass rate | 100% (89%–100%) | 100% (89%–100%) | 100% (96%–100%) | 100% (96%–100%) | 99% (94%–100%) | 91% (76%–97%) |
| passed every repeat | 100% | 100% | 100% | 100% | 97% | 91% |
| mean score | 0.937 | 0.949 | 0.947 | 0.977 | 0.986 | 0.948 |
| model answered | 100% | 100% | 100% | 100% | 100% | 100% |
| acceptable profile | 100% | 100% | 100% | 100% | 99% | 94% |
| preferred profile | 87% | 78% | 68% | 68% | 83% | 61% |
| forbidden profile | 0% | 0% | 0% | 0% | 0% | 3% |
| recipe in bounds | 100% | 100% | 100% | 100% | 100% | 78% |
| judge: no contradictions | 91% | 94% | 90% | – | – | – |
| judge: no invented figures | 38% | 66% | 82% | – | – | – |
| errors | 0 | 0 | 0 | 0 | 0 | 0 |
| latency p50 / p95 | 15.2 s / 25.3 s | 7.3 s / 9.6 s | 10.0 s / 14.6 s | 10.7 s / 14.1 s | 1.9 s / 2.1 s | 0.0 s / 0.0 s |
| cost per run | $0.0615 | $0.0273 | $0.0014 | – | – | – |
| prompts | 7d02f0cf36 | 7d02f0cf36 | 7d02f0cf36 | 7d02f0cf36 | 7d02f0cf36 | – |

**dialin**

|  | claude-cli:opus (reference) | claude-cli:sonnet | claude-cli:haiku | codex-cli:gpt-6-luna (describe+roaster-first) | gemini-api:gemini-3.5-flash-lite (describe+roaster-first) | rules |
|---|---|---|---|---|---|---|
| cases × repeats | 28 × 1 | 28 × 1 | 28 × 3 | 28 × 3 | 28 × 3 | 28 × 1 |
| pass rate | 100% (88%–100%) | 96% (82%–99%) | 94% (87%–97%) | 82% (73%–89%) | 92% (84%–96%) | 86% (69%–94%) |
| passed every repeat | 100% | 96% | 93% | 75% | 86% | 86% |
| mean score | 0.957 | 0.944 | 0.930 | 0.930 | 0.958 | 0.967 |
| model answered | 100% | 100% | 100% | 100% | 100% | 100% |
| right move | 100% | 96% | 94% | 82% | 92% | 86% |
| preferred move | 81% | 81% | 75% | 75% | 76% | 86% |
| one change | 100% | 100% | 100% | 100% | 100% | 100% |
| text matches fields | 100% | 100% | 100% | 98% | 99% | 100% |
| judge: no contradictions | 100% | 96% | 95% | – | – | – |
| judge: no invented figures | 100% | 100% | 100% | – | – | – |
| errors | 0 | 0 | 0 | 0 | 0 | 0 |
| latency p50 / p95 | 13.1 s / 19.3 s | 5.3 s / 7.6 s | 5.4 s / 8.4 s | 7.0 s / 8.9 s | 1.2 s / 1.4 s | 0.0 s / 0.0 s |
| cost per run | $0.0350 | $0.0137 | $0.0007 | – | – | – |
| prompts | 425434c354 | 425434c354 | 425434c354 | 425434c354 | 425434c354 | – |

</details>
<!-- results:end -->

## How it works

### Datasets (`datasets/*.json`)

Each case has an `id`, a `split`, `tags` for slicing, the `input`, the
`expect`ed answer, and a `why` that explains the label to a reviewer.

- **identify**: fixtures in `fixtures/` are fictional roasters on `.example`
  domains: 12 product pages as text and 9 rendered bag-label photos. They are
  self-contained, so a run doesn't depend on the web, and each case is built
  around something identification gets wrong in practice:
  - date formats (Australian, US and German day/month order, a packed date
    next to a roast date, a handwritten sticker)
  - a best-before date or production code with no roast date, which must not
    become one
  - the bag disagreeing with the website (the bag wins on lot facts)
  - altitude in feet, a recipe given as a ratio, German and Japanese labels
  - a collection page listing three coffees
  - customer reviews posing as tasting notes, and a page carrying a
    prompt-injection payload
  - descriptions as the user would say them into "Describe it": names
    misheard by sound, "roasted last Tuesday" against a fixed `today`, a
    self-correction ("the fourth, no sorry, the sixth"), numbers as words,
    and a blend whose text fields must stay text
  - facts a page simply doesn't give (no altitude, no producer), which must
    stay empty and not be flagged: `notFlagged` lists fields that must not
    appear in `needsConfirmation`

  The `live` cases look up the real ONA and Haven coffees on the web, as the
  search box does. They're slow and not reproducible, so they only run with
  `--live`.
- **recommend**: each case labels `acceptable` profiles (a good barista would
  accept them), `preferred` ones (the best fits) and `forbidden` ones (clearly
  wrong for this coffee or setup), from the profile authors' notes in
  `server/profiles/catalog.ts`. Some cases add recipe bounds (roaster recipe,
  past shots, basket size) or require rest advice. Slices cover milk vs
  straight, no scale, conical burrs, new users, limited installed profiles,
  decaf, wet-hulled, anaerobic and filter roasts, shot history, and prompt
  injection.
- **dialin**: advice is reduced to its main move (`finer`, `coarser`,
  `yield-up`, `yield-down`, `temp-up`, `temp-down`, `switch`, `keep`) and
  graded against the moves a good barista would `accept`. Several cases are
  built so the obvious rule is wrong: sour but slow, bitter but fast, a notes
  field that says "astringent" while the sliders read balanced, a turbo shot
  that's fast by design, and six failed shots that justify switching profile.

- **review**: reproducible curves in `lib/review-fixtures.ts` cover settled normal
  shots, sustained low/high flow, qualified flow rise, missing telemetry and scale,
  manual and unknown profiles, bloom/turbo, temperature curves, early stops,
  conflicting taste and embedded instructions. Checks cover required/forbidden
  findings, supported moves, exact installed-profile switches, one change, bounded
  ranges, missing taste and whether the model fell back to rules.

Coffees that recur are defined once in a file's `beans` map and referenced
with `ref`; real sample coffees are referenced by name with `sample`. Roast
dates and shot history are written relative to the run (`roastDaysAgo`,
`daysAgo`), so rest status means the same on any day.

### Graders (`lib/graders.ts`, `lib/review-grader.ts`)

Graders are code, not models. Each case becomes a list of named checks.
**Critical** checks are the ones a user would call a wrong answer (wrong
coffee, invented roast date, forbidden profile, wrong direction, two changes at
once). A case passes only if every critical check passes; for identify it also
needs a score of at least 0.75. The score is the mean of the scored checks, so it
still moves on the non-critical ones (preferred profile, tasting-note recall,
rationale shape, whether the advice text matches its fields).

Model-answer grades require known answer provenance and a successful subject
completion. Failed requests and unknown historical provenance cannot receive
model quality credit. Rules controls have their own provenance, and fallback
utility has its own denominator. Review trial wording heuristics are diagnostics
outside the ranked score.

### Model-graded checks (`lib/judge.ts`, optional)

`--judge` adds non-critical style and grounding checks to recommend and
dialin. Shot review uses a separate judge with critical evidence checks. Its
canonical envelope is identical for every source and omits subject prompts,
model identifiers and grader labels. The judge assesses numeric grounding,
causal restraint, taste attribution and advice alignment in separate fields.
Every veto needs exact answer text and canonical evidence. Unavailable or
incomplete judgments are coverage gaps. Fabricated citations cannot veto an
answer. Review records retain evidence and rubric digests for rejudging.

- **no contradictions**: nothing in the text conflicts with the input. Each
  finding must quote both the answer and the input words it conflicts with.
- **no invented figures**: no specific targets (pressures, drip times, flow,
  rest days) presented as the profile's or coffee's own when the input gives
  none.
- **quality**: specificity, actionability and plain language, 1–5 each.

Calibration: an earlier version asked one yes/no question ("faithful?")
without requiring quotes. Reading its output, about half its findings were
items it then called "fine". Requiring quotes from both sides cut the flagged
Opus contradictions from about 20 to 3, and all 3 were real. It still misses
some, so treat judge numbers as a comparison between runs with the same judge,
not as absolute truth. Keep the judge model fixed, and preferably different
from the model under test, since models rate their own writing higher. The
baselines use Sonnet; its own row is judged by itself, so read Sonnet's judge
numbers with that in mind. `--regrade <file> --judge <model>` re-judges saved
outputs without calling the model under test.

### Statistics (`lib/report.ts`)

With about 30 cases, one case is about 3 points, so every pass rate comes with
a 95% Wilson interval. `--repeat N` runs each case N times. "Passed every
repeat" (pass^k) is the share of cases that passed all N times, which shows
consistency rather than luck. Use the `holdout` split to check that a prompt
tuned on `dev` cases didn't just learn the dev cases.

## Trying a cheaper model

1. Run it on the dev split, with repeats:
   `npm run eval -- --task all --provider gemini-api --model gemini-2.5-flash-lite --repeat 3 --split dev`
2. Compare with the reference:
   `npm run eval:compare -- evals/baselines/<task>.claude-cli-opus.json evals/results/<run>.json`.
   This prints the metric table, the cases that got worse, and **agreement**:
   how often the cheap model gives the reference's answer (same profile, same
   move). Low agreement with a high pass rate is fine; low agreement with a
   low pass rate shows where it falls short.
3. Read the failures in the run's `.md` report, fix the prompt or the
   provider adapter, and re-run.
4. When dev looks good, run the holdout split once to confirm.
5. For a gate, use reference and candidate reports from the same panel and
   scorer with the same judge settings. `--fail-on-regression --tolerance 0.05`
   requires matching case, input, label and repeat digests and required
   check coverage per slot before applying the tolerance. Use
   `--vary-subject` if the subject settings are the factor under test.
   Include a judge for model review comparisons. Pin `--date` when the
   task uses relative dates. The gate reports unpaired rows and check coverage.

The tasks differ in what they need. `identify` is extraction from photos and
text, plus a web lookup. A small model can do the extraction once code has
fetched the page (`pageText` on `identify()`), and the self-contained cases
measure exactly that. `recommend` reads a long prompt and judges between close
candidates. `dialin` is close to classification. Each task can use a
different provider; measure each one separately.

## Adding cases

- Label from the catalog and first principles, not from a model's output.
  Write the reason in `why`.
- Check a recommend case shows the model an acceptable candidate: `npx tsx
  evals/inspect.ts recommend <id>` prints the six candidates with ✓ ★ ✗ marks
  and the rules' own pick. If no acceptable profile is shown, the case tests
  the ranking, not the model.
- `npx tsx evals/inspect.ts dialin <id>` prints the recipe the shot is judged
  against and the rules' move.
- New label photos go in `fixtures/render-labels.cjs` (`npm run eval:labels`).
  New pages go in `fixtures/pages/`. Keep roasters fictional, on `.example`
  domains.
- `npm test` validates every dataset file: schema, unique ids, real profile
  titles, fixtures present.
- After changing labels, use `--regrade` on captured runs with verified
  manifests. Compare the newly derived reports on the same label revision.

## Limits

- The labels were written by an AI (Claude) from the profile authors' notes
  and standard extraction logic, not by a panel of baristas. They are a
  starting point to argue with: change a label when a barista disagrees, and
  say why in `why`.
- The fixtures are clean compared with phone photos of crumpled bags. Add real
  photos (with permission, no personal data) when you have them.
- Live identify cases depend on search results that change; treat them as a
  smoke test, not a benchmark.
- Nothing here checks behaviour on a real DE1. A recipe can pass every check
  and still taste wrong, so feed real shot outcomes back in as dial-in and
  history cases.

## Refreshing the tables above

```bash
for t in identify recommend dialin; do npx tsx evals/compare.ts --markdown evals/baselines/$t.claude-cli-opus.json evals/baselines/$t.claude-cli-sonnet.json evals/baselines/$t.claude-cli-haiku.json evals/baselines/$t.codex-cli-gpt-6-luna.json evals/baselines/$t.gemini-api-gemini-3.5-flash-lite.json $(ls evals/baselines/$t.rules.json 2>/dev/null); done
```

See [Shot review gym iteration](ITERATION.md) for the offline demonstration and approved real-provider workflow.
