import type { ProfileLike } from "./curve.js";
import type { ReviewInput, ReviewIssue } from "../recommend/review-types.js";

export interface ShotAnalysisMetrics {
  recordedPoints: number;
  usableTemperaturePoints: number;
  meanTemperatureOffsetC: number | null;
  observedWindows: number;
}

export interface ShotAnalysis {
  issues: ReviewIssue[];
  wentWell: string[];
  metrics: ShotAnalysisMetrics;
}

const finite = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);
const number = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function stepAt(profile: ProfileLike, frame: number | null) {
  if (frame == null || !Number.isInteger(frame) || frame < 0) return null;
  return profile.steps?.[frame] ?? null;
}

function skippedStep(profile: ProfileLike, step: NonNullable<ReturnType<typeof stepAt>>, target: number) {
  const title = `${profile.title ?? ""} ${step.name ?? ""}`.toLowerCase();
  if (profile.beverage_type === "manual" || /turbo|bloom|pre.?infusion/.test(title)) return true;
  if (target <= 0 || number(step.limiter?.value) != null && number(step.limiter?.value)! > 0) return true;
  // High flow targets are often intentional, so don't grade them as faults.
  if ((step.pump === "flow" || step.pump === "Flow") && target > 3) return true;
  return false;
}

type Window = {
  frame: number;
  start: number;
  end: number;
  target: number;
  actuals: number[];
  flows: (number | null)[];
  pump: "pressure" | "flow";
  step: NonNullable<ReturnType<typeof stepAt>>;
};

function targetAndActual(input: ReviewInput, point: ReviewInput["points"][number]) {
  const step = stepAt(input.profile!, point.frame);
  if (!step || point.frame == null) return null;
  if (step.pump !== "flow" && step.pump !== "pressure") return null;
  const pump: "pressure" | "flow" = step.pump === "flow" ? "flow" : "pressure";
  const target = pump === "pressure" ? point.tp : point.tf;
  const actual = pump === "pressure" ? point.p : point.f;
  if (!finite(target) || !finite(actual) || target <= 0 || skippedStep(input.profile!, step, target)) return null;
  return { pump, target, actual, step };
}

/**
 * Conservative, deterministic observations from recorded telemetry. Missing
 * samples are unknown. A candidate must have a known profile frame, a steady
 * recorded target, and a settled window of at least eight seconds.
 */
