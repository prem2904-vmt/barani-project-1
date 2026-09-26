import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { vi } from 'vitest';
import { OrderCreateComponent } from './order-create.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { AuthService } from '../../../core/auth/auth.service';

/** Draft shelf → Order & Payments: tapping ANOTHER patient's parked order
 *  while this screen is open keeps the same (reused) component — the
 *  patient + cart must follow the live ?patientId, the cart on stage must
 *  be parked first, and a same-patient emission must change nothing. */
const CATALOGUE = [
  { id: 't1', name: 'Haemoglobin', testCode: 'HEM011', type: 'individual', price: 10, priceIsDefault: false, tatHours: 2, isActive: true, department: { name: 'Haematology' } },
  { id: 't2', name: 'Urine Glucose', testCode: 'CLP012', type: 'individual', price: 1, priceIsDefault: true, tatHours: 24, isActive: true, department: { name: 'Clinical Pathology' } },
  { id: 'p1', name: 'Diabetes Panel', testCode: 'PRO001', type: 'profile', price: 400, priceIsDefault: false, tatHours: 8, isActive: true,
    department: { name: 'Biochemistry' }, parameters: JSON.stringify({ items: [{ testId: 't1' }, { testId: 't2' }, { testId: 'x' }] }) },
  { id: 'k1', name: 'Full Body Checkup', testCode: 'PKG001', type: 'package', price: 999, priceIsDefault: false, tatHours: 24, isActive: true,
    department: { name: 'Packages' }, parameters: JSON.stringify({ items: [{ testId: 't1' }] }) },
];

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}


const PATIENTS: Record<string, { id: string; displayName: string }> = {
  pA: { id: 'pA', displayName: 'Mr. Arun' },
  pB: { id: 'pB', displayName: 'Ms. Bhavna' },
};

function render(q: Array<[string, string]>) {
  (window as any).matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  const query$ = new BehaviorSubject<Map<string, string>>(new Map(q));
  const router = { navigate: vi.fn(() => Promise.resolve(true)), navigateByUrl: vi.fn(() => Promise.resolve(true)) };
  const get = vi.fn((url: string) => {
    if (url.startsWith('/api/tests/')) return of(CATALOGUE);
    const m = url.match(/^\/api\/patients\/(\w+)$/);
    if (m) return of({ patient: PATIENTS[m[1]], history: [] });
    return of([]);
  });
  TestBed.configureTestingModule({
    imports: [OrderCreateComponent],
    providers: [
      { provide: ApiService, useValue: { get, post: vi.fn(() => of({})), patch: vi.fn(() => of({})), delete: vi.fn(() => of({})) } },
      { provide: ToastService, useValue: { success() {}, error() {}, info: vi.fn(), warning() {} } },
      { provide: ActivatedRoute, useValue: { queryParamMap: query$, snapshot: { paramMap: new Map(), queryParamMap: new Map(q) } } },
      { provide: Router, useValue: router },
      { provide: NavBackService, useValue: { showBack: () => true, back() {}, backTo() {} } },
      { provide: Location, useValue: {} },
      { provide: BranchLabConfigService, useValue: { ensureLoaded() {}, billingMode: () => 'front_desk', collectsAtFrontdesk: () => false } },
      { provide: ProcessWorkflowService, useValue: { isEnabled: () => true } },
      { provide: TenantStateService, useValue: { tenant: signal(null) } },
      { provide: AuthService, useValue: { hasPermission: () => true, user: () => ({ tenantName: 'Micro World' }) } },
    ],
  });
  const f = TestBed.createComponent(OrderCreateComponent);
  f.detectChanges();
  const patientGets = () => get.mock.calls.filter(a => /^\/api\/patients\/\w+$/.test(String(a[0]))).length;
  return { f, c: f.componentInstance as any, router, query$, patientGets };
}

const KEY = 'pf:order-draft:';
const draft = (testIds: string[], patient: object) =>
  JSON.stringify({ savedAt: Date.now(), priority: 'Normal', testIds, specimens: null, patient });

describe('Order & Payments — switching parked orders in place (draft shelf)', () => {
  let store: MemStorage;
  beforeEach(() => { store = new MemStorage(); vi.stubGlobal('localStorage', store); });
  afterEach(() => vi.unstubAllGlobals());

  it("A → B on the same route: B's patient and cart load; A's cart is parked first", () => {
    store.setItem(KEY + 'pA', draft(['t1'], PATIENTS['pA']));
    store.setItem(KEY + 'pB', draft(['t2', 'p1'], PATIENTS['pB']));
    const { c, query$ } = render([['patientId', 'pA']]);
    expect(c.patient()?.id).toBe('pA');
    expect(c.selected()).toEqual(['t1']);
    c._selected.set(['t1', 'k1']);                       // A's unsaved edit
    c.setPriority('Urgent');
    query$.next(new Map([['patientId', 'pB']]));         // tap B's chip
    expect(c.patient()?.id).toBe('pB');
    expect(c.selected()).toEqual(['t2', 'p1']);
    expect(c.priority()).toBe('Normal');                 // A's priority never leaks
    const parked = JSON.parse(store.getItem(KEY + 'pA')!);
    expect(parked).toMatchObject({ testIds: ['t1', 'k1'], priority: 'Urgent', patient: { id: 'pA' } });
  });

  it('the same patient re-emitted is a no-op: no refetch, the cart stays', () => {
    const { c, query$, patientGets } = render([['patientId', 'pA']]);
    c._selected.set(['t1']);
    const before = patientGets();
    query$.next(new Map([['patientId', 'pA']]));
    expect(patientGets()).toBe(before);
    expect(c.selected()).toEqual(['t1']);
  });

  it("attaching a patient in the pill (the screen's own URL sync) keeps the picked tests", () => {
    const { c, query$ } = render([]);
    c._selected.set(['t1', 't2']);                       // tests first, then the patient
    c.attachPatient(PATIENTS['pB']);
    query$.next(new Map([['patientId', 'pB']]));         // the router echoes the merge
    expect(c.patient()?.id).toBe('pB');
    expect(c.selected()).toEqual(['t1', 't2']);
  });

  it('bill / edit URLs keep their own flow (no patient switch)', () => {
    const { c, query$, patientGets } = render([['patientId', 'pA']]);
    const before = patientGets();
    query$.next(new Map([['orderId', 'o1'], ['patientId', 'pB']]));
    expect(patientGets()).toBe(before);
    expect(c.patient()?.id).toBe('pA');
  });
});
