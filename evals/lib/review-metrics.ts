import { MACHINE_GAP_S } from "../../server/profiles/phase-evidence.js";
import type { Observation, PumpMode, ReviewClaim, ReviewLabels, ReviewOutcome } from "./review-labels.js";

export interface ReviewEvent {
  kind: string;
  phase?: string;
  controlledVariable?: Observation["controlledVariable"];
  onsetS?: number;
  peakS?: number;
  timingBasis?: "issue-window";
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
  if (first < 0 || first > last) return false;
  const previous = samples[first - 1];
  const next = samples[last + 1];
  const left = previous !== undefined && samples[first] - previous <= MACHINE_GAP_S ? previous : lo;
  const right = next !== undefined && next - samples[last] <= MACHINE_GAP_S ? next : hi;
  return value >= left && value <= right;
}

function sameEvent(label: Observation, event: ReviewEvent) {
  return label.kind === event.kind &&
    (label.phase === undefined || label.phase === event.phase) &&
    (label.controlledVariable === undefined || label.controlledVariable === event.controlledVariable);
}

function timingUnsupported(label: Observation, event: ReviewEvent) {
  return label.timing && (event.onsetS === undefined || label.timing.type === "raw-landmark" && event.timingBasis === "issue-window" ||
    label.timing.peakS !== undefined && event.peakS === undefined);
}

function matches(label: Observation, event: ReviewEvent, samples: readonly number[]) {
  return sameEvent(label, event) && !timingUnsupported(label, event) &&
    (!label.timing || (timeMatches(label.timing.type, event.onsetS, label.timing.onsetS, samples) &&
      (!label.timing.peakS || timeMatches(label.timing.type, event.peakS, label.timing.peakS, samples))));
}

function timingError(label: Observation, event: ReviewEvent) {
  const error = (value: number | undefined, bounds: [number, number] | undefined) =>
    value == null || bounds == null ? null : outsideDistance(value, bounds);
  return { onsetErrorS: error(event.onsetS, label.timing?.onsetS), peakErrorS: error(event.peakS, label.timing?.peakS) };
}

interface MatchCandidate { index: number; distance: number }

/** Successive cheapest augmenting paths in the label/event residual graph. */
function assignEvents(candidates: MatchCandidate[][], eventCount: number) {
  const byLabel = new Map<number, MatchCandidate>();
  const byEvent = new Map<number, number>();
  for (let size = 0; size < candidates.length; size++) {
    const labelCost = candidates.map((_, i) => byLabel.has(i) ? Infinity : 0);
    const eventCost = Array<number>(eventCount).fill(Infinity);
    const previous = new Map<number, { label: number; edge: MatchCandidate }>();
    // The reverse of a matched edge refunds its cost. Reconsider the entire
    // alternating path so maximum cardinality also minimizes total error.
    for (let round = 0; round < candidates.length; round++) {
      let changed = false;
      for (const [label, edges] of candidates.entries()) {
        for (const edge of edges) {
          if (byLabel.get(label)?.index === edge.index) continue;
          const cost = labelCost[label] + edge.distance;
          if (cost + 1e-9 >= eventCost[edge.index]) continue;
          eventCost[edge.index] = cost;
          previous.set(edge.index, { label, edge });
          changed = true;
          const owner = byEvent.get(edge.index);
          if (owner !== undefined) labelCost[owner] = Math.min(labelCost[owner], cost - byLabel.get(owner)!.distance);
        }
      }
      if (!changed) break;
    }
    let target: number | undefined;
    for (const [index, cost] of eventCost.entries()) {
      if (!byEvent.has(index) && cost < (target === undefined ? Infinity : eventCost[target])) target = index;
    }
    if (target === undefined) break;
    while (target !== undefined) {
      const step: { label: number; edge: MatchCandidate } = previous.get(target)!;
      const { label, edge } = step;
      const prior: number | undefined = byLabel.get(label)?.index;
      byLabel.set(label, edge);
      byEvent.set(target, label);
      target = prior;
    }
  }
  return { byLabel, byEvent };
}

export function scoreReview(labels: ReviewLabels, output: ReviewEvalOutput, samples: readonly number[]) {
  const observations = labels.source === "sensory" ? [] : labels.observations;
  const required = observations.filter(o => o.expected === "required");
  const forbidden = observations.filter(o => o.expected === "forbidden");
  const assessed = labels.source === "sensory" ? [] : labels.exhaustiveEventKinds;
  const exhaustive = new Set(assessed ?? observations.map(o => o.kind));
  const kinds = new Set([...exhaustive, ...observations.map(o => o.kind)]);

  const candidates = required.map(label => output.events.flatMap((event, index) => {
    if (!matches(label, event, samples)) return [];
    const error = timingError(label, event);
    return [{ index, distance: (error.onsetErrorS ?? 0) + (error.peakErrorS ?? 0) }];
  }));
  const matched = assignEvents(candidates, output.events.length);
  const timingUnknown = (event: ReviewEvent) => observations.some(label => sameEvent(label, event) && timingUnsupported(label, event));
  const events = required.map((label, i) => {
    const index = matched.byLabel.get(i)?.index;
    const unsupported = index === undefined && output.events.some(e => sameEvent(label, e) && timingUnsupported(label, e));
    return { id: label.id, kind: label.kind, matched: index !== undefined,
      ...timingError(label, index === undefined ? { kind: label.kind } : output.events[index]), ...(unsupported ? { timingUnassessed: true } : {}) };
  });
  const forbiddenHits = forbidden.flatMap((label) => output.events.some((event) => matches(label, event, samples)) ? [label.id] : []);
  const impossible = (event: ReviewEvent) => forbidden.some(label => matches(label, event, samples));
  const falseAlarm = (event: ReviewEvent) => impossible(event) || exhaustive.has(event.kind) && !timingUnknown(event);
  const unmatched = output.events.filter((_, i) => !matched.byEvent.has(i));
  const falseAlarms = unmatched.filter(falseAlarm).map(event => event.kind);
  const unscoredEvents = unmatched.filter(event => !falseAlarm(event)).length;

  const figures = (labels.source === "sensory" ? [] : labels.figures).map((figure) => {
    const claims = output.figures.filter((claim) => claim.id === figure.id);
    const pass = claims.length > 0 && claims.every((claim) =>
      claim.unit.toLowerCase() === figure.unit.toLowerCase() && Math.abs(claim.value - figure.value) <= figure.tolerance);
    return { id: figure.id, pass };
  });

  if (labels.source !== "sensory" && labels.exhaustiveFigures) {
    const ids = new Set(figures.map(f => f.id));
    for (const id of new Set(output.figures.map(f => f.id))) {
      if (!ids.has(id)) figures.push({ id, pass: false });
    }
  }

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
    const relevant = i === 0 ? events : events.filter(e => e.kind === kind);
    const subset = relevant.filter(e => !e.timingUnassessed);
    const tp = subset.filter((e) => e.matched).length;
    const fp = i === 0 ? alarms.length : alarms.filter((alarm) => alarm === kind).length;
    const onset = nonNull(subset.map((e) => e.onsetErrorS));
    const peak = nonNull(subset.map((e) => e.peakErrorS));
    return { kind, tp, fp, fn: subset.length - tp, precision: rate(tp, tp + fp), recall: rate(tp, subset.length),
      timingUnassessed: relevant.length - subset.length, onsetMaeS: mean(onset), onsetN: onset.length, peakMaeS: mean(peak), peakN: peak.length };
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
