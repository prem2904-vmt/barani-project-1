import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { PatientProfileComponent } from './patient-profile.component';
import { LabOrdersComponent } from './lab-orders.component';
import { LabTrendsComponent, ndTrendSkin } from './lab-trends.component';
import { CumulativeResultsComponent } from './cumulative-results.component';
import {
  filterOrders, orderStatusLabel, orderTitle, orderTone, patientFlags, patientMetaLine,
} from './patient-profile.nd';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ChatService } from '../../../core/services/chat.service';
import { DialogService } from '../../../core/services/dialog.service';
import { OrderEntryService } from '../../../core/services/order-entry.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ZoomTransitionService } from '../../../core/navigation/zoom-transition';
import { PatientTimelineService } from './patient-timeline.service';

/**
 * Patient profile, CLINICAL-FIRST (docs/PF-PATTERN.md §22): band + context
 * bar (ONE primary, New order, permission-gated) → SNAPSHOT (needs
 * attention with deltas · in progress now · last visit) → CUMULATIVE
 * RESULTS (analyte × visit grid; a row → the trend, a cell → the report) ‖
 * the PATIENT companion (quick actions, a REAL timeline, details), the phone
 * layout, and no monospace / emoji / native controls.
 */
const FULL_NAME = 'Mr. Sathish Kumaravel Ramasamy Venkatachalapathy';
const TODAY = new Date();
const DOB = `${TODAY.getFullYear() - 22}-01-01T00:00:00Z`;
const PATIENT = {
  id: 'p1', tenantId: 't1', mrn: 'AA0006', firstName: 'Sathish', fathersName: 'Ramasamy', displayName: FULL_NAME,
  phone: '+91 98765 43210', sex: 'Male', dateOfBirth: DOB, isMinor: false, abhaId: '91672362107704',
  abhaAddress: 'sathish@abdm', abhaVerified: true, aadhaarVerified: false, source: 'walk_in',
  hasKnownAllergies: true, createdAt: '2026-01-02T00:00:00Z', bloodGroup: 'O+',
};
const test = (id: string, name: string, status: string, code?: string, currentResult?: string) =>
  ({ id, name, status, subOrderId: 's', testId: id, test: code ? { code, name, parameters: [], tatHours: 6 } : undefined, currentResult });
const ORDERS = [
  { id: 'o0', orderNumber: 'LAB-2608-000031', patientId: 'p1', branchId: 'b', priority: 'Routine', source: 'walk_in', status: 'validated',
    collectionType: 'walk_in', createdAt: '2026-08-12T09:00:00Z', totalAmount: 800, refDoctorName: 'Dr. Priya Nair', billStatus: 'paid',
    bill: { id: 'b0', status: 'paid', totalPayable: 800, balance: 0 }, report: { id: 'r0', status: 'final', deliveryStatus: 'delivered' },
    samples: [{ id: 's0', tests: [test('t0', 'Complete Blood Count', 'validated', 'CBC')] }] },
  { id: 'o1', orderNumber: 'LAB-2609-000085', patientId: 'p1', branchId: 'b', priority: 'Routine', source: 'walk_in', status: 'validated',
    collectionType: 'walk_in', createdAt: '2026-09-20T09:48:00Z', totalAmount: 1200, refDoctorName: 'Dr. Priya Nair', billStatus: 'paid',
    bill: { id: 'b1', status: 'paid', totalPayable: 1200, balance: 0 }, report: { id: 'r1', status: 'final', deliveryStatus: 'pending' },
    samples: [{ id: 's1', tests: [test('t1', 'Complete Blood Count', 'validated', 'CBC', JSON.stringify({ values: { Hb: '9.1' } })), test('t2', 'Liver Function Test', 'validated', 'LFT')] }] },
  { id: 'o2', orderNumber: 'LAB-2609-000099', patientId: 'p1', branchId: 'b', priority: 'Routine', source: 'walk_in', status: 'billed',
    collectionType: 'walk_in', createdAt: '2026-09-25T10:00:00Z', totalAmount: 400, billStatus: 'unpaid',
    bill: { id: 'b2', status: 'unpaid', totalPayable: 400, balance: 400 },
    samples: [{ id: 's2', tests: [test('t3', 'Thyroid Profile', 'pending', 'TFT')] }] },
];
const cbc = (orderId: string, date: string, hb: string, hbFlag: string, hbUnit = 'g/dL') => ({
  orderTestId: `${orderId}-cbc`, orderId, orderNumber: orderId, orderedAt: date, testId: 'T-CBC', testName: 'Complete Blood Count',
  department: 'Haematology', panel: null, status: 'validated', final: true,
  values: [
    { name: 'Hb', title: 'Haemoglobin', value: hb, num: +hb, unit: hbUnit, range: '13 - 17', flag: hbFlag },
    { name: 'PLT', title: 'Platelets', value: '250', num: 250, unit: '10^3/µL', range: '150 - 410', flag: 'N' },
  ],
});
const RESULTS = [cbc('o1', '2026-09-20T09:48:00Z', '9.1', 'L'), cbc('o0', '2026-08-12T09:00:00Z', '11.2', 'L')];
const ALL = ['*'];
const APPTS = [{ id: 'a1', type: 'home_collection', collectionType: 'home', appointmentDate: '2026-09-30T00:00:00Z', slotTime: '09:00', status: 'booked' }];

