import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { EVALS_DIR } from "./dataset.js";
import { loadReviewDataset } from "./review-holdout.js";
import { PumpMode } from "./review-labels.js";
import { decaidReviewInput } from "./review-local-replay.js";

export const INDEPENDENT_FIXTURES = path.join(EVALS_DIR, "fixtures", "review-independent");

const Sidecar = z.strictObject({
  profileFamily: z.string(),
  pumpMode: PumpMode,
  labels: z.object({ source: z.literal("synthetic-injected") }).passthrough(),
});

export function loadIndependentReviewDataset() {
  const files = (directory: string) => readdirSync(path.join(INDEPENDENT_FIXTURES, directory))
    .filter((file) => file.endsWith(".json")).sort();
  const read = (directory: string, file: string): unknown =>
    JSON.parse(readFileSync(path.join(INDEPENDENT_FIXTURES, directory, file), "utf8"));
  const recordings = files("recordings");
  if (recordings.join("\n") !== files("labels").join("\n")) {
    throw new Error("Independent recordings and labels must have matching filenames");
  }
  const cases = recordings.map((file) => {
    const id = path.basename(file, ".json");
    const pair = id.slice(0, -1);
    try {
      const input = decaidReviewInput(read("recordings", file));
      return { id, session: pair, recipe: pair, split: "dev", input, ...Sidecar.parse(read("labels", file)) };
    } catch (error) {
      throw new Error(`Invalid independent fixture ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return loadReviewDataset({ id: "independent", demonstration: false, cases });
}
