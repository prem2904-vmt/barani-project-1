import { ShareService } from '../../../core/services/share.service';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { PatientProfileComponent } from './patient-profile.component';
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

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CasesheetGateService } from '../../casesheets/shared/casesheet-gate.service';
import { environment } from '../../../../environments/environment';

/**
 * Case sheets in the patient profile (case sheets WP5; plan §8): ONE "Case sheet" button + a "Case sheets" list, shown
 * ONLY while the case-sheet gate is open AND the user has casesheet_view. Gate closed = the profile is exactly as
 * before (no button, no list, no request). The harness below is the profile ND spec's own (patient-profile.nd.spec.ts).
 *
 * (Original harness doc follows.) Patient profile, CLINICAL-FIRST (docs/PF-PATTERN.md §22): band + context
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
  resultsFail?: boolean; query?: Record<string, string>; gate?: boolean;
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
      { provide: TenantEntitlementsService, useValue: { ensureLoaded: async () => {}, moduleEnabled: (k: string) => (k === 'messages' ? opts.messages !== false : true) } },
      { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
      { provide: ZoomTransitionService, useValue: zoom },
      { provide: PatientTimelineService, useValue: timeline },
      { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'p1' })), queryParamMap: of(convertToParamMap(opts.query ?? {})), snapshot: { paramMap: convertToParamMap({ id: 'p1' }) } } },
      { provide: Router, useValue: router },
      { provide: CasesheetGateService, useValue: { visible: signal(!!opts.gate), ready: async () => {} } },
      provideHttpClient(),
      provideHttpClientTesting(),
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
  const http = TestBed.inject(HttpTestingController);
  return { f, el, c, api, router, orderEntry, navBack, timeline, zoom, holding, click, http };
}


const SHEETS = `${environment.apiUrl.replace(/\/+$/, '')}/api/casesheets/sheets`;
const flushDefer = async (f: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
  for (let i = 0; i < 4; i++) { await f.whenStable(); f.detectChanges(); await new Promise(r => setTimeout(r, 0)); }
};

describe('Patient profile — case sheets (gated)', () => {
  it('gate CLOSED: no Case sheet button, no list, no case-sheet request — whatever the permissions', async () => {
    const { el, f, http } = await render({ gate: false, perms: ALL });
    await flushDefer(f);
    expect(el.querySelector('[data-act="casesheet"]')).toBeNull();
    expect(el.querySelector('pf-patient-casesheets')).toBeNull();
    expect(el.querySelector('[data-casesheets]')).toBeNull();
    http.expectNone(r => r.url.includes('/api/casesheets/'));
  });

  it('gate open but no casesheet_view: nothing either', async () => {
    const { el, f, http } = await render({ gate: true, perms: ['view_patient', 'create_order', 'casesheet_fill'] });
    await flushDefer(f);
    expect(el.querySelector('[data-act="casesheet"]')).toBeNull();
    expect(el.querySelector('[data-casesheets]')).toBeNull();
    http.expectNone(r => r.url.includes('/api/casesheets/'));
  });

  it('gate open + casesheet_view + casesheet_fill: the band button opens Departments for THIS patient', async () => {
    const { el, f, router, click } = await render({ gate: true, perms: ALL });
    const btn = el.querySelector('[data-act="casesheet"]') as HTMLElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain('Case sheet');
    expect(btn.querySelector('svg')).not.toBeNull();
    expect(btn.classList.contains('pf-hb-btn--primary')).toBe(false); // New order stays THE primary
    click(btn);
    await f.whenStable();
    expect(router.navigate).toHaveBeenCalledWith(['/casesheets/new'], { queryParams: { patientId: 'p1' } });
  });

  it('the Case sheets list shows the patient\'s latest sheets (one request, filtered by patient)', async () => {
    const { el, f, http } = await render({ gate: true, perms: ALL });
    await flushDefer(f);
    const req = http.expectOne(r => r.url === SHEETS);
    expect(req.request.params.get('patientId')).toBe('p1');
    expect(req.request.params.get('pageSize')).toBe('5');
    req.flush({ items: [{ id: 's1', state: 'draft', formTitle: 'ENT case sheet', patientId: 'p1', updatedAt: new Date().toISOString() }], total: 1 });
    await flushDefer(f);
    const list = el.querySelector('[data-casesheets]') as HTMLElement;
    expect(list).not.toBeNull();
    expect(list.textContent).toContain('Case sheets');
    expect(list.textContent).toContain('ENT case sheet');
    expect(list.textContent).toContain('Draft');
    expect(list.querySelector('[data-cs-new]')).not.toBeNull();
  });

  it('view only (no casesheet_fill): the button opens the patient\'s sheets; the list has no New', async () => {
    const { el, f, router, click, http } = await render({ gate: true, perms: ['view_patient', 'create_order', 'casesheet_view'] });
    click('[data-act="casesheet"]');
    await f.whenStable();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/casesheets/patient/p1');
    await flushDefer(f);
    http.expectOne(r => r.url === SHEETS).flush({ items: [], total: 0 });
    await flushDefer(f);
    expect(el.querySelector('[data-casesheets]')?.textContent).toContain('No case sheets yet');
    expect(el.querySelector('[data-cs-new]')).toBeNull();
  });

  it('phones: Case sheet lives in the More sheet (the bottom bar keeps New order alone)', async () => {
    const { el, f, click } = await render({ gate: true, perms: ALL, phone: true });
    expect(el.querySelector('.pf-hb__actions [data-act="casesheet"]')).toBeNull();
    click('.pf-pp-act--more');
    await f.whenStable();
    f.detectChanges();
    expect(el.querySelector('.pf-pp-menu [data-act="casesheet"]')).not.toBeNull();
  });
});
