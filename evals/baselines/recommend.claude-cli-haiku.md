# Eval: recommend · claude-cli:haiku

2026-11-05T05:36:32.511Z · commit d8542101 (uncommitted changes) · 32 cases × 3 repeats · judge claude-cli:sonnet

Prompts: Recipe 7d02f0cf36

| Metric | Value |
|---|---|
| Pass rate | **100%** (95% CI 96–100%) |
| Passed every repeat | 100% of cases |
| Mean score | 0.947 |
| model answered | 100% |
| acceptable profile | 100% |
| preferred profile | 68% |
| forbidden profile | 0% |
| recipe in bounds | 100% |
| judge: no contradictions | 90% |
| judge: no invented figures | 82% |
| Errors | 0 of 96 runs |
| Latency | p50 10.0 s, p95 14.6 s |
| Cost (list price) | $0.132 total, $0.0014 per run |
| Tokens | 591,078 in, 163,683 out |

## Checks

| Check | Pass |
|---|---|
| acceptable | 100% (96/96) |
| alternatives | 100% (96/96) |
| judge.noContradictions | 90% (86/96) |
| judge.noInventedFigures | 82% (79/96) |
| judge.quality | 100% (96/96) |
| modelAnswered | 100% (96/96) |
| nearSuggested | 99% (68/69) |
| noEmoji | 100% (96/96) |
| notForbidden | 100% (87/87) |
| preferred | 68% (47/69) |
| rationaleShape | 100% (96/96) |
| recipeBounds | 100% (27/27) |
| recipeSane | 100% (96/96) |
| restAdvice | 100% (6/6) |
| validChoice | 100% (96/96) |

## Slices

| Tag | Pass |
|---|---|
| split: dev | 100% (66/66) |
| split: holdout | 100% (30/30) |
| advanced | 100% (6/6) |
| adversarial | 100% (3/3) |
| anaerobic | 100% (3/3) |
| blend | 100% (9/9) |
| burrs | 100% (3/3) |
| conflict | 100% (6/6) |
| dark | 100% (12/12) |
| decaf | 100% (3/3) |
| filter-roast | 100% (3/3) |
| high-altitude | 100% (3/3) |
| history | 100% (15/15) |
| installed | 100% (6/6) |
| light | 100% (36/36) |
| medium | 100% (3/3) |
| medium-dark | 100% (6/6) |
| milk | 100% (39/39) |
| natural | 100% (6/6) |
| new-user | 100% (9/9) |
| no-scale | 100% (12/12) |
| real | 100% (24/24) |
| rest | 100% (6/6) |
| roaster-recipe | 100% (6/6) |
| setup | 100% (3/3) |
| single-origin | 100% (3/3) |
| straight | 100% (6/6) |
| synthetic | 100% (72/72) |
| unknown-roast | 100% (3/3) |
| wet-hulled | 100% (3/3) |

## Failures (0)

