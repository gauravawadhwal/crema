# Eval: identify · gemini-api:gemini-3.5-flash-lite · describe+roaster-first, provider fixes

2026-11-08T05:56:42.328Z · commit 9b85f30a (uncommitted changes) · 27 cases × 3 repeats

Prompts: BeanInfo f6d42c189f

| Metric | Value |
|---|---|
| Pass rate | **96%** (95% CI 90–99%) |
| Passed every repeat | 96% of cases |
| Mean score | 0.992 |
| roaster+name right | 100% |
| process right | 100% |
| roast date read right | 91% |
| roast date invented | 0% |
| recipe invented | 0% |
| injection resisted | 100% |
| tasting notes | 100% |
| Errors | 0 of 81 runs |
| Latency | p50 2.4 s, p95 3.2 s |
| Tokens | 133,629 in, 43,099 out |

## Checks

| Check | Pass |
|---|---|
| altitudeMasl | 100% (36/36) |
| bestBefore | 100% (9/9) |
| blendComponents | 100% (6/6) |
| confidence | 100% (3/3) |
| country | 100% (60/60) |
| isBlend | 100% (18/18) |
| name | 100% (72/72) |
| needsConfirmation | 100% (18/18) |
| notFlagged | 100% (12/12) |
| processKind | 100% (57/57) |
| processWording | 100% (6/6) |
| productUrl | 100% (3/3) |
| region | 100% (18/18) |
| resistsInjection | 100% (3/3) |
| roastDate | 91% (30/33) |
| roastDate.notInvented | 100% (45/45) |
| roastDate.source | 93% (25/27) |
| roastLevel | 100% (54/54) |
| roastedFor | 100% (39/39) |
| roaster | 100% (81/81) |
| roasterRecipe | 100% (12/12) |
| roasterRecipe.notInvented | 100% (6/6) |
| summary | 100% (81/81) |
| tastingNotes | 100% (39/39) |
| tastingNotes.noLeak | 100% (6/6) |
| variety | 89% (16/18) |
| weightGrams | 100% (36/36) |

## Slices

| Tag | Pass |
|---|---|
| split: dev | 100% (57/57) |
| split: holdout | 88% (21/24) |
| adversarial | 100% (3/3) |
| anaerobic | 100% (3/3) |
| bag | 89% (24/27) |
| blend | 100% (6/6) |
| conflict | 100% (3/3) |
| date | 89% (24/27) |
| decaf | 100% (3/3) |
| describe | 100% (18/18) |
| dictated | 100% (9/9) |
| disambiguation | 100% (3/3) |
| flags | 100% (6/6) |
| hallucination | 100% (9/9) |
| inference | 100% (3/3) |
| language | 100% (9/9) |
| noise | 100% (3/3) |
| offline | 100% (3/3) |
| page | 100% (54/54) |
| query | 100% (3/3) |
| recipe | 100% (6/6) |
| single-origin | 100% (3/3) |
| units | 100% (3/3) |
| vision | 100% (6/6) |
| wet-hulled | 100% (3/3) |

## Failures (3)

- **id-bag-us-date** (repeat 0): **roastDate** (got "2026-03-10", expected 2026-10-03)
- **id-bag-us-date** (repeat 1): **roastDate** (got "2026-03-10", expected 2026-10-03)
- **id-bag-us-date** (repeat 2): **roastDate** (got "2026-03-10", expected 2026-10-03)
