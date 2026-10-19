import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { TestPricingService } from './test-pricing.service';
import { ApiService } from './api.service';
import { TenantStateService } from './tenant-state.service';
import { AuthService } from '../auth/auth.service';

function make(isolation: boolean | undefined, active: string | null = 'b1') {
  const api = { patch: vi.fn(() => of({})) };
  const tenant = signal<any>(isolation === undefined ? null : { id: 'tn', branchIsolationEnabled: isolation });
  const ensureLoaded = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: TenantStateService, useValue: { tenant, ensureLoaded } },
      { provide: AuthService, useValue: { activeBranchId: () => active } },
    ],
  });
  return { svc: TestBed.inject(TestPricingService), api, tenant, ensureLoaded };
}

describe('TestPricingService — the one price writer', () => {
  it('isolation OFF: writes the tenant price (no branchId)', () => {
    const { svc, api } = make(false);
    svc.save([{ testId: 't1', price: 200 }]).subscribe();
    expect(api.patch).toHaveBeenCalledWith('/api/tests/prices/bulk', { updates: [{ testId: 't1', price: 200 }] });
  });

  it('isolation ON: inline edits write the ACTING branch', () => {
    const { svc, api } = make(true, 'b7');
    expect(svc.isolationOn()).toBe(true);
    expect(svc.actingBranchId()).toBe('b7');
    svc.save([{ testId: 't1', price: 200, taxSlab: 5 }]).subscribe();
    expect(api.patch).toHaveBeenCalledWith('/api/tests/prices/bulk', { updates: [{ testId: 't1', price: 200, taxSlab: 5 }], branchId: 'b7' });
  });

  it('explicit scope wins: a branch id, or null for the tenant default', () => {
    const { svc, api } = make(true, 'b7');
    svc.save([{ testId: 't1', price: 1 }], 'b2').subscribe();
    expect(api.patch).toHaveBeenLastCalledWith('/api/tests/prices/bulk', { updates: [{ testId: 't1', price: 1 }], branchId: 'b2' });
    svc.save([{ testId: 't1', price: 1 }], null).subscribe();
    expect(api.patch).toHaveBeenLastCalledWith('/api/tests/prices/bulk', { updates: [{ testId: 't1', price: 1 }] });
  });

  it('tenant not loaded yet → treated as isolation OFF; ensureLoaded delegates', () => {
    const { svc, ensureLoaded } = make(undefined);
    expect(svc.isolationOn()).toBe(false);
    expect(svc.actingBranchId()).toBeNull();
    svc.ensureLoaded();
    expect(ensureLoaded).toHaveBeenCalled();
  });
});
