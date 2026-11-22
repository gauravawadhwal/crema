import { describe, expect, it, vi } from "vitest";
import { assertCurveStageInvariant, mockCurveStage } from "../evals/lib/review-crossed.js";
import { reviewFixture } from "../evals/lib/review-fixtures.js";
import { MockProvider } from "../server/llm/mock.js";
import { ProviderChain } from "../server/llm/index.js";
import type { StructuredRequest } from "../server/llm/types.js";
import { CoachReview } from "../server/schema.js";
import type { ProfileStepLike } from "../server/profiles/curve.js";
import { fullReviewTrace } from "../server/recommend/review-evidence.js";
import { rulesReviewResult } from "../server/recommend/review-local.js";
import { reviewShot } from "../server/recommend/review.js";
import { SHOT_REVIEW_VERSION, type ReviewInput, type ReviewPoint } from "../server/recommend/review-types.js";
import codexBloom from "./fixtures/coach-codex-bloom.json" with { type: "json" };
import type { z } from "zod";

const fill: ProfileStepLike = { name: "Fill start", pump: "pressure", pressure: 3, sensor: "coffee", temperature: 93 };
const main: ProfileStepLike = { name: "Pour", pump: "pressure", pressure: 8, sensor: "coffee", temperature: 93 };
const decline: ProfileStepLike = { ...main, name: "Pressure decline", transition: "smooth", pressure: 5 };
const bloom: ProfileStepLike = { ...main, name: "Bloom", pump: "flow", flow: 0, exit: { type: "pressure", condition: "under", value: 2 } };
type PhaseFixture = { step: ProfileStepLike; seconds?: number; readings?: (t: number) => Partial<ReviewPoint> };

function synthetic(phases: PhaseFixture[], overrides: Partial<ReviewInput> = {}): ReviewInput {
  const points: ReviewPoint[] = [];
  for (const [frame, { step, seconds = 10, readings }] of phases.entries()) {
    const start = (points.at(-1)?.t ?? -0.25) + 0.25;
    for (let elapsed = 0; elapsed < seconds; elapsed += 0.25) {
      const t = start + elapsed;
      points.push({ t, frame, substate: "pouring", p: Number(step.pressure ?? 2), f: Number(step.flow ?? 1.8),
        tp: step.pump === "pressure" ? Number(step.pressure) : null, tf: step.pump === "flow" ? Number(step.flow) : null,
        temp: 99, targetTemp: 99, groupTemp: 93, targetGroupTemp: 93, w: Math.max(0, 1.8 * (t - 2)),
        weightFlow: null, ...readings?.(elapsed) });
    }
  }
  return {
    points, profile: { title: "Synthetic review", beverage_type: "espresso", steps: phases.map(p => p.step) },
    timestamp: "2026-01-03T00:00:00Z", batchId: "synthetic-bag", profileShape: "synthetic-plan",
    tempC: 93, doseG: 18, yieldG: 36, targetYieldG: 36, stopReason: "targetWeight", targetTimeS: null,
    feedback: null, bean: null, installedProfiles: [], history: [], ...overrides,
  };
}

const coachOf = (shot: ReviewInput) => rulesReviewResult(shot).coach;
const grade = (coach: CoachReview) => coach.phases.map(phase => phase.verdict);
const earlier = (shot: ReviewInput, durationS: number): ReviewInput["history"][number] => ({
  timestamp: "2026-01-02T00:00:00Z", profileTitle: shot.profile?.title, profileShape: shot.profileShape,
  batchId: shot.batchId, tempC: shot.tempC, doseG: shot.doseG, yieldG: shot.yieldG, targetYieldG: shot.targetYieldG,
  stopReason: shot.stopReason, durationS, grinderSetting: shot.grinderSetting,
});

