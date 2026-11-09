/**
 * Eval datasets: Zod schemas for the case files in evals/datasets/, and the
 * helpers that turn a compact case spec into the inputs the real pipeline
 * takes (BeanInfo, Recipe, PastShot).
 *
 * Dates are written relative to the run ("roasted 9 days ago") so a case means
 * the same thing whenever it runs: rest status depends on today's date.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CATALOG, findProfile } from "../../server/profiles/catalog.js";
import { suggestRecipe } from "../../server/profiles/match.js";
import type { PastShot } from "../../server/recommend/index.js";
import { REVIEW_FIXTURES } from "./review-fixtures.js";
import { BeanInfo, ProcessKind, Recipe, RoastLevel, TasteFeedback } from "../../server/schema.js";

export const EVALS_DIR = path.resolve(import.meta.dirname, "..");
export const ROOT_DIR = path.resolve(EVALS_DIR, "..");
export const FIXTURES_DIR = path.join(EVALS_DIR, "fixtures");

export const TASKS = ["identify", "recommend", "dialin", "review"] as const;
export type TaskName = (typeof TASKS)[number];

const Split = z.enum(["dev", "holdout"]);
const caseBase = {
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Tune prompts on "dev"; keep "holdout" for checking you didn't overfit. */
  split: Split,
  tags: z.array(z.string()).default([]),
  /** Why the expectation is what it is. Reviewers read this. */
  why: z.string().min(10),
};

const str = z.string().nullable().optional();
const oneOrMany = <T extends z.ZodType>(t: T) => z.union([t, z.array(t)]);

// ---------------------------------------------------------------- beans

/** A coffee written compactly: plain values, provenance defaulted to "web". */
export const BeanSpec = z
  .object({
    /** Start from a coffee in samples/beans.json, matched by name. */
    sample: z.string().optional(),
    /** Start from a coffee in the dataset file's "beans" map (resolved when loading). */
    ref: z.string().optional(),
    roaster: str,
    name: str,
    country: str,
    region: str,
    producer: str,
    variety: z.array(z.string()).nullable().optional(),
    process: str,
    processKind: ProcessKind.nullable().optional(),
    altitudeMasl: z.array(z.number()).nullable().optional(),
    roastLevel: RoastLevel.nullable().optional(),
    roastedFor: z.enum(["espresso", "filter", "omni"]).nullable().optional(),
    roastDaysAgo: z.number().int().nullable().optional(),
    tastingNotes: z.array(z.string()).nullable().optional(),
    isBlend: z.boolean().nullable().optional(),
    blendComponents: z.array(z.string()).nullable().optional(),
    roasterRecipe: BeanInfo.shape.roasterRecipe.optional(),
    summary: z.string().optional(),
  })
  .strict();
export type BeanSpec = z.infer<typeof BeanSpec>;

const SOURCED = ["roaster", "name", "country", "region", "producer", "variety", "process", "altitudeMasl", "roastLevel", "tastingNotes"] as const;

let samples: BeanInfo[] | null = null;
function sampleBean(name: string): BeanInfo {
  samples ??= (JSON.parse(readFileSync(path.join(ROOT_DIR, "samples/beans.json"), "utf8")).results as { info: BeanInfo }[]).map((r) => r.info);
  const hit = samples.find((b) => b.name.value === name);
  if (!hit) throw new Error(`no sample coffee named "${name}" in samples/beans.json`);
  return structuredClone(hit);
}

const isoDaysAgo = (days: number, today: Date) => new Date(today.getTime() - days * 864e5).toISOString().slice(0, 10);

function emptyBean(): BeanInfo {
  const nil = { value: null, source: null };
  return BeanInfo.parse({
    roaster: nil, name: nil, country: nil, region: nil, producer: nil, variety: nil, process: nil, processKind: null,
    altitudeMasl: nil, roastLevel: nil, roastedFor: null, roastDate: nil, bestBefore: null, weightGrams: 250,
    tastingNotes: nil, isBlend: false, blendComponents: null, roasterRecipe: null, productUrl: null, imageUrl: null,
    sources: [], confidence: 0.9, needsConfirmation: [], summary: "",
  });
}

