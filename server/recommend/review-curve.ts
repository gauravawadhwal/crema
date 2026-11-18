import { MACHINE_GAP_S, type PhaseLandmark } from "../profiles/phase-evidence.js";
import type { ReviewPoint } from "./review-types.js";

export const REVIEW_CURVE_ROWS = 32;

// Chart-scale spans keep degrees, grams, bar and mL/s on comparable footing.
const channels = [
  ["p", 12], ["tp", 12], ["f", 12], ["tf", 12], ["w", 40], ["weightFlow", 10],
  ["temp", 30], ["targetTemp", 30], ["groupTemp", 30], ["targetGroupTemp", 30],
] as const;
const columns = ["t", ...channels.map(([key]) => key), "frame", "substate"];
const eventColumns = ["t", "p", "tp", "f", "tf", "w", "temp", "groupTemp", "frame", "substate"] as const;

const reading = (value: number | undefined | null, scale: number) =>
  value == null || !Number.isFinite(value) ? null : Math.round(value * scale) / scale;

function eventReading(point: ReviewPoint | undefined) {
  return point ? eventColumns.map(key => key === "t" ? point.t :
    key === "substate" || key === "frame" ? point[key] : reading(point[key], 100)) : null;
}

function eventTime({ t, at, before, after }: PhaseLandmark) {
  if (t === at?.t || t === before?.t || t === after?.t) return t;
  // Keep measured timestamps intact. Round inferred times only when the
  // result still fits the observed bracket.
  const rounded = Math.round(t * 1000) / 1000;
  return rounded >= (before?.t ?? -Infinity) && rounded <= (after?.t ?? Infinity) ? rounded : t;
}

const priority: Record<PhaseLandmark["kind"], number> = {
  recording_start: 0, recording_end: 0, first_sustained_beverage: 1, brew_pressure_crest: 2, stop: 2, phase_boundary: 3,
  cap_like_start: 4, cap_like_end: 4, planned_rise: 4, planned_decline: 4,
  pressure_droop_at_held_flow: 4, phase_pressure_crest: 5, weight_jump: 5, scale_gap: 5,
};

type Gap = [fromS: number, toS: number, channels: string[]];

