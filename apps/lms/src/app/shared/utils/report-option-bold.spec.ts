import { buildReportPdf } from './report-pdf';
import type { ReportColumn, ResolvedReportLayout } from '../models/report-layout.model';

/**
 * Dropdown results (owner 2026-09-26): a chosen option that is NOT ticked
 * Normal prints BOLD. mw saves that verdict as flag 'A' — and only when the
 * option list has at least one option ticked Normal (none ticked → no flag,
 * nothing bold). The PDF bolds an 'A' row whatever the indicator setting.
 * Renders real PDFs and reads which font each value is drawn in.
 */
const col = (name: string, label: string, type: string, order: number, width = 30): ReportColumn =>
  ({ id: `c-${name}`, name, label, order, width, type, locked: false } as ReportColumn);
const COLS = [col('name', 'Test', 'name', 0), col('result', 'Result', 'result', 1), col('range', 'Reference range', 'range', 2)];

function render(values: Record<string, { value: string; flag?: string }>, template: Record<string, unknown> | null,
  rowFlags: Record<string, string> = {}): string {
  const layout = {
    testId: 't1', testName: 'Stool routine', departmentName: 'Clinical Pathology', columns: COLS,
    sections: [{ id: 'g1', type: 'grid', order: 1, isVisible: true, rows: Object.entries(values).map(([n, v]) => ({
      parameterName: n, title: n, isMerged: false, unit: '', cells: { name: n, result: v.value, range: 'Not Seen' },
      ...(n in rowFlags ? { flag: rowFlags[n] } : {}),
    })) }],
  } as unknown as ResolvedReportLayout;
  const snap = {
    patient: { displayName: 'Test Patient', age: 30, sex: 'M' },
    order: { id: 'o1', orderNumber: 'LAB-2609-000001', createdAt: '2026-09-26T00:00:00Z' },
    type: 'final',
    tests: [{ testId: 't1', name: 'Stool routine', department: 'Clinical Pathology', sampleType: 'Stool', result: { values } }],
  };
  const doc = buildReportPdf({
    report: { id: 'r1', createdAt: '2026-09-26T00:00:00Z', data: JSON.stringify(snap) },
    resolvedLayouts: { t1: layout },
    template,
  } as never);
  return Buffer.from(doc.output('arraybuffer')).toString('latin1');
}

/** The font resource a text run is drawn in ("/F2"), from the content stream. */
function fontOf(pdf: string, text: string): string {
  const at = pdf.indexOf(`(${text}`);
  expect(at).toBeGreaterThan(-1);
  const before = pdf.slice(0, at);
  const all = [...before.matchAll(/\/(F\d+) [\d.]+ Tf/g)];
  return all.at(-1)![1];
}

describe('report — a non-normal dropdown option prints bold', () => {
  const values = {
    'Occult blood': { value: 'Seen', flag: 'A' },
    'Ova': { value: 'Absent', flag: 'N' },
    'Colour': { value: 'Brown', flag: '' },          // list with no Normal ticked → mw saves no flag
  };
  for (const [label, template] of [['default indicator', null], ['indicator "none"', { flagIndicator: 'none' }]] as const) {
    it(`${label}: 'A' bold, 'N' and unflagged plain`, () => {
      const pdf = render(values, template as Record<string, unknown> | null);
      const bold = fontOf(pdf, 'Occult blood');      // the name column is always bold
      expect(fontOf(pdf, 'Seen')).toBe(bold);
      expect(fontOf(pdf, 'Absent')).not.toBe(bold);
      expect(fontOf(pdf, 'Brown')).not.toBe(bold);
    });
  }

  it('the report PREVIEW (no saved result) bolds from the row flag mw puts on the layout', () => {
    const pdf = render({ 'Occult blood': { value: 'Seen' }, 'Ova': { value: 'Absent' } }, null, { 'Occult blood': 'A', 'Ova': 'N' });
    const bold = fontOf(pdf, 'Occult blood');
    expect(fontOf(pdf, 'Seen')).toBe(bold);
    expect(fontOf(pdf, 'Absent')).not.toBe(bold);
  });
});

describe('report — an abnormal dropdown answer (A) is bold only: no arrow, no letter', () => {
  /** Filled shapes in the page streams — the ▲/▼ arrows are filled triangles. */
  const fills = (pdf: string) => (pdf.match(/\sf\s/g) ?? []).length;

  it('arrow indicator: "Reactive" (A) draws no triangle; a High value still does', () => {
    const tpl = { flagIndicator: 'arrow' };
    const withA = render({ HCV: { value: 'Reactive', flag: 'A' } }, tpl);
    const plain = render({ HCV: { value: 'Reactive', flag: '' } }, tpl);
    const high = render({ HCV: { value: 'Reactive', flag: 'H' } }, tpl);
    expect(fills(withA)).toBe(fills(plain));
    expect(fills(high)).toBeGreaterThan(fills(plain));
    expect(fontOf(withA, 'Reactive')).toBe(fontOf(withA, 'HCV'));   // still bold
  });

  it('letter indicator: no "A" letter after the answer', () => {
    const pdf = render({ HCV: { value: 'Reactive', flag: 'A' } }, null);
    expect(pdf).not.toMatch(/\(Reactive\s+A\)/);
    expect(fontOf(pdf, 'Reactive')).toBe(fontOf(pdf, 'HCV'));
  });
});
