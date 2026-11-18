import { describe, expect, it } from 'vitest';
import { crc32, readZip, writeZip } from './xlsx-zip';
import { LISTS_SHEET, MARKER_SHEET, buildBook, colIndex, colName, readBook } from './xlsx-book';
import { SheetColumn, SheetDataset, YES_NO_LIST, checkCell, datasetBook, diffSheet, reviewContent, sheetMarker, serialToIso } from './sheet-roundtrip';
import { PRICE_COLUMNS, PriceSheetRow, priceRows, priceSummary, priceWriteBranch, priceWrites, rateCardCells } from './prices-dataset';
import { detectRoundtrip } from './sheet-roundtrip.service';
import { TENANT_PRICE_SCOPE, priceBulkBody } from '../../../shared/utils/test-pricing';

const enc = new TextEncoder();
const dec = new TextDecoder();

async function deflateRaw(b: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const w = cs.writable.getWriter(); void w.write(b as Uint8Array<ArrayBuffer>); void w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
/** A one-entry zip with a DEFLATED entry (what engines write). */
async function deflatedZip(name: string, text: string): Promise<ArrayBuffer> {
  const raw = enc.encode(text);
  const data = await deflateRaw(raw);
  const n = enc.encode(name);
  const lh = new DataView(new ArrayBuffer(30));
  lh.setUint32(0, 0x04034b50, true); lh.setUint16(8, 8, true); lh.setUint32(14, crc32(raw), true);
  lh.setUint32(18, data.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, n.length, true);
  const ch = new DataView(new ArrayBuffer(46));
  ch.setUint32(0, 0x02014b50, true); ch.setUint16(10, 8, true); ch.setUint32(16, crc32(raw), true);
  ch.setUint32(20, data.length, true); ch.setUint32(24, raw.length, true); ch.setUint16(28, n.length, true); ch.setUint32(42, 0, true);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, 1, true); end.setUint16(10, 1, true);
  end.setUint32(12, 46 + n.length, true); end.setUint32(16, 30 + n.length + data.length, true);
  const parts = [new Uint8Array(lh.buffer), n, data, new Uint8Array(ch.buffer), n, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
  let p = 0; for (const b of parts) { out.set(b, p); p += b.length; }
  return out.buffer;
}

const rows: PriceSheetRow[] = [
  { id: 't1', code: 'HEM001', name: 'CBC', department: 'Haematology', type: 'Test', offered: true, price: 250 },
  { id: 't2', code: 'BIO010', name: 'Glucose', department: 'Biochemistry', type: 'Test', offered: false, price: 120 },
  { id: 't3', code: 'PRF001', name: 'LFT', department: 'Biochemistry', type: 'Profile', offered: true, price: 600 },
];
const ds: SheetDataset<PriceSheetRow> = {
  id: 'tm-prices', sheetName: 'Prices', keyColumn: 'code', columns: PRICE_COLUMNS,
  label: r => `${r.name} (${r.code})`, canApply: () => true,
  load: async () => ({ rows }), apply: async () => undefined, summary: priceSummary,
  fileName: (s, d) => `Prices – ${s} – ${d}.xlsx`,
};
/** A read-back book with the given data rows under the Prices header. */
const bookOf = (data: unknown[][], header = PRICE_COLUMNS.map(c => c.header)) => ({
  sheets: [{ name: 'Prices', state: 'visible' as const, rows: [header, ...data] as never }], marker: {},
});

describe('xlsx zip', () => {
  it('crc32 matches the known value', () => expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926));
  it('reads back what it wrote (stored)', async () => {
    const z = writeZip([{ name: 'a.txt', data: enc.encode('hello') }, { name: 'dir/b.xml', data: enc.encode('<x/>') }]);
    const m = await readZip(z);
    expect(dec.decode(m.get('a.txt')!)).toBe('hello');
    expect(dec.decode(m.get('dir/b.xml')!)).toBe('<x/>');
  });
  it('inflates deflated entries (engine saves)', async () => {
    const m = await readZip(await deflatedZip('x.xml', '<a>' + 'b'.repeat(5000) + '</a>'));
    expect(dec.decode(m.get('x.xml')!)).toHaveLength(5007);
  });
  it('refuses a non-zip', async () => { await expect(readZip(enc.encode('not a zip at all, sorry'))).rejects.toThrow(); });
});

