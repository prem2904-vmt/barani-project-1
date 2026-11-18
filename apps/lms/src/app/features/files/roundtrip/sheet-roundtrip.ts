import { BookColumn, BookList, CellValue, ReadBook, buildBook } from './xlsx-book';

/**
 * Sheet round-trip: Prefrontal data → a protected Neuron sheet → edited → read back → reviewed → applied through the dataset's
 * EXISTING batch API. This file is the generic part (pure, no Angular): a dataset only DECLARES its columns, row key, lists and
 * how to load / apply (see {@link SheetDataset}); generation, read-back, value checks, the diff by key and the review words
 * all live here. Pricing (`prices-dataset.ts`) is the first dataset. Spec: sheet-roundtrip.spec.ts.
 *
 * Rules:
 *  - Rows are matched by the dataset's KEY column (Test Master: the test code, unique per lab), never by position or name.
 *  - Only EDITABLE columns can change anything; a read-only column that differs (somebody edited the master since) is ignored.
 *  - A bad value (empty when required, not a number, negative money, a value not in the column's list) flags the WHOLE row and
 *    nothing of that row is applied. The server stays the authority on everything that is applied.
 *  - "Old" values are the server's values at review time (the dataset reloads), not the values in the file.
 */

export type SheetColType = 'text' | 'number' | 'money' | 'yesno' | 'list' | 'date';

export interface SheetColumn<R> {
  key: string;
  header: string;
  type: SheetColType;
  /** False (default) = locked in the sheet. */
  editable?: boolean;
  /** An editable cell may not be left empty. */
  required?: boolean;
  /** `list` columns: the name of one of the dataset's lists (an in-cell drop-down from the hidden Lists sheet). `yesno` uses {@link YES_NO_LIST}. */
  list?: string;
  /** Column width in characters. */
  width?: number;
  /** The cell value for a row. */
  get(row: R): CellValue;
  /** Plain words for a value in the review list (default: the value; money as ₹). */
  show?(v: CellValue): string;
}

export interface SheetLoad<R> {
  rows: R[];
  /** Named value lists for `list` columns (departments, tests by code + name, partners…). */
  lists?: BookList[];
}

/** One changed cell of one row. */
export interface SheetFieldChange { key: string; header: string; before: CellValue; after: CellValue }
/** One row that changes (only its changed editable fields). */
export interface SheetChange<R> { key: string; label: string; row: R; fields: SheetFieldChange[] }
/** A row that is NOT applied, with the reason in plain words. */
export interface SheetIgnored { line: number; key: string; label: string; reason: string }

export interface SheetDiff<R> { changes: SheetChange<R>[]; ignored: SheetIgnored[]; unchanged: number }

/**
 * One dataset. Scope = where it applies (Pricing: the branch id, '' = the lab-wide price). `load` and `apply` call the SAME
 * services and payloads the dataset's own screen uses.
 */
export interface SheetDataset<R> {
  /** Stored in the file (`_pf` sheet). Never change it once files exist. */
  id: string;
  /** Data sheet tab name. */
  sheetName: string;
  /** Column whose value identifies a row. */
  keyColumn: string;
  columns: SheetColumn<R>[];
  /** Words for a row in lists ("CBC (HEM001)"). */
  label(row: R): string;
  /** May this person apply changes (the screen's own permission)? The server checks again. */
  canApply(): boolean;
  load(scope: string): Promise<SheetLoad<R>>;
  apply(scope: string, changes: SheetChange<R>[]): Promise<void>;
  /** Headline counts for the review ("3 prices change · 1 test switched off"). */
  summary(changes: SheetChange<R>[]): string[];
  /** File name for a new sheet. */
  fileName(scopeName: string, today: string): string;
}

export const YES_NO_LIST: BookList = { name: 'Yes/No', values: ['Yes', 'No'] };
export const SHEET_FORMAT_VERSION = '1';

export interface SheetMarker { dataset: string; scope: string; version: string }

/** The `_pf` sheet of a workbook, if it says which dataset it holds. */
export function sheetMarker(book: Pick<ReadBook, 'marker'>): SheetMarker | null {
  const m = book.marker;
  if (!m['dataset']) return null;
  return { dataset: m['dataset'], scope: m['scope'] ?? '', version: m['version'] ?? '' };
}

const listOf = <R>(c: SheetColumn<R>): string | undefined => (c.type === 'yesno' ? YES_NO_LIST.name : c.type === 'list' ? c.list : undefined);

