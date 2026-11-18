import { describe, expect, it } from "vitest";
import { analyzeShot } from "../server/profiles/analysis.js";
import type { PhaseLandmark } from "../server/profiles/phase-evidence.js";
import { reviewCurveSection, sampleReviewCurve } from "../server/recommend/review-curve.js";
import type { ReviewInput, ReviewPoint } from "../server/recommend/review-types.js";

const point = (t: number, overrides: Partial<ReviewPoint> = {}): ReviewPoint => ({
  t, p: 3, f: 4, w: 0, temp: 92, tp: null, tf: 4, targetTemp: 92,
  groupTemp: 91, targetGroupTemp: 92, frame: 0, substate: "pouring", weightFlow: null, ...overrides,
});
const input = (points: ReviewPoint[], overrides: Partial<ReviewInput> = {}): ReviewInput => ({
  points, profile: null, stopReason: null, doseG: null, yieldG: null, targetYieldG: null, targetTimeS: null,
  feedback: null, bean: null, installedProfiles: [], history: [], ...overrides,
});
function sample(shot: ReviewInput, limit?: number) {
  const landmarks: PhaseLandmark[] = [];
  const analysis = analyzeShot(shot, landmarks);
  return { ...sampleReviewCurve(shot.points, landmarks, limit), analysis, landmarks };
}

