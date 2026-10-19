import { TestBed } from '@angular/core/testing';
import { OpdDeskPage, dueFilter, dueWhat } from './desk.page';
import { OpdVisitDetailPage } from './visit-detail.page';
import { collectDiscountProblem, collectPreview } from './desk-rules';
import type { OpdBillView, OpdVisitDetail, PaymentDue } from './desk.models';
import { BOARD, VISIT, flush, harness, row } from './opd-b.spec-helpers';

/**
 * The desk collects what the consult sent (pay after consult + procedures):
 * "Payments due" on the desk, every visit bill on the visit, a Collect box
 * (partial allowed, discount within the role cap) through the inline payment panel.
 */
afterEach(() => TestBed.resetTestingModule());

const PENDING: OpdBillView = {
  id: 'b1', kind: 'consult', invoiceNumber: 'OPB-2610-000011', subTotal: 2600, discount: 0, taxable: 2600, tax: 0, roundOff: 0,
  totalPayable: 2600, totalPaid: 0, balance: 2600, status: 'pending', payments: [],
  lines: [
    { sourceType: 'service', description: 'ENT consultation', qty: 1, unitPrice: 500, discount: 0, taxSlab: 0, total: 500 },
    { sourceType: 'procedure', description: 'Diagnostic nasal endoscopy · Right', qty: 1, unitPrice: 1500, discount: 0, taxSlab: 0, total: 1500 },
    { sourceType: 'procedure', description: 'Ear wax removal — set by Dr Ananya Rao (rule ₹400)', qty: 2, unitPrice: 300, discount: 0, taxSlab: 0, total: 600 },
  ],
};
const DUE_VISIT: OpdVisitDetail = { ...VISIT, status: 'completed', bill: PENDING, bills: [PENDING], due: 2600, labOrder: null };
const DUE: PaymentDue = {
  visitId: 'v1', billId: 'b1', kind: 'consult', invoiceNumber: 'OPB-2610-000011', patientId: 'p1', patientName: 'Mrs. Kavitha Ramesh', patientMeta: '42/F · AA0112',
  doctorUserId: 'd1', doctorName: 'Dr. Ananya Rao', tokenLabel: 'A3', visitNumber: 'OPD-2610-000011', visitDate: '2026-10-01', visitStatus: 'completed',
  lines: PENDING.lines, totalPayable: 2600, totalPaid: 0, balance: 2600, status: 'pending',
};

describe('Desk money rules (mirror of OpdVisitBilling / BillMath)', () => {
  it('collect preview: discount before GST, rupee round-off, balance after what is paid', () => {
    expect(collectPreview(PENDING, null)).toMatchObject({ payable: 2600, balance: 2600 });
    expect(collectPreview(PENDING, 200)).toMatchObject({ payable: 2400, balance: 2400, discount: 200 });
    expect(collectPreview({ ...PENDING, totalPaid: 1000 }, 200).balance).toBe(1400);
  });
  it('discount problems: role cap, more than the bill, below what is paid', () => {
    expect(collectDiscountProblem(PENDING, 200, 10)).toBeNull();
    expect(collectDiscountProblem(PENDING, 300, 10)).toContain('exceeds your limit of 10%');
    expect(collectDiscountProblem(PENDING, 1, 0)).toContain('limit of 0%');
    expect(collectDiscountProblem(PENDING, 3000, 100)).toContain('more than the bill');
    expect(collectDiscountProblem({ ...PENDING, totalPaid: 2500 }, 200, 100)).toContain('below what has already been paid');
  });
  it('due rows: what the bill is for, filtered by doctor and search', () => {
    expect(dueWhat(DUE)).toBe('Consultation + 2 procedures');
    expect(dueWhat({ lines: [PENDING.lines[1]] })).toBe('1 procedure');
    expect(dueFilter([DUE], 'd2', '')).toEqual([]);
    expect(dueFilter([DUE], 'd1', 'kavitha')).toHaveLength(1);
    expect(dueFilter([DUE], null, 'opb-2610')).toHaveLength(1);
  });
});

