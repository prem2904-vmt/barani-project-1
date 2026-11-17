import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, convertToParamMap } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { OpdGateService } from './shared/opd-gate.service';
import { opdPharmacyRedirect } from './shared/opd.guard';

/** The old /admin/opd/pharmacy (pharmacy settings + drug master, before the Settings re-home) lands on Settings → Pharmacy. */
describe('/admin/opd/pharmacy redirect', () => {
  const run = async (visible: boolean, query: Record<string, string>) => {
    const createUrlTree = vi.fn((c: string[]) => ({ tree: c[0] }));
    TestBed.configureTestingModule({ providers: [
      { provide: AuthService, useValue: { waitForAuth: async () => undefined } },
      { provide: OpdGateService, useValue: { visible: () => visible } },
      { provide: Router, useValue: { createUrlTree } },
    ] });
    const route = { queryParamMap: convertToParamMap(query) } as ActivatedRouteSnapshot;
    return TestBed.runInInjectionContext(() => opdPharmacyRedirect(route, {} as never)) as Promise<unknown>;
  };
  afterEach(() => TestBed.resetTestingModule());

  it('goes to the pharmacy settings', async () => expect(await run(true, {})).toEqual({ tree: '/admin/pharmacy' }));
  it('?tab=drugs goes to the drug master', async () => expect(await run(true, { tab: 'drugs' })).toEqual({ tree: '/admin/pharmacy/drugs' }));
  it('with OPD closed it bounces like an unknown URL', async () => expect(await run(false, {})).toEqual({ tree: '/' }));
  it('is marked as an OPD-gated route guard', () => expect((opdPharmacyRedirect as unknown as { opdGate: boolean }).opdGate).toBe(true));
});
