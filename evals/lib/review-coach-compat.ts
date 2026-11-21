import type { CoachReviewResult, ReviewResult } from "../../server/recommend/review-types.js";

/** Preserve the flat findings and stage narrative used by the current graders. */
export function legacyEvalReview({ review, curve, taste, source, evidence }: CoachReviewResult): ReviewResult {
  return { review, curve, taste, source, evidence };
}
