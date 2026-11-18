import { ProviderChain } from "../../server/llm/index.js";
import type { LlmProvider } from "../../server/llm/types.js";
import { reviewShot } from "../../server/recommend/review.js";
import { rulesReview } from "../../server/recommend/review-local.js";
import type { ReviewInput, ShotReviewData } from "../../server/recommend/review-types.js";
import { RecordingProvider } from "./recorder.js";
import type { PumpMode, ReviewLabels } from "./review-labels.js";
import { scoreReview, summarizeReviewMetrics, type ReviewEvalOutput, type ReviewMetricRow } from "./review-metrics.js";

export interface ReviewEvalCase {
  id: string;
  input: ReviewInput;
  profileFamily: string;
  pumpMode: PumpMode;
  labels?: ReviewLabels;
  sampleTimes?: number[];
}

interface VariantOutput {
  scored: ReviewEvalOutput;
  review: ShotReviewData;
  source: string;
  fellBack: boolean;
}

type Variant =
  | { status: "ready"; run: (input: ReviewInput, llm: ProviderChain | null) => Promise<VariantOutput> }
  | { status: "pending"; reason: string };

export const VARIANT_NAMES = ["old", "facts-only", "facts-plus-anchored", "two-stage"] as const;
export type VariantName = typeof VARIANT_NAMES[number];

export function normalizeLegacyReview(review: ShotReviewData, input: ReviewInput): ReviewEvalOutput {
  const outcomes: ReviewEvalOutput["outcomes"] = [];
  const advice = review.nextShot;
  if (advice?.grindDelta.endsWith("finer")) outcomes.push("grind-finer");
  if (advice?.grindDelta.endsWith("coarser")) outcomes.push("grind-coarser");
  if (advice && Math.abs(advice.yieldDeltaG) > 0.01) outcomes.push("change-yield");
  if (advice && Math.abs(advice.tempDeltaC) > 0.01) outcomes.push("change-temperature");
  if (advice?.switchProfile != null) outcomes.push("switch-profile");

  const figures: ReviewEvalOutput["figures"] = [];
  const events = review.issues.map<ReviewEvalOutput["events"][number]>((issue) => {
    const point = input.points.find((p) => p.t === issue.fromS);
    const step = point?.frame == null ? undefined : input.profile?.steps?.[point.frame];
    const pump = step?.pump?.toLowerCase();
    const controlledVariable = pump === "pressure" || pump === "flow" ? pump : undefined;

    // Only decode numbers from the legacy code-authored evidence template.
    // A quantity mentioned in free prose does not establish its role or unit.
    if (issue.kind === "pressure_shortfall" || issue.kind === "flow_shortfall") {
      const match = /\bin frame (\d+): target ([\d.]+) (bar|ml\/s), measured ([\d.]+) \3(?: \(peak ([\d.]+) \3\))?/.exec(issue.evidence);
      if (match) {
        const [, frame, target, unit, measured, peak] = match;
        const prefix = `${issue.kind}.frame-${frame}`;
        figures.push({ id: `${prefix}.target`, unit, value: Number(target) },
          { id: `${prefix}.measured`, unit, value: Number(measured) });
        if (peak !== undefined) figures.push({ id: `${prefix}.peak`, unit, value: Number(peak) });
      }
    }
    return { kind: issue.kind, phase: point?.substate ?? undefined, controlledVariable, onsetS: issue.fromS ?? undefined };
  });
  return { events, figures, outcomes, claims: { "multiple-next-shot-changes": outcomes.length > 1 } };
}

const pending: Variant = { status: "pending", reason: "not implemented yet" };
export const REVIEW_VARIANTS: Readonly<Record<VariantName, Variant>> = {
  old: {
    status: "ready",
    async run(input, llm) {
      const { review, source } = llm ? await reviewShot(llm, input) : { review: rulesReview(input), source: "rules" };
      return { review, source, scored: normalizeLegacyReview(review, input), fellBack: llm != null && source === "rules" };
    },
  },
  "facts-only": pending,
  "facts-plus-anchored": pending,
  "two-stage": pending,
};

export async function runReviewVariant(name: VariantName, input: ReviewInput, provider?: LlmProvider) {
  const variant = REVIEW_VARIANTS[name];
  if (variant.status === "pending") return variant;
  const recorder = provider ? new RecordingProvider(provider) : undefined;
  const started = performance.now();
  const result = await variant.run(input, recorder ? new ProviderChain([recorder]) : null);
  const ms = performance.now() - started;
  const calls = recorder?.calls ?? [];
  let tokens: ReviewMetricRow["tokens"] = { input: 0, output: 0 };
  for (const { usage } of calls) {
    if (usage?.inputTokens == null || usage.outputTokens == null) {
      tokens = null;
      break;
    }
    tokens.input += usage.inputTokens;
    tokens.output += usage.outputTokens;
  }
  return { status: "ready" as const, ...result, ms, tokens, promptHashes: [...new Set(calls.map((c) => c.systemHash))] };
}

interface AblationRecord extends ReviewMetricRow {
  caseId: string;
  profileFamily: string;
  source: string;
  labelSource?: ReviewLabels["source"];
  promptHashes: string[];
}

export async function runReviewAblation(cases: readonly ReviewEvalCase[], names: readonly VariantName[], provider?: LlmProvider) {
  const results = [];
  for (const name of names) {
    const variant = REVIEW_VARIANTS[name];
    if (variant.status === "pending") {
      results.push({ name, ...variant });
      continue;
    }
    const records: AblationRecord[] = [];
    for (const c of cases) {
      const result = await runReviewVariant(name, structuredClone(c.input), provider);
      if (result.status !== "ready") throw new Error(`Variant ${name}: ${result.reason}`);
      const { ms, tokens, fellBack, scored, source, promptHashes } = result;
      const score = c.labels && scoreReview(c.labels, scored, c.sampleTimes ?? c.input.points.map((p) => p.t));
      records.push({ caseId: c.id, profileFamily: c.profileFamily, pumpMode: c.pumpMode, ms, tokens, fellBack, score, source, labelSource: c.labels?.source, promptHashes });
    }
    const families = Array.from(new Set(records.map((r) => r.profileFamily)), (family) => ({
      family, metrics: summarizeReviewMetrics(records.filter((r) => r.profileFamily === family)),
    }));
    const labelSources = Array.from(new Set(records.flatMap((r) => r.labelSource ? [r.labelSource] : [])), (source) => ({
      source, metrics: summarizeReviewMetrics(records.filter((r) => r.labelSource === source)),
    }));
    results.push({ name, status: "ready" as const, summary: summarizeReviewMetrics(records), families, labelSources, records });
  }
  return results;
}
