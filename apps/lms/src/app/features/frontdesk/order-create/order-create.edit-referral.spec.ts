import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { vi } from 'vitest';
import { OrderCreateComponent } from './order-create.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { AuthService } from '../../../core/auth/auth.service';

/**
 * An existing order's referral is changed through the ONE shared
 * pf-edit-referral-dialog — this screen has no inline editor of its own
 * (no second surface, no Save/Cancel pair in the band).
 */
function render(perms = true) {
  (window as any).matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  const get = vi.fn((url: string) => {
    if (url.endsWith('/referral')) return of({ orderId: 'o1', refDoctorName: 'Dr Old', refHospitalName: 'City', sourceTypes: ['Doctor'] });
    return of([]);
  });
  const patch = vi.fn(() => of({}));
  TestBed.configureTestingModule({
    imports: [OrderCreateComponent],
    providers: [
      { provide: ApiService, useValue: { get, post: vi.fn(() => of({})), patch, delete: vi.fn(() => of({})) } },
      { provide: ToastService, useValue: { success() {}, error() {}, info() {}, warning() {} } },
      { provide: DialogService, useValue: { confirm: vi.fn(() => Promise.resolve(true)) } },
      { provide: ActivatedRoute, useValue: { queryParamMap: new BehaviorSubject(new Map()), snapshot: { paramMap: new Map(), queryParamMap: new Map() } } },
      { provide: Router, useValue: { navigate: vi.fn(() => Promise.resolve(true)), navigateByUrl: vi.fn(() => Promise.resolve(true)), events: of() } },
      { provide: NavBackService, useValue: { showBack: () => true, back() {}, backTo() {} } },
      { provide: Location, useValue: {} },
      { provide: BranchLabConfigService, useValue: { ensureLoaded() {}, billingMode: () => 'front_desk', collectsAtFrontdesk: () => false } },
      { provide: ProcessWorkflowService, useValue: { isEnabled: () => true } },
      { provide: TenantStateService, useValue: { tenant: signal(null) } },
      { provide: AuthService, useValue: { hasPermission: () => perms, user: () => ({ tenantName: 'Micro World' }), activeBranchId: () => null } },
    ],
  });
  const f = TestBed.createComponent(OrderCreateComponent);
  const c = f.componentInstance as any;
  c.viewOrderId.set('o1');
  c._order.set({ id: 'o1', status: 'completed', refDoctorName: 'Dr Old', refHospitalName: 'City', samples: [] });
  f.detectChanges();
  return { f, c, el: f.nativeElement as HTMLElement, get, patch };
}

const editBtn = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('button[aria-label="Edit referral"]');

describe('Order & Payments — Edit referral uses the shared dialog', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('opens pf-edit-referral-dialog for the viewed order and has no inline Save/Cancel editor', () => {
    const { f, el, get } = render();
    expect(el.querySelector('pf-edit-referral-dialog')).toBeNull();
    editBtn(el)!.click();
    f.detectChanges();
    expect(el.querySelector('pf-edit-referral-dialog')).not.toBeNull();
    expect(get).toHaveBeenCalledWith('/api/orders/o1/referral');
    expect(el.querySelector('button[aria-label="Save referral"][class*="pf-hb-btn"]')).toBeNull();
    expect(el.querySelector('button[aria-label="Cancel referral edit"]')).toBeNull();
  });

  it('keeps the referral tiles read-only on an existing order (nothing inline to edit)', () => {
    const { c } = render();
    expect(c.referralInteractive()).toBe(false);
    expect(c.scopeEnabled('doctor')).toBe(false);
  });

  it('shows the saved referral and closes the dialog', () => {
    const { f, c, el } = render();
    editBtn(el)!.click();
    f.detectChanges();
    c.onReferralSaved({ changed: true, reportAmended: false, order: { id: 'o1', status: 'completed', refDoctorName: 'Dr New', refHospitalName: 'Metro', samples: [] } });
    f.detectChanges();
    expect(c.refDoctorName()).toBe('Dr New');
    expect(c.refHospitalName()).toBe('Metro');
    expect(el.querySelector('pf-edit-referral-dialog')).toBeNull();
  });

  it('is not offered without modify_order', () => {
    const { el } = render(false);
    expect(editBtn(el)).toBeNull();
  });
});
