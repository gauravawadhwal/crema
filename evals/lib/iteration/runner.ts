import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ProviderChain } from "../../../server/llm/index.js";
import { analyzeShot } from "../../../server/profiles/analysis.js";
import type { PhaseLandmark } from "../../../server/profiles/phase-evidence.js";
import { rulesReviewResult } from "../../../server/recommend/review-local.js";
import { reviewShot } from "../../../server/recommend/review.js";
import { authoredCoachRows } from "../review-coach-grader.js";
import { replayCoachCross } from "../review-crossed.js";
import type { CallRecord } from "../recorder.js";
import type { LlmProvider, StructuredRequest, Usage } from "../../../server/llm/types.js";
import { jsonSchemaFor } from "../../../server/llm/types.js";
import type { z } from "zod";
import { judgeChecks, judgeReview, reviewJudgeEvidence, reviewJudgeStatus } from "../judge.js";
import { curveRequest, digest, propose, Proposal, type Candidate, type DevError } from "./candidate.js";
import { compareEpisodes, design, type Episode } from "./compare.js";
import { IsolatedCli } from "./providers.js";
import { readJson, saveJson, stopCheck } from "./runtime.js";
import { scoreEpisode, type IterationCase } from "./score.js";

export interface Pins {
  commit: string;
  scorer: string;
  dataset: string;
  subject: unknown;
  judge: unknown;
  proposer: unknown;
}

interface Call {
  name: string;
  promptHash: string;
  evidenceHash: string;
  usage?: Usage;
}

interface Run {
  pins: Pins;
  dir: string;
  stop: string;
  subject?: LlmProvider;
  judge?: LlmProvider;
  hardJudge: boolean;
  offline: boolean;
}

interface StoredEpisode extends Episode {
  checkpoint: string;
  calls: Call[];
  judgeCalls: Call[];
}

function recorded(provider: LlmProvider, calls: Call[], stop: string, candidate?: Candidate, errors: unknown[] = [],
    captureCurve?: (call: Pick<CallRecord, "prompt" | "output">) => void): LlmProvider {
  return {
    id: provider.id, billing: provider.billing, model: provider.model,
    async structured<T extends z.ZodType>(original: StructuredRequest<T>) {
      if (errors.length) throw new Error("Gym provider call stopped after failure");
      const req = curveRequest(original, candidate);
      const call: Call = { name: req.schemaName, promptHash: digest([req.system, jsonSchemaFor(req.schema)]), evidenceHash: digest(req.prompt) };
      calls.push(call);
      try {
        stopCheck(stop);
        const value = await provider.structured({ ...req, onUsage(usage) { call.usage = usage; } });
        if (req.schemaName === "CurveNarrative") {
          const answer = value as { rewrites?: { evidenceIds: string[] }[]; interpretation?: { evidenceIds: string[] } | null };
          const evidence = req.prompt.split("\n").find(line => line.startsWith('{"recording"'));
          const knownIds = new Set(evidence ? Object.keys(JSON.parse(evidence)) : []);
          const citations = [...(answer.rewrites ?? []).flatMap(r => r.evidenceIds), ...(answer.interpretation?.evidenceIds ?? [])];
          if (!evidence || citations.some(id => !knownIds.has(id))) {
            throw new Error("Curve answer cited unavailable evidence");
          }
          captureCurve?.({ prompt: req.prompt, output: value });
        }
        return value;
      } catch (error) {
        errors.push(error);
        // Production catches provider errors and logs their messages. Keep
        // vendor stderr and case-related diagnostics out of that log.
        throw new Error("Gym provider call failed");
      }
    },
  };
}

async function episode(run: Run, c: IterationCase, repeat: number, pairHash: string, candidate?: Candidate,
    save = true): Promise<StoredEpisode> {
  stopCheck(run.stop);
  const checkpoint = digest({ pairHash, id: c.id, inputHash: c.hash, repeat, candidate: candidate ?? null });
  const file = join(run.dir, "episodes", checkpoint + ".json");
  if (save && existsSync(file)) {
    const cached = readJson(file) as StoredEpisode;
    if (cached.checkpoint !== checkpoint || cached.pairHash !== pairHash || cached.id !== c.id ||
        cached.inputHash !== c.hash || cached.repeat !== repeat) throw new Error("Checkpoint fingerprint differs");
    return cached;
  }
  const calls: Call[] = [], judgeCalls: Call[] = [];
  const providerErrors: unknown[] = [];
  let curveCall: Pick<CallRecord, "prompt" | "output"> | undefined;
  const provider = run.subject && recorded(run.subject, calls, run.stop, candidate, providerErrors, call => { curveCall = call; });
  const meteringMs = () => run.subject instanceof IsolatedCli ? run.subject.meteringMs : 0;
  const start = performance.now();
  const meteringStart = meteringMs();
  const pointBudget = candidate?.change.kind === "point-budget" ? candidate.change.rows : undefined;
  const result = provider ? await reviewShot(new ProviderChain([provider]), c.input, c.fullTrace, { pointBudget }) :
    rulesReviewResult(c.input, c.fullTrace);
  const ms = Math.max(0, performance.now() - start - (meteringMs() - meteringStart));
  const askedCurve = calls.some(call => call.name === "CurveNarrative");
  if (providerErrors.length) throw new Error("Provider error or fallback stopped the round", { cause: providerErrors[0] });
  if (provider && (askedCurve ? result.source !== provider.id : result.source !== "rules")) throw new Error("Unexpected review source or fallback");
  const trace: PhaseLandmark[] = [];
  analyzeShot(c.input, trace);
  const isolation = await replayCoachCross(c.input, result, c.fullTrace, curveCall, pointBudget);
  const authored = authoredCoachRows(result.coach, curveCall?.output);
  const score = scoreEpisode(c, result, trace, !provider, isolation, authored);
  const narrative = result.curve.narrative?.text ?? null;
  const row: StoredEpisode = { id: c.id, repeat, inputHash: c.hash, pairHash, checkpoint, score, narrative,
    source: result.source, ms, subjectTokens: calls.reduce((n, { usage }) => n + (usage?.inputTokens ?? 0) + (usage?.cacheTokens ?? 0), 0),
    calls, judgeCalls };
  if (run.judge) {
    // Canonical evidence is identical across arms. Neither variant prompt nor
    // goal, labels, IDs, grader outcomes or arm is sent to the judge.
    const evidence = reviewJudgeEvidence(c.input, c.fullTrace);
    const answer = { narrative: result.curve.narrative, taste: result.taste, nextShot: result.review.nextShot };
    const verdict = await judgeReview(new ProviderChain([recorded(run.judge, judgeCalls, run.stop)]), evidence, answer);
    const status = reviewJudgeStatus(verdict, evidence, answer);
    const checks = judgeChecks(verdict, true);
    const isProseScore = (name: string) => ["judge.specificity", "judge.actionable", "judge.plainLanguage"].includes(name);
    row.judge = { status,
      critical: status === "assessed" ? checks.filter(c => c.critical && !c.pass && !isProseScore(c.name)).map(c => c.name) : [],
      quality: checks.find(c => c.name === "judge.quality")!.score!,
    };
  }
  if (save) saveJson(file, row);
  return row;
}

