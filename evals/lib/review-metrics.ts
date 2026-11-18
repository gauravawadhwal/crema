import type { Observation, PumpMode, ReviewClaim, ReviewLabels, ReviewOutcome } from "./review-labels.js";

export interface ReviewEvent {
  kind: string;
  phase?: string;
  controlledVariable?: Observation["controlledVariable"];
  onsetS?: number;
  peakS?: number;
}

export interface ReviewEvalOutput {
  events: ReviewEvent[];
  figures: { id: string; unit: string; value: number }[];
  outcomes: Exclude<ReviewOutcome, "abstain">[];
  /** True means the claim was made. An omitted key means it was not assessed. */
  claims: Partial<Record<ReviewClaim, boolean>>;
}

function outsideDistance(value: number, [lo, hi]: [number, number]): number {
  return Math.max(lo - value, value - hi, 0);
}

function timeMatches(type: NonNullable<Observation["timing"]>["type"], value: number | undefined, bounds: [number, number], samples: readonly number[]) {
  if (value == null || !Number.isFinite(value)) return false;
  if (type === "windowed-event") return value >= bounds[0] - 1 && value <= bounds[1] + 1;

  // Expand the reference interval by one actual recording sample on each side.
  // A raw landmark must include a recorded sample, including on an irregular clock.
  const [lo, hi] = bounds;
  const first = samples.findIndex((t) => t >= lo);
  const last = samples.findLastIndex((t) => t <= hi);
  return first >= 0 && first <= last && value >= (samples[first - 1] ?? lo) && value <= (samples[last + 1] ?? hi);
}

function matches(label: Observation, event: ReviewEvent, samples: readonly number[]) {
  return label.kind === event.kind &&
    (label.phase === undefined || label.phase === event.phase) &&
    (label.controlledVariable === undefined || label.controlledVariable === event.controlledVariable) &&
    (!label.timing || (timeMatches(label.timing.type, event.onsetS, label.timing.onsetS, samples) &&
      (!label.timing.peakS || timeMatches(label.timing.type, event.peakS, label.timing.peakS, samples))));
}

function timingError(label: Observation, event: ReviewEvent) {
  const error = (value: number | undefined, bounds: [number, number] | undefined) =>
    value == null || bounds == null ? null : outsideDistance(value, bounds);
  return { onsetErrorS: error(event.onsetS, label.timing?.onsetS), peakErrorS: error(event.peakS, label.timing?.peakS) };
}

export function scoreReview(labels: ReviewLabels, output: ReviewEvalOutput, samples: readonly number[]) {
  const observations = labels.source === "sensory" ? [] : labels.observations;
  const required = observations.filter((o) => o.expected === "required");
  const forbidden = observations.filter((o) => o.expected === "forbidden");
  const kinds = new Set(observations.map((o) => o.kind));

  // Maximum-cardinality one-to-one matching. Prefer closer candidates, but
  // allow an earlier assignment to move aside for a more constrained label.
  const candidates = required.map((label) => output.events.flatMap((event, index) => {
    if (!matches(label, event, samples)) return [];
    const error = timingError(label, event);
    return [{ index, distance: (error.onsetErrorS ?? 0) + (error.peakErrorS ?? 0) }];
  }).sort((a, b) => a.distance - b.distance));
  const matched = new Map<number, number>();
  function assign(labelIndex: number, visited: Set<number>): boolean {
    for (const { index } of candidates[labelIndex]) {
      if (visited.has(index)) continue;
      visited.add(index);
      const previous = matched.get(index);
      if (previous !== undefined && !assign(previous, visited)) continue;
      matched.set(index, labelIndex);
      return true;
    }
    return false;
  }
  required.forEach((_, i) => assign(i, new Set()));

  const byLabel = new Map(Array.from(matched, ([event, label]) => [label, event]));
  const events = required.map((label, i) => {
    const index = byLabel.get(i);
    return { id: label.id, kind: label.kind, matched: index !== undefined,
      ...timingError(label, index === undefined ? { kind: label.kind } : output.events[index]) };
  });
  const forbiddenHits = forbidden.flatMap((label) => output.events.some((event) => matches(label, event, samples)) ? [label.id] : []);
  const falseAlarms = output.events.filter((event, i) => !matched.has(i) && kinds.has(event.kind)).map((event) => event.kind);
  const unscoredEvents = output.events.filter((event) => !kinds.has(event.kind)).length;

  const figures = (labels.source === "sensory" ? [] : labels.figures).map((figure) => {
    const claims = output.figures.filter((claim) => claim.id === figure.id);
    const pass = claims.length > 0 && claims.every((claim) =>
      claim.unit === figure.unit && Math.abs(claim.value - figure.value) <= figure.tolerance);
    return { id: figure.id, pass };
  });

  const supported = labels.supportedOutcomes;
  const abstained = output.outcomes.length === 0;
  const supportedOutcome = supported == null ? null : abstained ? supported.includes("abstain") :
    output.outcomes.length === 1 && supported.includes(output.outcomes[0]);
  return {
    events, assessedKinds: [...kinds], forbiddenHits, falseAlarms, unscoredEvents, figures,
    supportedOutcome,
    justifiedAbstention: supported?.includes("abstain") ? abstained : null,
    unjustifiedAbstention: abstained && supportedOutcome === false,
    forbiddenClaims: labels.forbiddenClaims.map((claim) => ({ claim, present: output.claims[claim] ?? null })),
  };
}

