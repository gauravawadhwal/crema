import { stoppedEarly, type ShotFacts } from "../profiles/analysis.js";
import { sameGrind } from "../control/workflow.js";
import type { ReviewInput } from "./review-types.js";
import type { ReviewTraceSummary } from "./review-evidence.js";

type Previous = ReviewInput["history"][number];
type Phase = ReviewTraceSummary["phases"][number];
type MassPoint = ReviewTraceSummary["mass"]["checkpoints"][number];

const MIN_COMPARATORS = 2;
const MIN_QUARTILES = 5;
const COACH_TIME_DIFFERENCE_S = 3;
const COACH_TIME_DIFFERENCE_SHARE = 0.15;
const COACH_PRESSURE_DIFFERENCE_BAR = 1;
const COACH_ONSET_DIFFERENCE_S = 2;
const COACH_CUP_RATE_DIFFERENCE_G_S = 1;

interface Reference {
  timestamp: string;
  durationS: number;
  grinderSetting: string | null;
  grindChanged: boolean | null;
  stopReason: string | null;
  completionBasis: "recorded_target_stop" | "recorded_yield_near_target";
  phase: Phase;
  firstGramBrewElapsedS: number | null;
  cupRateAfterOnsetGS: number | null;
  mass: MassPoint | null;
}

interface Distribution { count: number; median: number; q1: number; q3: number }

interface CurveComparison {
  reason: "no_history" | "no_comparable_recipe" | "bag_unverified" | "current_phase_unusable" | "fewer_than_two_usable_phases" | "comparable_phases";
  usableCount: number;
  phase: Phase | null;
  firstGramBrewElapsedS: number | null;
  cupRateAfterOnsetGS: number | null;
  mass: {
    reason: "no_common_covered_mass" | "fewer_than_two_usable_crossings" | "covered_same_phase_crossings";
    currentCoverage: string | null;
    usableCount: number;
    current: MassPoint | null;
  };
  references: Reference[];
  statistics: {
    peakPressureBar: Distribution;
    peakPhaseElapsedS: Distribution;
    pressureAtMassBar: Distribution | null;
  } | null;
}

export interface ReviewHistoryComparison {
  status: "none" | "comparable" | "confounded" | "insufficient";
  comparableCount: number;
  excluded: Record<"bag" | "profile" | "dose" | "yield" | "temperature" | "stop" | "incomplete" | "missing" | "chronology", number>;
  bagBasis: "recorded_batch" | "legacy_skin_history" | "no_recorded_batch";
  curves: CurveComparison;
  latest: {
    timestamp: string;
    previousDurationS: number;
    currentDurationS: number;
    deltaS: number;
    previousGrind: string | null;
    currentGrind: string | null;
    grindChanged: boolean | null;
  } | null;
  /** A descriptive range, never an ideal time window or proof of a grind effect. */
  recentRangeS: [number, number] | null;
}

const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const setting = (s?: string | null) => s?.trim() || null;
const rounded = (n: number) => Math.round(n * 10) / 10;
const materialDelta = (a: number, b: number, floor: number) => Math.abs(a - b) + 1e-9 >= floor;
const stopLabel = (s?: string | null) => {
  const value = s?.toLowerCase().trim();
  return value && ["appstop", "apistop", "userstop", "manual"].includes(value) ? "user" : value || null;
};
const changedSetting = (a: string | null, b: string | null) => a && b ? !sameGrind(a, b) : null;
const targetStop = (reason: string | null) => reason === "targetweight" || reason === "targetvolume";

function distribution(values: number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (fraction: number) => {
    const index = (sorted.length - 1) * fraction, lo = Math.floor(index), hi = Math.ceil(index);
    return rounded(sorted[lo] + (index - lo) * (sorted[hi] - sorted[lo]));
  };
  return { count: sorted.length, median: quantile(0.5), q1: quantile(0.25), q3: quantile(0.75) };
}

