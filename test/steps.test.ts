import { describe, expect, it } from "vitest";
import { steadyWeightFlow, stepProgress, stepTimes, stopReason, type StepPoint } from "../server/control/index.js";

// Shaped like a Decaid profile: numbers as strings, exits as objects.
const steps = [
  { name: "Fill", pump: "flow", flow: "6.0", pressure: "0", transition: "fast", seconds: "12", temperature: "92", exit: { type: "pressure", condition: "over", value: "3.0" } },
  { name: "Soak", pump: "pressure", pressure: "3.0", flow: "0", transition: "fast", seconds: "8", temperature: "92" },
  { name: "Rise", pump: "pressure", pressure: "9.0", flow: "0", transition: "fast", seconds: "4", temperature: "91.5" },
  { name: "Decline", pump: "pressure", pressure: "6.0", flow: "0", transition: "smooth", seconds: "30", temperature: "91", exit: { type: "flow", condition: "over", value: "3.0" } },
];

/** A four-step shot sampled every 0.25 s up to `until`: fill 0–5 s, soak 5–13, rise 13–17, decline from 17. Weight starts at 12 s and rises 1.5 g/s. */
function shot(until: number, over: (p: Required<StepPoint>) => Partial<StepPoint> = () => ({})): StepPoint[] {
  const out: StepPoint[] = [];
  for (let t = 0; t <= until + 1e-9; t += 0.25) {
    const frame = t < 5 ? 0 : t < 13 ? 1 : t < 17 ? 2 : 3;
    const p = frame === 0 ? (t / 5) * 3 : frame === 1 ? 3 : frame === 2 ? 9 : 9 - (t - 17) * 0.1;
    const base = { t, p, f: frame === 0 ? 6 : 2, w: Math.max(0, (t - 12) * 1.5), frame };
    out.push({ ...base, ...over(base) });
  }
  return out;
}

