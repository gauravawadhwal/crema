import { describe, expect, it } from "vitest";
import type { ProfileLike } from "../server/profiles/curve.js";
import { analyzeShot } from "../server/profiles/analysis.js";
import { rulesReview } from "../server/recommend/review-local.js";
import type { ReviewInput, ReviewPoint } from "../server/recommend/review-types.js";

const pressureProfile: ProfileLike = {
  title: "Flat pressure", beverage_type: "espresso",
  steps: [{ name: "Extraction", pump: "pressure", pressure: "9", seconds: "30", temperature: "92", limiter: null }],
};
const flowProfile: ProfileLike = {
  title: "Flow", beverage_type: "espresso",
  steps: [{ name: "Extraction", pump: "flow", flow: "2", seconds: "30", temperature: "92", limiter: null }],
};

function points(count: number, values: Partial<ReviewPoint> = {}): ReviewPoint[] {
  return Array.from({ length: count }, (_, t) => ({
    t, p: 9, f: 2, w: t * 1.5, temp: 92, tp: 9, tf: null, targetTemp: 92,
    frame: 0, substate: null, weightFlow: 1.5, ...values,
  }));
}

function input(overrides: Partial<ReviewInput> = {}): ReviewInput {
  return {
    points: points(21), profile: pressureProfile,
    doseG: 18, yieldG: 36, targetYieldG: 36, targetTimeS: [25, 35],
    stopReason: null, feedback: null, bean: null, installedProfiles: [], history: [],
    ...overrides,
  };
}

