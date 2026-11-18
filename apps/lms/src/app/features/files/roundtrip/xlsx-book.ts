import { readZip, writeZip } from './xlsx-zip';

/**
 * Write and read the .xlsx a sheet round-trip needs (Prefrontal data → a Neuron sheet → back), no dependency.
 *
 * What {@link buildBook} writes, in plain OOXML every spreadsheet engine reads:
 *  - the data sheet: a bold header row FROZEN (pane ySplit=1), an AutoFilter over every column, LOCKED cells for the read-only
 *    columns and UNLOCKED cells (style protection locked=0) for the editable ones, and SHEET PROTECTION with no password that
 *    still allows filtering, sorting and selecting;
 *  - a list DATA VALIDATION (an in-cell drop-down) on every column that has a known set of values; the values live on the
 *    hidden, protected "Lists" sheet (one column per list), so a long list (tests, departments) is never squeezed into a formula;
 *  - a very-hidden "_pf" sheet that says which dataset and scope (branch) the file holds (the editor reads it to offer
 *    "Send to Prefrontal"); the workbook STRUCTURE is protected so neither hidden sheet can be unhidden, renamed or deleted.
 * {@link readBook} reads any .xlsx back to values (shared strings, inline strings, numbers, booleans; errors as their text).
 */

export type CellValue = string | number | boolean | null;

export interface BookList { name: string; values: string[] }
export interface BookColumn { header: string; editable: boolean; /** Number format: money = 2 decimals. */ format?: 'money' | 'number' | 'text'; width?: number; /** Name of a {@link BookList}: an in-cell drop-down. */ list?: string; /** Shown when a value is picked that is not in the list. */ listError?: string }
export interface BookSpec {
  sheetName: string;
  columns: BookColumn[];
  rows: CellValue[][];
  lists: BookList[];
  /** Written to the very-hidden `_pf` sheet: what this file is. */
  marker: Record<string, string>;
  /** Extra blank-but-validated rows below the data (0 = none). The round-trip never adds rows, so the default is 0. */
  spareRows?: number;
}

export const LISTS_SHEET = 'Lists';
export const MARKER_SHEET = '_pf';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // XML 1.0 forbids most control characters: drop them rather than write a file no engine opens.
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** 0 → A, 25 → Z, 26 → AA. */
export function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
/** "AB12" → column index 27. */
export function colIndex(ref: string): number {
  const m = /^([A-Z]+)/.exec(ref.toUpperCase());
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** A sheet name quoted for a formula ('My sheet'!A1). */
const quoteSheet = (n: string): string => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`);

// Styles (cellXfs index): 0 default (locked), 1 header (bold, tinted, locked), 2 editable text, 3 editable money, 4 locked text, 5 editable number.
const STYLE = { header: 1, editText: 2, editMoney: 3, lockedText: 4, editNumber: 5, lockedMoney: 6 } as const;
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDE9FE"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4F4F5"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyProtection="1"><protection locked="0"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyProtection="1"><protection locked="0"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyProtection="1"><protection locked="0"/></xf>
<xf numFmtId="164" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function cellXml(ref: string, v: CellValue, s: number): string {
  const st = s ? ` s="${s}"` : '';
  if (v === null || v === undefined || v === '') return s ? `<c r="${ref}"${st}/>` : '';
  if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}"${st}><v>${v}</v></c>` : '';
  if (typeof v === 'boolean') return `<c r="${ref}"${st} t="b"><v>${v ? 1 : 0}</v></c>`;
  return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

function styleFor(c: BookColumn): number {
  if (!c.editable) return c.format === 'money' ? STYLE.lockedMoney : STYLE.lockedText;
  return c.format === 'money' ? STYLE.editMoney : c.format === 'number' ? STYLE.editNumber : STYLE.editText;
}

const PROTECT = '<sheetProtection sheet="1" objects="1" scenarios="1" formatColumns="0" autoFilter="0" sort="0"/>';

function dataSheetXml(spec: BookSpec, listRefs: Map<string, string>): string {
  const cols = spec.columns;
  const last = colName(cols.length - 1);
  const nData = spec.rows.length;
  const spare = Math.max(0, spec.spareRows ?? 0);
  const lastRow = Math.max(2, nData + 1 + spare);
  const colXml = cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 14}" customWidth="1"/>`).join('');   // no column style: below the data every cell stays locked (rows are never added)
  const rows: string[] = [];
  rows.push(`<row r="1">${cols.map((c, i) => cellXml(`${colName(i)}1`, c.header, STYLE.header)).join('')}</row>`);
  for (let r = 0; r < nData; r++) {
    const vals = spec.rows[r];
    rows.push(`<row r="${r + 2}">${cols.map((c, i) => cellXml(`${colName(i)}${r + 2}`, vals[i] ?? null, styleFor(c))).join('')}</row>`);
  }
  for (let r = nData; r < nData + spare; r++) rows.push(`<row r="${r + 2}">${cols.map((c, i) => cellXml(`${colName(i)}${r + 2}`, null, styleFor(c))).join('')}</row>`);
  const dv = cols.map((c, i) => {
    const ref = c.list ? listRefs.get(c.list) : undefined;
    if (!ref) return '';
    const err = esc(c.listError ?? 'Pick a value from the list.');
    return `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorStyle="stop" errorTitle="Not in the list" error="${err}" sqref="${colName(i)}2:${colName(i)}${lastRow}"><formula1>${ref}</formula1></dataValidation>`;
  }).filter(Boolean);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:${last}${Math.max(1, nData + 1)}"/>
<sheetViews><sheetView workbookViewId="0" tabSelected="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${colXml}</cols>
<sheetData>${rows.join('')}</sheetData>
${PROTECT}
<autoFilter ref="A1:${last}${Math.max(1, nData + 1)}"/>
${dv.length ? `<dataValidations count="${dv.length}">${dv.join('')}</dataValidations>` : ''}
</worksheet>`;
}

function plainSheetXml(rows: CellValue[][], protect: boolean): string {
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cellXml(`${colName(ci)}${ri + 1}`, v, ri === 0 && protect ? STYLE.header : 0)).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData>${protect ? PROTECT : ''}</worksheet>`;
}

