/**
 * Runs one eval case through the real pipeline (identify, recommend, dialIn
 * from server/), with the provider under test wrapped in a recorder, then
 * grades it. "rules" stands in for a provider to measure the no-AI baseline.
 */
import path from "node:path";
import { reviewShot } from "../../server/recommend/review.js";
import { rulesReview } from "../../server/recommend/review-local.js";
import type { ShotReviewData } from "../../server/recommend/review-types.js";
import { reviewFixture } from "./review-fixtures.js";
import { gradeReview } from "./review-grader.js";
import { identify, type IdentifyInput } from "../../server/identify.js";
import { ProviderChain } from "../../server/llm/index.js";
import { MockProvider } from "../../server/llm/mock.js";
import type { ImageInput, LlmProvider } from "../../server/llm/types.js";
import { rankProfiles } from "../../server/profiles/match.js";
import { dialInWithSource, recommend, rulesDialIn } from "../../server/recommend/index.js";
import type { BeanInfo, DialInAdvice, Recipe } from "../../server/schema.js";
import {
  dialInRecipe,
  dialInShot,
  expandBean,
  expandHistory,
  readFixture,
  type CaseFor,
  type DialInCase,
  type IdentifyCase,
  type RecommendCase,
  type ReviewCase,
  type TaskName,
} from "./dataset.js";
import { errorGrade, finalize, gradeDialIn, gradeIdentify, gradeRecommend, type Grade, type RecommendContext } from "./graders.js";
import { judge, judgeChecks, judgeReview, JudgeVerdict, reviewJudgeEvidence, reviewJudgeProvenance, reviewJudgeStatus } from "./judge.js";
import { RecordingProvider, type CallRecord } from "./recorder.js";

/** What is being evaluated: a model behind a provider, or Crema's rules with no model. */
import { caseDigests, sha256 } from "./manifest.js";
import { answerSource, type AnswerSource, type RequestedSubject } from "./provenance.js";

export type Subject = { kind: "llm"; provider: LlmProvider } | { kind: "rules" };

export interface RunRecord {
  caseId: string;
  repeat: number;
  split: string;
  tags: string[];
  ms: number;
  output?: unknown;
  error?: string;
  /** Task facts the grader needs again on --regrade (candidates, fallback source). */
  context?: unknown;
  calls: CallRecord[];
  judge?: JudgeVerdict;
  judgeCalls?: CallRecord[];
  requested?: RequestedSubject;
  answerSource?: AnswerSource;
  fallbackGrade?: Grade;
  judgeRequested?: boolean;
  judgeStatus?: "assessed" | "unassessed" | "invalid-citation" | "unavailable";
  judgeProvenance?: ReturnType<typeof reviewJudgeProvenance>;
  grade: Grade;
}

export interface RunOptions {
  judge?: LlmProvider;
  today: Date;
}

const MEDIA: Record<string, ImageInput["mediaType"]> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

export function supports(task: TaskName, subject: Subject): boolean {
  return !(task === "identify" && subject.kind === "rules");
}

export async function runCase<T extends TaskName>(task: T, c: CaseFor<T>, subject: Subject, repeat: number, opts: RunOptions): Promise<RunRecord> {
  const rec = subject.kind === "llm" ? new RecordingProvider(subject.provider) : new RecordingProvider(new MockProvider());
  const llm = new ProviderChain([rec]);
  const requested: RequestedSubject = subject.kind === "rules" ? { kind: "rules" } : { kind: "llm", provider: subject.provider.id };
  const base = { caseId: c.id, repeat, split: c.split, tags: c.tags, requested, judgeRequested: task !== "identify" && !!opts.judge };
  const t0 = performance.now();
  try {
    const { output, context, judgeInput } = await execute(task, c, subject, llm, opts.today);
    const ms = Math.round(performance.now() - t0);
    const record: RunRecord = { ...base, ms, output, context, calls: rec.calls, grade: errorGrade("ungraded") };
    record.answerSource = answerSource(task, record.calls, context, requested);
    if (opts.judge && (record.answerSource === "model" || record.answerSource === "rules")) {
      await rejudge(task, record, opts.judge, task === "review" ? c as ReviewCase : undefined, judgeInput);
    }
    record.grade = gradeRecord(task, c, record);
    return record;
  } catch (e) {
    const msg = (e as Error).message;
    return { ...base, ms: Math.round(performance.now() - t0), error: msg.slice(0, 2000), calls: rec.calls, grade: errorGrade(msg) };
  }
}

function identifyInput(ic: IdentifyCase): IdentifyInput {
  return {
    query: ic.input.query, description: ic.input.description, today: ic.input.today, url: ic.input.url,
    pageText: ic.input.page ? readFixture("pages", ic.input.page).toString("utf8") : undefined,
    images: ic.input.images?.map(f => ({ data: readFixture("labels", f), mediaType: MEDIA[path.extname(f).toLowerCase()] ?? "image/jpeg" })),
    offline: ic.input.offline,
  };
}

