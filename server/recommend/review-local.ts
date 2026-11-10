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

function rulesSummary(a: ShotAnalysis): string {
  const curveIssue = a.issues.some((i) => i.kind !== "off_target_temp");
  const temp = a.issues.find((i) => i.kind === "off_target_temp");
  const lines = [factsSentence(a.facts)];
  if (!a.metrics.enoughTelemetry && !a.metrics.observedWindows) lines.push("There is not enough telemetry to draw a conclusion from this shot.");
  else if (curveIssue) lines.push("Pressure or flow stayed well away from the profile's target for a sustained stretch.");
  else if (a.wentWell.length) lines.push("Where a step held a steady target, pressure or flow followed it without a sustained problem.");
  else if (a.metrics.observedWindows) lines.push("Where a step held a steady target, pressure or flow missed it by more than a fifth, though not by enough to call a fault.");
  else lines.push("No step held a steady target long enough to compare, so this describes the shot rather than grading it.");
  if (temp && a.metrics.meanTemperatureOffsetC != null) {
    const d = a.metrics.meanTemperatureOffsetC;
    lines.push(`Temperature averaged ${Math.abs(d).toFixed(1)} °C ${d > 0 ? "above" : "below"} its target.`);
  }
  return lines.filter(Boolean).join(" ");
}

/** Deterministic, local shot review. It never changes machine settings. */
export function rulesReview(input: ReviewInput): ShotReviewData {
  const analysis = analyzeShot(input);
  const issues = analysis.issues;
  const hasChoke = issues.some((i) => i.kind === "choked");
  const hasGush = issues.some((i) => i.kind === "gushed");
  const manual = input.profile?.beverage_type === "manual";
  let nextShot: DialInAdvice | null = null;
  let conflict = false;

  if (input.feedback) {
    const tasted = tasteAdvice(input);
    // A mechanical curve and taste can point to opposite grind changes. Keep
    // the evidence visible, but don't pick a blind direction between them.
    conflict = (hasChoke && input.feedback.sourBitter <= -1) || (hasGush && input.feedback.sourBitter >= 1);
    const explicitBalance = input.feedback.sourBitter === 0 && input.feedback.body === 0;
    if (!conflict && (explicitBalance || (!manual && input.profile != null))) nextShot = tasted;
  } else if (!manual && hasChoke && !hasGush) {
    nextShot = grindAdvice("coarser", "Flow was persistently very low during a steady pressure hold; a small coarser step may reduce resistance.");
  } else if (!manual && hasGush && !hasChoke) {
    nextShot = grindAdvice("finer", "Flow or pressure was far from the profile target for a sustained window; a small finer step may add resistance.");
  }

  const summary = rulesSummary(analysis);
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
