# Eval: review · codex-cli:gpt-6.1-terra · quality-holdout-once

2026-11-11T13:50:00.214Z · commit d9ab180c (uncommitted changes) · 11 cases × 1 repeats · filter holdout · judge codex-cli:gpt-6.1-sol

Prompts: ShotReview 8f9d8fc02e, JudgeVerdict c91b46b3a3

| Metric | Value |
|---|---|
| Pass rate | **100%** (95% CI 74–100%) |
| Mean score | 0.988 |
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
| grounded target comparison | 100% |
| grounded history comparison | 100% |
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
| historyComparison | 100% (3/3) |
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
| targetComparison | 100% (1/1) |
| usefulAbstention | 100% (2/2) |
| usefulExperiment | 50% (1/2) |
| validSwitch | 100% (11/11) |

## Slices

| Tag | Pass |
|---|---|
| split: holdout | 100% (11/11) |
| balanced | 100% (1/1) |
| history | 100% (3/3) |
| limiter | 100% (2/2) |
| missing-flow | 100% (1/1) |
| notes-only | 100% (1/1) |
| quality-v2 | 100% (3/3) |
| real-shape | 100% (1/1) |
| shortfall | 100% (1/1) |
| sour-choke | 100% (1/1) |
| synthetic | 100% (11/11) |
| taste | 100% (1/1) |
| transient | 100% (1/1) |
| unknown-profile | 100% (1/1) |

## Failures (0)

