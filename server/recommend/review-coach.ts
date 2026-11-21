import type { ProfileStepLike } from "../profiles/curve.js";
import type { PhaseEvidence } from "../profiles/phase-evidence.js";
import { coachHistory } from "./review-history.js";
import type { CurveReview } from "./review-types.js";
import type { CoachMechanics } from "../schema.js";
import type { CurveStageInput } from "./review-local.js";

type Phase = CoachMechanics["phases"][number];
type Stage = CoachMechanics["stages"][number];
type Hypothesis = CoachMechanics["hypotheses"][number];
type Fact = CoachMechanics["headline"];

// Treat a gap within 1.5 seconds of ten as about ten, and report the measured time.
const NOTABLE_PACE_GAP_S = 10 - 1.5;
const fact = (sentence: string, ...evidenceIds: string[]): Fact => ({ sentence, evidenceIds });
const number = (n: number) => String(Number(n.toFixed(1)));
const quantity = (n: number, unit: string) => `${number(n)} ${unit}`;
const stageNames = (names: string[]) => names.length === 1 ? names[0].toLowerCase() :
  `${names.slice(0, -1).join(", ").toLowerCase()} and ${names.at(-1)!.toLowerCase()}`;
const configuredNumber = (value: string | number | undefined) =>
  value != null && String(value).trim() && Number.isFinite(Number(value)) ? Number(value) : null;
const coverage = (p: PhaseEvidence) => p.controlledError.value != null &&
  p.controlledError.coveredS >= 0.5 && p.controlledError.coveredS + 0.002 >= 0.8 * p.durationS;

function phaseName(step: ProfileStepLike, p?: PhaseEvidence) {
  const name = step.name ?? "";
  if (/bloom|pause/i.test(name) || p?.purpose.value === "bloom_or_pause") return "Bloom";
  if (/declin|ramp down/i.test(name) || p?.purpose.value === "decline") return "Decline";
  if (/soak|^infuse$/i.test(name)) return "Soak";
  if (/fill|preinfus/i.test(name) || p?.purpose.value === "fill_or_soak") return /start|boost/i.test(name) ? "Fill start" : "Fill";
  if (/ramp|rise|build|pressure up/i.test(name) || p?.purpose.value === "ramp") {
    return p?.steadyHold.value ? "Main pour" : step.pump?.toLowerCase() === "flow" ? "Flow build" : "Pressure build";
  }
  if (/flow limit/i.test(name)) return "Flow limit";
  return "Main pour";
}

