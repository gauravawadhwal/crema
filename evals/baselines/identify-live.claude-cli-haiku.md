# Eval: identify · claude-cli:haiku · live

2026-11-05T05:57:13.512Z · commit d8542101 (uncommitted changes) · 9 cases × 1 repeats · filter tag:live

Prompts: BeanInfo b20cff0514

| Metric | Value |
|---|---|
| Pass rate | **100%** (95% CI 70–100%) |
| Mean score | 1 |
| roaster+name right | 100% |
| process right | 100% |
| roast date invented | 0% |
| Errors | 0 of 9 runs |
| Latency | p50 50.1 s, p95 57.2 s |
| Cost (list price) | $0.360 total, $0.0399 per run |
| Tokens | 618,176 in, 39,006 out |

## Checks

| Check | Pass |
|---|---|
| country | 100% (6/6) |
| isBlend | 100% (8/8) |
| name | 100% (9/9) |
| processKind | 100% (1/1) |
| roastDate.notInvented | 100% (9/9) |
| roastedFor | 100% (1/1) |
| roaster | 100% (9/9) |
| summary | 100% (9/9) |

## Slices

| Tag | Pass |
|---|---|
| split: dev | 100% (9/9) |
| live | 100% (9/9) |
| real | 100% (9/9) |

## Failures (0)

