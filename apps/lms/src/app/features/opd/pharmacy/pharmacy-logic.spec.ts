import { cartTotals, expiryLabel, monthsToExpiry, needsPrescription, needsRegister, scheduleLabel, taxableFromMrp, unitWords } from './pharmacy-math';
import { instructionFor, needsStrip, stripGlyphs, toRxLine, whatsAppText } from './pharmacy-instructions';
import { previewFefo } from './dispense.page';
import { counterGate } from './walk-in-counter.page';
import { buildDrugEdits, originWord, type DrugGridRow } from './drug-master.component';
import { filterStock } from './stock.page';
import { poLineTotal } from './purchase-orders.page';
import { gstinOk } from './suppliers.page';
import { returnable } from './returns.page';
import { waitingFor } from './rx-queue.page';
import { buildPharmacyPdf } from './pharmacy-print';
import { sayRx, stripDays } from '../shared/rx-schedule';
import type { RxLineView, StockRow } from './pharmacy.api';

/**
 * Pharmacy (OPD Agent D) — the pure pieces the screens stand on. The money
 * numbers are the SAME fixtures as the server's PharmacyRulesTests.cs (MRP
 * includes GST → BillMath: discount before GST, rupee round-off).
 */
describe('pharmacy math (mirror of PharmacyRules / PharmacyBilling)', () => {
  it('turns a GST-inclusive MRP into the taxable value (same fixtures as the server)', () => {
    expect(taxableFromMrp(112, 12)).toBe(100);
    expect(taxableFromMrp(105, 5)).toBe(100);
    expect(taxableFromMrp(50, 0)).toBe(50);
    expect(taxableFromMrp(22.4, 12)).toBe(20);
  });

  it('bills the mockup cart at ₹784 (MRP incl. 12% GST, rupee round-off)', () => {
    const t = cartTotals([
      { qty: 3, mrp: 23.8, taxSlab: 12 }, { qty: 25, mrp: 14.5, taxSlab: 12 }, { qty: 1, mrp: 285, taxSlab: 12 },
      { qty: 9, mrp: 2.2, taxSlab: 12 }, { qty: 1, mrp: 45, taxSlab: 12 },
    ]);
    expect(t.payable).toBe(784);
    expect(Math.abs(t.roundOff)).toBeLessThan(0.5);
    expect(t.cgst).toBe(t.sgst);
  });

  it('takes the discount off the taxable value before GST (101 / 100, same as the server)', () => {
    expect(cartTotals([{ qty: 1, mrp: 112, taxSlab: 12 }], 10).payable).toBe(101);
    expect(cartTotals([{ qty: 1, mrp: 112, taxSlab: 12 }], 10.5).payable).toBe(100);
    expect(cartTotals([{ qty: 2, mrp: 10.3, taxSlab: 12 }], 0, false)).toMatchObject({ tax: 0, payable: 21 });
  });

  it('schedules: H / H1 / X need a prescription; H1 / X go in the register', () => {
    expect(['none', 'G', 'H', 'H1', 'X'].map(needsPrescription)).toEqual([false, false, true, true, true]);
    expect(['none', 'G', 'H', 'H1', 'X'].map(needsRegister)).toEqual([false, false, false, true, true]);
    expect(scheduleLabel('H1')).toBe('Sch H1');
    expect(scheduleLabel('none')).toBe('OTC');
  });

  it('expiry and unit words', () => {
    expect(expiryLabel('2027-05-28')).toBe('05/2027');
    expect(monthsToExpiry('2026-12-28', '2026-09-30')).toBe(2);
    expect(monthsToExpiry('2026-09-01', '2026-09-30')).toBe(-1);
    expect(unitWords(1, 'bottle')).toBe('1 bottle');
    expect(unitWords(117, 'tab')).toBe('117 tabs');
  });
});

