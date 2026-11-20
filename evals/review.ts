/** Curve and label evals for the shot-review rebuild. */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { MockProvider } from "../server/llm/mock.js";
import { ROOT_DIR, EVALS_DIR } from "./lib/dataset.js";
import { REVIEW_FIXTURES, reviewFixture } from "./lib/review-fixtures.js";
import { checkReviewHoldout, freezeReviewHoldout, loadReviewDataset, selectReviewCases } from "./lib/review-holdout.js";
import { REVIEW_VARIANTS, VARIANT_NAMES, runReviewAblation } from "./lib/review-ablation.js";
import { assertCurveStageInvariant, mockCurveStage } from "./lib/review-crossed.js";
import { loadLocalReviewShots } from "./lib/review-local-replay.js";
import { loadIndependentReviewDataset } from "./lib/review-independent.js";
import { caseDigests, makeEvalManifest, scorerFingerprint } from "./lib/manifest.js";
import { reviewAblationMarkdown, type ReviewAblationReport } from "./lib/review-ablation-report.js";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    fixture: { type: "string" },
    provider: { type: "string" },
    dataset: { type: "string" },
    manifest: { type: "string" },
    split: { type: "string" },
    purpose: { type: "string" },
    variant: { type: "string", multiple: true },
    out: { type: "string" },
  },
});

const usage = `Usage: npx tsx evals/review.ts <command>
  cross  [--fixture <legacy synthetic fixture> | --dataset <file|independent>] [--provider rules|mock]
  run    --dataset <file|independent> [--split dev|holdout] [--purpose tune|evaluate]
         [--variant <name>] [--provider rules|mock] [--out <dir>] [--manifest <file>]
  freeze --dataset <file> --manifest <new file>
  check  --dataset <file> --manifest <frozen file>
  replay [--provider rules|mock]   Reads CREMA_LOCAL_SHOTS_DIR and prints aggregate metrics.`;

const variants = [...new Set(args.variant?.map((name) => z.enum(VARIANT_NAMES).parse(name)) ?? VARIANT_NAMES)];
const providerName = z.enum(["rules", "mock"]).parse(args.provider ?? "rules");
const provider = providerName === "mock" ? new MockProvider() : undefined;
const loadDataset = (name: string) => name === "independent"
  ? loadIndependentReviewDataset()
  : loadReviewDataset(JSON.parse(readFileSync(name, "utf8")));

async function main() {
  if (args.help || positionals.length !== 1) {
    console.log(usage);
    return args.help ? 0 : 2;
  }
  const command = z.enum(["cross", "run", "freeze", "check", "replay"]).parse(positionals[0]);
  if (command === "cross") {
    if (args.dataset && args.fixture) throw new Error("Specify either --dataset or --fixture");
    const legacyFixture = () => {
      const id = z.enum(REVIEW_FIXTURES).parse(args.fixture ?? "history-grind-progress");
      return [{ id, input: reviewFixture(id) }];
    };
    const cases = args.dataset ? loadDataset(args.dataset).cases.filter((c) => c.split === "dev") : legacyFixture();
    if (!cases.length) throw new Error("No dev cases to cross");
    for (const { id, input } of cases) {
      try {
        await assertCurveStageInvariant(input);
        if (provider) await assertCurveStageInvariant(input, mockCurveStage);
      } catch (error) {
        throw new Error(`Crossed taste check failed for ${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
      console.log(`Curve stage invariant across crossed taste inputs for ${id}`);
      if (provider) console.log("Mock curve output and any narrative prompt are byte-identical");
    }
    return 0;
  }

  if (command === "replay") {
    const cases = loadLocalReviewShots();
    if (!cases.length) throw new Error("No Decaid recordings found");
    const [result] = await runReviewAblation(cases, ["two-stage"], provider);
    if (result.status !== "ready") throw new Error(result.reason);
    // Keep recordings, annotations and prompt text out of the results directory.
    console.log(JSON.stringify({ provider: providerName, summary: result.summary, labelSources: result.labelSources }, null, 2));
    return 0;
  }

  if (!args.dataset) throw new Error("Specify --dataset <file|independent>");
  const dataset = loadDataset(args.dataset);
  if (command === "freeze" || command === "check") {
    if (!args.manifest) throw new Error("Specify --manifest <file>");
    const manifest = command === "freeze" ? freezeReviewHoldout(dataset, args.manifest) : checkReviewHoldout(dataset, args.manifest);
    console.log(`${command === "freeze" ? "Froze" : "Verified"} ${Object.keys(manifest.fixtures).length} ${manifest.demonstration ? "demonstration " : ""}holdout fixtures`);
    return 0;
  }

  const split = z.enum(["dev", "holdout"]).parse(args.split ?? "dev");
  const purpose = z.enum(["tune", "evaluate"]).parse(args.purpose ?? "tune");
  // A pending-only request has no evaluation attempt to count.
  if (variants.every((name) => REVIEW_VARIANTS[name].status === "pending")) {
    for (const name of variants) console.log(`${name}: not implemented yet`);
    return 0;
  }
  const start = new Date();
  const git = (args: string[]) => execFileSync("git", args, { cwd: ROOT_DIR, encoding: "utf8" }).trim();
  const commit = git(["rev-parse", "HEAD"]);
  const dirty = git(["status", "--porcelain"]) !== "";
  const { cases, holdoutRunCount, panel } = selectReviewCases(dataset, {
    split, purpose, manifest: args.manifest, provider: providerName, variants,
    attemptsDirectory: process.env.CREMA_HOLDOUT_ATTEMPTS_DIR,
  });
  if (panel) {
    const evaluated = await runReviewAblation(cases, variants, provider);
    console.log(JSON.stringify({ panel, verdict: "inconclusive", promotionEligible: evaluated.some(v => v.status === "ready" && v.promotionEligible) }));
    return 1;
  }
  const manifest = makeEvalManifest(cases.map(c => caseDigests(c.id,
    { session: c.session, recipe: c.recipe, family: c.profileFamily, pump: c.pumpMode, split: c.split }, { input: c.input, fullTrace: c.fullTrace, samples: c.input.points.map(p => p.t) }, c.labels)),
    cases.map(c => ({ caseId: c.id, repeat: 0 })), scorerFingerprint("ablation"));
  const report: ReviewAblationReport = {
    meta: { task: "review-ablation", dataset: dataset.id, demonstration: dataset.demonstration, split, purpose,
      provider: providerName, startedAt: start.toISOString(), manifest, git: { commit, dirty }, holdoutRunCount },
    variants: await runReviewAblation(cases, variants, provider),
  };

  const dir = path.resolve(args.out ?? path.join(EVALS_DIR, "results"));
  mkdirSync(dir, { recursive: true });
  const stamp = start.toISOString().replace(/[:.]/g, "-");
  const stem = path.join(dir, `${stamp}-review-ablation-${providerName}-${randomUUID().slice(0, 8)}`);
  writeFileSync(`${stem}.json`, JSON.stringify(report, null, 1) + "\n", { flag: "wx" });
  writeFileSync(`${stem}.md`, reviewAblationMarkdown(report), { flag: "wx" });
  console.log(`${stem}.json (+ .md report)`);
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
