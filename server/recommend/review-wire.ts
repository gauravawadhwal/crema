import { z } from "zod";
import { FULL_TRACE_PHASE_LIMIT, REVIEW_EVIDENCE_VERSION, type FullReviewTrace, type ReviewTraceSummary } from "./review-evidence.js";

const n = z.number();
const nullable = n.nullable();
const time = n.min(0).max(600);
const count = n.int().nonnegative();
const frame = count.max(100);
const share = n.min(0).max(1);
const pressure = n.min(0).max(20);
const reason = z.string().min(1).max(120);
const mode = z.enum(["pressure", "flow"]);
const text = z.string().max(120);
const option = z.union([z.string().max(30), n]);
const source = z.enum(["recorded", "inferred"]).nullable();
const evidence = <T extends z.ZodType>(value: T) => z.object({ value: value.nullable(), source, reason });
const window = <T extends z.ZodType>(value: T) => evidence(value).extend({ fromS: time, toS: time, coveredS: time });
const readings = evidence(z.object({ entry: nullable, last: nullable, min: n, max: n, timeWeightedMean: nullable })).extend({ coveredS: time });
const proxy = evidence(n);
const hydraulics = window(z.object({ medianPressureBar: pressure, medianInletFlowMlS: n, pressurePerInletFlowProxyBarPerMlS: proxy }));
const thermalOffset = evidence(z.object({ tS: time, actualC: n, targetC: n, offsetC: n }));
const rate = z.union([window(n), evidence(z.never())]);

const phase = z.object({
  id: text, index: count, frame: frame.nullable(), substate: text.nullable(),
  fromS: time, toS: time, durationS: time, phaseSource: z.literal("recorded"), phaseReason: reason,
  purpose: evidence(z.enum(["bloom_or_pause", "fill_or_soak", "decline", "ramp", "hold_or_pour"])), mode: evidence(mode),
  plan: evidence(z.object({
    name: text.nullable(), transition: text.nullable(), endpoint: nullable, maximumS: nullable, temperatureC: nullable,
    limiter: z.object({ value: n, unit: z.enum(["bar", "mL/s"]).nullable(), range: nullable }).nullable(),
    exit: z.object({ type: z.string().max(30).nullable(), condition: z.string().max(30).nullable(), value: option.nullable() }).nullable(),
    weightG: nullable, volumeMl: nullable,
  })),
  controlledUnit: z.enum(["bar", "mL/s"]).nullable(),
  loggedCommand: readings, pressureBar: readings, inletFlowMlS: readings,
  controlledError: window(z.object({ absoluteMean: n, signedMean: n })),
  capLikeTime: window(z.object({ seconds: time, shareOfCoveredTime: share })),
  hiddenFlowPlateau: z.object({ fromS: time, inletFlowMlS: n }).optional(),
  steadyHold: window(z.object({ meanCommand: n, meanResponse: n, otherMean: nullable })),
  earlyHydraulics: hydraulics, lateHydraulics: hydraulics,
  pressureCrest: evidence(z.object({ tS: time, pressureBar: pressure, inletFlowMlS: nullable, pressurePerInletFlowProxyBarPerMlS: proxy })),
  pressureDroopAtHeldFlowBar: evidence(n),
  cupRateEarlyGS: window(n), cupRateLateGS: window(n), cupGainG: evidence(n),
  temperature: evidence(z.object({
    sensor: z.enum(["group", "mix"]), entry: thermalOffset, atOnset: thermalOffset, last: thermalOffset,
    lateMedianOffsetC: window(n), stateBoundaryDeltaC: evidence(z.object({ fromS: time, toS: time, deltaC: n })),
    targetChangeAtEntryC: evidence(n),
  })),
  nextPhase: evidence(z.object({ nextFrame: frame.nullable(), nextSubstate: text.nullable(), nextSampleS: time })),
});

