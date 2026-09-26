import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { BillingCounterComponent } from './billing-counter.component';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { ScanService } from '../../core/services/scan.service';
import { AuthService } from '../../core/auth/auth.service';
import { TenantStateService } from '../../core/services/tenant-state.service';
import { NavBackService } from '../../core/services/nav-back.service';

/**
 * Billing counter — new-design pattern (ND-PATTERN "two jobs on one
 * screen"): the band + ONE unified pill search (patients AND orders /
 * invoices, grouped), BILLING main card on the left, MONEY summary card on
 * the right (kit date, no mono), a phone-only switch, ONE primary.
 */
const PATIENT = { id: 'p1', firstName: 'Paravai', fathersName: 'Munusamy', age: 44, sex: 'Female', mrn: 'AA0007', phone: '9000000001' };
const ORDER = {
  id: 'o1', orderNumber: 'LAB-2609-000085', patientId: 'p1', branchId: 'b1', priority: 'Normal', source: 'walk_in',
  status: 'created', collectionType: 'walk_in', createdAt: '2026-09-26T08:00:00Z', billStatus: 'unpaid', totalAmount: 1200,
  patient: PATIENT, samples: [{ id: 's1', status: 'pending', createdAt: '', tests: [{ id: 't1', name: 'Haemoglobin' }, { id: 't2', name: 'Lipid profile' }] }],
};
const DUE = { billId: 'b1', orderId: 'o1', patientId: 'p1', patientName: 'Paravai Munusamy', totalPayable: 1200, totalPaid: 200, balance: 1000, status: 'partial', createdAt: '2026-09-26T08:00:00Z' };
const REFUND = { billId: 'b2', orderId: 'o2', patientId: 'p2', patientName: 'Kavin Raj', totalPayable: 300, totalPaid: 500, balance: -200, status: 'paid', createdAt: '2026-09-25T08:00:00Z' };
const RECON = {
  date: '2026-09-26', payments: [{ mode: 'cash', count: 1, total: 1 }, { mode: 'upi', count: 2, total: 500 }],
  refunds: [{ mode: 'card', count: 1, total: 50 }], totalCollected: 501, totalRefunded: 50, net: 451,
};

function render(opts: { narrow?: boolean; phone?: boolean; lookupFails?: boolean } = {}) {
  (window as any).matchMedia = (q: string) => ({
    matches: q.includes('900px') ? !!(opts.narrow || opts.phone) : q.includes('640px') ? !!opts.phone : false,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  const api = {
    get: vi.fn((url: string) => {
      if (url.startsWith('/api/billing/outstanding')) return of({ due: [DUE], refundsOwed: [REFUND] });
      if (url.startsWith('/api/billing/reconcile')) return of(RECON);
      if (url.startsWith('/api/billing/lookup')) return opts.lookupFails ? throwError(() => new Error('No order matches that code')) : of({ orderId: 'o1' });
      if (url.startsWith('/api/billing/b1')) return of({ id: 'b1', orderId: 'o1', totalPayable: 1200, totalPaid: 200, balance: 1000, items: [{ id: 'i1', testName: 'Haemoglobin', price: 200, total: 200 }, { id: 'i2', testName: 'Lipid profile', price: 1000, total: 1000 }] });
      if (url.startsWith('/api/orders/')) return of(ORDER);
      if (url.startsWith('/api/patients?')) return of([PATIENT]);
      if (url.startsWith('/api/patients/')) return of({ patient: PATIENT, history: [ORDER] });
      return of(null);
    }),
    post: vi.fn(() => of({})),
  };
  const router = { navigate: vi.fn() };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  TestBed.configureTestingModule({
    imports: [BillingCounterComponent],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toasts },
      { provide: ScanService, useValue: { manualEntry: () => false } },
      { provide: AuthService, useValue: { user: () => ({ id: 'u1', tenantName: 'Micro World' }) } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }) } },
      { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn() } },
      { provide: Router, useValue: router },
    ],
  });
  const f = TestBed.createComponent(BillingCounterComponent);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const c = f.componentInstance as any;
  return { f, el, c, api, router, toasts };
}

const flush = () => new Promise(r => setTimeout(r, 0));

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
afterEach(() => TestBed.resetTestingModule());

