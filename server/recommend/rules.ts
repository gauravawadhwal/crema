import type { BeanInfo, RoastLevel } from "../schema.js";

/**
 * Deterministic starting point for a coffee. It works with no AI at all, and
 * it is handed to the model as a baseline to reason from, which keeps the
 * model's suggestions anchored to sensible numbers.
 */
export interface Baseline {
  roast: RoastLevel;
  tempC: number;
  ratio: number;
  doseG: number;
  yieldG: number;
  targetTimeS: [number, number];
  grindHint: string;
  rest: { daysOffRoast: number | null; window: [number, number]; status: "resting" | "peak" | "fading" | "unknown"; advice: string };
  reasons: string[];
}

const ROAST_ORDER: RoastLevel[] = ["light", "medium-light", "medium", "medium-dark", "dark"];

const BASE: Record<RoastLevel, { temp: number; ratio: number; time: [number, number]; rest: [number, number] }> = {
  light:          { temp: 94, ratio: 2.5, time: [25, 40], rest: [14, 40] },
  "medium-light": { temp: 93, ratio: 2.2, time: [25, 35], rest: [10, 35] },
  medium:         { temp: 92, ratio: 2.0, time: [26, 34], rest: [7, 28] },
  "medium-dark":  { temp: 90, ratio: 2.0, time: [26, 34], rest: [5, 24] },
  dark:           { temp: 88, ratio: 1.8, time: [24, 32], rest: [4, 21] },
};

export function inferRoast(bean: BeanInfo): RoastLevel {
  let roast = bean.roastLevel?.value;
  if (!roast) {
    // Roasters that sell "omni"/filter roasts are almost always light.
    if (bean.roastedFor === "filter") roast = "light";
    else if (bean.roastedFor === "omni") roast = "medium-light";
    else if (bean.isBlend) roast = "medium";
    else roast = "medium-light";
  }
  return roast;
}

export function daysBetween(fromIso: string, to: Date): number | null {
  const d = new Date(fromIso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((to.getTime() - d.getTime()) / 864e5);
}

export function baseline(bean: BeanInfo, opts: { doseG?: number; today?: Date } = {}): Baseline {
  const today = opts.today ?? new Date();
  const roast = inferRoast(bean);
  const b = BASE[roast];
  const reasons: string[] = [`${roast} roast: start around ${b.temp}°C and 1:${b.ratio}`];
  let temp = b.temp;
  let ratio = b.ratio;
  let grind = 0; // + finer, - coarser, relative to a medium roast

  grind += 2 - ROAST_ORDER.indexOf(roast); // lighter roasts are denser and need finer grinding

  if (bean.roastedFor === "filter") {
    temp += 1;
    ratio += 0.3;
    reasons.push("Roasted for filter: run it hotter and longer to extract enough");
  }

  switch (bean.processKind) {
    case "natural":
    case "anaerobic":
    case "experimental":
      temp -= 1;
      reasons.push(`${bean.processKind} process: fruit-forward and extracts readily, so 1°C cooler keeps it from turning boozy`);
      break;
    case "decaf":
      temp -= 2;
      grind -= 1;
      reasons.push("Decaf: more porous and extracts fast, so cooler and a touch coarser");
      break;
    case "wet-hulled":
      temp -= 1;
      reasons.push("Wet-hulled: heavy and earthy, a cooler shot tames it");
      break;
  }

  const alt = bean.altitudeMasl.value;
  const maxAlt = alt?.length ? Math.max(...alt) : null;
  if (maxAlt && maxAlt >= 1900) {
    temp += 0.5;
    grind += 1;
    reasons.push(`Grown high (${maxAlt} masl): dense beans, a little hotter and finer`);
  }

  const doseG = opts.doseG ?? 18;
  const rest = restOf(bean, today);
  if (rest.status === "resting") {
    temp -= 0.5;
    reasons.push("Still degassing: expect more crema and channelling; slightly cooler helps");
  }

  return {
    roast,
    tempC: round(temp, 0.5),
    ratio: round(ratio, 0.1),
    doseG,
    yieldG: Math.round(doseG * ratio),
    targetTimeS: b.time,
    grindHint: grindHint(grind),
    rest,
    reasons,
  };
}

/** Where a coffee is in its rest window, from its roast level (inferred if unset) and roast date. */
export function restOf(bean: BeanInfo, today: Date = new Date()): Baseline["rest"] {
  const roast = inferRoast(bean);
  const days = bean.roastDate?.value ? daysBetween(bean.roastDate.value, today) : null;
  return restStatus(days, BASE[roast].rest, roast);
}

function restStatus(days: number | null, window: [number, number], roast: RoastLevel): Baseline["rest"] {
  if (days == null) return { daysOffRoast: null, window, status: "unknown", advice: "No roast date. Add one from the bag for rest tracking." };
  if (days < window[0])
    return { daysOffRoast: days, window, status: "resting", advice: `Day ${days} off roast. ${roast} roasts usually open up from day ${window[0]}.` };
  if (days <= window[1]) return { daysOffRoast: days, window, status: "peak", advice: `Day ${days}: in its best window (days ${window[0]}–${window[1]}).` };
  return { daysOffRoast: days, window, status: "fading", advice: `Day ${days}: past its best window. Grind finer to keep it lively, or freeze the rest.` };
}

function grindHint(steps: number): string {
  if (steps >= 3) return "Much finer than you'd grind a medium roast";
  if (steps >= 1) return "A bit finer than you'd grind a medium roast";
  if (steps <= -2) return "Noticeably coarser than you'd grind a medium roast";
  if (steps <= -1) return "A bit coarser than you'd grind a medium roast";
  return "About where you'd grind a medium roast";
}

const round = (n: number, step: number) => Math.round(n / step) * step;