const phaseEvidence = z.object({
  phases: z.array(phase).max(FULL_TRACE_PHASE_LIMIT),
  firstSustainedBeverage: evidence(z.object({
    tS: time, brewElapsedS: time, confirmedThroughS: time, previousBelowGramS: time.nullable(),
    weightG: n, pressureBar: pressure.nullable(), inletFlowMlS: nullable, pressureAtPreviousBelowGramBar: pressure.nullable(),
    pressureAtConfirmationBar: pressure.nullable(), countedVolumeMl: evidence(n),
  })),
  cupRateBeforeOnsetGS: rate, cupRateAfterOnsetGS: rate, cupRateChangeAtOnsetGS: evidence(n),
  scaleClock: evidence(z.enum(["scale_timestamps_checked", "scale_age_checked", "machine_timestamps_only"])),
  scaleAvailability: z.object({ weightSamples: count, staleSamples: count, pairingAgeS: evidence(n),
    gap: z.boolean().default(false), dropout: z.boolean().default(false), jump: z.boolean().default(false) }),
  thermalAvailability: z.object({ mixSamples: count, groupSamples: count }),
  finish: z.object({
    annotatedYieldG: evidence(n), suppliedYieldG: evidence(n), lastRecordedWeightG: evidence(n), yieldToDoseRatio: evidence(n),
    stopSource: evidence(text), lastObservedPhase: evidence(z.object({ index: count, frame: frame.nullable(), toS: time })),
    unobservedPlanPhases: evidence(z.array(z.object({
      frame, name: text.nullable(), status: z.enum(["skipped_or_unrecorded", "preempted_by_weight_stop", "not_observed_before_recording_ended"]),
    })).max(40)),
    volumeCountStartFrame: evidence(n),
  }),
});

export const ReviewTraceWire = z.object({
  version: z.literal(REVIEW_EVIDENCE_VERSION),
  phases: z.array(z.object({
    frame, durationS: time, pressureCoveredS: time, peakPressureBar: pressure, peakPhaseElapsedS: time,
    latePressureBar: pressure.nullable(), lateInletFlowMlS: nullable, capLikeShare: share.nullable(),
  })).max(40),
  firstGramBrewElapsedS: time.nullable(), cupRateAfterOnsetGS: nullable,
  mass: z.object({
    reason, checkpoints: z.array(z.object({
      massG: n.int().min(1).max(500), frame, phaseElapsedS: time, brewElapsedS: time, pressureBar: pressure,
    })).max(102),
  }),
}).superRefine((trace, ctx) => {
  if (new Set(trace.phases.map(p => p.frame)).size !== trace.phases.length ||
      trace.phases.some(p => p.peakPhaseElapsedS > p.durationS || p.pressureCoveredS < 1 || p.pressureCoveredS + 0.002 < 0.8 * p.durationS) ||
      trace.mass.checkpoints.some((p, i, all) => ![1, 2].includes(p.massG) && p.massG % 5 !== 0 ||
        i > 0 && (p.massG <= all[i - 1].massG || p.brewElapsedS < all[i - 1].brewElapsedS))) {
    ctx.addIssue({ code: "custom", message: "trace summary has inconsistent coverage or landmarks" });
  }
}) satisfies z.ZodType<ReviewTraceSummary>;

export const ReviewIssue = z.object({
  kind: z.string().min(1).max(60), what: z.string().min(1).max(300), evidence: z.string().min(1).max(500),
  severity: z.enum(["info", "caution", "warning"]), fromS: time.nullable(), toS: time.nullable(),
});

const fullTraceBody = z.object({
  version: z.literal(REVIEW_EVIDENCE_VERSION), trace: ReviewTraceWire, phaseCount: count,
  analysis: z.object({
    facts: z.object({
      brewStartS: time.nullable(), brewEndS: time.nullable(), durationS: time.nullable(), preinfusionS: time.nullable(),
      pourS: time.nullable(), firstDripsS: time.nullable(), doseG: nullable, yieldG: nullable, targetYieldG: nullable, ratio: nullable,
      stopReason: text.nullable(), peakPressureBar: pressure.nullable(), pourMeanPressureBar: pressure.nullable(), pourMeanFlowMlS: nullable, weightGlitches: count,
      expectedTimeS: z.tuple([time, time]).nullable(), expectedTimeSource: z.enum(["recorded", "recipe", "guide", "provided"]).nullable(),
      timeTargetComparable: z.boolean(), timeStatus: z.enum(["fast", "in_window", "slow"]).nullable(), timeDeltaS: nullable,
      pourSteps: z.array(z.object({
        frame, name: text.nullable(), pump: mode, durationS: time, target: n, actualMean: n, actualPeak: n, otherMean: nullable,
        limiterValue: nullable, limiterEngaged: z.boolean(), steadyTarget: z.boolean(),
      })).max(200),
      phaseEvidence,
    }),
    metrics: z.object({
      recordedPoints: count, usableTemperaturePoints: count, meanTemperatureOffsetC: nullable,
      observedWindows: count, enoughTelemetry: z.boolean(),
    }),
    issues: z.array(ReviewIssue.extend({
      kind: z.enum(["choked", "gushed", "pressure_shortfall", "flow_shortfall", "channeling", "off_target_temp", "fast_shot", "slow_shot"]),
    })).max(200),
    wentWell: z.array(z.string().max(240)).max(2),
    faultWindows: z.array(z.object({ frame, startS: time, endS: time })).max(100),
  }),
});

export const FullReviewTraceWire: z.ZodType<FullReviewTrace> = fullTraceBody;
