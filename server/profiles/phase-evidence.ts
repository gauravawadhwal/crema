import type { ProfileStepLike } from "./curve.js";
import type { ReviewInput, ReviewPoint } from "../recommend/review-types.js";

type Mode = "flow" | "pressure";
type Provenance = "recorded" | "inferred";
type Evidence<T> = { value: T | null; source: Provenance | null; reason: string };
type TimeWindow = { fromS: number; toS: number; coveredS: number };
type WindowEvidence<T> = Evidence<T> & TimeWindow;

export const MACHINE_GAP_S = 1.5;
// These bounds reject unsupported interpolation and obvious scale artifacts.
// They are evidence-coverage checks, independent of espresso fault thresholds.
const SCALE_GAP_S = 0.75;
const ONSET_WINDOW_S = 2;
const RESPONSE_WINDOW_S = 5;

/** Raw brackets for prompt sampling. These never feed back into the evidence or fault rules. */
export interface PhaseLandmark {
  kind: "recording_start" | "recording_end" | "phase_boundary" | "brew_pressure_crest" | "phase_pressure_crest" | "first_sustained_beverage" |
    "cap_like_start" | "cap_like_end" | "planned_rise" | "planned_decline" |
    "pressure_droop_at_held_flow" | "stop" | "weight_jump" | "scale_gap";
  t: number;
  confidence: "high" | "medium" | "low";
  before?: ReviewPoint;
  at?: ReviewPoint;
  after?: ReviewPoint;
  confirmed?: ReviewPoint;
  detail?: unknown;
}

const rounded = (n: number) => Math.round(n * 1000) / 1000;
const roundedReading = (n: number | null) => n == null ? null : rounded(n);
const reading = (n: number | null | undefined, min = 0, max = Infinity): number | null =>
  n != null && Number.isFinite(n) && n >= min && n <= max ? n : null;
const profileNumber = (n: string | number | null | undefined) =>
  n == null || String(n).trim() === "" ? null : reading(Number(n));
const evidence = <T>(value: T | null, source: Provenance, reason: string): Evidence<T> =>
  ({ value, source: value == null ? null : source, reason });
const positive = (n: number | null | undefined) => reading(n, Number.MIN_VALUE);

export function isBrewPoint(p: ReviewPoint, hasState: boolean): boolean {
  return !hasState || /^(pour|preinfusion)/i.test(p.substate ?? "");
}

interface Run {
  points: ReviewPoint[];
  previous: ReviewPoint | undefined;
  next: ReviewPoint | undefined;
}

function phaseRuns(points: ReviewPoint[], hasState: boolean): Run[] {
  const runs: Run[] = [];
  let current: Run | undefined;
  for (const [i, p] of points.entries()) {
    const previous = points[i - 1];
    if (!isBrewPoint(p, hasState)) {
      current = undefined;
      continue;
    }
    if (!current || p.frame !== previous?.frame || p.substate !== previous?.substate) {
      current = { points: [], previous, next: undefined };
      runs.push(current);
    }
    current.points.push(p);
    current.next = points[i + 1];
  }
  return runs;
}

type Interval = { dt: number; a: number[]; b: number[] };

function interpolate(a: number, b: number, fraction: number) {
  return a + (b - a) * fraction;
}

/** Integrate only adjacent, valid pairs, clipping to the requested elapsed times. */
function intervals(points: ReviewPoint[], select: (p: ReviewPoint) => (number | null)[],
  fromS: number, toS: number) {
  const rows = points.map(select);
  const result: (Interval & { before: ReviewPoint; after: ReviewPoint })[] = [];
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1].t, end = points[i].t, dt = end - start;
    const a = rows[i - 1], b = rows[i];
    const lo = Math.max(start, fromS), hi = Math.min(end, toS);
    if (dt > MACHINE_GAP_S || hi <= lo || a.some(v => v == null) || b.some(v => v == null)) continue;
    result.push({
      dt: hi - lo,
      before: points[i - 1], after: points[i],
      a: a.map((v, j) => interpolate(v!, b[j]!, (lo - start) / dt)),
      b: a.map((v, j) => interpolate(v!, b[j]!, (hi - start) / dt)),
    });
  }
  return result;
}

function windowEvidence<T>(value: T | null, fromS: number, toS: number, coveredS: number, reason: string): WindowEvidence<T> {
  return { ...evidence(value, "inferred", reason), fromS: rounded(fromS), toS: rounded(toS), coveredS: rounded(coveredS) };
}

const coverage = (xs: Interval[]) => xs.reduce((total, x) => total + x.dt, 0);

function coverageReason(covered: number, duration: number) {
  if (covered === 0) return "no_adjacent_valid_readings";
  return covered + 1e-6 < duration ? "partial_missing_readings_or_gaps" : "covered";
}

function summarizeReadings(points: ReviewPoint[], select: (p: ReviewPoint) => number | null) {
  const first = points[0], last = points.at(-1)!;
  const readings = points.map(select).filter((x): x is number => x != null);
  const pairs = intervals(points, p => [select(p)], first.t, last.t);
  const covered = coverage(pairs);
  const mean = covered ? pairs.reduce((sum, { a, b, dt }) => sum + dt * (a[0] + b[0]) / 2, 0) / covered : null;
  const value = readings.length ? {
    entry: roundedReading(select(first)), last: roundedReading(select(last)), min: rounded(Math.min(...readings)), max: rounded(Math.max(...readings)),
    timeWeightedMean: mean == null ? null : rounded(mean),
  } : null;
  return { ...evidence(value, "recorded", readings.length ? coverageReason(covered, last.t - first.t) : "no_valid_readings"), coveredS: rounded(covered) };
}

