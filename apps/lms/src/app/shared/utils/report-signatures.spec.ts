import { jsPDF } from 'jspdf';
import { buildReportPdf, footerFloor } from './report-pdf';
import {
  layoutSignatureBlock, presentSignatures, signatureCentres, signatureRowSizes, signaturesPerRow,
  SIG_MIN_W,
} from './report-signatures';
import type { ReportSignature } from '../models/report.model';

/**
 * Adaptive report sign-off (owner, 2026-09-28): signatures take only the
 * room the signatories ACTUALLY present need, laid out by count —
 * 1 → right, 2 → left/right, 3 → L/C/R, 4 → even; 5-7 wrap into balanced
 * rows (4 per row max on A4) — and a page/report without signatures loses
 * no space to them.
 */

const H = 841.89;
const W = 595.28;
const MX = 30;
const USABLE = W - 2 * MX;
const SLOT = USABLE / 4;

function sig(i: number, extra: Partial<ReportSignature> = {}): ReportSignature {
  return { name: `Dr. Signer ${String.fromCharCode(65 + i)}`, title: 'Pathologist', ...extra };
}
const sigs = (n: number) => Array.from({ length: n }, (_, i) => sig(i));

// ── Rendering helpers ────────────────────────────────────────────

interface Txt { page: number; x: number; y: number; text: string; }

/** Every text draw in the PDF with its page and TOP-DOWN baseline (pt). */
function texts(pdf: string): Txt[] {
  const out: Txt[] = [];
  // jsPDF writes each page's content stream in page order; images are
  // separate XObjects (no BT operator), so text streams == pages.
  const streams = pdf.split('endstream').map(s => s.slice(s.lastIndexOf('stream') + 6)).filter(s => s.includes(' Tj'));
  streams.forEach((s, p) => {
    const re = /(-?[\d.]+) (-?[\d.]+) Td\s*\(((?:\\.|[^\\)])*)\) Tj/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) out.push({ page: p + 1, x: +m[1], y: H - +m[2], text: m[3].replace(/\\(.)/g, '$1') });
  });
  return out;
}

function render(opts: { rows?: number; depts?: Array<{ name: string; rows: number; sigs?: Array<ReportSignature | Record<string, never>> }>; sigs?: Array<ReportSignature | Record<string, never>> }): { pdf: string; t: Txt[]; pages: number } {
  const depts = opts.depts ?? [{ name: 'Haematology', rows: opts.rows ?? 6, sigs: opts.sigs }];
  const tests = depts.map((d, di) => ({
    testId: `t${di}`, name: `Panel ${d.name}`, department: d.name, sampleType: 'EDTA Whole Blood',
    result: { values: Object.fromEntries(Array.from({ length: d.rows }, (_, i) => [
      `ROW${di}_${String(i).padStart(2, '0')}`, { value: String(10 + i), unit: 'g/dL', range: '5 - 50' },
    ])) },
  }));
  const snap = {
    patient: { displayName: 'Sita Raman', age: 37, sex: 'Female' },
    order: { id: 'o1', orderNumber: 'LAB-2609-000042', createdAt: '2026-09-20T04:30:00Z' },
    type: 'final',
    tests,
    deptSignatures: depts.filter(d => d.sigs).map(d => ({ department: d.name, signatures: d.sigs })),
  };
  const doc = buildReportPdf({
    report: { id: 'r1', type: 'final', createdAt: '2026-09-20T06:00:00Z', data: JSON.stringify(snap) },
    template: null,
  } as never);
  const pdf = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  return { pdf, t: texts(pdf), pages: doc.getNumberOfPages() };
}

/** Centre x of a centred bold-9.5 name, from its drawn left x. */
function nameCentre(t: Txt): number {
  const m = new jsPDF({ unit: 'pt', format: 'a4' });
  m.setFont('helvetica', 'bold');
  m.setFontSize(9.5);
  return t.x + m.getTextWidth(t.text) / 2;
}
const names = (t: Txt[]) => t.filter(x => x.text.startsWith('Dr. Signer'));

