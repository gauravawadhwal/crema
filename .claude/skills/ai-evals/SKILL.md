---
name: ai-evals
description: Measure Crema's AI (coffee identification, profile recommendation, dial-in advice) against labelled cases and the committed baselines. Use before and after changing a prompt, a provider adapter, a model, the profile catalog or ranking, or anything in server/identify.ts, server/recommend/ or server/llm/; and when trying a cheaper model.
---

# Run the AI evals

Read `evals/README.md` for how the suite works. The short version:

1. **Free checks first.** Datasets, graders and the harness have unit tests, and the rules baseline costs nothing:
   ```bash
   npm test -- test/evals.test.ts
   ```
   ```bash
   npm run eval -- --task all --provider rules
   ```

2. **Run the change against a model.** Start with the task you touched and the dev split. Use `--repeat 3` for anything you'll draw conclusions from.
   ```bash
   npm run eval -- --task dialin --provider claude-cli --model haiku --repeat 3 --split dev --judge claude-cli:sonnet
   ```
   Cost and time with `claude-cli` (list price): Haiku is under a cent a case; Opus is about 5–6 cents a case. Identify cases take 8–15 s; recommend 7–15 s; dial-in 5–14 s.

3. **Compare with the baseline for the same model**, and with the Opus reference:
   ```bash
   npm run eval:compare -- evals/baselines/dialin.claude-cli-haiku.json evals/results/<new>.json --fail-on-regression
   ```
   Read the cases that got worse in the run's `.md` report. Decide whether the model is wrong or the label is wrong. Labels can be wrong: fix one only with a reason in its `why`, then `--regrade` the baselines.

4. **Before calling it done**, run the holdout split once. If the change is meant to be the new normal, copy the run to `evals/baselines/<task>.<subject>.json`, refresh the table in `evals/README.md` (command at the bottom of that file), and commit.

Notes:
- A prompt edit changes the prompt hash in `meta.prompts`; compare prints it, so you can tell which prompt each run used.
- Changing only the judge? `npm run eval -- --regrade <file> --judge claude-cli:sonnet` re-judges saved outputs without calling the model under test.
- `samples/recipes.json` (the demo's recipes) was generated with an earlier prompt. Regenerate it (refresh-demo-assets skill) if a prompt change should show in the demo.
