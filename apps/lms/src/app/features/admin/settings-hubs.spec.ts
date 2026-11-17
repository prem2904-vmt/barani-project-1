import { Router } from '@angular/router';
import { vi } from 'vitest';
import { renderBandPage } from './admin-band.spec-helpers';
import { AdminOverviewComponent } from './admin-overview.component';
import { SETTINGS_PARENT } from '../../shared/utils/settings-catalog';
import { SETTINGS_SECTIONS, categoryPath } from './settings/settings-map';

/**
 * Settings — one home per screen (owner 2026-11-01: "overall lot of duplicate"; re-homed 2026-11-17), and the
 * precise search with Enter → top hit.
 */
describe('Settings — each screen has ONE home', () => {
  it('no setting or category path is claimed by two settings, and no screen is listed twice in a section', () => {
    const seen = new Map<string, string>();
    for (const sec of SETTINGS_SECTIONS) for (const item of sec.items) {
      for (const c of item.categories) {
        const key = categoryPath(item, c) + '?' + JSON.stringify(c.query ?? {});
        expect(seen.get(key), key).toBeUndefined();
        seen.set(key, item.id);
      }
    }
  });

  it('every page a tile opens climbs back to the overview on THAT section (tile list and back map agree)', () => {
    for (const sec of SETTINGS_SECTIONS) for (const item of sec.items) {
      expect(SETTINGS_PARENT[item.path], item.path).toBe(`/admin?section=${sec.id}`);
      for (const c of item.categories) expect(SETTINGS_PARENT[categoryPath(item, c)], categoryPath(item, c)).toBe(`/admin?section=${sec.id}`);
    }
  });

  it('Referral labs and Partner prices live once, under Lab › Outsourcing (no Referral & Vendors hub, no copy in Organization)', () => {
    const outs = SETTINGS_SECTIONS.flatMap((s) => s.items).filter((i) => i.categories.some((c) => c.path === '/admin/referral-labs'));
    expect(outs.map((i) => i.id)).toEqual(['lab-outsourcing']);
  });
});

describe('Settings search on the hubs — precise, with where it lives, Enter opens the top hit', () => {
  it('/admin overview: "sample id" lists Sample ID format first with its section; no grid, one row per hit', () => {
    const p = renderBandPage(AdminOverviewComponent);
    p.type('sample id');
    const rows = Array.from(p.el.querySelectorAll<HTMLElement>('[data-testid="settings-hit"]'));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].textContent).toContain('Sample ID format');
    expect(rows[0].textContent).toContain('Lab · Sample numbers');
    expect(p.el.querySelector('pf-settings-results ul.pf-sr')).not.toBeNull();
  });

  it('/admin overview: Enter opens the top hit (with its tab)', () => {
    const p = renderBandPage(AdminOverviewComponent);
    const nav = vi.spyOn(p.f.debugElement.injector.get(Router), 'navigate').mockResolvedValue(true);
    p.type('queue focus');
    p.bandInput()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    p.f.detectChanges();
    expect(nav).toHaveBeenCalledWith(['/admin/lab/collection'], { queryParams: { tab: 'queue' } });
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