describe("coach phase and temperature verdicts", () => {
  it("grades all planned phases and uses the selected group sensor", () => {
    const coach = coachOf(synthetic([{ step: fill }, { step: main }, { step: decline }]));
    expect(CoachReview.safeParse(coach).success).toBe(true);
    expect(grade(coach)).toEqual(["on_plan", "on_plan", "on_plan"]);
    expect(coach.headline.sentence).toMatch(/followed the plan.*temperature held/);
    expect(coach.temperature).toMatchObject({ verdict: "on_plan", actual: { finish: 93 }, unit: "°C" });
    expect([...coach.phases, coach.temperature].map(row => row.sentence).join(" ")).not.toMatch(/\d|\b(?:Plan|Recorded):/i);
    expect(coach.history).toBeNull();
    expect(coach.taste).toBeNull();
    expect(coach.recommendation.adjustment).toBeNull();
  });

  it("contrasts a tracked first phase with an off-plan main phase", () => {
    const first = { ...main, name: "Pressure build", pressure: 6 };
    const coach = coachOf(synthetic([{ step: first, seconds: 3 }, { step: main, readings: () => ({ p: 3 }) }]));
    expect(grade(coach)).toEqual(["on_plan", "off_plan"]);
    expect(coach.headline.sentence).toMatch(/followed the plan.*missed its target/);
    expect(coach.phases[1]).toMatchObject({ expected: { average: 8 }, actual: { average: 3 },
      meanAbsoluteError: 5, sentence: "Pressure averaged 3 bar against a target of 8 bar." });
  });

  it("uses partly for a sustained smaller miss and not graded for missing data", () => {
    expect(grade(coachOf(synthetic([{ step: main, readings: () => ({ p: 6 }) }])))).toEqual(["partly"]);
    expect(grade(coachOf(synthetic([{ step: main, readings: () => ({ tp: null }) }])))).toEqual(["not_graded"]);
  });

  it("does not fail chamber filling or leak its transient into the headline", () => {
    const coach = coachOf(synthetic([{ step: fill, seconds: 2, readings: () => ({ p: 0.2 }) }, { step: main }]));
    expect(grade(coach)).toEqual(["not_graded", "on_plan"]);
    expect(coach.phases[0].sentence).toMatch(/machine was still filling/);
    expect(coach.headline.sentence).toMatch(/followed the plan through the main phases/);
    const prolonged = { ...fill, name: "Fill" };
    expect(grade(coachOf(synthetic([{ step: prolonged, seconds: 3, readings: () => ({ p: 1 }) }, { step: main }])))[0]).toBe("partly");
  });

  it("does not call bloom lag a failure unless the flow was well above plan throughout", () => {
    const entryLag = (t: number) => ({ tf: 4 - t, f: 7 - 1.8 * t });
    const shot = (seconds: number, readings: PhaseFixture["readings"]) =>
      coachOf(synthetic([{ step: fill }, { step: bloom, seconds, readings }, { step: main }]));
    expect(grade(shot(3, () => ({ tf: 0, f: 0 })))[1]).toBe("on_plan");
    expect(grade(shot(0.75, entryLag))[1]).toBe("not_graded");
    const lag = shot(3, t => ({ tf: Math.max(0, 4 - 2 * t), f: Math.max(0, 8 - 5 * t) }));
    expect(lag.phases[1]).toMatchObject({ name: "Bloom", verdict: "partly", sentence: expect.stringContaining("exit trigger") });
    expect(grade(shot(3, () => ({ tf: 0, f: 2 })))[1]).toBe("off_plan");
  });

  it("treats a decline preempted at target weight as ungraded", () => {
    const shot = synthetic([{ step: fill }, { step: main }]);
    shot.profile!.steps!.push(decline);
    expect(coachOf(shot).phases[2]).toMatchObject({ name: "Decline", verdict: "not_graded", actual: null,
      sentence: "The shot reached target weight before this phase." });
    expect(coachOf({ ...shot, stopReason: "apiStop" }).phases[2].sentence).toMatch(/ended before/);
    expect(coachOf(shot).stages.at(-1)).toMatchObject({ name: "Finish", verdict: "not_graded", phaseIds: ["planned-2"],
      sentence: "The shot reached target weight before the planned finish." });
  });

  it("groups consecutive start-up rows and uses the worst meaningful verdict in each stage", () => {
    const coach = coachOf(synthetic([
      { step: fill, seconds: 2, readings: () => ({ p: 0.2 }) }, { step: { ...fill, name: "Fill" } },
      { step: main }, { step: { ...main, name: "Second hold" }, readings: () => ({ p: 4 }) }, { step: decline },
    ]));
    expect(coach.stages).toMatchObject([
      { name: "Start-up", verdict: "on_plan", phaseIds: ["planned-0", "planned-1"], sentence: "The machine built pressure as planned." },
      { name: "Main pour", verdict: "off_plan", phaseIds: ["planned-2", "planned-3"], sentence: "Pressure averaged 4 bar against a target of 8 bar." },
      { name: "Finish", verdict: "on_plan", phaseIds: ["planned-4"] },
    ]);
    expect(coach.stages.flatMap(row => row.phaseIds)).toEqual(coach.phases.map(row => row.id));
    expect(coach.temperature.phaseIds).toEqual(coach.phases.map(row => row.id));
  });

  it("gives an important bloom its own stage and folds a short on-plan bloom into start-up", () => {
    const shot = (f: number) => coachOf(synthetic([
      { step: fill }, { step: bloom, seconds: 2, readings: () => ({ f }) }, { step: main },
    ]));
    expect(shot(0).stages[0]).toMatchObject({ name: "Start-up", phaseIds: ["planned-0", "planned-1"] });
    expect(shot(2).stages[1]).toMatchObject({ name: "Bloom", verdict: "off_plan", phaseIds: ["planned-1"] });
  });

  it("grades recovery after a cold start, a sustained miss, and unavailable sensor readings", () => {
    const temp = (readings: PhaseFixture["readings"]) => coachOf(synthetic([{ step: main, readings }])).temperature;
    expect(temp(t => ({ groupTemp: t < 1 ? 85 : 93 }))).toMatchObject({
      verdict: "partly", sentence: "Group temperature started cold and recovered near target by the end.",
    });
    expect(temp(() => ({ groupTemp: 89 }))).toMatchObject({ verdict: "partly" });
    expect(temp(() => ({ groupTemp: 86 }))).toMatchObject({ verdict: "off_plan" });
    expect(temp(() => ({ groupTemp: null }))).toMatchObject({ verdict: "not_graded" });
  });

  it("grades deliberate target drops and ongoing recovery as partly without an off-plan headline", () => {
    const stepped = (target: number, groupTemp: (elapsed: number) => number) => coachOf(synthetic([
      { step: fill }, { step: { ...main, temperature: target }, readings: t => ({ targetGroupTemp: target, groupTemp: groupTemp(t) }) },
    ]));
    const fewDegrees = stepped(88, () => 92);
    expect(fewDegrees.temperature).toMatchObject({ verdict: "partly", sentence: expect.stringContaining("lower finish target") });
    expect(fewDegrees.headline.sentence).not.toMatch(/sustained temperature miss/);
    const lagging = stepped(82, t => 96 - t * 0.7);
    expect(lagging.temperature).toMatchObject({ verdict: "partly", sentence: expect.stringContaining("still settling") });
    expect(stepped(82, () => 92).temperature.verdict).toBe("off_plan");
  });

  it("calls a high target flow on plan below the pressure ceiling and describes the easy pour", () => {
    const shot = synthetic([{ step: { ...main, pressure: undefined, pump: "flow", flow: 4.5, limiter: { value: 8.6 } },
      seconds: 20, readings: t => ({ p: t < 7 ? 2 : 3.4, w: Math.max(0, 4.6 * (t - 6.25)) }) }]);
    const coach = coachOf(shot);
    expect(coach.phases[0]).toMatchObject({ verdict: "on_plan", ceiling: { value: 8.6, unit: "bar" },
      expected: { average: 4.5 }, actual: { average: 4.5 }, sentence: "The machine held close to the planned flow." });
    expect(coach.notable.map(item => item.sentence)).toContain(
      "The machine held 4.5 mL/s, with pressure reaching only 3.4 bar under its 8.6 bar ceiling.");
    expect(coach.headline.sentence).toMatch(/held the planned flow.*fits a puck/);
    expect(coach.hypotheses[0]).toMatchObject({ signature: "sour_thin", evidenceIds: ["phase-0", "cup"] });
    expect(coach.recommendation.adjustment).toBeNull();
  });

  it("reserves reported pace figures for finishes about ten seconds outside the window", () => {
    const shot = synthetic([{ step: main, seconds: 20.25 }], { timeBasis: "recorded" });
    expect(coachOf({ ...shot, targetTimeS: [28.49, 35] }).notable).toHaveLength(0);
    expect(coachOf({ ...shot, targetTimeS: [28.5, 35] }).notable.map(item => item.sentence))
      .toContain("The shot finished in about 20 s against a 28.5–35 s expected window.");
    const earlyLever = synthetic([{ step: main, seconds: 21.75 }], { timeBasis: "recorded", targetTimeS: [30, 45] });
    expect(coachOf(earlyLever).notable.map(item => item.sentence))
      .toContain("The shot finished in about 21.5 s against a 30–45 s expected window.");
  });

  it("names the tracked stages and the departures in a mixed headline", () => {
    const coach = coachOf(synthetic([
      { step: fill }, { step: bloom, seconds: 3, readings: t => ({ tf: Math.max(0, 4 - 2 * t), f: Math.max(0, 8 - 5 * t) }) },
      { step: { ...main, name: "Pressure build" }, seconds: 3, readings: () => ({ p: 5 }) },
      { step: main }, { step: decline },
    ]));
    expect(coach.headline.sentence).toBe("The machine followed the plan through the main pour and finish, with the bloom and pressure build running differently.");
  });
});

