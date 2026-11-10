/**
 * The arithmetic behind how much of a bag is left. Decaid doesn't reduce a batch's
 * weightRemaining when a shot is pulled, so Crema counts it: the bag's weight, less
 * the doses of espresso shots recorded against it, plus a correction. Pure; the
 * reads and the correction's write stay in skin/app.js (`bagUse`).
 */

export interface ShotDose {
  annotations?: { actualDoseWeight?: number | null } | null;
  workflow?: { context?: { targetDoseWeight?: number | null } | null } | null;
}

/** Grams used: the recorded dose, else the target dose, else 0, summed. `null` when the shots couldn't be read. */
export const gramsUsed = (shots: ShotDose[] | null): number | null =>
  shots ? shots.reduce((sum, s) => sum + (s.annotations?.actualDoseWeight ?? s.workflow?.context?.targetDoseWeight ?? 0), 0) : null;

export interface BagState { adjust?: number | null; written?: number | null }

export interface BagInput {
  used: number | null;
  /** The bag's weight on the batch. */
  weight: number | null;
  /** What Decaid now says is left. */
  weightRemaining: number | null | undefined;
  /** Crema's record for the bag: the correction and what it last wrote. */
  state: BagState;
}

export interface BagResult {
  adjust: number;
  remaining: number | null;
  /** weightRemaining was changed elsewhere since Crema wrote it: `adjust` is the new correction and `weightRemaining` should be recorded as written. */
  corrected: boolean;
}

export function bagRemaining(i: BagInput): BagResult {
  let adjust = i.state.adjust ?? 0;
  let corrected = false;
  if (i.used != null && i.weight != null && i.weightRemaining != null && i.state.written != null && Math.abs(i.weightRemaining - i.state.written) > 0.5) {
    adjust = i.weightRemaining - (i.weight - i.used);
    corrected = true;
  }
  const remaining = i.weight != null && i.used != null ? Math.max(0, Math.round(i.weight - i.used + adjust)) : i.used == null ? null : i.weightRemaining ?? null;
  return { adjust, remaining, corrected };
}
