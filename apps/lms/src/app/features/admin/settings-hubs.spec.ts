import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { renderBandPage } from './admin-band.spec-helpers';
import { AdminOverviewComponent } from './admin-overview.component';
import { PartnersComponent } from './partners/partners.component';
import { LabSettingsHubComponent } from '../lab/lab-settings-hub/lab-settings-hub.component';
import { AuthService } from '../../core/auth/auth.service';
import { SETTINGS_PARENT } from '../../shared/utils/settings-catalog';
import { ADMIN_CATEGORIES } from '../../shared/utils/settings-tiles';

/**
 * Settings hubs — one home per screen (owner 2026-11-01: "overall lot of
 * duplicate"), and the precise search with Enter → top hit.
 */
const authAs = (perms: string[]) => ({
  provide: AuthService,
  useValue: {
    user: () => ({ tenantName: 'Micro World', firstName: 'Admin', permissions: perms }),
    hasPermission: (c: string) => perms.includes('*') || perms.includes(c),
    hasAnyPermission: (c: string[]) => perms.includes('*') || c.some((x) => perms.includes(x)),
    isAuthenticated: () => true,
    waitForAuth: async () => undefined,
  },
});

const linkHrefs = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLAnchorElement>('.pf-band-body a')).map((a) => (a.getAttribute('href') ?? '').split('?')[0]);

describe('Settings hubs — each screen has ONE hub', () => {
  it('Lab hub: no Referral Labs / Referring Network copies — one link to the Referral & Vendors hub', () => {
    const p = renderBandPage(LabSettingsHubComponent);
    const hrefs = linkHrefs(p.el);
    expect(hrefs).not.toContain('/admin/referral-labs');
    expect(hrefs).not.toContain('/admin/referring-network');
    expect(hrefs.filter((h) => h === '/admin/partners').length).toBe(1);
  });

  it('Settings overview: Vendor Wallets is not a second tile under Finance, and no screen is listed twice', () => {
    const all = ADMIN_CATEGORIES.flatMap((c) => c.tiles.map((t) => t.href));
    expect(all).not.toContain('/admin/vendors');
    expect(new Set(all).size).toBe(all.length);
  });

  it('every tile a hub lists climbs back to THAT hub (tile list and back map agree)', () => {
    const lab = renderBandPage(LabSettingsHubComponent);
    for (const t of lab.cmp.tiles as Array<{ href: string }>) {
      if (t.href === '/admin/partners') continue; // the one cross-LINK to the Referral & Vendors hub (its home: Branches & Organization)
      if (t.href === '/admin/communication') { expect(SETTINGS_PARENT[t.href]).toBe('/admin?section=communication'); continue; } // shared by every department: its home is Settings → All departments, Lab settings keeps a tile to it
      expect(SETTINGS_PARENT[t.href], t.href).toBe('/lab/settings');
    }
    TestBed.resetTestingModule();
    const partners = renderBandPage(PartnersComponent);
    for (const t of partners.cmp.tiles as Array<{ href: string }>) expect(SETTINGS_PARENT[t.href], t.href).toBe('/admin/partners');
    TestBed.resetTestingModule();
    for (const c of ADMIN_CATEGORIES) {
      for (const t of c.tiles) {
        if (t.href === '/expenses') continue; // a primary-nav root (no back)
        expect(SETTINGS_PARENT[t.href], t.href).toBe(`/admin?section=${c.id}`);
      }
    }
  });

  it('Overview: no separate Referral & Vendors section (it lives under Branches & Organization)', () => {
    const p = renderBandPage(AdminOverviewComponent);
    const cats = (p.cmp.groups as Array<{ cat: string }>).map((g) => g.cat);
    expect(cats).not.toContain('partners');
    expect(cats).toContain('org');
  });

  it('Referral & Vendors hub hides tiles the person cannot open (Lab Admin (Technical))', () => {
    const p = renderBandPage(PartnersComponent, { providers: [authAs(['manage_test_master', 'manage_lab_settings'])] });
    expect((p.cmp.visibleTiles() as Array<{ href: string }>).map((t) => t.href)).toEqual(['/admin/referral-labs', '/admin/partner-prices']);
  });
});

describe('Settings search on the hubs — precise, with where it lives, Enter opens the top hit', () => {
  it('/admin overview: "sample id" lists Sample ID format first with its section; no grid, one row per hit', () => {
    const p = renderBandPage(AdminOverviewComponent);
    p.type('sample id');
    const rows = Array.from(p.el.querySelectorAll<HTMLElement>('[data-testid="settings-hit"]'));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].textContent).toContain('Sample ID format');
    expect(rows[0].textContent).toContain('Organization & Identity · Sample ID');
    expect(p.el.querySelector('pf-settings-results ul.pf-sr')).not.toBeNull();
  });

  it('/admin overview: Enter opens the top hit (with its tab)', () => {
    const p = renderBandPage(AdminOverviewComponent);
    const nav = vi.spyOn(p.f.debugElement.injector.get(Router), 'navigate').mockResolvedValue(true);
    p.type('queue focus');
    p.bandInput()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    p.f.detectChanges();
    expect(nav).toHaveBeenCalledWith(['/admin/lab-settings'], { queryParams: { tab: 'queues' } });
  });

  it('/admin overview: nothing matches → "No settings match"', () => {
    const p = renderBandPage(AdminOverviewComponent);
    p.type('zzqx');
    expect(p.el.querySelector('[data-testid="settings-empty"]')?.textContent).toContain('No settings match');
  });

  it('/admin overview: a mid-word fragment finds nothing (no fuzzy noise)', () => {
    const p = renderBandPage(AdminOverviewComponent);
    p.type('ample');
    expect(p.el.querySelectorAll('[data-testid="settings-hit"]').length).toBe(0);
  });

  it('/admin overview: "printer" → printing settings only, each with its section', () => {
    const p = renderBandPage(AdminOverviewComponent);
    p.type('printer');
    const rows = Array.from(p.el.querySelectorAll<HTMLElement>('[data-testid="settings-hit"]'));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => (r.textContent ?? '').includes('Printing') || (r.textContent ?? '').includes('Your settings'))).toBe(true);
  });
});
