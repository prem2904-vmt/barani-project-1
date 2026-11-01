import type { jsPDF } from 'jspdf';
import { buildReportPdf, type ReportPdfInput } from './report-pdf';
import { describeOverlap, findOverlaps, recordDrawing, type DrawnBox } from './report-overlap-detector';
import { silenceJsdomCanvas } from './report-header-legacy.spec-helpers';
import { classicBodyMatrix, richInput, stripVolatile } from './report-theme.spec-helpers';
import { readPdfRuns } from './report-pdf-read.spec-helpers';
import { LONG_DOCTOR, LONG_HOSPITAL, LONG_PATIENT, LONG_SIG_NAME, LONG_TEST, PATIENT_LAYOUT_PATCHES, longNameInput } from './report-long-names.spec-helpers';

/**
 * TEXT FITTING (report layout plan, phase 1 — "never overlap").
 * With `reportStyle.fit.enabled`, long names wrap / shrink / grow the block
 * instead of running into their neighbours. Off (every existing template) the
 * paper is exactly what it was — the Classic golden specs pin that.
 */
describe('report text fitting — long names never overlap', () => {
  silenceJsdomCanvas();
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-30T05:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  const render = (input: ReportPdfInput) => {
    let rec: ReturnType<typeof recordDrawing> | null = null;
    const doc = buildReportPdf({ ...input, drawRecorder: d => { rec = recordDrawing(d); } });
    const boxes: DrawnBox[] = rec!.boxes;
    return { doc, boxes, overlaps: findOverlaps(boxes).map(describeOverlap) };
  };
  const pdfText = (doc: jsPDF) => readPdfRuns(Buffer.from(doc.output('arraybuffer')).toString('latin1')).map(r => r.text).join(' ');
  /** Every page content stream, nothing else (the Info dictionary and xref offsets differ by the Creator stamp). */
  const bytes = (doc: jsPDF) => [...stripVolatile(Buffer.from(doc.output('arraybuffer')).toString('latin1')).matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(m => m[1]).join('\n----\n');

  it('the detector has signal: with fitting OFF the long-name report overlaps today (arranged columns + classic strip)', () => {
    for (const [name, patch] of PATIENT_LAYOUT_PATCHES.filter(([n]) => n === 'three-col' || n === 'columns')) {
      expect(render(longNameInput({ patch })).overlaps.length, name).toBeGreaterThan(0);
    }
  });

  describe.each([['classic', 'classic'], ['centered', 'centered'], ['banner', 'banner'], ['minimal', 'minimal']])('%s letterhead', (_n, preset) => {
    it.each(PATIENT_LAYOUT_PATCHES.map(([n]) => n))('%s patient strip — zero overlaps with fitting on', name => {
      const patch = { ...PATIENT_LAYOUT_PATCHES.find(([n]) => n === name)![1], headerPreset: preset };
      const r = render(longNameInput({ fit: true, patch }));
      expect(r.overlaps).toEqual([]);
    });
  });

  it.each(PATIENT_LAYOUT_PATCHES.map(([n]) => n))('%s — both type themes and a pre-printed letterpad print clean', name => {
    const base = PATIENT_LAYOUT_PATCHES.find(([n]) => n === name)![1];
    const modern = render(longNameInput({ fit: true, patch: { ...base, metadata: JSON.stringify({ reportTheme: 'source-sans', options: { abnormalSummary: true }, reportStyle: { v: 1, fit: { enabled: true } } }) } }));
    expect(modern.overlaps, 'source-sans').toEqual([]);
    const pad = render({ ...longNameInput({ fit: true, patch: base }), blankLetterhead: true });
    expect(pad.overlaps, 'letterpad').toEqual([]);
  });

  it('the strip block grows: with a long name the results start lower than with fitting off', () => {
    const top = (boxes: DrawnBox[]) => boxes.find(b => b.page === 1 && b.text === 'Investigation')!.y;
    for (const [name, patch] of PATIENT_LAYOUT_PATCHES) {
      const off = render(longNameInput({ patch }));
      const on = render(longNameInput({ fit: true, patch }));
      expect(top(on.boxes), name).toBeGreaterThanOrEqual(top(off.boxes) - 0.01);
      if (name === 'three-col' || name === 'stacked') expect(top(on.boxes), name).toBeGreaterThan(top(off.boxes));
    }
  });

  it('a clinical value is never cut or ellipsised — every word of the names is on the paper', () => {
    for (const [name, patch] of PATIENT_LAYOUT_PATCHES) {
      const text = pdfText(render(longNameInput({ fit: true, patch })).doc);
      for (const w of [...LONG_PATIENT.split(' '), ...LONG_DOCTOR.split(' '), ...LONG_SIG_NAME.split(' '), ...LONG_TEST.split(/[\s]+/)]) {
        expect(text, `${name}: ${w}`).toContain(w);
      }
      expect(text, name).not.toContain('…');
    }
    // the 60-char hospital rides in the arranged columns
    const cols = pdfText(render(longNameInput({ fit: true, patch: PATIENT_LAYOUT_PATCHES.find(([n]) => n === 'columns')![1] })).doc);
    for (const w of LONG_HOSPITAL.split(' ')) expect(cols).toContain(w);
  });

  it('a wrapped lab name pushes the accent bar and the body down (Classic letterhead)', () => {
    const lab = (fit: boolean) => render(longNameInput({ fit, patch: { patientLayout: 'three-col' } }));
    const off = lab(false), on = lab(true);
    const y = (r: ReturnType<typeof lab>) => r.boxes.find(b => b.page === 1 && b.text === 'Investigation')!.y;
    expect(y(on)).toBeGreaterThan(y(off));
  });

  it('signatories: long names/titles wrap in their slot, the block grows, nothing overlaps or is cut', () => {
    const off = render(longNameInput());
    const on = render(longNameInput({ fit: true }));
    expect(on.overlaps).toEqual([]);
    // "Dr. Lakshminarasimhan Venkatasubramanian" no longer shrinks onto one line: its second word gets its own line.
    const own = (r: typeof on) => r.boxes.filter(b => b.text === 'Venkatasubramanian');
    expect(own(off).length).toBe(0);
    expect(own(on).length).toBeGreaterThan(0);
    // every signature line fits its 4-per-row slot (535 / 4 = 133.75 pt)
    const sigLines = on.boxes.filter(b => /Biochemist|Molecular|Consultant|Pathologist|^Reg\. TNMC 88213\/2009/.test(b.text ?? ''));
    expect(sigLines.length).toBeGreaterThan(2);
    for (const b of sigLines) expect(b.w).toBeLessThanOrEqual(134);
    // …and the whole title survives
    const text = pdfText(on.doc);
    for (const w of 'Consultant Clinical Biochemist and Molecular Pathologist'.split(' ')) expect(text).toContain(w);
  });

  it('auto-fit columns: the name column widens for long parameter names', () => {
    const plain = render(longNameInput({ fit: true }));
    const auto = render(longNameInput({ fit: true, style: { fit: { enabled: true, autoColumns: true } } }));
    expect(auto.overlaps).toEqual([]);
    // the department table is the one whose header sits on page 2; the Result column starts further right
    const resultX = (r: { boxes: DrawnBox[] }) => r.boxes.filter(b => b.text === 'Result' && b.page === 2)[0].x;
    expect(resultX(auto)).toBeGreaterThan(resultX(plain) + 20);
    // the 66-character test name needs fewer wrapped lines
    const lines = (r: { boxes: DrawnBox[] }) => r.boxes.filter(b => b.page === 2 && /Phosphate|Dehydrogenase|Quantitative|Erythrocyte/.test(b.text ?? '')).length;
    expect(lines(auto)).toBeLessThan(lines(plain));
  });

  describe('nothing that already fits changes', () => {
    const short = { patient: { id: 'p1', displayName: 'Sita Raman', age: 37, sex: 'Female', phone: '9080706050', mrn: 'CHN-2609-004217-3' },
                    order: { id: 'o1', orderNumber: 'LAB-2609-000142', createdAt: '2026-09-29T03:40:00Z', refDoctorName: 'Dr. A. Sharma', branchName: 'Anna Nagar', collectedBy: 'Priya S', trackToken: 'tok123' } };
    const runs = (doc: jsPDF) => readPdfRuns(Buffer.from(doc.output('arraybuffer')).toString('latin1'));
    // (Four-col prints a long specimen list CUT to its first line today, and Centered's contact lines run into the
    // strip today — with fitting on those two are fixed on purpose, so they are not "unchanged".)
    it.each(classicBodyMatrix().filter(([n]) => ['three-col', 'stacked', 'columns', 'banner', 'minimal', 'font-lg-times'].includes(n)))(
      '%s — fitting on moves nothing but the website line (and the body, by one small constant) for short text', (_n, patch) => {
        const base = richInput(patch, short);
        const fitOn = { ...base, template: { ...base.template!, metadata: JSON.stringify({ options: { abnormalSummary: true, specimenLine: true }, reportStyle: { v: 1, fit: { enabled: true } } }) } };
        // Phase 2: with fitting on the website line sits CLEAR of the accent bar, under it - so that one run
        // moves and the body below the header moves down with it by one constant (<= 8 pt). Nothing else changes.
        const on = runs(buildReportPdf(fitOn)).filter(r => r.text !== 'www.microworld.in');
        const off = runs(buildReportPdf(base)).filter(r => r.text !== 'www.microworld.in');
        expect(on.map(r => [r.page, r.text, r.x, r.size])).toEqual(off.map(r => [r.page, r.text, r.x, r.size]));
        const dys = new Set(on.map((r, i) => Math.round((off[i].y - r.y) * 100) / 100));
        const moved = [...dys].filter(d => d !== 0);
        expect(moved.length).toBeLessThanOrEqual(1);
        for (const d of moved) { expect(d).toBeGreaterThan(0); expect(d).toBeLessThanOrEqual(8); }
      });
  });

  it('the PDF Creator names the engine and preset only for a template that carries a style', () => {
    const raw = (i: ReportPdfInput) => Buffer.from(buildReportPdf(i).output('arraybuffer')).toString('latin1');
    expect(raw(richInput())).not.toContain('/Creator');
    expect(raw(longNameInput({ fit: true }))).toContain('/Creator (Prefrontal report engine v1; style v1; preset classic)');
  });
});
