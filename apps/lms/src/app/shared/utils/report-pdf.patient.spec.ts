import type { jsPDF } from 'jspdf';
import { buildReportPdf, buildReportPdfWithLayout, type ReportPdfInput } from './report-pdf';
import { describeOverlap, findOverlaps, recordDrawing, type DrawnBox } from './report-overlap-detector';
import { silenceJsdomCanvas } from './report-header-legacy.spec-helpers';
import { classicBodyMatrix, richInput, stripVolatile } from './report-theme.spec-helpers';
import { readPdfRuns } from './report-pdf-read.spec-helpers';
import { LONG_PATIENT, PATIENT_LAYOUT_PATCHES, longNameInput } from './report-long-names.spec-helpers';

/**
 * PATIENT BLOCK OPTIONS + CONTINUATION HEADER + "Page N of M" (report layout
 * plan, phase 2). Every option is opt-in through `template.metadata.reportStyle`;
 * with none set the paper is what it was (the Classic golden specs pin that).
 */
describe('report patient block options (phase 2)', () => {
  silenceJsdomCanvas();
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-30T05:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  const withStyle = (input: ReportPdfInput, style: Record<string, unknown>): ReportPdfInput => ({
    ...input,
    template: { ...input.template!, metadata: JSON.stringify({ options: { abnormalSummary: true, specimenLine: true }, reportStyle: { v: 1, ...style } }) },
  });
  const render = (input: ReportPdfInput) => {
    let rec: ReturnType<typeof recordDrawing> | null = null;
    const doc = buildReportPdf({ ...input, drawRecorder: d => { rec = recordDrawing(d); } });
    const boxes: DrawnBox[] = rec!.boxes;
    return { doc, boxes, overlaps: findOverlaps(boxes).map(describeOverlap) };
  };
  const raw = (doc: jsPDF) => Buffer.from(doc.output('arraybuffer')).toString('latin1');
  const runs = (doc: jsPDF) => readPdfRuns(raw(doc));
  const text = (doc: jsPDF) => runs(doc).map(r => r.text).join(' ');
  const streams = (doc: jsPDF) => [...stripVolatile(raw(doc)).matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(m => m[1]).join('\n----\n');
  const man = { patient: { id: 'p1', displayName: 'Ravi Kumar', age: 45, sex: 'Male', phone: '9840012345', mrn: 'CHN-2609-004217-3' } };
  const COLUMNS = PATIENT_LAYOUT_PATCHES.find(([n]) => n === 'columns')![1];

  describe('defaults print exactly what they printed', () => {
    const noop = { patient: { ageSex: 'separate', ageStyle: 'auto', sexStyle: 'word', joiner: ' / ', labels: {}, labelJoiner: 'auto', frame: 'rules', continuation: 'none', showReportStatus: false }, pageNumbers: 'n' };
    it.each(classicBodyMatrix().filter(([n]) => ['three-col', 'four-col', 'stacked', 'columns'].includes(n)))(
      '%s - a style that only restates the defaults is byte-identical', (_n, patch) => {
        const base = richInput(patch, man);
        expect(streams(buildReportPdf(withStyle(base, noop)))).toBe(streams(buildReportPdf(base)));
      });
  });

  describe('age and sex as one field', () => {
    const layouts: Array<[string, Partial<ReportPdfInput['template']>]> = [
      ['three-col', {}], ['four-col', { patientLayout: 'four-col-grid' }], ['stacked', { patientLayout: 'stacked' }],
      ['columns', { patientColumnsJson: JSON.stringify([['name', 'ageSex', 'mrn'], ['specimen', 'refdoctor'], ['barcode']]) }],
      ['columns, age + sex still separate chips', { patientColumnsJson: JSON.stringify([['name', 'age', 'sex', 'mrn'], ['specimen', 'refdoctor'], ['barcode']]) }],
    ];
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['45 Y / Male', { ageStyle: 'short' }, '45 Y / Male'],
      ['45 yrs / M', { ageStyle: 'yrs', sexStyle: 'letter' }, '45 yrs / M'],
      ['45 Years / Male', { ageStyle: 'Years' }, '45 Years / Male'],
    ];
    for (const [ln, patch] of layouts) {
      it.each(cases)(`${ln} - %s`, (_n, patient, expected) => {
        const r = render(withStyle(richInput(patch as never, man), { patient: { ageSex: 'combined', ...patient } }));
        expect(text(r.doc)).toContain(expected);
        expect(r.overlaps).toEqual([]);
      });
    }
    it('the separate "Sex" line is gone (no double sex) and the field is labelled', () => {
      const r = render(withStyle(richInput({ patientColumnsJson: JSON.stringify([['name', 'age', 'sex']]) }, man), { patient: { ageSex: 'combined', ageStyle: 'short' } }));
      const t = text(r.doc);
      expect(t).toContain('Age / Sex : 45 Y / Male');
      expect(t).not.toContain('Sex : Male');
    });
    it('separate with a style choice: letter sex, own age wording', () => {
      const t = text(render(withStyle(richInput({}, man), { patient: { ageStyle: 'yrs', sexStyle: 'letter' } })).doc);
      expect(t).toContain('Age : 45 yrs');
      expect(t).toContain('Sex : M');
    });
  });

  describe('labels, joiner, status', () => {
    it('renamed labels and a joiner reach the paper (arranged columns)', () => {
      const cols = JSON.stringify([['name', 'orderid', 'mrn', 'refdoctor'], ['phone'], ['barcode']]);
      const t = text(render(withStyle(richInput({ patientColumnsJson: cols }, { ...man, order: { id: 'o1', orderNumber: 'LAB-2609-000142', createdAt: '2026-09-29T03:40:00Z', refDoctorName: 'Dr. A. Sharma' } }),
        { patient: { labels: { orderid: 'Lab No.', mrn: 'UHID', refdoctor: 'Ref. Dr.' }, labelJoiner: ': ' } })).doc);
      expect(t).toContain('Lab No.: LAB-2609-000142');
      expect(t).toContain('UHID: CHN-2609-004217-3');
      expect(t).toMatch(/Ref\. Dr\.:\s+Dr\. A\. Sharma/);
    });
    it('four-col and stacked take the renames too', () => {
      expect(text(render(withStyle(richInput({ patientLayout: 'four-col-grid' }, man), { patient: { labels: { mrn: 'UHID' } } })).doc)).toContain('UHID');
      expect(text(render(withStyle(richInput({ patientLayout: 'stacked' }, man), { patient: { labels: { mrn: 'UHID' }, labelJoiner: ': ' } })).doc)).toContain('UHID:');
    });
    it('report status: Final, and Preliminary on a partial report - in every layout', () => {
      for (const [n, patch] of PATIENT_LAYOUT_PATCHES) {
        expect(text(render(withStyle(richInput(patch, man), { patient: { showReportStatus: true } })).doc), n).toMatch(/Final/);
        expect(text(render(withStyle(richInput(patch, { ...man, isPartial: true }), { patient: { showReportStatus: true } })).doc), n).toMatch(/Preliminary/);
      }
    });
  });

  describe('frames', () => {
    it.each(['box', 'tint', 'none'])('%s - every patient layout prints clean (no overlaps)', frame => {
      for (const [n, patch] of PATIENT_LAYOUT_PATCHES) {
        const r = render(withStyle(longNameInput({ fit: true, patch }), { fit: { enabled: true }, patient: { frame } }));
        expect(r.overlaps, n).toEqual([]);
      }
    });
    it('tint is painted BEHIND the strip text (also when the block was measured first)', () => {
      for (const fit of [false, true]) {
        const pdf = streams(buildReportPdf(withStyle(richInput({}, man), { fit: { enabled: fit }, patient: { frame: 'tint' } })));
        const tint = pdf.indexOf('0.96 0.96 0.98 rg');
        expect(tint, `fit ${fit}`).toBeGreaterThan(-1);
        expect(tint, `fit ${fit}`).toBeLessThan(pdf.indexOf('(Ravi Kumar)'));
      }
    });
    it('rules keeps the classic horizontal rules; none draws neither rules nor separators', () => {
      const lines = (frame: string) => (streams(buildReportPdf(withStyle(richInput({}, man), { patient: { frame } }))).match(/ l\n/g) ?? []).length;
      expect(lines('none')).toBeLessThan(lines('rules'));
    });
  });

  describe('continuation pages: mini strip + Page N of M', () => {
    const style = { fit: { enabled: true }, pageNumbers: 'n-of-m', patient: { continuation: 'mini', ageSex: 'combined', ageStyle: 'short' } };
    const long = (patch = {}) => withStyle(longNameInput({ fit: true, patch }), style);
    const pageCount = (doc: jsPDF) => doc.getNumberOfPages();

    /** The mini strip's own "Page N of M" box (top of the page; the footer's sits at the bottom). */
    const stripPages = (r: { boxes: DrawnBox[]; doc: jsPDF }) =>
      [...new Set(r.boxes.filter(b => b.y < 80 && /^Page \d+ of \d+$/.test(b.text ?? '')).map(b => b.page))].sort((a, b) => a - b);
    /** Pages that open with their own letterhead + full patient block (the first page, the abnormal sheet, a custom layout). */
    const blockPages = (r: { boxes: DrawnBox[] }) => [...new Set(r.boxes.filter(b => /DIAGNOSTICS CENTRE/.test(b.text ?? '')).map(b => b.page))];

    it('every page that has no full patient block carries the strip (name, age / sex, MRN, order no.) and "Page N of M"; the others do not', () => {
      const r = render(long());
      const total = pageCount(r.doc);
      const withBlock = blockPages(r), strips = stripPages(r);
      expect(total).toBeGreaterThanOrEqual(4);
      expect(withBlock).toContain(1);
      expect(strips.length).toBeGreaterThan(0);
      for (let p = 1; p <= total; p++) expect(strips.includes(p), `page ${p} strip`).toBe(!withBlock.includes(p));
      for (const p of strips) {
        // (the detector clips a box's text to 60 characters - read the strip back from the PDF itself)
        const words = runs(r.doc).filter(x => x.page === p && x.y > 842 - 80).map(x => x.text).join(' ');
        for (const w of [...LONG_PATIENT.split(' '), 'MRN', 'CHN-2609-004217-3-EXTENDED', 'LAB-2609-000142', '46 Y / Female']) expect(words, `p${p} ${w}`).toContain(w);
        expect(r.boxes.some(b => b.page === p && b.text === `Page ${p} of ${total}`)).toBe(true);
      }
      // the footer's own "Page N of M" is on page 1 too
      expect(r.boxes.some(b => b.page === 1 && b.text === `Page 1 of ${total}`)).toBe(true);
    });

    it('the footer follows the lab\'s page-number choice: n-of-m prints "Page 2 of 3", the default prints "2"', () => {
      const on = render(withStyle(richInput({}, man), { pageNumbers: 'n-of-m' }));
      expect(on.boxes.some(b => b.page === 2 && /^Page 2 of \d+$/.test(b.text ?? ''))).toBe(pageCount(on.doc) >= 2);
      const off = render(richInput({}, man));
      expect(off.boxes.some(b => /^Page \d+ of \d+$/.test(b.text ?? ''))).toBe(false);
      expect(off.boxes.some(b => b.page === 1 && b.text === '1')).toBe(true);
    });

    it('nothing overlaps the strip on any continuation page - every layout, both type themes, a pre-printed letterpad', () => {
      for (const [n, patch] of PATIENT_LAYOUT_PATCHES) {
        expect(render(long(patch)).overlaps, n).toEqual([]);
        const modern = withStyle(longNameInput({ fit: true, patch: { ...patch, metadata: JSON.stringify({ reportTheme: 'source-sans', options: { abnormalSummary: true } }) } }), style);
        expect(render(modern).overlaps, `${n} source-sans`).toEqual([]);
        expect(render({ ...long(patch), blankLetterhead: true }).overlaps, `${n} letterpad`).toEqual([]);
      }
    });

    it('the body starts below the strip on every strip page (no content hidden under it)', () => {
      const r = render(long());
      for (const p of stripPages(r)) {
        const pg = r.boxes.filter(b => b.page === p);
        const pageBox = pg.find(b => /^Page \d+ of \d+$/.test(b.text ?? '') && b.y < 80)!;
        const stripBottom = Math.max(...pg.filter(b => b.y < 60).map(b => b.y + b.h));
        const body = pg.filter(b => b.y > pageBox.y + 30 && b.y < 700);
        expect(body.length, `p${p}`).toBeGreaterThan(0);
        expect(Math.min(...body.map(b => b.y)), `p${p}`).toBeGreaterThanOrEqual(stripBottom - 0.01);
      }
    });

    it('a pre-printed letterpad: the strip sits BELOW the stationery header, never inside it', () => {
      const r = render({ ...long(), blankLetterhead: true });
      const headerPt = (long().template!.letterpadHeaderMm ?? 45) * (72 / 25.4);
      const strips = r.boxes.filter(b => /^Page \d+ of \d+$/.test(b.text ?? '') && b.y < headerPt + 80);
      expect(strips.length).toBeGreaterThan(0);
      for (const b of strips) expect(b.y, `p${b.page}`).toBeGreaterThanOrEqual(headerPt - 0.01);
    });

    it('a page that carries its own full patient block (the abnormal summary page) gets no mini strip', () => {
      const r = render(withStyle(richInput({}, man), { patient: { continuation: 'mini' } }));
      const pages = [...new Set(r.boxes.map(b => b.page))];
      for (const p of pages) {
        const hasStrip = r.boxes.some(b => b.page === p && /Order LAB-2609-000142$/.test(b.text ?? '') && /·|·/.test(b.text ?? ''));
        const hasBlock = r.boxes.some(b => b.page === p && /^Specimen\(s\)/.test(b.text ?? ''));
        expect(hasStrip && hasBlock, `page ${p}`).toBe(false);
      }
    });

    it('a one-page report is unchanged by the continuation choice (no strip, same body position)', () => {
      const one = richInput({}, { ...man, tests: [] });
      const a = render(one), b = render(withStyle(one, { patient: { continuation: 'mini' } }));
      expect(pageCount(a.doc)).toBe(1);
      expect(streams(b.doc).replace(/\/Creator[^\n]*/g, '')).toBe(streams(a.doc).replace(/\/Creator[^\n]*/g, ''));
    });

    it('with the mini strip off (every existing template) nothing moves on page 2', () => {
      const base = longNameInput({ fit: true });
      const a = render(base), b = render(withStyle(base, { fit: { enabled: true }, patient: { continuation: 'none' } }));
      expect(b.boxes.map(x => [x.page, x.y, x.text])).toEqual(a.boxes.map(x => [x.page, x.y, x.text]));
    });
  });

  describe('letterhead website line vs the accent bar', () => {
    const itemBoxes = (input: ReportPdfInput) => {
      const items = buildReportPdfWithLayout(input).layout.items;
      return { web: items.find(i => i.id === 'website')!.box, bar: items.find(i => i.id === 'accentBar')!.box };
    };
    it.each(['classic', 'centered'])('%s - with text fitting on the website sits clear of the bar; the body moves below it', preset => {
      const base = richInput({ headerPreset: preset as never }, man);
      const on = withStyle(base, { fit: { enabled: true } });
      const { web, bar } = itemBoxes(on);
      expect(web.y).toBeGreaterThanOrEqual(bar.y + bar.h - 0.01);
      const lay = buildReportPdfWithLayout(on).layout;
      expect(lay.bodyTop).toBeGreaterThanOrEqual(web.y + web.h);
    });
    it.each(['classic', 'centered'])('%s - fitting OFF keeps today\'s placement (untouched templates unchanged)', preset => {
      const { web, bar } = itemBoxes(richInput({ headerPreset: preset as never }, man));
      expect(web.y).toBeLessThan(bar.y + bar.h);   // the legacy pill straddles the bar
    });
  });
});
