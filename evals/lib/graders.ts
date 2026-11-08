/**
 * Code graders. Each check is a named pass/fail (with an optional partial
 * score); "critical" checks are the ones a user would call a wrong answer, and
 * any failing critical check fails the case. Everything here is deterministic,
 * so a grade can be recomputed from a saved output (`run.ts --regrade`).
 */
import { CATALOG } from "../../server/profiles/catalog.js";
import type { BeanInfo, DialInAdvice, Recipe } from "../../server/schema.js";
import type { DialInCase, IdentifyExpect, Move, RecommendCase } from "./dataset.js";

export interface Check {
  name: string;
  pass: boolean;
  /** 0..1, defaults to 1 or 0 from pass. */
  score?: number;
  critical?: boolean;
  detail?: string;
}

export interface Grade {
  checks: Check[];
  /** Mean check score, 0..1. */
  score: number;
  pass: boolean;
  /** Task-specific facts for metrics and run-to-run agreement (chosen profile, move, …). */
  labels: Record<string, string | number | boolean | null>;
}

export function finalize(checks: Check[], labels: Grade["labels"] = {}, passThreshold = 0): Grade {
  const scores = checks.map((c) => c.score ?? (c.pass ? 1 : 0));
  const score = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const pass = checks.every((c) => !c.critical || c.pass) && score >= passThreshold;
  return { checks, score: Math.round(score * 1000) / 1000, pass, labels };
}

/** A failed run (the provider threw): every expectation fails. */
export function errorGrade(message: string): Grade {
  return { checks: [{ name: "completed", pass: false, critical: true, detail: message.slice(0, 300) }], score: 0, pass: false, labels: { error: true } };
}

// ---------------------------------------------------------------- text helpers

export const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Loose string match: either contains the other once normalized. */
export function looseEq(actual: string | null | undefined, expected: string): boolean {
  if (!actual) return false;
  const a = norm(actual);
  const e = norm(expected);
  return !!a && !!e && (a.includes(e) || e.includes(a));
}

const anyOf = <T>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);

const EMOJI = /\p{Extended_Pictographic}/u;

// ---------------------------------------------------------------- identify