function residual(points: ReviewPoint[], command: (p: ReviewPoint) => number | null, actual: (p: ReviewPoint) => number | null) {
  const start = points[0].t, end = points.at(-1)!.t;
  const pairs = intervals(points, p => [command(p), actual(p)], start, end);
  const covered = coverage(pairs);
  let abs = 0, signed = 0;
  for (const { a, b, dt } of pairs) {
    const ea = a[1] - a[0], eb = b[1] - b[0];
    signed += dt * (ea + eb) / 2;
    // When a linear residual crosses zero, integrate the two triangles separately.
    abs += dt * (ea * eb < 0 ? (ea ** 2 + eb ** 2) / (Math.abs(ea) + Math.abs(eb)) : Math.abs(ea + eb)) / 2;
  }
  return windowEvidence(covered ? { absoluteMean: rounded(abs / covered), signedMean: rounded(signed / covered) } : null,
    start, end, covered, coverageReason(covered, end - start));
}

/** Fractional interval on which a linearly interpolated inequality is true. */
function nonnegative(a: number, b: number): [number, number] {
  if (a >= 0 && b >= 0) return [0, 1];
  if (a < 0 && b < 0) return [0, 0];
  const cross = a / (a - b);
  return a < 0 ? [cross, 1] : [0, cross];
}

function capTime(points: ReviewPoint[], command: (p: ReviewPoint) => number | null,
  actual: (p: ReviewPoint) => number | null, other: (p: ReviewPoint) => number | null, limit: number,
  landmarks?: PhaseLandmark[]) {
  const start = points[0].t, end = points.at(-1)!.t;
  const pairs = intervals(points, p => [command(p), actual(p), other(p)], start, end);
  const covered = coverage(pairs);
  let seconds = 0;
  const spans = pairs.map(({ a, b }) => {
    if (a[0] === 0 && b[0] === 0) return null;
    const cap = nonnegative(a[2] - 0.9 * limit, b[2] - 0.9 * limit);
    const shortage = nonnegative(0.8 * a[0] - a[1], 0.8 * b[0] - b[1]);
    const lo = Math.max(cap[0], shortage[0]), hi = Math.min(cap[1], shortage[1]);
    return hi > lo ? { lo, hi } : null;
  });
  for (const [i, { dt, before, after }] of pairs.entries()) {
    const span = spans[i];
    if (!span) continue;
    const { lo, hi } = span;
    seconds += dt * (hi - lo);
    if (!landmarks) continue;
    // An interpolated threshold crossing is descriptive. A gap or a phase
    // endpoint by itself does not establish that the limiter changed state.
    if (lo > 0 || (pairs[i - 1]?.after === before && spans[i - 1]?.hi !== 1)) {
      landmarks.push({ kind: "cap_like_start", confidence: "medium", t: before.t + dt * lo,
        before: lo === 0 ? pairs[i - 1].before : before, after: lo === 0 ? before : after });
    }
    if (hi < 1 || (pairs[i + 1]?.before === after && spans[i + 1]?.lo !== 0)) {
      landmarks.push({ kind: "cap_like_end", confidence: "medium", t: before.t + dt * hi,
        before: hi === 1 ? after : before, after: hi === 1 ? pairs[i + 1].after : after });
    }
  }
  return windowEvidence(covered ? { seconds: rounded(seconds), shareOfCoveredTime: rounded(seconds / covered) } : null,
    start, end, covered, coverageReason(covered, end - start));
}

const pressure = (p: ReviewPoint) => reading(p.p, 0, 20);
const flow = (p: ReviewPoint) => reading(p.f, 0, 20);
const weight = (p: ReviewPoint) => reading(p.w, -5, 500);

