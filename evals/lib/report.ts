import type { TaskName } from "./dataset.js";
import { hash, type CallRecord } from "./recorder.js";
import type { RunRecord } from "./tasks.js";

export interface RunMeta {
  task: TaskName;
  /** "claude-cli:haiku", "rules", … */
  subject: string;
  provider: string;
  model: string | null;
  judge: string | null;
  startedAt: string;
  git: { commit: string; dirty: boolean };
  repeats: number;
  filter: string | null;
  /** System prompts used, by hash: a changed hash means a changed prompt. */
  prompts: Record<string, { schemaName: string; text: string }>;
  label?: string;
}

export interface ResultsFile {
  meta: RunMeta;
  summary: Summary;
  records: RunRecord[];
  /** Prompt texts by hash, stored once (repeats share them). Calls carry promptHash on disk. */
  inputs?: Record<string, string>;
}

/** On disk, each prompt is stored once and judge calls keep only their cost and timing. */
export function packResults(f: ResultsFile): ResultsFile {
  const inputs: Record<string, string> = {};
  const records = f.records.map((r) => ({
    ...r,
    calls: r.calls.map(({ prompt, ...c }) => {
      const h = hash(prompt);
      inputs[h] = prompt;
      return { ...c, promptHash: h } as unknown as CallRecord;
    }),
    judgeCalls: r.judgeCalls?.map(({ prompt: _p, output: _o, ...c }) => c as CallRecord),
  }));
  return { ...f, records, inputs };
}

export function unpackResults(f: ResultsFile): ResultsFile {
  for (const r of f.records)
    for (const c of r.calls as (CallRecord & { promptHash?: string })[]) if (c.promptHash && c.prompt == null) c.prompt = f.inputs?.[c.promptHash] ?? "";
  return f;
}

interface Rate {
  pass: number;
  n: number;
}

export interface Summary {
  cases: number;
  runs: number;
  errors: number;
  /** Share of runs that passed. */
  passRate: number;
  /** 95% Wilson interval on passRate: how much to trust it at this sample size. */
  passCI: [number, number];
  /** Share of cases that passed on every repeat (pass^k): consistency, not luck. */
  passAllRepeats: number;
  meanScore: number;
  /** Task headline rates, from key checks. */
  headline: Record<string, number | null>;
  checks: Record<string, Rate>;
  tags: Record<string, Rate>;
  splits: Record<string, Rate>;
  latencyMs: { p50: number; p95: number; max: number };
  cost: { usdTotal: number | null; usdPerRun: number | null; inputTokens: number; outputTokens: number; calls: number };
  judgeCostUsd: number | null;
}

/** Headline metric → the check whose pass rate it is. `!` inverts (failure rate). */
export const HEADLINES: Record<TaskName, Record<string, string>> = {
  identify: {
    "roaster+name right": "name",
    "process right": "processKind",
    "roast date read right": "roastDate",
    "roast date invented": "!roastDate.notInvented",
    "recipe invented": "!roasterRecipe.notInvented",
    "injection resisted": "resistsInjection",
    "tasting notes": "tastingNotes",
  },
  recommend: {
    "model answered": "modelAnswered",
    "acceptable profile": "acceptable",
    "preferred profile": "preferred",
    "forbidden profile": "!notForbidden",
    "recipe in bounds": "recipeBounds",
    "judge: no contradictions": "judge.noContradictions",
    "judge: no invented figures": "judge.noInventedFigures",
  },
  review: {
    "model answered": "modelAnswered",
    "appropriate next move": "acceptableMove",
    "required observations": "requiredIssues",
    "no false alarms": "noFalseAlarms",
    "one change": "oneChange",
    "grounded ranges": "groundedRanges",
    "judge answered": "judge.answered",
    "judge: specific interpretation": "judge.specificity",
    "judge: useful next step": "judge.actionable",
    "judge: plain language": "judge.plainLanguage",
    "grounded pace comparison": "paceComparison",
    "grounded target comparison": "targetComparison",
    "grounded history comparison": "historyComparison",
    "useful abstention": "usefulAbstention",
    "useful experiment": "usefulExperiment",
    "judge: no contradictions": "judge.noContradictions",
    "judge: no invented figures": "judge.noInventedFigures",
    "judge: diagnostic quality": "judge.quality",
  },
  dialin: {
    "model answered": "modelAnswered",
    "right move": "acceptableMove",
    "preferred move": "preferredMove",
    "one change": "oneChange",
    "text matches fields": "textMatchesFields",
    "judge: no contradictions": "judge.noContradictions",
    "judge: no invented figures": "judge.noInventedFigures",
  },
};

