import type { CoachReview, ReviewInput } from "../../server/recommend/review-types.js";
import type { ReviewLabels } from "./review-labels.js";

export type Verdict = CoachReview["stages"][number]["verdict"];
type Hypothesis = Pick<CoachReview["hypotheses"][number], "id" | "signature">;
type Stage = { name: string; frames: readonly number[]; allowed: readonly Verdict[] };
type Abstention = { frame: number; reason: "weight" | "early-stop"; visible?: true };
type Leniency = { frame: number; kind: "start-up" | "bloom" | "exit-trigger" };
export interface CoachExpectation {
  stages: readonly Stage[];
  hypotheses: readonly Hypothesis[];
  abstentions: readonly Abstention[];
  leniency?: readonly Leniency[];
}

const tracked = ["on_plan"] as const;
const departure = ["partly", "off_plan"] as const;
const filling = ["not_graded", "partly", "on_plan"] as const;
const paused = ["on_plan", "partly", "not_graded"] as const;
const missed = ["not_graded"] as const;
const start = (frames: number[], allowed: readonly Verdict[] = filling): Stage => ({ name: "Start-up", frames, allowed });
const main = (frames: number[], allowed: readonly Verdict[] = tracked): Stage => ({ name: "Main pour", frames, allowed });
const finish = (frames: number[], allowed: readonly Verdict[] = tracked): Stage => ({ name: "Finish", frames, allowed });
const bloom = (frame: number, allowed: readonly Verdict[] = paused): Stage => ({ name: "Bloom", frames: [frame], allowed });
const easy = { id: "easy-flow", signature: "sour_thin" } as const;
const restricted = { id: "restricted-flow", signature: "bitter_heavy" } as const;
const expected = (stages: Stage[], hypotheses: Hypothesis[] = [], abstentions: Abstention[] = []): CoachExpectation =>
  ({ stages, hypotheses, abstentions });
const standard = expected([start([0]), main([1])]);
const capped = expected([start([0]), main([1], departure)], [restricted]);
const easyFlow = expected([start([0]), main([1])], [easy]);
const adaptive = expected([start([0, 1]), main([2, 3])]);
const adaptiveWeight = expected([start([0, 1]), main([2, 3])], [], [{ frame: 3, reason: "weight" }]);
const plannedDecline = expected([start([0]), main([1]), finish([2])]);

