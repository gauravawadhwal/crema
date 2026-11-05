# Eval: identify · claude-cli:sonnet

2026-11-05T05:48:30.919Z · commit d8542101 (uncommitted changes) · 21 cases × 1 repeats · judge claude-cli:sonnet

Prompts: BeanInfo b20cff0514

| Metric | Value |
|---|---|
| Pass rate | **100%** (95% CI 85–100%) |
| Mean score | 1 |
| roaster+name right | 100% |
| process right | 100% |
| roast date read right | 100% |
| roast date invented | 0% |
| recipe invented | 0% |
| injection resisted | 100% |
| tasting notes | 100% |
| Errors | 0 of 21 runs |
| Latency | p50 7.3 s, p95 12.6 s |
| Cost (list price) | $0.542 total, $0.0258 per run |
| Tokens | 193,805 in, 24,713 out |

## Checks

| Check | Pass |
|---|---|
| altitudeMasl | 100% (11/11) |
| bestBefore | 100% (3/3) |
| blendComponents | 100% (1/1) |
| confidence | 100% (1/1) |
| country | 100% (17/17) |
| isBlend | 100% (5/5) |
| name | 100% (19/19) |
| needsConfirmation | 100% (4/4) |
| processKind | 100% (17/17) |
| processWording | 100% (2/2) |
| productUrl | 100% (1/1) |
| region | 100% (6/6) |
| resistsInjection | 100% (1/1) |
| roastDate | 100% (7/7) |
| roastDate.notInvented | 100% (14/14) |
| roastDate.source | 100% (5/5) |
| roastLevel | 100% (18/18) |
| roastedFor | 100% (13/13) |
| roaster | 100% (21/21) |
| roasterRecipe | 100% (4/4) |
| roasterRecipe.notInvented | 100% (2/2) |
| summary | 100% (21/21) |
| tastingNotes | 100% (13/13) |
| tastingNotes.noLeak | 100% (2/2) |
| variety | 100% (6/6) |
| weightGrams | 100% (7/7) |

## Slices

| Tag | Pass |
|---|---|
| split: dev | 100% (15/15) |
| split: holdout | 100% (6/6) |
| adversarial | 100% (1/1) |
| anaerobic | 100% (1/1) |
| bag | 100% (9/9) |
| blend | 100% (1/1) |
| conflict | 100% (1/1) |
| date | 100% (7/7) |
| decaf | 100% (1/1) |
| disambiguation | 100% (1/1) |
| hallucination | 100% (3/3) |
| inference | 100% (1/1) |
| language | 100% (3/3) |
| noise | 100% (1/1) |
| page | 100% (13/13) |
| query | 100% (1/1) |
| recipe | 100% (2/2) |
| single-origin | 100% (1/1) |
| units | 100% (1/1) |
| vision | 100% (2/2) |
| wet-hulled | 100% (1/1) |

## Failures (0)

