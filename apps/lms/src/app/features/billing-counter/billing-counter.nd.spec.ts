import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { BillingCounterComponent, orderTestCount, waitingLabel } from './billing-counter.component';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { ScanService } from '../../core/services/scan.service';
import { AuthService } from '../../core/auth/auth.service';
import { TenantStateService } from '../../core/services/tenant-state.service';
import { NavBackService } from '../../core/services/nav-back.service';
import { ProcessWorkflowService } from '../../core/services/process-workflow.service';
import { ProcessWorkflowConfig } from '../../shared/models/process-workflow.model';

/**
 * Billing counter (ND-PATTERN §17): the band + ONE pill search, a LEFT queue
 * of patients waiting to pay (oldest first), the cart + payment taken right
 * here in the main card (Order & Payments' inline panel), a compact success
 * state with Next patient, and the MONEY summary card on the right.
 */
const PATIENT = { id: 'p1', firstName: 'Paravai', fathersName: 'Munusamy', age: 44, sex: 'Female', mrn: 'AA0007', phone: '9000000001' };
const PATIENT3 = { id: 'p3', firstName: 'Anbu', fathersName: 'Selvan', age: 30, sex: 'Male', mrn: 'AA0003', phone: '9000000003' };
const PATIENT4 = { id: 'p4', firstName: 'Meena', fathersName: 'Kumari', age: 25, sex: 'Female', mrn: 'AA0004', phone: '9000000004' };
const ORDER = {
  id: 'o1', orderNumber: 'LAB-2609-000085', patientId: 'p1', branchId: 'b1', priority: 'Normal', source: 'walk_in',
  status: 'created', collectionType: 'walk_in', createdAt: '2026-09-26T08:00:00Z', billStatus: 'unpaid', totalAmount: 1200,
  patient: PATIENT, samples: [{ id: 's1', status: 'pending', createdAt: '', tests: [{ id: 't1', name: 'Haemoglobin' }, { id: 't2', name: 'Lipid profile' }] }],
};
const ORDER3 = {
  ...ORDER, id: 'o3', orderNumber: 'LAB-2609-000080', patientId: 'p3', createdAt: '2026-09-26T07:00:00Z', patient: PATIENT3,
  samples: [{ id: 's3', status: 'pending', createdAt: '', tests: [{ id: 't1', name: 'Haemoglobin' }] }],
};
const ORDER4 = {
  ...ORDER, id: 'o4', orderNumber: 'LAB-2609-000090', patientId: 'p4', createdAt: '2026-09-26T09:00:00Z', patient: PATIENT4,
  billStatus: 'unbilled', totalAmount: 450,
  samples: [{ id: 's4', status: 'pending', createdAt: '', tests: [{ id: 't3', name: 'TSH' }, { id: 't4', name: 'T3' }, { id: 't5', name: 'T4' }] }],
};
const ORDERS: Record<string, any> = { o1: ORDER, o3: ORDER3, o4: ORDER4 };
const DUE = { billId: 'b1', orderId: 'o1', patientId: 'p1', patientName: 'Paravai Munusamy', totalPayable: 1200, totalPaid: 200, balance: 1000, status: 'partial', createdAt: '2026-09-26T08:01:00Z' };
const DUE3 = { billId: 'b3', orderId: 'o3', patientId: 'p3', patientName: 'Anbu Selvan', totalPayable: 300, totalPaid: 0, balance: 300, status: 'pending', createdAt: '2026-09-26T07:01:00Z' };
const REFUND = { billId: 'b2', orderId: 'o2', patientId: 'p2', patientName: 'Kavin Raj', totalPayable: 300, totalPaid: 500, balance: -200, status: 'paid', createdAt: '2026-09-25T08:00:00Z' };
const RECON = {
  date: '2026-09-26', payments: [{ mode: 'cash', count: 1, total: 1 }, { mode: 'upi', count: 2, total: 500 }],
  refunds: [{ mode: 'card', count: 1, total: 50 }], totalCollected: 501, totalRefunded: 50, net: 451,
};
const BILL1 = { id: 'b1', orderId: 'o1', totalPayable: 1200, totalPaid: 200, balance: 1000, totalDiscount: 100, totalTax: 0, invoiceNumber: 'INV-000123',
  items: [{ id: 'i1', testName: 'Haemoglobin', price: 200, total: 200 }, { id: 'i2', testName: 'Lipid profile', price: 1100, total: 1000 }] };

/** A (stray, pre-fixed-slot) collection copy in the billing counter's own menu.
 *  Sample Collection now sits only in Collect / Frontdesk / Lab, so this is
 *  NOT a placement: the counter never offers "Collect sample". */
const WF_COLLECT_AT_BILLING: ProcessWorkflowConfig = {
  categories: [
    { id: 'frontdesk', name: 'FD', icon: 'folder', color: '#000', order: 0 },
    { id: 'billdesk', name: 'Billing', icon: 'folder', color: '#000', order: 1 },
  ],
  actions: [
    { id: 'reg', type: 'patient_registration', categoryId: 'frontdesk', order: 0, enabled: true },
    { id: 'bill', type: 'billing', categoryId: 'billdesk', order: 0, enabled: true },
    { id: 'coll', type: 'sample_collection', categoryId: 'billdesk', order: 1, enabled: true },
  ],
};
/** Billing at its counter, collection at a separate one. */
const WF_COLLECT_ELSEWHERE: ProcessWorkflowConfig = {
  ...WF_COLLECT_AT_BILLING,
  actions: WF_COLLECT_AT_BILLING.actions.map(a => a.type === 'sample_collection' ? { ...a, categoryId: 'collect' } : a),
};

