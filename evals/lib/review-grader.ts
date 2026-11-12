import type { ShotReviewData } from "../../server/recommend/review-types.js";
import type { ReviewCase } from "./dataset.js";
import { changeCount, finalize, primaryMove, type Grade } from "./graders.js";
import { reviewFixture } from "./review-fixtures.js";

const GRIND_ISSUES = ["fast_shot", "slow_shot", "pressure_shortfall", "flow_shortfall", "choked", "gushed"];

// Small, explicit checks for claims we can verify mechanically. They are not a
// prose-quality score: the independent judge assesses causal restraint,
// prioritization and whether the proposed experiment would teach the user anything.
const sentences = (text: string) => text.split(/(?<=[.!?])\s+|[;\n]+/).map(s => s.toLowerCase());
const values = (text: string) => [...text.matchAll(/(?<![\d.])\d+(?:\.\d+)?(?![\d.])/g)].map(m => Number(m[0]));
const hasValue = (text: string, n: number, tolerance = 0.15) => values(text).some(v => Math.abs(v - n) <= tolerance);
const timeValues = (text: string) => [...text.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:s\b|sec(?:ond)?s?\b)/g)].map(m => Number(m[1]));
const timeRanges = (text: string) => [...text.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:[–—-]|to)\s*(\d+(?:\.\d+)?)\s*(?:s\b|sec(?:ond)?s?\b|(?:target |expected )?(?:window|range)\b)/g)].map(m => [Number(m[1]), Number(m[2])]);
const comparison = /\b(target|plan|step|window|expected|range|against|versus|vs|asked|requested|compared|of the)\b/;
const verdicts = {
  fast: /\b(fast(?:er)?|quick(?:er)?|short(?:er)?|under|below|before|ahead|earlier)\b/,
  slow: /\b(slow(?:er)?|long(?:er)?|over|above|past|beyond)\b/,
  in_window: /\b(within|inside|in (?:the )?(?:target )?(?:window|range)|on (?:time|track)|in line|right in)\b/,
};

function paceCorrect(text: string, label: NonNullable<NonNullable<ReviewCase["expect"]["narrative"]>["pace"]>): boolean {
  const delta = label.status === "fast" ? label.windowS[0] - label.actualS : label.actualS - label.windowS[1];
  return sentences(text).some(s => {
    if (!comparison.test(s) || !verdicts[label.status].test(s)) return false;
    if (timeRanges(s).some(([lo, hi]) => Math.abs(lo - label.windowS[0]) > 0.1 || Math.abs(hi - label.windowS[1]) > 0.1)) return false;
    const negative = s.replace(/\b(?:not|isn't|wasn't|is not|was not)\s+(?:too\s+)?(?:fast(?:er)?|slow(?:er)?|quick(?:er)?|within|inside)\b/g, "");
    if (!verdicts[label.status].test(negative)) return false;
    const timed = timeValues(s);
    // Either quote the actual duration, or how far outside the window it was.
    // A bare window copied out of the header does not establish the comparison.
    return timed.some(n => Math.abs(n - label.actualS) <= 1 || label.status !== "in_window" && Math.abs(n - delta) <= 1);
  });
}

