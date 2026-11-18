import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
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

const fingerprint = (fixture: unknown) => createHash("sha256").update(JSON.stringify(fixture)).digest("hex");

export function loadReviewDataset(value: unknown) {
  const raw = Dataset.parse(value);
  const ids = new Set<string>();
  const groups = { session: new Map<string, string>(), recipe: new Map<string, string>() };
  const cases = raw.cases.map((entry) => {
    const c = ReviewCase.parse(entry);
    if (ids.has(c.id)) throw new Error(`Duplicate fixture id: ${c.id}`);
    ids.add(c.id);
    for (const field of ["session", "recipe"] as const) {
      const split = groups[field].get(c[field]);
      if (split && split !== c.split) throw new Error(`Split crosses ${field} group ${c[field]}`);
      groups[field].set(c[field], c.split);
    }
    return { ...c, labels: validateReviewLabels(c.labels, "synthetic"), hash: fingerprint(entry) };
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
    // Append before execution so failed or interrupted attempts are counted.
    const log = `${run.manifest}.runs.jsonl`;
    appendFileSync(log, JSON.stringify({ startedAt: new Date().toISOString(), dataset: dataset.id, demonstration: dataset.demonstration,
      manifest: fingerprint(manifest), cases: cases.length, provider: run.provider, variants: run.variants }) + "\n", { mode: 0o600 });
    holdoutRunCount = readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  }
  return { cases, holdoutRunCount };
}
