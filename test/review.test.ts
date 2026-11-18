import { describe, expect, it } from "vitest";
import { reviewFixture } from "../evals/lib/review-fixtures.js";
import { createApp } from "../server/app.js";
import { ProviderChain } from "../server/llm/index.js";
import type { LlmProvider } from "../server/llm/types.js";
import { reviewShot } from "../server/recommend/review.js";
import type { ReviewInput, ReviewPoint } from "../server/recommend/review-types.js";
import { fullReviewTrace, REVIEW_POINT_LIMIT } from "../server/recommend/review-evidence.js";
import { rulesReviewResult } from "../server/recommend/review-local.js";
import { ReviewBody } from "../server/schema.js";

const point = (t: number, frame: number | null = 0, substate: string | null = "pour"): ReviewPoint => ({
  t, p: 8, f: 2, w: t, temp: 92, tp: 8, tf: null, targetTemp: 92, frame, substate, weightFlow: 2,
});
const input = (overrides: Partial<ReviewInput> = {}): ReviewInput => ({
  points: [point(0), point(10), point(20)], profile: null, doseG: 18, yieldG: 36,
  targetYieldG: 36, targetTimeS: [18, 32], stopReason: null, feedback: null, bean: null,
  installedProfiles: ["Installed profile"], history: [], ...overrides,
});
const provider = (answer: unknown | ((prompt: string) => unknown) | Error): ProviderChain => {
  const p: LlmProvider = {
    id: "mock", billing: "test",
    async structured(req) {
      if (answer instanceof Error) throw answer;
      const value = typeof answer === "function" ? answer(req.prompt) : answer;
      return req.schema.parse(value) as never;
    },
  };
  return new ProviderChain([p]);
};
const cleanReview = (overrides: Record<string, unknown> = {}) => ({
  summary: "The measured shot tracked its targets.", wentWell: ["Pressure stayed near target."], issues: [],
  nextShot: null, confidence: "low", askTaste: true, notesEvidence: null, notesTaste: null, ...overrides,
});

