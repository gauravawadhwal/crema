import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { digest } from "./manifest.js";
import { z } from "zod";
import { ReviewBody } from "../../server/schema.js";
import { PumpMode, validateReviewLabels } from "./review-labels.js";

const key = z.string().regex(/^[a-z0-9][a-z0-9_.-]*$/);
const ReviewCase = z.strictObject({
  id: key, session: key, recipe: key, profileFamily: key, pumpMode: PumpMode,
  split: z.enum(["dev", "holdout"]), input: ReviewBody, labels: z.unknown(),
});
const Dataset = z.strictObject({ id: key, demonstration: z.boolean(), cases: z.array(z.unknown()).min(1) });
const Manifest = z.strictObject({
  version: z.literal(1), dataset: key, demonstration: z.boolean(),
  fixtures: z.record(key, z.string().regex(/^[a-f0-9]{64}$/)),
});
type Manifest = z.infer<typeof Manifest>;

export function loadReviewDataset(value: unknown) {
  const raw = Dataset.parse(value);
  const ids = new Set<string>();
  const groups = { session: new Map<string, string>(), recipe: new Map<string, string>(), recording: new Map<string, string>() };
  const cases = raw.cases.map((entry) => {
    const c = ReviewCase.parse(entry);
    if (ids.has(c.id)) throw new Error(`Duplicate fixture id: ${c.id}`);
    ids.add(c.id);
    const { fullTrace, ...input } = c.input;
    const keys = { session: c.session, recipe: c.recipe, recording: digest(input.points) };
    for (const field of ["session", "recipe", "recording"] as const) {
      const split = groups[field].get(keys[field]);
      if (split && split !== c.split) throw new Error(`Split crosses ${field} group`);
      groups[field].set(keys[field], c.split);
    }
    return { ...c, input, fullTrace, labels: validateReviewLabels(c.labels, "synthetic", input.points.map(p => p.t)), hash: digest(entry) };
  });
  return { id: raw.id, demonstration: raw.demonstration, cases };
}

type ReviewDataset = ReturnType<typeof loadReviewDataset>;

function makeManifest(dataset: ReviewDataset): Manifest {
  const holdout = dataset.cases.filter((c) => c.split === "holdout");
  if (!holdout.length) throw new Error("Cannot freeze an empty holdout");
  return { version: 1, dataset: dataset.id, demonstration: dataset.demonstration,
    fixtures: Object.fromEntries(holdout.map((c) => [c.id, c.hash])) };
}

export function freezeReviewHoldout(dataset: ReviewDataset, file: string) {
  const manifest = makeManifest(dataset);
  writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  return manifest;
}

export function checkReviewHoldout(dataset: ReviewDataset, file: string) {
  const manifest = Manifest.parse(JSON.parse(readFileSync(file, "utf8")));
  const actual = makeManifest(dataset);
  if (manifest.dataset !== actual.dataset || manifest.demonstration !== actual.demonstration) throw new Error("Frozen holdout dataset identity changed");
  for (const id of new Set([...Object.keys(manifest.fixtures), ...Object.keys(actual.fixtures)])) {
    if (manifest.fixtures[id] !== actual.fixtures[id]) throw new Error(`Frozen holdout fixture changed, was removed or was added: ${id}`);
  }
  return manifest;
}

interface RunSelection {
  split?: "dev" | "holdout";
  purpose?: "tune" | "evaluate";
  manifest?: string;
  provider: string;
  variants: readonly string[];
  attemptsDirectory?: string;
}

export function selectReviewCases(dataset: ReviewDataset, run: RunSelection) {
  const split = run.split ?? "dev";
  if (split === "holdout" && (run.purpose !== "evaluate" || !run.manifest)) {
    throw new Error("Holdout requires explicit --split holdout --purpose evaluate --manifest <file>; tuning is dev-only");
  }
  const manifest = run.manifest ? checkReviewHoldout(dataset, run.manifest) : undefined;
  const cases = dataset.cases.filter((c) => c.split === split);
  if (!cases.length) throw new Error(`No ${split} cases`);

  let holdoutRunCount: number | undefined;
  if (split === "holdout" && run.manifest && manifest) {
    // Protected evaluation is a single reserved attempt per sealed panel.
    // The custodian supplies the same private ledger for every invocation.
    if (!dataset.demonstration) {
      if (!run.attemptsDirectory || !path.isAbsolute(run.attemptsDirectory)) {
        throw new Error("Protected holdout requires a custodian-owned absolute attempts directory");
      }
      if (run.variants.length !== 1) throw new Error("Nominate one variant for a protected holdout");
      const panel = digest(manifest);
      const cohort = digest(cases.map(c => digest(c.input.points)).sort());
      const attempt = path.join(run.attemptsDirectory, `${cohort}.json`);
      try {
        writeFileSync(attempt, JSON.stringify({ panel, startedAt: new Date().toISOString(), provider: run.provider, variants: run.variants }) + "\n",
          { flag: "wx", mode: 0o600 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Protected holdout already has a reserved attempt");
        throw error;
      }
      return { cases, holdoutRunCount: 1, panel };
    }
    // Append before execution so failed or interrupted attempts are counted.
    const log = `${run.manifest}.runs.jsonl`;
    appendFileSync(log, JSON.stringify({ startedAt: new Date().toISOString(), dataset: dataset.id, demonstration: dataset.demonstration,
      manifest: digest(manifest), cases: cases.length, provider: run.provider, variants: run.variants }) + "\n", { mode: 0o600 });
    holdoutRunCount = readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  }
  return { cases, holdoutRunCount, panel: undefined };
}
