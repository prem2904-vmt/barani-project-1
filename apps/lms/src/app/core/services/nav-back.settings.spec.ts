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
    // every setting climbs to the overview, on the section that holds it
    ['/admin/lab/collection', '/admin?section=lab'],
    ['/admin/lab/results', '/admin?section=lab'],
    ['/admin/instruments', '/admin?section=lab'],
    ['/admin/bridges', '/admin?section=lab'],
    ['/admin/lab/home-collection', '/admin?section=lab'],
    ['/admin/referral-labs', '/admin?section=lab'],
    ['/admin/partner-prices', '/admin?section=lab'],
    ['/admin/process', '/admin?section=lab'],
    ['/admin/workflows', '/admin?section=lab'],
    ['/admin/ai-connectors', '/admin?section=connected'],
    ['/admin/billing', '/admin?section=billing'],
    ['/admin/branches', '/admin?section=branches'],
    ['/admin/org/profile', '/admin?section=profile'],
    ['/admin/org/numbers', '/admin?section=numbers'],
    ['/admin/org/channels', '/admin?section=channels'],
    ['/admin/users', '/admin?section=people'],
    ['/admin/inventory', '/admin?section=inventory'],
    ['/admin/ipd/departments', '/admin?section=ipd'],
    ['/admin/pharmacy', '/admin?section=pharmacy'],
    // editors climb to their list
    ['/admin/instruments/abc', '/admin/instruments'],
    ['/admin/bridges/abc', '/admin/bridges'],
    ['/admin/opd/services/s1', '/admin/opd/departments'],
    ['/admin/opd/forms/f1', '/admin/opd/forms'],
  ];
  for (const [page, parent] of cases) {
    it(`${page} → ${parent}`, () => {
      const { svc } = setup();
      expect(svc.getParentRoute(page)).toBe(parent);
    });
  }

  it('query strings (a tab / category) do not change the parent', () => {
    const { svc } = setup();
    expect(svc.getParentRoute('/admin/lab/collection?tab=queues')).toBe('/admin?section=lab');
    expect(svc.getParentRoute('/admin/org/numbers?tab=order')).toBe('/admin?section=numbers');
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
  it('a page opened from the settings overview search pops back to the overview', () => {
    const { svc, go, location, router } = setup();
    go('/admin');
    go('/admin/lab/collection?tab=queues'); // search hit → Lab › Collection and queues
    svc.back();
    expect(location.back).toHaveBeenCalledTimes(1);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('a setting opened from a tile on the overview pops back to it', () => {
    const { svc, go, location } = setup();
    go('/admin?section=lab');
    go('/admin/instruments');
    svc.back();
    expect(location.back).toHaveBeenCalledTimes(1);
  });

  it('a deep link (nothing behind it) REPLACES with the canonical parent', () => {
    const { svc, go, router, location } = setup();
    go('/admin/referral-labs');
    svc.back();
    expect(location.back).not.toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/admin?section=lab', { replaceUrl: true });
  });

  it('a tab / category kept in the URL (replaceUrl) does not erase "came from"', () => {
    const { svc, go, location } = setup();
    go('/admin');
    go('/admin/lab/results');
    go('/admin/lab/results?tab=rules', 'replace');
    expect(svc.cameFrom()).toBe('/admin');
    svc.back();
    expect(location.back).toHaveBeenCalledTimes(1);
  });

  it('hub → list → editor → list → back goes to the hub entry already in history (no duplicate)', () => {
    const { svc, go, location, historyGo, router } = setup();
    go('/admin');
    go('/admin/instruments');
    go('/admin/instruments/abc');
    // editor back: its list is right behind → pop
    svc.backTo('/admin/instruments');
    expect(location.back).toHaveBeenCalledTimes(1);
    go('/admin/instruments', 'pop');
    // list back: came from the editor, but the overview is 1 entry behind → pop
    svc.back();
    expect(location.back).toHaveBeenCalledTimes(2);
    expect(historyGo).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('a parent further behind is reached with history.go(-n), not a pushed copy', () => {
    const { svc, go, historyGo, router } = setup();
    go('/admin');
    go('/admin/referral-labs');
    go('/admin/partner-prices');
    go('/admin/partner-prices/x'); // a deeper screen; then jump straight up to the overview
    svc.backTo('/admin');
    expect(historyGo).toHaveBeenCalledWith(-3);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });
});
