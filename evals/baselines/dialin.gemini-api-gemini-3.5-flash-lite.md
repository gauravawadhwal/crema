# Eval: dialin · gemini-api:gemini-3.5-flash-lite · describe+roaster-first

2026-11-08T05:44:15.576Z · commit 9b85f30a (uncommitted changes) · 28 cases × 3 repeats

Prompts: DialInAdvice 425434c354

| Metric | Value |
|---|---|
| Pass rate | **92%** (95% CI 84–96%) |
| Passed every repeat | 86% of cases |
| Mean score | 0.958 |
| model answered | 100% |
| right move | 92% |
| preferred move | 76% |
| one change | 100% |
| text matches fields | 99% |
| Errors | 0 of 84 runs |
| Latency | p50 1.2 s, p95 1.4 s |
| Tokens | 65,457 in, 8,792 out |

## Checks

| Check | Pass |
|---|---|
| acceptableMove | 92% (77/84) |
| magnitude | 78% (21/27) |
| modelAnswered | 100% (84/84) |
| noEmoji | 100% (84/84) |
| oneChange | 100% (84/84) |
| preferredMove | 76% (48/63) |
| saneDeltas | 100% (84/84) |
| textMatchesFields | 99% (83/84) |
| validSwitch | 100% (84/84) |

## Slices

| Tag | Pass |
|---|---|
| split: dev | 92% (55/60) |
| split: holdout | 92% (22/24) |
| adversarial | 100% (3/3) |
| allonge | 100% (3/3) |
| balanced | 100% (3/3) |
| bitter | 100% (21/21) |
| blooming | 33% (1/3) |
| body | 56% (5/9) |
| conflict | 100% (6/6) |
| dark | 100% (3/3) |
| decaf | 100% (3/3) |
| fast | 100% (18/18) |
| first-shot | 100% (3/3) |
| history | 83% (5/6) |
| low-contact | 100% (3/3) |
| milk | 33% (1/3) |
| missing-data | 100% (3/3) |
| natural | 100% (3/3) |
| notes-only | 100% (3/3) |
| nuance | 100% (3/3) |
| rest | 100% (6/6) |
| slow | 100% (9/9) |
| sour | 96% (43/45) |
| switch | 67% (2/3) |
| temperature | 100% (3/3) |
| turbo | 100% (3/3) |

## Failures (7)

- **dial-balanced-thin** (repeat 0): **acceptableMove** (move yield-up; acceptable ["yield-down","finer"]); preferredMove (move yield-up; preferred yield-down); textMatchesFields ("Grind slightly coarser to reduce extraction resistance while increasing the dose or yield for body, or maintain grind and slightly increase yield. Let's stick to the primary rule: for thin body at a good extraction balance (sourBitter = 0), a slight increase in yield or dose helps, but since grind is preferred first, let's adjust yield. Wait, standard logic says prefer grind changes first, but body is thin while extraction is balanced (sourBitter 0). Actually, a slightly coarser grind or keeping grind same and increasing yield by 2g to build body is standard. Let's adjust yield by +2g." vs grind same)
- **dial-balanced-thin** (repeat 2): **acceptableMove** (move coarser; acceptable ["yield-down","finer"]); preferredMove (move coarser; preferred yield-down)
- **dial-easy-blooming-sour** (repeat 0): **acceptableMove** (move coarser; acceptable ["yield-up","finer","temp-up"]); preferredMove (move coarser; preferred yield-up)
- **dial-easy-blooming-sour** (repeat 2): **acceptableMove** (move coarser; acceptable ["yield-up","finer","temp-up"]); preferredMove (move coarser; preferred yield-up)
- **dial-lost-in-milk** (repeat 0): **acceptableMove** (move coarser; acceptable ["yield-down","finer"]); preferredMove (move coarser; preferred yield-down)
- **dial-lost-in-milk** (repeat 1): **acceptableMove** (move yield-up; acceptable ["yield-down","finer"]); preferredMove (move yield-up; preferred yield-down)
- **dial-switch-after-many** (repeat 1): **acceptableMove** (move yield-up; acceptable ["switch","temp-up"]); preferredMove (move yield-up; preferred switch)