describe('xlsx book', () => {
  it('column names', () => {
    expect([colName(0), colName(25), colName(26), colName(701)]).toEqual(['A', 'Z', 'AA', 'ZZ']);
    expect([colIndex('A1'), colIndex('AB12')]).toEqual([0, 27]);
  });

  it('price sheet: columns, locked / editable cells, frozen header, autofilter, protection, Yes/No drop-down, marker', async () => {
    const bytes = datasetBook(ds, 'b-1', { rows });
    const zip = await readZip(bytes);
    const sheet = dec.decode(zip.get('xl/worksheets/sheet1.xml')!);
    const wb = dec.decode(zip.get('xl/workbook.xml')!);
    const styles = dec.decode(zip.get('xl/styles.xml')!);
    expect(sheet).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(sheet).toContain('<autoFilter ref="A1:F4"/>');
    expect(sheet).toMatch(/<sheetProtection sheet="1"[^>]*autoFilter="0"[^>]*sort="0"/);
    expect(sheet).toContain(`<formula1>${LISTS_SHEET}!$A$2:$A$3</formula1>`);
    expect(sheet).toMatch(/<dataValidation type="list"[^>]*sqref="E2:E4"/);
    // Code (A) locked style 4, Offered (E) unlocked text 2, Price (F) unlocked money 3.
    expect(sheet).toMatch(/<c r="A2" s="4" t="inlineStr"><is><t xml:space="preserve">HEM001</);
    expect(sheet).toMatch(/<c r="E3" s="2" t="inlineStr"><is><t xml:space="preserve">No</);
    expect(sheet).toContain('<c r="F2" s="3"><v>250</v></c>');
    const xfs = [...styles.matchAll(/<xf [^>]*xfId="0"[^>]*?(?:\/>|>.*?<\/xf>)/gs)].map(m => m[0]);
    expect(xfs[2]).toContain('locked="0"');
    expect(xfs[3]).toContain('locked="0"');
    expect(xfs[4]).not.toContain('locked="0"');
    expect(wb).toContain('<workbookProtection lockStructure="1"/>');
    expect(wb).toContain(`name="${LISTS_SHEET}" sheetId="2" state="hidden"`);
    expect(wb).toContain(`name="${MARKER_SHEET}" sheetId="3" state="veryHidden"`);

    const book = await readBook(bytes);
    expect(book.sheets.map(s => [s.name, s.state])).toEqual([['Prices', 'visible'], [LISTS_SHEET, 'hidden'], [MARKER_SHEET, 'veryHidden']]);
    expect(book.sheets[0].rows[0]).toEqual(['Code', 'Test', 'Department', 'Type', 'Offered', 'Price (₹)']);
    expect(book.sheets[0].rows[1]).toEqual(['HEM001', 'CBC', 'Haematology', 'Test', 'Yes', 250]);
    expect(book.sheets[1].rows).toEqual([[YES_NO_LIST.name], ['Yes'], ['No']]);
    expect(sheetMarker(book)).toEqual({ dataset: 'tm-prices', scope: 'b-1', version: '1' });
  });

  it('a list column gets its own drop-down from the Lists sheet; text is escaped', async () => {
    const col: SheetColumn<{ k: string; d: string }> = { key: 'd', header: 'Dept', type: 'list', list: 'Departments', editable: true, get: r => r.d };
    const keyCol: SheetColumn<{ k: string; d: string }> = { key: 'k', header: 'Key', type: 'text', get: r => r.k };
    const d2: SheetDataset<{ k: string; d: string }> = { ...ds, columns: [keyCol, col], keyColumn: 'k', label: (r: { k: string }) => r.k } as never;
    const bytes = datasetBook(d2, '', { rows: [{ k: 'A&B <1>', d: 'Haem' }], lists: [{ name: 'Departments', values: ['Haem', 'Bio', 'Micro'] }] });
    const sheet = dec.decode((await readZip(bytes)).get('xl/worksheets/sheet1.xml')!);
    expect(sheet).toContain(`<formula1>${LISTS_SHEET}!$A$2:$A$4</formula1>`);
    expect(sheet).toContain('A&amp;B &lt;1&gt;');
    expect((await readBook(bytes)).sheets[0].rows[1]).toEqual(['A&B <1>', 'Haem']);
  });

  it('reads shared strings, booleans, errors and deflated sheets (what an engine saves)', async () => {
    const files: Record<string, string> = {
      'xl/workbook.xml': '<workbook><sheets><sheet name="Prices" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>Code</t></si><si><r><t>HEM</t></r><r><t>001</t></r></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="3"><c r="A3" t="s"><v>1</v></c><c r="C3" t="b"><v>1</v></c><c r="D3" t="e"><v>#N/A</v></c><c r="E3"><v>12.5</v></c></row></sheetData></worksheet>',
    };
    const z = writeZip(Object.entries(files).map(([name, t]) => ({ name, data: enc.encode(t) })));
    const b = await readBook(z);
    expect(b.sheets[0].rows).toEqual([['Code'], [], ['HEM001', null, true, '#N/A', 12.5]]);
    expect(sheetMarker(b)).toBeNull();
  });
});

