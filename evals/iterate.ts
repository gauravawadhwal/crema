import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { ROOT_DIR } from "./lib/dataset.js";
import { asServerProvider } from "./lib/providers.js";
import { loadReviewDataset } from "./lib/review-holdout.js";
import { digest } from "./lib/iteration/candidate.js";
import { runDemonstration } from "./lib/iteration/demo.js";
import { lockedComparison } from "./lib/iteration/locked.js";
import { CasePolicies, legacyDev, seededDev, syntheticPanel, templates } from "./lib/iteration/panel.js";
import { CliPin, IsolatedCli, makeQuotaReader, Sandbox, vendorOf } from "./lib/iteration/providers.js";
import { develop, type DevReport, type Pins } from "./lib/iteration/runner.js";
import { assertPrivateDirectory, Budget, Meter, readJson, saveJson } from "./lib/iteration/runtime.js";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const commitId = z.string().regex(/^[a-f0-9]{40}$/);
const absolutePath = z.string().refine(isAbsolute);
const Plan = z.strictObject({
  commit: commitId,
  scenarioDirectories: z.array(absolutePath).default([]),
  seeds: z.number().int().min(1).max(8).default(1),
  screen: z.array(z.string()).length(4),
  // Pick the balanced panel before observing the screen. All legacy dev
  // regressions are always included in the larger paired check.
  balancedTemplates: z.array(z.string()).min(14),
  casePolicies: CasePolicies.default({}),
  subject: CliPin,
  proposer: CliPin,
  judge: CliPin.refine(pin => (pin.provider === "claude-cli" || pin.provider === "agy-cli") && /^claude-opus-\d/.test(pin.model)),
  calibration: z.strictObject({ file: absolutePath, sha }),
  sandbox: Sandbox,
  budget: Budget,
});
const Calibration = z.strictObject({
  status: z.enum(["passed", "advisory", "failed"]),
  judge: z.strictObject({ provider: z.enum(["claude-cli", "agy-cli"]), model: z.string(), effort: z.string(), tier: z.literal("standard") }),
  scorer: sha,
  judgeCode: sha,
  report: sha,
});
const Lock = z.strictObject({
  panel: absolutePath, manifest: absolutePath, attemptsDirectory: absolutePath, manifestDigest: sha, caseCount: z.number().int().min(14),
  nomination: sha, policies: absolutePath.optional(), policiesDigest: sha.optional(),
});

const usage = `Usage: npx tsx evals/iterate.ts <command> --out <private directory>
  demo [--provider mock|rules]
  dev --plan <round.json> --approved
  locked --plan <round.json> --lock <custodian.json> --approved
  pins [--judge agy-cli:<opus-model>]
See evals/ITERATION.md for plan fields, approval and costs.`;

const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT_DIR, encoding: "utf8" }).trim();
const inside = (parent: string, file: string) => {
  const rel = relative(parent, file);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep));
};

function external(file: string) {
  const actual = realpathSync(file);
  if (inside(realpathSync(ROOT_DIR), actual)) throw new Error("Use a private path outside the repository");
  return actual;
}

function fingerprints(agy = false) {
  const hash = (paths: string[]) => digest(paths.map(path => [path, readFileSync(join(ROOT_DIR, path), "utf8")]));
  return {
    scorer: hash(["evals/lib/iteration/score.ts", "evals/lib/iteration/compare.ts", "evals/lib/review-metrics.ts",
      "evals/lib/review-grader.ts", "evals/lib/review-labels.ts", "evals/lib/graders.ts", "evals/lib/review-coach-grader.ts",
      "evals/lib/review-coach-expectations.ts", "evals/lib/review-crossed.ts", "evals/lib/iteration/panel.ts"]),
    judgeCode: hash(["evals/lib/judge.ts", "evals/lib/iteration/runner.ts",
      ...(agy ? ["evals/lib/agy-cli.ts", "evals/lib/iteration/providers.ts", "evals/lib/iteration/runtime.ts"] : [])]),
  };
}