describe('Billing counter — band + unified pill search', () => {
  it('renders the band with ONE search in the pill and the scan icon inside it', () => {
    const { el } = render();
    const band = el.querySelector('pf-hero-band')!;
    expect(band).toBeTruthy();
    const input = band.querySelector('.pf-hb__search .pf-bc-us__input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.placeholder).toBe('Search patient, phone, MRN, order or invoice ID');
    expect(band.querySelector('.pf-hb__inline .pf-bc-scan')).toBeTruthy();
    // The old separate "Invoice / order ID" + Open row is gone.
    expect(el.querySelector('input[placeholder*="Invoice / order ID"]')).toBeNull();
    expect(Array.from(el.querySelectorAll('button')).some(b => b.textContent?.trim() === 'Open')).toBe(false);
    // Exactly one text input in the pill.
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
      expect(drop).toBeTruthy();
      const titles = Array.from(drop.querySelectorAll('.pf-bc-drop__title')).map(t => t.textContent?.trim());
      expect(titles).toEqual(['Patients', 'Orders & invoices']);
      const groups = drop.querySelectorAll('.pf-bc-drop__group');
      expect(groups[0].querySelectorAll('[role="option"]').length).toBe(1);
      expect(groups[0].textContent).toContain('Paravai Munusamy');
      expect(groups[1].querySelectorAll('[role="option"]').length).toBe(1);
      expect(groups[1].textContent).toContain('LAB-2609-000085');
      // ↓ walks across both groups; Enter picks the order.
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

  it('a patient name also finds their open balances under Orders & invoices', () => {
    const { c } = render();
    c.query.set('kavin');
    const rows = c.orderRows();
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe('Kavin Raj');
    expect(rows[0].meta).toContain('Refund owed');
  });

  it('Enter on an exact order / invoice ID opens it directly (no highlight)', () => {
    const { f, c, api } = render();
    c.query.set('INV-000123');
    c.onEnter(new KeyboardEvent('keydown'));
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
});

describe('Billing counter — two cards (desktop)', () => {
  it('no redundant tabs: both cards show, BILLING left, MONEY right', () => {
    const { el } = render();
    expect(el.querySelector('.pf-bc-switch')).toBeNull();
    expect(el.querySelector('[role="tablist"]')).toBeNull();
    expect(el.textContent).not.toContain('Find & bill');
    const cards = Array.from(el.querySelectorAll('.pf-bc-panels > .nd-card'));
    expect(cards.map(x => x.getAttribute('aria-label'))).toEqual(['Billing', 'Money']);
    expect(cards[0].querySelector('.nd-card__head .nd-card__icon')).toBeTruthy();
    expect(cards[0].querySelector('.nd-card__label')?.textContent?.trim()).toBe('Billing');
    expect(cards[1].querySelector('.nd-card__label')?.textContent?.trim()).toBe('Money');
  });

  it('the empty state is short and friendly, with no primary', () => {
    const { el } = render();
    expect(el.querySelector('.pf-bc-empty__title')?.textContent?.trim()).toBe('Find an order to bill');
    expect(el.querySelectorAll('.nd-btn--primary, .pf-hb-btn--primary').length).toBe(0);
  });

  it('MONEY collapses to a strip (remembered) and expands again', () => {
    const { f, el, c } = render();
    (el.querySelector('.pf-bc-collapse') as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.querySelector('.pf-bc-strip')).toBeTruthy();
    expect(el.querySelector('.pf-bc-side')).toBeNull();
    expect(el.querySelector('.pf-bc-panels--collapsed')).toBeTruthy();
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
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('.pf-bc-mrow__name')?.textContent).toContain('Paravai Munusamy');
    expect(rows[0].querySelector('.pf-bc-mrow__amt')?.textContent).toContain('1,000');
    expect(rows[1].querySelector('.pf-bc-mrow__amt')?.textContent).toContain('−');
    (rows[0] as HTMLButtonElement).click();
    f.detectChanges();
    expect(c.selectedOrderId()).toBe('o1');
  });

  it('day-end uses the kit date (no native date control shown) and capitalised modes', () => {
    const { el } = render();
    const side = el.querySelector('.pf-bc-side')!;
    const date = side.querySelector('pf-nd-date')!;
    expect(date).toBeTruthy();
    const typed = date.querySelector('input[type="text"]') as HTMLInputElement;
    expect(typed.placeholder).toBe('dd/mm/yyyy');
    // The only native date input is the hidden picker behind the calendar button.
    const natives = side.querySelectorAll('input[type="date"]');
    expect(natives.length).toBe(1);
    expect(natives[0].classList.contains('pf-ndd__native')).toBe(true);
    expect(natives[0].getAttribute('aria-hidden')).toBe('true');
    const modes = Array.from(side.querySelectorAll('.pf-bc-recon tbody td:first-child')).map(t => t.textContent?.trim());
    expect(modes).toEqual(['Cash', 'UPI', 'Card refund']);
    const net = side.querySelector('.pf-bc-totals__net');
    expect(net?.textContent).toContain('Net');
    // Section titles are calm (no spaced mono): our own classes, Noto.
    const titles = Array.from(side.querySelectorAll('.pf-bc-sec')).map(t => t.textContent?.trim());
    expect(titles).toEqual(['Balances due / refunds owed', 'Day-end summary']);
  });

  it('picking a date reloads the summary for that day', () => {
    const { c, api } = render();
    c.setReconcileDate('2026-09-20');
    expect(api.get).toHaveBeenCalledWith('/api/billing/reconcile?date=2026-09-20');
  });

  it('no monospace anywhere in the screen styles', () => {
    const styles = ((BillingCounterComponent as any).ɵcmp?.styles ?? []).join('\n');
    expect(styles).not.toMatch(/monospace|JetBrains|ui-monospace/i);
    // No off-palette status colours either (amber / green pills are gone).
    expect(styles).not.toMatch(/#fbbf24|#f87171|251,\s*191,\s*36/);
  });

  it('modeLabel capitalises known and unknown modes', () => {
    const { c } = render();
    expect(c.modeLabel('cash')).toBe('Cash');
    expect(c.modeLabel('upi')).toBe('UPI');
    expect(c.modeLabel('card')).toBe('Card');
    expect(c.modeLabel('bank_transfer')).toBe('Bank Transfer');
  });
});

describe('Billing counter — one primary', () => {
  it('a selected order with a balance has exactly ONE primary: Collect ₹X', async () => {
    const { f, el, c, router } = render();
    c.openOrder('o1');
    f.detectChanges();
    await flush();
    f.detectChanges();
    const primaries = el.querySelectorAll('.nd-btn--primary, .pf-hb-btn--primary');
    expect(primaries.length).toBe(1);
    expect(primaries[0].textContent).toMatch(/Collect ₹1,000/);
    // Items from the bill, dues below.
    expect(el.querySelectorAll('.pf-bc-item').length).toBe(2);
    expect(el.querySelector('.pf-bc-dues__bal')?.textContent).toContain('1,000');
    (primaries[0] as HTMLButtonElement).click();
    expect(router.navigate).toHaveBeenCalledWith(['/frontdesk/order'], { queryParams: { orderId: 'o1' } });
  });

  it('a refund owed makes the primary "Refund ₹X"', () => {
    const { f, el, c } = render();
    c.openOrder('o2');
    f.detectChanges();
    const primaries = el.querySelectorAll('.nd-btn--primary');
    expect(primaries.length).toBe(1);
    expect(primaries[0].textContent).toMatch(/Refund ₹200/);
  });

  it('a patient pick lists their orders to bill; no primary until an order is picked', () => {
    const { f, el, c } = render();
    c.selectPatient(PATIENT);
    f.detectChanges();
    expect(el.querySelectorAll('.pf-bc-orow').length).toBe(1);
    expect(el.querySelectorAll('.nd-btn--primary').length).toBe(0);
    (el.querySelector('.pf-bc-orow') as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.querySelectorAll('.nd-btn--primary').length).toBe(1);
    // "All orders" returns to the patient's list (secondary).
    const back = Array.from(el.querySelectorAll('.nd-btn--secondary')).find(b => b.textContent?.includes('All orders')) as HTMLButtonElement;
    expect(back).toBeTruthy();
    back.click();
    f.detectChanges();
    expect(c.selectedOrderId()).toBeNull();
    expect(c.selectedPatient()).toBeTruthy();
  });
});

describe('Billing counter — narrow / phone switch', () => {
  it('shows a compact two-way switch and one card at a time', () => {
    const { f, el } = render({ phone: true });
    const sw = el.querySelector('pf-hero-band .pf-bc-switch')!;
    expect(sw).toBeTruthy();
    const items = sw.querySelectorAll('[role="radio"]');
    expect(items.length).toBe(2);
    expect(items[0].getAttribute('aria-checked')).toBe('true');
    expect(el.querySelector('.pf-bc-main')).toBeTruthy();
    expect(el.querySelector('.pf-bc-side')).toBeNull();
    (items[1] as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.querySelector('.pf-bc-main')).toBeNull();
    expect(el.querySelector('.pf-bc-side')).toBeTruthy();
    // No collapse strip on narrow widths.
    expect(el.querySelector('.pf-bc-collapse')).toBeNull();
    expect((el.querySelector('.pf-bc-us__input') as HTMLInputElement).placeholder).toBe('Patient, order or invoice ID');
  });

  it('opening an order from MONEY flips back to the BILLING card', () => {
    const { f, el, c } = render({ phone: true });
    c.pane.set('money');
    f.detectChanges();
    (el.querySelector('.pf-bc-mrow') as HTMLButtonElement).click();
    f.detectChanges();
    expect(c.pane()).toBe('bill');
    expect(el.querySelector('.pf-bc-main')).toBeTruthy();
  });
});