interface Opts {
  narrow?: boolean; phone?: boolean; lookupFails?: boolean; empty?: boolean;
  workflow?: ProcessWorkflowConfig | null; canRefund?: boolean;
  /** The server already flags o1's balance as Pay later. */
  o1PayLater?: boolean;
  gate?: 'none' | 'dispatch' | 'report';
}

function render(opts: Opts = {}) {
  (window as any).matchMedia = (q: string) => ({
    matches: q.includes('900px') ? !!(opts.narrow || opts.phone) : q.includes('640px') ? !!opts.phone : false,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  // Live balances per bill, so an advance leaves the rest due.
  const bal: Record<string, number> = { b1: 1000, b3: 300, b4: 450 };
  const stamped = new Set<string>(opts.o1PayLater ? ['b1'] : []);
  let created = false;
  const payable: Record<string, number> = { b1: 1200, b3: 300, b4: 450 };
  const billNow = (id: string, extra: any = {}) => ({
    ...BILL1, id, orderId: extra.orderId ?? BILL1.orderId, patientId: 'p1', createdAt: '2026-09-26T08:01:00Z',
    totalPayable: payable[id] ?? 1200, totalPaid: (payable[id] ?? 1200) - (bal[id] ?? 0), balance: bal[id] ?? 0,
    status: (bal[id] ?? 0) <= 0 ? 'paid' : 'pending', ...extra,
  });
  const api = {
    get: vi.fn((url: string) => {
      if (url.startsWith('/api/billing/outstanding')) {
        if (opts.empty) return of({ due: [], refundsOwed: [] });
        // Like the server: live balances, the payLater stamp, bills raised here.
        const row = (d: any) => ({ ...d, balance: bal[d.billId], totalPaid: payable[d.billId] - bal[d.billId], payLater: stamped.has(d.billId) });
        const due = [DUE, DUE3, ...(created ? [{ ...DUE, billId: 'b4', orderId: 'o4', patientId: 'p4', patientName: 'Meena Kumari', createdAt: '2026-09-26T09:05:00Z' }] : [])]
          .map(row).filter(r => r.balance > 0);
        return of({ due, refundsOwed: [REFUND] });
      }
      if (url === '/api/tenants/branch-lab-config') return of(opts.gate ? { paymentGateStage: opts.gate } : null);
      if (url.startsWith('/api/billing/reconcile')) return of(RECON);
      if (url.startsWith('/api/billing/lookup')) return opts.lookupFails ? throwError(() => new Error('No order matches that code')) : of({ orderId: 'o1' });
      if (url.startsWith('/api/billing/b1')) return of(BILL1);
      if (url.startsWith('/api/billing/b3')) return of({ ...BILL1, id: 'b3', orderId: 'o3', totalPayable: 300, totalPaid: 0, balance: 300, totalDiscount: 0, items: [] });
      if (url.startsWith('/api/billing/b2')) return of({ ...BILL1, id: 'b2', orderId: 'o2', totalPayable: 300, totalPaid: 500, balance: -200, totalDiscount: 0, items: [] });
      if (url === '/api/orders/today') return of(opts.empty ? [] : [ORDER, ORDER4]);
      if (url.startsWith('/api/orders/')) {
        const id = url.split('/')[3];
        return of(ORDERS[id] ?? { ...ORDER, id, patient: { id: 'p2', firstName: 'Kavin', fathersName: 'Raj' } });
      }
      if (url.startsWith('/api/patients?')) return of([PATIENT]);
      if (url.startsWith('/api/patients/')) return of({ patient: PATIENT, history: [ORDER] });
      return of(null);
    }),
    post: vi.fn((url: string, body: any) => {
      if (url === '/api/billing/') created = true;
      if (url === '/api/billing/') return of({ ...BILL1, id: 'b4', orderId: body.orderId, totalPayable: 450, totalPaid: 0, balance: 450, totalDiscount: 0, items: [] });
      if (url.endsWith('/payment')) {
        const id = url.split('/')[3];
        bal[id] = Math.max(0, (bal[id] ?? 0) - body.amount);
        return of(billNow(id));
      }
      if (url.endsWith('/pay-later')) {
        const id = url.split('/')[3];
        stamped.add(id);
        return of(billNow(id, { orderId: id === 'b4' ? 'o4' : id === 'b3' ? 'o3' : 'o1', metadata: '{"payLater":{}}' }));
      }
      if (url.endsWith('/refund')) return of({ ...BILL1, id: 'b2', orderId: 'o2', totalPayable: 300, totalPaid: 300, balance: 0, items: [] });
      return of({});
    }),
  };
  const router = { navigate: vi.fn(), navigateByUrl: vi.fn() };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  const process = { active: signal<ProcessWorkflowConfig | null>(opts.workflow ?? null), loadActive: vi.fn() };
  TestBed.configureTestingModule({
    imports: [BillingCounterComponent],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toasts },
      { provide: ScanService, useValue: { manualEntry: () => false } },
      { provide: AuthService, useValue: {
        user: () => ({ id: 'u1', tenantName: 'Micro World' }),
        hasPermission: (c: string) => c !== 'process_refund' || opts.canRefund !== false,
      } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }) } },
      { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn() } },
      { provide: ProcessWorkflowService, useValue: process },
      { provide: Router, useValue: router },
    ],
  });
  const f = TestBed.createComponent(BillingCounterComponent);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const c = f.componentInstance as any;
  return { f, el, c, api, router, toasts, process };
}

