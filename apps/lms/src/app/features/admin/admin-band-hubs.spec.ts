import { renderBandPage } from './admin-band.spec-helpers';
import { LabSettingsHubComponent } from '../lab/lab-settings-hub/lab-settings-hub.component';
import { PartnersComponent } from './partners/partners.component';
import { OpdAdminComponent } from '../opd/admin/opd-admin.component';
import { TenantEntitlementsService } from '../../core/services/tenant-entitlements.service';

/**
 * Tile hubs (Lab settings, Referral & Vendors, OPD): no search before, so
 * the band pill gains one that filters the tiles; the page header is
 * classic-only and the tiles sit in the scrolling band body.
 */
describe('Admin band — tile hubs', () => {
  const hubs = [
    { name: 'Referral & Vendors hub', cmp: PartnersComponent, hit: 'vendor', expect: 'Vendor' },
    { name: 'OPD hub', cmp: OpdAdminComponent, hit: 'doctor', expect: 'Doctor' },
  ];

  for (const h of hubs) {
    it(`${h.name}: band + body wiring, header classic-only`, () => {
      const p = renderBandPage(h.cmp);
      expect(p.band()).not.toBeNull();
      expect(p.bandInput()).not.toBeNull();
      expect(p.body()).not.toBeNull();
      expect(p.headerIsClassicOnly()).toBe(true);
    });

    it(`${h.name}: the pill search filters the tiles, with an empty state`, () => {
      const p = renderBandPage(h.cmp);
      const tiles = () => Array.from(p.body()!.querySelectorAll('a')).map((a) => a.textContent ?? '');
      const all = tiles().length;
      expect(all).toBeGreaterThan(1);
      p.type(h.hit);
      expect(tiles().length).toBeGreaterThan(0);
      expect(tiles().length).toBeLessThanOrEqual(all);
      expect(tiles().every((t) => t.toLowerCase().includes(h.hit))).toBe(true);
      expect(tiles().some((t) => t.includes(h.expect))).toBe(true);
      p.type('zzzz-nothing');
      expect(tiles().length).toBe(0);
      expect(p.body()!.querySelector('.pf-band-empty')).not.toBeNull();
    });
  }
});

/** The Lab hub is the admin directory (ND-PATTERN "Admin pages"): its pill
 *  searches the lab pages AND their single settings, one result per row. */
describe('Admin band — Lab settings hub (directory)', () => {
  const make = () => renderBandPage(LabSettingsHubComponent, {
    providers: [{ provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true, ensureLoaded: () => undefined } }],
  });

  it('band + body wiring, header classic-only, every lab page one tap away', () => {
    const p = make();
    expect(p.bandInput()).not.toBeNull();
    expect(p.headerIsClassicOnly()).toBe(true);
    const hrefs = Array.from(p.body()!.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['/admin/lab-settings', '/admin/tests', '/admin/reports', '/admin/microbiology',
      '/admin/notifications', '/admin/kpis', '/admin/referral-labs', '/admin/referring-network']));
  });

  it('the pill search finds pages and single settings; empty state', () => {
    const p = make();
    p.type('report');
    const rows = () => Array.from(p.body()!.querySelectorAll('a')).map((a) => a.textContent ?? '');
    expect(rows().some((t) => t.includes('Report design'))).toBe(true);
    p.type('scan');
    const first = p.body()!.querySelector('a')!;
    expect(first.getAttribute('href')).toBe('/admin/lab-settings#scan-mode');
    p.type('zzzz-nothing');
    expect(rows().length).toBe(0);
    expect(p.body()!.querySelector('.pf-band-empty')).not.toBeNull();
  });
});