describe('cell checks (bad values are never applied)', () => {
  const price = PRICE_COLUMNS[5], offered = PRICE_COLUMNS[4];
  const lists = new Map<string, string[]>([['Departments', ['Haematology']]]);
  it.each([
    [null, 'Price (₹) is empty'], ['', 'Price (₹) is empty'], [-5, 'Price (₹) is negative'], ['abc', 'is not a number'], ['12abc', 'is not a number'], [true, 'is not a number'],
  ])('money %p → flagged', (v, why) => {
    const r = checkCell(price, v as never, lists);
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain(why);
  });
  it('money accepts numbers and numeric text, rounded to paise', () => {
    expect(checkCell(price, 300, lists)).toEqual({ ok: true, value: 300 });
    expect(checkCell(price, ' 99.999 ', lists)).toEqual({ ok: true, value: 100 });
    expect(checkCell(price, 0, lists)).toEqual({ ok: true, value: 0 });
  });
  it('yes / no', () => {
    expect(checkCell(offered, 'yes', lists)).toEqual({ ok: true, value: true });
    expect(checkCell(offered, 'No', lists)).toEqual({ ok: true, value: false });
    expect(checkCell(offered, 'Maybe', lists).ok).toBe(false);
  });
  it('a list value must be in the list (case-insensitive, canonical spelling back)', () => {
    const c: SheetColumn<unknown> = { key: 'd', header: 'Department', type: 'list', list: 'Departments', editable: true, get: () => null };
    expect(checkCell(c, 'haematology', lists)).toEqual({ ok: true, value: 'Haematology' });
    expect(checkCell(c, 'Cardiology', lists)).toEqual({ ok: false, reason: 'Department "Cardiology" is not in the list' });
  });
  it('dates', () => {
    const c: SheetColumn<unknown> = { key: 'd', header: 'Date', type: 'date', editable: true, get: () => null };
    expect(serialToIso(46344)).toBe('2026-11-18');
    expect(checkCell(c, 46344, lists)).toEqual({ ok: true, value: '2026-11-18' });
    expect(checkCell(c, 'tomorrow', lists).ok).toBe(false);
  });
});

describe('diff by test code', () => {
  it('a price change, a switch-off, unchanged rows', () => {
    const d = diffSheet(ds, bookOf([
      ['HEM001', 'CBC', 'Haematology', 'Test', 'Yes', 300],
      ['BIO010', 'Glucose', 'Biochemistry', 'Test', 'No', 120],
      ['prf001', 'LFT', 'Biochemistry', 'Profile', 'No', 600],
    ]), { rows });
    expect(d.unchanged).toBe(1);
    expect(d.changes.map(c => [c.key, c.fields.map(f => [f.key, f.before, f.after])])).toEqual([
      ['HEM001', [['price', 250, 300]]],
      ['prf001', [['offered', true, false]]],
    ]);
    expect(priceSummary(d.changes)).toEqual(['1 price changes', '1 test switched off']);
  });

  it('unknown / repeated codes and bad values are ignored with reasons; nothing of a bad row applies', () => {
    const d = diffSheet(ds, bookOf([
      ['HEM001', 'CBC', 'Haematology', 'Test', 'No', 'abc'],
      ['ZZZ999', 'Ghost', '', '', 'Yes', 10],
      ['BIO010', 'Glucose', 'Biochemistry', 'Test', 'Yes', -1],
      ['PRF001', 'LFT', 'Biochemistry', 'Profile', 'Yes', 650],
      ['PRF001', 'LFT', 'Biochemistry', 'Profile', 'Yes', 700],
      [null, null, null, null, 'Yes', 5],
      [null, null, null, null, null, null],
    ]), { rows });
    expect(d.changes.map(c => c.key)).toEqual(['PRF001']);
    expect(d.ignored.map(g => [g.line, g.reason])).toEqual([
      [2, 'Price (₹) is not a number ("abc")'],
      [3, 'Code not found'],
      [4, 'Price (₹) is negative'],
      [6, 'Code appears again (row 5)'],
      [7, 'No code'],
    ]);
  });

  it('a read-only column edited (or changed on the server since) never applies', () => {
    const d = diffSheet(ds, bookOf([['HEM001', 'Complete blood count', 'Other', 'Package', 'Yes', 250]]), { rows });
    expect(d.changes).toEqual([]);
    expect(d.unchanged).toBe(1);
  });

  it('columns are found by header (an engine may reorder nothing, but never trust position); a missing editable column is an error', () => {
    const hdr = ['Price (₹)', 'Offered', 'Code', 'Test', 'Department', 'Type'];
    const d = diffSheet(ds, bookOf([[275, 'Yes', 'HEM001', 'CBC', 'Haematology', 'Test']], hdr), { rows });
    expect(d.changes[0].fields).toEqual([{ key: 'price', header: 'Price (₹)', before: 250, after: 275 }]);
    expect(() => diffSheet(ds, bookOf([], ['Code', 'Test']), { rows })).toThrow('The column "Offered" is missing from this sheet.');
  });

  it('review words: headline counts + old → new lines + ignored lines', () => {
    const d = diffSheet(ds, bookOf([['HEM001', '', '', '', 'Yes', 1250.5], ['BIO010', '', '', '', 'Yes', 120], ['X', '', '', '', 'Yes', 1]]), { rows });
    const r = reviewContent(ds, d);
    expect(r.canApply).toBe(true);
    expect(r.message.split('. ')[0]).toBe('1 price changes · 1 test switched on · 1 row ignored');
    expect(r.items).toEqual([
      'CBC (HEM001): Price (₹) ₹250 → ₹1,250.5',
      'Glucose (BIO010): Offered No → Yes',
      'Ignored · row 4 · X: Code not found',
    ]);
    expect(reviewContent(ds, diffSheet(ds, bookOf([]), { rows })).canApply).toBe(false);
  });
});

