import type { ProviderChain } from "../llm/index.js";
import { DialInAdvice, Recipe, type BeanInfo, type TasteFeedback } from "../schema.js";
import { baseline, rankProfiles, type Baseline } from "./rules.js";

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
  profileTitles: string[];
  history?: PastShot[];
  preferences?: { drink?: "straight" | "milk" | "both"; basketG?: number; grinder?: string };
  /** Skip the model and return the rules-only recipe. */
  rulesOnly?: boolean;
}

const SYSTEM = `You are an experienced Decent DE1 barista. Given a coffee, a rules-based baseline, the user's actual profile library and their past shots of this coffee, pick a starting recipe.

- profileTitle MUST be copied exactly from the provided library. If nothing fits well, pick the closest one and say so in rationale.
- Treat the baseline numbers as a sensible prior. Move away from them only for a reason you can state, such as the roaster's published recipe, a past shot that went well, or the milk preference.
- If the roaster publishes an espresso recipe, weigh it heavily.
- If past shots exist, learn from them: repeat what scored well, and correct what didn't.
- rationale: 2–4 short bullets in plain words. alternatives: up to 2 other library profiles worth trying next.
- grindHint is relative guidance; you don't know the user's grinder numbers unless past shots include them.`;

export function rulesRecipe(input: RecommendInput, b: Baseline = baseline(input.bean, { doseG: input.preferences?.basketG })): Recipe {
  const ranked = rankProfiles(input.profileTitles, b.profileKeywords);
  const pick = ranked[0] ?? input.profileTitles[0] ?? "Default";
  const roasterRecipe = input.bean.roasterRecipe;
  const doseG = roasterRecipe?.doseG ?? b.doseG;
  const yieldG = roasterRecipe?.yieldG ?? b.yieldG;
  return {
    profileTitle: pick,
    profileId: null,
    doseG,
    yieldG,
    tempC: roasterRecipe?.tempC ?? b.tempC,
    targetTimeS: b.targetTimeS,
    grindHint: b.grindHint,
    restAdvice: b.rest.advice,
    rationale: [...b.reasons, ...(roasterRecipe?.doseG ? ["Using the roaster's published dose and yield"] : [])].slice(0, 4),
    alternatives: ranked.slice(1, 3).map((t) => ({ profileTitle: t, why: "Also suits this roast level" })),
  };
}

export async function recommend(llm: ProviderChain, input: RecommendInput): Promise<{ recipe: Recipe; baseline: Baseline; source: string }> {
  const b = baseline(input.bean, { doseG: input.preferences?.basketG });
  if (input.rulesOnly || !input.profileTitles.length) {
    return { recipe: rulesRecipe(input, b), baseline: b, source: "rules" };
  }
  const prompt = [
    `COFFEE:\n${JSON.stringify(input.bean)}`,
    `BASELINE (rules):\n${JSON.stringify(b)}`,
    `PROFILE LIBRARY (choose from these exact titles):\n${input.profileTitles.map((t) => `- ${t}`).join("\n")}`,
    `PAST SHOTS OF THIS COFFEE:\n${input.history?.length ? JSON.stringify(input.history.slice(0, 15)) : "none yet"}`,
    `PREFERENCES:\n${JSON.stringify(input.preferences ?? {})}`,
  ].join("\n\n");

  try {
    const recipe = await llm.structured({ system: SYSTEM, prompt, schema: Recipe, schemaName: "Recipe" });
    // Guard against a made-up profile name.
    if (!input.profileTitles.includes(recipe.profileTitle)) {
      const close = input.profileTitles.find((t) => t.toLowerCase() === recipe.profileTitle.toLowerCase());
      recipe.profileTitle = close ?? rulesRecipe(input, b).profileTitle;
    }
    return { recipe, baseline: b, source: llm.lastUsed ?? "llm" };
  } catch (e) {
    console.warn(`recommend: falling back to rules: ${(e as Error).message}`);
    return { recipe: rulesRecipe(input, b), baseline: b, source: "rules (llm unavailable)" };
  }
}

const DIAL_SYSTEM = `You help dial in espresso on a Decent DE1. Suggest exactly ONE change for the next shot, the one most likely to improve it. Standard logic: sour/thin/fast means under-extracted (grind finer, or raise yield or temperature); bitter/harsh/slow means over-extracted (grind coarser, or lower yield or temperature). Prefer grind changes first, then yield, then temperature. Suggest switching profiles only after several shots that aren't working.`;

export async function dialIn(
  llm: ProviderChain,
  input: { bean: BeanInfo; recipe: Recipe; shot: PastShot; feedback: TasteFeedback; history?: PastShot[] },
): Promise<DialInAdvice> {
  try {
    return await llm.structured({
      system: DIAL_SYSTEM,
      prompt: JSON.stringify(input),
      schema: DialInAdvice,
      schemaName: "DialInAdvice",
    });
  } catch {
    return rulesDialIn(input.feedback, input.shot, input.recipe);
  }
}

export function rulesDialIn(f: TasteFeedback, shot: PastShot, recipe: Recipe): DialInAdvice {
  const [tMin, tMax] = recipe.targetTimeS;
  const fast = shot.timeS != null && shot.timeS < tMin;
  const slow = shot.timeS != null && shot.timeS > tMax;
  if (f.sourBitter <= -1 || (fast && f.sourBitter <= 0)) {
    return { change: "Grind finer", grindDelta: f.sourBitter <= -2 || fast ? "much-finer" : "finer", yieldDeltaG: 0, tempDeltaC: 0, switchProfile: null, reasoning: "Sour or fast means under-extracted." };
  }
  if (f.sourBitter >= 1 || (slow && f.sourBitter >= 0)) {
    return { change: "Grind coarser", grindDelta: f.sourBitter >= 2 || slow ? "much-coarser" : "coarser", yieldDeltaG: 0, tempDeltaC: 0, switchProfile: null, reasoning: "Bitter or slow means over-extracted." };
  }
  if (f.body <= -1) return { change: "Shorten the yield by 3g for more body", grindDelta: "same", yieldDeltaG: -3, tempDeltaC: 0, switchProfile: null, reasoning: "Balanced but thin: a tighter ratio adds body." };
  if (f.body >= 2) return { change: "Lengthen the yield by 3g for more clarity", grindDelta: "same", yieldDeltaG: 3, tempDeltaC: 0, switchProfile: null, reasoning: "Balanced but heavy: a longer ratio opens it up." };
  return { change: "Keep it. This one's dialled in.", grindDelta: "same", yieldDeltaG: 0, tempDeltaC: 0, switchProfile: null, reasoning: "Balanced taste and body." };
}
