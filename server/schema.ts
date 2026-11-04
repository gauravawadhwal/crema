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
  enjoyment: z.number().min(1).max(5),
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
