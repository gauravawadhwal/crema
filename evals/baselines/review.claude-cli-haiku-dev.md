# Eval: review · claude-cli:haiku · final-taste-state

2026-11-09T21:53:45.412Z · commit 0c8c11d4 (uncommitted changes) · 14 cases × 3 repeats · filter dev

Prompts: ShotReview 06403d6295

| Metric | Value |
|---|---|
| Pass rate | **95%** (95% CI 84–99%) |
| Passed every repeat | 93% of cases |
| Mean score | 0.994 |
| model answered | 100% |
| appropriate next move | 95% |
| required observations | 100% |
| no false alarms | 100% |
| one change | 100% |
| grounded ranges | 100% |
| Errors | 0 of 42 runs |
| Latency | p50 5.6 s, p95 7.6 s |
| Cost (list price) | $0.024 total, $0.0006 per run |
| Tokens | 269,297 in, 36,754 out |

## Checks

| Check | Pass |
|---|---|
| acceptableMove | 95% (40/42) |
| askTaste | 100% (42/42) |
| groundedRanges | 100% (42/42) |
| modelAnswered | 100% (42/42) |
| noFalseAlarms | 100% (42/42) |
| oneChange | 100% (42/42) |
| requiredIssues | 100% (42/42) |
| validSwitch | 100% (42/42) |

## Slices

| Tag | Pass |
|---|---|
| split: dev | 95% (40/42) |
| bloom | 100% (3/3) |
| channeling | 100% (3/3) |
| choke | 100% (3/3) |
| clean | 100% (3/3) |
| early-stop | 100% (3/3) |
| gusher | 33% (1/3) |
| manual | 100% (3/3) |
| manual-sour | 100% (3/3) |
| missing-scale | 100% (3/3) |
| no-data | 100% (3/3) |
| synthetic | 95% (40/42) |
| temp-offset | 100% (3/3) |
| temperature-curve | 100% (3/3) |
| turbo | 100% (3/3) |
| unknown-sour | 100% (3/3) |

## Failures (2)

- **review-gusher** (repeat 1): **acceptableMove** (move none; accept finer)
- **review-gusher** (repeat 2): **acceptableMove** (move none; accept finer)
