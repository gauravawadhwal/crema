# Shot-review quality and recorded history

12 November 2026. Implementation: `codex/shot-review-quality`.

## Product contract

A review should help choose the next decision: interpret the strongest evidence,
state what it cannot establish, and propose one small trial with something to watch
for. It should not narrate the header or treat matching a profile as proof of good
extraction. Taste is reported by the user; telemetry cannot supply it.

The prompt now prioritizes a useful conclusion and a short explanation over a
fixed checklist of numbers. A changed grind setting and changed time can be an
association, never proof of causation or better taste. Conflicting evidence calls
for a specific repeat/check instead of an arbitrary adjustment. A large yield and
flow-control mismatch can justify checking the profile and stopping settings
before trying grind; the gusher eval accepts this concrete alternative.

Code retains authority over measured facts, observations and bounded one-variable
advice. Ramp targets and missing recorded targets are not treated as steady holds.
The review distinguishes an absent recording from a short/sparse recording or an
early manual stop. Suggestions remain draft-only and never write machine settings.

## History contract

An explicit review scans at most 1,000 summaries and hydrates at most ten earlier
shots of the same bag. This also works for an older selected shot; it no longer
just takes the bag's newest ten. Failed full reads are omitted. Measurements and
settings come from captured shot records, never the next-shot draft.

Comparison requires an earlier timestamp, matching recorded profile shape/title,
dose within 0.5 g, measured and known intended yields within 2 g or 5%, and starting temperature within
0.5 °C. Missing facts, early stops and substantially under-target completions are excluded. These are conservative software
comparison tolerances, not experimentally established espresso thresholds.

Grinder settings are opaque labels. Equal labels mean the same *recorded setting*,
not verified grinder identity. Numeric order does not establish finer/coarser.
A previous AI review is omitted from the model's evidence; recorded history and
computed comparison/rejection reasons are supplied instead. Raw profile-shape
strings are also omitted from the model prompt to avoid wasting tokens.

A saved current recipe supplies an old shot's time window only when recorded dose,
target yield, temperature and profile shape (when available) still match. The input
marks the window as recorded, matching recipe or catalogue guide. A guide is
explicitly approximate; if its dose or intended yield differs, timing stays descriptive
and cannot alone support a grind adjustment; legacy unknown windows and unknown custom profiles stay
unknown. These input fields are optional for older clients. Saved review version 1
is unchanged; no migration is needed.

## Taste notes and fallback

A model must quote the sensory report verbatim in a private `notesEvidence` field
and separately classify its reported character in `notesTaste` before a notes-only
adjustment is accepted. This separates taste interpretation from selecting a move. Code checks the quote's source,
limits notes-only adjustments to a small trial, and abstains when the proposed
grind direction opposes the recorded mechanics. Both private fields are stripped before
saving/displaying the review. Exact quotation proves provenance, not semantic
correctness: negation and embedded instructions are evaluated separately.

The rules fallback does not pretend to interpret free text. With notes but no
numeric taste feedback it preserves the observations and asks for taste confirmation
before selecting a grind adjustment, rather than ignoring a possibly contradictory
note. Real notes-driven advice remains an AI capability.

## Evaluation design

There are 39 synthetic cases: 28 development and 11 holdout. Authored expectations
are independent of the analysis implementation. They cover timing, pressure/flow,
limits, missing data, early stops, manual/unknown profiles, taste conflicts,
changed/same/missing grind labels, changed recipes/profiles, genuine and negated
taste notes, and instructions embedded in notes.

Code checks factual comparisons, direction consistency, one change, installed
profiles and grounded ranges. Adversarial grader tests reject keyword padding,
header-only answers, wrong windows, swapped pressure values, invented history and
empty cautions. Wording heuristics are diagnostics; they do not force one causal
connector or reject a valid answer merely for using different prose.

