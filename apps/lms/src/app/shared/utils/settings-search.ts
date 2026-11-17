/**
 * Precise settings search — the ONE matcher every settings search uses
 * (/admin overview, /admin/manage, the Lab and Partners hubs).
 *
 * It matches a setting's TITLE and its KEYWORDS only — never a description or
 * subtitle — and only on whole words or word prefixes, never a substring in the
 * middle of a word ("ample" does not find "Sample"). Ranked, best first:
 *
 *   0  the title IS the query                     "lab settings"  → Lab settings
 *   1  the title starts with the query + a word   "sample id"     → Sample ID format
 *   2  the title starts with the query            "sample id"     → Sample identification
 *   3  every query word is a whole title word     "label code"    → Specimen label code
 *   4  every query word starts a title word       "bran"          → Branches
 *   5  a keyword IS the query                     "barcode"       → Specimen label code
 *   6  a keyword starts with the query            "invoice num"   → Billing Config
 *   7  every query word starts a title/keyword word
 *
 * Ties keep the shorter title first, then the caller's order.
 */

/** Lower-case, "&" → "and", punctuation → space, collapsed. */
export function normSettingsText(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/&amp;/g, ' and ')
    .replace(/&/g, ' and ')
    .replace(/[“”"'’()·—–,.:;!?/\\[\]{}|+*]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordsOf(s: string): string[] {
  return s ? s.split(' ').filter(Boolean) : [];
}

/** Rank of `title`/`keywords` for `query` (lower is better), or null = no match. */
export function settingsRank(query: string | null | undefined, title: string, keywords: readonly string[] = []): number | null {
  const q = normSettingsText(query);
  if (!q) return null;
  const qw = wordsOf(q);
  const t = normSettingsText(title);
  const tw = wordsOf(t);

  if (t === q) return 0;
  if (t.startsWith(q + ' ')) return 1;
  if (t.startsWith(q)) return 2;
  if (qw.every((w) => tw.includes(w))) return 3;
  if (qw.every((w) => tw.some((x) => x.startsWith(w)))) return 4;

  const kws = keywords.map(normSettingsText).filter(Boolean);
  if (kws.some((k) => k === q)) return 5;
  if (kws.some((k) => k.startsWith(q))) return 6;
  const all = [...tw, ...kws.flatMap(wordsOf)];
  if (qw.every((w) => all.some((x) => x.startsWith(w)))) return 7;
  return null;
}

/** Filter + rank `items` for `query`. Empty query → []. */
export function searchSettings<T>(
  items: readonly T[],
  query: string | null | undefined,
  title: (item: T) => string,
  keywords: (item: T) => readonly string[] = () => [],
): T[] {
  if (!normSettingsText(query)) return [];
  const hits: Array<{ item: T; rank: number; len: number; i: number }> = [];
  items.forEach((item, i) => {
    const rank = settingsRank(query, title(item), keywords(item));
    if (rank !== null) hits.push({ item, rank, len: normSettingsText(title(item)).length, i });
  });
  hits.sort((a, b) => a.rank - b.rank || a.len - b.len || a.i - b.i);
  return hits.map((h) => h.item);
}

/** A hub's own tile filter: empty query → every tile (in order), else the ranked matches. */
export function filterSettingsTiles<T>(
  items: readonly T[],
  query: string | null | undefined,
  title: (item: T) => string,
  keywords: (item: T) => readonly string[] = () => [],
): T[] {
  return normSettingsText(query) ? searchSettings(items, query, title, keywords) : items.slice();
}
