import { ProviderChain } from "../../server/llm/index.js";
import { MockProvider } from "../../server/llm/mock.js";
import { analyzeShot } from "../../server/profiles/analysis.js";
import type { PhaseLandmark } from "../../server/profiles/phase-evidence.js";
import { reviewCurveSection } from "../../server/recommend/review-curve.js";
import type { LlmProvider } from "../../server/llm/types.js";
import { legacyReviewShot, legacyRulesReview } from "./review-legacy.js";
import { legacyEvalReview } from "./review-coach-compat.js";
import { reviewShot } from "../../server/recommend/review.js";
import { buildReviewEvidence, projectReviewEvidence, type FullReviewTrace, type ReviewEvidence } from "../../server/recommend/review-evidence.js";
import { rulesReviewResult } from "../../server/recommend/review-local.js";
import type { ReviewInput, ReviewResult, ShotReviewData } from "../../server/recommend/review-types.js";
import { digest } from "./manifest.js";
import { answerSource } from "./provenance.js";
import { judgeChecks, judgeReview, reviewJudgeEvidence, reviewJudgeProvenance, reviewJudgeStatus } from "./judge.js";
import { RecordingProvider, type CallRecord } from "./recorder.js";
import { legacyReviewCurveSection } from "./review-legacy-curve.js";
import type { PumpMode, ReviewLabels } from "./review-labels.js";
import { scoreReview, summarizeReviewMetrics, type ReviewEvalOutput, type ReviewMetricRow } from "./review-metrics.js";

export interface ReviewEvalCase {
  id: string;
  input: ReviewInput;
  fullTrace?: FullReviewTrace;
  profileFamily: string;
  pumpMode: PumpMode;
  labels?: ReviewLabels;
  sampleTimes?: number[];
}

interface VariantOutput {
  detectorEvidence: ReviewEvalOutput;
  review: ShotReviewData;
  source: string;
  stages?: Pick<ReviewResult, "curve" | "taste">;
}

type Variant =
  | { status: "ready"; run: (input: ReviewInput, llm: ProviderChain | null, fullTrace?: FullReviewTrace) => Promise<VariantOutput> }
  | { status: "pending"; reason: string };

export const VARIANT_NAMES = ["old", "facts-only", "facts-plus-anchored", "two-stage"] as const;
export type VariantName = typeof VARIANT_NAMES[number];

export function normalizeLegacyReview(review: ShotReviewData, input: ReviewInput, evidence?: ReviewEvidence): ReviewEvalOutput {
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
    return { kind: issue.kind, phase: point?.substate ?? undefined, controlledVariable, timingBasis: "issue-window", onsetS: issue.fromS ?? undefined };
  });
  const curves = evidence?.history.curves;
  if (curves?.reason === "comparable_phases" && curves.phase) {
    figures.push({ id: "history.comparable.peak", unit: "bar", value: curves.phase.peakPressureBar },
      { id: "history.comparable.count", unit: "shots", value: curves.usableCount });
    if (curves.mass.reason === "covered_same_phase_crossings" && curves.mass.current) {
      figures.push({ id: "history.mass.current", unit: "bar", value: curves.mass.current.pressureBar },
        { id: "history.mass.delivered", unit: "g", value: curves.mass.current.massG });
      for (const [i, ref] of curves.references.entries()) {
        if (ref.mass) figures.push({ id: `history.mass.previous-${i + 1}`, unit: "bar", value: ref.mass.pressureBar });
      }
    }
  }
  return { events, figures, outcomes, claims: { "multiple-next-shot-changes": outcomes.length > 1 } };
}

const pending: Variant = { status: "pending", reason: "not implemented yet" };
function curveVariant(curveSection?: typeof legacyReviewCurveSection): Variant {
  return {
    status: "ready",
    async run(input, llm, fullTrace) {
      if (!llm) {
        const evidence = buildReviewEvidence(input, fullTrace);
        const review = legacyRulesReview(input, evidence);
        return { review, source: "rules", detectorEvidence: normalizeLegacyReview(review, input, projectReviewEvidence(evidence)) };
      }
      const { review, source, evidence } = await legacyReviewShot(llm, input, fullTrace, { curveSection });
      return { review, source, detectorEvidence: normalizeLegacyReview(review, input, evidence) };
    },
  };
}

export const REVIEW_VARIANTS: Readonly<Record<VariantName, Variant>> = {
  old: curveVariant(legacyReviewCurveSection),
  "facts-only": pending,
  "facts-plus-anchored": curveVariant(),
  "two-stage": {
    status: "ready",
    async run(input, llm, fullTrace) {
      const { review, source, evidence, curve, taste } =
        legacyEvalReview(llm ? await reviewShot(llm, input, fullTrace) : rulesReviewResult(input, fullTrace));
      return { review, source, stages: { curve, taste }, detectorEvidence: normalizeLegacyReview(review, input, evidence) };
    },
  },
};

