/**
 * Runs the real recommender (rules ranking + AI choice) on every coffee in
 * samples/beans.json for a milk drinker and a "both" drinker, and saves the
 * results to samples/recipes.json for the demo.
 *
 *   LLM_PROVIDERS=claude-cli npx tsx scripts/seed-recipes.ts
 */
import { readFile, writeFile } from "node:fs/promises";
import { ProviderChain } from "../server/llm/index.js";
import { recommend } from "../server/recommend/index.js";

const { results } = JSON.parse(await readFile("samples/beans.json", "utf8"));
const llm = ProviderChain.fromEnv();
const jobs = results.flatMap((r: any) => (["both", "milk"] as const).map((drink) => ({ name: r.info.name.value as string, info: r.info, drink })));
const out: Record<string, unknown> = {};
const queue = [...jobs];
async function worker() {
  for (let j = queue.shift(); j; j = queue.shift()) {
    const t0 = Date.now();
    const res = await recommend(llm, { bean: j.info, preferences: { drink: j.drink, hasScale: true, experience: "comfortable" } });
    out[`${j.name}|${j.drink}`] = { recipe: res.recipe, source: res.source };
    console.log(`${res.source.padEnd(12)} ${j.name} (${j.drink}) → ${res.recipe.profileTitle} ${res.recipe.doseG}→${res.recipe.yieldG}g ${res.recipe.tempC}°C  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}
await Promise.all([worker(), worker(), worker()]);
await writeFile("samples/recipes.json", JSON.stringify({ generatedAt: new Date().toISOString(), recipes: out }, null, 2));
console.log("wrote samples/recipes.json");
