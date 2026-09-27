import { Test } from '../models/test.model';
import { shownDepartmentName } from './package-department';

/**
 * Generate US/UK spelling variants of a search string so the catalogue
 * matches regardless of which spelling the lab catalogue or the user
 * typed. Cheap substring substitution; not a full medical thesaurus.
 */
export function spellingVariants(q: string): string[] {
  const swaps: Array<[string, string]> = [
    ['hema',   'haema'],   // hematology ↔ haematology
    ['pedia',  'paedia'],  // pediatric ↔ paediatric
    ['anesth', 'anaesth'], // anesthesia ↔ anaesthesia
    ['fetal',  'foetal'],  // fetal ↔ foetal
    ['leuk',   'leuc'],    // leukocyte ↔ leucocyte
  ];
  const out = new Set<string>([q]);
  for (const [us, uk] of swaps) {
    if (q.includes(us)) out.add(q.replace(us, uk));
    if (q.includes(uk)) out.add(q.replace(uk, us));
  }
  return Array.from(out);
}

/**
 * Score a test against a search query. 0 = no match; higher = a better match.
 * Ranked tiers (so exact hits always sort above fuzzy near-misses):
 *   100 exact short-name/code · 90 prefix · 70 substring · 55–60 acronym ·
 *   27–35 fuzzy nearest-match.
 * Searches name/testName, code/testCode, shortName, profile, hsnSacCode and
 * department name, with US/UK spelling variants.
 */
export function scoreTestSearch(test: Test | any, query: string, aliases: readonly string[] = []): number {
  if (!query || !query.trim()) return 1;
  const q = query.trim().toLowerCase();
  const variants = spellingVariants(q);

  const name = String(test?.name ?? test?.testName ?? '').toLowerCase();
  const code = String(test?.testCode ?? test?.code ?? '').toLowerCase();
  const short = String(test?.shortName ?? '').toLowerCase();
  // The typed `profile` tag plus the DERIVED aliases: the names / codes /
  // short names of every profile this test belongs to (single source: the
  // profile's own member list, not a tag someone had to remember to type).
  const profile = [test?.profile, ...aliases].filter(Boolean).join(' ').toLowerCase();
  const hsn = String(test?.hsnSacCode ?? '').toLowerCase();
  // A package carries no department (a legacy stored one is never matched).
  const dept = shownDepartmentName(test).toLowerCase();
  const hay = [name, code, short, profile, hsn, dept].join(' ');

  // 1) Exact / prefix / substring — the original behaviour, now ranked.
  for (const v of variants) {
    if (short === v || code === v) return 100;
    if (short.startsWith(v) || code.startsWith(v) || name.startsWith(v)) return 90;
    if (hay.includes(v)) return 70;
  }

  const acronyms = [...acronymsOf(test), ...aliases.map(acronymOf).filter(Boolean)];

  // 2) Acronym: "LFT" → "Liver Function Test", "CBC" → "Complete Blood Count".
  //    The initials never appear contiguously, so the substring pass misses
  //    them. Short, space-free, alphabetic queries only.
  if (/^[a-z]{2,6}$/.test(q)) {
    if (acronyms.some(a => a === q)) return 60;
    if (acronyms.some(a => a.startsWith(q))) return 55;
  }

  // 3) Fuzzy nearest-match — a single short token within a small edit distance
  //    of a code / short name / name word / acronym. Surfaces the closest test
  //    when nothing matched exactly: "nft"→"lft", "cbcc"→"cbc",
  //    "hemoglobn"→"hemoglobin". Tight thresholds so it stays relevant, and it
  //    scores lowest so real matches always rank above it.
  if (/^[a-z0-9]{2,12}$/.test(q)) {
    const maxDist = q.length <= 4 ? 1 : 2;
    const tokens = [short, code, ...name.split(/[^a-z0-9]+/), ...acronyms].filter(Boolean);
    let best = maxDist + 1;
    for (const tok of tokens) {
      const d = boundedLevenshtein(q, tok, maxDist);
      if (d < best) best = d;
      if (best === 1 && maxDist === 1) break;
    }
    if (best <= maxDist) return 35 - (best - 1) * 8; // dist 1 → 35, dist 2 → 27
  }

  return 0;
}

