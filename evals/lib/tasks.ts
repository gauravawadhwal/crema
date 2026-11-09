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
import { dialIn, recommend, rulesDialIn } from "../../server/recommend/index.js";
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
import { judge, judgeChecks, type JudgeVerdict } from "./judge.js";
import { RecordingProvider, type CallRecord } from "./recorder.js";

/** What is being evaluated: a model behind a provider, or Crema's rules with no model. */
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
  const base = { caseId: c.id, repeat, split: c.split, tags: c.tags };
  const t0 = performance.now();
  try {
    const { output, context, judgeInput } = await execute(task, c, subject, llm, opts.today);
    const ms = Math.round(performance.now() - t0);
    const record: RunRecord = { ...base, ms, output, context, calls: rec.calls, grade: errorGrade("ungraded") };
    if (opts.judge && judgeInput && task !== "identify" && !hasFallback(record)) {
      const jr = new RecordingProvider(opts.judge);
      try {
        record.judge = await judge(new ProviderChain([jr]), task === "recommend" ? "recipe" : task === "review" ? "shot review" : "dial-in advice", judgeInput, output);
      } catch (e) {
        console.warn(`judge failed on ${c.id}: ${(e as Error).message.slice(0, 200)}`);
      }
      record.judgeCalls = jr.calls;
    }
    record.grade = gradeRecord(task, c, record);
    return record;
  } catch (e) {
    const msg = (e as Error).message;
    return { ...base, ms: Math.round(performance.now() - t0), error: msg.slice(0, 2000), calls: rec.calls, grade: errorGrade(msg) };
  }
}

function hasFallback(r: RunRecord) {
  return r.calls.some((c) => c.error) || (r.context as { source?: string } | undefined)?.source?.startsWith("rules (") === true || (r.context as { fellBack?: boolean } | undefined)?.fellBack === true;
}

async function execute(task: TaskName, c: unknown, subject: Subject, llm: ProviderChain, today: Date): Promise<{ output: unknown; context?: unknown; judgeInput?: string }> {
  if (task === "identify") {
    const ic = c as IdentifyCase;
    const input: IdentifyInput = {
      query: ic.input.query,
      description: ic.input.description,
      today: ic.input.today,
      url: ic.input.url,
      pageText: ic.input.page ? readFixture("pages", ic.input.page).toString("utf8") : undefined,
      images: ic.input.images?.map((f) => ({ data: readFixture("labels", f), mediaType: MEDIA[path.extname(f).toLowerCase()] ?? "image/jpeg" })),
      offline: ic.input.offline,
    };
    return { output: await identify(llm, input) };
  }

  if (task === "recommend") {
    const rc = c as RecommendCase;
    const bean = expandBean(rc.input.bean, today);
    const shown = rankProfiles(bean, rc.input.preferences, rc.input.installed)
      .filter((x) => x.installed)
      .slice(0, 6);
    const res = await recommend(llm, {
      bean,
      preferences: rc.input.preferences,
      profileTitles: rc.input.installed,
      history: expandHistory(rc.input.history, today),
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
    return { output: result.review, context: { fellBack: subject.kind === "llm" && result.source === "rules" }, judgeInput: JSON.stringify(input) };
  }

  const dc = c as DialInCase;
  const bean = expandBean(dc.input.bean, today);
  const recipe = dialInRecipe(dc, bean);
  const shot = dialInShot(dc, recipe, today);
  const history = expandHistory(dc.input.history, today);
  if (subject.kind === "rules") {
    return { output: rulesDialIn(dc.input.feedback, shot, recipe), context: { fellBack: false }, judgeInput: JSON.stringify({ bean, recipe, shot, feedback: dc.input.feedback, history }) };
  }
  const advice = await dialIn(llm, { bean, recipe, shot, feedback: dc.input.feedback, history });
  const calls = (llm.providers[0] as RecordingProvider).calls;
  return { output: advice, context: { fellBack: !calls.length || calls.some((x) => x.error) }, judgeInput: calls[0]?.prompt };
}

/** Re-run only the judge on a saved record, using the prompt the model saw. */
export async function rejudge(task: TaskName, r: RunRecord, judgeProvider: LlmProvider): Promise<void> {
  const call = r.calls.find((c) => c.schemaName === "Recipe" || c.schemaName === "DialInAdvice");
  if (task === "identify" || !call || r.output == null || hasFallback(r)) return;
  const jr = new RecordingProvider(judgeProvider);
  try {
    r.judge = await judge(new ProviderChain([jr]), task === "recommend" ? "recipe" : task === "review" ? "shot review" : "dial-in advice", call.prompt, r.output);
  } catch (e) {
    console.warn(`judge failed on ${r.caseId}: ${(e as Error).message.slice(0, 200)}`);
    delete r.judge;
  }
  r.judgeCalls = jr.calls;
}

/** Grade a finished record. Deterministic, so `--regrade` can re-run it on saved outputs. */
export function gradeRecord(task: TaskName, c: unknown, r: RunRecord): Grade {
  if (r.error || r.output == null) return errorGrade(r.error ?? "no output");
  let g: Grade;
  if (task === "identify") g = gradeIdentify((c as IdentifyCase).expect, r.output as BeanInfo);
  else if (task === "recommend") g = gradeRecommend(c as RecommendCase, r.output as Recipe, r.context as RecommendContext);
  else if (task === "review") g = gradeReview(c as ReviewCase, r.output as ShotReviewData, r.context as { fellBack: boolean });
  else g = gradeDialIn(c as DialInCase, r.output as DialInAdvice, r.context as { fellBack: boolean });
  // Verdicts from an older judge schema are ignored until re-judged.
  return typeof r.judge?.contradictions?.[0] !== "string" && Array.isArray(r.judge?.contradictions) ? finalize([...g.checks, ...judgeChecks(r.judge)], g.labels) : g;
}
