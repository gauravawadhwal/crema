import { CoachReview as CoachSchema } from "../../server/schema.js";
import { curveStageInput } from "../../server/recommend/review-local.js";
import { groundedNotes, reviewNotes } from "../../server/recommend/review-taste.js";
import type { CoachReview, CoachReviewResult, ReviewInput } from "../../server/recommend/review-types.js";
import type { CoachExpectation, Verdict } from "./review-coach-expectations.js";
import type { ReviewOutcome } from "./review-labels.js";

type Fact = CoachReview["headline"];
type Signature = CoachReview["hypotheses"][number]["signature"];
const stageOrder = ["Start-up", "Soak", "Bloom", "Main pour", "Finish"];
const verdicts = ["on_plan", "partly", "off_plan", "not_graded"] as const;
const jargon = /\b(?:peak\w*|derivative\w*|slope\w*|resistance\s+proxy|cap[- ]like|conductance)\b/i;
const sensory = /\b(?:(?:coffee|shot|finish) (?:is|was|felt|seemed) (?:thin|heavy|balanced)|tast\w*|flavou?r\w*|sour\w*|bitter\w*|sweet\w*|fruity|delicious|chocolatey|thin[- ]bodied|heavy[- ]bodied|mouthfeel|extraction yield)\b/i;
const fault = /\b(?:channel(?:l?ing|l?ed)|crack\w*|fissur\w*|fractur\w*|collaps\w*|puck defect|uneven puck|under[- ]?extract\w*|over[- ]?extract\w*)\b/i;
const certainty = /\b(?:proves?|confirms?|definitely|certainly|caused by|(?:puck|tamp|grind) caused|because (?:you|of (?:your|the) puck)|diagnos\w*|the cause was|must have)\b/i;
const hedge = /\b(?:(?:this|that) fits|could (?:mean|reflect|be)|might (?:mean|reflect|be)|may (?:mean|reflect|indicate)|is consistent with)\b/i;
const ownerMachine = /\byou\s+(?:held|built|ran|followed|maintained|reached|missed|kept|raised|lowered|hit)\b.{0,46}\b(?:pressure|flow|temperature|setpoint|the (?:plan|target))\b/i;
const machineCoffee = /\b(?:the )?machine\s+(?:ground|tamped|tasted|distributed|prepared)\b/i;
const spelledFigure = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|(?:thir|four|fif|six|seven|eigh|nine)teen|(?:twen|thir|for|fif|six|seven|eigh|nine)ty|hundred)\s+(?:bar|mL\/s|g(?:\/s)?|°C|s(?:ec(?:ond)?s?)?|grams?|degrees?)(?![\w/])/i;
const readback = /\b(?:plan(?:ned)?|recorded)\s*:|\b(?:dose|yield|ratio)\s*(?:was|:)?\s*\d/i;
const advice = /\b(?:try|switch to|load|select|set|move|adjust|change|raise|lower|increase|decrease|reduce|grind|tamp|distribute)\b.{0,35}\b(?:finer|coarser|grind|yield|dose|temperature|warmer|cooler|profile|basket|puck|tamp|distribution)\b/i;
const puckWords: Record<NonNullable<CoachReview["recommendation"]["puckCheck"]>, RegExp> = {
  even_distribution: /\beven distribution\b/i,
  level_tamp: /\blevel tamp\b/i,
  consistent_dose: /\bconsistent dose\b/i,
  basket_and_puck_consistency: /\b(?:basket and puck|puck and basket) consistency\b/i,
};
const puckDiagnosis = /\b(?:fix|correct|repair|replace|buy|install|upgrade|wdt|screen|tool|needle|tamper|channel(?:l?ing|l?ed))\b/i;

const quantityPattern = /([+\-−]?(?:\d+(?:\.\d+)?|\.\d+))(?:\s*(?:[–-]|→|\bto\b)\s*([+\-−]?(?:\d+(?:\.\d+)?|\.\d+)))?\s*(mL\/s|g\/s|bar|°\s*C|s(?:ec(?:ond)?s?)?|g)(?![\w/])/gi;
type NumberRole = "measured" | "target" | "ceiling";
type QuantityUnit = "ml/s" | "g/s" | "bar" | "°c" | "s" | "g";
interface ParsedQuantity {
  first: number;
  last: number | null;
  unit: QuantityUnit;
  role: NumberRole;
}

