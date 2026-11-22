import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import controls from "../evals/fixtures/review-coach-judge/v3-controls.json";
import { compareEpisodes, type Episode } from "../evals/lib/iteration/compare.js";
import { digest } from "../evals/lib/iteration/candidate.js";
import { seededDev, syntheticPanel } from "../evals/lib/iteration/panel.js";
import { scoreEpisode } from "../evals/lib/iteration/score.js";
import { judgeReview, reviewJudgeEvidence, reviewJudgeProvenance, reviewJudgeStatus, reviewRubric } from "../evals/lib/judge.js";
import { runReviewAblation } from "../evals/lib/review-ablation.js";
import { coachExpectation } from "../evals/lib/review-coach-expectations.js";
import { authoredCoachRows, coachCard, coachFirstPart, coachTasteViolations, gradeCoachCard, scoreCoachTruth } from "../evals/lib/review-coach-grader.js";
import { assertCoachTasteInvariant } from "../evals/lib/review-crossed.js";
import { loadIndependentReviewDataset } from "../evals/lib/review-independent.js";
import { ProviderChain } from "../server/llm/index.js";
import { MockProvider } from "../server/llm/mock.js";
import type { StructuredRequest } from "../server/llm/types.js";
import { rulesReviewResult } from "../server/recommend/review-local.js";
import type { CoachReview } from "../server/recommend/review-types.js";
import type { z } from "zod";

const independent = loadIndependentReviewDataset().cases;
const fixture = (id: string) => independent.find(c => c.id === id)!;
const grade = (id: string, change: (coach: CoachReview) => void) => {
  const { input } = fixture(id);
  const result = rulesReviewResult(input);
  const reference = structuredClone(result.coach);
  change(result.coach);
  return gradeCoachCard(result, input, reference);
};

