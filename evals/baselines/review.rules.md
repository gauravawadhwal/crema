# Eval: review · rules

2026-11-10T00:58:42.761Z · commit d89715b3 (uncommitted changes) · 22 cases × 1 repeats

Prompts: none (no model calls)

| Metric | Value |
|---|---|
| Pass rate | **100%** (95% CI 85–100%) |
| Mean score | 1 |
| model answered | 100% |
| appropriate next move | 100% |
| required observations | 100% |
| no false alarms | 100% |
| one change | 100% |
| grounded ranges | 100% |
| Errors | 0 of 22 runs |
| Latency | p50 0.0 s, p95 0.0 s |

## Checks

| Check | Pass |
|---|---|
| acceptableMove | 100% (22/22) |
| askTaste | 100% (21/21) |
| groundedRanges | 100% (22/22) |
| modelAnswered | 100% (22/22) |
| noFalseAlarms | 100% (22/22) |
| oneChange | 100% (22/22) |
| requiredIssues | 100% (22/22) |
| validSwitch | 100% (22/22) |

## Slices

| Tag | Pass |
|---|---|
| split: holdout | 100% (7/7) |
| split: dev | 100% (15/15) |
| balanced | 100% (1/1) |
| bloom | 100% (1/1) |
| channeling | 100% (1/1) |
| choke | 100% (1/1) |
| clean | 100% (1/1) |
| early-stop | 100% (1/1) |
| gusher | 100% (1/1) |
| limiter | 100% (2/2) |
| manual | 100% (1/1) |
| manual-sour | 100% (1/1) |
| missing-flow | 100% (1/1) |
| missing-scale | 100% (1/1) |
| no-data | 100% (1/1) |
| notes-only | 100% (1/1) |
| real-shape | 100% (2/2) |
| sour-choke | 100% (1/1) |
| synthetic | 100% (22/22) |
| taste | 100% (1/1) |
| temp-offset | 100% (1/1) |
| temperature-curve | 100% (1/1) |
| transient | 100% (1/1) |
| turbo | 100% (1/1) |
| unknown-profile | 100% (1/1) |
| unknown-sour | 100% (1/1) |

## Failures (0)

