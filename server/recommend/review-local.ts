import { stoppedEarly, type ShotFacts } from "../profiles/analysis.js";
import type { CurveReview, ReviewInput, ReviewResult, ShotReviewData } from "./review-types.js";
import type { DialInAdvice } from "../schema.js";
import { historyCurveSentence, historySentence } from "./review-history.js";
import { alignTaste, grindAdvice } from "./review-taste.js";
import { buildReviewEvidence, projectReviewEvidence, type FullReviewTrace, type ReviewEvidence } from "./review-evidence.js";

const STOPS: Record<string, string> = {
  targetWeight: "stopped at the target weight", targetVolume: "stopped at the target volume",
  machineEnded: "ended by the machine", apiStop: "stopped from the app", userStop: "stopped by hand",
};

/** One plain sentence of what the shot did, from measured facts only. */
export function factsSentence(f: ShotFacts): string | null {
  const parts: string[] = [];
  const g = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} g`;
  if (f.yieldG != null) parts.push(f.doseG != null ? `${g(f.yieldG)} from ${g(f.doseG)} (1:${f.ratio!.toFixed(1)})` : g(f.yieldG));
  if (f.durationS != null && f.durationS >= 5) {
    const pre = f.preinfusionS != null && f.preinfusionS >= 1 ? `, ${Math.round(f.preinfusionS)} s of it preinfusion` : "";
    parts.push(`${parts.length ? "in" : "ran for"} ${Math.round(f.durationS)} s${pre}`);
  }
  const stop = f.stopReason ? STOPS[f.stopReason] : null;
  if (!parts.length) return null;
  const sentence = parts.join(" ") + (stop ? `, ${stop}` : "");
  return sentence[0].toUpperCase() + sentence.slice(1) + ".";
}

const grams = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} g`;

/** Pace against the expected time window, when there is one to compare with. */
export function paceSentence(f: ShotFacts): string | null {
  if (!f.expectedTimeS || f.durationS == null || f.timeStatus == null || f.timeDeltaS == null) return null;
  const [lo, hi] = f.expectedTimeS;
  const basis = f.expectedTimeSource === "guide" ? "guide" : "target";
  const ran = Math.round(f.durationS);
  const off = Math.abs(Math.round(f.timeDeltaS));
  const detail = f.yieldG != null ? `${ran} s to ${grams(f.yieldG)}` : `${ran} s`;
  if (f.timeStatus === "in_window" || off < 1) return `Finished in ${ran} s, ${f.timeStatus === "in_window" ? "right in" : "at the edge of"} the ${lo}–${hi} s ${basis} window.`;
  return `Ran ${off} s ${f.timeStatus === "fast" ? "faster" : "slower"} than the ${lo}–${hi} s ${basis} window (${detail}).`;
}

/** Whether the main pour step reached its pressure or flow target, in numbers. */
export function trackingSentence(f: ShotFacts, faultFrames: ReadonlySet<number>): string | null {
  const main = f.pourSteps.filter(s => s.steadyTarget).sort((a, b) => b.durationS - a.durationS)[0];
  if (!main) return null;
  const pressure = main.pump === "pressure";
  const unit = pressure ? "bar" : "ml/s";
  const otherUnit = pressure ? "ml/s" : "bar";
  const n = (x: number) => x.toFixed(1);
  const at = main.otherMean != null ? ` at ${n(main.otherMean)} ${otherUnit}` : "";
  const ratio = main.actualMean / main.target;
  const gap = main.target - main.actualMean;
  const short = pressure ? ratio <= 0.78 && gap >= 1.2 : ratio <= 0.75 && gap >= 0.4;
  const name = pressure ? "pressure" : "flow";
  if (!faultFrames.has(main.frame)) return `Pour ${name} averaged ${n(main.actualMean)} ${unit} against the ${n(main.target)} ${unit} target${at}.`;
  const atLimit = main.limiterValue != null && main.otherMean != null && main.otherMean >= 0.85 * main.limiterValue;
  if (short || main.limiterEngaged) {
    const why = main.limiterEngaged
      ? pressure ? ` at the ${main.limiterValue} ml/s flow limit, consistent with low puck resistance` : ` at the ${main.limiterValue} bar pressure limit, consistent with a restrictive puck`
      : "";
    return `Pour ${name} only reached ${n(main.actualMean)} ${unit} of the ${n(main.target)} ${unit} target${at}${why}.`;
  }
  if (Math.abs(ratio - 1) <= 0.1) return `${pressure ? "Pressure" : "Flow"} held ${n(main.actualMean)} ${unit} against the ${n(main.target)} ${unit} target${at}.`;
  const limitNote = atLimit && gap > 0 ? `, with ${pressure ? "flow" : "pressure"} at its ${main.limiterValue} ${otherUnit} limit as the profile allows` : "";
  return `Pour ${name} averaged ${n(main.actualMean)} ${unit} against the ${n(main.target)} ${unit} target${at}${limitNote}.`;
}