function recommendInput(c: RecommendCase, today: Date) {
  return { bean: expandBean(c.input.bean, today), preferences: c.input.preferences,
    profileTitles: c.input.installed, history: expandHistory(c.input.history, today) };
}

function dialInInput(c: DialInCase, today: Date) {
  const bean = expandBean(c.input.bean, today);
  const recipe = dialInRecipe(c, bean);
  return { bean, recipe, shot: dialInShot(c, recipe, today), feedback: c.input.feedback, history: expandHistory(c.input.history, today) };
}

export function legacyCaseDigests<T extends TaskName>(task: T, c: CaseFor<T>, today: Date) {
  let input: unknown;
  if (task === "identify") {
    const { images, ...rest } = identifyInput(c as IdentifyCase);
    input = { ...rest, images: images?.map(i => ({ mediaType: i.mediaType, digest: sha256(i.data) })) };
  } else if (task === "review") input = reviewFixture((c as ReviewCase).input.fixture);
  else if (task === "recommend") input = recommendInput(c as RecommendCase, today);
  else input = dialInInput(c as DialInCase, today);
  return caseDigests(c.id, { split: c.split, tags: c.tags }, input, { expect: c.expect, why: c.why }, requiredChecks(task, c));
}

function requiredChecks<T extends TaskName>(task: T, c: CaseFor<T>) {
  if (task === "review") {
    const { expect } = c as ReviewCase;
    return ["acceptableMove", "requiredIssues", "noFalseAlarms", "oneChange", "validSwitch", "groundedRanges", "directionConsistent", "supportedClaims",
      ...(expect.askTaste === undefined ? [] : ["askTaste"]),
      ...Object.entries({ pace: "paceComparison", target: "targetComparison", history: "historyComparison",
        abstention: "usefulAbstention", controlMismatch: "controlMismatchCheck" } as const)
        .flatMap(([key, name]) => expect.narrative?.[key as keyof NonNullable<ReviewCase["expect"]["narrative"]>] ? [name] : [])];
  }
  if (task === "recommend") {
    const { expect } = c as RecommendCase;
    return ["acceptable", "recipeSane", ...(expect.preferred ? ["preferred"] : []),
      ...(expect.forbidden ? ["notForbidden"] : []), ...(expect.recipe ? ["recipeBounds"] : [])];
  }
  if (task === "dialin") {
    return ["acceptableMove", "oneChange", "textMatchesFields", ...((c as DialInCase).expect.preferred ? ["preferredMove"] : [])];
  }
  const { expect } = c as IdentifyCase;
  return ["summary", ...(expect.name !== undefined ? ["name"] : []), ...(expect.processKind !== undefined ? ["processKind"] : []),
    ...(expect.roastDate === undefined ? [] : [expect.roastDate === null ? "roastDate.notInvented" : "roastDate"]),
    ...(expect.roasterRecipe === null ? ["roasterRecipe.notInvented"] : []),
    ...(expect.tastingNotes ? ["tastingNotes"] : []), ...(expect.forbiddenText ? ["resistsInjection"] : [])];
}

async function execute(task: TaskName, c: unknown, subject: Subject, llm: ProviderChain, today: Date): Promise<{ output: unknown; context?: unknown; judgeInput?: string }> {
  if (task === "identify") return { output: await identify(llm, identifyInput(c as IdentifyCase)) };

  if (task === "recommend") {
    const rc = c as RecommendCase;
    const input = recommendInput(rc, today);
    const { bean } = input;
    const shown = rankProfiles(bean, rc.input.preferences, rc.input.installed)
      .filter((x) => x.installed)
      .slice(0, 6);
    const res = await recommend(llm, {
      ...input,
      rulesOnly: subject.kind === "rules",
    });
    const raw = (llm.providers[0] as RecordingProvider).calls.find((x) => x.schemaName === "Recipe");
    const context: RecommendContext = {
      candidates: shown.map((x) => ({ title: x.title, doseG: x.recipe.doseG, yieldG: x.recipe.yieldG, tempC: x.recipe.tempC })),
      source: res.source,
      rawProfileTitle: subject.kind === "rules" ? undefined : ((raw?.output as Recipe | undefined)?.profileTitle ?? null),
    };
    const judgeInput =
      raw?.prompt ??
      JSON.stringify({ bean, preferences: rc.input.preferences, candidates: shown.map((x) => ({ title: x.title, character: x.profile.character, authorGuidance: x.profile.dialIn, recipe: x.recipe })) });
    return { output: res.recipe, context, judgeInput };
  }

  if (task === "review") {
    const rc = c as ReviewCase;
    const input = reviewFixture(rc.input.fixture);
    const result = subject.kind === "rules" ? { review: rulesReview(input), source: "rules" } : await reviewShot(llm, input);
    return { output: result.review, context: { source: result.source } };
  }

  const input = dialInInput(c as DialInCase, today);
  const { shot, recipe, feedback } = input;
  if (subject.kind === "rules") {
    return { output: rulesDialIn(feedback, shot, recipe), context: { source: "rules" }, judgeInput: JSON.stringify(input) };
  }
  const { advice, source } = await dialInWithSource(llm, input);
  const calls = (llm.providers[0] as RecordingProvider).calls;
  return { output: advice, context: { source }, judgeInput: calls[0]?.prompt };
}