type Opts = {
  holding?: boolean; narrow?: boolean; phone?: boolean; touch?: boolean; perms?: string[]; messages?: boolean;
  fail?: boolean; hang?: boolean; orders?: unknown[]; patient?: Record<string, unknown>; results?: unknown[]; appointments?: unknown[];
  resultsFail?: boolean;
};

const realMatchMedia = (window as any).matchMedia;
beforeEach(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null), setItem: (k: string, v: string) => { mem.set(k, String(v)); },
             removeItem: (k: string) => { mem.delete(k); }, clear: () => mem.clear() },
    configurable: true, writable: true,
  });
});
afterEach(() => {
  TestBed.resetTestingModule();
  (window as any).matchMedia = realMatchMedia;
  vi.restoreAllMocks();
});

async function render(opts: Opts = {}) {
  TestBed.resetTestingModule();
  (window as any).matchMedia = (q: string) => ({
    matches: q.includes('900px') ? !!(opts.narrow || opts.phone) : q.includes('640px') ? !!opts.phone
      : q.includes('hover') ? !(opts.phone || opts.touch) : false,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  const patient = { ...PATIENT, ...(opts.patient ?? {}) };
  const perms = opts.perms ?? ALL;
  const has = (p: string[]) => perms.includes('*') || p.some(x => perms.includes(x));
  const api = {
    get: vi.fn((url: string) => {
      if (url === '/api/patients/p1') {
        if (opts.hang) return new Subject();
        return opts.fail ? throwError(() => new Error('boom'))
          : of({ patient, history: opts.orders ?? ORDERS, appointments: opts.appointments ?? APPTS });
      }
      if (url === '/api/patients/p1/cumulative-results') {
        return opts.resultsFail ? throwError(() => new Error('x')) : of({ results: opts.results ?? RESULTS, truncated: false });
      }
      if (url.endsWith('/lab-trends')) return of({ tests: [] });
      if (url.startsWith('/api/reports/by-order/')) return of(null);
      if (url.startsWith('/api/orders/')) return of({ ...ORDERS[2], samples: [] });
      if (url === '/api/directory/users') return of([]);
      return of([]);
    }),
    post: vi.fn(() => of({})),
    patch: vi.fn(() => of({})),
  };
  const router = {
    url: '/frontdesk/patients/p1', navigate: vi.fn(() => Promise.resolve(true)), navigateByUrl: vi.fn(() => Promise.resolve(true)),
    events: of(), lastSuccessfulNavigation: signal(null), createUrlTree: vi.fn(), serializeUrl: vi.fn(() => ''),
  };
  const orderEntry = { startNewOrder: vi.fn(async () => {}) };
  const navBack = { showBack: () => true, back: vi.fn(), backTo: vi.fn() };
  const timeline = { open: vi.fn(), close: vi.fn(), isOpen: signal(false), patientId: signal(null) };
  const holding = signal(!!opts.holding);
  const zoom = { holding, runLocal: vi.fn((_d: string, fn: () => void) => fn()), tap: () => true, attachTarget() {}, detachTarget() {}, attachSource() {}, detachSource() {} };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: NavBackService, useValue: navBack },
      { provide: AuthService, useValue: { user: () => ({ id: 'u1', authId: 'u1', displayName: 'Admin', tenantName: 'Micro World' }), hasAnyPermission: has, hasPermission: (p: string) => has([p]) } },
      { provide: ChatService, useValue: { sharePatientWithUser: vi.fn(async () => {}) } },
      { provide: DialogService, useValue: { confirm: vi.fn(async () => true) } },
      { provide: OrderEntryService, useValue: orderEntry },
      { provide: ProcessWorkflowService, useValue: { isEnabled: () => true, active: signal(null) } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }), ensureLoaded() {} } },
      { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => opts.messages !== false } },
      { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
      { provide: ZoomTransitionService, useValue: zoom },
      { provide: PatientTimelineService, useValue: timeline },
      { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'p1' })), snapshot: { paramMap: convertToParamMap({ id: 'p1' }) } } },
      { provide: Router, useValue: router },
    ],
  });
  const f = TestBed.createComponent(PatientProfileComponent);
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const c = f.componentInstance as any;
  const click = (sel: string | Element) => {
    const b = (typeof sel === 'string' ? el.querySelector(sel) : sel) as HTMLElement;
    expect(b, String(sel)).not.toBeNull();
    b.click(); f.detectChanges();
  };
  return { f, el, c, api, router, orderEntry, navBack, timeline, zoom, holding, click };
}

