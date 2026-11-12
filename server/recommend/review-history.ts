import { stoppedEarly, type ShotFacts } from "../profiles/analysis.js";
import { sameGrind } from "../control/workflow.js";
import type { ReviewInput } from "./review-types.js";

type Previous = ReviewInput["history"][number];
export interface ReviewHistoryComparison {
  status: "none" | "comparable" | "confounded" | "insufficient";
  comparableCount: number;
  excluded: Record<"profile" | "dose" | "yield" | "temperature" | "incomplete" | "missing" | "chronology", number>;
  latest: {
    timestamp: string;
    previousDurationS: number;
    currentDurationS: number;
    deltaS: number;
    previousGrind: string | null;
    currentGrind: string | null;
    grindChanged: boolean | null;
  } | null;
  /** A descriptive range, never an ideal time window or proof of a grind effect. */
  recentRangeS: [number, number] | null;
}

const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const setting = (s?: string | null) => s?.trim() || null;
const rounded = (n: number) => Math.round(n * 10) / 10;

/** Compare recorded shots of one bag while keeping recipe changes and missing facts visible. */
export function compareReviewHistory(input: ReviewInput, facts: ShotFacts): ReviewHistoryComparison {
  const out: ReviewHistoryComparison = {
    status: input.history.length ? "insufficient" : "none", comparableCount: 0,
    excluded: { profile: 0, dose: 0, yield: 0, temperature: 0, incomplete: 0, missing: 0, chronology: 0 },
    latest: null, recentRangeS: null,
  };
  if (!input.history.length) return out;
  const currentAt = Date.parse(input.timestamp ?? "");
  const currentKnown = input.profile != null && input.profile.beverage_type !== "manual" &&
    !!input.profileShape && positive(facts.durationS) && positive(facts.doseG) && positive(facts.yieldG) && positive(input.tempC) &&
    Number.isFinite(currentAt);
  const comparable: Previous[] = [];
  for (const p of input.history.slice(0, 20)) {
    if (!currentKnown || !p.profileShape || !positive(p.durationS) || !positive(p.doseG) || !positive(p.yieldG) || !positive(p.tempC)) {
      out.excluded.missing++; continue;
    }
    const at = Date.parse(p.timestamp);
    if (!Number.isFinite(at) || at >= currentAt) { out.excluded.chronology++; continue; }
    if (stoppedEarly(input) || stoppedEarly({ yieldG: p.yieldG!, targetYieldG: p.targetYieldG ?? null, stopReason: p.stopReason ?? null }) ||
        positive(input.targetYieldG) && facts.yieldG! < 0.8 * input.targetYieldG || positive(p.targetYieldG) && p.yieldG! < 0.8 * p.targetYieldG) {
      out.excluded.incomplete++; continue;
    }
    if (p.profileTitle !== input.profile?.title || p.profileShape !== input.profileShape) { out.excluded.profile++; continue; }
    if (Math.abs(p.doseG! - facts.doseG!) > 0.5) { out.excluded.dose++; continue; }
    if (Math.abs(p.yieldG! - facts.yieldG!) > Math.max(2, facts.yieldG! * 0.05)) { out.excluded.yield++; continue; }
    if (positive(input.targetYieldG) && positive(p.targetYieldG) && Math.abs(input.targetYieldG - p.targetYieldG) > Math.max(2, input.targetYieldG * 0.05)) { out.excluded.yield++; continue; }
    if (Math.abs(p.tempC! - input.tempC!) > 0.5) { out.excluded.temperature++; continue; }
    comparable.push(p);
  }
  comparable.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  out.comparableCount = comparable.length;
  if (!comparable.length) {
    out.status = out.excluded.profile + out.excluded.dose + out.excluded.yield + out.excluded.temperature > 0 ? "confounded" : "insufficient";
    return out;
  }
  out.status = "comparable";
  const p = comparable[0];
  const previousGrind = setting(p.grinderSetting), currentGrind = setting(input.grinderSetting);
  out.latest = {
    timestamp: p.timestamp, previousDurationS: p.durationS!, currentDurationS: facts.durationS!,
    deltaS: rounded(facts.durationS! - p.durationS!), previousGrind, currentGrind,
    // A numeric direction does not establish which way this grinder gets finer.
    grindChanged: previousGrind && currentGrind ? !sameGrind(previousGrind, currentGrind) : null,
  };
  const times = comparable.map(p => p.durationS!);
  out.recentRangeS = [Math.min(...times), Math.max(...times)];
  return out;
}

export function historySentence(h: ReviewHistoryComparison): string | null {
  const p = h.latest;
  if (p) {
    const change = p.grindChanged === true ? `with grind ${p.previousGrind} → ${p.currentGrind}` :
      p.grindChanged === false ? "at the same recorded setting" : "with grind history unknown";
    return `On the same recipe, time went from ${p.previousDurationS} to ${p.currentDurationS} s ${change}; repeat before attributing a cause.`;
  }
  if (h.status === "confounded") return "The earlier recipe or profile changed, so history cannot isolate a grind effect; repeat this recipe before drawing a trend.";
  if (h.status === "insufficient") return "Recorded timing or recipe details are missing, so history cannot establish a grind trend; repeat with the setting noted.";
  return null;
}
