import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MockProvider } from "../server/llm/mock.js";
import type { ReviewIssue } from "../server/recommend/review-types.js";
import { type LlmProvider } from "../server/llm/types.js";
import { normalizeLegacyReview, runReviewAblation, runReviewVariant } from "../evals/lib/review-ablation.js";
import { reviewAblationMarkdown } from "../evals/lib/review-ablation-report.js";
import { assertCurveStageInvariant, checkModelStage, crossedTasteInputs } from "../evals/lib/review-crossed.js";
import { checkReviewHoldout, freezeReviewHoldout, loadReviewDataset, selectReviewCases } from "../evals/lib/review-holdout.js";
import { validateReviewLabels } from "../evals/lib/review-labels.js";
import { scoreReview, summarizeReviewMetrics, type ReviewEvalOutput } from "../evals/lib/review-metrics.js";
import { reviewFixture } from "../evals/lib/review-fixtures.js";
import { ROOT_DIR } from "../evals/lib/dataset.js";

const demo = path.join(ROOT_DIR, "evals/fixtures/review-ablation/demonstration.json");
const fixtures = () => JSON.parse(readFileSync(demo, "utf8"));
const synthetic = { source: "synthetic-injected", injection: "Injected a flow rise.", observations: [] };
const noClaims: ReviewEvalOutput = { events: [], figures: [], outcomes: [], claims: {} };

