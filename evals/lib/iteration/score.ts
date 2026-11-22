import type { FullReviewTrace } from "../../../server/recommend/review-evidence.js";
import type { CoachReviewResult, ReviewInput, ReviewResult } from "../../../server/recommend/review-types.js";
import type { PhaseLandmark } from "../../../server/profiles/phase-evidence.js";
import { rulesReviewResult } from "../../../server/recommend/review-local.js";
import { coachOutcomes, gradeCoachCard, scoreCoachTruth, type authoredCoachRows, type CoachScore } from "../review-coach-grader.js";
import { coachExpectation } from "../review-coach-expectations.js";
import { gradeReview } from "../review-grader.js";
import { normalizeLegacyReview } from "../review-ablation.js";
import { scoreReview, type ReviewEvent } from "../review-metrics.js";
import type { ReviewCase } from "../dataset.js";
import type { PumpMode, ReviewLabels } from "../review-labels.js";

export interface IterationCase {
  id: string;
  family: string;
  session: string;
  recipe: string;
  template: string;
  hash: string;
  input: ReviewInput;
  fullTrace?: FullReviewTrace;
  pumpMode: PumpMode;
  legacy?: ReviewCase;
  labels?: ReviewLabels;
  nominal?: boolean;
  gap?: "scale" | "pressure" | "flow" | "temperature" | "profile" | "history";
}

