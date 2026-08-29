import { Test } from '../models/test.model';

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
export function scoreTestSearch(test: Test | any, query: string): number {
  if (!query || !query.trim()) return 1;
  const q = query.trim().toLowerCase();
  const variants = spellingVariants(q);

  const name = String(test?.name ?? test?.testName ?? '').toLowerCase();
  const code = String(test?.testCode ?? test?.code ?? '').toLowerCase();
  const short = String(test?.shortName ?? '').toLowerCase();
  const profile = String(test?.profile ?? '').toLowerCase();
  const hsn = String(test?.hsnSacCode ?? '').toLowerCase();
  const dept = String(test?.department?.name ?? '').toLowerCase();
  const hay = [name, code, short, profile, hsn, dept].join(' ');

  // 1) Exact / prefix / substring — the original behaviour, now ranked.
  for (const v of variants) {
    if (short === v || code === v) return 100;
    if (short.startsWith(v) || code.startsWith(v) || name.startsWith(v)) return 90;
    if (hay.includes(v)) return 70;
  }

  const acronyms = acronymsOf(test);

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
export function filterTestList<T extends Test | any>(list: T[], query: string): T[] {
  if (!query || !query.trim()) return list;
  return list
    .map((t, i) => ({ t, i, s: scoreTestSearch(t, query) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(x => x.t);
}