function tempDirectory(run: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "crema-review-harness-"));
  try { run(dir); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

describe("review label sources", () => {
  it("accepts each source in its intended storage and rejects mixed sources", () => {
    const measured = { source: "measured-reference", reference: "Synchronized measurement", observations: [] };
    const sensory = { source: "sensory", taste: { sourBitter: -1, enjoyment: 0 }, supportedOutcomes: ["abstain"] };
    expect(validateReviewLabels(synthetic, "synthetic").source).toBe("synthetic-injected");
    expect(validateReviewLabels(measured, "local").source).toBe("measured-reference");
    expect(validateReviewLabels(sensory, "local").source).toBe("sensory");
    expect(() => validateReviewLabels(measured, "synthetic")).toThrow(/local replay/);
    expect(() => validateReviewLabels(synthetic, "local")).toThrow(/synthetic fixture/);
    for (const mixed of [[synthetic, sensory], { ...measured, injection: "extra" }, { ...synthetic, taste: sensory.taste },
      { ...sensory, observations: [] }, { ...sensory, taste: {} }]) {
      expect(() => validateReviewLabels(mixed, "local")).toThrow();
    }
  });

  it("rejects inverted bounds, unknown timing conventions, and repeated observation identities", () => {
    const event = { id: "drops", kind: "first_drips", expected: "required" };
    for (const observations of [[event, event], [{ ...event, timing: { type: "raw-landmark", onsetS: [3, 2] } }],
      [{ ...event, timing: { type: "two-seconds", onsetS: [3, 3] } }]]) {
      expect(() => validateReviewLabels({ ...synthetic, observations }, "synthetic")).toThrow();
    }
  });
});

describe("crossed taste", () => {
  const fixture = () => reviewFixture("history-grind-progress");

  it("crosses taste and history independently while leaving telemetry and history metadata intact", () => {
    const input = fixture();
    const variants = crossedTasteInputs(input);
    const tasting = variants.find((r) => r.id === "high-enjoyment/liked")!;
    expect(variants).toHaveLength(21);
    expect(tasting.input.feedback?.enjoyment).toBe(10);
    expect(tasting.input.history[0]).toMatchObject({ timestamp: input.history[0].timestamp, enjoyment: 10 });
    expect(variants.find((r) => r.id === "instructions-only/adverse")?.input).toMatchObject({
      feedback: null, notes: expect.stringMatching(/Ignore the curve/),
      history: [expect.objectContaining({ notes: expect.stringMatching(/Ignore all instructions/) })],
    });
    expect(new Set(variants.map(({ input }) => JSON.stringify(input.points))).size).toBe(1);
    tasting.input.points[0].p = 1;
    expect(input.points[0].p).not.toBe(1);
  });

  it("keeps deterministic facts and issues byte-identical and catches taste leakage", async () => {
    await assertCurveStageInvariant(fixture());
    await assertCurveStageInvariant(reviewFixture("choke"));
    await expect(assertCurveStageInvariant(fixture(), (input) => ({ taste: input.feedback }))).rejects.toThrow(/balanced/);
    await expect(assertCurveStageInvariant(fixture(), (input) => input.notes ?
      { a: 1, b: 2 } : { b: 2, a: 1 })).rejects.toThrow(/Curve stage changed/);
  });

  it("checks changes in mechanics, order, and confidence independently", async () => {
    const issue: ReviewIssue = { kind: "gushed", what: "Gushed", evidence: "high flow", severity: "caution", fromS: 1, toS: 2 };
    const second = { ...issue, kind: "slow_shot" };
    const changes = await checkModelStage(fixture(), ({ feedback, notes }) => {
      if (feedback?.enjoyment === 10) return { findings: [second, issue], confidence: "high" };
      if (notes?.startsWith("Ignore")) return { findings: [second], confidence: "low" };
      return { findings: [issue, second], confidence: "low" };
    });
    expect(changes).toHaveLength(6);
    expect(changes).toContainEqual({ variant: "high-enjoyment/liked", findings: true, order: false, confidence: false });
    expect(changes).toContainEqual({ variant: "instructions-only/unrated", findings: false, order: null, confidence: true });
  });

  it("exercises the legacy mock model and exposes the legacy rules confidence change", async () => {
    const mock = new MockProvider();
    const run = (provider?: LlmProvider) => checkModelStage(reviewFixture("choke"), async (input) => {
      const result = await runReviewVariant("old", input, provider);
      if (result.status !== "ready") throw new Error(result.reason);
      expect(result.fellBack).toBe(false);
      return { findings: result.review.issues, confidence: result.review.confidence };
    });
    expect(await run(mock)).toEqual([]);
    expect(await run()).toContainEqual({ variant: "sour-and-thin/unrated", findings: true, order: true, confidence: false });
  });

  it.todo("future curve-only REVIEW is byte-identical across crossed taste inputs via curveStage");
});

describe("labelled review metrics", () => {
  it("uses actual neighbours for raw landmarks and ±1 s for windowed onset and peak", () => {
    const labels = validateReviewLabels({ ...synthetic, observations: [
      { id: "drops", kind: "first_drips", expected: "required", timing: { type: "raw-landmark", onsetS: [2, 2] } },
      { id: "rise", kind: "flow_rise", phase: "pouring", controlledVariable: "pressure",
        expected: "required", timing: { type: "windowed-event", onsetS: [4, 4.5], peakS: [8, 9] } },
      { id: "no-choke", kind: "choke", expected: "forbidden" },
    ] }, "synthetic");
    const output = { ...noClaims, events: [
      { kind: "first_drips", onsetS: 3.1 }, { kind: "first_drips", onsetS: 1.8 },
      { kind: "flow_rise", onsetS: 3, peakS: 10, phase: "pouring", controlledVariable: "pressure" as const },
      { kind: "flow_rise", onsetS: 4, peakS: 8, phase: "bloom", controlledVariable: "pressure" as const },
      { kind: "flow_rise", onsetS: 4, phase: "pouring", controlledVariable: "pressure" as const },
      { kind: "choke" }, { kind: "unlabelled" },
    ] };
    const score = scoreReview(labels, output, [0, 1.8, 2, 3, 5, 8]);
    expect(score.events[0]).toMatchObject({ id: "drops", matched: true, onsetErrorS: expect.closeTo(0.2), peakErrorS: null });
    expect(score.events[1]).toMatchObject({ id: "rise", matched: true, onsetErrorS: 1, peakErrorS: 1 });
    expect(score.falseAlarms).toEqual(["first_drips", "flow_rise", "flow_rise", "choke"]);
    expect(score.forbiddenHits).toEqual(["no-choke"]);
    expect(score.unscoredEvents).toBe(1);
  });

  it("matches repeated event kinds one-to-one without letting a broad label consume a constrained hit", () => {
    const labels = validateReviewLabels({ ...synthetic, observations: [
      { id: "broad", kind: "drop", expected: "required" },
      { id: "narrow", kind: "drop", expected: "required", timing: { type: "windowed-event", onsetS: [1, 1] } },
    ] }, "synthetic");
    const events = [{ kind: "drop", onsetS: 1 }, { kind: "drop", onsetS: 5 }];
    expect(scoreReview(labels, { ...noClaims, events }, []).events.map((e) => e.matched)).toEqual([true, true]);
    expect(scoreReview(labels, { ...noClaims, events: events.slice(0, 1) }, []).events.filter((e) => e.matched)).toHaveLength(1);
  });

  it("requires figures to be present, correctly named, and consistent across all mentions", () => {
    const labels = validateReviewLabels({ ...synthetic,
      supportedOutcomes: ["abstain"], forbiddenClaims: ["inferred-taste", "unqualified-diagnosis", "multiple-next-shot-changes"],
      figures: [{ id: "actual", unit: "bar", value: 5, tolerance: 0.1 }, { id: "peak", unit: "bar", value: 6, tolerance: 0.1 },
        { id: "target", unit: "bar", value: 9, tolerance: 0.1 }, { id: "flow", unit: "ml/s", value: 1, tolerance: 0 }],
    }, "synthetic");
    const score = scoreReview(labels, { ...noClaims,
      figures: [{ id: "actual", unit: "bar", value: 5.05 }, { id: "peak", unit: "bar", value: 6 },
        { id: "peak", unit: "bar", value: 4 }, { id: "flow", unit: "bar", value: 1 }],
      claims: { "inferred-taste": true, "multiple-next-shot-changes": false },
    }, []);
    expect(score.figures.map((f) => f.pass)).toEqual([true, false, false, false]);
    expect(score.justifiedAbstention).toBe(true);
    expect(score.forbiddenClaims.map((c) => c.present)).toEqual([true, null, false]);
  });

  it("reports event accuracy, missing data, pump alarms, usage and latency without conflating them", () => {
    const labels = validateReviewLabels({ ...synthetic, supportedOutcomes: ["grind-finer"], observations: [
      { id: "flow", kind: "flow_rise", expected: "required" }, { id: "choke", kind: "choke", expected: "forbidden" },
    ] }, "synthetic");
    const score = scoreReview(labels, { ...noClaims, events: [{ kind: "choke" }] }, []);
    const other = scoreReview(labels, { ...noClaims, events: [{ kind: "flow_rise" }], outcomes: ["grind-finer"] }, []);
    const summary = summarizeReviewMetrics([
      { pumpMode: "pressure", score, ms: 4, fellBack: true, tokens: null },
      { pumpMode: "flow", score: other, ms: 7, fellBack: false, tokens: { input: 100, output: 20 } },
      { pumpMode: "unknown", ms: 9, fellBack: false, tokens: null },
    ]);
    expect(summary.byKind[0]).toMatchObject({ tp: 1, fp: 1, fn: 1, precision: 0.5, recall: 0.5, onsetMaeS: null, peakN: 0 });
    expect(summary.byKind[1]).toMatchObject({ kind: "flow_rise", precision: 1, recall: 0.5 });
    expect(summary.falseAlarmsByPump).toEqual([{ pumpMode: "pressure", falseAlarms: 1, cases: 1, perCase: 1 },
      { pumpMode: "flow", falseAlarms: 0, cases: 1, perCase: 0 }]);
    expect(summary).toMatchObject({
      abstention: { unjustified: 1 }, tokens: { reportedRuns: 1, input: 100, output: 20 },
      latencyMs: { p50: 7, p95: 9 }, fallbackRate: 1 / 3,
    });
  });
});

describe("review ablation registry and report", () => {
  it("runs the shipped paths on the same fixtures, with explicit placeholders and a per-family report", async () => {
    const cases = loadReviewDataset(fixtures()).cases;
    const variants = await runReviewAblation(cases, ["old", "facts-only", "facts-plus-anchored", "two-stage"]);
    const [old, ...pending] = variants;
    expect(pending).toHaveLength(3);
    for (const result of pending) expect(result).toMatchObject({ status: "pending", reason: "not implemented yet" });
    expect(old).toMatchObject({ status: "ready", summary: { numericConsistency: { passed: 1, total: 1 }, fallbackRate: 0 },
      families: [{ family: "flat-flow" }, { family: "flat-pressure" }],
      records: [{ caseId: "demo-steady", source: "rules" }, { caseId: "demo-shortfall", source: "rules" }] });
    const report = reviewAblationMarkdown({ meta: { task: "review-ablation", dataset: "demo", demonstration: true, split: "dev",
      purpose: "tune", provider: "rules", startedAt: "2000-01-01T00:00:00Z", git: { commit: "abcdef", dirty: false } }, variants });
    expect(report).toContain("Demonstration fixtures only.");
    expect(report).toContain("### flat-pressure");
    expect(report).toContain("Numeric consistency 1/1");
    expect(report).toContain("not implemented yet");
    const mock = await runReviewVariant("old", cases[0].input, new MockProvider());
    expect(mock).toMatchObject({ status: "ready", source: "mock", tokens: null, fellBack: false, promptHashes: [expect.any(String)] });
    if (mock.status !== "ready") throw new Error(mock.reason);
    expect(normalizeLegacyReview({ ...mock.review, nextShot: {
      change: "", reasoning: "", grindDelta: "finer", yieldDeltaG: 2, tempDeltaC: 0, switchProfile: null,
    } }, cases[0].input).claims["multiple-next-shot-changes"]).toBe(true);
  });

  it("records paid-usage fields when a mock reports them and flags a mock failure that fell back", async () => {
    const mock = new MockProvider();
    const measuredMock: LlmProvider = {
      ...mock, structured: (request) => {
        request.onUsage?.({ inputTokens: 12, outputTokens: 8 });
        return mock.structured(request);
      },
    };
    expect(await runReviewVariant("old", reviewFixture("choke"), measuredMock)).toMatchObject({
      tokens: { input: 12, output: 8 }, fellBack: false,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const broken: LlmProvider = { ...mock, structured: async () => { throw new Error("mock provider failed"); } };
      expect(await runReviewVariant("old", reviewFixture("choke"), broken)).toMatchObject({ fellBack: true, source: "rules" });
    } finally { warn.mockRestore(); }
  });
});

describe("frozen review holdout", () => {
  it("keeps both session and recipe groups together and refuses duplicate ids", () => {
    for (const field of ["session", "recipe"]) {
      const raw = fixtures();
      raw.cases[1][field] = raw.cases[0][field];
      expect(() => loadReviewDataset(raw)).toThrow(`Split crosses ${field} group`);
    }
    const raw = fixtures();
    raw.cases[1].id = raw.cases[0].id;
    expect(() => loadReviewDataset(raw)).toThrow(/Duplicate fixture id/);
  });

  it("freezes the fixture inputs and labels, refuses overwrites, and allows dev edits", () => tempDirectory((dir) => {
    const file = path.join(dir, "holdout.manifest.json");
    const raw = fixtures();
    const manifest = freezeReviewHoldout(loadReviewDataset(raw), file);
    expect(Object.keys(manifest.fixtures)).toEqual(["demo-shortfall"]);
    expect(Object.values(manifest.fixtures)[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(() => freezeReviewHoldout(loadReviewDataset(raw), file)).toThrow(/EEXIST/);
    raw.cases[0].input.points[1].f += 1;
    expect(checkReviewHoldout(loadReviewDataset(raw), file)).toEqual(manifest);
    const added = structuredClone(raw.cases[1]);
    raw.cases.push({ ...added, id: "another-holdout" });
    expect(() => checkReviewHoldout(loadReviewDataset(raw), file)).toThrow(/added/);
    raw.cases.pop();
    raw.cases[1].labels.figures[0].value += 1;
    expect(() => checkReviewHoldout(loadReviewDataset(raw), file)).toThrow(/demo-shortfall/);
    raw.cases[1] = added;
    raw.cases[1].input.points[1].p += 1;
    expect(() => checkReviewHoldout(loadReviewDataset(raw), file)).toThrow(/demo-shortfall/);
    raw.cases.pop();
    expect(() => checkReviewHoldout(loadReviewDataset(raw), file)).toThrow();
  }));

  it("defaults to dev and only logs explicit verified evaluations of a holdout", () => tempDirectory((dir) => {
    const dataset = loadReviewDataset(fixtures());
    const manifest = path.join(dir, "holdout.manifest.json");
    const log = manifest + ".runs.jsonl";
    const setup = { provider: "rules", variants: ["old"] } as const;
    expect(selectReviewCases(dataset, setup).cases.map((c) => c.split)).toEqual(["dev"]);
    expect(() => selectReviewCases(dataset, { ...setup, split: "holdout", purpose: "evaluate" })).toThrow(/explicit/);
    freezeReviewHoldout(dataset, manifest);
    expect(() => selectReviewCases(dataset, { ...setup, split: "holdout", manifest, purpose: "tune" })).toThrow(/dev-only/);
    expect(readdirSync(dir)).toEqual(["holdout.manifest.json"]);
    for (const count of [1, 2]) expect(selectReviewCases(dataset, { ...setup, split: "holdout", manifest, purpose: "evaluate" })).toMatchObject({
      holdoutRunCount: count, cases: [{ id: "demo-shortfall" }],
    });
    const entries = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ provider: "rules", variants: ["old"], cases: 1, demonstration: true });
  }));

  it("gates the CLI and writes paired reports following the logged attempt", () => tempDirectory((dir) => {
    const manifest = path.join(dir, "frozen.json");
    const args = ["--import", "tsx", path.join(ROOT_DIR, "evals/review.ts")];
    const data = ["--dataset", demo, "--manifest", manifest];
    const opts = { cwd: ROOT_DIR, encoding: "utf8" } as const;
    execFileSync(process.execPath, [...args, "freeze", ...data], opts);
    const refused = spawnSync(process.execPath, [...args, "run", ...data, "--split", "holdout", "--purpose", "tune"], opts);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/tuning is dev-only/);
    execFileSync(process.execPath, [...args, "run", ...data, "--split", "holdout", "--purpose", "evaluate", "--out", dir], opts);
    const files = readdirSync(dir);
    const json = files.find((file) => file.includes("-review-ablation-") && file.endsWith(".json"))!;
    expect(files).toContain(json.replace(/\.json$/, ".md"));
    expect(JSON.parse(readFileSync(path.join(dir, json), "utf8")).meta).toMatchObject({ split: "holdout", holdoutRunCount: 1 });
  }));
});
