# Eval: dialin · codex-cli:gpt-6-luna · describe+roaster-first

2026-11-08T05:44:15.577Z · commit 9b85f30a (uncommitted changes) · 28 cases × 3 repeats

Prompts: DialInAdvice 425434c354

| Metric | Value |
|---|---|
| Pass rate | **82%** (95% CI 73–89%) |
| Passed every repeat | 75% of cases |
| Mean score | 0.93 |
| model answered | 100% |
| right move | 82% |
| preferred move | 75% |
| one change | 100% |
| text matches fields | 98% |
| Errors | 0 of 84 runs |
| Latency | p50 7.0 s, p95 8.9 s |

## Checks

| Check | Pass |
|---|---|
| acceptableMove | 82% (69/84) |
| magnitude | 35% (8/23) |
| modelAnswered | 100% (84/84) |
| noEmoji | 100% (84/84) |
| oneChange | 100% (84/84) |
| preferredMove | 75% (47/63) |
| saneDeltas | 100% (84/84) |
| textMatchesFields | 98% (82/84) |
| validSwitch | 100% (84/84) |

## Slices

| Tag | Pass |
|---|---|
| split: dev | 77% (46/60) |
| split: holdout | 96% (23/24) |
| adversarial | 100% (3/3) |
| allonge | 0% (0/3) |
| balanced | 100% (3/3) |
| bitter | 90% (19/21) |
| blooming | 100% (3/3) |
| body | 33% (3/9) |
| conflict | 83% (5/6) |
| dark | 100% (3/3) |
| decaf | 100% (3/3) |
| fast | 100% (18/18) |
| first-shot | 100% (3/3) |
| history | 50% (3/6) |
| low-contact | 100% (3/3) |
| milk | 0% (0/3) |
| missing-data | 100% (3/3) |
| natural | 100% (3/3) |
| notes-only | 100% (3/3) |
| nuance | 100% (3/3) |
| rest | 100% (6/6) |
| slow | 89% (8/9) |
| sour | 91% (41/45) |
| switch | 0% (0/3) |
| temperature | 67% (2/3) |
| turbo | 100% (3/3) |

## Failures (15)

- **dial-allonge-sour** (repeat 0): **acceptableMove** (move keep; acceptable ["finer","temp-up","yield-up"])
- **dial-allonge-sour** (repeat 1): **acceptableMove** (move keep; acceptable ["finer","temp-up","yield-up"])
- **dial-allonge-sour** (repeat 2): **acceptableMove** (move keep; acceptable ["finer","temp-up","yield-up"])
- **dial-balanced-thin** (repeat 0): **acceptableMove** (move yield-up; acceptable ["yield-down","finer"]); preferredMove (move yield-up; preferred yield-down)
- **dial-balanced-thin** (repeat 1): **acceptableMove** (move yield-up; acceptable ["yield-down","finer"]); preferredMove (move yield-up; preferred yield-down)
- **dial-balanced-thin** (repeat 2): **acceptableMove** (move yield-up; acceptable ["yield-down","finer"]); preferredMove (move yield-up; preferred yield-down)
- **dial-bitter-in-window** (repeat 0): **acceptableMove** (move finer; acceptable ["coarser","temp-down","yield-down"]); preferredMove (move finer; preferred coarser); textMatchesFields ("Grind slightly coarser" vs grind finer)
- **dial-hot-dark-bitter** (repeat 0): **acceptableMove** (move finer; acceptable ["temp-down","coarser","yield-down"]); textMatchesFields ("Grind coarser for the next shot, keeping dose, yield, temperature, and profile the same." vs grind finer)
- **dial-lost-in-milk** (repeat 0): **acceptableMove** (move yield-up; acceptable ["yield-down","finer"]); preferredMove (move yield-up; preferred yield-down)
- **dial-lost-in-milk** (repeat 1): **acceptableMove** (move yield-up; acceptable ["yield-down","finer"]); preferredMove (move yield-up; preferred yield-down)
- **dial-lost-in-milk** (repeat 2): **acceptableMove** (move yield-up; acceptable ["yield-down","finer"]); preferredMove (move yield-up; preferred yield-down)
- **dial-sour-but-slow** (repeat 1): **acceptableMove** (move finer; acceptable ["coarser","temp-up","yield-up"])
- **dial-switch-after-many** (repeat 0): **acceptableMove** (move yield-up; acceptable ["switch","temp-up"]); preferredMove (move yield-up; preferred switch)
- **dial-switch-after-many** (repeat 1): **acceptableMove** (move finer; acceptable ["switch","temp-up"]); preferredMove (move finer; preferred switch)
- **dial-switch-after-many** (repeat 2): **acceptableMove** (move yield-up; acceptable ["switch","temp-up"]); preferredMove (move yield-up; preferred switch)