function phaseRow(step: ProfileStepLike, p: PhaseEvidence | undefined, reason: string, name: string, role: string, frame: number): Phase {
  const flow = step.pump?.toLowerCase() === "flow";
  const unit = flow ? "mL/s" : "bar";
  const variable = flow ? "flow" : "pressure";
  const configured = configuredNumber(flow ? step.flow : step.pressure);
  const limit = p?.plan.value?.limiter?.value ?? configuredNumber(step.limiter?.value);
  const otherUnit = flow ? "bar" : "mL/s";
  const command = p?.loggedCommand.value;
  const hold = p?.steadyHold.value;
  const actualReadings = flow ? p?.inletFlowMlS.value : p?.pressureBar.value;
  const changed = command?.entry != null && command.last != null &&
    Math.abs(command.last - command.entry) >= (flow ? 0.3 : 0.5);
  const target = hold?.meanCommand ?? command?.timeWeightedMean ?? configured;
  const down = changed && command!.last! < command!.entry!;
  const actualMean = hold?.meanResponse ?? actualReadings?.timeWeightedMean;
  const supported = /^(flow|pressure)$/i.test(step.pump ?? "");
  const base = { id: `planned-${frame}`, name, unit: supported ? unit : null, evidenceIds: [p?.id ?? "finish"],
    expected: supported && target != null ? { start: command?.entry ?? null, finish: command?.last ?? configured, average: target } : null,
    actual: supported && actualReadings ? { start: actualReadings.entry, finish: actualReadings.last, average: actualMean ?? null } : null,
    ceiling: supported && limit != null && limit > 0 ? { value: limit, unit: otherUnit } : null,
    meanAbsoluteError: p?.controlledError.value?.absoluteMean ?? null } satisfies Omit<Phase, "verdict" | "sentence">;
  if (!p || !coverage(p) || target == null || actualMean == null) return {
    ...base, verdict: "not_graded", sentence: p ? "You have too little paired target and response data to judge this phase." : reason,
  };

  // Judge the controlled channel against the logged command. Start-up lag in a
  // long hold is covered by the settled window. The uncontrolled channel is
  // context, so a flow hold can be on plan well below its pressure ceiling.
  const error = hold ? Math.abs(hold.meanResponse - hold.meanCommand) : p.controlledError.value!.absoluteMean;
  const scale = Math.max(Math.abs(target), changed ? Math.abs(command!.entry!) : 0, changed ? Math.abs(command!.last!) : 0);
  const close = Math.max(flow ? 0.3 : 0.5, 0.2 * scale);
  const wide = Math.max(flow ? 0.6 : 1, 0.4 * scale);
  const limited = (p.capLikeTime.value?.shareOfCoveredTime ?? 0) >= 0.2;
  // A pressure command during wetting can be a ceiling the chamber hasn't
  // filled enough to reach. A threshold can also end the phase before its target.
  const fill = role === "Fill" || role === "Fill start";
  const pressureExit = step.exit?.type?.toLowerCase() === "pressure";
  if (fill && error > close) {
    const endShort = !flow && !pressureExit && role !== "Fill start" && p.durationS >= 2 &&
      actualReadings?.last != null && command?.last != null && command.last - actualReadings.last > close;
    return { ...base, verdict: endShort ? "partly" : "not_graded", sentence: endShort ?
      "Pressure was still below the setpoint when filling ended." :
      "The machine was still filling, so this phase is hard to judge against the target." };
  }
  const bloom = role === "Bloom";
  const wholePhaseHigh = flow && p.durationS >= 1 && actualReadings?.min != null && command?.max != null &&
    actualReadings.min - command.max >= wide && p.controlledError.coveredS + 0.002 >= 0.95 * p.durationS;
  if ((bloom || pressureExit) && error > close && !wholePhaseHigh) {
    return { ...base, verdict: p.durationS < 1 ? "not_graded" : "partly", sentence:
      `${flow ? "Flow" : "Pressure"} was off target, with no clear exit trigger in the recording.` };
  }
  const verdict = error <= close ? "on_plan" : error >= wide ? "off_plan" : "partly";
  const direction = (hold ? hold.meanResponse - hold.meanCommand : p.controlledError.value!.signedMean) < 0 ? "below" : "above";
  const channel = flow ? "Flow" : "Pressure";
  const sentence = verdict === "on_plan" ? (changed && !hold
    ? `The machine followed the planned ${variable} ${down ? "drop" : "rise"}.`
    : bloom ? "The machine followed the planned pause." : `The machine held close to the planned ${variable}.`)
    : limited ? `The ${flow ? "pressure" : "flow"} ceiling held ${variable} below target for part of the phase.`
    : changed && !hold ? `${channel} ${down ? "eased" : "built"} ${direction === (down ? "above" : "below") ? "more slowly" : "more quickly"} than planned.`
    : verdict === "off_plan" && target > 0 ?
      `${channel} averaged ${quantity(actualMean, unit)} against a target of ${quantity(target, unit)}.`
      : `${channel} ran ${verdict === "off_plan" ? "well " : ""}${direction} the plan.`;
  return { ...base, verdict, sentence };
}

function phaseRows(steps: ProfileStepLike[], observed: PhaseEvidence[], stage: CurveStageInput) {
  const { finish } = stage.evidence.analysis.facts.phaseEvidence;
  const missed = new Map(finish.unobservedPlanPhases.value?.map(p => [p.frame, p.status]));
  const planned = steps.map((step, frame) => {
    const runs = observed.filter(p => p.frame === frame && p.plan.value);
    const p = runs.reduce<PhaseEvidence | undefined>((best, run) =>
      !best || run.controlledError.coveredS > best.controlledError.coveredS ? run : best, undefined);
    return { step, p, role: phaseName(step, p) };
  });
  return planned.map(({ step, p, role }, frame) => {
    const siblings = planned.flatMap((phase, index) => phase.role === role ? [index] : []);
    const order = siblings.indexOf(frame);
    const lower = role.toLowerCase();
    const name = siblings.length === 1 ? role : role === "Main pour" ?
      order === 0 ? "Opening pour" : order === siblings.length - 1 ? "Finish pour" : role :
      order === 0 ? `Opening ${lower}` : order === siblings.length - 1 ? `Final ${lower}` : role;
    const status = missed.get(frame);
    const reason = status === "preempted_by_weight_stop" ? "The shot reached target weight before this phase." :
      status === "skipped_or_unrecorded" ? "This phase was skipped or its readings are missing." :
      status === "not_observed_before_recording_ended" ? "The shot ended before this phase was recorded." :
      "The recording couldn't be matched to this phase.";
    return { phase: phaseRow(step, p, reason, name, role, frame), role, durationS: p?.durationS ?? 0 };
  });
}