/** The .xlsx for a dataset's rows. */
export function datasetBook<R>(ds: SheetDataset<R>, scope: string, data: SheetLoad<R>): ArrayBuffer {
  const columns: BookColumn[] = ds.columns.map(c => ({
    header: c.header, editable: !!c.editable, width: c.width,
    format: c.type === 'money' ? 'money' : c.type === 'number' ? 'number' : 'text',
    list: listOf(c),
    listError: c.type === 'yesno' ? 'Pick Yes or No.' : 'Pick a value from the list.',
  }));
  const lists = [...(ds.columns.some(c => c.type === 'yesno') ? [YES_NO_LIST] : []), ...(data.lists ?? [])];
  return buildBook({
    sheetName: ds.sheetName,
    columns,
    rows: data.rows.map(r => ds.columns.map(c => {
      const v = c.get(r);
      return c.type === 'yesno' && typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v;
    })),
    lists,
    marker: { dataset: ds.id, scope, version: SHEET_FORMAT_VERSION },
  });
}

export type CellCheck = { ok: true; value: CellValue } | { ok: false; reason: string };

const round2 = (n: number): number => Math.round(n * 100) / 100;
const blank = (v: CellValue | undefined): boolean => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/** Excel day number → yyyy-mm-dd (1900 system). */
export function serialToIso(n: number): string {
  const ms = Math.round((n - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}

/** Check one edited cell against its column. Returns the value to compare / apply (money rounded to paise, Yes/No as a boolean). */
export function checkCell<R>(c: SheetColumn<R>, raw: CellValue | undefined, lists: ReadonlyMap<string, readonly string[]>): CellCheck {
  if (blank(raw)) return c.required ? { ok: false, reason: `${c.header} is empty` } : { ok: true, value: null };
  const v = raw as CellValue;
  switch (c.type) {
    case 'money':
    case 'number': {
      const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN;
      if (typeof v === 'boolean' || !Number.isFinite(n)) return { ok: false, reason: `${c.header} is not a number ("${String(v)}")` };
      if (c.type === 'money' && n < 0) return { ok: false, reason: `${c.header} is negative` };
      return { ok: true, value: c.type === 'money' ? round2(n) : n };
    }
    case 'yesno': {
      if (typeof v === 'boolean') return { ok: true, value: v };
      const s = String(v).trim().toLowerCase();
      if (s === 'yes') return { ok: true, value: true };
      if (s === 'no') return { ok: true, value: false };
      return { ok: false, reason: `${c.header} must be Yes or No ("${String(v)}")` };
    }
    case 'list': {
      const options = (c.list && lists.get(c.list)) || [];
      const s = String(v).trim();
      const hit = options.find(o => o.toLowerCase() === s.toLowerCase());
      return hit !== undefined ? { ok: true, value: hit } : { ok: false, reason: `${c.header} "${s}" is not in the list` };
    }
    case 'date': {
      if (typeof v === 'number') return { ok: true, value: serialToIso(v) };
      const s = String(v).trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? { ok: true, value: s } : { ok: false, reason: `${c.header} is not a date ("${s}")` };
    }
    default:
      return { ok: true, value: typeof v === 'string' ? v.trim() : String(v) };
  }
}

/** The value a column holds for a current (server) row, in the same shape {@link checkCell} returns. */
function currentValue<R>(c: SheetColumn<R>, row: R): CellValue {
  const v = c.get(row);
  if (c.type === 'money' && typeof v === 'number') return round2(v);
  if (c.type === 'yesno' && typeof v === 'string') return v.toLowerCase() === 'yes';
  if (blank(v)) return null;
  return v;
}

const keyText = (v: CellValue | undefined): string => (blank(v) ? '' : String(v).trim());
const keyNorm = (s: string): string => s.toUpperCase();

/**
 * Diff the edited sheet against the server's current rows. `book` = the workbook read back; `current` = `ds.load(scope)` now.
 * Rows the sheet does not have are left alone (a deleted or filtered-out row never changes anything).
 */
export function diffSheet<R>(ds: SheetDataset<R>, book: ReadBook, current: SheetLoad<R>): SheetDiff<R> {
  const sheet = book.sheets.find(s => s.name === ds.sheetName) ?? book.sheets.find(s => s.state === 'visible');
  if (!sheet) throw new Error(`The sheet "${ds.sheetName}" is missing from this file.`);
  const header = (sheet.rows[0] ?? []).map(h => keyText(h).toLowerCase());
  const at = new Map<string, number>();
  for (const c of ds.columns) {
    const i = header.indexOf(c.header.toLowerCase());
    if (i < 0 && (c.editable || c.key === ds.keyColumn)) throw new Error(`The column "${c.header}" is missing from this sheet.`);
    at.set(c.key, i);
  }
  const keyCol = ds.columns.find(c => c.key === ds.keyColumn)!;
  const lists = new Map<string, readonly string[]>([[YES_NO_LIST.name, YES_NO_LIST.values], ...(current.lists ?? []).map(l => [l.name, l.values] as [string, string[]])]);
  const byKey = new Map<string, R>();
  for (const r of current.rows) byKey.set(keyNorm(keyText(keyCol.get(r))), r);
  const seen = new Map<string, number>();
  const changes: SheetChange<R>[] = [];
  const ignored: SheetIgnored[] = [];
  let unchanged = 0;
  for (let i = 1; i < sheet.rows.length; i++) {
    const cells = sheet.rows[i] ?? [];
    const line = i + 1;
    const key = keyText(cells[at.get(keyCol.key)!]);
    const editedBlank = ds.columns.filter(c => c.editable).every(c => blank(cells[at.get(c.key)!]));
    if (!key) { if (!editedBlank) ignored.push({ line, key: '', label: '', reason: `No ${keyCol.header.toLowerCase()}` }); continue; }
    const row = byKey.get(keyNorm(key));
    if (!row) { ignored.push({ line, key, label: key, reason: `${keyCol.header} not found` }); continue; }
    const label = ds.label(row);
    if (seen.has(keyNorm(key))) { ignored.push({ line, key, label, reason: `${keyCol.header} appears again (row ${seen.get(keyNorm(key))})` }); continue; }
    seen.set(keyNorm(key), line);
    const fields: SheetFieldChange[] = [];
    const bad: string[] = [];
    for (const c of ds.columns) {
      if (!c.editable) continue;
      const chk = checkCell(c, cells[at.get(c.key)!], lists);
      if (!chk.ok) { bad.push(chk.reason); continue; }
      const before = currentValue(c, row);
      if (chk.value !== before) fields.push({ key: c.key, header: c.header, before, after: chk.value });
    }
    if (bad.length) { ignored.push({ line, key, label, reason: bad.join('; ') }); continue; }
    if (fields.length) changes.push({ key, label, row, fields });
    else unchanged++;
  }
  return { changes, ignored, unchanged };
}

/** Plain words for a value in the review. */
export function showValue<R>(c: Pick<SheetColumn<R>, 'type' | 'show'> | undefined, v: CellValue): string {
  if (c?.show) return c.show(v);
  if (v === null || v === undefined || v === '') return '—';
  if (c?.type === 'money' && typeof v === 'number') return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

/** The review dialog's content (DialogService `confirm` with `items`): headline, lines, and whether there is anything to apply. */
export function reviewContent<R>(ds: SheetDataset<R>, diff: SheetDiff<R>): { message: string; items: string[]; canApply: boolean } {
  const cols = new Map(ds.columns.map(c => [c.key, c]));
  const head = [...ds.summary(diff.changes)];
  if (diff.ignored.length) head.push(`${diff.ignored.length} row${diff.ignored.length === 1 ? '' : 's'} ignored`);
  if (!head.length) head.push('Nothing changed');
  const items = [
    ...diff.changes.map(ch => `${ch.label}: ${ch.fields.map(f => `${ds.columns.length > 1 ? f.header + ' ' : ''}${showValue(cols.get(f.key), f.before)} → ${showValue(cols.get(f.key), f.after)}`).join(', ')}`),
    ...diff.ignored.map(g => `Ignored · row ${g.line}${g.label ? ' · ' + g.label : ''}: ${g.reason}`),
  ];
  const tail = diff.changes.length
    ? 'Only the changes listed are saved. Ignored rows are not changed.'
    : diff.ignored.length ? 'Fix the ignored rows in the sheet and send again.' : 'The sheet matches Prefrontal.';
  return { message: `${head.join(' · ')}. ${tail}`, items, canApply: diff.changes.length > 0 };   // one paragraph: the dialog does not keep line breaks
}

/** base64 (what `file.saveBytes` answers) → bytes. */
export function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