describe("version 4 structure and surface checks", () => {
  it("agrees with the rendered section order and omits absent sections", () => {
    const { input } = fixture("a1");
    const source = readFileSync(new URL("../skin/app.js", import.meta.url), "utf8");
    const render = runInNewContext(source.slice(source.indexOf("function coachReviewHtml("), source.indexOf("function reviewHtml(")) +
      "\ncoachReviewHtml", { reviewRecipeMatches: () => false, S: {}, esc: String }) as (coach: CoachReview, shot: object) => string;
    const coach = rulesReviewResult(input).coach;
    expect(Object.keys(coachCard(coach))).toEqual(["headline", "stages", "notable", "hypotheses", "recommendation"]);
    const html = render(coach, {});
    const positions = ["coach-headline", "Start-up", "Main pour", "Temperature", "Worth noting", "Easy flow", "What to try"].map(s => html.indexOf(s));
    expect(positions[0]).toBeGreaterThan(-1);
    expect(positions.slice(1).every((pos, i) => pos > positions[i])).toBe(true);
    expect(html).not.toMatch(/Your tasting|Compared with/);
    const taste = rulesReviewResult({ ...input, feedback: { sourBitter: -2, body: -1, enjoyment: 3, notes: null } }).coach;
    expect(render(taste, {}).indexOf("Your tasting")).toBeLessThan(render(taste, {}).indexOf("What to try"));
    expect(grade("a1", row => { row.stages.reverse(); row.headline.sentence = ""; })).toMatchObject({
      structural: expect.arrayContaining(["headline", "stage-order-or-coverage"]),
    });
    expect(grade("a1", row => { Reflect.deleteProperty(row, "headline"); }).structural).toContain("coach-schema");
    expect(grade("a1", row => { row.history = { sentence: "Your earlier shot ran slower.", evidenceIds: ["history"] }; }).structural)
      .toContain("irrelevant-history");
  });

  it("rejects unsupported prose, extra advice, unbounded changes and puck diagnosis", () => {
    const flaws = grade("a1", row => {
      row.stages[0].sentence = "Plan: 4.5 mL/s. Recorded: 4.5 mL/s.";
      row.headline.sentence = "You held the pressure and the coffee tasted sweet.";
      row.hypotheses[0].label = "";
      row.hypotheses[0].sentence = "This could mean you must have cracked the puck.";
      row.recommendation.action = "Fix the uneven distribution with a new tool.";
      row.recommendation.puckCheck = "even_distribution";
      row.recommendation.adjustment = { grindDelta: "much-finer", yieldDeltaG: 12, tempDeltaC: 4, switchProfile: "Unknown",
        change: "", reasoning: "" };
    });
    expect(flaws.style).toEqual(expect.arrayContaining(["agency.headline", "numeric-readback.stage-1"]));
    expect(flaws.structural).toEqual(expect.arrayContaining(["stage-sentence.stage-1", "unlabelled-or-unhedged-hypothesis",
      "recommendation-bounds", "puck-preparation-vocabulary"]));
    expect(flaws.grounding).toContain("definite-diagnosis.hypothesis-1");
    expect(flaws.taste).toContain("taste-in-mechanics.headline");
    expect(grade("a1", row => { row.recommendation.compare = "Raise the temperature before the repeat."; }).structural)
      .toContain("recommendation-action");
    expect(grade("a1", row => {
      row.recommendation = { action: "Check for even distribution before you tamp.", expect: "Look for a more consistent pour.",
        compare: "Keep dose and yield fixed.", puckCheck: "even_distribution", adjustment: null };
    }).structural).toEqual([]);
  });

  it.each(["peak", "derivative", "slope", "resistance proxy", "cap-like", "conductance"])("flags %s in displayed text", word => {
    expect(grade("a1", row => { row.headline.sentence = `The ${word} changed.`; }).style).toContain("jargon.headline");
  });

  it("grounds key figures by slot, order, unit, role and evidence ID", () => {
    const rewrite = (sentence: string) => grade("a1", row => {
      row.notable.find(n => n.sentence.includes("4.5 mL/s"))!.sentence = sentence;
    }).grounding;
    expect(rewrite("The machine held 4.5 mL/s and reached 3.6 bar below its 8.6 bar ceiling.")).toEqual([]);
    for (const wrong of [
      "The machine held 4.5 mL/s and reached 3.6 bar below its 8.6 bar target.",
      "The machine held 4.5 mL/s with a ceiling of 3.6 bar and reached 8.6 bar.",
      "The machine held 4.5 mL/s and reached 3.6 bar below its 8.6 mL/s ceiling.",
      "The machine held 4.5 mL/s and reached 3.6 bar below its 8.6 bar ceiling in 99 s.",
      "The machine held 4.5 mL/s and reached 3.6 bar below its 8.6 bar ceiling in phase 2.",
      "The machine held 4.5 mL/s and reached 3.6 bar below its 8.6 bar ceiling for ten seconds.",
    ]) expect(rewrite(wrong)).toContain("figures-or-role.notable-2");
    expect(grade("a1", row => { row.notable[1].evidenceIds = ["recording", "invented-id"]; }).grounding)
      .toContain("evidence-ids.notable-2");
  });
});

