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

const Figure = z.strictObject({ id, unit: name, value: z.number(), tolerance: z.number().nonnegative() });
const decisions = {
  supportedOutcomes: z.array(ReviewOutcome).min(1).optional(),
  forbiddenClaims: z.array(ReviewClaim).default([]),
};
const mechanical = {
  ...decisions,
  observations: z.array(Observation),
  figures: z.array(Figure).default([]),
};

export const ReviewLabels = z.discriminatedUnion("source", [
  z.strictObject({ source: z.literal("measured-reference"), ...mechanical, reference: name }),
  z.strictObject({ source: z.literal("synthetic-injected"), ...mechanical, injection: name }),
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
  for (const [key, entries] of [["observations", labels.observations], ["figures", labels.figures]] as const) {
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      if (seen.has(entry.id)) ctx.addIssue({ code: "custom", path: [key, index, "id"], message: "duplicate label id" });
      seen.add(entry.id);
    });
  }
});

export type ReviewLabels = z.infer<typeof ReviewLabels>;
export type Observation = z.infer<typeof Observation>;
export type PumpMode = z.infer<typeof PumpMode>;
export type ReviewOutcome = z.infer<typeof ReviewOutcome>;
export type ReviewClaim = z.infer<typeof ReviewClaim>;

export function validateReviewLabels(value: unknown, storage: "synthetic" | "local"): ReviewLabels {
  const labels = ReviewLabels.parse(value);
  if (storage === "synthetic" && labels.source === "measured-reference") {
    throw new Error("Measured reference labels require local replay");
  }
  if (storage === "local" && labels.source === "synthetic-injected") {
    throw new Error("Synthetic injected truth requires a synthetic fixture");
  }
  return labels;
}
