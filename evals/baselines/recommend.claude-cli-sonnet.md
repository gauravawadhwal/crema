# Eval: recommend · claude-cli:sonnet

2026-11-05T05:48:30.919Z · commit d8542101 (uncommitted changes) · 32 cases × 1 repeats · judge claude-cli:sonnet

Prompts: Recipe 7d02f0cf36

| Metric | Value |
|---|---|
| Pass rate | **100%** (95% CI 89–100%) |
| Mean score | 0.949 |
| model answered | 100% |
| acceptable profile | 100% |
| preferred profile | 78% |
| forbidden profile | 0% |
| recipe in bounds | 100% |
| judge: no contradictions | 94% |
| judge: no invented figures | 66% |
| Errors | 0 of 32 runs |
| Latency | p50 7.3 s, p95 9.6 s |
| Cost (list price) | $0.874 total, $0.0273 per run |
| Tokens | 188,418 in, 27,282 out |

## Checks

| Check | Pass |
|---|---|
| acceptable | 100% (32/32) |
| alternatives | 100% (32/32) |
| judge.noContradictions | 94% (30/32) |
| judge.noInventedFigures | 66% (21/32) |
| judge.quality | 100% (32/32) |
| modelAnswered | 100% (32/32) |
| nearSuggested | 100% (23/23) |
| noEmoji | 100% (32/32) |
| notForbidden | 100% (29/29) |
| preferred | 78% (18/23) |
| rationaleShape | 100% (32/32) |
| recipeBounds | 100% (9/9) |
| recipeSane | 100% (32/32) |
| restAdvice | 100% (2/2) |
| validChoice | 100% (32/32) |

## Slices

| Tag | Pass |
|---|---|
| split: dev | 100% (22/22) |
| split: holdout | 100% (10/10) |
| advanced | 100% (2/2) |
| adversarial | 100% (1/1) |
| anaerobic | 100% (1/1) |
| blend | 100% (3/3) |
| burrs | 100% (1/1) |
| conflict | 100% (2/2) |
| dark | 100% (4/4) |
| decaf | 100% (1/1) |
| filter-roast | 100% (1/1) |
| high-altitude | 100% (1/1) |
| history | 100% (5/5) |
| installed | 100% (2/2) |
| light | 100% (12/12) |
| medium | 100% (1/1) |
| medium-dark | 100% (2/2) |
| milk | 100% (13/13) |
| natural | 100% (2/2) |
| new-user | 100% (3/3) |
| no-scale | 100% (4/4) |
| real | 100% (8/8) |
| rest | 100% (2/2) |
| roaster-recipe | 100% (2/2) |
| setup | 100% (1/1) |
| single-origin | 100% (1/1) |
| straight | 100% (2/2) |
| synthetic | 100% (24/24) |
| unknown-roast | 100% (1/1) |
| wet-hulled | 100% (1/1) |

## Failures (0)

