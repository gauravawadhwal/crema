import { rankProfiles, type Candidate, type Preferences } from "../profiles/match.js";
import type { BeanInfo, DialInAdvice, Recipe, TasteFeedback } from "../schema.js";
import { baseline } from "./rules.js";

/**
 * The parts of recommendation that need no AI and no server. This module is
 * pure (no Node APIs, no runtime zod), so it is bundled into the web app as
 * skin/engine.js (see server/engine.ts) and runs on the tablet when the Crema
 * server is unavailable or AI features are switched off.
 */

export interface PastShot {
  timestamp: string;
  profileTitle?: string;
  doseG?: number;
  yieldG?: number;
  timeS?: number;
  grinderSetting?: string;
  enjoyment?: number;
  notes?: string;
}

export interface RecommendInput {
  bean: BeanInfo;
  /** Titles installed on the machine. Undefined = assume the catalog is installed (Decaid ships it). */
  profileTitles?: string[];
  history?: PastShot[];
  preferences?: Preferences;
  /** Skip the model and return the rules-only recipe. */
  rulesOnly?: boolean;
}

export function strip({ profile: _p, ...rest }: Candidate) {
  return rest;
}

export function rulesRecipe(input: RecommendInput, ranked = rankProfiles(input.bean, input.preferences, input.profileTitles)): Recipe {
  const b = baseline(input.bean, { doseG: input.preferences?.basketDoseG });
  const usable = ranked.filter((c) => c.installed);
  const top = usable[0] ?? ranked[0];
  const r = top.recipe;
  return {
    profileTitle: top.title,
    profileId: null,
    doseG: r.doseG,
    yieldG: r.yieldG,
    tempC: r.tempC,
    targetTimeS: r.timeS,
    grindHint: b.grindHint,
    restAdvice: b.rest.advice,
    dialIn: top.profile.dialIn,
    rationale: [...top.reasons.slice(0, 3), `Recipe from ${r.basis}`].slice(0, 4),
    alternatives: usable.slice(1, 3).map((c) => ({ profileTitle: c.title, why: c.reasons[0] ?? c.profile.character })),
  };
}

export function rulesDialIn(f: TasteFeedback, shot: PastShot, recipe: Recipe): DialInAdvice {
  const [tMin, tMax] = recipe.targetTimeS;
  const fast = shot.timeS != null && shot.timeS < tMin;
  const slow = shot.timeS != null && shot.timeS > tMax;
  if (f.sourBitter <= -1 || (fast && f.sourBitter <= 0)) {
    return { change: "Grind finer", grindDelta: f.sourBitter <= -2 || fast ? "much-finer" : "finer", yieldDeltaG: 0, tempDeltaC: 0, switchProfile: null, reasoning: fast ? `Ran fast (${shot.timeS}s against ${tMin}–${tMax}s) and tasted sour: under-extracted.` : "Sour means under-extracted. Finer grinding pulls out more sweetness." };
  }
  if (f.sourBitter >= 1 || (slow && f.sourBitter >= 0)) {
    return { change: "Grind coarser", grindDelta: f.sourBitter >= 2 || slow ? "much-coarser" : "coarser", yieldDeltaG: 0, tempDeltaC: 0, switchProfile: null, reasoning: slow ? `Ran slow (${shot.timeS}s) and tasted bitter: over-extracted.` : "Bitter or harsh means over-extracted." };
  }
  if (f.body <= -1) return { change: "Shorten the yield by 3 g for more body", grindDelta: "same", yieldDeltaG: -3, tempDeltaC: 0, switchProfile: null, reasoning: "Balanced but thin: a tighter ratio adds body." };
  if (f.body >= 2) return { change: "Lengthen the yield by 3 g for more clarity", grindDelta: "same", yieldDeltaG: 3, tempDeltaC: 0, switchProfile: null, reasoning: "Balanced but heavy: a longer ratio opens it up." };
  return { change: "Keep it. You're dialled in.", grindDelta: "same", yieldDeltaG: 0, tempDeltaC: 0, switchProfile: null, reasoning: "Balanced taste and body." };
}

/** Shot summary from Decaid's shot record. */
export function toPastShot(s: {
  timestamp: string;
  workflow?: { name?: string; profile?: { title?: string }; context?: { targetDoseWeight?: number; targetYield?: number; grinderSetting?: string } };
  annotations?: { actualDoseWeight?: number; actualYield?: number; enjoyment?: number; espressoNotes?: string };
  measurements?: unknown[];
}): PastShot {
  const m = s.measurements as { machine?: { timestamp?: string } }[] | undefined;
  let timeS: number | undefined;
  if (m && m.length > 1) {
    const t0 = Date.parse(m[0].machine?.timestamp ?? "");
    const t1 = Date.parse(m.at(-1)!.machine?.timestamp ?? "");
    if (!Number.isNaN(t0) && !Number.isNaN(t1)) timeS = Math.round((t1 - t0) / 1000);
  }
  return {
    timestamp: s.timestamp,
    profileTitle: s.workflow?.profile?.title ?? s.workflow?.name,
    doseG: s.annotations?.actualDoseWeight ?? s.workflow?.context?.targetDoseWeight,
    yieldG: s.annotations?.actualYield ?? s.workflow?.context?.targetYield,
    timeS,
    grinderSetting: s.workflow?.context?.grinderSetting,
    enjoyment: s.annotations?.enjoyment,
    notes: s.annotations?.espressoNotes,
  };
}

/**
 * Shift every step's temperature so the first step matches the recipe, keeping
 * the profile's own temperature curve (declining-temperature profiles stay
 * declining). This is what the DE1 app does when you change brew temperature.
 */
export function withTemperature(profile: Record<string, unknown>, tempC: number) {
  const steps = Array.isArray(profile.steps) ? (profile.steps as Record<string, unknown>[]) : [];
  const first = Number(steps[0]?.temperature);
  if (!steps.length || !Number.isFinite(first)) return profile;
  const delta = tempC - first;
  return {
    ...profile,
    steps: steps.map((st) => {
      const t = Number(st.temperature);
      return Number.isFinite(t) ? { ...st, temperature: Math.round((t + delta) * 10) / 10 } : st;
    }),
  };
}
