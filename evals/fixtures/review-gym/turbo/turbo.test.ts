import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { PhaseLandmark } from "../../../../server/profiles/phase-evidence.js";
import { fullReviewTrace } from "../../../../server/recommend/review-evidence.js";
import { generateGymDataset, readGymScenarios } from "../../../lib/gym/dataset.js";
import { GYM_GENERATOR_VERSION } from "../../../lib/gym/random.js";
import { scoreReview, type ReviewEvalOutput, type ReviewEvent } from "../../../lib/review-metrics.js";

const scenarios = readGymScenarios(fileURLToPath(new URL(".", import.meta.url)));
const { cases } = generateGymDataset({ scenarios, seeds: 8, generatorVersion: GYM_GENERATOR_VERSION });

const mean = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;

test("Turbo pairs separate a hidden flow cap, restriction, weight stop and scale loss", () => {
  assert.equal(cases.length, 48);
  for (const { id, input, labels } of cases) {
    const landmarks: PhaseLandmark[] = [];
    const { analysis } = fullReviewTrace(input, landmarks);
    const { points } = input;
    const last = points.at(-1)!;
    const samples = points.map(({ t }) => t);
    const events: ReviewEvent[] = landmarks.map(({ kind, t, at }) => ({
      kind, onsetS: t, phase: at?.substate ?? undefined,
    }));
    events.push(...analysis.issues.map(({ kind, fromS }) => ({
      kind, onsetS: fromS ?? undefined, phase: points.find(({ t }) => t === fromS)?.substate ?? undefined,
    })));
    const figures: ReviewEvalOutput["figures"] = [];
    const hold = points.filter(({ t, frame }) => t >= 9 && t <= 11 && frame === 1);
    const holdPressure = mean(hold.flatMap(({ p }) => p ?? []));
    const holdInlet = mean(hold.flatMap(({ f }) => f ?? []));
    assert.equal(input.stopReason, "targetWeight", id);
    assert.ok(hold.length >= 5, id);

    if (id.startsWith("turbo-flat-hidden-cap.")) {
      // The legacy issue extractor skips Turbo. Check the observable pressure
      // deficit against the live command and the simultaneous inlet plateau.
      const underCommand = points.find(({ t, p, f, tp, frame }) =>
        frame === 1 && t > 6 && p != null && f != null && tp != null && tp - p >= 0.7 && f <= 2.66);
      assert.ok(underCommand, id);
      events.push({ kind: "pressure_shortfall", onsetS: underCommand.t, phase: "pouring", controlledVariable: "pressure" });
      figures.push(
        { id: "pressure_shortfall.frame-2.target", value: underCommand.tp!, unit: "bar" },
        { id: "pressure_shortfall.frame-2.measured", value: holdPressure, unit: "bar" },
        { id: "pour.inlet-plateau", value: holdInlet, unit: "ml/s" },
      );
      assert.ok(holdPressure < 4.4 && hold.every(({ f }) => f == null || f === 2.65), id);
    }
    if (id.startsWith("turbo-flat-restriction.")) {
      assert.ok(holdPressure > 5.1 && holdPressure < 5.3 && holdInlet > 2.3 && holdInlet < 2.6, id);
    }
    if (id.startsWith("turbo-taper-early-stop.")) {
      assert.equal(input.targetYieldG, 28, id);
      assert.ok(last.frame === 2 && last.tp! > 5.15 && Math.abs(last.p! - last.tp!) < 0.1, id);
    }
    if (id.startsWith("turbo-taper-scale-dropout.")) {
      const lastScale = points.findLastIndex(({ w }) => w != null);
      const dropout = points[lastScale + 1];
      assert.ok(lastScale >= 0 && dropout && dropout.t >= 7 && dropout.t <= 7.45, id);
      events.push({ kind: "scale_gap", onsetS: dropout.t });
      assert.equal(input.yieldG, null, id);
      assert.ok(last.p != null && last.f != null && last.tp != null, id);
      assert.ok(Math.abs(last.p - last.tp) < 0.1, id);
    }
    if (id.includes("-nominal.")) {
      assert.equal(labels.injection, "none", id);
      assert.ok(holdPressure >= 5.1 && holdPressure <= 5.5 && holdInlet >= 3.2 && holdInlet <= 4, id);
    }

    const output: ReviewEvalOutput = {
      events, figures, outcomes: [],
      claims: { "inferred-taste": false, "unqualified-diagnosis": false },
    };
    const scored = scoreReview(labels, output, samples);
    assert.deepEqual(scored.events.filter(({ matched }) => !matched), [], id);
    assert.ok(scored.figures.every(({ pass }) => pass), id);
    assert.deepEqual(scored.forbiddenHits, [], id);
    assert.equal(scored.justifiedAbstention, true, id);

    const badReview = scoreReview(labels, {
      events: [{ kind: "fast_shot" }, { kind: "channeling" }, { kind: "flow_shortfall", phase: "pouring" }],
      figures: figures.map(figure => ({ ...figure, unit: figure.unit === "bar" ? "ml/s" : "bar" })),
      outcomes: ["grind-finer"],
      claims: { "inferred-taste": true, "unqualified-diagnosis": true },
    }, samples);
    assert.ok(badReview.forbiddenHits.includes("generic-fast-fault"), id);
    assert.ok(badReview.forbiddenHits.includes("channeling-diagnosis"), id);
    assert.ok(badReview.forbiddenHits.includes("swapped-controller"), id);
    assert.ok(badReview.events.every(({ matched }) => !matched), id);
    assert.ok(badReview.figures.every(({ pass }) => !pass), id);
    assert.ok(badReview.forbiddenClaims.every(({ present }) => present), id);
    assert.equal(badReview.supportedOutcome, false, id);
  }
});
