import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { renderBandPage } from '../admin-band.spec-helpers';
import { AuthService } from '../../../core/auth/auth.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { CommunicationSettingsPage } from '../communication/communication-settings.page';
import { OrganizationSettingsComponent } from '../organization/organization-settings.component';
import { VendorsComponent } from '../vendors/vendors.component';
import { readFileSync } from 'node:fs';
import { SETTINGS_FULL_PAGE_ROUTES, SETTINGS_SHELL_CHILDREN } from '../settings/settings.routes';
import { OPD_ADMIN_ROUTES } from '../../opd/opd.routes';
import { PHARMACY_VIEW } from '../../opd/pharmacy/pharmacy-view';
import { ROUTE_ACCESS } from '../../../core/auth/route-access';

const route = (data: Record<string, unknown>) => ({ provide: ActivatedRoute, useValue: { snapshot: { data, queryParamMap: new Map() as any, paramMap: new Map() as any }, queryParamMap: of(new Map() as any) } });
afterEach(() => TestBed.resetTestingModule());

describe('Organization › Patient numbers (/admin/org/numbers)', () => {
  it('shows only the Patient ID — Identity, Sample ID and Order ID are not here (Order ID moved to Lab, OPD, Pharmacy)', () => {
    const p = renderBandPage(OrganizationSettingsComponent, { getFor: () => ({}), providers: [route({ orgTabs: ['patient'] })] });
    const tabs = Array.from(p.el.querySelectorAll('pf-hero-band .pf-hb__tools pf-segmented .seg-item')).map(b => b.getAttribute('aria-label'));
    expect(tabs).toEqual(['Patient ID']);
    expect(p.cmp.tab()).toBe('patient');
    expect(p.el.querySelector('pf-setting-group .pf-sgroup__label')?.textContent?.trim()).toBe('Patient ID');
    expect(p.el.textContent).not.toContain('Organization login handle');
    expect(p.el.textContent).not.toContain('Sample ID format');
    expect(p.el.querySelector('pf-order-id-format-card')).toBeNull();
    expect(p.el.textContent).not.toContain('Order ID');
    expect(p.api.get).not.toHaveBeenCalledWith(expect.stringContaining('/api/config/order-id'));
  });

  it('Patient ID still saves the same payload', () => {
    const p = renderBandPage(OrganizationSettingsComponent, { getFor: () => ({}), providers: [route({ orgTabs: ['patient'] })] });
    p.cmp.savePatientId();
    expect(p.api.post).toHaveBeenCalledWith('/api/config/patient-id', expect.objectContaining({ datePrefix: 'ddmmyy', serialMode: 'numeric' }));
  });

  it('the old /admin/organization (no route data) keeps its two tabs (Sample ID and Order ID moved)', () => {
    const p = renderBandPage(OrganizationSettingsComponent, { getFor: () => ({}) });
    const tabs = Array.from(p.el.querySelectorAll('pf-hero-band .pf-hb__tools pf-segmented .seg-item')).map(b => b.getAttribute('aria-label'));
    expect(tabs).toEqual(['Identity', 'Patient ID']);
  });
});

describe('Organization › Message channels (/admin/org/channels)', () => {
  const providers = (data: Record<string, unknown>) => [
    route(data),
    { provide: AuthService, useValue: { user: () => ({ tenantName: 'MW', permissions: [] }), activeBranchId: () => null, hasPermission: () => true, hasAnyPermission: () => true, isAuthenticated: () => true, waitForAuth: async () => undefined } },
    { provide: TenantStateService, useValue: { tenant: () => null, ensureLoaded: vi.fn(), update: vi.fn() } },
    { provide: BranchLabConfigService, useValue: { collectionMode: signal('front_desk'), billingMode: signal('front_desk'), ensureLoaded: vi.fn(), update: vi.fn() } },
    { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true, ensureLoaded: vi.fn() } },
  ];
  const WA = { autoSendEnabled: false, sendUpdatedReports: true, sender: { source: 'platform', displayName: 'Prefrontal', status: 'not_connected', tokenStored: false, canConnect: false },
    platform: { enabled: true, configured: true, webhookConfigured: true } };
  const make = (data: Record<string, unknown>) => renderBandPage(CommunicationSettingsPage, {
    getFor: (u) => u === '/api/whatsapp/settings' ? WA : u.includes('/settings/communication') ? { whatsapp: { auto: true, chat: true }, sms: { chat: true }, email: { enabled: true, mode: 'platform', ready: true } } : [],
    providers: providers(data),
  });

  it('the accounts stay (number, usage); what the lab SENDS (WhatsApp Auto, send again) lives in Lab › Report, not here', () => {
    const p = make({});
    p.f.detectChanges();
    expect(p.el.querySelector('[data-testid="ls-whatsapp"]')).toBeNull();
    expect(p.el.textContent).not.toContain('send the report automatically when it is ready');
    expect(p.el.querySelector('[data-testid="ls-wa-connect-card"]')).not.toBeNull();
    expect(p.el.querySelector('[data-testid="ls-wa-chat"]')).not.toBeNull();
  });

  it('email sender / SMTP and SMS are still on their tabs', () => {
    const p = make({});
    p.cmp.tab.set('email'); p.f.detectChanges();
    expect(p.el.querySelector('[data-testid="cm-email"]')).not.toBeNull();
    p.cmp.tab.set('sms'); p.f.detectChanges();
    expect(p.el.querySelector('[data-testid="cm-sms"]')).not.toBeNull();
  });

});

