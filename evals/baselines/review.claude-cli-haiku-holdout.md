# Eval: review · claude-cli:haiku

2026-11-10T01:00:09.609Z · commit d89715b3 (uncommitted changes) · 7 cases × 1 repeats · filter holdout

Prompts: ShotReview 4ff5a4ebfa

| Metric | Value |
|---|---|
| Pass rate | **100%** (95% CI 65–100%) |
| Mean score | 1 |
| model answered | 100% |
| appropriate next move | 100% |
| required observations | 100% |
| no false alarms | 100% |
| one change | 100% |
| grounded ranges | 100% |
| Errors | 0 of 7 runs |
| Latency | p50 6.3 s, p95 14.5 s |
| Cost (list price) | $0.013 total, $0.0018 per run |
| Tokens | 55,862 in, 9,571 out |

## Checks

| Check | Pass |
|---|---|
| acceptableMove | 100% (7/7) |
| askTaste | 100% (6/6) |
| groundedRanges | 100% (7/7) |
| modelAnswered | 100% (7/7) |
| noFalseAlarms | 100% (7/7) |
| oneChange | 100% (7/7) |
| requiredIssues | 100% (7/7) |
| validSwitch | 100% (7/7) |

## Slices

| Tag | Pass |
|---|---|
| split: holdout | 100% (7/7) |
| balanced | 100% (1/1) |
| limiter | 100% (1/1) |
| missing-flow | 100% (1/1) |
| notes-only | 100% (1/1) |
| real-shape | 100% (1/1) |
| sour-choke | 100% (1/1) |
| synthetic | 100% (7/7) |
| taste | 100% (1/1) |
| transient | 100% (1/1) |
| unknown-profile | 100% (1/1) |

## Failures (0)

