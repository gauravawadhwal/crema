import { analyzeShot, type ShotAnalysis } from "../profiles/analysis.js";
import { measureMassCheckpoints, type PhaseLandmark } from "../profiles/phase-evidence.js";
import { compareReviewHistory, type ReviewHistoryComparison } from "./review-history.js";
import type { ReviewInput } from "./review-types.js";

export const REVIEW_EVIDENCE_VERSION = 1;
export const REVIEW_POINT_LIMIT = 1800;
export const REVIEW_PHASE_LIMIT = 12;
export const FULL_TRACE_PHASE_LIMIT = 40;

const units = {
  time: "s", pressure: "bar", inletFlow: "mL/s", cupMass: "g",
  cupRate: "g/s", temperature: "°C", countedInletVolume: "mL",
} as const;

type PhaseEvidence = ShotAnalysis["facts"]["phaseEvidence"];

export interface ReviewTraceSummary {
  version: typeof REVIEW_EVIDENCE_VERSION;
  phases: {
    frame: number; durationS: number; pressureCoveredS: number;
    peakPressureBar: number; peakPhaseElapsedS: number;
    latePressureBar: number | null; lateInletFlowMlS: number | null; capLikeShare: number | null;
  }[];
  firstGramBrewElapsedS: number | null;
  cupRateAfterOnsetGS: number | null;
  mass: ReturnType<typeof measureMassCheckpoints>;
}

/** Wire data for recordings too large for the point limit. History is evaluated independently. */
export interface FullReviewTrace {
  version: typeof REVIEW_EVIDENCE_VERSION;
  analysis: ShotAnalysis;
  phaseCount: number;
  trace: ReviewTraceSummary;
}

