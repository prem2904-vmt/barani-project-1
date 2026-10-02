import { of } from 'rxjs';
import { vi } from 'vitest';
import { renderBandPage } from '../admin/admin-band.spec-helpers';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { InsightsComponent } from './insights.component';

/**
 * Insights — click-through (owner spec: "every chart element clicks through
 * to its list, pre-filtered"). Analytics and the lists read the SAME band;
 * a drill narrows only the LIST (a bucket's days, one department / test /
 * doctor) and never moves the band.
 */
const OVERVIEW = { patients: 3, tests: 5, testsPerPatient: 1.67, outsourcedPct: 0, medianTatMinutes: null };

function render(perms = ['view_analytics', 'export_patient_data'], overview: unknown = OVERVIEW) {
  const api = {
    get: vi.fn((url: string) => {
      if (url.startsWith('/api/tenants/branches')) return of([]);
      if (url.startsWith('/api/analytics/overview')) return of(overview);
      if (url.startsWith('/api/analytics/lists/')) return of({ total: 3, rows: [] });
      if (url.startsWith('/api/analytics/trends/')) return of({ bucketUnit: 'day', points: [] });
      return of([]);
    }),
    getBlob: vi.fn(() => of(new Blob(['a,b']))),
    post: vi.fn(() => of({})), put: vi.fn(() => of({})), patch: vi.fn(() => of({})), delete: vi.fn(() => of({})),
  };
  const p = renderBandPage(InsightsComponent, {
    providers: [
      { provide: ApiService, useValue: api },
      {
        provide: AuthService,
        useValue: {
          user: () => ({ tenantName: 'Micro World', firstName: 'Admin', permissions: perms }),
          hasPermission: (c: string) => perms.includes(c),
          hasAnyPermission: (codes: string[]) => perms.some(c => codes.includes(c)),
          isAuthenticated: () => true,
          waitForAuth: async () => undefined,
        },
      },
    ],
  });
  return { ...p, api, c: p.cmp as InsightsComponent };
}

const urls = (api: { get: { mock: { calls: unknown[][] } } }) => api.get.mock.calls.map(c => c[0] as string);
const paramsOf = (u: string) => new URLSearchParams(u.split('?')[1]);

describe('Insights — layout + defaults', () => {
  it('opens on Overview, This month, with KPI tiles and no grid', () => {
    const p = render();
    p.f.detectChanges();
    expect(p.c.period()).toBe('month');
    expect(p.el.querySelectorAll('.pf-ins-kpi').length).toBeGreaterThan(0);
    expect(p.el.querySelector('ag-grid-angular')).toBeNull();
    const ov = urls(p.api).find(u => u.startsWith('/api/analytics/overview'))!;
    expect(paramsOf(ov).get('period')).toBe('month');
  });

  it('has the ND anatomy: SECTIONS card on the left, the main card, ONE primary', () => {
    const p = render();
    p.f.detectChanges();
    expect(p.el.querySelector('aside.pf-ins-nav')).not.toBeNull();
    expect(p.el.querySelector('section.pf-ins-main')).not.toBeNull();
    expect(p.el.querySelectorAll('.nd-btn--primary').length).toBeLessThanOrEqual(1);
    const items = Array.from(p.el.querySelectorAll('.pf-ins-nav__item')).map(b => b.textContent?.trim());
    expect(items).toContain('Patients & Volume');
    expect(items).toContain('Patients');
  });

  it('an empty period shows ONE calm banner and no red delta', () => {
    const p = render(undefined, { patients: 0, tests: 0, testsPerPatient: 0, outsourcedPct: 0, medianTatMinutes: null });
    p.f.detectChanges();
    expect(p.el.querySelector('.pf-ins-banner')).not.toBeNull();
    expect(p.el.querySelector(".pf-ins-delta[data-tone='bad']")).toBeNull();
    expect(p.el.textContent).not.toContain('-100%');
    expect(p.el.textContent).not.toContain('−100%');
  });
});

describe('Insights — click-through to the list', () => {
  it('a KPI selects its breakdown; the CTA opens its list under the SAME period', () => {
    const p = render();
    p.f.detectChanges();
    const kpi = Array.from(p.el.querySelectorAll<HTMLButtonElement>('.pf-ins-kpi')).find(b => b.textContent?.includes('Patients'))!;
    kpi.click();
    p.f.detectChanges();
    expect(p.c.selectedKpi()).toBe('patients');
    const cta = p.el.querySelector<HTMLButtonElement>('.nd-btn--primary')!;
    expect(cta.textContent).toContain('Open patients');
    cta.click();
    p.f.detectChanges();
    expect(p.c.nav()).toBe('list:patients');
    const ov = urls(p.api).find(u => u.startsWith('/api/analytics/overview'))!;
    const list = urls(p.api).find(u => u.startsWith('/api/analytics/lists/patients'))!;
    expect(paramsOf(list).get('period')).toBe(paramsOf(ov).get('period'));
    expect(paramsOf(list).get('from')).toBe(paramsOf(ov).get('from'));
  });

  it('a trend-bucket drill narrows the LIST to that day; the band period stays', () => {
    const p = render();
    p.f.detectChanges();
    const day = p.c.resolved().toYmd;
    p.c.drillVolume({ name: day, dataIndex: 0 });
    p.f.detectChanges();
    expect(p.c.nav()).toBe('list:test-volume');
    expect(p.c.period()).toBe('month');
    const list = urls(p.api).filter(u => u.startsWith('/api/analytics/lists/test-volume')).pop()!;
    expect(paramsOf(list).get('period')).toBe('custom');
    expect(paramsOf(list).get('from')).toBe(day);
    expect(paramsOf(list).get('to')).toBe(day);
    // the drill chip clears it
    p.el.querySelector<HTMLButtonElement>('.pf-ins-drillchip')!.click();
    p.f.detectChanges();
    const after = urls(p.api).filter(u => u.startsWith('/api/analytics/lists/test-volume')).pop()!;
    expect(paramsOf(after).get('period')).toBe('month');
  });

  it('a department drill passes the department id to a list that takes it', () => {
    const p = render();
    p.f.detectChanges();
    p.c.drillDept({ name: 'Haematology', dataIndex: 0, key: 'dep-1' }, []);
    p.f.detectChanges();
    const list = urls(p.api).filter(u => u.startsWith('/api/analytics/lists/test-volume')).pop()!;
    expect(paramsOf(list).get('departmentId')).toBe('dep-1');
  });

  it('band dimensions a list cannot take are not sent to it', () => {
    const p = render();
    p.f.detectChanges();
    p.c.setFilter('department', 'dep-9');
    p.c.goList('orders');
    p.f.detectChanges();
    const list = urls(p.api).filter(u => u.startsWith('/api/analytics/lists/orders')).pop()!;
    expect(paramsOf(list).get('departmentId')).toBeNull();
    expect(p.c.ignoredFilters()).toEqual(['department']);
  });
});
