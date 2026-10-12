import { signal } from '@angular/core';
import { vi } from 'vitest';
import { renderBandPage } from '../admin-band.spec-helpers';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { LabSettingsComponent } from './lab-settings.component';

/**
 * Lab settings → Report → "Technician notes on report" (owner 2026-09-30):
 * a per-branch ND switch on branch-lab-config (`techReportNotes`), off by
 * default; toggling PATCHes only that field.
 */
const providers = [
  {
    provide: AuthService,
    useValue: {
      user: () => ({ tenantName: 'Micro World', firstName: 'Admin', branchId: null, permissions: [] }),
      activeBranchId: () => null, hasPermission: () => true, hasAnyPermission: () => true,
      isAuthenticated: () => true, waitForAuth: async () => undefined,
    },
  },
  { provide: TenantStateService, useValue: { tenant: () => null, ensureLoaded: vi.fn(), update: vi.fn() } },
  {
    provide: BranchLabConfigService,
    useValue: { collectionMode: signal('front_desk'), billingMode: signal('front_desk'), ensureLoaded: vi.fn(), update: vi.fn() },
  },
  { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true, ensureLoaded: vi.fn() } },
];

function make(cfg: Record<string, unknown>) {
  const p = renderBandPage(LabSettingsComponent, {
    getFor: (url) => url === '/api/tenants/branch-lab-config' ? { labStructure: 'auto', ...cfg }
      : url === '/api/config/report-template' ? null : [],
    providers,
  });
  p.cmp.tab.set('report');
  p.f.detectChanges();
  const sw = () => p.el.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Technician notes on report"]');
  return { ...p, sw };
}

describe('Lab settings — technician notes on report', () => {
  it('is an ND switch card under the Report tab, off by default', () => {
    const p = make({});
    expect(p.sw()).not.toBeNull();
    expect(p.sw()!.classList.contains('pf-toggle')).toBe(true);
    expect(p.sw()!.getAttribute('aria-checked')).toBe('false');
    expect(p.el.querySelector('[data-testid="ls-tech-notes"]')!.textContent).toContain('prints on the final report');
  });

  it('reads the saved switch and PATCHes only techReportNotes', () => {
    const p = make({ techReportNotes: true });
    expect(p.sw()!.getAttribute('aria-checked')).toBe('true');
    p.sw()!.click();
    p.f.detectChanges();
    const calls = (p.api.patch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const body = calls.find(c => c[0] === '/api/tenants/branch-lab-config')?.[1];
    expect(body).toEqual({ techReportNotes: false });
    expect(p.sw()!.getAttribute('aria-checked')).toBe('false');
  });
});
