/**
 * Runs Crema's AI evals: the real identify / recommend / dial-in pipeline
 * against labelled cases, with a chosen provider and model.
 *
 *   npx tsx evals/run.ts --task recommend --provider claude-cli --model haiku
 *   npx tsx evals/run.ts --task all --provider rules            # no-AI baseline
 *   npx tsx evals/run.ts --task dialin --provider claude-cli --model sonnet --repeat 3 --judge claude-cli:opus
 *   npx tsx evals/run.ts --regrade evals/results/<file>.json     # re-grade saved outputs, no model calls
 *
 * See evals/README.md.
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { makeProvider, PROVIDER_IDS } from "../server/llm/index.js";
import type { ProviderId } from "../server/llm/types.js";
import { EVALS_DIR, loadCases, TASKS, type TaskName } from "./lib/dataset.js";
import { consoleSummary, markdownReport, packResults, summarize, unpackResults, type ResultsFile } from "./lib/report.js";
import { SYSTEM_PROMPTS } from "./lib/recorder.js";
import { gradeRecord, rejudge, runCase, supports, type RunRecord, type Subject } from "./lib/tasks.js";

const { values: args } = parseArgs({
  options: {
    task: { type: "string", default: "all" },
    provider: { type: "string", default: "claude-cli" },
    model: { type: "string" },
    repeat: { type: "string", default: "1" },
    concurrency: { type: "string", default: "4" },
    filter: { type: "string" },
    split: { type: "string" },
    live: { type: "boolean", default: false },
    judge: { type: "string" },
    out: { type: "string" },
    label: { type: "string" },
    regrade: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (args.help) {
  console.log(`Usage: npx tsx evals/run.ts [options]
  --task identify|recommend|dialin|review|all   (default all)
  --provider ${PROVIDER_IDS.join("|")}|rules   (default claude-cli)
  --model <name>        provider's model, e.g. haiku, sonnet, opus, gemini-2.5-flash-lite
  --repeat N            run each case N times to measure consistency (default 1)
  --concurrency N       parallel cases (default 4)
  --filter <text>       case id substring, or tag:<tag>
  --split dev|holdout   only one split
  --live                include identify cases that need live web search
  --judge <provider[:model]>  add model-graded text checks (recommend, dialin)
  --label <text>        note stored with the results (e.g. "prompt v2")
  --out <dir>           where to write results (default evals/results)
  --regrade <file>      re-grade a results file with the current graders and cases
                        (add --judge to re-run only the judge on its saved outputs)`);
  process.exit(0);
}

function git() {
  try {
    return { commit: execSync("git rev-parse HEAD", { cwd: EVALS_DIR }).toString().trim(), dirty: execSync("git status --porcelain", { cwd: EVALS_DIR }).toString().trim() !== "" };
  } catch {
    return { commit: "unknown", dirty: true };
  }
}

function parseSubject(spec: string, model?: string): { subject: Subject; name: string; provider: string; model: string | null } {
  if (spec === "rules") return { subject: { kind: "rules" }, name: "rules", provider: "rules", model: null };
  const [id, inlineModel] = spec.split(":");
  if (!PROVIDER_IDS.includes(id as ProviderId)) throw new Error(`unknown provider ${id}; expected ${PROVIDER_IDS.join(", ")} or rules`);
  const provider = makeProvider(id as ProviderId, { model: model ?? inlineModel });
  return { subject: { kind: "llm", provider }, name: provider.model ? `${id}:${provider.model}` : id, provider: id, model: provider.model ?? null };
}

function matches(c: { id: string; tags: string[]; split: string; live?: boolean }) {
  if (c.live && !args.live) return false;
  if (args.split && c.split !== args.split) return false;
  const f = args.filter;
  if (!f) return true;
  return f.startsWith("tag:") ? c.tags.includes(f.slice(4)) : c.id.includes(f);
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

function write(file: ResultsFile, outDir: string, stem: string) {
  mkdirSync(outDir, { recursive: true });
  const json = path.join(outDir, `${stem}.json`);
  writeFileSync(json, JSON.stringify(packResults(file), null, 1) + "\n");
  writeFileSync(path.join(outDir, `${stem}.md`), markdownReport(file));
  return json;
}

const outDir = path.resolve(args.out ?? path.join(EVALS_DIR, "results"));

if (args.regrade) {
  const file = unpackResults(JSON.parse(readFileSync(args.regrade, "utf8")) as ResultsFile);
  const cases = new Map(loadCases(file.meta.task).map((c) => [c.id, c]));
  const records = file.records.filter((r) => cases.has(r.caseId));
  if (args.judge) {
    // Re-judge saved outputs: changes to the judge never need the model under test re-run.
    const j = parseSubject(args.judge);
    if (j.subject.kind !== "llm") throw new Error("--judge needs a model provider");
    const provider = j.subject.provider;
    await pool(records, Number(args.concurrency), (r) => rejudge(file.meta.task, r, provider));
    file.meta.judge = j.name;
  }
  for (const r of records) r.grade = gradeRecord(file.meta.task, cases.get(r.caseId), r);
  const regraded: ResultsFile = { ...file, summary: summarize(file.meta.task, records), records, inputs: undefined };
  const dir = path.dirname(path.resolve(args.regrade));
  const stem = path.basename(args.regrade, ".json");
  write(regraded, dir, stem);
  console.log(consoleSummary(regraded));
  console.log(`regraded ${records.length} runs in place: ${args.regrade}`);
  process.exit(0);
}

const tasks: TaskName[] = args.task === "all" ? [...TASKS] : [args.task as TaskName];
for (const t of tasks) if (!TASKS.includes(t)) throw new Error(`unknown task ${t}`);
const { subject, name, provider, model } = parseSubject(args.provider!, args.model);
const judge = args.judge ? parseSubject(args.judge) : null;
if (judge && judge.subject.kind !== "llm") throw new Error("--judge needs a model provider");
const repeats = Math.max(1, Number(args.repeat));
const today = new Date();
const stamp = today.toISOString().replace(/[:.]/g, "-").slice(0, 19);

let failedGate = false;
for (const task of tasks) {
  if (!supports(task, subject)) {
    console.log(`skipping ${task}: ${name} can't do it`);
    continue;
  }
  const cases = loadCases(task).filter(matches);
  if (!cases.length) {
    console.log(`skipping ${task}: no cases match`);
    continue;
  }
  const jobs = cases.flatMap((c) => Array.from({ length: repeats }, (_, repeat) => ({ c, repeat })));
  console.log(`\n${task}: ${cases.length} cases × ${repeats} on ${name}${judge ? `, judged by ${judge.name}` : ""}`);
  let done = 0;
  const records: RunRecord[] = await pool(jobs, Number(args.concurrency), async ({ c, repeat }) => {
    const r = await runCase(task, c, subject, repeat, { today, judge: judge?.subject.kind === "llm" ? judge.subject.provider : undefined });
    done++;
    const cost = r.calls.reduce((a, x) => a + (x.usage?.costUsd ?? 0), 0);
    const bad = r.grade.checks.filter((x) => !x.pass).map((x) => x.name);
    console.log(
      `  ${r.grade.pass ? "pass" : "FAIL"} ${String(done).padStart(3)}/${jobs.length} ${c.id}${repeats > 1 ? `#${repeat}` : ""}  ${r.grade.score.toFixed(2)}  ${(r.ms / 1000).toFixed(1)}s${cost ? `  $${cost.toFixed(4)}` : ""}${bad.length ? `  [${bad.join(", ")}]` : ""}`,
    );
    return r;
  });
  records.sort((a, b) => a.caseId.localeCompare(b.caseId) || a.repeat - b.repeat);

  const prompts: ResultsFile["meta"]["prompts"] = {};
  for (const r of records) for (const call of r.calls) if (SYSTEM_PROMPTS.has(call.systemHash)) prompts[call.systemHash] = SYSTEM_PROMPTS.get(call.systemHash)!;
  const file: ResultsFile = {
    meta: { task, subject: name, provider, model, judge: judge?.name ?? null, startedAt: today.toISOString(), git: git(), repeats, filter: args.filter ?? args.split ?? null, prompts, label: args.label },
    summary: summarize(task, records),
    records,
  };
  const json = write(file, outDir, `${stamp}-${task}-${name.replace(/[^a-z0-9.-]+/gi, "_")}`);
  console.log(`\n${consoleSummary(file)}\n  → ${path.relative(process.cwd(), json)} (+ .md report)`);
  if (file.summary.errors === file.summary.runs) failedGate = true;
}
process.exit(failedGate ? 1 : 0);
