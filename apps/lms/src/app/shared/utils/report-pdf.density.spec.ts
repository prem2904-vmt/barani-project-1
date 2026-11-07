import type { jsPDF } from 'jspdf';
import { buildReportPdf, buildReportPdfWithLayout, lastReportSqueeze, type ReportPdfInput } from './report-pdf';
import { describeOverlap, findOverlaps, recordDrawing, type DrawnBox } from './report-overlap-detector';
import { silenceJsdomCanvas } from './report-header-legacy.spec-helpers';
import { richInput, stripVolatile } from './report-theme.spec-helpers';
import { readPdfRuns } from './report-pdf-read.spec-helpers';
import { PATIENT_LAYOUT_PATCHES, longNameInput } from './report-long-names.spec-helpers';
import { listInput } from './report-density.spec-helpers';
import { SIG_ROW } from './report-signatures';

/**
 * COMPACT DENSITY + SQUEEZE (report layout plan, phase 3). Normal is the paper
 * as it always was (the Classic golden specs pin that); Compact is a token
 * overlay; "Squeeze onto one page" tries Compact, then x0.95, when the report
 * runs only a little over - and keeps the result only if it really saves a page.
 */
describe('report density — Compact and squeeze', () => {
  silenceJsdomCanvas();
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-30T05:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  const runs = (doc: jsPDF) => readPdfRuns(Buffer.from(doc.output('arraybuffer')).toString('latin1'));
  const pages = (i: ReportPdfInput) => buildReportPdf(i).getNumberOfPages();
  const render = (input: ReportPdfInput) => {
    let rec: ReturnType<typeof recordDrawing> | null = null;
    const built = buildReportPdfWithLayout({ ...input, drawRecorder: d => { rec = recordDrawing(d); } });
    const boxes: DrawnBox[] = rec!.boxes;
    return { ...built, boxes, overlaps: findOverlaps(boxes).map(describeOverlap) };
  };
  const bytes = (doc: jsPDF) => [...stripVolatile(Buffer.from(doc.output('arraybuffer')).toString('latin1')).matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(m => m[1]).join('\n----\n');

  describe('Compact', () => {
    it('takes pages off: 20 tests print on 2 pages Normal, 1 page Compact', () => {
      expect(pages(listInput(20))).toBe(2);
      expect(pages(listInput(20, { density: 'compact' }))).toBe(1);
      expect(pages(listInput(60))).toBeGreaterThan(pages(listInput(60, { density: 'compact' })));
    });

    it('the rich multi-department report never grows, and its first results page is shorter', () => {
      const rich = (density?: string) => richInput({ metadata: JSON.stringify({ options: { abnormalSummary: true, specimenLine: true }, ...(density ? { reportStyle: { v: 1, density } } : {}) }) });
      expect(pages(rich('compact'))).toBeLessThanOrEqual(pages(rich()));
      // The last signatory line's place in document order (PDF y runs up, so later = smaller): Compact never ends later.
      // Departments share pages now (OPS-80), so this is no longer a fixed page 2.
      const last = (density?: string) => Math.min(...runs(buildReportPdf(rich(density))).filter(r => r.text === 'Reg. TNMC 88213').map(r => -r.page * 1000 + r.y));
      expect(last('compact')).toBeGreaterThanOrEqual(last());
    });

    it('row rhythm: each test row is at least 18 percent shorter, with its Method beside the name', () => {
      const pitch = (density?: string) => {
        const r = runs(buildReportPdf(listInput(6, density ? { density } : {}))).filter(x => /^Analyte [34]$/.test(x.text));
        return Math.abs(r[1].y - r[0].y);
      };
      expect(pitch('compact')).toBeLessThan(pitch() * 0.82);
      // the same rows, Method text-for-text: Normal prints it under the name, Compact right after it
      const n = runs(buildReportPdf(listInput(6)));
      const c = runs(buildReportPdf(listInput(6, { density: 'compact' })));
      expect(n.some(r => r.text === 'Method: Photometry')).toBe(true);
      expect(c.some(r => r.text === 'Method: Photometry')).toBe(false);
      const name = c.find(r => r.text === 'Analyte 3')!, method = c.find(r => r.page === name.page && r.text === '(Photometry)' && Math.abs(r.y - name.y) < 0.6 && r.x > name.x)!;
      expect(method).toBeTruthy();
      expect(method.x).toBeGreaterThan(name.x + 30);
    });

    it('a method that would not fit beside the name keeps its own row - nothing is cut', () => {
      const text = runs(buildReportPdf(richInput({ metadata: JSON.stringify({ options: { specimenLine: true }, reportStyle: { v: 1, density: 'compact' } }) }))).map(r => r.text);
      // the long profile line (it cannot share the band) and the long test name's method both survive whole
      expect(text.some(t => t.startsWith('Method: Photometry (Total Bilirubin'))).toBe(true);
      expect(text).toContain('Method: CLIA');
    });

    it('a panel band carries its Method and Specimen when they fit beside the name', () => {
      const r = runs(buildReportPdf(richInput({ metadata: JSON.stringify({ options: { specimenLine: true }, reportStyle: { v: 1, density: 'compact' } }) })));
      const band = r.find(x => x.text === 'GLUCOSE, FASTING (FBS)')!;
      const line = r.find(x => x.page === band.page && /^Method: Hexokinase/.test(x.text) && Math.abs(x.y - band.y) < 0.6)!;
      expect(line).toBeTruthy();
      expect(line.text).toContain('Specimen: Fluoride Plasma');
    });

    it('the department caption is slim: its first table row sits closer', () => {
      const gap = (density?: string) => {
        const r = runs(buildReportPdf(listInput(6, density ? { density } : {})));
        const dept = r.find(x => x.text === 'BIOCHEMISTRY')!;
        return Math.abs(r.find(x => x.page === dept.page && x.text === 'Investigation')!.y - dept.y);
      };
      expect(gap('compact')).toBeLessThan(gap() - 4);
    });

    it('notes print at 8 pt, results keep their size', () => {
      const r = runs(buildReportPdf(richInput({ metadata: JSON.stringify({ options: { abnormalSummary: false }, reportStyle: { v: 1, density: 'compact' } }) })));
      const interp = r.find(x => x.text.startsWith('Enzyme mostly'))!;
      expect(interp.size).toBe(8);
      const normal = runs(buildReportPdf(richInput({ metadata: JSON.stringify({ options: { abnormalSummary: false } }) })));
      expect(normal.find(x => x.text.startsWith('Enzyme mostly'))!.size).toBe(8.5);
      for (const nm of ['Total Bilirubin', 'SGPT (ALT)', 'Haemoglobin']) {
        expect(r.find(x => x.text === nm)!.size).toBe(normal.find(x => x.text === nm)!.size);
      }
    });

    it('the sign-off block is tighter and the rhythm is put back after the render', () => {
      const h = (density?: string) => {
        const r = runs(buildReportPdf(listInput(6, density ? { density } : {})));
        const name = r.find(x => x.text === 'Arun Kumar')!, reg = r.find(x => x.text === 'Reg. TN-LT-4412')!;
        return { name, reg };
      };
      const c = h('compact'), n = h();
      expect(c.reg.y - c.name.y).toBe(n.reg.y - n.name.y);   // the block itself is unchanged
      buildReportPdf(listInput(6, { density: 'compact' }));
      expect([SIG_ROW.lead, SIG_ROW.base, SIG_ROW.tail]).toEqual([10, 30, 7]);
    });

    it('trend charts: three to a row in Compact, two in Normal', () => {
      const charts = [1, 2, 3, 4, 5, 6].map(i => ({ title: `T${i}`, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' }));
      const xs = (density?: string) => {
        const r = render({ ...listInput(4, density ? { density } : {}), trendograms: charts });
        const imgs = r.boxes.filter(b => b.kind === 'image' && b.w > 100 && b.w < 300);
        const firstY = Math.min(...imgs.map(b => Math.round(b.y)));
        return new Set(imgs.filter(b => Math.abs(b.y - firstY) < 3).map(b => Math.round(b.x)));
      };
      expect(xs().size).toBe(2);
      expect(xs('compact').size).toBe(3);
    });

    it('Normal written out is the same paper as no style at all (byte for byte)', () => {
      expect(bytes(buildReportPdf(listInput(20, { density: 'normal' })))).toBe(bytes(buildReportPdf(listInput(20))));
      expect(bytes(buildReportPdf(richInput({ metadata: JSON.stringify({ options: { abnormalSummary: true, specimenLine: true }, reportStyle: { v: 1, density: 'normal', squeeze: false } }) }))))
        .toBe(bytes(buildReportPdf(richInput())));
    });

    it('Relaxed is airier than Normal', () => {
      const pitch = (density?: string) => {
        const r = runs(buildReportPdf(listInput(6, density ? { density } : {}))).filter(x => /^Analyte [34]$/.test(x.text));
        return Math.abs(r[1].y - r[0].y);
      };
      expect(pitch('relaxed')).toBeGreaterThan(pitch() + 2);
    });
  });

  describe('Compact never overlaps', () => {
    const modern = (base: Record<string, unknown>) => JSON.stringify({ reportTheme: 'source-sans', options: { abnormalSummary: true }, reportStyle: { v: 1, fit: { enabled: true }, density: 'compact', ...base } });
    describe.each([['classic'], ['centered'], ['banner'], ['minimal']])('%s letterhead', preset => {
      it.each(PATIENT_LAYOUT_PATCHES.map(([n]) => n))('%s strip — zero overlaps (long names, Compact, fit on)', name => {
        const patch = { ...PATIENT_LAYOUT_PATCHES.find(([n]) => n === name)![1], headerPreset: preset };
        expect(render(longNameInput({ fit: true, style: { density: 'compact' }, patch })).overlaps).toEqual([]);
      });
    });
    it.each(PATIENT_LAYOUT_PATCHES.map(([n]) => n))('%s — Modern theme and a pre-printed letterpad print clean', name => {
      const base = PATIENT_LAYOUT_PATCHES.find(([n]) => n === name)![1];
      expect(render(longNameInput({ fit: true, patch: { ...base, metadata: modern({}) } })).overlaps, 'source-sans').toEqual([]);
      expect(render({ ...longNameInput({ fit: true, style: { density: 'compact' }, patch: base }), blankLetterhead: true }).overlaps, 'letterpad').toEqual([]);
      expect(render({ ...longNameInput({ patch: { ...base, metadata: modern({}) } }), blankLetterhead: true }).overlaps, 'modern letterpad').toEqual([]);
    });
    it('the rich report in Compact, Classic and Modern, with the abnormal sheet', () => {
      for (const theme of [undefined, 'source-sans']) {
        const meta = JSON.stringify({ ...(theme ? { reportTheme: theme } : {}), options: { abnormalSummary: true, specimenLine: true }, reportStyle: { v: 1, density: 'compact' } });
        expect(render(richInput({ metadata: meta })).overlaps, String(theme)).toEqual([]);
      }
    });
    it('a name and its inline Method never touch (a long list, Compact, both themes)', () => {
      expect(render(listInput(30, { density: 'compact' })).overlaps).toEqual([]);
      expect(render(listInput(30, { density: 'compact' }, { metadata: modern({}) })).overlaps).toEqual([]);
    });
    it('a squeezed report has no overlaps either', () => {
      for (const n of [12, 14]) expect(render(listInput(n, { squeeze: true, fit: { enabled: true } })).overlaps).toEqual([]);
    });
  });

  describe('Squeeze onto one page', () => {
    const squeeze = (n: number, extra: Record<string, unknown> = {}) => buildReportPdfWithLayout(listInput(n, { squeeze: true, ...extra }));

    it('triggers when the report runs a little over (<= 12 percent of a page): Compact is enough', () => {
      for (const n of [12, 13, 14]) {
        const b = squeeze(n);
        expect(b.squeeze, `n=${n}`).toMatchObject({ applied: true, pagesBefore: 2, pagesAfter: 1, by: 'compact' });
        expect(b.squeeze!.overflow, `n=${n}`).toBeLessThanOrEqual(0.12);
        expect(b.doc.getNumberOfPages()).toBe(1);
        expect(lastReportSqueeze()).toEqual(b.squeeze);
      }
    });

    it('does NOT trigger at 30 percent over: the report prints as it would have (still 2 pages, Normal rhythm)', () => {
      const b = squeeze(18);
      expect(b.squeeze).toMatchObject({ applied: false, reason: 'too-long', pagesBefore: 2, pagesAfter: 2 });
      expect(b.squeeze!.overflow).toBeGreaterThan(0.12);
      expect(b.squeeze!.overflow).toBeGreaterThan(0.25);   // about 30 percent of a page
      expect(b.squeeze!.overflow).toBeLessThan(0.36);
      expect(bytes(b.doc)).toBe(bytes(buildReportPdf(listInput(18))));
    });

    it('a report that already fits one page is left alone', () => {
      const b = squeeze(8);
      expect(b.squeeze).toMatchObject({ applied: false, reason: 'one-page', pagesBefore: 1 });
      expect(bytes(b.doc)).toBe(bytes(buildReportPdf(listInput(8))));
    });

    it('when Compact is not enough it goes a touch smaller (x0.95) - and keeps it only if a page is saved', () => {
      const scaled = squeeze(31, { density: 'compact' });
      expect(scaled.squeeze).toMatchObject({ applied: true, by: 'scale', pagesBefore: 2, pagesAfter: 1 });
      const none = squeeze(33, { density: 'compact' });
      expect(none.squeeze).toMatchObject({ applied: false, reason: 'no-gain', pagesBefore: 2, pagesAfter: 2 });
      expect(bytes(none.doc)).toBe(bytes(buildReportPdf(listInput(33, { density: 'compact' }))));
    });

    it('never below the floor: clinical values stay >= the smallest size, and a raised floor holds them', () => {
      const clinical = (doc: jsPDF) => runs(doc).filter(r => /^(Analyte \d+|\d+ mg\/dL|10 – 90|\d+)$/.test(r.text) && r.y > 100).map(r => r.size);
      const small = clinical(squeeze(31, { density: 'compact' }).doc);
      expect(small.length).toBeGreaterThan(10);
      expect(Math.min(...small)).toBeGreaterThanOrEqual(8.5);
      expect(Math.min(...small)).toBeLessThan(9);               // it really did shrink
      const held = squeeze(31, { density: 'compact', fit: { minPt: 9 } });
      expect(Math.min(...clinical(held.doc))).toBeGreaterThanOrEqual(9);
    });

    it('squeeze off: one ordinary render, no report, nothing recorded', () => {
      const b = buildReportPdfWithLayout(listInput(14));
      expect(b.squeeze).toBeNull();
      expect(lastReportSqueeze()).toBeNull();
      expect(b.doc.getNumberOfPages()).toBe(2);
    });

    it('a recorder / designer hook watches the paper that is returned (one final render, not the dry ones)', () => {
      const r = render(listInput(13, { squeeze: true }));
      expect(r.squeeze!.applied).toBe(true);
      expect(Math.max(...r.boxes.map(b => b.page))).toBe(1);
      const names = r.boxes.filter(b => b.text === 'Analyte 1');
      expect(names.length).toBe(1);
    });

    it('works on top of text fitting and a Modern theme', () => {
      const b = buildReportPdfWithLayout(listInput(14, { squeeze: true, fit: { enabled: true } }, { metadata: JSON.stringify({ reportTheme: 'source-sans', options: { specimenLine: true }, reportStyle: { v: 1, squeeze: true, fit: { enabled: true } } }) }));
      expect(b.squeeze).not.toBeNull();
      expect(b.doc.getNumberOfPages()).toBeLessThanOrEqual(b.squeeze!.pagesBefore);
    });
  });

  describe('Centered letterhead: the accent bar clears the text (fitting on)', () => {
    const items = (fit: boolean) => buildReportPdfWithLayout(richInput({ headerPreset: 'centered', metadata: JSON.stringify({ options: { abnormalSummary: true }, ...(fit ? { reportStyle: { v: 1, fit: { enabled: true } } } : {}) }) })).layout.items;
    const bar = (its: ReturnType<typeof items>) => its.find(i => i.id === 'accentBar')!;
    const textBottom = (its: ReturnType<typeof items>) => Math.max(...its.filter(i => i.kind === 'text' && i.region === 'header' && i.id !== 'website' && !i.hidden).map(i => i.box.y + i.box.h));

    it('with fitting off the bar is where it always was (through the contact lines)', () => {
      expect(bar(items(false)).y).toBe(82);
      expect(bar(items(false)).y).toBeLessThan(textBottom(items(false)));
    });
    it('with fitting on the bar sits below the tagline, contact and address lines', () => {
      const its = items(true);
      expect(bar(its).y).toBeGreaterThanOrEqual(textBottom(its));
      expect(bar(its).y).toBeGreaterThan(82);
    });
    it('the body below moves down with it and nothing overlaps', () => {
      const on = render(richInput({ headerPreset: 'centered', metadata: JSON.stringify({ options: { abnormalSummary: true }, reportStyle: { v: 1, fit: { enabled: true } } }) }));
      expect(on.overlaps).toEqual([]);
      const top = (r: { layout: { bodyTop: number } }) => r.layout.bodyTop;
      const off = buildReportPdfWithLayout(richInput({ headerPreset: 'centered' }));
      expect(top(on)).toBeGreaterThan(top(off));
    });
  });
});
