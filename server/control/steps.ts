/**
 * Where a running shot is in its profile: each step's state and time, what the
 * current step is waiting for, how much of the target yield is in the cup and
 * roughly how long is left. Pure: the caller passes the points collected so far
 * (time comes from them, not from a clock), and data comes back, not display text.
 */
import { profileCurve, type ProfileStepLike } from "../profiles/curve.js";

/** A live sample as skin/app.js collects it. `frame` is Decaid's `profileFrame`. */
export interface StepPoint {
  t: number;
  /** Weight on the scale, g. */
  w?: number | null;
  p?: number | null;
  f?: number | null;
  frame?: number | null;
}

export interface StepProgressInput {
  /** The loaded profile's steps, as Decaid stores them. */
  steps: ProfileStepLike[] | null | undefined;
  /** The shot's samples so far, oldest first. */
  points: StepPoint[];
  /** The yield the shot stops at, g. Null or 0 when there is none. */
  targetYieldG?: number | null;
  /** The scale's own flow reading (`weightFlow`), g/s, if it sends one. */
  weightFlow?: number | null;
  /** False when no scale is connected: the points' weights mean nothing. Defaults to true when any point carries a weight. */
  hasScale?: boolean;
  /** A manual (group-head controlled) profile: its steps have no exits to track. */
  manual?: boolean;
}

export type StepExitKind = "time" | "weight" | "volume" | "pressureOver" | "pressureUnder" | "flowOver" | "flowUnder" | "yield";

/** The exit expected to end the current step first. */
export interface StepTracking {
  kind: StepExitKind;
  /** 0..1 of the way to `goal`. */
  progress: number;
  /** Where it is now, in the exit's unit: s, g, ml, bar or ml/s. */
  value: number;
  /** The value that ends the step. */
  goal: number;
}

export interface StepState {
  index: number;
  name: string;
  state: "done" | "now" | "ahead";
  /** Seconds actually spent in the step: set for "done" and "now" (0 when skipped), null for "ahead". */
  elapsedS: number | null;
  /** The step's time limit in seconds, null when it has none. */
  limitS: number | null;
  /** What the step drives. Null for a manual profile, where a hand sets it. */
  target: { kind: "pressure" | "flow"; value: number; smooth: boolean } | null;
  tempC: number | null;
  /** Set on the "now" step only, and null there when nothing can be tracked. */
  tracking: StepTracking | null;
}

export interface StepProgress {
  steps: StepState[];
  /** The current step, 0-based. Null when the profile has no steps or no sample names a step it has. */
  index: number | null;
  count: number;
  /** 0..1 of the target yield. Null with no target or no scale weight. */
  yieldFraction: number | null;
  /** Seconds until the target yield, 0..ETA_MAX_S. Null with no target, no scale, or weight flow not yet steady. */
  etaS: number | null;
}

/** Rule for `etaS`; see `steadyWeightFlow`. */
export const ETA_MIN_WEIGHT_G = 2;
export const ETA_MIN_FLOW_GS = 0.3;
export const ETA_WINDOW_S = 2;
export const ETA_MAX_S = 120;

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

export interface StepTimes {
  /** The furthest step any sample has named, or null. */
  index: number | null;
  /** When each step was entered (null if never). A step jumped over gets the time of the jump. */
  start: (number | null)[];
  /** The time of the last sample, or null with no samples. */
  lastT: number | null;
}

/**
 * When each step began, from the step number on each sample. The step only ever
 * moves forward: a sample naming an earlier step than one already seen (a late or
 * reordered reading) is ignored, as is a step number the profile doesn't have
 * (null, negative, fractional, or beyond the last step).
 */
export function stepTimes(points: StepPoint[], count: number): StepTimes {
  const start = new Array<number | null>(count).fill(null);
  let index: number | null = null;
  let lastT: number | null = null;
  for (const pt of points) {
    if (!Number.isFinite(pt.t)) continue;
    lastT = pt.t;
    const fr = pt.frame;
    if (fr == null || !Number.isInteger(fr) || fr < 0 || fr >= count) continue;
    if (index != null && fr <= index) continue;
    for (let i = (index ?? -1) + 1; i <= fr; i++) start[i] = pt.t;
    index = fr;
  }
  return { index, start, lastT };
}

/**
 * Weight flow in g/s once it is steady, else null. Conservative on purpose, so a
 * time-to-go only shows when it will hold:
 *  - at least ETA_MIN_WEIGHT_G in the cup (first drips and a settling cup are noise);
 *  - samples covering at least three quarters of the last ETA_WINDOW_S seconds;
 *  - both halves of that window rising faster than ETA_MIN_FLOW_GS, and within 35%
 *    of each other;
 *  - if the scale sends its own flow, that is above the threshold too and within
 *    50% of the measured rate.
 */