export async function runReviewVariant(name: VariantName, input: ReviewInput, provider?: LlmProvider, fullTrace?: FullReviewTrace) {
  const variant = REVIEW_VARIANTS[name];
  if (variant.status === "pending") return variant;
  const recorder = provider ? new RecordingProvider(provider) : undefined;
  const started = performance.now();
  const result = await variant.run(input, recorder ? new ProviderChain([recorder]) : null, fullTrace);
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
  const provenance = answerSource("review", calls, { source: result.source },
    provider ? { kind: "llm", provider: provider.id } : { kind: "rules" });
  const authored = provenance === "model" ? authoredReview(result, calls) : undefined;
  const curveCall = calls.find(call => call.schemaName === "ShotReview" || call.schemaName === "CurveNarrative");
  return { status: "ready" as const, ...result, fellBack: provenance === "fallback", provenance, authored, curveCall, ms, tokens, promptHashes: [...new Set(calls.map((c) => c.systemHash))] };
}

function authoredReview(result: VariantOutput, calls: CallRecord[]) {
  const { review, stages } = result;
  if (!stages) {
    const raw = calls.find(call => call.schemaName === "ShotReview")?.output as ShotReviewData | undefined;
    if (!raw) return undefined;
    return {
      summary: raw.summary === review.summary ? raw.summary : undefined,
      wentWell: review.wentWell.filter(text => raw.wentWell?.includes(text)),
      nextShot: digest(raw.nextShot) === digest(review.nextShot) ? review.nextShot : undefined,
    };
  }
  const interpretation = stages.curve.narrative;
  const { report } = (calls.find(call => call.schemaName === "ReviewNotes")?.output ?? {}) as {
    report?: { notesEvidence: string; notesTaste: string };
  };
  // Only count the interpretation and adjustment that survived validation
  // and taste alignment. A repeat imposed by those stages belongs to rules.
  const notesAssessment = report && stages.taste.summary.includes(`${report.notesTaste} in the saved note`)
    ? { quote: report.notesEvidence, reportedTaste: report.notesTaste } : undefined;
  const nextShot = notesAssessment && review.nextShot?.reasoning.startsWith("You reported a ") ? review.nextShot : undefined;
  return interpretation || notesAssessment ? { interpretation: interpretation ?? undefined, notesAssessment, nextShot } : undefined;
}

const MEASURED_LANDMARKS = ["first_sustained_beverage", "brew_pressure_crest", "phase_boundary", "stop", "recording_end"] as const;
type LandmarkCounts = Record<typeof MEASURED_LANDMARKS[number], { kept: number; total: number }>;
export interface PromptMeasure { curveChars: number; promptChars: number; landmarks: LandmarkCounts }

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

