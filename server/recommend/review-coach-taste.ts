import type { CoachMechanics, CoachReview, DialInAdvice } from "../schema.js";
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

export function coachRecommendation(curve: CurveReview, alignment: TasteAlignment, advice: DialInAdvice | null,
  taste: CoachReview["taste"], mechanics: CoachMechanics, knownEspresso: boolean): Recommendation {
  const repeat = (action: string, compare: string, puckCheck: Recommendation["puckCheck"] = null): Recommendation =>
    ({ action, expect: "Keep your recipe and other prep the same.", compare, puckCheck, adjustment: null });
  if (alignment.status === "conflicts" || taste?.links.some(link => link.status === "does_not_match")) {
    return repeat("Repeat the same shot and taste it again.", "Check whether the same pour and taste recur before moving the grinder.");
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
  if (!mechanics.phases.some(p => p.verdict !== "not_graded")) {
    return repeat("Repeat the recipe with recording active.", "Check that the next recording shows each phase before judging the curve.");
  }
  return repeat("Repeat the same recipe.", "Compare when the cup starts filling and how the pour and taste repeat.");
}
