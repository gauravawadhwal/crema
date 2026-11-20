# Shot review gym iteration

The gym tests one prompt instruction or anchored-curve row budget at a time. It runs the shipped two-stage review through a one-provider chain. The baseline uses the shipped prompt and evidence. The candidate overrides one setting in memory for the curve narrative. The implementation writes an applicable patch for a separate pull request only after a locked pass.

## Offline demonstration

```sh
npx tsx evals/iterate.ts demo --provider mock --out "$(mktemp -d)"
npx tsx evals/iterate.ts demo --provider rules --out "$(mktemp -d)"
```

The mock rejects `summary-first`, a header-readback candidate that loses observations, and accepts `first-controlled-event` on dev. The latter fails on the synthetic locked panel and the manifest records one attempt. The rules pass uses the same orchestration with the local review, yielding zero model tokens and no finalist. The cases and scripted mock responses exercise the gates. Their results are plumbing checks. Both commands leave their reports in the supplied private directory.

## Approved real round

Run only after the owner approves the model pins and spending for that round. Use an isolated evaluator account or VM with outbound traffic restricted to the approved provider and quota endpoints. The checkout must be a clean linked worktree on a separate branch. Use private directories outside the checkout, owned by the evaluator at mode `0700`. Mount subscription-only CLI profiles with no machine, home network, API or publishing credentials. The subprocess inherits a minimal environment, uses a fresh working directory and disables CLI tools, user configuration and session persistence. The isolated environment is responsible for enforcing network and filesystem isolation.

1. Run `npx tsx evals/iterate.ts pins` to print the checkout commit and scorer and judge code hashes. Have the independent judge custodian issue a calibration attestation for that scorer and judge configuration. `passed` enables cited critical vetoes. `advisory` records judge diagnostics without giving them veto power. A failed, changed, or mismatched attestation stops the round.
2. Save the plan below in a private file. Choose four screen case IDs from four distinct templates and at least 14 balanced dev templates spanning the available gym families. Case IDs end in `.s0`, `.s1`, and so on. Template IDs omit the seed suffix. The generator automatically loads the checked-in kernel and corpus tree. Additional scenario directories are optional. The larger check includes the selected synthetic templates and every legacy dev case.
3. Start the dev round. The initial baseline on four cases × three repeats provides only failed DEV observations to the proposer. Each proposed candidate gets its own alternating baseline/candidate screen. At most one advances to the larger paired dev check. The command prints one nomination digest if it passes that check.
4. Give the nomination digest to the independent custodian. The custodian freezes a separate synthetic holdout-only dataset of at least 14 unseen templates with `npx tsx evals/review.ts freeze --dataset "$panel" --manifest "$manifest"` and records the manifest digest before tuning. The custodian owns the panel and rubric. Use distinct session and recipe groups and new scenario shapes. Keep the dataset and its case policy inaccessible to the dev process and reviewer subprocesses.
5. On the custodian side, run the locked command once using the same plan, results directory and a private lock file. It checks the nomination and remaining allowance before opening the panel, checks the manifest and disjoint groups, runs one pass per arm, and retires the panel. The optimizer receives one decision. The custodian keeps the private result and can release `proposed.patch` on acceptance. Later tuning uses a new panel.

```sh
CREMA_GYM_ISOLATED=1 npx tsx evals/iterate.ts dev \
  --plan "$round_plan" --out "$private_round" --approved

CREMA_GYM_ISOLATED=1 npx tsx evals/iterate.ts locked \
  --plan "$round_plan" --lock "$custodian_lock" --out "$private_round" --approved
```

The round plan is a JSON object with these fields.

