import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Location } from '@angular/common';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AdminOverviewComponent } from './admin-overview.component';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { TenantStateService } from '../../core/services/tenant-state.service';
import { NavBackService } from '../../core/services/nav-back.service';

/**
 * Settings overview = the two-panel hub: grouped section list on the left, the
 * selected section's existing tiles on the right, section in the URL, search
 * across every tile, phone list → detail drill-in. No KPI / counter cards.
 */
function setup(opts: { perms?: string[]; compact?: boolean } = {}) {
  const perms = opts.perms ?? ['*'];
  (window as any).matchMedia = (q: string) => ({
    matches: !!opts.compact && q.includes('max-width: 767px'),
    addEventListener() {}, removeEventListener() {},
  });
  document.documentElement.classList.add('design-new');
  const api = { get: vi.fn(() => of([])), post: vi.fn(() => of({})), put: vi.fn(() => of({})), patch: vi.fn(() => of({})), delete: vi.fn(() => of({})) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'admin', component: AdminOverviewComponent }, { path: '**', children: [] }]),
      { provide: ApiService, useValue: api },
      {
        provide: AuthService,
        useValue: {
          user: () => ({ tenantName: 'Micro World', firstName: 'Admin', permissions: perms }),
          hasPermission: (c: string) => perms.includes('*') || perms.includes(c),
          hasAnyPermission: (c: string[]) => perms.includes('*') || c.some((x) => perms.includes(x)),
          isAuthenticated: () => true,
          waitForAuth: async () => undefined,
        },
      },
      { provide: TenantStateService, useValue: { tenant: () => null } },
    ],
  });
  return { api };
}

async function open(url: string) {
  const h = await RouterTestingHarness.create();
  await h.navigateByUrl(url, AdminOverviewComponent);
  h.detectChanges();
  return h;
}
const el = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
const itemIds = (e: HTMLElement) => Array.from(e.querySelectorAll('[data-testid^="tp-item-"]')).map((b) => b.getAttribute('data-testid')!.slice(8));
const tileHrefs = (e: HTMLElement) => Array.from(e.querySelectorAll<HTMLAnchorElement>('[data-testid="ov-tiles"] a')).map((a) => (a.getAttribute('href') ?? '').split('?')[0]);
const groupsShown = (e: HTMLElement) => Array.from(e.querySelectorAll('.pf-tp__heading')).map((h) => h.textContent!.trim());

describe('Settings overview — two panels', () => {
  it('left list is grouped Departments → Organization → All departments last', async () => {
    setup();
    const h = await open('/admin');
    expect(groupsShown(el(h))).toEqual(['Departments', 'Organization', 'All departments']);
    const ids = itemIds(el(h));
    expect(ids.indexOf('lab')).toBeLessThan(ids.indexOf('people'));
    expect(ids.indexOf('people')).toBeLessThan(ids.indexOf('communication'));
    expect(ids[ids.length - 1]).not.toBe('lab');
  });

  it('desktop: the first section is selected when the URL names none, and its existing tiles show', async () => {
    setup();
    const h = await open('/admin');
    expect(el(h).querySelector('[data-testid="tp-item-lab"]')?.getAttribute('aria-current')).toBe('true');
    expect(tileHrefs(el(h))).toEqual(expect.arrayContaining(['/admin/tests', '/admin/reports', '/admin/lab-settings', '/admin/kpis']));
  });

  it('the Lab "KPI cards" settings tile stays; the KPI / number cards are gone', async () => {
    setup();
    const h = await open('/admin');
    expect(el(h).textContent).toContain('KPI cards');
    expect(el(h).querySelector('.pf-ov__kpi, .pf-ov__stat, .pf-ov__range, [aria-label="Date range"]')).toBeNull();
    expect(el(h).textContent).not.toContain('Cash in');
    expect(el(h).textContent).not.toContain('Balance due');
  });

  it('?section= selects that section (old /admin/manage?cat= deep links land here)', async () => {
    setup();
    const h = await open('/admin?section=finance');
    expect(el(h).querySelector('[data-testid="tp-item-finance"]')?.getAttribute('aria-current')).toBe('true');
    expect(tileHrefs(el(h))).toEqual(expect.arrayContaining(['/admin/billing', '/finance/daily']));
    expect(tileHrefs(el(h))).not.toContain('/admin/tests');
  });

  it('an unknown section falls back to the first one', async () => {
    setup();
    const h = await open('/admin?section=nope');
    expect(el(h).querySelector('[data-testid="tp-item-lab"]')?.getAttribute('aria-current')).toBe('true');
  });

  it('picking a section writes it to the URL (replace on desktop) and swaps the tiles', async () => {
    setup();
    const h = await open('/admin');
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigate');
    el(h).querySelector<HTMLButtonElement>('[data-testid="tp-item-people"]')!.click();
    await h.fixture.whenStable();
    h.detectChanges();
    expect(nav).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { section: 'people' }, replaceUrl: true }));
    expect(router.url).toContain('section=people');
    expect(tileHrefs(el(h))).toEqual(expect.arrayContaining(['/admin/users', '/admin/audit']));
    expect(tileHrefs(el(h))).not.toContain('/admin/tests');
  });

  it('role gating: a tile the person cannot open stays hidden, and an empty section disappears', async () => {
    setup({ perms: ['manage_tests'] });
    const h = await open('/admin?section=lab');
    const hrefs = tileHrefs(el(h));
    expect(hrefs).toContain('/admin/tests');
    expect(hrefs).not.toContain('/admin/kpis');
    expect(hrefs).not.toContain('/admin/notifications');
    expect(itemIds(el(h))).not.toContain('people');
  });

  it('search across every setting replaces the panels with ranked hits; Enter opens the top hit; clearing restores', async () => {
    setup();
    const h = await open('/admin');
    const cmp = h.routeDebugElement!.componentInstance as AdminOverviewComponent;
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    cmp.setQ('sample id');
    h.detectChanges();
    const rows = Array.from(el(h).querySelectorAll<HTMLElement>('[data-testid="settings-hit"]'));
    expect(rows[0].textContent).toContain('Sample ID format');
    expect(el(h).querySelector('pf-two-panel')).toBeNull();
    cmp.setQ('queue focus');
    cmp.openTopHit();
    expect(nav).toHaveBeenCalledWith(['/admin/lab-settings'], { queryParams: { tab: 'queues' } });
    cmp.setQ('');
    h.detectChanges();
    expect(el(h).querySelector('pf-two-panel')).not.toBeNull();
  });

  it('band search box says "Search all settings"', async () => {
    setup();
    const h = await open('/admin');
    expect(el(h).querySelector<HTMLInputElement>('pf-hero-band .pf-hb__input')?.placeholder).toBe('Search all settings');
  });
});