describe('OPD desk → Payments due', () => {
  it('a "Payments due" filter lists the open visit bills; a row opens the visit', () => {
    const h = harness({ get: url => (url.startsWith('/api/opd/queue/board') ? BOARD : url === '/api/opd/visits/payments-due' ? [DUE] : url.startsWith('/api/opd/visits') ? [row({ id: '1' })] : null) });
    TestBed.configureTestingModule({ imports: [OpdDeskPage], providers: h.providers });
    const f = TestBed.createComponent(OpdDeskPage); f.detectChanges();
    const el = f.nativeElement as HTMLElement, c = f.componentInstance;
    expect(c.counts().due).toBe(1);
    expect([...el.querySelectorAll('[role="radio"]')].map(b => b.textContent?.trim().replace(/\s+/g, ' '))).toContain('Payments due 1');
    c.filter.set('due'); f.detectChanges();
    const r = el.querySelector('[data-due]') as HTMLButtonElement;
    expect(r.textContent).toContain('Mrs. Kavitha Ramesh');
    expect(r.textContent).toContain('Consultation + 2 procedures');
    expect(r.textContent).toContain('2,600');
    expect(el.querySelector('[data-visit]')).toBeNull();
    r.click();
    expect(h.router.navigate).toHaveBeenCalledWith(['/opd/visit', 'v1']);
  });
});

describe('Visit detail → Collect', () => {
  function render(visit: OpdVisitDetail = DUE_VISIT, after: OpdVisitDetail = { ...DUE_VISIT, due: 1600, bills: [{ ...PENDING, totalPaid: 1000, balance: 1600, status: 'partial' }] }) {
    const h = harness({
      params: { id: 'v1' },
      get: url => (url === '/api/opd/visits/v1' ? visit : url === '/api/config/billing/visibility' ? { maxDiscountPct: 10, overrideDiscountPct: 25 } : null),
      post: url => (url.includes('/bills/') ? after : {}),
    });
    TestBed.configureTestingModule({ imports: [OpdVisitDetailPage], providers: h.providers });
    const f = TestBed.createComponent(OpdVisitDetailPage); f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance, ...h };
  }
  it('shows the line items with "set by Dr X (rule ₹Y)", and ONE primary = Collect', () => {
    const { el } = render();
    expect(el.textContent).toContain('Ear wax removal — set by Dr Ananya Rao (rule ₹400)');
    expect(el.textContent).toContain('2 × ');
    const p = el.querySelectorAll('.pf-btn--primary, .pf-hb-btn--primary');
    expect(p.length).toBe(1);
    expect(p[0].textContent).toContain('Collect');
    expect(p[0].textContent).toContain('2,600');
  });
  it('a pay-at-booking visit shows the paid consult bill and the procedure bill separately', () => {
    const paid: OpdBillView = { ...PENDING, id: 'b0', lines: [PENDING.lines[0]], totalPayable: 500, totalPaid: 500, balance: 0, status: 'paid' };
    const proc: OpdBillView = { ...PENDING, id: 'b2', kind: 'procedure', invoiceNumber: 'OPB-2610-000012', lines: PENDING.lines.slice(1), totalPayable: 2100, balance: 2100 };
    const { el, c } = render({ ...DUE_VISIT, bill: paid, bills: [paid, proc], due: 2100 });
    expect(el.querySelectorAll('[data-bill]').length).toBe(2);
    expect(el.querySelector('[data-bill="procedure"]')!.textContent).toContain('Procedure bill');
    expect(c.dueBill()!.id).toBe('b2');
  });
  it('collects part of the bill with a discount inside the cap (posted to the visit bill)', async () => {
    const { c, f, el, api, toasts } = render();
    c.startCollect(); f.detectChanges();
    expect(el.querySelector('[data-box="collect"] pf-inline-payment-panel')).toBeTruthy();
    c.discountRaw.set('200'); c.amountRaw.set('1000'); f.detectChanges();
    expect(c.discountErr()).toBeNull();
    expect(c.preview()!.balance).toBe(2400);
    await c.collect({ mode: 'cash', cashTendered: 1000 }); await flush();
    expect(api.post).toHaveBeenCalledWith('/api/opd/visits/v1/bills/b1/pay', { discount: 200, discountReason: null, payments: [{ mode: 'cash', amount: 1000, reference: null }] });
    expect(toasts.success).toHaveBeenCalledWith(expect.stringContaining('still due'));
  });
  it('a discount over the role cap blocks the collect (nothing posted)', async () => {
    const { c, f, api } = render();
    c.startCollect(); c.discountRaw.set('700'); f.detectChanges(); // 26.9 % > the 25 % override cap
    expect(c.discountErr()).toContain('exceeds your limit');
    await c.collect({ mode: 'cash', cashTendered: 2100 });
    expect(api.post).not.toHaveBeenCalled();
  });
  it('"Bill to vendor" is refused at the OPD desk', async () => {
    const { c, f, api, toasts } = render();
    c.startCollect(); f.detectChanges();
    await c.collect({ mode: 'wallet', vendorId: 'x' });
    expect(api.post).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalled();
  });
});
