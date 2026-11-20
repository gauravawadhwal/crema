import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fullReviewTrace } from "../../../../server/recommend/review-evidence.js";
import type { PhaseLandmark } from "../../../../server/profiles/phase-evidence.js";
import { generateGymDataset, readGymScenarios } from "../../../lib/gym/dataset.js";
import { GYM_GENERATOR_VERSION } from "../../../lib/gym/random.js";
import { scoreReview, type ReviewEvalOutput } from "../../../lib/review-metrics.js";

const scenarios = readGymScenarios(fileURLToPath(new URL(".", import.meta.url)));
const { cases } = generateGymDataset({ scenarios, seeds: 8, generatorVersion: GYM_GENERATOR_VERSION });

test("flow-limiter labels match sampled events and reject swapped roles and diagnoses", () => {
  assert.equal(cases.length, 48);
  for (const { id, input, labels } of cases) {
    const landmarks: PhaseLandmark[] = [];
    const { analysis } = fullReviewTrace(input, landmarks);
    const samples = input.points.map((point) => point.t);
    const pour = input.profile?.steps?.[1];
    assert.ok(pour?.pump === "flow" && pour.flow && pour.limiter, id);
    const reviewIssues = analysis.issues.map(({ kind, fromS }) => ({
      kind, onsetS: fromS ?? undefined,
      phase: input.points.find(({ t }) => t === fromS)?.substate ?? undefined,
      controlledVariable: kind === "pressure_shortfall" ? "pressure" as const : "flow" as const,
    }));
    const output: ReviewEvalOutput = {
      events: [
        ...landmarks.filter(({ kind }) => ["cap_like_start", "first_sustained_beverage", "stop"].includes(kind))
          .map(({ kind, t, at, after }) => ({ kind, onsetS: t, phase: (at ?? after)?.substate ?? undefined, controlledVariable: "flow" as const })),
        ...reviewIssues,
      ],
      figures: [
        { id: "pour.inlet-command", unit: "ml/s", value: Number(pour.flow) },
        { id: "pour.pressure-ceiling", unit: "bar", value: Number(pour.limiter.value) },
      ],
      outcomes: [],
      claims: { "unqualified-diagnosis": false, "inferred-taste": false },
    };
    const scored = scoreReview(labels, output, samples);
    assert.ok(scored.events.every((event) => event.matched), id);
    assert.ok(scored.figures.every((figure) => figure.pass), id);
    assert.equal(scored.forbiddenHits.length, 0, id);
    assert.equal(scored.justifiedAbstention, true, id);

    if (scored.figures.length) {
      const [flow, ceiling] = output.figures;
      const swapped = scoreReview(labels, {
        ...output,
        events: output.events.map((event) => ({ ...event, controlledVariable: "pressure" })),
        figures: [{ ...flow, value: ceiling.value, unit: ceiling.unit }, { ...ceiling, value: flow.value, unit: flow.unit }],
        claims: { "unqualified-diagnosis": true, "inferred-taste": true },
      }, samples);
      assert.equal(swapped.events.find((event) => event.id === "cap-entry")?.matched, false, id);
      assert.ok(swapped.figures.every((figure) => !figure.pass), id);
      assert.ok(swapped.forbiddenClaims.every((claim) => claim.present), id);
    }

    if (id.startsWith("flow-limiter-early-weight-stop.")) {
      assert.equal(input.stopReason, "targetWeight", id);
      assert.ok(input.points.every((point) => point.frame !== 2), id);
      assert.equal(analysis.facts.phaseEvidence.phases.length, 2, id);
    }
  }
});