// Hidden expectations transcribed from the injection, recorded plan and
// required/forbidden labels. Frame numbers refer to the plan, never to the
// detector output. Preserve this table across seeds of the same scenario.
// A scale-only intervention leaves the commanded hydraulic comparison alone.
const seeded: Readonly<Record<string, CoachExpectation>> = {
  "adaptive-flow-handoff-hidden-flow-cap": expected([start([0, 1]), main([2, 3], departure)]),
  "adaptive-flow-handoff-nominal": adaptive,
  "adaptive-flow-handoff-recorded-limiter": expected([start([0, 1]), main([2, 3], departure)], [restricted]),
  "adaptive-weight-handoff-nominal": adaptiveWeight,
  "adaptive-weight-handoff-pressure-lag": adaptiveWeight,
  "adaptive-weight-handoff-scale-loss": adaptiveWeight,
  "allonge-capped": capped,
  "allonge-tracked": easyFlow,
  "bloom-trickle-early-onset": expected([start([0]), bloom(1), main([2, 3])]),
  "bloom-trickle-low-resistance": expected([start([0]), bloom(1), main([2, 3])]),
  "bloom-trickle-nominal": expected([start([0]), bloom(1), main([2, 3])]),
  "bloom-zero-nominal": expected([start([0]), bloom(1), main([2, 3, 4])]),
  "bloom-zero-restart-restriction": expected([start([0]), bloom(1), main([2, 3, 4], departure)], [restricted]),
  "bloom-zero-scale-loss": expected([start([0]), bloom(1), main([2, 3, 4])]),
  "fixed-flow-1p35-nominal": standard,
  "fixed-flow-1p5-nominal": standard,
  "fixed-flow-abrupt-pressure-drop": standard,
  "fixed-flow-capped": capped,
  // This slow hold tracks at lower pressure but lacks the fast cup fill
  // used to support a taste-linked easy-flow hypothesis.
  "fixed-flow-low-pressure": standard,
  "fixed-flow-scale-loss": standard,
  "flat-pressure-fast-fill-low-resistance": standard,
  "flat-pressure-fast-fill-nominal": standard,
  "flat-pressure-fast-fill-restriction": expected([start([0]), main([1])], [restricted]),
  "flat-pressure-gentler-fill-hidden-flow-cap": expected([start([0]), main([1], departure)]),
  "flat-pressure-gentler-fill-nominal": standard,
  "flat-pressure-gentler-fill-scale-outage": standard,
  "flow-limiter-capped": capped,
  "flow-limiter-early-weight-stop": expected([start([0]), main([1, 2])], [easy], [{ frame: 2, reason: "weight" }]),
  "flow-limiter-masked-restriction": capped,
  "flow-limiter-restriction": expected([start([0]), main([1, 2], departure)], [restricted]),
  "flow-limiter-soft-cap": capped,
  "flow-limiter-tracked": expected([start([0]), main([1, 2])], [easy]),
  "lever-commanded-decline": plannedDecline,
  "lever-reed-flat": expected([start([0]), main([1, 2])]),
  "lever-reed-load-change": plannedDecline,
  "lever-reed-scheduled": plannedDecline,
  "lever-willow-scale-gap": expected([start([0]), main([1]), finish([2, 3])]),
  "lever-willow-tracked": expected([start([0]), main([1]), finish([2, 3])]),
  "lever-willow-weight-stop": expected([start([0]), main([1]), finish([2, 3], missed)], [],
    [{ frame: 2, reason: "weight", visible: true }, { frame: 3, reason: "weight", visible: true }]),
  "turbo-flat-hidden-cap": expected([start([0]), main([1], departure)]),
  "turbo-flat-nominal": standard,
  "turbo-flat-restriction": standard,
  "turbo-taper-early-stop": plannedDecline,
  "turbo-taper-nominal": plannedDecline,
  "turbo-taper-scale-dropout": plannedDecline,
};

const independent: Readonly<Record<string, CoachExpectation>> = {
  a1: easyFlow,
  a2: capped,
  b1: expected([start([0]), main([1]), finish([2, 3])]),
  b2: expected([start([0]), main([1, 2, 3], departure)]),
  c1: expected([start([0], paused), main([1, 2])]),
  c2: expected([start([0], paused), main([1, 2])], [], [{ frame: 2, reason: "early-stop" }]),
  d1: standard,
  d2: standard,
  e1: expected([start([0]), bloom(1, tracked), main([2])]),
  e2: expected([start([0]), bloom(1, tracked), main([2])]),
  f1: expected([start([0]), main([1, 2])]),
  f2: expected([start([0]), main([1]), finish([2], missed)], [], [{ frame: 2, reason: "weight", visible: true }]),
};

export function coachExpectation(id: string, labels?: ReviewLabels, plan?: ReviewInput["profile"]): CoachExpectation | undefined {
  if (labels?.source !== "synthetic-injected") return;
  const seed = /^(.*)\.s\d+$/.exec(id);
  const table = seed ? seeded : independent;
  const key = seed?.[1] ?? id;
  if (!Object.hasOwn(table, key)) return;
  const expectation = table[key];
  const leniency = expectation.stages.flatMap(({ name, frames }) => frames.flatMap<Leniency>(frame => [
    ...(name === "Start-up" && frame === 0 ? [{ frame, kind: "start-up" as const }] : []),
    ...(name === "Bloom" ? [{ frame, kind: "bloom" as const }] : []),
    ...(plan?.steps?.[frame]?.exit?.type ? [{ frame, kind: "exit-trigger" as const }] : []),
  ]));
  return { ...expectation, leniency };
}
