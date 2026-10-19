import { test, expect, type Page } from '@playwright/test';
import { loginAs, type RoleKey } from './support/auth';

/**
 * OPERATIONAL ACCESS MATRIX — a cross-cutting RBAC audit of the day-to-day
 * operational screens (appointments, home collection, the collection queue,
 * lost & found, partners/vendors/referral-labs/referring-network, KPIs,
 * finance and the audit log) across all 5 working seeded roles.
 *
 * Ground truth is apps/lms/src/app/app.routes.ts (route `canActivate`
 * guards), cross-checked against prefrontal-mw's Prefrontal/Seed/RoleSeeder.cs
 * (the actual permission set each seeded role holds). Companion to
 * admin-config-access.rbac.spec.ts (tenant-configuration screens) and
 * admin-settings.rbac.spec.ts / nav-visibility.rbac.spec.ts — same guard
 * vocabulary, different screen set.
 *
 * `permissionGuard(codes)` (core/auth/permission.guard.ts) is OR-semantics:
 * it admits the user if they hold ANY of the listed permissions, otherwise
 * redirects to `/403` (the shared "Forbidden" PlaceholderComponent). Some
 * operational screens stack a SECOND guard behind the permission guard:
 * `moduleGuard(key)` (tenant module entitlement) or `workflowGuard(key)`
 * (tenant process-workflow action toggle) — both fail-open by design
 * (module.guard.ts / workflow.guard.ts doc comments: "never locks out an
 * already-live tenant... only an action/module explicitly turned OFF is
 * blocked") and, on failure, redirect to `/` (landing) — NOT `/403`.
 *
 * So a route with only a permissionGuard has ONE block outcome (/403) and
 * we assert reach-vs-block exactly. A route stacking a permission guard
 * *and* a module/workflow guard has TWO distinct block outcomes: lacking
 * the permission → /403 (permission guard fires first and short-circuits);
 * holding the permission but the tenant having the module/workflow toggled
 * off → / (environmental, not an RBAC fact about the role). For those
 * stacked routes we assert the role-holds-permission case as "reachable OR
 * redirected to /, but definitely NOT /403" — the only thing that is a pure
 * function of the role's permission set — and assert the role-lacks-
 * permission case as the usual exact /403.
 *
 * Route → guard (verified in app.routes.ts):
 *   /admin/appointments      permissionGuard(['manage_branches','manage_tenant'])
 *   /frontdesk/appointments  permissionGuard(['register_patient','create_order','view_order']) + workflowGuard('appointment')
 *   /admin/home-collection   permissionGuard(['manage_home_collection','manage_branches']) + moduleGuard('homeCollection')
 *   /frontdesk/home-collection permissionGuard(['manage_home_collection','register_patient','create_order']) + workflowGuard('home_visits') + moduleGuard('homeCollection')
 *   /frontdesk/queue         permissionGuard(['register_patient','create_order','view_order','collect_sample']) + workflowGuard('queue')
 *   /lost-and-found          permissionGuard(['receive_sample','reject_sample','cancel_order','manage_users']) + workflowGuard('lost_and_found')
 *   /admin/partners          permissionGuard(['manage_tenant','manage_tests','manage_admin'])
 *   /admin/vendors           permissionGuard('manage_tenant')
 *   /admin/referral-labs     permissionGuard('manage_tests')
 *   /admin/referring-network permissionGuard(['manage_tenant','manage_admin'])
 *   /admin/kpis              adminGuard = permissionGuard(['manage_tests','manage_users','manage_workflows','manage_branches'])
 *   /finance                 permissionGuard(['collect_payment','create_bill','manage_tenant'])
 *   /finance/daily           permissionGuard(['collect_payment','create_bill','manage_tenant'])
 *   /admin/audit             permissionGuard('view_audit_log')
 *
 * Role → permission (RoleSeeder.cs):
 *   admin (Lab Admin)        holds every manage_*, plus collect_payment,
 *                            create_bill, view_audit_log, collect_sample,
 *                            register_patient, create_order, receive_sample,
 *                            reject_sample, cancel_order, manage_home_collection
 *                            → reaches everything (module/workflow toggles permitting).
 *   manager (Branch Manager) holds manage_branch, manage_branches,
 *                            view_audit_log, manage_home_collection, view_* —
 *                            NOT manage_tenant/manage_tests/manage_users/
 *                            manage_workflows/collect_payment/create_bill/
 *                            register_patient/create_order/collect_sample/
 *                            receive_sample/reject_sample/cancel_order.
 *   labTech                  view_patient, view_order, collect_sample,
 *                            reject_sample, receive_sample, enter_result,
 *                            edit_result, view_report, view_test, print_barcode.
 *                            No manage_*.
 *   sampleCollector           view_patient, view_order, collect_sample,
 *                            reject_sample, print_barcode.
 *   pathologist               view_patient, view_order, edit_result,
 *                            validate_result, reject_result, reassign_result,
 *                            view_report, deliver_report. No manage_*.
 *
 * ⚠ FINDING — Branch-Manager over-exposure extends to operations (same root
 * cause as admin-config-access.rbac.spec.ts's documented finding): `manage_branches`
 * is OR'd into the guard for /admin/appointments and /admin/kpis (adminGuard),
 * so a Branch Manager's direct navigation to either URL loads the real
 * screen — not /403 — purely because they hold the read-tier "browse the
 * tenant branch list" permission. Bounded: the manager tests below assert
 * the CONTRAST live — manager is correctly /403 on /admin/vendors,
 * /admin/referral-labs, /admin/referring-network, /admin/partners, /finance
 * and /finance/daily (none of those guards mention manage_branches), which
 * shows the leak is specific to manage_branches-guarded screens, not a
 * general Branch-Manager bypass.
 *
 * ⚠ FINDING — `manage_admin` is a dead guard reference. /admin/partners and
 * /admin/referring-network both OR `manage_admin` into their permission list,
 * but that code is seeded NOWHERE in the mw backend (RoleSeeder.cs — no role,
 * including Lab Admin, is ever granted a permission literally named
 * `manage_admin`). Harmless today because `manage_tenant`/`manage_tests`
 * already co-gate both routes for the one role (admin) that needs them, but
 * it silently gates nothing; if a dedicated admin-management permission was
 * intended, it does not exist. Tracked live on the admin reach test for
 * those two screens below so a future permission rename doesn't silently
 * break this without anyone noticing the reference was always inert.
 */

