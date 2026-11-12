import type { ProfileLike } from "../profiles/curve.js";
import type { BeanInfo, DialInAdvice, TasteFeedback } from "../schema.js";

/** Recorded observations. Null means unavailable, never a measured zero. */
export interface ReviewPoint {
  t: number;
  p: number | null;
  f: number | null;
  w: number | null;
  temp: number | null;
  tp: number | null;
  tf: number | null;
  targetTemp: number | null;
  /** Group (coffee) temperature and its target, when the skin sends them. */
  groupTemp?: number | null;
  targetGroupTemp?: number | null;
  frame: number | null;
  substate: string | null;
  weightFlow: number | null;
}

export interface ReviewInput {
  /** Recorded context only: never the currently prepared recipe or grinder draft. */
  timestamp?: string | null;
  grinderSetting?: string | null;
  tempC?: number | null;
  /** Stable profile shape, ignoring absolute temperature and target yield edits. */
  profileShape?: string | null;
  points: ReviewPoint[];
  profile: ProfileLike | null;
  doseG: number | null;
  yieldG: number | null;
  targetYieldG: number | null;
  targetTimeS: [number, number] | null;
  /** Where the time window came from; a profile guide is an approximation. */
  timeBasis?: "recorded" | "recipe" | "guide" | null;
  stopReason: string | null;
  feedback: TasteFeedback | null;
  /** Free-text taste can be provided even when the tap scales were left unset. */
  notes?: string | null;
  bean: BeanInfo | null;
  installedProfiles: string[];
  history: {
    timestamp: string; profileTitle?: string | null; profileShape?: string | null;
    doseG?: number | null; yieldG?: number | null; targetYieldG?: number | null;
    durationS?: number | null; grinderSetting?: string | null; tempC?: number | null; stopReason?: string | null;
    enjoyment?: number | null; notes?: string | null; review?: string | null;
  }[];
}

export interface ReviewIssue {
  kind: string;
  what: string;
  evidence: string;
  severity: "info" | "caution" | "warning";
  fromS: number | null;
  toS: number | null;
}

export interface ShotReviewData {
  summary: string;
  wentWell: string[];
  issues: ReviewIssue[];
  nextShot: DialInAdvice | null;
  confidence: "low" | "medium" | "high";
  askTaste: boolean;
}

export interface ReviewResult { review: ShotReviewData; source: string }
export interface SavedReview extends ReviewResult { version: 1; createdAt: string }
