import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import adversarial from "../evals/fixtures/review-ablation/grader-adversarial.json";
import { loadCases, ROOT_DIR } from "../evals/lib/dataset.js";
import { makeEvalManifest, sha256 } from "../evals/lib/manifest.js";
import type { ResultsFile } from "../evals/lib/report.js";
import { normalizeLegacyReview, runReviewAblation, type ReviewEvalCase } from "../evals/lib/review-ablation.js";
import { checkModelStage } from "../evals/lib/review-crossed.js";
import { reviewFixture } from "../evals/lib/review-fixtures.js";
import { gradeReview } from "../evals/lib/review-grader.js";
import { freezeReviewHoldout, loadReviewDataset, selectReviewCases } from "../evals/lib/review-holdout.js";
import { validateReviewLabels } from "../evals/lib/review-labels.js";
import { scoreReview } from "../evals/lib/review-metrics.js";
import { gradeRecord, runCase } from "../evals/lib/tasks.js";
import type { LlmProvider } from "../server/llm/types.js";
import { MockProvider } from "../server/llm/mock.js";
import { fullReviewTrace } from "../server/recommend/review-evidence.js";
import { rulesReview } from "../server/recommend/review-local.js";
import type { ShotReviewData } from "../server/recommend/review-types.js";

const cases = loadCases("review");
const find = (id: string) => cases.find(c => c.id === id)!;
const clean = find("review-clean");
const note = find("review-notes-injection");
const input = reviewFixture(clean.input.fixture);
const today = new Date("2000-01-01T00:00:00Z");
const mock = new MockProvider();
const labelBase = { source: "synthetic-injected", injection: "Synthetic fixture with neutral pressure hold.", observations: [] };
const dry = { events: [], figures: [], outcomes: [], claims: {} };
const goodVerdict = {
  contradictions: [], inventedFigures: [], specificity: 4, actionable: 4, plainLanguage: 4, comment: "Checked the answer.",
  assessment: {
    numericEvidence: { status: "pass" }, causalRestraint: { status: "pass" },
    tasteGrounding: { status: "pass" }, adviceAlignment: { status: "pass" },
  },
};

function scripted(reply: (schema: string, prompt: string) => unknown): LlmProvider {
  return { id: "mock", billing: "test", async structured(req) { return req.schema.parse(reply(req.schemaName, req.prompt)); } };
}
const failing = scripted(() => { throw new Error("Synthetic offline failure"); });
const syntheticCase: ReviewEvalCase = {
  id: "fictional-pressure", input, profileFamily: "flat", pumpMode: "pressure",
  labels: validateReviewLabels({ ...labelBase, supportedOutcomes: ["abstain"] }, "synthetic"),
};
const fixture = (name: string) => JSON.parse(readFileSync(path.join(ROOT_DIR, "evals/fixtures/review-ablation", name), "utf8"));

