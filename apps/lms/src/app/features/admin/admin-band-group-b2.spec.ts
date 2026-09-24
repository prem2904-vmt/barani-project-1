import { signal } from '@angular/core';
import { vi } from 'vitest';
import { renderBandPage } from './admin-band.spec-helpers';
import { AuthService } from '../../core/auth/auth.service';
import { TenantStateService } from '../../core/services/tenant-state.service';
import { BranchLabConfigService } from '../../core/services/branch-lab-config.service';
import { TenantEntitlementsService } from '../../core/services/tenant-entitlements.service';
import { LabSettingsComponent } from './lab-settings/lab-settings.component';
import { OrganizationSettingsComponent } from './organization/organization-settings.component';

/**
 * Admin band — settings forms whose section cards become a tabs-only pill
 * (group B2). Each page: band present, NO pill search, clicking a pill tab
 * swaps the visible section cards, and any page-level Save lives in the band.
 */

const auth = {
  provide: AuthService,
  useValue: {
    user: () => ({ tenantName: 'Micro World', firstName: 'Admin', branchId: null, permissions: [] }),
    activeBranchId: () => null,
    hasPermission: () => true,
    hasAnyPermission: () => true,
    isAuthenticated: () => true,
    waitForAuth: async () => undefined,
  },
};
const tenantState = {
  provide: TenantStateService,
  useValue: { tenant: () => null, ensureLoaded: vi.fn(), update: vi.fn() },
};

/** Pill tab buttons + a click helper. */
function pillTabs(p: ReturnType<typeof renderBandPage>) {
  const btns = () => Array.from(p.tools()!.querySelectorAll<HTMLButtonElement>('pf-segmented button'));
  return {
    labels: () => btns().map((b) => b.getAttribute('aria-label')),
    click: (label: string) => {
      const b = btns().find((x) => x.getAttribute('aria-label') === label);
      if (!b) throw new Error(`no pill tab "${label}"`);
      b.click();
      p.f.detectChanges();
    },
  };
}
const titles = (p: ReturnType<typeof renderBandPage>, sel: string) =>
  Array.from(p.body()!.querySelectorAll(sel)).map((h) => (h.textContent ?? '').trim());

describe('Admin band B2 — Lab settings', () => {
  function make() {
    return renderBandPage(LabSettingsComponent, {
      getFor: (url) => (url === '/api/tenants/branch-lab-config' ? { labStructure: 'auto' } : []),
      providers: [
        auth,
        tenantState,
        {
          provide: BranchLabConfigService,
          useValue: {
            collectionMode: signal('front_desk'),
            billingMode: signal('front_desk'),
            ensureLoaded: vi.fn(),
            update: vi.fn(),
          },
        },
        { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true, ensureLoaded: vi.fn() } },
      ],
    });
  }

  it('band with a tabs-only pill (no search), header classic-only, one scrolling body', () => {
    const p = make();
    expect(p.band()).not.toBeNull();
    expect(p.bandInput()).toBeNull();
    expect(p.el.querySelector('.pf-hb__search--tabs')).not.toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
    expect(p.body()).not.toBeNull();
    expect(pillTabs(p).labels()).toEqual(['Collection & IDs', 'Queues & assignment', 'Rules & gates']);
  });

  it('pill tabs swap the visible section cards', () => {
    const p = make();
    const t = () => titles(p, '.pf-ls__title');
    expect(t()).toContain('Sample identification');
    expect(t()).toContain('Specimen label code');
    expect(t()).not.toContain('Queue focus');

    pillTabs(p).click('Queues & assignment');
    expect(t()).toEqual(expect.arrayContaining(['Queue focus', 'Lab structure', 'Auto-assign by department']));
    expect(t()).not.toContain('Sample identification');

    pillTabs(p).click('Rules & gates');
    expect(t()).toEqual(expect.arrayContaining(['Calculation constants', 'Require full payment to progress', 'Enable inventory']));
    expect(t()).not.toContain('Lab structure');
  });

  it('autosaves — no page-level band action', () => {
    const p = make();
    expect(p.actions().length).toBe(0);
  });
});

describe('Admin band B2 — Organization & Identity', () => {
  function make() {
    return renderBandPage(OrganizationSettingsComponent, {
      getFor: (url) => (url === '/api/tenants/current' ? { name: 'Micro World', slug: 'microworld' } : {}),
      providers: [auth, tenantState],
    });
  }

  it('band with a tabs-only pill, header classic-only', () => {
    const p = make();
    expect(p.band()).not.toBeNull();
    expect(p.bandInput()).toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
    expect(pillTabs(p).labels()).toEqual(['Identity', 'Patient ID', 'Sample ID', 'Order ID']);
  });

  it('pill tabs swap the cards; each card keeps its own Save', () => {
    const p = make();
    const t = () => titles(p, '.pf-ls__title');
    expect(t()).toEqual(['Organization name', 'Organization login handle']);
    pillTabs(p).click('Patient ID');
    expect(t()).toEqual(['Patient ID format']);
    pillTabs(p).click('Sample ID');
    expect(t()).toEqual(['Sample ID format']);
    pillTabs(p).click('Order ID');
    expect(t()).toEqual(['Order ID format']);
    expect(p.actions().length).toBe(0);
  });
});