function compareCurves(out: CurveComparison, input: ReviewInput, comparable: Previous[], current: ReviewTraceSummary | undefined) {
  if (!input.batchId) { out.reason = "bag_unverified"; return; }
  const phase = current?.phases.reduce<Phase | null>((best, p) => !best || p.durationS > best.durationS ? p : best, null);
  if (!phase || !current) { out.reason = "current_phase_unusable"; return; }
  out.phase = phase;
  out.firstGramBrewElapsedS = current.firstGramBrewElapsedS;
  out.cupRateAfterOnsetGS = current.cupRateAfterOnsetGS;
  const candidates = comparable.flatMap(p => {
    const trace = p.trace;
    const previousPhase = trace?.version === current.version ? trace.phases.find(x => x.frame === phase.frame) : null;
    return trace && previousPhase ? [{ p, trace, phase: previousPhase }] : [];
  });
  out.usableCount = candidates.length;
  out.reason = candidates.length < MIN_COMPARATORS ? "fewer_than_two_usable_phases" : "comparable_phases";

  // Compare the same recorded phase at a shared absolute cup mass. Prefer
  // greater support, then proximity to half the current recorded yield.
  const midpointG = (input.yieldG ?? 0) / 2;
  const support = current.mass.checkpoints.filter(p => p.frame === phase.frame).map(point => ({
    point, matches: candidates.map(c => c.trace.mass.checkpoints.find(p => p.frame === point.frame && p.massG === point.massG) ?? null),
  })).map(row => ({ ...row, count: row.matches.filter(Boolean).length }))
    .filter(row => row.count > 0)
    .sort((a, b) => b.count - a.count || Math.abs(a.point.massG - midpointG) - Math.abs(b.point.massG - midpointG))[0];
  out.mass = {
    reason: !support ? "no_common_covered_mass" : support.count < MIN_COMPARATORS ?
      "fewer_than_two_usable_crossings" : "covered_same_phase_crossings",
    currentCoverage: current.mass.reason, usableCount: support?.count ?? 0, current: support?.point ?? null,
  };

  const references = candidates.map<Reference>(({ p, phase, trace }, i) => ({
    timestamp: p.timestamp, durationS: p.durationS!, grinderSetting: setting(p.grinderSetting),
    grindChanged: changedSetting(setting(p.grinderSetting), setting(input.grinderSetting)),
    stopReason: p.stopReason ?? null, completionBasis: targetStop(stopLabel(p.stopReason)) ? "recorded_target_stop" : "recorded_yield_near_target",
    phase, firstGramBrewElapsedS: trace.firstGramBrewElapsedS,
    cupRateAfterOnsetGS: trace.cupRateAfterOnsetGS, mass: support?.matches[i] ?? null,
  }));
  // Keep recorded labels visible, including for a small mass subset of a larger group.
  out.references = references;
  if (references.length >= MIN_QUARTILES) {
    const pressuresAtMass = references.flatMap(r => r.mass ? [r.mass.pressureBar] : []);
    out.statistics = {
      peakPressureBar: distribution(references.map(r => r.phase.peakPressureBar)),
      peakPhaseElapsedS: distribution(references.map(r => r.phase.peakPhaseElapsedS)),
      pressureAtMassBar: pressuresAtMass.length >= MIN_QUARTILES ? distribution(pressuresAtMass) : null,
    };
  }
}

