import type { DialInAdvice } from "../schema.js";
import type { CurveReview, ReviewInput, TasteAlignment } from "./review-types.js";

export function grindAdvice(direction: "finer" | "coarser", reason: string): DialInAdvice {
  const finer = direction === "finer";
  return {
    change: finer ? "Grind finer" : "Grind coarser",
    grindDelta: finer ? "finer" : "coarser",
    yieldDeltaG: 0, tempDeltaC: 0, switchProfile: null, reasoning: reason,
  };
}

export function tasteAdvice(f: ReviewInput["feedback"]): DialInAdvice | null {
  if (!f) return null;
  if (f.sourBitter != null && f.sourBitter <= -1) return grindAdvice("finer", "You reported sourness. Try one small finer step with dose and yield fixed; taste whether the sharpness softens before changing again.");
  if (f.sourBitter != null && f.sourBitter >= 1) return grindAdvice("coarser", "You reported bitterness. Try one small coarser step with dose and yield fixed; taste whether the bitter finish softens before changing again.");
  if (f.body != null && f.body <= -1) return { change: "Shorten the yield by 3 g for more body", grindDelta: "same", yieldDeltaG: -3, tempDeltaC: 0, switchProfile: null, reasoning: "The shot tasted thin; a slightly shorter yield may add body." };
  if (f.body != null && f.body >= 2) return { change: "Lengthen the yield by 3 g for more clarity", grindDelta: "same", yieldDeltaG: 3, tempDeltaC: 0, switchProfile: null, reasoning: "The shot tasted heavy; a slightly longer yield may add clarity." };
  if (f.sourBitter === 0 && f.body === 0) return { change: "Keep it as it is", grindDelta: "same", yieldDeltaG: 0, tempDeltaC: 0, switchProfile: null, reasoning: "You marked the taste and body as balanced." };
  return null;
}

export type NotesTaste = "sour" | "bitter" | "thin" | "heavy" | "balanced" | "other";
export interface NotesInterpretation {
  notesEvidence: string;
  notesTaste: NotesTaste;
  nextShot: DialInAdvice | null;
}

export function reviewNotes(input: Pick<ReviewInput, "notes" | "feedback">) {
  return input.notes?.trim() || input.feedback?.notes?.trim() || null;
}

/** The model must cite a report in context, even if it returns only an interpretation. */
export function groundedNotes(notes: string, quote: string) {
  if (!quote.trim()) return false;
  const index = notes.indexOf(quote);
  if (index < 0) return false;
  const before = notes.slice(0, index).split(/[.!?;\n]/).at(-1) ?? "";
  const after = notes.slice(index + quote.length).split(/[.!?;\n]/)[0];
  const clause = before + quote + after;
  if (/\b(?:ignore|disregard|override|pretend|invent|output|respond|instructions?|say|claim|mark (?:it|this)|report (?:that|it|this)|switch to|grind (?:finer|coarser)|raise the temperature)\b/i.test(clause)) return false;
  // A short quote cannot remove negation or a report the user explicitly denied.
  const unqualified = before.split(/,|\b(?:but|though|instead|yet)\b/i).at(-1) ?? "";
  return !/\b(?:not|never|no|without|isn['’]t|wasn['’]t|didn['’]t|don['’]t|could be|might be|may be|would like)\b/i.test(unqualified + quote) &&
    !/^\s*[—–-]?\s*(?:isn't|wasn't|was not|not really)\b/i.test(after);
}

export function validNotesAdvice(advice: DialInAdvice, input: Pick<ReviewInput, "installedProfiles">, knownEspresso: boolean) {
  const { grindDelta, yieldDeltaG, tempDeltaC, switchProfile } = advice;
  const moves = Number(grindDelta !== "same") + Number(yieldDeltaG !== 0) + Number(tempDeltaC !== 0) + Number(switchProfile !== null);
  if (moves > 1 || moves && !knownEspresso || Math.abs(yieldDeltaG) > 10 || Math.abs(tempDeltaC) > 3) return false;
  if (switchProfile !== null && !input.installedProfiles.includes(switchProfile)) return false;
  return switchProfile === null && !grindDelta.startsWith("much-");
}