describe('Settings overview — phone drill-in', () => {
  it('phone: the section list first, no tiles, no back chevron', async () => {
    setup({ compact: true });
    const h = await open('/admin');
    expect(el(h).querySelector('.pf-tp--compact')).not.toBeNull();
    expect(el(h).querySelector('.pf-tp--detail')).toBeNull();
    expect(el(h).querySelector('[data-testid="ov-tiles"]')).toBeNull();
    expect(itemIds(el(h)).length).toBeGreaterThan(3);
  });

  it('tapping a section pushes it into the URL and shows only its tiles with a back chevron', async () => {
    setup({ compact: true });
    const h = await open('/admin');
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigate');
    el(h).querySelector<HTMLButtonElement>('[data-testid="tp-item-org"]')!.click();
    await h.fixture.whenStable();
    h.detectChanges();
    expect(nav).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { section: 'org' }, replaceUrl: false }));
    expect(el(h).querySelector('.pf-tp--detail')).not.toBeNull();
    expect(el(h).querySelector('[data-testid="tp-back"]')).not.toBeNull();
    expect(tileHrefs(el(h))).toContain('/admin/branches');
  });

  it('back chevron pops history when the detail was opened by a tap', async () => {
    setup({ compact: true });
    const h = await open('/admin');
    const loc = TestBed.inject(Location);
    const back = vi.spyOn(loc, 'back').mockImplementation(() => undefined);
    el(h).querySelector<HTMLButtonElement>('[data-testid="tp-item-org"]')!.click();
    await h.fixture.whenStable();
    h.detectChanges();
    el(h).querySelector<HTMLButtonElement>('[data-testid="tp-back"]')!.click();
    expect(back).toHaveBeenCalled();
  });

  it('opened straight on ?section= (deep link): detail shows, and chevron clears the section from the URL', async () => {
    setup({ compact: true });
    const h = await open('/admin?section=lab');
    expect(el(h).querySelector('.pf-tp--detail')).not.toBeNull();
    const router = TestBed.inject(Router);
    el(h).querySelector<HTMLButtonElement>('[data-testid="tp-back"]')!.click();
    await h.fixture.whenStable();
    h.detectChanges();
    expect(router.url).not.toContain('section=');
    expect(el(h).querySelector('.pf-tp--detail')).toBeNull();
  });

  it('swipe / hardware back goes through NavBackService and closes the detail first', async () => {
    setup({ compact: true });
    const h = await open('/admin?section=lab');
    h.detectChanges();
    TestBed.flushEffects?.();
    const nb = TestBed.inject(NavBackService);
    expect(nb.showBack()).toBe(true);
    nb.back();
    await h.fixture.whenStable();
    h.detectChanges();
    expect(el(h).querySelector('.pf-tp--detail')).toBeNull();
  });
});
