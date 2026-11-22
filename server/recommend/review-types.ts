import type { ProfileLike } from "../profiles/curve.js";
import type { BeanInfo, DialInAdvice, TasteFeedback } from "../schema.js";
import type { ReviewEvidence, ReviewTraceSummary } from "./review-evidence.js";

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
  /** The machine's counted inlet volume, and the scale time relative to the machine trace. */
  countedVolumeMl?: number | null;
  scaleSampleS?: number | null;
  /** Pairing age in seconds. It describes timing between snapshots. */
  scaleAgeS?: number | null;
}

export interface ReviewInput {
  /** Recorded context only: never the currently prepared recipe or grinder draft. */
  timestamp?: string | null;
  grinderSetting?: string | null;
  /** Size of one adjustment on the grinder selected for the next shot. */
  grindStep?: number;
  tempC?: number | null;
  /** Stable profile shape, ignoring absolute temperature and target yield edits. */
  profileShape?: string | null;
  batchId?: string | null;
  targetWaterMl?: number | null;
  points: ReviewPoint[];
  profile: ProfileLike | null;
  doseG: number | null;
  yieldG: number | null;
  targetYieldG: number | null;
  /** Provenance separate from yieldG, which can fall back to a scale reading. */
  annotatedYieldG?: number | null;
  volumeCountStartFrame?: string | number | null;
  targetTimeS: [number, number] | null;
  /** Where the time window came from; a profile guide is an approximation. */
  timeBasis?: "recorded" | "recipe" | "guide" | null;
  stopReason: string | null;
  feedback: (Omit<TasteFeedback, "sourBitter" | "body"> & { sourBitter: number | null; body: number | null }) | null;
  /** Free-text taste can be provided even when the tap scales were left unset. */
  notes?: string | null;
  bean: BeanInfo | null;
  installedProfiles: string[];
  history: {
    timestamp: string; profileTitle?: string | null; profileShape?: string | null;
    doseG?: number | null; yieldG?: number | null; targetYieldG?: number | null;
    durationS?: number | null; grinderSetting?: string | null; tempC?: number | null; stopReason?: string | null;
    batchId?: string | null; targetWaterMl?: number | null; trace?: ReviewTraceSummary | null;
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

export interface CurveReview {
  summary: string;
  history: string | null;
  timing: string | null;
  wentWell: string[];
  issues: ReviewIssue[];
  confidence: ShotReviewData["confidence"];
  limitation: string;
  finer: boolean;
  coarser: boolean;
  nextShot: DialInAdvice | null;
  check: string;
  narrative: { text: string; evidenceIds: string[] } | null;
}

export interface TasteAlignment {
  status: "absent" | "agrees" | "conflicts" | "no_direction" | "uninterpreted_notes";
  summary: string;
  notes: string | null;
  changesExperiment: boolean;
  check: string | null;
}

interface LegacyReviewResult { review: ShotReviewData; source: string; evidence: ReviewEvidence }
export interface ReviewResult extends LegacyReviewResult { curve: CurveReview; taste: TasteAlignment }
export type { CoachMechanics, CoachReview } from "../schema.js";
export interface CoachReviewResult extends ReviewResult { coach: import("../schema.js").CoachReview }
export const SHOT_REVIEW_VERSION = 4;
export type SavedReview =
  | { version: 1; review: ShotReviewData; source: string; createdAt: string }
  | (LegacyReviewResult & { version: 2; createdAt: string })
  | (ReviewResult & { version: 3; createdAt: string })
  | (CoachReviewResult & { version: typeof SHOT_REVIEW_VERSION; createdAt: string });
