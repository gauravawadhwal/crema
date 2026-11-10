import { describe, expect, it } from "vitest";
import {
  adoptPatch, afterStartSent, bagRemaining, gramsUsed, isStarting, loadDecision, near, reconcileOutcome, recipeMatches, sameGrind,
  shotAcrossOnLoss, shotRunning, snapshotDecision, socketFrame, socketLost, startGate, startSettled, startSteps,
  type MachineRecipe, type NextRecipe, type SocketTrack,
} from "../server/control/index.js";

const next = (over: Partial<NextRecipe> = {}): NextRecipe => ({ profileTitle: "Londinium", profileId: "p1", profileShape: "shape-a", manual: null, doseG: 18, yieldG: 36, tempC: 93, grind: "21", targetTimeS: [25, 32], ...over });
const machine = (over: Partial<MachineRecipe> = {}): MachineRecipe => ({ profileTitle: "Londinium", profileShape: "shape-a", manual: null, doseG: 18, yieldG: 36, tempC: 93, grind: "21", batchId: "b1", coffeeName: "Ona", coffeeRoaster: "Ona", ...over });

describe("recipe comparison", () => {
  it("treats values within 0.05 as the same and a missing side as a difference only when the other has a value", () => {
    expect(near(18, 18.04)).toBe(true);
    expect(near(18, 18.06)).toBe(false);
    expect(near("18", 18)).toBe(true);
    expect(near(null, null)).toBe(true);
    expect(near(undefined, null)).toBe(true);
    expect(near(null, 0)).toBe(false);
  });
  it("compares grind as a note: an empty side never differs, numbers compare as numbers", () => {
    expect(sameGrind("", "21")).toBe(true);
    expect(sameGrind(null, "21")).toBe(true);
    expect(sameGrind("21", "21.00")).toBe(true);
    expect(sameGrind("21", "22")).toBe(false);
    expect(sameGrind(" 3.5 ", "3.50")).toBe(true);
    expect(sameGrind("fine", "Fine")).toBe(false);
  });
  it("matches on title, shape, dose, yield, temperature and grind", () => {
    expect(recipeMatches(machine(), next())).toBe(true);
    expect(recipeMatches(machine({ profileTitle: "Turbo" }), next())).toBe(false);
    expect(recipeMatches(machine({ profileShape: "shape-b" }), next())).toBe(false);
    expect(recipeMatches(machine({ profileShape: "shape-b" }), next({ profileShape: null }))).toBe(true);
    expect(recipeMatches(machine({ doseG: 19 }), next())).toBe(false);
    expect(recipeMatches(machine({ yieldG: 40 }), next())).toBe(false);
    expect(recipeMatches(machine({ tempC: 92 }), next())).toBe(false);
    expect(recipeMatches(machine({ grind: "" }), next())).toBe(true);
    expect(recipeMatches(null, next())).toBe(false);
    expect(recipeMatches(machine(), null)).toBe(false);
  });
});