/** Re-run only the judge. Review evidence comes from the independently verified case. */
export async function rejudge(task: TaskName, r: RunRecord, provider: LlmProvider, reviewCase?: ReviewCase, liveInput?: string): Promise<void> {
  if (task === "identify") return;
  r.judgeRequested = true;
  r.judgeStatus = "unavailable";
  delete r.judge;
  delete r.judgeCalls;
  delete r.judgeProvenance;
  const input = liveInput ?? r.calls.find(c => c.schemaName === "Recipe" || c.schemaName === "DialInAdvice")?.prompt;
  const evidence = reviewCase ? reviewJudgeEvidence(reviewFixture(reviewCase.input.fixture)) : undefined;
  if (r.output == null || (task === "review" ? !evidence : !input)) return;
  const source = answerSource(task, r.calls, r.context, r.requested);
  if (source !== "model" && source !== "rules") return;
  const jr = new RecordingProvider(provider);
  const llm = new ProviderChain([jr]);
  if (evidence) r.judgeProvenance = reviewJudgeProvenance(evidence);
  try {
    r.judge = evidence ? await judgeReview(llm, evidence, r.output)
      : await judge(llm, task === "recommend" ? "recipe" : "dial-in advice", input!, r.output);
    r.judgeStatus = evidence ? reviewJudgeStatus(r.judge, evidence, r.output) : "assessed";
  } catch {
    r.judgeStatus = "unavailable";
  }
  r.judgeCalls = jr.calls;
}

/** Grade saved outputs with the same provenance rules as a fresh run. */
export function gradeRecord(task: TaskName, c: unknown, r: RunRecord): Grade {
  delete r.fallbackGrade;
  if (r.error || r.output == null) return errorGrade(r.error ?? "no output");
  const source = answerSource(task, r.calls, r.context, r.requested);
  r.answerSource = source;
  if (source === "unknown" || (task === "recommend" && !(r.context as RecommendContext | undefined)?.candidates)) {
    return finalize([{ name: "modelAnswered", pass: false, critical: true, detail: "unknown provenance or grading context" }]);
  }
  let g: Grade;
  if (task === "identify") g = gradeIdentify((c as IdentifyCase).expect, r.output as BeanInfo);
  else if (task === "recommend") g = gradeRecommend(c as RecommendCase, r.output as Recipe, r.context as RecommendContext);
  else if (task === "review") g = gradeReview(c as ReviewCase, r.output as ShotReviewData, { note: (r.calls.find(call => call.schemaName === "ReviewNotes")?.output as { report?: { notesEvidence?: string; notesTaste?: string } } | undefined)?.report });
  else g = gradeDialIn(c as DialInCase, r.output as DialInAdvice, { fellBack: source === "fallback" });
  if (source === "fallback") r.fallbackGrade = finalize(g.checks.filter(check => check.name !== "modelAnswered"), g.labels);
  if (source === "fallback") {
    return finalize([{ name: "modelAnswered", pass: false, critical: true, detail: source }]);
  }
  if (source === "rules") g = finalize(g.checks.filter(check => check.name !== "modelAnswered"), g.labels);
  const schemaValid = JudgeVerdict.safeParse(r.judge).success;
  if (task !== "review") return schemaValid ? finalize([...g.checks, ...judgeChecks(r.judge!)], g.labels) : g;
  if (r.judgeCalls === undefined) return g;
  const evidence = reviewJudgeEvidence(reviewFixture((c as ReviewCase).input.fixture));
  const provenance = reviewJudgeProvenance(evidence);
  if (!r.judgeCalls.some(call => call.schemaName === "ReviewJudgeVerdict" && call.error === undefined)) {
    r.judgeStatus = "unavailable";
    return g;
  }
  if (r.judgeProvenance?.evidenceDigest !== provenance.evidenceDigest || r.judgeProvenance.rubricDigest !== provenance.rubricDigest) {
    r.judgeStatus = "unassessed";
    return g;
  }
  r.judgeStatus = reviewJudgeStatus(r.judge, evidence, r.output);
  if (!schemaValid || r.judgeStatus === "invalid-citation") return g;
  const checks = judgeChecks(r.judge!, true);
  const applied = r.judgeStatus === "assessed" ? checks : checks.filter(check => check.critical && !check.pass && check.name !== "judge.specificity" &&
    check.name !== "judge.actionable" && check.name !== "judge.plainLanguage");
  return applied.length ? finalize([...g.checks, ...applied], g.labels) : g;
}
