import type { Test } from '../models/test.model';
import type { MappingPrefill } from '../assistant/assistant.models';
import { CodeMapRow, emptyCodeMapRow } from './instrument-config';

/**
 * "Add to mapping" (the assistant's mapping card) → the instrument editor's
 * EXISTING Code mapping rows, prefilled. Pure; the editor marks the rows
 * dirty and the person presses Save — nothing is ever saved for them.
 *
 *   - the test is resolved against the Test Master list the editor already
 *     loaded (by id, then by test code) — an individual test with a
 *     catalogue key; not found ⇒ the row keeps the code + unit and the
 *     person picks the test;
 *   - a row with the same analyzer code and NO test yet is filled in;
 *   - the same code already mapped to the same test ⇒ nothing changes;
 *   - otherwise a new row is added (one code may feed several tests — the
 *     editor's shared-code hint says so).
 */
export type PrefillOutcome = 'added' | 'filled' | 'exists';

export interface PrefillResult {
  rows: CodeMapRow[];
  /** Index of the row the prefill landed on (to point the person at it). */
  index: number;
  outcome: PrefillOutcome;
  /** False when the suggested test isn't in this lab's Test Master list. */
  testFound: boolean;
}

export function resolvePrefillTest(tests: readonly Test[], p: MappingPrefill): Test | null {
  const usable = (t: Test) => t.type === 'individual' && !!t.catalogKey;
  const id = (p.testId ?? '').trim();
  if (id) {
    const byId = tests.find((t) => t.id === id && usable(t));
    if (byId) return byId;
  }
  const code = (p.testCode ?? '').trim().toUpperCase();
  if (code) {
    const byCode = tests.find((t) => usable(t) && [t.testCode, t.code].some((c) => (c ?? '').trim().toUpperCase() === code));
    if (byCode) return byCode;
  }
  return null;
}

/** True when a hand-off carries enough to prefill a row. */
export function isMappingPrefill(v: unknown): v is MappingPrefill {
  return !!v && typeof v === 'object' && typeof (v as MappingPrefill).analyzerCode === 'string'
    && !!(v as MappingPrefill).analyzerCode.trim();
}

export function applyMappingPrefill(rows: readonly CodeMapRow[], p: MappingPrefill, tests: readonly Test[]): PrefillResult {
  const code = p.analyzerCode.trim().slice(0, 40);
  const t = resolvePrefillTest(tests, p);
  const key = t?.catalogKey ?? '';
  const unit = (p.unit ?? '').trim() || t?.derivedUnit || t?.unit || '';
  const same = (r: CodeMapRow) => r.analyzerCode.trim().toUpperCase() === code.toUpperCase();

  if (key) {
    const already = rows.findIndex((r) => same(r) && r.testCatalogKey === key);
    if (already >= 0) return { rows: [...rows], index: already, outcome: 'exists', testFound: true };
  }
  const blank = rows.findIndex((r) => same(r) && !r.testCatalogKey);
  if (blank >= 0) {
    if (!key) return { rows: [...rows], index: blank, outcome: 'exists', testFound: false };
    const next = rows.map((r, i) => (i === blank
      ? { ...r, testCatalogKey: key, testName: t?.name ?? p.testName ?? null, unit: r.unit || unit, loincMatched: false, loincCandidates: undefined }
      : r));
    return { rows: next, index: blank, outcome: 'filled', testFound: true };
  }
  if (!key) {
    const unkeyed = rows.findIndex((r) => same(r));
    if (unkeyed >= 0) return { rows: [...rows], index: unkeyed, outcome: 'exists', testFound: false };
  }
  const row: CodeMapRow = { ...emptyCodeMapRow(code), unit, testCatalogKey: key, testName: t?.name ?? (key ? p.testName ?? null : null) };
  return { rows: [...rows, row], index: rows.length, outcome: 'added', testFound: !!key };
}
