/**
 * Decisions around a running shot: whether one is under way, whether a recipe load
 * is sent or held, and what a machine snapshot means given the one before it.
 * Pure, moved out of skin/app.js unchanged so every case can be tested.
 */

/**
 * A shot is running while the machine says espresso, and also while the machine
 * socket is down after it dropped mid-shot: the DE1 keeps pouring, so the profile
 * must not be written until a snapshot shows the shot is over.
 */
export const shotRunning = (state: string | null | undefined, shotAcross: boolean): boolean => state === "espresso" || shotAcross;

/**
 * What a load does when its turn comes.
 *  - "hold": a shot is running; the load waits and is sent when the shot ends.
 *  - "skip": queued behind another load that already left the recipe on the machine.
 *  - "send": write the recipe now.
 */
export function loadDecision(i: { shotRunning: boolean; queued: boolean; loaded: boolean }): "hold" | "skip" | "send" {
  if (i.shotRunning) return "hold";
  if (i.queued && i.loaded) return "skip";
  return "send";
}

/** The machine socket's own tracking: the last state, and a shot that was running when it dropped. */
export interface SocketTrack { prev: string | null | undefined; across: boolean }

/**
 * A frame arrived on the machine socket. The first one that isn't espresso after a
 * shot (or after a drop in mid-shot) is the end of that shot, so the app is told
 * `finished`.
 */
export function socketFrame(t: SocketTrack, state: string | null | undefined): { track: SocketTrack; finished: boolean } {
  return { finished: (t.prev === "espresso" || t.across) && state !== "espresso", track: { prev: state, across: false } };
}

/** The machine socket closed: remember that a shot may end while it is down. */
export function socketLost(t: SocketTrack): SocketTrack {
  return { prev: null, across: t.across || t.prev === "espresso" };
}

/** The app dropped its last reading (the stream was lost): carry a running shot across. */
export const shotAcrossOnLoss = (lastState: string | null | undefined, shotAcross: boolean): boolean => shotAcross || lastState === "espresso";

export interface SnapshotInput {
  /** The state of the previous reading (undefined after the stream was lost). */
  prevState: string | null | undefined;
  /** The state in this reading. */
  state: string | null | undefined;
  /** A shot was running when the stream dropped (`S.shotAcross`). */
  shotAcross: boolean;
  /** A load is waiting for the shot to end (`S.heldLoad`). */
  heldLoad: boolean;
  /** The operation Crema is starting, if any (`S.starting?.kind`). */
  startingKind: string | null | undefined;
}

export interface SnapshotDecision {
  /** The state differs from the previous reading. */
  changed: boolean;
  /** First reading after a drop in mid-shot, and still pouring: the same shot goes on. */
  resumed: boolean;
  /** First reading after a drop in mid-shot, and it is over. */
  endedAway: boolean;
  /** The machine has picked up the start Crema sent. */
  clearStarting: boolean;
  /** A new shot began (not the resumption of one). */
  shotStart: boolean;
  /** A shot just ended with a load held: send it. */
  sendHeldLoad: boolean;
}

export function snapshotDecision(i: SnapshotInput): SnapshotDecision {
  const changed = i.state !== i.prevState;
  const resumed = i.shotAcross && i.state === "espresso";
  const endedAway = i.shotAcross && i.state !== "espresso";
  return {
    changed, resumed, endedAway,
    clearStarting: changed && i.startingKind === i.state,
    shotStart: changed && i.state === "espresso" && !resumed,
    sendHeldLoad: (i.prevState === "espresso" || endedAway) && i.state !== "espresso" && i.heldLoad,
  };
}