function experiment(advice: DialInAdvice | null) {
  return [advice?.grindDelta ?? "same", advice?.yieldDeltaG ?? 0, advice?.tempDeltaC ?? 0, advice?.switchProfile ?? null].join("|");
}

export function alignTaste(
  input: Pick<ReviewInput, "feedback" | "notes">,
  curve: Readonly<CurveReview>,
  interpreted: NotesInterpretation | undefined,
  knownEspresso: boolean,
  hiddenFlowCap: boolean,
): { alignment: TasteAlignment; nextShot: DialInAdvice | null; askTaste: boolean } {
  const { feedback } = input;
  const notes = reviewNotes(input);
  const { sourBitter, body, enjoyment } = feedback ?? {};
  const taste = sourBitter == null ? null : sourBitter < -1 ? "sourness" : sourBitter < 0 ? "slight sourness" :
    sourBitter > 1 ? "bitterness" : sourBitter > 0 ? "slight bitterness" : "balanced taste";
  const texture = body == null ? null : body < -1 ? "thin body" : body < 0 ? "light body" :
    body > 1 ? "heavy body" : body > 0 ? "rich body" : "balanced body";
  const explicit = !!(taste || texture);
  const sensory = explicit ? null : interpreted?.notesTaste;
  const recorded = [taste, texture, enjoyment == null ? null : `${enjoyment}/10 enjoyment`].filter(Boolean);
  if (sensory && sensory !== "other") recorded.push(`${sensory} in the saved note`);
  const finer = (sourBitter ?? 0) <= -1 || sensory === "sour";
  const coarser = (sourBitter ?? 0) >= 1 || sensory === "bitter";
  const conflicts = finer && curve.coarser || coarser && curve.finer;
  const agrees = !conflicts && (finer && curve.finer || coarser && curve.coarser);
  const status = conflicts ? "conflicts" : agrees ? "agrees" : notes && !explicit && (!sensory || sensory === "other") ?
    "uninterpreted_notes" : recorded.length ? "no_direction" : "absent";
  const tasted = tasteAdvice(feedback);
  let nextShot = curve.nextShot;
  let check = curve.check;
  if (conflicts) {
    nextShot = null;
    check = "Repeat this recipe with consistent puck prep and taste again before changing grind.";
  } else if (explicit) {
    nextShot = knownEspresso || sourBitter === 0 && body === 0 ? tasted : null;
  } else if (notes) {
    nextShot = interpreted?.nextShot ?? null;
    if (nextShot && (nextShot.grindDelta.endsWith("finer") && (coarser || curve.coarser) ||
        nextShot.grindDelta.endsWith("coarser") && (finer || curve.finer))) {
      nextShot = null;
      check = "Repeat this recipe with consistent puck prep and taste again before changing grind.";
    } else if (!nextShot && agrees) {
      nextShot = curve.nextShot;
    } else if (!nextShot) {
      check = "Repeat this recipe and confirm taste before changing a setting.";
    }
  }
  if (hiddenFlowCap && nextShot?.grindDelta.endsWith("finer")) {
    nextShot = null;
    check = "Repeat the shot and see whether pressure and flow drop together again.";
  }

  const changesExperiment = experiment(nextShot) !== experiment(curve.nextShot);
  const relation: Record<TasteAlignment["status"], string> = {
    absent: "No taste was recorded. The next step follows the curve read.",
    agrees: "The reported taste and curve support the same grind direction.",
    conflicts: "The reported taste and curve point toward opposite grind changes.",
    no_direction: "These ratings give no independent confirmation of the curve read.",
    uninterpreted_notes: "The saved note leaves taste alignment uncertain.",
  };
  const effect = status === "absent" ? "" : conflicts || changesExperiment && !nextShot ? " This changes the next step to a repeat." :
    changesExperiment ? " This changes the proposed next experiment." : " The proposed experiment stays the same.";
  const summary = `${recorded.length ? `Recorded ${recorded.join(", ")}. ` : ""}${relation[status]}${effect}`;
  return {
    alignment: { status, summary, notes, changesExperiment, check: !nextShot || experiment(nextShot) === experiment(null) ? check : null },
    nextShot, askTaste: sourBitter == null || body == null,
  };
}