const normalizeUnit = (unit: string): QuantityUnit => {
  const compact = unit.toLowerCase().replace(/\s+/g, "");
  return /^sec(?:ond)?s?$/.test(compact) ? "s" : compact as QuantityUnit;
};

const normalizeNumber = (n: string) => Number(n.replace("−", "-"));

// Bind numeric comparisons to a role, recognizing ceiling/cap/limit both before
// and after a number and ignoring relational references like "below target at".
function parseQuantities(text: string): ParsedQuantity[] | null {
  const matches = [...text.matchAll(quantityPattern)];
  const remainder = text.replace(quantityPattern, "");
  if (/\p{N}/u.test(remainder)) return null;
  const targetComparison = /\b(?:below|above|under|over|near|off|from|short of|miss(?:ed|ing)?(?:\s+(?:the|its))?)\s+(?:the\s+|its\s+)?(?:planned\s+|sensor\s+)?(?:target|plan|setpoint|command)\b/gi;
  return matches.map((match, i) => {
    const start = matches[i - 1] ? matches[i - 1].index + matches[i - 1][0].length : 0;
    const rawPrior = text.slice(start, match.index);
    const localPrior = (rawPrior.split(/(?<=[.!?])\s+|[,;]|\b(?:versus|vs\.?|against|while|compared (?:with|to))\b/i).at(-1) ?? rawPrior)
      .replace(targetComparison, " ");
    const after = text.slice(match.index + match[0].length, matches[i + 1]?.index);
    let role: NumberRole = "measured";
    if (/^\s+(?:(?:pressure|flow)\s+)?(?:ceiling|cap|limit)\b/i.test(after) ||
        /\b(?:(?:ceiling|cap|limit)(?:\s+(?:of|at|near))?|(?:capped|limited)\s+(?:at|to|near))\s*$/i.test(localPrior)) {
      role = "ceiling";
    } else if (/^\s+(?:(?:pressure|flow|temperature|sensor)\s+)?(?:target|plan|command(?:ed)?|setpoint|guide|expected(?:\s+window)?)\b/i.test(after) ||
        /\b(?:target|plan(?:ned)?|command(?:ed)?|request(?:ed)?|setpoint|guide|expected)(?:\s+(?:pressure|flow|temperature|yield|time|climb|ramp|decline|drop|rise|hold))?(?:\s+(?:of|was|is|at|near|around|to|toward))?\s*$/i.test(localPrior)) {
      role = "target";
    }
    return {
      first: normalizeNumber(match[1]),
      last: match[2] == null ? null : normalizeNumber(match[2]),
      unit: normalizeUnit(match[3]),
      role,
    };
  });
}