export function shortPhaseSentence(phase: ShotFacts["phaseEvidence"]["phases"][number]) {
  const name = phase.purpose.value === "bloom_or_pause" ? "bloom" : phase.purpose.value === "decline" ? "decline" : "phase";
  return `During the ${name}, ${phase.mode.value} differed from the recorded command by ${phase.controlledError.value!.absoluteMean.toFixed(1)} ${phase.controlledUnit} on average over ${phase.controlledError.coveredS.toFixed(1)} s.`;
}

export function highFlowSentence(phase: ShotFacts["phaseEvidence"]["phases"][number]) {
  const hold = phase.steadyHold;
  const mean = hold.value!;
  const peak = phase.pressureCrest.value;
  const droop = phase.pressureDroopAtHeldFlowBar.value;
  const first = `Inlet flow averaged ${mean.meanResponse.toFixed(1)} mL/s against the ${mean.meanCommand.toFixed(1)} mL/s target over ${hold.coveredS.toFixed(1)} s`;
  const pressure = peak ? `, with pressure peaking at ${peak.pressureBar.toFixed(1)} bar` : "";
  const late = droop != null && droop >= 0.2 ? ` and easing by ${droop.toFixed(1)} bar late` : "";
  return `${first}${pressure}${late}.`;
}

export function cupOnsetSentence(facts: ShotFacts): string | null {
  const { firstSustainedBeverage, cupRateAfterOnsetGS } = facts.phaseEvidence;
  const onset = firstSustainedBeverage.value;
  if (!onset) return null;
  const elapsed = onset.brewElapsedS.toFixed(1);
  const rate = cupRateAfterOnsetGS.value;
  const crossing = onset.previousBelowGramS == null ? `The first usable reading of at least 1 g was at ${elapsed} s` : `The cup reached 1 g after ${elapsed} s`;
  return `${crossing}${rate == null ? "" : `, then gained about ${rate.toFixed(1)} g/s`}.`;
}

const FAST = ["gushed", "pressure_shortfall", "fast_shot"];
const SLOW = ["choked", "flow_shortfall", "slow_shot"];

export function fastReason(kinds: string[]): string {
  const why = [
    kinds.includes("fast_shot") && "the shot ran faster than its expected window",
    kinds.includes("pressure_shortfall") && "pressure fell short of the profile's target",
    kinds.includes("gushed") && "flow gushed well above its target",
  ].filter(Boolean) as string[];
  return `${capitalize(joinAnd(why))}, consistent with low puck resistance. Try one small finer step with dose and yield fixed; look for more pressure or a slower pour, then taste before changing again.`;
}

export function slowReason(kinds: string[]): string {
  const why = [
    kinds.includes("slow_shot") && "the shot ran slower than its expected window",
    kinds.includes("flow_shortfall") && "flow fell short of the profile's target",
    kinds.includes("choked") && "flow stayed very low against high pressure",
  ].filter(Boolean) as string[];
  return `${capitalize(joinAnd(why))}, consistent with a restrictive puck. Try one small coarser step with dose and yield fixed; look for freer flow or a shorter pour, then taste before changing again.`;
}

