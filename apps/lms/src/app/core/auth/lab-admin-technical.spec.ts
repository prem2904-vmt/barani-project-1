import { TestBed } from '@angular/core/testing';
import { Route } from '@angular/router';
import { appRoutes } from '../../app.routes';
import { MORE_NAV, NavVisibilityCtx, navItemVisible } from '../../layout/nav-items';
import { LabSettingsHubComponent } from '../../features/lab/lab-settings-hub/lab-settings-hub.component';
import { PERMISSION_GROUPS, PERMISSION_INFO, ROLE_INFO } from '../../features/admin/users-access/permission-catalog';
import { ThemeService } from '../services/theme.service';
import { AuthService } from './auth.service';
import { pickLanding } from './landing.guard';
import {
  FINANCE_PERMS, PAYMENT_RULE_PERMS, RouteAccessCtx, TEST_MASTER_PERMS, TEST_PRICING_PERMS, WA_BILLING_VIEW_PERMS,
  canOpenRoute,
} from './route-access';

/**
 * Lab Admin (Technical) — owner 2026-09-30: works in Test Master (tests,
 * profiles, packages, ranges, layouts AND prices) and Lab settings, never in
 * money (billing, payments, discounts, refunds, finance hub / day-end,
 * WhatsApp credits) or user / role / organisation administration.
 *
 * The permission set mirrors RoleSeeder.Definitions["Lab Admin (Technical)"]
 * (the backend matrix test pins the server side).
 */
const LAB_ADMIN_TECH = [
  'view_patient', 'view_order',
  'collect_sample', 'reject_sample', 'print_barcode', 'receive_sample', 'dispatch_sample',
  'enter_result', 'edit_result', 'reject_result', 'reassign_result', 'culture_workbench',
  'view_report', 'view_test',
  'manage_test_master', 'manage_test_pricing',
  'manage_lab_settings', 'manage_departments', 'manage_report_template',
  'view_tat_dashboard', 'view_audit_log',
  'lms.critical_value.notify', 'lms.tat_breach.notify', 'lms.sample_rejection.notify',
];

/** The tenant admin's seat as the server hands it out: manage_tests is expanded
 *  (PermissionImplications) with the two finer codes. */
const ADMIN_EXPANDED = ['manage_tests', 'manage_users', 'manage_tenant', 'manage_billing_config',
  'manage_lab_settings', 'manage_report_template', 'create_bill', 'collect_payment',
  'manage_test_master', 'manage_test_pricing'];

const ctxFor = (perms: string[]): RouteAccessCtx => ({
  hasAny: p => perms.includes('*') || p.some(c => perms.includes(c)),
});

const navCtx = (perms: string[]): NavVisibilityCtx => ({
  ...ctxFor(perms),
  isEnabled: () => true,
  isSuper: perms.includes('*'),
  collectionMode: 'front_desk',
  billingMode: 'separate_counter',
  inventoryEnabled: true,
  moduleEnabled: () => true,
});

/** The guard functions (outermost → leaf) on the live appRoutes for a path. */
function guardsFor(path: string): Array<{ requiredPerms?: string[] }> {
  const want = path.split('/').filter(Boolean);
  const walk = (routes: Route[], rest: string[], acc: unknown[]): unknown[] | null => {
    for (const r of routes) {
      const parts = (r.path ?? '').split('/').filter(Boolean);
      if (parts.length > rest.length) continue;
      if (!parts.every((p, i) => p.startsWith(':') || p === rest[i])) continue;
      const here = [...acc, ...(r.canActivate ?? [])];
      const remaining = rest.slice(parts.length);
      if (!remaining.length && (r.loadComponent || r.component)) return here;
      if (r.children) { const hit = walk(r.children, remaining, here); if (hit) return hit; }
    }
    return null;
  };
  const chain = walk(appRoutes, want, []);
  if (!chain) throw new Error(`no route for ${path}`);
  return chain as Array<{ requiredPerms?: string[] }>;
}

const guardAllows = (path: string, perms: string[]) =>
  guardsFor(path).every(g => !g.requiredPerms || g.requiredPerms.some(c => perms.includes('*') || perms.includes(c)));

describe('Lab Admin (Technical) — routes it CAN open', () => {
  for (const route of ['/admin/tests', '/admin/tests/new', '/admin/referral-labs', '/admin/lab-settings',
                       '/lab/settings', '/admin/microbiology', '/admin/reports', '/lab/my-work', '/dashboard']) {
    it(`${route}: nav table and real guard both admit`, () => {
      expect(canOpenRoute(route, ctxFor(LAB_ADMIN_TECH))).toBe(true);
      expect(guardAllows(route, LAB_ADMIN_TECH)).toBe(true);
    });
  }

  it('the test editor route (admin/tests/:id/edit) admits manage_test_master', () => {
    expect(guardAllows('/admin/tests/abc/edit', LAB_ADMIN_TECH)).toBe(true);
    expect(guardAllows('/admin/tests/abc/edit', ['view_test', 'manage_test_pricing'])).toBe(false);
  });
});

