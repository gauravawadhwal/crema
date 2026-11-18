import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateGymDataset, gymJson, GymReplay, readGymScenarios } from "../evals/lib/gym/dataset.js";
import { CUP_G_PER_ML, simulateGymShot, TICK_MS } from "../evals/lib/gym/kernel.js";
import { GYM_GENERATOR_VERSION } from "../evals/lib/gym/random.js";
import { recordGymShot } from "../evals/lib/gym/recording.js";
import { GymScenario } from "../evals/lib/gym/scenario.js";
import { runReviewAblation } from "../evals/lib/review-ablation.js";
import { loadReviewDataset } from "../evals/lib/review-holdout.js";
import { scoreReview } from "../evals/lib/review-metrics.js";
import type { PhaseLandmark } from "../server/profiles/phase-evidence.js";
import { REVIEW_CURVE_ROWS, sampleReviewCurve } from "../server/recommend/review-curve.js";
import { buildReviewEvidence, fullReviewTrace, projectReviewEvidence } from "../server/recommend/review-evidence.js";

const directory = fileURLToPath(new URL("../evals/fixtures/review-gym", import.meta.url));
const scenarios = readGymScenarios(directory);
const replay = { generatorVersion: GYM_GENERATOR_VERSION, seeds: 8, scenarios } as const;
const dataset = generateGymDataset(replay);
const cases = loadReviewDataset(dataset).cases;
const [capped, tracked, lever] = scenarios;
const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
const time = (tick: number) => tick * TICK_MS / 1000;