When a judge is requested, review quality is gated separately on contradictions,
invented figures and minimum specificity/actionability/plain-language scores. A
high score on one dimension cannot hide an unusable next step. Missing judge
answers fail coverage rather than silently counting as quality evidence. The
judge sees the historical system instructions and actual case input; illustrative
examples are not case facts. Subject and judge prompt hashes/texts are recorded,
and rejudging uses the saved historical system rather than today's prompt.

This follows the distinction between task-specific outcome checks and calibrated
judgment in [Anthropic's evaluation guidance](https://www.anthropic.com/research/demystifying-evals-for-ai-agents)
and [OpenAI's evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices).
Synthetic checks and another model's judgment establish software behavior and
usefulness under the rubric, not physical diagnostic accuracy or the owner's taste.

## Validation record

| Run | Strict checks + quality gates | Model / judge answered |
|---|---|---|
| Rules, all 39 cases | 36/39 (92%) | no model or judge |
| Codex Terra, 28 dev cases × 3, Sol judge | 84/84 (100%), after grader correction | 84/84 each |
| Codex Terra, 11 holdout cases × 1, original checks | 9/11 (82%) | 11/11 each |
| Same saved holdout outputs, corrected grader | 11/11 (100%), **not a fresh holdout** | no new model calls |

The final Codex subject is `gpt-6.1-terra`, with independent `gpt-6.1-sol` judging,
medium reasoning and the isolated eval wrapper. Model/judge contradictions, invented
figures and minimum quality dimensions all pass on the final development and holdout
answers. The noncritical lexical experiment heuristic reports 83% dev and 50%
holdout; it misses some valid wording that the semantic judge accepts.

The original holdout failures were grader coverage errors: a correct 1.1 vs 2.2 ml/s
comparison did not say "below", and a correct E-3 → E-4 comparison did not repeat
"grind". Their original outputs and scores are preserved in
`review.codex-cli-gpt-6.1-terra-initial-holdout.*`; the rescore is separately named.
No model prompt or intended holdout verdict was tuned from those outputs. Development
checks also learned ordinary valid inflections ("conflicts", "lacks", "unsuitable").
These corrections are regression-tested, but the rescored holdout is no longer fresh.

The final development run first completed 52/84 trials before a provider limit.
The 32 unavailable trials were retried after access returned. Every retry checked
that both system hash and full case input matched the original before making a call;
completed trials were retained. All 84 final trials and judges answered. This is
complete coverage of the planned repeats, not a claim that the interrupted attempt
had no availability failures.

The three rules misses are notes-only cases: two require semantic taste-led advice,
and one requires explaining a taste/curve conflict. The fallback safely abstains;
it does not pretend to understand notes. Recommend/dial-in rules remain identical
to their existing baselines (100% agreement).
Claude's subscription limit interrupted the Haiku/Opus reference reruns. Those
partial failures remain local availability evidence, not promoted quality baselines.
A non-isolated Codex run also encountered a stale desktop MCP endpoint and is not
a valid complete model baseline.

The eval-only `scripts/codex-eval-isolated.cjs` wrapper uses the documented
[`--ignore-user-config` and `--ephemeral` execution mode](https://learn.chatgpt.com/docs/non-interactive-mode)
with an explicit model. It retains authentication without inheriting desktop
integrations or changing production provider configuration. Reproduction commands
and measured baselines are in [the eval guide](../evals/README.md).

No release, NAS/tablet deployment or physical-machine test accompanies this change.


Software validation: 17 unit/server test files, typecheck, JavaScript syntax,
source/built demo, live simulator, brewing/favourites, saved-review live/demo,
all five tablet-fit sizes, source/built normal/stress target checks and installable
skin ZIP. Source/built screenshots were inspected. An initial built target run had
navigation timeouts; the isolated rerun passed all 12 runs with zero target failures.
Independent code review found the intended-yield and guide-ratio comparison issues;
both were reproduced, fixed and covered by regressions.
