import { describe, expect, it } from "vitest";
import { MockProvider, mockBean } from "../server/llm/mock.js";
import type { DialInAdvice, Recipe } from "../server/schema.js";
import { expandBean, expandHistory, lintCases, loadCases, TASKS } from "../evals/lib/dataset.js";
import { changeCount, gradeDialIn, gradeIdentify, gradeRecommend, looseEq, primaryMove } from "../evals/lib/graders.js";
import { judgeChecks } from "../evals/lib/judge.js";
import { lowerIsBetter, summarize, wilson } from "../evals/lib/report.js";
import { runCase } from "../evals/lib/tasks.js";

const today = new Date("2026-11-05T08:00:00Z");

describe("eval datasets", () => {
  for (const task of TASKS) {
    it(`${task}: every case parses, lints clean and has a reason`, () => {
      const cases = loadCases(task);
      expect(cases.length).toBeGreaterThanOrEqual(25);
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