export interface ReviewMetricRow {
  pumpMode: PumpMode;
  score?: ReturnType<typeof scoreReview>;
  ms: number;
  fellBack: boolean;
  /** Null means the provider did not report complete token usage. */
  tokens: { input: number; output: number } | null;
}

const rate = (n: number, d: number) => d ? n / d : null;
const mean = (values: number[]) => rate(values.reduce((sum, value) => sum + value, 0), values.length);
const nonNull = (values: (number | null)[]) => values.filter((value) => value !== null);

export function summarizeReviewMetrics(rows: ReviewMetricRow[]) {
  const scored = rows.flatMap((r) => r.score ? [r.score] : []);
  const events = scored.flatMap((s) => s.events);
  const alarms = scored.flatMap((s) => s.falseAlarms);
  const byKind = ["all", ...new Set(scored.flatMap((s) => s.assessedKinds))].map((kind, i) => {
    const subset = i === 0 ? events : events.filter((e) => e.kind === kind);
    const tp = subset.filter((e) => e.matched).length;
    const fp = i === 0 ? alarms.length : alarms.filter((alarm) => alarm === kind).length;
    const onset = nonNull(subset.map((e) => e.onsetErrorS));
    const peak = nonNull(subset.map((e) => e.peakErrorS));
    return { kind, tp, fp, fn: subset.length - tp, precision: rate(tp, tp + fp), recall: rate(tp, subset.length),
      onsetMaeS: mean(onset), onsetN: onset.length, peakMaeS: mean(peak), peakN: peak.length };
  });
  const mechanicalRows = rows.filter((r) => r.score?.assessedKinds.length);
  const falseAlarmsByPump = [...new Set(mechanicalRows.map((r) => r.pumpMode))].map((pumpMode) => {
    const relevant = mechanicalRows.filter((r) => r.pumpMode === pumpMode);
    const falseAlarms = relevant.reduce((n, r) => n + r.score!.falseAlarms.length, 0);
    return { pumpMode, falseAlarms, cases: relevant.length, perCase: rate(falseAlarms, relevant.length) };
  });
  const opportunities = scored.filter((s) => s.justifiedAbstention !== null);
  const decisions = scored.filter((s) => s.supportedOutcome !== null);
  const figures = scored.flatMap((s) => s.figures);
  const claims = scored.flatMap((s) => s.forbiddenClaims);
  const tokenRows = rows.flatMap((r) => r.tokens ? [r.tokens] : []);
  const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
  const quantile = (fraction: number) => ms[Math.ceil(fraction * ms.length) - 1] ?? null;
  return {
    runs: rows.length, labelled: scored.length, byKind, falseAlarmsByPump,
    unscoredEvents: scored.reduce((n, s) => n + s.unscoredEvents, 0),
    forbiddenFindingHits: scored.reduce((n, s) => n + s.forbiddenHits.length, 0),
    abstention: { opportunities: opportunities.length, justified: opportunities.filter((s) => s.justifiedAbstention).length,
      unjustified: scored.filter((s) => s.unjustifiedAbstention).length },
    supportedOutcomes: { passed: decisions.filter((s) => s.supportedOutcome).length, total: decisions.length },
    numericConsistency: { passed: figures.filter((f) => f.pass).length, total: figures.length },
    forbiddenClaims: { violations: claims.filter((c) => c.present === true).length, unassessed: claims.filter((c) => c.present === null).length },
    tokens: { reportedRuns: tokenRows.length, input: tokenRows.reduce((n, r) => n + r.input, 0), output: tokenRows.reduce((n, r) => n + r.output, 0) },
    latencyMs: { p50: quantile(0.5), p95: quantile(0.95) },
    fallbackRate: rate(rows.filter((r) => r.fellBack).length, rows.length),
  };
}
