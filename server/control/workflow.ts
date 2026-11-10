/**
 * Decisions about the machine's recipe versus the one on the screen. Pure: the
 * app reads the machine and its own state, asks here what that means, then acts
 * (toasts, redraws, writes). Moved out of skin/app.js unchanged so the rules can
 * be tested without a DOM.
 */

/** The recipe read back from Decaid's workflow (`api.machine.recipe()`). */
export interface MachineRecipe {
  profileTitle?: string | null;
  profileShape?: string | null;
  manual?: string | null;
  doseG?: number | null;
  yieldG?: number | null;
  tempC?: number | null;
  grind?: string | null;
  batchId?: string | null;
  coffeeName?: string | null;
  coffeeRoaster?: string | null;
}

/** The next-shot panel's recipe (`S.next`). */
export interface NextRecipe {
  profileTitle?: string | null;
  profileId?: string | null;
  profileShape?: string | null;
  manual?: string | null;
  doseG?: number | null;
  yieldG?: number | null;
  tempC?: number | null;
  grind?: string | null;
  targetTimeS?: unknown;
}

export const near = (a: unknown, b: unknown): boolean =>
  a == null || b == null ? a == b : Math.abs(Number(a) - Number(b)) < 0.05;

/**
 * Grind is only a note on the recipe (it never reaches the machine), so a side
 * that has none doesn't count as a difference. Writers format numbers differently
 * ("21", "21.00"), so numbers compare as numbers.
 */
export const sameGrind = (a: unknown, b: unknown): boolean => {
  const x = String(a ?? "").trim(), y = String(b ?? "").trim();
  return x === "" || y === "" || x === y || (Number.isFinite(Number(x)) && Number(x) === Number(y));
};

export const recipeMatches = (m: MachineRecipe | null | undefined, n: NextRecipe | null | undefined): boolean =>
  !!(m && n) && m.profileTitle === n.profileTitle && (!n.profileShape || m.profileShape === n.profileShape)
  && near(m.doseG, n.doseG) && near(m.yieldG, n.yieldG) && near(m.tempC, n.tempC) && sameGrind(m.grind, n.grind);

export interface ReconcileInput {
  /** What the machine has. */
  machine: MachineRecipe;
  /** The panel's recipe. */
  next: NextRecipe;
  /** Brewing without a bag. */
  noBag: boolean;
  /** The batch id of the selected bag, if any. */
  currentBatch: string | null | undefined;
  /** The panel's recipe is believed to be on the machine (`S.loaded`). */
  loaded: boolean;
  /** False before a start: never take the machine's values. */
  adopt: boolean;
  /** First read after the page opened. */
  boot: boolean;
}

export type ReconcileOutcome =
  /** The recipe is on the machine; mark it loaded if it wasn't. */
  | { kind: "same"; markLoaded: boolean }
  /** It differs and the panel is kept (unsaved edits, or `adopt` is off); not loaded. */
  | { kind: "differs" }
  /** The machine has another coffee's, or an unrecorded, recipe; keep ours, not loaded. */
  | { kind: "other" }
  /** The machine's recipe is this bag's and the panel matched it before: take its values. `lookupProfile` says the profile id must be looked up in the library. */
  | { kind: "adopt"; lookupProfile: boolean };

export function reconcileOutcome(i: ReconcileInput): ReconcileOutcome {
  const m = i.machine;
  // A recipe recorded against another bag is another coffee's, whatever its numbers.
  const otherCoffee = i.noBag ? !!(m.batchId || m.coffeeName || m.coffeeRoaster) : !!m.batchId && m.batchId !== i.currentBatch;
  if (!otherCoffee && recipeMatches(m, i.next)) return { kind: "same", markLoaded: !i.loaded };
  const unsaved = !i.loaded && !i.boot;
  if (!i.adopt || unsaved) return { kind: "differs" };
  const forThisBag = i.noBag ? !otherCoffee && m.profileShape === i.next.profileShape : !!m.batchId && m.batchId === i.currentBatch;
  if (!forThisBag || !m.profileTitle) return { kind: "other" };
  return { kind: "adopt", lookupProfile: m.profileShape !== i.next.profileShape };
}

/**
 * The fields to copy onto the panel's recipe when adopting the machine's. The
 * recommendation's time window no longer applies when the profile differs from
 * the one the coffee's saved recipe names (`targetTimeS` is then cleared).
 */
export function adoptPatch(m: MachineRecipe, next: NextRecipe, profileId: string | null | undefined, savedRecipeTitle: string | null | undefined): Record<string, unknown> {
  return {
    ...(m.profileTitle !== savedRecipeTitle ? { targetTimeS: null } : {}),
    fromMachine: true,
    profileTitle: m.profileTitle,
    profileId, profileShape: m.profileShape, manual: m.manual,
    doseG: m.doseG ?? next.doseG, yieldG: m.yieldG ?? next.yieldG, tempC: m.tempC ?? next.tempC,
    grind: m.grind || next.grind,
  };
}