describe("stepProgress", () => {
  it("follows a normal four-step shot", () => {
    const r = stepProgress({ steps, points: shot(20), targetYieldG: 36, weightFlow: 1.5 });
    expect(r.index).toBe(3);
    expect(r.count).toBe(4);
    expect(r.steps.map((s) => [s.name, s.state, s.elapsedS, s.limitS])).toEqual([["Fill", "done", 5, 12], ["Soak", "done", 8, 8], ["Rise", "done", 4, 4], ["Decline", "now", 3, 30]]);
    expect(r.steps[0].target).toEqual({ kind: "flow", value: 6, smooth: false });
    expect(r.steps[3].target).toEqual({ kind: "pressure", value: 6, smooth: true });
    expect(r.steps[2].tempC).toBe(91.5);
    expect(r.steps.slice(0, 3).every((s) => s.tracking === null)).toBe(true);
    // 12 g of 36 g is further along than 3 s of 30 s, or flow 2 of 3 ml/s (which hasn't moved).
    expect(r.steps[3].tracking).toEqual({ kind: "yield", progress: 12 / 36, value: 12, goal: 36 });
    expect(r.yieldFraction).toBeCloseTo(1 / 3);
    expect(r.etaS).toBe(16); // 24 g to go at 1.5 g/s
  });

  it("tracks a pressure exit by how far pressure has come since the step began, and the clock when that leads", () => {
    const fill = stepProgress({ steps, points: shot(2.5), targetYieldG: 36 });
    expect(fill.index).toBe(0);
    expect(fill.steps.map((s) => s.state)).toEqual(["now", "ahead", "ahead", "ahead"]);
    expect(fill.steps[1].elapsedS).toBeNull();
    expect(fill.steps[0].tracking).toMatchObject({ kind: "pressureOver", goal: 3 });
    expect(fill.steps[0].tracking!.progress).toBeCloseTo(0.5);
    const soak = stepProgress({ steps, points: shot(9), targetYieldG: 36 });
    expect(soak.steps[1].tracking).toEqual({ kind: "time", progress: 0.5, value: 4, goal: 8 });
    expect(soak.yieldFraction).toBe(0);
    expect(soak.etaS).toBeNull();
  });

  it("tracks a falling exit, a step weight and a step volume", () => {
    const s = [{ name: "Bloom", pump: "flow", flow: "0", seconds: "30", exit: { type: "pressure", condition: "under", value: "1.0" } }];
    const pts = [{ t: 0, p: 4, f: 0, w: 0, frame: 0 }, { t: 3, p: 2.5, f: 0, w: 0, frame: 0 }];
    expect(stepProgress({ steps: s, points: pts }).steps[0].tracking).toEqual({ kind: "pressureUnder", progress: 0.5, value: 2.5, goal: 1 });
    const byWeight = [{ name: "Infuse", pump: "pressure", pressure: "3", seconds: "20", weight: "5" }];
    expect(stepProgress({ steps: byWeight, points: [{ t: 0, w: 0, frame: 0 }, { t: 2, w: 4, frame: 0 }] }).steps[0].tracking).toEqual({ kind: "weight", progress: 0.8, value: 4, goal: 5 });
    const byVolume = [{ name: "Fill", pump: "flow", flow: "4", seconds: "60", volume: "40" }];
    expect(stepProgress({ steps: byVolume, points: [{ t: 0, f: 4, frame: 0 }, { t: 5, f: 4, frame: 0 }], hasScale: false }).steps[0].tracking).toEqual({ kind: "volume", progress: 0.5, value: 20, goal: 40 });
  });

  it("returns no steps for an empty or missing profile, and still reports the yield", () => {
    for (const none of [[], null, undefined]) {
      const r = stepProgress({ steps: none, points: shot(20), targetYieldG: 24 });
      expect(r).toMatchObject({ steps: [], index: null, count: 0, yieldFraction: 0.5 });
    }
    expect(stepProgress({ steps, points: [] })).toMatchObject({ index: null, count: 4, yieldFraction: null, etaS: null });
  });

  it("has no current step while the frame is null or one the profile doesn't have", () => {
    const blank = stepProgress({ steps, points: shot(6, () => ({ frame: null })) });
    expect(blank.index).toBeNull();
    expect(blank.steps.every((s) => s.state === "ahead" && s.elapsedS === null && s.tracking === null)).toBe(true);
    expect(stepProgress({ steps, points: shot(6, () => ({ frame: 7 })) }).index).toBeNull();
    expect(stepProgress({ steps, points: shot(6, () => ({ frame: -1 })) }).index).toBeNull();
    expect(stepProgress({ steps, points: shot(6, () => ({ frame: 1.5 })) }).index).toBeNull();
    // A frame past the end after real ones: the last real step stays current.
    const past = stepProgress({ steps, points: shot(20, (p) => (p.t >= 19 ? { frame: 4 } : {})) });
    expect(past.index).toBe(3);
    expect(past.steps[3].elapsedS).toBe(3);
  });

  it("marks a step the frames jumped over as done with no time", () => {
    const r = stepProgress({ steps, points: shot(15, (p) => (p.frame === 1 ? { frame: 0 } : {})) });
    expect(r.steps.map((s) => [s.state, s.elapsedS])).toEqual([["done", 13], ["done", 0], ["now", 2], ["ahead", null]]);
  });

  it("ignores a frame that goes backwards", () => {
    const r = stepProgress({ steps, points: shot(15, (p) => (p.t === 14 ? { frame: 0 } : {})) });
    expect(r.index).toBe(2);
    expect(r.steps.map((s) => s.elapsedS)).toEqual([5, 8, 2, null]);
    expect(stepTimes([{ t: 0, frame: 1 }, { t: 1, frame: 0 }, { t: 2, frame: 1 }], 3)).toEqual({ index: 1, start: [0, 0, null], lastT: 2 });
  });

  it("gives no yield or time to go without a scale or without a target", () => {
    const noScale = stepProgress({ steps, points: shot(20, () => ({ w: 0 })), targetYieldG: 36, hasScale: false });
    expect(noScale).toMatchObject({ index: 3, yieldFraction: null, etaS: null });
    expect(noScale.steps[3].tracking!.kind).toBe("time");
    const noWeights = stepProgress({ steps, points: shot(20, () => ({ w: undefined })), targetYieldG: 36 });
    expect(noWeights).toMatchObject({ yieldFraction: null, etaS: null });
    for (const targetYieldG of [null, 0, undefined]) expect(stepProgress({ steps, points: shot(20), targetYieldG, weightFlow: 1.5 })).toMatchObject({ yieldFraction: null, etaS: null });
  });

  it("reports a manual profile's step without a target or an exit", () => {
    const manual = [{ name: "hold", pump: "flow", flow: "0.0", pressure: "", seconds: "60" }, { name: "decline", pump: "flow", flow: "0.0", seconds: "60" }];
    const r = stepProgress({ steps: manual, points: shot(20, () => ({ frame: 0 })), targetYieldG: 36, manual: true });
    expect(r.index).toBe(0);
    expect(r.steps[0]).toMatchObject({ name: "hold", state: "now", elapsedS: 20, limitS: 60, target: null, tracking: null });
    expect(r.yieldFraction).toBeCloseTo(1 / 3);
  });

  it("caps the yield at 1 and the time to go at zero once the target is passed", () => {
    expect(stepProgress({ steps, points: shot(40), targetYieldG: 36 })).toMatchObject({ yieldFraction: 1, etaS: 0 });
  });
});

