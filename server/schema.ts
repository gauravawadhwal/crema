import { z } from "zod";

/**
 * Where a fact came from. The bag in your hand is the source of truth for
 * lot-specific facts (roast date, the exact lot); the roaster's own web page
 * is usually richer for origin detail; "inferred" means the model reasoned it
 * out and you should treat it as a guess.
 */
export const Provenance = z.enum(["bag", "web", "inferred"]);

// Every field is nullable rather than optional: OpenAI/Codex strict schemas and
// Anthropic structured outputs both behave best when every key is required.
const sourced = <T extends z.ZodType>(value: T) =>
  z.object({ value: value.nullable(), source: Provenance.nullable() });

export const RoastLevel = z.enum([
  "light",
  "medium-light",
  "medium",
  "medium-dark",
  "dark",
]);
export type RoastLevel = z.infer<typeof RoastLevel>;

export const ProcessKind = z.enum([
  "washed",
  "natural",
  "honey",
  "anaerobic",
  "wet-hulled",
  "experimental",
  "decaf",
  "other",
]);
export type ProcessKind = z.infer<typeof ProcessKind>;

export const BeanInfo = z.object({
  roaster: sourced(z.string()),
  name: sourced(z.string()),
  country: sourced(z.string()),
  region: sourced(z.string()),
  producer: sourced(z.string()),
  variety: sourced(z.array(z.string())),
  process: sourced(z.string()),
  processKind: ProcessKind.nullable(),
  altitudeMasl: sourced(z.array(z.number())),
  roastLevel: sourced(RoastLevel),
  roastedFor: z
    .enum(["espresso", "filter", "omni"])
    .nullable()
    .describe("What the roaster says the roast is for"),
  roastDate: sourced(z.string().describe("ISO date YYYY-MM-DD")),
  bestBefore: z.string().nullable(),
  weightGrams: z.number().nullable(),
  tastingNotes: sourced(z.array(z.string())),
  isBlend: z.boolean().nullable(),
  blendComponents: z.array(z.string()).nullable(),
  roasterRecipe: z
    .object({
      doseG: z.number().nullable(),
      yieldG: z.number().nullable(),
      timeS: z.number().nullable(),
      tempC: z.number().nullable(),
      text: z.string().nullable(),
    })
    .nullable()
    .describe("Espresso recipe the roaster publishes, if any"),
  productUrl: z.string().nullable(),
  imageUrl: z.string().nullable(),
  sources: z.array(z.string()).describe("URLs consulted"),
  confidence: z.number().describe("0..1 overall confidence in the identification"),
  needsConfirmation: z
    .array(z.string())
    .describe("Field names the user should double-check"),
  summary: z.string().describe("One or two sentences describing the coffee"),
});
export type BeanInfo = z.infer<typeof BeanInfo>;

/** A recipe the skin can show and apply to the machine via the Workflow API. */
export const Recipe = z.object({
  profileTitle: z
    .string()
    .describe("Exact title of a profile from the provided library"),
  profileId: z.string().nullable(),
  doseG: z.number(),
  yieldG: z.number(),
  tempC: z.number(),
  targetTimeS: z.array(z.number()).describe("[min, max] seconds"),
  grindHint: z
    .string()
    .describe("Relative grind guidance, e.g. 'start 2 steps finer than your medium-roast setting'"),
  restAdvice: z.string().nullable(),
  dialIn: z.string().describe("How to dial this profile in for this coffee, 1–2 sentences"),
  rationale: z.array(z.string()).describe("Short bullet reasons"),
  alternatives: z.array(
    z.object({ profileTitle: z.string(), why: z.string() }),
  ),
});
export type Recipe = z.infer<typeof Recipe>;

export const TasteFeedback = z.object({
  sourBitter: z.number().min(-2).max(2).describe("-2 very sour .. +2 very bitter"),
  body: z.number().min(-2).max(2).describe("-2 thin .. +2 heavy"),
  enjoyment: z.number().min(0).max(10).nullable().describe("Decaid's 0..10 scale: one point is half a star, 10 is five stars; null when not rated"),
  notes: z.string().nullable(),
});
export type TasteFeedback = z.infer<typeof TasteFeedback>;

export const DialInAdvice = z.object({
  change: z.string().describe("The one adjustment to make next"),
  grindDelta: z.enum(["much-finer", "finer", "same", "coarser", "much-coarser"]),
  yieldDeltaG: z.number(),
  tempDeltaC: z.number(),
  switchProfile: z.string().nullable(),
  reasoning: z.string(),
});
export type DialInAdvice = z.infer<typeof DialInAdvice>;