describe("synthetic review gym", () => {
  it("generates the same bytes after serializing the replay and reordering manifests", () => {
    const serialized = GymReplay.parse(JSON.parse(gymJson({ ...replay, scenarios: [...scenarios].reverse() })));
    expect(gymJson(generateGymDataset(serialized))).toBe(gymJson(dataset));
    expect(cases).toHaveLength(24);
    expect(recordGymShot(tracked, 0).points).not.toEqual(recordGymShot(tracked, 1).points);
    expect(() => GymReplay.parse({ ...replay, generatorVersion: 0 })).toThrow();
  });

  it("keeps intervention, seed and grouping metadata outside the reviewer input", () => {
    expect(cases.filter((c) => c.session === "high-flow-pair")).toHaveLength(16);
    for (const c of cases) {
      const input = gymJson(c.input);
      expect(c.split).toBe("dev");
      expect(input).not.toContain(c.id);
      expect(input).not.toContain(c.session);
      expect(input).not.toContain(c.recipe);
      expect(input).not.toMatch(/"seed"|"labels"|"interventions"|"puck"|"grading"/);
      expect(c.input.feedback).toBeNull();
    }
    expect(cases.filter((c) => c.profileFamily === "lever").map((c) =>
      c.labels.source === "synthetic-injected" ? c.labels.injection : c.labels.source)).toEqual(Array(8).fill("none"));
    for (const changed of [
      { ...tracked, split: "holdout" as const, recipe: "different-recipe" },
      { ...tracked, split: "holdout" as const, session: "different-session" },
    ]) {
      expect(() => generateGymDataset({ ...replay, seeds: 1, scenarios: [capped, changed] })).toThrow(/Split crosses/);
    }
  });

  it("rejects unknown inputs, invalid fault windows and labels that miss the recorded clock", () => {
    expect(() => GymScenario.parse({ ...tracked, notes: "unrecognized" })).toThrow(/notes/);
    expect(() => GymScenario.parse({ ...tracked, interventions: [{ kind: "scale-loss", atS: 6, untilS: 5 }] }))
      .toThrow(/positive duration/);
    const badLabel = { ...tracked, grading: { ...tracked.grading, observations: [
      { id: "outside-trace", kind: "stop", expected: "required" as const,
        timing: { type: "raw-landmark" as const, onsetS: [500, 501] as [number, number] } },
    ] } };
    expect(() => generateGymDataset({ ...replay, seeds: 1, scenarios: [badLabel] })).toThrow(/no recorded sample/);
  });

  it("conserves liquid, honors both cross-channel caps and has finite pump response", () => {
    expect(CUP_G_PER_ML).toBe(0.98);
    for (const scenario of scenarios) {
      for (let seed = 0; seed < 8; seed++) {
        const { ticks, steps } = simulateGymShot(scenario, seed);
        expect(ticks[0].flow).toBe(0);
        expect(ticks[1].flow).toBeGreaterThan(0);
        expect(ticks[1].flow).toBeLessThan(1);
        expect(ticks.slice(0, 300).every((s) => s.cupG === 0)).toBe(true);
        const massError = Math.max(...ticks.map((s) => Math.abs(s.inletMl - s.storedMl - s.cupG / 0.98)));
        expect(massError).toBeLessThan(1e-9);
        expect(ticks.every((s, i) => s.cupG >= (ticks[i - 1]?.cupG ?? 0) && s.storedMl >= 0)).toBe(true);
        expect(ticks.every((s) => {
          const step = steps[s.frame];
          const capped = step.pump === "flow" ? s.pressure : s.flow;
          return capped <= (step.limiter?.value ?? Infinity) + 1e-9;
        })).toBe(true);
      }
    }
    const nearCap = GymScenario.parse({ ...capped, puck: { resistance: 2 }, interventions: [] });
    const soft = simulateGymShot(nearCap, 0).ticks;
    const hard = simulateGymShot(GymScenario.parse({ ...nearCap,
      profile: { steps: nearCap.profile.steps!.map((step) => ({ ...step, limiter: { ...step.limiter, range: 0 } })) },
    }), 0).ticks;
    expect(soft[600].pressure).toBeLessThan(8.6);
    expect(soft[600].flow).toBeLessThan(hard[600].flow - 0.02);
    expect(soft[1500].flow).toBeCloseTo(hard[1500].flow, 2);
  });

  it("advances on pressure and step weight exits and leaves later frames unexecuted at a weight stop", () => {
    const scenario = GymScenario.parse({
      ...lever, family: "adaptive", stop: { timeS: 60, weightG: 8 },
      profile: { steps: [
        { name: "Fill", pump: "flow", target: 6, seconds: 20, exit: { type: "pressure", condition: "over", value: 2.5 } },
        { name: "Hold", pump: "pressure", target: 6, seconds: 20, weightG: 2 },
        { name: "Follow", pump: "flow", target: 2.5, seconds: 20, transition: "smooth" },
        { name: "Finish", pump: "pressure", target: 4, seconds: 10 },
      ] },
    });
    const { ticks, stopReason } = simulateGymShot(scenario, 0);
    const hold = ticks.findIndex((s) => s.frame === 1);
    const follow = ticks.findIndex((s) => s.frame === 2);
    expect(time(hold)).toBeLessThan(5);
    expect(ticks[hold - 2].pressure).toBeLessThanOrEqual(2.5);
    expect(ticks[hold - 1].pressure).toBeGreaterThan(2.5);
    expect(ticks[follow - 2].cupG).toBeLessThan(2);
    expect(ticks[follow - 1].cupG).toBeGreaterThanOrEqual(2);
    expect(ticks[follow].command).toBe(ticks[follow - 1].flow);
    expect(stopReason).toBe("targetWeight");
    expect(ticks.at(-2)!.cupG).toBeLessThan(8);
    expect(ticks.at(-1)!.cupG).toBeGreaterThanOrEqual(8);
    expect([...new Set(ticks.map((s) => s.frame))]).toEqual([0, 1, 2]);
    const clock = simulateGymShot({ ...scenario, stop: { timeS: 9.31 } }, 0);
    expect(clock.stopReason).toBe("apiStop");
    expect(time(clock.ticks.length - 1)).toBe(9.31);
  });

  it("keeps mild cup delivery through a commanded bloom and supports all seven outlines", () => {
    for (const family of ["flat-pressure", "lever", "fixed-flow", "allonge", "bloom", "turbo", "adaptive"] as const) {
      const scenario = GymScenario.parse({ ...lever, family, profile: {}, stop: { timeS: 90 } });
      expect(recordGymShot(scenario, 0).points.length).toBeGreaterThan(10);
    }
    const bloom = GymScenario.parse({ ...lever, family: "bloom", profile: { steps: [
      { name: "Fill", pump: "flow", target: 5, seconds: 6 },
      { name: "Bloom", pump: "flow", target: 0, seconds: 3 },
      { name: "Restart", pump: "flow", target: 2.2, seconds: 12 },
    ] } });
    const { ticks } = simulateGymShot(bloom, 0);
    const pause = ticks.filter((s) => s.frame === 1);
    expect(pause).toHaveLength(300);
    expect(pause.every((s) => s.command === 0)).toBe(true);
    expect(pause.at(-1)!.cupG).toBeGreaterThan(pause[0].cupG);
    expect(pause.at(-1)!.flow).toBeLessThan(0.01);
    expect(ticks.at(-1)!.flow).toBeCloseTo(2.2, 1);
  });

  it("keeps scale and machine clocks distinct and applies tare, loss and lag to observations only", () => {
    const treated = GymScenario.parse({ ...lever, interventions: [
      { kind: "tare-jump", atS: 10, deltaG: 12 },
      { kind: "scale-loss", atS: 12, untilS: 14 },
      { kind: "sensor-lag", channel: "pressure", delayS: 1 },
    ] });
    const record = recordGymShot(treated, 0);
    const control = recordGymShot(lever, 0);
    expect(simulateGymShot(treated, 0)).toEqual(simulateGymShot(lever, 0));
    expect(record.stopReason).toBe(control.stopReason);
    const ages = [];
    let differingPressure = 0;
    for (const [i, p] of control.points.entries()) {
      const observed = record.points[i];
      expect(observed.t).toBe(p.t);
      expect(observed.f).toBe(p.f);
      expect(observed.tp).toBe(p.tp);
      if (p.p != null && observed.p != null && Math.abs(p.p - observed.p) > 0.25) differingPressure++;
      if (p.scaleSampleS == null) continue;
      expect(p.scaleSampleS).toBeLessThanOrEqual(p.t);
      expect(p.scaleAgeS).toBeCloseTo(p.t - p.scaleSampleS, 8);
      ages.push(p.scaleAgeS!);
      if (p.scaleSampleS >= 12 && p.scaleSampleS < 14) {
        expect(observed.w).toBeNull();
        expect(observed.scaleSampleS).toBeNull();
      } else {
        expect(observed.scaleSampleS).toBe(p.scaleSampleS);
        expect(observed.w! - p.w!).toBeCloseTo(p.scaleSampleS >= 10 ? 12 : 0, 8);
      }
    }
    expect(differingPressure).toBeGreaterThan(4);
    expect(mean(ages)).toBeGreaterThan(0.025);
    expect(Math.max(...ages)).toBeLessThan(0.13);
    expect(new Set(control.points.slice(1).map((p, i) => Math.round((p.t - control.points[i].t) * 1000))).size)
      .toBeGreaterThan(8);
  });

  it("recovers the selected thermal sensor toward its logged target after a perturbation", () => {
    for (const sensor of ["coffee", "water"] as const) {
      const scenario = GymScenario.parse({ ...tracked, profile: { steps: [
        { name: "Pour", pump: "flow", target: 4.5, seconds: 17, sensor, temperatureC: 90 },
      ] }, interventions: [{ kind: "thermal-recovery", atS: 4, dropC: 4, recoveryS: 1.5 }] });
      const { ticks } = simulateGymShot(scenario, 0);
      const actual = sensor === "coffee" ? "groupC" : "mixC";
      const target = sensor === "coffee" ? "targetGroupC" : "targetMixC";
      expect(ticks[401][target]).toBe(90);
      expect(ticks[401][actual]).toBeLessThan(86.1);
      expect(ticks[500][actual]).toBeGreaterThan(ticks[401][actual]);
      expect(ticks[1500][actual]).toBeCloseTo(90, 1);
    }
  });

  it("distinguishes a planned decline from a pressure drop under an unchanged command", () => {
    const flat = GymScenario.parse({ ...lever, profile: { steps: [
      ...lever.profile.steps!.slice(0, 2), { ...lever.profile.steps![2], name: "Pour", transition: "fast", target: 8 },
    ] }, interventions: [{ kind: "flow-cap", atS: 21, maxMlS: 1.3 }] });
    const { ticks } = simulateGymShot(flat, 0);
    expect(ticks[2000].pressure).toBeGreaterThan(7.8);
    expect(ticks[2200].pressure).toBeLessThan(6);
    expect(ticks[2200].command).toBe(8);
    const landmarks: PhaseLandmark[] = [];
    fullReviewTrace(recordGymShot(flat, 0), landmarks);
    expect(landmarks.some((l) => l.kind === "planned_decline")).toBe(false);
  });

  it("matches the independently ranged Allongé regimes and lever decline through analysis and anchoring", async () => {
    // Bounds are rounded out from the science report's onset/peak observations
    // and the guide's family durations, with the synthetic density kept fixed.
    const spans: Record<string, number[]> = { capped: [], tracked: [], decline: [] };
    for (const c of cases) {
      const isLever = c.profileFamily === "lever";
      const isCapped = c.id.startsWith("allonge-capped");
      const focus = isLever ? "decline" : isCapped ? "capped" : "tracked";
      const landmarks: PhaseLandmark[] = [];
      const full = fullReviewTrace(c.input, landmarks);
      const evidence = projectReviewEvidence(buildReviewEvidence(c.input, full));
      const sampled = sampleReviewCurve(c.input.points, landmarks);
      const anchorKind = isLever ? "planned_decline" : isCapped ? "cap_like_start" : "first_sustained_beverage";
      const anchor = landmarks.find((l) => l.kind === anchorKind);
      expect(anchor).toBeDefined();
      expect(evidence.analysis.facts.phaseEvidence.phases.length).toBeGreaterThanOrEqual(2);
      expect(sampled.points.length).toBeLessThanOrEqual(REVIEW_CURVE_ROWS);
      expect(sampled.points.at(-1)?.t).toBe(c.input.points.at(-1)!.t);
      expect(sampled.points.some((p) => p === anchor!.before || p === anchor!.at || p === anchor!.after)).toBe(true);
      const score = scoreReview(c.labels, {
        events: [{ kind: anchorKind, onsetS: anchor!.t }], outcomes: [], figures: [], claims: {},
      }, c.input.points.map((p) => p.t));
      expect(score.events.every((event) => event.matched)).toBe(true);
      const lastTime = c.input.points.at(-1)!.t;
      spans[focus].push(lastTime);
      const late = c.input.points.filter((p) => p.t > lastTime - 5);
      const peakBar = Math.max(...c.input.points.flatMap((p) => p.p ?? []));
      const lateFlow = mean(late.flatMap((p) => p.f ?? []));
      if (isLever) {
        expect(peakBar).toBeGreaterThan(7.8);
        expect(peakBar).toBeLessThan(9.5);
        expect(mean(late.flatMap((p) => p.p ?? []))).toBeLessThan(6.2);
      } else {
        const onset = landmarks.find((l) => l.kind === "first_sustained_beverage")!.t;
        expect(onset).toBeGreaterThan(4.5);
        expect(onset).toBeLessThan(8.7);
        expect(c.input.stopReason).toBe("targetWeight");
        expect(c.input.yieldG!).toBeGreaterThan(102);
        expect(peakBar).toBeGreaterThan(isCapped ? 8 : 2.4);
        expect(peakBar).toBeLessThan(isCapped ? 9.5 : 3.5);
        expect(lateFlow).toBeGreaterThan(isCapped ? 2.8 : 4.4);
        expect(lateFlow).toBeLessThan(isCapped ? 3.8 : 4.6);
      }
    }
    expect(mean(spans.tracked)).toBeGreaterThan(28);
    expect(mean(spans.tracked)).toBeLessThan(35);
    expect(mean(spans.capped)).toBeGreaterThan(38);
    expect(mean(spans.capped)).toBeLessThan(47);
    expect(mean(spans.decline)).toBeGreaterThan(25);
    expect(mean(spans.decline)).toBeLessThan(36);

    const [result] = await runReviewAblation(cases, ["facts-plus-anchored"]);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.records).toHaveLength(24);
    expect(result.records.every((r) => r.source === "rules" && r.tokens?.input === 0 && r.tokens?.output === 0)).toBe(true);
  });
});