describe('Lab Admin (Technical) — finance / users / org stay CLOSED', () => {
  for (const route of ['/finance', '/finance/daily', '/billing-counter', '/frontdesk', '/frontdesk/post-payment',
                       '/admin/billing', '/admin/users', '/admin/users/invite', '/admin/roles/new',
                       '/admin/organization', '/admin/vendors', '/admin', '/admin/manage', '/admin/modules',
                       '/admin/kpis', '/setup', '/admin/notifications', '/admin/referring-network',
                       '/admin/workflows', '/admin/process', '/admin/appointments', '/stores', '/admin/inventory']) {
    it(`${route}: hidden in the nav table and refused by the guard`, () => {
      expect(canOpenRoute(route, ctxFor(LAB_ADMIN_TECH))).toBe(false);
      expect(guardAllows(route, LAB_ADMIN_TECH)).toBe(false);
    });
  }

  it('holds none of the finance / money-view / payment-rule / admin codes', () => {
    const banned = [...FINANCE_PERMS, ...WA_BILLING_VIEW_PERMS, ...PAYMENT_RULE_PERMS,
      'give_discount', 'override_discount', 'approve_discount', 'process_refund', 'view_bill', 'modify_order',
      'cancel_order', 'view_dashboard', 'manage_users', 'manage_roles', 'manage_workflows', 'manage_tests'];
    expect(LAB_ADMIN_TECH.filter(c => banned.includes(c))).toEqual([]);
  });

  it('More menu: Tests + Lab settings show; Daily statement, Billing cfg, Users, Admin overview do not', () => {
    const visible = MORE_NAV.filter(i => navItemVisible(i, navCtx(LAB_ADMIN_TECH))).map(i => i.id);
    expect(visible).toEqual(expect.arrayContaining(['tests', 'lab-settings', 'lab-cfg', 'reports-t']));
    for (const id of ['daily-statement', 'billing', 'users', 'admin-overview', 'admin-manage', 'notifs', 'process', 'workflows']) {
      expect(visible).not.toContain(id);
    }
  });

  it('lands on the bench (never /403, never /admin)', () => {
    expect(pickLanding(ctxFor(LAB_ADMIN_TECH))).toBe('/lab/my-work');
    // A Test-Master-only custom role lands on the Lab settings hub.
    expect(pickLanding(ctxFor(['manage_test_master']))).toBe('/lab/settings');
  });
});

describe('Test Master grants — Admin unchanged', () => {
  it('manage_tests alone still opens Test Master (the full switch)', () => {
    for (const r of ['/admin/tests', '/admin/tests/new', '/admin/referral-labs', '/admin', '/lab/settings']) {
      expect(canOpenRoute(r, ctxFor(['manage_tests']))).toBe(true);
    }
    expect(guardAllows('/admin/tests/x/edit', ['manage_tests'])).toBe(true);
  });

  it('the constants keep manage_tests in front', () => {
    expect(TEST_MASTER_PERMS).toEqual(['manage_tests', 'manage_test_master']);
    expect(TEST_PRICING_PERMS).toEqual(['manage_tests', 'manage_test_pricing']);
  });

  it('price editing: pricing grant or full switch or *; Test-Master-only cannot', () => {
    const canPrice = (perms: string[]) => ctxFor(perms).hasAny(TEST_PRICING_PERMS);
    expect(canPrice(LAB_ADMIN_TECH)).toBe(true);
    expect(canPrice(ADMIN_EXPANDED)).toBe(true);
    expect(canPrice(['manage_tests'])).toBe(true);
    expect(canPrice(['*'])).toBe(true);
    expect(canPrice(['manage_test_master', 'view_test'])).toBe(false);
  });
});

describe('Lab settings hub — tiles filtered by what the user can open', () => {
  function hubFor(perms: string[]) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: ThemeService, useValue: {} },
        { provide: AuthService, useValue: {
          hasAnyPermission: (c: string[]) => perms.includes('*') || c.some(x => perms.includes(x)),
        } },
      ],
    });
    return TestBed.runInInjectionContext(() => new LabSettingsHubComponent());
  }

  it('Lab Admin (Technical) sees only openable tiles', () => {
    const hrefs = hubFor(LAB_ADMIN_TECH).visibleTiles().map(t => t.href);
    expect(hrefs).toEqual(['/admin/tests', '/admin/reports', '/admin/referral-labs', '/admin/lab-settings', '/admin/microbiology', '/admin/instruments']);
  });

  it('super-admin sees every tile (a BETA tile only with its switch — off here)', () => {
    const hub = hubFor(['*']);
    expect(hub.visibleTiles().length).toBe(hub.tiles.filter(t => !t.beta).length);
  });
});

describe('Role editor catalogue', () => {
  it('describes the two new codes in plain words, grouped under Test Master & prices', () => {
    expect(PERMISSION_GROUPS.some(g => g.key === 'testmaster')).toBe(true);
    for (const code of ['manage_tests', 'manage_test_master', 'manage_test_pricing']) {
      expect(PERMISSION_INFO[code]?.group).toBe('testmaster');
      expect(PERMISSION_INFO[code]?.what.length).toBeGreaterThan(20);
    }
    expect(PERMISSION_INFO['manage_test_pricing'].sensitive).toBe(true);
  });

  it('explains the role, and that it has no money / users', () => {
    expect(ROLE_INFO['Lab Admin (Technical)']).toMatch(/No billing/);
    expect(ROLE_INFO['Lab Admin']).toBeTruthy();
  });
});
