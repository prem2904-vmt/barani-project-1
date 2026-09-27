/**
 * Order & Payments catalogue ordering + Repeat mapping — pure helpers, kept
 * out of the (large) component so they are unit-testable on their own.
 *
 *  - Lists (All tests, Profiles, Packages, Favourites, department groups) read
 *    A→Z by name (QA #4b). Recent keeps most-recent-first; search keeps
 *    relevance first (test-search.ts breaks ties by name).
 *  - Recent merges the items ordered on this screen with the server list.
 *  - Repeat maps the server's resolved items onto the orderable catalogue.
 */

/** Display name used for sorting (case-/accent-insensitive, numeric-aware). */
function sortName(t: { name?: string | null }): string {
  return (t.name ?? '').trim();
}

/** A→Z by name; ties fall back to the test code so the order is stable. */
export function byName<T extends { name?: string | null; testCode?: string | null; code?: string | null }>(a: T, b: T): number {
  return sortName(a).localeCompare(sortName(b), undefined, { sensitivity: 'base', numeric: true })
    || (a.testCode ?? a.code ?? '').localeCompare(b.testCode ?? b.code ?? '', undefined, { numeric: true });
}

/** A sorted copy (never mutates the input — it is usually signal state). */
export function sortByName<T extends { name?: string | null; testCode?: string | null; code?: string | null }>(list: readonly T[]): T[] {
  return list.slice().sort(byName);
}

/** `first` ahead of `rest`, de-duplicated, order kept (most recent first). */
export function mergeRecent(first: readonly string[], rest: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...first, ...rest]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** One line of GET /api/orders/{id}/repeat-items: what the source order
 *  carried at the TOP level (the test, profile or package that was picked —
 *  never a bundle's members), resolved server-side to the tenant's CURRENT
 *  effective row (`id`; a reference-mode master id follows a later tenant
 *  override). `id` is null when the item no longer exists / is disabled. */
export interface RepeatItem {
  orderedId: string;
  id: string | null;
  name: string;
  type?: string | null;
}

export interface RepeatPlan {
  /** Cart ids, in the source order's order. */
  ids: string[];
  /** Names of items that can't be re-ordered any more. */
  unavailable: string[];
}

/** Map resolved repeat items onto the orderable catalogue. An item carries
 *  over only when its effective id is orderable here now (active + offered);
 *  otherwise its name is reported. Duplicates collapse. */
export function planRepeat(items: readonly RepeatItem[], orderable: readonly { id: string }[]): RepeatPlan {
  const have = new Set(orderable.map(t => t.id));
  const ids: string[] = [];
  const unavailable: string[] = [];
  for (const it of items) {
    const id = it.id && have.has(it.id) ? it.id : have.has(it.orderedId) ? it.orderedId : null;
    if (id) { if (!ids.includes(id)) ids.push(id); }
    else if (!unavailable.includes(it.name)) unavailable.push(it.name);
  }
  return { ids, unavailable };
}
