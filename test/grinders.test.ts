import { describe, expect, it } from "vitest";
import { grinderList, resolveGrinder, stepGrind, validGrinder, type Grinder } from "../server/shared/grinders.js";

const custom: Grinder = { name: "Workshop grinder", start: -2.75, step: 0.0125, finer: "higher" };

describe("grinder settings", () => {
  it("uses the existing defaults and preserves older settings and rounding", () => {
    expect(resolveGrinder()).toMatchObject({ id: null, start: 10, step: 0.25, finer: "lower" });
    const legacy = resolveGrinder({ grindStart: 18.5, grindStep: 0.1 });
    expect(legacy).toMatchObject({ id: null, start: 18.5, step: 0.1 });
    expect(stepGrind("18.5239", 1, legacy)).toBe("18.624");
    expect(stepGrind("18.5 clicks", -1, legacy)).toBe("18.4");
    expect(stepGrind("unknown", 1, legacy)).toBe("18.5");
  });

  it("resolves both built-ins, or a user-edited preset with the same ID", () => {
    expect(resolveGrinder({ grinderId: "niche-zero" })).toMatchObject({ name: "Niche Zero", start: 10, step: 0.25 });
    expect(resolveGrinder({ grinderId: "lagom-p80" })).toMatchObject({ name: "Lagom P80", start: 1, step: 0.05 });
    const grinders = { "lagom-p80": { name: "Lagom P80", start: 1.1, step: 0.07, finer: "lower" } } satisfies Record<string, Grinder>;
    const edited = resolveGrinder({ grinderId: "lagom-p80", grinders });
    expect(stepGrind("1.1", -1, edited)).toBe("1.03");
  });

  it("accepts custom scales and keeps small increments stable across repeated taps", () => {
    const grinder = resolveGrinder({ grinderId: "custom-example", grinders: { "custom-example": custom } });
    expect(grinder).toEqual({ id: "custom-example", ...custom });
    expect(stepGrind("", -1, grinder)).toBe("-2.75");
    let dial = "-2.75";
    for (let i = 0; i < 20; i++) dial = stepGrind(dial, 1, grinder);
    expect(dial).toBe("-2.5");
  });

  it("ignores invalid saved entries and falls back when a selected grinder was removed", () => {
    expect(validGrinder({ ...custom, name: " " })).toBe(false);
    expect(validGrinder({ ...custom, step: 0 })).toBe(false);
    expect(validGrinder({ ...custom, start: Infinity })).toBe(false);
    expect(validGrinder({ ...custom, step: 0.0000001 })).toBe(false);
    expect(grinderList({ grinders: { broken: { ...custom, step: -1 } } })).not.toHaveProperty("broken");
    expect(resolveGrinder({ grinderId: "deleted", grindStart: 7, grindStep: -1 }))
      .toMatchObject({ id: null, start: 7, step: 0.25 });
  });
});
