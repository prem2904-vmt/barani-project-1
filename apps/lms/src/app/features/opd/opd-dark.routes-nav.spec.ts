import { Route } from '@angular/router';
import { appRoutes } from '../../app.routes';
import { DOCTOR_NAV, MORE_NAV, NavVisibilityCtx, PRIMARY_NAV, navItemVisible } from '../../layout/nav-items';
import { ModuleKey } from '../../core/services/tenant-entitlements.service';
import { OPD_ADMIN_ROUTES, OPD_FRONTDESK_CHILD_ROUTES, OPD_SHELL_ROUTES } from './opd.routes';
import { CASESHEET_SHELL_ROUTES, CASESHEETS_PUBLIC_GROUP, CASESHEETS_PUBLIC_ROUTES, CASESHEETS_PUBLIC_SHELL_ROUTES } from '../casesheets/casesheets.routes';

/**
 * OPD dark build — routes + nav with the gate CLOSED are exactly today's lab
 * set, and every OPD route is behind the OPD gate (a deep link bounces like an
 * unknown URL).
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
const isOpdGuard = (g: unknown) => !!(g as { opdGate?: boolean })?.opdGate;
const OPD_ROUTE_OBJECTS = new Set<Route>([...OPD_SHELL_ROUTES, ...OPD_ADMIN_ROUTES, ...OPD_FRONTDESK_CHILD_ROUTES]);
const all = flatten(appRoutes);

/** What looks like an OPD URL anywhere in the app. */
const OPD_PATH = /(^|\/)(opd|doctor)(\/|$)|^frontdesk\/consult$/;

describe('OPD routes are all gated', () => {
  it('every OPD-looking route is one of the OPD route objects and carries opdGuard', () => {
    // (Old OPD links that only redirect — /admin/opd, /admin/opd/pharmacy, /admin/opd/drugs — are not pages.)
    const opdish = all.filter(f => OPD_PATH.test(f.path) && !f.route.redirectTo);
    // Every OPD route object is mounted once (Pharmacy's two settings routes live in the OPD file but sit at /admin/pharmacy).
    expect(all.filter(f => OPD_ROUTE_OBJECTS.has(f.route)).length).toBe(OPD_ROUTE_OBJECTS.size);
    for (const f of opdish) {
      expect(OPD_ROUTE_OBJECTS.has(f.route)).toBe(true);
      expect((f.route.canActivate ?? []).some(isOpdGuard)).toBe(true);
    }
  });

  it('admin OPD routes keep the admin permission guard as well', () => {
    for (const r of OPD_ADMIN_ROUTES) expect((r.canActivate ?? []).length).toBe(2);
  });

  it('every route in the OPD files is mounted in the app', () => {
    const mounted = new Set(all.map(f => f.route));
    for (const r of OPD_ROUTE_OBJECTS) expect(mounted.has(r)).toBe(true);
  });
});

/** Case-sheet route objects (gated in-shell routes + the casesheets-mode-only public group) — pinned by
 *  features/casesheets/casesheets.routes.spec.ts, so the lab set below stays byte-identical. */
const CASESHEET_ROUTE_OBJECTS = new Set<Route>([...CASESHEET_SHELL_ROUTES, CASESHEETS_PUBLIC_GROUP, ...CASESHEETS_PUBLIC_ROUTES, ...CASESHEETS_PUBLIC_SHELL_ROUTES]);

/**
 * Snapshot of today's NON-OPD route paths (origin/dev 0d4db6df, OPD routes
 * removed). With the gate closed the reachable app is exactly this — adding or
 * removing a lab route must update it deliberately. Case-sheet routes (2026-11-10,
 * WP0-ui) are excluded here on purpose and pinned in casesheets.routes.spec.ts.
 */
describe('non-OPD routes are exactly today\'s lab set', () => {
  it('matches the snapshot', () => {
    const lab = all.filter(f => !OPD_ROUTE_OBJECTS.has(f.route) && !CASESHEET_ROUTE_OBJECTS.has(f.route)).map(f => f.path);
    expect(lab).toMatchSnapshot();
    expect(lab.filter(p => OPD_PATH.test(p) && p !== 'admin/opd' && !p.startsWith('admin/opd/')).length).toBe(0);
  });
});

function ctx(opdOn: boolean): NavVisibilityCtx {
  return {
    hasAny: () => true, isSuper: true,
    collectionMode: 'front_desk', billingMode: 'front_desk', inventoryEnabled: true,
    // Mirrors TenantEntitlementsService.moduleEnabled: opd = the OPD gate; the
    // rest = a tenant with no module row (catalog defaults).
    moduleEnabled: (m: ModuleKey) => m === 'opd' ? opdOn : ['lab', 'inventory', 'messages', 'homeCollection', 'reports'].includes(m),
  };
}
const ids = (opdOn: boolean) => [...PRIMARY_NAV, ...MORE_NAV].filter(i => navItemVisible(i, ctx(opdOn))).map(i => i.id);

describe('nav with the gate closed', () => {
  it('shows no OPD entry and equals the gate-open set minus OPD', () => {
    const off = ids(false);
    const on = ids(true);
    expect(off).not.toContain('m-opd');
    expect(on).toContain('m-opd');
    expect(off).toEqual(on.filter(id => id !== 'm-opd'));
    expect(off).toMatchSnapshot();
  });

  it('doctor Consults points into the gated OPD area', () => {
    expect(DOCTOR_NAV.href).toBe('/opd/consult');
    expect(all.find(f => f.path === 'opd/consult')?.route.canActivate?.some(isOpdGuard)).toBe(true);
  });
});
