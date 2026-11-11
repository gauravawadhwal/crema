import { analyzeShot, type ShotAnalysis, type ShotFacts } from "../profiles/analysis.js";
import type { ReviewInput, ShotReviewData } from "./review-types.js";
import type { DialInAdvice } from "../schema.js";

function grindAdvice(direction: "finer" | "coarser", reason: string): DialInAdvice {
  const finer = direction === "finer";
  return {
    change: finer ? "Grind finer" : "Grind coarser",
    grindDelta: finer ? "finer" : "coarser",
    yieldDeltaG: 0, tempDeltaC: 0, switchProfile: null, reasoning: reason,
  };
}

function tasteAdvice(input: ReviewInput): DialInAdvice | null {
  const f = input.feedback;
  if (!f) return null;
  if (f.sourBitter <= -1) return grindAdvice("finer", "The shot tasted sour; finer grinding is a small extraction adjustment.");
  if (f.sourBitter >= 1) return grindAdvice("coarser", "The shot tasted bitter; coarser grinding is a small extraction adjustment.");
  if (f.body <= -1) return { change: "Shorten the yield by 3 g for more body", grindDelta: "same", yieldDeltaG: -3, tempDeltaC: 0, switchProfile: null, reasoning: "The shot tasted thin; a slightly shorter yield may add body." };
  if (f.body >= 2) return { change: "Lengthen the yield by 3 g for more clarity", grindDelta: "same", yieldDeltaG: 3, tempDeltaC: 0, switchProfile: null, reasoning: "The shot tasted heavy; a slightly longer yield may add clarity." };
  if (f.sourBitter === 0 && f.body === 0) return { change: "Keep it as it is", grindDelta: "same", yieldDeltaG: 0, tempDeltaC: 0, switchProfile: null, reasoning: "You marked the taste and body as balanced." };
  return null;
}

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

function rulesSummary(a: ShotAnalysis, direction: "finer" | "coarser" | null = null): string {
  const curveIssue = a.issues.some((i) => !["off_target_temp", "fast_shot", "slow_shot"].includes(i.kind));
  const temp = a.issues.find((i) => i.kind === "off_target_temp");
  const lines = [paceSentence(a.facts) ?? factsSentence(a.facts)];
  const tracking = trackingSentence(a.facts);
  if (!a.metrics.enoughTelemetry && !a.metrics.observedWindows) lines.push("There is not enough telemetry to draw a conclusion from this shot.");
  else if (tracking) lines.push(tracking);
  else if (curveIssue) lines.push("Pressure or flow stayed well away from the profile's target for a sustained stretch.");
  else if (a.wentWell.length) lines.push("Where a step held a steady target, pressure or flow followed it without a sustained problem.");
  else if (a.metrics.observedWindows) lines.push("Where a step held a steady target, pressure or flow missed it by more than a fifth, though not by enough to call a fault.");
  else lines.push("No step held a steady target long enough to compare, so this describes the shot rather than grading it.");
  if (a.issues.some((i) => i.kind === "channeling")) lines.push("Flow rose steadily through the pour, which can mean the water found a channel.");
  if (temp && a.metrics.meanTemperatureOffsetC != null) {
    const d = a.metrics.meanTemperatureOffsetC;
    lines.push(`Temperature averaged ${Math.abs(d).toFixed(1)} °C ${d > 0 ? "above" : "below"} its target.`);
  }
  if (direction === "finer") lines.push("Grind finer to add resistance, slow the shot and build pressure.");
  if (direction === "coarser") lines.push("Grind coarser to open up flow and speed the shot up.");
  return lines.filter(Boolean).join(" ");
}

