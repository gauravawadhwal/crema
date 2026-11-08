# Eval: dialin · claude-cli:haiku

2026-11-05T05:51:18.778Z · commit d8542101 (uncommitted changes) · 28 cases × 3 repeats · judge claude-cli:sonnet

Prompts: DialInAdvice 425434c354

| Metric | Value |
|---|---|
| Pass rate | **94%** (95% CI 87–97%) |
| Passed every repeat | 93% of cases |
| Mean score | 0.93 |
| model answered | 100% |
| right move | 94% |
| preferred move | 75% |
| one change | 100% |
| text matches fields | 100% |
| judge: no contradictions | 95% |
| judge: no invented figures | 100% |
| Errors | 0 of 84 runs |
| Latency | p50 5.4 s, p95 8.4 s |
| Cost (list price) | $0.058 total, $0.0007 per run |
| Tokens | 254,482 in, 66,342 out |

## Checks

| Check | Pass |
|---|---|
| acceptableMove | 94% (79/84) |
| judge.noContradictions | 95% (80/84) |
| judge.noInventedFigures | 100% (84/84) |
| judge.quality | 100% (84/84) |
| magnitude | 59% (16/27) |
| modelAnswered | 100% (84/84) |
| noEmoji | 100% (84/84) |
| oneChange | 100% (84/84) |
| preferredMove | 75% (47/63) |
| saneDeltas | 100% (84/84) |
| textMatchesFields | 100% (84/84) |
| validSwitch | 100% (84/84) |

## Slices

| Tag | Pass |
|---|---|
| split: dev | 92% (55/60) |
| split: holdout | 100% (24/24) |
| adversarial | 100% (3/3) |
| allonge | 100% (3/3) |
| balanced | 100% (3/3) |
| bitter | 100% (21/21) |
| blooming | 100% (3/3) |
| body | 100% (9/9) |
| conflict | 100% (6/6) |
| dark | 100% (3/3) |
| decaf | 100% (3/3) |
| fast | 100% (18/18) |
| first-shot | 100% (3/3) |
| history | 50% (3/6) |
| low-contact | 100% (3/3) |
| milk | 100% (3/3) |
| missing-data | 100% (3/3) |
| natural | 100% (3/3) |
| notes-only | 100% (3/3) |
| nuance | 100% (3/3) |
| rest | 100% (6/6) |
| slow | 100% (9/9) |
| sour | 96% (43/45) |
| switch | 0% (0/3) |
| temperature | 100% (3/3) |
| turbo | 33% (1/3) |

## Failures (5)

- **dial-switch-after-many** (repeat 0): **acceptableMove** (move finer; acceptable ["switch","temp-up"]); preferredMove (move finer; preferred switch)
- **dial-switch-after-many** (repeat 1): **acceptableMove** (move finer; acceptable ["switch","temp-up"]); preferredMove (move finer; preferred switch); judge.noContradictions ("Every shot at setting 9 or finer has been sour" vs input ""grinderSetting":"7","enjoyment":2,"notes":"harsh"")
- **dial-switch-after-many** (repeat 2): **acceptableMove** (move finer; acceptable ["switch","temp-up"]); preferredMove (move finer; preferred switch)
- **dial-turbo-sour** (repeat 0): **acceptableMove** (move coarser; acceptable ["finer","temp-up","yield-up"])
- **dial-turbo-sour** (repeat 1): **acceptableMove** (move coarser; acceptable ["finer","temp-up","yield-up"])