const VERDICT_ORDER = { not_graded: 0, on_plan: 1, partly: 2, off_plan: 3 };

function stageRows(planned: ReturnType<typeof phaseRows>): Stage[] {
  const groups: { name: string; phases: Phase[] }[] = [];
  let pouring = false;
  let finishing = false;
  for (const { phase, role, durationS } of planned) {
    finishing ||= role === "Decline" || role === "Flow limit";
    const distinct: boolean = !pouring && !finishing && (role === "Bloom" || role === "Soak") &&
      (phase.verdict === "partly" || phase.verdict === "off_plan" || role === "Bloom" && durationS >= 3);
    pouring ||= role === "Main pour" || distinct;
    const name = finishing ? "Finish" : distinct ? role : pouring ? "Main pour" : "Start-up";
    const last = groups.at(-1);
    if (last?.name === name) last.phases.push(phase);
    else groups.push({ name, phases: [phase] });
  }
  return groups.map(({ name, phases }) => {
    const worst = phases.reduce((best, p) => VERDICT_ORDER[p.verdict] > VERDICT_ORDER[best.verdict] ? p : best);
    const { verdict } = worst;
    const tracked = phases.filter(p => p.verdict === "on_plan");
    const flow = tracked.some(p => p.unit === "mL/s");
    const pressure = tracked.some(p => p.unit === "bar");
    let sentence = worst.sentence;
    if (name === "Start-up" && verdict === "on_plan" && phases.length > 1) {
      sentence = `The machine built ${flow && pressure ? "flow and pressure" : flow ? "flow" : "pressure"} as planned.`;
    } else if (name === "Main pour" && verdict === "on_plan") {
      sentence = `The machine held close to the planned ${tracked.at(-1)?.unit === "mL/s" ? "flow" : "pressure"}.`;
    } else if (name === "Main pour" && verdict === "partly" && /build/i.test(worst.name) &&
        phases.slice(phases.indexOf(worst) + 1).some(p => p.verdict === "on_plan" && p.unit === worst.unit)) {
      sentence = `${worst.sentence.slice(0, -1)}, then the machine held it close to target.`;
    } else if (name === "Finish" && verdict === "not_graded" && phases.every(p => p.actual == null) &&
        worst.sentence === "The shot reached target weight before this phase.") {
      sentence = "The shot reached target weight before the planned finish.";
    }
    return { name, verdict, sentence, phaseIds: phases.map(p => p.id), evidenceIds: [...new Set(phases.flatMap(p => p.evidenceIds))] };
  });
}

const TEMPERATURE_BAND_C = 2;
const LARGE_TEMPERATURE_MISS_C = 5;
const LARGE_TEMPERATURE_MISS_AFTER_DROP_C = 6;

