import type { ShotReviewData } from "../../server/recommend/review-types.js";
import type { ReviewCase } from "./dataset.js";
import { changeCount, finalize, primaryMove, type Grade } from "./graders.js";
import { reviewFixture } from "./review-fixtures.js";

const GRIND_ISSUES = ["fast_shot", "slow_shot", "pressure_shortfall", "flow_shortfall", "choked", "gushed"];

// Small, explicit checks for claims we can verify mechanically. They are not a
// prose-quality score: the independent judge assesses causal restraint,
// prioritization and whether the proposed experiment would teach the user anything.
const sentences = (text: string) => text.split(/(?<=[.!?])\s+|[;\n]+/).map(s => s.toLowerCase());
const values = (text: string) => [...text.matchAll(/(?<![\d.])\d+(?:\.\d+)?(?!\d|\.\d)/g)].map(m => Number(m[0]));
const close = (actual: number, expected: number, tolerance = 0.15) => Math.abs(actual - expected) <= tolerance;
const hasValue = (text: string, n: number) => values(text).some(v => close(v, n));
const NUM = String.raw`(\d+(?:\.\d+)?)(?!\d|\.\d)`;
const TIME = String.raw`\s*(?:-\s*)?(?:s\b|sec(?:ond)?s?\b)`;
const expectedTime = /\b(?:expected|target|guide|window|range)\b/;
const paceRelation = {
  fast: String.raw`(?:fast(?:er)? than|quick(?:er)? than|short of|under|below|before|earlier than)`,
  slow: String.raw`(?:slow(?:er)? than|longer than|over|above|after|past|beyond)`,
  in_window: String.raw`(?:within|inside|(?:right )?in)`,
};

type Narrative = NonNullable<ReviewCase["expect"]["narrative"]>;

function paceCorrect(text: string, label: NonNullable<Narrative["pace"]>): boolean {
  const offset = label.status === "fast" ? label.windowS[0] - label.actualS : label.actualS - label.windowS[1];
  const duration = new RegExp(String.raw`\b(?:finished in|took|lasting|taking|shot(?: time)?(?: was| of| at)?|in|at|expected:)\s+${NUM}${TIME}|\b${NUM}${TIME}\s+shot\b`, "g");
  const ranges = new RegExp(String.raw`\b${NUM}\s*(?:[–—-]|to)\s*${NUM}${TIME}`, "g");
  const relation = new RegExp(String.raw`\b${paceRelation[label.status]}\b[^.!?]*(?:\b(?:expected|target|guide|window|range)\b)`);
  return sentences(text).some(s => {
    if (!expectedTime.test(s) || !relation.test(s) || /\b(?:not|wasn't|isn't)\s+(?:too\s+)?(?:fast|slow|quick|short|above|below|under|within|in\b|inside)/.test(s)) return false;
    if (label.status === "fast" && /\b(?:slow(?:er)?|longer than)\b/.test(s) ||
        label.status === "slow" && /\b(?:fast(?:er)?|quicker than)\b/.test(s)) return false;
    if ([...s.matchAll(ranges)].some(([, lo, hi]) => !close(Number(lo), label.windowS[0]) || !close(Number(hi), label.windowS[1]))) return false;
    const actual = [...s.matchAll(duration)].map(m => Number(m[1] ?? m[2]));
    if (actual.some(n => !close(n, label.actualS, 1))) return false;
    const offsetClaim = new RegExp(String.raw`\b${NUM}${TIME}\s+${paceRelation[label.status]}\b`);
    const statedOffset = s.match(offsetClaim);
    if (!actual.length && !statedOffset && label.status === "in_window") return false;
    return actual.length > 0 || (label.status !== "in_window" && !!statedOffset && close(Number(statedOffset[1]), offset, 1));
  });
}

