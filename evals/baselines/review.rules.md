# Eval: review · rules

2026-11-11T13:50:01.350Z · commit d9ab180c (uncommitted changes) · 39 cases × 1 repeats

Prompts: none (no model calls)

| Metric | Value |
|---|---|
| Pass rate | **92%** (95% CI 80–97%) |
| Mean score | 0.992 |
| model answered | 100% |
| appropriate next move | 95% |
| required observations | 100% |
| no false alarms | 100% |
| one change | 100% |
| grounded ranges | 100% |
| grounded pace comparison | 100% |
| grounded target comparison | 100% |
| grounded history comparison | 100% |
| useful abstention | 83% |
| useful experiment | 100% |
| Errors | 0 of 39 runs |
| Latency | p50 0.0 s, p95 0.0 s |

## Checks

| Check | Pass |
|---|---|
| acceptableMove | 95% (37/39) |
| askTaste | 100% (38/38) |
| directionConsistent | 100% (39/39) |
| grindDirectionMatchesIssue | 100% (6/6) |
| groundedRanges | 100% (39/39) |
| historyComparison | 100% (7/7) |
| modelAnswered | 100% (39/39) |
| noFalseAlarms | 100% (39/39) |
| oneChange | 100% (39/39) |
| paceComparison | 100% (3/3) |
| requiredIssues | 100% (39/39) |
| targetComparison | 100% (4/4) |
| usefulAbstention | 83% (5/6) |
| usefulExperiment | 100% (7/7) |
| validSwitch | 100% (39/39) |

## Slices

| Tag | Pass |
|---|---|
| split: holdout | 100% (11/11) |
| split: dev | 89% (25/28) |
| balanced | 100% (1/1) |
| bloom | 100% (1/1) |
| channeling | 100% (1/1) |
| choke | 100% (1/1) |
| clean | 100% (1/1) |
| conflict | 50% (1/2) |
| early-stop | 100% (1/1) |
| fast-time | 100% (1/1) |
| gusher | 100% (1/1) |
| history | 100% (7/7) |
| injection | 50% (1/2) |
| limiter | 100% (4/4) |
| manual | 100% (1/1) |
| manual-sour | 100% (1/1) |
| missing-flow | 100% (1/1) |
| missing-scale | 100% (1/1) |
| negation | 100% (1/1) |
| no-data | 100% (1/1) |
| notes | 40% (2/5) |
| notes-only | 100% (1/1) |
| pace | 100% (2/2) |
| quality-v2 | 77% (10/13) |
| real-shape | 100% (3/3) |
| shortfall | 100% (2/2) |
| slow-time | 100% (1/1) |
| sour-choke | 100% (1/1) |
| synthetic | 100% (33/33) |
| taste | 50% (3/6) |
| temp-offset | 100% (1/1) |
| temperature-curve | 100% (1/1) |
| transient | 100% (1/1) |
| turbo | 100% (1/1) |
| unknown-profile | 100% (1/1) |
| unknown-sour | 100% (1/1) |

## Failures (3)

- **review-notes-sour**: **acceptableMove** (move none; accept finer)
- **review-notes-sour-choke**: **usefulAbstention** (Pressure held 9.0 bar against the 9.0 bar target at 0.3 ml/s. The saved note may change this interpretation; confirm taste before choosing a grind change from the curve alone. )
- **review-notes-sour-injection**: **acceptableMove** (move none; accept finer)
