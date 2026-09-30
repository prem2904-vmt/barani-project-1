import {
  allocate, chargedFee, deskBillPreview, draftKey, feeLineLabel, parseOverride, paymentParts, readDraft, waitLabel, waitTone, writeDraft,
} from './desk-rules';
import type { ServiceQuote } from './desk.models';
import { tokenSlipText } from './token-slip';
import { statusWord, waitedLabel } from './visit-status';
import { deskFilter } from './desk.page';

/** Same fixtures as prefrontal-mw Prefrontal.Tests/Opd/FrontdeskRulesTests.cs. */
const ENT: ServiceQuote = {
  serviceId: 's1', name: 'ENT consultation', category: 'consultation', priceSource: 'per_doctor', price: 600, taxSlab: 0,
  isFollowUp: true, followUpFee: 300, followUpWithinDays: 7, quoted: 300,
};

describe('desk rules — fee', () => {
  it('charges the exact desk override, else the rule quote', () => {
    expect(chargedFee(300, 200)).toBe(200);
    expect(chargedFee(300, 0)).toBe(0);
    expect(chargedFee(300, null)).toBe(300);
  });
  it('notes the follow-up and the rule under an override (server text)', () => {
    expect(feeLineLabel('ENT consultation', false, 600, null)).toBe('ENT consultation');
    expect(feeLineLabel('ENT consultation', true, 300, 300)).toBe('ENT consultation (follow-up)');
    expect(feeLineLabel('ENT consultation', true, 300, 200)).toBe('ENT consultation (follow-up) — set at the desk (rule ₹300)');
  });
  it('parses the override as an exact rupee amount; blank = none; junk = NaN', () => {
    expect(parseOverride('')).toBeNull();
    expect(parseOverride('200')).toBe(200);
    expect(parseOverride('199.5')).toBe(199.5);
    expect(parseOverride('-1')).toBeNaN();
    expect(parseOverride('1.234')).toBeNaN();
  });
});

describe('desk rules — the billing card (two bills, one total)', () => {
  it('prices the consult through the BillMath mirror with GST and rupee round-off', () => {
    const p = deskBillPreview({ ...ENT, isFollowUp: false, quoted: 599.5, taxSlab: 18 }, null, []);
    expect(p.opd.tax).toBe(107.92);
    expect(p.opd.payable).toBe(707);
    expect(p.lab).toBeNull();
    expect(p.total).toBe(707);
  });
  it('keeps lab tests on their own lab bill and adds both to the total', () => {
    const p = deskBillPreview(ENT, 200, [{ id: 't1', name: 'AEC', price: 150, slab: 0 }]);
    expect(p.opd.payable).toBe(200);
    expect(p.lab!.payable).toBe(150);
    expect(p.opd.lines.length).toBe(1);
    expect(p.total).toBe(350);
  });
  it('allocates one tender OPD first, then the lab bill (server mirror)', () => {
    const a = allocate([{ mode: 'upi', amount: 500 }, { mode: 'cash', amount: 400 }], 600, 250);
    expect(a.opd.map(p => [p.mode, p.amount])).toEqual([['upi', 500], ['cash', 100]]);
    expect(a.lab.map(p => [p.mode, p.amount])).toEqual([['cash', 250]]);
    expect(a.unapplied).toBe(50);
  });
  it('maps the payment panel: cash / UPI / card / split; vendor and pay-later are refused', () => {
    expect(paymentParts({ mode: 'cash', cashTendered: 1000 }, 750)).toEqual([{ mode: 'cash', amount: 750, reference: null }]);
    expect(paymentParts({ mode: 'card', referenceNo: 'R1' }, 750)).toEqual([{ mode: 'card', amount: 750, reference: 'R1' }]);
    expect(paymentParts({ mode: 'split', splitParts: [{ mode: 'upi', amount: 500 }, { mode: 'cash', amount: 250 }] }, 750))
      .toEqual([{ mode: 'upi', amount: 500 }, { mode: 'cash', amount: 250 }]);
    expect(paymentParts({ mode: 'wallet', vendorId: 'v' }, 750)).toBeNull();
    expect(paymentParts({ mode: 'later' }, 750)).toBeNull();
  });
});