function targetCorrect(text: string, label: NonNullable<Narrative["target"]>): boolean {
  const parts = sentences(text);
  const unit = label.pump === "pressure" ? "bar" : String.raw`ml\s*/\s*s`;
  const reading = String.raw`${NUM}(?:\s*(bar\b|ml\s*/\s*s\b))?`;
  const measured = new RegExp(String.raw`\b(?:measured|averag(?:ed|ing)|held|reach(?:ed|ing)|(?:pressure|flow) (?:was|sat|stayed))\s+(?:(?:only|just|at|near|about|around|to)\s+)*${reading}`, "g");
  const target = new RegExp(String.raw`\b(?:target\s+(?:(?:of|was|is|at)\s+)*|expected\s+)${reading}|\b${reading}\s+(?:(?:pressure|flow)\s+)?(?:target|step|plan|pour)\b`, "g");
  return parts.flatMap((s, i) => [s, `${s} ${parts[i + 1] ?? ""}`]).some(s => {
    if (!new RegExp(String.raw`\b(?:${label.pump}|${unit})\b`).test(s)) return false;
    if (/\b(?:not|wasn't|isn't)\s+(?:below|above|under|over|short|within|on target)/.test(s)) return false;
    if (label.status === "shortfall" && /\b(?:exceeded|overshot|above (?:the |its )?target)\b/.test(s)) return false;
    if (label.status !== "met" && /\b(?:met|matched|reached)\s+(?:(?:its|the)\s+)?(?:\d+(?:\.\d+)?\s*(?:bar|ml\s*\/\s*s)\s+)?target\b/.test(s.replace(/\b(?:never|didn't|did not)\s+reached?\b/g, ""))) return false;
    const ratio = s.match(/\b(?:reached|averaged|held|measured)\s+(?:only\s+)?(\d+(?:\.\d+)?)\s*%\s+of\s+(?:its |the )?target\b/);
    if (ratio && label.target !== 0) return close(Number(ratio[1]), label.actual * 100 / label.target, 1);
    const sameUnit = (u: string | undefined) => u == null || new RegExp(`^${unit}$`).test(u);
    const actuals = [...s.matchAll(measured)].filter(m => sameUnit(m[2]));
    const targets = [...s.matchAll(target)].filter(m => sameUnit(m[2] ?? m[4]));
    const linked = actuals.some(a => targets.some(t => {
      const between = s.slice(Math.min(a.index, t.index), Math.max(a.index, t.index) + Math.max(a[0].length, t[0].length));
      return (a[2] || t[2] || t[4]) && close(Number(a[1]), label.actual) && close(Number(t[1] ?? t[3]), label.target) &&
        !/\b(?:temperature|yield|dose|cup weight)\b/.test(between);
    }));
    return linked;
  });
}

function historyCorrect(text: string, label: NonNullable<Narrative["history"]>): boolean {
  const s = text.toLowerCase();
  if (label.kind === "confounded") return /\b(?:previous|earlier|prior|last|history)\b/.test(s) &&
    /\b(dose|yield|profile|temperature|recipe)\b/.test(s) &&
    /\b(confound\w*|cannot|can't|unsuitable|not comparable|isolate|not directly|not a (?:fair|controlled|clean))\b/.test(s);
  if (label.kind === "insufficient") return /\b(?:previous|earlier|prior|last|history|recorded)\b/.test(s) &&
    /\b(?:time|timing|duration|grind|recipe|history|comparison)\b/.test(s) &&
    /\b(?:missing|unknown|unrecorded|not recorded|unavailable|lacks? enough|insufficient|cannot establish)\b/.test(s);
  const transition = s.match(new RegExp(String.raw`\b(?:(?:time|duration)\s+(?:went|changed|rose|fell)\s+from\s+(?:the previous )?|coincided with\s+)${NUM}(?:${TIME})?\s+to\s+${NUM}${TIME}`));
  const roleTime = (role: RegExp, expected: number | undefined) => expected === undefined || text.split(/(?<=[.!?])\s+|[;\n]+/).some(raw => {
    const part = raw.toLowerCase();
    return role.test(part) && [...part.matchAll(new RegExp(String.raw`\b${NUM}${TIME}`, "g"))].some(m => close(Number(m[1]), expected, 1));
  });
  const previous = /\b(?:previous|earlier|prior|last)\b/;
  const current = /\b(?:current|this)\b/;
  const agrees = (n: string, expected: number | undefined) => expected === undefined || close(Number(n), expected, 1);
  const measured = transition ? agrees(transition[1], label.previousS) && agrees(transition[2], label.currentS)
    : roleTime(previous, label.previousS) && roleTime(current, label.currentS);
  if (!measured) return false;
  if (label.kind === "same_grind") return /\b(?:same|unchanged|identical)\b[^;\n]*\b(?:grind|setting)\b/.test(s);
  if (!label.changedGrind) return true;
  if (!label.previousSetting || !label.currentSetting) return false;
  const old = label.previousSetting.toLowerCase();
  const next = label.currentSetting.toLowerCase();
  const change = s.match(/\b(?:grind(?:er)?(?: setting)?|change from)\s+([\w.-]+)\s*(?:→|to)\s*([\w.-]+)/);
  if (change) return change[1] === old && change[2] === next;
  if (transition && /\brecorded grind setting changed\b/.test(s)) return true;
  const clauses = text.toLowerCase().split(/(?<=[.!?])\s+|[;\n]+/);
  const setting = (role: RegExp, value: string) => clauses.some(part => role.test(part) &&
    part.match(/\bgrind(?:er)?(?: setting)?\s+([\w.-]+)/)?.[1] === value);
  return setting(previous, old) && setting(current, next);
}

function usefulAbstention(text: string, kind: NonNullable<NonNullable<ReviewCase["expect"]["narrative"]>["abstention"]>): boolean {
  const s = text.toLowerCase();
  const repeat = /\b(?:repeat|record|check|verify|confirm|retest|taste again)\b/;
  if (!repeat.test(s)) return false;
  if (kind === "conflict") return /\b(?:taste|notes?|sour\w*|bitter\w*)\b/.test(s) &&
    /\b(?:conflict\w*|oppos\w*|disagree\w*|uncertain|ambiguous|contradic\w*)\b/.test(s);
  if (kind === "profile") return /\b(?:recorded profile|manual control|controller|profile (?:is )?(?:unknown|missing))\b/.test(s);
  if (kind === "telemetry") return /\b(?:curve|recording|samples|scale|telemetry)\b/.test(s) &&
    /\b(?:not recorded|not enough|missing|unavailable|no|check that)\b/.test(s);
  return /\b(?:taste|tasted|flavou?r)\b/.test(s);
}

function controlMismatchCheck(text: string, label: NonNullable<NonNullable<ReviewCase["expect"]["narrative"]>["controlMismatch"]>, needsCheck: boolean): boolean {
  const s = text.toLowerCase();
  const mismatch = sentences(s).some(part => {
    if (/\b(?:target matched|matched (?:the |its )?target|on target)\b/.test(part)) return false;
    if (targetCorrect(part, { pump: "flow", actual: label.actualFlow, target: label.targetFlow, status: "above" })) return true;
    const doubled = /\bflow\b[^.!?]*\b(?:double[ds]?|twice)\b[^.!?]*\b(?:target|command)/.test(part) &&
      hasValue(part, label.targetFlow) && label.actualFlow === 2 * label.targetFlow;
    const yieldOvershoot = /\byield (?:was |of )?[^.!?]*\b(?:exceeded|overshot|above)\b/.test(part) &&
      /\btarget\b/.test(part) && hasValue(part, label.actualYieldG);
    return doubled || yieldOvershoot;
  });
  const check = /\b(check|verify|confirm|inspect|review|ensure|make sure)\b[^.!?]*(?:\b(profile|scale|stop\w*|workflow|calibrat\w*)\b|flow[- ]control)/.test(s);
  return mismatch && (!needsCheck || check);
}

const ACTIONS: readonly [string, RegExp][] = [
  ["finer", /\b(?:(?:grind|go|move|try|step)\s+(?:(?:one|a|small|single|slight|slightly|much|step|adjustment|bit|little)\s+){0,4}finer\b|(?:use|try)\s+(?:[\w-]+\s+){0,4}finer (?:grind|setting|step)\b)/],
  ["coarser", /\b(?:(?:grind|go|move|try|step)\s+(?:(?:one|a|small|single|slight|slightly|much|step|adjustment|bit|little)\s+){0,4}coarser\b|(?:use|try)\s+(?:[\w-]+\s+){0,4}coarser (?:grind|setting|step)\b)/],
  ["switch", /\b(?:switch to|load|select)\s+(?:the\s+)?[^.!?]*\bprofile\b/],
  ["temp", /\b(?:raise|lower|increase|decrease)\s+(?:the\s+)?temp(?:erature)?\b/],
  ["yield", /\b(?:raise|lower|increase|decrease|reduce)\s+(?:the\s+)?yield\b/],
];

function displayedActions(text: string) {
  const chunks = sentences(text.replaceAll("’", "'")).flatMap(s => s.split(/\b(?:and|but)\b/));
  return new Set(ACTIONS.filter(([, rx]) => chunks.some(chunk => {
    const request = rx.exec(chunk);
    return request && !/\b(?:if|unless|before|avoid|don't|do not|never|without|no reason to)\b/.test(chunk.slice(0, request.index));
  })).map(([key]) => key));
}

type NotesReport = { notesEvidence?: string; notesTaste?: string };
export function sensoryAttribution(input: ReturnType<typeof reviewFixture>, note: NotesReport) {
  const saved = input.notes ?? input.feedback?.notes;
  const quote = note.notesEvidence?.toLowerCase();
  const taste = note.notesTaste;
  if (!quote || !taste || !saved?.includes(note.notesEvidence!)) return false;
  if (!["sour", "bitter", "thin", "heavy"].includes(taste)) return false;
  const positive = new RegExp(`\\b${taste}(?:ness)?\\b`);
  return sentences(quote).flatMap(s => s.split(/\b(?:but|although)\b/)).some(s =>
    positive.test(s) && !/\b(?:no|not|never|without|didn't|untasted|if|say|claim|pretend|report|classify|describe)\b/.test(s));
}

export function gradeReview(c: ReviewCase, out: ShotReviewData, context?: { fellBack?: boolean; note?: NotesReport }): Grade {
  const move = out.nextShot ? primaryMove(out.nextShot) : "none";
  const input = reviewFixture(c.input.fixture);
  const kinds = out.issues.map(i => i.kind);
  const end = input.points.at(-1)?.t ?? 0;
  const hasGrindIssue = c.expect.requiredIssues.some(k => GRIND_ISSUES.includes(k));
  const expectsGrindMove = (hasGrindIssue || c.expect.narrative?.actionEvidence != null) && (move === "finer" || move === "coarser");
  const narrative = c.expect.narrative;
  const explanation = `${out.summary} ${out.nextShot?.reasoning ?? ""}`;
  const reason = out.nextShot?.reasoning ?? "";
  const prose = [out.summary, ...out.wentWell, ...out.issues.flatMap(i => [i.what, i.evidence]), out.nextShot?.change, reason].filter(Boolean).join("\n");
  const actions = displayedActions(prose);
  const fieldKinds = new Set<string>();
  if (out.nextShot?.grindDelta && out.nextShot.grindDelta !== "same") fieldKinds.add(out.nextShot.grindDelta.endsWith("finer") ? "finer" : "coarser");
  if (out.nextShot?.switchProfile) fieldKinds.add("switch");
  if (out.nextShot?.tempDeltaC) fieldKinds.add("temp");
  if (out.nextShot?.yieldDeltaG) fieldKinds.add("yield");
  const title = out.nextShot?.change ?? "";
  const titleDirections = [...displayedActions(title), ...title.toLowerCase().matchAll(/\b(?:one|small)\s+(?:step\s+)?(finer|coarser)\b/g)].map(value => typeof value === "string" ? value : value[1]);
  const directionConsistent = [...actions, ...titleDirections].every(action => fieldKinds.has(action));
  const unsupportedAssertion = sentences(prose).some(s =>
    /\bextraction yield\s+(?:was|is|of|at|reached|measured)\s+\d+(?:\.\d+)?\s*%/.test(s) ||
    /\b(?:sweetness|bitterness|sourness|channeling)\s+(?:is|was)\s+(?:proven|confirmed|definite)\b/.test(s) ||
    /\bdefinite(?:ly)?\s+channel(?:l)?ing\b/.test(s));
  const trial = /\b(?:try|trial|repeat|next (?:shot|pour)|retest|one (?:small|step)|small(?:er)? (?:step|adjustment))\b/i.test(reason);
  const observation = /\b(?:watch|look for|check|taste|compare)\b[^.!?]*\b(?:pressure|flow|pour|pace|tast(?:e|ing)|sour\w*|bitter\w*|finish|body|window)\b/i.test(reason) &&
    /\b(?:pressure|flow|pour|pace|tast(?:e|ing)|sour\w*|bitter\w*|finish|body)\b/i.test(reason);
  const experimentUseful = trial && observation;
  const grindExplained = experimentUseful && fieldKinds.has(move);
  const hasNoteAction = !!context?.note && !!out.nextShot && /\byou reported\b/i.test(reason);
  return finalize([
    { name: "modelAnswered", pass: !context?.fellBack, critical: true },
    { name: "acceptableMove", pass: c.expect.accept.includes(move), critical: true, detail: `move ${move}; accept ${c.expect.accept.join(", ")}` },
    { name: "requiredIssues", pass: c.expect.requiredIssues.every(k => kinds.includes(k)), critical: true, detail: `observed ${kinds.join(", ")}` },
    { name: "noFalseAlarms", pass: !c.expect.forbiddenIssues.some(k => kinds.includes(k)) && (!c.expect.noFaults || !out.issues.some(i => i.severity !== "info")), critical: true },
    { name: "oneChange", pass: new Set([...actions, ...fieldKinds]).size <= 1, critical: true },
    { name: "validSwitch", pass: !out.nextShot?.switchProfile || input.installedProfiles.includes(out.nextShot.switchProfile), critical: true },
    { name: "groundedRanges", pass: out.issues.every(i => (i.fromS == null && i.toS == null) || (i.fromS != null && i.toS != null && i.fromS >= 0 && i.toS >= i.fromS && i.toS <= end)), critical: true },
    ...(c.expect.askTaste === undefined ? [] : [{ name: "askTaste", pass: out.askTaste === c.expect.askTaste, critical: true }]),
    { name: "supportedClaims", pass: !unsupportedAssertion, critical: true },
    ...(hasNoteAction ? [{ name: "groundedSensoryAdvice", pass: sensoryAttribution(input, context!.note!), critical: true }] : []),
    { name: "directionConsistent", pass: directionConsistent, critical: true, detail: prose },
    ...(narrative?.pace ? [{ name: "paceComparison", pass: paceCorrect(out.summary, narrative.pace), critical: true, detail: out.summary }] : []),
    ...(narrative?.target ? [{ name: "targetComparison", pass: targetCorrect(explanation, narrative.target), critical: true, detail: explanation }] : []),
    ...(narrative?.history ? [{ name: "historyComparison", pass: historyCorrect(explanation, narrative.history), critical: true, detail: explanation }] : []),
    ...(narrative?.abstention ? [{ name: "usefulAbstention", pass: usefulAbstention(explanation, narrative.abstention), critical: true, detail: explanation }] : []),
    ...(narrative?.controlMismatch ? [{ name: "controlMismatchCheck", pass: controlMismatchCheck(explanation, narrative.controlMismatch, move === "none"), critical: true, detail: explanation }] : []),
    // Surface wording heuristics as diagnostics. The independent review judge
    // gates semantic usefulness without demanding particular causal connectors.
    ...(expectsGrindMove ? [{ name: "grindDirectionMatchesIssue", pass: grindExplained, diagnostic: true, detail: out.nextShot?.reasoning ?? "no nextShot" }] : []),
    ...(out.nextShot && changeCount(out.nextShot) > 0 ? [{ name: "usefulExperiment", pass: experimentUseful, diagnostic: true, detail: reason }] : []),
  ], { move, findings: kinds.join(",") });
}
