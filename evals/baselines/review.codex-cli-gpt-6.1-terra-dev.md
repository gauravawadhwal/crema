# Eval: review · codex-cli:gpt-6.1-terra · quality-validated; 32 provider-unavailable trials retried with unchanged system/input; original completed trials preserved

2026-11-12T00:38:13.474Z · commit d9ab180c (uncommitted changes) · 28 cases × 3 repeats · filter dev · judge codex-cli:gpt-6.1-sol

Prompts: ShotReview 8f9d8fc02e, JudgeVerdict c91b46b3a3

| Metric | Value |
|---|---|
| Pass rate | **100%** (95% CI 96–100%) |
| Passed every repeat | 100% of cases |
| Mean score | 0.992 |
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
| grounded pace comparison | 100% |
| grounded target comparison | 100% |
| grounded history comparison | 100% |
| useful abstention | 100% |
| useful experiment | 83% |
| judge: no contradictions | 100% |
| judge: no invented figures | 100% |
| judge: diagnostic quality | 100% |
| Errors | 0 of 84 runs |
| Latency | p50 5.4 s, p95 9.5 s |
| Tokens | 1,815,686 in, 10,016 out |

## Checks

| Check | Pass |
|---|---|
| acceptableMove | 100% (84/84) |
| askTaste | 100% (84/84) |
| directionConsistent | 100% (84/84) |
| grindDirectionMatchesIssue | 76% (16/21) |
| groundedRanges | 100% (84/84) |
| historyComparison | 100% (12/12) |
| judge.actionable | 100% (84/84) |
| judge.answered | 100% (84/84) |
| judge.noContradictions | 100% (84/84) |
| judge.noInventedFigures | 100% (84/84) |
| judge.plainLanguage | 100% (84/84) |
| judge.quality | 100% (84/84) |
| judge.specificity | 100% (84/84) |
| modelAnswered | 100% (84/84) |
| noFalseAlarms | 100% (84/84) |
| oneChange | 100% (84/84) |
| paceComparison | 100% (9/9) |
| requiredIssues | 100% (84/84) |
| targetComparison | 100% (9/9) |
| usefulAbstention | 100% (12/12) |
| usefulExperiment | 83% (20/24) |
| validSwitch | 100% (84/84) |

## Slices

| Tag | Pass |
|---|---|
| split: dev | 100% (84/84) |
| bloom | 100% (3/3) |
| channeling | 100% (3/3) |
| choke | 100% (3/3) |
| clean | 100% (3/3) |
| conflict | 100% (6/6) |
| early-stop | 100% (3/3) |
| fast-time | 100% (3/3) |
| gusher | 100% (3/3) |
| history | 100% (12/12) |
| injection | 100% (6/6) |
| limiter | 100% (6/6) |
| manual | 100% (3/3) |
| manual-sour | 100% (3/3) |
| missing-scale | 100% (3/3) |
| negation | 100% (3/3) |
| no-data | 100% (3/3) |
| notes | 100% (15/15) |
| pace | 100% (6/6) |
| quality-v2 | 100% (30/30) |
| real-shape | 100% (6/6) |
| shortfall | 100% (3/3) |
| slow-time | 100% (3/3) |
| synthetic | 100% (66/66) |
| taste | 100% (15/15) |
| temp-offset | 100% (3/3) |
| temperature-curve | 100% (3/3) |
| turbo | 100% (3/3) |
| unknown-sour | 100% (3/3) |

## Failures (0)

