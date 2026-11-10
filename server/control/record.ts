/**
 * Writes to records that several devices share (a coffee's `bean:<id>` record, the
 * settings). Decaid's key-value store has no revisions, so a write replaces the whole
 * value and a device that merges into a copy it read earlier undoes what another device
 * wrote in between. The defence is small: re-read right before writing and merge only
 * the fields the call changes. These functions build that patch from the fresh read.
 * Pure.
 */

type Rec = Record<string, unknown>;

/** The patch without its undefined values, so "not changed" never overwrites a field. */
export const definedOnly = (patch: Rec): Rec => Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));

/** The fresh record with only the patch's fields replaced. */
export const mergeRecord = (fresh: Rec | null | undefined, patch: Rec): Rec => ({ ...(fresh ?? {}), ...definedOnly(patch) });


/**
 * What `recommend` changes: the recipe and where it came from. It reads the coffee's
 * info and bag at the start and may take seconds (the AI), so it writes them only when
 * the record had none (info worked out from the Decaid bean is kept the first time) or,
 * for the bag, when the record still names the bag it started from. A value another
 * device wrote meanwhile is never overwritten from this device's older read.
 * `started` is the record as this call first read it.
 */
export function recommendPatch(
  fresh: Rec | null | undefined,
  out: { recipe: unknown; source: unknown; info: unknown; batchId: string | null },
  started?: Rec | null,
): Rec {
  const patch: Rec = { recipe: out.recipe ?? null, recipeSource: out.source ?? null };
  if (!fresh?.info) patch.info = out.info;
  const was = (started?.batchId as string | null | undefined) ?? null;
  const now = (fresh?.batchId as string | null | undefined) ?? null;
  if (now === was && now !== out.batchId) patch.batchId = out.batchId;
  return patch;
}

/**
 * What saving a coffee changes. Another bag of a coffee already known keeps its recipe,
 * reference shot, photos and first-added time from the fresh record; a new coffee starts
 * with none.
 */
export function saveBeanPatch(
  fresh: Rec | null | undefined,
  add: { info: unknown; photo: string | null; productImage: string | null; art: string | null; batchId: string; now: string },
): Rec {
  const f = fresh ?? {};
  const patch: Rec = { info: add.info, finished: false, batchId: add.batchId };
  if (!("recipe" in f)) patch.recipe = null;
  if (!("recipeSource" in f)) patch.recipeSource = null;
  if (!("bestShotId" in f)) patch.bestShotId = null;
  if (!f.addedAt) patch.addedAt = add.now;
  if (add.photo) patch.photo = add.photo; else if (!("photo" in f)) patch.photo = null;
  if (add.productImage) patch.productImage = add.productImage; else if (!("productImage" in f)) patch.productImage = null;
  patch.art = add.art || f.art || (add.productImage ? "product" : "photo");
  return patch;
}
