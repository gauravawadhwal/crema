import { readdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "vitest";
import { EVALS_DIR } from "../evals/lib/dataset.js";
import { generateGymDataset, readGymScenarios } from "../evals/lib/gym/dataset.js";
import { GYM_GENERATOR_VERSION } from "../evals/lib/gym/random.js";
import type { GymScenario } from "../evals/lib/gym/scenario.js";
import { loadIndependentReviewDataset } from "../evals/lib/review-independent.js";

function readScenarioTree(directory: string): GymScenario[] {
  const children = readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory());
  return [...readGymScenarios(directory), ...children.flatMap(entry => readScenarioTree(join(directory, entry.name)))];
}

// Both entry points run validateReviewLabels against each recording's sampled clock.
test("validates the merged gym corpus across eight seeds", () => {
  const scenarios = readScenarioTree(join(EVALS_DIR, "fixtures", "review-gym"));
  const seeds = 8;
  const { cases } = generateGymDataset({ generatorVersion: GYM_GENERATOR_VERSION, scenarios, seeds });
  expect(cases).toHaveLength(scenarios.length * seeds);
});

test("validates every independent recording with its label sidecar", () => {
  const { cases } = loadIndependentReviewDataset();
  expect(cases.length).toBeGreaterThan(0);
});
