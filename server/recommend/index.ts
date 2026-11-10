import type { ProviderChain } from "../llm/index.js";
import { findProfile } from "../profiles/catalog.js";
import { rankProfiles, type Candidate, type Preferences } from "../profiles/match.js";
import { DialInAdvice, Recipe, type BeanInfo, type TasteFeedback } from "../schema.js";
import { baseline, type Baseline } from "./rules.js";
import { rulesDialIn, rulesRecipe, strip, type PastShot, type RecommendInput } from "./local.js";

export { rulesDialIn, rulesRecipe, toPastShot, withTemperature, type PastShot, type RecommendInput } from "./local.js";

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

export async function recommend(llm: ProviderChain, input: RecommendInput): Promise<RecommendOutput> {
  const b = baseline(input.bean, { doseG: input.preferences?.basketDoseG });
  const ranked = rankProfiles(input.bean, input.preferences, input.profileTitles);
  const candidates = ranked.filter((c) => c.installed).slice(0, 6);
  const out = (recipe: Recipe, source: string): RecommendOutput => ({ recipe, baseline: b, candidates: ranked.slice(0, 8).map(strip), source });

  if (input.rulesOnly) return out(rulesRecipe(input, ranked), "rules");
  // Nothing installed matches the catalogue: there is nothing for a model to choose
  // from. The app shows "no recommendation" for a recipe whose profile isn't installed.
  if (!candidates.length) return out(rulesRecipe(input, ranked), "rules (no installed profile matches)");

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
    `PAST SHOTS OF THIS BAG (enjoyment is 0 to 10, 10 best; missing means not rated):\n${input.history?.length ? JSON.stringify(input.history.slice(0, 15)) : "none yet"}`,
  ].join("\n\n");

  try {
    const { value: recipe, provider } = await llm.structuredWithProvider({ system: SYSTEM, prompt, schema: Recipe, schemaName: "Recipe" });
    const match = candidates.find((c) => c.title.toLowerCase() === recipe.profileTitle.toLowerCase());
    if (!match) return out(rulesRecipe(input, ranked), "rules (model chose an unknown profile)");
    recipe.profileTitle = match.title;
    recipe.alternatives = recipe.alternatives.filter((a) => candidates.some((c) => c.title === a.profileTitle));
    return out(recipe, provider);
  } catch (e) {
    console.warn(`recommend: falling back to rules: ${(e as Error).message}`);
    return out(rulesRecipe(input, ranked), "rules (AI unavailable)");
  }
}

const DIAL_SYSTEM = `You help dial in espresso on a Decent DE1. Suggest exactly ONE change for the next shot, the one most likely to improve it. Use the profile author's own dial-in guidance when it's given. The taste feedback scales: sourBitter runs from -2 (very sour) through 0 (balanced) to +2 (very bitter); body from -2 (thin) through 0 to +2 (heavy); enjoyment from 0 to 10 (the user's star rating in half stars, so 10 is five stars; missing or null means they didn't rate it). Read the notes too. Standard logic: sour/thin/fast means under-extracted (grind finer, or raise yield or temperature); bitter/harsh/slow means over-extracted (grind coarser, or lower yield or temperature). Prefer grind changes first, then yield, then temperature. Suggest switching profiles only after several shots that aren't working.`;

export async function dialIn(
  llm: ProviderChain,
  input: { bean: BeanInfo; recipe: Recipe; shot: PastShot; feedback: TasteFeedback; history?: PastShot[] },
): Promise<DialInAdvice> {
  return (await dialInWithSource(llm, input)).advice;
}

export async function dialInWithSource(
  llm: ProviderChain,
  input: { bean: BeanInfo; recipe: Recipe; shot: PastShot; feedback: TasteFeedback; history?: PastShot[] },
): Promise<{ advice: DialInAdvice; source: string }> {
  try {
    const guidance = findProfile(input.recipe.profileTitle)?.dialIn ?? null;
    const { value: advice, provider } = await llm.structuredWithProvider({
      system: DIAL_SYSTEM,
      prompt: JSON.stringify({ ...input, profileAuthorGuidance: guidance }),
      schema: DialInAdvice,
      schemaName: "DialInAdvice",
    });
    return { advice, source: provider };
  } catch (e) {
    console.warn(`dialin: falling back to rules: ${(e as Error).message}`);
    return { advice: rulesDialIn(input.feedback, input.shot, input.recipe), source: "rules" };
  }
}

