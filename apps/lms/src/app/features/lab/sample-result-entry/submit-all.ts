import type { OrderTest } from '../../../shared/models/order.model';
import type { TestParameter, TestParametersBlob } from '../../../shared/models/test.model';
import { readParameters } from '../../../shared/utils/test-parameters';
import { resolveParamEntryKind } from '../../../shared/utils/param-entry-kind';

/**
 * "Submit all" across the tube tabs of one order (owner 2026-09-27): the
 * pure rules, kept out of the component so they are testable on their own.
 *
 *   - a tab's WRITABLE tests are the ones this screen can still submit
 *     (not entered / validated / rejected, not a culture — cultures live on
 *     the Culture bench);
 *   - every field of every writable test filled → Submit all goes straight
 *     through; any EMPTY field → one confirmation listing them, grouped by
 *     tab and test ("26124 · Bacterial PCR Detection — Sample Adequacy,
 *     Molecular QC"); confirming submits every tab as-is;
 *   - a tab is "complete" (✓) when none of its writable fields is empty,
 *     "draft" (dot) when it holds some value (typed or a saved draft).
 *
 * A checkbox never counts as empty: unticked is an answer.
 */

/** Values per order-test id → parameter name → value. */
export type ValuesMap = Record<string, Record<string, unknown>>;

/** One tube tab as Submit all sees it. */
export interface TabSnapshot {
  sampleId: string;
  barcode: string;
  /** In-house tests of the tube (outsourced lines already split off). */
  tests: OrderTest[];
  values: ValuesMap;
}

/** A writable test with one or more empty fields. */
export interface MissingEntry {
  sampleId: string;
  barcode: string;
  testId: string;
  testName: string;
  /** Empty fields in entry order (name = the value key, title = its label). */
  fields: Array<{ name: string; title: string }>;
}

/** Generic single "Result" field for a non-culture test without a schema
 *  (mirrors the entry screen, so such a test is still enterable). */
const DEFAULT_PARAM: TestParameter = { id: 'result', name: 'result', title: 'Result', type: 'text' };

function blobOf(t: OrderTest): TestParametersBlob | null {
  const raw = t.test?.parameters;
  if (!raw) return null;
  try { return JSON.parse(raw) as TestParametersBlob; } catch { return null; }
}

export function isCultureTest(t: OrderTest): boolean {
  return blobOf(t)?.microFormat === 'culture_sensitivity';
}

/** The entry fields of a test, exactly as the entry screen renders them. */
export function paramsOfTest(t: OrderTest): TestParameter[] {
  const blob = blobOf(t);
  const params = blob ? readParameters(blob) : [];
  if (params.length === 0 && blob?.microFormat !== 'culture_sensitivity') return [DEFAULT_PARAM];
  return params;
}

/** Can this screen still submit the test? */
export function isWritableTest(t: OrderTest): boolean {
  return t.status !== 'entered' && t.status !== 'validated' && t.status !== 'rejected' && !isCultureTest(t);
}

/** A real entered value: non-blank text / number, or a ticked box. An
 *  unticked box is indistinguishable from an untouched one, so it does not
 *  count. */
export function isFilled(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'boolean') return v;
  return String(v).trim() !== '';
}

export function testHasValue(values: ValuesMap, testId: string): boolean {
  return Object.values(values[testId] ?? {}).some(isFilled);
}

/** Fields that can be empty (a checkbox always holds an answer). */
function emptyableParams(t: OrderTest): TestParameter[] {
  return paramsOfTest(t).filter((p) => resolveParamEntryKind(p) !== 'checkbox');
}

/** Every writable test with an empty field, tab by tab in tab order. */
export function missingEntries(tabs: readonly TabSnapshot[]): MissingEntry[] {
  const out: MissingEntry[] = [];
  for (const tab of tabs) {
    for (const t of tab.tests) {
      if (!isWritableTest(t)) continue;
      const fields = emptyableParams(t)
        .filter((p) => !isFilled(tab.values[t.id]?.[p.name]))
        .map((p) => ({ name: p.name, title: p.title || p.name }));
      if (!fields.length) continue;
      out.push({
        sampleId: tab.sampleId, barcode: tab.barcode, testId: t.id,
        testName: t.test?.name || t.name || 'Test', fields,
      });
    }
  }
  return out;
}

/** "26124 · Bacterial PCR Detection — Sample Adequacy, Molecular QC". A
 *  single-field test whose field is just "Result" names the test alone. */
export function missingLine(m: MissingEntry): string {
  const names = m.fields.map((f) => f.title);
  const onlyResult = names.length === 1 && names[0].toLowerCase() === 'result';
  return `${m.barcode || 'Tube'} · ${m.testName}${onlyResult ? '' : ' — ' + names.join(', ')}`;
}

/** The tab indicator: complete (✓) / draft (dot) / nothing. */
export function tabMark(tab: TabSnapshot): 'complete' | 'draft' | null {
  const writable = tab.tests.filter(isWritableTest);
  if (!writable.length) return null;
  const complete = writable.every((t) =>
    emptyableParams(t).every((p) => isFilled(tab.values[t.id]?.[p.name])) &&
    (emptyableParams(t).length > 0 || testHasValue(tab.values, t.id)));
  if (complete) return 'complete';
  return writable.some((t) => testHasValue(tab.values, t.id)) ? 'draft' : null;
}

/** Numeric fields holding something that is not a number (blocks submit,
 *  exactly as the per-tab submit does). */
export function invalidNumbers(tab: TabSnapshot): string[] {
  const out: string[] = [];
  for (const t of tab.tests) {
    if (!isWritableTest(t)) continue;
    for (const p of paramsOfTest(t)) {
      if (resolveParamEntryKind(p) !== 'number') continue;
      const raw = tab.values[t.id]?.[p.name];
      if (raw === undefined || raw === null || raw === '') continue;
      if (Number.isNaN(Number(String(raw).trim()))) out.push(p.title || p.name);
    }
  }
  return out;
}

/** The per-tube submit body, in the per-tab submit's shape. Submit all
 *  sends EVERY writable test as-is — a test left empty (after the user
 *  confirmed) goes with empty values. */
export function tabPayload(tab: TabSnapshot): { results: Array<{ orderTestId: string; values: Record<string, unknown>; note: undefined }> } {
  return {
    results: tab.tests
      .filter(isWritableTest)
      .map((t) => ({ orderTestId: t.id, values: tab.values[t.id] ?? {}, note: undefined })),
  };
}

/** Server prefill (each test's saved draft / result) — what the entry
 *  screen loads before overlaying the local unsaved copy. */
export function prefillFromTests(tests: readonly OrderTest[]): ValuesMap {
  const init: ValuesMap = {};
  for (const t of tests) {
    if (!t.currentResult) continue;
    try { init[t.id] = JSON.parse(t.currentResult)?.values ?? {}; } catch { /* ignore */ }
  }
  return init;
}

/** Overlay the local (never-reached-the-server) copy on a prefill. */
export function overlayDraft(base: ValuesMap, draft: ValuesMap | null): ValuesMap {
  if (!draft) return base;
  const merged: ValuesMap = { ...base };
  for (const [id, vals] of Object.entries(draft)) merged[id] = { ...(merged[id] ?? {}), ...vals };
  return merged;
}
