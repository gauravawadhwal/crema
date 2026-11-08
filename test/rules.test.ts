import { describe, expect, it } from "vitest";
import { mockBean } from "../server/llm/mock.js";
import { extractJson } from "../server/llm/types.js";
import { rulesDialIn, rulesRecipe } from "../server/recommend/index.js";
import { baseline } from "../server/recommend/rules.js";
import type { BeanInfo } from "../server/schema.js";

const today = new Date("2026-11-05T08:00:00Z");
// No roast date by default so rest status does not shift temperatures.
const bean = (over: Partial<BeanInfo> = {}): BeanInfo => ({ ...mockBean("light"), roastDate: { value: null, source: null }, ...over });
const titles = ["Default", "Londinium", "Adaptive v2", "Blooming espresso", "Turbo shot"];

describe("baseline", () => {
  it("runs light roasts hot and long", () => {
    const b = baseline(bean({ roastLevel: { value: "light", source: "web" }, processKind: "washed", altitudeMasl: { value: [1700], source: "web" } }), { today });
    expect(b.tempC).toBe(94);
    expect(b.ratio).toBe(2.5);
    expect(b.yieldG).toBe(45);
    expect(b.grindHint).toMatch(/finer/);
  });

  it("runs dark naturals cool and short", () => {
    const b = baseline(bean({ roastLevel: { value: "dark", source: "web" }, processKind: "natural", altitudeMasl: { value: null, source: null } }), { today });
    expect(b.tempC).toBe(87);
    expect(b.ratio).toBe(1.8);
    expect(b.grindHint).toMatch(/coarser/);
  });

  it("bumps dense high-grown coffee", () => {
    const b = baseline(bean({ roastLevel: { value: "light", source: "web" }, processKind: "washed", altitudeMasl: { value: [2000, 2200], source: "web" } }), { today });
    expect(b.tempC).toBe(94.5);
  });

  it("tracks rest from the roast date", () => {
    const fresh = baseline(bean({ roastLevel: { value: "light", source: "web" }, roastDate: { value: "2026-11-01", source: "bag" } }), { today });
    expect(fresh.rest.status).toBe("resting");
    expect(fresh.rest.daysOffRoast).toBe(4);
    const peak = baseline(bean({ roastLevel: { value: "light", source: "web" }, roastDate: { value: "2026-10-15", source: "bag" } }), { today });
    expect(peak.rest.status).toBe("peak");
    const none = baseline(bean({ roastDate: { value: null, source: null } }), { today });
    expect(none.rest.status).toBe("unknown");
  });

  it("guesses light for filter roasts with no stated level", () => {
    const b = baseline(bean({ roastLevel: { value: null, source: null }, roastedFor: "filter" }), { today });
    expect(b.roast).toBe("light");
  });
});

describe("recipes", () => {
  it("prefers the roaster's published recipe on conventional profiles", () => {
    const r = rulesRecipe({ bean: mockBean("dark blend"), preferences: { drink: "milk" } });
    expect(r.doseG).toBe(18);
    expect(r.yieldG).toBe(38);
  });

  it("only ever picks a profile that is installed", () => {
    const r = rulesRecipe({ bean: mockBean("light"), profileTitles: ["Default", "Londonium"] });
    expect(["Default", "Londonium"]).toContain(r.profileTitle);
  });
});

describe("dial-in rules", () => {
  const recipe = { ...rulesRecipe({ bean: mockBean("light") }), targetTimeS: [25, 40] };
  it("sour → finer", () => {
    expect(rulesDialIn({ sourBitter: -1, body: 0, enjoyment: 6, notes: null }, { timestamp: "", timeS: 30 }, recipe).grindDelta).toBe("finer");
  });
  it("bitter and slow → much coarser", () => {
    expect(rulesDialIn({ sourBitter: 1, body: 0, enjoyment: 4, notes: null }, { timestamp: "", timeS: 50 }, recipe).grindDelta).toBe("much-coarser");
  });
  it("balanced → keep it", () => {
    expect(rulesDialIn({ sourBitter: 0, body: 0, enjoyment: 10, notes: null }, { timestamp: "", timeS: 30 }, recipe).change).toMatch(/Keep/);
  });
});

describe("extractJson", () => {
  it("reads fenced and bare JSON", () => {
    expect(extractJson('Here:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('sure {"a":{"b":2}} done')).toEqual({ a: { b: 2 } });
  });
});
