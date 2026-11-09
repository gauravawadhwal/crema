/**
 * What a DE1 profile asks the machine to do, as a curve that can be drawn, and a
 * small puck model that follows a profile for the simulators and the demo.
 *
 * A profile is a list of steps. Each step drives either pressure or flow to a
 * target, jumping there ("fast") or ramping across the step ("smooth"), for at
 * most `seconds`. A step can move on earlier on a pressure or flow condition
 * (`exit`) or a weight, and can cap the other quantity (`limiter`). Decaid
 * stores the numbers as strings.
 *
 * Because steps often end early, a step's `seconds` is only its time limit:
 * the curve drawn from limits is the profile's shape, not a timeline. Saved
 * shots record which step was running (`profileFrame`), so `stepDurations`
 * recovers real step times from a past shot of the same profile.
 */

export interface ProfileStepLike {
  name?: string;
  pump?: string;
  transition?: string;
  pressure?: string | number;
  flow?: string | number;
  seconds?: string | number;
  temperature?: string | number;
  weight?: string | number;
  volume?: string | number;
  exit?: { type?: string; condition?: string; value?: string | number } | null;
  limiter?: { value?: string | number; range?: string | number } | null;
}
export interface ProfileLike {
  title?: string;
  beverage_type?: string;
  steps?: ProfileStepLike[];
  target_weight?: string | number;
}

export interface PlanStep {
  index: number;
  name: string;
  pump: "pressure" | "flow";
  target: number;
  smooth: boolean;
  tempC: number | null;
  /** The step's time limit, in seconds. */
  limitS: number;
  /** When it starts and ends on this curve (limits, or a past shot's timings). */
  start: number;
  end: number;
  /** Plain descriptions: what ends it early, and what it caps. */
  exit: string | null;
  cap: string | null;
}
export interface PlanPoint { t: number; tp: number | null; tf: number | null; temp: number | null; frame: number }
export interface ProfileCurve {
  steps: PlanStep[];
  points: PlanPoint[];
  total: number;
  /** "limits": each step drawn for its full time limit. "shot": timed from a past shot. */
  timed: "limits" | "shot";
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

function exitText(s: ProfileStepLike): string | null {
  const parts: string[] = [];
  const e = s.exit;
  const v = num(e?.value);
  if (e && v != null && (e.type === "pressure" || e.type === "flow")) {
    const unit = e.type === "pressure" ? "bar" : "ml/s";
    parts.push(`${e.type} ${e.condition === "under" ? "drops below" : "rises above"} ${fmt(v)} ${unit}`);
  }
  const w = num(s.weight);
  if (w != null && w > 0) parts.push(`${fmt(w)} g is in the cup`);
  const vol = num(s.volume);
  if (vol != null && vol > 0) parts.push(`${fmt(vol)} ml has gone through`);
  return parts.length ? `Moves on when ${parts.join(", or ")}` : null;
}
function capText(s: ProfileStepLike, pump: "pressure" | "flow"): string | null {
  const v = num(s.limiter?.value);
  if (v == null || v <= 0) return null;
  return pump === "flow" ? `Pressure capped at ${fmt(v)} bar` : `Flow capped at ${fmt(v)} ml/s`;
}

/**
 * The curve a profile asks for. With `durations` (seconds per step, from
 * `stepDurations`), steps are drawn for the time they took in that shot;
 * otherwise each for its full time limit.
 */
export function profileCurve(profile: ProfileLike | null | undefined, durations?: number[] | null): ProfileCurve | null {
  const raw = profile?.steps;
  if (!raw?.length) return null;
  const timed = durations && durations.length === raw.length ? "shot" : "limits";
  const steps: PlanStep[] = [];
  const points: PlanPoint[] = [];
  let t = 0;
  let prevP: number | null = null, prevF: number | null = null;
  raw.forEach((s, index) => {
    const pump = s.pump === "flow" ? "flow" : "pressure";
    const target = num(pump === "flow" ? s.flow : s.pressure) ?? 0;
    const limitS = Math.max(0, num(s.seconds) ?? 0);
    const dur = timed === "shot" ? Math.max(0, durations![index]) : limitS;
    const smooth = s.transition === "smooth";
    const tempC = num(s.temperature);
    steps.push({ index, name: s.name || `Step ${index + 1}`, pump, target, smooth, tempC, limitS, start: t, end: t + dur, exit: exitText(s), cap: capText(s, pump) });
    if (dur <= 0) return;
    const prev = pump === "flow" ? prevF : prevP;
    const from = smooth && prev != null ? prev : target;
    const at = (v: number) => (pump === "flow" ? { tp: null, tf: v } : { tp: v, tf: null });
    points.push({ t, ...at(from), temp: tempC, frame: index });
    points.push({ t: t + dur, ...at(target), temp: tempC, frame: index });
    if (pump === "flow") { prevF = target; prevP = null; } else { prevP = target; prevF = null; }
    t += dur;
  });
  return { steps, points, total: t, timed };
}

/**
 * Seconds spent in each step of a shot, from the step number recorded with
 * each sample. Null when the shot doesn't record steps, or records steps the
 * profile doesn't have (a different profile, or firmware extension frames).
 */
export function stepDurations(points: { t: number; frame?: number | null }[], stepCount: number): number[] | null {
  const seen = points.filter((p) => p.frame != null && Number.isInteger(p.frame));
  if (seen.length < 2 || !stepCount) return null;
  if (seen.some((p) => p.frame! < 0 || p.frame! >= stepCount)) return null;
  const first = new Array<number | null>(stepCount).fill(null);
  for (const p of seen) if (first[p.frame!] == null) first[p.frame!] = p.t;
  const out = new Array<number>(stepCount).fill(0);
  const end = seen.at(-1)!.t;
  for (let i = 0; i < stepCount; i++) {
    if (first[i] == null) continue;
    const next = first.slice(i + 1).find((x) => x != null);
    out[i] = Math.max(0, (next ?? end) - first[i]!);
  }
  return out.some((d) => d > 0) ? out : null;
}

/** The target at time `t` on a curve: pressure or flow, and the step. */
export function planAt(curve: ProfileCurve, t: number): { tp: number | null; tf: number | null; frame: number } {
  const pts = curve.points;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const a = pts[i], b = pts[i + 1];
    if (t <= b.t || i + 2 >= pts.length) {
      const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
      const lerp = (x: number | null, y: number | null) => (x == null || y == null ? null : x + (y - x) * k);
      return { tp: lerp(a.tp, b.tp), tf: lerp(a.tf, b.tf), frame: a.frame };
    }
  }
  return { tp: null, tf: null, frame: 0 };
}

