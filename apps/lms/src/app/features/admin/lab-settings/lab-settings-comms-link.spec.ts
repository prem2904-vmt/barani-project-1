import { signal } from '@angular/core';
import { vi } from 'vitest';
import { renderBandPage } from '../admin-band.spec-helpers';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { LabSettingsComponent } from './lab-settings.component';

/** WhatsApp moved to Settings → Communication (2026-11-13): Lab settings → Report keeps ONE link card, no WhatsApp cards. */
const providers = [
  { provide: AuthService, useValue: {
    user: () => ({ tenantName: 'Micro World', firstName: 'Admin', branchId: null, permissions: [] }),
    activeBranchId: () => null, hasPermission: () => true, hasAnyPermission: () => true,
    isAuthenticated: () => true, waitForAuth: async () => undefined,
  } },
  { provide: TenantStateService, useValue: { tenant: () => null, ensureLoaded: vi.fn(), update: vi.fn() } },
  { provide: BranchLabConfigService, useValue: { collectionMode: signal('front_desk'), billingMode: signal('front_desk'), ensureLoaded: vi.fn(), update: vi.fn() } },
  { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true, ensureLoaded: vi.fn() } },
];

describe('Lab settings → Report: WhatsApp lives in Communication now', () => {
  it('shows a link card to Communication and no WhatsApp cards; never reads the WhatsApp settings', () => {
    const p = renderBandPage(LabSettingsComponent, {
      getFor: (url) => url === '/api/tenants/branch-lab-config' ? { labStructure: 'auto' } : [],
      providers,
    });
    p.cmp.tab.set('report');
    p.f.detectChanges();
    const link = p.el.querySelector<HTMLAnchorElement>('[data-testid="ls-comms-open"]')!;
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('/admin/communication');
    expect(p.el.querySelector('[data-testid="ls-whatsapp"], pf-wa-connect-card, pf-wa-billing-card')).toBeNull();
    expect(p.api.get).not.toHaveBeenCalledWith('/api/whatsapp/settings');
  });
});
