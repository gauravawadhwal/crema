import { describe, expect, it } from "vitest";
import { MockProvider, mockBean } from "../server/llm/mock.js";
import type { DialInAdvice, Recipe } from "../server/schema.js";
import { expandBean, expandHistory, lintCases, loadCases, TASKS } from "../evals/lib/dataset.js";
import { changeCount, gradeDialIn, gradeIdentify, gradeRecommend, looseEq, primaryMove } from "../evals/lib/graders.js";
import { judgeChecks } from "../evals/lib/judge.js";
import { lowerIsBetter, packResults, summarize, unpackResults, wilson, type ResultsFile } from "../evals/lib/report.js";
import { rejudge, runCase } from "../evals/lib/tasks.js";
import type { LlmProvider, StructuredRequest } from "../server/llm/types.js";
import { gradeReview } from "../evals/lib/review-grader.js";
import { reviewFixture } from "../evals/lib/review-fixtures.js";
import { rulesReview } from "../server/recommend/review-local.js";

const today = new Date("2026-11-05T08:00:00Z");

describe("eval datasets", () => {
  for (const task of TASKS) {
    it(`${task}: every case parses, lints clean and has a reason`, () => {
      const cases = loadCases(task);
      expect(cases.length).toBeGreaterThanOrEqual(task === "review" ? 16 : 25);
      expect(new Set(cases.map((c) => c.split))).toEqual(new Set(["dev", "holdout"]));
      for (const c of cases) expect(c.why.length).toBeGreaterThan(20);
    });
  }

  it("catches labels that name a profile the catalog doesn't have", () => {
    const problems = lintCases("recommend", [{ id: "x", input: { bean: {} }, expect: { acceptable: ["Adaptive v9"] } }]);
    expect(problems.join()).toMatch(/Adaptive v9/);
  });

  it("expands bean specs with relative roast dates and history", () => {
    const b = expandBean({ sample: "Maple", roastDaysAgo: 10 }, today);
    expect(b.roaster.value).toBe("ONA Coffee");
    expect(b.roastDate).toEqual({ value: "2026-10-26", source: "bag" });
    const h = expandHistory([{ daysAgo: 1, profileTitle: "Londonium" }], today)!;
    expect(h[0].timestamp.slice(0, 10)).toBe("2026-11-04");
  });
});

describe("identify grader", () => {
  const out = () => structuredClone({ ...mockBean("light"), roastDate: { value: null, source: null } });

  it("fails the case when a roast date is invented", () => {
    const b = out();
    b.roastDate = { value: "2026-10-01", source: "inferred" };
    const g = gradeIdentify({ roaster: "Example", roastDate: null }, b);
    expect(g.pass).toBe(false);
    expect(g.checks.find((c) => c.name === "roastDate.notInvented")).toMatchObject({ pass: false, critical: true });
  });

  it("matches loosely and scores tasting-note recall", () => {
    const g = gradeIdentify({ roaster: "example roasters", name: "Kii", country: ["Kenia", "Kenya"], tastingNotes: ["blackcurrant", "grapefruit", "jasmine"], roastDate: null }, out());
    expect(g.pass).toBe(true);
    expect(g.checks.find((c) => c.name === "tastingNotes")!.score).toBeCloseTo(2 / 3);
    expect(looseEq("Röstwerk Elbufer", "rostwerk")).toBe(true);
  });

  it("flags prompt-injection text that leaks into the output", () => {
    const b = out();
    b.sources.push("https://best-coffee-deals.example/promo");
    expect(gradeIdentify({ forbiddenText: ["best-coffee-deals"] }, b).pass).toBe(false);
  });
});

