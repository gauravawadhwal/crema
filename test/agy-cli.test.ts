import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AgyCliProvider } from "../evals/lib/agy-cli.js";
import { ROOT_DIR } from "../evals/lib/dataset.js";
import { CliPin, IsolatedCli, makeQuotaReader } from "../evals/lib/iteration/providers.js";
import { Meter } from "../evals/lib/iteration/runtime.js";

let dir: string;
let binary: string;
const opus = "claude-opus-5-5-high";
const req = { system: "Judge the answer.", prompt: "Evidence and answer.", schema: z.object({ verdict: z.literal("ok") }), schemaName: "Probe" };

function stub(source: string, name = "agy") {
  const path = join(dir, name);
  writeFileSync(path, `#!${process.execPath}\n${source}\n`, { mode: 0o700 });
  return path;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "crema-agy-test-"));
  binary = join(dir, "agy");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("Antigravity eval provider", () => {
  it("runs print mode in a clean scratch directory with detached input and decodes usage", async () => {
    stub(`
      const fs = require("node:fs"), assert = require("node:assert/strict");
      const args = process.argv.slice(2);
      const value = flag => args[args.indexOf(flag) + 1];
      assert.equal(value("-p"), "Judge the answer.\\n\\n---\\n\\nEvidence and answer.");
      assert.equal(value("--model"), "${opus}");
      assert.equal(value("--output-format"), "json");
      assert.equal(JSON.parse(value("--json-schema")).properties.verdict.const, "ok");
      assert.equal(JSON.parse(value("--settings")).useG1Credits, false);
      assert.equal(JSON.parse(value("--settings")).toolPermission, "strict");
      assert.equal(process.env.GEMINI_API_KEY, undefined);
      assert.equal(fs.readFileSync(0, "utf8"), "");
      assert.deepEqual(fs.readdirSync("."), []);
      console.log(JSON.stringify({ status: "SUCCESS", num_turns: 1,
        response: "\`\`\`json\\n{}\\n\`\`\`", structured_output: { verdict: "ok" },
        usage: { input_tokens: 23, output_tokens: 3, cache_read_tokens: 5, thinking_tokens: 2, total_tokens: 28 } }));
    `);
    const provider = new AgyCliProvider(opus, { binary, scratchRoot: dir, env: { ...process.env, GEMINI_API_KEY: "test-key" } });
    const observed: unknown[] = [];
    expect(await provider.structured({ ...req, onUsage: usage => observed.push(usage) })).toEqual({ verdict: "ok" });
    expect(observed).toEqual([{ inputTokens: 18, cacheTokens: 5, outputTokens: 5 }]);
    expect(readdirSync(dir)).toEqual(["agy"]);
  });

  it("validates raw text output and rejects malformed or multi-turn responses", async () => {
    const provider = new AgyCliProvider(opus, { binary, scratchRoot: dir });
    stub(`console.log("Response: {\\\"verdict\\\":\\\"ok\\\"}")`);
    await expect(provider.structured(req)).resolves.toEqual({ verdict: "ok" });
    stub(`console.log('{"verdict":"wrong"}')`);
    await expect(provider.structured(req)).rejects.toThrow("invalid structured output");
    stub(`console.log('{"status":"SUCCESS","num_turns":2,"structured_output":{"verdict":"ok"}}')`);
    await expect(provider.structured(req)).rejects.toThrow("invalid structured output");
  });

  it.each([
    ["Authentication required", "authentication failed"],
    ["429 Resource Exhausted", "quota or rate limit reached"],
    ["Model is unavailable", "Check the catalog with agy models"],
    ["Untrusted workspace", "workspace trust"],
  ])("reports %s without echoing the CLI diagnostic", async (message, expected) => {
    stub(`console.error(${JSON.stringify(message + " sensitive-diagnostic")}); process.exit(1)`);
    const provider = new AgyCliProvider(opus, { binary, scratchRoot: dir });
    await expect(provider.structured(req)).rejects.toThrow(expected);
  });

  it("fails on missing executables and bounds noninteractive waits", async () => {
    const provider = new AgyCliProvider(opus, { binary, scratchRoot: dir, timeoutMs: 200 });
    await expect(provider.structured(req)).rejects.toThrow("agy executable not found");
    stub("setInterval(() => {}, 1000)");
    await expect(provider.structured(req)).rejects.toThrow("timed out");
    expect(readdirSync(dir)).toEqual(["agy"]);
  });

  it("records the exact providers through the CLI subject and judge flags", () => {
    stub(`
      const assert = require("node:assert/strict");
      const args = process.argv.slice(2);
      const schema = JSON.parse(args[args.indexOf("--json-schema") + 1]);
      const model = args[args.indexOf("--model") + 1];
      const isJudge = !!schema.properties.specificity;
      assert.equal(model, isJudge ? "${opus}" : "gemini-4-argon-high");
      const value = isJudge ? {
        contradictions: [], inventedFigures: [], specificity: 4, actionable: 4, plainLanguage: 4, comment: "none",
        assessment: Object.fromEntries(["numericEvidence", "causalRestraint", "tasteGrounding", "adviceAlignment"].map(k => [k, { status: "pass" }])),
      } : schema.properties.report ? { report: null } : { rewrites: [] };
      console.log(JSON.stringify({ status: "SUCCESS", num_turns: 1, structured_output: value }));
    `);
    const out = join(dir, "results");
    execFileSync(process.execPath, ["--import", "tsx", "evals/run.ts", "--task", "review", "--filter", "history-grind-progress",
      "--provider", "agy-cli", "--model", "gemini-4-argon-high", "--judge", `agy-cli:${opus}`, "--out", out],
    { cwd: ROOT_DIR, env: { ...process.env, AGY_BIN: binary }, timeout: 10_000 });
    const report = JSON.parse(readFileSync(join(out, readdirSync(out).find(file => file.endsWith(".json"))!), "utf8"));
    expect(report.meta).toMatchObject({ provider: "agy-cli", model: "gemini-4-argon-high", judge: `agy-cli:${opus}` });
    expect(report.records).toHaveLength(1);
    expect(report.records[0]).toMatchObject({ requested: { kind: "llm", provider: "agy-cli" }, answerSource: "model", judgeStatus: "assessed" });
  }, 12_000);

  it("meters agy separately and dispatches no further calls after the token cap or stop file", async () => {
    const counter = join(dir, "attempts");
    stub(`require("node:fs").appendFileSync(${JSON.stringify(counter)}, "."); console.log('{"status":"SUCCESS","num_turns":1,"structured_output":{"verdict":"ok"},"usage":{"input_tokens":13,"output_tokens":4}}');`);
    const quotaBinary = stub(`
      require("node:assert/strict").equal(process.argv[3], "agy");
      console.log(JSON.stringify({ schemaVersion: 5, generatedAt: new Date().toISOString(), providers: [{
        provider: "agy", accountKeys: ["default"], state: { status: "fresh", stale: false },
        windows: [
          { id: "claude_gpt_5h", kind: "session", percentRemaining: 70, resetsAt: "2099-01-01T00:00:00Z" },
          { id: "claude_gpt_weekly", kind: "weekly", percentRemaining: 80, resetsAt: "2099-01-02T00:00:00Z" },
          { id: "gemini_5h", kind: "session", percentRemaining: 0 },
        ],
      }] }));
    `, "quota");
    const stop = join(dir, "STOP");
    const pin = CliPin.parse({ provider: "agy-cli", model: opus, binary, effort: "high", tier: "standard", cliVersion: "stub", maxCallTokens: 200 });
    const sandbox = { home: dir, quotaBinary, timeoutMs: 2000 };
    const reader = makeQuotaReader(sandbox, dir, stop, [pin]);
    const meter = new Meter(dir, stop, { maxTokens: 205, quota: {
      agy: { maxShortPp: 10, maxWeeklyPp: 10, reserveShortPp: 50, reserveWeeklyPp: 50, shortPpPerCall: 1, weeklyPpPerCall: 1 },
    } }, "test", reader);
    const provider = new IsolatedCli(pin, sandbox, dir, stop, meter);
    await expect(provider.structured(req)).resolves.toEqual({ verdict: "ok" });
    expect(meter.usage).toMatchObject({ attempts: 1, tokens: 17, windows: { agy: [{ id: "claude_gpt_5h" }, { id: "claude_gpt_weekly" }] } });
    await expect(provider.structured(req)).rejects.toThrow("Hard token cap");
    writeFileSync(stop, "");
    await expect(provider.structured(req)).rejects.toThrow("stopped by stop file");
    expect(readFileSync(counter, "utf8")).toBe(".");
  });
});