const flush = () => new Promise(r => setTimeout(r, 0));
const primaries = (el: HTMLElement) => el.querySelectorAll('.nd-btn--primary, .pf-hb-btn--primary');
const neverToOrderScreen = (router: { navigate: any; navigateByUrl: any }) => {
  for (const call of router.navigate.mock.calls) expect(JSON.stringify(call)).not.toContain('/frontdesk/order');
  for (const call of router.navigateByUrl.mock.calls) expect(String(call[0])).not.toContain('/frontdesk/order');
};

// render() swaps window.matchMedia; put the runner's own back afterwards so
// other spec files (pointer-mode, band layouts) never see ours.
const realMatchMedia = (window as any).matchMedia;

// This runner has no Web Storage: an in-memory one for the remembered collapse.
beforeEach(() => {
  const mem = new Map<string, string>();
  const store = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => mem.clear(),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true });
});
afterEach(() => {
  TestBed.resetTestingModule();
  (window as any).matchMedia = realMatchMedia;
});

describe('Billing counter — the queue (LEFT)', () => {
  it('stacks everyone waiting to pay, OLDEST first: bills due + today\'s unbilled orders', () => {
    const { el, c } = render();
    expect(c.queue().map((r: any) => r.orderId)).toEqual(['o3', 'o1', 'o4']);
    const rows = el.querySelectorAll('.pf-bc-queue .pf-bc-qrow');
    expect(rows.length).toBe(3);
    // Name (wraps, never cut) · order number · tests · amount · waiting since.
    expect(rows[1].querySelector('.pf-bc-qrow__name')?.textContent?.trim()).toBe('Paravai Munusamy');
    expect(rows[1].querySelector('.pf-bc-qrow__meta')?.textContent).toContain('LAB-2609-000085');
    expect(rows[1].querySelector('.pf-bc-qrow__meta')?.textContent).toContain('2 tests');
    expect(rows[1].querySelector('.pf-bc-qrow__amt')?.textContent).toContain('1,000');
    expect(rows[1].querySelector('.pf-bc-qrow__wait')?.textContent?.trim()).toBeTruthy();
    // The unbilled order bills its order total and says so.
    expect(rows[2].querySelector('.pf-bc-qrow__amt')?.textContent).toContain('450');
    expect(rows[2].querySelector('.pf-bc-qrow__meta')?.textContent).toContain('Not billed yet');
    // Refunds owed are not in the queue (they stay in MONEY).
    expect(el.querySelector('.pf-bc-queue')?.textContent).not.toContain('Kavin Raj');
    // An older balance not in today's feed was read for its details.
    const oldest = c.queue()[0];
    expect(oldest.orderLabel).toBe('LAB-2609-000080');
    expect(oldest.tests).toBe(1);
  });

  it('the pill filters the queue (name, order number, phone) and says when nothing matches', () => {
    const { f, el, c } = render();
    c.query.set('paravai');
    f.detectChanges();
    expect(Array.from(el.querySelectorAll('.pf-bc-qrow__name')).map(n => n.textContent?.trim())).toEqual(['Paravai Munusamy']);
    c.query.set('000090');
    expect(c.filteredQueue().map((r: any) => r.orderId)).toEqual(['o4']);
    c.query.set('9000000003');
    expect(c.filteredQueue().map((r: any) => r.orderId)).toEqual(['o3']);
    c.query.set('zzz');
    f.detectChanges();
    expect(el.querySelectorAll('.pf-bc-qrow').length).toBe(0);
    expect(el.querySelector('.pf-bc-queue')?.textContent).toContain('No one in the queue matches');
    expect(el.querySelector('.pf-bc-queue .nd-card__head')?.textContent).toContain('0 of 3');
  });

  it('empty queue: "No one waiting to pay"', () => {
    const { el } = render({ empty: true });
    expect(el.querySelector('.pf-bc-queue .pf-bc-empty__title')?.textContent?.trim()).toBe('No one waiting to pay');
    expect(primaries(el).length).toBe(0);
  });

  it('refreshes gently: a poll re-reads the outstanding bills and today\'s orders', () => {
    const { c, api } = render();
    api.get.mockClear();
    c.poll();
    const urls = api.get.mock.calls.map((x: any[]) => x[0]);
    expect(urls).toContain('/api/billing/outstanding');
    expect(urls).toContain('/api/orders/today');
  });

  it('waitingLabel / orderTestCount helpers', () => {
    const t0 = new Date('2026-09-26T08:00:00Z').getTime();
    expect(waitingLabel('2026-09-26T08:00:00Z', t0 + 20_000)).toBe('just now');
    expect(waitingLabel('2026-09-26T08:00:00Z', t0 + 12 * 60_000)).toBe('12 min');
    expect(waitingLabel('2026-09-26T08:00:00Z', t0 + 125 * 60_000)).toBe('2 h 5 min');
    expect(waitingLabel('2026-09-26T08:00:00Z', t0 + 3 * 86_400_000)).toBe('3 d');
    expect(orderTestCount(ORDER as any)).toBe(2);
  });
});

