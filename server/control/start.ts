/**
 * Decisions for starting and stopping an operation. Pure: the generation counter,
 * timers, toasts and requests stay in skin/app.js; this says what to do given the
 * state. Moved out unchanged.
 */

/** `S.starting`: what Crema is starting, and until when it blocks a second start. */
export interface Starting { kind: string; until: number }

export const isStarting = (starting: Starting | null | undefined, now: number): boolean => !!starting && now < starting.until;

/** Operations in progress; nothing new starts until one is stopped. */
export const RUNNING_STATES = ["espresso", "steam", "hotWater", "flush"];
/**
 * Machine states (Decaid's names) in which nothing new should start. Stop is never
 * blocked. Heating and preheating are left alone: the DE1 handles a start while warming.
 */
export const NOT_READY = ["sleeping", "needsWater", "error", "booting", "steamRinse", "cleaning", "descaling", "transportMode", "fwUpgrade"];

export type StartRefusal =
  /** Already starting: ignore silently. */
  | { refuse: "starting" }
  | { refuse: "unlinked" }
  | { refuse: "running" }
  | { refuse: "notReady"; state: string };

/** Whether a start may go ahead, checked in this order. `null` means go. */
export function startGate(i: { starting: Starting | null | undefined; now: number; unlinked: boolean; state: string | null | undefined }): StartRefusal | null {
  if (isStarting(i.starting, i.now)) return { refuse: "starting" };
  if (i.unlinked) return { refuse: "unlinked" };
  if (i.state && RUNNING_STATES.includes(i.state)) return { refuse: "running" };
  if (i.state && NOT_READY.includes(i.state)) return { refuse: "notReady", state: i.state };
  return null;
}

/** What a start does before sending the command. */
export function startSteps(kind: string, loaded: boolean): { reconcileFirst: boolean; loadFirst: boolean; presets: "steam" | "water" | "flush" | null } {
  return {
    reconcileFirst: kind === "espresso" && loaded,
    // Only meaningful after the reconcile, which can clear `loaded`: ask again then.
    loadFirst: kind === "espresso" && !loaded,
    presets: kind === "steam" ? "steam" : kind === "hotWater" ? "water" : kind === "flush" ? "flush" : null,
  };
}

/**
 * Once the start command has landed: if Stop was pressed while it was on its way
 * (the generation moved on), the two requests can reach the machine in either
 * order, so stop again now.
 */
export const afterStartSent = (stillCurrent: boolean): "stopAgain" | "heartbeat" => (stillCurrent ? "heartbeat" : "stopAgain");

/**
 * What `S.starting` becomes when a start attempt finishes. Only the current
 * generation settles it. A sent command keeps blocking a second start for 3 s,
 * until the machine reports the start; a failed or abandoned one clears at once.
 */
export function startSettled(i: { stillCurrent: boolean; sent: boolean; kind: string; now: number }): { update: false } | { update: true; starting: Starting | null; redrawLater: boolean } {
  if (!i.stillCurrent) return { update: false };
  return i.sent ? { update: true, starting: { kind: i.kind, until: i.now + 3000 }, redrawLater: true } : { update: true, starting: null, redrawLater: false };
}