describe('picking and gates', () => {
  const B = (id: string, exp: string, qty: number, mrp = 10) => ({ id, batchNo: id, expiryDate: exp, mrp, qtyOnHand: qty });

  it('previews earliest expiry first, skips expired, splits across batches', () => {
    const t = previewFefo([B('LATE', '2028-01-28', 100), B('OLD', '2026-08-28', 50), B('SOON', '2026-12-28', 4)], 9, '2026-09-30');
    expect(t.map(x => [x.batchNo, x.qty])).toEqual([['SOON', 4], ['LATE', 5]]);
    expect(previewFefo([B('A', '2027-01-01', 2)], 5, '2026-09-30').reduce((a, x) => a + x.qty, 0)).toBe(2); // short → caller blocks
  });

  const d = (schedule: string) => ({ drug: { name: 'X-' + schedule, schedule } as never });
  it('counter gate mirrors EnforceSchedules', () => {
    expect(counterGate([d('none')], '', '', true)).toBeNull();
    expect(counterGate([d('H')], '', '', true)).toMatch(/prescription-only/);
    expect(counterGate([d('H')], 'Dr. Rao', '', true)).toBeNull();
    expect(counterGate([d('H')], '', '', false)).toBeNull();
    expect(counterGate([d('H1')], 'Dr. Rao', '', false)).toMatch(/customer/);
    expect(counterGate([d('H1')], '', 'Anand', false)).toMatch(/prescribing doctor/);
    expect(counterGate([d('H1')], 'Dr. Rao', 'Anand', true)).toBeNull();
  });
});

describe('drug master batch save (copy-on-write)', () => {
  const row = (p: Partial<DrugGridRow>): DrugGridRow => ({
    key: 'k', id: 'master-id', rowId: 'master-id', catalogKey: 'pf-x', origin: 'master', isMaster: true, name: 'A', form: 'tab',
    schedule: 'none', taxSlab: 12, aliases: [], isActive: true, ...p,
  });
  it('sends only the changed fields for an existing row, by its stable id', () => {
    const edits = buildDrugEdits(new Map([['k', { defaultMrp: 2.5 }]]), [row({})]);
    expect(edits).toEqual([{ id: 'master-id', defaultMrp: 2.5 }]);
  });
  it('a new row goes without an id (a lab-only drug) and carries its basics', () => {
    const edits = buildDrugEdits(new Map([['new-1', { name: 'House linctus' }]]), [row({ key: 'new-1', id: 'new-1', isNew: true, name: 'House linctus', form: 'syrup' })]);
    expect(edits[0]).toMatchObject({ id: null, name: 'House linctus', form: 'syrup', schedule: 'none', taxSlab: 12 });
  });
  it('names the source', () => {
    expect([originWord('master'), originWord('override'), originWord('local'), originWord('local', true)]).toEqual(['Master', 'Changed here', 'Your drug', 'New']);
  });
});

