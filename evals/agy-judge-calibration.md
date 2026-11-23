# Antigravity Opus judge calibration

The Antigravity replay matched the recorded Claude CLI Opus verdict on all 31
completed presentations. The quota rejection left 17 presentations without an
Antigravity verdict, so the calibration gate is incomplete.

The replay used `agy-cli:claude-opus-5-5-high` with Antigravity CLI 1.5.14 and
the historical round-two v2 calibration. It preserved the frozen rubric,
schema, case payloads and presentation schedule. The 24 blinded synthetic
reviews span six scenarios. Each has evidence-first (A) and review-first (B)
presentations. The scorer joined the result to the answer key after inference.
The comparison used the saved Claude CLI Opus 5.5 results from the same round.

| Metric | Antigravity | Claude CLI reference |
| --- | ---: | ---: |
| A faithful controls accepted | 10/10 assessed (12 planned) | 12/12 |
| A flawed reviews rejected | 9/9 assessed (12 planned) | 12/12 |
| B faithful controls accepted | 6/6 assessed (12 planned) | 12/12 |
| B flawed reviews rejected | 6/6 assessed (12 planned) | 12/12 |
| A/B verdict agreement | 7/7 paired (24 planned) | 24/24 |
| Critical flaws accepted | 0/3 assessed (4 planned) | 0/4 |

There were no verdict disagreements among the overlapping presentations.
One Antigravity rejection for an unlisted profile quoted two fields joined by
an ellipsis, giving 14/15 exact offending spans compared with 24/24 for the
reference. The recorded definite diagnosis was rejected in both orders. The
invented duration was rejected in order A and remains unassessed in B.

The replay made 32 Antigravity CLI attempts, with one quota rejection
(3.1%) and no retries. One successful format check on the first frozen
presentation brought the total to 33 attempts. The replay made zero Claude
Code or Codex calls. The shared Claude/GPT Antigravity quota read 95% → 0%
for the short window and 73% → 25% for the weekly window. These rounded,
account-wide readings include any concurrent use.

Use the flag for exploratory advisory screening. Keep deterministic promotion
checks and require a complete custodian calibration for an approved iteration
judge. The replay covers the historical calibration rubric and synthetic
controls. The integrated review rubric, unseen fixtures and physical shots
remain outside this comparison.