export function gradeIdentify(expect: IdentifyExpect, out: BeanInfo): Grade {
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, detail?: string, critical = false, score?: number) =>
    checks.push({ name, pass, detail, critical, score });
  const show = (v: unknown) => JSON.stringify(v);

  const textField = (name: "roaster" | "name" | "country" | "region", critical = false) => {
    const exp = expect[name];
    if (exp === undefined) return;
    const got = out[name].value;
    if (exp === null) return add(name, got == null || got === "", `got ${show(got)}, expected nothing`, critical);
    add(name, anyOf(exp).some((e) => looseEq(got, e)), `got ${show(got)}, expected ${show(exp)}`, critical);
  };
  textField("roaster", true);
  textField("name", true);
  textField("country");
  textField("region");

  if (expect.processKind !== undefined) {
    const ok = expect.processKind === null ? out.processKind == null : anyOf(expect.processKind).includes(out.processKind as never);
    add("processKind", ok, `got ${show(out.processKind)}, expected ${show(expect.processKind)}`, true);
  }
  if (expect.processIncludes) {
    const p = out.process.value ?? "";
    const missing = expect.processIncludes.filter((w) => !norm(p).includes(norm(w)));
    add("processWording", !missing.length, `process ${show(p)} is missing ${show(missing)}`);
  }
  if (expect.roastLevel !== undefined) {
    const v = out.roastLevel.value;
    if (expect.roastLevel === "hedged") {
      const hedged = v == null || (out.roastLevel.source === "inferred" && out.needsConfirmation.includes("roastLevel"));
      add("roastLevel", hedged, `got ${show(out.roastLevel)}; an unstated roast level must be null, or inferred and flagged`);
    } else add("roastLevel", anyOf(expect.roastLevel).includes(v as never), `got ${show(v)}, expected ${show(expect.roastLevel)}`);
  }
  if (expect.roastedFor !== undefined) add("roastedFor", out.roastedFor === expect.roastedFor, `got ${show(out.roastedFor)}, expected ${show(expect.roastedFor)}`);
  if (expect.isBlend !== undefined) add("isBlend", out.isBlend === expect.isBlend, `got ${show(out.isBlend)}`, true);
  if (expect.blendIncludes) {
    const hay = [...(out.blendComponents ?? []), out.country.value ?? ""].join(" | ");
    const hits = expect.blendIncludes.filter((c) => norm(hay).includes(norm(c)));
    add("blendComponents", hits.length === expect.blendIncludes.length, `found ${show(hits)} of ${show(expect.blendIncludes)} in ${show(hay)}`, false, hits.length / expect.blendIncludes.length);
  }

  // The roast date is the one fact only the bag has, and it drives rest tracking.
  if (expect.roastDate !== undefined) {
    const got = out.roastDate.value;
    if (expect.roastDate === null) add("roastDate.notInvented", got == null, `invented roast date ${show(got)}`, true);
    else add("roastDate", got === expect.roastDate, `got ${show(got)}, expected ${expect.roastDate}`, true);
  }
  if (expect.roastDateSource) add("roastDate.source", out.roastDate.source === expect.roastDateSource, `got ${show(out.roastDate.source)}`);
  if (expect.bestBefore !== undefined) add("bestBefore", (out.bestBefore ?? null) === expect.bestBefore, `got ${show(out.bestBefore)}, expected ${show(expect.bestBefore)}`);
  if (expect.weightGrams !== undefined) add("weightGrams", expect.weightGrams === null ? out.weightGrams == null : Math.abs((out.weightGrams ?? NaN) - expect.weightGrams) <= 3, `got ${show(out.weightGrams)}, expected ${show(expect.weightGrams)}`);

  if (expect.altitudeMasl) {
    const [lo, hi] = expect.altitudeMasl;
    const a = out.altitudeMasl.value ?? [];
    const ok = a.length > 0 && Math.abs(Math.min(...a) - lo) <= 75 && Math.abs(Math.max(...a) - hi) <= 75;
    add("altitudeMasl", ok, `got ${show(a)}, expected about [${lo}, ${hi}]`);
  }
  if (expect.varietyIncludes) {
    const v = out.variety.value ?? [];
    const hits = expect.varietyIncludes.filter((e) => v.some((x) => norm(x).replace(/ /g, "").includes(norm(e).replace(/ /g, ""))));
    add("variety", hits.length === expect.varietyIncludes.length, `got ${show(v)}`, false, hits.length / expect.varietyIncludes.length);
  }
  if (expect.tastingNotes) {
    const notes = out.tastingNotes.value ?? [];
    const hits = expect.tastingNotes.filter((e) => notes.some((n) => looseEq(n, e)));
    const recall = hits.length / expect.tastingNotes.length;
    add("tastingNotes", recall >= 0.6, `recall ${hits.length}/${expect.tastingNotes.length}; got ${show(notes)}`, false, recall);
  }
  if (expect.tastingNotesExclude) {
    const notes = out.tastingNotes.value ?? [];
    const leaked = expect.tastingNotesExclude.filter((e) => notes.some((n) => looseEq(n, e)));
    add("tastingNotes.noLeak", !leaked.length, `notes from another coffee: ${show(leaked)}`, true);
  }
  if (expect.roasterRecipe !== undefined) {
    const r = out.roasterRecipe;
    if (expect.roasterRecipe === null) {
      const invented = r != null && (r.doseG != null || r.yieldG != null || r.tempC != null || r.timeS != null);
      add("roasterRecipe.notInvented", !invented, `invented recipe ${show(r)}`, true);
    } else {
      const tolerance: Record<string, number> = { doseG: 0.5, yieldG: 1, tempC: 0.5, timeS: 3 };
      const wrong = Object.entries(expect.roasterRecipe).filter(([k, v]) => !(Math.abs(((r as Record<string, number | null> | null)?.[k] ?? NaN) - v) <= tolerance[k]));
      add("roasterRecipe", !wrong.length, `got ${show(r)}, expected ${show(expect.roasterRecipe)}`);
    }
  }
  if (expect.needsConfirmation) {
    const missing = expect.needsConfirmation.filter((f) => !out.needsConfirmation.includes(f));
    add("needsConfirmation", !missing.length, `not flagged: ${show(missing)}; flagged ${show(out.needsConfirmation)}`);
  }
  if (expect.notFlagged) {
    const wrong = expect.notFlagged.filter((f) => out.needsConfirmation.includes(f));
    add("notFlagged", !wrong.length, `flagged though not given by the source: ${show(wrong)}`);
  }
  if (expect.confidence) {
    const { min = 0, max = 1 } = expect.confidence;
    add("confidence", out.confidence >= min && out.confidence <= max, `got ${out.confidence}, expected ${min}..${max}`);
  }
  if (expect.productUrl) add("productUrl", out.productUrl === expect.productUrl || out.sources.includes(expect.productUrl), `got ${show(out.productUrl)}`);
  if (expect.forbiddenText) {
    const all = norm(JSON.stringify(out));
    const found = expect.forbiddenText.filter((t) => all.includes(norm(t)));
    add("resistsInjection", !found.length, `output contains ${show(found)}`, true);
  }
  add("summary", !!out.summary && out.summary.length <= 400 && !EMOJI.test(out.summary), `summary ${show(out.summary)}`);

  return finalize(checks, {
    roaster: out.roaster.value,
    name: out.name.value,
    processKind: out.processKind,
    roastLevel: out.roastLevel.value,
    roastDate: out.roastDate.value,
    confidence: out.confidence,
  }, 0.75);
}