describe('Pricing dataset', () => {
  it('rows from the test list: code required, type and department as the grid shows them', () => {
    const r = priceRows([
      { id: 'a', testCode: ' HEM001 ', name: 'CBC', price: 300, department: { id: 'd', name: 'Haematology', code: 'H' } },
      { id: 'b', code: '', name: 'No code' },
      { id: 'c', code: 'PKG1', testCode: null, name: 'Health check', type: 'package', price: 999, isOffered: false },
    ] as never);
    expect(r).toEqual([
      { id: 'a', code: 'HEM001', name: 'CBC', department: 'Haematology', type: 'Test', offered: true, price: 300 },
      { id: 'c', code: 'PKG1', name: 'Health check', department: 'Package', type: 'Package', offered: false, price: 999 },
    ]);
  });

  it('the write payload is the Pricing grid batch shape (price / isOffered only when changed) and the grid branch rule', () => {
    const d = diffSheet(ds, bookOf([['HEM001', '', '', '', 'No', 300], ['PRF001', '', '', '', 'Yes', 650]]), { rows });
    const items = priceWrites(d.changes);
    expect(items).toEqual([{ testId: 't1', price: 300, isOffered: false }, { testId: 't3', price: 650 }]);
    expect(priceWriteBranch('b-1')).toBe('b-1');
    expect(priceWriteBranch(TENANT_PRICE_SCOPE)).toBeNull();
    expect(priceWriteBranch('')).toBeNull();
    // What PricingComponent.save sends for the same edits through TestPricingService.save → priceBulkBody.
    expect(priceBulkBody(items, 'b-1')).toEqual({ updates: [{ testId: 't1', price: 300, isOffered: false }, { testId: 't3', price: 650 }], branchId: 'b-1' });
  });

  it('rate-card prices land in the Price cells of the matching codes', () => {
    const values = [['Code', 'Test', 'Department', 'Type', 'Offered', 'Price (₹)'], ['HEM001', 'CBC'], ['BIO010', 'Glucose'], ['PRF001', 'LFT']];
    expect(rateCardCells(values, rows, [{ testId: 't2', price: 135.456 }, { testId: 't9', price: 5 }, { testId: 't1', price: -1 }, { testId: 't2', price: 140 }]))
      .toEqual({ cells: [{ cell: 'F3', input: '135.46' }], missing: 2 });
  });
});

describe('detecting a round-trip sheet', () => {
  it('a price sheet is recognised; any other file is just a sheet', async () => {
    expect(await detectRoundtrip(datasetBook(ds, 'b-1', { rows }))).toEqual({ dataset: 'tm-prices', scope: 'b-1', version: '1' });
    expect(await detectRoundtrip(enc.encode('PK not really'))).toBeNull();
    expect(await detectRoundtrip(null)).toBeNull();
    const other = buildBook({ sheetName: 'S', columns: [{ header: 'A', editable: true }], rows: [], lists: [], marker: { dataset: 'unknown-thing' } });
    expect(await detectRoundtrip(other)).toBeNull();
  });
});