/** Compare recorded shots of one bag while keeping recipe changes and missing facts visible. */
export function compareReviewHistory(input: ReviewInput, facts: ShotFacts, trace?: ReviewTraceSummary): ReviewHistoryComparison {
  const out: ReviewHistoryComparison = {
    status: input.history.length ? "insufficient" : "none", comparableCount: 0,
    excluded: { bag: 0, profile: 0, dose: 0, yield: 0, temperature: 0, stop: 0, incomplete: 0, missing: 0, chronology: 0 },
    bagBasis: input.batchId ? "recorded_batch" : input.batchId === undefined ? "legacy_skin_history" : "no_recorded_batch",
    curves: { reason: input.history.length ? "no_comparable_recipe" : "no_history", usableCount: 0, phase: null,
      firstGramBrewElapsedS: null, cupRateAfterOnsetGS: null,
      mass: { reason: "no_common_covered_mass", currentCoverage: null, usableCount: 0, current: null }, references: [], statistics: null },
    latest: null, recentRangeS: null,
  };
  if (!input.history.length) return out;
  const currentAt = Date.parse(input.timestamp ?? "");
  const currentKnown = input.profile != null && input.profile.beverage_type !== "manual" &&
    !!input.profileShape && positive(facts.durationS) && positive(facts.doseG) && positive(facts.yieldG) && positive(input.tempC) &&
    Number.isFinite(currentAt);
  const comparable: Previous[] = [];
  const seen = new Set<number>();
  const currentStop = stopLabel(input.stopReason);
  for (const p of input.history.slice(0, 20)) {
    if (!currentKnown || !p.profileShape || !positive(p.durationS) || !positive(p.doseG) || !positive(p.yieldG) || !positive(p.tempC)) {
      out.excluded.missing++; continue;
    }
    const at = Date.parse(p.timestamp);
    if (!Number.isFinite(at) || at >= currentAt || seen.has(at)) { out.excluded.chronology++; continue; }
    if (input.batchId !== undefined && (!input.batchId || p.batchId !== input.batchId)) { out.excluded.bag++; continue; }
    const previousStop = stopLabel(p.stopReason);
    if (stoppedEarly(input) || stoppedEarly({ yieldG: p.yieldG!, targetYieldG: p.targetYieldG ?? null, stopReason: p.stopReason ?? null }) ||
        currentStop === "error" || previousStop === "error" ||
        positive(input.targetYieldG) && facts.yieldG! < 0.8 * input.targetYieldG || positive(p.targetYieldG) && p.yieldG! < 0.8 * p.targetYieldG) {
      out.excluded.incomplete++; continue;
    }
    if (p.profileTitle !== input.profile?.title || p.profileShape !== input.profileShape) { out.excluded.profile++; continue; }
    if (Math.abs(p.doseG! - facts.doseG!) > 0.5) { out.excluded.dose++; continue; }
    if (Math.abs(p.yieldG! - facts.yieldG!) > Math.max(2, facts.yieldG! * 0.05)) { out.excluded.yield++; continue; }
    if (positive(input.targetYieldG) && positive(p.targetYieldG) && Math.abs(input.targetYieldG - p.targetYieldG) > Math.max(2, input.targetYieldG * 0.05)) { out.excluded.yield++; continue; }
    if (Math.abs(p.tempC! - input.tempC!) > 0.5) { out.excluded.temperature++; continue; }
    if (input.batchId && (currentStop === "user" || previousStop === "user" ||
        !targetStop(currentStop) && !positive(input.targetYieldG) || !targetStop(previousStop) && !positive(p.targetYieldG))) {
      out.excluded.incomplete++; continue;
    }
    if (input.batchId && ((currentStop && previousStop && currentStop !== previousStop) ||
        input.targetWaterMl != null && p.targetWaterMl != null && Math.abs(input.targetWaterMl - p.targetWaterMl) > 2)) {
      out.excluded.stop++; continue;
    }
    seen.add(at);
    comparable.push(p);
  }
  comparable.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  out.comparableCount = comparable.length;
  if (!comparable.length) {
    out.status = out.excluded.bag + out.excluded.profile + out.excluded.dose + out.excluded.yield + out.excluded.temperature +
      out.excluded.stop > 0 ? "confounded" : "insufficient";
    return out;
  }
  out.status = "comparable";
  const p = comparable[0];
  const previousGrind = setting(p.grinderSetting), currentGrind = setting(input.grinderSetting);
  out.latest = {
    timestamp: p.timestamp, previousDurationS: p.durationS!, currentDurationS: facts.durationS!,
    deltaS: rounded(facts.durationS! - p.durationS!), previousGrind, currentGrind,
    // A numeric direction does not establish which way this grinder gets finer.
    grindChanged: changedSetting(previousGrind, currentGrind),
  };
  const times = comparable.map(p => p.durationS!);
  out.recentRangeS = [Math.min(...times), Math.max(...times)];
  compareCurves(out.curves, input, comparable, trace);
  return out;
}

export function historySentence(h: ReviewHistoryComparison): string | null {
  const p = h.latest;
  if (p) {
    const change = p.grindChanged === true ? `with grind ${p.previousGrind} → ${p.currentGrind}` :
      p.grindChanged === false ? "at the same recorded setting" : "with grind history unknown";
    return `On the same recipe, time went from ${p.previousDurationS} to ${p.currentDurationS} s ${change}; repeat before attributing a cause.`;
  }
  if (h.excluded.stop) return "The earlier shot had a different recorded stop condition, so its timing cannot isolate a grind effect.";
  if (h.excluded.bag) return "The earlier shot was from a different or unverified bag.";
  if (h.status === "confounded") return "The earlier recipe or profile changed, so history cannot isolate a grind effect; repeat this recipe before drawing a trend.";
  if (h.status === "insufficient") return "Recorded timing or recipe details are missing, so history cannot establish a grind trend; repeat with the setting noted.";
  return null;
}

