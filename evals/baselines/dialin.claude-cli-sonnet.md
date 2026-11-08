# Eval: dialin · claude-cli:sonnet

2026-11-05T05:48:30.919Z · commit d8542101 (uncommitted changes) · 28 cases × 1 repeats · judge claude-cli:sonnet

Prompts: DialInAdvice 425434c354

| Metric | Value |
|---|---|
| Pass rate | **96%** (95% CI 82–99%) |
| Mean score | 0.944 |
| model answered | 100% |
| right move | 96% |
| preferred move | 81% |
| one change | 100% |
| text matches fields | 100% |
| judge: no contradictions | 96% |
| judge: no invented figures | 100% |
| Errors | 0 of 28 runs |
| Latency | p50 5.3 s, p95 7.6 s |
| Cost (list price) | $0.382 total, $0.0137 per run |
| Tokens | 84,273 in, 12,523 out |

## Checks

| Check | Pass |
|---|---|
| acceptableMove | 96% (27/28) |
| judge.noContradictions | 96% (27/28) |
| judge.noInventedFigures | 100% (28/28) |
| judge.quality | 100% (28/28) |
| magnitude | 63% (5/8) |
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
| split: dev | 95% (19/20) |
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
| history | 50% (1/2) |
| low-contact | 100% (1/1) |
| milk | 100% (1/1) |
| missing-data | 100% (1/1) |
| natural | 100% (1/1) |
| notes-only | 100% (1/1) |
| nuance | 100% (1/1) |
| rest | 100% (2/2) |
| slow | 100% (3/3) |
| sour | 100% (15/15) |
| switch | 0% (0/1) |
| temperature | 100% (1/1) |
| turbo | 100% (1/1) |

## Failures (1)

- **dial-switch-after-many**: **acceptableMove** (move finer; acceptable ["switch","temp-up"]); preferredMove (move finer; preferred switch); judge.noContradictions ("settings 10–11 (25–28 s) were very sour" vs input ""grinderSetting":"10","enjoyment":2,"notes":"sour"")
