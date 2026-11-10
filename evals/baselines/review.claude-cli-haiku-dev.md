# Eval: review · claude-cli:haiku

2026-11-10T00:58:51.338Z · commit d89715b3 (uncommitted changes) · 15 cases × 3 repeats · filter dev

Prompts: ShotReview 4ff5a4ebfa

| Metric | Value |
|---|---|
| Pass rate | **93%** (95% CI 82–98%) |
| Passed every repeat | 80% of cases |
| Mean score | 0.992 |
| model answered | 98% |
| appropriate next move | 96% |
| required observations | 100% |
| no false alarms | 100% |
| one change | 100% |
| grounded ranges | 100% |
| Errors | 0 of 45 runs |
| Latency | p50 6.2 s, p95 8.7 s |
| Cost (list price) | $0.053 total, $0.0012 per run |
| Tokens | 336,426 in, 46,359 out |

## Checks

| Check | Pass |
|---|---|
| acceptableMove | 96% (43/45) |
| askTaste | 100% (45/45) |
| groundedRanges | 100% (45/45) |
| modelAnswered | 98% (44/45) |
| noFalseAlarms | 100% (45/45) |
| oneChange | 100% (45/45) |
| requiredIssues | 100% (45/45) |
| validSwitch | 100% (45/45) |

## Slices

| Tag | Pass |
|---|---|
| split: dev | 93% (42/45) |
| bloom | 100% (3/3) |
| channeling | 100% (3/3) |
| choke | 67% (2/3) |
| clean | 100% (3/3) |
| early-stop | 100% (3/3) |
| gusher | 67% (2/3) |
| limiter | 100% (3/3) |
| manual | 100% (3/3) |
| manual-sour | 100% (3/3) |
| missing-scale | 100% (3/3) |
| no-data | 100% (3/3) |
| real-shape | 100% (3/3) |
| synthetic | 93% (42/45) |
| temp-offset | 100% (3/3) |
| temperature-curve | 100% (3/3) |
| turbo | 100% (3/3) |
| unknown-sour | 67% (2/3) |

## Failures (3)

- **review-choke** (repeat 0): **acceptableMove** (move none; accept coarser)
- **review-gusher** (repeat 0): **acceptableMove** (move none; accept finer)
- **review-unknown-sour** (repeat 0): **modelAnswered**
