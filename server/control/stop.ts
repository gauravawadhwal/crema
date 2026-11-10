/**
 * Why a finished shot stopped. Decaid's shot record carries `stopReason` for shots
 * its sequencer ran; that is used when present. Without it (older records, shots
 * Decaid did not sequence, the demo) the reason is inferred from what is known,
 * and "unknown" is preferred over a guess. Pure, and returns values, not copy.
 */
import type { ProfileStepLike } from "../profiles/curve.js";
import { stepTimes, type StepPoint } from "./steps.js";

export type StopReason =
  /** The target yield was reached on the scale. */
  | "weight"
  /** The target volume was reached. */
  | "volume"
  /** Someone stopped it from an app: Crema, another client of Decaid's API, or Decaid's own screen. */
  | "user"
  /** The profile's last step ran out. */
  | "profile"
  /** The machine reported the end and nothing says why: the group-head control, the profile ending, or firmware stop-at-weight. */
  | "machine"
  | "error"
  | "unknown";

export interface StopReasonInput {
  /** `stopReason` from Decaid's shot record, if it has one. */
  recorded?: string | null;
  /** Crema sent Stop during this shot. */
  stoppedByCrema?: boolean;
  /** The final weight in the cup, g. */
  finalWeightG?: number | null;
  /** The yield the shot was set to stop at, g. Null or 0 when stop-at-weight was off. */
  targetYieldG?: number | null;
  /** False when stop-at-weight could not have acted (no scale). Defaults to true. */
  stopAtWeight?: boolean;
  /** The profile's steps and the shot's samples, to tell whether the last step ran to its time limit. */
  steps?: ProfileStepLike[] | null;
  points?: StepPoint[] | null;
}

export interface StopReasonResult {
  reason: StopReason;
  /** "recorded": from Decaid's record. "inferred": worked out here. */
  source: "recorded" | "inferred";
  /** The final weight is within the window around the target. Null when either is missing. For "stopped near target" when the reason is unknown. */
  nearTarget: boolean | null;
}

/** Decaid's persisted values (open set: anything else falls through to inference). */
const RECORDED: Record<string, StopReason> = {
  targetWeight: "weight", targetVolume: "volume", apiStop: "user", appStop: "user", machineEnded: "machine", error: "error",
};

/** Decaid stops on projected weight, so the cup ends a little either side of the target. */
export const NEAR_TARGET_UNDER_G = 3;
export const NEAR_TARGET_OVER_G = 3;
/** The last step counts as run out when the shot ended this close to its time limit. */
const LIMIT_SLACK_S = 0.5;

function lastStepRanOut(steps: ProfileStepLike[] | null | undefined, points: StepPoint[] | null | undefined): boolean {
  if (!steps?.length || !points?.length) return false;
  const { index, start, lastT } = stepTimes(points, steps.length);
  if (index !== steps.length - 1 || lastT == null) return false;
  const limit = Number(steps[index].seconds);
  return Number.isFinite(limit) && limit > 0 && lastT - start[index]! >= limit - LIMIT_SLACK_S;
}

export function stopReason(i: StopReasonInput): StopReasonResult {
  const w = i.finalWeightG, target = i.targetYieldG;
  const comparable = w != null && Number.isFinite(w) && target != null && Number.isFinite(target) && target > 0;
  const nearTarget = comparable ? w! >= target! - NEAR_TARGET_UNDER_G && w! <= target! + NEAR_TARGET_OVER_G : null;
  const ranOut = lastStepRanOut(i.steps, i.points);

  const known = i.recorded ? RECORDED[i.recorded] : undefined;
  if (known) {
    // "machineEnded" covers several causes; the samples can settle one of them.
    return { reason: known === "machine" && ranOut && !nearTarget ? "profile" : known, source: "recorded", nearTarget };
  }
  const inferred = (reason: StopReason): StopReasonResult => ({ reason, source: "inferred", nearTarget });
  if (i.stoppedByCrema) return inferred("user");
  // At the target just as the last step ran out: either could have ended it.
  if (nearTarget && ranOut) return inferred("unknown");
  if (nearTarget && i.stopAtWeight !== false) return inferred("weight");
  if (ranOut) return inferred("profile");
  return inferred("unknown");
}
