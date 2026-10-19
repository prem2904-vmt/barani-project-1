import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { PricingComponent } from './pricing.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { TENANT_PRICE_SCOPE } from '../../../shared/utils/test-pricing';
import { PACKAGES_FILTER } from './pricing.component';

/**
 * Test Master single source — phase 2: the Pricing page IS the per-tenant
 * pricing table. The DTO carries the effective price (+ priceIsDefault /
 * isOffered); every write goes through PATCH /api/tests/prices/bulk only,
 * with `branchId` when the tenant isolates branches.
 */
const tests = [
  { id: 't1', name: 'CBC', price: 300, priceIsDefault: false, department: { id: 'd1', name: 'Haematology' } },
  { id: 't2', name: 'ALT', price: 1, priceIsDefault: true, departmentId: 'd2', department: null },
  { id: 't3', name: 'AST', price: 0, priceIsDefault: false, isOffered: false, department: { id: 'd2', name: 'Biochemistry' } },
];

function make(list: any[] = tests, opts: { isolation?: boolean; active?: string; patchErr?: any } = {}) {
  const api = {
    get: vi.fn((url: string) => of(url.startsWith('/api/tests') ? list : [])),
    patch: vi.fn(() => (opts.patchErr ? throwError(() => opts.patchErr) : of({}))),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  const tenant = signal<any>({ id: 'tn', branchIsolationEnabled: !!opts.isolation });
  const auth = {
    user: () => ({ branches: [{ id: 'b1', name: 'Alwarpet' }, { id: 'b2', name: 'Chennai' }] }),
    activeBranchId: () => opts.active ?? 'b1',
    hasPermission: () => true,
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toasts },
      { provide: AuthService, useValue: auth },
      { provide: TenantStateService, useValue: { tenant, ensureLoaded: vi.fn() } },
    ],
  });
  const c = TestBed.runInInjectionContext(() => new PricingComponent());
  c.ngOnInit();
  return { c, api, toasts };
}


/** Owner 2026-09-27: a package carries no department — Pricing lists it
 *  under its own "Packages" filter, never under a department. */
describe('PricingComponent — packages have no department', () => {
  const withPkg = [...tests,
    { id: 'k1', name: 'Wellness Basic', type: 'package', price: 999, priceIsDefault: false,
      department: { id: 'd1', name: 'Haematology' } }];   // a LEGACY stored department

  it('a package row carries no department', () => {
    const { c } = make(withPkg);
    const k1 = c.filtered().find(r => r.id === 'k1')!;
    expect(k1.isPackage).toBe(true);
    expect(k1.deptName).toBe('');
    expect(k1.deptId).toBe('');
  });

  it('a department filter never lists a package; the Packages filter lists only packages', () => {
    const { c } = make(withPkg);
    expect(c.deptOptions().some(o => o.value === PACKAGES_FILTER && o.label === 'Packages')).toBe(true);
    c.selectedDeptId.set('d1');
    expect(c.filtered().map(r => r.id)).toEqual(['t1']);
    c.selectedDeptId.set(PACKAGES_FILTER);
    expect(c.filtered().map(r => r.id)).toEqual(['k1']);
    expect(c.scopeLabel()).toBe('Applies to packages');
  });
});