/** The workbook bytes (.xlsx). */
export function buildBook(spec: BookSpec): ArrayBuffer {
  const lists = spec.lists.filter(l => spec.columns.some(c => c.list === l.name));
  // Lists sheet: row 1 = list names, below = values; one column per list.
  const listRefs = new Map<string, string>();
  const height = lists.reduce((n, l) => Math.max(n, l.values.length), 0);
  const listRows: CellValue[][] = [lists.map(l => l.name)];
  for (let r = 0; r < height; r++) listRows.push(lists.map(l => l.values[r] ?? null));
  lists.forEach((l, i) => {
    const c = colName(i);
    listRefs.set(l.name, `${quoteSheet(LISTS_SHEET)}!$${c}$2:$${c}$${Math.max(2, l.values.length + 1)}`);
  });
  const markerRows: CellValue[][] = Object.entries(spec.marker).map(([k, v]) => [k, v]);
  const sheets = [
    { name: spec.sheetName, xml: dataSheetXml(spec, listRefs), state: '' },
    { name: LISTS_SHEET, xml: plainSheetXml(listRows, true), state: ' state="hidden"' },
    { name: MARKER_SHEET, xml: plainSheetXml(markerRows, true), state: ' state="veryHidden"' },
  ];
  const last = colName(spec.columns.length - 1);
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<workbookProtection lockStructure="1"/>
<bookViews><workbookView activeTab="0"/></bookViews>
<sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.state} r:id="rId${i + 1}"/>`).join('')}</sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${esc(quoteSheet(spec.sheetName))}!$A$1:$${last}$${Math.max(1, spec.rows.length + 1)}</definedName></definedNames>
</workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  const root = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const e = new TextEncoder();
  return writeZip([
    { name: '[Content_Types].xml', data: e.encode(types) },
    { name: '_rels/.rels', data: e.encode(root) },
    { name: 'xl/workbook.xml', data: e.encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: e.encode(rels) },
    { name: 'xl/styles.xml', data: e.encode(STYLES_XML) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: e.encode(s.xml) })),
  ]);
}

// ───────────────────────────── reading ─────────────────────────────

export interface ReadSheet { name: string; state: 'visible' | 'hidden' | 'veryHidden'; rows: CellValue[][] }
export interface ReadBook { sheets: ReadSheet[]; /** The `_pf` sheet as key → value (empty when the file has none). */ marker: Record<string, string> }

const unesc = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');
/** Attributes of one start tag. */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = unesc(m[2]);
  for (const m of tag.matchAll(/([\w:]+)\s*=\s*'([^']*)'/g)) out[m[1]] = unesc(m[2]);
  return out;
}
/** The text of every <t> inside (rich text runs joined; phonetic runs dropped). */
function textOf(xml: string): string {
  const noPh = xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '');
  let s = '';
  for (const m of noPh.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)) s += unesc(m[1]);
  return s;
}
const norm = (p: string): string => {
  const parts: string[] = [];
  for (const seg of p.split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); }
  return parts.join('/');
};

function sheetRows(xml: string, shared: string[]): CellValue[][] {
  const rows: CellValue[][] = [];
  const data = /<(?:\w+:)?sheetData\b[^>]*>([\s\S]*?)<\/(?:\w+:)?sheetData>/.exec(xml)?.[1] ?? '';
  let autoRow = 0;
  for (const rm of data.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    const ra = attrs(rm[1]);
    const r = ra['r'] ? Number(ra['r']) - 1 : autoRow;
    autoRow = r + 1;
    const row: CellValue[] = [];
    let autoCol = 0;
    for (const cm of (rm[2] ?? '').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const a = attrs(cm[1]);
      const ci = a['r'] ? colIndex(a['r']) : autoCol;
      autoCol = ci + 1;
      const inner = cm[2] ?? '';
      const v = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner)?.[1];
      const t = a['t'] ?? 'n';
      let val: CellValue = null;
      if (t === 'inlineStr') val = textOf(/<(?:\w+:)?is>([\s\S]*?)<\/(?:\w+:)?is>/.exec(inner)?.[1] ?? '');
      else if (v === undefined) val = null;
      else if (t === 's') val = shared[Number(v)] ?? '';
      else if (t === 'b') val = v.trim() === '1';
      else if (t === 'str' || t === 'e') val = unesc(v);
      else { const n = Number(v); val = Number.isFinite(n) ? n : unesc(v); }
      row[ci] = val;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null;
    rows[r] = row;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

/** Read every sheet of an .xlsx to values. Throws on a file that is not a workbook. */
export async function readBook(bytes: ArrayBuffer | Uint8Array): Promise<ReadBook> {
  const zip = await readZip(bytes);
  const dec = new TextDecoder();
  const text = (p: string): string | null => { const b = zip.get(p); return b ? dec.decode(b) : null; };
  const wb = text('xl/workbook.xml');
  if (!wb) throw new Error('not a workbook');
  const relsXml = text('xl/_rels/workbook.xml.rels') ?? '';
  const rels = new Map<string, string>();
  for (const m of relsXml.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?>/g)) {
    const a = attrs(m[1]);
    if (a['Id'] && a['Target']) rels.set(a['Id'], a['Target'].startsWith('/') ? norm(a['Target']) : norm('xl/' + a['Target']));
  }
  const sstXml = text('xl/sharedStrings.xml') ?? '';
  const shared: string[] = [];
  for (const m of sstXml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>|<(?:\w+:)?si\s*\/>/g)) shared.push(textOf(m[1] ?? ''));
  const sheets: ReadSheet[] = [];
  for (const m of wb.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>/g)) {
    const a = attrs(m[1]);
    const rid = a['r:id'] ?? Object.entries(a).find(([k]) => /:id$/.test(k))?.[1] ?? '';
    const path = rels.get(rid);
    const xml = path ? text(path) : null;
    const st = a['state'] === 'hidden' ? 'hidden' : a['state'] === 'veryHidden' ? 'veryHidden' : 'visible';
    sheets.push({ name: a['name'] ?? '', state: st, rows: xml ? sheetRows(xml, shared) : [] });
  }
  const marker: Record<string, string> = {};
  const ms = sheets.find(s => s.name === MARKER_SHEET);
  for (const r of ms?.rows ?? []) if (r[0] !== null && r[0] !== undefined && r[0] !== '') marker[String(r[0])] = r[1] === null || r[1] === undefined ? '' : String(r[1]);
  return { sheets, marker };
}