/**
 * Match a test against a search query. See {@link scoreTestSearch} for the
 * fields and matching tiers (exact → prefix → substring → acronym → fuzzy).
 */
export function matchTestSearch(test: Test | any, query: string): boolean {
  return scoreTestSearch(test, query) > 0;
}

function acronymsOf(test: Test | any): string[] {
  return [test?.name, test?.testName, test?.profile, test?.shortName]
    .map(acronymOf)
    .filter(Boolean);
}

/** First letter of each word → lowercase acronym. "Liver function test" → "lft". */
function acronymOf(s?: string | null): string {
  if (!s) return '';
  return s
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .toLowerCase();
}

/** Levenshtein edit distance, early-exiting once it provably exceeds `max`
 *  (returns `max + 1` in that case). Keeps fuzzy search cheap per keystroke. */
function boundedLevenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  let prev = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    const cur = new Array<number>(bl + 1);
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    let rowMin = cur[0];
    for (let j = 1; j <= bl; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[bl] <= max ? prev[bl] : max + 1;
}

/**
 * Filter + rank a list of tests. Non-matches are dropped; the rest are ordered
 * best-match-first (exact/prefix above substring above acronym above fuzzy),
 * ties keeping the original order. Empty query returns the list unchanged.
 */
export function filterTestList<T extends Test | any>(list: T[], query: string, catalogue: readonly (Test | any)[] = list): T[] {
  if (!query || !query.trim()) return list;
  const aliases = profileAliases(catalogue);
  return oneRowPerKey(list)
    .map((t, i) => ({ t, i, s: scoreTestSearch(t, query, aliasesFor(t, aliases)) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(x => x.t);
}

/**
 * Profile aliases DERIVED from membership (Test Master single source: the
 * typed `tests.Profile` tag is not the source). For every profile in the
 * catalogue, each member (by `testId`, or by `catalogKey` for bundles
 * stamped with it) gets the profile's name, code and short name — so SGOT
 * is found by "liver" and "LFT" even when nobody typed a tag on it.
 * Keys are member test ids and `key:<catalogKey>` (lower-case).
 */
export function profileAliases(catalogue: readonly (Test | any)[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const p of catalogue) {
    if (p?.type !== 'profile' || !p?.parameters) continue;
    let items: unknown[] = [];
    try {
      const blob = JSON.parse(p.parameters);
      items = Array.isArray(blob?.items) ? blob.items : [];
    } catch { continue; }
    const labels = [p.name, p.testCode, p.shortName].map(x => String(x ?? '').trim()).filter(Boolean);
    if (!labels.length) continue;
    for (const it of items) {
      const o = (typeof it === 'string' ? { testId: it } : (it ?? {})) as { testId?: string; catalogKey?: string };
      const keys = [o.testId, o.catalogKey ? `key:${o.catalogKey.toLowerCase()}` : ''].filter(Boolean) as string[];
      for (const k of keys) {
        const arr = out.get(k) ?? [];
        for (const l of labels) if (!arr.includes(l)) arr.push(l);
        out.set(k, arr);
      }
    }
  }
  return out;
}

function aliasesFor(t: Test | any, aliases: Map<string, string[]>): string[] {
  if (!aliases.size) return [];
  const byId = t?.id ? aliases.get(t.id) ?? [] : [];
  const key = String(t?.catalogKey ?? '').trim().toLowerCase();
  const byKey = key ? aliases.get(`key:${key}`) ?? [] : [];
  return byKey.length ? [...new Set([...byId, ...byKey])] : byId;
}

/** Copy-on-write lists carry ONE row per catalogue key; should a list ever
 *  hold the master row next to this lab's own copy, the copy wins (branch →
 *  lab copy → own → master) so search never shows the same test twice.
 *  Rows without an origin (older payloads) are never merged. */
const ORIGIN_RANK: Record<string, number> = { branch: 4, customised: 3, local: 2, master: 1 };
function oneRowPerKey<T extends Test | any>(list: T[]): T[] {
  const best = new Map<string, T>();
  for (const t of list) {
    const key = String((t as any)?.catalogKey ?? '').trim().toLowerCase();
    const rank = ORIGIN_RANK[String((t as any)?.origin ?? '')] ?? 0;
    if (!key || !rank) continue;
    const cur = best.get(key);
    if (!cur || rank > (ORIGIN_RANK[String((cur as any).origin)] ?? 0)) best.set(key, t);
  }
  if (!best.size) return list;
  return list.filter(t => {
    const key = String((t as any)?.catalogKey ?? '').trim().toLowerCase();
    const rank = ORIGIN_RANK[String((t as any)?.origin ?? '')] ?? 0;
    return !key || !rank || best.get(key) === t;
  });
}

/**
 * STRICT ranked search — the order screen's search dropdown (owner: the
 * fuzzy / acronym tiers of {@link scoreTestSearch} made "ja" return 190
 * rows). Case-insensitive substring on code, name, short name and profile
 * label (the typed `profile` tag + membership-derived aliases); no fuzzy,
 * no subsequence, no acronym. A 1-character query only matches prefixes.
 * Rank: exact code › exact short name › code prefix › short-name prefix ›
 * name word-prefix › profile-label word-prefix › name substring ›
 * code / short / profile substring. Ties keep catalogue order.
 */
export function scoreTestSearchStrict(test: Test | any, query: string, aliases: readonly string[] = []): number {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return 1;
  const name = String(test?.name ?? test?.testName ?? '').toLowerCase();
  const code = String(test?.testCode ?? test?.code ?? '').toLowerCase();
  const short = String(test?.shortName ?? '').toLowerCase();
  const labels = [test?.profile, ...aliases].filter(Boolean).map(x => String(x).toLowerCase());
  const words = (s: string) => s.split(/[^a-z0-9]+/).filter(Boolean);
  const wordPrefix = (s: string, v: string) =>
    s.startsWith(v) || words(s).some(w => w.startsWith(v)) || (v.includes(' ') && s.includes(' ' + v));
  const prefixOnly = q.length < 2;
  let best = 0;
  for (const v of spellingVariants(q)) {
    let sc = 0;
    if (code && code === v) sc = 100;
    else if (short && short === v) sc = 95;
    else if (code.startsWith(v)) sc = 90;
    else if (short.startsWith(v)) sc = 80;
    else if (wordPrefix(name, v)) sc = 70;
    else if (labels.some(l => wordPrefix(l, v))) sc = 60;
    else if (!prefixOnly && name.includes(v)) sc = 50;
    else if (!prefixOnly && (code.includes(v) || short.includes(v) || labels.some(l => l.includes(v)))) sc = 40;
    if (sc > best) best = sc;
  }
  return best;
}

/** Filter + rank with {@link scoreTestSearchStrict}. Empty query → list. */
export function filterTestListStrict<T extends Test | any>(list: T[], query: string, catalogue: readonly (Test | any)[] = list): T[] {
  if (!query || !query.trim()) return list;
  const aliases = profileAliases(catalogue);
  // Relevance first, then A→Z by name (QA #4b), then catalogue order.
  const nameOf = (t: any) => String(t?.name ?? '').trim();
  return oneRowPerKey(list)
    .map((t, i) => ({ t, i, s: scoreTestSearchStrict(t, query, aliasesFor(t, aliases)) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s
      || nameOf(a.t).localeCompare(nameOf(b.t), undefined, { sensitivity: 'base', numeric: true })
      || a.i - b.i)
    .map(x => x.t);
}
