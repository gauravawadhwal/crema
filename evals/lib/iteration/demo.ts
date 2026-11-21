import { join } from "node:path";
import type { z } from "zod";
import { MockProvider } from "../../../server/llm/mock.js";
import type { StructuredRequest } from "../../../server/llm/types.js";
import { EVALS_DIR } from "../dataset.js";
import { generateGymDataset, readGymScenarios } from "../gym/dataset.js";
import { GYM_GENERATOR_VERSION } from "../gym/random.js";
import { freezeReviewHoldout, loadReviewDataset } from "../review-holdout.js";
import { Candidate, digest } from "./candidate.js";
import { lockedComparison } from "./locked.js";
import { syntheticPanel } from "./panel.js";
import { develop } from "./runner.js";
import { readJson, saveJson } from "./runtime.js";

const bad = Candidate.parse({ id: "summary-first", hypothesis: "Leading with the header will make the review easier to read.",
  change: { kind: "instruction", text: "Echo the dose and yield as the main takeaway." } });
const good = Candidate.parse({ id: "first-controlled-event", hypothesis: "Leading with the controlled variable will recover missed observations.",
  change: { kind: "instruction", text: "Name the clearest observed response to the active command first." } });

class IterationMock extends MockProvider {
  override async structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>> {
    if (req.schemaName === "GymProposal") return req.schema.parse({ candidates: [bad, good] });
    if (req.schemaName !== "CurveNarrative") return super.structured(req);
    const recorded = JSON.parse(req.prompt.split("\n").find(line => line.startsWith('{"recording"'))!);
    const dose = recorded.recording.facts.doseG as number;
    if (req.system.endsWith(bad.change.kind === "instruction" ? bad.change.text : "")) {
      return req.schema.parse({ interpretation: null });
    }
    const variant = req.system.endsWith(good.change.kind === "instruction" ? good.change.text : "");
    const text = dose === 18 || dose === 22 ? "First sustained beverage followed the fill phase."
      : variant && dose === 19 ? "Pressure stayed close to its cap under the flow command."
      : variant && (dose === 20 || dose === 24) ? "The planned pressure decline followed the rise."
      : dose === 21 || dose === 25 ? "Scale readings are unavailable."
      : null;
    const ids = Object.keys(recorded).filter(id => /^phase-\d+$/.test(id));
    const evidenceIds = text?.startsWith("First") ? ["first-sustained-gram"]
      : text?.startsWith("Pressure") ? ids.filter(id => recorded[id].capLikeTime?.value).slice(0, 4)
      : text?.startsWith("The planned") ? ids.filter(id => recorded[id].purpose?.value === "decline").slice(0, 4) : ["recording"];
    return req.schema.parse({ interpretation: text ? { text, evidenceIds } : null });
  }
}

export async function runDemonstration(dir: string, stop: string, commit: string, provider: "mock" | "rules") {
  const kernel = readGymScenarios(join(EVALS_DIR, "fixtures/review-gym"));
  const scenarios = ["allonge-tracked", "allonge-capped", "lever-commanded-decline", "allonge-tracked"]
    .map(id => kernel.find(c => c.id === id)!);
  const make = (split: "dev" | "holdout") => {
    const generated = generateGymDataset({ generatorVersion: GYM_GENERATOR_VERSION, seeds: 1,
      scenarios: scenarios.map((s, i) => ({
        ...s, id: `demo-${split}-${i}`, recipe: `demo-${split}-recipe-${i}`, session: `demo-${split}-session-${i}`, split,
        doseG: (split === "dev" ? 18 : 22) + i,
        profile: { ...s.profile, temperatureC: s.profile.temperatureC + (split === "holdout" ? 1 : 0) },
        interventions: i === 3 ? [...s.interventions, { kind: "scale-loss", atS: 0 }] : s.interventions,
        grading: { ...s.grading,
          observations: i === 3 ? [...s.grading.observations.filter(o => o.expected === "forbidden"),
            { id: "scale-unavailable", kind: "scale_readings_missing", expected: "required" }] : s.grading.observations,
          supportedOutcomes: undefined,
        },
      })),
    });
    return { ...generated, id: `loop-mechanics-${split}`, demonstration: true };
  };
  const dataset = make("dev");
  const policies = { "demo-dev-3.s0": { nominal: true, gap: "scale" as const } };
  const dev = syntheticPanel(loadReviewDataset(dataset).cases, policies);
  const mock = new IterationMock();
  const pins = { commit, scorer: "scripted-demo-v1", dataset: digest(dataset), subject: provider,
    judge: "none", proposer: "mock-demo-v1" };
  const run = { pins, dir, stop, subject: provider === "mock" ? mock : undefined, hardJudge: false, offline: true };
  const report = await develop(run, dev, dev, mock, digest(pins));
  let decision = "no nominee";
  if (report.finalist?.accepted) {
    const locked = make("holdout");
    const panel = join(dir, "demo-holdout.json");
    saveJson(panel, locked);
    const manifest = join(dir, "demo-manifest.json");
    freezeReviewHoldout(loadReviewDataset(locked), manifest);
    const lockedPolicies = { "demo-holdout-3.s0": { nominal: true, gap: "scale" } };
    const policyFile = join(dir, "demo-holdout-policy.json");
    saveJson(policyFile, lockedPolicies);
    decision = await lockedComparison({
      run, report, dev, panel, manifest, policies: policyFile, policiesDigest: digest(lockedPolicies),
      manifestDigest: digest(readJson(manifest)), nomination: digest(report), count: 4,
      beforeOpen: async () => {}, demonstration: true,
    });
  }
  const summary = { provider, tokens: 0, screen: report.screens.map(result => ({
    candidate: result.candidate.id, passed: result.accepted, failures: result.failures,
  })), dev: report.finalist?.accepted ? report.finalist.candidate.id : null, locked: decision };
  saveJson(join(dir, "demo-report.json"), { summary, report });
  console.log(JSON.stringify(summary, null, 2));
}