const descriptions: Record<string, RegExp> = {
  cap_like_start: /\b(?:pressure.{0,40}(?:cap|ceiling|limit)|(?:cap|ceiling|limit).{0,40}pressure)\b/,
  cap_like_end: /\b(?:left|fell away from|dropped below) (?:the )?(?:pressure )?(?:cap|ceiling|limit)\b/,
  first_sustained_beverage: /\b(?:cup (?:fill|flow)|beverage|espresso|scale mass) (?:began|started|first|onset)|\bfirst (?:sustained )?(?:drips|gram|beverage)\b/,
  planned_decline: /\b(?:planned|commanded|programmed|intentional|profile.{0,12}) (?:pressure )?(?:decline|fall|drop|taper)\b/,
  planned_rise: /\b(?:planned|commanded|programmed|intentional) (?:pressure )?(?:rise|increase|ramp)\b/,
  pressure_droop_at_held_flow: /\bpressure (?:fell|dropped|declined|drooped).{0,48}\b(?:flow (?:held|stayed|tracked)|steady (?:inlet )?flow)\b/,
  pressure_shortfall: /\bpressure (?:fell |stayed |was |ran )?(?:short|below|under|missed)\b/,
  flow_shortfall: /\bflow (?:fell |stayed |was |ran )?(?:short|below|under|missed)\b/,
  pressure_tracking: /\bpressure (?:held|tracked|followed|stayed (?:near|on)|met).{0,45}\b(?:target|command|plan|setpoint)\b/,
  pressure_step_at_held_flow: /\bpressure (?:stepped|dropped abruptly|jumped).{0,48}\b(?:flow (?:held|stayed|tracked)|steady flow)\b/,
  inlet_flow_plateau: /\b(?:inlet )?flow (?:plateaued|levelled|leveled|hit its ceiling)\b/,
  scale_readings_missing: /\bscale (?:readings |data )?(?:were |was |are |is )?(?:missing|unavailable|lost|unreliable)\b/,
  channeling: /\bchannel(?:l?ing|l?ed)\b/,
  choked: /\b(?:choke[ds]?|choking)\b/,
  gushed: /\b(?:gush(?:ed|ing)?|ran away)\b/,
  weight_jump: /\b(?:scale|mass|weight).{0,24}\b(?:jump|step|reset|discontinuit)\w*\b/,
  scale_gap: /\b(?:scale|mass|weight).{0,28}\b(?:gap|dropout|dropped out|outage)\b/,
  off_target_temp: /\btemperature (?:fell |stayed |was |ran )?(?:short|below|above|under|missed)\b/,
  phase_boundary: /\b(?:phase|step) (?:changed|transitioned|switched)\b/,
  brew_pressure_crest: /\bpressure (?:peaked|crested|reached its maximum)\b/,
  phase_pressure_crest: /\b(?:phase|step) pressure (?:peaked|crested)\b|\bpressure (?:peaked|crested).{0,32}\b(?:in|during) (?:the )?(?:pour|phase|step)\b/,
  fast_shot: /\b(?:earlier|faster|shorter) than (?:the )?(?:time |guide )?window\b/,
  slow_shot: /\b(?:later|slower|longer) than (?:the )?(?:time |guide )?window\b/,
  stop: /\b(?:stopped|ended) (?:early |at |before |on )/,
};
const faults = new Set(["pressure_shortfall", "flow_shortfall", "choked", "gushed", "off_target_temp", "fast_shot", "slow_shot"]);
const inferredTaste = /\b(?:sour(?:ness)?|bitter(?:ness)?|sweet(?:ness)?|fruity|chocolatey|delicious|tasted?)\b/i;
const definiteDiagnosis = /\b(?:channel(?:l?ing|l?ed)|puck defect|under.extract(?:ed|ion)|over.extract(?:ed|ion)|extraction yield)\b/i;
const abstaining = /\b(?:cannot|can't|could not|unavailable|unknown|unreliable|insufficient|missing|not recorded|no reliable)\b/i;

function narratives(text: string, result: ReviewResult, trace: PhaseLandmark[], evidenceIds = result.curve.narrative?.evidenceIds ?? []) {
  const cited = new Set(evidenceIds);
  const phases = result.evidence.analysis.facts.phaseEvidence.phases;
  const covers = (at: number) => phases.some(p => cited.has(p.id) && p.fromS - 0.15 <= at && p.toS + 0.15 >= at)
    || result.evidence.landmarks.some(l => cited.has(l.id) && Math.abs(l.tS - at) <= 0.15);
  const positive = /\b(?:no|not|without|cannot|can't|rules out)\b/;
  return text.toLowerCase().split(/(?<=[.!?])\s+/).flatMap((sentence, order) =>
    Object.entries(descriptions).flatMap(([kind, description]) => {
      if (kind === "brew_pressure_crest" && descriptions.phase_pressure_crest.test(sentence)) return [];
      const hit = description.exec(sentence);
      if (!hit || positive.test(sentence.slice(Math.max(0, hit.index - 24), hit.index))) return [];
      const anchors = trace.filter(event => event.kind === kind && covers(event.t));
      const issues = result.curve.issues.filter((issue, i) => issue.kind === kind && cited.has(`finding-${i + 1}`));
      const time = /(?:\bat|\bby|\bnear|\baround)\s+(\d+(?:\.\d+)?)\s*s(?:\b|ec)/.exec(sentence.slice(hit.index));
      const onsetS = time ? Number(time[1]) : anchors.length === 1 ? anchors[0].t :
        issues.length === 1 ? issues[0].fromS ?? undefined : undefined;
      const anchor = anchors.find(a => onsetS !== undefined && Math.abs(a.t - onsetS) <= 1);
      const observed = phases.find(p => onsetS != null && p.fromS <= onsetS && p.toS >= onsetS);
      const phase = anchor?.at?.substate ?? anchor?.after?.substate ?? observed?.substate;
      const controlled = observed?.mode.value ??
        (kind === "pressure_shortfall" || kind === "pressure_tracking" ? "pressure" :
          kind === "flow_shortfall" || kind.endsWith("_at_held_flow") ? "flow" : undefined);
      const mode = kind === "off_target_temp" ? "temperature" : controlled ?? (kind === "choked" || kind === "gushed" ?
        /\bflow\b/.test(sentence) ? "flow" : /\bpressure\b/.test(sentence) ? "pressure" : undefined : undefined);
      return [{ order, position: hit.index, event: { kind, onsetS, phase: phase ?? undefined, controlledVariable: mode } satisfies ReviewEvent }];
    })).sort((a, b) => a.order - b.order || a.position - b.position);
}

const quantities = /(-?\d+(?:\.\d+)?)\s*(bar\b|ml\s*\/\s*s\b|g\s*\/\s*s\b|g\b|°\s*c\b|s(?:ec(?:ond)?s?)?\b|%)/gi;

function measurements(text: string, input: ReviewInput, c: IterationCase, result: ReviewResult) {
  const labelFigures = c.labels?.source === "synthetic-injected" ? c.labels.figures : [];
  const figures: { id: string; unit: string; value: number }[] = [];
  const errors = new Set<string>();
  for (const match of text.toLowerCase().matchAll(quantities)) {
    const value = Number(match[1]), unit = match[2].replace(/\s/g, "").replace(/^sec(?:ond)?s?$/, "s");
    const context = text.toLowerCase().slice(0, match.index).split(/(?<=[.!?])\s+|,|\b(?:versus|vs|against|while|compared (?:with|to))\b/).at(-1) ?? "";
    const after = text.toLowerCase().slice(match.index + match[0].length);
    const marker = [...context.matchAll(/\b(target|planned|commanded|requested|goal|measured|actual|observed|recorded|held|reached|stayed)\b/g)].at(-1)?.[1];
    const role = /^\s+(?:target|command|goal)\b/.test(after) || marker && /^(?:target|planned|commanded|requested|goal)$/.test(marker)
      ? "target" : marker ? "measured" : undefined;
    const sameRole = role ? labelFigures.filter(f => f.unit.toLowerCase() === unit && f.id.endsWith(`.${role}`)) : [];
    const exact = sameRole.filter(f => Math.abs(f.value - value) <= f.tolerance);
    const matching = exact.length ? exact : sameRole.length === 1 ? sameRole : [];
    for (const f of matching) figures.push({ id: f.id, unit: f.unit, value });
    const keys = unit === "bar" ? ["p", "tp"] as const : unit === "ml/s" ? ["f", "tf"] as const :
      unit === "°c" ? ["temp", "targetTemp"] as const : undefined;
    const recorded = keys ? input.points.flatMap(p => role === "target" ? [p[keys[1]]] :
      role === "measured" ? [p[keys[0]]] : [p[keys[0]], p[keys[1]]]) :
      unit === "g" ? (role === "target" ? [input.targetYieldG] : [input.doseG, input.yieldG]) :
      unit === "s" ? (role === "target" ? input.targetTimeS ?? [] : input.points.map(p => p.t)) :
      unit === "g/s" ? input.points.map(p => p.weightFlow) : [];
    let fixedRoles: number[] | undefined;
    for (const kind of ["pressure_shortfall", "flow_shortfall"]) {
      const comparison = result.curve.issues.find(i => i.kind === kind)?.evidence.match(/target ([\d.]+) (bar|ml\/s), measured ([\d.]+)/);
      if (comparison?.[2] === unit && role) fixedRoles = [Number(comparison[role === "target" ? 1 : 3])];
    }
    const supported = matching.length ? matching.some(f => Math.abs(f.value - value) <= f.tolerance) :
      (fixedRoles ?? recorded).some(n => n != null && Math.abs(n - value) <= 0.15);
    const channel = [...context.matchAll(/\b(pressure|(?:inlet |cup )?flow|temperature)\b/g)].at(-1)?.[1];
    const mismatchedUnit = (unit === "ml/s" && (channel === "pressure" || channel === "temperature" || channel === "cup flow")) ||
      (unit === "bar" && (channel?.endsWith("flow") || channel === "temperature")) ||
      (unit === "°c" && (channel?.endsWith("flow") || channel === "pressure"));
    if (!supported || mismatchedUnit) errors.add(role || mismatchedUnit ? "measurement-role-or-unit" : "invented-measurement");
  }
  return { figures, errors: [...errors] };
}

export interface DeterministicScore {
  critical: string[];
  events: { id: string; kind: string; matched: boolean }[];
  falseAlarms: string[];
  unassessedKinds: string[];
  uncoveredKinds: string[];
  nominal: boolean;
  nominalAlarm: boolean;
  abstention: boolean | null;
  salient: boolean | null;
  diagnostics: string[];
  coach?: CoachScore;
}

export function scoreEpisode(c: IterationCase, result: CoachReviewResult, trace: PhaseLandmark[], rules: boolean,
  isolation: CoachScore["isolation"] = { checked: 0, violations: 0 },
  authored?: ReturnType<typeof authoredCoachRows>): DeterministicScore {
  const text = authored ? authored.map(row => row.text).join(" ") : result.curve.narrative?.text ?? "";
  const detector = normalizeLegacyReview(result.review, c.input, result.evidence);
  const outcomes = coachOutcomes(result.coach.recommendation);
  const outputs = { ...detector, outcomes, claims: { ...detector.claims, "multiple-next-shot-changes": outcomes.length > 1 } };
  const coach: CoachScore = {
    ...gradeCoachCard(result, c.input, rulesReviewResult(c.input, c.fullTrace).coach),
    truth: scoreCoachTruth(result.coach, coachExpectation(c.id, c.labels, c.input.profile)),
    isolation, fallback: false,
  };
  const spoken = authored ? authored.flatMap((row, order) =>
    narratives(row.text, result, trace, row.evidenceIds).map(observation => ({ ...observation, order }))) :
    narratives(text, result, trace);
  const numeric = measurements(text, c.input, c, result);
  const critical: string[] = [...numeric.errors];
  const diagnostics: string[] = [];
  const clauses = text.split(/(?<=[.!?])\s+|[;]|\b(?:but|however|yet)\b/i);
  if (clauses.some(clause => inferredTaste.test(clause) && !abstaining.test(clause))) critical.push("taste-leakage");
  // A stated evidence limit and a diagnosis elsewhere in the answer are scored independently.
  if (clauses.some(clause => definiteDiagnosis.test(clause) && !abstaining.test(clause))) critical.push("unsupported-diagnosis");
  if (outputs.claims["multiple-next-shot-changes"]) critical.push("multiple-changes");
  if (result.taste.notes && !hasSensoryReport(c.input) && c.input.feedback?.sourBitter == null && c.input.feedback?.body == null &&
      result.taste.status !== "uninterpreted_notes") critical.push("unsupported-note-alignment");
  if (c.legacy) {
    for (const check of gradeReview(c.legacy, result.review).checks.filter(check => !check.pass)) {
      if (check.critical) critical.push(`legacy.${check.name}`);
      else diagnostics.push(`legacy.${check.name}`);
    }
    return { critical, diagnostics, events: [], falseAlarms: [], unassessedKinds: [], uncoveredKinds: [],
      nominal: false, nominalAlarm: false, abstention: null, salient: null, coach };
  }
  const labels = c.labels;
  if (labels?.source !== "synthetic-injected") throw new Error("A gym episode requires synthetic labels");
  const output = rules ? outputs : { ...outputs, figures: numeric.figures, events: spoken.map(s => s.event) };
  const assessed = scoreReview(labels, output, c.input.points.map(p => p.t));
  const required = labels.observations.filter(o => o.expected === "required");
  const nominal = c.nominal ?? (required.length === 0 && labels.observations.some(o => o.expected === "forbidden"));
  const gap = c.gap;
  const abstention = gap ?
    (rules ? outputs.outcomes.length === 0 : abstaining.test(text) && new RegExp(`\\b${gap}\\b`, "i").test(text)) : null;
  if (abstention === false) critical.push("unsupported-no-abstention");
  if (assessed.supportedOutcome === false) critical.push("unsupported-outcome");
  if (assessed.forbiddenHits.length) critical.push("forbidden-event");
  if (labels.forbiddenClaims.some(claim => output.claims[claim] === true)) critical.push("forbidden-claim");
  const salientLabel = required[0];
  const first = spoken.find(s => s.order === 0);
  const firstMatches = first && salientLabel && scoreReview({ ...labels, observations: [salientLabel] },
    { ...output, events: [first.event] }, c.input.points.map(p => p.t)).events[0].matched;
  if (assessed.figures.some(f => !f.pass) && numeric.figures.some(f => assessed.figures.some(a => a.id === f.id && !a.pass))) {
    critical.push("contradictory-labelled-figure");
  }
  const knownKinds = new Set(assessed.assessedKinds);
  return {
    critical, diagnostics, coach, events: assessed.events, falseAlarms: assessed.falseAlarms,
    unassessedKinds: [...new Set(output.events.filter(e => !knownKinds.has(e.kind) && (!nominal || !faults.has(e.kind))).map(e => e.kind))],
    uncoveredKinds: rules ? [] : [...knownKinds].filter(kind => !Object.hasOwn(descriptions, kind)),
    nominal, nominalAlarm: nominal && output.events.some(e => faults.has(e.kind) || labels.observations.some(o => o.kind === e.kind && o.expected === "forbidden")),
    abstention, salient: salientLabel ? (rules ? assessed.events[0].matched : !!firstMatches && critical.length === 0) : null,
  };
}

function hasSensoryReport(input: ReviewInput) {
  const note = input.notes ?? input.feedback?.notes ?? "";
  return /\b(?:it|shot|finish|coffee)\s+(?:tasted|was|felt|had)\b/i.test(note);
}
