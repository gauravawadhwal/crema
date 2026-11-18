import { ProviderChain } from "../../server/llm/index.js";
import { MockProvider } from "../../server/llm/mock.js";
import { analyzeShot } from "../../server/profiles/analysis.js";
import type { PhaseLandmark } from "../../server/profiles/phase-evidence.js";
import { reviewCurveSection } from "../../server/recommend/review-curve.js";
import type { LlmProvider } from "../../server/llm/types.js";
import { reviewShot } from "../../server/recommend/review.js";
import { rulesReview } from "../../server/recommend/review-local.js";
import type { ReviewInput, ShotReviewData } from "../../server/recommend/review-types.js";
import { RecordingProvider } from "./recorder.js";
import { legacyReviewCurveSection } from "./review-legacy-curve.js";
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
function curveVariant(curveSection?: typeof legacyReviewCurveSection): Variant {
  return {
    status: "ready",
    async run(input, llm) {
      const { review, source } = llm ? await reviewShot(llm, input, { curveSection }) : { review: rulesReview(input), source: "rules" };
      return { review, source, scored: normalizeLegacyReview(review, input), fellBack: llm != null && source === "rules" };
    },
  };
}

export const REVIEW_VARIANTS: Readonly<Record<VariantName, Variant>> = {
  old: curveVariant(legacyReviewCurveSection),
  "facts-only": pending,
  "facts-plus-anchored": curveVariant(),
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

const MEASURED_LANDMARKS = ["first_sustained_beverage", "brew_pressure_crest", "phase_boundary", "stop", "recording_end"] as const;
type LandmarkCounts = Record<typeof MEASURED_LANDMARKS[number], { kept: number; total: number }>;
export interface PromptMeasure { curveChars: number; promptChars: number; landmarks: LandmarkCounts }

const CURVE_SECTIONS: Partial<Record<VariantName, (input: ReviewInput, landmarks: PhaseLandmark[]) => string>> = {
  old: (input) => legacyReviewCurveSection(input.points),
  "facts-plus-anchored": (input, landmarks) => reviewCurveSection(input.points, landmarks),
};

/** Times the model can see in the curve section: every row, and every reading carried by an event. */
function visibleTimes(section: string) {
  const parsed = JSON.parse(section.split("\n")[1]);
  if (Array.isArray(parsed)) return new Set<number>(parsed.map((p: { t: number }) => p.t));
  const times = new Set<number>(parsed.rows.map((row: number[]) => row[0]));
  for (const event of parsed.events) {
    for (const key of ["before", "at", "after", "confirmed"]) if (event[key]) times.add(event[key][0]);
  }
  return times;
}

/** Token-free size and landmark retention for one variant on one recording. */
export async function measurePrompt(name: VariantName, input: ReviewInput): Promise<PromptMeasure | null> {
  const section = CURVE_SECTIONS[name];
  if (!section) return null;
  const landmarks: PhaseLandmark[] = [];
  analyzeShot(input, landmarks);
  const curve = section(input, landmarks);
  const seen = visibleTimes(curve);
  const recorder = new RecordingProvider(new MockProvider());
  await reviewShot(new ProviderChain([recorder]), structuredClone(input), { curveSection: name === "old" ? () => curve : undefined });
  const counts = Object.fromEntries(MEASURED_LANDMARKS.map((kind) => [kind, { kept: 0, total: 0 }])) as LandmarkCounts;
  for (const landmark of landmarks) {
    if (!(landmark.kind in counts)) continue;
    const bucket = counts[landmark.kind as keyof LandmarkCounts];
    const readings = [landmark.before, landmark.at, landmark.after, landmark.confirmed].filter((p) => p != null);
    bucket.total++;
    if (readings.every((p) => seen.has(p.t))) bucket.kept++;
  }
  return { curveChars: curve.length, promptChars: recorder.calls[0]?.prompt.length ?? 0, landmarks: counts };
}

export function summarizePrompt(records: { prompt: PromptMeasure | null }[]) {
  const measured = records.flatMap((r) => r.prompt ? [r.prompt] : []);
  const mean = (pick: (m: PromptMeasure) => number) => measured.length ? measured.reduce((n, m) => n + pick(m), 0) / measured.length : null;
  return {
    runs: measured.length, curveChars: mean((m) => m.curveChars), promptChars: mean((m) => m.promptChars),
    landmarks: MEASURED_LANDMARKS.map((kind) => ({
      kind, kept: measured.reduce((n, m) => n + m.landmarks[kind].kept, 0), total: measured.reduce((n, m) => n + m.landmarks[kind].total, 0),
    })),
  };
}

interface AblationRecord extends ReviewMetricRow {
  prompt: PromptMeasure | null;
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
      records.push({ prompt: await measurePrompt(name, c.input), caseId: c.id, profileFamily: c.profileFamily, pumpMode: c.pumpMode, ms, tokens, fellBack, score, source, labelSource: c.labels?.source, promptHashes });
    }
    const families = Array.from(new Set(records.map((r) => r.profileFamily)), (family) => ({
      family, metrics: summarizeReviewMetrics(records.filter((r) => r.profileFamily === family)),
      prompt: summarizePrompt(records.filter((r) => r.profileFamily === family)),
    }));
    const labelSources = Array.from(new Set(records.flatMap((r) => r.labelSource ? [r.labelSource] : [])), (source) => ({
      source, metrics: summarizeReviewMetrics(records.filter((r) => r.labelSource === source)),
      prompt: summarizePrompt(records.filter((r) => r.labelSource === source)),
    }));
    results.push({ name, status: "ready" as const, summary: summarizeReviewMetrics(records), prompt: summarizePrompt(records), families, labelSources, records });
  }
  return results;
}