describe("recommend grader", () => {
  const recipe: Recipe = {
    profileTitle: "Londonium", profileId: null, doseG: 18, yieldG: 40, tempC: 90, targetTimeS: [30, 45], grindHint: "", restAdvice: null,
    dialIn: "Grind for 40 s.", rationale: ["Holds up in milk", "Written for medium roasts"], alternatives: [{ profileTitle: "D-Flow / default", why: "scale-driven" }],
  };
  const c = { id: "t", split: "dev", tags: [], why: "test case for the grader", input: { bean: {}, preferences: {} }, expect: { acceptable: ["Londonium"], forbidden: ["Rao Allongé"] } } as never;
  const candidates = [{ title: "Londonium", doseG: 18, yieldG: 42, tempC: 90 }, { title: "D-Flow / default", doseG: 18, yieldG: 40, tempC: 88 }];

  it("passes an acceptable, sane recipe", () => {
    expect(gradeRecommend(c, recipe, { candidates, source: "claude-cli", rawProfileTitle: "Londonium" }).pass).toBe(true);
  });

  it("fails when the model named a profile it wasn't offered, even though Crema fell back", () => {
    const g = gradeRecommend(c, recipe, { candidates, source: "rules (model chose an unknown profile)", rawProfileTitle: "Super Turbo" });
    expect(g.pass).toBe(false);
    expect(g.checks.filter((x) => !x.pass).map((x) => x.name)).toEqual(["modelAnswered", "validChoice"]);
  });
});

describe("dial-in grader", () => {
  const advice = (a: Partial<DialInAdvice>): DialInAdvice => ({ change: "Grind finer", grindDelta: "same", yieldDeltaG: 0, tempDeltaC: 0, switchProfile: null, reasoning: "", ...a });

  it("reduces advice to one move, grind first", () => {
    expect(primaryMove(advice({ grindDelta: "much-finer" }))).toBe("finer");
    expect(primaryMove(advice({ yieldDeltaG: -3 }))).toBe("yield-down");
    expect(primaryMove(advice({ switchProfile: "Londonium" }))).toBe("switch");
    expect(primaryMove(advice({}))).toBe("keep");
    expect(changeCount(advice({ grindDelta: "finer", tempDeltaC: 1 }))).toBe(2);
  });

  it("fails two changes at once and made-up profiles", () => {
    const c = { expect: { accept: ["finer"] } } as never;
    expect(gradeDialIn(c, advice({ grindDelta: "finer", tempDeltaC: 1 }), { fellBack: false }).pass).toBe(false);
    expect(gradeDialIn(c, advice({ grindDelta: "finer" }), { fellBack: false }).pass).toBe(true);
    const hack = gradeDialIn({ expect: { accept: ["switch"] } } as never, advice({ switchProfile: "Hack Mode" }), { fellBack: false });
    expect(hack.checks.find((x) => x.name === "validSwitch")!.pass).toBe(false);
  });
});

describe("judge checks", () => {
  it("does not let high scores hide an unusable next step in a judged review", () => {
    const verdict = { contradictions: [], inventedFigures: [], specificity: 5, actionable: 1, plainLanguage: 5, comment: "No useful next decision." };
    const checks = judgeChecks(verdict, true);
    expect(checks.find(c => c.name === "judge.quality")?.pass).toBe(true);
    expect(checks.find(c => c.name === "judge.actionable")).toMatchObject({ pass: false, critical: true });
    expect(judgeChecks(verdict).every(c => !c.critical)).toBe(true);
  });
  it("never decide the pass, only the score", () => {
    const checks = judgeChecks({
      contradictions: [{ answerSays: "about four days into this bag", inputSays: "No roast date" }],
      inventedFigures: ["first drips at 8–12 s", "peak at 9 bar"],
      specificity: 4, actionable: 4, plainLanguage: 5, comment: "none",
    });
    expect(checks.every((c) => !c.critical)).toBe(true);
    expect(checks.find((c) => c.name === "judge.noContradictions")!.detail).toContain("No roast date");
    expect(checks.find((c) => c.name === "judge.noInventedFigures")!.score).toBeCloseTo(1 / 3);
  });
});

