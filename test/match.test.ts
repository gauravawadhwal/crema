import { describe, expect, it } from "vitest";
import { mockBean } from "../server/llm/mock.js";
import { CATALOG } from "../server/profiles/catalog.js";
import { beanTraits, rankProfiles, roastTempOffset } from "../server/profiles/match.js";
import type { BeanInfo } from "../server/schema.js";

const s = <T>(value: T) => ({ value, source: "web" as const });
const bean = (o: Partial<BeanInfo>): BeanInfo => ({ ...mockBean("light"), roastDate: { value: null, source: null }, roasterRecipe: null, ...o });

const chocolateBlend = bean({
  roastLevel: s("medium-dark"), processKind: "natural", isBlend: true, roastedFor: "espresso",
  tastingNotes: s(["dark chocolate", "hazelnut", "caramel"]), altitudeMasl: s(null),
});
const floralGeisha = bean({
  roastLevel: s("light"), processKind: "washed", isBlend: false, roastedFor: "filter",
  tastingNotes: s(["jasmine", "bergamot", "peach"]), altitudeMasl: s([1950, 2100]),
});

describe("profile matching", () => {
  it("reads traits from the roaster's tasting notes", () => {
    expect([...beanTraits(chocolateBlend)]).toEqual(expect.arrayContaining(["chocolate", "body", "sweetness"]));
    expect([...beanTraits(floralGeisha)]).toEqual(expect.arrayContaining(["florals", "fruit", "clarity"]));
    expect(beanTraits(bean({ tastingNotes: s(["red currant", "brown sugar"]) })).has("chocolate")).toBe(false);
  });

  it("sends a chocolatey milk blend to a lever profile", () => {
    const top = rankProfiles(chocolateBlend, { drink: "milk" })[0];
    expect(["lever", "flow", "scale-driven"]).toContain(top.profile.style);
    expect(top.profile.milk).toBe("great");
  });

  it("sends a floral light roast to a clarity profile and never a milk-first one", () => {
    const top3 = rankProfiles(floralGeisha, { drink: "straight" }).slice(0, 3);
    for (const c of top3) expect(c.profile.roasts).toContain("light");
    expect(top3.some((c) => ["blooming", "allonge", "adaptive", "low-contact"].includes(c.profile.style))).toBe(true);
  });

  it("never suggests milk-averse profiles for milk drinkers", () => {
    for (const c of rankProfiles(floralGeisha, { drink: "milk" }).slice(0, 3)) expect(c.profile.milk).not.toBe("avoid");
  });

  it("respects the user's setup", () => {
    const noScale = rankProfiles(floralGeisha, { hasScale: false }).slice(0, 3);
    for (const c of noScale) expect(c.profile.needsScale).toBe(false);
    const beginner = rankProfiles(floralGeisha, { experience: "new" })[0];
    expect(beginner.profile.difficulty).not.toBe("advanced");
  });

  it("flags profiles that aren't on the machine", () => {
    const ranked = rankProfiles(chocolateBlend, {}, ["Default"]);
    expect(ranked.find((c) => c.title === "Default")!.installed).toBe(true);
    expect(ranked.find((c) => c.title === "Londonium")!.installed).toBe(false);
  });

  it("brews lighter roasts hotter on the same profile", () => {
    const londonium = CATALOG.find((p) => p.title === "Londonium")!;
    expect(roastTempOffset(londonium, "light")).toBeGreaterThan(0);
    expect(roastTempOffset(londonium, "dark")).toBeLessThan(0);
  });

  it("has unique titles and sane recipes", () => {
    expect(new Set(CATALOG.map((p) => p.title)).size).toBe(CATALOG.length);
    for (const p of CATALOG) {
      expect(p.recipe.yieldG / p.recipe.doseG).toBeGreaterThan(1);
      expect(p.recipe.tempC).toBeGreaterThan(70);
      expect(p.recipe.tempC).toBeLessThan(100);
    }
  });
});
