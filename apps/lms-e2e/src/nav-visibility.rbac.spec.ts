import { test, expect, type Page } from '@playwright/test';
import { loginAs, RoleKey } from './support/auth';

/**
 * RBAC nav / view-visibility — verifies each seeded role sees only the
 * primary-nav work-areas (and the Admin/settings entry) its permissions
 * allow, per the mw RoleSeeder + ProcessWorkflowSeeder contract.
 *
 * TOPOLOGY (read from apps/lms/src/app/layout/nav-items.ts +
 * top-strip.component.{ts,html}):
 *  - The primary nav is workflow-driven: TopStripComponent.primary =
 *    menusFromWorkflow(activeWorkflow, ctx) ?? PRIMARY_NAV. Micro World runs
 *    the seeded default workflow (ProcessWorkflowSeeder.DefaultConfig), whose
 *    categories are Frontdesk / Home Visits / Lab / Validate / Results /
 *    Messages. menusFromWorkflow shows a category only when the user holds a
 *    permission for at least one of its ENABLED actions (ACTION_CATALOG
 *    permissions) — role NAME is no longer consulted (nav-items.ts explicitly
 *    calls the old "gate by area.roles" behaviour the bug it replaced).
 *  - Each nav link renders as <a> inside `nav.pf-topnav-center`
 *    (visible ≥1280px / tailwind `xl:`) with `aria-label` / visible text ==
 *    the item's label — so `getByRole('link', { name })` scoped to that nav
 *    is a stable, real-DOM selector.
 *  - The Admin/settings entry is NOT a nav item — it's a standalone icon
 *    button (`aria-label="Admin settings"`, routes to /admin) shown only when
 *    `hasAnyPermission(['manage_tests','manage_users','manage_workflows',
 *    'manage_branches'])` (TopStripComponent.showAdmin). The SAME permission
 *    set gates the /admin route itself (app.routes.ts `adminGuard`).
 *  - Home Visits / Messages / Stores never render for ANY seeded role in
 *    this environment (Micro World's homeCollection/messages/inventory
 *    module entitlements are off) — that's a tenant-plan gate, not role
 *    RBAC, so this spec doesn't assert on those labels.
 *
 * PER-ROLE MATRIX ASSERTED (mw RoleSeeder permissions → nav):
 *   sampleCollector (Sample Collector: collect_sample, ...)
 *     → sees:  Collect
 *     → hides: Frontdesk, Lab, Validate, Results, Admin
 *   labTech (Lab Technician: collect_sample, receive_sample, enter_result,
 *            view_report, ...)
 *     → sees:  Collect, Lab, Results
 *     → hides: Frontdesk, Validate, Admin
 *   pathologist (Pathologist: validate_result, deliver_report, view_report)
 *     → sees:  Validate, Results
 *     → hides: Frontdesk, Collect, Lab, Admin
 *   admin (Lab Admin: superset of every operational + manage_* permission)
 *     → sees:  Frontdesk, Collect, Lab, Validate, Results, Admin
 *     → hides: (nothing — sees the most, as expected)
 *
 * ⚠ FINDINGS (see the `manager` describe block below for the fully
 *   documented, intentionally-failing assertions — do not "fix" by
 *   weakening them):
 *   1. LEAK — Branch Manager sees the Admin/settings icon and can open
 *      /admin (and /admin/branches) even though the task's RBAC contract
 *      says Admin/settings is Lab Admin-only. Root cause: RoleSeeder.cs
 *      grants "Branch Manager" the `manage_branches` permission (deliberately,
 *      per its own comment — "browse/inspect the tenant branch list" —
 *      but it is also one of the four permissions in both
 *      TopStripComponent.showAdmin's gate AND app.routes.ts's
 *      `adminGuard`/ADMIN_PERMS, so it grants the *entire* admin surface,
 *      not just branch-browsing).
 *   2. GAP (under-exposure, not a security leak) — Branch Manager does NOT
 *      see "Frontdesk" in the nav, despite nav-items.ts's FRONTDESK_PERMS
 *      comment explicitly intending it ("a branch manager oversees the
 *      counter ... admit those roles too (OPS-10)"). Root cause:
 *      menusFromWorkflow() gates a category's visibility on whether the user
 *      holds a permission for one of its ACTION_CATALOG entries BEFORE ever
 *      consulting FRONTDESK_PERMS/ROUTE_NAV_PERMS — and no frontdesk action
 *      (appointment/patient_registration/walk_in_order/billing/
 *      sample_collection/queue/dispatch) lists `manage_branch` as a
 *      qualifying permission. So the FRONTDESK_PERMS carve-out for managers
 *      is live code only on the PRIMARY_NAV fallback path, never on the
 *      workflow-driven nav Micro World actually runs.
 */

test.use({ viewport: { width: 1440, height: 900 } });

/** Scope every nav assertion to the real rendered desktop primary nav. */
function primaryNav(page: Page) {
  return page.locator('nav.pf-topnav-center');
}

async function navLabels(page: Page): Promise<string[]> {
  return (await primaryNav(page).locator('a').allTextContents()).map((s) => s.trim()).filter(Boolean);
}

function adminIcon(page: Page) {
  return page.getByRole('link', { name: 'Admin settings' });
}

