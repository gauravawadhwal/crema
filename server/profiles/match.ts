import type { BeanInfo, RoastLevel } from "../schema.js";
import { baseline } from "../recommend/rules.js";
import { CATALOG, profileRoastCentre, roastDistance, type CatalogProfile, type Trait } from "./catalog.js";

/**
 * Ranks community profiles for a coffee using what the roaster and the bag say
 * about it: roast level, process, tasting notes, what it's roasted for, blend or
 * single origin, density (altitude) and freshness. Also uses the user's setup:
 * milk or straight, scale, grinder burrs, experience.
 *
 * The ranking is deterministic and explainable. The LLM step (recommend.ts)
 * then chooses among the top candidates, reading the full descriptions.
 */

export interface Preferences {
  drink?: "milk" | "straight" | "both";
  hasScale?: boolean;
  burrs?: "flat" | "conical" | "unknown";
  experience?: "new" | "comfortable" | "advanced";
  basketDoseG?: number;
}

export interface SuggestedRecipe {
  doseG: number;
  yieldG: number;
  tempC: number;
  timeS: [number, number];
  basis: string;
}

export interface Candidate {
  title: string;
  score: number;
  installed: boolean;
  reasons: string[];
  cautions: string[];
  recipe: SuggestedRecipe;
  profile: CatalogProfile;
}

const ORDER: RoastLevel[] = ["light", "medium-light", "medium", "medium-dark", "dark"];

const TRAIT_WORDS: Record<Exclude<Trait, "forgiving" | "texture" | "clarity" | "acidity">, RegExp> = {
  fruit: /berr|currant|cherr|citrus|grapefruit|lime|lemon|orange|mandarin|mango|peach|apricot|apple|pear|plum|raspberr|strawberr|pomegranate|tropical|passion|pineapple|grape|wine|raisin|fig|stone fruit|melon|lychee|candy/i,
  florals: /jasmine|bergamot|rose|floral|lavender|hibiscus|tea|honeysuckle|orange blossom|elderflower/i,
  sweetness: /sugar|honey|caramel|toffee|syrup|molasses|candy|sweet|vanilla|maple|panela|demerara/i,
  chocolate: /chocolate|cocoa|cacao|\bnut|hazelnut|almond|walnut|praline|biscuit|malt|spice|molasses|tobacco/i,
  body: /chocolate|cocoa|syrup|full|heavy|creamy|biscuit|\bnut|malt/i,
};

export function beanTraits(bean: BeanInfo): Set<Trait> {
  const notes = (bean.tastingNotes.value ?? []).join(", ") + " " + (bean.summary ?? "");
  const traits = new Set<Trait>();
  for (const [t, re] of Object.entries(TRAIT_WORDS)) if (re.test(notes)) traits.add(t as Trait);
  if (traits.has("fruit") || traits.has("florals")) traits.add("clarity");
  if (/acid|bright|juic|citrus|lime|lemon|grapefruit|currant/i.test(notes)) traits.add("acidity");
  return traits;
}

/** Temperature shift for brewing a bean on a profile written for a different roast. ~1.5 °C per roast step, lighter = hotter. */
export function roastTempOffset(p: CatalogProfile, roast: RoastLevel): number {
  const delta = profileRoastCentre(p) - ORDER.indexOf(roast);
  return Math.max(-4, Math.min(4, Math.round(delta * 1.5 * 2) / 2));
}

export function suggestRecipe(p: CatalogProfile, bean: BeanInfo, prefs: Preferences = {}): SuggestedRecipe {
  const b = baseline(bean);
  const ratio = p.recipe.yieldG / p.recipe.doseG;
  let dose = prefs.basketDoseG ?? (p.style === "allonge" || p.style === "turbo" ? p.recipe.doseG : 18);
  let yieldG = Math.round(dose * ratio);
  let temp = p.recipe.tempC + roastTempOffset(p, b.roast);
  let basis = `${p.title}'s own recipe, ratio 1:${ratio.toFixed(1)}`;

  // A roaster's published espresso recipe is the best evidence for conventional
  // profiles. Turbo, allongé and low-contact shots run on their own logic, so
  // only the dose carries over to those.
  const rr = bean.roasterRecipe;
  const conventional = !["allonge", "turbo", "low-contact", "blooming"].includes(p.style);
  if (rr?.doseG && rr.yieldG && conventional) {
    dose = rr.doseG;
    yieldG = rr.yieldG;
    basis = `the roaster's recipe (${rr.doseG} g → ${rr.yieldG} g) on ${p.title}`;
    if (rr.tempC && ["flat-pressure", "flow", "adaptive"].includes(p.style)) temp = rr.tempC;
  }

  if (["natural", "anaerobic", "experimental"].includes(bean.processKind ?? "") && p.style !== "low-contact") temp -= 0.5;
  if (bean.processKind === "decaf") temp -= 1.5;
  if (b.rest.status === "resting") temp -= 0.5;

  return { doseG: dose, yieldG, tempC: Math.round(temp * 2) / 2, timeS: p.recipe.timeS, basis };
}