const capitalize = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;
const joinAnd = (xs: string[]) => xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

/** Only measured evidence and bounded, non-sensory context cross into the curve stage. */
export function curveStageInput(input: ReviewInput, evidence: ReviewEvidence) {
  const type = input.profile?.beverage_type;
  const profile: "espresso" | "manual" | "unknown" = type === "manual" ? "manual" :
    input.profile?.title?.trim() && (!type || type === "espresso") ? "espresso" : "unknown";
  return {
    evidence, profile,
    earlyStop: stoppedEarly(evidence.analysis.facts),
    bean: input.bean ? { roastLevel: input.bean.roastLevel?.value ?? null, processKind: input.bean.processKind ?? null } : null,
  };
}

export type CurveStageInput = ReturnType<typeof curveStageInput>;

function prioritizedIssues(issues: ShotReviewData["issues"]) {
  const priority = (kind: string) => kind === "fast_shot" || kind === "slow_shot" ? 1 : 0;
  const severity = { warning: 0, caution: 1, info: 2 };
  return [...issues].sort((a, b) => priority(a.kind) - priority(b.kind) ||
    severity[a.severity] - severity[b.severity] || (a.fromS ?? 0) - (b.fromS ?? 0)).slice(0, 12);
}

function curveSummary(stage: CurveStageInput) {
  const { evidence, profile, earlyStop } = stage;
  const { facts, metrics, issues, wentWell, faultWindows } = evidence.analysis;
  const { phases } = facts.phaseEvidence;
  const measured = phases.filter(p => p.controlledError.value != null).sort((a, b) => b.controlledError.coveredS - a.controlledError.coveredS)[0];
  const hasRecording = metrics.enoughTelemetry || metrics.observedWindows > 0;
  if (!hasRecording) {
    if (!metrics.recordedPoints) return "No shot curve was recorded.";
    const shortYield = facts.targetYieldG != null && facts.yieldG != null && facts.yieldG < 0.8 * facts.targetYieldG;
    const limit = shortYield && earlyStop ? "This shot was stopped early, so a full repeat is needed to assess the curve." :
      "This recording is too short or sparse for a reliable curve assessment.";
    return measured?.controlledError.coveredS >= 1 ? `${limit} ${shortPhaseSentence(measured)}` : limit;
  }
  const main = phases.filter(p => p.substate == null || /^pour/i.test(p.substate))
    .reduce<(typeof phases)[number] | null>((best, p) => p.steadyHold.value && (!best || p.durationS > best.durationS) ? p : best, null);
  const highFlow = main?.mode.value === "flow" && (main.steadyHold.value?.meanCommand ?? 0) > 3;
  const tracking = highFlow ? highFlowSentence(main) : trackingSentence(facts, new Set(faultWindows.map(w => w.frame)));
  const hydraulicIssue = issues.some(i => !["off_target_temp", "fast_shot", "slow_shot"].includes(i.kind));
  const lines: (string | null)[] = [];
  if (tracking) lines.push(tracking);
  else if (hydraulicIssue) lines.push("Pressure or flow stayed well away from the profile's target for a sustained stretch.");
  else if (wentWell.length) lines.push("Where a step held a steady target, pressure or flow followed it without a sustained problem.");
  else if (metrics.observedWindows) lines.push("Where a step held a steady target, pressure or flow missed it by more than a fifth, though not by enough to call a fault.");
  else if (profile === "manual") lines.push("Manual control has no fixed automatic target to judge.");
  else if (measured) lines.push(shortPhaseSentence(measured));
  else if (facts.peakPressureBar != null) lines.push(`Pressure peaked at ${facts.peakPressureBar.toFixed(1)} bar. A target comparison needs reliable phase data.`);
  else lines.push("The recording lacks enough paired target and response data for comparison.");
  if (issues.some(i => i.kind === "channeling")) lines.push("Inlet flow rose gradually while pressure held near its target.");
  lines.push(cupOnsetSentence(facts));
  if (issues.some(i => i.kind === "off_target_temp") && metrics.meanTemperatureOffsetC != null) {
    const d = metrics.meanTemperatureOffsetC;
    lines.push(`Temperature averaged ${Math.abs(d).toFixed(1)} °C ${d > 0 ? "above" : "below"} its target.`);
  }
  const recovery = (main ?? measured)?.temperature.value?.lateMedianOffsetC.value;
  if (highFlow && recovery != null && Math.abs(recovery) >= 0.05) {
    lines.push(`Late in the pour, temperature was ${Math.abs(recovery).toFixed(1)} °C ${recovery > 0 ? "above" : "below"} target.`);
  }
  if (profile === "unknown") lines.push("Check the recorded profile before comparing targets or changing grind.");
  return lines.filter(Boolean).join(" ");
}

