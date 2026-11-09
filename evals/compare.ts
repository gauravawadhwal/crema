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
import { lowerIsBetter, type ResultsFile } from "./lib/report.js";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: { "fail-on-regression": { type: "boolean", default: false }, tolerance: { type: "string", default: "0.05" }, markdown: { type: "boolean", default: false } },
});
if (positionals.length < 2) {
  console.error("usage: npx tsx evals/compare.ts <reference.json> <candidate.json> [more.json…] [--fail-on-regression] [--tolerance 0.05] [--markdown]");
  process.exit(2);
}
const files = positionals.map((p) => ({ name: path.basename(p, ".json"), f: JSON.parse(readFileSync(p, "utf8")) as ResultsFile }));
const task = files[0].f.meta.task;
if (files.some((x) => x.f.meta.task !== task)) throw new Error("all files must be the same task");

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

console.log(`\n${shared.length} shared cases. Agreement on ${LABEL[task]}: ${pct(agree.length / (shared.length || 1))}`);
const show = (id: string) => `  ${id}: ${pct(a.get(id)!.passRate)} → ${pct(b.get(id)!.passRate)}  (${a.get(id)!.label} → ${b.get(id)!.label})`;
if (worse.length) console.log(`Worse in ${files[1].name} (${worse.length}):\n${worse.map(show).join("\n")}`);
if (better.length) console.log(`Better in ${files[1].name} (${better.length}):\n${better.map(show).join("\n")}`);
const disagreeButPass = shared.filter((id) => a.get(id)!.label !== b.get(id)!.label && b.get(id)!.passRate === 1);
if (disagreeButPass.length) console.log(`Different answer, still acceptable (${disagreeButPass.length}): ${disagreeButPass.join(", ")}`);

if (args["fail-on-regression"]) {
  const tol = Number(args.tolerance);
  const drops: string[] = [];
  if (B.summary.passRate < A.summary.passRate - tol) drops.push(`pass rate ${pct(A.summary.passRate)} → ${pct(B.summary.passRate)}`);
  for (const [k, va] of Object.entries(A.summary.headline)) {
    const vb = B.summary.headline[k];
    if (va == null || vb == null) continue;
    // Failure-rate headlines ("roast date invented", "forbidden profile") regress when they go up.
    if (lowerIsBetter(task, k) ? vb > va + tol : vb < va - tol) drops.push(`${k} ${pct(va)} → ${pct(vb)}`);
  }
  if (drops.length) {
    console.log(`\nREGRESSION (tolerance ${pct(tol)}): ${drops.join("; ")}`);
    process.exit(1);
  }
  console.log(`\nNo regression beyond ${pct(tol)}.`);
}
