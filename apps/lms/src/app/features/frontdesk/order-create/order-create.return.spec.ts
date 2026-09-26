import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { OrderCreateComponent } from './order-create.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { AuthService } from '../../../core/auth/auth.service';

/** Registration round-trip (ND-PATTERN §15): "Register a new patient" /
 *  "Edit … details" stash the half-built cart and open registration with
 *  returnTo=order; coming back with ?patientId=…&resume=registration
 *  restores it with the patient attached. */
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

function render(q: Array<[string, string]> = []) {
  (window as any).matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  const router = { navigate: vi.fn(() => Promise.resolve(true)), navigateByUrl: vi.fn(() => Promise.resolve(true)) };
  TestBed.configureTestingModule({
    imports: [OrderCreateComponent],
    providers: [
      { provide: ApiService, useValue: {
        get: vi.fn((url: string) => of(url.startsWith('/api/tests/') ? CATALOGUE
          : url.startsWith('/api/patients/') ? { patient: { id: 'p-new', displayName: 'Mr. Ravi Shankar' }, history: [] } : [])),
        post: vi.fn(() => of({})), patch: vi.fn(() => of({})), delete: vi.fn(() => of({})) } },
      { provide: ToastService, useValue: { success() {}, error() {}, info() {}, warning() {} } },
      { provide: ActivatedRoute, useValue: { queryParamMap: of(new Map(q)), snapshot: { paramMap: new Map(), queryParamMap: new Map(q) } } },
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
  return { f, c: f.componentInstance as any, router };
}

describe('Order & Payments ⇄ registration round-trip', () => {
  let store: MemStorage;
  beforeEach(() => { store = new MemStorage(); vi.stubGlobal('localStorage', store); });
  afterEach(() => vi.unstubAllGlobals());

  it('"Register a new patient" stashes the cart and opens registration with returnTo=order', () => {
    const { c, router } = render();
    c._selected.set(['t1', 't2']);
    c.refDoctorName.set('Dr. Mehta');
    c.newPatient();
    expect(router.navigate).toHaveBeenCalledWith(['/frontdesk/patients/new'], { queryParams: { returnTo: 'order' } });
    const saved = JSON.parse(store.getItem(OrderCreateComponent.PENDING_KEY)!);
    expect(saved).toMatchObject({ testIds: ['t1', 't2'], refDoctorName: 'Dr. Mehta', priority: 'Normal' });
  });

  it('back with ?patientId&resume=registration: the patient is attached and the cart restored (one-shot)', () => {
    store.setItem(OrderCreateComponent.PENDING_KEY, JSON.stringify({
      savedAt: Date.now(), testIds: ['t1', 'p1'], priority: 'Urgent', refDoctorName: 'Dr. Mehta', refHospitalName: '' }));
    const { c } = render([['patientId', 'p-new'], ['resume', 'registration']]);
    expect(c.patient()?.id).toBe('p-new');
    expect(c.selected()).toEqual(['t1', 'p1']);
    expect(c.priority()).toBe('Urgent');
    expect(c.refDoctorName()).toBe('Dr. Mehta');
    expect(store.getItem(OrderCreateComponent.PENDING_KEY)).toBeNull();
  });

  it('without resume, a stale stash is ignored (never attaches to some other patient)', () => {
    store.setItem(OrderCreateComponent.PENDING_KEY, JSON.stringify({ savedAt: Date.now(), testIds: ['t1'] }));
    const { c } = render([['patientId', 'p-new']]);
    expect(c.selected()).toEqual([]);
  });

  it('"Edit … details" also round-trips with the patient id', () => {
    const { c, router } = render();
    c._patient.set({ id: 'p-9', displayName: 'Ms. Asha' });
    c.editPatient();
    expect(router.navigate).toHaveBeenCalledWith(['/frontdesk/patients/new'], { queryParams: { patientId: 'p-9', returnTo: 'order' } });
  });
});