const FORBIDDEN_HEADING = /forbidden/i;

/** Exact block: permission-only routes redirect to /403 with no other
 *  possible outcome, so we assert the precise URL + heading. */
async function expectBlocked(page: Page, path: string) {
  await page.goto(path);
  await page.waitForURL(/\/403$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: FORBIDDEN_HEADING })).toBeVisible();
  await expect(page.getByText(/you do not have permission/i)).toBeVisible();
}

/** Exact reach: permission-only routes with no module/workflow guard behind
 *  them — a holder always lands on the real screen. */
async function expectAllowed(page: Page, path: string, headingName: RegExp) {
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(path.replace(/\//g, '\\/') + '$'));
  await expect(page.getByRole('heading', { name: headingName, level: 1 })).toBeVisible({ timeout: 15_000 });
}

/** Tolerant reach: guard-stacked routes (permission + module/workflow). A
 *  role holding the listed permission must NOT be bounced to /403 by the
 *  permission guard — but MAY still land on `/` if the tenant's module or
 *  workflow toggle is off (environmental, not an RBAC fact about the role).
 *
 *  Note: /403 can only ever come from the SYNCHRONOUS permission guard (which
 *  passes for a holder); the async module/workflow guards only ever redirect
 *  to `/`. So we never need to wait for the network to settle — doing so via
 *  `networkidle` actually hangs, because the reachable frontdesk screens hold
 *  persistent connections that never go idle, burning the whole test budget.
 *  We give the guard chain a brief beat to run, then assert we are not on /403
 *  and confirm the URL is stable (a late redirect to /403 cannot appear). */
async function expectNotForbidden(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('domcontentloaded');
  await expect(page).not.toHaveURL(/\/403(\/|$)/, { timeout: 10_000 });
  await page.waitForTimeout(400);
  await expect(page, `holder should not be bounced to /403 from ${path}`).not.toHaveURL(/\/403(\/|$)/);
}

interface PermScreen {
  key: string;
  path: string;
  heading: RegExp;
  holders: ReadonlySet<RoleKey>;
}

// Permission-only routes — no module/workflow guard behind the permission
// guard, so reach vs. block is an exact function of the role's permissions.
const PERM_SCREENS: PermScreen[] = [
  { key: 'appointmentsConfig', path: '/admin/appointments', heading: /appointments\s*&\s*queue/i, holders: new Set<RoleKey>(['admin', 'manager']) },
  { key: 'vendors', path: '/admin/vendors', heading: /vendor credit wallets/i, holders: new Set<RoleKey>(['admin']) },
  { key: 'referralLabs', path: '/admin/referral-labs', heading: /referral\s*\/\s*outsourced labs/i, holders: new Set<RoleKey>(['admin']) },
  { key: 'referringNetwork', path: '/admin/referring-network', heading: /hospitals\s*&\s*doctors/i, holders: new Set<RoleKey>(['admin']) },
  { key: 'partners', path: '/admin/partners', heading: /referral\s*&\s*vendors/i, holders: new Set<RoleKey>(['admin']) },
  { key: 'kpis', path: '/admin/kpis', heading: /kpi configuration/i, holders: new Set<RoleKey>(['admin', 'manager']) },
  { key: 'audit', path: '/admin/audit', heading: /audit trail/i, holders: new Set<RoleKey>(['admin', 'manager']) },
  { key: 'finance', path: '/finance', heading: /^finance$/i, holders: new Set<RoleKey>(['admin']) },
  { key: 'financeDaily', path: '/finance/daily', heading: /daily statement/i, holders: new Set<RoleKey>(['admin']) },
];

interface StackedScreen {
  key: string;
  path: string;
  holders: ReadonlySet<RoleKey>;
}

// Guard-stacked routes — permission guard + module and/or workflow guard.
// NOTE: the /frontdesk/* children live under a PARENT `frontdesk` route gated
// by permissionGuard(FRONTDESK_PERMS) = [register_patient, create_order,
// create_bill, collect_payment, manage_branch] (app.routes.ts frontdesk shell).
// That parent gate runs FIRST, so a child's own view_order/collect_sample perm
// is irrelevant to reachability. Lab roles (labTech/sampleCollector/pathologist)
// hold none of FRONTDESK_PERMS → correctly bounced to /403 at the shell (the
// OPS-10 lab-tech leak fix). Manager reaches via manage_branch (the documented
// Branch-Manager over-exposure). So the real holders of the frontdesk-shell
// children are {admin, manager} only.
const STACKED_SCREENS: StackedScreen[] = [
  { key: 'frontdeskAppointments', path: '/frontdesk/appointments', holders: new Set<RoleKey>(['admin', 'manager']) },
  { key: 'frontdeskQueue', path: '/frontdesk/queue', holders: new Set<RoleKey>(['admin', 'manager']) },
  { key: 'homeCollectionAdmin', path: '/admin/home-collection', holders: new Set<RoleKey>(['admin', 'manager']) },
  { key: 'homeCollectionFrontdesk', path: '/frontdesk/home-collection', holders: new Set<RoleKey>(['admin', 'manager']) },
  { key: 'lostAndFound', path: '/lost-and-found', holders: new Set<RoleKey>(['admin', 'labTech', 'sampleCollector']) },
];

const OPERATIONAL_ROLES: RoleKey[] = ['admin', 'manager', 'labTech', 'sampleCollector', 'pathologist'];

for (const role of OPERATIONAL_ROLES) {
  test.describe(`Operational access matrix — ${role}`, () => {
    test(`${role}: permission-only screens (exact reach/block)`, async ({ page }) => {
      if (role === 'manager') {
        test.info().annotations.push({
          type: 'finding',
          description:
            'Branch-Manager over-exposure extends to operations: manage_branches is OR\'d into the guard for ' +
            '/admin/appointments and /admin/kpis (adminGuard), so Branch Manager reaches both real screens directly, ' +
            'not /403 — even though it correctly stays /403 on vendors/referral-labs/referring-network/partners/finance ' +
            '(none of those guards mention manage_branches). Same root cause as admin-config-access.rbac.spec.ts\'s ' +
            'documented Branch-Manager finding, just extended to the operational screen set.',
        });
      }
      if (role === 'admin') {
        test.info().annotations.push({
          type: 'finding',
          description:
            '`manage_admin` is a dead guard reference: /admin/partners and /admin/referring-network both OR ' +
            'manage_admin into their permission list, but no seeded mw role is ever granted a permission literally ' +
            'named manage_admin (verified via RoleSeeder.cs). Harmless today because manage_tenant/manage_tests already ' +
            'co-gate both routes for admin, but it silently gates nothing — if a dedicated admin-management permission ' +
            'was intended, it does not exist.',
        });
      }
      await loginAs(page, role);
      for (const s of PERM_SCREENS) {
        if (s.holders.has(role)) {
          await expectAllowed(page, s.path, s.heading);
        } else {
          await expectBlocked(page, s.path);
        }
      }
    });

    test(`${role}: guard-stacked screens (tolerant reach/exact block)`, async ({ page }) => {
      // Five sequential real-browser navigations, some waiting up to 15s for a
      // /403 redirect to settle — legitimately more than the 30s default budget.
      test.slow();
      if (role === 'labTech' || role === 'sampleCollector' || role === 'pathologist') {
        test.info().annotations.push({
          type: 'finding',
          description:
            'Positive control (leak fix holding): the /frontdesk shell parent gates on FRONTDESK_PERMS ' +
            '(register_patient/create_order/create_bill/collect_payment/manage_branch), NOT view_patient/view_order. ' +
            `So ${role} — which holds view_order but none of FRONTDESK_PERMS — is correctly bounced to /403 at the ` +
            'shell BEFORE any child (appointments/queue) renders. This is the OPS-10 lab-tech-leak fix; the child ' +
            "guards' view_order alone would have let lab roles in.",
        });
      }
      await loginAs(page, role);
      for (const s of STACKED_SCREENS) {
        if (s.holders.has(role)) {
          await expectNotForbidden(page, s.path);
        } else {
          await expectBlocked(page, s.path);
        }
      }
    });
  });
}
