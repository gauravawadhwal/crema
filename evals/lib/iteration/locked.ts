import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT_DIR } from "../dataset.js";
import { checkReviewHoldout, loadReviewDataset, selectReviewCases } from "../review-holdout.js";
import { digest, type Candidate } from "./candidate.js";
import { assertIndependent, CasePolicies, syntheticPanel, templates } from "./panel.js";
import { comparePanel, type DevReport } from "./runner.js";
import { readJson, saveJson, stopCheck } from "./runtime.js";
import type { IterationCase } from "./score.js";

const productionFile = "server/recommend/review.ts";

export function candidatePatch(candidate: Candidate, commit: string) {
  const source = execFileSync("git", ["show", `${commit}:${productionFile}`], { cwd: ROOT_DIR, encoding: "utf8" });
  const lines = source.split("\n");
  const index = lines.findIndex(line => candidate.change.kind === "instruction"
    ? line.startsWith("Pressure is in bar, inlet flow") && line.endsWith("`;")
    : line.includes("reviewCurveSection(input.points, landmarks, options?.pointBudget)"));
  if (index < 0) throw new Error("Cannot produce patch from pinned review");
  const before = lines[index];
  const after = candidate.change.kind === "instruction"
    ? before.slice(0, -1) + " + " + JSON.stringify("\n\n" + candidate.change.text) + ";"
    : before.replace("options?.pointBudget)", `options?.pointBudget ?? ${candidate.change.rows})`);
  const start = index - 2;
  return [
    `diff --git a/${productionFile} b/${productionFile}`, `--- a/${productionFile}`, `+++ b/${productionFile}`,
    `@@ -${start + 1},5 +${start + 1},5 @@`,
    ...lines.slice(start, index).map(line => " " + line), "-" + before, "+" + after,
    ...lines.slice(index + 1, index + 3).map(line => " " + line), "",
  ].join("\n");
}

export async function lockedComparison(options: {
  run: Parameters<typeof comparePanel>[0];
  report: DevReport;
  dev: IterationCase[];
  panel: string;
  policies?: string;
  manifest: string;
  manifestDigest: string;
  policiesDigest?: string;
  nomination: string;
  count: number;
  beforeOpen: () => Promise<void>;
  demonstration?: boolean;
}) {
  const { run, report, dev, panel, manifest, count, demonstration } = options;
  const finalist = report.finalist;
  if (!finalist?.accepted || digest(report) !== options.nomination) throw new Error("Accepted dev nomination does not match its approved digest");
  if (digest(report.pins) !== digest(run.pins)) throw new Error("Dev and locked run pins differ");
  if (count < 14 && !demonstration) throw new Error("Locked panel requires at least 14 independent templates");
  if (run.offline && !demonstration) throw new Error("Offline checks cannot use a production holdout");
  if (existsSync(`${manifest}.retired`) || existsSync(`${manifest}.runs.jsonl`)) throw new Error("Frozen holdout panel already attempted or retired");
  if (existsSync(join(run.dir, "locked.json"))) throw new Error("Round already has a locked decision");
  stopCheck(run.stop);
  await options.beforeOpen();
  stopCheck(run.stop);
  if (digest(readJson(manifest)) !== options.manifestDigest) throw new Error("Frozen manifest digest differs");
  // No body or rubric is opened in the dev command. Even a failed locked
  // attempt consumes this panel once its contents have been opened.
  writeFileSync(join(run.dir, "nomination.spent"), options.nomination + "\n", { flag: "wx", mode: 0o600 });
  const opening = `${manifest}.opening`;
  writeFileSync(opening, options.nomination + "\n", { flag: "wx", mode: 0o600 });
  let comparison: Awaited<ReturnType<typeof comparePanel>>;
  try {
    const dataset = loadReviewDataset(readJson(panel));
    if (dataset.demonstration !== !!demonstration || dataset.cases.some(c => c.split !== "holdout")) throw new Error("Expected a holdout-only frozen dataset");
    checkReviewHoldout(dataset, manifest);
    const rawPolicies = options.policies ? readJson(options.policies) : {};
    if (digest(rawPolicies) !== (options.policiesDigest ?? digest({}))) throw new Error("Frozen case policy digest differs");
    const cases = syntheticPanel(dataset.cases, CasePolicies.parse(rawPolicies));
    if (cases.length !== count || templates(cases) !== count) throw new Error("Frozen count or template uniqueness differs");
    assertIndependent(dev, cases);
    selectReviewCases(dataset, { split: "holdout", purpose: "evaluate", manifest,
      provider: run.subject?.id ?? "rules", variants: ["baseline", finalist.candidate.id], singleUse: true });
    comparison = await comparePanel(run, cases, 1, finalist.candidate, "holdout", finalist.baselineRepeatVariation);
  } catch {
    if (!existsSync(`${manifest}.retired`)) writeFileSync(`${manifest}.retired`, "", { flag: "wx", mode: 0o600 });
    saveJson(join(run.dir, "locked.json"), { pins: run.pins, nomination: options.nomination,
      manifestDigest: options.manifestDigest, decision: "inconclusive" });
    return "inconclusive";
  }
  const decision = comparison.accepted ? "accepted" : "rejected";
  saveJson(join(run.dir, "locked.json"), { pins: comparison.pins, nomination: options.nomination,
    manifestDigest: options.manifestDigest, decision, calls: comparison.lockedUsage });
  if (decision === "accepted" && !demonstration) {
    writeFileSync(join(run.dir, "proposed.patch"), candidatePatch(finalist.candidate, run.pins.commit), { mode: 0o600, flag: "wx" });
  }
  return decision;
}
