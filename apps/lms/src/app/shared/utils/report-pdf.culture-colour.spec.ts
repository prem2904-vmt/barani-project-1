import { buildReportPdf } from './report-pdf';
import { richTemplate } from './report-theme.spec-helpers';
import { silenceJsdomCanvas } from './report-header-legacy.spec-helpers';

/**
 * OPS-90: culture / microbiology lines print in the lab's chosen Body text colour
 * (the designer's colour) instead of a hard black. Read back from the content
 * stream: the `r g b rg` operator in force when a given run is drawn.
 */
describe('culture lines honour the template text colour (OPS-90)', () => {
  silenceJsdomCanvas();

  const render = (bodyTextColor?: string, layoutSections?: Array<Record<string, unknown>>): string => {
    const snap = {
      patient: { displayName: 'Test Patient', age: 30, sex: 'M' },
      order: { id: 'o1', orderNumber: 'LAB-2609-000001', createdAt: '2026-09-19T00:00:00Z' },
      type: 'final',
      tests: [{
        testId: 'ct1', name: 'Bacterial Culture & Sensitivity', packageTestId: null, packageType: null,
        department: 'Microbiology', sampleType: 'Urine',
        result: { microFormat: 'culture_sensitivity', values: { specimen: 'SPECVALUE', gramStain: 'GRAMVALUE bacilli', growth: 'GROWTHVALUE' } },
      }],
    };
    const doc = buildReportPdf({
      report: { id: 'r1', createdAt: '2026-09-19T00:00:00Z', data: JSON.stringify(snap) },
      resolvedLayouts: layoutSections
        ? { ct1: { testId: 'ct1', testName: 'Bacterial Culture & Sensitivity', departmentName: 'Microbiology', columns: [], sections: layoutSections } }
        : {},
      template: richTemplate(bodyTextColor ? { bodyTextColor } : {}),
    } as never);
    return Buffer.from(doc.output('arraybuffer')).toString('latin1');
  };

  const strip = (p: string) => p.replace(/\/CreationDate \([^)]*\)/g, '').replace(/\/ID \[[^\]]*\]/g, '');

  /** The fill colour (`r g b rg`) in force when `text` is drawn. */
  const inkAt = (pdf: string, text: string): string => {
    const at = pdf.indexOf(`(${text}) Tj`);
    expect(at, `"${text}" is printed`).toBeGreaterThan(-1);
    const all = [...pdf.slice(0, at).matchAll(/([\d.]+) ([\d.]+) ([\d.]+) rg/g)];
    const m = all[all.length - 1];
    return [m[1], m[2], m[3]].map(v => String(parseFloat(v))).join(' ');
  };

  it('classic C&S: label and value take the Body text colour', () => {
    const pdf = render('#0000ff');
    expect(inkAt(pdf, 'SPECIMEN:')).toBe('0 0 1');
    expect(inkAt(pdf, 'SPECVALUE')).toBe('0 0 1');
    expect(inkAt(pdf, 'GRAM STAIN:')).toBe('0 0 1');
    expect(inkAt(pdf, 'GRAMVALUE bacilli')).toBe('0 0 1');
  });

  it('layout-driven culture lines and paragraphs take it too', () => {
    const pdf = render('#0000ff', [
      { id: 's1', type: 'culture_line', order: 1, content: 'gramStain', label: 'Gram', conditions: [] },
      { id: 's2', type: 'paragraph', order: 2, content: 'PARAGRAPHTEXT', conditions: [] },
    ]);
    expect(inkAt(pdf, 'GRAM:')).toBe('0 0 1');
    expect(inkAt(pdf, 'GRAMVALUE bacilli')).toBe('0 0 1');
    expect(inkAt(pdf, 'PARAGRAPHTEXT')).toBe('0 0 1');
  });

  it('a template that never picked a Body text colour keeps today\'s ink (heading colour)', () => {
    const pdf = render();
    expect(inkAt(pdf, 'SPECIMEN:')).not.toBe('0 0 1');
    expect(inkAt(pdf, 'SPECIMEN:')).toBe(inkAt(pdf, 'GRAM STAIN:'));
    // the lab's stock #1a1a1a body colour is "not picked" as well
    expect(strip(render('#1a1a1a'))).toBe(strip(pdf));
  });
});