const primaries = (el: HTMLElement) => el.querySelectorAll('.pf-btn--primary, .pf-hb-btn--primary');
const css = (cmp: unknown) => ((cmp as any).ɵcmp.styles as string[]).join('\n');
const txt = (e: Element | null | undefined) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('Patient profile (clinical) — band + CONTEXT BAR', () => {
  it('keeps the band (back + tenant) and puts the FULL name, "22/M · MRN · phone", ABHA and flags in the pill', async () => {
    const { el } = await render();
    const band = el.querySelector('pf-hero-band') as HTMLElement;
    expect(band.querySelector('.pf-hb__back')).not.toBeNull();
    const ctx = band.querySelector('.pf-pp-ctx') as HTMLElement;
    expect(ctx.querySelector('.pf-pp-name')?.textContent?.trim()).toBe(FULL_NAME);
    expect(ctx.querySelector('.pf-pp-meta')?.textContent?.trim()).toBe('22/M · AA0006 · +91 98765 43210');
    expect(ctx.querySelector('.pf-pp-abha')?.textContent).toContain('91-6723-6210-7704');
    expect([...ctx.querySelectorAll('.pf-pp-flag')].map(f => f.textContent?.trim())).toEqual(['Known allergies', 'Payment due']);
    expect(el.querySelector('h1')).toBeNull();
  });

  it('back returns to the front desk; with a detail open it closes the detail first', async () => {
    const { el, navBack, c, f } = await render();
    c.openOrder('o1'); f.detectChanges();
    (el.querySelector('.pf-hb__back') as HTMLButtonElement).click(); f.detectChanges();
    expect(c.detail()).toBeNull();
    expect(navBack.backTo).not.toHaveBeenCalled();
    (el.querySelector('.pf-hb__back') as HTMLButtonElement).click(); f.detectChanges();
    expect(navBack.backTo).toHaveBeenCalledWith('/frontdesk');
  });
});

