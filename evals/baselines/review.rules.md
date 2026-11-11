# Eval: review · rules

2026-11-11T05:43:38.711Z · commit f188694c (uncommitted changes) · 26 cases × 1 repeats

Prompts: none (no model calls)

| Metric | Value |
|---|---|
| Pass rate | **100%** (95% CI 87–100%) |
| Mean score | 1 |
| model answered | 100% |
| appropriate next move | 100% |
| required observations | 100% |
| no false alarms | 100% |
| one change | 100% |
| grounded ranges | 100% |
| Errors | 0 of 26 runs |
| Latency | p50 0.0 s, p95 0.0 s |

## Checks

| Check | Pass |
|---|---|
| acceptableMove | 100% (26/26) |
| askTaste | 100% (25/25) |
| grindDirectionMatchesIssue | 100% (6/6) |
| groundedRanges | 100% (26/26) |
| insightfulSummary | 100% (24/24) |
| modelAnswered | 100% (26/26) |
| noFalseAlarms | 100% (26/26) |
| oneChange | 100% (26/26) |
| requiredIssues | 100% (26/26) |
| validSwitch | 100% (26/26) |

## Slices

| Tag | Pass |
|---|---|
| split: holdout | 100% (8/8) |
| split: dev | 100% (18/18) |
| balanced | 100% (1/1) |
| bloom | 100% (1/1) |
| channeling | 100% (1/1) |
| choke | 100% (1/1) |
| clean | 100% (1/1) |
| early-stop | 100% (1/1) |
| fast-time | 100% (1/1) |
| gusher | 100% (1/1) |
| limiter | 100% (4/4) |
| manual | 100% (1/1) |
| manual-sour | 100% (1/1) |
| missing-flow | 100% (1/1) |
| missing-scale | 100% (1/1) |
| no-data | 100% (1/1) |
| notes-only | 100% (1/1) |
| pace | 100% (2/2) |
| real-shape | 100% (3/3) |
| shortfall | 100% (2/2) |
| slow-time | 100% (1/1) |
| sour-choke | 100% (1/1) |
| synthetic | 100% (26/26) |
| taste | 100% (1/1) |
| temp-offset | 100% (1/1) |
| temperature-curve | 100% (1/1) |
| transient | 100% (1/1) |
| turbo | 100% (1/1) |
| unknown-profile | 100% (1/1) |
| unknown-sour | 100% (1/1) |

## Failures (0)