describe("reconcileOutcome", () => {
  const base = { next: next(), noBag: false, currentBatch: "b1", loaded: true, adopt: true, boot: false };
  it("same: the machine has the recipe; marks it loaded only if it wasn't", () => {
    expect(reconcileOutcome({ ...base, machine: machine() })).toEqual({ kind: "same", markLoaded: false });
    expect(reconcileOutcome({ ...base, machine: machine(), loaded: false })).toEqual({ kind: "same", markLoaded: true });
  });
  it("a machine recipe with no bag recorded still matches a bagged coffee when the numbers agree", () => {
    expect(reconcileOutcome({ ...base, machine: machine({ batchId: null }) }).kind).toBe("same");
  });
  it("another bag's recipe is another coffee's, whatever its numbers", () => {
    expect(reconcileOutcome({ ...base, machine: machine({ batchId: "b2" }), loaded: false, boot: true })).toEqual({ kind: "other" });
  });
  it("no bag: any recorded coffee on the machine makes it another coffee's", () => {
    const nb = { ...base, noBag: true, currentBatch: undefined };
    expect(reconcileOutcome({ ...nb, machine: machine({ batchId: null, coffeeName: null, coffeeRoaster: null }) }).kind).toBe("same");
    expect(reconcileOutcome({ ...nb, machine: machine({ batchId: null, coffeeName: "Ona", coffeeRoaster: null }), loaded: false, boot: true }).kind).toBe("other");
    expect(reconcileOutcome({ ...nb, machine: machine({ batchId: "b9", coffeeName: null, coffeeRoaster: null }), loaded: false, boot: true }).kind).toBe("other");
  });
  it("differs when adopt is off (before a start), whatever the panel", () => {
    expect(reconcileOutcome({ ...base, machine: machine({ doseG: 20 }), adopt: false })).toEqual({ kind: "differs" });
    expect(reconcileOutcome({ ...base, machine: machine({ doseG: 20 }), adopt: false, boot: true, loaded: false })).toEqual({ kind: "differs" });
  });
  it("differs when the panel had unsaved edits (not loaded, not boot)", () => {
    expect(reconcileOutcome({ ...base, machine: machine({ doseG: 20 }), loaded: false })).toEqual({ kind: "differs" });
  });
  it("on boot the panel has no unsaved edits, so an outside change to this bag is adopted", () => {
    expect(reconcileOutcome({ ...base, machine: machine({ doseG: 20 }), loaded: false, boot: true })).toEqual({ kind: "adopt", lookupProfile: false });
  });
  it("adopts when the panel matched the machine and the machine's change is recorded for this bag", () => {
    expect(reconcileOutcome({ ...base, machine: machine({ doseG: 20 }) })).toEqual({ kind: "adopt", lookupProfile: false });
  });
  it("asks for a library lookup when the profile shape changed", () => {
    expect(reconcileOutcome({ ...base, machine: machine({ profileShape: "shape-b", profileTitle: "Turbo" }) })).toEqual({ kind: "adopt", lookupProfile: true });
  });
  it("other: this bag's recipe was never recorded (Streamline's or Decaid's defaults)", () => {
    expect(reconcileOutcome({ ...base, machine: machine({ batchId: null, doseG: 20 }) })).toEqual({ kind: "other" });
  });
  it("other: nothing to take when the machine has no profile title", () => {
    expect(reconcileOutcome({ ...base, machine: machine({ profileTitle: null }) })).toEqual({ kind: "other" });
  });
  it("no bag: adopts a bagless recipe of the same shape, otherwise leaves it", () => {
    const nb = { ...base, noBag: true, currentBatch: undefined };
    const bagless = { batchId: null, coffeeName: null, coffeeRoaster: null };
    expect(reconcileOutcome({ ...nb, machine: machine({ ...bagless, doseG: 20 }) })).toEqual({ kind: "adopt", lookupProfile: false });
    expect(reconcileOutcome({ ...nb, machine: machine({ ...bagless, profileShape: "shape-b", profileTitle: "Turbo" }) }).kind).toBe("other");
  });
});

describe("adoptPatch", () => {
  it("copies the machine's values, falling back to the panel's for missing numbers", () => {
    const patch = adoptPatch(machine({ doseG: null, yieldG: 40, grind: "" }), next(), "p2", "Londinium");
    expect(patch).toMatchObject({ fromMachine: true, profileTitle: "Londinium", profileId: "p2", doseG: 18, yieldG: 40, tempC: 93, grind: "21" });
    expect("targetTimeS" in patch).toBe(false);
  });
  it("clears the recommendation's time window when the profile isn't the saved recipe's", () => {
    expect(adoptPatch(machine({ profileTitle: "Turbo" }), next(), "p3", "Londinium").targetTimeS).toBeNull();
    expect(adoptPatch(machine({ profileTitle: "Turbo" }), next(), "p3", undefined).targetTimeS).toBeNull();
  });
});

describe("shotRunning and loadDecision", () => {
  it("runs while espresso, or while a drop in mid-shot hasn't been resolved", () => {
    expect(shotRunning("espresso", false)).toBe(true);
    expect(shotRunning(undefined, true)).toBe(true);
    expect(shotRunning("idle", false)).toBe(false);
    expect(shotRunning(undefined, false)).toBe(false);
    expect(shotRunning("steam", false)).toBe(false);
  });
  it("holds during a shot, ahead of everything else", () => {
    expect(loadDecision({ shotRunning: true, queued: true, loaded: true })).toBe("hold");
    expect(loadDecision({ shotRunning: true, queued: false, loaded: false })).toBe("hold");
  });
  it("skips a queued load when the one ahead left the recipe on the machine", () => {
    expect(loadDecision({ shotRunning: false, queued: true, loaded: true })).toBe("skip");
  });
  it("sends otherwise", () => {
    expect(loadDecision({ shotRunning: false, queued: true, loaded: false })).toBe("send");
    expect(loadDecision({ shotRunning: false, queued: false, loaded: true })).toBe("send");
    expect(loadDecision({ shotRunning: false, queued: false, loaded: false })).toBe("send");
  });
});