describe("coach history, taste and the next test", () => {
  it("shows a material same-recipe difference and does not infer a cause from grinder labels", () => {
    const shot = synthetic([{ step: main, seconds: 20.25 }], { grinderSetting: "A" });
    const compared = (duration: number, extra = {}) => coachOf({ ...shot, history: [{ ...earlier(shot, duration), ...extra }] }).history;
    expect(compared(17.01)).toBeNull();
    expect(compared(17, { grinderSetting: "B" })?.sentence).toMatch(/20 s versus 17 s.*can't tell what caused/);
    expect(compared(10, { batchId: "another-bag" })).toBeNull();
    expect(compared(23.25)).toBeNull(); // 3.25 s is under 15% of the prior duration.
    expect(compared(24)?.sentence).toContain("20 s versus 24 s");
  });

  it("shows repeated early finishes beyond the existing time threshold", () => {
    const shot = synthetic([{ step: main, seconds: 20.25 }], { targetTimeS: [24, 30], timeBasis: "recorded" });
    expect(coachOf({ ...shot, history: [earlier(shot, 20.01)] }).history).toBeNull();
    expect(coachOf({ ...shot, history: [earlier(shot, 20)] }).history?.sentence).toMatch(/Both pours finished ahead/);
  });

  it("requires a material difference in pressure at shared cup mass, onset or cup rate", () => {
    const shot = synthetic([{ step: main, seconds: 20.25 }]);
    const trace = fullReviewTrace(shot).trace;
    const prior = (bar: number, onset: number, rate: number) => ({
      ...trace,
      firstGramBrewElapsedS: trace.firstGramBrewElapsedS! + onset,
      cupRateAfterOnsetGS: trace.cupRateAfterOnsetGS! + rate,
      mass: { ...trace.mass, checkpoints: trace.mass.checkpoints.map(point => ({ ...point, pressureBar: point.pressureBar + bar })) },
    });
    const compare = (bar: number, onset: number, rate: number) =>
      coachOf({ ...shot, history: [{ ...earlier(shot, 20), trace: prior(bar, onset, rate) }] }).history?.sentence;
    expect(compare(0.9, 1.9, 0.9)).toBeUndefined();
    expect(compare(1, 0, 0)).toMatch(/g in the cup.*8 bar versus 9 bar/);
    expect(compare(0, 2, 0)).toMatch(/first gram/);
    expect(compare(0, 0, 1)).toMatch(/g\/s versus/);
  });

  it("links ratings in both directions, leaves balanced taste unlinked, and repeats on conflict", () => {
    const shot = reviewFixture("gusher");
    const rated = (sourBitter: number, body: number) =>
      coachOf({ ...shot, feedback: { sourBitter, body, enjoyment: 10, notes: "Saved observation." } });
    expect(rated(-1, -2).taste).toMatchObject({ enjoyment: 10, notes: "Saved observation.",
      reported: "You said it tasted slightly sour and thin, which fits the easy flow above.",
      links: [{ hypothesisId: "easy-flow", status: "matches" }] });
    expect(rated(2, 0).taste?.links[0].status).toBe("does_not_match");
    expect(rated(0, 2).taste?.links[0].status).toBe("does_not_match");
    expect(rated(0, 0).taste?.links[0]).toMatchObject({ status: "no_link", sentence: null });
    expect(rated(0, 0).taste?.reported).toBe("You said it tasted balanced.");
    expect(rated(2, 0).recommendation).toMatchObject({ action: expect.stringContaining("Repeat"), adjustment: null });
    expect(coachOf(reviewFixture("choke")).hypotheses[0].signature).toBe("bitter_heavy");
  });

  it("uses a fixed puck check without diagnosing a defect or claiming a taste link", () => {
    const shot = reviewFixture("channeling");
    const coach = coachOf({ ...shot, feedback: { sourBitter: 0, body: 0, enjoyment: 9, notes: null } });
    expect(coach.hypotheses).toContainEqual(expect.objectContaining({ signature: "none", confidence: "low" }));
    expect(coach.taste?.links).toContainEqual(expect.objectContaining({ status: "no_link", sentence: null }));
    expect(coach.recommendation).toMatchObject({ action: "Check for even distribution before you tamp.",
      puckCheck: "even_distribution", adjustment: null, expect: expect.any(String), compare: expect.any(String) });
    expect(coachOf(shot).recommendation.puckCheck).toBeNull();
  });

  it("keeps both providers' mechanical sections byte-identical across present, historical and bean taste", async () => {
    const shot = reviewFixture("gusher");
    await assertCurveStageInvariant(shot);
    await assertCurveStageInvariant(shot, mockCurveStage);
    const project = ({ taste, recommendation, ...mechanics }: CoachReview) => JSON.stringify(mechanics);
    expect(project(coachOf({ ...shot, feedback: { sourBitter: 0, body: 0, enjoyment: 10, notes: "Loved it." } })))
      .toBe(project(coachOf(shot)));
  });
});

describe("coach wording and wire compatibility", () => {
  function recordedProvider(answer: unknown, inspect?: (prompt: string) => void) {
    class RecordedProvider extends MockProvider {
      override async structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>> {
        inspect?.(req.prompt);
        return req.schema.parse(answer);
      }
    }
    return new ProviderChain([new RecordedProvider()]);
  }

  it("replays Codex's rewrite of a synthetic bloom omitted by the detailed phase projection", async () => {
    const shot = reviewFixture("high-flow-tracked");
    const pour = shot.profile!.steps![1];
    const fill = { ...pour, name: "Fill start", seconds: 3 };
    const bloom = { ...pour, name: "Bloom", flow: 0, seconds: 2 };
    shot.profile!.steps = [...Array.from({ length: 12 }, () => fill), bloom, pour];
    const sample = shot.points[12];
    shot.points = Array.from({ length: 48 * 4 }, (_, i) => {
      const t = i / 4;
      const duringBloom = t >= 36 && t < 38;
      return { ...sample, t, frame: t < 36 ? Math.floor(t / 3) : duringBloom ? 12 : 13,
        tf: duringBloom ? 0 : 4.5, p: 3.4, w: Math.max(0, t - 25) * 3, countedVolumeMl: t * 4.5,
        groupTemp: 92, targetGroupTemp: 92 };
    });
    shot.yieldG = shot.targetYieldG = shot.annotatedYieldG = 68.25;
    const rules = rulesReviewResult(shot);
    const reply = await reviewShot(recordedProvider(codexBloom, prompt => {
      const evidence = JSON.parse(prompt.split("EVIDENCE (keys are evidence IDs):\n")[1].split("\n")[0]);
      expect(evidence["phase-12"]).toBeUndefined();
    }), shot);
    expect(reply.source).toBe("mock");
    expect(reply.coach.headline).toEqual({ ...rules.coach.headline, sentence: codexBloom.rewrites[0].text });
    expect(reply.coach.stages[1]).toEqual({ ...rules.coach.stages[1], sentence: codexBloom.rewrites[3].text });
    expect(reply.coach.phases).toEqual(rules.coach.phases);
    expect(reply.curve.narrative?.text).toBe(codexBloom.rewrites.map(row => row.text).join(" "));
    expect(reply.curve.narrative?.evidenceIds).toContain("phase-12");
  });

  it("keeps useful wording with different precision and skips unusable slots individually", async () => {
    const shot = reviewFixture("high-flow-tracked");
    const rules = rulesReviewResult(shot);
    const text = "Your cup stayed nearly dry for roughly six seconds, then filled quickly.";
    const rewrites = [
      { slot: "notable-1", text, evidenceIds: ["invented-id"] },
      { slot: "temperature", text: "  ", evidenceIds: [] },
      { slot: "notable-1", text: "Your cup stayed nearly dry. Private marker.", evidenceIds: ["cup"] },
      { slot: "private-slot", text: "Private marker.", evidenceIds: [] },
    ];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const reply = await reviewShot(recordedProvider({ rewrites }), shot);
      expect(reply.source).toBe("mock");
      expect(reply.coach.notable[0]).toEqual({ ...rules.coach.notable[0], sentence: text });
      expect(reply.coach.temperature).toEqual(rules.coach.temperature);
      expect(reply.curve.narrative).toEqual({ text, evidenceIds: rules.coach.notable[0].evidenceIds });
      expect(warn.mock.calls).toEqual([
        ["review: rejected coach rewrite", { provider: "mock", slot: "temperature", reason: "empty text", sample: "" }],
        ["review: rejected coach rewrite", { provider: "mock", slot: "notable-1", reason: "duplicate slot", sample: "your cup stayed nearly … … …" }],
        ["review: rejected coach rewrite", { provider: "mock", slot: "<unknown>", reason: "unknown slot", sample: "… …" }],
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it("falls back to rules when the provider response cannot be parsed", async () => {
    const shot = reviewFixture("high-flow-tracked");
    const response = { rewrites: [
      { slot: "headline", text: "The machine held flow near a private marker.", evidenceIds: ["phase-1"] },
      { slot: "temperature", text: 5, evidenceIds: [] },
    ] };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await reviewShot(recordedProvider(response), shot)).toEqual(rulesReviewResult(shot));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("review: using measured summary:"), {
        rewrites: 2,
        samples: [{ slot: "headline", text: "the machine held flow … a … …" }, { slot: "temperature", text: "number" }],
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("retains the old flat contract while adding the new sections to rules and mock results", async () => {
    const shot = reviewFixture("gusher");
    const rules = rulesReviewResult(shot);
    const wire = await reviewShot(new ProviderChain(["mock"]), shot);
    expect(SHOT_REVIEW_VERSION).toBe(4);
    expect(wire.coach).toEqual(rules.coach);
    expect(wire.review).toMatchObject({ summary: expect.any(String), issues: expect.any(Array), nextShot: rules.coach.recommendation.adjustment });
    expect(wire.curve).toEqual(rules.curve);
    expect(wire.taste).toEqual(rules.taste);
  });
});
