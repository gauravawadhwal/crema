import type { runReviewAblation } from "./review-ablation.js";

export interface ReviewAblationReport {
  meta: {
    task: "review-ablation";
    dataset: string;
    demonstration: boolean;
    split: "dev" | "holdout";
    purpose: "tune" | "evaluate";
    provider: string;
    startedAt: string;
    git: { commit: string; dirty: boolean };
    holdoutRunCount?: number;
  };
  variants: Awaited<ReturnType<typeof runReviewAblation>>;
}

const pct = (n: number | null) => n == null ? "—" : `${(n * 100).toFixed(1)}%`;
const num = (n: number | null) => n == null ? "—" : n.toFixed(2);
const cell = (s: string) => s.replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");

export function reviewAblationMarkdown({ meta, variants }: ReviewAblationReport): string {
  const lines = [
    "# Shot review ablation", "",
    `${meta.dataset} · ${meta.split} · ${meta.purpose} · ${meta.provider} · ${meta.startedAt}`,
    `Commit \`${meta.git.commit}\`${meta.git.dirty ? " (dirty)" : ""}`, "",
  ];
  if (meta.demonstration) lines.push("Demonstration fixtures only.", "");
  if (meta.holdoutRunCount !== undefined) lines.push(`Holdout attempts logged as of this run · ${meta.holdoutRunCount}`, "");
  for (const variant of variants) {
    lines.push(`## ${variant.name}`, "");
    if (variant.status === "pending") {
      lines.push(variant.reason, "");
      continue;
    }
    const sections = [{ family: "All profile families", metrics: variant.summary, prompt: variant.prompt }, ...variant.families];
    if (variant.labelSources.length > 1 || (variant.labelSources.length === 1 && variant.summary.labelled !== variant.summary.runs)) {
      sections.push(...variant.labelSources.map(({ source, metrics, prompt }) => ({ family: source, metrics, prompt })));
    }
    for (const { family, metrics: m, prompt } of sections) {
      lines.push(
        `### ${cell(family)}`, "",
        `${m.runs} runs · ${m.labelled} labelled · ${m.unscoredEvents} unscored predictions · ${m.forbiddenFindingHits} forbidden finding hits`, "",
        "| Event kind | TP | FP | FN | Precision | Recall | Onset MAE (s, n) | Peak MAE (s, n) |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
        ...m.byKind.map((r) => `| ${cell(r.kind)} | ${r.tp} | ${r.fp} | ${r.fn} | ${pct(r.precision)} | ${pct(r.recall)} | ${num(r.onsetMaeS)} (${r.onsetN}) | ${num(r.peakMaeS)} (${r.peakN}) |`),
        "",
        "| Pump mode | False alarms | Mechanically labelled cases | Per case |",
        "|---|---:|---:|---:|",
        ...m.falseAlarmsByPump.map((r) => `| ${r.pumpMode} | ${r.falseAlarms} | ${r.cases} | ${num(r.perCase)} |`),
        "",
        `- Justified abstention ${m.abstention.justified}/${m.abstention.opportunities}, with ${m.abstention.unjustified} unjustified abstentions`,
        `- Supported outcomes ${m.supportedOutcomes.passed}/${m.supportedOutcomes.total}`,
        `- Numeric consistency ${m.numericConsistency.passed}/${m.numericConsistency.total}`,
        `- Forbidden claims ${m.forbiddenClaims.violations} detected, ${m.forbiddenClaims.unassessed} unassessed`,
        `- Input/output tokens ${m.tokens.input}/${m.tokens.output} across ${m.tokens.reportedRuns}/${m.runs} runs with usage`,
        `- End-to-end latency p50/p95 ${num(m.latencyMs.p50)}/${num(m.latencyMs.p95)} ms`,
        `- Fallback rate ${pct(m.fallbackRate)}`,
        ...(prompt.runs ? [
          `- Mean prompt size ${num(prompt.curveChars)} chars of curve, ${num(prompt.promptChars)} chars in total, across ${prompt.runs} runs`,
          `- Landmarks visible to the model ${prompt.landmarks.map((l) => `${l.kind} ${l.kept}/${l.total}`).join(", ")}`,
        ] : []), "",
      );
    }
  }
  return lines.join("\n");
}