describe("snapshotDecision", () => {
  const snap = (prevState: string | undefined, state: string | undefined, over: Partial<Parameters<typeof snapshotDecision>[0]> = {}) =>
    snapshotDecision({ prevState, state, shotAcross: false, heldLoad: false, startingKind: null, ...over });

  it("a quiet repeat changes nothing", () => {
    expect(snap("idle", "idle")).toEqual({ changed: false, resumed: false, endedAway: false, clearStarting: false, shotStart: false, sendHeldLoad: false });
    expect(snap("espresso", "espresso", { heldLoad: true })).toMatchObject({ changed: false, shotStart: false, sendHeldLoad: false });
  });
  it("a shot starting from idle is a shot start", () => {
    expect(snap("idle", "espresso")).toMatchObject({ changed: true, shotStart: true, resumed: false, sendHeldLoad: false });
  });
  it("the first reading ever being espresso is a shot start", () => {
    expect(snap(undefined, "espresso")).toMatchObject({ changed: true, shotStart: true });
  });
  it("a shot ending sends a held load, and only a held one", () => {
    expect(snap("espresso", "idle", { heldLoad: true })).toMatchObject({ changed: true, sendHeldLoad: true });
    expect(snap("espresso", "idle", { heldLoad: false })).toMatchObject({ sendHeldLoad: false });
    expect(snap("espresso", "heating", { heldLoad: true })).toMatchObject({ sendHeldLoad: true });
  });
  it("a held load waits while the machine is anything but ending a shot", () => {
    expect(snap("idle", "heating", { heldLoad: true }).sendHeldLoad).toBe(false);
    expect(snap("steam", "idle", { heldLoad: true }).sendHeldLoad).toBe(false);
  });
  it("a drop mid-shot, then still pouring: the same shot resumes and is not a new start", () => {
    expect(snap(undefined, "espresso", { shotAcross: true, heldLoad: true })).toEqual({ changed: true, resumed: true, endedAway: false, clearStarting: false, shotStart: false, sendHeldLoad: false });
  });
  it("a drop mid-shot, then the shot is over: ends away and sends the held load", () => {
    expect(snap(undefined, "idle", { shotAcross: true, heldLoad: true })).toEqual({ changed: true, resumed: false, endedAway: true, clearStarting: false, shotStart: false, sendHeldLoad: true });
    expect(snap(undefined, "idle", { shotAcross: true, heldLoad: false }).sendHeldLoad).toBe(false);
  });
  it("a drop mid-shot where the machine comes back asleep or steaming still counts as over", () => {
    expect(snap(undefined, "sleeping", { shotAcross: true, heldLoad: true })).toMatchObject({ endedAway: true, sendHeldLoad: true });
    expect(snap(undefined, "steam", { shotAcross: true, heldLoad: true })).toMatchObject({ endedAway: true, sendHeldLoad: true });
  });
  it("a drop that never returns: no reading, so nothing is decided and the load stays held", () => {
    // shotRunning stays true for as long as shotAcross is set, so loads keep being held.
    expect(shotRunning(undefined, shotAcrossOnLoss("espresso", false))).toBe(true);
    expect(shotRunning(undefined, shotAcrossOnLoss(undefined, true))).toBe(true);
  });
  it("a drop outside a shot does not mark a shot across", () => {
    expect(shotAcrossOnLoss("idle", false)).toBe(false);
    expect(shotAcrossOnLoss(undefined, false)).toBe(false);
  });
  it("a start that the machine picks up clears the starting marker", () => {
    expect(snap("idle", "espresso", { startingKind: "espresso" }).clearStarting).toBe(true);
    expect(snap("idle", "steam", { startingKind: "espresso" }).clearStarting).toBe(false);
    expect(snap("espresso", "espresso", { startingKind: "espresso" }).clearStarting).toBe(false);
    expect(snap("idle", "steam", { startingKind: "steam" }).shotStart).toBe(false);
  });
  it("a shot that ends and another that starts in the same frame pair are separate decisions", () => {
    expect(snap("espresso", "idle", { heldLoad: true }).shotStart).toBe(false);
    expect(snap("idle", "espresso", { heldLoad: true }).sendHeldLoad).toBe(false);
  });
});

