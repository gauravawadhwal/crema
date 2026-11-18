import type { ReviewPoint } from "../../server/recommend/review-types.js";

/** Frozen pre-anchor sampler for the old review ablation. */
export function downsampleReviewPoints(points: ReviewPoint[], limit = 50): ReviewPoint[] {
  if (points.length <= limit) return points;
  const keep = new Set<number>([0, points.length - 1]);
  for (let i = 1; i < points.length; i++) {
    if (points[i].frame !== points[i - 1].frame || points[i].substate !== points[i - 1].substate) { keep.add(i - 1); keep.add(i); }
  }
  // A malformed or unusually noisy stream can have more boundaries than the
  // budget. Keep frame starts first, then evenly select any remaining boundary.
  if (keep.size > limit) {
    const boundary = [...keep].filter((i) => i !== 0 && i !== points.length - 1);
    keep.clear(); keep.add(0); keep.add(points.length - 1);
    const frameStarts = boundary.filter((i) => points[i].frame !== points[i - 1].frame);
    const prioritized = frameStarts.length ? frameStarts : boundary;
    const room = limit - keep.size;
    for (let j = 0; j < room; j++) keep.add(prioritized[Math.floor(j * prioritized.length / room)]);
  }
  // Split the widest gap at its midpoint so samples span the full shot.
  while (keep.size < limit) {
    const sorted = [...keep].sort((a, b) => a - b);
    let best = -1, bestGap = 1;
    for (let i = 0; i + 1 < sorted.length; i++) {
      const gap = sorted[i + 1] - sorted[i];
      if (gap > bestGap) { best = Math.floor((sorted[i] + sorted[i + 1]) / 2); bestGap = gap; }
    }
    if (best < 0) break;
    keep.add(best);
  }
  return [...keep].sort((a, b) => a - b).slice(0, limit).map((i) => points[i]);
}

export function legacyReviewCurveSection(points: ReviewPoint[]) {
  return `SHOT CURVES (approximately 50 samples; all available phase starts retained):
${JSON.stringify(downsampleReviewPoints(points))}`;
}