function temperatureRow(phases: PhaseEvidence[]): CoachMechanics["temperature"] {
  const pairs = phases.flatMap(p => p.temperature.value ? [{ p, t: p.temperature.value }] : []);
  const entry = pairs.find(({ t }) => t.entry.value)?.t;
  const end = pairs.at(-1)?.t;
  const named = { id: "temperature", name: "Temperature", unit: "°C" as const, expected: null, actual: null,
    ceiling: null, meanAbsoluteError: null,
    phaseIds: [...new Set(pairs.flatMap(({ p }) => p.frame == null ? [] : [`planned-${p.frame}`]))] };
  const ids = pairs.map(({ p }) => p.id);
  if (!end?.last.value || ids.length === 0) {
    return { ...named, verdict: "not_graded", ...fact("The recording is missing the temperature or target from the sensor this profile controls.", "temperature") };
  }
  const final = end.last.value;
  const first = entry?.entry.value;
  const startDip = first && first.offsetC < -TEMPERATURE_BAND_C;
  const entryDip = pairs.find(({ t }) => (t.entry.value?.offsetC ?? 0) < -TEMPERATURE_BAND_C);
  const missedLate = pairs.filter(({ t }) => Math.abs(t.lateMedianOffsetC.value ?? 0) > TEMPERATURE_BAND_C);
  const settled = end.lateMedianOffsetC.value;
  const hasCoverage = pairs.some(({ t }) => t.lateMedianOffsetC.value != null);
  const near = Math.abs(final.offsetC) <= TEMPERATURE_BAND_C;
  const lowered = pairs.some(({ t }) => t.sensor === end.sensor && (t.entry.value?.targetC ?? final.targetC) > final.targetC + 1);
  const easing = settled != null && Math.sign(settled) === Math.sign(final.offsetC) &&
    Math.abs(settled) - Math.abs(final.offsetC) >= 1;
  const sustained = settled != null && end.lateMedianOffsetC.coveredS >= 3 &&
    Math.sign(settled) === Math.sign(final.offsetC) &&
    Math.min(Math.abs(settled), Math.abs(final.offsetC)) >
      (lowered ? LARGE_TEMPERATURE_MISS_AFTER_DROP_C : LARGE_TEMPERATURE_MISS_C);
  const finishTarget = lowered ? "the lower finish target" : "the finish target";
  const finish = near ? "recovered near target by the end" : easing ? `was still settling toward ${finishTarget}` :
    final.offsetC > 0 ? `ended above ${finishTarget}` : "stayed below target at the end";
  const verdict = !hasCoverage ? "not_graded" :
    sustained && !easing ? "off_plan" :
    entryDip || Math.abs(first?.offsetC ?? 0) > TEMPERATURE_BAND_C || missedLate.length || !near ? "partly" : "on_plan";
  const dip = entryDip?.t.entry.value;
  const opening = startDip ? `${entry?.sensor === "group" ? "Group" : "Mix-water"} temperature started cold` :
    dip ? `The ${entryDip!.t.sensor === "group" ? "group" : "mix-water"} reading dipped below target at a phase change` : null;
  const sentence = opening ? `${opening} and ${finish}.` :
    verdict === "on_plan" ? "Temperature held near the sensor target." :
    verdict === "not_graded" ? "You have an end reading, with too little data to judge how well temperature held." :
    near ? "Temperature returned near target for the finish." : easing ? `Temperature was still settling toward ${finishTarget}.` :
      `Temperature stayed ${verdict === "off_plan" ? "well " : ""}${final.offsetC < 0 ? "below" : "above"} ${finishTarget}.`;
  return { ...named, verdict,
    expected: { start: first?.targetC ?? null, finish: final.targetC, average: null },
    actual: { start: first?.actualC ?? null, finish: final.actualC, average: null },
    ...fact(sentence, "temperature", ...ids) };
}

/** New descriptive hypothesis only. The existing fault detectors and advice thresholds stay unchanged. */
function easyFlowPhase(facts: CurveStageInput["evidence"]["analysis"]["facts"]) {
  const { phases, cupRateAfterOnsetGS, firstSustainedBeverage } = facts.phaseEvidence;
  const onset = firstSustainedBeverage.value;
  return phases.find(p => {
    const hold = p.steadyHold.value;
    const ceiling = p.plan.value?.limiter?.value;
    const pressure = p.pressureCrest.value?.pressureBar;
    return p.mode.value === "flow" && hold && hold.meanCommand > 3 &&
      Math.abs(hold.meanResponse - hold.meanCommand) <= 0.1 * hold.meanCommand &&
      ceiling != null && pressure != null && pressure <= 0.5 * ceiling &&
      onset && onset.tS >= p.fromS && onset.tS <= p.toS && (cupRateAfterOnsetGS.value ?? 0) >= 3;
  });
}