export function expandBean(spec: BeanSpec, today = new Date()): BeanInfo {
  const bean = spec.sample ? sampleBean(spec.sample) : emptyBean();
  const b = bean as Record<string, unknown>;
  for (const [k, v] of Object.entries(spec)) {
    if (k === "sample" || k === "ref" || v === undefined) continue;
    if (k === "roastDaysAgo") {
      bean.roastDate = v == null ? { value: null, source: null } : { value: isoDaysAgo(v as number, today), source: "bag" };
    } else if ((SOURCED as readonly string[]).includes(k)) {
      b[k] = { value: v, source: v == null ? null : "web" };
    } else b[k] = v;
  }
  return BeanInfo.parse(bean);
}

// ---------------------------------------------------------------- shots

const HistoryShot = z
  .object({
    daysAgo: z.number().default(0),
    profileTitle: z.string(),
    doseG: z.number().optional(),
    yieldG: z.number().optional(),
    timeS: z.number().optional(),
    grinderSetting: z.string().optional(),
    enjoyment: z.number().min(0).max(10).optional(),
    notes: z.string().optional(),
  })
  .strict();

export function expandHistory(h: z.infer<typeof HistoryShot>[] | undefined, today = new Date()): PastShot[] | undefined {
  // Most recent first, like Decaid returns them; same-day shots keep file order.
  return h?.map(({ daysAgo, ...s }, i) => ({ timestamp: new Date(today.getTime() - daysAgo * 864e5 - i * 6e5).toISOString(), ...s }));
}

// ---------------------------------------------------------------- identify

export const IdentifyExpect = z
  .object({
    /** Strings match loosely (case, accents, punctuation, either contains the other). null means it must be empty. */
    roaster: oneOrMany(z.string()).nullable().optional(),
    name: oneOrMany(z.string()).nullable().optional(),
    country: oneOrMany(z.string()).nullable().optional(),
    region: oneOrMany(z.string()).optional(),
    processKind: oneOrMany(ProcessKind).nullable().optional(),
    /** Words the roaster's own process wording should keep. */
    processIncludes: z.array(z.string()).optional(),
    /** "hedged": unstated by the roaster, so null, or inferred and listed in needsConfirmation. */
    roastLevel: z.union([oneOrMany(RoastLevel), z.literal("hedged")]).optional(),
    roastedFor: z.enum(["espresso", "filter", "omni"]).nullable().optional(),
    isBlend: z.boolean().optional(),
    blendIncludes: z.array(z.string()).optional(),
    /** Exact ISO date, or null: no roast date is visible, so none may be invented. */
    roastDate: z.string().nullable().optional(),
    roastDateSource: z.enum(["bag", "web"]).optional(),
    bestBefore: z.string().nullable().optional(),
    weightGrams: z.number().nullable().optional(),
    /** [min, max] in metres; matched within 75 m at each end. */
    altitudeMasl: z.tuple([z.number(), z.number()]).optional(),
    varietyIncludes: z.array(z.string()).optional(),
    /** Recall of these notes, fuzzy-matched. */
    tastingNotes: z.array(z.string()).optional(),
    /** Notes that belong to a different coffee and must not appear. */
    tastingNotesExclude: z.array(z.string()).optional(),
    /** null: the roaster publishes none, so none may be invented. */
    roasterRecipe: z
      .object({ doseG: z.number().optional(), yieldG: z.number().optional(), tempC: z.number().optional(), timeS: z.number().optional() })
      .nullable()
      .optional(),
    needsConfirmation: z.array(z.string()).optional(),
    /** Fields that must NOT be flagged: facts the source simply doesn't give, which should show as "Not given". */
    notFlagged: z.array(z.string()).optional(),
    confidence: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
    productUrl: z.string().optional(),
    /** Text that must not appear anywhere in the output (e.g. a prompt-injection payload). */
    forbiddenText: z.array(z.string()).optional(),
  })
  .strict();
export type IdentifyExpect = z.infer<typeof IdentifyExpect>;

export const IdentifyCase = z
  .object({
    ...caseBase,
    /** Needs live web search: slow, not reproducible, skipped unless --live. */
    live: z.boolean().default(false),
    input: z
      .object({
        query: z.string().optional(),
        /** The user describing the bag, as typed or dictated (may carry speech-to-text errors). */
        description: z.string().optional(),
        /** Fixed "today" (YYYY-MM-DD) so relative dates in a description have one right answer. */
        today: z.string().optional(),
        url: z.string().optional(),
        /** File in evals/fixtures/pages/, passed as already-fetched page text. */
        page: z.string().optional(),
        /** Files in evals/fixtures/labels/, passed as bag photos. */
        images: z.array(z.string()).optional(),
        offline: z.boolean().default(true),
      })
      .strict(),
    expect: IdentifyExpect,
  })
  .strict();
