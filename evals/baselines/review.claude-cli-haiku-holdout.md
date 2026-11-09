# Eval: review · claude-cli:haiku · final-taste-state-recheck

2026-11-09T21:55:16.800Z · commit 0c8c11d4 (uncommitted changes) · 6 cases × 1 repeats · filter holdout

Prompts: ShotReview 06403d6295

| Metric | Value |
|---|---|
| Pass rate | **100%** (95% CI 61–100%) |
| Mean score | 1 |
| model answered | 100% |
| appropriate next move | 100% |
| required observations | 100% |
| no false alarms | 100% |
| one change | 100% |
| grounded ranges | 100% |
| Errors | 0 of 6 runs |
| Latency | p50 6.0 s, p95 11.2 s |
| Cost (list price) | $0.004 total, $0.0007 per run |
| Tokens | 49,723 in, 5,893 out |

## Checks

| Check | Pass |
|---|---|
| acceptableMove | 100% (6/6) |
| askTaste | 100% (5/5) |
| groundedRanges | 100% (6/6) |
| modelAnswered | 100% (6/6) |
| noFalseAlarms | 100% (6/6) |
| oneChange | 100% (6/6) |
| requiredIssues | 100% (6/6) |
| validSwitch | 100% (6/6) |

## Slices

| Tag | Pass |
|---|---|
| split: holdout | 100% (6/6) |
| balanced | 100% (1/1) |
| missing-flow | 100% (1/1) |
| notes-only | 100% (1/1) |
| sour-choke | 100% (1/1) |
| synthetic | 100% (6/6) |
| transient | 100% (1/1) |
| unknown-profile | 100% (1/1) |

## Failures (0)

