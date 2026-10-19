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

/** Owner bug (2026-09-27): "we put a patient for a test in the Salem branch,
 *  but it is reflecting in the Trichy branch." A parked cart belongs to the
 *  branch that parked it — Order & Payments in Trichy must never restore (and
 *  so never place) Salem's half-built order. The user's default branch here
 *  is Salem (bSalem); Trichy is bTrichy. */
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

function render(q: Array<[string, string]>, active: string | null) {
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
      { provide: AuthService, useValue: { hasPermission: () => true, activeBranchId: signal(active), user: () => ({ tenantName: 'Micro World', tenantId: 'ten1', branchId: 'bSalem' }) } },
    ],
  });
  const f = TestBed.createComponent(OrderCreateComponent);
  f.detectChanges();
  const patientGets = () => get.mock.calls.filter(a => /^\/api\/patients\/\w+$/.test(String(a[0]))).length;
  return { f, c: f.componentInstance as any, router, query$, patientGets };
}

const draft = (testIds: string[], patient: object, extra: object = {}) =>
  JSON.stringify({ savedAt: Date.now(), priority: 'Normal', testIds, specimens: null, patient, ...extra });

describe('Order & Payments — drafts belong to the branch that parked them', () => {
  let store: MemStorage;
  beforeEach(() => { store = new MemStorage(); vi.stubGlobal('localStorage', store); });
  afterEach(() => vi.unstubAllGlobals());

  it("Trichy does NOT restore Salem's parked cart for the same patient", () => {
    store.setItem('pf:order-draft:bSalem:pA', draft(['t1'], PATIENTS['pA'], { tenantId: 'ten1', branchId: 'bSalem' }));
    const { c } = render([['patientId', 'pA']], 'bTrichy');
    expect(c.patient()?.id).toBe('pA');            // the patient is shared…
    expect(c.selected()).toEqual([]);             // …the Salem visit is not
    expect(c.hasDraft()).toBe(false);
    expect(store.getItem('pf:order-draft:bSalem:pA')).not.toBeNull();   // Salem keeps it
  });

  it("Salem restores its own parked cart", () => {
    store.setItem('pf:order-draft:bSalem:pA', draft(['t1'], PATIENTS['pA'], { tenantId: 'ten1', branchId: 'bSalem' }));
    const { c } = render([['patientId', 'pA']], 'bSalem');
    expect(c.selected()).toEqual(['t1']);
  });

  it('saving a draft in Trichy writes a Trichy-keyed, tenant+branch-stamped draft', () => {
    const { c } = render([['patientId', 'pA']], 'bTrichy');
    c._selected.set(['t2']);
    c.saveDraft();
    const saved = JSON.parse(store.getItem('pf:order-draft:bTrichy:pA')!);
    expect(saved).toMatchObject({ tenantId: 'ten1', branchId: 'bTrichy', testIds: ['t2'] });
    expect(store.getItem('pf:order-draft:pA')).toBeNull();
  });

  it('a legacy (branch-less) draft restores only in the default branch, and is re-keyed on save', () => {
    store.setItem('pf:order-draft:pA', draft(['t1'], PATIENTS['pA']));
    const trichy = render([['patientId', 'pA']], 'bTrichy');
    expect(trichy.c.selected()).toEqual([]);
    TestBed.resetTestingModule();

    const salem = render([['patientId', 'pA']], 'bSalem');
    expect(salem.c.selected()).toEqual(['t1']);
    salem.c.saveDraft();
    expect(store.getItem('pf:order-draft:bSalem:pA')).not.toBeNull();
    expect(store.getItem('pf:order-draft:pA')).toBeNull();   // no duplicate Drafts row
  });

  it("placing Trichy's order never deletes Salem's parked cart for the same patient", () => {
    store.setItem('pf:order-draft:bSalem:pA', draft(['t1'], PATIENTS['pA'], { tenantId: 'ten1', branchId: 'bSalem' }));
    const { c } = render([['patientId', 'pA']], 'bTrichy');
    c.discardDraft();
    expect(store.getItem('pf:order-draft:bSalem:pA')).not.toBeNull();
  });
});