export interface ReviewEvidence {
  version: typeof REVIEW_EVIDENCE_VERSION;
  units: typeof units;
  analysis: ShotAnalysis;
  omittedPhaseCount: number;
  landmarks: {
    id: string; phaseId: string | null; tS: number; brewElapsedS: number;
    phaseElapsedS: number | null; source: "recorded" | "inferred"; reason: string;
  }[];
  expectedTime: {
    value: ShotAnalysis["facts"]["expectedTimeS"];
    source: "recorded" | "inferred" | "guide-derived" | null; reason: string;
  };
  history: ReviewHistoryComparison;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

function selectedPhases(phases: PhaseEvidence["phases"], limit = REVIEW_PHASE_LIMIT) {
  if (phases.length <= limit) return phases;
  const middle = phases.slice(1, -1).sort((a, b) => b.durationS - a.durationS).slice(0, limit - 2);
  return [phases[0], ...middle.sort((a, b) => a.index - b.index), phases.at(-1)!];
}

/** Compute the same measurements for the current shot and hydrated references. */
export function summarizeReviewTrace(points: ReviewInput["points"], evidence: PhaseEvidence): ReviewTraceSummary {
  const phases = evidence.phases;
  const counts = new Map<number, number>();
  for (const p of phases) if (p.frame != null) counts.set(p.frame, (counts.get(p.frame) ?? 0) + 1);
  return {
    version: REVIEW_EVIDENCE_VERSION,
    phases: phases.flatMap(p => {
      const peak = p.pressureCrest.value;
      if (p.frame == null || counts.get(p.frame) !== 1 || !p.plan.value || !peak ||
          p.pressureBar.coveredS < 1 || p.pressureBar.coveredS + 0.002 < 0.8 * p.durationS) return [];
      return [{ frame: p.frame, durationS: p.durationS, pressureCoveredS: p.pressureBar.coveredS,
        peakPressureBar: peak.pressureBar, peakPhaseElapsedS: round(peak.tS - p.fromS),
        latePressureBar: p.lateHydraulics.value?.medianPressureBar ?? null, lateInletFlowMlS: p.lateHydraulics.value?.medianInletFlowMlS ?? null,
        capLikeShare: p.capLikeTime.value?.shareOfCoveredTime ?? null }];
    }),
    firstGramBrewElapsedS: evidence.firstSustainedBeverage.value?.brewElapsedS ?? null,
    cupRateAfterOnsetGS: evidence.cupRateAfterOnsetGS.value,
    mass: measureMassCheckpoints(points, phases),
  };
}

export function fullReviewTrace(input: ReviewInput, landmarks?: PhaseLandmark[]): FullReviewTrace {
  const analysis = analyzeShot(input, landmarks);
  const phaseEvidence = analysis.facts.phaseEvidence;
  const phaseCount = phaseEvidence.phases.length;
  const trace = summarizeReviewTrace(input.points, phaseEvidence);
  if (input.points.length > REVIEW_POINT_LIMIT) {
    phaseEvidence.phases = selectedPhases(phaseEvidence.phases, FULL_TRACE_PHASE_LIMIT);
    if (analysis.facts.pourSteps.length > 200) {
      analysis.facts.pourSteps = [...analysis.facts.pourSteps]
        .sort((a, b) => Number(b.steadyTarget) - Number(a.steadyTarget) || b.durationS - a.durationS).slice(0, 200);
    }
  }
  return { version: REVIEW_EVIDENCE_VERSION, analysis, phaseCount, trace };
}

function landmarks(facts: ShotAnalysis["facts"], phases: PhaseEvidence["phases"]): ReviewEvidence["landmarks"] {
  if (facts.brewStartS == null) return [];
  const out: ReviewEvidence["landmarks"] = [];
  const start = phases[0]?.fromS ?? facts.brewStartS;
  const add = (id: string, tS: number, phase: PhaseEvidence["phases"][number] | undefined,
    source: "recorded" | "inferred", reason: string) => {
    out.push({ id, phaseId: phase?.id ?? null, tS, brewElapsedS: round(tS - start),
      phaseElapsedS: phase ? round(tS - phase.fromS) : null, source, reason });
  };
  for (const phase of phases) {
    add(`${phase.id}-start`, phase.fromS, phase, "recorded", phase.phaseReason);
    add(`${phase.id}-end`, phase.toS, phase, "recorded", "last_observed_sample_in_phase");
    const crest = phase.pressureCrest.value;
    if (crest) add(`${phase.id}-pressure-crest`, crest.tS, phase, "recorded", phase.pressureCrest.reason);
  }
  const onset = facts.phaseEvidence.firstSustainedBeverage;
  if (onset.value) {
    const { tS } = onset.value;
    add("first-sustained-gram", tS, phases.find(p => p.fromS <= tS && p.toS >= tS), "inferred", onset.reason);
  }
  const last = facts.phaseEvidence.finish.lastObservedPhase.value;
  if (last) add("last-brew-sample", last.toS, phases.find(p => p.index === last.index), "recorded", "last_brew_sample_may_precede_stop");
  return out.sort((a, b) => a.tS - b.tS);
}

export function buildReviewEvidence(input: ReviewInput, full = fullReviewTrace(input)): ReviewEvidence {
  const { analysis, trace } = full;
  const { facts } = analysis;
  const phases = selectedPhases(facts.phaseEvidence.phases);
  const timeSource = facts.expectedTimeSource;
  return {
    version: REVIEW_EVIDENCE_VERSION, units, analysis,
    omittedPhaseCount: full.phaseCount - phases.length,
    landmarks: landmarks(facts, phases),
    expectedTime: { value: facts.expectedTimeS,
      source: timeSource === "guide" ? "guide-derived" : timeSource === "recorded" ? "recorded" : timeSource ? "inferred" : null,
      reason: timeSource ?? "no_comparable_time_window_available" },
    history: compareReviewHistory(input, facts, trace),
  };
}

/** Bound the saved/AI projection while retaining the complete analysis for local decisions. */
export function projectReviewEvidence(evidence: ReviewEvidence): ReviewEvidence {
  const { analysis } = evidence;
  const { facts } = analysis;
  return { ...evidence, analysis: { ...analysis, facts: { ...facts,
    phaseEvidence: { ...facts.phaseEvidence, phases: selectedPhases(facts.phaseEvidence.phases) },
    pourSteps: facts.pourSteps.length <= REVIEW_PHASE_LIMIT ? facts.pourSteps :
      [...facts.pourSteps].sort((a, b) => b.durationS - a.durationS).slice(0, REVIEW_PHASE_LIMIT),
  } } };
}
