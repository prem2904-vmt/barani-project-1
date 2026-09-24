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
 * when its methodology changes. Returns the same array when nothing changed.
 */
export function stripRedundantMethodology<T extends { methodology?: string | null }>(
  params: T[],
  testMethodology: string | null | undefined,
): T[] {
  const tm = clean(testMethodology).toLowerCase();
  let changed = false;
  const out = params.map(p => {
    if (!p || typeof p !== 'object' || !('methodology' in p)) return p;
    const own = clean(p.methodology);
    if (own && own.toLowerCase() !== tm) return p;
    changed = true;
    const { methodology: _drop, ...rest } = p;
    void _drop;
    return rest as T;
  });
  return changed ? out : params;
}