describe('patient instructions come from the shared Rx model', () => {
  const line = (schedule: RxLineView['schedule'], form: RxLineView['form'] = 'tab', dur = 5): Pick<RxLineView, 'drugId' | 'dose' | 'site' | 'schedule' | 'durationDays' | 'food' | 'form' | 'drugName'> =>
    ({ drugId: 'd1', dose: 1, site: null, schedule, durationDays: dur, food: 'After', form, drugName: 'Amoclav-PF 625' });

  it('uses sayRx verbatim — never a second sentence builder', () => {
    const l = line({ type: 'times', pat: [1, 0, 1] });
    const i = instructionFor(l);
    expect(i.say).toBe(sayRx(toRxLine(l), { form: 'tab' }));
    expect(i.say).toContain('after food');
    expect(i.strip).toBeNull(); // every day, same times → no strip
  });

  it('non-daily schedules get the 14-day strip (stripDays)', () => {
    const l = line({ type: 'days', mode: 'alt' }, 'tab', 14);
    const start = new Date(2026, 8, 28);
    const i = instructionFor(l, 'Substitute-PF', start);
    expect(i.name).toBe('Substitute-PF');
    expect(i.strip).toEqual(stripDays(toRxLine(l), start, 14));
    expect(stripGlyphs(i.strip!)).toBe('1 – 1 – 1 – 1 – 1 – 1 – 1 –');
    expect(needsStrip(toRxLine(line({ type: 'sos', max: 3, gap: 6 })))).toBe(false);
  });

  it('the WhatsApp message lists every medicine in plain words', () => {
    const lines = [instructionFor(line({ type: 'times', pat: [1, 0, 1] })), instructionFor(line({ type: 'days', mode: 'alt' }, 'tab', 14))];
    const text = whatsAppText({ patientFirstName: 'Kavitha', clinic: 'Micro World Clinic', doctor: 'Dr. Ananya Rao', lines });
    expect(text).toContain('Hello Kavitha');
    expect(text).toContain('1. *Amoclav-PF 625* — Take 1 tablet');
    expect(text).toContain('Next 14 days:');
  });

  it('prints one A5 sheet with the instructions, the strip and the bill', () => {
    const lines = [instructionFor(line({ type: 'days', mode: 'alt' }, 'tab', 14))];
    const doc = buildPharmacyPdf({
      clinic: 'Micro World Clinic', patientName: 'Kavitha', instructions: lines, number: 'PH-2609-00001',
      lines: [{ id: 'x', drugId: 'd1', drugName: 'Amoclav-PF 625', form: 'tab', schedule: 'H1', batchId: 'b', batchNo: 'AC1', expiryDate: '2027-01-28', qty: 7, mrp: 22.4, total: 156.8, returnedQty: 0 }],
      bill: { id: 'b', invoiceNumber: 'PH-2609-00001', subTotal: 140, discount: 0, totalTaxable: 140, totalCgst: 8.4, totalSgst: 8.4, totalTax: 16.8, roundOff: 0.2, totalPayable: 157, totalPaid: 157, balance: 0, status: 'paid', payments: [] },
    });
    expect(doc.getNumberOfPages()).toBe(1);
  });
});

describe('small helpers', () => {
  it('stock filters', () => {
    const r = (p: Partial<StockRow>): StockRow => ({ drugId: 'x', name: 'x', form: 'tab', schedule: 'none', onHand: 10, expiredQty: 0, batches: 1, low: false, ...p });
    const rows = [r({ drugId: 'low', low: true }), r({ drugId: 'soon', nearestExpiry: '2026-11-28' }), r({ drugId: 'exp', expiredQty: 3 }), r({ drugId: 'ok', nearestExpiry: '2028-01-01' })];
    expect(filterStock(rows, 'low', '2026-09-30').map(x => x.drugId)).toEqual(['low']);
    expect(filterStock(rows, 'expiring', '2026-09-30').map(x => x.drugId)).toEqual(['soon']);
    expect(filterStock(rows, 'expired', '2026-09-30').map(x => x.drugId)).toEqual(['exp']);
    expect(filterStock(rows, 'all', '2026-09-30')).toHaveLength(4);
  });
  it('PO line total incl. GST, GSTIN shape, returnable units, waiting time', () => {
    expect(poLineTotal({ qty: 100, unitCost: 1, taxSlab: 12 })).toBe(112);
    expect(gstinOk('33ABCDE1234F1Z5')).toBe(true);
    expect(gstinOk('123')).toBe(false);
    expect(gstinOk('')).toBe(true);
    expect(returnable({ qty: 10, returnedQty: 4 })).toBe(6);
    const now = Date.parse('2026-09-30T10:00:00Z');
    expect(waitingFor('2026-09-30T09:48:00Z', now)).toBe('12 min');
    expect(waitingFor('2026-09-30T07:55:00Z', now)).toBe('2 h 5 min');
    expect(waitingFor('2026-09-27T10:00:00Z', now)).toBe('3 d');
  });
});
