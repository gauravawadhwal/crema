/**
 * Builds samples/beans.json by running Crema's real identify pipeline (with web
 * lookup) on a list of coffees. This is how the demo's ONA and Haven coffees
 * were made, and it doubles as an end-to-end test of the AI provider chain.
 *
 *   LLM_PROVIDERS=claude-cli npx tsx scripts/seed-samples.ts
 */
import { writeFile } from "node:fs/promises";
import { identifyWithProvider } from "../server/identify.js";
import { ProviderChain } from "../server/llm/index.js";

const COFFEES = [
  "ONA Coffee Maple (espresso blend), onacoffee.com.au",
  "ONA Coffee Raspberry Candy, onacoffee.com.au",
  "ONA Coffee Kaliluni AA Kenya washed espresso, onacoffee.com.au",
  "ONA Coffee Guji Yabitu Koba G1, onacoffee.com.au",
  "ONA Coffee La Fincona espresso, onacoffee.com.au",
  "Haven Coffee Sydney Compass House Blend, havencoffee.com.au",
  "Haven Coffee Sydney Ethiopia Guji Gogogu, havencoffee.com.au",
  "Haven Coffee Sydney Kenya Rioki Estate, havencoffee.com.au",
  "Haven Coffee Sydney Peru Adelino Vega Navara, havencoffee.com.au",
];

const llm = ProviderChain.fromEnv();
const results: unknown[] = [];
const queue = [...COFFEES.entries()];
async function worker() {
  for (let next = queue.shift(); next; next = queue.shift()) {
    const [i, q] = next;
    const t0 = Date.now();
    try {
      const { info, provider } = await identifyWithProvider(llm, { query: q });
      results[i] = { query: q, info, seconds: (Date.now() - t0) / 1000, provider };
      console.log(`✓ ${q} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    } catch (e) {
      results[i] = { query: q, error: (e as Error).message };
      console.log(`✗ ${q}: ${(e as Error).message.slice(0, 200)}`);
    }
  }
}
await Promise.all([worker(), worker(), worker()]);
await writeFile("samples/beans.json", JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
console.log("wrote samples/beans.json");
