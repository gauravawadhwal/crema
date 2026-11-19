import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { INDEPENDENT_FIXTURES, loadIndependentReviewDataset } from "../evals/lib/review-independent.js";
import { assertCurveStageInvariant, mockCurveStage } from "../evals/lib/review-crossed.js";
import { scoreReview, type ReviewEvalOutput } from "../evals/lib/review-metrics.js";
import { analyzeShot } from "../server/profiles/analysis.js";
import type { PhaseLandmark } from "../server/profiles/phase-evidence.js";
import type { ReviewInput } from "../server/recommend/review-types.js";

const pairs = ["a", "b", "c", "d", "e", "f"];
const ids = pairs.flatMap((pair) => [pair + "1", pair + "2"]);
const dataset = loadIndependentReviewDataset();

test("loads every Decaid recording with strict synthetic labels and keeps pairs together", () => {
  expect(dataset.cases.map(c => c.id)).toEqual(ids);
  for (const { id, recipe, session, split, input, labels } of dataset.cases) {
    expect([session, recipe, split]).toEqual([id[0], id[0], "dev"]);
    expect(input.points.length).toBeGreaterThan(30);
    expect(input.points.every(({ t }, i) => t === i / 4)).toBe(true);
    expect([input.history, input.bean, input.feedback, input.notes]).toEqual([[], null, null, null]);
    expect(labels.source).toBe("synthetic-injected");
    if (labels.source !== "synthetic-injected") throw new Error(`Unexpected label source for ${id}`);
    for (const { timing } of labels.observations) {
      if (timing?.type !== "raw-landmark") continue;
      for (const [lo, hi] of [timing.onsetS, ...(timing.peakS ? [timing.peakS] : [])]) {
        expect(input.points.some(({ t }) => lo <= t && t <= hi)).toBe(true);
      }
    }
  }
});