describe("synthetic plan truth", () => {
  it("covers all seeded templates and independently authored records", () => {
    const { dataset } = seededDev([], 2);
    expect(dataset.cases.length).toBeGreaterThanOrEqual(84);
    expect(independent).toHaveLength(12);
    for (const c of [...dataset.cases, ...independent]) {
      const truth = coachExpectation(c.id, c.labels, c.input.profile);
      expect(truth, c.id).toBeDefined();
      expect(truth!.stages.flatMap(s => s.frames), c.id).toEqual(c.input.profile!.steps!.map((_, i) => i));
    }
  });

  it("separates the controlled channel, the taste signature and the reason for abstention", () => {
    const tracked = fixture("a1"), capped = fixture("a2"), stopped = fixture("f2");
    const score = (c: typeof tracked, coach: CoachReview = rulesReviewResult(c.input).coach) =>
      scoreCoachTruth(coach, coachExpectation(c.id, c.labels, c.input.profile))!;
    expect(score(tracked).stages[1]).toMatchObject({ expected: "on_plan", actual: "on_plan" });
    expect(score(tracked).hypotheses).toEqual([{ id: "easy-flow", pass: true }]);
    expect(score(capped).stages[1]).toMatchObject({ expected: "partly", actual: "partly" });
    expect(score(capped).hypotheses).toEqual([{ id: "restricted-flow", pass: false }]);
    const capReview = rulesReviewResult(capped.input).coach;
    capReview.hypotheses = [{ id: "restricted-flow", label: "Restricted flow", signature: "bitter_heavy",
      sentence: "This fits a restricted pour.", evidenceIds: ["phase-1"], confidence: "low" }];
    expect(score(capped, capReview).hypothesisSetCorrect).toBe(true);
    capReview.hypotheses[0].signature = "sour_thin";
    expect(score(capped, capReview).hypothesisSetCorrect).toBe(false);
    const truncation = rulesReviewResult(stopped.input).coach;
    expect(score(stopped, truncation).abstentions).toEqual([{ id: "planned-2", pass: false }]);
    truncation.stages[1].phaseIds = ["planned-1"];
    truncation.stages.push({ name: "Finish", verdict: "not_graded", phaseIds: ["planned-2"], evidenceIds: ["finish"],
      sentence: "The shot reached target weight before the planned finish." });
    expect(score(stopped, truncation).abstentions).toEqual([{ id: "planned-2", pass: true }]);
    truncation.phases[2].sentence = "The machine missed its target.";
    expect(score(stopped, truncation).abstentions).toEqual([{ id: "planned-2", pass: false }]);
  });

  it.each([["a1", 0, "start-up"], ["e1", 1, "bloom"], ["c1", 0, "exit-trigger"]] as const)(
    "checks leniency for %s frame %i", (id, frame, kind) => {
      const c = fixture(id);
      const coach = rulesReviewResult(c.input).coach;
      const truth = coachExpectation(c.id, c.labels, c.input.profile);
      const control = scoreCoachTruth(coach, truth)!;
      expect(control.leniency).toContainEqual({ kind, id: `planned-${frame}`, pass: true });
      coach.phases[frame].verdict = "off_plan";
      expect(scoreCoachTruth(coach, truth)!.leniency).toContainEqual({ kind, id: `planned-${frame}`, pass: false });
    });
});

describe("taste isolation and attribution", () => {
  it("keeps the off-plan card invariant even when an owner enjoyed the shot", async () => {
    const { input } = fixture("a2");
    const bad = rulesReviewResult(input).coach;
    expect(bad.stages.some(s => s.verdict === "partly" || s.verdict === "off_plan")).toBe(true);
    const liked = rulesReviewResult({ ...input, feedback: { sourBitter: 0, body: 0, enjoyment: 10, notes: null } }).coach;
    expect(JSON.stringify(coachFirstPart(liked))).toBe(JSON.stringify(coachFirstPart(bad)));
    await assertCoachTasteInvariant(input, new MockProvider());
  });

  it("distinguishes matches, conflicts, mixed axes and unlinked hypotheses", () => {
    const { input } = fixture("a1");
    for (const [sourBitter, body, expected] of [[-2, -2, "matches"], [0, 1, "does_not_match"],
      [-1, 1, "does_not_match"], [0, 0, "no_link"]] as const) {
      const tasted = { ...input, feedback: { sourBitter, body, enjoyment: 10, notes: null } };
      const { coach } = rulesReviewResult(tasted);
      expect(coach.taste!.links[0].status).toBe(expected);
      expect(coachTasteViolations(coach, tasted)).toEqual([]);
      coach.taste!.reported = "You said it tasted fruity, which fits the easy flow above.";
      expect(coachTasteViolations(coach, tasted)).toContain("taste-report");
    }
    const tasted = { ...input, feedback: { sourBitter: -2, body: -2, enjoyment: 3, notes: null } };
    const { coach } = rulesReviewResult(tasted);
    coach.hypotheses[0].signature = "none";
    expect(coachTasteViolations(coach, tasted)).toContain("taste-link.easy-flow");
    coach.taste!.links[0] = { hypothesisId: "easy-flow", status: "no_link", sentence: null };
    coach.taste!.reported = "You said it tasted sour and thin.";
    expect(coachTasteViolations(coach, tasted)).toEqual([]);
    expect(coachTasteViolations(coach, input)).toEqual(["unrecorded-taste"]);
  });
});