describe('signature layout rules (pure)', () => {
  it('per-row max comes from the usable width and the minimum readable slot', () => {
    expect(SIG_MIN_W).toBe(120);
    expect(signaturesPerRow(USABLE)).toBe(4);
  });

  it('1 → right, 2 → left/right, 3 → left/centre/right, 4 → four evenly spaced', () => {
    expect(signatureCentres(1, MX, USABLE, SLOT)).toEqual([W - MX - SLOT / 2]);
    const two = signatureCentres(2, MX, USABLE, SLOT);
    expect(two[0]).toBeCloseTo(MX + SLOT / 2);
    expect(two[1]).toBeCloseTo(W - MX - SLOT / 2);
    const three = signatureCentres(3, MX, USABLE, SLOT);
    expect(three[0]).toBeCloseTo(MX + SLOT / 2);
    expect(three[1]).toBeCloseTo(W / 2);
    expect(three[2]).toBeCloseTo(W - MX - SLOT / 2);
    const four = signatureCentres(4, MX, USABLE, SLOT);
    four.forEach((x, i) => expect(x).toBeCloseTo(MX + SLOT * (i + 0.5)));
  });

  it('5-7 wrap into balanced rows, fullest first (5 → 3+2, 6 → 3+3, 7 → 4+3)', () => {
    expect([1, 2, 3, 4].map(n => signatureRowSizes(n, 4))).toEqual([[1], [2], [3], [4]]);
    expect(signatureRowSizes(5, 4)).toEqual([3, 2]);
    expect(signatureRowSizes(6, 4)).toEqual([3, 3]);
    expect(signatureRowSizes(7, 4)).toEqual([4, 3]);
    expect(signatureRowSizes(0, 4)).toEqual([]);
  });

  it('reserved height scales with the actual count: 0 → 0, 1-4 → one row, 5-7 → two rows', () => {
    const h = (n: number) => layoutSignatureBlock(sigs(n), MX, USABLE).height;
    expect(h(0)).toBe(0);
    expect(h(1)).toBeGreaterThan(0);
    expect([2, 3, 4].map(h)).toEqual([h(1), h(1), h(1)]);
    expect([5, 6, 7].map(h)).toEqual([2 * h(1), 2 * h(1), 2 * h(1)]);
    // Rows only grow for the lines they print: no title/reg → shorter.
    expect(layoutSignatureBlock([{ name: 'A' }], MX, USABLE).height).toBeLessThan(h(1));
    expect(layoutSignatureBlock([sig(0, { regNo: 'TN-1' })], MX, USABLE).height).toBeGreaterThan(h(1));
  });

  it('7 configured but 2 present → laid out (and sized) as 2', () => {
    const configured = [sig(0), {}, { title: 'Microbiologist' }, null, sig(1), { name: '  ' }, undefined];
    expect(presentSignatures(configured as never).map(s => s.name)).toEqual(['Dr. Signer A', 'Dr. Signer B']);
    const block = layoutSignatureBlock(configured as never, MX, USABLE);
    expect(block.rows.map(r => r.slots.length)).toEqual([2]);
    expect(block.height).toBe(layoutSignatureBlock(sigs(2), MX, USABLE).height);
    expect(block.rows[0].slots.map(s => s.cx)).toEqual(signatureCentres(2, MX, USABLE, SLOT));
  });
});

