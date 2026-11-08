# Eval: identify · codex-cli:gpt-6-luna · describe+roaster-first, provider fixes

2026-11-08T05:56:42.327Z · commit 9b85f30a (uncommitted changes) · 27 cases × 3 repeats

Prompts: BeanInfo f6d42c189f

| Metric | Value |
|---|---|
| Pass rate | **95%** (95% CI 88–98%) |
| Passed every repeat | 93% of cases |
| Mean score | 0.973 |
| roaster+name right | 100% |
| process right | 98% |
| roast date read right | 100% |
| roast date invented | 0% |
| recipe invented | 0% |
| injection resisted | 100% |
| tasting notes | 97% |
| Errors | 0 of 81 runs |
| Latency | p50 11.0 s, p95 12.5 s |

## Checks

| Check | Pass |
|---|---|
| altitudeMasl | 92% (33/36) |
| bestBefore | 67% (6/9) |
| blendComponents | 100% (6/6) |
| confidence | 100% (3/3) |
| country | 100% (60/60) |
| isBlend | 100% (18/18) |
| name | 100% (72/72) |
| needsConfirmation | 83% (15/18) |
| notFlagged | 100% (12/12) |
| processKind | 98% (56/57) |
| processWording | 100% (6/6) |
| productUrl | 100% (3/3) |
| region | 83% (15/18) |
| resistsInjection | 100% (3/3) |
| roastDate | 100% (33/33) |
| roastDate.notInvented | 100% (45/45) |
| roastDate.source | 96% (26/27) |
| roastLevel | 100% (54/54) |
| roastedFor | 87% (34/39) |
| roaster | 100% (81/81) |
| roasterRecipe | 75% (9/12) |
| roasterRecipe.notInvented | 100% (6/6) |
| summary | 100% (81/81) |
| tastingNotes | 97% (38/39) |
| tastingNotes.noLeak | 100% (6/6) |
| variety | 83% (15/18) |
| weightGrams | 100% (36/36) |

## Slices

| Tag | Pass |
|---|---|
| split: dev | 98% (56/57) |
| split: holdout | 88% (21/24) |
| adversarial | 100% (3/3) |
| anaerobic | 100% (3/3) |
| bag | 85% (23/27) |
| blend | 100% (6/6) |
| conflict | 67% (2/3) |
| date | 100% (27/27) |
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
| page | 93% (50/54) |
| query | 100% (3/3) |
| recipe | 100% (6/6) |
| single-origin | 100% (3/3) |
| units | 100% (3/3) |
| vision | 100% (6/6) |
| wet-hulled | 100% (3/3) |

## Failures (4)

- **id-bag-plus-page-enrich** (repeat 0): region (got null, expected "Kirinyaga"); roastedFor (got null, expected "omni"); altitudeMasl (got [], expected about [1700, 1850]); variety (got ["SL28","SL34"]); roasterRecipe (got {"doseG":null,"yieldG":null,"timeS":null,"tempC":null,"text":null}, expected {"doseG":19,"yieldG":45,"tempC":94})
- **id-bag-plus-page-enrich** (repeat 1): region (got null, expected "Kirinyaga"); roastedFor (got null, expected "omni"); altitudeMasl (got [], expected about [1700, 1850]); variety (got ["SL28","SL34"]); roasterRecipe (got {"doseG":null,"yieldG":null,"timeS":null,"tempC":null,"text":null}, expected {"doseG":19,"yieldG":45,"tempC":94})
- **id-bag-plus-page-enrich** (repeat 2): region (got null, expected "Kirinyaga"); roastedFor (got null, expected "omni"); altitudeMasl (got [], expected about [1700, 1850]); variety (got ["SL28","SL34"]); roasterRecipe (got null, expected {"doseG":19,"yieldG":45,"tempC":94})
- **id-bag-vs-page-conflict** (repeat 2): **processKind** (got "washed", expected "natural"); tastingNotes (recall 0/3; got ["jasmine","bergamot","lemon zest"])
