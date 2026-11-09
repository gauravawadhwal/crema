import { analyzeShot } from "../profiles/analysis.js";
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

  const summary = issues.length
    ? "The recorded curves show a sustained difference from the profile in at least one part of the shot."
    : analysis.metrics.observedWindows
      ? "No sustained curve issue stood out in the recorded, comparable parts of the profile."
      : "There is not enough comparable telemetry to draw a conclusion from this shot.";
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