describe("event-anchored review curves", () => {
  it("retains the dry-to-flow bracket, bloom and configured limiter handoff, cap-like changes, crest and stop", () => {
    const points = Array.from({ length: 65 }, (_, i) => {
      const t = i / 4;
      const frame = t < 6 ? 0 : t < 8 ? 1 : 2;
      const capLike = t >= 10 && t < 12;
      return point(t, { frame, substate: frame === 0 ? "preinfusion" : "pouring",
        p: t === 11.25 ? 7 : capLike ? 6 : 3, f: frame === 1 ? 0 : capLike ? 2 : 4,
        tf: frame === 1 ? 0 : 4, w: Math.max(0, (t - 4) * 4) });
    });
    points.push(point(16.25, { frame: null, substate: "idle", p: 0, f: 0, w: 48 }));
    const shot = input(points, { stopReason: "targetWeight", profile: { steps: [
      { name: "Fill", pump: "flow", flow: 4, limiter: { value: 9 } },
      { name: "Bloom", pump: "flow", flow: 0 },
      { name: "Main", pump: "flow", flow: 4, limiter: { value: 6 } },
      { name: "Decline", pump: "pressure", pressure: 3, transition: "smooth" },
    ] } });
    const sampled = sample(shot);
    expect(sampled.points).toHaveLength(32);
    expect(sampled.points.map(p => p.t)).toEqual(expect.arrayContaining([
      0, 4, 4.25, 4.5, 4.75, 5.75, 6, 7.75, 8, 9.75, 10, 11.25, 11.75, 12, 16, 16.25,
    ]));
    expect(sampled.events).toContainEqual(expect.objectContaining({ kind: "first_sustained_beverage", t: 4.25,
      before: points[16], at: points[17], after: points[18], confirmed: points[19], confidence: "high" }));
    expect(sampled.events).toContainEqual(expect.objectContaining({ kind: "phase_boundary", t: 6,
      detail: { entering: "bloom_or_pause", fromLimiter: { value: 9, range: null, unit: "bar" }, toLimiter: null } }));
    expect(sampled.events).toContainEqual(expect.objectContaining({ kind: "phase_boundary", t: 8,
      detail: { entering: "hold_or_pour", fromLimiter: null, toLimiter: { value: 6, range: null, unit: "bar" } } }));
    expect(sampled.events).toContainEqual(expect.objectContaining({ kind: "cap_like_start", confidence: "medium",
      t: 9.95, before: points[39], after: points[40] }));
    expect(sampled.events).toContainEqual(expect.objectContaining({ kind: "cap_like_end", confidence: "medium",
      t: 11.8, before: points[47], after: points[48] }));
    expect(sampled.events).toContainEqual(expect.objectContaining({ kind: "brew_pressure_crest", t: 11.25, at: points[45] }));
    expect(sampled.events).toContainEqual(expect.objectContaining({ kind: "stop", t: 16,
      detail: "targetWeight", before: points[64], after: points[65] }));
    expect(sampled.events.some(event => event.kind === "planned_decline")).toBe(false);
    expect(sampled.analysis.facts.phaseEvidence.finish.unobservedPlanPhases.value).toEqual([
      { frame: 3, name: "Decline", status: "preempted_by_weight_stop" },
    ]);
  });

  it("uses observed endpoints of a planned rise and decline", () => {
    const points = Array.from({ length: 49 }, (_, i) => {
      const t = i / 4;
      const target = t < 6 ? 2 + t : 8 - (t - 6) / 2;
      return point(t, { p: target, tp: target, tf: null, frame: t < 6 ? 0 : 1 });
    });
    const shot = input(points, { profile: { steps: [
      { name: "Rise", pump: "pressure" }, { name: "Decline", pump: "pressure" },
    ] } });
    const result = sample(shot, 8);
    expect(result.events).toContainEqual(expect.objectContaining({ kind: "planned_rise", t: 0,
      before: points[0], after: points[23] }));
    expect(result.events).toContainEqual(expect.objectContaining({ kind: "planned_decline", t: 6,
      before: points[24], after: points[48] }));
    expect(result.points).toEqual(expect.arrayContaining([points[0], points[23], points[24], points[48]]));
  });

  it("anchors the crest and late comparison when pressure eases at held flow", () => {
    const points = Array.from({ length: 81 }, (_, i) => {
      const t = i / 4;
      return point(t, { p: t <= 6 ? 3 + t / 3 : Math.max(3, 5 - (t - 6) / 4) });
    });
    const shot = input(points, { profile: { steps: [{ name: "Pour", pump: "flow" }] } });
    const result = sample(shot);
    expect(result.events).toContainEqual(expect.objectContaining({ kind: "pressure_droop_at_held_flow", confidence: "medium",
      t: 15, before: points[24], at: points[60], after: points[80] }));
    expect(result.points).toEqual(expect.arrayContaining([points[24], points[60], points[80]]));
    expect(result.analysis.facts.phaseEvidence.phases[0].pressureDroopAtHeldFlowBar.value).toBe(2);
  });

  it("preserves null spans and time gaps without interpolating and withholds onset across a tare jump", () => {
    const points = [
      point(0), point(0.25, { w: 12 }), point(0.5, { w: 13, groupTemp: null }),
      point(0.75, { w: 14, groupTemp: null }), point(4, { w: 15 }), point(4.25, { w: 16 }),
    ];
    const result = sample(input(points), 2);
    expect(result.points).toEqual([points[0], points[5]]);
    expect(result.gaps).toEqual([[0.25, 4, ["groupTemp"]], [0.75, 4, ["all"]]]);
    expect(result.events).toContainEqual(expect.objectContaining({ kind: "weight_jump", t: 0.25,
      before: points[0], after: points[1] }));
    expect(result.events).toContainEqual(expect.objectContaining({ kind: "scale_gap", t: 4 }));
    expect(result.events.some(event => event.kind === "first_sustained_beverage")).toBe(false);
    expect(sample(input(points), 100).points[2].groupTemp).toBeNull();
    const compact = JSON.parse(reviewCurveSection(points, result.landmarks, 100).split("\n")[1]);
    expect(compact.rows[2][compact.columns.indexOf("groupTemp")]).toBeNull();
  });

  it("preserves elapsed coverage on a flat interval and gives normalized curve error priority", () => {
    const dense = Array.from({ length: 101 }, (_, i) => point(i / 100));
    const sparse = Array.from({ length: 40 }, (_, i) => point(i + 2));
    const flat = [...dense, ...sparse];
    const selected = sampleReviewCurve(flat, [], 9).points;
    expect(Math.max(...selected.slice(1).map((p, i) => p.t - selected[i].t))).toBeLessThanOrEqual(6);

    const shape = [point(0), point(0.5, { p: 9 }), point(1, { temp: 101 }), point(1.5)];
    // Six bars cover a greater share of the pressure axis than nine degrees
    // cover of the thermal axis. Both points have the same time coverage.
    expect(sampleReviewCurve(shape, [], 3).points).toEqual([shape[0], shape[1], shape[3]]);
  });

  it("is deterministic and carries every event when the anchor count exceeds the row budget", () => {
    const shot = input(Array.from({ length: 101 }, (_, i) => point(i / 4, { frame: i % 2 })));
    const none = sample(shot, 0);
    const one = sample(shot, 1);
    const all = sample(shot, Infinity);
    expect(none.points).toEqual([]);
    expect(one.points).toEqual([shot.points[0]]);
    expect(all.points).toEqual(shot.points);
    expect(none.events.filter(event => event.kind === "phase_boundary")).toHaveLength(100);
    expect(none.events.find(event => event.kind === "recording_end")?.before).toBe(shot.points.at(-1));
    expect(one.events).toEqual(none.events);
    expect(all.events).toEqual(none.events);
    const first = sample(shot);
    expect(sample(shot).points).toEqual(first.points);
    expect(first.points.every(p => shot.points.includes(p))).toBe(true);
    expect(sample(input([]), 0)).toMatchObject({ points: [], events: [], gaps: [] });
  });

  it("rounds readings without merging distinct recorded times", () => {
    const points = [point(0.0001, { p: 3.0123 }), point(0.0002, { p: 3.1234 })];
    const { landmarks } = sample(input(points));
    const curve = JSON.parse(reviewCurveSection(points, landmarks).split("\n")[1]);
    expect(curve.rows.map((row: number[]) => row.slice(0, 2))).toEqual([[0.0001, 3.01], [0.0002, 3.12]]);
    expect(curve.events).toContainEqual(expect.objectContaining({ kind: "recording_end", t: 0.0002 }));
  });
});