describe('Patient profile (clinical) — ONE primary + every action reachable', () => {
  it('web: exactly one primary, "New order", which starts an order for this patient', async () => {
    const { el, orderEntry, click } = await render();
    const p = primaries(el);
    expect(p.length).toBe(1);
    expect(p[0].textContent?.trim()).toBe('New order');
    click(p[0]);
    expect(orderEntry.startNewOrder).toHaveBeenCalledWith('p1');
  });

  it('More holds every secondary action; Full timeline opens with REAL data only (no OPD / IPD records)', async () => {
    const { el, c, router, timeline, click } = await render();
    click('.pf-pp-act--more');
    const acts = [...el.querySelectorAll('.pf-pp-menu__row')].map(b => (b as HTMLElement).dataset['act']);
    expect(acts).toEqual(['appointment', 'chat', 'abha', 'idcard', 'qr', 'timeline', 'merge']);
    click('[data-act="appointment"]');
    expect(router.navigate).toHaveBeenCalledWith(['/frontdesk/appointments/new'], { queryParams: { patientId: 'p1' } });
    click('.pf-pp-act--more'); click('[data-act="timeline"]');
    expect(timeline.open).toHaveBeenCalledWith('p1', [], [], []);
    click('.pf-pp-act--more'); click('[data-act="merge"]');
    expect(c.mergeOpen()).toBe(true);
    c.closeMerge();
    click('.pf-pp-act--more'); click('[data-act="chat"]');
    expect(c.chatPickerOpen()).toBe(true);
  });

  it('phones: the primary moves to a full-width bottom bar — still exactly one', async () => {
    const { el, orderEntry, click } = await render({ phone: true });
    expect(el.querySelector('.pf-pp-act--new')).toBeNull();
    const p = primaries(el);
    expect(p.length).toBe(1);
    expect(p[0].closest('.pf-bottombar')).not.toBeNull();
    click(p[0]);
    expect(orderEntry.startNewOrder).toHaveBeenCalledWith('p1');
  });
});

describe('Patient profile (clinical) — SNAPSHOT', () => {
  it('Needs attention: analyte, value + unit, the arrow, the reference, the date and the delta vs the previous value', async () => {
    const { el } = await render();
    const rows = el.querySelectorAll('.pf-pp-attn__row');
    expect(rows.length).toBe(1);                          // Platelets is normal → not listed
    const r = rows[0] as HTMLElement;
    expect(r.dataset['tone']).toBe('abnormal');
    expect(txt(r.querySelector('.pf-pp-attn__name'))).toContain('Haemoglobin');
    expect(txt(r.querySelector('.pf-pp-attn__val'))).toBe('9.1g/dL');
    expect(r.querySelector('.pf-pp-attn__val svg')).not.toBeNull();   // the ▼ arrow is an SVG
    const meta = txt(r.querySelector('.pf-pp-attn__meta'));
    expect(meta).toContain('Ref 13 - 17');
    expect(meta).toContain('20 Sep');
    expect(txt(r.querySelector('.pf-pp-attn__delta'))).toBe('−19% since 12 Aug');
  });

  it('a calm line when nothing is flagged; an access line without result permissions', async () => {
    const calm = await render({ results: [cbc('o1', '2026-09-20T09:48:00Z', '14', 'N')] });
    expect(txt(calm.el.querySelector('.pf-pp-pane--attn'))).toContain('Nothing flagged in the latest results');
    const none = await render({ perms: ['view_patient'] });
    expect(txt(none.el.querySelector('.pf-pp-pane--attn'))).toContain('Results need report access');
    expect(none.api.get).not.toHaveBeenCalledWith('/api/patients/p1/cumulative-results');
  });

  it('In progress now: the active order with its live stage (4-step bar) and ready-by', async () => {
    const { el, c, click } = await render();
    const rows = el.querySelectorAll('.pf-pp-prog__row');
    expect(rows.length).toBe(1);
    expect(txt(rows[0].querySelector('.pf-pp-prog__name'))).toBe('Thyroid Profile');
    expect(rows[0].querySelectorAll('.pf-pp-steps__seg').length).toBe(4);
    expect(txt(rows[0].querySelector('.pf-pp-status'))).toBe('Ordered');
    expect(txt(rows[0].querySelector('.pf-pp-prog__due'))).toMatch(/^(Ready by|Overdue by|Due) /);
    click(rows[0]);
    expect(c.detail()).toEqual({ kind: 'order', id: 'o2', report: false });
  });

  it('Last visit: date, tests, doctor, report status and View', async () => {
    const { el, c, click } = await render();
    const pane = el.querySelector('.pf-pp-pane--last') as HTMLElement;
    // The newest COMPLETED visit (the active one is already "in progress").
    expect(txt(pane.querySelector('.pf-pp-last__tests'))).toBe('Complete Blood Count, Liver Function Test');
    expect(txt(pane.querySelector('.pf-pp-last__doc'))).toBe('Dr. Priya Nair');
    expect(txt(pane.querySelector('.pf-pp-status'))).toBe('Report ready');
    click(pane.querySelector('.pf-pp-last__view')!);
    expect(c.detail()).toEqual({ kind: 'order', id: 'o1', report: true });
  });
});

