/**
 * Methodology — HYBRID (owner rule, Test Master single source 2026-09-24).
 *
 * The test-level `Methodology` column is the default for every value of the
 * test; a per-value `methodology` on a parameter overrides it for that value
 * only. Effective = value.methodology ?? test.methodology — the bench and the
 * report read through this one resolver. A per-value copy that merely repeats
 * the test-level one is redundant and is stripped when the test is saved.
 */

type WithMethodology = { methodology?: string | null } | null | undefined;

const clean = (m: string | null | undefined): string => String(m ?? '').trim();

/** The methodology that applies to one value: its own, else the test's. '' when neither. */
export function effectiveMethodology(value: WithMethodology, test: WithMethodology): string {
  return clean(value?.methodology) || clean(test?.methodology);
}

/**
 * Drop per-value methodology entries equal (case-insensitive, trimmed) to the
 * test-level one — they add nothing and would silently stop following the test
 * when its methodology changes. `previousTestMethodology` (the test-level value
 * before this edit) marks copies that were FOLLOWING the test: when the test's
 * methodology changes, they go too — left behind they would become per-value
 * overrides and the report would keep printing the old method (RCA
 * 2026-09-28, Calcium "Colorimetric" → "Modified Arsenazo III").
 * Returns the same array when nothing changed.
 */
export function stripRedundantMethodology<T extends { methodology?: string | null }>(
  params: T[],
  testMethodology: string | null | undefined,
  previousTestMethodology?: string | null,
): T[] {
  const followed = new Set([clean(testMethodology).toLowerCase(), clean(previousTestMethodology).toLowerCase()]);
  let changed = false;
  const out = params.map(p => {
    if (!p || typeof p !== 'object' || !('methodology' in p)) return p;
    const own = clean(p.methodology);
    if (own && !followed.has(own.toLowerCase())) return p;
    changed = true;
    const { methodology: _drop, ...rest } = p;
    void _drop;
    return rest as T;
  });
  return changed ? out : params;
}

/** The methodology a lab picks to say a value is computed by a formula
 *  (LDL, INR, A/G ratio, eGFR…). Opt-in per test — never auto-filled; the
 *  report prints it wherever methodology prints and adds no marker itself. */
export const CALCULATED_METHODOLOGY = 'Calculated';

/** Common methods offered in Test Master's Methodology picker. */
export const STANDARD_METHODOLOGIES: readonly string[] = [
  CALCULATED_METHODOLOGY,
  'Photometry', 'Colorimetry', 'Enzymatic', 'Hexokinase', 'GOD-POD',
  'Immunoturbidimetry', 'Nephelometry', 'ISE (Indirect)', 'ISE (Direct)',
  'CLIA', 'ECLIA', 'ELISA', 'Immunochromatography', 'Agglutination',
  'HPLC', 'Electrophoresis', 'Impedance', 'Flow cytometry',
  'Microscopy', 'Westergren', 'Coagulometry', 'PCR', 'RT-PCR', 'Culture',
];

/**
 * Picker list for the Methodology field: the current value first when it is
 * not already offered (a hand-entered or legacy method survives untouched),
 * then the standard methods, then the tenant's own methods from its
 * catalogue — de-duplicated case-insensitively, first spelling wins.
 */
export function methodologyChoices(
  current: string | null | undefined,
  tenantMethods: Iterable<string | null | undefined> = [],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (m: string | null | undefined) => {
    const v = clean(m);
    if (!v || seen.has(v.toLowerCase())) return;
    seen.add(v.toLowerCase());
    out.push(v);
  };
  const cur = clean(current);
  const offered = [...STANDARD_METHODOLOGIES, ...tenantMethods];
  if (cur && !offered.some(m => clean(m).toLowerCase() === cur.toLowerCase())) add(cur);
  STANDARD_METHODOLOGIES.forEach(add);
  const extra = [...tenantMethods].map(clean).filter(Boolean).sort((a, b) => a.localeCompare(b));
  extra.forEach(add);
  return out;
}