export function analyzeShot(input: ReviewInput): ShotAnalysis {
  const issues: ReviewIssue[] = [];
  const profile = input.profile;
  const points = [...input.points].filter((p) => finite(p.t)).sort((a, b) => a.t - b.t);
  const targets = points.map((p) => ({ p, data: profile ? targetAndActual(input, p) : null }));

  const windows: Window[] = [];
  let run: typeof targets = [];
  const flush = () => {
    if (run.length < 6) { run = []; return; }
    const first = run[0], last = run.at(-1)!;
    if (last.p.t - first.p.t < 8 || !first.data) { run = []; return; }
    // Skip the first two seconds in a frame as pump pressure and flow settle.
    const settled = run.filter(({ p, data }) => p.t - first.p.t >= 2 && data != null);
    if (settled.length < 5 || settled.at(-1)!.p.t - settled[0].p.t < 5) { run = []; return; }
    const ts = settled.map((x) => x.data!.target);
    if (Math.max(...ts) - Math.min(...ts) > 0.25) { run = []; return; }
    windows.push({
      frame: first.p.frame!, start: settled[0].p.t, end: settled.at(-1)!.p.t,
      target: ts.reduce((a, b) => a + b, 0) / ts.length,
      actuals: settled.map((x) => x.data!.actual),
      flows: settled.map((x) => finite(x.p.f) ? x.p.f : null),
      pump: first.data.pump, step: first.data.step,
    });
    run = [];
  };
  for (const entry of targets) {
    const current = entry.data;
    const prev = run.at(-1);
    const compatible = current && prev?.data && entry.p.frame === prev.p.frame && current.pump === prev.data.pump &&
      Math.abs(current.target - prev.data.target) <= 0.25 && entry.p.t - prev.p.t <= 1.5;
    if (!compatible) flush();
    if (current) run.push(entry);
  }
  flush();

  for (const w of windows) {
    const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    const actual = avg(w.actuals);
    const flowValues = w.flows.filter(finite);
    const flowCoverage = flowValues.length / w.flows.length;
    const flow = avg(flowValues);
    if (actual == null) continue;
    const ratio = actual / w.target;
    let kind: string | null = null;
    let what = "";
    if (w.pump === "flow" && ratio <= 0.55) {
      kind = "choked";
      what = "Flow stayed well below the profile's flow target.";
    } else if (w.pump === "flow" && ratio >= 1.55) {
      kind = "gushed";
      what = "Flow stayed well above the profile's flow target.";
    } else if (w.pump === "pressure" && ratio <= 0.55 && flowCoverage >= 0.8 && flow != null && flow >= 3.5) {
      kind = "gushed";
      what = "Pressure stayed well below target while flow remained high.";
    } else if (w.pump === "pressure" && flowCoverage >= 0.8 && flow != null && flow <= 0.5 && actual >= 4) {
      kind = "choked";
      what = "Flow stayed very low while pressure remained high.";
    }
    if (kind) {
      issues.push({
        kind, what,
        evidence: `${(w.end - w.start).toFixed(1)}s in frame ${w.frame + 1}: ${w.pump} target ${w.target.toFixed(1)}, measured ${actual.toFixed(1)}${w.pump === "pressure" ? " bar" : " ml/s"}${flow == null ? "" : `, flow ${flow.toFixed(1)} ml/s`}.`,
        severity: "caution", fromS: w.start, toS: w.end,
      });
    }
    // A gradual flow rise while a pressure target is being held can be
    // consistent with falling puck resistance. Require a long, settled,
    // low-flow pressure window; a single spike is never enough.
    const pressureStable = Math.max(...w.actuals) - Math.min(...w.actuals) <= Math.max(0.5, w.target * 0.15);
    if (w.pump === "pressure" && w.end - w.start >= 15 && flow != null && flowCoverage >= 0.8 &&
        Math.abs(actual / w.target - 1) <= 0.15 && pressureStable && actual >= 4.5 && flowValues.length >= 8 && Math.max(...flowValues) <= 3) {
      const binCount = 4;
      const bins = Array.from({ length: binCount }, (_, i) => {
        const start = Math.floor(i * flowValues.length / binCount);
        const end = Math.floor((i + 1) * flowValues.length / binCount);
        return avg(flowValues.slice(start, end));
      });
      const riseSteps = bins.slice(1).filter((value, i) => value != null && bins[i] != null && value >= bins[i]! + 0.1).length;
      const startFlow = bins[0], endFlow = bins.at(-1);
      if (startFlow != null && endFlow != null && riseSteps >= 3 && startFlow >= 0.4 && endFlow - startFlow >= 0.8 && endFlow >= startFlow * 1.5) {
        issues.push({
          kind: "channeling", what: "Flow rose steadily while pressure stayed near its target.",
          evidence: `${(w.end - w.start).toFixed(1)}s in frame ${w.frame + 1}: four successive flow bins rose from ${startFlow.toFixed(1)} to ${endFlow.toFixed(1)} ml/s while pressure averaged ${actual.toFixed(1)} bar against ${w.target.toFixed(1)} bar.`,
          severity: "caution", fromS: w.start, toS: w.end,
        });
      }
    }
  }

  const tempPairs = points.flatMap((p) => {
    if (!finite(p.temp)) return [];
    // A measured target is authoritative. The profile is only a fallback when
    // the shot recorded a frame that maps to this profile.
    const target = finite(p.targetTemp) ? p.targetTemp : number(stepAt(profile ?? {}, p.frame)?.temperature);
    return target == null ? [] : [{ p, delta: p.temp! - target }];
  });
  const meanTemp = tempPairs.length ? tempPairs.reduce((n, x) => n + x.delta, 0) / tempPairs.length : null;
  if (tempPairs.length >= 5 && tempPairs.at(-1)!.p.t - tempPairs[0].p.t >= 4 && meanTemp != null && Math.abs(meanTemp) > 1.5) {
    const fromS = tempPairs[0].p.t, toS = tempPairs.at(-1)!.p.t;
    issues.push({
      kind: "off_target_temp", what: `Recorded temperature averaged ${meanTemp > 0 ? "above" : "below"} its target.`,
      evidence: `Mean offset ${meanTemp > 0 ? "+" : ""}${meanTemp.toFixed(1)} °C across ${tempPairs.length} paired readings.`,
      severity: "info", fromS, toS,
    });
  }

  const well = windows.filter((w) => {
    if (issues.some((issue) => issue.fromS === w.start && issue.toS === w.end)) return false;
    const avg = w.actuals.reduce((a, b) => a + b, 0) / w.actuals.length;
    return Math.abs(avg / w.target - 1) <= 0.2;
  });
  const wentWell = well.length ? ["The controlled pressure or flow target stayed close to its recorded target."] : [];
  return {
    issues, wentWell,
    metrics: { recordedPoints: points.length, usableTemperaturePoints: tempPairs.length, meanTemperatureOffsetC: meanTemp, observedWindows: windows.length },
  };
}
