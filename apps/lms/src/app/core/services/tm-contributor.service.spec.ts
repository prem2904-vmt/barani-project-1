import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { vi } from 'vitest';
import { ApiService } from './api.service';
import { AuthService } from '../auth/auth.service';
import { TenantStateService } from './tenant-state.service';
import { TestPricingService } from './test-pricing.service';
import { TmContributorService } from './tm-contributor.service';
import { CONTRIBUTE_CODE, settingsLevel } from '../../shared/utils/settings-access';

/** "Send for approval" (Settings access, owner 2026-11-18): a Test Master contributor's saves become pending changes. */
function setup(perms: string[]) {
  const post = vi.fn(() => of({ created: [], skipped: [] }));
  const patch = vi.fn(() => of({}));
  TestBed.configureTestingModule({ providers: [
    { provide: ApiService, useValue: { post, patch, get: vi.fn(() => of(null)) } },
    { provide: AuthService, useValue: { settingsLevel: (a: never) => settingsLevel(perms, a), activeBranchId: () => null } },
    { provide: TenantStateService, useValue: { tenant: () => null, ensureLoaded: () => {} } },
  ] });
  return { svc: TestBed.inject(TmContributorService), pricing: TestBed.inject(TestPricingService), post, patch };
}

describe('TmContributorService / TestPricingService for a contributor', () => {
  it('a contributor is recognised; an editor is not', () => {
    expect(setup(['view_test', CONTRIBUTE_CODE.test_master]).svc.isContributor()).toBe(true);
    TestBed.resetTestingModule();
    expect(setup(['manage_test_master']).svc.isContributor()).toBe(false);
  });

  it('a test edit goes to test-update with only the changed fields', async () => {
    const { svc, post } = setup([CONTRIBUTE_CODE.test_master]);
    await firstValueFrom(svc.proposeUpdate('t1', { tatHours: 72 }));
    expect(post).toHaveBeenCalledWith('/api/settings-changes/test-master/test-update', { testId: 't1', fields: { tatHours: 72 } });
  });

  it('a new test never carries a code or a tax; the price rides alongside', async () => {
    const { svc, post } = setup([CONTRIBUTE_CODE.test_master]);
    await firstValueFrom(svc.proposeCreate({ name: 'Ferritin', testCode: 'X1', price: 500, taxSlab: 5, departmentId: 'd1' }, 500));
    expect(post).toHaveBeenCalledWith('/api/settings-changes/test-master/test-create', { fields: { name: 'Ferritin', departmentId: 'd1' }, price: 500 });
  });

  it('price writes of a contributor are proposals, never the bulk PATCH', async () => {
    const { pricing, post, patch } = setup([CONTRIBUTE_CODE.test_master]);
    await firstValueFrom(pricing.save([{ testId: 't1', price: 450 }]));
    expect(patch).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/api/settings-changes/test-master/prices', { changes: [{ testId: 't1', price: 450 }] });
  });

  it('an editor still writes prices directly', async () => {
    const { pricing, post, patch } = setup(['manage_tests']);
    await firstValueFrom(pricing.save([{ testId: 't1', price: 450 }]));
    expect(post).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledTimes(1);
  });
});
