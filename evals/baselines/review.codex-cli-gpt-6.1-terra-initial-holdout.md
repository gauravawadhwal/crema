# Eval: review · codex-cli:gpt-6.1-terra · quality-holdout-once

2026-11-11T13:50:00.214Z · commit d9ab180c (uncommitted changes) · 11 cases × 1 repeats · filter holdout · judge codex-cli:gpt-6.1-sol

Prompts: ShotReview 8f9d8fc02e, JudgeVerdict c91b46b3a3

| Metric | Value |
|---|---|
| Pass rate | **82%** (95% CI 52–95%) |
| Mean score | 0.977 |
| model answered | 100% |
| appropriate next move | 100% |
| required observations | 100% |
| no false alarms | 100% |
| one change | 100% |
| grounded ranges | 100% |
| judge answered | 100% |
| judge: specific interpretation | 100% |
| judge: useful next step | 100% |
| judge: plain language | 100% |
| grounded target comparison | 0% |
| grounded history comparison | 67% |
| useful abstention | 100% |
| useful experiment | 50% |
| judge: no contradictions | 100% |
| judge: no invented figures | 100% |
| judge: diagnostic quality | 100% |
| Errors | 0 of 11 runs |
| Latency | p50 5.7 s, p95 7.3 s |
| Tokens | 241,097 in, 1,433 out |

## Checks

| Check | Pass |
|---|---|
| acceptableMove | 100% (11/11) |
| askTaste | 100% (10/10) |
| directionConsistent | 100% (11/11) |
| grindDirectionMatchesIssue | 0% (0/1) |
| groundedRanges | 100% (11/11) |
| historyComparison | 67% (2/3) |
| judge.actionable | 100% (11/11) |
| judge.answered | 100% (11/11) |
| judge.noContradictions | 100% (11/11) |
| judge.noInventedFigures | 100% (11/11) |
| judge.plainLanguage | 100% (11/11) |
| judge.quality | 100% (11/11) |
| judge.specificity | 100% (11/11) |
| modelAnswered | 100% (11/11) |
| noFalseAlarms | 100% (11/11) |
| oneChange | 100% (11/11) |
| requiredIssues | 100% (11/11) |
| targetComparison | 0% (0/1) |
| usefulAbstention | 100% (2/2) |
| usefulExperiment | 50% (1/2) |
| validSwitch | 100% (11/11) |

## Slices

| Tag | Pass |
|---|---|
| split: holdout | 82% (9/11) |
| balanced | 100% (1/1) |
| history | 67% (2/3) |
| limiter | 50% (1/2) |
| missing-flow | 100% (1/1) |
| notes-only | 100% (1/1) |
| quality-v2 | 67% (2/3) |
| real-shape | 100% (1/1) |
| shortfall | 0% (0/1) |
| sour-choke | 100% (1/1) |
| synthetic | 82% (9/11) |
| taste | 100% (1/1) |
| transient | 100% (1/1) |
| unknown-profile | 100% (1/1) |

## Failures (2)

- **review-flow-shortfall**: **targetComparison** (The pour suggests a restrictive puck: flow averaged 1.1 ml/s against a 2.2 ml/s target while pressure was near its limit. The shot finished 4 seconds beyond the expected window, so a small coarser trial is reasonable. The sustained flow shortfall near the pressure limit is consistent with high puck resistance. Keep the dose, yield, profile and puck preparation consistent, then check whether flow moves closer to target and how the shot tastes.); grindDirectionMatchesIssue (The sustained flow shortfall near the pressure limit is consistent with high puck resistance. Keep the dose, yield, profile and puck preparation consistent, then check whether flow moves closer to target and how the shot tastes.); usefulExperiment (The sustained flow shortfall near the pressure limit is consistent with high puck resistance. Keep the dose, yield, profile and puck preparation consistent, then check whether flow moves closer to target and how the shot tastes.)
- **review-history-grind-slower**: **historyComparison** (The change from E-3 to E-4 coincided with a slower shot, from 25 to 32 seconds, bringing it into the expected window. Pressure also matched the 9 bar target; repeat E-4 with consistent puck prep and taste before adjusting. )
