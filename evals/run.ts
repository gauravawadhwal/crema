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
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { makeProvider, PROVIDER_IDS } from "../server/llm/index.js";
import type { ProviderId } from "../server/llm/types.js";
import { EVALS_DIR, loadCases, TASKS, type ReviewCase, type TaskName } from "./lib/dataset.js";
import { consoleSummary, markdownReport, packResults, summarize, unpackResults, type ResultsFile } from "./lib/report.js";
import { SYSTEM_PROMPTS } from "./lib/recorder.js";
import { digest, makeEvalManifest, scorerFingerprint, sha256, verifyEvalManifest } from "./lib/manifest.js";
import { gradeRecord, legacyCaseDigests, rejudge, runCase, supports, type RunRecord, type Subject } from "./lib/tasks.js";

const { values: args } = parseArgs({
  options: {
    task: { type: "string", default: "all" },
    provider: { type: "string", default: "claude-cli" },
    model: { type: "string" },
    repeat: { type: "string", default: "1" },
    concurrency: { type: "string", default: "4" },
    filter: { type: "string" },
    split: { type: "string" },
    date: { type: "string" },
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
  --split dev|holdout   only one split (review defaults to dev)
  --date YYYY-MM-DD     pin the reference date for relative case inputs
  --live                include identify cases that need live web search
  --judge <provider[:model]>  add model-graded text checks (recommend, dialin)
  --label <text>        note stored with the results (e.g. "prompt v2")
  --out <dir>           where to write results (default evals/results)
  --regrade <file>      write a derived report from verified saved inputs and current labels
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

function parseSubject(spec: string, model?: string): { subject: Subject; name: string; provider: string; model: string | null; settings: string } {
  if (spec === "rules") return { subject: { kind: "rules" }, name: "rules", provider: "rules", model: null, settings: digest(["rules"]) };
  const [id, inlineModel] = spec.split(":");
  if (!PROVIDER_IDS.includes(id as ProviderId)) throw new Error(`unknown provider ${id}; expected ${PROVIDER_IDS.join(", ")} or rules`);
  const provider = makeProvider(id as ProviderId, { model: model ?? inlineModel });
  const effort = id === "codex-cli" ? process.env.CODEX_REASONING_EFFORT ?? null : null;
  return { subject: { kind: "llm", provider }, settings: digest([id, provider.model ?? null, effort]), name: provider.model ? `${id}:${provider.model}` : id, provider: id, model: provider.model ?? null };
}

function matches(task: TaskName, c: { id: string; tags: string[]; split: string; live?: boolean }) {
  if (c.live && !args.live) return false;
  const split = args.split ?? (task === "review" ? "dev" : undefined);
  if (split && c.split !== split) return false;
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
  writeFileSync(json, JSON.stringify(packResults(file), null, 1) + "\n", { flag: "wx" });
  writeFileSync(path.join(outDir, `${stem}.md`), markdownReport(file), { flag: "wx" });
  return json;
}

const outDir = path.resolve(args.out ?? path.join(EVALS_DIR, "results"));
const concurrency = Number(args.concurrency);
if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error("--concurrency must be a positive integer");

if (args.regrade) {
  const bytes = readFileSync(args.regrade);
  const file = unpackResults(JSON.parse(bytes.toString("utf8")) as ResultsFile);
  const parent = verifyEvalManifest(file.meta.manifest, file.records, file.meta.repeats);
  const cases = new Map(loadCases(file.meta.task).map(c => [c.id, c]));
  const records = file.records;
  const inputDate = new Date(file.meta.inputDate ?? "");
  if (!Number.isFinite(inputDate.getTime())) throw new Error("Missing parent input date");
  const caseDigests = parent.cases.map(old => {
    const c = cases.get(old.caseId);
    if (!c) throw new Error(`Cannot regrade missing case ${old.caseId}`);
    const next = legacyCaseDigests(file.meta.task, c, inputDate);
    if (old.inputDigest !== next.inputDigest || old.caseDigest !== next.caseDigest) throw new Error(`Case or input drift for ${old.caseId}`);
    return next;
  });
  const byId = new Map(parent.cases.map(c => [c.caseId, c]));
  for (const r of records) {
    if (digest({ split: r.split, tags: r.tags }) !== byId.get(r.caseId)?.caseDigest) {
      throw new Error(`Saved case metadata drift on ${r.caseId}`);
    }
    const requested = file.meta.provider === "rules" ? { kind: "rules" } as const : { kind: "llm", provider: file.meta.provider } as const;
    if (r.requested && digest(r.requested) !== digest(requested)) throw new Error(`Subject provenance conflict on ${r.caseId}`);
    r.requested = requested;
  }
  if (args.judge) {
    // Re-judge saved outputs: changes to the judge never need the model under test re-run.
    const j = parseSubject(args.judge);
    if (j.subject.kind !== "llm") throw new Error("--judge needs a model provider");
    const provider = j.subject.provider;
    await pool(records, concurrency, (r) => rejudge(file.meta.task, r, provider, file.meta.task === "review" ? cases.get(r.caseId) as ReviewCase : undefined));
    file.meta.judge = j.name;
    file.meta.judgeSettings = j.settings;
  }
  for (const r of records) r.grade = gradeRecord(file.meta.task, cases.get(r.caseId), r);
  for (const r of records) for (const call of [...r.calls, ...(r.judgeCalls ?? [])]) if (SYSTEM_PROMPTS.has(call.systemHash)) file.meta.prompts[call.systemHash] = SYSTEM_PROMPTS.get(call.systemHash)!;
  const regraded: ResultsFile = {
    meta: { ...file.meta, git: git(), manifest: makeEvalManifest(caseDigests, records, scorerFingerprint("legacy")),
      parentDigest: sha256(bytes), regradedAt: new Date().toISOString() },
    summary: summarize(file.meta.task, records),
    records,
  };
  const stem = `${path.basename(args.regrade, ".json")}-regrade-${randomUUID().slice(0, 8)}`;
  const derived = write(regraded, outDir, stem);
  console.log(consoleSummary(regraded));
  console.log(`Regraded ${records.length} runs into ${derived}`);
  process.exit(0);
}

const tasks: TaskName[] = args.task === "all" ? [...TASKS] : [args.task as TaskName];
for (const t of tasks) if (!TASKS.includes(t)) throw new Error(`unknown task ${t}`);
const { subject, name, provider, model, settings } = parseSubject(args.provider!, args.model);
const judge = args.judge ? parseSubject(args.judge) : null;
if (judge && judge.subject.kind !== "llm") throw new Error("--judge needs a model provider");
if (args.split && !["dev", "holdout"].includes(args.split)) throw new Error("--split must be dev or holdout");
const repeats = Number(args.repeat);
if (!Number.isSafeInteger(repeats) || repeats < 1) throw new Error("--repeat must be a positive integer");
const today = new Date();
const date = args.date ?? today.toISOString().slice(0, 10);
const inputDate = new Date(`${date}T00:00:00.000Z`);
if (!Number.isFinite(inputDate.getTime()) || inputDate.toISOString().slice(0, 10) !== date) throw new Error("--date must be YYYY-MM-DD");
const stamp = today.toISOString().replace(/[:.]/g, "-").slice(0, 19);

let failedGate = false;
for (const task of tasks) {
  if (!supports(task, subject)) {
    console.log(`skipping ${task}: ${name} can't do it`);
    continue;
  }
  const cases = loadCases(task).filter(c => matches(task, c));
  if (!cases.length) {
    console.log(`skipping ${task}: no cases match`);
    continue;
  }
  const jobs = cases.flatMap((c) => Array.from({ length: repeats }, (_, repeat) => ({ c, repeat })));
  const manifest = makeEvalManifest(cases.map(c => legacyCaseDigests(task, c, inputDate)),
    jobs.map(({ c, repeat }) => ({ caseId: c.id, repeat })), scorerFingerprint("legacy"));
  console.log(`\n${task}: ${cases.length} cases × ${repeats} on ${name}${judge ? `, judged by ${judge.name}` : ""}`);
  let done = 0;
  const records: RunRecord[] = await pool(jobs, concurrency, async ({ c, repeat }) => {
    const r = await runCase(task, c, subject, repeat, { today: inputDate, judge: judge?.subject.kind === "llm" ? judge.subject.provider : undefined });
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
  for (const r of records) for (const call of [...r.calls, ...(r.judgeCalls ?? [])]) if (SYSTEM_PROMPTS.has(call.systemHash)) prompts[call.systemHash] = SYSTEM_PROMPTS.get(call.systemHash)!;
  const file: ResultsFile = {
    meta: { task, subject: name, provider, model, judge: judge?.name ?? null, judgeSettings: judge?.settings ?? null, subjectSettings: settings, startedAt: today.toISOString(), git: git(), repeats, inputDate: inputDate.toISOString(), manifest, filter: args.filter ?? args.split ?? (task === "review" ? "dev" : null), prompts, label: args.label },
    summary: summarize(task, records),
    records,
  };
  const json = write(file, outDir, `${stamp}-${task}-${name.replace(/[^a-z0-9.-]+/gi, "_")}-${randomUUID().slice(0, 8)}`);
  console.log(`\n${consoleSummary(file)}\n  → ${path.relative(process.cwd(), json)} (+ .md report)`);
  if (file.summary.errors === file.summary.runs) failedGate = true;
}
process.exit(failedGate ? 1 : 0);