function devMarkdown(report: DevReport) {
  return [
    "# Crema shot review gym", "",
    `Commit \`${report.pins.commit}\` · dataset \`${report.pins.dataset}\` · scorer \`${report.pins.scorer}\``, "",
    ...[...report.screens.map(result => ({ stage: "Screen", result })), ...(report.finalist ? [{ stage: "Dev", result: report.finalist }] : [])]
      .flatMap(({ stage, result: p }) => [
        `## ${stage} · ${p.candidate.id}`, "", p.candidate.hypothesis, "",
        p.accepted ? "Passed this panel." : `Rejected or inconclusive. ${p.failures.join(" · ")}`, "",
        `Salience gains on ${p.salientTemplateGains} templates. Family-macro delta ${p.familyMacroDelta ?? "unassessed"}, paired 95% interval ${p.caseClusterInterval95?.join(" to ") ?? "unassessed"}, dev repeat variation ${p.baselineRepeatVariation}.`,
        `Pass-all-repeats ${p.passAll.filter(c => c.baseline).length} baseline and ${p.passAll.filter(c => c.candidate).length} candidate out of ${p.passAll.length} cases.`, "",
        "| Event class | Baseline TP / FP / FN | Candidate TP / FP / FN |", "| --- | --- | --- |",
        ...p.summaries.candidate.classes.map(c => {
          const a = p.summaries.baseline.classes.find(b => b.kind === c.kind);
          return `| ${c.kind} | ${a ? [a.tp, a.fp, a.fn].join(" / ") : "—"} | ${[c.tp, c.fp, c.fn].join(" / ")} |`;
        }), "",
        "| Arm | Stage agreement | Hypotheses | Stop abstention | Taste isolation violations (pairs) | Taste and links | Style | Structure | Grounding | Fallbacks |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
        ...Object.entries(p.summaries).map(([arm, { coach: c }]) =>
          `| ${arm} | ${c.agreement.passed}/${c.agreement.total} | ${c.hypothesisAccuracy.passed}/${c.hypothesisAccuracy.total} | ${c.abstention.passed}/${c.abstention.total} | ${c.tasteIsolation.violations} (${c.tasteIsolation.checked}) | ${c.tasteLinkViolations} | ${c.styleViolations} | ${c.structuralViolations} | ${c.groundingViolations} | ${c.fallback} |`),
        "", "| Arm | Stage class | Precision | Recall |", "|---|---|---:|---:|",
        ...Object.entries(p.summaries).flatMap(([arm, { coach }]) => coach.stageClasses.map(c =>
          `| ${arm} | ${c.verdict} | ${c.precision?.toFixed(3) ?? "—"} | ${c.recall?.toFixed(3) ?? "—"} |`)), "",
        `Candidate justified abstention ${p.summaries.candidate.abstention.passed}/${p.summaries.candidate.abstention.total} and nominal false alarms ${p.summaries.candidate.nominal.alarms}/${p.summaries.candidate.nominal.total}.`,
        `Unassessed event classes ${[...p.summaries.candidate.unassessed, ...p.summaries.candidate.unsupported].join(", ") || "none observed"}.`,
        `Median input tokens ${p.summaries.baseline.medianInput} → ${p.summaries.candidate.medianInput}. p95 latency ${p.summaries.baseline.p95Ms.toFixed(1)} → ${p.summaries.candidate.p95Ms.toFixed(1)} ms.`, "",
        ...p.adverse.map(c => `- ${c.id} repeat ${c.repeat + 1} · ${c.checks.join(", ")}`), "",
      ]),
  ].join("\n");
}

