import { of } from 'rxjs';
import { vi } from 'vitest';
import { renderBandPage } from '../admin/admin-band.spec-helpers';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { InsightsComponent } from './insights.component';

/**
 * Insights — money-hidden rendering (owner spec: view_financial_analytics
 * gates every money figure; withheld at the SOURCE, the UI only mirrors it).
 * The server omits null money fields from the JSON entirely (Program.cs
 * ignore-null); the component must render those KPI cards as simply ABSENT,
 * never a blank/garbled "₹undefined" or "NaN".
 */
const OVERVIEW_NO_MONEY = {
  patients: 4, tests: 9, testsPerPatient: 2.25, outsourcedPct: 11.1, medianTatMinutes: 95,
  // billedNet / collected / avgBillValue omitted — exactly what the server sends
  // when view_financial_analytics is absent.
};
const OVERVIEW_WITH_MONEY = { ...OVERVIEW_NO_MONEY, billedNet: 18000, collected: 17500, avgBillValue: 4500 };

function authStub(perms: string[]) {
  return {
    user: () => ({ tenantName: 'Micro World', firstName: 'Admin', permissions: perms }),
    hasPermission: (c: string) => perms.includes(c),
    hasAnyPermission: (codes: string[]) => codes.some(c => perms.includes(c)),
    isAuthenticated: () => true,
    waitForAuth: async () => undefined,
  };
}

function render(perms: string[], overview: unknown) {
  const api = {
    get: vi.fn((url: string) => {
      if (url.startsWith('/api/tenants/branches')) return of([]);
      if (url.startsWith('/api/analytics/overview')) return of(overview);
      if (url.startsWith('/api/analytics/lists/patients')) return of({ total: 0, rows: [] });
      return of(null);
    }),
    post: vi.fn(() => of({})), put: vi.fn(() => of({})), patch: vi.fn(() => of({})), delete: vi.fn(() => of({})),
  };
  const p = renderBandPage(InsightsComponent, {
    providers: [
      { provide: ApiService, useValue: api },
      { provide: AuthService, useValue: authStub(perms) },
    ],
  });
  return { ...p, api };
}

describe('Insights — money-hidden rendering', () => {
  it('without view_financial_analytics: money KPI cards are absent, non-money KPIs still render', () => {
    const p = render(['view_analytics'], OVERVIEW_NO_MONEY);
    p.f.detectChanges();
    const text = p.el.textContent ?? '';
    expect(text).toContain('Patients');
    expect(text).toContain('Median TAT');
    expect(text).not.toContain('Billed (net)');
    expect(text).not.toContain('Collected');
    // money-only sections and lists are not offered at all
    expect(text).not.toContain('Profitability');
    expect(text).not.toContain('Outstanding payments');
    expect(text).not.toContain('Avg bill value');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');
    p.f.destroy();
  });

  it('with view_financial_analytics: money KPI cards render with a rupee value', () => {
    const p = render(['view_analytics', 'view_financial_analytics'], OVERVIEW_WITH_MONEY);
    p.f.detectChanges();
    const text = p.el.textContent ?? '';
    expect(text).toContain('Billed (net)');
    expect(text).toContain('Collected');
    expect(text).toContain('Avg bill value');
    expect(text).toMatch(/₹\s?18,000|₹18,000/);
    p.f.destroy();
  });

  it('without view_analytics at all: the area says so, no KPI cards render', () => {
    const p = render([], OVERVIEW_NO_MONEY);
    p.f.detectChanges();
    expect(p.el.textContent).toContain("don't have access");
    expect(p.el.querySelector('.pf-ins-kpi')).toBeNull();
    p.f.destroy();
  });
});