/** Counterfactual render for rules. For model runs, use the actual wire request. */
export async function measurePrompt(name: VariantName, input: ReviewInput, fullTrace?: FullReviewTrace, captured?: string) {
  if (REVIEW_VARIANTS[name].status !== "ready") return null;
  const landmarks: PhaseLandmark[] = [];
  // Supplied full-trace summaries omit the raw sample brackets, so their
  // landmark retention denominator cannot be reconstructed from bounded rows.
  if (!fullTrace) analyzeShot(input, landmarks);
  let prompt = captured;
  if (prompt === undefined) {
    const recorder = new RecordingProvider(new MockProvider());
    await REVIEW_VARIANTS[name].run(structuredClone(input), new ProviderChain([recorder]), fullTrace);
    prompt = recorder.calls.find(call => call.schemaName === "ShotReview" || call.schemaName === "CurveNarrative")?.prompt;
  }
  const curve = prompt?.match(/^SHOT CURVES[^\n]*\n[^\n]+/m)?.[0];
  if (!curve || !prompt) return null;
  const seen = visibleTimes(curve);
  const counts = Object.fromEntries(MEASURED_LANDMARKS.map((kind) => [kind, { kept: 0, total: 0 }])) as LandmarkCounts;
  for (const landmark of landmarks) {
    if (!(landmark.kind in counts)) continue;
    const bucket = counts[landmark.kind as keyof LandmarkCounts];
    const readings = [landmark.before, landmark.at, landmark.after, landmark.confirmed].filter((p) => p != null);
    bucket.total++;
    if (readings.every((p) => seen.has(p.t))) bucket.kept++;
  }
  return { curveChars: curve.length, promptChars: prompt.length, landmarks: counts };
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

interface ReviewerScore {
  status: "rules-control" | "no-model-answer" | "unassessed" | "invalid-citation" | "unavailable" | "pass" | "fail";
  supportedOutcome: boolean | null;
  adjudication?: {
    evidenceDigest: string;
    rubricDigest: string;
    verdict?: Awaited<ReturnType<typeof judgeReview>>;
  };
}

async function scoreReviewer(result: Extract<Awaited<ReturnType<typeof runReviewVariant>>, { status: "ready" }>,
  c: ReviewEvalCase, decision: boolean | null, judge?: LlmProvider): Promise<ReviewerScore> {
  if (result.provenance === "rules") return { status: "rules-control", supportedOutcome: null };
  if (result.provenance !== "model") return { status: "no-model-answer", supportedOutcome: null };
  const answer = result.authored;
  const supportedOutcome = answer && "nextShot" in answer && answer.nextShot !== undefined ? decision : null;
  if (!answer || !judge) return { status: supportedOutcome === false ? "fail" : "unassessed", supportedOutcome };
  const evidence = reviewJudgeEvidence(c.input, c.fullTrace);
  const provenance = reviewJudgeProvenance(evidence);
  let verdict;
  try {
    verdict = await judgeReview(new ProviderChain([judge]), evidence, answer);
  } catch {
    return { status: "unavailable", supportedOutcome, adjudication: provenance };
  }
  const assessment = reviewJudgeStatus(verdict, evidence, answer);
  const adjudication = { ...provenance, verdict };
  if (assessment === "invalid-citation") return { status: assessment, supportedOutcome, adjudication };
  const failed = supportedOutcome === false || judgeChecks(verdict, true).some(check => check.critical && !check.pass);
  const coverage = assessment === "assessed" && (c.labels?.supportedOutcomes == null || supportedOutcome !== null);
  return { status: failed ? "fail" : coverage ? "pass" : "unassessed", supportedOutcome, adjudication };
}

export interface AblationRecord extends ReviewMetricRow {
  prompt: PromptMeasure | null;
  caseId: string;
  repeat: number;
  profileFamily: string;
  source: string;
  labelSource?: ReviewLabels["source"];
  promptHashes: string[];
  reviewerScore: ReviewerScore;
  fallbackUtility: boolean | null;
}

function summarizeRecords(records: AblationRecord[]) {
  const count = (status: ReviewerScore["status"]) => records.filter(r => r.reviewerScore.status === status).length;
  const outcomes = records.flatMap(r => r.reviewerScore.supportedOutcome === null ? [] : [r.reviewerScore.supportedOutcome]);
  const { abstention: _abstention, supportedOutcomes: _outcomes, forbiddenClaims: _claims, ...detectorEvidence } = summarizeReviewMetrics(records);
  return {
    detectorEvidence,
    reviewer: { passed: count("pass"), failed: count("fail"), unassessed: count("unassessed"),
      invalidCitation: count("invalid-citation"), unavailable: count("unavailable"), noModelAnswer: count("no-model-answer"),
      rulesControl: count("rules-control"),
      supportedOutcomes: { passed: outcomes.filter(Boolean).length, total: outcomes.length } },
    fallbackUtility: { passed: records.filter(r => r.fallbackUtility === true).length, total: records.filter(r => r.fallbackUtility !== null).length },
  };
}

export async function runReviewAblation(cases: readonly ReviewEvalCase[], names: readonly VariantName[], provider?: LlmProvider, judge?: LlmProvider) {
  const results = [];
  for (const name of names) {
    const variant = REVIEW_VARIANTS[name];
    if (variant.status === "pending") {
      results.push({ name, ...variant });
      continue;
    }
    const records: AblationRecord[] = [];
    for (const c of cases) {
      const result = await runReviewVariant(name, structuredClone(c.input), provider, c.fullTrace);
      if (result.status !== "ready") throw new Error(`Variant ${name}: ${result.reason}`);
      const { ms, tokens, fellBack, detectorEvidence, source, promptHashes } = result;
      const samples = c.sampleTimes ?? c.input.points.map(p => p.t);
      const decision = c.labels ? scoreReview(c.labels, detectorEvidence, samples).supportedOutcome : null;
      const score = c.labels && scoreReview({ ...c.labels, supportedOutcomes: undefined, forbiddenClaims: [] }, detectorEvidence, samples);
      const prompt = !provider || result.curveCall
        ? await measurePrompt(name, c.input, c.fullTrace, result.curveCall?.prompt) : null;
      records.push({ prompt, caseId: c.id, repeat: 0, profileFamily: c.profileFamily, pumpMode: c.pumpMode, ms, tokens, fellBack, score, source,
        labelSource: c.labels?.source, promptHashes, reviewerScore: await scoreReviewer(result, c, decision, judge),
        fallbackUtility: fellBack ? decision : null });
    }
    const families = Array.from(new Set(records.map(r => r.profileFamily)), family => ({
      family, metrics: summarizeRecords(records.filter(r => r.profileFamily === family)),
      prompt: summarizePrompt(records.filter(r => r.profileFamily === family)),
    }));
    const labelSources = Array.from(new Set(records.flatMap(r => r.labelSource ? [r.labelSource] : [])), source => ({
      source, metrics: summarizeRecords(records.filter(r => r.labelSource === source)),
      prompt: summarizePrompt(records.filter(r => r.labelSource === source)),
    }));
    // The CLI has no calibrated judge or custodian-approved panel. It produces
    // diagnostic evidence and cannot issue a promotion verdict.
    results.push({ name, status: "ready" as const, promotionEligible: false, summary: summarizeRecords(records),
      prompt: summarizePrompt(records), families, labelSources, records });
  }
  return results;
}