function targetCorrect(text: string, label: NonNullable<NonNullable<ReviewCase["expect"]["narrative"]>["target"]>): boolean {
  const parts = sentences(text);
  // A comparison may span adjacent sentences: "The 6 bar pour missed target.
  // Pressure sat at 3.8 bar." It need not repeat both numbers in one clause.
  const candidates = parts.flatMap((s, i) => [s, `${s} ${parts[i + 1] ?? ""}`]);
  return candidates.some(s => {
    const quantity = label.pump === "pressure" ? /\b(pressure|bar)\b/ : /\bflow\b|ml\s*\/\s*s/;
    const verdict = label.status === "shortfall" ? /\b(short|shortfall|below|under|only|missed|miss|held back|never reached|low puck resistance)\b/
      : label.status === "above" ? /\b(above|over|exceeded|twice|double)\b/ : /\b(held|met|near|followed|reached|tracked|on target|matches|matched|slight(?:ly)?|modest|small|within)\b|\bon\s+(?:the\s+)?\d[^.!?]*\btarget\b/;
    if (!(quantity.test(s) && comparison.test(s) && hasValue(s, label.actual) && hasValue(s, label.target))) return false;
    // Verify common explicit measured/target roles, not just the presence of
    // both numbers. More complex wording still needs the independent judge.
    const actualClaims = [...s.matchAll(/\b(?:measured|averag(?:ed|ing)|held|reach(?:ed|ing)|pressure (?:was|sat|stayed)|flow (?:was|sat|stayed))\s+(?:(?:only|just|at|near|about|around|to)\s+)*(\d+(?:\.\d+)?)/g)].map(m => Number(m[1]));
    const targetClaims = [...s.matchAll(/\btarget\s+(?:(?:of|was|is|at)\s+)*(\d+(?:\.\d+)?)|\b(\d+(?:\.\d+)?)\s*(?:bar|ml\s*\/\s*s)?\s+target\b/g)].map(m => Number(m[1] ?? m[2]));
    const explicitNumbers = actualClaims.some(n => Math.abs(n - label.actual) <= 0.15) && targetClaims.some(n => Math.abs(n - label.target) <= 0.15);
    const positive = s.replace(/\b(?:not|never|didn't|did not)\s+(?:meet|met|match|matched|reach|reached)\b/g, "");
    if (label.status !== "met" && /\b(?:met|matched|reached)\s+(?:(?:its|the)\s+)?(?:\d+(?:\.\d+)?\s*(?:bar|ml\s*\/\s*s)\s+)?target\b/.test(positive)) return false;
    // Correctly assigned measured/target numbers state the comparison without
    // needing an extra adjective such as "below" or "shortfall".
    if (!verdict.test(s) && !explicitNumbers) return false;
    return (!actualClaims.length || actualClaims.some(n => Math.abs(n - label.actual) <= 0.15)) &&
      (!targetClaims.length || targetClaims.some(n => Math.abs(n - label.target) <= 0.15));
  });
}

function historyCorrect(text: string, label: NonNullable<NonNullable<ReviewCase["expect"]["narrative"]>["history"]>): boolean {
  const s = text.toLowerCase();
  const history = /\b(previous|earlier|prior|last|history|compared|before|from|comparable|same recipe)\b/.test(s);
  if (!history) return false;
  if (label.kind === "confounded") return /\b(dose|yield|profile|temperature|recipe)\b/.test(s) && (/\b(confound\w*|cannot|can't|not comparable|isolate|separate|multiple|unreliable|unsuitable|not a (?:fair|controlled|clean)|not directly)\b/.test(s) || /\bdifferent\b/.test(s) && /\b(nothing supports|no basis|not enough|before (?:adjusting|changing))\b/.test(s));
  if (label.kind === "insufficient") return /\b(missing|unknown|unrecorded|not recorded|no|without|lack\w*|unavailable)\b/.test(s) && /\b(time|timing|duration|grind|recipe|history|compar\w*)\b/.test(s);
  const measured = (label.previousS == null || hasValue(s, label.previousS, 1)) && (label.currentS == null || hasValue(s, label.currentS, 1));
  const namedSettings = label.previousSetting != null && label.currentSetting != null && s.includes(label.previousSetting.toLowerCase()) && s.includes(label.currentSetting.toLowerCase());
  const grind = label.kind === "same_grind" ? /\b(same|unchanged|identical)\b/.test(s) && /\b(grind|setting)\b/.test(s)
    : !label.changedGrind || /\b(grind|setting)\b/.test(s) || namedSettings;
  return measured && grind;
}

function usefulAbstention(text: string, kind: NonNullable<NonNullable<ReviewCase["expect"]["narrative"]>["abstention"]>): boolean {
  const s = text.toLowerCase();
  const reason = kind === "conflict" ? /\b(conflict\w*|oppos\w*|contradic\w*|despite|but|yet|while|different directions|does not fit|doesn't fit|mismatch|disagree)\b/.test(s)
    : kind === "profile" ? /\b(profile|manual|controller|target)\b/.test(s)
      : kind === "telemetry" ? /\b(telemetry|measurements|samples|recording|data|curve)\b/.test(s) : /\b(taste|tasted|flavou?r)\b/.test(s);
  return reason && /\b(taste|repeat|record|check|keep|hold|verify|confirm|try|retest)\b/.test(s);
}

function controlMismatchCheck(text: string, label: NonNullable<NonNullable<ReviewCase["expect"]["narrative"]>["controlMismatch"]>): boolean {
  const s = text.toLowerCase();
  const mismatch = sentences(s).some(part => {
    if (!/\b(flow|yield|weight)\b/.test(part) || !/\b(target|command\w*|request\w*|stop)\b/.test(part)) return false;
    const quotedPair = /\b(against|versus|vs)\b/.test(part) &&
      (hasValue(part, label.actualFlow) && hasValue(part, label.targetFlow) || hasValue(part, label.actualYieldG) && hasValue(part, label.targetYieldG));
    const described = /\b(above|double\w*|twice|exceed\w*|oversho\w*|mismatch|not track\w*|didn't track|failed to track|too high|overran|more than)\b/.test(part) &&
      (hasValue(part, label.actualFlow) || hasValue(part, label.actualYieldG) ||
       /\b(double\w*|twice)\b/.test(part) && hasValue(part, label.targetFlow) && label.actualFlow === 2 * label.targetFlow);
    return quotedPair || described;
  });
  const check = /\b(check|verify|confirm|inspect|review|ensure|make sure)\b[^.!?]*(?:\b(profile|scale|stop\w*|workflow|calibrat\w*)\b|flow[- ]control)/.test(s);
  return mismatch && check;
}

export function gradeReview(c: ReviewCase, out: ShotReviewData, context?: { fellBack?: boolean }): Grade {
  const move = out.nextShot ? primaryMove(out.nextShot) : "none";
  const input = reviewFixture(c.input.fixture);
  const kinds = out.issues.map(i => i.kind);
  const end = input.points.at(-1)?.t ?? 0;
  const hasGrindIssue = c.expect.requiredIssues.some(k => GRIND_ISSUES.includes(k));
  const expectsGrindMove = (hasGrindIssue || c.expect.narrative?.actionEvidence != null) && (move === "finer" || move === "coarser");
  const narrative = c.expect.narrative;
  const explanation = `${out.summary} ${out.nextShot?.reasoning ?? ""}`;
  const reason = out.nextShot?.reasoning ?? "";
  const evidenceExplained = /\b(fast(?:er)?|slow(?:er)?|fell short|below|above|low flow|high flow|sour(?:ness)?|bitter(?:ness)?|tasted|chok\w*|gush\w*)\b/i.test(reason) ||
    /\b(?:flow|pressure)\b.{0,30}\b(?:low|high|short|restricted|restrictive)\b/i.test(reason) ||
    /\d+(?:\.\d+)?\s*(?:s\b|seconds?\b|bar\b|ml\s*\/\s*s)/i.test(reason) && comparison.test(reason.toLowerCase());
  const grindExplained = out.nextShot != null &&
    c.expect.accept.includes(move) &&
    reason.length >= 45 && evidenceExplained &&
    /\b(grind|trial|step|adjustment|setting|finer|coarser)\b/i.test(reason);
  const experimentUseful = /\b(try|trial|repeat|next (?:shot|pour)|retest|one (?:small|step)|small(?:er)? (?:step|adjustment))\b/i.test(reason) &&
    /\b(watch|look for|check|taste|build pressure|slow|speed|open up flow|toward|closer|reach|improv\w*|confirm)\b/i.test(reason);
  const prose = `${out.nextShot?.change ?? ""} ${out.nextShot?.reasoning ?? ""}`.toLowerCase();
  const titleDirections = (out.nextShot?.change.toLowerCase().match(/\b(?:finer|coarser)\b/g) ?? []);
  const commands = sentences(reason).filter(s => !/\b(if|unless|otherwise)\b/.test(s))
    .flatMap(s => [...s.replace(/\b(?:not|avoid|don't|do not)\s+(?:grind(?:ing)?\s+)?(?:finer|coarser)\b/g, "").matchAll(/\b(?:grind|go|move|try|step)\s+(?:(?:one|a|small|single|slight|slightly|much|step|adjustment|bit|little)\s+)*(finer|coarser)\b/g)].map(m => m[1]));
  const opposite = move === "finer" ? "coarser" : move === "coarser" ? "finer" : null;
  const directionConsistent = opposite == null || ![...titleDirections, ...commands].includes(opposite);
  return finalize([
    { name: "modelAnswered", pass: !context?.fellBack, critical: true },
    { name: "acceptableMove", pass: c.expect.accept.includes(move), critical: true, detail: `move ${move}; accept ${c.expect.accept.join(", ")}` },
    { name: "requiredIssues", pass: c.expect.requiredIssues.every(k => kinds.includes(k)), critical: true, detail: `observed ${kinds.join(", ")}` },
    { name: "noFalseAlarms", pass: !c.expect.forbiddenIssues.some(k => kinds.includes(k)) && (!c.expect.noFaults || !out.issues.some(i => i.severity !== "info")), critical: true },
    { name: "oneChange", pass: !out.nextShot || changeCount(out.nextShot) <= 1, critical: true },
    { name: "validSwitch", pass: !out.nextShot?.switchProfile || input.installedProfiles.includes(out.nextShot.switchProfile), critical: true },
    { name: "groundedRanges", pass: out.issues.every(i => (i.fromS == null && i.toS == null) || (i.fromS != null && i.toS != null && i.fromS >= 0 && i.toS >= i.fromS && i.toS <= end)), critical: true },
    ...(c.expect.askTaste === undefined ? [] : [{ name: "askTaste", pass: out.askTaste === c.expect.askTaste, critical: true }]),
    { name: "directionConsistent", pass: directionConsistent, critical: true, detail: prose },
    ...(narrative?.pace ? [{ name: "paceComparison", pass: paceCorrect(out.summary, narrative.pace), critical: true, detail: out.summary }] : []),
    ...(narrative?.target ? [{ name: "targetComparison", pass: targetCorrect(explanation, narrative.target), critical: true, detail: explanation }] : []),
    ...(narrative?.history ? [{ name: "historyComparison", pass: historyCorrect(explanation, narrative.history), critical: true, detail: explanation }] : []),
    ...(narrative?.abstention ? [{ name: "usefulAbstention", pass: usefulAbstention(explanation, narrative.abstention), critical: true, detail: explanation }] : []),
    ...(narrative?.controlMismatch && move === "none" ? [{ name: "controlMismatchCheck", pass: controlMismatchCheck(explanation, narrative.controlMismatch), critical: true, detail: explanation }] : []),
    // Surface wording heuristics as diagnostics. The independent review judge
    // gates semantic usefulness without demanding particular causal connectors.
    ...(expectsGrindMove ? [{ name: "grindDirectionMatchesIssue", pass: grindExplained, detail: out.nextShot?.reasoning ?? "no nextShot" }] : []),
    ...(out.nextShot && changeCount(out.nextShot) > 0 ? [{ name: "usefulExperiment", pass: experimentUseful, detail: reason }] : []),
  ], { move, findings: kinds.join(",") });
}
