import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { NavBackService } from './nav-back.service';
import { SETTINGS_PARENT } from '../../shared/utils/settings-catalog';

/**
 * Settings back navigation (owner 2026-11-01: "this settings page back
 * navigation is not proper"). The chevron, edge-swipe and Android back all call
 * NavBackService.back(); for a settings page it climbs to the ONE hub that
 * lists it (SETTINGS_PARENT), or POPS history to the hub the person came from,
 * never to the app home or a wrong category, and never piles up duplicates.
 */
function setup(startUrl = '/') {
  const events = new Subject<unknown>();
  let nav: { trigger: string; extras: { replaceUrl?: boolean } } | null = null;
  const router = {
    url: startUrl,
    events,
    getCurrentNavigation: () => nav,
    navigateByUrl: vi.fn((u: string, extras?: { replaceUrl?: boolean }) => { go(u, extras?.replaceUrl ? 'replace' : 'push'); return Promise.resolve(true); }),
  };
  const location = { back: vi.fn() };
  const historyGo = vi.spyOn(window.history, 'go').mockImplementation(() => undefined);
  let id = 0;
  function go(url: string, how: 'push' | 'replace' | 'pop' = 'push') {
    nav = { trigger: how === 'pop' ? 'popstate' : 'imperative', extras: { replaceUrl: how === 'replace' } };
    router.url = url;
    events.next(new NavigationEnd(++id, url, url));
    nav = null;
  }
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: Router, useValue: router },
      { provide: Location, useValue: location },
    ],
  });
  const svc = TestBed.inject(NavBackService);
  return { svc, router, location, historyGo, go };
}

afterEach(() => vi.restoreAllMocks());

describe('Settings back — the one parent map', () => {
  const cases: Array<[string, string]> = [
    ['/admin/manage', '/admin'],
    ['/lab/settings', '/admin'],
    ['/admin/lab-settings', '/lab/settings'],
    ['/admin/instruments', '/lab/settings'],
    ['/admin/bridges', '/lab/settings'],
    ['/admin/ai-connectors', '/lab/settings'],
    ['/admin/home-collection', '/lab/settings'],
    ['/admin/microbiology', '/lab/settings'],
    ['/admin/instruments/abc', '/admin/instruments'],
    ['/admin/bridges/abc', '/admin/bridges'],
    ['/admin/referral-labs', '/admin/partners'],
    ['/admin/partner-prices', '/admin/partners'],
    ['/admin/vendors', '/admin/partners'],
    ['/admin/referring-network', '/admin/partners'],
    ['/admin/partners', '/admin/manage?cat=org'],
    ['/admin/branches', '/admin/manage?cat=org'],
    ['/admin/organization', '/admin/manage?cat=org'],
    ['/admin/billing', '/admin/manage?cat=finance'],
    ['/admin/process', '/admin/manage?cat=automation'],
    ['/admin/inventory', '/admin'],
    ['/admin/modules', '/admin'],
    ['/admin/radiology', '/admin'],
  ];
  for (const [page, parent] of cases) {
    it(`${page} → ${parent}`, () => {
      const { svc } = setup();
      expect(svc.getParentRoute(page)).toBe(parent);
    });
  }

  it('query strings (a tab / category) do not change the parent', () => {
    const { svc } = setup();
    expect(svc.getParentRoute('/admin/lab-settings?tab=queues')).toBe('/lab/settings');
    expect(svc.getParentRoute('/admin/organization?tab=sample')).toBe('/admin/manage?cat=org');
  });

  it('every mapped page parents to a hub that is itself mapped or the /admin root (no loops)', () => {
    for (const [page, parent] of Object.entries(SETTINGS_PARENT)) {
      const p = parent.split('?')[0];
      expect(p, page).not.toBe(page);
      expect(p === '/admin' || !!SETTINGS_PARENT[p], `${page} → ${parent}`).toBe(true);
    }
  });

  it('a personal page (Printing) goes back to where you came from — never /admin', () => {
    const { svc, go } = setup('/lab/my-work');
    go('/lab/my-work');
    go('/printing');
    expect(svc.getParentRoute('/printing')).toBe('/lab/my-work');
    const fresh = setup('/printing');
    expect(fresh.svc.getParentRoute('/printing')).toBe('/');
  });
});

describe('Settings back — honours where you came from', () => {
  it('a page opened from the settings hub search pops back to that hub', () => {
    const { svc, go, location, router } = setup();
    go('/admin');
    go('/admin/manage');
    go('/admin/lab-settings?tab=queues'); // search hit → Lab settings › Queues
    svc.back();
    expect(location.back).toHaveBeenCalledTimes(1);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('a page opened from the Lab hub pops back to it', () => {
    const { svc, go, location } = setup();
    go('/admin');
    go('/lab/settings');
    go('/admin/instruments');
    svc.back();
    expect(location.back).toHaveBeenCalledTimes(1);
  });

  it('a deep link (nothing behind it) REPLACES with the canonical parent', () => {
    const { svc, go, router, location } = setup();
    go('/admin/referral-labs');
    svc.back();
    expect(location.back).not.toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/partners', { replaceUrl: true });
  });

  it('a tab / category kept in the URL (replaceUrl) does not erase "came from"', () => {
    const { svc, go, location } = setup();
    go('/lab/settings');
    go('/admin/lab-settings');
    go('/admin/lab-settings?tab=rules', 'replace');
    expect(svc.cameFrom()).toBe('/lab/settings');
    svc.back();
    expect(location.back).toHaveBeenCalledTimes(1);
  });

  it('hub → list → editor → list → back goes to the hub entry already in history (no duplicate)', () => {
    const { svc, go, location, historyGo, router } = setup();
    go('/admin');
    go('/lab/settings');
    go('/admin/instruments');
    go('/admin/instruments/abc');
    // editor back: its list is right behind → pop
    svc.backTo('/admin/instruments');
    expect(location.back).toHaveBeenCalledTimes(1);
    go('/admin/instruments', 'pop');
    // list back: came from the editor, but the Lab hub is 1 entry behind → pop
    svc.back();
    expect(location.back).toHaveBeenCalledTimes(2);
    expect(historyGo).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('a parent further behind is reached with history.go(-n), not a pushed copy', () => {
    const { svc, go, historyGo, router } = setup();
    go('/admin/manage');
    go('/admin/partners');
    go('/admin/vendors');
    go('/admin/vendors/x'); // a deeper screen; then jump straight up to the hub
    svc.backTo('/admin/manage?cat=org');
    expect(historyGo).toHaveBeenCalledWith(-3);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });
});