function median(values: number[]) {
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

/** Duration-weighted median of interval midpoints, approximating the response at regular times. */
function timeMedian(pairs: Interval[], index: number) {
  const half = coverage(pairs) / 2;
  const values = pairs.map(({ dt, a, b }) => ({ dt, value: (a[index] + b[index]) / 2 })).sort((a, b) => a.value - b.value);
  let time = 0;
  for (const [i, x] of values.entries()) {
    time += x.dt;
    if (Math.abs(time - half) <= 1e-9 && values[i + 1]) return (x.value + values[i + 1].value) / 2;
    if (time >= half) return x.value;
  }
  return values.at(-1)!.value;
}

function hydraulicWindow(points: ReviewPoint[], from: number, to: number) {
  const pairs = intervals(points, p => [pressure(p), flow(p)], from, to);
  const covered = coverage(pairs);
  const usable = covered >= 1 && covered + 1e-6 >= (to - from) * 0.8;
  const proxy = pairs.filter(({ a, b }) => a[1] >= 0.5 && b[1] >= 0.5)
    .map(({ dt, a, b }) => ({ dt, a: [a[0] / a[1]], b: [b[0] / b[1]] }));
  const proxyCovered = coverage(proxy);
  return windowEvidence(usable ? {
    medianPressureBar: rounded(timeMedian(pairs, 0)), medianInletFlowMlS: rounded(timeMedian(pairs, 1)),
    pressurePerInletFlowProxyBarPerMlS: evidence(proxyCovered >= 1 && proxyCovered >= 0.8 * covered ? rounded(timeMedian(proxy, 0)) : null,
      "inferred", proxyCovered >= 1 && proxyCovered >= 0.8 * covered ? "paired_pressure_and_inlet_flow" : "inlet_flow_too_low_or_sparse"),
  } : null, from, to, covered, usable ? coverageReason(covered, to - from) : "less_than_one_second_or_80_percent_paired_coverage");
}

function pressurePeak(points: ReviewPoint[]) {
  let peak: ReviewPoint | undefined;
  for (const p of points) if (pressure(p) != null && (peak == null || p.p! > peak.p!)) peak = p;
  return peak;
}

function pressureCrest(peak: ReviewPoint | undefined) {
  const f = peak ? flow(peak) : null;
  return evidence(peak ? {
    tS: rounded(peak.t), pressureBar: rounded(peak.p!), inletFlowMlS: roundedReading(f),
    pressurePerInletFlowProxyBarPerMlS: evidence(f != null && f >= 0.5 ? rounded(peak.p! / f) : null, "inferred",
      f != null && f >= 0.5 ? "paired_pressure_and_inlet_flow" : "inlet_flow_too_low_or_missing"),
  } : null, "recorded", peak ? "largest_observed_sample" : "no_valid_pressure");
}

type ScaleRow = { p: ReviewPoint; w: number | null; sampleS: number; reason: string };

function scaleRows(points: ReviewPoint[], hasState: boolean): ScaleRow[] {
  let previousScaleS: number | undefined;
  return points.flatMap(p => {
    const actual = weight(p);
    const hasClock = p.scaleSampleS != null || p.scaleAgeS != null;
    const sampleS = p.scaleSampleS ?? p.t - (p.scaleAgeS ?? 0);
    const stale = (p.scaleAgeS != null && Math.abs(p.scaleAgeS) > SCALE_GAP_S) ||
      (hasClock && (Math.abs(p.t - sampleS) > SCALE_GAP_S || (previousScaleS != null && sampleS < previousScaleS)));
    if (!stale && actual != null && hasClock && sampleS === previousScaleS && isBrewPoint(p, hasState)) return [];
    if (hasClock) previousScaleS = sampleS;
    if (!isBrewPoint(p, hasState)) return [{ p, w: null, sampleS, reason: "not_brewing" }];
    return [{ p, w: stale ? null : actual, sampleS, reason: stale ? "stale_scale_sample" : (p.w ?? 0) < -5 ? "weight_jump" : actual == null ? "missing_or_invalid_weight" : "recorded_weight" }];
  });
}

function scaleEdge(a: ScaleRow, b: ScaleRow) {
  if (a.w == null) return a.reason;
  if (b.w == null) return b.reason;
  const dt = b.sampleS - a.sampleS;
  if (dt <= 0 || dt > SCALE_GAP_S || b.p.t <= a.p.t || b.p.t - a.p.t > SCALE_GAP_S) return "scale_gap";
  if (b.w - a.w > Math.max(5, 15 * dt) || a.w - b.w > Math.max(2, 8 * dt)) return "weight_jump";
  return null;
}

/** Sample first crossings on a fixed mass grid so past traces stay off the wire. */
export function measureMassCheckpoints(points: ReviewPoint[], phases: PhaseEvidence[]) {
  const rows = scaleRows(points, points.some(p => p.substate));
  const first = rows.findIndex(row => row.reason !== "not_brewing");
  const checkpoints: { massG: number; frame: number; phaseElapsedS: number; brewElapsedS: number; pressureBar: number }[] = [];
  const start = rows[first];
  if (!start || start.w == null || Math.abs(start.w) >= 1) {
    return { checkpoints, reason: !start || !rows.some(row => row.w != null) ? "no_scale_readings" : "no_near_zero_brew_start" };
  }
  const grid = [1, 2, ...Array.from({ length: 100 }, (_, i) => (i + 1) * 5)];
  let next = 0, phaseIndex = 0, machineIndex = 0;
  let highWeight = start.w;
  let reason = "recording_ended";
  for (let i = first + 1; i < rows.length && next < grid.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (b.reason === "not_brewing") break;
    const fault = scaleEdge(a, b);
    if (fault) { reason = fault; break; }
    // Avoid relabelling post-tare weights as cumulative beverage.
    if (b.w! < highWeight - 0.5) { reason = "weight_drop_or_reset"; break; }
    highWeight = Math.max(highWeight, b.w!);
    while (phaseIndex + 1 < phases.length && b.p.t > phases[phaseIndex].toS + 0.0005) phaseIndex++;
    const phase = phases[phaseIndex];
    for (; next < grid.length && grid[next] <= b.w!; next++) {
      if (!phase?.plan.value || phase.frame == null || a.p.t < phase.fromS - 0.0005 || a.w! >= grid[next]) continue;
      const fraction = (grid[next] - a.w!) / (b.w! - a.w!);
      const t = interpolate(a.sampleS, b.sampleS, fraction);
      while (machineIndex < points.length && points[machineIndex].t < t) machineIndex++;
      const right = points[machineIndex], left = right?.t === t ? right : points[machineIndex - 1];
      if (!left || !right || left.t < phase.fromS - 0.0005 || right.t > phase.toS + 0.0005 || right.t - left.t > SCALE_GAP_S) continue;
      const pa = pressure(left), pb = pressure(right);
      if (pa == null || pb == null) continue;
      const crossingBar = left === right ? pa : interpolate(pa, pb, (t - left.t) / (right.t - left.t));
      checkpoints.push({ massG: grid[next], frame: phase.frame, phaseElapsedS: rounded(Math.max(0, t - phase.fromS)),
        brewElapsedS: rounded(Math.max(0, t - start.p.t)), pressureBar: rounded(crossingBar) });
    }
  }
  return { checkpoints, reason };
}

function firstBeverage(rows: ScaleRow[], hasScale: boolean, brewStartS: number | undefined, landmarks?: PhaseLandmark[]) {
  let rejected = "no_three_consecutive_gram_readings";
  for (let i = 0; brewStartS != null && i + 2 < rows.length; i++) {
    const [a, b, c] = [rows[i], rows[i + 1], rows[i + 2]];
    if ((a.w ?? -Infinity) < 1 || (b.w ?? -Infinity) < 1 || (c.w ?? -Infinity) < 1) continue;
    const prev = rows[i - 1];
    const before = a.p.t === brewStartS ? null : prev ? scaleEdge(prev, a) : "missing_preceding_weight";
    const fault = before ?? scaleEdge(a, b) ?? scaleEdge(b, c);
    if (fault || (prev?.w ?? -Infinity) >= 1) {
      if (fault) rejected = fault;
      continue;
    }
    const p = a.p;
    const volume = positive(p.countedVolumeMl);
    landmarks?.push({ kind: "first_sustained_beverage", t: p.t, at: p,
      confidence: prev?.w != null ? "high" : "medium", before: prev?.w != null ? prev.p : undefined,
      after: b.p, confirmed: c.p });
    return { point: p, event: evidence({
      tS: rounded(p.t), brewElapsedS: rounded(p.t - brewStartS), confirmedThroughS: rounded(c.p.t), previousBelowGramS: prev?.w != null ? rounded(prev.p.t) : null,
      weightG: rounded(a.w!), pressureBar: roundedReading(pressure(p)), inletFlowMlS: roundedReading(flow(p)),
      pressureAtPreviousBelowGramBar: prev?.w != null ? roundedReading(pressure(prev.p)) : null,
      pressureAtConfirmationBar: roundedReading(pressure(c.p)),
      countedVolumeMl: evidence(volume == null ? null : rounded(volume), "recorded",
        volume != null ? "machine_counted_volume" : p.countedVolumeMl === 0 ? "counter_zero_or_not_started" : "counter_not_available"),
    }, "inferred", prev?.w != null ? "three_consecutive_gram_readings" : "already_at_gram_in_first_brew_sample") };
  }
  if (rows.some(row => row.reason === "stale_scale_sample") && rejected === "no_three_consecutive_gram_readings") rejected = "stale_scale_sample";
  return { point: null, event: evidence<never>(null, "inferred", hasScale ? rejected : "no_scale_readings") };
}

function cupRate(rows: ScaleRow[], from: number, to: number, hasScale: boolean): WindowEvidence<number> {
  const first = rows.findIndex(row => row.p.t >= from);
  const left = first > 0 && rows[first].p.t > from ? first - 1 : first;
  let right = rows.findIndex(row => row.p.t >= to);
  if (right < 0) right = rows.length - 1;
  const selected = left >= 0 ? rows.slice(left, right + 1) : [];
  let covered = 0;
  let failure = hasScale ? null : "no_scale_readings";
  for (let i = 1; i < selected.length; i++) {
    const a = selected[i - 1], b = selected[i];
    const reason = scaleEdge(a, b);
    if (reason) failure ??= reason;
    else covered += Math.max(0, Math.min(to, b.p.t) - Math.max(from, a.p.t));
  }
  if (failure || to - from < 1 || covered + 1e-6 < to - from || selected.length < 3) {
    return windowEvidence(null, from, to, covered, failure ?? "less_than_one_second_or_incomplete_scale_window");
  }
  // Uniform probes give a robust median slope without overweighting densely sampled bursts.
  let i = 1;
  const probes = Array.from({ length: 9 }, (_, j) => {
    const t = interpolate(from, to, j / 8);
    while (selected[i].p.t < t && i + 1 < selected.length) i++;
    const a = selected[i - 1], b = selected[i];
    return { t, w: interpolate(a.w!, b.w!, (t - a.p.t) / (b.p.t - a.p.t)) };
  });
  const slopes = probes.flatMap((a, k) => probes.slice(k + 1).map(b => (b.w - a.w) / (b.t - a.t)));
  return windowEvidence(rounded(median(slopes)), from, to, covered, "covered_median_of_pairwise_slopes");
}

function thermalOffset(p: ReviewPoint, step: ProfileStepLike, sensor: "group" | "mix") {
  const actual = reading(sensor === "group" ? p.groupTemp : p.temp, 0, 150);
  const logged = reading(sensor === "group" ? p.targetGroupTemp : p.targetTemp, 20, 150);
  const plan = reading(profileNumber(step.temperature), 20, 150);
  const target = logged ?? plan;
  return evidence(actual != null && target != null ? { tS: rounded(p.t), actualC: rounded(actual), targetC: rounded(target), offsetC: rounded(actual - target) } : null,
    "recorded", actual == null ? "controlled_sensor_missing" : logged != null ? "logged_temperature_target" : plan != null ? "configured_temperature_target" : "no_temperature_target");
}

function thermalEvidence(run: Run, step: ProfileStepLike | undefined, onset: ReviewPoint | null, lateStart: number) {
  const sensor = step?.sensor?.toLowerCase() === "coffee" ? "group" : step?.sensor?.toLowerCase() === "water" ? "mix" : null;
  if (!sensor || !step) return evidence<never>(null, "recorded", "controlled_sensor_unknown");
  const points = run.points, first = points[0], last = points.at(-1)!;
  const entry = thermalOffset(first, step, sensor);
  const atOnset = onset && points.includes(onset) ? thermalOffset(onset, step, sensor) : evidence<never>(null, "recorded", "onset_not_observed_in_phase");
  const pairs = intervals(points, p => {
    const v = thermalOffset(p, step, sensor).value;
    return [v?.offsetC ?? null];
  }, lateStart, last.t);
  const covered = coverage(pairs);
  const previous = run.previous;
  const measure = (p: ReviewPoint) => reading(sensor === "group" ? p.groupTemp : p.temp, 0, 150);
  const prevC = previous ? measure(previous) : null, entryC = measure(first);
  const loggedTarget = (p: ReviewPoint) => reading(sensor === "group" ? p.targetGroupTemp : p.targetTemp, 20, 150);
  const prevTarget = previous ? loggedTarget(previous) : null;
  const thisTarget = loggedTarget(first);
  const adjacent = previous != null && first.t - previous.t <= MACHINE_GAP_S;
  const boundary = adjacent && prevC != null && entryC != null && previous.substate !== first.substate &&
    first.t > previous.t ? { fromS: rounded(previous.t), toS: rounded(first.t), deltaC: rounded(entryC - prevC) } : null;
  return evidence({
    sensor, entry, atOnset, last: thermalOffset(last, step, sensor),
    lateMedianOffsetC: windowEvidence(covered >= 1 ? rounded(timeMedian(pairs, 0)) : null, lateStart, last.t, covered,
      covered >= 1 ? coverageReason(covered, last.t - lateStart) : "less_than_one_second_of_paired_temperature"),
    stateBoundaryDeltaC: evidence(boundary, "recorded", boundary ? "adjacent_readings_across_state_change" : "no_adjacent_state_boundary_reading"),
    targetChangeAtEntryC: evidence(adjacent && prevTarget != null && thisTarget != null ? rounded(thisTarget - prevTarget) : null,
      "recorded", adjacent && prevTarget != null && thisTarget != null ? "difference_between_adjacent_logged_targets" : "no_adjacent_temperature_target_pair"),
  }, "recorded", "profile_selects_controlled_sensor");
}

function phasePurpose(first: ReviewPoint, step: ProfileStepLike | undefined, mode: Mode | null, delta: number | null) {
  const name = step?.name ?? "";
  if (/bloom|pause/i.test(name) || (mode === "flow" && profileNumber(step?.flow) === 0)) return "bloom_or_pause";
  if (/^preinfusion/i.test(first.substate ?? "") || /fill|soak|infus/i.test(name)) return "fill_or_soak";
  if (/declin|ramp down/i.test(name) || (delta != null && delta < -0.25)) return "decline";
  if (/ramp|rise|pressure up/i.test(name) || (delta != null && delta > 0.25)) return "ramp";
  return mode ? "hold_or_pour" : null;
}

function describePhase(run: Run, index: number, step: ProfileStepLike | undefined, alignmentReason: string,
  scale: ScaleRow[], hasScale: boolean, hasState: boolean, onset: ReviewPoint | null, landmarks?: PhaseLandmark[]) {
  const xs = run.points, first = xs[0], last = xs.at(-1)!;
  const span = last.t - first.t;
  const pump = step?.pump?.toLowerCase();
  const mode = pump === "pressure" || pump === "flow" ? pump : null;
  const command = (p: ReviewPoint) => {
    if (!mode) return null;
    const value = reading(mode === "flow" ? p.tf : p.tp, 0, 20);
    const opposite = positive(mode === "flow" ? p.tp : p.tf);
    // One sample can log the next controller before its frame changes.
    return opposite != null && (value ?? 0) === 0 ? null : value;
  };
  const actual = mode === "flow" ? flow : pressure;
  const other = mode === "flow" ? pressure : flow;
  const limit = positive(profileNumber(step?.limiter?.value));
  const pressureBar = summarizeReadings(xs, pressure);
  const inletFlowMlS = summarizeReadings(xs, flow);
  const loggedCommand = summarizeReadings(xs, command);
  const measurement = loggedCommand.value;
  const delta = measurement?.entry != null && measurement.last != null ? measurement.last - measurement.entry : null;
  const purpose = phasePurpose(first, step, mode, delta);
  if (first !== last && (purpose === "ramp" || purpose === "decline")) {
    landmarks?.push({ kind: purpose === "ramp" ? "planned_rise" : "planned_decline", t: first.t,
      confidence: "medium", before: first, after: last });
  }
  const lateStart = last.t - Math.min(RESPONSE_WINDOW_S, span / 2);
  const earlyEnd = first.t + Math.min(RESPONSE_WINDOW_S, span / 2);
  const early = hydraulicWindow(xs, first.t, earlyEnd), late = hydraulicWindow(xs, lateStart, last.t);
  const crestPoint = pressurePeak(xs);
  const crest = pressureCrest(crestPoint);
  const cap = mode && limit != null ? capTime(xs, command, actual, other, limit, landmarks) :
    windowEvidence<never>(null, first.t, last.t, 0, mode ? "no_configured_limiter" : alignmentReason);
  const controlledError = mode ? residual(xs, command, actual) : windowEvidence<never>(null, first.t, last.t, 0, alignmentReason);
  // A steady logged command is descriptive even if the measured response misses it.
  // Use the settled region for this classification but keep the ramp/entry in the residual.
  const settled = xs.filter(p => p.t - first.t >= 2);
  const paired = settled.filter(p => (command(p) ?? 0) > 0 && actual(p) != null);
  const settledStart = settled[0]?.t ?? last.t;
  const settledSpan = last.t - settledStart;
  const steadyPairs = intervals(settled, p => {
    const target = positive(command(p));
    return [target, actual(p)];
  }, settledStart, last.t);
  const steadyCovered = coverage(steadyPairs);
  const targets = paired.map(p => command(p)!);
  const steadyTarget = mode != null && purpose !== "fill_or_soak" && purpose !== "bloom_or_pause" &&
    span >= 8 && settledSpan >= 5 && paired.length >= 5 &&
    steadyCovered + 1e-6 >= 0.8 * settledSpan &&
    Math.max(...targets) - Math.min(...targets) <= 0.25;

  const steadyMean = (index: number) =>
    rounded(steadyPairs.reduce((sum, { a, b, dt }) => sum + dt * (a[index] + b[index]) / 2, 0) / steadyCovered);
  const steadyHold = windowEvidence(steadyTarget ? {
    meanCommand: steadyMean(0), meanResponse: steadyMean(1), otherMean: summarizeReadings(settled, other).value?.timeWeightedMean ?? null,
  } : null, settledStart, last.t, steadyCovered,
  steadyTarget ? coverageReason(steadyCovered, settledSpan) : !mode ? alignmentReason :
    purpose === "fill_or_soak" || purpose === "bloom_or_pause" ? "fill_soak_or_bloom" :
    span < 8 || settledSpan < 5 ? "short_phase" : paired.length < 5 || steadyCovered < 0.8 * settledSpan ?
      "insufficient_paired_settled_coverage" : "changing_logged_command");

  const peak = crest.value, tail = late.value;
  const heldError = mode === "flow" && crestPoint ? residual(xs.filter(p => p.t >= crestPoint.t), command, actual) : null;
  const peakTarget = crestPoint ? positive(command(crestPoint)) : null;
  const heldFlow = steadyTarget && mode === "flow" && peak != null && tail != null && peakTarget != null && peak.inletFlowMlS != null &&
    peak.tS >= settledStart && peak.tS < lateStart && Math.abs(peak.inletFlowMlS - peakTarget) <= 0.1 * peakTarget &&
    Math.abs(peak.inletFlowMlS - tail.medianInletFlowMlS) <= 0.1 * peakTarget &&
    heldError?.value != null && heldError.coveredS + 1e-6 >= 0.8 * (last.t - peak.tS) &&
    heldError.value.absoluteMean <= 0.1 * peakTarget;
  const decline = evidence(heldFlow && peak && tail ? rounded(peak.pressureBar - tail.medianPressureBar) : null,
    "inferred", heldFlow ? "crest_minus_late_median_at_similar_tracked_inlet_flow" : "no_covered_crest_to_late_comparison_at_held_flow");
  if (landmarks && crestPoint) {
    const at = xs.indexOf(crestPoint);
    if (at > 0 && at < xs.length - 1) {
      landmarks.push({ kind: "phase_pressure_crest", confidence: "high", t: crestPoint.t,
        before: xs[at - 1], at: crestPoint, after: xs[at + 1] });
    }
    if (decline.value != null && decline.value > 0) {
      landmarks.push({ kind: "pressure_droop_at_held_flow", confidence: "medium", t: lateStart,
        before: crestPoint, at: xs.find(p => p.t >= lateStart), after: last });
    }
  }

  const next = run.next;
  const end = next && isBrewPoint(next, hasState) ?
    evidence({ nextFrame: next.frame, nextSubstate: next.substate, nextSampleS: rounded(next.t) }, "recorded",
      next.t - last.t <= MACHINE_GAP_S ? "next_brew_phase_observed_trigger_unknown" : "next_brew_phase_after_gap_trigger_unknown") :
    evidence<never>(null, "recorded", "no_adjacent_next_brew_phase");
  const plannedTarget = mode ? profileNumber(mode === "pressure" ? step?.pressure : step?.flow) : null;
  const massRows = scale.filter(row => row.p.t >= first.t && row.p.t <= last.t);
  const phaseWeight = massRows.filter(row => row.w != null);
  const massStart = phaseWeight[0], massEnd = phaseWeight.at(-1);
  const cupRateEarlyGS = cupRate(scale, first.t, earlyEnd, hasScale);
  const cupRateLateGS = cupRate(scale, lateStart, last.t, hasScale);
  const massFault = massRows.slice(1).map((row, i) => scaleEdge(massRows[i], row)).find(Boolean);
  return {
    id: `phase-${index}`, index, frame: first.frame, substate: first.substate, fromS: rounded(first.t), toS: rounded(last.t), durationS: rounded(span),
    phaseSource: "recorded" as const, phaseReason: first.substate ? "contiguous_frame_and_machine_substate" : "machine_substate_missing_assumed_brew",
    purpose: evidence(purpose, "inferred", purpose ? "frame_label_substate_or_command_shape" : alignmentReason),
    mode: evidence<Mode>(mode, "recorded", mode ? "recorded_profile_step" : alignmentReason),
    plan: evidence(step ? {
      name: step.name ?? null, transition: step.transition ?? null, endpoint: plannedTarget, maximumS: profileNumber(step.seconds),
      temperatureC: profileNumber(step.temperature),
      limiter: limit == null ? null : { value: limit, unit: mode === "flow" ? "bar" : mode === "pressure" ? "mL/s" : null, range: profileNumber(step.limiter?.range) },
      exit: step.exit ? { type: step.exit.type ?? null, condition: step.exit.condition ?? null, value: step.exit.value ?? null } : null,
      weightG: positive(profileNumber(step.weight)), volumeMl: positive(profileNumber(step.volume)),
    } : null, "recorded", step ? "recorded_profile_configuration" : alignmentReason),
    controlledUnit: mode === "pressure" ? "bar" : mode === "flow" ? "mL/s" : null,
    loggedCommand: mode ? loggedCommand : { ...evidence<never>(null, "recorded", alignmentReason), coveredS: 0 },
    pressureBar, inletFlowMlS, controlledError, capLikeTime: cap, steadyHold,
    earlyHydraulics: early, lateHydraulics: late, pressureCrest: crest, pressureDroopAtHeldFlowBar: decline,
    cupRateEarlyGS, cupRateLateGS,
    cupGainG: evidence(massStart && massEnd && massStart !== massEnd && !massFault ? rounded(massEnd.w! - massStart.w!) : null,
      "inferred", !hasScale ? "no_scale_readings" : massFault ?? (massStart && massEnd && massStart !== massEnd ? "difference_between_recorded_weights" : "insufficient_scale_readings")),
    temperature: thermalEvidence(run, step, onset, lateStart),
    nextPhase: end,
  };
}

export type PhaseEvidence = ReturnType<typeof describePhase>;

/** A pouring-only trace with placeholders at frame zero cannot identify a multi-step plan. */
export function ambiguousZeroFrames(input: ReviewInput, points: ReviewPoint[]): boolean {
  return (input.profile?.steps?.length ?? 0) !== 1 && points.length > 0 &&
    points.every(p => p.frame === 0 && /^pour/i.test(p.substate ?? ""));
}

export function measurePhases(input: ReviewInput, points: ReviewPoint[], landmarks?: PhaseLandmark[]) {
  const hasState = points.some(p => p.substate);
  const runs = phaseRuns(points, hasState);
  const steps = input.profile?.steps ?? [];
  const brew = points.filter(p => isBrewPoint(p, hasState));
  const allZeroPour = ambiguousZeroFrames(input, points);
  const alignmentReason = input.profile?.beverage_type === "manual" ? "manual_control" :
    allZeroPour ? "all_frames_zero_only_pouring_plan_alignment_ambiguous" :
    steps.length === 0 ? "recorded_profile_steps_missing" : null;
  const hasScale = brew.some(p => p.w != null || p.weightFlow != null);
  const scale = scaleRows(points, hasState);
  const first = brew[0], last = brew.at(-1);
  const onset = firstBeverage(scale, hasScale, first?.t, landmarks);
  const phases = runs.map((run, index) => {
    const frame = run.points[0].frame;
    const step = !alignmentReason && frame != null && Number.isInteger(frame) ? steps[frame] : undefined;
    const mode = step?.pump?.toLowerCase();
    const points = run.points;
    const incompatible = (mode === "flow" || mode === "pressure") &&
      !points.some(p => positive(mode === "flow" ? p.tf : p.tp) != null) &&
      points.some(p => positive(mode === "flow" ? p.tp : p.tf) != null);
    return describePhase(run, index, incompatible ? undefined : step,
      alignmentReason ?? (incompatible ? "logged_controller_conflicts_with_frame" : step ? "configured_controller_unknown" : "frame_missing_or_out_of_plan"),
      scale, hasScale, hasState, onset.point, landmarks);
  });
  const rateBoundary = onset.point?.t ?? null;
  const before = rateBoundary != null && first ? cupRate(scale, Math.max(first.t, rateBoundary - ONSET_WINDOW_S), rateBoundary, hasScale) : null;
  const after = rateBoundary != null && last ? cupRate(scale, rateBoundary, Math.min(last.t, rateBoundary + ONSET_WINDOW_S), hasScale) : null;
  const lastPhase = phases.at(-1);
  const executed = new Set(phases.filter(p => p.plan.value).map(p => p.frame));
  const weightStop = input.stopReason?.toLowerCase() === "targetweight";
  const terminalFrame = lastPhase?.plan.value ? lastPhase.frame : null;
  const missed = steps.flatMap((step, frame) => {
    if (terminalFrame == null || executed.has(frame)) return [];
    const status = frame < terminalFrame ? "skipped_or_unrecorded" : weightStop ? "preempted_by_weight_stop" : "not_observed_before_recording_ended";
    return [{ frame, name: step.name ?? null, status }];
  });
  const dose = positive(input.doseG), suppliedYield = positive(input.yieldG);
  const annotated = positive(input.annotatedYieldG);
  // The last machine snapshot can reuse the previous fresh scale sample.
  const lastScale = last ? scale.findLast(row => row.p.t <= last.t && last.t - row.p.t <= SCALE_GAP_S) : undefined;
  const previousScale = lastScale ? scale[scale.indexOf(lastScale) - 1] : undefined;
  const finalWeightJump = previousScale && lastScale && scaleEdge(previousScale, lastScale) === "weight_jump";
  const lastScaleValue = finalWeightJump ? null : lastScale?.w ?? null;
  if (landmarks) {
    const start = points[0], end = points.at(-1);
    if (start) landmarks.push({ kind: "recording_start", t: start.t, confidence: "high", after: start });
    if (end) landmarks.push({ kind: "recording_end", t: end.t, confidence: "high", before: end });
    const crest = pressurePeak(brew);
    if (crest) {
      const index = points.indexOf(crest);
      landmarks.push({ kind: "brew_pressure_crest", confidence: "high", t: crest.t,
        before: points[index - 1], at: crest, after: points[index + 1] });
    }
    const phaseEntries = new Map(runs.map((run, i) => [run.points[0], phases[i]]));
    const phaseExits = new Map(runs.map((run, i) => [run.points.at(-1)!, phases[i]]));
    for (const [i, point] of points.entries()) {
      const prev = points[i - 1];
      if (!prev || (prev.frame === point.frame && prev.substate === point.substate)) continue;
      const ending = phaseExits.get(prev), starting = phaseEntries.get(point);
      const fromLimiter = ending?.plan.value?.limiter ?? null;
      const toLimiter = starting?.plan.value?.limiter ?? null;
      const limitChanged = (fromLimiter?.value !== toLimiter?.value || fromLimiter?.unit !== toLimiter?.unit ||
        fromLimiter?.range !== toLimiter?.range);
      landmarks.push({ kind: "phase_boundary", t: point.t, before: prev, after: point,
        confidence: point.t - prev.t <= MACHINE_GAP_S ? "high" : "low",
        detail: {
          ...(starting?.purpose.value ? { entering: starting.purpose.value } : {}),
          ...(limitChanged ? { fromLimiter, toLimiter } : {}),
        } });
    }
    for (const [i, row] of scale.entries()) {
      const prev = scale[i - 1];
      if (!prev || !isBrewPoint(prev.p, hasState) || !isBrewPoint(row.p, hasState)) continue;
      const reason = scaleEdge(prev, row);
      if (reason === "weight_jump" || reason === "scale_gap" || reason === "stale_scale_sample") {
        landmarks.push({ kind: reason === "weight_jump" ? reason : "scale_gap", confidence: "high",
          t: row.p.t, before: prev.p, after: row.p });
      }
    }
    if (last) {
      const index = points.indexOf(last);
      const reason = input.stopReason;
      landmarks.push({ kind: "stop", confidence: reason ? "medium" : "low", t: last.t,
        before: last, after: points[index + 1], detail: reason });
    }
  }
  return {
    phases,
    firstSustainedBeverage: onset.event,
    cupRateBeforeOnsetGS: before ?? evidence<never>(null, "inferred", hasScale ? "no_confirmed_onset" : "no_scale_readings"),
    cupRateAfterOnsetGS: after ?? evidence<never>(null, "inferred", hasScale ? "no_confirmed_onset" : "no_scale_readings"),
    cupRateChangeAtOnsetGS: evidence(before?.value != null && after?.value != null ? rounded(after.value - before.value) : null, "inferred",
      before?.value != null && after?.value != null ? "difference_between_covered_before_and_after_slopes" : "both_onset_rate_windows_required"),
    scaleClock: evidence(hasScale ? (brew.some(p => p.scaleSampleS != null) ? "scale_timestamps_checked" :
      brew.some(p => p.scaleAgeS != null) ? "scale_age_checked" : "machine_timestamps_only") : null, "recorded",
      hasScale ? "cup_windows_use_recording_clock" : "no_scale_readings"),
    scaleAvailability: {
      weightSamples: scale.filter(row => row.w != null).length,
      staleSamples: scale.filter(row => row.reason === "stale_scale_sample").length,
      pairingAgeS: evidence(roundedReading(brew.reduce<number | null>((max, p) => {
        if (weight(p) == null) return max;
        const age = p.scaleAgeS ?? (p.scaleSampleS != null ? p.t - p.scaleSampleS : null);
        return age == null ? max : Math.max(max ?? 0, Math.abs(age));
      }, null)), "inferred", brew.some(p => weight(p) != null && (p.scaleAgeS != null || p.scaleSampleS != null)) ?
        "max_absolute_scale_pairing_age" : "no_timestamp_or_age_for_recorded_weight"),
    },
    thermalAvailability: {
      mixSamples: brew.filter(p => reading(p.temp, 0, 150) != null).length,
      groupSamples: brew.filter(p => reading(p.groupTemp, 0, 150) != null).length,
    },
    finish: {
      annotatedYieldG: evidence(annotated, "recorded", annotated != null ? "shot_annotation" : input.annotatedYieldG === null ? "no_positive_yield_annotation" : "annotation_provenance_not_available"),
      suppliedYieldG: evidence(suppliedYield, "recorded", suppliedYield != null ? "supplied_shot_yield_may_include_last_weight_fallback" : "no_positive_yield"),
      lastRecordedWeightG: evidence(lastScaleValue, "recorded", lastScaleValue != null ?
        (lastScale?.p === last ? "last_brew_sample" : "last_fresh_paired_scale_sample") :
        hasScale ? finalWeightJump ? "weight_jump" : lastScale?.reason ?? "no_fresh_final_weight" : "no_scale_readings"),
      yieldToDoseRatio: evidence(dose && suppliedYield ? rounded(suppliedYield / dose) : null, "inferred", dose && suppliedYield ? "supplied_yield_divided_by_dose" : "positive_dose_and_yield_required"),
      stopSource: evidence(input.stopReason, "recorded", input.stopReason ? "recorded_stop_reason" : "stop_reason_missing"),
      lastObservedPhase: evidence(lastPhase ? { index: lastPhase.index, frame: lastPhase.frame, toS: lastPhase.toS } : null,
        "recorded", lastPhase ? "last_brew_sample_may_precede_stop" : "no_brew_samples"),
      unobservedPlanPhases: evidence(terminalFrame != null ? missed : null, "inferred",
        terminalFrame != null ? "plan_after_or_between_observed_frames" : alignmentReason ?? "last_frame_not_aligned_to_plan"),
      volumeCountStartFrame: evidence(profileNumber(input.volumeCountStartFrame), "recorded",
        input.volumeCountStartFrame != null ? "recorded_profile_count_start" : "count_start_not_available"),
    },
  };
}