describe('Billing counter — select → cart → pay here', () => {
  it('clicking a patient shows their cart: items, discount, Payable / Paid / Balance and the payment panel', async () => {
    const { f, el, c } = render();
    (el.querySelectorAll('.pf-bc-qrow')[1] as HTMLButtonElement).click();
    f.detectChanges();
    await flush();
    f.detectChanges();
    expect(c.selectedOrderId()).toBe('o1');
    expect(el.querySelector('.pf-bc-qrow[aria-pressed="true"]')?.textContent).toContain('Paravai Munusamy');
    const main = el.querySelector('.pf-bc-main')!;
    expect(main.querySelector('.pf-bc-subject__name')?.textContent).toContain('Paravai Munusamy');
    expect(main.querySelectorAll('.pf-bc-item').length).toBe(2);
    const dues = main.querySelector('.pf-bc-dues')!.textContent!;
    expect(dues).toContain('Discount');
    expect(dues).toContain('Payable');
    expect(dues).toContain('Paid');
    expect(main.querySelector('.pf-bc-dues__bal')?.textContent).toContain('1,000');
    // Order & Payments' own payment panel — Pay later included (a neutral
    // choice in the panel's track, not a second primary).
    const panel = main.querySelector('pf-inline-payment-panel');
    expect(panel).toBeTruthy();
    expect(panel!.textContent).toContain('Pay now');
    expect(panel!.textContent).toContain('Pay later');
    // Until the panel is complete the CTA is a disabled secondary: no primary.
    expect(primaries(el).length).toBe(0);
    const cta = main.querySelector('.nd-card__foot .pf-bc-primary') as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
    expect(cta.textContent).toMatch(/Collect ₹1,000/);
  });

  it('ONE primary "Collect ₹X" once the mode is set; paying records it on the bill and never leaves the counter', async () => {
    const { f, el, c, api, router } = render();
    c.selectRow(c.queue()[1]);
    f.detectChanges();
    await flush();
    f.detectChanges();
    c.payPanel().setMode('upi');
    f.detectChanges();
    const ps = primaries(el);
    expect(ps.length).toBe(1);
    expect(ps[0].textContent).toMatch(/Collect ₹1,000/);
    (ps[0] as HTMLButtonElement).click();
    await flush();
    f.detectChanges();
    expect(api.post).toHaveBeenCalledWith('/api/billing/b1/payment', { amount: 1000, mode: 'upi', referenceNo: undefined });
    neverToOrderScreen(router);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('after payment: compact success, the patient drops off the queue, Next patient opens the next in line', async () => {
    const { f, el, c } = render();
    c.selectRow(c.queue()[1]);             // Paravai (o1)
    f.detectChanges();
    await flush();
    f.detectChanges();
    c.payPanel().setMode('upi');
    f.detectChanges();
    c.runCollect();
    await flush();
    f.detectChanges();
    const done = el.querySelector('.pf-bc-done')!;
    expect(done).toBeTruthy();
    expect(done.textContent).toContain('₹1,000');
    expect(done.textContent).toContain('received');
    expect(done.textContent).toContain('UPI');
    expect(done.textContent).toContain('INV-000123');
    // Dropped off the list.
    expect(c.queue().map((r: any) => r.orderId)).toEqual(['o3', 'o4']);
    expect(el.querySelector('.pf-bc-queue')?.textContent).not.toContain('Paravai');
    // Print receipt (secondary) + Next patient (the one primary).
    const foot = el.querySelector('.pf-bc-main .nd-card__foot')!;
    expect(Array.from(foot.querySelectorAll('.nd-btn--secondary')).map(b => b.textContent?.trim())).toContain('Print receipt');
    const ps = primaries(el);
    expect(ps.length).toBe(1);
    expect(ps[0].textContent?.trim()).toBe('Next patient');
    (ps[0] as HTMLButtonElement).click();
    f.detectChanges();
    expect(c.selectedOrderId()).toBe('o3');
    expect(c.paid()).toBeNull();
  });

  it('an order with no bill yet is billed on payment (POST bill, then the payment)', async () => {
    const { f, c, api } = render();
    c.selectRow(c.queue()[2]);             // o4, unbilled
    f.detectChanges();
    await flush();
    f.detectChanges();
    expect(c.payAmount()).toBe(450);
    await c.confirmPayment({ mode: 'card', referenceNo: 'AP123' });
    expect(api.post).toHaveBeenCalledWith('/api/billing/', { orderId: 'o4', discount: 0 });
    expect(api.post).toHaveBeenCalledWith('/api/billing/b4/payment', { amount: 450, mode: 'card', referenceNo: 'AP123' });
    expect(c.queue().map((r: any) => r.orderId)).toEqual(['o3', 'o1']);
  });

  it('split pays each part', async () => {
    const { f, c, api } = render();
    c.selectRow(c.queue()[1]);
    f.detectChanges();
    await flush();
    await c.confirmPayment({ mode: 'split', splitParts: [{ mode: 'cash', amount: 400 }, { mode: 'upi', amount: 600 }] });
    expect(api.post).toHaveBeenCalledWith('/api/billing/b1/payment', { amount: 400, mode: 'cash' });
    expect(api.post).toHaveBeenCalledWith('/api/billing/b1/payment', { amount: 600, mode: 'upi' });
  });
});

describe('Billing counter — Pay later', () => {
  async function openO1(opts: Opts = {}) {
    const r = render(opts);
    r.c.selectRow(r.c.queue().find((x: any) => x.orderId === 'o1'));
    r.f.detectChanges();
    await flush();
    r.f.detectChanges();
    return r;
  }

  it('is available in the cart; picking it makes the ONE primary "Save — pay later"', async () => {
    const { f, el, c } = await openO1();
    const kinds = Array.from(el.querySelectorAll('.pf-ipp__kind')).map(b => b.textContent?.trim());
    expect(kinds).toContain('Pay later');
    // At rest (cash, nothing typed) there is no primary.
    expect(primaries(el).length).toBe(0);
    (Array.from(el.querySelectorAll('.pf-ipp__kind')).find(b => b.textContent?.trim() === 'Pay later') as HTMLButtonElement).click();
    f.detectChanges();
    expect(c.laterPicked()).toBe(true);
    const ps = primaries(el);
    expect(ps.length).toBe(1);
    expect(ps[0].textContent?.trim()).toBe('Save — pay later');
    // The Pay-later choice itself is never violet primary.
    expect(el.querySelector('.pf-ipp__kind.nd-btn--primary')).toBeNull();
    // With an advance the label says what is collected now.
    c.payPanel().setAdvance('300');
    f.detectChanges();
    expect(primaries(el).length).toBe(1);
    expect(primaries(el)[0].textContent).toMatch(/Collect ₹300(\.00)? — rest later/);
  });

  it('QA #3b: an advance above the balance is an inline error and the CTA is not ready', async () => {
    const { f, el, c } = await openO1();
    c.payPanel().setKind('later');
    c.payPanel().setAdvance('1500');          // o1 owes ₹1,000
    f.detectChanges();
    expect(el.querySelector('.pf-ipp__err')?.textContent).toContain("Advance can't be more than the bill");
    expect(c.collectReady()).toBe(false);
    expect(primaries(el).length).toBe(0);
    expect(c.collectLabel()).toBe('Save — pay later');
  });

  it('records the bill with its balance (no payment), stamps it pay-later, shows the saved state', async () => {
    const { f, el, c, api, router, toasts } = await openO1();
    await c.confirmPayment({ mode: 'later' });
    f.detectChanges();
    const posts = api.post.mock.calls.map((x: any[]) => x[0]);
    expect(posts).toEqual(['/api/billing/b1/pay-later']);
    expect(posts.some((u: string) => u.endsWith('/payment'))).toBe(false);
    const done = el.querySelector('.pf-bc-done')!;
    expect(done.textContent).toContain('Bill saved');
    expect(done.textContent).toMatch(/₹1,000(\.00)?\s*due later/);
    expect(done.textContent).toContain('Paravai Munusamy');
    expect(toasts.success).toHaveBeenCalledWith(expect.stringContaining('due later'));
    // Print the bill (secondary) + Next patient (the ONE primary).
    const foot = el.querySelector('.pf-bc-main .nd-card__foot')!;
    expect(Array.from(foot.querySelectorAll('.nd-btn--secondary')).map(b => b.textContent?.trim())).toContain('Print bill');
    const ps = primaries(el);
    expect(ps.length).toBe(1);
    expect(ps[0].textContent?.trim()).toBe('Next patient');
    neverToOrderScreen(router);
  });

  it('an advance is recorded as a payment; the rest stays due', async () => {
    const { f, el, c, api } = await openO1();
    await c.confirmPayment({ mode: 'later', advanceAmount: 300, advanceMode: 'upi' });
    f.detectChanges();
    expect(api.post).toHaveBeenCalledWith('/api/billing/b1/payment', { amount: 300, mode: 'upi' });
    expect(api.post).toHaveBeenCalledWith('/api/billing/b1/pay-later', {});
    expect(c.paid().due).toBe(700);
    expect(el.querySelector('.pf-bc-done')?.textContent).toMatch(/₹700(\.00)?\s*due later/);
    expect(el.querySelector('.pf-bc-done')?.textContent).toMatch(/₹300(\.00)?\s*advance · UPI/);
    expect(c.due().find((r: any) => r.orderId === 'o1').balance).toBe(700);
  });

  it('an order with no bill yet is billed, then saved for later', async () => {
    const { f, c, api } = render();
    c.selectRow(c.queue().find((x: any) => x.orderId === 'o4'));
    f.detectChanges();
    await flush();
    await c.confirmPayment({ mode: 'later' });
    expect(api.post).toHaveBeenCalledWith('/api/billing/', { orderId: 'o4', discount: 0 });
    expect(api.post).toHaveBeenCalledWith('/api/billing/b4/pay-later', {});
    expect(c.queue().map((r: any) => r.orderId)).not.toContain('o4');
    expect(c.due().find((r: any) => r.orderId === 'o4')?.balance).toBe(450);
  });

  it('leaves the "waiting to pay" queue at once and shows in MONEY → Balances due', async () => {
    const { f, el, c } = await openO1();
    await c.confirmPayment({ mode: 'later' });
    f.detectChanges();
    expect(c.queue().map((r: any) => r.orderId)).toEqual(['o3', 'o4']);
    expect(el.querySelector('.pf-bc-queue')?.textContent).not.toContain('Paravai');
    const mrow = Array.from(el.querySelectorAll('.pf-bc-side .pf-bc-mrow')).find(r => r.textContent?.includes('Paravai'))!;
    expect(mrow).toBeTruthy();
    expect(mrow.textContent).toContain('Pay later');
    expect(mrow.querySelector('.pf-bc-mrow__amt')?.textContent).toContain('1,000');
    // A refresh that still lists the balance keeps them off the queue.
    c.poll();
    f.detectChanges();
    expect(c.queue().map((r: any) => r.orderId)).not.toContain('o1');
  });

  it('the server flag keeps a pay-later balance off the queue for every cashier', () => {
    const { el, c } = render({ o1PayLater: true });
    expect(c.queue().map((r: any) => r.orderId)).toEqual(['o3', 'o4']);
    expect(el.querySelector('.pf-bc-side')?.textContent).toContain('Paravai Munusamy');
  });

  it('picking the balance in MONEY reopens the cart with "Collect ₹X" and Pay later again', async () => {
    const { f, el, c } = render({ o1PayLater: true });
    const mrow = Array.from(el.querySelectorAll('.pf-bc-side .pf-bc-mrow')).find(r => r.textContent?.includes('Paravai')) as HTMLButtonElement;
    mrow.click();
    f.detectChanges();
    await flush();
    f.detectChanges();
    expect(c.selectedOrderId()).toBe('o1');
    const cta = el.querySelector('.pf-bc-main .nd-card__foot .pf-bc-primary') as HTMLButtonElement;
    expect(cta.textContent).toMatch(/Collect ₹1,000/);
    const kinds = Array.from(el.querySelectorAll('.pf-ipp__kind')).map(b => b.textContent?.trim());
    expect(kinds).toContain('Pay later');
    c.payPanel().setMode('upi');
    f.detectChanges();
    expect(primaries(el).length).toBe(1);
  });

  it('respects the payment gate: nothing but the bill is touched; the note names the gate', async () => {
    const dispatch = await openO1({ gate: 'dispatch' });
    await dispatch.c.confirmPayment({ mode: 'later' });
    dispatch.f.detectChanges();
    const urls = dispatch.api.post.mock.calls.map((x: any[]) => x[0]);
    expect(urls.every((u: string) => u.startsWith('/api/billing/'))).toBe(true);
    expect(dispatch.el.querySelector('.pf-bc-done__hint')?.textContent).toContain('dispatch');
    TestBed.resetTestingModule();
    const report = await openO1({ gate: 'report' });
    await report.c.confirmPayment({ mode: 'later' });
    report.f.detectChanges();
    expect(report.el.querySelector('.pf-bc-done__hint')?.textContent).toContain('report');
  });

  it('a stray collection copy at the billing counter: no "Collect sample" after Pay later (fixed slots)', async () => {
    const { f, el, c } = await openO1({ workflow: WF_COLLECT_AT_BILLING });
    await c.confirmPayment({ mode: 'later' });
    f.detectChanges();
    expect(c.collectsHere()).toBe(false);
    expect(Array.from(primaries(el)).some(p => p.textContent?.trim() === 'Collect sample')).toBe(false);
  });
});

describe('Billing counter — collect sample only when the workflow says so', () => {
  async function payFirst(opts: Opts) {
    const r = render(opts);
    r.c.selectRow(r.c.queue()[1]);
    r.f.detectChanges();
    await flush();
    await r.c.confirmPayment({ mode: 'upi' });
    r.f.detectChanges();
    return r;
  }
  const hasCollect = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('button')).some(b => /collect sample/i.test(b.textContent ?? ''));

  it('no workflow → no "Collect sample"', async () => {
    const { el, c } = await payFirst({ workflow: null });
    expect(c.collectsHere()).toBe(false);
    expect(el.querySelector('.pf-bc-done')).toBeTruthy();
    expect(hasCollect(el)).toBe(false);
    expect(el.querySelector('.pf-bc-done')?.textContent).toContain('sample collection now');
  });

  it('collection at a different counter → no "Collect sample"; they go on to the collection queue', async () => {
    const { el, c } = await payFirst({ workflow: WF_COLLECT_ELSEWHERE });
    expect(c.collectsHere()).toBe(false);
    expect(hasCollect(el)).toBe(false);
  });

  it('a stray collection copy AT the billing counter → still no "Collect sample" (fixed slots)', async () => {
    const { el, c } = await payFirst({ workflow: WF_COLLECT_AT_BILLING });
    expect(c.collectsHere()).toBe(false);
    expect(hasCollect(el)).toBe(false);
  });
});

describe('Billing counter — refunds owed', () => {
  it('a refund owed makes the ONE primary "Refund ₹X", taken here', async () => {
    const { f, el, c, api, router } = render();
    c.openOrder('o2');
    f.detectChanges();
    await flush();
    f.detectChanges();
    const ps = primaries(el);
    expect(ps.length).toBe(1);
    expect(ps[0].textContent).toMatch(/Refund ₹200/);
    expect(el.querySelector('pf-inline-payment-panel')).toBeNull();
    (ps[0] as HTMLButtonElement).click();
    expect(api.post).toHaveBeenCalledWith('/api/billing/b2/refund', { amount: 200, mode: 'cash', reason: 'Refunded at the billing counter' });
    neverToOrderScreen(router);
  });

  it('without refund permission there is no primary, just a note', async () => {
    const { f, el, c } = render({ canRefund: false });
    c.openOrder('o2');
    f.detectChanges();
    await flush();
    f.detectChanges();
    expect(primaries(el).length).toBe(0);
    expect(el.querySelector('.pf-bc-main')?.textContent).toContain('refund permission');
  });
});

describe('Billing counter — band + unified pill search', () => {
  it('renders the band with ONE search in the pill and the scan icon inside it', () => {
    const { el } = render();
    const band = el.querySelector('pf-hero-band')!;
    const input = band.querySelector('.pf-hb__search .pf-bc-us__input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.placeholder).toBe('Search patient, phone, MRN, order or invoice ID');
    expect(band.querySelector('.pf-hb__inline .pf-bc-scan')).toBeTruthy();
    expect(band.querySelectorAll('.pf-hb__search input[type="text"]').length).toBe(1);
  });

  it('type-ahead groups Patients and Orders & invoices in one dropdown', async () => {
    vi.useFakeTimers();
    try {
      const { f, el, api } = render();
      const c = f.componentInstance as any;
      c.onQuery('LAB-2609');
      vi.advanceTimersByTime(250);
      f.detectChanges();
      expect(api.get).toHaveBeenCalledWith('/api/patients?q=LAB-2609');
      expect(api.get).toHaveBeenCalledWith('/api/billing/lookup?code=LAB-2609');
      const drop = el.querySelector('#pf-bc-drop')!;
      const titles = Array.from(drop.querySelectorAll('.pf-bc-drop__title')).map(t => t.textContent?.trim());
      expect(titles).toEqual(['Patients', 'Orders & invoices']);
      const ev = new KeyboardEvent('keydown');
      c.onArrow(ev, 1); c.onArrow(ev, 1);
      expect(c.highlight()).toBe(1);
      c.onEnter(ev);
      f.detectChanges();
      expect(c.selectedOrderId()).toBe('o1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Enter on an exact order / invoice ID opens its cart directly', async () => {
    const { f, c, api } = render();
    c.query.set('INV-000123');
    c.onEnter(new KeyboardEvent('keydown'));
    f.detectChanges();
    await flush();
    f.detectChanges();
    expect(api.get).toHaveBeenCalledWith('/api/billing/lookup?code=INV-000123');
    expect(c.selectedOrderId()).toBe('o1');
    expect(f.nativeElement.querySelector('.pf-bc-main .pf-bc-subject__name')?.textContent).toContain('Paravai Munusamy');
  });

  it('a failed lookup says so and opens nothing', () => {
    const { c, toasts } = render({ lookupFails: true });
    c.resolveLookup('NOPE-1');
    expect(toasts.error).toHaveBeenCalled();
    expect(c.selectedOrderId()).toBeNull();
  });

  it('a scanned code runs the same lookup', () => {
    const { c, api } = render();
    c.startScan();
    expect(c.scanning()).toBe(true);
    c.onScanned('LAB-2609-000085');
    expect(c.scanning()).toBe(false);
    expect(api.get).toHaveBeenCalledWith('/api/billing/lookup?code=LAB-2609-000085');
  });

  it('a searched patient in the queue goes straight to their cart', () => {
    const { c } = render();
    c.selectPatient(PATIENT);
    expect(c.selectedOrderId()).toBe('o1');
    expect(c.selectedPatient()).toBeNull();
  });
});

describe('Billing counter — three cards (desktop)', () => {
  it('QUEUE left, BILLING middle, MONEY right; no tabs', () => {
    const { el } = render();
    expect(el.querySelector('.pf-bc-switch')).toBeNull();
    const cards = Array.from(el.querySelectorAll('.pf-bc-panels > .nd-card'));
    expect(cards.map(x => x.getAttribute('aria-label'))).toEqual(['Queue', 'Billing', 'Money']);
    expect(cards[0].querySelector('.nd-card__label')?.textContent?.trim()).toBe('Waiting to pay');
    expect(cards[1].querySelector('.nd-card__label')?.textContent?.trim()).toBe('Billing');
  });

  it('nothing picked: a short prompt and no primary', () => {
    const { el } = render();
    expect(el.querySelector('.pf-bc-main .pf-bc-empty__title')?.textContent?.trim()).toBe('Pick a patient to bill');
    expect(primaries(el).length).toBe(0);
  });

  it('MONEY collapses to a strip (remembered) and expands again', () => {
    const { f, el, c } = render();
    (el.querySelector('.pf-bc-collapse') as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.querySelector('.pf-bc-strip')).toBeTruthy();
    expect(el.querySelector('.pf-bc-side')).toBeNull();
    expect(localStorage.getItem('pf:bc:money-collapsed:u1')).toBe('1');
    (el.querySelector('.pf-bc-strip__btn') as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.querySelector('.pf-bc-side')).toBeTruthy();
    expect(c.moneyCollapsed()).toBe(false);
  });
});

describe('Billing counter — MONEY card', () => {
  it('rows are patient + amount; tap opens the order in BILLING', () => {
    const { f, el, c } = render();
    const rows = el.querySelectorAll('.pf-bc-side .pf-bc-mrow');
    expect(rows.length).toBe(3);
    expect(rows[0].querySelector('.pf-bc-mrow__name')?.textContent).toContain('Paravai Munusamy');
    expect(rows[2].querySelector('.pf-bc-mrow__amt')?.textContent).toContain('−');
    (rows[0] as HTMLButtonElement).click();
    f.detectChanges();
    expect(c.selectedOrderId()).toBe('o1');
  });

  it('day-end uses the kit date and capitalised modes', () => {
    const { el } = render();
    const side = el.querySelector('.pf-bc-side')!;
    const typed = side.querySelector('pf-nd-date input[type="text"]') as HTMLInputElement;
    expect(typed.placeholder).toBe('dd/mm/yyyy');
    const natives = side.querySelectorAll('input[type="date"]');
    expect(natives.length).toBe(1);
    expect(natives[0].classList.contains('pf-ndd__native')).toBe(true);
    const modes = Array.from(side.querySelectorAll('.pf-bc-recon tbody td:first-child')).map(t => t.textContent?.trim());
    expect(modes).toEqual(['Cash', 'UPI', 'Card refund']);
    const titles = Array.from(side.querySelectorAll('.pf-bc-sec')).map(t => t.textContent?.trim());
    expect(titles).toEqual(['Balances due / refunds owed', 'Day-end summary']);
  });

  it('picking a date reloads the summary for that day', () => {
    const { c, api } = render();
    c.setReconcileDate('2026-09-20');
    expect(api.get).toHaveBeenCalledWith('/api/billing/reconcile?date=2026-09-20');
  });

  it('no monospace and no off-palette colours in the screen styles', () => {
    const styles = ((BillingCounterComponent as any).ɵcmp?.styles ?? []).join('\n');
    expect(styles).not.toMatch(/monospace|JetBrains|ui-monospace/i);
    expect(styles).not.toMatch(/#fbbf24|#f87171|251,\s*191,\s*36|#22c55e|#10b981/);
  });

  it('modeLabel capitalises known and unknown modes', () => {
    const { c } = render();
    expect(c.modeLabel('cash')).toBe('Cash');
    expect(c.modeLabel('upi')).toBe('UPI');
    expect(c.modeLabel('bank_transfer')).toBe('Bank Transfer');
  });
});

describe('Billing counter — narrow / phone', () => {
  it('the queue is full screen; a tap slides the cart in; back returns to the list', async () => {
    const { f, el, c } = render({ phone: true });
    const sw = el.querySelector('pf-hero-band .pf-bc-switch')!;
    expect(sw.querySelectorAll('[role="radio"]').length).toBe(2);
    expect(el.querySelector('.pf-bc-queue')).toBeTruthy();
    expect(el.querySelector('.pf-bc-main')).toBeNull();
    expect(el.querySelector('.pf-bc-side')).toBeNull();
    expect(c.bandBack()).toBeNull();
    (el.querySelectorAll('.pf-bc-qrow')[1] as HTMLButtonElement).click();
    f.detectChanges();
    await flush();
    f.detectChanges();
    expect(el.querySelector('.pf-bc-queue')).toBeNull();
    expect(el.querySelector('.pf-bc-main pf-inline-payment-panel')).toBeTruthy();
    // The band's back returns to the queue (not to the front desk).
    const back = c.bandBack();
    expect(typeof back).toBe('function');
    back();
    f.detectChanges();
    expect(c.selectedOrderId()).toBeNull();
    expect(el.querySelector('.pf-bc-queue')).toBeTruthy();
    expect((el.querySelector('.pf-bc-us__input') as HTMLInputElement).placeholder).toBe('Patient, order or invoice ID');
  });

  it('the switch shows MONEY; opening a balance flips back to the cart', () => {
    const { f, el, c } = render({ phone: true });
    (el.querySelectorAll('.pf-bc-switch [role="radio"]')[1] as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.querySelector('.pf-bc-side')).toBeTruthy();
    expect(el.querySelector('.pf-bc-queue')).toBeNull();
    expect(el.querySelector('.pf-bc-collapse')).toBeNull();
    (el.querySelector('.pf-bc-mrow') as HTMLButtonElement).click();
    f.detectChanges();
    expect(c.pane()).toBe('bill');
    expect(el.querySelector('.pf-bc-main')).toBeTruthy();
  });
});