export function rankProfiles(bean: BeanInfo, prefs: Preferences = {}, installedTitles?: string[]): Candidate[] {
  const roast = baseline(bean).roast;
  const traits = beanTraits(bean);
  const installed = installedTitles ? new Set(installedTitles.map((t) => t.toLowerCase())) : null;
  const drink = prefs.drink ?? (bean.roastedFor === "filter" ? "straight" : "both");
  const altitude = Math.max(0, ...(bean.altitudeMasl.value ?? []));

  return CATALOG.map((p) => {
    let score = 0;
    const reasons: string[] = [];
    const cautions: string[] = [];

    const dist = Math.min(...p.roasts.map((r) => roastDistance(r, roast)));
    if (dist === 0) {
      score += 3;
      reasons.push(`Written for ${roast} roasts`);
    } else if (dist === 1) score += 1;
    else {
      score -= 3;
      cautions.push(`Meant for ${p.roasts.join("/")} roasts`);
    }

    if (drink === "milk") {
      if (p.milk === "great") (score += 2), reasons.push("Holds up in milk");
      if (p.milk === "avoid") (score -= 4), cautions.push("Not intended for milk drinks");
    } else if (drink === "straight") {
      if (p.straight === "great") score += 1.5;
    } else if (p.milk === "avoid") score -= 0.5;

    const shared = p.emphasises.filter((t) => traits.has(t));
    if (shared.length) {
      score += 0.75 * shared.length;
      reasons.push(`Brings out ${shared.filter((t) => t !== "forgiving").join(", ")} the roaster describes`);
    }
    if (traits.has("chocolate") && !traits.has("fruit") && p.emphasises.includes("clarity") && !p.emphasises.includes("body")) score -= 0.5;

    if (bean.processKind && p.processes.includes(bean.processKind)) {
      score += 1;
      reasons.push(`Suits ${bean.processKind} coffees`);
    }

    if (bean.isBlend && drink !== "straight" && (p.style === "lever" || p.style === "flow")) score += 0.5;
    if (altitude >= 1900 && ["blooming", "allonge", "adaptive"].includes(p.style) && ORDER.indexOf(roast) <= 1) {
      score += 0.5;
      reasons.push(`Dense, high-grown beans (${altitude} masl) reward its long contact`);
    }

    if (prefs.hasScale === false && p.needsScale) (score -= 3), cautions.push("Works best with a Bluetooth scale");
    if (p.wantsFlatBurrs) {
      if (prefs.burrs === "flat") score += 1;
      else if (prefs.burrs === "conical") (score -= 2), cautions.push("Designed for high-extraction flat burrs");
      else (score -= 0.75), cautions.push("Designed for high-extraction flat burrs");
    }

    const exp = prefs.experience ?? "comfortable";
    if (exp === "new") {
      if (p.difficulty === "easy") (score += 1.5), reasons.push("Forgiving while you learn");
      if (p.difficulty === "advanced") (score -= 2), cautions.push("An advanced profile");
    } else if (exp === "advanced" && p.difficulty === "advanced") score += 0.5;
    else if (p.difficulty === "advanced") score -= 0.75;

    score += 0.4 * p.popularity;
    const isInstalled = installed ? installed.has(p.title.toLowerCase()) : true;
    if (!isInstalled) (score -= 0.5), cautions.push("Not on your machine yet");

    return { title: p.title, score: Math.round(score * 100) / 100, installed: isInstalled, reasons, cautions, recipe: suggestRecipe(p, bean, prefs), profile: p };
  }).sort((a, b) => b.score - a.score);
}