describe("reporting and advisory rubric", () => {
  it("credits accepted rewrites in display order and keeps their citations separate", () => {
    const coach = rulesReviewResult(fixture("a1").input).coach;
    const first = { slot: "headline", text: coach.headline.sentence, evidenceIds: [coach.headline.evidenceIds[0]] };
    const second = { slot: "notable-1", text: coach.notable[0].sentence, evidenceIds: [coach.notable[0].evidenceIds[0]] };
    const rejected = { slot: "stage-1", text: "This did not reach the card.", evidenceIds: ["recording"] };
    const authored = authoredCoachRows(coach, { rewrites: [second, rejected, first] });
    expect(authored).toEqual([first, second]);
  });

  it("reports labelled card metrics and separates model fallback from reviewer credit", async () => {
    class Unavailable extends MockProvider {
      override async structured<T extends z.ZodType>(_request: StructuredRequest<T>): Promise<z.infer<T>> { throw new Error("offline"); }
    }
    const c = fixture("a1");
    const [control] = await runReviewAblation([c], ["two-stage"]);
    const [failed] = await runReviewAblation([c], ["two-stage"], new Unavailable());
    expect(control.status === "ready" && control.summary.coach).toMatchObject({
      agreement: { passed: 2, total: 2 }, hypothesisAccuracy: { passed: 1, total: 1 },
      tasteIsolation: { checked: 5, violations: 0 }, styleViolations: 0, fallback: 0,
    });
    expect(failed.status === "ready" && failed.summary).toMatchObject({
      coach: { fallback: 1, tasteIsolation: { checked: 0, violations: 0 } },
      reviewer: { passed: 0, noModelAnswer: 1 },
    });
  });

  it("rejects taste isolation regressions independently of judge confidence", () => {
    const [c] = syntheticPanel([fixture("a1")], {});
    const result = rulesReviewResult(c.input);
    const score = scoreEpisode(c, result, [], true, { checked: 5, violations: 0 });
    const pins = { subject: "rules", scorer: "test" };
    const baseline: Episode = { id: c.id, repeat: 0, inputHash: c.hash, pairHash: digest(pins), score, source: "rules",
      subjectTokens: 0, ms: 1, narrative: null, judge: { status: "assessed", critical: [], quality: 1 } };
    const candidate = { ...baseline, score: { ...score, coach: { ...score.coach!, isolation: { checked: 5, violations: 1 } } } };
    const comparison = compareEpisodes([c], 1, pins, [baseline], [candidate], "screen", { offline: true, hardJudge: true });
    expect(comparison.failures).toContain("coach taste isolation violation");
    expect(comparison.summaries.candidate.coach.tasteIsolation).toEqual({ checked: 5, violations: 1 });
  });

  it("keeps rubric v2 and sends v3 the identical canonical evidence without calibration labels", async () => {
    const { input } = fixture("a1");
    const evidence = reviewJudgeEvidence(input);
    const v2 = reviewJudgeProvenance(evidence, "v2");
    const v3 = reviewJudgeProvenance(evidence, "v3");
    expect(v2.evidenceDigest).toBe(v3.evidenceDigest);
    expect(v2.rubricDigest).not.toBe(v3.rubricDigest);
    expect(reviewRubric("v3")).toContain(reviewRubric("v2"));
    expect(controls.calibration).toBe("unrun");
    expect(new Set(controls.controls.map(c => c.expected))).toEqual(new Set(["faithful", "flawed"]));
    let prompt = "";
    class ScriptedJudge extends MockProvider {
      override async structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>> {
        prompt = req.prompt;
        expect(req.system).toContain("Coach voice and plain language");
        return req.schema.parse({ contradictions: [], inventedFigures: [], specificity: 4, actionable: 4, plainLanguage: 4, comment: "Mock",
          assessment: { numericEvidence: { status: "fail", findings: [{ answerSays: "not quoted", evidenceId: "recording", reason: "test" }] } } });
      }
    }
    const [{ answer }] = controls.controls;
    const verdict = await judgeReview(new ProviderChain([new ScriptedJudge()]), evidence, answer, "v3");
    expect(JSON.parse(prompt)).toEqual(JSON.parse(JSON.stringify({ caseEvidence: evidence, answer })));
    expect(reviewJudgeStatus(verdict, evidence, answer)).toBe("invalid-citation");
  });
});