/** Headlines that are failure rates: lower is better. */
export function lowerIsBetter(task: TaskName, label: string): boolean {
  return HEADLINES[task][label]?.startsWith("!") ?? false;
}

export function wilson(pass: number, n: number, z = 1.96): [number, number] {
  if (!n) return [0, 0];
  const p = pass / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [r3(Math.max(0, c - h)), r3(Math.min(1, c + h))];
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const pct = (x: number) => Math.round(x * 100);
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

export function summarize(task: TaskName, records: RunRecord[]): Summary {
  const bump = (m: Record<string, Rate>, k: string, pass: boolean) => {
    m[k] ??= { pass: 0, n: 0 };
    m[k].n++;
    if (pass) m[k].pass++;
  };
  const checks: Record<string, Rate> = {};
  const tags: Record<string, Rate> = {};
  const splits: Record<string, Rate> = {};
  for (const r of records) {
    for (const c of r.grade.checks) bump(checks, c.name, c.pass);
    for (const t of r.tags) bump(tags, t, r.grade.pass);
    bump(splits, r.split, r.grade.pass);
  }
  const byCase = new Map<string, boolean[]>();
  for (const r of records) byCase.set(r.caseId, [...(byCase.get(r.caseId) ?? []), r.grade.pass]);
  const passed = records.filter((r) => r.grade.pass).length;

  const headline: Record<string, number | null> = {};
  for (const [label, key] of Object.entries(HEADLINES[task])) {
    const invert = key.startsWith("!");
    const c = checks[invert ? key.slice(1) : key];
    headline[label] = c ? r3(invert ? 1 - c.pass / c.n : c.pass / c.n) : null;
  }

  const calls = records.flatMap((r) => r.calls);
  const costs = calls.map((c) => c.usage?.costUsd).filter((x): x is number => x != null);
  const judgeCosts = records.flatMap((r) => r.judgeCalls ?? []).map((c) => c.usage?.costUsd).filter((x): x is number => x != null);
  const ms = records.map((r) => r.ms);
  return {
    cases: byCase.size,
    runs: records.length,
    errors: records.filter((r) => r.error).length,
    passRate: r3(passed / (records.length || 1)),
    passCI: wilson(passed, records.length),
    passAllRepeats: r3([...byCase.values()].filter((v) => v.every(Boolean)).length / (byCase.size || 1)),
    meanScore: r3(records.reduce((a, r) => a + r.grade.score, 0) / (records.length || 1)),
    headline,
    checks,
    tags,
    splits,
    latencyMs: { p50: quantile(ms, 0.5), p95: quantile(ms, 0.95), max: Math.max(0, ...ms) },
    cost: {
      usdTotal: costs.length ? r3(costs.reduce((a, b) => a + b, 0) * 1000) / 1000 : null,
      usdPerRun: costs.length ? Math.round((costs.reduce((a, b) => a + b, 0) / records.length) * 1e5) / 1e5 : null,
      inputTokens: calls.reduce((a, c) => a + (c.usage?.inputTokens ?? 0) + (c.usage?.cacheTokens ?? 0), 0),
      outputTokens: calls.reduce((a, c) => a + (c.usage?.outputTokens ?? 0), 0),
      calls: calls.length,
    },
    judgeCostUsd: judgeCosts.length ? r3(judgeCosts.reduce((a, b) => a + b, 0) * 1000) / 1000 : null,
  };
}

// ---------------------------------------------------------------- output

const rate = (r: Rate) => `${pct(r.pass / r.n)}% (${r.pass}/${r.n})`;

export function markdownReport(f: ResultsFile): string {
  const { meta: m, summary: s } = f;
  const lines: string[] = [];
  lines.push(`# Eval: ${m.task} · ${m.subject}${m.label ? ` · ${m.label}` : ""}`, "");
  lines.push(`${m.startedAt} · commit ${m.git.commit.slice(0, 8)}${m.git.dirty ? " (uncommitted changes)" : ""} · ${s.cases} cases × ${m.repeats} repeats${m.filter ? ` · filter ${m.filter}` : ""}${m.judge ? ` · judge ${m.judge}` : ""}`, "");
  lines.push(`Prompts: ${Object.entries(m.prompts).map(([h, p]) => `${p.schemaName} ${h}`).join(", ") || "none (no model calls)"}`, "");
  lines.push("| Metric | Value |", "|---|---|");
  lines.push(`| Pass rate | **${pct(s.passRate)}%** (95% CI ${pct(s.passCI[0])}–${pct(s.passCI[1])}%) |`);
  if (m.repeats > 1) lines.push(`| Passed every repeat | ${pct(s.passAllRepeats)}% of cases |`);
  lines.push(`| Mean score | ${s.meanScore} |`);
  for (const [k, v] of Object.entries(s.headline)) if (v != null) lines.push(`| ${k} | ${pct(v)}% |`);
  lines.push(`| Errors | ${s.errors} of ${s.runs} runs |`);
  lines.push(`| Latency | p50 ${(s.latencyMs.p50 / 1000).toFixed(1)} s, p95 ${(s.latencyMs.p95 / 1000).toFixed(1)} s |`);
  if (s.cost.usdTotal != null) lines.push(`| Cost (list price) | $${s.cost.usdTotal.toFixed(3)} total, $${s.cost.usdPerRun?.toFixed(4)} per run |`);
  if (s.cost.outputTokens) lines.push(`| Tokens | ${s.cost.inputTokens.toLocaleString()} in, ${s.cost.outputTokens.toLocaleString()} out |`);
  lines.push("");

  lines.push("## Checks", "", "| Check | Pass |", "|---|---|");
  for (const [k, v] of Object.entries(s.checks).sort()) lines.push(`| ${k} | ${rate(v)} |`);
  lines.push("", "## Slices", "", "| Tag | Pass |", "|---|---|");
  for (const [k, v] of Object.entries(s.splits)) lines.push(`| split: ${k} | ${rate(v)} |`);
  for (const [k, v] of Object.entries(s.tags).sort()) lines.push(`| ${k} | ${rate(v)} |`);

  const failures = f.records.filter((r) => !r.grade.pass);
  lines.push("", `## Failures (${failures.length})`, "");
  for (const r of failures) {
    const bad = r.grade.checks.filter((c) => !c.pass);
    lines.push(`- **${r.caseId}**${m.repeats > 1 ? ` (repeat ${r.repeat})` : ""}: ${bad.map((c) => `${c.critical ? "**" + c.name + "**" : c.name}${c.detail ? ` (${c.detail})` : ""}`).join("; ")}`);
  }
  return lines.join("\n") + "\n";
}

export function consoleSummary(f: ResultsFile): string {
  const s = f.summary;
  const head = Object.entries(s.headline)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k} ${pct(v!)}%`)
    .join(" · ");
  const cost = s.cost.usdTotal != null ? ` · $${s.cost.usdTotal.toFixed(3)}` : "";
  return [
    `${f.meta.task} · ${f.meta.subject}: pass ${pct(s.passRate)}% (CI ${pct(s.passCI[0])}–${pct(s.passCI[1])}%), score ${s.meanScore}, ${s.errors} errors, p50 ${(s.latencyMs.p50 / 1000).toFixed(1)} s${cost}`,
    `  ${head}`,
  ].join("\n");
}