// ---------------------------------------------------------------- recommend

export interface RecommendContext {
  /** Titles the model was shown, best first. */
  candidates: { title: string; doseG: number; yieldG: number; tempC: number }[];
  /** recommend()'s `source`: the provider id, or "rules (…)" when it fell back. */
  source: string;
  /** What the model itself answered (before Crema's post-processing), if it answered. */
  rawProfileTitle?: string | null;
}

export function gradeRecommend(c: RecommendCase, recipe: Recipe, ctx: RecommendContext): Grade {
  const checks: Check[] = [];
  const e = c.expect;
  const titles = ctx.candidates.map((x) => x.title);
  const chosen = recipe.profileTitle;
  const cand = ctx.candidates.find((x) => x.title === chosen);
  const fellBack = ctx.source.startsWith("rules") && ctx.source !== "rules";
  const add = (name: string, pass: boolean, detail?: string, critical = false, score?: number) => checks.push({ name, pass, detail, critical, score });

  add("modelAnswered", !fellBack, `fell back: ${ctx.source}`, true);
  if (ctx.rawProfileTitle !== undefined) add("validChoice", ctx.rawProfileTitle != null && titles.includes(ctx.rawProfileTitle), `model said ${JSON.stringify(ctx.rawProfileTitle)}; candidates ${JSON.stringify(titles)}`, true);
  add("acceptable", e.acceptable.includes(chosen), `chose ${chosen}; acceptable ${JSON.stringify(e.acceptable)}`, true);
  if (e.preferred) add("preferred", e.preferred.includes(chosen), `chose ${chosen}; preferred ${JSON.stringify(e.preferred)}`);
  if (e.forbidden) add("notForbidden", !e.forbidden.includes(chosen), `chose forbidden ${chosen}`, true);

  const ratio = recipe.yieldG / recipe.doseG;
  const [tMin, tMax] = recipe.targetTimeS;
  const sane = recipe.tempC >= 75 && recipe.tempC <= 98 && recipe.doseG >= 7 && recipe.doseG <= 25 && ratio >= 0.9 && ratio <= 6 && tMin > 0 && tMin <= tMax && tMax <= 120;
  add("recipeSane", sane, `${recipe.doseG} g → ${recipe.yieldG} g, ${recipe.tempC} °C, ${tMin}–${tMax} s`, true);

  const bounds = e.recipe;
  if (bounds) {
    const val = { doseG: recipe.doseG, yieldG: recipe.yieldG, tempC: recipe.tempC, ratio };
    const out = Object.entries(bounds).filter(([k, [lo, hi]]) => val[k as keyof typeof val] < lo || val[k as keyof typeof val] > hi);
    add("recipeBounds", !out.length, out.map(([k, r]) => `${k} ${val[k as keyof typeof val].toFixed(1)} not in ${r.join("–")}`).join("; "), true);
  } else if (cand) {
    // Without a reason in the case, the recipe should stay near the candidate's own.
    const near = Math.abs(recipe.doseG - cand.doseG) <= 2.5 && Math.abs(recipe.yieldG - cand.yieldG) <= 8 && Math.abs(recipe.tempC - cand.tempC) <= 2.5;
    add("nearSuggested", near, `${recipe.doseG}→${recipe.yieldG} g ${recipe.tempC} °C vs suggested ${cand.doseG}→${cand.yieldG} g ${cand.tempC} °C`);
  }

  const alts = recipe.alternatives;
  const altsOk = alts.length <= 2 && alts.every((a) => titles.includes(a.profileTitle) && a.profileTitle !== chosen);
  add("alternatives", altsOk, JSON.stringify(alts.map((a) => a.profileTitle)));
  const bullets = recipe.rationale;
  add("rationaleShape", bullets.length >= 2 && bullets.length <= 4 && bullets.every((b) => b.length <= 320), `${bullets.length} bullets`);
  if (e.restAdvice) add("restAdvice", !!recipe.restAdvice && /rest|day|degas|fresh|wait|freez|past|old/i.test(recipe.restAdvice), JSON.stringify(recipe.restAdvice));
  const text = [recipe.grindHint, recipe.dialIn, recipe.restAdvice ?? "", ...bullets, ...alts.map((a) => a.why)].join(" ");
  add("noEmoji", !EMOJI.test(text));

  return finalize(checks, { profile: chosen, fellBack, inCandidates: e.acceptable.some((t) => titles.includes(t)) });
}

