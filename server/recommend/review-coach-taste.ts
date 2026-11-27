import type { CoachMechanics, CoachReview, DialInAdvice } from "../schema.js";
import { pressureLimitedPour } from "./review-coach.js";
import type { CurveStageInput } from "./review-local.js";
import { reviewNotes, type NotesInterpretation } from "./review-taste.js";
import type { CurveReview, ReviewInput, TasteAlignment } from "./review-types.js";

type RecordedTaste = NonNullable<CoachReview["taste"]>;
type Recommendation = CoachReview["recommendation"];

const flavor = ["sour", "slightly sour", "balanced", "slightly bitter", "bitter"];
const bodyWords = ["thin", "light-bodied", "balanced in body", "rich", "heavy"];

function tasteLink(hypothesis: CoachMechanics["hypotheses"][number], submitted: string | null,
  sourBitter: number | null, body: number | null): RecordedTaste["links"][number] {
  const hypothesisId = hypothesis.id;
  if (hypothesis.signature === "none" || !submitted) return { hypothesisId, status: "no_link", sentence: null };
  const direction = hypothesis.signature === "sour_thin" ? -1 : 1;
  const axes = [sourBitter, body].map(value => (value ?? 0) * direction);
  // Mixed directional reports are a conflict for advice, even when one axis fits.
  if (axes.some(value => value < 0)) return {
    hypothesisId, status: "does_not_match",
    sentence: `You said it tasted ${submitted}, which doesn't fully fit the ${hypothesis.label.toLowerCase()} above, where ${direction < 0 ?
      "sourness or a thin body" : "bitterness or a heavy body"} would be more typical.`,
  };
  if (axes.some(value => value > 0)) return {
    hypothesisId, status: "matches",
    sentence: `You said it tasted ${submitted}, which fits the ${hypothesis.label.toLowerCase()} above.`,
  };
  return { hypothesisId, status: "no_link", sentence: null };
}

export function coachTaste(input: Pick<ReviewInput, "feedback" | "notes">, mechanics: CoachMechanics,
  interpreted?: NotesInterpretation): RecordedTaste | null {
  const { sourBitter = null, body = null, enjoyment = null } = input.feedback ?? {};
  const notes = reviewNotes(input);
  if (sourBitter == null && body == null && enjoyment == null && !notes) return null;
  const descriptors = sourBitter === 0 && body === 0 ? ["balanced"] :
    [sourBitter == null ? null : flavor[sourBitter + 2], body == null ? null : bodyWords[body + 2]].filter(Boolean);
  const submitted = descriptors.join(" and ") || null;
  const links = mechanics.hypotheses.map(h => tasteLink(h, submitted, sourBitter, body));
  const linked = links.filter(link => link.sentence);
  const relation = links.flatMap((link, i) => link.sentence ? [
    `${link.status === "matches" ? "fits" : "doesn't fully fit"} the ${mechanics.hypotheses[i].label.toLowerCase()} above`,
  ] : []);
  const reported = linked.length === 1 ? linked[0].sentence : submitted ? `You said it tasted ${submitted}${relation.length ? `, which ${relation.join(" and ")}` : ""}.` :
    !notes && enjoyment != null ? `You rated it ${enjoyment}/10 for enjoyment.` : null;
  return { sourBitter, body, enjoyment, notes, noteQuote: interpreted?.notesEvidence ?? null, reported, links };
}

const repeat = (action: string, expect: string, compare: string): Recommendation =>
  ({ action, expect, compare, puckCheck: null, adjustment: null });

const rounded = (n: number) => Number(n.toFixed(1));