/** The same code-computed comparison is displayed for rules and AI reviews. */
export function historyCurveSentence(h: ReviewHistoryComparison): string | null {
  const { phase, usableCount, references, statistics, mass } = h.curves;
  if (!phase || usableCount < MIN_COMPARATORS) return h.bagBasis === "recorded_batch" && h.comparableCount > 0 ?
    `Phase comparison needs two usable earlier curves. ${usableCount} of ${h.comparableCount} matching recordings qualified.` : null;
  const earlier = (values: number[]) => `${values.map(x => x.toFixed(1)).join(", ")} bar`;
  const ranges = (stat: Distribution) => `a median of ${stat.median.toFixed(1)} bar (middle half ${stat.q1.toFixed(1)}–${stat.q3.toFixed(1)} bar)`;
  const peaks = statistics ? ranges(statistics.peakPressureBar) : earlier(references.map(r => r.phase.peakPressureBar));
  const lines = [`Pressure peaked at ${phase.peakPressureBar.toFixed(1)} bar in the matched phase, versus ${peaks} across ${usableCount} earlier shots.`];
  if (mass.current && mass.usableCount >= MIN_COMPARATORS) {
    const atMass = statistics?.pressureAtMassBar ? ranges(statistics.pressureAtMassBar) :
      earlier(references.flatMap(r => r.mass ? [r.mass.pressureBar] : []));
    lines.push(`At ${mass.current.massG} g in the cup, pressure was ${mass.current.pressureBar.toFixed(1)} bar versus ${atMass} across ${mass.usableCount} earlier shots.`);
  }
  const changed = [...new Set(references.flatMap(r => r.grindChanged && r.grinderSetting ? [r.grinderSetting] : []))];
  if (changed.length) lines.push(changed.length <= 4 ?
    `This shot recorded setting ${h.latest?.currentGrind}; earlier settings included ${changed.join(", ")}.` :
    "Recorded grinder settings differed across these shots.");
  return lines.join(" ");
}

/** One recent match is enough for a descriptive comparison. A repeat needs a shared departure from the plan. */
export function coachHistory(h: ReviewHistoryComparison, facts: ShotFacts) {
  const latest = h.latest;
  if (!latest || h.comparableCount === 0) return null;
  const { currentDurationS, previousDurationS } = latest;
  const materialTime = materialDelta(currentDurationS, previousDurationS,
    Math.max(COACH_TIME_DIFFERENCE_S, COACH_TIME_DIFFERENCE_SHARE * previousDurationS));
  const settingNote = (changed: boolean | null) => changed ?
    " The grinder setting changed too, so you can't tell what caused the difference from these shots." : "";
  const row = (sentence: string, ids: string[] = ["history"]) => ({ sentence, evidenceIds: ids });
  const time = `Your pour took ${rounded(currentDurationS)} s versus ${rounded(previousDurationS)} s on the last matching recipe.`;
  if (materialTime) return row(time + settingNote(latest.grindChanged));

  const { phase, mass, firstGramBrewElapsedS, cupRateAfterOnsetGS, references } = h.curves;
  const previous = references[0];
  if (phase && previous) {
    const a = mass.current, b = previous.mass;
    if (a && b && materialDelta(a.pressureBar, b.pressureBar, COACH_PRESSURE_DIFFERENCE_BAR)) {
      return row(`At ${a.massG} g in the cup, you were at ${rounded(a.pressureBar)} bar versus ${rounded(b.pressureBar)} bar in the earlier pour.` +
        settingNote(previous.grindChanged));
    }
    if (firstGramBrewElapsedS != null && previous.firstGramBrewElapsedS != null &&
        materialDelta(firstGramBrewElapsedS, previous.firstGramBrewElapsedS, COACH_ONSET_DIFFERENCE_S)) {
      return row(`Your cup reached its first gram at ${rounded(firstGramBrewElapsedS)} s versus ${rounded(previous.firstGramBrewElapsedS)} s in the earlier pour.` +
        settingNote(previous.grindChanged));
    }
    if (cupRateAfterOnsetGS != null && previous.cupRateAfterOnsetGS != null &&
        materialDelta(cupRateAfterOnsetGS, previous.cupRateAfterOnsetGS, COACH_CUP_RATE_DIFFERENCE_G_S)) {
      return row(`Once your cup started filling, it gained ${rounded(cupRateAfterOnsetGS)} g/s versus ${rounded(previous.cupRateAfterOnsetGS)} g/s in the earlier pour.` +
        settingNote(previous.grindChanged));
    }
  }
  const window = facts.expectedTimeS;
  if (window && facts.timeTargetComparable) {
    const fast = Math.max(currentDurationS, previousDurationS) <= window[0] - 4;
    const slow = Math.min(currentDurationS, previousDurationS) >= window[1] + 5;
    if (fast || slow) return row(`Both pours finished ${fast ? "ahead of" : "beyond"} the expected time window. ${time}` +
      (latest.grindChanged ? " The grinder setting changed too, so you can't tell what kept the pours at that pace." : ""), ["history", "timing"]);
  }
  return null;
}
