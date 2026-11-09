# Eval: review · claude-cli:haiku · narrative-only-holdout

2026-11-09T21:46:24.680Z · commit 0c8c11d4 (uncommitted changes) · 6 cases × 1 repeats · filter holdout

Prompts: ShotReview 06403d6295

| Metric | Value |
|---|---|
| Pass rate | **83%** (95% CI 44–97%) |
| Mean score | 0.979 |
| model answered | 100% |
| appropriate next move | 100% |
| required observations | 100% |
| no false alarms | 100% |
| one change | 100% |
| grounded ranges | 100% |
| Errors | 0 of 6 runs |
| Latency | p50 5.5 s, p95 8.9 s |
| Cost (list price) | $0.009 total, $0.0014 per run |
| Tokens | 41,024 in, 5,223 out |

## Checks

| Check | Pass |
|---|---|
| acceptableMove | 100% (6/6) |
| askTaste | 80% (4/5) |
| groundedRanges | 100% (6/6) |
| modelAnswered | 100% (6/6) |
| noFalseAlarms | 100% (6/6) |
| oneChange | 100% (6/6) |
| requiredIssues | 100% (6/6) |
| validSwitch | 100% (6/6) |

## Slices

| Tag | Pass |
|---|---|
| split: holdout | 83% (5/6) |
| balanced | 100% (1/1) |
| missing-flow | 100% (1/1) |
| notes-only | 100% (1/1) |
| sour-choke | 0% (0/1) |
| synthetic | 83% (5/6) |
| transient | 100% (1/1) |
| unknown-profile | 100% (1/1) |

## Failures (1)

- **review-sour-choke**: **askTaste**