describe('Patient profile (clinical) — CUMULATIVE RESULTS', () => {
  it('an analyte × visit grid, newest visit first, grouped, with flagged cells tinted and a sparkline per row', async () => {
    const { el } = await render();
    const t = el.querySelector('pf-cumulative-results table.pf-cr__t') as HTMLElement;
    expect(t).not.toBeNull();
    const dates = [...t.querySelectorAll('thead .pf-cr__th--date')].map(txt);
    expect(dates).toEqual(['20 Sep', '12 Aug']);
    expect(txt(t.querySelector('.pf-cr__gcell'))).toBe('Haematology · Complete Blood Count');
    const hb = t.querySelectorAll('tbody .pf-cr__row')[0] as HTMLElement;
    expect(txt(hb.querySelector('.pf-cr__title'))).toBe('Haemoglobin');
    expect(hb.querySelector('svg.pf-cr__spark path.pf-cr__line')).not.toBeNull();
    expect(hb.querySelector('svg.pf-cr__spark rect.pf-cr__band')).not.toBeNull();
    expect(txt(hb.querySelector('.pf-cr__trend'))).toBe('−19%');
    const cells = hb.querySelectorAll('.pf-cr__cell');
    expect((cells[0] as HTMLElement).dataset['tone']).toBe('abnormal');
    expect(txt(cells[0])).toBe('9.1');
    // Legend + no truncation of the analyte name.
    expect(txt(el.querySelector('.pf-cr__legend'))).toContain('Critical');
  });

  it('a cell opens that visit\'s order + report; a row with a series opens its trend chart; Back zooms out', async () => {
    const { el, c, zoom, api, click, f } = await render();
    click(el.querySelector('.pf-cr__cellbtn')!);
    expect(zoom.runLocal).toHaveBeenCalledWith('in', expect.any(Function));
    expect(c.detail()).toEqual({ kind: 'order', id: 'o1', report: true });
    await f.whenStable(); await new Promise(r => setTimeout(r, 0)); f.detectChanges();
    expect(el.querySelector('.pf-pp-detail .pf-lo-detail')).not.toBeNull();
    expect(api.get).toHaveBeenCalledWith('/api/reports/by-order/o1');
    click('.pf-lo-detail__back');
    expect(c.detail()).toBeNull();
    click(el.querySelector('.pf-cr__namebtn')!);
    expect(c.detail()).toMatchObject({ kind: 'trend', testId: 'T-CBC', parameter: 'Hb', title: 'Haemoglobin' });
    expect(el.querySelector('.pf-pp-detail pf-lab-trends')).not.toBeNull();
    click('.pf-pp-detail__back');
    expect(zoom.runLocal).toHaveBeenCalledWith('out', expect.any(Function));
    expect(el.querySelector('pf-cumulative-results')).not.toBeNull();
  });

  it('flags a row whose visits used different units', async () => {
    const { el } = await render({ results: [cbc('o1', '2026-09-20T09:48:00Z', '91', 'L', 'g/L'), cbc('o0', '2026-08-12T09:00:00Z', '11.2', 'L')] });
    const hb = el.querySelector('tbody .pf-cr__row') as HTMLElement;
    expect(txt(hb.querySelector('.pf-cr__mis'))).toBe('Units differ');
    expect(hb.querySelector('.pf-cr__trend')).toBeNull();          // never a trend across units
    expect(txt(hb.querySelectorAll('.pf-cr__cell')[1])).toContain('g/dL');   // the odd cell shows its unit
  });

  it('filters: search, abnormal only (slate switch), department chips; no match → Clear filters', async () => {
    const results = [...RESULTS, { ...cbc('o1', '2026-09-20T09:48:00Z', '1', 'N'), orderTestId: 'x', testId: 'T-TSH', testName: 'TSH', department: 'Biochemistry',
      values: [{ name: 'TSH', title: 'TSH', value: '2.1', num: 2.1, unit: 'µIU/mL', range: '0.4 - 4.0', flag: 'N' }] }];
    const { el, f } = await render({ results });
    const rowsNow = () => [...el.querySelectorAll('tbody .pf-cr__title')].map(txt);
    expect(rowsNow()).toEqual(['TSH', 'Haemoglobin', 'Platelets']);
    const sw = el.querySelector('.pf-cr__abn') as HTMLElement;
    expect(sw.getAttribute('role')).toBe('switch');
    sw.click(); f.detectChanges();
    expect(rowsNow()).toEqual(['Haemoglobin']);
    sw.click(); f.detectChanges();
    const chips = [...el.querySelectorAll('.pf-cr__chip')] as HTMLElement[];
    expect(chips.map(txt)).toEqual(['All', 'Biochemistry', 'Haematology']);
    chips[1].click(); f.detectChanges();
    expect(rowsNow()).toEqual(['TSH']);
    chips[0].click(); f.detectChanges();
    const input = el.querySelector('.pf-cr__find-in') as HTMLInputElement;
    input.value = 'plate'; input.dispatchEvent(new Event('input')); f.detectChanges();
    expect(rowsNow()).toEqual(['Platelets']);
    input.value = 'zzz'; input.dispatchEvent(new Event('input')); f.detectChanges();
    expect(txt(el.querySelector('pf-cumulative-results .pf-empty'))).toContain('No analytes match');
  });

  it('"Show all N" in the snapshot turns on Abnormal only in the grid', async () => {
    const many = ['A', 'B', 'C', 'D', 'E'].map((k, i) => ({ ...cbc('o1', '2026-09-20T09:48:00Z', '1', 'N'), orderTestId: k, testId: k, testName: `Test ${k}`,
      values: [{ name: k, title: `Analyte ${k}`, value: String(20 + i), num: 20 + i, unit: 'u', range: '1 - 10', flag: 'H' }] }));
    const { el, click, f } = await render({ results: many });
    expect(el.querySelectorAll('.pf-pp-attn__row').length).toBe(4);
    click('.pf-pp-pane__more');
    await f.whenStable(); f.detectChanges();
    expect(el.querySelector('.pf-cr__abn')?.getAttribute('aria-checked')).toBe('true');
  });

  it('empty and error states', async () => {
    const empty = await render({ results: [] });
    expect(txt(empty.el.querySelector('pf-cumulative-results .pf-empty'))).toContain('No results yet');
    const failed = await render({ resultsFail: true });
    expect(txt(failed.el.querySelector('pf-cumulative-results .pf-empty'))).toContain('Couldn’t load results');
    const denied = await render({ perms: ['view_patient'] });
    expect(txt(denied.el.querySelector('pf-cumulative-results .pf-empty'))).toContain('Results need report access');
  });

  it('phones: per-analyte cards with a sparkline, not the wide grid', async () => {
    const { el } = await render({ phone: true });
    expect(el.querySelector('table.pf-cr__t')).toBeNull();
    const cards = el.querySelectorAll('.pf-cr__card');
    expect(cards.length).toBe(2);
    expect(txt(cards[0].querySelector('.pf-cr__card-name'))).toBe('Haemoglobin');
    expect(cards[0].querySelector('svg.pf-cr__spark')).not.toBeNull();
    expect(txt(cards[0].querySelector('.pf-cr__word'))).toBe('Low');
  });
});