/** One check against this recording, with no taste assumptions or recipe change. */
export function repeatRecommendation(stage: CurveStageInput): Recommendation {
  const { facts, metrics } = stage.evidence.analysis;
  const { scaleAvailability: scale, firstSustainedBeverage: { value: onset }, phases } = facts.phaseEvidence;
  if (scale.gap || scale.jump || metrics.enoughTelemetry && !scale.weightSamples) {
    return repeat("Repeat to verify that your scale records the full shot.",
      scale.dropout ? "The scale cut out before this shot finished." :
        scale.jump ? "The running cup weight jumped on this shot." :
        scale.gap ? "The cup weight was missing for part of this shot." : "This shot came through without cup weights.",
      "Look for a continuous weight reading through the stop.");
  }
  if (stage.earlyStop) {
    const where = facts.stopReason?.toLowerCase() === "apistop" ? "from the app" : "by hand";
    if (facts.durationS != null && facts.yieldG != null) {
      const checkpoint = `${rounded(facts.durationS)} s`;
      const weight = `${rounded(facts.yieldG)} g`;
      return repeat(`Repeat at the same settings and check the cup at ${checkpoint}.`,
        `This shot was stopped ${where} at ${checkpoint} with ${weight} in the cup.`,
        `At ${checkpoint}, see whether the cup weighs about ${weight} again.`);
    }
    const when = facts.durationS == null ? "" : ` at ${rounded(facts.durationS)} s`;
    const weight = facts.yieldG == null ? "" : ` with ${rounded(facts.yieldG)} g in the cup`;
    return repeat("Repeat the same recipe and let it run to its planned stop.",
      `This shot was stopped ${where}${when}${weight}.`, "Compare the final cup weight with this shot.");
  }
  const plateau = phases.find(p => p.hiddenFlowPlateau)?.hiddenFlowPlateau;
  if (plateau) {
    return repeat("Repeat at the same settings to check the flow plateau.",
      `This time the inlet settled near ${rounded(plateau.inletFlowMlS)} mL/s as pressure fell.`,
      "See whether pressure and inlet flow drop together again.");
  }
  const shortYield = facts.yieldG != null && facts.targetYieldG != null && facts.yieldG < 0.8 * facts.targetYieldG;
  const extremeRatio = facts.ratio != null && (facts.ratio >= 4 || facts.ratio < 1.2);
  if (facts.yieldG != null && (shortYield || extremeRatio && facts.stopReason?.toLowerCase() !== "targetweight")) {
    return repeat("Repeat at the same settings to check the finished weight.",
      `This shot finished at ${rounded(facts.yieldG)} g${facts.ratio != null ? ` (1:${rounded(facts.ratio)})` : ""}.`,
      "See whether the cup finishes near that weight again.");
  }
  if (phases.some(pressureLimitedPour)) {
    return repeat("Repeat at the same settings to check for the flow shortfall.",
      "This time the machine reached its pressure limit before it could deliver the commanded flow.",
      "See whether flow runs below target at the pressure limit again.");
  }
  if (onset?.previousBelowGramS != null) {
    return repeat("Repeat at the same settings to check when the cup starts filling.",
      `This time the cup reached its first gram at about ${rounded(onset.brewElapsedS)} s.`,
      "See whether the next shot takes about as long to reach its first gram.");
  }
  if (!metrics.enoughTelemetry && !metrics.observedWindows) {
    return repeat("Repeat with recording active.", "This recording gave only a limited view of the pour.",
      "Check that the new recording captures the full shot through the stop.");
  }
  return repeat("Repeat at the same settings to check the pour.",
    "A repeat gives you a second curve at the same settings.", "Compare how closely the main pour follows the plan.");
}

export function coachRecommendation(curve: CurveReview, alignment: TasteAlignment, advice: DialInAdvice | null,
  taste: CoachReview["taste"], mechanics: CoachMechanics, knownEspresso: boolean, repeatCheck: Recommendation): Recommendation {
  if (alignment.status === "conflicts" || taste?.links.some(link => link.status === "does_not_match")) {
    return repeat("Repeat the same shot and taste it again.",
      "Your taste report and the curve give different signals.", "Check whether the same taste comes through on the repeat.");
  }
  if (!knownEspresso) return {
    action: "Repeat with the recorded setup.", expect: "Keep the settings fixed.",
    compare: "Compare pressure and flow if the same profile is recorded again.", puckCheck: null, adjustment: null,
  };
  const adjustment = taste?.sourBitter != null || taste?.body != null || taste?.notes ? advice : curve.nextShot;
  if (adjustment) {
    const { grindDelta, yieldDeltaG, tempDeltaC, switchProfile } = adjustment;
    if (grindDelta === "finer" || grindDelta === "coarser") {
      return {
        action: `Try one small step ${grindDelta}.`,
        expect: grindDelta === "finer" ? "Expect a slower cup fill at the same pressure or more pressure at the same flow." :
          "Expect a faster cup fill at the same pressure or less pressure at the same flow.",
        compare: "Keep dose and yield fixed. Compare cup fill and taste before moving again.", puckCheck: null, adjustment,
      };
    }
    if (yieldDeltaG) return {
      action: `Try ${Math.abs(yieldDeltaG)} g ${yieldDeltaG > 0 ? "more" : "less"} in the cup.`,
      expect: yieldDeltaG > 0 ? "Look for a lighter body." : "Look for a fuller body.",
      compare: "Keep dose, grind and temperature fixed. Taste the two shots side by side if you can.", puckCheck: null, adjustment,
    };
    if (tempDeltaC) return {
      action: `Try brewing ${Math.abs(tempDeltaC)} °C ${tempDeltaC > 0 ? "warmer" : "cooler"}.`,
      expect: tempDeltaC > 0 ? "Look for a softer sharpness." : "Look for a softer bitter finish.",
      compare: "Keep dose, yield and grind fixed. Compare the finish against this shot.", puckCheck: null, adjustment,
    };
    if (switchProfile) return {
      action: `Try ${switchProfile}.`, expect: "Expect a different pressure and flow pattern.",
      compare: "Compare the recorded pour and taste at the same dose and yield.", puckCheck: null, adjustment,
    };
  }
  if ((taste?.sourBitter != null || taste?.body != null || taste?.noteQuote) &&
      (!adjustment || adjustment.grindDelta === "same") && mechanics.hypotheses.some(h => h.id === "freer-late-flow")) {
    return { action: "Check for even distribution before you tamp.", expect: "Look for a more consistent pour from one shot to the next.",
      compare: "Keep grind, dose and yield fixed. Compare whether the flow still picks up late.",
      puckCheck: "even_distribution", adjustment: null };
  }
  return repeatCheck;
}