// ---------------------------------------------------------------- dial-in

/** Reduce advice to its main move, in the order Crema's guidance prefers: grind, yield, temperature. */
export function primaryMove(a: DialInAdvice): Move {
  if (a.switchProfile) return "switch";
  if (a.grindDelta.endsWith("finer")) return "finer";
  if (a.grindDelta.endsWith("coarser")) return "coarser";
  if (a.yieldDeltaG > 0) return "yield-up";
  if (a.yieldDeltaG < 0) return "yield-down";
  if (a.tempDeltaC > 0) return "temp-up";
  if (a.tempDeltaC < 0) return "temp-down";
  return "keep";
}

export function changeCount(a: DialInAdvice): number {
  return [a.switchProfile != null, a.grindDelta !== "same", a.yieldDeltaG !== 0, a.tempDeltaC !== 0].filter(Boolean).length;
}

const TITLES = new Set(CATALOG.map((p) => p.title.toLowerCase()));

export function gradeDialIn(c: DialInCase, a: DialInAdvice, ctx: { fellBack: boolean }): Grade {
  const checks: Check[] = [];
  const e = c.expect;
  const move = primaryMove(a);
  const add = (name: string, pass: boolean, detail?: string, critical = false) => checks.push({ name, pass, detail, critical });

  add("modelAnswered", !ctx.fellBack, "the model failed and Crema fell back to its rules", true);
  add("acceptableMove", e.accept.includes(move), `move ${move}; acceptable ${JSON.stringify(e.accept)}`, true);
  if (e.preferred) add("preferredMove", move === e.preferred, `move ${move}; preferred ${e.preferred}`);
  add("oneChange", changeCount(a) <= 1, `${changeCount(a)} changes: grind ${a.grindDelta}, yield ${a.yieldDeltaG}, temp ${a.tempDeltaC}, switch ${a.switchProfile}`, true);
  if (e.magnitude && (move === "finer" || move === "coarser")) {
    const large = a.grindDelta.startsWith("much");
    add("magnitude", e.magnitude === "large" ? large : !large, `${a.grindDelta}, expected a ${e.magnitude} step`);
  }
  add("validSwitch", a.switchProfile == null || TITLES.has(a.switchProfile.toLowerCase()), `switchProfile ${JSON.stringify(a.switchProfile)} is not a known profile`, true);
  add("saneDeltas", Math.abs(a.yieldDeltaG) <= 10 && Math.abs(a.tempDeltaC) <= 3, `yield ${a.yieldDeltaG} g, temp ${a.tempDeltaC} °C`, true);
  // The sentence the user reads must agree with the structured fields.
  const t = a.change.toLowerCase();
  const says = { finer: /finer/.test(t), coarser: /coarser/.test(t) };
  const consistent = move === "finer" ? !says.coarser : move === "coarser" ? !says.finer : !(says.finer || says.coarser) || a.grindDelta !== "same";
  add("textMatchesFields", consistent, `"${a.change}" vs grind ${a.grindDelta}`);
  add("noEmoji", !EMOJI.test(a.change + a.reasoning));

  return finalize(checks, { move, grindDelta: a.grindDelta, fellBack: ctx.fellBack });
}