export type IdentifyCase = z.infer<typeof IdentifyCase>;

// ---------------------------------------------------------------- recommend

const Preferences = z
  .object({
    drink: z.enum(["milk", "straight", "both"]).optional(),
    hasScale: z.boolean().optional(),
    burrs: z.enum(["flat", "conical", "unknown"]).optional(),
    experience: z.enum(["new", "comfortable", "advanced"]).optional(),
    basketDoseG: z.number().optional(),
  })
  .strict();

const range = z.tuple([z.number(), z.number()]);

export const RecommendCase = z
  .object({
    ...caseBase,
    input: z
      .object({
        bean: BeanSpec,
        preferences: Preferences.default({}),
        /** Profiles on the machine. Omitted = the whole catalog, as Decaid ships it. */
        installed: z.array(z.string()).optional(),
        history: z.array(HistoryShot).optional(),
      })
      .strict(),
    expect: z
      .object({
        /** Profiles a good barista would accept for this coffee and setup. */
        acceptable: z.array(z.string()).min(1),
        /** The best fits, a subset of acceptable. */
        preferred: z.array(z.string()).optional(),
        /** Clearly wrong for this coffee or setup. */
        forbidden: z.array(z.string()).optional(),
        /** Recipe bounds this case requires (roaster recipe, past shots). */
        recipe: z.object({ doseG: range.optional(), yieldG: range.optional(), tempC: range.optional(), ratio: range.optional() }).strict().optional(),
        /** Expect restAdvice to speak to resting (very fresh or old coffee). */
        restAdvice: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();
export type RecommendCase = z.infer<typeof RecommendCase>;

// ---------------------------------------------------------------- dial-in

/** The one move a piece of dial-in advice makes, reduced to a label. */
export const Move = z.enum(["finer", "coarser", "yield-up", "yield-down", "temp-up", "temp-down", "switch", "keep"]);
export type Move = z.infer<typeof Move>;

export const DialInCase = z
  .object({
    ...caseBase,
    input: z
      .object({
        bean: BeanSpec,
        profile: z.string(),
        /** Overrides on top of the profile's suggested recipe for this coffee. */
        recipe: z.object({ doseG: z.number(), yieldG: z.number(), tempC: z.number(), targetTimeS: range }).partial().strict().optional(),
        shot: z
          .object({ timeS: z.number().nullable().optional(), doseG: z.number().optional(), yieldG: z.number().optional(), grinderSetting: z.string().optional() })
          .strict(),
        feedback: TasteFeedback,
        history: z.array(HistoryShot).optional(),
      })
      .strict(),
    expect: z
      .object({
        accept: z.array(Move).min(1),
        preferred: Move.optional(),
        /** For grind moves: "large" wants much-finer/much-coarser, "small" wants a single step. */
        magnitude: z.enum(["small", "large"]).optional(),
      })
      .strict(),
  })
  .strict();
export type DialInCase = z.infer<typeof DialInCase>;

export function dialInRecipe(c: DialInCase, bean: BeanInfo): Recipe {
  const p = findProfile(c.input.profile);
  if (!p) throw new Error(`${c.id}: unknown profile ${c.input.profile}`);
  const s = suggestRecipe(p, bean);
  const o = c.input.recipe ?? {};
  return {
    profileTitle: p.title,
    profileId: null,
    doseG: o.doseG ?? s.doseG,
    yieldG: o.yieldG ?? s.yieldG,
    tempC: o.tempC ?? s.tempC,
    targetTimeS: o.targetTimeS ?? s.timeS,
    grindHint: "",
    restAdvice: null,
    dialIn: p.dialIn,
    rationale: [],
    alternatives: [],
  };
}

export function dialInShot(c: DialInCase, recipe: Recipe, today = new Date()): PastShot {
  return {
    timestamp: today.toISOString(),
    profileTitle: recipe.profileTitle,
    doseG: c.input.shot.doseG ?? recipe.doseG,
    yieldG: c.input.shot.yieldG ?? recipe.yieldG,
    timeS: c.input.shot.timeS ?? undefined,
    grinderSetting: c.input.shot.grinderSetting,
    enjoyment: c.input.feedback.enjoyment ?? undefined,
    notes: c.input.feedback.notes ?? undefined,
  };
}

// ---------------------------------------------------------------- shot review
export const ReviewCase = z.object({
  ...caseBase,
  input: z.object({ fixture: z.enum(REVIEW_FIXTURES) }).strict(),
  expect: z.object({
    accept: z.array(z.union([Move, z.literal("none")])).min(1),
    requiredIssues: z.array(z.string()).default([]),
    forbiddenIssues: z.array(z.string()).default([]),
    askTaste: z.boolean().optional(),
    noFaults: z.boolean().default(false),
  }).strict(),
}).strict();
export type ReviewCase = z.infer<typeof ReviewCase>;

// ---------------------------------------------------------------- loading

const SCHEMAS = { identify: IdentifyCase, recommend: RecommendCase, dialin: DialInCase, review: ReviewCase } as const;
export type CaseFor<T extends TaskName> = z.infer<(typeof SCHEMAS)[T]>;

export function loadCases<T extends TaskName>(task: T): CaseFor<T>[] {
  const file = path.join(EVALS_DIR, "datasets", `${task}.json`);
  const raw = JSON.parse(readFileSync(file, "utf8")) as { beans?: Record<string, BeanSpec>; cases: unknown[] };
  for (const c of raw.cases as { id?: string; input?: { bean?: BeanSpec } }[]) {
    const ref = c.input?.bean?.ref;
    if (!ref) continue;
    if (!raw.beans?.[ref]) throw new Error(`${task}.json ${c.id}: unknown bean ref "${ref}"`);
    c.input!.bean = { ...raw.beans[ref], ...c.input!.bean };
  }
  const cases = raw.cases.map((c, i) => {
    const r = SCHEMAS[task].safeParse(c);
    if (!r.success) throw new Error(`${task}.json case ${i} (${(c as { id?: string }).id}): ${z.prettifyError(r.error)}`);
    return r.data as CaseFor<T>;
  });
  const problems = lintCases(task, cases);
  if (problems.length) throw new Error(`${task}.json:\n  ${problems.join("\n  ")}`);
  return cases;
}

/** Checks that need more than a schema: unique ids, real profile titles, fixture files present. */
export function lintCases(task: TaskName, cases: unknown[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const titles = new Set(CATALOG.map((p) => p.title));
  const profile = (id: string, t: string) => titles.has(t) || problems.push(`${id}: "${t}" is not a catalog profile title`);
  for (const c of cases as { id: string }[]) {
    if (seen.has(c.id)) problems.push(`duplicate id ${c.id}`);
    seen.add(c.id);
    if (task === "identify") {
      const ic = c as IdentifyCase;
      if (ic.input.page && !existsSync(path.join(FIXTURES_DIR, "pages", ic.input.page))) problems.push(`${c.id}: missing page fixture ${ic.input.page}`);
      for (const img of ic.input.images ?? [])
        if (!existsSync(path.join(FIXTURES_DIR, "labels", img))) problems.push(`${c.id}: missing image ${img} (run node evals/fixtures/render-labels.cjs)`);
      if (!ic.input.query && !ic.input.description && !ic.input.url && !ic.input.page && !ic.input.images?.length) problems.push(`${c.id}: no input`);
    }
    if (task === "recommend") {
      const rc = c as RecommendCase;
      const { acceptable, preferred = [], forbidden = [] } = rc.expect;
      [...acceptable, ...preferred, ...forbidden, ...(rc.input.installed ?? []), ...(rc.input.history ?? []).map((h) => h.profileTitle)].forEach((t) => profile(c.id, t));
      for (const t of preferred) if (!acceptable.includes(t)) problems.push(`${c.id}: preferred "${t}" is not in acceptable`);
      for (const t of forbidden) if (acceptable.includes(t)) problems.push(`${c.id}: "${t}" is both acceptable and forbidden`);
    }
    if (task === "dialin") {
      const dc = c as DialInCase;
      profile(c.id, dc.input.profile);
      if (dc.expect.preferred && !dc.expect.accept.includes(dc.expect.preferred)) problems.push(`${c.id}: preferred move is not in accept`);
    }
  }
  return problems;
}

export function readFixture(kind: "pages" | "labels", file: string): Buffer {
  return readFileSync(path.join(FIXTURES_DIR, kind, file));
}