async function realRound(command: "dev" | "locked", args: { plan?: string; lock?: string; approved?: boolean }, dir: string, stop: string) {
  if (!args.approved || !args.plan) throw new Error("Real inference requires the approved round plan and --approved");
  if (process.env.CREMA_GYM_ISOLATED !== "1") throw new Error("Real inference requires the isolated evaluator environment");
  const plan = Plan.parse(readJson(external(args.plan)));
  if (git("rev-parse", "HEAD") !== plan.commit || git("status", "--porcelain") ||
      git("branch", "--show-current") === "" || ["main", "master"].includes(git("branch", "--show-current")) ||
      git("rev-parse", "--git-dir") === git("rev-parse", "--git-common-dir")) {
    throw new Error("Real inference requires a clean, pinned, non-default linked worktree");
  }
  if (plan.subject.provider === "claude-cli" && !/^claude-(?:opus|sonnet|haiku)-\d/.test(plan.subject.model) ||
      plan.proposer.provider === "claude-cli" && !/^claude-(?:opus|sonnet|haiku)-\d/.test(plan.proposer.model)) {
    throw new Error("Use a versioned Claude model identifier");
  }
  const { scorer, judgeCode } = fingerprints(plan.judge.provider === "agy-cli");
  const approval = readJson(external(plan.calibration.file));
  if (digest(approval) !== plan.calibration.sha) throw new Error("Calibration report digest differs");
  const calibration = Calibration.parse(approval);
  const { provider, model, effort, tier } = plan.judge;
  if (calibration.status === "failed" || calibration.scorer !== scorer || calibration.judgeCode !== judgeCode ||
      digest(calibration.judge) !== digest({ provider, model, effort, tier })) throw new Error("Judge calibration failed or does not match the run pins");

  const generated = seededDev(plan.scenarioDirectories, plan.seeds);
  const loaded = loadReviewDataset(generated.dataset);
  const all = [...syntheticPanel(loaded.cases, { ...generated.policies, ...plan.casePolicies }), ...legacyDev()];
  const screen = plan.screen.map(id => {
    const c = all.find(c => c.id === id);
    if (!c || c.legacy) throw new Error("Screen requires seeded synthetic dev cases");
    return c;
  });
  const names = new Set(plan.balancedTemplates);
  const dev = all.filter(c => c.legacy || names.has(c.template));
  if (templates(dev) !== names.size || names.size !== plan.balancedTemplates.length) throw new Error("Balanced dev templates must exist and be distinct");
  const available = new Set(all.filter(c => !c.legacy).map(c => c.family));
  const perFamily = [...available].map(family => templates(dev.filter(c => !c.legacy && c.family === family)));
  if (perFamily.some(n => n === 0) || Math.max(...perFamily) - Math.min(...perFamily) > 1) {
    throw new Error("Balanced dev panel must cover all available gym families with template counts within one");
  }
  const pins: Pins = { commit: plan.commit, scorer, dataset: digest(all.map(c => c.hash)),
    subject: plan.subject, proposer: plan.proposer, judge: { pin: plan.judge, calibration: plan.calibration.sha, judgeCode, status: calibration.status } };
  const binding = digest({ pins, plan });
  const work = mkdtempSync(join(dir, "model-"));
  try {
    assertPrivateDirectory(external(plan.sandbox.home));
    for (const profile of [plan.sandbox.codexProfile, plan.sandbox.claudeProfile]) if (profile) assertPrivateDirectory(external(profile));
    const meter = new Meter(dir, stop, plan.budget, binding, makeQuotaReader(plan.sandbox, work, stop, [plan.subject, plan.proposer, plan.judge]));
    const subject = new IsolatedCli(plan.subject, plan.sandbox, work, stop, meter);
    const proposer = new IsolatedCli(plan.proposer, plan.sandbox, work, stop, meter);
    const judge = new IsolatedCli(plan.judge, plan.sandbox, work, stop, meter);
    for (const cli of [subject, judge, ...(command === "dev" ? [proposer] : [])]) await cli.checkVersion();
    const run = { pins, dir, stop, subject: asServerProvider(subject), judge: asServerProvider(judge),
      hardJudge: calibration.status === "passed", offline: false };
    const devReport = join(dir, "dev.json");
    if (command === "dev") {
      if (args.lock) throw new Error("The dev command has no holdout input");
      if (existsSync(devReport)) throw new Error("This round has already released a dev decision");
      const report = await develop(run, screen, dev, asServerProvider(proposer), binding);
      saveJson(devReport, report);
      writeFileSync(join(dir, "dev.md"), devMarkdown(report), { mode: 0o600, flag: "wx" });
      console.log(report.finalist?.accepted ? `Dev nominee ${report.finalist.candidate.id} · ${digest(report)}` : "No dev nominee");
    } else {
      if (!args.lock) throw new Error("Specify one custodian lock file");
      const lock = Lock.parse(readJson(external(args.lock)));
      const report = readJson(devReport) as DevReport;
      if (report.binding !== binding) throw new Error("Dev plan changed before holdout");
      const attemptsDirectory = external(lock.attemptsDirectory);
      assertPrivateDirectory(attemptsDirectory);
      const decision = await lockedComparison({ run, report, dev: all, ...lock, attemptsDirectory,
        panel: external(lock.panel), manifest: external(lock.manifest), policies: lock.policies && external(lock.policies),
        count: lock.caseCount,
        beforeOpen: async () => {
          // Two arms, one review per trace, at most one note interpretation per
          // review, plus judge, with room for a transport retry on every call.
          const planned = [ { pin: plan.subject, calls: lock.caseCount * 8 }, { pin: plan.judge, calls: lock.caseCount * 4 } ];
          for (const vendor of new Set(planned.map(p => vendorOf(p.pin)))) {
            const entries = planned.filter(p => vendorOf(p.pin) === vendor);
            await meter.reserve(vendor, entries.reduce((n, p) => n + p.calls, 0), Math.max(...entries.map(p => p.pin.maxCallTokens)));
          }
          if (meter.usage.tokens + planned.reduce((n, p) => n + p.calls * p.pin.maxCallTokens, 0) > plan.budget.maxTokens) {
            throw new Error("Token cap cannot fund the locked panel");
          }
        },
      });
      console.log(decision);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    out: { type: "string" }, provider: { type: "string" }, judge: { type: "string" }, plan: { type: "string" }, lock: { type: "string" },
    approved: { type: "boolean" }, help: { type: "boolean" },
  } });
  if (values.help) { console.log(usage); return; }
  if (positionals.length !== 1) throw new Error(usage);
  const command = z.enum(["demo", "dev", "locked", "pins"]).parse(positionals[0]);
  if (command === "pins") {
    if (values.judge && !/^agy-cli:claude-opus-\d[a-z0-9.-]*$/.test(values.judge)) throw new Error(usage);
    console.log(JSON.stringify({ commit: git("rev-parse", "HEAD"), ...fingerprints(!!values.judge) }));
    return;
  }
  if (values.judge) throw new Error("Set the real judge in the pinned plan");
  if (!values.out) throw new Error(usage);
  const out = resolve(values.out);
  external(dirname(out));
  if (!existsSync(out)) mkdirSync(out, { mode: 0o700 });
  const dir = external(out);
  assertPrivateDirectory(dir);
  const running = join(dir, "round.running");
  const fd = openSync(running, "wx", 0o600);
  try {
    const stop = join(dir, "STOP");
    if (command === "demo") {
      if (values.plan || values.lock || values.approved) throw new Error("Demo takes only an offline provider and results directory");
      const provider = z.enum(["mock", "rules"]).parse(values.provider ?? "mock");
      await runDemonstration(dir, stop, git("rev-parse", "HEAD"), provider);
    } else {
      if (values.provider) throw new Error("Set the real provider in the pinned plan");
      if (command === "dev" && values.lock) throw new Error("The dev command has no holdout input");
      await realRound(command, values, dir, stop);
    }
  } finally {
    closeSync(fd);
    rmSync(running);
  }
}

try { await main(); }
catch (error) {
  console.error(error instanceof Error ? error.message : "Iteration stopped");
  process.exitCode = 1;
}
