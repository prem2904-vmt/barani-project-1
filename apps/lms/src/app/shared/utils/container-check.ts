/**
 * Test Master missing-container flag (owner 2026-10-03): a test with no
 * usable container is an ERROR to fix in the data, never something the tube
 * grouping guesses from a sibling or the profile. The server owns the rule
 * (`GET /api/tests/missing-container` → `ContainerCheck`); this file only
 * turns its rows into the grid's Container-cell flag.
 */

/** One row of `GET /api/tests/missing-container`. */
export interface MissingContainerRow {
  id: string;
  testCode?: string | null;
  name: string;
  sampleType?: string | null;
  tubeColor?: string | null;
  problem: 'blank' | 'unknown' | string;
}

export interface MissingContainerResponse {
  count: number;
  tests: MissingContainerRow[];
}

export const MISSING_CONTAINER_URL = '/api/tests/missing-container';

/** id → problem, for the grid. */
export function missingContainerIndex(r: MissingContainerResponse | null | undefined): Map<string, string> {
  return new Map((r?.tests ?? []).map(t => [t.id, t.problem]));
}

/** The Container cell's flag for a test, or null when it has a container. */
export function containerFlag(problem: string | undefined | null, specimen?: string | null): { label: string; title: string } | null {
  if (!problem) return null;
  const spec = (specimen ?? '').trim();
  const then = `Orders draw it into a separate sterile pot${spec ? ` of ${spec}` : ''} — set the container here.`;
  return problem === 'unknown'
    ? { label: 'Unknown container', title: `This container is not one the lab knows. ${then}` }
    : { label: 'No container set', title: `No container is set for this test. ${then}` };
}