function baseGroundedValues(input: ReviewInput, result: CoachReviewResult) {
  const buckets = new Map<string, number[]>();
  const add = (unit: QuantityUnit, role: NumberRole, ...values: (number | null | undefined)[]) => {
    const key = `${unit}|${role}`;
    const list = buckets.get(key) ?? [];
    for (const v of values) {
      if (v != null && Number.isFinite(v)) list.push(v);
    }
    buckets.set(key, list);
  };
  const stepPump = (frame: number | null) =>
    frame == null ? null : input.profile?.steps?.[frame]?.pump?.toLowerCase() ?? null;
  const num = (v: string | number | undefined) => {
    if (v == null || String(v).trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const { facts, metrics } = result.evidence.analysis;
  const { phaseEvidence } = facts;
  const brewStart = facts.brewStartS;
  for (const p of input.points) {
    const pump = stepPump(p.frame);
    add("bar", "measured", p.p);
    if (pump !== "flow") add("bar", "target", p.tp);
    add("ml/s", "measured", p.f);
    if (pump !== "pressure") add("ml/s", "target", p.tf);
    add("°c", "measured", p.temp, p.groupTemp);
    add("°c", "target", p.targetTemp, p.targetGroupTemp);
    add("g", "measured", p.w);
    add("g/s", "measured", p.weightFlow);
    add("s", "measured", p.t, brewStart != null ? p.t - brewStart : null);
  }

  for (const step of input.profile?.steps ?? []) {
    const pump = step.pump?.toLowerCase();
    const limit = num(step.limiter?.value);
    if (pump === "pressure") {
      add("bar", "target", num(step.pressure));
      add("ml/s", "ceiling", limit);
    } else if (pump === "flow") {
      add("ml/s", "target", num(step.flow));
      add("bar", "ceiling", limit);
    }
    add("°c", "target", num(step.temperature));
    add("g", "target", num(step.weight));
    const secs = num(step.seconds);
    add("s", "target", secs);
    add("s", "ceiling", secs);
  }

  add("°c", "target", input.tempC);
  add("°c", "measured", metrics.meanTemperatureOffsetC,
    metrics.meanTemperatureOffsetC == null ? null : Math.abs(metrics.meanTemperatureOffsetC));
  add("g", "measured", input.doseG, input.yieldG, input.annotatedYieldG, facts.doseG, facts.yieldG);
  add("g", "target", input.targetYieldG, facts.targetYieldG);
  add("g", "ceiling", input.targetYieldG, facts.targetYieldG);
  add("bar", "measured", facts.peakPressureBar, facts.pourMeanPressureBar);
  add("ml/s", "measured", facts.pourMeanFlowMlS);
  add("s", "measured", facts.brewStartS, facts.brewEndS, facts.durationS, facts.preinfusionS,
    facts.pourS, facts.firstDripsS, facts.timeDeltaS, facts.timeDeltaS == null ? null : Math.abs(facts.timeDeltaS));
  for (const t of [...(input.targetTimeS ?? []), ...(facts.expectedTimeS ?? []), ...(result.evidence.expectedTime.value ?? [])]) {
    add("s", "target", t);
  }

  for (const ps of facts.pourSteps) {
    const u: QuantityUnit = ps.pump === "flow" ? "ml/s" : "bar";
    const other: QuantityUnit = ps.pump === "flow" ? "bar" : "ml/s";
    add(u, "target", ps.target);
    add(u, "measured", ps.actualMean, ps.actualPeak);
    add(other, "measured", ps.otherMean);
    add(other, "ceiling", ps.limiterValue);
    add("s", "measured", ps.durationS);
  }

  for (const p of phaseEvidence.phases) {
    add("s", "measured", p.fromS, p.toS, p.durationS, p.controlledError.coveredS, p.pressureBar.coveredS,
      p.inletFlowMlS.coveredS, p.pressureCrest.value?.tS, p.capLikeTime.coveredS, p.capLikeTime.value?.seconds);
    if (p.plan.value) {
      add("s", "target", p.plan.value.maximumS);
      add("s", "ceiling", p.plan.value.maximumS);
      add("°c", "target", p.plan.value.temperatureC);
      add("g", "target", p.plan.value.weightG);
    }
    const pv = p.pressureBar.value;
    if (pv) add("bar", "measured", pv.entry, pv.last, pv.min, pv.max, pv.timeWeightedMean,
      pv.entry != null && pv.last != null ? Math.abs(pv.last - pv.entry) : null);
    const fv = p.inletFlowMlS.value;
    if (fv) add("ml/s", "measured", fv.entry, fv.last, fv.min, fv.max, fv.timeWeightedMean,
      fv.entry != null && fv.last != null ? Math.abs(fv.last - fv.entry) : null);
    add("bar", "measured", p.pressureCrest.value?.pressureBar, p.lateHydraulics.value?.medianPressureBar,
      p.pressureDroopAtHeldFlowBar.value);
    add("ml/s", "measured", p.lateHydraulics.value?.medianInletFlowMlS);
    const mode = p.mode.value;
    if (mode === "pressure" || mode === "flow") {
      const u: QuantityUnit = mode === "flow" ? "ml/s" : "bar";
      const other: QuantityUnit = mode === "flow" ? "bar" : "ml/s";
      const cmd = p.loggedCommand.value;
      if (cmd) add(u, "target", cmd.entry, cmd.last, cmd.min, cmd.max, cmd.timeWeightedMean,
        cmd.entry != null && cmd.last != null ? Math.abs(cmd.last - cmd.entry) : null);
      add(u, "target", p.steadyHold.value?.meanCommand, p.plan.value?.endpoint);
      add(u, "measured", p.steadyHold.value?.meanResponse, p.controlledError.value?.absoluteMean,
        p.controlledError.value?.signedMean,
        p.controlledError.value?.signedMean == null ? null : Math.abs(p.controlledError.value.signedMean));
      add(other, "ceiling", p.plan.value?.limiter?.value);
    }
    const tv = p.temperature.value;
    if (tv) {
      const e = tv.entry.value, l = tv.last.value, late = tv.lateMedianOffsetC.value;
      add("°c", "measured", e?.actualC, l?.actualC, e?.offsetC, l?.offsetC, late,
        e?.offsetC == null ? null : Math.abs(e.offsetC),
        l?.offsetC == null ? null : Math.abs(l.offsetC),
        late == null ? null : Math.abs(late));
      add("°c", "target", e?.targetC, l?.targetC);
    }
  }

  if (phaseEvidence.firstSustainedBeverage.value) {
    add("g", "measured", 1);
    add("s", "measured", phaseEvidence.firstSustainedBeverage.value.tS, phaseEvidence.firstSustainedBeverage.value.brewElapsedS);
  }
  add("g/s", "measured", phaseEvidence.cupRateBeforeOnsetGS.value, phaseEvidence.cupRateAfterOnsetGS.value);
  for (const landmark of result.evidence.landmarks) {
    add("s", "measured", landmark.tS, landmark.brewElapsedS, landmark.phaseElapsedS);
  }
  for (const issue of result.curve.issues) {
    add("s", "measured", issue.fromS, issue.toS);
  }
  for (const phase of [result.coach.temperature, ...result.coach.phases]) {
    if (!phase.unit) continue;
    const u = normalizeUnit(phase.unit);
    add(u, "target", phase.expected?.start, phase.expected?.finish, phase.expected?.average);
    add(u, "measured", phase.actual?.start, phase.actual?.finish, phase.actual?.average, phase.meanAbsoluteError);
    if (phase.ceiling) add(normalizeUnit(phase.ceiling.unit), "ceiling", phase.ceiling.value);
  }
  const curves = result.evidence.history.curves;
  if (curves?.reason === "comparable_phases") {
    add("bar", "measured", curves.phase?.peakPressureBar, curves.mass.current?.pressureBar,
      ...curves.references.map(r => r.mass?.pressureBar));
    add("g", "measured", curves.mass.current?.massG);
  }
  for (const h of input.history) {
    add("g", "measured", h.doseG, h.yieldG);
    add("g", "target", h.targetYieldG);
    add("s", "measured", h.durationS);
    add("°c", "target", h.tempC);
  }
  return buckets;
}

const NUMERIC_GROUNDING_TOLERANCE = 0.15;

function groundedCoachNumbers(text: string, draft: string, baseBuckets: () => Map<string, number[]>) {
  if (spelledFigure.test(text)) return false;
  const parsed = parseQuantities(text);
  if (parsed === null) return false;
  if (parsed.length === 0) return true;
  const buckets = baseBuckets();
  const draftValues = new Map<string, number[]>();
  for (const q of parseQuantities(draft) ?? []) {
    const key = `${q.unit}|${q.role}`;
    const list = draftValues.get(key) ?? [];
    list.push(q.first);
    if (q.last !== null) list.push(q.last);
    draftValues.set(key, list);
  }
  return parsed.every(({ first, last, unit, role }) => {
    const key = `${unit}|${role}`;
    const allowed = buckets.get(key) ?? [];
    const fromDraft = draftValues.get(key) ?? [];
    const ok = (value: number) =>
      fromDraft.some(ref => Math.abs(ref - value) <= NUMERIC_GROUNDING_TOLERANCE) ||
      allowed.some(ref => Math.abs(ref - value) <= NUMERIC_GROUNDING_TOLERANCE);
    return ok(first) && (last === null || ok(last));
  });
}

function oneSentence(text: string) {
  return /\S/.test(text) && !/[\r\n]|[.!?]\s+\S/.test(text.trim());
}

/** The ordered user-facing fields. Internal phase readbacks and individual link sentences are not rendered. */
export function coachCard(coach: CoachReview) {
  const { headline, stages, temperature, notable, hypotheses, history, taste, recommendation } = coach;
  return {
    headline: headline.sentence,
    stages: [...stages, temperature].map(({ name, verdict, sentence }) => ({ name, verdict, sentence })),
    notable: notable.map(row => row.sentence),
    hypotheses: hypotheses.map(({ label, sentence, confidence }) => ({ label, sentence, confidence })),
    ...(history && { history: history.sentence }),
    ...(taste && { taste: { reported: taste.reported, notes: taste.notes, noteQuote: taste.noteQuote } }),
    recommendation: { action: recommendation.action, expect: recommendation.expect, compare: recommendation.compare },
  };
}

export function coachFirstPart(coach: CoachReview) {
  const { headline, stages, phases, temperature, notable, hypotheses, history } = coach;
  return { headline, stages, phases, temperature, notable, hypotheses, history };
}

function mechanicsFacts(coach: CoachReview) {
  return [
    { slot: "headline", row: coach.headline },
    ...coach.stages.map((row, i) => ({ slot: `stage-${i + 1}`, row })),
    { slot: "temperature", row: coach.temperature },
    ...coach.notable.map((row, i) => ({ slot: `notable-${i + 1}`, row })),
    ...coach.hypotheses.map((row, i) => ({ slot: `hypothesis-${i + 1}`, row })),
    ...(coach.history ? [{ slot: "history", row: coach.history }] : []),
  ];
}

/** Credit only rewrites that were actually displayed, in display order. */
export function authoredCoachRows(coach: CoachReview, reply: unknown) {
  const rewrites = (reply as { rewrites?: { slot: string; text: string; evidenceIds: string[] }[] } | undefined)?.rewrites ?? [];
  return mechanicsFacts(coach).flatMap(({ slot, row }) => {
    const rewrite = rewrites.find(r => r.slot === slot && r.text.trim() === row.sentence);
    return rewrite ? [{ slot, text: row.sentence, evidenceIds: rewrite.evidenceIds }] : [];
  });
}

export function expectedTasteLink(signature: Signature, feedback: ReviewInput["feedback"]) {
  if (signature === "none" || !feedback) return "no_link";
  const axes = [feedback.sourBitter, feedback.body].filter((value): value is number => value != null && value !== 0);
  if (!axes.length) return "no_link";
  const sign = signature === "sour_thin" ? -1 : 1;
  return axes.every(value => Math.sign(value) === sign) ? "matches" : "does_not_match";
}

export function coachTasteViolations(coach: CoachReview, input: ReviewInput) {
  const { taste, hypotheses } = coach;
  const { sourBitter = null, body = null, enjoyment = null } = input.feedback ?? {};
  const notes = reviewNotes(input);
  const recorded = sourBitter != null || body != null || enjoyment != null || notes != null;
  if (!taste) return recorded ? ["missing-taste"] : [];
  if (!recorded) return ["unrecorded-taste"];
  const errors: string[] = [];
  if (taste.sourBitter !== sourBitter || taste.body !== body || taste.enjoyment !== enjoyment || taste.notes !== notes ||
      taste.noteQuote != null && (!notes || !groundedNotes(notes, taste.noteQuote))) errors.push("taste-attribution");
  if (taste.links.length !== hypotheses.length) errors.push("taste-link-coverage");
  const flavour = sourBitter == null ? null : ["sour", "slightly sour", "balanced", "slightly bitter", "bitter"][sourBitter + 2];
  const texture = body == null ? null : ["thin", "light-bodied", "balanced in body", "rich", "heavy"][body + 2];
  const descriptors = sourBitter === 0 && body === 0 ? "balanced" : [flavour, texture].filter(Boolean).join(" and ");
  const report = taste.reported?.trim() ?? "";
  const attribution = descriptors ? `You said it tasted ${descriptors}` :
    !notes && enjoyment != null ? `You rated it ${enjoyment}/10 for enjoyment` : null;
  if (attribution && report !== `${attribution}.` && !report.startsWith(`${attribution}, which `) ||
      !attribution && report) errors.push("taste-report");
  let linked = 0;
  for (const [i, h] of hypotheses.entries()) {
    const link = taste.links[i];
    const expected = expectedTasteLink(h.signature, input.feedback);
    const label = h.label.toLowerCase();
    const matching = `fits the ${label} above`;
    const conflicting = `doesn't fully fit the ${label} above`;
    const claimsLink = report.toLowerCase().includes(label);
    if (expected !== "no_link") linked++;
    if (link?.hypothesisId !== h.id || link.status !== expected ||
        (expected === "no_link" ? link.sentence !== null || claimsLink :
          !report.toLowerCase().includes(expected === "matches" ? matching : conflicting) ||
          !link.sentence?.toLowerCase().includes(expected === "matches" ? matching : conflicting) ||
          report.toLowerCase().includes(expected === "matches" ? conflicting : matching))) {
      errors.push(`taste-link.${h.id}`);
    }
  }
  if (!linked && attribution && report !== `${attribution}.`) errors.push("unlinked-taste-claim");
  return errors;
}

export function coachOutcomes(rec: CoachReview["recommendation"]): Exclude<ReviewOutcome, "abstain">[] {
  const result: Exclude<ReviewOutcome, "abstain">[] = [];
  const a = rec.adjustment;
  if (a?.grindDelta.endsWith("finer")) result.push("grind-finer");
  if (a?.grindDelta.endsWith("coarser")) result.push("grind-coarser");
  if (a?.yieldDeltaG) result.push("change-yield");
  if (a?.tempDeltaC) result.push("change-temperature");
  if (a?.switchProfile != null) result.push("switch-profile");
  return result;
}

function recommendationViolations(rec: CoachReview["recommendation"], input: ReviewInput, espresso: boolean) {
  const { action, expect, compare, adjustment: a, puckCheck } = rec;
  const text = [action, expect, compare].join(" ");
  const moves = coachOutcomes(rec);
  const errors: string[] = [];
  if (!oneSentence(action) || !expect.trim() || !compare.trim()) errors.push("recommendation-missing");
  if (moves.length + Number(puckCheck != null) > 1 || a && (!espresso || moves.length !== 1 || a.grindDelta.startsWith("much-") ||
      Math.abs(a.yieldDeltaG) > 10 || Math.abs(a.tempDeltaC) > 3 ||
      a.switchProfile !== null && !input.installedProfiles.includes(a.switchProfile))) errors.push("recommendation-bounds");
  if (puckCheck && (!puckWords[puckCheck].test(action) || !/^check\b/i.test(action) || puckDiagnosis.test(text) ||
      Object.values(puckWords).filter(pattern => pattern.test(action)).length !== 1) ||
      !puckCheck && (/\b(?:check|redo|fix|improve)\b.{0,32}\b(?:distribution|tamp|basket|puck prep)\b/i.test(action) ||
        Object.values(puckWords).some(pattern => pattern.test(action)))) errors.push("puck-preparation-vocabulary");
  // Version 4 renders a fixed action for each structured adjustment. Check
  // amount, direction and exact installed name as well as the change count.
  const expected = a?.grindDelta === "finer" || a?.grindDelta === "coarser" ? `Try one small step ${a.grindDelta}.` :
    a?.yieldDeltaG ? `Try ${Math.abs(a.yieldDeltaG)} g ${a.yieldDeltaG > 0 ? "more" : "less"} in the cup.` :
    a?.tempDeltaC ? `Try brewing ${Math.abs(a.tempDeltaC)} °C ${a.tempDeltaC > 0 ? "warmer" : "cooler"}.` :
    a?.switchProfile ? `Try ${a.switchProfile}.` : null;
  const extra = (s: string) => s.split(/(?<=[.!?])\s+|;|\band\b/i).some(clause => {
    const move = advice.exec(clause);
    return move && !/\b(?:before|avoid|don't|do not|keep)\b/i.test(clause.slice(0, move.index));
  });
  if (expected && action !== expected || !expected && !puckCheck && !/^repeat\b/i.test(action) ||
      !expected && extra(action) || extra(expect) || extra(compare)) errors.push("recommendation-action");
  return errors;
}

export interface CoachStyle {
  structural: string[];
  style: string[];
  grounding: string[];
  taste: string[];
}

export function gradeCoachCard(result: CoachReviewResult, input: ReviewInput, reference: CoachReview): CoachStyle {
  const { coach, evidence, curve } = result;
  const structural: string[] = [];
  const style: string[] = [];
  const grounding: string[] = [];
  if (!CoachSchema.safeParse(coach).success) return { structural: ["coach-schema"], style, grounding, taste: [] };
  const taste = coachTasteViolations(coach, input);
  if (!oneSentence(coach.headline.sentence)) structural.push("headline");
  const ids = coach.phases.map(p => p.id);
  const rendered = coach.stages.flatMap(stage => stage.phaseIds);
  const order = coach.stages.map(stage => stageOrder.indexOf(stage.name));
  const ranked = ["not_graded", "on_plan", "partly", "off_plan"] as const;
  if (ids.length !== reference.phases.length ||
      ids.some((id, i) => id !== `planned-${i}`) || ids.join() !== rendered.join() ||
      order.some((index, i) => index < 0 || i > 0 && index <= order[i - 1]) ||
      coach.stages.some(s => s.phaseIds.length === 0 ||
        s.verdict !== ranked[Math.max(...s.phaseIds.map(id => ranked.indexOf(coach.phases.find(p => p.id === id)!.verdict)))])) {
    structural.push("stage-order-or-coverage");
  }
  if (coach.temperature.name !== "Temperature") structural.push("temperature-row");
  if (coach.history && (!reference.history || evidence.history.comparableCount === 0)) structural.push("irrelevant-history");
  if (new Set(coach.hypotheses.map(h => h.id)).size !== coach.hypotheses.length ||
      coach.hypotheses.some(h => !h.label.trim() || !oneSentence(h.sentence) || !hedge.test(h.sentence) || certainty.test(h.sentence))) {
    structural.push("unlabelled-or-unhedged-hypothesis");
  }

  const referenceFacts = new Map(mechanicsFacts(reference).map(({ slot, row }) => [slot, row]));
  const evidenceIds = new Set(["recording", "temperature", "finish", ...evidence.landmarks.map(l => l.id),
    ...evidence.analysis.facts.phaseEvidence.phases.map(p => p.id), ...curve.issues.map((_, i) => `finding-${i + 1}`)]);
  if (evidence.history.comparableCount) evidenceIds.add("history");
  if (evidence.expectedTime.value) evidenceIds.add("timing");
  if (evidence.analysis.facts.phaseEvidence.firstSustainedBeverage.value) evidenceIds.add("cup");
  const validIds = (row: Fact, draft?: Fact) => row.evidenceIds.length > 0 &&
    row.evidenceIds.every(id => evidenceIds.has(id) && (!draft || draft.evidenceIds.includes(id)));
  let cachedBuckets: Map<string, number[]> | undefined;
  const getBuckets = () => cachedBuckets ??= baseGroundedValues(input, result);
  for (const { slot, row } of mechanicsFacts(coach)) {
    const text = row.sentence;
    const draft = referenceFacts.get(slot);
    const isStage = slot.startsWith("stage-") || slot === "temperature";
    if (isStage && !oneSentence(text)) structural.push(`stage-sentence.${slot}`);
    if (readback.test(text)) style.push(`numeric-readback.${slot}`);
    if (!draft || (text !== draft.sentence && !groundedCoachNumbers(text, draft.sentence, getBuckets))) grounding.push(`figures-or-role.${slot}`);
    if (!validIds(row, draft)) grounding.push(`evidence-ids.${slot}`);
    if (jargon.test(text)) style.push(`jargon.${slot}`);
    // History conveys the owner's recorded time, not control of a machine channel.
    if (ownerMachine.test(text) || machineCoffee.test(text)) style.push(`agency.${slot}`);
    if (sensory.test(text)) taste.push(`taste-in-mechanics.${slot}`);
    if (fault.test(text) || certainty.test(text)) grounding.push(`definite-diagnosis.${slot}`);
    if (advice.test(text) && !/\b(?:setting changed|changed too)\b/i.test(text)) grounding.push(`advice-in-mechanics.${slot}`);
  }
  for (const [i, phase] of coach.phases.entries()) {
    if (!validIds(phase, reference.phases[i])) grounding.push(`evidence-ids.${phase.id}`);
  }
  for (const [i, h] of coach.hypotheses.entries()) {
    if (jargon.test(h.label)) style.push(`jargon.hypothesis-label-${i + 1}`);
    if (sensory.test(h.label)) taste.push(`taste-in-mechanics.hypothesis-label-${i + 1}`);
    if (fault.test(h.label)) grounding.push(`definite-diagnosis.hypothesis-label-${i + 1}`);
  }
  const rec = coach.recommendation;
  const recommendation = [rec.action, rec.expect, rec.compare].join(" ");
  if (jargon.test(recommendation)) style.push("jargon.recommendation");
  if (ownerMachine.test(recommendation) || machineCoffee.test(recommendation)) style.push("agency.recommendation");
  if (fault.test(recommendation) || certainty.test(recommendation)) grounding.push("definite-diagnosis.recommendation");
  structural.push(...recommendationViolations(rec, input, curveStageInput(input, evidence).profile === "espresso"));
  return { structural, style, grounding, taste };
}

interface StageMatch { name: string; expected: Verdict | null; actual: Verdict | null }
type Decision = { id: string; pass: boolean };
export function scoreCoachTruth(coach: CoachReview, expectation?: CoachExpectation) {
  if (!expectation) return null;
  const match = (expected: CoachExpectation["stages"][number], s: CoachReview["stages"][number]) =>
    s.name === expected.name && s.phaseIds.join() === expected.frames.map(frame => `planned-${frame}`).join();
  const stages: StageMatch[] = expectation.stages.map(expected => {
    const row = coach.stages.find(s => match(expected, s));
    return { name: expected.name, expected: row && expected.allowed.includes(row.verdict) ? row.verdict : expected.allowed[0],
      actual: row?.verdict ?? null };
  });
  for (const row of coach.stages.filter(s => !expectation.stages.some(e => match(e, s)))) {
    stages.push({ name: row.name, expected: null, actual: row.verdict });
  }
  const hypotheses: Decision[] = expectation.hypotheses.map(h => ({
    id: h.id, pass: coach.hypotheses.some(row => row.id === h.id && row.signature === h.signature),
  }));
  for (const row of coach.hypotheses.filter(h => !expectation.hypotheses.some(e => e.id === h.id))) {
    hypotheses.push({ id: row.id, pass: false });
  }
  const abstentions: Decision[] = expectation.abstentions.map(({ frame, reason, visible }) => {
    const id = `planned-${frame}`;
    const row = coach.phases.find(p => p.id === id);
    const stage = coach.stages.find(s => s.phaseIds.includes(id));
    const reasonText = reason === "weight" ? /\b(?:reached target weight|stopped at (?:the )?target weight)\b/i :
      /\b(?:ended before|stopped before|ended early|stopped early)\b/i;
    return { id, pass: row?.verdict === "not_graded" && reasonText.test(row.sentence) &&
      (!visible || stage?.verdict === "not_graded") &&
      (stage?.verdict !== "not_graded" || reasonText.test(stage.sentence)) };
  });
  const leniency = (expectation.leniency ?? []).map(({ frame, kind }) => {
    const id = `planned-${frame}`;
    const phase = coach.phases.find(p => p.id === id);
    return { kind, id, pass: !!phase && phase.verdict !== "off_plan" };
  });
  return { stages, hypotheses, leniency, hypothesisSetCorrect: hypotheses.every(h => h.pass), abstentions };
}

export interface CoachScore extends CoachStyle {
  truth: ReturnType<typeof scoreCoachTruth>;
  isolation: { checked: number; violations: number };
  fallback: boolean;
}

export function summarizeCoach(scores: readonly CoachScore[]) {
  const truth = scores.flatMap(row => row.truth ? [row.truth] : []);
  const stages = truth.flatMap(row => row.stages);
  const abstentions = truth.flatMap(row => row.abstentions);
  const leniency = truth.flatMap(row => row.leniency);
  const count = (key: keyof CoachStyle) => scores.reduce((n, score) => n + score[key].length, 0);
  return {
    reviews: scores.length,
    labelled: truth.length,
    agreement: { passed: stages.filter(row => row.actual === row.expected).length, total: stages.length },
    stageClasses: verdicts.map(verdict => {
      const tp = stages.filter(row => row.actual === verdict && row.expected === verdict).length;
      const predicted = stages.filter(row => row.actual === verdict).length;
      const expected = stages.filter(row => row.expected === verdict).length;
      return { verdict, tp, fp: predicted - tp, fn: expected - tp,
        precision: predicted ? tp / predicted : null, recall: expected ? tp / expected : null };
    }),
    hypothesisAccuracy: { passed: truth.filter(row => row.hypothesisSetCorrect).length, total: truth.length },
    abstention: { passed: abstentions.filter(row => row.pass).length, total: abstentions.length },
    leniency: (["start-up", "bloom", "exit-trigger"] as const).map(kind => ({
      kind, passed: leniency.filter(row => row.kind === kind && row.pass).length, total: leniency.filter(row => row.kind === kind).length,
    })),
    tasteIsolation: { checked: scores.reduce((n, s) => n + s.isolation.checked, 0),
      violations: scores.reduce((n, s) => n + s.isolation.violations, 0) },
    tasteLinkViolations: count("taste"),
    styleViolations: count("style"),
    structuralViolations: count("structural"),
    groundingViolations: count("grounding"),
    fallback: scores.filter(s => s.fallback).length,
  };
}