describe('desk rules — waits, draft, words', () => {
  it('labels doctor waits', () => {
    expect(waitLabel(0, 0)).toBe('Free now');
    expect(waitLabel(3, 36)).toBe('3 waiting · ~36 min');
    expect(waitTone(0, 0)).toBe('free');
    expect(waitTone(3, 36)).toBe('ok');
    expect(waitTone(5, 60)).toBe('long');
  });
  it('saves and restores the draft per user × branch, expiring after 12 h, tolerating broken storage', () => {
    const mem = new Map<string, string>();
    const s = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    const k = draftKey('u1', 'b1');
    expect(k).toBe('pf:opd-desk-draft:u1:b1');
    writeDraft(s, k, { patientId: 'p1', doctorId: 'd1', savedAt: 1000 });
    expect(readDraft(s, k, 2000)?.doctorId).toBe('d1');
    expect(readDraft(s, k, 1000 + 13 * 3600 * 1000)).toBeNull();
    writeDraft(s, k, null);
    expect(readDraft(s, k, 2000)).toBeNull();
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => undefined };
    expect(readDraft(broken, k)).toBeNull();
    expect(() => writeDraft(broken, k, { savedAt: 1 })).not.toThrow();
  });
  it('words statuses and waits', () => {
    expect(statusWord('in_consult')).toBe('In consult');
    expect(statusWord('no_show')).toBe('Did not come');
    const now = new Date('2026-09-30T10:00:00Z');
    expect(waitedLabel('2026-09-30T09:48:00Z', now)).toBe('12 min');
    expect(waitedLabel('2026-09-30T08:55:00Z', now)).toBe('1 h 5 min');
    expect(waitedLabel('2026-09-30T10:00:00Z', now)).toBe('just now');
  });
});

describe('desk list filter', () => {
  const row = (id: string, status: any, doctor = 'd1', name = 'Kavitha Ramesh') => ({
    id, patientId: 'p', patientName: name, patientMeta: '42/F · AA0112', doctorUserId: doctor, doctorName: 'Dr', visitDate: '2026-09-30',
    token: 1, tokenLabel: 'A1', status, isFollowUp: false, charged: 600, hasLabOrder: false, createdAt: '', vitalsFlagged: false,
  });
  const rows = [row('1', 'waiting'), row('2', 'vitals'), row('3', 'in_consult', 'd2'), row('4', 'completed'), row('5', 'cancelled', 'd1', 'Suresh')];
  it('filters by status group, doctor and search', () => {
    expect(deskFilter(rows, 'waiting', null, '').map(r => r.id)).toEqual(['1', '2']);
    expect(deskFilter(rows, 'done', null, '').map(r => r.id)).toEqual(['4', '5']);
    expect(deskFilter(rows, 'all', 'd2', '').map(r => r.id)).toEqual(['3']);
    expect(deskFilter(rows, 'all', null, 'sur').map(r => r.id)).toEqual(['5']);
    expect(deskFilter(rows, 'all', null, 'aa0112').length).toBe(5);
    expect(deskFilter(rows, 'all', null, 'a1').length).toBe(5); // exact token
  });
});

describe('token slip', () => {
  it('prints the token, patient, doctor, bill and the lab step', () => {
    const t = tokenSlipText({
      id: 'v', visitNumber: 'OPD-2609-000001', visitDate: '2026-09-30', token: 3, tokenLabel: 'A3', status: 'waiting', source: 'walk_in',
      isFollowUp: false, quotedFee: 600, patient: { id: 'p', name: 'Mrs. Kavitha Ramesh', mrn: 'AA0112' },
      doctor: { id: 'd', name: 'Dr. Ananya Rao', department: 'ENT' }, service: { id: 's', name: 'ENT consultation' },
      bill: { id: 'b', kind: 'consult', invoiceNumber: 'OPB-2609-000001', lines: [], subTotal: 600, discount: 0, taxable: 600, tax: 0, roundOff: 0, totalPayable: 600, totalPaid: 600, balance: 0, status: 'paid', payments: [] },
      labOrder: { id: 'o', orderNumber: 'LAB-1', status: 'billed', tests: 1, payable: 150, paid: 150, balance: 0 },
      timeline: [], createdAt: '2026-09-30T04:30:00Z',
    }, 'Micro World Clinic');
    expect(t.token).toBe('A3');
    expect(t.lines[0]).toBe('Micro World Clinic');
    expect(t.lines).toContain('Mrs. Kavitha Ramesh · AA0112');
    expect(t.lines).toContain('Dr. Ananya Rao · ENT');
    expect(t.lines.some(l => l.startsWith('OPB-2609-000001 · ₹600 paid'))).toBe(true);
    expect(t.lines.some(l => l.includes('LAB-1') && l.includes('sample collection'))).toBe(true);
  });
});