describe("steadyWeightFlow", () => {
  const ramp = (rate: (t: number) => number, from = 10, to = 14) => {
    const out: StepPoint[] = [];
    let w = 5;
    for (let t = from; t <= to + 1e-9; t += 0.25) { out.push({ t, w }); w += rate(t) * 0.25; }
    return out;
  };
  it("is the rate over the last two seconds when both halves agree", () => {
    expect(steadyWeightFlow(ramp(() => 2))).toBeCloseTo(2);
    expect(steadyWeightFlow(ramp(() => 2), 2.2)).toBeCloseTo(2);
  });
  it("waits for weight, for enough samples, and for the flow to settle", () => {
    expect(steadyWeightFlow([])).toBeNull();
    expect(steadyWeightFlow(ramp(() => 0.4, 10, 14).map((p) => ({ ...p, w: p.w! - 4.8 })))).toBeNull(); // under 2 g
    expect(steadyWeightFlow(ramp(() => 2, 13, 14))).toBeNull(); // one second of samples
    expect(steadyWeightFlow(ramp(() => 0.1))).toBeNull(); // dripping
    expect(steadyWeightFlow(ramp((t) => (t < 13 ? 1 : 3)))).toBeNull(); // speeding up
    expect(steadyWeightFlow(ramp(() => 2), 0.1)).toBeNull(); // the scale says it has stopped
    expect(steadyWeightFlow(ramp(() => 2), 5)).toBeNull(); // the scale disagrees
  });
  it("keeps the time to go within bounds", () => {
    expect(stepProgress({ steps, points: ramp(() => 0.4), targetYieldG: 500 }).etaS).toBe(120);
  });
});

describe("stopReason", () => {
  it("uses Decaid's recorded reason when it has a known one", () => {
    expect(stopReason({ recorded: "targetWeight", finalWeightG: 43.5, targetYieldG: 45 })).toEqual({ reason: "weight", source: "recorded", nearTarget: true });
    expect(stopReason({ recorded: "targetVolume" }).reason).toBe("volume");
    expect(stopReason({ recorded: "apiStop" }).reason).toBe("user");
    expect(stopReason({ recorded: "appStop" }).reason).toBe("user");
    expect(stopReason({ recorded: "error" }).reason).toBe("error");
    expect(stopReason({ recorded: "machineEnded" })).toEqual({ reason: "machine", source: "recorded", nearTarget: null });
    // The record wins over what Crema would have inferred.
    expect(stopReason({ recorded: "apiStop", finalWeightG: 36, targetYieldG: 36 }).reason).toBe("user");
  });
  it("names the profile for a machine-ended shot whose last step ran to its limit", () => {
    expect(stopReason({ recorded: "machineEnded", steps, points: shot(47), finalWeightG: 20, targetYieldG: 60 })).toMatchObject({ reason: "profile", source: "recorded" });
    expect(stopReason({ recorded: "machineEnded", steps, points: shot(30), finalWeightG: 20, targetYieldG: 60 }).reason).toBe("machine");
  });
  it("infers when the record has no reason or one it doesn't know", () => {
    expect(stopReason({ recorded: "somethingNew", finalWeightG: 35.2, targetYieldG: 36 })).toEqual({ reason: "weight", source: "inferred", nearTarget: true });
    expect(stopReason({ recorded: null, stoppedByCrema: true, finalWeightG: 36, targetYieldG: 36 })).toEqual({ reason: "user", source: "inferred", nearTarget: true });
    expect(stopReason({ finalWeightG: 20, targetYieldG: 60, steps, points: shot(47) })).toEqual({ reason: "profile", source: "inferred", nearTarget: false });
  });
  it("prefers unknown to a guess", () => {
    expect(stopReason({})).toEqual({ reason: "unknown", source: "inferred", nearTarget: null });
    expect(stopReason({ finalWeightG: 22, targetYieldG: 36 })).toMatchObject({ reason: "unknown", nearTarget: false });
    expect(stopReason({ finalWeightG: 41, targetYieldG: 36 }).reason).toBe("unknown");
    expect(stopReason({ finalWeightG: 36, targetYieldG: 0 })).toMatchObject({ reason: "unknown", nearTarget: null });
    expect(stopReason({ finalWeightG: 36, targetYieldG: 36, stopAtWeight: false })).toMatchObject({ reason: "unknown", nearTarget: true });
    // At the target as the last step ran out: either could have ended it.
    expect(stopReason({ finalWeightG: 36, targetYieldG: 36, steps, points: shot(47) })).toMatchObject({ reason: "unknown", nearTarget: true });
    // The last step ended early, or the shot never reached it.
    expect(stopReason({ finalWeightG: 20, targetYieldG: 60, steps, points: shot(30) }).reason).toBe("unknown");
    expect(stopReason({ finalWeightG: 20, targetYieldG: 60, steps, points: shot(15) }).reason).toBe("unknown");
  });
});
