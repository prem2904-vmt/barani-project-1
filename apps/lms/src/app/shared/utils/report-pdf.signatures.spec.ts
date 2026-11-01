import { silenceJsdomCanvas } from './report-header-legacy.spec-helpers';
import { stripVolatile } from './report-theme.spec-helpers';
import { buildReportPdf } from './report-pdf';
import { readPdfRuns } from './report-pdf-read.spec-helpers';
import { MM_PT } from './report-signature-space';
import { SIGNERS, namesOf, renderSig, sigInput, type SigFixture } from './report-signature-space.spec-helpers';

/**
 * SIGNATURE SPACE DECIDER, on the real renderer (phase 6): where the sign-off
 * prints (department / end / every page), what prints (image / name only /
 * verified line) and the room kept for pre-printed stationery. WHO signs never
 * changes - these specs read the paper back through the draw recorder.
 */
describe('report PDF — signature space decider', () => {
  silenceJsdomCanvas();
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-30T05:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  const bytes = (f: SigFixture) => stripVolatile(Buffer.from(buildReportPdf(sigInput(f)).output('arraybuffer')).toString('latin1'));
  const pdfText = (doc: ReturnType<typeof buildReportPdf>) => readPdfRuns(Buffer.from(doc.output('arraybuffer')).toString('latin1')).map(r => r.text).join('\n');
  const eorOf = (boxes: ReturnType<typeof renderSig>['boxes']) => boxes.find(b => /End of Report/.test(b.text ?? ''))!;

  it('department / image / today\'s numbers: written out in full it is byte-identical to an untouched template', () => {
    for (const f of [{}, { departments: 3 }, { departments: 3, n: 7 }, { n: 4, blankLetterhead: true }] as SigFixture[]) {
      const explicit = { ...f, signatures: { placement: 'department', show: 'image', imageH: 24, maxPerRow: 4 } };
      expect(bytes(explicit)).toBe(bytes(f));
    }
  });

  describe('department (today)', () => {
    it('each department signs once, at its own foot, and a department change opens a new page', () => {
      const r = renderSig(sigInput({ departments: 3, n: 2 }));
      expect(r.pages).toBe(3);
      for (const { at } of namesOf(r.boxes, 2)) expect(at.map(b => b.page).sort()).toEqual([1, 2, 3]);
      expect(r.overlaps).toEqual([]);
    });
  });

  describe('end — one sign-off after End of Report', () => {
    it('merges the departments: each person once, on the last page, below End of Report', () => {
      const r = renderSig(sigInput({ departments: 3, n: 2, signatures: { placement: 'end' } }));
      const eor = eorOf(r.boxes);
      for (const { at } of namesOf(r.boxes, 2)) {
        expect(at).toHaveLength(1);
        expect(at[0].page).toBe(r.pages);
        expect(at[0].y).toBeGreaterThan(eor.y);
      }
      expect(r.overlaps).toEqual([]);
    });
    it('departments no longer end a page: fewer pages', () => {
      expect(renderSig(sigInput({ departments: 3, perDept: 3 })).pages).toBe(3);
      expect(renderSig(sigInput({ departments: 3, perDept: 3, signatures: { placement: 'end' } })).pages).toBe(1);
    });
    it('each signer keeps their own title; no department names are appended', () => {
      const r = renderSig(sigInput({ departments: 3, n: 2, signatures: { placement: 'end' } }));
      expect(r.boxes.some(b => /Biochemistry, Haematology/.test(b.text ?? ''))).toBe(false);
      expect(r.boxes.some(b => b.text === '(Lab Technician)')).toBe(true);
    });
    it('7 signatories sit in two rows, the last row at the page foot', () => {
      const r = renderSig(sigInput({ departments: 2, n: 7, signatures: { placement: 'end' } }));
      expect(new Set(namesOf(r.boxes).map(x => Math.round(x.at[0].y))).size).toBe(2);
      expect(r.overlaps).toEqual([]);
    });
  });

  describe('every page — the foot of every page', () => {
    it('prints the report-level signatories on every page, at the same height, and holds that room back from the results', () => {
      const r = renderSig(sigInput({ departments: 3, perDept: 14, signatures: { placement: 'every-page' }, templateSigs: [SIGNERS[5]] }));
      expect(r.pages).toBeGreaterThan(1);
      const on = r.boxes.filter(b => b.text === 'Karthik Subramanian');
      expect(on.map(b => b.page)).toEqual(Array.from({ length: r.pages }, (_, i) => i + 1));
      expect(new Set(on.map(b => Math.round(b.y))).size).toBe(1);
      expect(r.boxes.filter(b => b.text === 'Arun Kumar')).toHaveLength(0);
      expect(r.overlaps).toEqual([]);
      const top = Math.min(...on.map(b => b.y));
      const rows = r.boxes.filter(b => /^Analyte/.test(b.text ?? ''));
      expect(rows.length).toBeGreaterThan(0);
      for (const b of rows) expect(b.y + b.h).toBeLessThanOrEqual(top);
    });
    it('costs room on every page: results end higher', () => {
      const withBlock = renderSig(sigInput({ departments: 1, perDept: 60, signatures: { placement: 'every-page' }, templateSigs: [SIGNERS[5]] }));
      const without = renderSig(sigInput({ departments: 1, perDept: 60, templateSigs: [SIGNERS[5]] }));
      const lowest = (r: typeof withBlock, page: number) => Math.max(...r.boxes.filter(b => b.page === page && /^Analyte/.test(b.text ?? '')).map(b => b.y + b.h));
      expect(lowest(without, 1) - lowest(withBlock, 1)).toBeGreaterThan(0);
      expect(withBlock.pages).toBeGreaterThanOrEqual(without.pages);
    });
    it('with no report-level list it falls back to the people who sign the departments', () => {
      const r = renderSig(sigInput({ departments: 2, n: 2, signatures: { placement: 'every-page' } }));
      expect(namesOf(r.boxes, 2).map(x => x.at.length)).toEqual([r.pages, r.pages]);
    });
  });

  describe('what prints', () => {
    it('image: one image per signatory', () => {
      const withImg = renderSig(sigInput({ n: 3, images: true }));
      const none = renderSig(sigInput({ n: 3 }));
      expect(withImg.boxes.filter(b => b.kind === 'image').length - none.boxes.filter(b => b.kind === 'image').length).toBe(3);
    });
    it('image height scales the printed image', () => {
      const h = (imageH: number) => renderSig(sigInput({ n: 1, images: true, signatures: { imageH } })).boxes.filter(b => b.kind === 'image').pop()!;
      expect(h(24).h).toBeCloseTo(24, 4);
      expect(h(40).h).toBeCloseTo(40, 4);
      expect(h(40).w).toBeGreaterThan(h(24).w);
    });
    it('name only: names, titles and registration, no image and no scribble', () => {
      const r = renderSig(sigInput({ n: 3, images: true, signatures: { show: 'name-only' } }));
      const base = renderSig(sigInput({ n: 3, images: true, signatures: { show: 'image' } }));
      expect(r.boxes.filter(b => b.kind === 'image').length).toBe(base.boxes.filter(b => b.kind === 'image').length - 3);
      for (const { at } of namesOf(r.boxes, 3)) expect(at).toHaveLength(1);
      expect(r.boxes.some(b => b.text === 'Reg. TN-LT-4412')).toBe(true);
      expect(r.overlaps).toEqual([]);
    });
    it('verified line: one italic line per signatory with name, registration and the validation time', () => {
      const r = renderSig(sigInput({ n: 3, signatures: { show: 'verified-line' } }));
      const lines = r.boxes.filter(b => /^Electronically verified by/.test(b.text ?? ''));
      expect(lines).toHaveLength(3);
      expect(pdfText(r.doc)).toContain('Electronically verified by Dr. Meena Iyer (Reg. TNMC 88213) on 29 Sep 2026 09:45');
      expect(lines[1].y - lines[0].y).toBeCloseTo(10, 1);
      expect(r.boxes.some(b => b.text === 'Arun Kumar')).toBe(false);
      expect(r.overlaps).toEqual([]);
    });
    it('the lab\'s own wording is used', () => {
      const r = renderSig(sigInput({ n: 1, signatures: { show: 'verified-line', verifiedText: 'Signed off by {name}, {datetime}' } }));
      expect(pdfText(r.doc)).toContain('Signed off by Arun Kumar (Reg. TN-LT-4412), 29 Sep 2026 09:45');
    });
    it('a very long attestation wraps instead of running off the page', () => {
      const r = renderSig(sigInput({ n: 1, signatures: { show: 'verified-line', verifiedText: 'This report has been electronically verified by {name} after review of every result and the clinical correlation notes, on {datetime}, and is valid without a handwritten signature. '.repeat(2) } }));
      const eor = eorOf(r.boxes);
      const lines = r.boxes.filter(b => b.page === eor.page && b.kind === 'text' && b.y > eor.y + 4 && Math.abs(b.x - 30) < 1.5);
      expect(lines.length).toBeGreaterThan(1);
      expect(r.overlaps).toEqual([]);
      for (const b of lines) expect(b.x + b.w).toBeLessThanOrEqual(595.28 - 30 + 1);
    });
  });

  describe('maxPerRow', () => {
    it('2 per row turns 4 signatories into 2 + 2', () => {
      const r = renderSig(sigInput({ n: 4, signatures: { maxPerRow: 2 } }));
      expect(new Set(namesOf(r.boxes, 4).map(x => Math.round(x.at[0].y))).size).toBe(2);
    });
  });

  describe('reserve for pre-printed stationery', () => {
    const f = (mm: number | null, extra: Partial<SigFixture> = {}): SigFixture =>
      ({ n: 2, images: true, signatures: { show: 'image', ...(mm ? { reserveMm: mm } : {}) }, ...extra });
    it('keeps the room blank and prints names only - never an image over a printed one', () => {
      const r = renderSig(sigInput(f(45)));
      const plain = renderSig(sigInput(f(null)));
      expect(r.boxes.filter(b => b.kind === 'image').length).toBe(plain.boxes.filter(b => b.kind === 'image').length - 2);
      const names = namesOf(r.boxes, 2).map(x => x.at[0]);
      const foot = Math.max(...names.map(b => b.y + b.h));
      const first = Math.min(...names.map(b => b.y));
      const above = Math.max(...r.boxes.filter(b => b.page === names[0].page && b.y + b.h < first - 1 && b.kind === 'text').map(b => b.y + b.h));
      expect(first - above).toBeGreaterThanOrEqual(45 * MM_PT - (foot - first) - 14);
      expect(r.overlaps).toEqual([]);
    });
    it('the block is taller by the reserve: the results end that much higher', () => {
      const lowest = (r: ReturnType<typeof renderSig>) => Math.max(...r.boxes.filter(b => /^Analyte/.test(b.text ?? '')).map(b => b.y + b.h));
      expect(lowest(renderSig(sigInput(f(45, { perDept: 30 }))))).toBeLessThanOrEqual(lowest(renderSig(sigInput(f(null, { perDept: 30 })))));
    });
  });

  describe('overlaps - placements × departments × letterpad × what prints', () => {
    const placements = ['department', 'end', 'every-page'];
    const shows = ['image', 'name-only', 'verified-line'];
    for (const placement of placements) for (const show of shows) for (const departments of [1, 3]) for (const blankLetterhead of [false, true]) {
      it(`${placement} / ${show} / ${departments} dept / ${blankLetterhead ? 'letterpad' : 'letterhead'}`, () => {
        const r = renderSig(sigInput({ departments, n: 4, images: true, blankLetterhead, perDept: 12, signatures: { placement, show }, templateSigs: [SIGNERS[0], SIGNERS[1]] }));
        expect(r.overlaps).toEqual([]);
      });
    }
    it('7 signatories, every placement', () => {
      for (const placement of placements) {
        expect(renderSig(sigInput({ departments: 2, n: 7, images: true, perDept: 20, signatures: { placement } })).overlaps).toEqual([]);
      }
    });
    it('text fitting on (long names wrap) stays clear too', () => {
      for (const placement of placements) {
        expect(renderSig(sigInput({ departments: 2, n: 4, style: { fit: { enabled: true } }, signatures: { placement } })).overlaps).toEqual([]);
      }
    });
  });

  describe('page breaks - a sign-off is never orphaned onto an empty page', () => {
    const walk = (placement: string, perDept: number, departments: number, show = 'image') =>
      renderSig(sigInput({ departments, perDept, n: 3, signatures: { placement, show } }));
    it('the page that holds a signature also holds results (department and end), across the page boundary', () => {
      for (const placement of ['department', 'end']) {
        for (let n = 8; n <= 40; n++) {
          const r = walk(placement, n, 1);
          for (const { at } of namesOf(r.boxes, 3)) for (const b of at) {
            expect(r.boxes.some(x => x.page === b.page && /^Analyte/.test(x.text ?? ''))).toBe(true);
          }
        }
      }
    });
    it('End of Report always travels with the sign-off', () => {
      for (let n = 8; n <= 40; n++) {
        const r = walk('end', n, 1);
        const eor = eorOf(r.boxes);
        for (const { at } of namesOf(r.boxes, 3)) expect(at[0].page).toBe(eor.page);
      }
    });
    it('the end placement never needs more pages than the department placement', () => {
      for (const departments of [1, 2, 3]) for (let n = 3; n <= 18; n += 3) {
        expect(walk('end', n, departments).pages).toBeLessThanOrEqual(walk('department', n, departments).pages);
      }
    });
    it('every page: the block adds no page of its own when the body already fits', () => {
      expect(renderSig(sigInput({ departments: 1, perDept: 4, signatures: { placement: 'every-page' }, templateSigs: [SIGNERS[0]] })).pages).toBe(1);
    });
  });
});