describe("harness", () => {
  it("grades review fallback honestly and rejects invented findings or multiple changes", async () => {
    const c = loadCases("review").find(x => x.id === "review-clean")!;
    const out = rulesReview(reviewFixture("clean"));
    expect(gradeReview(c, out).pass).toBe(true);
    expect(gradeReview(c, out, { fellBack: true }).pass).toBe(false);
    expect(gradeReview(c, { ...out, issues: [{ kind: "choked", what: "Choked", evidence: "invented", severity: "warning", fromS: 0, toS: 500 }] }).pass).toBe(false);
    expect(gradeReview(c, { ...out, nextShot: { change: "two changes", grindDelta: "finer", yieldDeltaG: 3, tempDeltaC: 0, switchProfile: null, reasoning: "" } }).pass).toBe(false);
    const run = await runCase("review", c, { kind: "rules" }, 0, { today });
    expect(run.grade.pass).toBe(true);
    expect(summarize("review", [run]).headline["no false alarms"]).toBe(1);
  });

  it("rejects keyword padding and header readbacks instead of calling them insightful", () => {
    const c = loadCases("review").find(x => x.id === "review-fast-time")!;
    const good = rulesReview(reviewFixture("fast-time"));
    for (const summary of ["Pressure.", "Target window fast pressure flow.", "36 g from 18 g in 19 s; pressure 7.8 bar."]) {
      const grade = gradeReview(c, { ...good, summary, nextShot: { ...good.nextShot!, reasoning: "target" } });
      expect(grade.pass).toBe(false);
      expect(grade.checks.find(x => x.name === "paceComparison")?.pass).toBe(false);
      expect(grade.checks.find(x => x.name === "grindDirectionMatchesIssue")?.pass).toBe(false);
    }
  });

  it("requires a correctly grounded pace verdict, without requiring one prose template", () => {
    const c = loadCases("review").find(x => x.id === "review-fast-time")!;
    const good = rulesReview(reviewFixture("fast-time"));
    for (const summary of [
      "The shot was faster than expected: 19 s rather than the 28–34 s window.",
      "Finishing 9 seconds below the expected window suggests too little resistance.",
      "The shot finished 9 seconds before the expected window.",
    ]) expect(gradeReview(c, { ...good, summary }).checks.find(x => x.name === "paceComparison")?.pass).toBe(true);
    for (const summary of [
      "The shot was slower than the 28–34 s expected window, at 19 s.",
      "The shot was faster than expected, taking 60 s against the 28–34 s window.",
      "At 19 s, the shot was faster than the 90–99 s target window.",
      "At 19 s the shot was not faster than the 28–34 s expected window.",
    ]) expect(gradeReview(c, { ...good, summary }).checks.find(x => x.name === "paceComparison")?.pass).toBe(false);
  });

  it("accepts valid comparisons and descriptive grind language across natural phrasing", () => {
    const cases = loadCases("review");
    const slow = cases.find(x => x.id === "review-slow-time")!;
    const out = rulesReview(reviewFixture("slow-time"));
    const phrased = { ...out, summary: "The 44 s shot ran 10 s past the 28–34 s window.", nextShot: { ...out.nextShot!, reasoning: "The low flow suggests the current grind may be finer than ideal. Try one small step coarser on the next shot and check whether flow opens up." } };
    expect(gradeReview(slow, phrased).checks.filter(x => ["paceComparison", "directionConsistent"].includes(x.name)).every(x => x.pass)).toBe(true);
    const short = cases.find(x => x.id === "review-limited-pressure-shortfall")!;
    const recorded = rulesReview(reviewFixture("limited-pressure-shortfall"));
    for (const summary of [
      "The 6 bar pour never reached target. Pressure sat at 3.8 bar while flow held at its limit.",
      "During the 6 bar step, pressure stayed at 3.8 bar while flow was held at the 2.2 ml/s limiter, consistent with low puck resistance.",
    ]) expect(gradeReview(short, { ...recorded, summary }).checks.find(x => x.name === "targetComparison")?.pass).toBe(true);
    const modest = cases.find(x => x.id === "review-limited-pour")!;
    expect(gradeReview(modest, { ...rulesReview(reviewFixture("limited-pour")), summary: "Pour pressure averaged 5.5 bar against a 6 bar target, a modest 0.5 bar shortfall with no fault finding." }).checks.find(x => x.name === "targetComparison")?.pass).toBe(true);
    const history = cases.find(x => x.id === "review-history-same-grind-drift")!;
    expect(gradeReview(history, { ...rulesReview(reviewFixture("history-same-grind-drift")), summary: "The current shot took 30 s. The previous shot at the same 9.75 grind ran 24 s, so the 6 s difference has no recorded setting change to explain it." }).checks.find(x => x.name === "historyComparison")?.pass).toBe(true);
    const notes = cases.find(x => x.id === "review-notes-sour")!;
    const sour = rulesReview(reviewFixture("notes-sour"));
    expect(gradeReview(notes, { ...sour, nextShot: { change: "One small finer step", grindDelta: "finer", yieldDeltaG: 0, tempDeltaC: 0, switchProfile: null, reasoning: "The notes report sharp sourness and a thin finish, and a finer grind is the usual small adjustment for that pattern. On the next shot, check whether sourness softens." } }).checks.find(x => x.name === "grindDirectionMatchesIssue")?.pass).toBe(true);
  });

  it("allows a gusher control check without accepting generic or ungrounded abstention", () => {
    const c = loadCases("review").find(x => x.id === "review-gusher")!;
    const base = rulesReview(reviewFixture("gusher"));
    const withSummary = (summary: string) => gradeReview(c, { ...base, summary, nextShot: null });
    for (const summary of [
      "Flow doubled the commanded 2 ml/s target, and yield overshot 38 g. Verify the profile's flow control and scale-stop settings before changing the grind.",
      "The 81 g yield exceeded its target before the machine ended. Check that scale-stop is enabled and repeat with the same recipe before attributing this to grind.",
      "The pour averaged 4 ml/s against a 2 ml/s flow target and ended at 81 g against 38 g. Check the scale connection and weight-stop settings, then repeat.",
    ]) expect(withSummary(summary).pass).toBe(true);
    for (const summary of [
      "Taste it before deciding whether to change the grind.",
      "Flow doubled the commanded target; taste the shot before adjusting anything.",
      "Check scale-stop settings before adjusting the grind.",
      "Flow was 1 ml/s against a 1 ml/s target. Check scale-stop settings.",
    ]) expect(withSummary(summary).checks.find(x => x.name === "controlMismatchCheck")?.pass).toBe(false);
    const padded = gradeReview(c, { ...base, nextShot: { ...base.nextShot!, reasoning: "Target target target target target target because target." } });
    expect(padded.checks.find(x => x.name === "grindDirectionMatchesIssue")?.pass).toBe(false);
  });

  it("rejects wrong pressure numbers, a wrong tracking verdict and opposite action prose", () => {
    const c = loadCases("review").find(x => x.id === "review-limited-pressure-shortfall")!;
    const good = rulesReview(reviewFixture("limited-pressure-shortfall"));
    for (const summary of [
      "Pressure fell below its 6 bar target, averaging 5.8 bar.",
      "Pressure met the 6 bar target, averaging 3.8 bar.",
      "Pressure only reached 6 bar against the 3.8 bar target.",
    ]) {
      const out = { ...good, summary, nextShot: { ...good.nextShot!, reasoning: "A fast shot suggests lower resistance; a small finer step should slow it." } };
      expect(gradeReview(c, out).checks.find(x => x.name === "targetComparison")?.pass).toBe(false);
    }
    const opposite = { ...good, nextShot: { ...good.nextShot!, change: "Grind coarser" } };
    expect(gradeReview(c, opposite).checks.find(x => x.name === "directionConsistent")?.pass).toBe(false);
    const padding = { ...good, nextShot: { ...good.nextShot!, reasoning: "The target target target target target target matters because the target is a target." } };
    expect(gradeReview(c, padding).checks.find(x => x.name === "grindDirectionMatchesIssue")?.pass).toBe(false);
  });

  it("requires recorded history comparisons and useful abstention instead of empty caution", () => {
    const c = loadCases("review").find(x => x.id === "review-history-grind-progress")!;
    const base = rulesReview(reviewFixture("history-grind-progress"));
    const check = (summary: string) => gradeReview(c, { ...base, summary }).checks.find(x => x.name === "historyComparison")?.pass;
    expect(check("After the recorded grind setting changed, duration rose from the previous 22 s to 30 s at the same recipe.")).toBe(true);
    expect(check("Previous pressure was good. The grind target is useful.")).toBe(false);
    expect(check("After the recorded grind setting changed, duration rose from the previous 40 s to 30 s.")).toBe(false);
    const missing = loadCases("review").find(x => x.id === "review-no-data")!;
    const out = rulesReview(reviewFixture("no-data"));
    const abstain = (summary: string) => gradeReview(missing, { ...out, summary }).checks.find(x => x.name === "usefulAbstention")?.pass;
    expect(abstain("There is not enough telemetry.")).toBe(false);
    expect(abstain("There is not enough recorded telemetry; check the recording connection and repeat before changing the grind.")).toBe(true);
  });

  it("judges and rejudges a shot review against the actual shipped prompt", async () => {
    const seen: string[] = [];
    const judgeProvider: LlmProvider = {
      id: "mock", billing: "test",
      async structured(req: StructuredRequest<any>) {
        seen.push(req.prompt);
        return req.schema.parse({ contradictions: [], inventedFigures: [], specificity: 3, actionable: 3, plainLanguage: 4, comment: "test verdict" });
      },
    };
    const c = loadCases("review").find(x => x.id === "review-history-grind-progress")!;
    const run = await runCase("review", c, { kind: "llm", provider: new MockProvider() }, 0, { today, judge: judgeProvider });
    expect(run.calls).toHaveLength(1);
    expect(run.calls[0].schemaName).toBe("ShotReview");
    expect(run.calls[0].prompt).toContain("HISTORY COMPARISON");
    expect(run.calls[0].prompt).toContain('"previousDurationS":22');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain(run.calls[0].prompt);
    expect(seen[0]).not.toContain("flat-pressure-v1");
    await rejudge("review", run, judgeProvider);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toContain(run.calls[0].prompt);
    expect(run.judge?.comment).toBe("test verdict");
    expect(run.judgeCalls).toHaveLength(1);
    const summary = summarize("review", [run]);
    expect(summary.headline["judge: diagnostic quality"]).toBe(1);
    expect(summary.headline["grounded history comparison"]).toBe(0);
    const historicalText = "HISTORICAL FIELD GUIDE: sourBitter -2 means sour; +2 means bitter. Example only: 77 s is not this case's time.";
    const saved: ResultsFile = {
      meta: { task: "review", subject: "mock", provider: "mock", model: null, judge: "mock", startedAt: today.toISOString(), git: { commit: "test", dirty: false }, repeats: 1, filter: null, prompts: { historical: { schemaName: "ShotReview", text: historicalText } } },
      summary, records: [{ ...run, calls: [{ ...run.calls[0], systemHash: "historical" }] }],
    };
    const loaded = unpackResults(JSON.parse(JSON.stringify(packResults(saved))));
    await rejudge("review", loaded.records[0], judgeProvider, loaded.meta.prompts);
    expect(seen[2]).toContain(historicalText);
    expect(seen[2]).toContain(run.calls[0].prompt);
    expect(seen[2]).not.toContain("You help a Decent DE1 owner decide");
  });

  it("runs the rules baseline and grades it", async () => {
    const [c] = loadCases("dialin").filter((x) => x.id === "dial-sour-fast");
    const r = await runCase("dialin", c, { kind: "rules" }, 0, { today });
    expect(r.grade.pass).toBe(true);
    expect(r.grade.labels.move).toBe("finer");
  });

  it("runs a provider through the real pipeline and records the call", async () => {
    const [c] = loadCases("recommend").filter((x) => x.id === "rec-ona-maple-milk");
    const r = await runCase("recommend", c, { kind: "llm", provider: new MockProvider() }, 0, { today });
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].schemaName).toBe("Recipe");
    expect(r.grade.checks.find((x) => x.name === "validChoice")!.pass).toBe(true);
    const s = summarize("recommend", [r]);
    expect(s.headline["acceptable profile"]).toBe(1);
    expect(s.headline["forbidden profile"]).toBe(0);
  });

  it("feeds fixtures (pages and photos) to identify", async () => {
    const [c] = loadCases("identify").filter((x) => x.id === "id-bag-vs-page-conflict");
    const r = await runCase("identify", c, { kind: "llm", provider: new MockProvider() }, 0, { today });
    expect(r.calls[0]).toMatchObject({ images: 1, web: false });
    expect(r.calls[0].prompt).toContain("<page>");
    expect(r.grade.pass).toBe(false); // the mock doesn't read anything
  });

  it("knows which headlines are failure rates, for the regression gate", () => {
    expect(lowerIsBetter("identify", "roast date invented")).toBe(true);
    expect(lowerIsBetter("recommend", "forbidden profile")).toBe(true);
    expect(lowerIsBetter("recommend", "judge: no invented figures")).toBe(false);
    expect(lowerIsBetter("dialin", "right move")).toBe(false);
  });

  it("gives honest confidence intervals for small samples", () => {
    const [lo, hi] = wilson(9, 10);
    expect(lo).toBeLessThan(0.6);
    expect(hi).toBeGreaterThan(0.95);
  });
});