const grams = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} g`;

/** Pace against the expected time window, when there is one to compare with. */
export function paceSentence(f: ShotFacts): string | null {
  if (!f.expectedTimeS || f.durationS == null || f.timeStatus == null || f.timeDeltaS == null) return null;
  const [lo, hi] = f.expectedTimeS;
  const ran = Math.round(f.durationS);
  const off = Math.abs(Math.round(f.timeDeltaS));
  const detail = f.yieldG != null ? `${ran} s to ${grams(f.yieldG)}` : `${ran} s`;
  if (f.timeStatus === "in_window" || off < 1) return `Finished in ${ran} s, ${f.timeStatus === "in_window" ? "right in" : "at the edge of"} the ${lo}–${hi} s target window.`;
  return `Ran ${off} s ${f.timeStatus === "fast" ? "faster" : "slower"} than the ${lo}–${hi} s target window (${detail}).`;
}

/** Whether the main pour step reached its pressure or flow target, in numbers. */
export function trackingSentence(f: ShotFacts): string | null {
  const main = [...f.pourSteps].sort((a, b) => b.durationS - a.durationS)[0];
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
  const atLimit = main.limiterValue != null && main.otherMean != null && main.otherMean >= 0.85 * main.limiterValue;
  if (short || main.limiterEngaged) {
    const why = main.limiterEngaged
      ? pressure ? `, held back by the ${main.limiterValue} ml/s flow limit: the puck gave too little resistance` : `, held back by the ${main.limiterValue} bar pressure limit: the puck was too restrictive`
      : "";
    return `Pour ${name} only reached ${n(main.actualMean)} ${unit} of the ${n(main.target)} ${unit} target${at}${why}.`;
  }
  if (Math.abs(ratio - 1) <= 0.1) return `${pressure ? "Pressure" : "Flow"} held ${n(main.actualMean)} ${unit} against the ${n(main.target)} ${unit} target${at}.`;
  const limitNote = atLimit && gap > 0 ? `, with ${pressure ? "flow" : "pressure"} at its ${main.limiterValue} ${otherUnit} limit as the profile allows` : "";
  return `Pour ${name} averaged ${n(main.actualMean)} ${unit} against the ${n(main.target)} ${unit} target${at}${limitNote}.`;
}

const FAST = ["gushed", "pressure_shortfall", "fast_shot"];
const SLOW = ["choked", "flow_shortfall", "slow_shot"];

function fastReason(kinds: string[]): string {
  const why = [
    kinds.includes("fast_shot") && "the shot ran faster than its expected window",
    kinds.includes("pressure_shortfall") && "pressure fell short of the profile's target",
    kinds.includes("gushed") && "flow gushed well above its target",
  ].filter(Boolean) as string[];
  return `${capitalize(joinAnd(why))}, so the puck gave too little resistance; a small finer step should slow it and build pressure.`;
}

function slowReason(kinds: string[]): string {
  const why = [
    kinds.includes("slow_shot") && "the shot ran slower than its expected window",
    kinds.includes("flow_shortfall") && "flow fell short of the profile's target",
    kinds.includes("choked") && "flow stayed very low against high pressure",
  ].filter(Boolean) as string[];
  return `${capitalize(joinAnd(why))}, so the puck was too restrictive; a small coarser step should open up flow and speed it up.`;
}

const capitalize = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;
const joinAnd = (xs: string[]) => xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

/** Deterministic, local shot review. It never changes machine settings. */
export function rulesReview(input: ReviewInput): ShotReviewData {
  const analysis = analyzeShot(input);
  const issues = analysis.issues;
  const kinds = issues.map((i) => i.kind);
  // Signs of too little puck resistance (grind finer) and too much (grind coarser).
  const hasFast = kinds.some((k) => FAST.includes(k));
  const hasSlow = kinds.some((k) => SLOW.includes(k));
  const manual = input.profile?.beverage_type === "manual";
  let nextShot: DialInAdvice | null = null;
  let conflict = false;

  if (input.feedback) {
    const tasted = tasteAdvice(input);
    // A mechanical curve and taste can point to opposite grind changes. Keep
    // the evidence visible, but don't pick a blind direction between them.
    conflict = (hasSlow && input.feedback.sourBitter <= -1) || (hasFast && input.feedback.sourBitter >= 1);
    const explicitBalance = input.feedback.sourBitter === 0 && input.feedback.body === 0;
    if (!conflict && (explicitBalance || (!manual && input.profile != null))) nextShot = tasted;
  } else if (!manual && input.profile != null && hasFast && !hasSlow) {
    nextShot = grindAdvice("finer", fastReason(kinds));
  } else if (!manual && input.profile != null && hasSlow && !hasFast) {
    nextShot = grindAdvice("coarser", slowReason(kinds));
  }

  const direction = nextShot?.grindDelta.endsWith("finer") ? "finer" : nextShot?.grindDelta.endsWith("coarser") ? "coarser" : null;
  const summary = rulesSummary(analysis, input.feedback ? null : direction);
  let confidence: ShotReviewData["confidence"] = "low";
  if (analysis.metrics.observedWindows >= 1 && (input.feedback || issues.length)) confidence = "medium";
  if (analysis.metrics.observedWindows >= 2 && input.feedback && !conflict && issues.length <= 1) confidence = "high";
  if (conflict) confidence = "low";
  return {
    summary,
    wentWell: analysis.wentWell,
    issues,
    nextShot,
    confidence,
    askTaste: input.feedback == null,
  };
}