/* ---------------- outlines for the simulators and demo ---------------- */

type Outline = [name: string, pump: "pressure" | "flow", target: number, seconds: number, extra?: Partial<ProfileStepLike> & { dT?: number }][];
const over = (type: "pressure" | "flow", value: number) => ({ exit: { type, condition: "over", value: String(value) } });
const under = (type: "pressure" | "flow", value: number) => ({ exit: { type, condition: "under", value: String(value) } });
const cap = (value: number) => ({ limiter: { value: String(value), range: "0.6" } });

// Crema's own simplified step outlines, one per catalogue style. They give the
// simulators and the demo a recognisable shape for each kind of profile; real
// machines use the profiles installed in Decaid.
const OUTLINES: Record<string, Outline> = {
  "flat-pressure": [["Preinfusion", "flow", 4, 12, over("pressure", 3)], ["Extraction", "pressure", 9, 40]],
  lever: [["Fill", "flow", 6, 12, over("pressure", 2.5)], ["Soak", "pressure", 3, 8], ["Rise", "pressure", 9, 4], ["Decline", "pressure", 5, 30, { transition: "smooth", ...over("flow", 2.8) }], ["Flow limit", "flow", 2.5, 30]],
  adaptive: [["Fill", "flow", 6, 12, over("pressure", 3)], ["Rise", "pressure", 9, 6, over("flow", 2.2)], ["Follow the puck", "flow", 2, 40, { transition: "smooth", ...cap(9.5) }]],
  blooming: [["Fill", "flow", 6, 12, over("pressure", 3)], ["Bloom", "flow", 0, 15, { ...under("pressure", 0.8), dT: -1 }], ["Extraction", "flow", 2.2, 40, cap(9)]],
  flow: [["Preinfusion", "flow", 4, 12, over("pressure", 4)], ["Extraction", "flow", 2.2, 40, cap(9)]],
  allonge: [["Fill", "flow", 8, 8, over("pressure", 2)], ["Extraction", "flow", 4.5, 50, cap(7)]],
  turbo: [["Fill", "flow", 8, 6, over("pressure", 3)], ["Extraction", "flow", 4.5, 30, cap(6)]],
  "low-contact": [["Fill", "flow", 8, 12, { ...over("pressure", 4.5), dT: -6 }], ["Bloom", "flow", 0, 25, { ...under("pressure", 2.2), dT: -14 }], ["Extraction", "pressure", 6, 40, { ...cap(3), dT: -8 }]],
  "scale-driven": [["Fill", "flow", 8, 12, { ...over("pressure", 3), weight: "2" }], ["Infuse", "pressure", 3, 20, { weight: "5" }], ["Extraction", "flow", 2, 40, { transition: "smooth", ...cap(9) }]],
};

/** A profile body in Decaid's shape, from Crema's outline for a style. */
export function outlineProfile(title: string, style: string, tempC = 92, targetWeight = 36, author = "Decent"): ProfileLike & { title: string; author: string; notes: string; version: string; target_volume: number } {
  const o = OUTLINES[style] ?? OUTLINES["flat-pressure"];
  return {
    version: "2", title, author, notes: "", beverage_type: "espresso", target_weight: targetWeight, target_volume: 0,
    steps: o.map(([name, pump, target, seconds, extra = {}]) => {
      const { dT = 0, ...rest } = extra;
      return {
        name, pump, transition: "fast", pressure: pump === "pressure" ? String(target) : "0", flow: pump === "flow" ? String(target) : "0",
        seconds: String(seconds), temperature: String(tempC + dT), sensor: "coffee", volume: "0", weight: "0", exit: null, limiter: null, ...rest,
      };
    }),
  };
}

