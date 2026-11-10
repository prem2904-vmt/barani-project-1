import { Route, Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { appRoutes } from '../../app.routes';
import { resolveAppMode } from '../../core/app-mode';
import { ROUTE_ACCESS } from '../../core/auth/route-access';
import { DOCTOR_NAV, MORE_NAV, PRIMARY_NAV } from '../../layout/nav-items';
import { environment } from '../../../environments/environment';
import { CASESHEET_PATHS, CASESHEET_SHELL_ROUTES, CASESHEETS_PUBLIC_GROUP, CASESHEETS_PUBLIC_ROUTES, casesheetLinks } from './casesheets.routes';

/**
 * Case sheets (part of IPD, WP0-ui) — every case-sheet route is defined once, gated, and invisible to the lab
 * while the gate is closed; the public case-sheet site matches ONLY in casesheets mode (plan §4.4).
 * The lab's own route + nav snapshot (features/opd/opd-dark.routes-nav.spec.ts) is unchanged.
 */
type Flat = { path: string; route: Route };
function flatten(routes: Route[], prefix = ''): Flat[] {
  const out: Flat[] = [];
  for (const r of routes) {
    const path = [prefix, r.path ?? ''].filter(Boolean).join('/');
    out.push({ path, route: r });
    if (r.children) out.push(...flatten(r.children, path));
  }
  return out;
}
const all = flatten(appRoutes);
const isCasesheetGuard = (g: unknown) => !!(g as { casesheetGate?: boolean })?.casesheetGate;
const modeOf = (r: Route) => (r.canMatch ?? []).map(g => (g as { appMode?: string }).appMode).filter(Boolean);
const shell = appRoutes.find(r => r.path === '' && (r.canActivate?.length ?? 0) > 0)!;

describe('case-sheet routes: defined once, all gated', () => {
  it('the gated in-shell set is exactly the plan\'s routes', () => {
    // Deliberate list: adding / removing a case-sheet route updates it here.
    expect(CASESHEET_SHELL_ROUTES.map(r => r.path)).toEqual([
      'admin/ipd/myprefrontal',
      'admin/ipd/myprefrontal/forms/:id',
      'admin/ipd/myprefrontal/forms/:id/history',
      'admin/ipd/myprefrontal/import',
      'casesheets/patient/:patientId',
      'casesheets/new',
      'casesheets/:id',
    ]);
  });

  it('every in-shell case-sheet route is mounted in the shell and has casesheetGuard FIRST, then its perms', () => {
    for (const r of CASESHEET_SHELL_ROUTES) {
      expect(shell.children!.includes(r)).toBe(true);
      const guards = r.canActivate ?? [];
      expect(isCasesheetGuard(guards[0])).toBe(true);
      const perms = guards.map(g => (g as { requiredPerms?: string[] }).requiredPerms).find(Boolean);
      expect([...(perms ?? [])].sort()).toEqual([...(ROUTE_ACCESS['/' + r.path!].perms ?? [])].sort());
    }
  });

  it('route access uses only the case-sheet permissions', () => {
    for (const r of CASESHEET_SHELL_ROUTES) {
      for (const p of ROUTE_ACCESS['/' + r.path!].perms ?? []) expect(p).toMatch(/^casesheet_(fill|view|forms_manage)$/);
    }
    expect(ROUTE_ACCESS['/admin/ipd/myprefrontal'].perms).toEqual(['casesheet_forms_manage']);
    expect(ROUTE_ACCESS['/casesheets/new'].perms).toEqual(['casesheet_fill']);
  });

  it('nothing case-sheet-looking anywhere else in the LMS table is ungated', () => {
    const csish = all.filter(f => /(^|\/)(casesheets|myprefrontal)(\/|$)/.test(f.path));
    expect(csish.map(f => f.route).every(r => CASESHEET_SHELL_ROUTES.includes(r))).toBe(true);
    expect(csish.length).toBe(CASESHEET_SHELL_ROUTES.length);
  });

  it('/admin/ipd itself is still the existing placeholder (adminGuard, no case-sheet gate)', () => {
    const ipd = shell.children!.find(r => r.path === 'admin/ipd')!;
    expect(ipd.data?.['moduleId']).toBe('ipd');
    expect((ipd.canActivate ?? []).some(isCasesheetGuard)).toBe(false);
  });

  it('links match the paths', () => {
    expect(casesheetLinks.adminForm('f 1')).toBe('/admin/ipd/myprefrontal/forms/f%201');
    expect(casesheetLinks.sheet('s1')).toBe('/casesheets/s1');
    expect(casesheetLinks.patientSheets('p1')).toBe('/casesheets/patient/p1');
    expect(casesheetLinks.adminHome()).toBe('/' + CASESHEET_PATHS.admin.home);
  });
});

describe('gate closed ⇒ no visible nav change for the lab', () => {
  it('no nav entry (primary, More, doctor) points at a case-sheet route', () => {
    const hrefs = [...PRIMARY_NAV, ...MORE_NAV, DOCTOR_NAV].map(i => i.href.split('?')[0]);
    expect(hrefs.some(h => /^\/(casesheets|admin\/ipd\/myprefrontal)(\/|$)/.test(h))).toBe(false);
  });
});

describe('app modes (plan §4.4)', () => {
  it('the public group is first and can match only in casesheets mode', () => {
    expect(appRoutes[0]).toBe(CASESHEETS_PUBLIC_GROUP);
    expect(modeOf(CASESHEETS_PUBLIC_GROUP)).toEqual(['casesheets']);
    expect(CASESHEETS_PUBLIC_ROUTES.map(r => r.path)).toEqual(['sign-in', 'auth/callback', '', 'cases', 'cases/:id', 'settings', '**']);
  });

  it('every LMS top-level route can match only in LMS mode', () => {
    for (const r of appRoutes.slice(1)) expect(modeOf(r)).toEqual(['lms']);
  });

  it('mode: /config.json mode wins, else the case-sheet hosts', () => {
    expect(resolveAppMode({ hostname: 'med-dev.prefrontal.health' })).toBe('lms');
    expect(resolveAppMode({ hostname: 'localhost' })).toBe('lms');
    for (const h of ['prepare.prefrontal.health', 'prepare-dev.prefrontal.health', 'casesheets-dev.prefrontal.health', 'PREPARE.prefrontal.health'])
      expect(resolveAppMode({ hostname: h })).toBe('casesheets');
    for (const h of ['prepare.prefrontal.health.evil.com', 'xprepare.prefrontal.health', 'prepare-stage.prefrontal.health'])
      expect(resolveAppMode({ hostname: h })).toBe('lms');
    expect(resolveAppMode({ configMode: 'casesheets', hostname: 'med-dev.prefrontal.health' })).toBe('casesheets');
    expect(resolveAppMode({ configMode: 'lms', hostname: 'prepare-dev.prefrontal.health' })).toBe('lms');
    expect(resolveAppMode({ configMode: 'other', hostname: 'localhost' })).toBe('lms');
  });

  describe('casesheets mode ⇒ only the public case-sheet routes match', () => {
    const env = environment as { mode?: string };
    let saved: string | undefined;
    beforeEach(() => {
      saved = env.mode;
      env.mode = 'casesheets';
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [provideRouter(appRoutes)] });
    });
    afterEach(() => { env.mode = saved; });

    it.each(['/cases', '/cases/abc', '/settings', '/sign-in', '/auth/callback'])('%s opens the case-sheet page', async (url) => {
      const router = TestBed.inject(Router);
      expect(await router.navigateByUrl(url)).toBe(true);
      expect(router.url).toBe(url);
    });

    it.each(['/login', '/admin', '/admin/tests', '/frontdesk', '/reports/public/t1', '/track/t1', '/casesheets/s1', '/opd', '/lab/my-work'])(
      'LMS URL %s is unmatchable → the case-sheet Departments page', async (url) => {
        const router = TestBed.inject(Router);
        await router.navigateByUrl(url);
        expect(router.url).toBe('/');
        const leaf = (() => { let s = router.routerState.snapshot.root; while (s.firstChild) s = s.firstChild; return s; })();
        expect(leaf.data['title']).toBe('Departments');
      });
  });
});
