# Crema AI evals

Crema calls a model in four places. This suite measures each one against
labelled cases, so you can change a prompt, a provider or a model and know
whether the result got better or worse, and by how much it costs.

| Task | Code under test | Output | Cases |
|---|---|---|---|
| `identify` | `identify()` in `server/identify.ts` | `BeanInfo` from bag photos, a fetched product page, a typed or dictated description, and/or a query | 27 self-contained + 9 live web |
| `recommend` | `recommend()` in `server/recommend/index.ts` | `Recipe`: one profile among the installed candidates, plus dose, yield, temperature and guidance | 32 |
| `dialin` | `dialIn()` in `server/recommend/index.ts` | `DialInAdvice`: the one change to make after a shot | 28 |
| `review` | `reviewShot()` in `server/recommend/review.ts` | Grounded observations, narrative and at most one next-shot change | 22 synthetic |

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
npm run eval:compare -- evals/baselines/recommend.claude-cli-opus.json evals/results/<new run>.json --fail-on-regression
```

Each run writes `evals/results/<time>-<task>-<subject>.json` (every output,
every check, every call's tokens, cost and latency) and a `.md` report next to
it. `evals/results/` is gitignored; promote a run to `evals/baselines/` when it
becomes the reference to beat.

Options: `--filter <id-substring|tag:name>`, `--split dev|holdout`,
`--repeat N`, `--concurrency N`, `--live` (adds the web-search identify cases),
`--judge provider[:model]`, `--label "prompt v2"`, and `--regrade <file>`, which
re-grades saved outputs with the current graders and labels without calling a
model.

Any provider in `server/llm/` works: `claude-cli`, `codex-cli`,
`anthropic-api`, `gemini-api` (e.g. `--provider gemini-api --model
gemini-2.5-flash-lite`), and `mock`. `--provider rules` runs Crema's
deterministic fallback in place of a model.

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
| Rules, all 22 cases | 22/22 (100%) | n/a | 100% / 100% / 100% |
| Haiku, 15 development cases × 3 | 42/45 (93%) | 44/45 (98%) | 100% / 100% / 100% |
| Haiku, 7 holdout cases × 1 | 7/7 (100%) | 7/7 (100%) | 100% / 100% / 100% |

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
needs a score of at least 0.75. The score is the mean of all checks, so it
still moves on the non-critical ones (preferred profile, tasting-note recall,
rationale shape, whether the advice text matches its fields).

`modelAnswered` fails when Crema fell back to its rules because the model
errored or named a profile it wasn't offered. The fallback hides this from
users, but the eval shouldn't.

### Model-graded checks (`lib/judge.ts`, optional)

`--judge` adds three non-critical checks to recommend, dialin and review. The judge
never decides the profile or the move; code does that.

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
5. Gate it: `--fail-on-regression --tolerance 0.05` exits non-zero if the pass
   rate or any headline metric drops by more than 5 points.

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
- When you change a label, `--regrade` the baselines rather than re-running
  them.

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