describe("conservative shot analysis", () => {
  it("keeps clean flat pressure and flow shots clear", () => {
    expect(analyzeShot(input()).issues).toEqual([]);
    expect(analyzeShot(input({ profile: flowProfile, points: points(21, { p: 6, f: 2, tp: null, tf: 2 }) })).issues).toEqual([]);
  });

  it("does not grade intentional lever, bloom, turbo, or manual phases", () => {
    const cases: [ProfileLike, ReviewPoint[]][] = [
      [{ title: "Lever", beverage_type: "espresso", steps: [
        { pump: "flow", name: "Fill", flow: "6", seconds: "10" },
        { pump: "pressure", name: "Soak", pressure: "3", seconds: "10" },
        { pump: "pressure", name: "Decline", pressure: "5", seconds: "30", limiter: { value: "2.8" } },
      ] }, points(21, { frame: 0, p: 1, f: 6, tp: null, tf: 6 })],
      [{ title: "Bloom", beverage_type: "espresso", steps: [{ pump: "flow", name: "Bloom", flow: "0", seconds: "20" }] }, points(21, { p: 0, f: 0, tp: null, tf: 0 })],
      [{ title: "Turbo", beverage_type: "espresso", steps: [{ pump: "flow", flow: "4.5", seconds: "20" }] }, points(21, { p: 1, f: 1, tp: null, tf: 4.5 })],
      [{ title: "Manual", beverage_type: "manual", steps: [{ pump: "pressure", pressure: "9", seconds: "30" }] }, points(21, { p: 9, f: 0.2, tp: 9 })],
      [{ title: "Preinfusion", beverage_type: "espresso", steps: [{ pump: "pressure", name: "Preinfusion", pressure: "9", seconds: "30" }] }, points(21, { p: 9, f: 0.2, tp: 9 })],
      [{ title: "Unknown pump", beverage_type: "espresso", steps: [{ pump: "", pressure: "9", seconds: "30" }] }, points(21, { p: 9, f: 0.2, tp: 9 })],
    ];
    for (const [profile, shotPoints] of cases) expect(analyzeShot(input({ profile, points: shotPoints })).issues).toEqual([]);
  });

  it("flags a sustained, settled low-flow pressure hold as a possible choke", () => {
    const result = rulesReview(input({ points: points(26, { p: 9, f: 0.25, tp: 9 }) }));
    expect(result.issues.map((x) => x.kind)).toContain("choked");
    expect(result.nextShot?.grindDelta).toBe("coarser");
    expect(result.wentWell).toEqual([]);
  });

  it("requires paired flow coverage for a pressure-hold choke observation", () => {
    const shot = points(26, { p: 9, f: null, tp: 9 });
    shot[10] = { ...shot[10], f: 0.2 };
    expect(analyzeShot(input({ points: shot })).issues).toEqual([]);
  });

  it("requires a sustained multi-bin rise before calling a pressure hold channeling", () => {
    const rising = points(25, { p: 9, tp: 9 });
    rising.forEach((p, i) => { p.f = 1 + i * 0.075; });
    expect(analyzeShot(input({ points: rising })).issues.map((x) => x.kind)).toContain("channeling");

    const lateSpike = points(25, { p: 9, f: 1.2, tp: 9 });
    lateSpike[24] = { ...lateSpike[24], f: 2.8 };
    expect(analyzeShot(input({ points: lateSpike })).issues.map((x) => x.kind)).not.toContain("channeling");

    const oscillating = points(25, { p: 9, tp: 9 });
    oscillating.forEach((p, i) => { p.f = i % 2 ? 2.4 : 1.0; });
    expect(analyzeShot(input({ points: oscillating })).issues.map((x) => x.kind)).not.toContain("channeling");
  });

  it("uses paired target temperatures across a changing profile and leaves missing values unknown", () => {
    const profile: ProfileLike = { title: "Declining", steps: [
      { pump: "pressure", pressure: "9", temperature: "92", seconds: "10" },
      { pump: "pressure", pressure: "6", temperature: "88", seconds: "20" },
    ] };
    const samples = [
      ...points(10, { temp: 92, targetTemp: 92, frame: 0 }),
      ...points(10, { temp: 88, targetTemp: 88, frame: 1 }).map((p, i) => ({ ...p, t: i + 10 })),
    ];
    expect(analyzeShot(input({ profile, points: samples })).issues.map((x) => x.kind)).not.toContain("off_target_temp");
    expect(analyzeShot(input({ points: points(21, { temp: null, targetTemp: null }) })).metrics.usableTemperaturePoints).toBe(0);
  });

  it("ignores a brief frame blip and does not infer a failure from an early manual stop", () => {
    const samples = points(12, { p: 9, f: 0.2, tp: 9 });
    samples[5] = { ...samples[5], frame: 7 };
    const result = analyzeShot(input({ points: samples.slice(0, 8), stopReason: "manual" }));
    expect(result.issues).toEqual([]);
    expect(rulesReview(input({ points: samples.slice(0, 5), stopReason: "manual" })).nextShot).toBeNull();
  });

  it("keeps telemetry and taste disagreement from creating a blind grind change", () => {
    const result = rulesReview(input({
      points: points(26, { p: 9, f: 0.25, tp: 9 }),
      feedback: { sourBitter: -2, body: 0, enjoyment: null, notes: null },
    }));
    expect(result.issues.map((x) => x.kind)).toContain("choked");
    expect(result.nextShot).toBeNull();
    expect(result.confidence).toBe("low");
  });

  it("returns no forced change when telemetry is missing, and respects explicit balance", () => {
    const empty = points(8, { p: null, f: null, w: null, temp: null, tp: null, tf: null, targetTemp: null, frame: null });
    expect(rulesReview(input({ points: empty }))).toMatchObject({ issues: [], nextShot: null, askTaste: true });
    expect(rulesReview(input({ feedback: { sourBitter: 0, body: 0, enjoyment: 8, notes: null } })).nextShot?.grindDelta).toBe("same");
    expect(rulesReview(input({
      profile: { title: "Manual", beverage_type: "manual", steps: [] },
      feedback: { sourBitter: -2, body: 0, enjoyment: null, notes: null },
    })).nextShot).toBeNull();
  });
});