/**
 * A recorded reading, or null when unavailable. Decaid records -1 as "no target"
 * (de1app imports, and the target of whichever pump isn't in control), and a
 * scale tare or cup bump mid-shot records large negative weights. Those are not
 * measurements, so a value outside the plausible range becomes null instead of
 * rejecting the whole review.
 */
const reading = (min: number, max: number) => z.number().nullable().transform((v) => v == null || v < min || v > max ? null : v);

/** A bounded telemetry sample sent only when someone asks for a shot review. */
export const ReviewPoint = z.object({
  t: z.number().min(0).max(600),
  p: reading(-0.5, 20).transform((v) => v == null ? null : Math.max(0, v)),
  f: reading(-0.5, 20).transform((v) => v == null ? null : Math.max(0, v)),
  w: reading(-5, 500),
  temp: reading(0, 150),
  tp: reading(0, 20),
  tf: reading(0, 20),
  targetTemp: reading(0, 150),
  // Group (coffee) temperature: what a profile step with sensor "coffee" targets.
  // Optional, so reviews from skins that don't send it still validate.
  groupTemp: reading(0, 150).optional(),
  targetGroupTemp: reading(0, 150).optional(),
  frame: z.number().int().min(0).max(100).nullable(),
  substate: z.string().max(80).nullable(),
  weightFlow: reading(-20, 100),
});

const ReviewProfileStep = z.object({
  name: z.string().max(120).optional(), pump: z.string().max(30).optional(),
  transition: z.string().max(30).optional(), pressure: z.union([z.string().max(30), z.number()]).optional(),
  flow: z.union([z.string().max(30), z.number()]).optional(), seconds: z.union([z.string().max(30), z.number()]).optional(),
  temperature: z.union([z.string().max(30), z.number()]).optional(), weight: z.union([z.string().max(30), z.number()]).optional(),
  volume: z.union([z.string().max(30), z.number()]).optional(), sensor: z.string().max(20).optional(),
  exit: z.object({ type: z.string().max(30).optional(), condition: z.string().max(30).optional(), value: z.union([z.string().max(30), z.number()]).optional() }).nullable().optional(),
  limiter: z.object({ value: z.union([z.string().max(30), z.number()]).optional(), range: z.union([z.string().max(30), z.number()]).optional() }).nullable().optional(),
});
const ReviewProfile = z.object({ title: z.string().max(160).optional(), beverage_type: z.string().max(60).optional(), target_weight: z.union([z.string().max(30), z.number()]).optional(), steps: z.array(ReviewProfileStep).max(40).optional() }).nullable();
const ReviewHistory = z.object({
  timestamp: z.string().max(80), profileTitle: z.string().max(160).nullish(), doseG: z.number().min(0).max(60).nullish(),
  yieldG: z.number().min(0).max(500).nullish(), enjoyment: z.number().min(0).max(10).nullish(), notes: z.string().max(500).nullish(), review: z.string().max(1000).nullish(),
});
export const ReviewBody = z.object({
  points: z.array(ReviewPoint).max(1800).superRefine((points, ctx) => {
    for (let i = 1; i < points.length; i++) if (points[i].t <= points[i - 1].t) ctx.addIssue({ code: "custom", path: [i, "t"], message: "times must increase without duplicates" });
  }), profile: ReviewProfile,
  // The skin falls back to the last cup weight for yield, which a cup bump can leave negative.
  doseG: z.number().min(0).max(60).nullable(), yieldG: reading(0, 500),
  targetYieldG: z.number().min(0).max(500).nullable(),
  targetTimeS: z.tuple([z.number().min(0).max(600), z.number().min(0).max(600)]).nullable(),
  stopReason: z.string().max(120).nullable(), feedback: TasteFeedback.extend({ notes: z.string().max(1000).nullable() }).nullable(), bean: BeanInfo.nullable(),
  notes: z.string().max(1000).nullable().optional(),
  installedProfiles: z.array(z.string().min(1).max(160)).max(200), history: z.array(ReviewHistory).max(20),
});
export type ReviewBody = z.infer<typeof ReviewBody>;

export const ReviewIssue = z.object({
  kind: z.string().min(1).max(60), what: z.string().min(1).max(300), evidence: z.string().min(1).max(500),
  severity: z.enum(["info", "caution", "warning"]), fromS: z.number().min(0).max(600).nullable(), toS: z.number().min(0).max(600).nullable(),
});
export const ShotReview = z.object({
  summary: z.string().min(1).max(500), wentWell: z.array(z.string().min(1).max(240)).max(6), issues: z.array(ReviewIssue).max(12),
  nextShot: DialInAdvice.nullable(), confidence: z.enum(["low", "medium", "high"]), askTaste: z.boolean(),
});
export type ShotReview = z.infer<typeof ShotReview>;
