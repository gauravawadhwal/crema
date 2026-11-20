import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fullReviewTrace } from "../../../../server/recommend/review-evidence.js";
import type { PhaseLandmark } from "../../../../server/profiles/phase-evidence.js";
import { generateGymDataset, readGymScenarios } from "../../../lib/gym/dataset.js";
import { simulateGymShot, TICK_MS } from "../../../lib/gym/kernel.js";
import { GYM_GENERATOR_VERSION } from "../../../lib/gym/random.js";
import { scoreReview, type ReviewEvalOutput } from "../../../lib/review-metrics.js";

const scenarios = readGymScenarios(fileURLToPath(new URL(".", import.meta.url)));
const seeds = 8;
const { cases } = generateGymDataset({ scenarios, seeds, generatorVersion: GYM_GENERATOR_VERSION });

test("Adaptive handoffs and finish labels follow sampled frames, including missing scale", () => {
  assert.equal(cases.length, 48);
  for (const scenario of scenarios) {
    let offSampleCrossings = 0;
    for (const { id, input, labels } of cases.filter(({ id }) => id.startsWith(`${scenario.id}.s`))) {
      const seed = Number(id.split(".s")[1]);
      const { ticks } = simulateGymShot(scenario, seed);
      const landmarks: PhaseLandmark[] = [];
      const { analysis } = fullReviewTrace(input, landmarks);
      const { phases, finish } = analysis.facts.phaseEvidence;
      const boundaries = landmarks.filter(({ kind }) => kind === "phase_boundary");
      const samples = input.points.map(({ t }) => t);
      const modeAt = (frame?: number | null) => frame == null ? undefined : scenario.profile.steps?.[frame]?.pump;
      assert.equal(labels.injection, scenario.interventions[0]?.kind ?? "none", id);
      assert.deepEqual(phases.slice(0, 3).map((phase) => phase.mode.value), ["flow", "pressure", "flow"], id);

      const exit = ticks.findIndex((tick) => tick.frame === 1) - 1;
      assert.ok(ticks[exit - 1].pressure <= 2 && ticks[exit].pressure > 2, id);
      const exitS = exit * TICK_MS / 1000;
      assert.ok(boundaries[0].before!.t <= exitS && exitS < boundaries[0].after!.t, id);
      if (!samples.includes(exitS)) offSampleCrossings++;

      const riseExit = scenario.profile.steps![1].exit;
      if (riseExit?.type === "flow" && riseExit.condition === "under") {
        const crossing = ticks.findIndex((tick) => tick.frame === 2) - 1;
        const crossingS = crossing * TICK_MS / 1000;
        assert.ok(ticks[crossing - 1].flow >= riseExit.value && ticks[crossing].flow < riseExit.value, id);
        assert.ok(boundaries[1].before!.t <= crossingS && crossingS < boundaries[1].after!.t, id);
      }

      const output: ReviewEvalOutput = {
        events: [
          ...landmarks.map(({ kind, t, at, before, after }) => ({
            kind, onsetS: t, controlledVariable: modeAt((at ?? after ?? before)?.frame),
          })),
          ...analysis.issues.map(({ kind, fromS }) => ({
            kind, onsetS: fromS ?? undefined, controlledVariable: modeAt(input.points.find(({ t }) => t === fromS)?.frame),
          })),
        ],
        figures: [],
        outcomes: [],
        claims: { "inferred-taste": false, "unqualified-diagnosis": false, "multiple-next-shot-changes": false },
      };

      assert.equal(input.stopReason, "targetWeight", id);
      if (finish.unobservedPlanPhases.value?.some(({ status }) => status === "preempted_by_weight_stop")) {
        assert.equal(finish.lastObservedPhase.value?.frame, 2, id);
        output.events.push({ kind: "unreached_final_phase", controlledVariable: "flow" });
      }

      if (scenario.interventions[0]?.kind === "scale-loss") {
        const [fill, handoff] = boundaries;
        assert.equal(handoff.before!.w, null, id);
        assert.equal(handoff.after!.w, null, id);
        const deadline = scenario.profile.steps![1].seconds;
        assert.ok(fill.before!.t + deadline <= handoff.after!.t && handoff.before!.t <= fill.after!.t + deadline, id);
      }
      if (scenario.interventions[0]?.kind === "sensor-lag") {
        assert.ok((boundaries[0].after?.p ?? Infinity) < 1, id);
      }

      const main = phases[2];
      const plan = main.plan.value!;
      if (main.capLikeTime.value?.shareOfCoveredTime === 1) {
        output.events.push({ kind: "cap_like_regime", onsetS: main.fromS, controlledVariable: "flow" });
      }
      const drop = input.points.find((point, i) => {
        const prev = input.points[i - 1];
        return point.frame === 2 && prev?.frame === 2 && point.tf === prev.tf &&
          (prev.f ?? 0) > 1.9 && (point.f ?? Infinity) < 1.55 && (point.p ?? Infinity) < 6.5;
      });
      if (drop) output.events.push({ kind: "inlet_flow_drop_at_held_command", onsetS: drop.t, controlledVariable: "flow" });
      const command = main.loggedCommand.value!;
      assert.ok(command.timeWeightedMean != null, id);
      output.figures.push(
        { id: "main.inlet-command", unit: main.controlledUnit!, value: command.timeWeightedMean },
        { id: "main.pressure-ceiling", unit: plan.limiter!.unit!, value: plan.limiter!.value },
      );

      const score = scoreReview(labels, output, samples);
      assert.deepEqual(score.events.filter(({ matched }) => !matched), [], id);
      assert.deepEqual(score.forbiddenHits, [], id);
      assert.ok(score.figures.every(({ pass }) => pass), id);
      assert.equal(score.justifiedAbstention, true, id);

      const [inlet, ceiling] = output.figures;
      const swapped = scoreReview(labels, {
        ...output,
        events: [...output.events, { kind: "channeling" }],
        figures: [{ ...ceiling, id: inlet.id }, { ...inlet, id: ceiling.id }],
        claims: { "inferred-taste": true, "unqualified-diagnosis": true },
      }, samples);
      assert.ok(swapped.figures.every(({ pass }) => !pass), id);
      assert.deepEqual(swapped.forbiddenHits, ["definite-channeling"], id);
      assert.ok(swapped.forbiddenClaims.filter(({ claim }) => claim !== "multiple-next-shot-changes").every(({ present }) => present), id);
    }
    assert.ok(offSampleCrossings > 0, scenario.id);
  }
});
