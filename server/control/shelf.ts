/**
 * Which shelf rows are new and still waiting for their recipe. A coffee added on
 * another device appears on the shelf first and gets its recipe (a kv-only write the
 * cheap poll can't see) some seconds later, so while one is waiting the poll reads the
 * shelf in full. Only rows that appeared recently count; a row with no recipe for any
 * other reason (a cleared recipe) must not keep every poll full. Pure.
 */

export const NEW_ROW_WINDOW_MS = 120_000;

export interface ShelfRowLite { key: string; recipe?: unknown | null }

/** key -> when the row was first seen. */
export type NewRows = Map<string, number>;

/**
 * Update the new rows after a shelf read. `previous` is the keys of the shelf before
 * the read (null before the first read: nothing is new then). Rows that now have a
 * recipe, are gone, or are older than the window drop out.
 */
export function trackNewRows(tracked: NewRows, previous: string[] | null, rows: ShelfRowLite[], now: number, windowMs = NEW_ROW_WINDOW_MS): NewRows {
  const known = new Set(previous ?? rows.map((r) => r.key));
  const next: NewRows = new Map();
  for (const r of rows) {
    if (r.recipe) continue;
    const since = tracked.get(r.key) ?? (known.has(r.key) ? null : now);
    if (since != null && now - since < windowMs) next.set(r.key, since);
  }
  return next;
}

/** Drop rows that have aged out, without a read. */
export const pruneNewRows = (tracked: NewRows, now: number, windowMs = NEW_ROW_WINDOW_MS): NewRows =>
  new Map([...tracked].filter(([, since]) => now - since < windowMs));

/** Is this row new and still waiting for its recipe? */
export const waitingForRecipe = (tracked: NewRows, key: string, now: number, windowMs = NEW_ROW_WINDOW_MS): boolean => {
  const since = tracked.get(key);
  return since != null && now - since < windowMs;
};