/** Mechanical conclusions and the initial experiment are fixed before alignment. */
export function rulesCurveReview(stage: CurveStageInput): CurveReview {
  const { evidence, profile } = stage;
  const { facts, metrics, issues, wentWell } = evidence.analysis;
  const kinds = issues.map(i => i.kind);
  const finer = kinds.some(k => FAST.includes(k));
  const coarser = kinds.some(k => SLOW.includes(k));
  let nextShot: DialInAdvice | null = null;
  if (profile === "espresso" && finer !== coarser) {
    nextShot = finer ? grindAdvice("finer", fastReason(kinds)) : grindAdvice("coarser", slowReason(kinds));
  }
  const check = !metrics.recordedPoints ? "Check that Decaid is recording, then repeat the same recipe." :
    !metrics.enoughTelemetry && !metrics.observedWindows ? "Repeat with recording active for the full shot." :
    finer && coarser ? "The mechanical signals point toward opposite grind changes. Repeat this recipe with consistent puck prep." :
    profile === "manual" ? "Repeat the same controller sequence and compare the pressure and flow." :
    profile === "unknown" ? "Check which profile was recorded before changing grind." :
    evidence.history.curves.phase ? "Repeat the same setup and check whether the cup fill and pressure crest recur." :
    "Repeat the same recipe with consistent puck prep and check whether the pour repeats.";
  return {
    summary: curveSummary(stage),
    history: historyCurveSentence(evidence.history),
    timing: [paceSentence(facts), historySentence(evidence.history)].filter(Boolean).join(" ") || null,
    wentWell, issues: prioritizedIssues(issues), finer, coarser,
    confidence: metrics.observedWindows > 0 && (issues.length > 0 || wentWell.length > 0) ? "medium" : "low",
    limitation: "Shot curves show how the machine and puck responded. They cannot identify the cause of a change or tell you how the shot tasted.",
    nextShot, check, narrative: null,
  };
}

/** Keep the original review fields usable by older skins and saved reports. */
export function finishReview(input: ReviewInput, stage: CurveStageInput, curve: CurveReview, source: string, notes?: Parameters<typeof alignTaste>[2]): ReviewResult {
  const { alignment, nextShot, askTaste } = alignTaste(input, curve, notes, stage.profile === "espresso");
  const summary = [curve.summary, curve.history, curve.timing, curve.narrative?.text, alignment.summary,
    nextShot ? null : alignment.check].filter(Boolean).join(" ");
  const review = { summary, issues: curve.issues, wentWell: curve.wentWell, confidence: curve.confidence, nextShot, askTaste };
  return { review, curve, taste: alignment, source, evidence: projectReviewEvidence(stage.evidence) };
}

export function rulesReview(input: ReviewInput, evidence = buildReviewEvidence(input)): ShotReviewData {
  const stage = curveStageInput(input, evidence);
  return finishReview(input, stage, rulesCurveReview(stage), "rules").review;
}

export function rulesReviewResult(input: ReviewInput, fullTrace?: FullReviewTrace): ReviewResult {
  const stage = curveStageInput(input, buildReviewEvidence(input, fullTrace));
  return finishReview(input, stage, rulesCurveReview(stage), "rules");
}
