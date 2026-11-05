# Eval: identify · claude-cli:haiku

2026-11-05T05:48:30.880Z · commit d8542101 (uncommitted changes) · 21 cases × 3 repeats · judge claude-cli:sonnet

Prompts: BeanInfo b20cff0514

| Metric | Value |
|---|---|
| Pass rate | **100%** (95% CI 94–100%) |
| Passed every repeat | 100% of cases |
| Mean score | 0.999 |
| roaster+name right | 100% |
| process right | 100% |
| roast date read right | 100% |
| roast date invented | 0% |
| recipe invented | 0% |
| injection resisted | 100% |
| tasting notes | 100% |
| Errors | 0 of 63 runs |
| Latency | p50 12.6 s, p95 18.8 s |
| Cost (list price) | $0.127 total, $0.0020 per run |
| Tokens | 885,451 in, 164,170 out |

## Checks

| Check | Pass |
|---|---|
| altitudeMasl | 100% (33/33) |
| bestBefore | 89% (8/9) |
| blendComponents | 100% (3/3) |
| confidence | 100% (3/3) |
| country | 100% (51/51) |
| isBlend | 100% (15/15) |
| name | 100% (57/57) |
| needsConfirmation | 100% (12/12) |
| processKind | 100% (51/51) |
| processWording | 100% (6/6) |
| productUrl | 100% (3/3) |
| region | 100% (18/18) |
| resistsInjection | 100% (3/3) |
| roastDate | 100% (21/21) |
| roastDate.notInvented | 100% (42/42) |
| roastDate.source | 100% (15/15) |
| roastLevel | 100% (54/54) |
| roastedFor | 100% (39/39) |
| roaster | 100% (63/63) |
| roasterRecipe | 100% (12/12) |
| roasterRecipe.notInvented | 100% (6/6) |
| summary | 100% (63/63) |
| tastingNotes | 100% (39/39) |
| tastingNotes.noLeak | 100% (6/6) |
| variety | 100% (18/18) |
| weightGrams | 100% (21/21) |

## Slices

| Tag | Pass |
|---|---|
| split: dev | 100% (45/45) |
| split: holdout | 100% (18/18) |
| adversarial | 100% (3/3) |
| anaerobic | 100% (3/3) |
| bag | 100% (27/27) |
| blend | 100% (3/3) |
| conflict | 100% (3/3) |
| date | 100% (21/21) |
| decaf | 100% (3/3) |
| disambiguation | 100% (3/3) |
| hallucination | 100% (9/9) |
| inference | 100% (3/3) |
| language | 100% (9/9) |
| noise | 100% (3/3) |
| page | 100% (39/39) |
| query | 100% (3/3) |
| recipe | 100% (6/6) |
| single-origin | 100% (3/3) |
| units | 100% (3/3) |
| vision | 100% (6/6) |
| wet-hulled | 100% (3/3) |

## Failures (0)

