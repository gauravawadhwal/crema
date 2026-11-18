import { describe, expect, it } from "vitest";
import { reviewFixture, type ReviewFixture } from "../evals/lib/review-fixtures.js";
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
    doseG: 18, yieldG: 36, targetYieldG: 36, targetTimeS: [18, 28],
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

// Shapes taken from real Decaid shots: a preinfusion phase, then a main pour on
// a pressure step that carries a flow limiter, as in Extractamundo Dos! and
// Gentle and sweet. The reviews of those shots graded nothing in v0.4.0.
describe("real Decaid shot shapes", () => {
  const limited = (limiter: string): ProfileLike => ({
    title: "Two step", beverage_type: "espresso", steps: [
      { name: "preinfusion", pump: "flow", flow: "8", seconds: "20", temperature: "88", sensor: "coffee" },
      { name: "rise and hold", pump: "pressure", pressure: "6", seconds: "40", temperature: "88", sensor: "coffee", limiter: { value: limiter, range: "1" } },
    ],
  });
  // 4 samples a second: 2 s preparing, 6 s preinfusion, 22 s pouring.
  const shot = (pour: Partial<ReviewPoint> = {}, overrides: (p: ReviewPoint) => Partial<ReviewPoint> = () => ({})): ReviewPoint[] =>
    Array.from({ length: 120 }, (_, i) => {
      const t = i / 4;
      const phase = t < 2 ? "preparingForShot" : t < 8 ? "preinfusion" : "pouring";
      const base: ReviewPoint = phase === "pouring"
        ? { t, p: 6, f: 1.6, w: (t - 8) * 1.7, temp: 92, tp: 6, tf: 0, targetTemp: 93, groupTemp: 87.5, targetGroupTemp: 88, frame: 1, substate: phase, weightFlow: 1.7, ...pour }
        : { t, p: 2, f: 7, w: 0, temp: 85, tp: 0, tf: 8, targetTemp: 94, groupTemp: 68, targetGroupTemp: 88, frame: 0, substate: phase, weightFlow: 0 };
      return { ...base, ...overrides(base) };
    });
  const real = (points: ReviewPoint[], profile: ProfileLike = limited("4")) => input({ points, profile, doseG: 18, yieldG: 34.6, targetYieldG: 36, targetTimeS: [25, 35], stopReason: "targetWeight" });

  it("grades a main pour whose flow limiter never engaged", () => {
    const result = analyzeShot(real(shot()));
    expect(result.metrics.observedWindows).toBe(1);
    expect(result.issues).toEqual([]);
    expect(result.wentWell).toEqual([
      "Finished in 28 s, inside the 25–35 s window.",
      "Held pressure at 6.0 bar against the 6.0 bar target.",
    ]);
  });

  it("grades an engaged limiter without calling the shortfall a fault", () => {
    // Pressure settles under 6 bar while flow sits above a 1 ml/s limit.
    const result = analyzeShot(real(shot({ p: 5.4, f: 1.9 }), limited("1")));
    expect(result.metrics.observedWindows).toBe(1);
    expect(result.issues).toEqual([]);
  });

  it("still finds a choke on a limited step", () => {
    const result = analyzeShot(real(shot({ p: 6, f: 0.3 })));
    expect(result.issues.map((x) => x.kind)).toContain("choked");
  });

  it("never grades Decaid's preinfusion phase, whatever the step is called", () => {
    const profile: ProfileLike = { title: "Plain", steps: [{ name: "Fill", pump: "pressure", pressure: "8", seconds: "20" }] };
    const points = Array.from({ length: 60 }, (_, i) => ({ t: i / 4, p: 1.5, f: 7, w: 0, temp: 92, tp: 8, tf: 0, targetTemp: 92, frame: 0, substate: "preinfusion", weightFlow: 0 }));
    const result = analyzeShot(input({ profile, points }));
    expect(result.metrics.observedWindows).toBe(0);
    expect(result.issues).toEqual([]);
  });

  it("compares a coffee-sensor step on group temperature, not the mix water", () => {
    // The mix runs 1 °C under its own target; the group is 0.5 °C under 88.
    expect(analyzeShot(real(shot())).issues.map((x) => x.kind)).not.toContain("off_target_temp");
    expect(analyzeShot(real(shot({ temp: 80, targetTemp: 93 }))).issues.map((x) => x.kind)).not.toContain("off_target_temp");
    const hot = analyzeShot(real(shot({ groupTemp: 91 })));
    expect(hot.issues.map((x) => x.kind)).toContain("off_target_temp");
    expect(hot.metrics.meanTemperatureOffsetC).toBeCloseTo(3, 1);
  });

  it("leaves out preinfusion and a profile that steps down to cooler water", () => {
    // Preinfusion reads 20 °C cold on the group; it must not drag the mean.
    expect(analyzeShot(real(shot())).metrics.meanTemperatureOffsetC).toBeCloseTo(-0.5, 1);
    // A step down from 88 to 73: the machine can't cool, so running hot is expected.
    const stepped = analyzeShot(real(shot({ groupTemp: 79, targetGroupTemp: 73 })));
    expect(stepped.issues.map((x) => x.kind)).not.toContain("off_target_temp");
    expect(stepped.metrics.usableTemperaturePoints).toBe(0);
  });

  it("measures the shot's facts and ignores a cup bump", () => {
    const facts = analyzeShot(real(shot({}, (p) => p.t === 12 ? { w: -124 } : {}))).facts;
    expect(facts).toMatchObject({ brewStartS: 2, durationS: 27.8, preinfusionS: 5.8, pourS: 21.8, doseG: 18, yieldG: 34.6, ratio: 1.9, stopReason: "targetWeight", weightGlitches: 1 });
    expect(facts.firstDripsS).toBe(8.8);
    expect(facts.pourMeanPressureBar).toBe(6);
  });

  it("says what the shot did in the rules summary, and admits when there is too little", () => {
    const clean = rulesReview(real(shot())).summary;
    expect(clean).toContain("right in the 25–35 s target window");
    expect(clean).toContain("6.0 bar");
    expect(clean).toMatch(/repeat.*taste/);
    const withoutWindow = rulesReview({ ...real(shot()), targetTimeS: null }).summary;
    expect(withoutWindow).toMatch(/^Pressure held 6\.0 bar against the 6\.0 bar target/);
    expect(withoutWindow).not.toContain("34.6 g from 18 g");
    const thin = rulesReview(input({ points: shot().slice(0, 7), profile: limited("4"), yieldG: null }));
    expect(thin.summary).toMatch(/too short or sparse.*Repeat with recording/);
  });

  it("flags a pressure shortfall when a flow limiter caps pressure well below target", () => {
    const review = rulesReview(real(shot({ p: 3.8, f: 2.2 }), limited("2.2")));
    expect(review.issues.map((x) => x.kind)).toContain("pressure_shortfall");
    expect(review.issues[0].evidence).toContain("2.2 ml/s flow limit");
    expect(review.nextShot).toMatchObject({ change: "Grind finer", grindDelta: "finer" });
    expect(review.nextShot?.reasoning).toMatch(/pressure fell short/i);
    expect(review.summary).toContain("Pour pressure only reached 3.8 bar of the 6.0 bar target at 2.2 ml/s");
    expect(review.summary).toContain("finer grind step");
    const step = analyzeShot(real(shot({ p: 3.8, f: 2.2 }), limited("2.2"))).facts.pourSteps[0];
    expect(step).toMatchObject({ frame: 1, pump: "pressure", target: 6, actualMean: 3.8, limiterValue: 2.2, limiterEngaged: true });
  });

  it("flags a flow shortfall when puck resistance holds a flow step below target", () => {
    const flowLimited: ProfileLike = {
      title: "Flow with cap", beverage_type: "espresso",
      steps: [{ name: "Pour", pump: "flow", flow: "2.2", seconds: "40", temperature: "92", limiter: { value: "8" } }],
    };
    const pts = points(26, { p: 7.4, f: 1.1, tp: null, tf: 2.2 });
    const review = rulesReview(input({ profile: flowLimited, points: pts }));
    expect(review.issues.map((x) => x.kind)).toContain("flow_shortfall");
    expect(review.issues[0].evidence).toContain("8 bar pressure limit");
    expect(review.nextShot).toMatchObject({ change: "Grind coarser", grindDelta: "coarser" });
    expect(review.summary).toContain("Pour flow only reached 1.1 ml/s of the 2.2 ml/s target");
  });

  it("flags shots outside the expected time window and falls back to the catalogue window", () => {
    const fast = rulesReview(input({ points: points(19), targetTimeS: [28, 34], stopReason: "targetWeight" }));
    expect(fast.issues.map((x) => x.kind)).toContain("fast_shot");
    expect(fast.nextShot?.grindDelta).toBe("finer");
    expect(fast.summary).toMatch(/^Ran 10 s faster than the 28–34 s target window/);

    const slow = rulesReview(input({ points: points(43, { f: 1.1 }), targetTimeS: [28, 34], stopReason: "targetWeight" }));
    expect(slow.issues.map((x) => x.kind)).toContain("slow_shot");
    expect(slow.nextShot?.grindDelta).toBe("coarser");
    expect(slow.summary).toMatch(/^Ran 8 s slower than the 28–34 s target window/);

    const fromCatalog = analyzeShot(input({
      profile: { title: "Extractamundo Dos!", beverage_type: "espresso", steps: pressureProfile.steps },
      points: points(17), targetTimeS: null, targetYieldG: 40, yieldG: 40, stopReason: "targetWeight",
    }));
    expect(fromCatalog.facts.expectedTimeS).toEqual([25, 35]);
    expect(fromCatalog.facts.timeStatus).toBe("fast");
    expect(fromCatalog.issues.map((x) => x.kind)).toContain("fast_shot");
  });

  it("explains contradictory mechanical evidence without inventing a taste report", () => {
    const review = rulesReview(input({ points: points(19, { f: 0.25 }), targetTimeS: [28, 34], stopReason: "targetWeight" }));
    expect(review.issues.map(i => i.kind)).toEqual(expect.arrayContaining(["choked", "fast_shot"]));
    expect(review.nextShot).toBeNull();
    expect(review.summary).toMatch(/mechanical signals.*opposite/);
    expect(review.summary).not.toMatch(/Taste and curve/);
  });

  it("does not turn an intentional ramp or an unrecorded target into a pressure hold diagnosis", () => {
    for (const measuredTarget of [true, false]) {
      const curve = points(31).map(p => ({ ...p, p: p.t * 0.3, tp: measuredTarget ? p.t * 0.3 : null }));
      const shot = input({ points: curve, targetTimeS: [25, 35] });
      expect(analyzeShot(shot).metrics.observedWindows).toBe(0);
      expect(analyzeShot(shot).facts.pourSteps[0].steadyTarget).toBe(false);
      expect(rulesReview(shot).summary).not.toMatch(/Pressure held|Pour pressure only reached|low puck resistance/);
      expect(rulesReview(shot).nextShot).toBeNull();
    }
  });

  it("keeps a catalogue window descriptive when an intentional longer ratio differs from its recipe", () => {
    const shot = input({ profile: { ...pressureProfile, title: "Gentle and sweet", steps: [{ pump: "pressure", pressure: "6", seconds: "60" }] }, points: points(51, { p: 6, tp: 6 }), doseG: 18, yieldG: 72, targetYieldG: 72, targetTimeS: null, stopReason: "targetWeight" });
    const analysis = analyzeShot(shot);
    expect(analysis.facts).toMatchObject({ expectedTimeSource: "guide", timeStatus: "slow", timeTargetComparable: false });
    expect(analysis.issues.map(i => i.kind)).not.toContain("slow_shot");
    const review = rulesReview(shot);
    expect(review.nextShot).toBeNull();
    expect(review.summary).toContain("guide window");
  });
});


