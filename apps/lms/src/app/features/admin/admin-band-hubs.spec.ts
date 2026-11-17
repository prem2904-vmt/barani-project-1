import { renderBandPage } from './admin-band.spec-helpers';
import { OpdAdminComponent } from '../opd/admin/opd-admin.component';

/**
 * Tile hubs (OPD; the Lab and Referral & Vendors hubs are now sections of the Settings overview): no search before, so
 * the band pill gains one that filters the tiles; the page header is
 * classic-only and the tiles sit in the scrolling band body.
 */
describe('Admin band — tile hubs', () => {
  const hubs = [
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
      // Precise search (settings-search.ts): ranked by title first, so the
      // tile whose TITLE matches leads; other tiles match by the settings on
      // their page (keywords), never by a word inside the subtitle.
      if (h.cmp === OpdAdminComponent) {
        // OPD hub keeps the plain band filter (not a settings-catalog hub).
        expect(tiles().every((t) => t.toLowerCase().includes(h.hit))).toBe(true);
        expect(tiles().some((t) => t.includes(h.expect))).toBe(true);
      } else {
        expect(tiles()[0]).toContain(h.expect);
      }
      p.type('zzzz-nothing');
      expect(tiles().length).toBe(0);
      expect(p.body()!.querySelector('.pf-band-empty')).not.toBeNull();
    });
  }
});