describe("shot review backend", () => {
  it("uses rules with truthful provenance when the model fails", async () => {
    const result = await reviewShot(provider(new Error("provider unavailable")), input());
    expect(result.source).toBe("rules");
    expect(result.review.summary).toBeTruthy();
  });

  it("serves validated reviews with provider provenance", async () => {
    const app = createApp({ llm: new ProviderChain(["mock"]) });
    const res = await app.request("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input()) });
    expect(res.status).toBe(200);
    const result = await res.json();
    expect(result.source).toBe("mock");
    expect(result.review.askTaste).toBe(true);
    expect(result.review.nextShot).toBeNull();
  });

  it("accepts unknown values in previous shots without fabricating ratings or yield", async () => {
    let prompt = "";
    const app = createApp({ llm: provider((value) => { prompt = value; return cleanReview(); }) });
    const history = [{ timestamp: "2026-11-01T00:00:00Z", enjoyment: null, doseG: null, yieldG: null, profileTitle: null }];
    const res = await app.request("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input({ history })) });
    expect(res.status).toBe(200);
    expect((await res.json()).source).toBe("mock");
    expect(JSON.parse(prompt.split("RECENT HISTORY FOR THIS BAG (bounded, enjoyment 0..10):\n")[1])).toEqual(history);
  });

  it("sends a high-flow hold and its measured pressure crest without adding faults", async () => {
    const shot = reviewFixture("high-flow-tracked");
    const hidden = shot.points.find(p => p.t > 8 && p.t < 11)!;
    hidden.p = 3.45;
    let prompt = "";
    const app = createApp({ llm: provider(value => { prompt = value; return cleanReview(); }) });
    const response = await app.request("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(shot) });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.source).toBe("mock");
    expect(result.review.issues.map((issue: { kind: string }) => issue.kind)).toEqual(["off_target_temp"]);
    const facts = JSON.parse(prompt.split("SHOT FACTS (measured by code from every sample; null means not measured):\n")[1].split("\n\n")[0]);
    const sampled = JSON.parse(prompt.split("SHOT CURVES AND EVENTS")[1].split("\n")[1]);
    expect(facts.gradedWindows).toBe(1);
    expect(facts.phaseEvidence.phases[1]).toMatchObject({ mode: { value: "flow" }, controlledError: { value: { absoluteMean: 0 } },
      pressureCrest: { value: { tS: hidden.t, pressureBar: 3.45 } } });
    expect(facts.phaseEvidence.firstSustainedBeverage.value.countedVolumeMl).toMatchObject({ value: 28.125, reason: "machine_counted_volume" });
    expect(sampled.rows).toContainEqual(expect.arrayContaining([hidden.t, 3.45]));
    expect(sampled.events).toContainEqual(expect.objectContaining({ kind: "brew_pressure_crest", t: hidden.t,
      at: expect.arrayContaining([hidden.t, 3.45]) }));
  });

  it("keeps provider findings, facts and event evidence identical at every row budget", async () => {
    const shot = reviewFixture("high-flow-tracked");
    const runs = [];
    for (const pointBudget of [0, 1, 32, 5000]) {
      let prompt = "";
      const result = await reviewShot(provider(value => { prompt = value; return cleanReview(); }), shot, undefined, { pointBudget });
      const facts = JSON.parse(prompt.split("SHOT FACTS")[1].split("\n")[1]);
      const { events, rows, gaps } = JSON.parse(prompt.split("SHOT CURVES AND EVENTS")[1].split("\n")[1]);
      expect(rows).toHaveLength(Math.min(shot.points.length, pointBudget));
      expect(result.source).toBe("mock");
      expect(result.review.issues.map(issue => issue.kind)).toEqual(["off_target_temp"]);
      runs.push({ facts, events, gaps, issues: result.review.issues });
    }
    expect(runs[0].events.map((event: { kind: string }) => event.kind)).toContain("first_sustained_beverage");
    for (const result of runs.slice(1)) expect(result).toEqual(runs[0]);
  });

  it("uses the same versioned history and landmarks in rules, AI facts and the returned review", async () => {
    const shot = reviewFixture("comparable-phase-history");
    shot.history.push({ ...shot.history[0], timestamp: "2000-01-01T11:00:00Z", batchId: "other-bag", notes: "Different bag only" });
    const rules = rulesReviewResult(shot);
    let prompt = "";
    const app = createApp({ llm: provider(value => { prompt = value; return cleanReview(); }) });
    const res = await app.request("/api/review", { method: "POST", body: JSON.stringify(shot) });
    expect(res.status).toBe(200);
    const result = await res.json();
    expect(result.evidence).toEqual(rules.evidence);
    const facts = JSON.parse(prompt.split("SHOT FACTS (measured by code from every sample; null means not measured):\n")[1].split("\n\n")[0]);
    const history = JSON.parse(prompt.split("HISTORY COMPARISON (computed from recorded metadata, not prior review prose):\n")[1].split("\n\n")[0]);
    expect(facts).toMatchObject({ evidenceVersion: 1, units: { pressure: "bar", cupMass: "g" },
      landmarks: expect.arrayContaining([{ id: "first-sustained-gram", phaseId: "phase-0", tS: 4.5, brewElapsedS: 4.5, phaseElapsedS: 4.5, source: "inferred", reason: "three_consecutive_gram_readings" }]) });
    expect(history).toEqual(rules.evidence.history);
    expect(history.excluded.bag).toBe(1);
    expect(prompt).not.toContain("Different bag only");
  });

  it("keeps a full-trace crest and the code findings when the request caps the sampled points", async () => {
    const shot = reviewFixture("comparable-phase-history");
    shot.points = Array.from({ length: 2401 }, (_, i) => {
      const t = i / 100;
      return { ...shot.points[0], t, scaleSampleS: t - 0.05, w: Math.max(0, t - 4) * 2, p: 3.6 };
    });
    const points = Array.from({ length: REVIEW_POINT_LIMIT }, (_, i) => shot.points[Math.round(i * (shot.points.length - 1) / (REVIEW_POINT_LIMIT - 1))]);
    const crest = shot.points.find(p => p.t > 8 && !points.includes(p))!;
    crest.p = 5.2;
    const fullTrace = fullReviewTrace(shot);
    const app = createApp({ llm: provider(cleanReview()) });
    const request = (body: unknown) => app.request("/api/review", { method: "POST", body: JSON.stringify(body) });
    const res = await request({ ...shot, points, fullTrace });
    expect(res.status).toBe(200);
    const result = await res.json();
    expect(result.evidence).toEqual(rulesReviewResult(shot).evidence);
    expect(result.evidence.analysis.facts.peakPressureBar).toBe(5.2);
    expect(result.evidence.history.curves.phase).toMatchObject({ peakPressureBar: 5.2, peakPhaseElapsedS: crest.t });
    expect((await request({ ...shot, points, fullTrace: { ...fullTrace, version: 999 } })).status).toBe(400);
    expect((await request({ ...shot, points, doseG: 22, fullTrace })).status).toBe(400);
    const boundedOnly = await request({ ...shot, points });
    expect((await boundedOnly.json()).evidence.analysis.facts.peakPressureBar).toBe(3.6);
  });

  it("accepts an older skin without evidence fields and treats null history as absent", async () => {
    const app = createApp({ llm: provider(cleanReview()) });
    const legacy = input({ points: [point(0), point(0.25), point(0.5)] });
    const res = await app.request("/api/review", { method: "POST", body: JSON.stringify({ ...legacy, history: null }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ evidence: { version: 1, history: { status: "none", curves: { usableCount: 0 } },
      analysis: { facts: { phaseEvidence: { scaleClock: { value: "machine_timestamps_only" },
        finish: { volumeCountStartFrame: { value: null }, annotatedYieldG: { value: null, reason: "annotation_provenance_not_available" } } } } } } });
  });

  it("bounds per-phase prompt facts when the recorded frame changes on every sample", async () => {
    const shot = reviewFixture("high-flow-tracked");
    shot.points = shot.points.filter(p => p.frame !== 4).map((p, i) => ({ ...p, frame: i % 2 }));
    let prompt = "";
    await reviewShot(provider(value => { prompt = value; return cleanReview(); }), shot);
    const facts = JSON.parse(prompt.split("SHOT FACTS (measured by code from every sample; null means not measured):\n")[1].split("\n\n")[0]);
    expect(facts.phaseEvidence.phases.length + facts.phaseEvidence.omittedPhaseCount).toBe(shot.points.length);
    expect(facts.phaseEvidence.phases.length).toBe(12);
    expect(facts.phaseEvidence.finish.lastObservedPhase.value.toS).toBe(21);
  });

  it("asks for missing taste and never asks again when both taste ratings were supplied", async () => {
    const missing = await reviewShot(provider(cleanReview({ askTaste: false })), input());
    expect(missing.review.askTaste).toBe(true);
    const rated = await reviewShot(provider(cleanReview({ askTaste: true })), input({
      feedback: { sourBitter: -1, body: 0, enjoyment: null, notes: null },
    }));
    expect(rated.review.askTaste).toBe(false);
  });

  it("rejects unsupported profile switches and multi-change model advice", async () => {
    for (const nextShot of [
      { change: "Switch profile", grindDelta: "same", yieldDeltaG: 0, tempDeltaC: 0, switchProfile: "Not installed", reasoning: "test" },
      { change: "Change two things", grindDelta: "finer", yieldDeltaG: 1, tempDeltaC: 0, switchProfile: null, reasoning: "test" },
    ]) {
      const result = await reviewShot(provider(cleanReview({ nextShot })), input());
      expect(result.source).toBe("rules");
    }
  });

  it("does not accept an unsupported change without taste or a finding", async () => {
    const advice = { change: "Grind finer", grindDelta: "finer", yieldDeltaG: 0, tempDeltaC: 0, switchProfile: null, reasoning: "test" };
    const clean = input({
      points: Array.from({ length: 21 }, (_, t) => ({ ...point(t), f: 2, tf: 2, tp: null, p: 6 })),
      profile: { title: "Installed profile", steps: [{ pump: "flow", flow: "2", seconds: "30" }] },
    });
    const result = await reviewShot(provider(cleanReview({ nextShot: advice })), clean);
    expect(result.source).toBe("rules");
    expect(result.review.nextShot).toBeNull();
  });

  it("requires a grounded note quote for notes-only advice and keeps it private", async () => {
    const advice = { change: "Grind finer", grindDelta: "finer", yieldDeltaG: 0, tempDeltaC: 0, switchProfile: null, reasoning: "You reported a sour taste. Try one small finer step at the same dose and yield, then taste for less sharpness." };
    const clean = input({
      points: Array.from({ length: 21 }, (_, t) => ({ ...point(t), p: 8, tp: 8 })),
      profile: { title: "Installed profile", steps: [{ pump: "pressure", pressure: "8", seconds: "30" }] },
      notes: "It tasted sharp and sour.",
    });
    for (const notesEvidence of [null, "It tasted bitter."]) {
      const rejected = await reviewShot(provider(cleanReview({ nextShot: advice, notesEvidence })), clean);
      expect(rejected.source).toBe("rules");
      expect(rejected.review.nextShot).toBeNull();
    }
    const accepted = await reviewShot(provider(cleanReview({ nextShot: advice, notesEvidence: "sharp and sour", notesTaste: "sour" })), clean);
    expect(accepted.source).toBe("mock");
    expect(accepted.review.nextShot?.grindDelta).toBe("finer");
    expect(accepted.review).not.toHaveProperty("notesEvidence");
    expect(accepted.review).not.toHaveProperty("notesTaste");
    const switched = { ...advice, grindDelta: "same", switchProfile: "Installed profile" };
    expect((await reviewShot(provider(cleanReview({ nextShot: switched, notesEvidence: "sharp and sour", notesTaste: "sour" })), clean)).source).toBe("rules");
  });

  it("abstains when a grounded taste note opposes the curve instead of falling back to the opposite move", async () => {
    const shot = input({
      points: Array.from({ length: 26 }, (_, t) => ({ ...point(t), p: 8, tp: 8, f: 0.2 })),
      profile: { title: "Installed profile", steps: [{ pump: "pressure", pressure: "8", seconds: "30" }] },
      notes: "It tasted sharply sour.",
    });
    const advice = { change: "Grind finer", grindDelta: "finer", yieldDeltaG: 0, tempDeltaC: 0, switchProfile: null, reasoning: "The notes report a sour taste." };
    const result = await reviewShot(provider(cleanReview({ nextShot: advice, confidence: "high", notesEvidence: "sharply sour", notesTaste: "sour" })), shot);
    expect(result.source).toBe("mock");
    expect(result.review.issues.map(i => i.kind)).toContain("choked");
    expect(result.review.nextShot).toBeNull();
    expect(result.review.confidence).toBe("low");
    expect(result.review.summary).toMatch(/opposite.*Repeat/);
    const curveMove = { ...advice, change: "Grind coarser", grindDelta: "coarser" };
    const ignoresTaste = await reviewShot(provider(cleanReview({ nextShot: curveMove, confidence: "high", notesEvidence: "sharply sour", notesTaste: "sour" })), shot);
    expect(ignoresTaste.review.nextShot).toBeNull();
  });

  it("allows finer or coarser grind advice without taste when timing or target shortfall supports it", async () => {
    const advice = { change: "Grind finer", grindDelta: "much-finer", yieldDeltaG: 0, tempDeltaC: 0, switchProfile: null, reasoning: "Pressure fell short of target." };
    const shortfall = input({
      points: Array.from({ length: 21 }, (_, t) => ({ ...point(t), p: 3.8, tp: 6, f: 2.2, tf: null })),
      profile: { title: "Installed profile", beverage_type: "espresso", steps: [{ pump: "pressure", pressure: "6", seconds: "30", limiter: { value: "2.2" } }] },
    });
    const accepted = await reviewShot(provider(cleanReview({ nextShot: advice })), shortfall);
    expect(accepted.source).toBe("mock");
    expect(accepted.review.nextShot?.grindDelta).toBe("much-finer");

    const wrongWay = { ...advice, change: "Grind coarser", grindDelta: "coarser" };
    const rejected = await reviewShot(provider(cleanReview({ nextShot: wrongWay })), shortfall);
    expect(rejected.source).toBe("rules");
    expect(rejected.review.nextShot?.grindDelta).toBe("finer");
  });

  it("preserves every selected deterministic finding when the model omits it", async () => {
    const points = Array.from({ length: 21 }, (_, t) => ({ ...point(t), f: 0.5, tf: 2, tp: null, p: 6 }));
    const shot = input({ points, profile: { title: "Installed profile", steps: [{ pump: "flow", flow: "2", seconds: "30" }] } });
    const result = await reviewShot(provider(cleanReview()), shot);
    expect(result.source).toBe("mock");
    expect(result.review.issues.map((i: { kind: string }) => i.kind)).toContain("choked");
  });

  it("does not accept physical adjustments for an unknown or manual profile", async () => {
    const advice = { change: "Shorten yield", grindDelta: "same", yieldDeltaG: -3, tempDeltaC: 0, switchProfile: null, reasoning: "test" };
    for (const profile of [null, { title: "Manual", beverage_type: "manual" }]) {
      const result = await reviewShot(provider(cleanReview({ nextShot: advice })), input({
        profile, feedback: { sourBitter: 0, body: -1, enjoyment: 5, notes: null },
      }));
      expect(result.source).toBe("rules");
    }
  });

  it("ignores model-supplied findings and uses only computed ranges", async () => {
    const points = Array.from({ length: 21 }, (_, t) => ({ ...point(t), f: 0.5, tf: 2, tp: null, p: 6 }));
    const shot = input({ points, profile: { title: "Installed profile", steps: [{ pump: "flow", flow: "2", seconds: "30" }] } });
    const injected = cleanReview({ issues: [{ kind: "choked", what: "Bad shot", evidence: "Observed at 400 s", severity: "warning", fromS: 400, toS: 401 }] });
    const result = await reviewShot(provider(injected), shot);
    expect(result.source).toBe("mock");
    expect(result.review.issues[0].fromS).toBe(2);
    expect(result.review.issues[0].toS).toBe(20);
  });

  it("accepts Decaid's -1 'no target' and a cup bump instead of rejecting the review", async () => {
    // A de1app import records -1 for the pump not in control; a tare mid-shot reads -124 g.
    const points = Array.from({ length: 21 }, (_, t) => ({ ...point(t), tp: t < 10 ? -1 : 6, tf: t < 10 ? 4 : -1, w: t === 12 ? -124.19 : t }));
    const app = createApp({ llm: new ProviderChain(["mock"]) });
    const res = await app.request("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input({ points, yieldG: -124.19 })) });
    expect(res.status).toBe(200);
    const parsed = ReviewBody.parse(input({ points, yieldG: -124.19 }));
    expect(parsed.points[0]).toMatchObject({ tp: null, tf: 4 });
    expect(parsed.points[12].w).toBe(-6);
    expect(parsed.yieldG).toBeNull();
  });

  it("keeps the model's description of a well-recorded shot that has no gradable step", async () => {
    // Long, steady telemetry on an unknown profile: nothing to grade, plenty to describe.
    const points = Array.from({ length: 120 }, (_, i) => ({ ...point(i / 4), substate: i < 8 ? "preinfusion" : "pouring" }));
    let prompt = "";
    const summary = "30 s shot, 36 g from 18 g (1:2.0). Pressure held near 8 bar throughout.";
    const result = await reviewShot(provider((p: string) => { prompt = p; return cleanReview({ summary, confidence: "high" }); }), input({ points }));
    expect(result.review.summary).toBe(summary);
    expect(result.review.wentWell).toEqual(["Pressure stayed near target."]);
    expect(result.review.confidence).toBe("low");
    const facts = JSON.parse(prompt.split("SHOT FACTS (measured by code from every sample; null means not measured):\n")[1].split("\n")[0]);
    expect(facts).toMatchObject({ gradedWindows: 0, doseG: 18, yieldG: 36, ratio: 2, preinfusionS: 1.8 });
    expect(facts.weightGlitches).toBeUndefined();
  });

  it("replaces the model's narrative when the shot has too few samples to describe", async () => {
    const result = await reviewShot(provider(cleanReview({ confidence: "high" })), input());
    expect(result.review.summary).toMatch(/^This recording is too short or sparse/);
    expect(result.review.wentWell).toEqual([]);
    expect(result.review.confidence).toBe("low");
  });

  it("validates malformed and oversized requests at the API boundary", async () => {
    const app = createApp({ llm: new ProviderChain(["mock"]) });
    const post = (body: string, headers: Record<string, string> = {}) => app.request("/api/review", {
      method: "POST", headers: { "content-type": "application/json", ...headers }, body,
    });
    expect((await post(JSON.stringify({ points: [], profile: null }))).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect((await post("{}", { "content-length": "1000001" })).status).toBe(413);
  });

  it("distinguishes no recording from a recorded early stop", async () => {
    const empty = await reviewShot(provider(cleanReview()), input({ points: [] }));
    expect(empty.review.summary).toMatch(/^No shot curve was recorded/);
    const early = await reviewShot(provider(cleanReview()), input({ points: Array.from({ length: 25 }, (_, i) => point(i / 4)), yieldG: 4, stopReason: "apiStop" }));
    expect(early.review.summary).toMatch(/stopped early.*full repeat/);
    expect(early.review.summary).not.toMatch(/No.*curve.*recorded/);
    const manual = await reviewShot(provider(cleanReview()), input({ points: Array.from({ length: 25 }, (_, i) => point(i / 4)), profile: { title: "Manual", beverage_type: "manual" }, targetYieldG: 0, yieldG: 4, stopReason: "apiStop" }));
    expect(manual.review.summary).toMatch(/short or sparse/);
    expect(manual.review.summary).not.toMatch(/stopped early/);
  });

  it("accepts older clients and bounds the optional recorded history metadata", () => {
    expect(ReviewBody.safeParse(input()).success).toBe(true);
    const history = { timestamp: "2026-11-01T00:00:00Z", durationS: 30, grinderSetting: "E-3", tempC: 92, profileShape: "recorded-shape" };
    expect(ReviewBody.safeParse({ ...input(), history }).success).toBe(false);
    expect(ReviewBody.safeParse(input({ history: [history] })).success).toBe(true);
    for (const bad of [{ durationS: 601 }, { durationS: -1 }, { tempC: 151 }, { grinderSetting: "x".repeat(121) }, { profileShape: "x".repeat(20001) }]) {
      expect(ReviewBody.safeParse(input({ history: [{ ...history, ...bad }] })).success).toBe(false);
    }
    expect(ReviewBody.safeParse({ ...input(), timestamp: "x".repeat(81) }).success).toBe(false);
  });
});