describe("the machine socket's tracking", () => {
  const frames = (states: (string | undefined | "LOST")[], start: SocketTrack = { prev: null, across: false }) => {
    let track = start;
    return states.map((st) => {
      if (st === "LOST") { track = socketLost(track); return "lost"; }
      const f = socketFrame(track, st);
      track = f.track;
      return f.finished ? "finished" : "-";
    });
  };
  it("flags the first non-espresso frame after espresso as finished, once", () => {
    expect(frames(["idle", "espresso", "espresso", "idle", "idle"])).toEqual(["-", "-", "-", "finished", "-"]);
  });
  it("a drop mid-shot followed by an ended shot is finished on the first frame back", () => {
    expect(frames(["espresso", "LOST", "idle"])).toEqual(["-", "lost", "finished"]);
  });
  it("a drop mid-shot followed by still pouring is not finished, and ends normally later", () => {
    expect(frames(["espresso", "LOST", "espresso", "idle"])).toEqual(["-", "lost", "-", "finished"]);
  });
  it("two drops in a row keep the shot across", () => {
    expect(frames(["espresso", "LOST", "LOST", "idle"])).toEqual(["-", "lost", "lost", "finished"]);
  });
  it("a drop outside a shot is not a finished shot", () => {
    expect(frames(["idle", "LOST", "idle"])).toEqual(["-", "lost", "-"]);
  });
  it("a drop that never returns finishes nothing", () => {
    expect(frames(["espresso", "LOST"])).toEqual(["-", "lost"]);
    expect(socketLost({ prev: "espresso", across: false })).toEqual({ prev: null, across: true });
  });
  it("frames with no state after a drop mid-shot count as the shot being over", () => {
    expect(frames(["espresso", "LOST", undefined])).toEqual(["-", "lost", "finished"]);
  });
});

describe("starting an operation", () => {
  const gate = (over: Partial<Parameters<typeof startGate>[0]> = {}) => startGate({ starting: null, now: 1000, unlinked: false, state: "idle", ...over });
  it("goes ahead from idle, heating and preheating", () => {
    expect(gate()).toBeNull();
    expect(gate({ state: "heating" })).toBeNull();
    expect(gate({ state: undefined })).toBeNull();
  });
  it("ignores a second tap while a start is under way, and lets it through once the window has passed", () => {
    expect(gate({ starting: { kind: "espresso", until: Infinity } })).toEqual({ refuse: "starting" });
    expect(gate({ starting: { kind: "espresso", until: 2000 } })).toEqual({ refuse: "starting" });
    expect(gate({ starting: { kind: "espresso", until: 1000 } })).toBeNull();
    expect(isStarting({ kind: "espresso", until: 1001 }, 1000)).toBe(true);
    expect(isStarting(null, 1000)).toBe(false);
  });
  it("refuses an unlinked machine before looking at its state", () => {
    expect(gate({ unlinked: true, state: "espresso" })).toEqual({ refuse: "unlinked" });
    expect(gate({ starting: { kind: "x", until: Infinity }, unlinked: true })).toEqual({ refuse: "starting" });
  });
  it("refuses while an operation runs, and in states that need attention", () => {
    for (const state of ["espresso", "steam", "hotWater", "flush"]) expect(gate({ state })).toEqual({ refuse: "running" });
    for (const state of ["sleeping", "needsWater", "error", "booting", "steamRinse", "cleaning", "descaling", "transportMode", "fwUpgrade"]) expect(gate({ state })).toEqual({ refuse: "notReady", state });
  });
  it("plans the steps: espresso reconciles when loaded and loads when not; the others push their preset", () => {
    expect(startSteps("espresso", true)).toEqual({ reconcileFirst: true, loadFirst: false, presets: null });
    expect(startSteps("espresso", false)).toEqual({ reconcileFirst: false, loadFirst: true, presets: null });
    expect(startSteps("steam", false)).toEqual({ reconcileFirst: false, loadFirst: false, presets: "steam" });
    expect(startSteps("hotWater", true).presets).toBe("water");
    expect(startSteps("flush", true).presets).toBe("flush");
  });
  it("stops again when Stop was pressed while the start was on its way", () => {
    expect(afterStartSent(true)).toBe("heartbeat");
    expect(afterStartSent(false)).toBe("stopAgain");
  });
  it("only the current generation settles the starting marker", () => {
    expect(startSettled({ stillCurrent: false, sent: true, kind: "espresso", now: 5 })).toEqual({ update: false });
    expect(startSettled({ stillCurrent: true, sent: true, kind: "espresso", now: 5 })).toEqual({ update: true, starting: { kind: "espresso", until: 3005 }, redrawLater: true });
    expect(startSettled({ stillCurrent: true, sent: false, kind: "espresso", now: 5 })).toEqual({ update: true, starting: null, redrawLater: false });
  });
  it("a stop during a pending write, then a double tap: sequenced by generation", () => {
    // Mirrors startOp's use: each start takes a generation; Stop bumps it.
    let opGen = 0;
    const log: string[] = [];
    const start = (kind: string) => {
      const gen = ++opGen, current = () => gen === opGen;
      return {
        sent: () => log.push(afterStartSent(current()) === "stopAgain" ? `${kind}:stop-again` : `${kind}:ok`),
        settle: (sent: boolean) => startSettled({ stillCurrent: current(), sent, kind, now: 0 }),
      };
    };
    const a = start("espresso");
    opGen++; // Stop pressed while the write is pending
    a.sent();
    expect(a.settle(true)).toEqual({ update: false });
    const b = start("espresso");
    b.sent();
    expect(b.settle(true)).toMatchObject({ update: true });
    expect(log).toEqual(["espresso:stop-again", "espresso:ok"]);
  });
});

