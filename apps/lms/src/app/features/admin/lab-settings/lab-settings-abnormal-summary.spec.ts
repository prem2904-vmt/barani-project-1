import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { throwError } from 'rxjs';
import { vi } from 'vitest';
import { renderBandPage } from '../admin-band.spec-helpers';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { LabSettingsComponent } from './lab-settings.component';
import { readReportOption } from '../../../shared/utils/report-header-layout';

/**
 * Lab settings → Report → "Consolidated abnormal results sheet". The switch
 * is the report template's metadata option `abnormalSummary` (server-served,
 * so every viewer's report renders the same): toggling POSTs the WHOLE
 * template back with only that option changed, keeping other metadata.
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

const TEMPLATE = {
  id: 't1', labName: 'Micro World Diagnostics', primaryColor: '#1B3A6B',
  metadata: JSON.stringify({ options: { specimenLine: true }, headerLayout: { v: 1, items: {} } }),
};

/** The body of the report-template POST, if any. */
function posted(api: { post: { mock: { calls: unknown } } }): unknown {
  const calls = api.post.mock.calls as unknown as unknown[][];
  return calls.find(c => c[0] === '/api/config/report-template')?.[1];
}

function make(tpl: unknown) {
  const p = renderBandPage(LabSettingsComponent, {
    getFor: (url) => url === '/api/config/report-template' ? tpl
      : url === '/api/tenants/branch-lab-config' ? { labStructure: 'auto' } : [],
    providers,
  });
  p.cmp.tab.set('report');
  p.f.detectChanges();
  const sw = () => p.el.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Consolidated abnormal results sheet"]');
  return { ...p, sw };
}

describe('Lab settings — consolidated abnormal results sheet', () => {
  it('is an ND switch card under the Report tab, off by default', () => {
    const p = make(TEMPLATE);
    expect(p.sw()).not.toBeNull();
    expect(p.sw()!.classList.contains('pf-toggle')).toBe(true);
    expect(p.sw()!.getAttribute('aria-checked')).toBe('false');
    expect(p.sw()!.disabled).toBe(false);
    expect(p.el.textContent).toContain('Print a first page listing every');
    expect(p.el.querySelector('select, datalist, input[type="checkbox"]')).toBeNull();
  });

  it('toggle on → POSTs the whole template with the option set (other fields + metadata kept); reload reads it back', () => {
    const p = make(TEMPLATE);
    p.sw()!.click();
    p.f.detectChanges();
    const sent = posted(p.api) as typeof TEMPLATE;
    expect(sent).toBeTruthy();
    expect(sent.id).toBe('t1');
    expect(sent.labName).toBe('Micro World Diagnostics');
    expect(readReportOption(sent, 'abnormalSummary')).toBe(true);
    expect(readReportOption(sent, 'specimenLine')).toBe(true);
    expect(JSON.parse(sent.metadata).headerLayout).toEqual({ v: 1, items: {} });
    expect(p.sw()!.getAttribute('aria-checked')).toBe('true');

    // What the server stored comes back on the next visit — the switch reads it.
    TestBed.resetTestingModule();
    const again = make(sent);
    expect(again.sw()!.getAttribute('aria-checked')).toBe('true');
    again.sw()!.click();
    const off = posted(again.api) as typeof TEMPLATE;
    expect(readReportOption(off, 'abnormalSummary')).toBe(false);
    expect(readReportOption(off, 'specimenLine')).toBe(true);
  });

  it('a failed save reverts the switch and says why', () => {
    const p = make(TEMPLATE);
    p.api.post.mockReturnValueOnce(throwError(() => ({ status: 403, error: { message: 'Forbidden' } })));
    p.sw()!.click();
    p.f.detectChanges();
    expect(p.sw()!.getAttribute('aria-checked')).toBe('false');
    expect(p.toasts.error).toHaveBeenCalled();
  });

  it('no saved report design yet → switch disabled with a hint (never posts a bare template)', () => {
    const p = make(null);
    expect(p.sw()!.disabled).toBe(true);
    expect(p.el.textContent).toContain('Save the report design once');
    p.cmp.setAbnormalSummary(true);
    expect(p.api.post).not.toHaveBeenCalled();
  });
});