function hypotheses(curve: CurveReview, easy: PhaseEvidence | undefined): Hypothesis[] {
  const result: Hypothesis[] = [];
  const causes = [
    { kinds: ["gushed", "pressure_shortfall"], timing: "fast_shot", id: "easy-flow", label: "Easy flow",
      signature: "sour_thin", tracking: "This fits an easy pour where your puck offered little resistance.",
      pace: "An early finish could mean your water moved through the coffee too quickly." },
    { kinds: ["choked", "flow_shortfall"], timing: "slow_shot", id: "restricted-flow", label: "Restricted flow",
      signature: "bitter_heavy", tracking: "This fits a restricted pour where water had trouble getting through your puck.",
      pace: "A long finish could mean water moved more slowly through your coffee." },
  ] as const;
  for (const pattern of causes) {
    const measured = curve.issues.findIndex(issue => pattern.kinds.some(kind => issue.kind === kind));
    const timing = curve.issues.findIndex(issue => issue.kind === pattern.timing);
    const easyHold = pattern.id === "easy-flow" ? easy : undefined;
    if (measured < 0 && timing < 0 && !easyHold) continue;
    const ids = [measured >= 0 ? `finding-${measured + 1}` : null, timing >= 0 ? "timing" : null,
      ...(easyHold ? [easyHold.id, "cup"] : [])].filter(id => id != null);
    result.push({ id: pattern.id, label: pattern.label, signature: pattern.signature,
      confidence: measured >= 0 && timing >= 0 ? "medium" : "low",
      ...fact(measured >= 0 || easyHold ? pattern.tracking : pattern.pace, ...ids) });
  }
  const risingFlow = curve.issues.findIndex(issue => issue.kind === "channeling");
  if (result.length < 2 && risingFlow >= 0) result.push({
    id: "freer-late-flow", label: "Freer flow late", signature: "none", confidence: "low",
    ...fact("The rising flow at steady pressure could mean water found it easier to get through your puck later in the pour.", `finding-${risingFlow + 1}`),
  });
  return result;
}