describe('signature layout on paper', () => {
  it.each([1, 2, 3, 4])('%i signature(s): one row at the rule\'s x positions', n => {
    const got = names(render({ sigs: sigs(n) }).t);
    expect(got.map(t => t.text)).toEqual(sigs(n).map(s => s.name));
    expect(new Set(got.map(t => t.y)).size).toBe(1);
    const want = signatureCentres(n, MX, USABLE, SLOT);
    got.forEach((t, i) => expect(nameCentre(t)).toBeCloseTo(want[i], 0));
  });

  it('7 signatures: two rows, 4 evenly spaced then 3 at left/centre/right', () => {
    const got = names(render({ sigs: sigs(7) }).t);
    expect(got).toHaveLength(7);
    const rows = [...new Set(got.map(t => t.y))].sort((a, b) => a - b);
    expect(rows).toHaveLength(2);
    const top = got.filter(t => t.y === rows[0]), bottom = got.filter(t => t.y === rows[1]);
    expect(top).toHaveLength(4);
    expect(bottom).toHaveLength(3);
    top.forEach((t, i) => expect(nameCentre(t)).toBeCloseTo(signatureCentres(4, MX, USABLE, SLOT)[i], 0));
    bottom.forEach((t, i) => expect(nameCentre(t)).toBeCloseTo(signatureCentres(3, MX, USABLE, SLOT)[i], 0));
  });

  it.each([[5, [3, 2]], [6, [3, 3]]])('%i signatures wrap as %j', (n, sizes) => {
    const got = names(render({ sigs: sigs(n as number) }).t);
    const rows = [...new Set(got.map(t => t.y))].sort((a, b) => a - b);
    expect(rows.map(y => got.filter(t => t.y === y).length)).toEqual(sizes);
  });

  it('7 configured, 2 present → one row, left + right', () => {
    const configured = [sig(0), {}, {}, sig(1), {}, {}, {}];
    const got = names(render({ sigs: configured }).t);
    expect(got).toHaveLength(2);
    expect(got[0].y).toBe(got[1].y);
    const want = signatureCentres(2, MX, USABLE, SLOT);
    got.forEach((t, i) => expect(nameCentre(t)).toBeCloseTo(want[i], 0));
  });

  it('the sign-off sits at the page foot; its top rises only by the rows actually drawn', () => {
    const top = (n: number) => Math.min(...names(render({ sigs: sigs(n) }).t).map(t => t.y));
    const one = top(1), two = top(2), four = top(4), seven = top(7);
    expect(two).toBe(one);
    expect(four).toBe(one);
    const rowH = layoutSignatureBlock(sigs(1), MX, USABLE).height;
    expect(one - seven).toBeCloseTo(rowH, 0);
    // Last row ends on the footer floor, below the End-of-Report marker.
    const r = render({ sigs: sigs(2) });
    const end = r.t.find(t => t.text.includes('End of Report'))!;
    expect(names(r.t)[0].y).toBeGreaterThan(end.y);
    expect(names(r.t)[0].y).toBeGreaterThan(H - 150);
  });

  it('no signatures → no reserved footer space: page 1 fills to the normal floor', () => {
    const r = render({ rows: 70 });
    expect(r.pages).toBeGreaterThan(1);
    const floor = footerFloor(null);
    const lowest = Math.max(...r.t.filter(t => t.page === 1 && t.text.startsWith('ROW')).map(t => t.y));
    // The old fixed 150pt floor stopped rows at h-150; now they run to the footer band.
    expect(lowest).toBeGreaterThan(H - 150 + 40);
    expect(lowest).toBeLessThanOrEqual(H - floor);
  });

  it('a multi-page department reserves its sign-off ONLY on the page it ends on', () => {
    const plain = render({ rows: 70 });
    const signed = render({ rows: 70, sigs: sigs(7) });
    const p1 = (r: typeof plain) => r.t.filter(t => t.page === 1 && t.text.startsWith('ROW')).map(t => t.text);
    // Page 1 carries exactly the same rows with or without 7 signatories.
    expect(p1(signed)).toEqual(p1(plain));
  });

  it('never orphans the sign-off: wherever the table ends, the signing page keeps result rows', () => {
    for (let rows = 20; rows <= 44; rows++) {
      for (const n of [2, 7]) {
        const r = render({ rows, sigs: sigs(n) });
        const sigPage = names(r.t)[0].page;
        expect(names(r.t).every(t => t.page === sigPage)).toBe(true);
        const rowsThere = r.t.filter(t => t.page === sigPage && t.text.startsWith('ROW'));
        expect(rowsThere.length, `rows=${rows} sigs=${n}`).toBeGreaterThan(0);
        // …and nothing prints under the footer floor.
        expect(Math.max(...names(r.t).map(t => t.y))).toBeLessThan(H - 40);
      }
    }
  });

  it('an earlier department signs at the foot of its own last page, never alone', () => {
    for (let rows = 20; rows <= 40; rows += 2) {
      const r = render({ depts: [
        { name: 'Haematology', rows, sigs: [sig(0), sig(1), sig(2)] },
        { name: 'Biochemistry', rows: 4, sigs: [sig(3)] },
      ] });
      const first = names(r.t).filter(t => t.text !== 'Dr. Signer D');
      expect(first).toHaveLength(3);
      expect(r.t.some(t => t.page === first[0].page && t.text.startsWith('ROW0_')), `rows=${rows}`).toBe(true);
    }
  });
});
