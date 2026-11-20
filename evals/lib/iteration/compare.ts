import { digest } from "./candidate.js";
import type { IterationCase, DeterministicScore } from "./score.js";

export interface Episode {
  id: string;
  repeat: number;
  inputHash: string;
  pairHash: string;
  score: DeterministicScore;
  source: string;
  subjectTokens: number;
  ms: number;
  narrative: string | null;
  judge?: { status: "assessed" | "invalid-citation" | "unassessed"; critical: string[]; quality: number };
}

export function design(cases: readonly IterationCase[], repeats: number) {
  return Array.from({ length: repeats }, (_, repeat) => cases.map(c => ({
    id: c.id, repeat, inputHash: c.hash,
  }))).flat();
}

const ratio = (n: number, d: number) => d ? n / d : null;
const mean = (values: number[]) => values.reduce((sum, n) => sum + n, 0) / values.length;
const quantile = (values: number[], q: number) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * q) - 1)];
const key = (r: Pick<Episode, "id" | "repeat">) => JSON.stringify([r.id, r.repeat]);

function align(expected: ReturnType<typeof design>, rows: readonly Episode[], pairHash: string) {
  const index = new Map(rows.map(r => [key(r), r]));
  if (rows.length !== expected.length || index.size !== expected.length) throw new Error("Incomplete or duplicate paired repeats");
  return expected.map(entry => {
    const row = index.get(key(entry));
    if (row?.inputHash !== entry.inputHash || row.pairHash !== pairHash) throw new Error("Paired input, subject, judge or scorer fingerprint differs");
    if (![row.ms, row.subjectTokens].every(n => Number.isFinite(n) && n >= 0)) throw new Error("Missing paired cost measurement");
    return row;
  });
}

function coverage(rows: Episode[]) {
  const scores = rows.map(r => r.score);
  const events = scores.flatMap(s => s.events);
  const alarms = scores.flatMap(s => s.falseAlarms);
  const abstention = scores.filter(s => s.abstention !== null);
  const nominal = scores.filter(s => s.nominal);
  return {
    classes: [...new Set([...events.map(e => e.kind), ...alarms])].sort().map(kind => {
      const required = events.filter(e => e.kind === kind);
      const tp = required.filter(e => e.matched).length;
      const fp = alarms.filter(k => k === kind).length;
      return { kind, tp, fp, fn: required.length - tp, precision: ratio(tp, tp + fp), recall: ratio(tp, required.length) };
    }),
    abstention: { passed: abstention.filter(s => s.abstention).length, total: abstention.length },
    nominal: { alarms: nominal.filter(s => s.nominalAlarm).length, total: nominal.length },
    unassessed: [...new Set(scores.flatMap(s => s.unassessedKinds))],
    unsupported: [...new Set(scores.flatMap(s => s.uncoveredKinds))],
    medianInput: quantile(rows.map(r => r.subjectTokens), 0.5),
    p95Ms: quantile(rows.map(r => r.ms), 0.95),
    judge: { covered: rows.filter(r => r.judge?.status === "assessed").length, quality: rows.every(r => r.judge) ? mean(rows.map(r => r.judge!.quality)) : null },
  };
}

function intervals(families: Map<string, number[]>) {
  // Paired bootstrap of template clusters, stratified by family. Repeats and
  // seeds from the same design never get independent bootstrap draws.
  let seed = 0x315ba611;
  const draw = (n: number) => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return Math.floor(seed / 2 ** 32 * n);
  };
  const strata = [...families.values()].filter(g => g.length);
  if (!strata.length) return null;
  const samples = Array.from({ length: 4000 }, () =>
    mean(strata.map(group => mean(group.map(() => group[draw(group.length)])))));
  return [quantile(samples, 0.025), quantile(samples, 0.975)];
}

