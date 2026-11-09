# Eval: review · rules · final-rules

2026-11-09T21:45:52.746Z · commit 0c8c11d4 (uncommitted changes) · 20 cases × 1 repeats

Prompts: none (no model calls)

| Metric | Value |
|---|---|
| Pass rate | **100%** (95% CI 84–100%) |
| Mean score | 1 |
| model answered | 100% |
| appropriate next move | 100% |
| required observations | 100% |
| no false alarms | 100% |
| one change | 100% |
| grounded ranges | 100% |
| Errors | 0 of 20 runs |
| Latency | p50 0.0 s, p95 0.0 s |

## Checks

| Check | Pass |
|---|---|
| acceptableMove | 100% (20/20) |
| askTaste | 100% (19/19) |
| groundedRanges | 100% (20/20) |
| modelAnswered | 100% (20/20) |
| noFalseAlarms | 100% (20/20) |
| oneChange | 100% (20/20) |
| requiredIssues | 100% (20/20) |
| validSwitch | 100% (20/20) |

## Slices

| Tag | Pass |
|---|---|
| split: holdout | 100% (6/6) |
| split: dev | 100% (14/14) |
| balanced | 100% (1/1) |
| bloom | 100% (1/1) |
| channeling | 100% (1/1) |
| choke | 100% (1/1) |
| clean | 100% (1/1) |
| early-stop | 100% (1/1) |
| gusher | 100% (1/1) |
| manual | 100% (1/1) |
| manual-sour | 100% (1/1) |
| missing-flow | 100% (1/1) |
| missing-scale | 100% (1/1) |
| no-data | 100% (1/1) |
| notes-only | 100% (1/1) |
| sour-choke | 100% (1/1) |
| synthetic | 100% (20/20) |
| temp-offset | 100% (1/1) |
| temperature-curve | 100% (1/1) |
| transient | 100% (1/1) |
| turbo | 100% (1/1) |
| unknown-profile | 100% (1/1) |
| unknown-sour | 100% (1/1) |

## Failures (0)

