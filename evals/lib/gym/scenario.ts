import { z } from "zod";
import { outlineProfile, type ProfileLike } from "../../../server/profiles/curve.js";
import { SyntheticReviewLabels } from "../review-labels.js";

const id = z.string().regex(/^[a-z0-9][a-z0-9_.-]*$/).max(80);
const seconds = z.number().min(0).max(180);
const positiveS = seconds.min(0.01);
const temperature = z.number().min(65).max(100);
const channel = z.enum(["pressure", "flow"]);
const limit = z.strictObject({ value: z.number().gt(0).max(12), range: z.number().min(0).max(12).default(0) })
  .refine((v) => v.range <= v.value, "limiter range exceeds the cap");
const step = z.strictObject({
  name: z.string().min(1).max(64),
  pump: channel,
  target: z.number().min(0).max(12),
  seconds: positiveS,
  transition: z.enum(["fast", "smooth"]).default("fast"),
  sensor: z.enum(["coffee", "water"]).default("coffee"),
  temperatureC: temperature.optional(),
  limiter: limit.optional(),
  exit: z.strictObject({ type: channel, condition: z.enum(["under", "over"]), value: z.number().min(0).max(12) }).optional(),
  weightG: z.number().gt(0).max(200).optional(),
  substate: z.enum(["preinfusion", "pouring"]).default("pouring"),
});

const outlines = {
  "flat-pressure": "flat-pressure", lever: "lever", "fixed-flow": "flow",
  allonge: "allonge", bloom: "blooming", turbo: "turbo", adaptive: "adaptive",
} as const;

const intervention = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("low-resistance"), atS: seconds.default(0), factor: z.number().min(0.1).lt(1) }),
  z.strictObject({ kind: z.literal("restriction"), atS: seconds.default(0), factor: z.number().gt(1).max(20) }),
  z.strictObject({ kind: z.literal("flow-cap"), atS: seconds.default(0), maxMlS: z.number().gt(0).max(8) }),
  z.strictObject({ kind: z.literal("onset-dynamics"), fillMl: z.number().min(4).max(35), delayMl: z.number().min(0).max(12) }),
  z.strictObject({ kind: z.literal("tare-jump"), atS: seconds, deltaG: z.number().min(-100).max(100).refine((v) => v !== 0) }),
  z.strictObject({ kind: z.literal("scale-loss"), atS: seconds.default(0), untilS: positiveS.optional() }),
  z.strictObject({ kind: z.literal("sensor-lag"), channel: z.enum(["pressure", "flow", "temperature"]), delayS: positiveS.max(5) }),
  z.strictObject({ kind: z.literal("thermal-recovery"), atS: seconds, dropC: z.number().gt(0).max(15), recoveryS: positiveS.max(30) }),
]);

// Reuse the runner's exact label schema. The kernel fills in only provenance.
const grading = SyntheticReviewLabels.omit({ source: true, injection: true }).extend({
  consequence: z.string().min(1).max(500),
  unknowableWhen: z.array(z.string().min(1).max(500)).min(1),
  acceptCauseAbstention: z.boolean().default(true),
});

export const GymScenario = z.strictObject({
  version: z.literal(1),
  id,
  session: id,
  recipe: id,
  family: z.enum(Object.keys(outlines) as (keyof typeof outlines)[]),
  split: z.enum(["dev", "holdout"]).default("dev"),
  profile: z.strictObject({
    temperatureC: temperature.default(92),
    steps: z.array(step).min(1).max(12).optional(),
  }).default({ temperatureC: 92 }),
  doseG: z.number().min(8).max(30).default(18),
  stop: z.strictObject({ timeS: positiveS.default(90), weightG: z.number().gt(0).max(300).optional() }).default({ timeS: 90 }),
  puck: z.strictObject({ resistance: z.number().min(0.3).max(16).default(4.4) }).default({ resistance: 4.4 }),
  interventions: z.array(intervention).default([]),
  grading,
}).superRefine((s, ctx) => {
  const seen = new Set<string>();
  s.interventions.forEach((effect, i) => {
    const key = effect.kind === "sensor-lag" ? effect.kind + ":" + effect.channel : effect.kind;
    if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["interventions", i], message: "duplicate intervention" });
    seen.add(key);
    if ("atS" in effect && effect.atS >= s.stop.timeS) {
      ctx.addIssue({ code: "custom", path: ["interventions", i, "atS"], message: "intervention starts at or after the shot time limit" });
    }
    if (effect.kind === "scale-loss" && effect.untilS != null && effect.untilS <= effect.atS) {
      ctx.addIssue({ code: "custom", path: ["interventions", i, "untilS"], message: "scale-loss window must have positive duration" });
    }
  });
});

export type GymScenario = z.infer<typeof GymScenario>;
type GymStep = z.infer<typeof step>;

/** Use the built-in outlines unless a manifest supplies the recorded plan explicitly. */
export function gymSteps(scenario: GymScenario): GymStep[] {
  if (scenario.profile.steps) return scenario.profile.steps;
  return outlineProfile("", outlines[scenario.family], scenario.profile.temperatureC).steps!.map((s, i) => step.parse({
    name: s.name,
    pump: s.pump,
    target: Number(s.pump === "pressure" ? s.pressure : s.flow),
    seconds: Number(s.seconds),
    transition: s.transition,
    sensor: s.sensor,
    temperatureC: Number(s.temperature),
    limiter: s.limiter ? { value: Number(s.limiter.value), range: Number(s.limiter.range) } : undefined,
    exit: s.exit ? { ...s.exit, value: Number(s.exit.value) } : undefined,
    weightG: Number(s.weight) || undefined,
    substate: i === 0 ? "preinfusion" : "pouring",
  }));
}

export function recordedProfile(scenario: GymScenario, steps: GymStep[]): ProfileLike {
  return {
    title: `Synthetic ${scenario.family}`,
    beverage_type: "espresso",
    target_weight: scenario.stop.weightG,
    target_volume_count_start: 0,
    steps: steps.map((s) => ({
      name: s.name, pump: s.pump, transition: s.transition, seconds: s.seconds,
      pressure: s.pump === "pressure" ? s.target : 0, flow: s.pump === "flow" ? s.target : 0,
      temperature: s.temperatureC ?? scenario.profile.temperatureC, sensor: s.sensor,
      limiter: s.limiter ?? null, exit: s.exit ?? null, weight: s.weightG,
    })),
  };
}