export function rulesCoachMechanics(stage: CurveStageInput, curve: CurveReview): CoachMechanics {
  const { facts, metrics } = stage.evidence.analysis;
  const evidence = facts.phaseEvidence;
  const planned = phaseRows(stage.steps, evidence.phases, stage);
  const phases = planned.map(row => row.phase);
  const stages = stageRows(planned);
  const temperature = temperatureRow(evidence.phases);
  const notable: Fact[] = [];
  const easy = easyFlowPhase(facts);
  const cup = evidence.firstSustainedBeverage.value;
  const after = evidence.cupRateAfterOnsetGS.value;
  const rapidFill = (after ?? 0) >= 3 && (evidence.cupRateBeforeOnsetGS.value ?? Infinity) <= 1;
  if (cup && cup.previousBelowGramS != null && (cup.brewElapsedS >= 6 || rapidFill)) {
    const started = (evidence.cupRateBeforeOnsetGS.value ?? Infinity) <= 1
      ? `Your cup stayed nearly dry for about ${quantity(cup.brewElapsedS, "s")}`
      : `Your cup reached its first gram after about ${quantity(cup.brewElapsedS, "s")}`;
    notable.push(fact(started + (rapidFill ? ", then filled quickly." : after != null && after < 1 ? ", then filled slowly." : "."), "cup", "first-sustained-gram"));
  } else if (metrics.enoughTelemetry && evidence.scaleAvailability.weightSamples === 0) {
    notable.push(fact("Your scale readings were unavailable, so cup fill couldn't be assessed.", "recording"));
  }
  const held = easy?.steadyHold.value;
  const pressure = easy?.pressureCrest.value?.pressureBar;
  const ceiling = easy?.plan.value?.limiter?.value;
  if (easy && held && pressure != null && ceiling != null) {
    notable.push(fact(`The machine held ${quantity(held.meanCommand, "mL/s")}, with pressure reaching only ${quantity(pressure, "bar")} under its ${quantity(ceiling, "bar")} ceiling.`, easy.id));
  }
  const paceIssue = curve.issues.find(i => i.kind === "fast_shot" || i.kind === "slow_shot");
  if (paceIssue && facts.durationS != null && facts.expectedTimeS) {
    const [lo, hi] = facts.expectedTimeS;
    if (Math.max(lo - facts.durationS, facts.durationS - hi) >= NOTABLE_PACE_GAP_S) {
      const basis = facts.expectedTimeSource === "guide" ? "guide" : "expected window";
      notable.push(fact(`The shot finished in about ${quantity(facts.durationS, "s")} against a ${number(lo)}–${quantity(hi, "s")} ${basis}.`, "timing", "recording"));
    }
  }
  const droop = evidence.phases.find(p => (p.pressureDroopAtHeldFlowBar.value ?? 0) >= 0.5 &&
    p.pressureCrest.value && p.lateHydraulics.value);
  if (droop && notable.length < 3) notable.push(fact("Pressure eased later even as the machine held flow steady.", droop.id));
  else if (curve.issues.some(i => i.kind === "channeling")) {
    notable.push(fact("Flow rose even as the machine held pressure near its target.", `finding-${curve.issues.findIndex(i => i.kind === "channeling") + 1}`));
  }

  const patterns = hypotheses(curve, easy);
  const main = stages.filter(row => row.name !== "Start-up");
  const bad = main.find(row => row.verdict === "off_plan");
  const departures = main.filter(row => row.verdict === "partly");
  const partly = departures[0];
  const mainPour = main.find(row => row.name === "Main pour");
  const trackedMain = planned.find(row => row.role === "Main pour" && row.phase.verdict === "on_plan" &&
    mainPour?.phaseIds.includes(row.phase.id))?.phase;
  const good = main.find(row => row.name === "Main pour" && row.verdict === "on_plan") ?? trackedMain ??
    main.find(row => row.verdict === "on_plan");
  const goodBuild = planned.find(row => /build/.test(row.role) && row.phase.verdict === "on_plan")?.phase;
  const preempted = stages.find(row => row.name === "Finish" && row.sentence === "The shot reached target weight before the planned finish.");
  const between = (row: Stage) => goodBuild && bad && stages[0]?.name === "Start-up" && stages[0]?.verdict === "on_plan"
    ? fact(`The machine followed the plan through the start-up, then missed its target during the ${row.name.toLowerCase()}.`, ...goodBuild.evidenceIds, ...row.evidenceIds)
    : fact(`The machine ${row.verdict === "off_plan" ? "missed its target" : "only partly followed the plan"} during the ${row.name.toLowerCase()}.`, ...row.evidenceIds);
  const mixed = () => {
    const followed = main.flatMap(row => row.verdict === "on_plan" || row.name === "Main pour" && trackedMain ? [row.name] : []);
    const differed = departures.flatMap(row => row.name === "Main pour" && trackedMain ?
      phases.filter(p => row.phaseIds.includes(p.id) && p.verdict === "partly").map(p => p.name) : [row.name]);
    return fact(`The machine followed the plan through the ${stageNames(followed)}, with the ${stageNames(differed)} running differently.`,
      ...main.filter(row => row.verdict === "on_plan" || row.verdict === "partly").flatMap(row => row.evidenceIds));
  };
  const restricted = patterns.find(h => h.id === "restricted-flow");
  const lateFlow = patterns.find(h => h.id === "freer-late-flow");
  const headline = bad ? between(bad) : easy ?
    fact("The machine held the planned flow, and the fast cup fill at low pressure fits a puck offering little resistance.", easy.id, "cup") :
    good && restricted && (evidence.cupRateAfterOnsetGS.value ?? Infinity) < 1 ?
      fact("The machine followed the main pour plan, and the cup filled slowly once the first gram came through.", ...good.evidenceIds, "cup") :
    good && lateFlow ? fact("The machine held the planned pressure as flow picked up late in the pour.", ...good.evidenceIds, ...lateFlow.evidenceIds) :
    partly && good ? mixed() :
    partly ? between(partly) :
    preempted && !good ? fact(preempted.sentence, ...preempted.evidenceIds) :
    paceIssue ? fact(`The shot finished ${paceIssue.kind === "fast_shot" ? "earlier" : "later"} than the plan's time window.`, "timing") :
    good ? fact(temperature.verdict === "on_plan" ? "The machine followed the plan through the main phases and temperature held near target." :
      temperature.verdict === "off_plan" ? "The machine followed the main pour plan with a sustained temperature miss." :
      temperature.verdict === "partly" ? "The machine followed the main pour plan with some variation in temperature." :
        "The machine followed the plan through the measured main phases.", ...main.filter(p => p.verdict === "on_plan").flatMap(p => p.evidenceIds), "temperature") :
    fact(!metrics.recordedPoints ? "You have no recorded curve to compare with the plan." :
      stage.profile === "manual" ? "Your manual shot has no fixed automatic curve to compare against." :
        "Your recording lacks enough phase data for a verdict against the plan.", "recording");
  return { headline, phases, stages, temperature, notable: notable.slice(0, 3), hypotheses: patterns, history: coachHistory(stage.evidence.history, facts) };
}