export async function comparePanel(run: Run, cases: IterationCase[], repeats: number, candidate: Candidate,
    stage: "screen" | "dev" | "holdout", devVariation?: number) {
  const expected = design(cases, repeats);
  const runPins = { ...run.pins, panel: digest(expected), stage, pairing: digest(candidate) };
  const pairHash = digest(runPins);
  const b: StoredEpisode[] = [], c: StoredEpisode[] = [];
  const byId = new Map(cases.map(entry => [entry.id, entry]));
  for (const [index, item] of expected.entries()) {
    const evaluate = (arm?: Candidate) => episode(run, byId.get(item.id)!, item.repeat, pairHash, arm, stage !== "holdout");
    if (index % 2) {
      c.push(await evaluate(candidate));
      b.push(await evaluate());
    } else {
      b.push(await evaluate());
      c.push(await evaluate(candidate));
    }
  }
  const report = compareEpisodes(cases, repeats, runPins, b, c, stage, { offline: run.offline, hardJudge: run.hardJudge, devVariation });
  return { pins: runPins, candidate, ...report, calls: stage === "holdout" ? undefined :
    { baseline: b.map(({ id, repeat, calls, judgeCalls }) => ({ id, repeat, calls, judgeCalls })),
      candidate: c.map(({ id, repeat, calls, judgeCalls }) => ({ id, repeat, calls, judgeCalls })) },
    lockedUsage: stage === "holdout" ? {
      baseline: b.map(({ calls, judgeCalls }) => ({ calls, judgeCalls })),
      candidate: c.map(({ calls, judgeCalls }) => ({ calls, judgeCalls })),
    } : undefined,
  };
}

export async function develop(run: Run, screen: IterationCase[], dev: IterationCase[], proposer: LlmProvider, binding: string) {
  if (screen.length !== 4 || new Set(screen.map(c => c.template)).size !== 4) throw new Error("Screen requires four distinct dev templates");
  mkdirSync(join(run.dir, "episodes"), { recursive: true, mode: 0o700 });
  const proposalFile = join(run.dir, "proposal.json");
  const baselinePins = { ...run.pins, panel: digest(design(screen, 3)), stage: "proposal-baseline" };
  const baselineHash = digest(baselinePins);
  let candidates: Candidate[];
  if (existsSync(proposalFile)) {
    const prior = readJson(proposalFile) as { binding: string; candidates: unknown };
    if (prior.binding !== binding) throw new Error("Proposal input fingerprint differs");
    candidates = Proposal.parse({ candidates: prior.candidates }).candidates;
  } else {
    const errors: DevError[] = [];
    for (const plan of design(screen, 3)) {
      const entry = screen.find(c => c.id === plan.id)!;
      const row = await episode(run, entry, plan.repeat, baselineHash);
      const { score, narrative } = row;
      const missed = score.events.filter(e => !e.matched).map(e => e.kind);
      if (score.critical.length || missed.length || score.salient === false || score.abstention === false) {
        errors.push({ family: entry.family, checks: [...score.critical, ...(score.salient === false ? ["missed-priority"] : [])], missed, narrative });
      }
    }
    const calls: Call[] = [];
    candidates = await propose(recorded(proposer, calls, run.stop), errors);
    saveJson(proposalFile, { binding, candidates, calls });
  }
  const screens = [];
  for (const candidate of candidates) screens.push(await comparePanel(run, screen, 3, candidate, "screen"));
  // Screen nominates at most one and never falls through to another candidate
  // after the larger dev panel fails. Judge prose quality never breaks ties.
  const best = screens.filter(report => report.accepted).sort((a, b) =>
    b.salientTemplateGains - a.salientTemplateGains || (b.familyMacroDelta ?? -1) - (a.familyMacroDelta ?? -1))[0];
  const finalist = best && await comparePanel(run, dev, 3, best.candidate, "dev");
  return { pins: run.pins, binding, screens, finalist: finalist ?? null };
}

export type DevReport = Awaited<ReturnType<typeof develop>>;