async function scratch<T>(fn: (dir: string) => T | Promise<T>) {
  const dir = mkdtempSync(path.join(tmpdir(), "crema-grader-"));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe("synthetic narrative attacks and controls", () => {
  it.each(adversarial)("$id", row => {
    const c = find(row.case);
    const base = rulesReview(reviewFixture(c.input.fixture));
    const out = {
      ...base,
      ...("summary" in row ? { summary: row.summary } : {}),
      ...("wentWell" in row ? { wentWell: row.wentWell } : {}),
      ...(row.nextShot === null ? { nextShot: null } : {}),
    } as ShotReviewData;
    if (row.reasoning && out.nextShot) out.nextShot.reasoning = row.reasoning;
    expect(gradeReview(c, out).checks.find(check => check.name === row.check)?.pass).toBe(row.want);
  });

  it("rejects advice and an invented extraction claim through the shipped curve stage", async () => {
    const provider = scripted(schema => schema === "ReviewNotes" ? { report: null } : {
      rewrites: [{ slot: "headline", text: "Switch to Secret Profile and raise the temperature by 10 °C. Extraction yield was 24%.", evidenceIds: ["recording"] }],
    });
    const result = await runCase("review", note, { kind: "llm", provider }, 0, { today });
    expect(result.output).toMatchObject({ nextShot: null });
    expect((result.output as ShotReviewData).summary).not.toContain("Secret Profile");
    expect(result.grade.checks).toContainEqual(expect.objectContaining({ name: "modelAnswered", pass: false, detail: "fallback" }));
  });

  it("rejects a verbatim note misclassified as a sensory report", async () => {
    const provider = scripted(schema => schema === "ReviewNotes" ? {
      report: { notesEvidence: "It tasted sharply sour", notesTaste: "thin",
        adjustment: { grindDelta: "finer", yieldDeltaG: 0, tempDeltaC: 0, switchProfile: null } },
    } : { rewrites: [] });
    const result = await runCase("review", find("review-notes-sour"), { kind: "llm", provider }, 0, { today });
    expect(result.output).toMatchObject({ nextShot: { grindDelta: "finer" } });
    expect(result.grade.checks).toContainEqual(expect.objectContaining({ name: "acceptableMove", pass: true }));
    expect(result.grade.checks).toContainEqual(expect.objectContaining({ name: "groundedSensoryAdvice", pass: false }));
  });
});

describe("review attribution and adjudication", () => {
  it("gives detector credit to the measured history and rejects the model-authored false reading", async () => {
    const c = loadReviewDataset(fixture("comparable-history.json")).cases[0];
    const summary = "The current pressure at matched cup mass was 20 bar. The shot definitely channelled and tasted sweet.";
    const subject = scripted(() => ({ ...rulesReview(c.input), summary, notesEvidence: null, notesTaste: null }));
    let answer: unknown;
    const judge = scripted((_, prompt) => {
      answer = JSON.parse(prompt).answer;
      return { ...goodVerdict, assessment: { ...goodVerdict.assessment,
        numericEvidence: { status: "fail", findings: [{ answerSays: "20 bar", evidenceId: "derived", reason: "Wrong matched-mass pressure." }] },
        causalRestraint: { status: "fail", findings: [{ answerSays: "definitely channelled", evidenceId: "recording", reason: "Telemetry cannot establish this cause." }] },
        tasteGrounding: { status: "fail", findings: [{ answerSays: "tasted sweet", evidenceId: "taste", reason: "No recorded taste." }] },
      } };
    });
    const [assessed] = await runReviewAblation([c], ["old"], subject, judge);
    expect(answer).toMatchObject({ summary });
    expect(answer).not.toHaveProperty("issues");
    expect(assessed).toMatchObject({
      promotionEligible: false, summary: { detectorEvidence: { numericConsistency: { passed: 6, total: 6 } },
        reviewer: { passed: 0, failed: 1 } }, records: [{ reviewerScore: { status: "fail" } }],
    });
    const [unassessed] = await runReviewAblation([c], ["old"], subject);
    expect(unassessed).toMatchObject({ promotionEligible: false, records: [{ reviewerScore: { status: "unassessed" } }] });
  });

  it("treats fabricated citations, absent semantic verdicts and unavailable judges as missing coverage", async () => {
    for (const [judge, judgeStatus] of [
      [scripted(() => ({ ...goodVerdict, contradictions: [{ answerSays: "The pump exceeded 99 bar.", inputSays: "88 bar" }] })), "invalid-citation"],
      [scripted(() => ({ ...goodVerdict, assessment: undefined, comment: "The answer claims channeling and taste." })), "unassessed"],
      [scripted(() => ({ ...goodVerdict, assessment: { ...goodVerdict.assessment, numericEvidence: { status: "unassessed" } } })), "unassessed"],
      [failing, "unavailable"],
    ] as const) {
      const result = await runCase("review", clean, { kind: "rules" }, 0, { today, judge });
      expect(result.judgeStatus).toBe(judgeStatus);
      expect(result.grade.pass).toBe(true);
      expect(result.grade.checks.some(c => c.name.startsWith("judge."))).toBe(false);
    }
  });

  it("separates fallback utility from model quality even with missing historical context", async () => {
    const failed = await runCase("review", clean, { kind: "llm", provider: failing }, 0, { today });
    expect(failed).toMatchObject({ answerSource: "fallback", grade: { pass: false, score: 0 }, fallbackGrade: { pass: true } });
    const old = { ...failed, context: undefined, requested: undefined };
    expect(gradeRecord("review", clean, old).pass).toBe(false);
    expect(old.answerSource).toBe("fallback");
    const unknown = { ...old, calls: [] };
    expect(gradeRecord("review", clean, unknown).pass).toBe(false);
    expect(unknown.answerSource).toBe("unknown");
    const control = await runCase("review", clean, { kind: "rules" }, 0, { today });
    expect(control.answerSource).toBe("rules");
    expect(control.grade.checks.some(c => c.name === "modelAnswered")).toBe(false);
    const [fallback] = await runReviewAblation([syntheticCase], ["old"], failing);
    expect(fallback).toMatchObject({ promotionEligible: false,
      summary: { fallbackUtility: { passed: 1, total: 1 }, reviewer: { passed: 0, noModelAnswer: 1 } },
      records: [{ reviewerScore: { status: "no-model-answer", supportedOutcome: null }, fallbackUtility: true }],
    });
  });

  it("detects taste leaking into the legacy mechanical wording without a findings or confidence change", async () => {
    const delta = await checkModelStage(input, crossed => ({ summary: crossed.notes ?? "Hold.", findings: [], confidence: "low" }));
    expect(delta).toContainEqual({ variant: "sour-and-thin/unrated", summary: false, findings: true, order: true, confidence: true });
  });
});

const cli = (entry: string, args: string[]) => spawnSync(process.execPath,
  ["--import", "tsx", path.join(ROOT_DIR, "evals", entry), ...args], { cwd: ROOT_DIR, encoding: "utf8" });

function rulesReports(dir: string) {
  const args = ["--task", "review", "--provider", "rules", "--repeat", "2", "--filter", "review-history", "--out", dir];
  const result = cli("run.ts", args);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  const json = path.join(dir, readdirSync(dir).find(f => f.endsWith(".json"))!);
  return { json, report: JSON.parse(readFileSync(json, "utf8")) as ResultsFile };
}

describe("comparison and immutable regrading", () => {
  it("rejects changed panels, partial judge coverage, and removed required metrics at zero tolerance", async () => scratch(dir => {
    const { json, report } = rulesReports(dir);
    const candidate = path.join(dir, "candidate.json");
    function compare(next: ResultsFile, reference = json) {
      writeFileSync(candidate, JSON.stringify(next));
      return cli("compare.ts", [reference, candidate, "--fail-on-regression", "--tolerance", "0"]);
    }
    const same = compare(report);
    expect(same.status).toBe(0);
    expect(same.stdout).toContain("Coverage historyComparison");
    expect(same.stdout).toContain("Unpaired rows: 0 reference, 0 candidate");
    const change = (apply: (file: ResultsFile) => void) => {
      const copy = structuredClone(report);
      apply(copy);
      return compare(copy);
    };
    for (const mutate of [
      (f: ResultsFile) => { f.records.shift(); },
      (f: ResultsFile) => { f.records.push({ ...f.records[0], repeat: 2 }); },
      (f: ResultsFile) => { f.records.push(f.records[0]); },
    ]) expect(change(mutate).stderr).toContain("Unpaired repeat slots");
    for (const field of ["inputDigest", "labelDigest"] as const) {
      const r = change(f => {
        const m = f.meta.manifest!;
        m.cases[0][field] = sha256(field);
        f.meta.manifest = makeEvalManifest(m.cases, m.slots, m.scorer);
      });
      expect(r.stderr).toContain("Case, input, label or repeat manifest drift");
    }
    expect(change(f => { f.meta.manifest!.scorer = sha256("different scorer"); }).stderr).toContain("Scorer fingerprint drift");
    expect(change(f => { f.meta.subjectSettings = sha256("different configuration"); }).stderr).toContain("Subject settings drift");
    expect(change(f => { f.meta.judge = "test judge"; f.meta.judgeSettings = sha256("different judge"); }).stderr).toContain("Judge settings drift");
    const noMetric = structuredClone(report);
    noMetric.records[0].grade.checks = noMetric.records[0].grade.checks.filter(c => c.name !== "historyComparison");
    const missing = path.join(dir, "both-missing.json");
    writeFileSync(missing, JSON.stringify(noMetric));
    expect(compare(noMetric, missing).stderr).toContain("Missing or duplicate required metric");
    const unjudged = structuredClone(report);
    unjudged.meta.judge = "mock";
    unjudged.meta.judgeSettings = sha256("mock judge");
    writeFileSync(missing, JSON.stringify(unjudged));
    expect(compare(unjudged, missing).stderr).toContain("Missing judge coverage");
    expect(change(f => { delete f.meta.manifest; }).stderr).toContain("Missing or invalid evaluation manifest");
    const markdown = readFileSync(json.replace(/\.json$/, ".md"), "utf8");
    expect(markdown).toContain(report.meta.manifest!.scorer);
    expect(markdown).toContain(report.meta.manifest!.slots[0].digest);
  }), 30000);

  it("keeps the source bytes and refuses missing cases and input drift", async () => scratch(dir => {
    const { json, report } = rulesReports(dir);
    const original = readFileSync(json);
    const result = cli("run.ts", ["--regrade", json, "--out", dir]);
    expect(result.status).toBe(0);
    expect(readFileSync(json)).toEqual(original);
    const derived = readdirSync(dir).find(f => f.includes("-regrade-") && f.endsWith(".json"))!;
    expect(JSON.parse(readFileSync(path.join(dir, derived), "utf8")).meta).toMatchObject({
      parentDigest: sha256(original), manifest: report.meta.manifest,
    });
    const bad = path.join(dir, "wrong.json");
    const m = report.meta.manifest!;
    m.cases[0].inputDigest = sha256("changed fictional flow trace");
    report.meta.manifest = makeEvalManifest(m.cases, m.slots, m.scorer);
    writeFileSync(bad, JSON.stringify(report));
    expect(cli("run.ts", ["--regrade", bad, "--out", dir]).stderr).toContain("Case or input drift");
    const id = m.cases[0].caseId;
    m.cases[0].caseId = "fictional-removed";
    const rename = <T extends { caseId: string }>(slot: T): T => slot.caseId === id ? { ...slot, caseId: "fictional-removed" } : slot;
    report.records = report.records.map(rename);
    report.meta.manifest = makeEvalManifest(m.cases, m.slots.map(rename), m.scorer);
    const missing = JSON.stringify(report);
    writeFileSync(bad, missing);
    expect(cli("run.ts", ["--regrade", bad, "--out", dir]).stderr).toContain("Cannot regrade missing case fictional-removed");
    expect(readFileSync(bad, "utf8")).toBe(missing);
  }), 30000);
});

describe("holdout custody", () => {
  it("keeps legacy holdout out of the default cohort and out of progress output", async () => scratch(dir => {
    const result = cli("run.ts", ["--task", "review", "--provider", "rules", "--out", dir]);
    expect(result.status).toBe(0);
    const f = JSON.parse(readFileSync(path.join(dir, readdirSync(dir).find(f => f.endsWith(".json"))!), "utf8")) as ResultsFile;
    expect(f.records.map(r => r.caseId).sort()).toEqual(cases.filter(c => c.split === "dev").map(c => c.id).sort());
    for (const c of cases.filter(c => c.split === "holdout")) expect(result.stdout).not.toContain(c.id);
  }), 30000);

  it("rejects cloned recordings across splits and reserves protected attempts independently of manifest path", async () => scratch(dir => {
    const source = fixture("demonstration.json");
    const duplicated = structuredClone(source);
    duplicated.cases[1].input = { ...duplicated.cases[0].input, notes: "Different note on the same recording." };
    expect(() => loadReviewDataset(duplicated)).toThrow(/Split crosses recording group/);
    const dataset = loadReviewDataset({ ...source, demonstration: false });
    const first = path.join(dir, "a.json");
    const second = path.join(dir, "b.json");
    freezeReviewHoldout(dataset, first);
    freezeReviewHoldout(dataset, second);
    const setup = { split: "holdout", purpose: "evaluate", provider: "rules", variants: ["old"] } as const;
    expect(() => selectReviewCases(dataset, { ...setup, manifest: first })).toThrow(/custodian/);
    expect(selectReviewCases(dataset, { ...setup, manifest: first, attemptsDirectory: dir })).toMatchObject({ holdoutRunCount: 1 });
    expect(() => selectReviewCases(dataset, { ...setup, manifest: first, attemptsDirectory: dir })).toThrow(/already has/);
    expect(() => selectReviewCases(dataset, { ...setup, manifest: second, attemptsDirectory: dir })).toThrow(/already has/);
  }));
});

describe("labels and timing", () => {
  it("scores extra alarms and figures under explicit exhaustive coverage", () => {
    const labels = validateReviewLabels({ ...labelBase, exhaustiveEventKinds: ["ramp", "choked"], exhaustiveFigures: true,
      observations: [{ id: "ramp", kind: "ramp", expected: "required" }],
      figures: [{ id: "peak", unit: "bar", value: 6, tolerance: 0 }],
    }, "synthetic");
    const score = scoreReview(labels, { ...dry, events: [{ kind: "ramp" }, { kind: "choked" }, { kind: "unassessed" }],
      figures: [{ id: "peak", unit: "bar", value: 6 }, { id: "invented", unit: "bar", value: 99 }],
    }, [0, 5]);
    expect(score.falseAlarms).toEqual(["choked"]);
    expect(score.unscoredEvents).toBe(1);
    expect(score.figures).toEqual([{ id: "peak", pass: true }, { id: "invented", pass: false }]);
  });

  it("rejects overlapping labels, invalid units, excessive tolerances and cross-kind duplicate IDs", () => {
    const event = { id: "ramp-a", kind: "ramp", expected: "required" };
    expect(() => validateReviewLabels({ ...labelBase, observations: [event, { ...event, id: "ramp-b", expected: "forbidden" }] }, "synthetic")).toThrow(/overlap/);
    for (const figure of [{ id: "f", unit: "banana", value: 5, tolerance: 0 },
      { id: "f", unit: "bar", value: 5, tolerance: 999 }, { id: "ramp-a", unit: "bar", value: 5, tolerance: 0 }]) {
      expect(() => validateReviewLabels({ ...labelBase, observations: [event], figures: [figure] }, "synthetic")).toThrow();
    }
  });

  it("does not tolerate a landmark across the telemetry gap or accept an unobserved raw label", () => {
    const raw = (onsetS: [number, number]) => ({ ...labelBase,
      observations: [{ id: "crest", kind: "crest", expected: "required", timing: { type: "raw-landmark", onsetS } }],
    });
    const labels = validateReviewLabels(raw([2, 2]), "synthetic", [0, 2, 20]);
    expect(scoreReview(labels, { ...dry, events: [{ kind: "crest", onsetS: 18 }] }, [0, 2, 20]).events[0].matched).toBe(false);
    expect(() => validateReviewLabels(raw([10.2, 10.4]), "synthetic", [10, 10.5])).toThrow(/recorded sample/);
  });

  it("minimizes total timing error after matching the maximum number of events", () => {
    const labels = validateReviewLabels({ ...labelBase,
      observations: [10, 10.25].map((t, i) => ({ id: `event-${i}`, kind: "crest", expected: "required", timing: { type: "windowed-event", onsetS: [t, t] } })),
    }, "synthetic");
    const { events } = scoreReview(labels, { ...dry, events: [{ kind: "crest", onsetS: 10 }, { kind: "crest", onsetS: 11 }] }, []);
    expect(events.map(e => e.onsetErrorS)).toEqual([0, 0.75]);
  });

  it("records legacy peak timing as unassessed even when a peak value exists", () => {
    const shot = reviewFixture("limited-pressure-shortfall");
    const legacy = normalizeLegacyReview({ ...rulesReview(shot), issues: [
      { kind: "pressure_shortfall", what: "Lower pressure during the hold", severity: "caution",
        fromS: 1, toS: 3, evidence: "Pressure in frame 0: target 6 bar, measured 3.8 bar (peak 4 bar)" },
    ] }, shot);
    const labels = validateReviewLabels({ ...labelBase, observations: [
      { id: "with-peak", kind: "pressure_shortfall", expected: "required", timing: { type: "windowed-event", onsetS: [1, 1], peakS: [2, 2] } },
    ] }, "synthetic");
    expect(legacy.figures).toContainEqual({ id: "pressure_shortfall.frame-0.peak", unit: "bar", value: 4 });
    const scored = scoreReview(labels, legacy, [1, 2, 3]);
    expect(scored.events[0]).toMatchObject({ timingUnassessed: true, peakErrorS: null });
    expect(scored.falseAlarms).toEqual([]);
  });
});

it("uses the captured prompt when reporting visibility in an actual mock run", async () => {
  const prompts: string[] = [];
  const subject: LlmProvider = { id: "mock", billing: "test", structured(req) {
    prompts.push(req.prompt);
    return mock.structured(req);
  } };
  const fullTrace = fullReviewTrace(syntheticCase.input);
  const [result] = await runReviewAblation([{ ...syntheticCase, fullTrace }], ["old"], subject);
  expect(result).toMatchObject({ prompt: { runs: 1, promptChars: prompts[0].length } });
});