| Field | Value |
| --- | --- |
| `commit` | Exact commit from `pins` |
| `seeds` | 1–8 generated recordings per template, each reviewed three times on dev |
| `scenarioDirectories` | Optional absolute directories of additional synthetic dev scenarios |
| `screen` | Four synthetic dev case IDs |
| `balancedTemplates` | At least 14 preregistered synthetic template IDs |
| `casePolicies` | Optional overrides keyed by generated dev case ID. Each value can set `nominal` or name a required abstention scope with `gap`. The built-in defaults use nominal and tracked scenario names and injected scale loss. |
| `subject`, `proposer`, `judge` | Each has `provider` (`codex-cli` or `claude-cli`), exact `model`, `effort` (`low`, `medium` or `high`), `tier` (`standard`), absolute `binary`, exact `cliVersion` from that binary, and `maxCallTokens`. The judge uses an exact Claude Opus model ID. |
| `calibration` | Absolute `file` and `sha` of the custodian's JSON attestation |
| `sandbox` | Absolute `home`, `quotaBinary`, and matching `codexProfile` and/or `claudeProfile`. Set `timeoutMs` per subprocess. |
| `budget` | `maxTokens` and `quota` keyed by `codex` or `claude`. Each vendor budget contains `maxShortPp`, `maxWeeklyPp`, `reserveShortPp`, `reserveWeeklyPp`, `shortPpPerCall` and `weeklyPpPerCall`. Use percentage points of the full relevant allowance. |

The attestation JSON has `status`, `judge` (provider, model, effort, tier), `scorer` and `judgeCode` from `pins`, and `report` (the SHA-256 digest of the custodian's underlying calibration report). The lock JSON has absolute `panel`, `manifest`, and `attemptsDirectory` paths, `manifestDigest`, `caseCount`, and `nomination` from the dev output. Share the same custodian-owned private attempt ledger with the ablation runner for every evaluation of a protected panel. Optional `policies` and `policiesDigest` pin the locked case policy sidecar. The sidecar uses the same shape as `casePolicies`; freeze its digest with the manifest. The runner's JSON digests hash UTF-8 `JSON.stringify` of the parsed document. For example:

```sh
node -e 'const fs=require("node:fs"), c=require("node:crypto"); console.log(c.createHash("sha256").update(JSON.stringify(JSON.parse(fs.readFileSync(process.argv[1],"utf8")))).digest("hex"))' "$manifest"
```

`dev.json` records the paired fingerprints, provider usage including cache, coverage denominators, family changes, interval and adverse examples. `dev.md` summarizes the same decision. Episode checkpoints are reused only for the same plan, pairing, input hash, candidate and repeat. Set the `STOP` file in the private round directory to prevent further model calls and cancel an active child. A transport failure can consume one metered retry. A fall back to rules after a model failure, stale quota, changed reset window, lost reserve or uncertain usage stops the round. Production's explicit rules path for recordings with insufficient telemetry is recorded as rules. An interrupted metered call leaves an uncertain ledger that requires a new approved round after the custodian accounts for the usage. A locked attempt retires its panel even if it fails.

The comparison requires zero critical regressions, per-class precision and recall of at least 90% where assessed, justified abstention at least 95%, nominal false alarms at most 5%, and no loss of a consistently passing case. Missing acceptance coverage or unassessed event classes block promotion. Dev and locked promotion each require two additional correctly prioritized templates, positive family-macro improvement above baseline dev repeat variation, and a positive lower bound on the paired case-cluster interval. Median subject input tokens and p95 subject latency may increase by at most 10%. The narrative matcher is conservative and may mark a valid paraphrase unassessed. Inspect adverse dev examples and version the scorer separately before opening another panel.

## Inference budget

Offline runs consume zero model tokens. One screen with one candidate uses 24 subject reviews, plus the 12 initial baseline reviews and one proposer call. Two candidates use 48 screen reviews. A finalist adds six reviews per dev recording (both arms × three repeats) and two reviews per locked recording. A free-text notes stage can add one subject call per review. The Opus judge is metered separately for each review, and one transport retry and all failed attempts count. Usage accounting includes cache, output and reported reasoning tokens.

Historical Terra review averaged about 21,600 input and 120 output tokens per review. A 24-review screen at that footprint is about 519,000 input and 2,900 output tokens before the initial baseline, proposer, notes, judge and retries. A 14-template dev and 14-template locked comparison adds 112 reviews, or about 2.42 million input and 13,400 output tokens before notes and judging. The current curve-first prompt and judge input can differ in size. Use the actual subscription quota and authorized bounds for dispatch.

Set `maxCallTokens` to a conservative upper bound for a full provider turn, including CLI overhead and model output. The runner reserves that amount before dispatch, accounts for actual reported tokens afterward, and stops on overage or missing usage. Provider CLIs report usage after inference. The quota meter runs before and after every attempt and treats estimated reservation and observed account movement conservatively. Quota percentages are rounded, shared and can lag. Keep the holdout sealed if the remaining authorized cap cannot fund the locked comparison.
