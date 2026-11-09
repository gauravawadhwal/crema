import type { ShotReviewData } from "../../server/recommend/review-types.js";
import type { ReviewCase } from "./dataset.js";
import { changeCount, finalize, primaryMove, type Grade } from "./graders.js";
import { reviewFixture } from "./review-fixtures.js";

export function gradeReview(c: ReviewCase, out: ShotReviewData, context?: { fellBack?: boolean }): Grade {
  const move = out.nextShot ? primaryMove(out.nextShot) : "none";
  const input = reviewFixture(c.input.fixture);
  const kinds = out.issues.map(i => i.kind);
  const end = input.points.at(-1)?.t ?? 0;
  return finalize([
    { name: "modelAnswered", pass: !context?.fellBack, critical: true },
    { name: "acceptableMove", pass: c.expect.accept.includes(move), critical: true, detail: `move ${move}; accept ${c.expect.accept.join(", ")}` },
    { name: "requiredIssues", pass: c.expect.requiredIssues.every(k => kinds.includes(k)), critical: true, detail: `observed ${kinds.join(", ")}` },
    { name: "noFalseAlarms", pass: !c.expect.forbiddenIssues.some(k => kinds.includes(k)) && (!c.expect.noFaults || !out.issues.some(i => i.severity !== "info")), critical: true },
    { name: "oneChange", pass: !out.nextShot || changeCount(out.nextShot) <= 1, critical: true },
    { name: "validSwitch", pass: !out.nextShot?.switchProfile || input.installedProfiles.includes(out.nextShot.switchProfile), critical: true },
    { name: "groundedRanges", pass: out.issues.every(i => (i.fromS == null && i.toS == null) || (i.fromS != null && i.toS != null && i.fromS >= 0 && i.toS >= i.fromS && i.toS <= end)), critical: true },
    ...(c.expect.askTaste === undefined ? [] : [{ name: "askTaste", pass: out.askTaste === c.expect.askTaste, critical: true }]),
  ], { move, findings: kinds.join(",") });
}
