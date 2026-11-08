# Eval: dialin · rules

2026-11-05T05:35:39.798Z · commit d8542101 (uncommitted changes) · 28 cases × 1 repeats

Prompts: none (no model calls)

| Metric | Value |
|---|---|
| Pass rate | **86%** (95% CI 69–94%) |
| Mean score | 0.967 |
| model answered | 100% |
| right move | 86% |
| preferred move | 86% |
| one change | 100% |
| text matches fields | 100% |
| Errors | 0 of 28 runs |
| Latency | p50 0.0 s, p95 0.0 s |

## Checks

| Check | Pass |
|---|---|
| acceptableMove | 86% (24/28) |
| magnitude | 100% (9/9) |
| modelAnswered | 100% (28/28) |
| noEmoji | 100% (28/28) |
| oneChange | 100% (28/28) |
| preferredMove | 86% (18/21) |
| saneDeltas | 100% (28/28) |
| textMatchesFields | 100% (28/28) |
| validSwitch | 100% (28/28) |

## Slices

| Tag | Pass |
|---|---|
| split: dev | 90% (18/20) |
| split: holdout | 75% (6/8) |
| adversarial | 100% (1/1) |
| allonge | 100% (1/1) |
| balanced | 100% (1/1) |
| bitter | 86% (6/7) |
| blooming | 100% (1/1) |
| body | 100% (3/3) |
| conflict | 0% (0/2) |
| dark | 100% (1/1) |
| decaf | 100% (1/1) |
| fast | 83% (5/6) |
| first-shot | 100% (1/1) |
| history | 50% (1/2) |
| low-contact | 100% (1/1) |
| milk | 100% (1/1) |
| missing-data | 100% (1/1) |
| natural | 100% (1/1) |
| notes-only | 0% (0/1) |
| nuance | 100% (1/1) |
| rest | 100% (2/2) |
| slow | 67% (2/3) |
| sour | 93% (14/15) |
| switch | 0% (0/1) |
| temperature | 100% (1/1) |
| turbo | 100% (1/1) |

## Failures (4)

- **dial-astringent-notes**: **acceptableMove** (move keep; acceptable ["coarser","yield-down","temp-down"])
- **dial-bitter-but-fast**: **acceptableMove** (move coarser; acceptable ["finer","temp-down","yield-down"]); preferredMove (move coarser; preferred finer)
- **dial-sour-but-slow**: **acceptableMove** (move finer; acceptable ["coarser","temp-up","yield-up"])
- **dial-switch-after-many**: **acceptableMove** (move finer; acceptable ["switch","temp-up"]); preferredMove (move finer; preferred switch)
