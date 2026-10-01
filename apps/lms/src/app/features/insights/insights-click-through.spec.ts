import { of } from 'rxjs';
import { vi } from 'vitest';
import { renderBandPage } from '../admin/admin-band.spec-helpers';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { InsightsComponent } from './insights.component';

/**
 * Insights — click-through (owner spec: "every chart element clicks through
 * to the matching list, pre-filtered"). Both halves of Insights read the
 * SAME filter band (period/branch signals on the component), so a KPI tap
 * only needs to switch the active tab — the Operations list underneath is
 * already scoped to the identical filter, never a re-navigation with its
 * own copied params.
 */
const OVERVIEW = { patients: 3, tests: 5, testsPerPatient: 1.67, outsourcedPct: 0, medianTatMinutes: null };

function render() {
  const api = {
    get: vi.fn((url: string) => {
      if (url.startsWith('/api/tenants/branches')) return of([]);
      if (url.startsWith('/api/analytics/overview')) return of(OVERVIEW);
      if (url.startsWith('/api/analytics/lists/patients')) return of({ total: 3, rows: [] });
      return of(null);
    }),
    post: vi.fn(() => of({})), put: vi.fn(() => of({})), patch: vi.fn(() => of({})), delete: vi.fn(() => of({})),
  };
  const p = renderBandPage(InsightsComponent, {
    providers: [
      { provide: ApiService, useValue: api },
      {
        provide: AuthService,
        useValue: {
          user: () => ({ tenantName: 'Micro World', firstName: 'Admin', permissions: ['view_analytics', 'export_patient_data'] }),
          hasPermission: () => true,
          hasAnyPermission: (codes: string[]) => ['view_analytics', 'export_patient_data'].some(c => codes.includes(c)),
          isAuthenticated: () => true,
          waitForAuth: async () => undefined,
        },
      },
    ],
  });
  // renderBandPage's OWN `api` key is its internal default stub (unused here —
  // our real ApiService provider above shadows it in DI); return OUR api so
  // assertions inspect the calls the component actually made.
  return { ...p, api };
}

describe('Insights — click-through from a chart/KPI to its list', () => {
  it('starts on the Analytics tab with the KPI grid visible', () => {
    const p = render();
    p.f.detectChanges();
    expect(p.el.querySelector('.ins-kpi-grid')).not.toBeNull();
    expect(p.el.querySelector('ag-grid-angular')).toBeNull();
  });

  it('tapping the Patients KPI switches to Operations (the Patients list) under the SAME filter', () => {
    const p = render();
    p.f.detectChanges();
    const kpi = Array.from(p.el.querySelectorAll<HTMLButtonElement>('.ins-kpi'))
      .find(b => b.textContent?.includes('Patients'));
    expect(kpi).toBeTruthy();
    kpi!.click();
    p.f.detectChanges();
    expect((p.cmp as InsightsComponent).tab()).toBe('operations');
    // Same period (today) as the Analytics tab — the filter band is shared,
    // not re-sent with different params.
    expect((p.cmp as InsightsComponent).period()).toBe('today');
  });

  it('the Operations list request carries the SAME period the Analytics tab used', async () => {
    const p = render();
    p.f.detectChanges();
    await Promise.resolve();
    p.f.detectChanges();
    const calls = (p.api.get as any).mock.calls as unknown[][];
    const overviewUrl = calls.find((c) => (c[0] as string).startsWith('/api/analytics/overview'))?.[0] as string;
    const patientsUrl = calls.find((c) => (c[0] as string).startsWith('/api/analytics/lists/patients'))?.[0] as string;
    expect(overviewUrl).toBeDefined();
    expect(patientsUrl).toBeDefined();
    const periodOf = (u: string) => new URLSearchParams(u.split('?')[1]).get('period');
    expect(periodOf(overviewUrl)).toBe(periodOf(patientsUrl));
  });
});