describe('Credit accounts — setup in Billing, money on Finance', () => {
  const vendor = { id: 'v1', name: 'Apollo Hospital', code: 'APOLLO', isActive: true, totalCredit: 0, usedCredit: 0, outstanding: 500, createdAt: '2026-01-01' };
  const make = (data: Record<string, unknown>) => renderBandPage(VendorsComponent, {
    getFor: (u) => (u.startsWith('/api/vendors') && !u.includes('/transactions') ? [vendor] : []),
    providers: [route(data)],
  });
  const labels = (p: any) => p.cmp.actionsFor(vendor).map((a: any) => a.label);

  it('setup view: add, edit and deactivate only — no top up, payment, statement or history', () => {
    const p = make({ creditView: 'setup' });
    expect(labels(p)).toEqual(['Edit', 'Deactivate']);
    expect(p.actions().some(b => b.textContent?.includes('Add vendor'))).toBe(true);
  });

  it('money view: top up, record payment, email statement, history — and no Add vendor', () => {
    const p = make({ creditView: 'money' });
    expect(labels(p)).toEqual(['Top up', 'Record payment', 'Email statement', 'View history']);
    expect(p.actions().some(b => b.textContent?.includes('Add vendor'))).toBe(false);
    p.cmp.toggleNewVendor();
    p.f.detectChanges();
    expect(p.el.querySelector('.pf-vn-new')).toBeNull();
  });

  it('the old Vendor Wallets page (no data) shows both, and the money APIs are unchanged', () => {
    const p = make({});
    expect(labels(p)).toContain('Top up');
    expect(labels(p)).toContain('Deactivate');
    p.cmp.openTopUp(vendor);
    p.cmp.topUpAmount.set('1000');
    p.cmp.confirmTopUp(vendor);
    expect(p.api.post).toHaveBeenCalledWith('/api/vendors/v1/topup', expect.objectContaining({ amount: 1000 }));
  });
});

describe('Settings re-home routes (hosted by the Settings shell; one route table)', () => {
  // Card-style pages are hosted by the shell; full-screen ones (Drug master …) are top-level routes (DESIGN-V2 rule 2).
  const ALL = [...SETTINGS_SHELL_CHILDREN, ...SETTINGS_FULL_PAGE_ROUTES, ...OPD_ADMIN_ROUTES.filter(r => !SETTINGS_SHELL_CHILDREN.includes(r))];
  const by = (path: string) => ALL.find(r => r.path === path)!;
  it('declares every routed page once (hosted card pages in the shell)', () => {
    for (const p of ['admin/org/profile', 'admin/org/numbers', 'admin/org/channels', 'admin/billing', 'admin/ipd/alerts', 'admin/pharmacy', 'admin/opd/front-desk']) {
      expect(SETTINGS_SHELL_CHILDREN.filter(r => r.path === p).length, p).toBe(1);
    }
    expect(ALL.filter(r => r.path === 'admin/pharmacy/drugs').length).toBe(1);
    expect(SETTINGS_SHELL_CHILDREN.some(r => r.path === 'admin/pharmacy/drugs')).toBe(false);
  });
  it('every page is guarded (nothing opens without a permission or module gate)', () => {
    for (const p of ['admin/org/profile', 'admin/org/numbers', 'admin/org/channels', 'admin/billing', 'admin/ipd/alerts', 'admin/pharmacy', 'admin/pharmacy/drugs']) {
      expect(by(p).canActivate?.length, p).toBeGreaterThan(0);
    }
  });
  it('the OPD and pharmacy pages are behind the OPD gate; IPD alerts behind the case-sheet gate', () => {
    expect(by('admin/pharmacy').canActivate!.some(g => (g as any).opdGate)).toBe(true);
    expect(by('admin/pharmacy/drugs').canActivate!.some(g => (g as any).opdGate)).toBe(true);
    expect(by('admin/ipd/alerts').canActivate!.length).toBeGreaterThanOrEqual(2);
  });
  it('Order IDs per module: Visit numbers and Dispense numbers are hosted OPD-gated pages with their own permission', () => {
    for (const p of ['admin/opd/numbers', 'admin/pharmacy/numbers']) {
      expect(SETTINGS_SHELL_CHILDREN.filter(r => r.path === p).length, p).toBe(1);
      expect(by(p).canActivate!.some(g => (g as any).opdGate), p).toBe(true);
    }
    expect(ROUTE_ACCESS['/admin/opd/numbers']).toEqual({ perms: ['manage_opd', 'manage_users', 'manage_billing_config'] });
    expect(ROUTE_ACCESS['/admin/pharmacy/numbers']).toEqual({ perms: ['manage_pharmacy', 'manage_inventory', 'manage_billing_config'] });
  });
  it('route data pins what each reused screen shows', () => {
    expect(by('admin/org/numbers').data).toEqual({ orgTabs: ['patient'] });
    expect(by('admin/ipd/alerts').data).toEqual({ department: 'ipd' });
    expect(by('admin/pharmacy/drugs').data?.[PHARMACY_VIEW]).toBe('drugs');
    expect(readFileSync('apps/lms/src/app/app.routes.ts', 'utf8')).toMatch(/path: 'finance\/credit-accounts',[\s\S]{0,120}data: \{ creditView: 'money' \}/);
  });
  it('the access table has an entry for each guarded page', () => {
    for (const p of ['/admin/org/profile', '/admin/org/numbers', '/admin/org/channels', '/finance/credit-accounts', '/admin/ipd/alerts']) {
      expect(ROUTE_ACCESS[p], p).toBeTruthy();
    }
  });
});
