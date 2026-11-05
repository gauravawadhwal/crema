import type { ProviderChain } from "../llm/index.js";
import { findProfile } from "../profiles/catalog.js";
import { rankProfiles, type Candidate, type Preferences } from "../profiles/match.js";
import { DialInAdvice, Recipe, type BeanInfo, type TasteFeedback } from "../schema.js";
import { baseline, type Baseline } from "./rules.js";

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

export interface RecommendOutput {
  recipe: Recipe;
  baseline: Baseline;
  candidates: Omit<Candidate, "profile">[];
  source: string;
}

const SYSTEM = `You are an experienced Decent DE1 barista choosing an espresso profile and starting recipe for a specific coffee.

You get: the coffee as the roaster and the bag describe it, a rules-based ranking of community profiles with each profile's own description (from its author), a suggested recipe per profile, the user's setup and preferences, and their past shots of this bag.

How to choose:
- Read the roaster's description (roast level, what it's roasted for, process, tasting notes, blend or single origin, any published recipe) and match it to what each profile is designed to bring out. Trust the profile authors' own guidance over generic rules.
- The rules ranking is a strong prior, not a verdict. Pick a lower-ranked candidate when the coffee's description clearly fits it better, and say why.
- Past shots outrank everything: repeat what scored well, and move away from what didn't.
- profileTitle MUST be one of the candidate titles, copied exactly.
- Keep dose, yield and temperature close to that candidate's suggested recipe unless you have a reason (a roaster recipe, past shots, the milk preference).
- dialIn: specific guidance for this coffee on this profile (targets like dripping weight, flow rate or shot time, and which way to grind first).
- rationale: 2–4 short bullets in plain words that connect the coffee's description to the profile. alternatives: up to 2 other candidates worth trying next, each with a one-line reason.
- grindHint is relative guidance; you don't know the user's grinder numbers unless past shots include them.`;

function strip({ profile: _p, ...rest }: Candidate) {
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

export async function recommend(llm: ProviderChain, input: RecommendInput): Promise<RecommendOutput> {
  const b = baseline(input.bean, { doseG: input.preferences?.basketDoseG });
  const ranked = rankProfiles(input.bean, input.preferences, input.profileTitles);
  const candidates = ranked.filter((c) => c.installed).slice(0, 6);
  const out = (recipe: Recipe, source: string): RecommendOutput => ({ recipe, baseline: b, candidates: ranked.slice(0, 8).map(strip), source });

  if (input.rulesOnly) return out(rulesRecipe(input, ranked), "rules");

  const cards = candidates.map((c, i) => ({
    rank: i + 1,
    title: c.title,
    author: c.profile.author,
    style: c.profile.style,
    writtenFor: c.profile.roasts,
    milk: c.profile.milk,
    emphasises: c.profile.emphasises,
    character: c.profile.character,
    authorGuidance: c.profile.dialIn,
    rulesScore: c.score,
    reasons: c.reasons,
    cautions: c.cautions,
    suggestedRecipe: c.recipe,
  }));
  const prompt = [
    `COFFEE (from the roaster and the bag):\n${JSON.stringify(input.bean)}`,
    `FRESHNESS AND ROAST BASELINE:\n${JSON.stringify({ roast: b.roast, rest: b.rest, grindHint: b.grindHint })}`,
    `CANDIDATE PROFILES (rules ranking, best first):\n${JSON.stringify(cards, null, 1)}`,
    `USER SETUP AND PREFERENCES:\n${JSON.stringify(input.preferences ?? {})}`,
    `PAST SHOTS OF THIS BAG:\n${input.history?.length ? JSON.stringify(input.history.slice(0, 15)) : "none yet"}`,
  ].join("\n\n");

  try {
    const recipe = await llm.structured({ system: SYSTEM, prompt, schema: Recipe, schemaName: "Recipe" });
    const match = candidates.find((c) => c.title.toLowerCase() === recipe.profileTitle.toLowerCase());
    if (!match) return out(rulesRecipe(input, ranked), "rules (model chose an unknown profile)");
    recipe.profileTitle = match.title;
    recipe.alternatives = recipe.alternatives.filter((a) => candidates.some((c) => c.title === a.profileTitle));
    return out(recipe, llm.lastUsed ?? "llm");
  } catch (e) {
    console.warn(`recommend: falling back to rules: ${(e as Error).message}`);
    return out(rulesRecipe(input, ranked), "rules (AI unavailable)");
  }
}

const DIAL_SYSTEM = `You help dial in espresso on a Decent DE1. Suggest exactly ONE change for the next shot, the one most likely to improve it. Use the profile author's own dial-in guidance when it's given. The taste feedback scales: sourBitter runs from -2 (very sour) through 0 (balanced) to +2 (very bitter); body from -2 (thin) through 0 to +2 (heavy); enjoyment from 1 to 5. Read the notes too. Standard logic: sour/thin/fast means under-extracted (grind finer, or raise yield or temperature); bitter/harsh/slow means over-extracted (grind coarser, or lower yield or temperature). Prefer grind changes first, then yield, then temperature. Suggest switching profiles only after several shots that aren't working.`;

export async function dialIn(
  llm: ProviderChain,
  input: { bean: BeanInfo; recipe: Recipe; shot: PastShot; feedback: TasteFeedback; history?: PastShot[] },
): Promise<DialInAdvice> {
  try {
    const guidance = findProfile(input.recipe.profileTitle)?.dialIn ?? null;
    return await llm.structured({
      system: DIAL_SYSTEM,
      prompt: JSON.stringify({ ...input, profileAuthorGuidance: guidance }),
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
    return { change: "Grind finer", grindDelta: f.sourBitter <= -2 || fast ? "much-finer" : "finer", yieldDeltaG: 0, tempDeltaC: 0, switchProfile: null, reasoning: fast ? `Ran fast (${shot.timeS}s against ${tMin}–${tMax}s) and tasted sour: under-extracted.` : "Sour means under-extracted. Finer grinding pulls out more sweetness." };
  }
  if (f.sourBitter >= 1 || (slow && f.sourBitter >= 0)) {
    return { change: "Grind coarser", grindDelta: f.sourBitter >= 2 || slow ? "much-coarser" : "coarser", yieldDeltaG: 0, tempDeltaC: 0, switchProfile: null, reasoning: slow ? `Ran slow (${shot.timeS}s) and tasted bitter: over-extracted.` : "Bitter or harsh means over-extracted." };
  }
  if (f.body <= -1) return { change: "Shorten the yield by 3 g for more body", grindDelta: "same", yieldDeltaG: -3, tempDeltaC: 0, switchProfile: null, reasoning: "Balanced but thin: a tighter ratio adds body." };
  if (f.body >= 2) return { change: "Lengthen the yield by 3 g for more clarity", grindDelta: "same", yieldDeltaG: 3, tempDeltaC: 0, switchProfile: null, reasoning: "Balanced but heavy: a longer ratio opens it up." };
  return { change: "Keep it. You're dialled in.", grindDelta: "same", yieldDeltaG: 0, tempDeltaC: 0, switchProfile: null, reasoning: "Balanced taste and body." };
}
