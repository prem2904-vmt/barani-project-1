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
import { OpdGateService } from '../opd/shared/opd-gate.service';
import { CasesheetGateService } from '../casesheets/shared/casesheet-gate.service';
import { TenantEntitlementsService } from '../../core/services/tenant-entitlements.service';

/**
 * Settings overview = the two-panel hub: grouped section list on the left, the
 * selected section's existing tiles on the right, section in the URL, search
 * across every tile, phone list → detail drill-in. No KPI / counter cards.
 */
function setup(opts: { perms?: string[]; compact?: boolean; opd?: boolean; pharmacy?: boolean; ipd?: boolean } = {}) {
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
      { provide: OpdGateService, useValue: { visible: () => !!opts.opd } },
      { provide: CasesheetGateService, useValue: { visible: () => !!opts.ipd } },
      ...(opts.pharmacy ? [{ provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true, moduleOn: () => true, ensureLoaded: async () => undefined, loaded: () => true } }] : []),
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
  it('left list: Departments (Lab first) then Organization; no "All departments", no shared Front desk', async () => {
    setup();
    const h = await open('/admin');
    expect(groupsShown(el(h))).toEqual(['Departments', 'Organization']);
    const ids = itemIds(el(h));
    expect(ids.slice(0, 2)).toEqual(['lab', 'inventory']); // OPD / Pharmacy / IPD hidden: this lab does not have them
    expect(ids).toEqual(expect.arrayContaining(['profile', 'branches', 'numbers', 'people', 'billing', 'channels']));
    expect(ids.indexOf('lab')).toBeLessThan(ids.indexOf('people'));
    expect(el(h).textContent).not.toContain('All departments');
    expect(el(h).textContent).not.toContain('Shared front desk');
  });

  it('OPD, Pharmacy and IPD only appear when the lab has them; coming-soon departments never do', async () => {
    setup({ opd: true, pharmacy: true, ipd: true });
    const h = await open('/admin');
    const ids = itemIds(el(h));
    expect(ids.slice(0, 5)).toEqual(['lab', 'opd', 'pharmacy', 'ipd', 'inventory']);
    for (const soon of ['radiology', 'payroll', 'emergency', 'bloodbank', 'insurance']) expect(ids).not.toContain(soon);
  });

  it('desktop: the first section is selected when the URL names none, and its settings show as tiles into the shell', async () => {
    setup();
    const h = await open('/admin');
    expect(el(h).querySelector('[data-testid="tp-item-lab"]')?.getAttribute('aria-current')).toBe('true');
    expect(tileHrefs(el(h))).toEqual(expect.arrayContaining([
      '/admin/lab/departments', '/admin/lab/sample-numbers', '/admin/tests', '/admin/reports', '/admin/lab/collection', '/admin/lab/results',
      '/admin/lab/outsourcing', '/admin/lab/analyzers', '/admin/lab/front-desk', '/admin/lab/alerts', '/admin/lab/numbers', '/admin/lab/work-steps',
    ]));
    expect(el(h).textContent).toContain('Numbers on lab screens');
  });

  it('Finance, Daily statement, Expenses, Audit trail and Modules are not in Settings; no number cards', async () => {
    setup();
    for (const section of ['lab', 'profile', 'billing', 'people', 'channels']) {
      TestBed.resetTestingModule(); setup();
      const h = await open(`/admin?section=${section}`);
      const t = el(h).textContent ?? '';
      for (const gone of ['Daily Statement', 'Daily statement', 'Audit trail', 'Expenses', 'Modules']) expect(t, `${section}: ${gone}`).not.toContain(gone);
      expect(tileHrefs(el(h))).not.toContain('/finance');
      expect(tileHrefs(el(h))).not.toContain('/expenses');
      expect(tileHrefs(el(h))).not.toContain('/admin/audit');
      expect(tileHrefs(el(h))).not.toContain('/admin/modules');
    }
    TestBed.resetTestingModule(); setup();
    const h = await open('/admin');
    expect(el(h).querySelector('.pf-ov__kpi, .pf-ov__stat, .pf-ov__range, [aria-label="Date range"]')).toBeNull();
    expect(el(h).textContent).not.toContain('Cash in');
  });

  it('?section= selects that section', async () => {
    setup();
    const h = await open('/admin?section=billing');
    expect(el(h).querySelector('[data-testid="tp-item-billing"]')?.getAttribute('aria-current')).toBe('true');
    expect(tileHrefs(el(h))).toEqual(['/admin/billing']);
  });

  it('old section ids from old links (?section=finance, ?section=org, ?section=communication) open the section that holds them now', async () => {
    setup();
    for (const [old, now] of [['finance', 'billing'], ['org', 'profile'], ['communication', 'channels'], ['automation', 'lab']] as const) {
      TestBed.resetTestingModule(); setup();
      const h = await open(`/admin?section=${old}`);
      expect(el(h).querySelector(`[data-testid="tp-item-${now}"]`)?.getAttribute('aria-current'), `${old} → ${now}`).toBe('true');
    }
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
    expect(tileHrefs(el(h))).toEqual(['/admin/users']);
  });

  it('role gating: a section / tile the person cannot open stays hidden (same rule as the old cards)', async () => {
    setup({ perms: ['manage_users'] });
    const h = await open('/admin?section=people');
    const ids = itemIds(el(h));
    expect(ids).toContain('people');
    expect(ids).not.toContain('lab');
    expect(ids).not.toContain('billing');
    expect(tileHrefs(el(h))).toContain('/admin/users');
  });

  it('role gating inside a section: Lab shows only the settings its perms open', async () => {
    setup({ perms: ['manage_tests', 'manage_lab_settings'] });
    const h = await open('/admin?section=lab');
    const hrefs = tileHrefs(el(h));
    expect(hrefs).toContain('/admin/tests');
    expect(hrefs).toContain('/admin/lab/collection');
    expect(hrefs).not.toContain('/admin/lab/alerts'); // needs manage_tenant / manage_notifications
  });

  it('search across every setting replaces the panels with ranked hits; Enter opens the top hit at its NEW home; clearing restores', async () => {
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
    expect(nav).toHaveBeenCalledWith(['/admin/lab/collection'], { queryParams: { tab: 'queue' } });
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
    el(h).querySelector<HTMLButtonElement>('[data-testid="tp-item-branches"]')!.click();
    await h.fixture.whenStable();
    h.detectChanges();
    expect(nav).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { section: 'branches' }, replaceUrl: false }));
    expect(el(h).querySelector('.pf-tp--detail')).not.toBeNull();
    expect(el(h).querySelector('[data-testid="tp-back"]')).toBeNull();   // ONE back: the band's
    expect(el(h).querySelector('.pf-hb__back')).not.toBeNull();
    expect(tileHrefs(el(h))).toEqual(['/admin/branches']);
  });

  it('back chevron pops history when the detail was opened by a tap', async () => {
    setup({ compact: true });
    const h = await open('/admin');
    const loc = TestBed.inject(Location);
    const back = vi.spyOn(loc, 'back').mockImplementation(() => undefined);
    el(h).querySelector<HTMLButtonElement>('[data-testid="tp-item-branches"]')!.click();
    await h.fixture.whenStable();
    h.detectChanges();
    el(h).querySelector<HTMLButtonElement>('.pf-hb__back')!.click();
    expect(back).toHaveBeenCalled();
  });

  it('opened straight on ?section= (deep link): detail shows, and chevron clears the section from the URL', async () => {
    setup({ compact: true });
    const h = await open('/admin?section=lab');
    expect(el(h).querySelector('.pf-tp--detail')).not.toBeNull();
    const router = TestBed.inject(Router);
    el(h).querySelector<HTMLButtonElement>('.pf-hb__back')!.click();
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
