# Eval: recommend · gemini-api:gemini-3.5-flash-lite · describe+roaster-first

2026-11-08T05:44:15.576Z · commit 9b85f30a (uncommitted changes) · 32 cases × 3 repeats

Prompts: Recipe 7d02f0cf36

| Metric | Value |
|---|---|
| Pass rate | **99%** (95% CI 94–100%) |
| Passed every repeat | 97% of cases |
| Mean score | 0.986 |
| model answered | 100% |
| acceptable profile | 99% |
| preferred profile | 83% |
| forbidden profile | 0% |
| recipe in bounds | 100% |
| Errors | 0 of 96 runs |
| Latency | p50 1.9 s, p95 2.1 s |
| Tokens | 281,274 in, 33,684 out |

## Checks

| Check | Pass |
|---|---|
| acceptable | 99% (95/96) |
| alternatives | 100% (96/96) |
| modelAnswered | 100% (96/96) |
| nearSuggested | 100% (69/69) |
| noEmoji | 100% (96/96) |
| notForbidden | 100% (87/87) |
| preferred | 83% (57/69) |
| rationaleShape | 100% (96/96) |
| recipeBounds | 100% (27/27) |
| recipeSane | 100% (96/96) |
| restAdvice | 100% (6/6) |
| validChoice | 100% (96/96) |

## Slices

| Tag | Pass |
|---|---|
| split: dev | 100% (66/66) |
| split: holdout | 97% (29/30) |
| advanced | 100% (6/6) |
| adversarial | 100% (3/3) |
| anaerobic | 100% (3/3) |
| blend | 100% (9/9) |
| burrs | 100% (3/3) |
| conflict | 100% (6/6) |
| dark | 92% (11/12) |
| decaf | 100% (3/3) |
| filter-roast | 100% (3/3) |
| high-altitude | 100% (3/3) |
| history | 93% (14/15) |
| installed | 100% (6/6) |
| light | 100% (36/36) |
| medium | 100% (3/3) |
| medium-dark | 100% (6/6) |
| milk | 97% (38/39) |
| natural | 100% (6/6) |
| new-user | 100% (9/9) |
| no-scale | 100% (12/12) |
| real | 100% (24/24) |
| rest | 100% (6/6) |
| roaster-recipe | 100% (6/6) |
| setup | 100% (3/3) |
| single-origin | 100% (3/3) |
| straight | 100% (6/6) |
| synthetic | 99% (71/72) |
| unknown-roast | 100% (3/3) |
| wet-hulled | 100% (3/3) |

## Failures (1)

- **rec-history-top-pick-failed** (repeat 1): **acceptable** (chose Damian's LRv3; acceptable ["Gentle and sweet","Flow profile for milky drinks","D-Flow / default","A-Flow / default-dark","Classic Italian espresso","Cremina lever machine","Default","Espresso Forge Dark"]); preferred (chose Damian's LRv3; preferred ["Gentle and sweet","Flow profile for milky drinks","D-Flow / default"])
