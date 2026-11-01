import type { ReportSignature } from '../models/report.model';
import { DEFAULT_REPORT_STYLE } from './report-style';
import { layoutSignatureBlock, SIG_ROW, SIG_VERIFIED, signatureRowSizes } from './report-signatures';
import {
  effectiveShow, formatVerifiedStamp, mergeSignatories, MM_PT, planSignatures, sigOptsFrom, signatureCost,
  signatureImageBox, signatureReadout, signatureStyleOf, verifiedLine,
} from './report-signature-space';
import { SIGNERS } from './report-signature-space.spec-helpers';

const USABLE = 535;
const style = (o: Record<string, unknown> = {}) => signatureStyleOf({ signatures: o as never });
const sigs = (n: number): ReportSignature[] => SIGNERS.slice(0, n);

describe('signature space — the plan (pure)', () => {
  it('today\'s settings are "no options": the renderer stays on its original path', () => {
    expect(sigOptsFrom(style())).toBeUndefined();
    expect(sigOptsFrom(style({ placement: 'end' }))).toBeUndefined();
    expect(sigOptsFrom(style({ show: 'name-only' }))).toBeDefined();
    expect(sigOptsFrom(style({ imageH: 30 }))).toBeDefined();
  });

  it('with no options the layout is exactly today\'s', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      expect(layoutSignatureBlock(sigs(n), 30, USABLE, 100, undefined, sigOptsFrom(style()))).toEqual(layoutSignatureBlock(sigs(n), 30, USABLE, 100));
    }
  });

  describe('1 / 2 / 3 / 4 / 7 signatories × what prints', () => {
    const cases: Array<[number, number[]]> = [[1, [1]], [2, [2]], [3, [3]], [4, [4]], [7, [4, 3]]];
    for (const [n, rows] of cases) {
      it(`${n} signator${n === 1 ? 'y' : 'ies'} → rows ${JSON.stringify(rows)}`, () => {
        for (const show of ['image', 'name-only'] as const) {
          const plan = planSignatures({ style: style({ show }), departments: [{ department: 'A', sigs: sigs(n) }], usableW: USABLE });
          expect(plan.blocks[0].rowSizes).toEqual(rows);
          expect(plan.rows).toBe(rows.length);
          expect(plan.count).toBe(n);
        }
        const img = planSignatures({ style: style(), departments: [{ department: 'A', sigs: sigs(n) }], usableW: USABLE });
        const nameOnly = planSignatures({ style: style({ show: 'name-only' }), departments: [{ department: 'A', sigs: sigs(n) }], usableW: USABLE });
        expect(nameOnly.blockH).toBeLessThan(img.blockH);
        expect(img.blockH).toBe(rows.length * (SIG_ROW.lead + 20 + 16 + 11 + 10 + SIG_ROW.tail));
        expect(nameOnly.blockH).toBe(rows.length * (SIG_ROW.lead - 8 + 16 + 11 + 10 + SIG_ROW.tail));
      });
      it(`${n} verified line${n === 1 ? '' : 's'} take ${12 + 10 * n} pt`, () => {
        const plan = planSignatures({ style: style({ show: 'verified-line' }), departments: [{ department: 'A', sigs: sigs(n) }], usableW: USABLE });
        expect(plan.blockH).toBe(SIG_VERIFIED.lead + SIG_VERIFIED.line * n + SIG_VERIFIED.tail);
        expect(plan.rows).toBe(n);
      });
    }
  });

  it('image height moves the block by exactly the difference; the box scales and never overflows its slot', () => {
    const at = (imageH: number) => planSignatures({ style: style({ imageH }), departments: [{ department: 'A', sigs: sigs(2) }], usableW: USABLE }).blockH;
    expect(at(40) - at(24)).toBe(16);
    expect(at(16) - at(24)).toBe(-8);
    expect(signatureImageBox(24, 133)).toEqual({ w: 70, h: 24 });
    const big = signatureImageBox(40, 133);
    expect(big.w).toBeLessThanOrEqual(133 - 6);
    expect(big.h).toBeGreaterThan(24);
    const narrow = signatureImageBox(40, 90);
    expect(narrow.w).toBe(84);
    expect(narrow.h).toBeLessThan(40);
  });

  it('"at most N per row" balances the rows', () => {
    const rows = (maxPerRow: number, n: number) =>
      planSignatures({ style: style({ maxPerRow }), departments: [{ department: 'A', sigs: sigs(n) }], usableW: USABLE }).blocks[0].rowSizes;
    expect(rows(3, 7)).toEqual(signatureRowSizes(7, 3));
    expect(rows(2, 4)).toEqual([2, 2]);
    expect(rows(6, 4)).toEqual([4]);
  });

  describe('placement', () => {
    const depts = ['Biochemistry', 'Haematology', 'Serology'].map(d => ({ department: d, sigs: sigs(2) }));
    it('department: one block per department', () => {
      const plan = planSignatures({ style: style(), departments: depts, usableW: USABLE });
      expect(plan.blocks.map(b => b.label)).toEqual(['Biochemistry', 'Haematology', 'Serology']);
      expect(plan.perPageH).toBe(0);
    });
    it('end: ONE block, a user who signs two departments appears once, with their own title', () => {
      const plan = planSignatures({ style: style({ placement: 'end' }), departments: depts, usableW: USABLE });
      expect(plan.blocks).toHaveLength(1);
      expect(plan.blocks[0].sigs.map(s => s.name)).toEqual(['Arun Kumar', 'Dr. Meena Iyer']);
      expect(plan.blocks[0].sigs[0].title).toBe('Lab Technician');
      expect(plan.perPageH).toBe(0);
    });
    it('end keeps every title as it is', () => {
      expect(mergeSignatories([{ department: 'A', sigs: sigs(2) }, { department: 'B', sigs: sigs(2) }]).map(s => s.title)).toEqual(['Lab Technician', 'MD Biochemistry']);
    });
    it('end keeps different people and caps at seven', () => {
      const merged = mergeSignatories([{ department: 'A', sigs: sigs(5) }, { department: 'B', sigs: SIGNERS.slice(3, 7) }]);
      expect(merged.map(s => s.name)).toEqual(SIGNERS.map(s => s.name));
      expect(merged).toHaveLength(7);
    });
    it('every-page: costs the block height on every page, report-level list first', () => {
      const plan = planSignatures({ style: style({ placement: 'every-page' }), departments: depts, reportLevel: [SIGNERS[5]], usableW: USABLE });
      expect(plan.blocks[0].sigs.map(s => s.name)).toEqual(['Karthik Subramanian']);
      expect(plan.perPageH).toBe(plan.blockH);
      expect(plan.perPageH).toBeGreaterThan(0);
      const fallback = planSignatures({ style: style({ placement: 'every-page' }), departments: depts, usableW: USABLE });
      expect(fallback.blocks[0].sigs).toHaveLength(2);
    });
  });

  describe('stationery reserve', () => {
    it('an image never prints over a printed signature: the reserve means names only', () => {
      expect(effectiveShow({ show: 'image', reserveMm: 40 })).toBe('name-only');
      expect(effectiveShow({ show: 'image', reserveMm: null })).toBe('image');
      expect(effectiveShow({ show: 'verified-line', reserveMm: 40 })).toBe('verified-line');
    });
    it('the block takes at least the reserve, and says when the names need more', () => {
      const ok = planSignatures({ style: style({ reserveMm: 40 }), departments: [{ department: 'A', sigs: sigs(2) }], usableW: USABLE });
      expect(ok.blockH).toBeCloseTo(40 * MM_PT, 5);
      expect(ok.reservedH).toBeCloseTo(40 * MM_PT, 5);
      expect(ok.reserveTooSmall).toBe(false);
      const small = planSignatures({ style: style({ reserveMm: 5 }), departments: [{ department: 'A', sigs: sigs(7) }], usableW: USABLE });
      expect(small.reserveTooSmall).toBe(true);
      expect(small.blockH).toBeGreaterThan(5 * MM_PT);
    });
    it('nobody to sign reserves nothing', () => {
      expect(planSignatures({ style: style({ reserveMm: 40 }), departments: [{ department: 'A', sigs: [] }], usableW: USABLE }).blockH).toBe(0);
    });
  });

  describe('readout', () => {
    it('says count, rows, mm and where', () => {
      const p = planSignatures({ style: style(), departments: [{ department: 'A', sigs: sigs(2) }], usableW: USABLE });
      expect(signatureReadout(p)).toBe(`2 signatories · 1 row · ${Math.round(p.blockH / MM_PT)} mm · at the end of each department`);
      const p7 = planSignatures({ style: style({ placement: 'end' }), departments: [{ department: 'A', sigs: sigs(7) }], usableW: USABLE });
      expect(signatureReadout(p7)).toMatch(/^7 signatories · 2 rows · \d+ mm · once, after End of Report$/);
      const v = planSignatures({ style: style({ show: 'verified-line' }), departments: [{ department: 'A', sigs: sigs(1) }], usableW: USABLE });
      expect(signatureReadout(v)).toMatch(/^1 signatory · 1 line · \d+ mm/);
      const e = planSignatures({ style: style({ placement: 'every-page' }), departments: [{ department: 'A', sigs: sigs(3) }], usableW: USABLE });
      expect(signatureReadout(e)).toMatch(/at the foot of every page$/);
      expect(signatureCost(e)).toMatch(/on every page/);
      expect(signatureReadout(planSignatures({ style: style(), departments: [], usableW: USABLE }))).toBe('No signatories to print.');
    });
    it('the readout height is the height the layout reports (one source)', () => {
      for (const n of [1, 2, 3, 4, 7]) {
        const p = planSignatures({ style: style({ show: 'name-only' }), departments: [{ department: 'A', sigs: sigs(n) }], usableW: USABLE });
        expect(p.blockH).toBe(layoutSignatureBlock(sigs(n), 0, USABLE, 0, undefined, sigOptsFrom(style({ show: 'name-only' }))).height);
      }
    });
  });

  describe('verified line', () => {
    const stamp = '01 Nov 2026 14:32';
    const text = DEFAULT_REPORT_STYLE.signatures.verifiedText;
    it('names, registration and time', () => {
      expect(verifiedLine(SIGNERS[1], text, stamp)).toBe('Electronically verified by Dr. Meena Iyer (Reg. TNMC 88213) on 01 Nov 2026 14:32');
    });
    it('no registration, no brackets; {reg} placed by the lab is used as written', () => {
      expect(verifiedLine({ name: 'Dr X' }, text, stamp)).toBe('Electronically verified by Dr X on 01 Nov 2026 14:32');
      expect(verifiedLine({ name: 'Dr X', regNo: '7' }, 'Verified: {name}, reg {reg}, {datetime}', stamp)).toBe('Verified: Dr X, reg 7, 01 Nov 2026 14:32');
    });
    it('no time known drops the "on ..." tail instead of printing a hole', () => {
      expect(verifiedLine({ name: 'Dr X' }, text, '')).toBe('Electronically verified by Dr X');
    });
    it('formats the stamp', () => {
      expect(formatVerifiedStamp('2026-11-01T14:32:00')).toBe('01 Nov 2026 14:32');
      expect(formatVerifiedStamp('nonsense')).toBe('');
      expect(formatVerifiedStamp(undefined)).toBe('');
    });
  });
});
