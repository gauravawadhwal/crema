import { readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { EVALS_DIR, loadCases } from "../dataset.js";
import { generateGymDataset, readGymScenarios } from "../gym/dataset.js";
import { GYM_GENERATOR_VERSION } from "../gym/random.js";
import { reviewFixture } from "../review-fixtures.js";
import { loadReviewDataset } from "../review-holdout.js";
import { digest } from "./candidate.js";
import type { IterationCase } from "./score.js";

export const CasePolicy = z.strictObject({
  nominal: z.boolean().optional(),
  gap: z.enum(["scale", "pressure", "flow", "temperature", "profile", "history"]).optional(),
});
export const CasePolicies = z.record(z.string(), CasePolicy);

export function syntheticPanel(rows: ReturnType<typeof loadReviewDataset>["cases"], policies: z.infer<typeof CasePolicies>) {
  const ids = new Set(rows.map(row => row.id));
  for (const id of Object.keys(policies)) if (!ids.has(id)) throw new Error("Case policy refers to an absent case");
  return rows.map<IterationCase>(c => ({
    id: c.id, family: c.profileFamily, session: c.session, recipe: c.recipe, template: c.id.replace(/\.s\d+$/, ""),
    hash: digest([c.hash, policies[c.id]]), input: c.input, fullTrace: c.fullTrace, pumpMode: c.pumpMode, labels: c.labels, ...policies[c.id],
  }));
}

export function legacyDev() {
  return loadCases("review").filter(c => c.split === "dev").map<IterationCase>(c => {
    const input = reviewFixture(c.input.fixture);
    return { id: `legacy.${c.id}`, family: "legacy", session: c.input.fixture, recipe: c.input.fixture,
      template: c.input.fixture, hash: digest([c, input]), input, pumpMode: "unknown", legacy: c };
  });
}

export function seededDev(dirs: string[], seeds: number) {
  function readTree(dir: string): ReturnType<typeof readGymScenarios> {
    const subdirs = readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
    return [...readGymScenarios(dir), ...subdirs.flatMap(name => readTree(join(dir, name)))];
  }
  const scenarios = [join(EVALS_DIR, "fixtures/review-gym"), ...dirs].flatMap(readTree);
  if (scenarios.some(c => c.split !== "dev")) throw new Error("Dev generation received a holdout scenario");
  const dataset = generateGymDataset({ generatorVersion: GYM_GENERATOR_VERSION, seeds, scenarios });
  const byId = new Map(scenarios.map(s => [s.id, s]));
  const policies = Object.fromEntries(dataset.cases.map(c => {
    const scenario = byId.get(c.id.replace(/\.s\d+$/, ""))!;
    return [c.id, CasePolicy.parse({
      nominal: /(?:-nominal|-tracked)$/.test(scenario.id),
      gap: scenario.interventions.some(i => i.kind === "scale-loss") ? "scale" : undefined,
    })];
  }));
  return { dataset, policies };
}

export function assertIndependent(dev: IterationCase[], locked: IterationCase[]) {
  const trace = (c: IterationCase) => digest(c.input.points);
  const surfaces = [(c: IterationCase) => c.id, (c: IterationCase) => c.template,
    (c: IterationCase) => c.session, (c: IterationCase) => c.recipe, trace];
  for (const surface of surfaces) {
    const seen = new Set(dev.map(surface));
    if (locked.some(c => seen.has(surface(c)))) throw new Error("Locked panel shares a dev template, session, recipe or trace");
  }
  if (new Set(locked.map(trace)).size !== locked.length) throw new Error("Locked panel contains a reused trace");
}

export function templates(cases: IterationCase[]) {
  return new Set(cases.filter(c => !c.legacy).map(c => c.template)).size;
}