export function steadyWeightFlow(points: StepPoint[], weightFlow?: number | null): number | null {
  const pts = points.filter((p) => Number.isFinite(p.t) && typeof p.w === "number" && Number.isFinite(p.w));
  const last = pts.at(-1);
  if (!last || last.w! < ETA_MIN_WEIGHT_G) return null;
  const win = pts.filter((p) => p.t >= last.t - ETA_WINDOW_S && p.t <= last.t);
  const first = win[0];
  const span = last.t - first.t;
  if (win.length < 3 || span < ETA_WINDOW_S * 0.75) return null;
  // The sample nearest the middle splits the window in two.
  const midT = first.t + span / 2;
  const mid = win.reduce((a, b) => (Math.abs(b.t - midT) < Math.abs(a.t - midT) ? b : a));
  if (mid.t <= first.t || mid.t >= last.t) return null;
  const a = (mid.w! - first.w!) / (mid.t - first.t);
  const b = (last.w! - mid.w!) / (last.t - mid.t);
  if (a < ETA_MIN_FLOW_GS || b < ETA_MIN_FLOW_GS) return null;
  if (Math.abs(a - b) > 0.35 * Math.max(a, b)) return null;
  const rate = (last.w! - first.w!) / span;
  if (weightFlow != null && Number.isFinite(weightFlow)) {
    if (weightFlow < ETA_MIN_FLOW_GS || Math.abs(weightFlow - rate) > 0.5 * Math.max(weightFlow, rate)) return null;
  }
  return rate;
}

/** Progress from `from` (the value when the step began) toward crossing `goal`. */
function crossing(from: number, now: number, goal: number, over: boolean): number {
  if (over ? now >= goal : now <= goal) return 1;
  const whole = over ? goal - from : from - goal;
  if (whole <= 0) return 0;
  return clamp01((over ? now - from : from - now) / whole);
}

export function stepProgress(i: StepProgressInput): StepProgress {
  const raw = i.steps ?? [];
  const points = i.points ?? [];
  const count = raw.length;
  const plan = profileCurve({ steps: raw })?.steps ?? [];
  const { index, start, lastT } = stepTimes(points, count);

  const last = points.at(-1);
  const hasScale = i.hasScale ?? points.some((p) => typeof p.w === "number" && Number.isFinite(p.w));
  const weight = hasScale && last && typeof last.w === "number" && Number.isFinite(last.w) ? last.w : null;
  const target = i.targetYieldG != null && Number.isFinite(i.targetYieldG) && i.targetYieldG > 0 ? i.targetYieldG : null;

  const steps: StepState[] = plan.map((s, n) => {
    const state = index == null || n > index ? "ahead" : n < index ? "done" : "now";
    const began = start[n];
    const ended = state === "done" ? start[n + 1] : lastT;
    const elapsedS = state === "ahead" || began == null || ended == null ? (state === "ahead" ? null : 0) : round1(Math.max(0, ended - began));
    return {
      index: n, name: s.name, state, elapsedS,
      limitS: s.limitS > 0 ? s.limitS : null,
      target: i.manual ? null : { kind: s.pump, value: s.target, smooth: s.smooth },
      tempC: s.tempC,
      tracking: null,
    };
  });

  if (index != null && !i.manual) {
    const s = raw[index], now = steps[index], began = start[index]!;
    const inStep = points.filter((p) => Number.isFinite(p.t) && p.t >= began);
    const exits: StepTracking[] = [];
    // Listed in the order a tie is settled: a condition before the clock.
    const e = s.exit, ev = num(e?.value);
    if (e && ev != null && (e.type === "pressure" || e.type === "flow")) {
      const read = (p: StepPoint | undefined) => (e.type === "pressure" ? p?.p : p?.f);
      const from = read(inStep[0]), cur = read(last);
      if (typeof from === "number" && typeof cur === "number" && Number.isFinite(from) && Number.isFinite(cur)) {
        const over = e.condition !== "under";
        const kind = (e.type === "pressure" ? (over ? "pressureOver" : "pressureUnder") : over ? "flowOver" : "flowUnder") as StepExitKind;
        exits.push({ kind, progress: crossing(from, cur, ev, over), value: cur, goal: ev });
      }
    }
    const sw = num(s.weight);
    if (sw != null && sw > 0 && weight != null) exits.push({ kind: "weight", progress: clamp01(weight / sw), value: weight, goal: sw });
    if (target != null && weight != null) exits.push({ kind: "yield", progress: clamp01(weight / target), value: weight, goal: target });
    const sv = num(s.volume);
    if (sv != null && sv > 0) {
      // Water through the group in this step, summed from the flow readings (an estimate).
      let ml = 0;
      for (let k = 1; k < inStep.length; k++) ml += Math.max(0, inStep[k].f ?? 0) * Math.max(0, inStep[k].t - inStep[k - 1].t);
      exits.push({ kind: "volume", progress: clamp01(ml / sv), value: round1(ml), goal: sv });
    }
    if (now.limitS != null) exits.push({ kind: "time", progress: clamp01(now.elapsedS! / now.limitS), value: now.elapsedS!, goal: now.limitS });
    // The exit furthest along is the one expected to end the step.
    now.tracking = exits.reduce<StepTracking | null>((best, x) => (!best || x.progress > best.progress ? x : best), null);
  }

  let etaS: number | null = null;
  if (target != null && weight != null) {
    if (weight >= target) etaS = 0;
    else {
      const rate = steadyWeightFlow(hasScale ? points : [], i.weightFlow);
      if (rate != null) etaS = round1(Math.min(ETA_MAX_S, Math.max(0, (target - weight) / rate)));
    }
  }

  return { steps, index, count, yieldFraction: target != null && weight != null ? clamp01(weight / target) : null, etaS };
}