/** Wait until the workflow-derived nav has actually rendered (avoids racing
 *  ProcessWorkflowService.loadActive() / auth hydration). `anyLabel` is one
 *  item guaranteed to appear for the role under test. */
async function waitForNav(page: Page, anyLabel: string): Promise<void> {
  await expect(primaryNav(page).getByRole('link', { name: anyLabel })).toBeVisible({ timeout: 15_000 });
}

interface RoleExpectation {
  role: RoleKey;
  /** One label guaranteed present — used to know the nav has hydrated. */
  anchor: string;
  present: string[];
  absent: string[];
  adminVisible: boolean;
}

const MATRIX: RoleExpectation[] = [
  {
    role: 'sampleCollector',
    anchor: 'Collect',
    present: ['Collect'],
    absent: ['Frontdesk', 'Lab', 'Validate', 'Results'],
    adminVisible: false,
  },
  {
    role: 'labTech',
    anchor: 'Lab',
    present: ['Collect', 'Lab', 'Results'],
    absent: ['Frontdesk', 'Validate'],
    adminVisible: false,
  },
  {
    role: 'pathologist',
    anchor: 'Validate',
    present: ['Validate', 'Results'],
    absent: ['Frontdesk', 'Collect', 'Lab'],
    adminVisible: false,
  },
  {
    role: 'admin',
    anchor: 'Frontdesk',
    present: ['Frontdesk', 'Collect', 'Lab', 'Validate', 'Results'],
    absent: [],
    adminVisible: true,
  },
];

test.describe('RBAC nav visibility — per-role primary nav + Admin entry', () => {
  for (const exp of MATRIX) {
    test(`${exp.role} sees exactly its permitted work-areas`, async ({ page }) => {
      await loginAs(page, exp.role);
      await waitForNav(page, exp.anchor);

      const nav = primaryNav(page);
      for (const label of exp.present) {
        await expect(nav.getByRole('link', { name: label, exact: true }), `${exp.role} should see "${label}"`)
          .toBeVisible();
      }
      for (const label of exp.absent) {
        await expect(nav.getByRole('link', { name: label, exact: true }), `${exp.role} must NOT see "${label}"`)
          .toHaveCount(0);
      }

      if (exp.adminVisible) {
        await expect(adminIcon(page), `${exp.role} should see the Admin/settings icon`).toBeVisible();
      } else {
        await expect(adminIcon(page), `${exp.role} must NOT see the Admin/settings icon`).toHaveCount(0);
      }
    });
  }
});

test.describe('RBAC nav visibility — Branch Manager (documented findings, not weakened)', () => {
  // This whole test is EXPECTED TO FAIL — it asserts the RBAC contract given
  // for this spec ("Admin/settings → Lab Admin only", "manager sees
  // frontdesk + dashboards + audit"), which the real app does not fully
  // meet. See the two findings documented in the file header. We use
  // `test.fail()` so CI stays green while the exact, un-weakened assertions
  // stay in the suite as a live regression/finding tracker: if either issue
  // is ever fixed, this test starts passing and Playwright will flag it as
  // an *unexpected* pass, forcing someone to update/remove the annotation.
  test.fail();

  test('manager should see Frontdesk and should NOT see Admin/settings (currently inverted)', async ({ page }) => {
    await loginAs(page, 'manager');
    await waitForNav(page, 'Results');

    const nav = primaryNav(page);

    // FINDING 2 (gap): expected per FRONTDESK_PERMS intent, actually absent.
    await expect.soft(
      nav.getByRole('link', { name: 'Frontdesk', exact: true }),
      'Branch Manager holds manage_branch, which FRONTDESK_PERMS lists as an ' +
        'admitted permission for Front Desk — but menusFromWorkflow never ' +
        'surfaces the category because no frontdesk ACTION_CATALOG entry ' +
        'accepts manage_branch/manage_branches.'
    ).toBeVisible();

    // Sanity: correctly hidden sections stay hidden (these DO pass).
    await expect(nav.getByRole('link', { name: 'Lab', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Validate', exact: true })).toHaveCount(0);

    // FINDING 1 (leak): expected hidden per the task's RBAC contract,
    // actually visible AND functional (see the second test below).
    await expect.soft(
      adminIcon(page),
      'Branch Manager holds manage_branches, which is one of the 4 ' +
        'permissions in both TopStripComponent.showAdmin() and ' +
        "app.routes.ts's adminGuard (ADMIN_PERMS) — so it unlocks the whole " +
        'Admin/settings surface, not just branch browsing.'
    ).toHaveCount(0);
  });

  test('manager can actually navigate to /admin (route guard also admits manage_branches)', async ({ page }) => {
    await loginAs(page, 'manager');
    await waitForNav(page, 'Results');

    await page.goto('/admin');
    // A blocked route would redirect to /login or /403; staying on /admin
    // proves this isn't just a stray icon — the guard genuinely admits the
    // Branch Manager permission set (adminGuard = permissionGuard(ADMIN_PERMS),
    // ADMIN_PERMS includes 'manage_branches').
    await expect.soft(page, 'manager should be bounced off /admin per the RBAC contract').not.toHaveURL(/\/admin$/);
  });
});