test("regenerates every recording and label byte for byte with Python 3", () => {
  const scratch = mkdtempSync(join(tmpdir(), "crema-independent-"));
  try {
    const script = join(scratch, "author_cases.py");
    copyFileSync(join(INDEPENDENT_FIXTURES, "author_cases.py"), script);
    execFileSync("python3", [script]);
    for (const dir of ["recordings", "labels"]) {
      expect(readdirSync(join(scratch, dir)).sort()).toEqual(ids.map(id => `${id}.json`));
      for (const id of ids) {
        const relative = join(dir, `${id}.json`);
        expect(readFileSync(join(scratch, relative)).equals(readFileSync(join(INDEPENDENT_FIXTURES, relative))),
          relative).toBe(true);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

type RawRecording = {
  id?: string;
  stopReason?: string;
  annotations: { actualYield?: number };
  workflow: {
    profile: { target_weight?: number; steps: { pressure?: number }[] };
    context: { targetYield?: number };
  };
  measurements: {
    machine: { pressure?: number; flow?: number; targetPressure?: number };
    volume?: number;
    scale?: { weight?: number; weightFlow?: number } | null;
  }[];
};

function rawRecording(id: string): RawRecording {
  return JSON.parse(readFileSync(join(INDEPENDENT_FIXTURES, "recordings", `${id}.json`), "utf8"));
}

describe("matched recordings", () => {
  test.each(pairs)("%s preserves every field outside the consequences of its intervention", (pair) => {
    const nominal = rawRecording(pair + "1");
    const changed = rawRecording(pair + "2");
    expect([nominal.id, changed.id]).toEqual([pair + "1", pair + "2"]);
    delete nominal.id;
    delete changed.id;
    expect(changed).not.toEqual(nominal);
    for (const shot of [nominal, changed]) {
      if (pair !== "b") delete shot.annotations.actualYield;
      if (pair === "a") {
        // Puck resistance can change hydraulic response, accumulated inlet and cup mass.
        for (const row of shot.measurements) {
          delete row.machine.pressure;
          delete row.machine.flow;
          delete row.volume;
        }
      }
      if (pair === "b") {
        // Only the late pressure command and corresponding plan endpoints change.
        for (const step of shot.workflow.profile.steps.slice(2)) delete step.pressure;
        for (const row of shot.measurements.slice(16 * 4)) delete row.machine.targetPressure;
      }
      if (pair === "a" || pair === "e") {
        for (const { scale } of shot.measurements) {
          if (!scale) continue;
          delete scale.weight;
          delete scale.weightFlow;
        }
      }
      if (pair === "f") {
        delete shot.workflow.profile.target_weight;
        delete shot.workflow.context.targetYield;
      }
    }
    if (pair === "d") {
      for (const [i, row] of changed.measurements.entries()) {
        const clean = nominal.measurements[i];
        if (i >= 49 && i < 60) {
          expect(row.scale).toBeNull();
          clean.scale = null;
        } else if (i >= 60) {
          expect(row.scale?.weight).toBeLessThan(clean.scale!.weight!);
          delete row.scale!.weight;
          delete clean.scale!.weight;
        }
      }
    }
    if (pair === "f") {
      for (const shot of [rawRecording("f1"), rawRecording("f2")]) {
        const target = shot.workflow.context.targetYield!;
        expect(shot.stopReason).toBe("targetWeight");
        expect(shot.measurements.slice(0, -1).every(({ scale }) => scale?.weight != null && scale.weight < target)).toBe(true);
        expect(shot.measurements.at(-1)?.scale?.weight).toBeGreaterThanOrEqual(target);
      }
    }
    if (pair === "c" || pair === "f") {
      expect(nominal.measurements.length).toBeGreaterThan(changed.measurements.length);
      nominal.measurements.length = changed.measurements.length;
    }
    if (pair === "c") {
      expect([nominal.stopReason, changed.stopReason]).toEqual(["machineEnded", "apiStop"]);
      delete nominal.stopReason;
      delete changed.stopReason;
    }
    expect(changed).toEqual(nominal);
  });
});

test("crossed taste preserves both mock curve routing paths", async () => {
  const long = dataset.cases.find(c => c.id === "f1")!.input;
  const short = dataset.cases.find(c => c.id === "f2")!.input;
  expect((await mockCurveStage(long)).input).not.toBeNull();
  expect((await mockCurveStage(short)).input).toBeNull();
  await assertCurveStageInvariant(long, mockCurveStage);
  await assertCurveStageInvariant(short, mockCurveStage);
});

// Project production facts and landmarks by meaning. The evidence decides what
// to emit; case labels supply the expected values and tolerances to scoreReview.
function productionObservables(pair: string, input: ReviewInput) {
  const landmarks: PhaseLandmark[] = [];
  const { facts } = analyzeShot(input, landmarks);
  const { phases, finish, scaleAvailability } = facts.phaseEvidence;
  const [first, second, third, fourth] = phases;
  const last = phases.at(-1);
  const boundary = landmarks.find(l => l.kind === "phase_boundary");
  const stop = landmarks.find(l => l.kind === "stop");
  const output: ReviewEvalOutput = { figures: [], events: [], outcomes: [], claims: {} };
  const figure = (id: string, unit: string, value: number | null | undefined) => {
    if (value != null) output.figures.push({ id, unit, value });
  };
  const event = (kind: string, controlledVariable: ReviewEvalOutput["events"][number]["controlledVariable"],
    phase: string | null | undefined, onsetS: number | undefined) => {
    output.events.push({ kind, controlledVariable, phase: phase ?? undefined, onsetS });
  };
  const weight = finish.lastRecordedWeightG.value;

  if (pair === "a") {
    const hold = second.steadyHold.value;
    if (hold) {
      figure("hold-mean-flow", "mL/s", hold.meanResponse);
      figure("hold-mean-pressure", "bar", hold.otherMean);
      figure("hold-flow-deficit", "mL/s", hold.meanCommand - hold.meanResponse);
    }
    figure("terminal-weight", "g", weight);
  }
  if (pair === "b") {
    const terminal = fourth.pressureBar.value?.last;
    const plateau = second.steadyHold.value?.meanResponse;
    figure("terminal-pressure", "bar", terminal);
    if (plateau != null && terminal != null) figure("measured-decline-magnitude", "bar", plateau - terminal);
    if (third.purpose.value === "decline" && (third.controlledError.value?.absoluteMean ?? Infinity) < 0.1) {
      event("decline-matches-command", "pressure", third.substate, third.fromS);
    }
  }
  if (pair === "c") {
    const threshold = first.plan.value?.exit?.value;
    const before = boundary?.before;
    const after = boundary?.after;
    figure("configured-exit-threshold", "bar", threshold == null ? null : Number(threshold));
    figure("handoff-bracket-lower-pressure", "bar", before?.p);
    figure("handoff-bracket-upper-pressure", "bar", after?.p);
    figure("handoff-bracket-lower-time", "s", before?.t);
    figure("handoff-bracket-upper-time", "s", after?.t);
    figure("last-frame-reached", "frame", finish.lastObservedPhase.value?.frame);
    figure("stop-time", "s", stop?.t);
    if (first.mode.value === "pressure" && second.mode.value === "flow" &&
        before?.p != null && after?.p != null && before.p < Number(threshold) && Number(threshold) < after.p) {
      event("flow-mode-handoff-bracket-consistent-with-configured-threshold", "pressure", second.substate, after.t);
    }
    if (last?.frame === (input.profile?.steps?.length ?? 0) - 1 &&
        last.durationS >= (last.plan.value?.maximumS ?? Infinity) && stop?.detail === "machineEnded") {
      event("final-frame-completed", "time", last.substate, stop.t);
    }
    if (stop && finish.unobservedPlanPhases.value?.some(p => p.status === "not_observed_before_recording_ended")) {
      event("terminal-stop-before-final-frame", "time", last?.substate, stop.t);
    }
  }
  if (pair === "d") {
    const missing = input.points.length - scaleAvailability.weightSamples;
    figure("scale-null-samples", "samples", missing);
    if (missing === 0) {
      figure("scale-coverage-start", "s", facts.brewStartS);
      figure("scale-coverage-end", "s", facts.brewEndS);
      figure("terminal-scale-indication", "g", weight);
      event("scale-continuous-whole-shot", "yield", null, facts.brewStartS ?? undefined);
    }
  }
  if (pair === "e") {
    if (second.purpose.value === "bloom_or_pause" && second.loggedCommand.value?.last === 0) {
      event("zero-flow-pause", "flow", second.substate, second.fromS);
      figure("pause-cup-gain", "g", second.cupGainG.value);
    }
    // Exercise the timing difference between first visible mass and sustained flow.
    figure("first-cup-time", "s", facts.firstDripsS);
    figure("terminal-weight", "g", weight);
  }
  if (pair === "f") {
    const target = facts.targetYieldG;
    figure("target-weight", "g", target);
    figure("terminal-weight", "g", weight);
    if (weight != null && target != null) figure("target-overshoot", "g", weight - target);
    figure("terminal-frame", "frame", finish.lastObservedPhase.value?.frame);
    figure("terminal-time", "s", stop?.t);
    if (stop?.detail === "targetWeight") event("target-weight-stop", "yield", last?.substate, stop.t);
    if (last && last.frame === (input.profile?.steps?.length ?? 0) - 1) {
      event("planned-final-phase-reached", "time", last.substate, last.fromS);
    }
    if (stop && finish.unobservedPlanPhases.value?.some(p => p.status === "preempted_by_weight_stop")) {
      event("target-truncates-plan", "time", last?.substate, stop.t);
    }
  }
  return output;
}

describe("production evidence against independent labels", () => {
  test("distinguishes tracked high flow from flow short of command at the cap", () => {
    const holds = dataset.cases.filter(c => c.session === "a")
      .map(c => analyzeShot(c.input).facts.pourSteps.find(step => step.steadyTarget));
    expect(holds.map(hold => hold?.limiterEngaged)).toEqual([false, true]);
  });

  test("documents the scale gap that still lacks a production landmark", () => {
    const { input } = dataset.cases.find(c => c.id === "d2")!;
    const landmarks: PhaseLandmark[] = [];
    const { facts } = analyzeShot(input, landmarks);
    expect(landmarks.filter(l => l.kind === "scale_gap" || l.kind === "weight_jump")).toEqual([]);
    expect(facts.phaseEvidence.finish.annotatedYieldG.value).toBeNull();
    expect(facts.yieldG).toBe(facts.phaseEvidence.finish.lastRecordedWeightG.value);
  });

  test.each(dataset.cases)("$id preserves the documented coverage and tolerances", ({ id, input, labels }) => {
    const score = scoreReview(labels, productionObservables(id[0], input), input.points.map(({ t }) => t));
    expect(score.forbiddenHits).toEqual([]);
    // Exact baseline of misses. Fixes that close gaps should update this report
    // and design.md while retaining the independently authored labels.
    expect({
      observations: score.events.filter(event => !event.matched).map(event => event.id),
      figures: score.figures.filter(figure => !figure.pass).map(figure => figure.id),
    }).toMatchSnapshot();
  });
});
