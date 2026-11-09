import { describe, expect, it } from "vitest";
import { outlineProfile, planAt, profileCurve, simulateShot, stepDurations } from "../server/profiles/curve.js";

// Shaped like a Decaid profile: numbers as strings, exits and limiters as objects.
const lever = {
  title: "Test lever",
  beverage_type: "espresso",
  steps: [
    { name: "Fill", pump: "flow", flow: "6.0", pressure: "0", transition: "fast", seconds: "20", temperature: "89", exit: { type: "pressure", condition: "over", value: "2.5" } },
    { name: "Rise", pump: "pressure", pressure: "9.0", flow: "0", transition: "fast", seconds: "4", temperature: "88.5" },
    { name: "Decline", pump: "pressure", pressure: "5.0", flow: "0", transition: "smooth", seconds: "30", temperature: "88", limiter: { value: "2.8", range: "0.6" } },
    { name: "Unused", pump: "flow", flow: "2", seconds: "0", temperature: "88" },
    { name: "Weight", pump: "flow", flow: "2.2", seconds: "10", temperature: "88", weight: "30" },
  ],
};

describe("profileCurve", () => {
  it("draws each step for its time limit and describes it", () => {
    const c = profileCurve(lever)!;
    expect(c.timed).toBe("limits");
    expect(c.total).toBe(64);
    expect(c.steps.map((s) => [s.start, s.end])).toEqual([[0, 20], [20, 24], [24, 54], [54, 54], [54, 64]]);
    expect(c.steps[0].exit).toBe("Moves on when pressure rises above 2.5 bar");
    expect(c.steps[2].cap).toBe("Flow capped at 2.8 ml/s");
    expect(c.steps[4].exit).toBe("Moves on when 30 g is in the cup");
    // Flow, then pressure: each channel is drawn only for its own steps.
    expect(c.points[0]).toMatchObject({ t: 0, tp: null, tf: 6 });
    // A smooth step ramps from the previous target across the step.
    expect(c.points.filter((p) => p.frame === 2).map((p) => p.tp)).toEqual([9, 5]);
  });
  it("uses a shot's step timings when given", () => {
    const c = profileCurve(lever, [5, 4, 15, 0, 3])!;
    expect(c.timed).toBe("shot");
    expect(c.total).toBe(27);
    expect(planAt(c, 16.5)).toMatchObject({ frame: 2, tp: 7 });
  });
  it("returns null without steps", () => {
    expect(profileCurve({ title: "x" })).toBeNull();
    expect(profileCurve(null)).toBeNull();
  });
});

describe("stepDurations", () => {
  it("times each step from the recorded step numbers", () => {
    const pts = [0, 1, 2, 3, 4, 5, 6].map((t) => ({ t, frame: t < 2 ? 0 : t < 5 ? 2 : 4 }));
    expect(stepDurations(pts, 5)).toEqual([2, 0, 3, 0, 1]);
  });
  it("refuses shots without steps or with steps the profile lacks", () => {
    expect(stepDurations([{ t: 0 }, { t: 1 }], 3)).toBeNull();
    expect(stepDurations([{ t: 0, frame: 0 }, { t: 1, frame: 33 }], 3)).toBeNull();
  });
});

describe("the simulated puck", () => {
  it("follows a profile to the target weight and records its steps", () => {
    const profile = outlineProfile("Sim lever", "lever");
    const pts = simulateShot(profile, 36);
    const end = pts.at(-1)!;
    expect(end.w).toBeGreaterThanOrEqual(36);
    expect(end.t).toBeGreaterThan(18);
    expect(end.t).toBeLessThan(45);
    expect(Math.max(...pts.map((p) => p.p))).toBeGreaterThan(8);
    const d = stepDurations(pts, profile.steps!.length)!;
    expect(d[0]).toBeLessThan(Number(profile.steps![0].seconds)); // the fill ended on pressure
    expect(profileCurve(profile, d)!.total).toBeCloseTo(end.t, 0);
  });
});
