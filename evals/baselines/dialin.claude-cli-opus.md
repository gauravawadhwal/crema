# Eval: dialin · claude-cli:opus · reference

2026-11-05T05:49:26.700Z · commit d8542101 (uncommitted changes) · 28 cases × 1 repeats · judge claude-cli:sonnet

Prompts: DialInAdvice 425434c354

| Metric | Value |
|---|---|
| Pass rate | **100%** (95% CI 88–100%) |
| Mean score | 0.957 |
| model answered | 100% |
| right move | 100% |
| preferred move | 81% |
| one change | 100% |
| text matches fields | 100% |
| judge: no contradictions | 100% |
| judge: no invented figures | 100% |
| Errors | 0 of 28 runs |
| Latency | p50 13.1 s, p95 19.3 s |
| Cost (list price) | $0.981 total, $0.0350 per run |
| Tokens | 84,101 in, 24,605 out |

## Checks

| Check | Pass |
|---|---|
| acceptableMove | 100% (28/28) |
| judge.noContradictions | 100% (28/28) |
| judge.noInventedFigures | 100% (28/28) |
| judge.quality | 100% (28/28) |
| magnitude | 71% (5/7) |
| modelAnswered | 100% (28/28) |
| noEmoji | 100% (28/28) |
| oneChange | 100% (28/28) |
| preferredMove | 81% (17/21) |
| saneDeltas | 100% (28/28) |
| textMatchesFields | 100% (28/28) |
| validSwitch | 100% (28/28) |

## Slices

| Tag | Pass |
|---|---|
| split: dev | 100% (20/20) |
| split: holdout | 100% (8/8) |
| adversarial | 100% (1/1) |
| allonge | 100% (1/1) |
| balanced | 100% (1/1) |
| bitter | 100% (7/7) |
| blooming | 100% (1/1) |
| body | 100% (3/3) |
| conflict | 100% (2/2) |
| dark | 100% (1/1) |
| decaf | 100% (1/1) |
| fast | 100% (6/6) |
| first-shot | 100% (1/1) |
| history | 100% (2/2) |
| low-contact | 100% (1/1) |
| milk | 100% (1/1) |
| missing-data | 100% (1/1) |
| natural | 100% (1/1) |
| notes-only | 100% (1/1) |
| nuance | 100% (1/1) |
| rest | 100% (2/2) |
| slow | 100% (3/3) |
| sour | 100% (15/15) |
| switch | 100% (1/1) |
| temperature | 100% (1/1) |
| turbo | 100% (1/1) |

## Failures (0)

