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
 * Match a test against a search query using order page's exact search logic.
 * Searches across:
 * - name / testName
 * - code / testCode
 * - shortName
 * - profile
 * - hsnSacCode
 * - department name
 * Supports US/UK spelling variations.
 */
export function matchTestSearch(test: Test | any, query: string): boolean {
  if (!query || !query.trim()) return true;
  const q = query.trim().toLowerCase();
  const variants = spellingVariants(q);

  const hay = [
    test?.name ?? '',
    test?.testName ?? '',
    test?.code ?? '',
    test?.testCode ?? '',
    test?.shortName ?? '',
    test?.profile ?? '',
    test?.hsnSacCode ?? '',
    test?.department?.name ?? ''
  ].join(' ').toLowerCase();

  return variants.some(v => hay.includes(v));
}

/**
 * Filter an array of tests using the standard test search logic.
 */
export function filterTestList<T extends Test | any>(list: T[], query: string): T[] {
  if (!query || !query.trim()) return list;
  return list.filter(t => matchTestSearch(t, query));
}