describe('Patient profile (clinical) — PATIENT companion', () => {
  it('quick actions for this user: Repeat last order, Reprint labels, View last report (New order is the band primary)', async () => {
    const { el, router, api, c, click } = await render();
    const q = [...el.querySelectorAll('.pf-pp-side .pf-pp-quick__btn')].map(b => (b as HTMLElement).dataset['q']);
    expect(q).toEqual(['repeat', 'labels', 'report']);
    click('.pf-pp-side [data-q="repeat"]');
    expect(router.navigate).toHaveBeenCalledWith(['/frontdesk/order'], { queryParams: { patientId: 'p1', fromOrderId: 'o2' } });
    click('.pf-pp-side [data-q="labels"]');
    expect(api.get).toHaveBeenCalledWith('/api/orders/o2');
    click('.pf-pp-side [data-q="report"]');
    expect(c.detail()).toEqual({ kind: 'order', id: 'o1', report: true });
  });

  it('a lab tech (view only) sees no New order and no Repeat — only what they may do', async () => {
    const { el } = await render({ perms: ['view_patient', 'view_order', 'view_report'] });
    expect(primaries(el).length).toBe(0);
    const q = [...el.querySelectorAll('.pf-pp-quick__btn')].map(b => (b as HTMLElement).dataset['q']);
    expect(q).toEqual(['report']);
  });

  it('the timeline is the REAL history (orders, reports, bills, home visits) and an order row zooms into it', async () => {
    const { el, c, click } = await render();
    const kinds = [...el.querySelectorAll('.pf-pp-side .pf-tl__row')].map(r => (r as HTMLElement).dataset['kind']);
    expect(kinds).toEqual(['home', 'order', 'report', 'order', 'report', 'order']);
    expect(el.textContent).not.toMatch(/OPD|IPD|Hospitalization|Prescribed/);
    const due = [...el.querySelectorAll('.pf-tl__row')].find(r => txt(r).includes('Thyroid Profile')) as HTMLElement;
    expect(txt(due.querySelector('.pf-tl__meta'))).toContain('₹400 due');
    click(due);
    expect(c.detail()).toEqual({ kind: 'order', id: 'o2', report: false });
  });

  it('no orders and no appointments → an empty timeline, never generated records', async () => {
    const { el } = await render({ orders: [], appointments: [], results: [] });
    expect(el.querySelectorAll('.pf-tl__row').length).toBe(0);
    expect(txt(el.querySelector('.pf-pp-side .pf-empty'))).toContain('No history yet');
    expect(txt(el.querySelector('.pf-pp-pane--last'))).toContain('No visits yet');
  });

  it('Details: demographics, ABHA, billing outstanding, allergies; the seg is one Tab stop', async () => {
    const { el, click } = await render();
    const seg = el.querySelector('.pf-pp-side .pf-seg[role=radiogroup]') as HTMLElement;
    expect([...seg.querySelectorAll('[role=radio]')].map(r => r.getAttribute('tabindex'))).toEqual(['0', '-1']);
    click(seg.querySelectorAll('[role=radio]')[1]);
    const side = el.querySelector('.pf-pp-side') as HTMLElement;
    expect(side.textContent).toContain('AA0006');
    expect(side.textContent).toContain('Known allergies');
    expect(txt(side.querySelector('.pf-pp-owed'))).toContain('400');
    expect(side.textContent).toContain('Payment due on 1 order');
    click('.pf-pp-abha-card');
    expect(el.querySelector('.pf-pp-sheet--abha .abc')).not.toBeNull();
  });

  it('collapses to a strip (remembered per user) and back', async () => {
    const { el, click } = await render();
    click('.pf-pp-collapse');
    expect(el.querySelector('.pf-pp-side')).toBeNull();
    expect(el.querySelector('.pf-pp-strip')).not.toBeNull();
    expect(localStorage.getItem('pf:pp:side-collapsed:u1')).toBe('1');
    const again = await render();
    expect(again.el.querySelector('.pf-pp-strip')).not.toBeNull();
    again.click('.pf-pp-strip__btn');
    expect(again.el.querySelector('.pf-pp-side')).not.toBeNull();
  });

  it('≤900px: one stacked column — snapshot, results, then the timeline and details inline', async () => {
    const { el } = await render({ narrow: true });
    expect(el.querySelector('.pf-pp-side')).toBeNull();
    const order = [...el.querySelectorAll('.pf-pp-main > *')].map(n => n.classList.contains('pf-pp-snap') ? 'snap'
      : n.tagName === 'PF-CUMULATIVE-RESULTS' ? 'results' : n.getAttribute('aria-label'));
    expect(order).toEqual(['snap', 'results', 'Timeline', 'Patient details']);
  });
});

