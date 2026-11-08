# Eval: recommend · rules

2026-11-05T05:35:39.798Z · commit d8542101 (uncommitted changes) · 32 cases × 1 repeats

Prompts: none (no model calls)

| Metric | Value |
|---|---|
| Pass rate | **91%** (95% CI 76–97%) |
| Mean score | 0.948 |
| model answered | 100% |
| acceptable profile | 94% |
| preferred profile | 61% |
| forbidden profile | 3% |
| recipe in bounds | 78% |
| Errors | 0 of 32 runs |
| Latency | p50 0.0 s, p95 0.0 s |

## Checks

| Check | Pass |
|---|---|
| acceptable | 94% (30/32) |
| alternatives | 100% (32/32) |
| modelAnswered | 100% (32/32) |
| nearSuggested | 100% (23/23) |
| noEmoji | 100% (32/32) |
| notForbidden | 97% (28/29) |
| preferred | 61% (14/23) |
| rationaleShape | 100% (32/32) |
| recipeBounds | 78% (7/9) |
| recipeSane | 100% (32/32) |
| restAdvice | 100% (2/2) |

## Slices

| Tag | Pass |
|---|---|
| split: dev | 95% (21/22) |
| split: holdout | 80% (8/10) |
| advanced | 100% (2/2) |
| adversarial | 100% (1/1) |
| anaerobic | 100% (1/1) |
| blend | 100% (3/3) |
| burrs | 100% (1/1) |
| conflict | 100% (2/2) |
| dark | 75% (3/4) |
| decaf | 100% (1/1) |
| filter-roast | 100% (1/1) |
| high-altitude | 100% (1/1) |
| history | 40% (2/5) |
| installed | 100% (2/2) |
| light | 100% (12/12) |
| medium | 100% (1/1) |
| medium-dark | 100% (2/2) |
| milk | 77% (10/13) |
| natural | 100% (2/2) |
| new-user | 100% (3/3) |
| no-scale | 100% (4/4) |
| real | 100% (8/8) |
| rest | 100% (2/2) |
| roaster-recipe | 100% (2/2) |
| setup | 100% (1/1) |
| single-origin | 100% (1/1) |
| straight | 100% (2/2) |
| synthetic | 88% (21/24) |
| unknown-roast | 100% (1/1) |
| wet-hulled | 100% (1/1) |

## Failures (3)

- **rec-history-dose-yield**: **recipeBounds** (yieldG 42.0 not in 34–38)
- **rec-history-prefers-lower-ranked**: **acceptable** (chose Londonium; acceptable ["Gentle and sweet"]); **recipeBounds** (yieldG 42.0 not in 34–38)
- **rec-history-top-pick-failed**: **acceptable** (chose Londonium; acceptable ["Gentle and sweet","Flow profile for milky drinks","D-Flow / default","A-Flow / default-dark","Classic Italian espresso","Cremina lever machine","Default","Espresso Forge Dark"]); preferred (chose Londonium; preferred ["Gentle and sweet","Flow profile for milky drinks","D-Flow / default"]); **notForbidden** (chose forbidden Londonium)
