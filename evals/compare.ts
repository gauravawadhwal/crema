/**
 * Compares eval results side by side, and gates on regressions.
 *
 *   npx tsx evals/compare.ts evals/baselines/recommend.claude-cli-opus.json evals/results/<new>.json
 *   npx tsx evals/compare.ts A.json B.json --fail-on-regression --tolerance 0.05
 *
 * With two files, the first is the reference: it also lists cases that newly
 * fail or pass, and how often the second agrees with the first's answers
 * (same profile, same move), which is the number to watch when replacing a big
 * model with a cheaper one.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { digest, slotKey, verifyEvalManifest } from "./lib/manifest.js";
import { answerSource } from "./lib/provenance.js";
import { HEADLINES, lowerIsBetter, summarize, type ResultsFile } from "./lib/report.js";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: { "fail-on-regression": { type: "boolean", default: false }, tolerance: { type: "string", default: "0.05" }, markdown: { type: "boolean", default: false }, "vary-subject": { type: "boolean" } },
});
if (positionals.length < 2) {
  console.error("usage: npx tsx evals/compare.ts <reference.json> <candidate.json> [more.json…] [--fail-on-regression] [--tolerance 0.05] [--vary-subject] [--markdown]");
  process.exit(2);
}
const files = positionals.map((p) => ({ name: path.basename(p, ".json"), f: JSON.parse(readFileSync(p, "utf8")) as ResultsFile }));
const task = files[0].f.meta.task;
if (files.some(x => x.f.meta.task !== task)) throw new Error("All files must be the same task");
if (!Object.hasOwn(HEADLINES, task)) throw new Error("Compare accepts legacy task reports. Ablation reports expose promotion eligibility separately.");
if (args["fail-on-regression"] && files.length !== 2) throw new Error("A gated comparison requires exactly two reports");
if (args["fail-on-regression"]) for (const { f } of files) f.summary = summarize(task, f.records);

const pct = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const money = (x: number | null) => (x == null ? "–" : `$${x.toFixed(4)}`);
const rows: [string, (f: ResultsFile) => string][] = [
  ["cases × repeats", (f) => `${f.summary.cases} × ${f.meta.repeats}`],
  ["pass rate", (f) => `${pct(f.summary.passRate)} (${pct(f.summary.passCI[0])}–${pct(f.summary.passCI[1])})`],
  ["passed every repeat", (f) => pct(f.summary.passAllRepeats)],
  ["mean score", (f) => f.summary.meanScore.toFixed(3)],
  ...Object.keys(files[0].f.summary.headline).map((k): [string, (f: ResultsFile) => string] => [k, (f) => pct(f.summary.headline[k])]),
  ["errors", (f) => `${f.summary.errors}`],
  ["latency p50 / p95", (f) => `${(f.summary.latencyMs.p50 / 1000).toFixed(1)} s / ${(f.summary.latencyMs.p95 / 1000).toFixed(1)} s`],
  ["cost per run", (f) => money(f.summary.cost.usdPerRun)],
  ["prompts", (f) => Object.keys(f.meta.prompts).join(" ") || "–"],
];

const header = ["", ...files.map((x) => x.f.meta.subject + (x.f.meta.label ? ` (${x.f.meta.label})` : ""))];
const table = [header, ...rows.map(([label, fn]) => [label, ...files.map((x) => fn(x.f))])];
if (args.markdown) {
  console.log(`| ${table[0].join(" | ")} |\n|${table[0].map(() => "---").join("|")}|`);
  for (const r of table.slice(1)) console.log(`| ${r.join(" | ")} |`);
} else {
  const w = table[0].map((_, i) => Math.max(...table.map((r) => r[i].length)));
  for (const r of table) console.log(r.map((c, i) => c.padEnd(w[i])).join("  "));
}

if (files.length !== 2) process.exit(0);

// ---------------------------------------------------------------- reference vs candidate

const [A, B] = files.map((x) => x.f);
const LABEL: Record<string, string> = { identify: "roastDate", recommend: "profile", dialin: "move", review: "move" };
type CaseStat = { passRate: number; label: string };
const perCase = (f: ResultsFile) => {
  const m = new Map<string, { pass: number; n: number; labels: string[] }>();
  for (const r of f.records) {
    const e = m.get(r.caseId) ?? { pass: 0, n: 0, labels: [] };
    e.n++;
    if (r.grade.pass) e.pass++;
    e.labels.push(String(r.grade.labels[LABEL[task]] ?? "∅"));
    m.set(r.caseId, e);
  }
  const mode = (xs: string[]) => [...xs].sort((a, b) => xs.filter((x) => x === b).length - xs.filter((x) => x === a).length)[0];
  return new Map([...m].map(([id, e]): [string, CaseStat] => [id, { passRate: e.pass / e.n, label: mode(e.labels) }]));
};
const a = perCase(A);
const b = perCase(B);
const shared = [...a.keys()].filter((id) => b.has(id));
const worse = shared.filter((id) => b.get(id)!.passRate < a.get(id)!.passRate);
const better = shared.filter((id) => b.get(id)!.passRate > a.get(id)!.passRate);
const agree = shared.filter((id) => a.get(id)!.label === b.get(id)!.label);

const bSlots = new Set(B.records.map(slotKey));
const aSlots = new Set(A.records.map(slotKey));
console.log(`\nUnpaired rows: ${A.records.filter(r => !bSlots.has(slotKey(r))).length} reference, ${B.records.filter(r => !aSlots.has(slotKey(r))).length} candidate.`);
console.log(`${shared.length} shared cases. Agreement on ${LABEL[task]}: ${pct(agree.length / (shared.length || 1))}`);
const show = (id: string) => `  ${id}: ${pct(a.get(id)!.passRate)} → ${pct(b.get(id)!.passRate)}  (${a.get(id)!.label} → ${b.get(id)!.label})`;
if (worse.length) console.log(`Worse in ${files[1].name} (${worse.length}):\n${worse.map(show).join("\n")}`);
if (better.length) console.log(`Better in ${files[1].name} (${better.length}):\n${better.map(show).join("\n")}`);
const disagreeButPass = shared.filter((id) => a.get(id)!.label !== b.get(id)!.label && b.get(id)!.passRate === 1);
if (disagreeButPass.length) console.log(`Different answer, still acceptable (${disagreeButPass.length}): ${disagreeButPass.join(", ")}`);

if (args["fail-on-regression"]) {
  const tol = args.tolerance?.trim() ? Number(args.tolerance) : NaN;
  if (!Number.isFinite(tol) || tol < 0 || tol > 1) throw new Error("Tolerance must be a number from 0 to 1");
  const am = verifyEvalManifest(A.meta.manifest, A.records, A.meta.repeats);
  const bm = verifyEvalManifest(B.meta.manifest, B.records, B.meta.repeats);
  if (am.scorer !== bm.scorer) throw new Error("Scorer fingerprint drift");
  if (am.digest !== bm.digest) throw new Error("Case, input, label or repeat manifest drift");
  if (A.meta.judge !== B.meta.judge || A.meta.judgeSettings !== B.meta.judgeSettings ||
      [A, B].some(f => f.meta.judge ? !f.meta.judgeSettings : f.meta.judgeSettings !== null)) throw new Error("Judge settings drift");
  if ([A, B].some(f => !f.meta.subjectSettings)) throw new Error("Missing subject settings digest");
  const subjectSettings = (f: ResultsFile) => [f.meta.provider, f.meta.model, f.meta.subject, f.meta.subjectSettings];
  if (!args["vary-subject"] && digest(subjectSettings(A)) !== digest(subjectSettings(B))) {
    throw new Error("Subject settings drift. Use --vary-subject when changing the subject is the intended comparison.");
  }
  if (task === "review" && [A, B].some(f => f.meta.provider !== "rules" && !f.meta.judge)) {
    throw new Error("Model review comparisons require independent judge coverage");
  }
  const checks = new Set([...Object.keys(A.summary.checks), ...Object.keys(B.summary.checks)]);
  for (const key of [...checks].sort()) {
    console.log(`Coverage ${key}: ${A.summary.checks[key]?.n ?? 0}/${A.records.length} → ${B.summary.checks[key]?.n ?? 0}/${B.records.length}`);
  }
  const required = new Set(Object.values(HEADLINES[task]).map(key => key.replace(/^!/, "")).filter(key => checks.has(key)));
  required.delete("usefulExperiment"); // Diagnostic, applicable only when the answer proposes a change.
  const judgeCheckNames = task === "review"
    ? ["judge.numericEvidence", "judge.causalRestraint", "judge.tasteGrounding", "judge.adviceAlignment",
      "judge.specificity", "judge.actionable", "judge.plainLanguage", "judge.quality"]
    : ["judge.quality"];
  const cases = new Map(am.cases.map(c => [c.caseId, c]));
  const candidate = new Map(B.records.map(r => [slotKey(r), r]));
  for (const record of A.records) {
    const other = candidate.get(slotKey(record))!;
    const id = slotKey(record);
    const c = cases.get(record.caseId)!;
    for (const [report, row] of [[A, record], [B, other]] as const) {
      if (digest({ split: row.split, tags: row.tags }) !== c.caseDigest) throw new Error(`Case metadata drift at ${id}`);
      const requested = report.meta.provider === "rules" ? { kind: "rules" } as const : { kind: "llm", provider: report.meta.provider } as const;
      const source = answerSource(task, row.calls, row.context, requested);
      if (row.error || source !== row.answerSource || source !== (requested.kind === "rules" ? "rules" : "model")) {
        throw new Error(`Missing gradable answer at ${id}`);
      }
      if (report.meta.judge && task !== "identify" &&
          (row.judgeStatus !== "assessed" || !row.judgeCalls?.some(call => call.error === undefined && call.schemaName === (task === "review" ? "ReviewJudgeVerdict" : "JudgeVerdict")) ||
           task === "review" && !row.judgeProvenance)) {
        throw new Error(`Missing judge coverage at ${id}`);
      }
      const needed = c.requiredChecks ? [...c.requiredChecks] : [];
      if (!c.requiredChecks?.length) throw new Error(`Missing required metric declaration at ${id}`);
      if (report.meta.provider !== "rules" && task !== "identify") needed.push("modelAnswered");
      if (report.meta.provider !== "rules" && task === "recommend") needed.push("validChoice");
      if (report.meta.judge && task !== "identify") needed.push("judge.noContradictions", "judge.noInventedFigures", ...judgeCheckNames);
      const present = row.grade.checks.map(check => check.name);
      if (new Set(present).size !== present.length || needed.some(name => !present.includes(name))) {
        throw new Error(`Missing or duplicate required metric at ${id}`);
      }
    }
    if (digest(record.judgeProvenance) !== digest(other.judgeProvenance)) throw new Error(`Judge evidence or rubric drift at ${id}`);
    const names = (row: typeof record) => row.grade.checks.filter(c => required.has(c.name) || c.critical && c.name !== "validChoice").map(c => c.name).sort();
    if (digest(names(record)) !== digest(names(other))) throw new Error(`Required metric coverage changed at ${id}`);
  }
  const drops: string[] = [];
  const passRate = (f: ResultsFile) => f.records.filter(r => r.grade.pass).length / f.records.length;
  if (passRate(B) < passRate(A) - tol) drops.push(`pass rate ${pct(A.summary.passRate)} → ${pct(B.summary.passRate)}`);
  for (const [label, raw] of Object.entries(HEADLINES[task])) {
    if (raw === "usefulExperiment") continue;
    const key = raw.replace(/^!/, "");
    const a = A.summary.checks[key];
    const b = B.summary.checks[key];
    if (!a || !b) continue; // Required coverage was checked on every slot above.
    const lower = lowerIsBetter(task, label);
    const va = lower ? (a.n - a.pass) / a.n : a.pass / a.n;
    const vb = lower ? (b.n - b.pass) / b.n : b.pass / b.n;
    if (lower ? vb > va + tol : vb < va - tol) drops.push(`${label} ${pct(va)} → ${pct(vb)}`);
  }
  if (drops.length) {
    console.log(`\nREGRESSION (tolerance ${pct(tol)}): ${drops.join("; ")}`);
    process.exit(1);
  }
  console.log(`\nNo regression beyond ${pct(tol)}.`);
}