describe("recorded phase evidence", () => {
  it("describes a short fill and a 4.5 mL/s hold, excluding preparation from the brew", () => {
    const shot = reviewFixture("high-flow-tracked");
    const { facts, metrics, issues } = analyzeShot(shot);
    const evidence = facts.phaseEvidence;
    expect(facts).toMatchObject({ brewStartS: 1, durationS: 20, peakPressureBar: 3.4, firstDripsS: 7.3 });
    expect(evidence.phases.map(({ frame, fromS, toS }) => [frame, fromS, toS])).toEqual([[0, 1, 2.75], [1, 3, 21]]);
    const [fill, pour] = evidence.phases;
    expect(fill.purpose.value).toBe("fill_or_soak");
    expect(fill.plan.value).toMatchObject({ transition: "fast", exit: { type: "pressure", value: 2 } });
    expect(fill.controlledError).toMatchObject({ coveredS: 1.75, value: { absoluteMean: 0, signedMean: 0 } });
    expect(pour.mode).toMatchObject({ value: "flow", source: "recorded" });
    expect(pour.controlledUnit).toBe("mL/s");
    expect(pour.controlledError).toMatchObject({ coveredS: 18, reason: "covered", value: { absoluteMean: 0, signedMean: 0 } });
    expect(pour.capLikeTime.value).toEqual({ seconds: 0, shareOfCoveredTime: 0 });
    expect(pour.pressureCrest.value).toMatchObject({ tS: 11, pressureBar: 3.4, inletFlowMlS: 4.5, pressurePerInletFlowProxyBarPerMlS: { value: 0.756 } });
    expect(pour.lateHydraulics.value).toMatchObject({ medianPressureBar: 2.65, medianInletFlowMlS: 4.5 });
    expect(pour.pressureDroopAtHeldFlowBar.value).toBe(0.75);
    // Weight first exceeds 1 g at 7.25 s, rises linearly at 4.8 g/s, and
    // the pressure is still on the 0.3 bar/s climb toward its 11 s crest.
    expect(evidence.firstSustainedBeverage).toMatchObject({ value: {
      tS: 7.25, previousBelowGramS: 7, confirmedThroughS: 7.75, pressureBar: 2.275,
      pressureAtPreviousBelowGramBar: 2.2, pressureAtConfirmationBar: 2.425,
      countedVolumeMl: { value: 28.125, source: "recorded" },
    }, reason: "three_consecutive_gram_readings" });
    expect(evidence.cupRateBeforeOnsetGS).toMatchObject({ value: 0, coveredS: 2 });
    expect(evidence.cupRateAfterOnsetGS).toMatchObject({ value: 4.8, coveredS: 2 });
    expect(fill.temperature.value).toMatchObject({ sensor: "group", entry: { value: { offsetC: -40 } },
      stateBoundaryDeltaC: { value: { fromS: 0.75, toS: 1, deltaC: -36 }, reason: "adjacent_readings_across_state_change" } });
    expect(pour.temperature.value).toMatchObject({ atOnset: { value: { offsetC: -27.5 } }, lateMedianOffsetC: { value: -5 } });
    expect(evidence.finish).toMatchObject({ annotatedYieldG: { value: 69 }, lastRecordedWeightG: { value: 67.2 },
      yieldToDoseRatio: { value: 3.833 }, volumeCountStartFrame: { value: 0 }, stopSource: { value: "targetWeight" } });
    expect(facts.pourSteps.map(step => step.steadyTarget)).toEqual([false, true]);
    expect(metrics.observedWindows).toBe(0); // High-flow holds remain excluded from diagnostic grading.
    expect(issues.map(i => i.kind)).toEqual(["off_target_temp"]);
    const review = rulesReview(shot);
    expect(review.summary).toContain("4.5 mL/s against a 4.5 mL/s");
    expect(review.summary).toContain("peaking at 3.4 bar");
    expect(review.summary).toContain("then gained about 4.8 g/s");
    expect(review.summary).not.toMatch(/No step held a steady target/);
    expect(review.nextShot).toBeNull();
  });

  it("measures time at either cap without making a 4.5 mL/s shortfall a fault", () => {
    const shot = reviewFixture("high-flow-capped");
    const { facts, issues } = analyzeShot(shot);
    const pour = facts.phaseEvidence.phases[1];
    expect(pour.controlledError.value).toEqual({ absoluteMean: 1.5, signedMean: -1.5 });
    expect(pour.capLikeTime.value).toEqual({ seconds: 18, shareOfCoveredTime: 1 });
    expect(pour.pressureDroopAtHeldFlowBar.value).toBeNull();
    expect(issues.map(i => i.kind)).toEqual(["off_target_temp"]);
    expect(rulesReview(shot).summary).toContain("near the 8.6 bar limit for 18.0 s");

    const mirrored = analyzeShot(reviewFixture("limited-pressure-shortfall")).facts.phaseEvidence.phases[1];
    expect(mirrored.capLikeTime.value).toEqual({ seconds: 16, shareOfCoveredTime: 1 });
    expect(mirrored.plan.value?.limiter?.unit).toBe("mL/s");
  });

  it("integrates irregular intervals and interpolates the simultaneous cap thresholds", () => {
    const shot = reviewFixture("high-flow-tracked");
    shot.points = [[0, 6, 5.5], [1, 8, 3.5], [1.5, 8, 3.5]].map(([t, p, f]) => ({
      ...shot.points[12], t, p, f, w: null, weightFlow: null,
    }));
    const phase = analyzeShot(shot).facts.phaseEvidence.phases[0];
    // Residual goes linearly from +1 to -1 for one second, then stays at -1 for half a second.
    expect(phase.controlledError).toMatchObject({ coveredS: 1.5, value: { absoluteMean: 0.667, signedMean: -0.333 } });
    // Pressure crosses 7.74 bar at 0.87 s and flow crosses 3.6 mL/s at 0.95 s.
    expect(phase.capLikeTime.value).toEqual({ seconds: 0.55, shareOfCoveredTime: 0.367 });
  });

  it("keeps a phase aligned when an isolated handoff sample logs the opposite controller", () => {
    const shot = reviewFixture("high-flow-tracked");
    const handoff = shot.points.find(p => p.t === 10)!;
    handoff.tf = 0;
    handoff.tp = 6;
    const phase = analyzeShot(shot).facts.phaseEvidence.phases[1];
    expect(phase.mode.value).toBe("flow");
    expect(phase.loggedCommand.value).toMatchObject({ min: 4.5, max: 4.5 });
    expect(phase.controlledError).toMatchObject({ coveredS: 17.5, reason: "partial_missing_readings_or_gaps", value: { absoluteMean: 0 } });
  });

  it("reports a gradual inlet rise at held pressure and preserves existing fault kinds", () => {
    const { facts, issues } = analyzeShot(reviewFixture("channeling"));
    const phase = facts.phaseEvidence.phases[0];
    expect(phase.earlyHydraulics.value).toMatchObject({ medianPressureBar: 9, medianInletFlowMlS: 0.975 });
    expect(phase.lateHydraulics.value).toMatchObject({ medianPressureBar: 9, medianInletFlowMlS: 2.725 });
    expect(phase.controlledError.value?.absoluteMean).toBe(0);
    expect(issues.map(i => i.kind)).toEqual(["channeling"]);
    expect(rulesReview(reviewFixture("channeling")).summary).toContain("Inlet flow rose gradually while pressure held");
    for (const [name, expected] of [
      ["choke", ["choked"]], ["gusher", ["gushed"]], ["flow-shortfall", ["flow_shortfall"]], ["fast-time", ["fast_shot"]],
    ] as const) expect(analyzeShot(reviewFixture(name)).issues.map(i => i.kind)).toEqual(expected);
  });

  it("compares a decline against its live ramp and shows a deliberate mix temperature step", () => {
    const { facts, issues } = analyzeShot(reviewFixture("pressure-ramp"));
    const phase = facts.phaseEvidence.phases[3];
    expect(phase.purpose.value).toBe("decline");
    expect(phase.loggedCommand.value).toMatchObject({ entry: 6, last: 3 });
    expect(phase.controlledError).toMatchObject({ coveredS: 12, value: { absoluteMean: 0.1, signedMean: -0.1 } });
    expect(phase.steadyHold).toMatchObject({ value: null, reason: "changing_logged_command" });
    expect(phase.temperature.value).toMatchObject({ sensor: "mix", entry: { value: { targetC: 85, offsetC: 4 } },
      lateMedianOffsetC: { value: 4 }, targetChangeAtEntryC: { value: -7 } });
    expect(facts.phaseEvidence.finish.stopSource.value).toBe("apiStop");
    expect(issues).toEqual([]);
  });

  it("includes a dynamic bloom and separates an unobserved intermediate phase from a weight-preempted decline", () => {
    const bloomResult = analyzeShot(reviewFixture("dynamic-bloom"));
    const bloom = bloomResult.facts.phaseEvidence.phases[1];
    expect(bloom.purpose.value).toBe("bloom_or_pause");
    expect(bloom.loggedCommand.value).toMatchObject({ entry: 4, last: 0 });
    expect(bloom.controlledError.value?.absoluteMean).toBe(0);
    expect(bloom.cupGainG.value).toBe(4.125);
    expect(bloomResult.issues).toEqual([]);

    const stopped = analyzeShot(reviewFixture("preempted-decline"));
    const finish = stopped.facts.phaseEvidence.finish;
    expect(finish.lastObservedPhase.value).toMatchObject({ frame: 2, toS: 10 });
    expect(finish.unobservedPlanPhases.value).toEqual([
      { frame: 1, name: "Dynamic bloom", status: "skipped_or_unrecorded" },
      { frame: 3, name: "Decline", status: "preempted_by_weight_stop" },
    ]);
    expect(finish.lastRecordedWeightG.value).toBe(10.5);
    expect(finish.annotatedYieldG.value).toBe(11);
    expect(stopped.issues).toEqual([]);
  });

  it("reports elapsed-time coverage and withholds cup windows across gaps, stale samples and jumps", () => {
    const evidence = (name: ReviewFixture) => analyzeShot(reviewFixture(name)).facts.phaseEvidence;
    const missingScale = evidence("missing-scale");
    expect(missingScale.firstSustainedBeverage.reason).toBe("no_scale_readings");
    expect(missingScale.phases[0].controlledError.value?.absoluteMean).toBe(0);
    expect(missingScale.phases[0].cupRateLateGS.reason).toBe("no_scale_readings");
    expect(missingScale.finish.lastRecordedWeightG.value).toBeNull();
    expect(evidence("scale-jump").cupRateAfterOnsetGS).toMatchObject({ value: null, reason: "weight_jump" });
    expect(evidence("scale-jump").phases[1].cupRateLateGS.value).toBe(4.8);
    expect(evidence("stale-scale").firstSustainedBeverage).toMatchObject({ value: null, reason: "stale_scale_sample" });
    const gap = evidence("phase-gap");
    expect(gap.phases[1].controlledError).toMatchObject({ coveredS: 12.25, reason: "partial_missing_readings_or_gaps" });
    expect(gap.firstSustainedBeverage).toMatchObject({ value: null, reason: "scale_gap" });
    expect(evidence("no-data").finish.lastObservedPhase.reason).toBe("no_brew_samples");
  });

  it("keeps measured landmarks with ambiguous all-zero imports or manual controller traces", () => {
    const imported = analyzeShot(reviewFixture("all-zero-import")).facts.phaseEvidence;
    expect(imported.phases[0].mode).toMatchObject({ value: null, reason: "all_frames_zero_only_pouring_plan_alignment_ambiguous" });
    expect(imported.phases[0].pressureCrest.value?.pressureBar).toBe(3.4);
    expect(imported.firstSustainedBeverage.value?.tS).toBe(7.25);
    expect(imported.finish.unobservedPlanPhases.value).toBeNull();
    const manual = analyzeShot(reviewFixture("manual")).facts.phaseEvidence;
    expect(manual.phases[0].controlledError.reason).toBe("manual_control");
    expect(manual.phases[0].inletFlowMlS.value?.timeWeightedMean).toBe(2);
  });
});