describe('Patient profile (clinical) — loading, zoom, rules', () => {
  it('skeleton while loading; the main column is the ONE route zoom target', async () => {
    const { el } = await render({ hang: true });
    expect(el.querySelector('.pf-pp-snap--skel')).not.toBeNull();
    expect(el.querySelector('.pf-pp-main')?.getAttribute('aria-busy')).toBe('true');
  });

  it('the ROUTE zoom holds the skeleton; an in-page zoom never swaps the content out', async () => {
    const r = await render({ holding: true });
    expect(r.el.querySelector('.pf-pp-snap--skel')).not.toBeNull();
    r.holding.set(false); r.f.detectChanges(); await r.f.whenStable(); r.f.detectChanges();
    expect(r.el.querySelector('pf-cumulative-results')).not.toBeNull();
    r.holding.set(true); r.f.detectChanges();
    expect(r.el.querySelector('.pf-pp-snap--skel')).toBeNull();
  });

  it('not found → .pf-empty with a way back', async () => {
    const { el } = await render({ fail: true });
    expect(txt(el.querySelector('.pf-pp-missing .pf-empty'))).toContain('Patient not found');
  });

  it('no monospace, no emoji / glyph icons, no native select / datalist', async () => {
    const { el, click } = await render();
    click('.pf-pp-act--more');
    expect(el.querySelectorAll('select, datalist').length).toBe(0);
    expect(el.querySelectorAll('.font-mono').length).toBe(0);
    expect(el.textContent).not.toMatch(/[✕▲▼‼†]/u);
    expect(el.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    for (const cmp of [PatientProfileComponent, LabOrdersComponent, LabTrendsComponent, CumulativeResultsComponent]) {
      expect(css(cmp)).not.toMatch(/monospace/);
      expect(css(cmp)).not.toMatch(/linear-gradient\(135deg, #7c3aed/);
    }
  });

  it('touch: band actions become 44px icons with their words kept for AT', async () => {
    const { el } = await render({ touch: true });
    const edit = el.querySelector('.pf-pp-act--edit') as HTMLElement;
    expect(edit.classList).toContain('pf-pp-act--icon');
    expect(edit.getAttribute('aria-label')).toBe('Edit patient');
  });

  it('band actions share a consistent 44px height', () => {
    expect(css(PatientProfileComponent)).toMatch(/\.pf-pp-act(\[[^\]]*\])?\s*\{[^}]*height:\s*44px/);
  });

  it('reduced motion switches every animation off', () => {
    for (const cmp of [PatientProfileComponent, LabOrdersComponent, CumulativeResultsComponent]) {
      expect(css(cmp)).toMatch(/prefers-reduced-motion: reduce/);
    }
  });
});

describe('patient-profile.nd helpers', () => {
  it('meta line, flags, titles, tones', () => {
    const p = { ...PATIENT, hasKnownAllergies: false, isMinor: true } as any;
    expect(patientMetaLine(p)).toBe('22/M · AA0006 · +91 98765 43210');
    expect(patientFlags(p, ORDERS as any).map(f => f.key)).toEqual(['minor', 'due']);
    expect(orderTitle(ORDERS[1] as any)).toBe('Complete Blood Count, Liver Function Test');
    expect(orderStatusLabel('sample_collected')).toBe('Collected');
    expect(orderTone('cancelled')).toBe('red');
    expect(orderTone('dispatched')).toBe('blue');
    expect(filterOrders(ORDERS as any, 'lfT', '', '').map(o => o.id)).toEqual(['o1']);
    expect(filterOrders(ORDERS as any, '', '2026-09-24', '').map(o => o.id)).toEqual(['o2']);
  });

  it('the screen chart skin: transparent, Noto, neutral reference band, red only on flags', () => {
    const flagged = (p: { dataIndex: number }) => (p.dataIndex === 1 ? '#fb7185' : '#a855f7');
    const opt = ndTrendSkin({
      backgroundColor: '#fff', xAxis: { axisLabel: {} }, yAxis: { axisLabel: {}, splitLine: { lineStyle: {} } },
      tooltip: { trigger: 'axis' },
      series: [{ type: 'line', lineStyle: { color: '#a855f7' }, itemStyle: { color: flagged }, markArea: { itemStyle: { color: 'rgba(16,185,129,0.12)' } } }],
    }, false);
    expect(opt.backgroundColor).toBe('transparent');
    expect(opt.textStyle.fontFamily).toContain('Noto Sans');
    expect(opt.series[0].markArea.itemStyle.color).not.toMatch(/16,185,129/);
    expect(opt.series[0].itemStyle.color({ dataIndex: 0 })).toBe('#7c3aed');
    expect(opt.series[0].itemStyle.color({ dataIndex: 1 })).toBe('#dc2626');
  });
});