describe("bag weight", () => {
  const dose = (n: number | null, target: number | null = null) => ({ annotations: { actualDoseWeight: n }, workflow: { context: { targetDoseWeight: target } } });
  it("sums the recorded dose, else the target dose, else nothing", () => {
    expect(gramsUsed([dose(18), dose(null, 17), dose(null, null), {}])).toBe(35);
    expect(gramsUsed([])).toBe(0);
    expect(gramsUsed(null)).toBeNull();
  });
  it("remaining is weight less used plus the correction, rounded and never negative", () => {
    expect(bagRemaining({ used: 90, weight: 250, weightRemaining: 160, state: {} })).toEqual({ adjust: 0, remaining: 160, corrected: false });
    expect(bagRemaining({ used: 90.4, weight: 250, weightRemaining: null, state: { adjust: 5 } }).remaining).toBe(165);
    expect(bagRemaining({ used: 300, weight: 250, weightRemaining: null, state: {} }).remaining).toBe(0);
  });
  it("takes a change made elsewhere as the new correction", () => {
    // Crema wrote 160; someone set 200 in Decaid: 200 = 250 - 90 + adjust.
    expect(bagRemaining({ used: 90, weight: 250, weightRemaining: 200, state: { adjust: 0, written: 160 } })).toEqual({ adjust: 40, remaining: 200, corrected: true });
  });
  it("ignores a change of half a gram or less", () => {
    expect(bagRemaining({ used: 90, weight: 250, weightRemaining: 160.5, state: { adjust: 0, written: 160 } }).corrected).toBe(false);
    expect(bagRemaining({ used: 90, weight: 250, weightRemaining: 160.6, state: { adjust: 0, written: 160 } }).corrected).toBe(true);
  });
  it("does not correct before Crema has written anything, or without the numbers", () => {
    expect(bagRemaining({ used: 90, weight: 250, weightRemaining: 200, state: {} }).corrected).toBe(false);
    expect(bagRemaining({ used: null, weight: 250, weightRemaining: 200, state: { written: 100 } }).corrected).toBe(false);
    expect(bagRemaining({ used: 90, weight: null, weightRemaining: 200, state: { written: 100 } }).corrected).toBe(false);
    expect(bagRemaining({ used: 90, weight: 250, weightRemaining: null, state: { written: 100 } }).corrected).toBe(false);
  });
  it("falls back to Decaid's figure with no weight, and to nothing when the shots couldn't be read", () => {
    expect(bagRemaining({ used: 90, weight: null, weightRemaining: 120, state: {} }).remaining).toBe(120);
    expect(bagRemaining({ used: 90, weight: null, weightRemaining: undefined, state: {} }).remaining).toBeNull();
    expect(bagRemaining({ used: null, weight: 250, weightRemaining: 120, state: {} }).remaining).toBeNull();
  });

  it("every reader computes the same remaining from the same stored state, so a correction needn't be written to be shown", () => {
    const input = { used: 90, weight: 250, weightRemaining: 200, state: { adjust: 0, written: 160 } };
    const a = bagRemaining(input), b = bagRemaining({ ...input, state: { ...input.state } });
    expect(a).toEqual(b);
    // Once the correction is stored (adjust 40, written 200), a reader gets the same figure without needing to correct.
    expect(bagRemaining({ ...input, state: { adjust: a.adjust, written: 200 } })).toEqual({ adjust: 40, remaining: a.remaining, corrected: false });
  });
});
