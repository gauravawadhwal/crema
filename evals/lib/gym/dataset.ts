import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ReviewBody } from "../../../server/schema.js";
import { loadReviewDataset } from "../review-holdout.js";
import { SyntheticReviewLabels } from "../review-labels.js";
import { GYM_GENERATOR_VERSION } from "./random.js";
import { recordGymShot } from "./recording.js";
import { gymSteps, GymScenario } from "./scenario.js";

export const SeedCount = z.number().int().min(1).max(256);
export const GymReplay = z.strictObject({
  generatorVersion: z.literal(GYM_GENERATOR_VERSION),
  seeds: SeedCount,
  scenarios: z.array(GymScenario).min(1),
}).transform(({ scenarios, ...metadata }) => ({
  ...metadata,
  // Save the resolved plan so edits to Crema's outline catalog do not change
  // the meaning of an already recorded replay.
  scenarios: scenarios.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map((scenario) => ({ ...scenario, profile: { ...scenario.profile, steps: gymSteps(scenario) } })),
}));

export function readGymScenarios(directory: string) {
  return readdirSync(directory).filter((file) => file.endsWith(".json")).sort().map((file) => {
    try {
      return GymScenario.parse(JSON.parse(readFileSync(join(directory, file), "utf8")));
    } catch (error) {
      throw new Error(`Invalid scenario ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

export function generateGymDataset(replay: z.input<typeof GymReplay>) {
  const { seeds, scenarios } = GymReplay.parse(replay);
  const cases = scenarios.flatMap((scenario) => {
    const modes = new Set(scenario.profile.steps.map((step) => step.pump));
    const pumpMode = modes.size > 1 ? "mixed" : [...modes][0];
    const { observations, figures, supportedOutcomes, forbiddenClaims } = scenario.grading;
    const labels = SyntheticReviewLabels.parse({
      source: "synthetic-injected",
      injection: scenario.interventions.map((i) => i.kind).join(", ") || "none",
      observations, figures, supportedOutcomes, forbiddenClaims,
    });
    return Array.from({ length: seeds }, (_, seed) => {
      const id = `${scenario.id}.s${seed}`;
      const input = ReviewBody.parse(recordGymShot(scenario, seed));
      for (const label of labels.observations) {
        const timing = label.timing;
        if (!timing || timing.type !== "raw-landmark") continue;
        for (const [lo, hi] of [timing.onsetS, ...(timing.peakS ? [timing.peakS] : [])]) {
          if (!input.points.some(({ t }) => t >= lo && t <= hi)) {
            throw new Error(`${id}: ${label.id} has no recorded sample in [${lo}, ${hi}] s`);
          }
        }
      }
      return { id, session: scenario.session, recipe: scenario.recipe, profileFamily: scenario.family,
        pumpMode, split: scenario.split, input, labels };
    });
  });
  const dataset = { id: `synthetic-shot-gym-v${GYM_GENERATOR_VERSION}`, demonstration: false, cases };
  // The merged loader checks the exact wire shape, label IDs, and both split keys.
  loadReviewDataset(dataset);
  return dataset;
}

export const gymJson = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