/* ---------------- a puck that follows a profile ---------------- */

export interface ShotSample { t: number; p: number; f: number; w: number; tp: number | null; tf: number | null; frame: number; temp: number | null }

/**
 * Steps a simulated shot through a profile, 0.1 s at a time: the pump chases
 * the step's target, the puck sets how pressure and flow relate, steps move on
 * at their time limit or exit condition. `resistance` stands in for grind
 * (1 = about right). Manual profiles behave as if a hand held a steady value.
 */
export function shotSim(profile: ProfileLike, { resistance = 1 }: { resistance?: number } = {}) {
  const steps = profile.steps?.length ? profile.steps : outlineProfile("", "flat-pressure").steps!;
  const manual = profile.beverage_type === "manual";
  let t = 0, frame = 0, frameStart = 0, p = 0, f = 0, w = 0, water = 0, from: { p: number | null; f: number | null } = { p: null, f: null };
  let done = false, out: { tp: number | null; tf: number | null; frame: number; temp: number | null } = { tp: null, tf: null, frame: 0, temp: null };
  const FILL = 18; // ml to fill the headspace and wet the puck before pressure can build
  return {
    get done() { return done; },
    tick(dt = 0.1): ShotSample {
      if (!done) {
        const s = steps[frame];
        const pump = s.pump === "flow" ? "flow" : "pressure";
        let target = num(pump === "flow" ? s.flow : s.pressure) ?? 0;
        if (manual) target = t < 4 ? (pump === "flow" ? 6 : 3) : pump === "flow" ? 2 : 8;
        const limit = Math.max(0.1, num(s.seconds) ?? 0);
        const into = t - frameStart;
        const prev = pump === "flow" ? from.f : from.p;
        const goal = s.transition === "smooth" && prev != null ? prev + (target - prev) * Math.min(1, into / limit) : target;
        const R = 5.2 * resistance * (1 - 0.35 * Math.min(1, Math.max(0, water - FILL) / 45)); // bar per ml/s
        const capV = num(s.limiter?.value);
        let wantP: number, wantF: number;
        if (pump === "pressure") {
          wantP = goal; wantF = water < FILL ? 6 : goal / R;
          if (capV && capV > 0 && wantF > capV) { wantF = capV; wantP = Math.min(goal, wantF * R); }
        } else {
          wantF = goal; wantP = water < FILL ? Math.min(1.2, goal * 0.3) : goal * R;
          if (capV && capV > 0 && wantP > capV) { wantP = capV; wantF = water < FILL ? goal : wantP / R; }
        }
        const k = Math.min(1, dt / 0.6);
        // Pressure falls slowly when the pump eases off: the puck holds it.
        // The pump raises pressure at most about 8 bar a second.
        p += Math.min(8 * dt, (wantP - p) * (wantP < p ? Math.min(1, dt / 4) : k)) + (Math.random() - 0.5) * 0.05;
        f += (wantF - f) * k + (Math.random() - 0.5) * 0.03;
        p = Math.max(0, p); f = Math.max(0, f);
        water += f * dt;
        if (water > FILL + 4) w += f * dt * 0.92;
        t += dt;
        out = { tp: pump === "pressure" ? goal : null, tf: pump === "flow" ? goal : null, frame, temp: num(s.temperature) };
        // Move on: time limit, exit condition (after half a second), or weight.
        const e = s.exit, ev = num(e?.value), sw = num(s.weight);
        const exitNow = into > 0.5 && ((e && ev != null && ((e.type === "pressure" && (e.condition === "under" ? p < ev : p > ev)) || (e.type === "flow" && (e.condition === "under" ? f < ev : f > ev)))) || (sw != null && sw > 0 && w >= sw));
        if (!manual && (t - frameStart >= limit || exitNow)) {
          from = pump === "flow" ? { p: null, f: goal } : { p: goal, f: null };
          frame += 1; frameStart = t;
          if (frame >= steps.length) { done = true; frame = steps.length - 1; }
        }
      }
      return { t, p, f, w, ...out };
    },
  };
}

/** A whole simulated shot, stopping at `yieldG` (or the profile's end, or 90 s). */
export function simulateShot(profile: ProfileLike, yieldG: number, opts: { resistance?: number; every?: number } = {}): ShotSample[] {
  const sim = shotSim(profile, opts);
  const out: ShotSample[] = [];
  const every = opts.every ?? 0.25;
  let next = 0;
  for (let i = 0; i < 900; i++) {
    const s = sim.tick(0.1);
    if (s.t >= next - 1e-9) { out.push(s); next += every; }
    if (sim.done || (yieldG > 0 && s.w >= yieldG)) { out.push(s); break; }
  }
  return out;
}