export function compareEpisodes(cases: readonly IterationCase[], repeats: number, runPins: unknown,
    baseline: readonly Episode[], candidate: readonly Episode[], stage: "screen" | "dev" | "holdout",
    options: { offline: boolean; hardJudge: boolean; devVariation?: number }) {
  if (!cases.length || new Set(cases.map(c => c.id)).size !== cases.length || !Number.isInteger(repeats) || repeats < 1) throw new Error("Invalid paired panel");
  const schedule = design(cases, repeats);
  const hash = digest(runPins);
  const a = align(schedule, baseline, hash);
  const b = align(schedule, candidate, hash);
  const failures = new Set<string>();
  const adverse: { id: string; repeat: number; checks: string[]; before: string | null; after: string | null }[] = [];
  const pass = (r: Episode) => !r.score.critical.length && r.score.events.every(e => e.matched) && !r.score.nominalAlarm &&
    r.score.abstention !== false && (!options.hardJudge || r.judge?.critical.length === 0);
  const checkKeys = (r: Episode) => [...r.score.critical, ...(options.hardJudge ? r.judge?.critical ?? ["judge-missing"] : [])];
  for (const [i, row] of b.entries()) {
    const before = a[i];
    const checks = checkKeys(row).filter(c => !checkKeys(before).includes(c));
    if (checks.length) failures.add("critical regression");
    const losses = before.score.events.filter(e => e.matched && !row.score.events.some(f => f.id === e.id && f.matched));
    if (losses.length) failures.add("lost observable event");
    if (before.score.nominal && !before.score.nominalAlarm && row.score.nominalAlarm) failures.add("new nominal false alarm");
    if (before.score.abstention === true && row.score.abstention !== true) failures.add("lost justified abstention");
    if (checks.length || losses.length || before.score.salient && !row.score.salient) adverse.push({
      id: row.id, repeat: row.repeat, checks: [...checks, ...losses.map(e => `lost:${e.id}`), ...(before.score.salient && !row.score.salient ? ["lost:salience"] : [])],
      before: before.narrative, after: row.narrative,
    });
  }
  if (options.hardJudge && [...a, ...b].some(row => row.judge?.status !== "assessed")) failures.add("missing calibrated judge coverage");
  if (b.some(row => checkKeys(row).some(c => !c.startsWith("legacy.") && c !== "unsupported-outcome"))) failures.add("candidate critical error");

  const summaries = { baseline: coverage(a), candidate: coverage(b) };
  const cover = summaries.candidate;
  if (cover.classes.some(c => c.precision !== null && c.precision < 0.90 || c.recall !== null && c.recall < 0.90)) failures.add("per-class precision or recall below 90%");
  if (cover.abstention.total && cover.abstention.passed / cover.abstention.total < 0.95) failures.add("justified abstention below 95%");
  if (cover.nominal.total && cover.nominal.alarms / cover.nominal.total > 0.05) failures.add("nominal false alarms above 5%");
  if (cover.unsupported.length || cover.unassessed.length) failures.add("unassessed event coverage");
  if (!options.offline && (cover.medianInput > 1.10 * summaries.baseline.medianInput ||
      cover.p95Ms > 1.10 * summaries.baseline.p95Ms)) failures.add("median input tokens or p95 latency exceeded 110% of baseline");

  const byId = new Map(cases.map((c, index) => [c.id, {
    baseline: a.filter((_, i) => i % cases.length === index),
    candidate: b.filter((_, i) => i % cases.length === index),
  }]));
  const familyClusters = new Map<string, Map<string, number[]>>();
  const templateGains = new Set<string>();
  const passAll = cases.map(c => {
    const pair = byId.get(c.id)!;
    const baselinePass = pair.baseline.every(pass), candidatePass = pair.candidate.every(pass);
    if (baselinePass && !candidatePass) failures.add("lost a consistently correct critical result");
    const salient = (rows: Episode[]) => rows.map(r => r.score.salient).filter(v => v !== null).map(Number);
    const baselineSalience = salient(pair.baseline), candidateSalience = salient(pair.candidate);
    if (baselineSalience.length && candidateSalience.length) {
      const clusters = familyClusters.get(c.family) ?? new Map<string, number[]>();
      const values = clusters.get(c.template) ?? [];
      values.push(mean(candidateSalience) - mean(baselineSalience));
      clusters.set(c.template, values);
      familyClusters.set(c.family, clusters);
      if (!baselineSalience.every(Boolean) && candidateSalience.every(Boolean)) templateGains.add(c.template);
    }
    return { id: c.id, family: c.family, baseline: baselinePass, candidate: candidatePass };
  });
  const strata = new Map([...familyClusters].map(([family, groups]) => [family, [...groups.values()].map(mean)]));
  const family = [...strata].map(([name, values]) => ({ name, templates: values.length, salienceDelta: mean(values) }));
  const delta = family.length ? mean(family.map(f => f.salienceDelta)) : null;
  const interval = intervals(strata);
  const repeatScores = Array.from({ length: repeats }, (_, repeat) => mean([...familyClusters].map(([name, groups]) =>
    mean([...groups.keys()].map(template => {
      const rows = cases.filter(c => c.family === name && c.template === template)
        .map(c => byId.get(c.id)!.baseline[repeat].score.salient).filter(v => v !== null).map(Number);
      return mean(rows);
    })))));
  const measured = family.length ? Math.max(...repeatScores) - Math.min(...repeatScores) : 0;
  const variation = options.devVariation ?? measured;
  if (stage === "screen" && (!cover.classes.some(c => c.tp + c.fn > 0) || templateGains.size === 0 && (delta ?? 0) <= 0)) {
    failures.add("screen showed no event-priority gain");
  }
  if (stage !== "screen") {
    if (!cover.abstention.total || !cover.nominal.total || !cover.classes.some(c => c.tp + c.fn > 0)) failures.add("missing acceptance coverage");
    if (templateGains.size < 2) failures.add("fewer than two additional salient templates");
    if (delta === null || delta <= variation || !interval || interval[0] <= 0) failures.add("salience improvement inconclusive");
  }
  return { accepted: failures.size === 0, failures: [...failures], summaries, family, salientTemplateGains: templateGains.size,
    familyMacroDelta: delta, caseClusterInterval95: interval, baselineRepeatVariation: variation, passAll, adverse };
}