/** Keep the original brackets, then fill by elapsed coverage and interpolation error. */
export function sampleReviewCurve(points: ReviewPoint[], landmarks: PhaseLandmark[], limit = REVIEW_CURVE_ROWS) {
  const budget = Math.max(0, Math.min(points.length, Math.floor(limit) || 0));
  const indices = new Map(points.map((point, i) => [point, i]));
  const globalCrest = landmarks.find(event => event.kind === "brew_pressure_crest")?.at;
  const events = landmarks.filter(event => event.kind !== "phase_pressure_crest" || event.at !== globalCrest)
    .sort((a, b) => a.t - b.t || priority[a.kind] - priority[b.kind]);

  const scaleBreaks = new Set(events.filter(event => event.kind === "weight_jump" || event.kind === "scale_gap")
    .map(event => event.after));
  const machineBreaks = points.map((point, i) => i > 0 && point.t - points[i - 1].t > MACHINE_GAP_S);
  const gapSpans = new Map<string, Gap>();
  const gapAnchors = new Set<number>();
  const addGap = (left: number, right: number, names: string[]) => {
    const from = points[left].t, to = points[right].t;
    const key = `${left}:${right}`;
    const existing = gapSpans.get(key);
    if (existing) existing[2].push(...names);
    else gapSpans.set(key, [from, to, names]);
    gapAnchors.add(left);
    gapAnchors.add(right);
  };
  for (const [i, isGap] of machineBreaks.entries()) {
    if (isGap) addGap(i - 1, i, ["all"]);
  }

  const values = channels.map(([key]) => points.map(p => p[key] ?? null));
  // Segment IDs prevent interpolation across an unsampled missing reading,
  // recording break or scale discontinuity even when both retained ends exist.
  const segments = channels.map(([key], channel) => {
    const samples = values[channel];
    const scale = key === "w" || key === "weightFlow";
    let segment = 0;
    let missingStart = -1;
    const hasValues = samples.some(value => value != null);
    return samples.map((value, i) => {
      if (machineBreaks[i] || (scale && scaleBreaks.has(points[i])) ||
        (i > 0 && (value == null || samples[i - 1] == null))) segment++;
      if (hasValues && value == null) {
        if (missingStart < 0) missingStart = i;
        if (i === samples.length - 1 || samples[i + 1] != null) {
          addGap(Math.max(0, missingStart - 1), Math.min(samples.length - 1, i + 1), [key]);
          gapAnchors.add(missingStart);
          gapAnchors.add(i);
          missingStart = -1;
        }
      }
      return segment;
    });
  });

  const keep = new Set<number>();
  const add = (i?: number) => {
    if (i != null && i >= 0 && i < points.length && keep.size < budget) keep.add(i);
  };
  add(0);
  add(points.length - 1);
  for (const event of [...events].sort((a, b) => priority[a.kind] - priority[b.kind])) {
    if (event.at) add(indices.get(event.at));
    if (event.before) add(indices.get(event.before));
    if (event.after) add(indices.get(event.after));
    if (event.kind === "first_sustained_beverage" && event.at) {
      const i = indices.get(event.at);
      if (i != null) {
        add(i - 1);
        add(i + 1);
      }
    }
    if (event.confirmed) add(indices.get(event.confirmed));
  }
  for (const i of gapAnchors) add(i);

  const candidates: { left: number; right: number; index: number; score: number }[] = [];
  const findCandidate = (left: number, right: number) => {
    const from = points[left].t, to = points[right].t;
    let best = -1, bestScore = -1;
    for (let i = left + 1; i < right; i++) {
      const t = points[i].t;
      const fraction = (t - from) / (to - from);
      let error = 0;
      for (const [channel, [, span]] of channels.entries()) {
        if (segments[channel][left] !== segments[channel][right]) continue;
        const [a, b, actual] = [values[channel][left], values[channel][right], values[channel][i]];
        if (a == null || b == null || actual == null) continue;
        error = Math.max(error, Math.abs(actual - (a + (b - a) * fraction)) / span);
      }
      // Even a perfectly flat interval has positive priority. Bound the error
      // multiplier so a single large excursion cannot starve long intervals.
      const score = Math.min(t - from, to - t) * (1 + 4 * Math.min(1, error));
      if (score > bestScore) { best = i; bestScore = score; }
    }
    if (best >= 0) candidates.push({ left, right, index: best, score: bestScore });
  };
  if (budget === points.length) {
    points.forEach((_, i) => add(i));
  } else if (keep.size < budget) {
    const boundaries = [...keep].sort((a, b) => a - b);
    for (let i = 1; i < boundaries.length; i++) findCandidate(boundaries[i - 1], boundaries[i]);
    while (keep.size < budget && candidates.length) {
      const best = candidates.reduce((a, b) => a.score > b.score || a.score === b.score && a.index < b.index ? a : b);
      candidates.splice(candidates.indexOf(best), 1);
      add(best.index);
      findCandidate(best.left, best.index);
      findCandidate(best.index, best.right);
    }
  }

  return { points: [...keep].sort((a, b) => a - b).map(i => points[i]), events,
    gaps: [...gapSpans.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]) };
}

export function reviewCurveSection(points: ReviewPoint[], landmarks: PhaseLandmark[], limit?: number) {
  const sampled = sampleReviewCurve(points, landmarks, limit);
  return `SHOT CURVES AND EVENTS (recorded rows and event brackets; do not join across gaps, nulls or scale discontinuities):
${JSON.stringify({
    columns,
    rows: sampled.points.map(p => [
      p.t, ...channels.map(([key]) => reading(p[key], 100)), p.frame, p.substate,
    ]),
    gaps: sampled.gaps,
    eventColumns,
    events: sampled.events.map(event => {
      const { kind, confidence, at, before, after, confirmed, detail } = event;
      return {
        kind, t: eventTime(event), confidence, before: eventReading(before), after: eventReading(after),
        ...(at ? { at: eventReading(at) } : {}), ...(confirmed ? { confirmed: eventReading(confirmed) } : {}),
        ...(detail != null && (typeof detail !== "object" || Object.keys(detail).length) ? { detail } : {}),
      };
    }),
  })}
Gap entries give the surrounding times and affected columns ("all" means no samples between those times). Events give observed readings around a landmark. For cap-like crossings, t is an estimate from the bracket and does not confirm limiter engagement. For droop, t marks the late comparison window. For stop, t is the last brew reading and can precede actual stop.`;
}
