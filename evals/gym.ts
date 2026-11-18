import { mkdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { generateGymDataset, gymJson, GymReplay, readGymScenarios, SeedCount } from "./lib/gym/dataset.js";
import { GYM_GENERATOR_VERSION } from "./lib/gym/random.js";

const usage = `Usage: npx tsx evals/gym.ts <command>
  validate     --scenarios <dir> [--seeds N]
  generate     --scenarios <dir> --seeds N --out <new dir>
  replay-check --out <dir>`;

function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { scenarios: { type: "string" }, seeds: { type: "string" }, out: { type: "string" }, help: { type: "boolean" } },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  const [command] = positionals;
  if (positionals.length !== 1) throw new Error(usage);
  if (command === "replay-check") {
    if (!values.out || values.scenarios || values.seeds) throw new Error(usage);
    const out = resolve(values.out);
    const replay = GymReplay.parse(JSON.parse(readFileSync(join(out, "replay.json"), "utf8")));
    const generated = Buffer.from(gymJson(generateGymDataset(replay)));
    if (!generated.equals(readFileSync(join(out, "dataset.json")))) throw new Error("Replay differs from dataset.json");
    console.log(`Byte-for-byte replay matched with generator v${replay.generatorVersion}`);
    return;
  }

  if ((command !== "generate" && command !== "validate") || !values.scenarios ||
      (command === "generate" && (!values.out || !values.seeds)) || (command === "validate" && values.out)) {
    throw new Error(usage);
  }
  const seeds = SeedCount.parse(Number(values.seeds ?? 1));
  const scenarios = readGymScenarios(resolve(values.scenarios));
  const replay = GymReplay.parse({ generatorVersion: GYM_GENERATOR_VERSION, seeds, scenarios });
  const dataset = generateGymDataset(replay);
  if (command === "validate") {
    console.log(`Validated ${scenarios.length} scenarios and ${dataset.cases.length} review cases`);
    return;
  }

  const out = resolve(values.out!);
  mkdirSync(out);
  try {
    writeFileSync(join(out, "dataset.json"), gymJson(dataset), { flag: "wx" });
    writeFileSync(join(out, "replay.json"), gymJson(replay), { flag: "wx" });
  } catch (error) {
    rmSync(join(out, "dataset.json"), { force: true });
    rmSync(join(out, "replay.json"), { force: true });
    rmdirSync(out);
    throw error;
  }
  console.log(`Generated ${dataset.cases.length} review cases in ${out}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
