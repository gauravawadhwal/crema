import { z } from "zod";

const name = z.string().min(1);
const id = z.string().regex(/^[a-z0-9][a-z0-9_.-]*$/);
const seconds = z.number().nonnegative().max(600);
const bounds = z.tuple([seconds, seconds]).refine(([lo, hi]) => lo <= hi, "time bounds must be ordered");
const timingFields = { onsetS: bounds, peakS: bounds.optional() };

export const PumpMode = z.enum(["pressure", "flow", "mixed", "manual", "unknown"]);
export const ReviewOutcome = z.enum(["abstain", "grind-finer", "grind-coarser", "change-yield", "change-temperature", "switch-profile"]);
export const ReviewClaim = z.enum(["inferred-taste", "unqualified-diagnosis", "multiple-next-shot-changes"]);

const Observation = z.strictObject({
  id,
  kind: name,
  phase: name.optional(),
  controlledVariable: z.enum(["pressure", "flow", "temperature", "yield", "time"]).optional(),
  expected: z.enum(["required", "forbidden"]),
  timing: z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("raw-landmark"), ...timingFields }),
    z.strictObject({ type: z.literal("windowed-event"), ...timingFields }),
  ]).optional(),
});

const maxTolerance = { bar: 1, "ml/s": 1, "mL/s": 1, "g/s": 1, g: 2, ml: 2, mL: 2, s: 1, "°C": 1, shots: 0.01, samples: 0, frame: 0 } as const;
const units = Object.keys(maxTolerance) as (keyof typeof maxTolerance)[];
const Figure = z.strictObject({ id, unit: z.enum(units), value: z.number(), tolerance: z.number().nonnegative() })
  .refine(f => f.tolerance <= maxTolerance[f.unit], { path: ["tolerance"], message: "Tolerance exceeds the unit limit" });
const decisions = {
  supportedOutcomes: z.array(ReviewOutcome).min(1).optional(),
  forbiddenClaims: z.array(ReviewClaim).default([]),
};
const mechanical = {
  ...decisions,
  observations: z.array(Observation),
  figures: z.array(Figure).default([]),
  exhaustiveEventKinds: z.array(name).optional(),
  exhaustiveFigures: z.boolean().default(false),
};

export const SyntheticReviewLabels = z.strictObject({ source: z.literal("synthetic-injected"), ...mechanical, injection: name });

export const ReviewLabels = z.discriminatedUnion("source", [
  z.strictObject({ source: z.literal("measured-reference"), ...mechanical, reference: name }),
  SyntheticReviewLabels,
  z.strictObject({
    source: z.literal("sensory"),
    ...decisions,
    taste: z.strictObject({
      sourBitter: z.number().min(-2).max(2).optional(),
      body: z.number().min(-2).max(2).optional(),
      enjoyment: z.number().min(0).max(10).optional(),
      notes: name.optional(),
    }).refine((value) => Object.keys(value).length > 0, "include a sensory report"),
  }),
]).superRefine((labels, ctx) => {
  if (labels.source === "sensory") return;
  const seen = new Set<string>();
  for (const [key, entries] of [["observations", labels.observations], ["figures", labels.figures]] as const) {
    entries.forEach((entry, index) => {
      if (seen.has(entry.id)) ctx.addIssue({ code: "custom", path: [key, index, "id"], message: "duplicate label id" });
      seen.add(entry.id);
    });
  }
  const overlaps = (a?: [number, number], b?: [number, number]) => !a || !b || a[0] <= b[1] && b[0] <= a[1];
  for (const [index, a] of labels.observations.entries()) {
    const conflicts = labels.observations.slice(index + 1).some(b => a.expected !== b.expected && a.kind === b.kind &&
      (!a.phase || !b.phase || a.phase === b.phase) &&
      (!a.controlledVariable || !b.controlledVariable || a.controlledVariable === b.controlledVariable) &&
      overlaps(a.timing?.onsetS, b.timing?.onsetS) && overlaps(a.timing?.peakS, b.timing?.peakS));
    if (conflicts) ctx.addIssue({ code: "custom", path: ["observations", index], message: "Required and forbidden predicates overlap" });
  }
});

export type ReviewLabels = z.infer<typeof ReviewLabels>;
export type Observation = z.infer<typeof Observation>;
export type PumpMode = z.infer<typeof PumpMode>;
export type ReviewOutcome = z.infer<typeof ReviewOutcome>;
export type ReviewClaim = z.infer<typeof ReviewClaim>;

export function validateReviewLabels(value: unknown, storage: "synthetic" | "local", samples?: readonly number[]): ReviewLabels {
  const labels = ReviewLabels.parse(value);
  if (storage === "synthetic" && labels.source === "measured-reference") {
    throw new Error("Measured reference labels require local replay");
  }
  if (storage === "local" && labels.source === "synthetic-injected") {
    throw new Error("Synthetic injected truth requires a synthetic fixture");
  }
  if (samples && labels.source !== "sensory") for (const observation of labels.observations) {
    const timing = observation.timing;
    if (!timing) continue;
    for (const [lo, hi] of [timing.onsetS, ...(timing.peakS ? [timing.peakS] : [])]) {
      if (!samples.length || lo < samples[0] || hi > samples.at(-1)!) {
        throw new Error(`Timing for ${observation.id} falls outside the recording`);
      }
      if (timing.type === "raw-landmark" && !samples.some(t => t >= lo && t <= hi)) {
        throw new Error(`Raw timing for ${observation.id} must include a recorded sample`);
      }
    }
  }
  return labels;
}
