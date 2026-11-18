import { Route, Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { appRoutes } from '../../app.routes';
import { SETTINGS_SHELL_CHILDREN } from '../admin/settings/settings.routes';
import { resolveAppMode } from '../../core/app-mode';
import { ROUTE_ACCESS } from '../../core/auth/route-access';
import { DOCTOR_NAV, MORE_NAV, PRIMARY_NAV } from '../../layout/nav-items';
import { environment } from '../../../environments/environment';
import { CASESHEET_PATHS, CASESHEET_SHELL_ROUTES, CASESHEETS_PUBLIC_GROUP, CASESHEETS_PUBLIC_ROUTES, CASESHEETS_PUBLIC_SHELL_ROUTES, casesheetLinks } from './casesheets.routes';
import { signal } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { CasesheetGateService } from './shared/casesheet-gate.service';
import { CS_NAV } from './public/cs-bottom-nav.component';

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
      'admin/ipd/myprefrontal/pending',
      'admin/ipd/myprefrontal/forms/:id',
      'admin/ipd/myprefrontal/forms/:id/history',
      'admin/ipd/departments',
      'prepare',
      'prepare/cases',
      'casesheets/patient/:patientId',
      'casesheets/new',
      'casesheets/:id',
    ]);
  });

  it('every in-shell case-sheet route is mounted in the shell and has casesheetGuard FIRST, then its perms', () => {
    for (const r of CASESHEET_SHELL_ROUTES) {
      // Mounted in the signed-in shell, or — the Settings pages (case sheets, pending, IPD departments) — inside the Settings shell.
      expect(shell.children!.includes(r) || SETTINGS_SHELL_CHILDREN.includes(r)).toBe(true);
      const guards = r.canActivate ?? [];
      expect(isCasesheetGuard(guards[0])).toBe(true);
      const perms = guards.map(g => (g as { requiredPerms?: string[] }).requiredPerms).find(Boolean);
      expect([...(perms ?? [])].sort()).toEqual([...(ROUTE_ACCESS['/' + r.path!].perms ?? [])].sort());
    }
  });

  it('route access uses only the case-sheet permissions', () => {
    for (const r of CASESHEET_SHELL_ROUTES) {
      // + the IPD contributor code (Settings access, owner 2026-11-18: opens the form admin and edits drafts; an admin publishes).
      for (const p of ROUTE_ACCESS['/' + r.path!].perms ?? []) expect(p).toMatch(/^(casesheet_(fill|view|forms_manage)|contribute_ipd_settings)$/);
    }
    expect(ROUTE_ACCESS['/admin/ipd/myprefrontal'].perms).toEqual(['casesheet_forms_manage', 'contribute_ipd_settings']);
    expect(ROUTE_ACCESS['/casesheets/new'].perms).toEqual(['casesheet_fill']);
  });

  it('nothing case-sheet-looking anywhere else in the LMS table is ungated', () => {
    const csish = all.filter(f => /(^|\/)(casesheets|myprefrontal|ipd\/departments|prepare)(\/|$)/.test(f.path));
    expect(csish.map(f => f.route).every(r => CASESHEET_SHELL_ROUTES.includes(r))).toBe(true);
    expect(csish.length).toBe(CASESHEET_SHELL_ROUTES.length);
  });

  it('/admin/ipd itself redirects to the overview\'s IPD section (the placeholder hub is gone)', () => {
    const ipd = shell.children!.find(r => r.path === 'admin/ipd')!;
    expect(ipd.redirectTo).toBeTruthy();
    expect(ipd.canActivate ?? []).toEqual([]);
  });


  it('links match the paths', () => {
    expect(casesheetLinks.adminForm('f 1')).toBe('/admin/ipd/myprefrontal/forms/f%201');
    expect(casesheetLinks.sheet('s1')).toBe('/casesheets/s1');
    expect(casesheetLinks.patientSheets('p1')).toBe('/casesheets/patient/p1');
    expect(casesheetLinks.adminHome()).toBe('/' + CASESHEET_PATHS.admin.home);
    expect(casesheetLinks.adminDepartments()).toBe('/' + CASESHEET_PATHS.admin.departments);
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
    expect(CASESHEETS_PUBLIC_ROUTES.map(r => r.path)).toEqual(['sign-in', 'auth/callback', 'login', '', '**']);
    // The signed-in shell holds exactly the three areas (+ one case) — nothing else.
    expect(CASESHEETS_PUBLIC_SHELL_ROUTES.map(r => r.path)).toEqual(['', 'cases', 'cases/:id', 'settings']);
    const shellRoute = CASESHEETS_PUBLIC_ROUTES.find(r => r.path === '')!;
    expect(shellRoute.children).toBe(CASESHEETS_PUBLIC_SHELL_ROUTES);
    expect((shellRoute.canActivate ?? []).some(g => (g as { casesheetsPublicGuard?: boolean }).casesheetsPublicGuard)).toBe(true);
    expect(CASESHEETS_PUBLIC_ROUTES.find(r => r.path === 'login')!.redirectTo).toBe('sign-in');
  });

  it('the bottom nav has exactly Departments · Cases · Settings, each a shell route', () => {
    expect(CS_NAV.map(n => n.label)).toEqual(['Departments', 'Cases', 'Settings']);
    expect(CS_NAV.map(n => n.href)).toEqual(['/', '/cases', '/settings']);
    for (const n of CS_NAV) expect(CASESHEETS_PUBLIC_SHELL_ROUTES.some(r => '/' + r.path === n.href)).toBe(true);
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
    const user = signal<{ id: string; tenantKind?: string } | null>(null);
    const gateOpen = signal(true);
    function boot(who: { id: string; tenantKind?: string } | null, open = true) {
      user.set(who);
      gateOpen.set(open);
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideRouter(appRoutes),
          { provide: AuthService, useValue: { user, isAuthenticated: () => !!user(), mustChangePassword: () => false, waitForAuth: async () => undefined } },
          { provide: CasesheetGateService, useValue: { ready: async () => undefined, visible: () => gateOpen() } },
        ],
      });
      return TestBed.inject(Router);
    }
    const leafTitle = (router: Router) => {
      let s = router.routerState.snapshot.root;
      while (s.firstChild) s = s.firstChild;
      return s.data['title'];
    };
    beforeEach(() => { saved = env.mode; env.mode = 'casesheets'; });
    afterEach(() => { env.mode = saved; });

    it.each(['/', '/cases', '/cases/abc', '/settings'])('signed in (personal): %s opens the case-sheet page', async (url) => {
      const router = boot({ id: 'u', tenantKind: 'personal' });
      expect(await router.navigateByUrl(url)).toBe(true);
      expect(router.url).toBe(url);
    });

    it.each(['/', '/cases', '/cases/abc', '/settings'])('signed out: %s → the case-sheet sign-in', async (url) => {
      const router = boot(null);
      await router.navigateByUrl(url);
      expect(router.url.split('?')[0]).toBe('/sign-in');
      expect(leafTitle(router)).toBe('Sign in');
    });

    it('signed out: sign-in and the Google return open; /login is the case-sheet sign-in', async () => {
      const router = boot(null);
      await router.navigateByUrl('/auth/callback');
      expect(leafTitle(router)).toBe('Signing in');
      await router.navigateByUrl('/login?reason=expired');
      expect(router.url).toBe('/sign-in?reason=expired');
      expect(leafTitle(router)).toBe('Sign in');
    });

    it('signed in but case sheets not open for the account: every area → sign-in ("not available")', async () => {
      const router = boot({ id: 'lab-user' }, false);
      for (const url of ['/', '/cases', '/settings', '/admin']) {
        await router.navigateByUrl(url);
        expect(router.url).toBe('/sign-in');
      }
    });

    // EVERY LMS URL (each top-level route and each route in the LMS shell, params filled in) is unmatchable: a
    // signed-in personal user lands on Departments, never an LMS screen.
    const lmsUrls = Array.from(new Set(all
      .filter(f => !CASESHEETS_PUBLIC_ROUTES.includes(f.route) && !CASESHEETS_PUBLIC_SHELL_ROUTES.includes(f.route) && f.route !== CASESHEETS_PUBLIC_GROUP)
      .map(f => f.path)
      .filter(p => p && !p.includes('*'))
      .map(p => '/' + p.replace(/:[^/]+/g, 'x'))))
      // An LMS path that happens to spell a public one IS the public page there (tested above).
      .filter(u => !['/cases', '/cases/x', '/settings', '/sign-in', '/auth/callback'].includes(u));

    it('the LMS URL list is the real table (sanity)', () => {
      expect(lmsUrls.length).toBeGreaterThan(50);
      for (const u of ['/login', '/frontdesk', '/admin', '/set-password', '/reports/public/x', '/track/x', '/casesheets/x', '/oauth/consent'])
        expect(lmsUrls).toContain(u);
    });

    it('every LMS URL is unmatchable → the case-sheet Departments page', async () => {
      const router = boot({ id: 'u', tenantKind: 'personal' });
      const leaked: string[] = [];
      for (const url of lmsUrls) {
        await router.navigateByUrl(url).catch(() => false);
        const t = leafTitle(router);
        if (router.url !== '/' || t !== 'Departments') leaked.push(`${url} → ${router.url} (${t})`);
      }
      expect(leaked).toEqual([]);
    });
  });
});
