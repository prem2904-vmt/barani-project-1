import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * ADMIN-SETTINGS GATING — who can reach /admin/* screens and change tenant
 * settings.
 *
 * Ground truth is apps/lms/src/app/app.routes.ts (route `canActivate` guards)
 * cross-checked against prefrontal-mw's Prefrontal/Seed/RoleSeeder.cs (the
 * actual permission set each seeded role holds). `permissionGuard(...)`
 * (core/auth/permission.guard.ts) redirects a user lacking every listed
 * permission to `/403`, which renders the "Forbidden" placeholder screen
 * (features/shared/placeholder.component.ts) — that's the block signature we
 * assert on everywhere below. There is no separate `/unauthorized` route.
 *
 * Seeded roles (apps/lms-e2e/src/support/auth.ts → ROLE_CREDS) map to mw
 * roles as: labTech→"Lab Technician", pathologist→"Pathologist",
 * sampleCollector→"Sample Collector", manager→"Branch Manager",
 * admin→"Lab Admin". Per RoleSeeder.cs only "Lab Admin" holds
 * manage_tenant/manage_users/manage_tests/manage_workflows/
 * manage_report_template/manage_billing_config — Lab Technician,
 * Pathologist and Sample Collector hold NONE of the manage_* permissions,
 * so they're blocked from every /admin/* route below, full stop.
 *
 * ⚠ FINDING — Branch Manager is NOT fully excluded from /admin. RoleSeeder
 * grants Branch Manager `manage_branches` (read-only branch browsing per its
 * own comment), but two routes OR manage_branches into their guard instead
 * of requiring the settings-specific permission:
 *   - /admin/lab-settings: permissionGuard(['manage_lab_settings', 'manage_branches'])
 *   - /admin/billing:      permissionGuard(['manage_tenant', 'manage_branches'])
 * So a Branch Manager's direct navigation to those two URLs LOADS the real
 * admin screen (not /403) — confirmed below. The corresponding backend
 * writes stay protected (ConfigController's POST endpoints require
 * "manage_tenant" only — manage_branches is accepted on the GETs, not the
 * POSTs — see Prefrontal/Controllers/ConfigController.cs), so a Manager
 * cannot actually persist a change; but the screen itself — including
 * whatever billing/lab-settings data it displays — is visible to them,
 * which contradicts the "only Lab Admin reaches tenant-admin screens"
 * expectation. Same root cause surfaces the Admin nav entry point to
 * Branch Managers too: ADMIN_NAV.permissions (layout/nav-items.ts) is
 * ['manage_tests','manage_users','manage_workflows','manage_branches'] —
 * the trailing manage_branches means showAdmin()/showAdminTab() (top-strip
 * + bottom-nav) light up for a Branch Manager, not just Lab Admin.
 * admin/users, admin/tests and admin/workflows are NOT affected — those
 * guards are single-permission (manage_users / manage_tests /
 * manage_workflows only), so Branch Manager is correctly blocked there.
 */

const FORBIDDEN_HEADING = /forbidden/i;

async function expectBlocked(page: Page, path: string) {
  await page.goto(path);
  await page.waitForURL(/\/403$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: FORBIDDEN_HEADING })).toBeVisible();
  await expect(page.getByText(/you do not have permission/i)).toBeVisible();
}

async function expectAllowed(page: Page, path: string, headingName: RegExp) {
  await page.goto(path);
  // Give the guard + lazy chunk a moment, then confirm we were NOT bounced.
  await expect(page).toHaveURL(new RegExp(path.replace(/\//g, '\\/') + '$'));
  await expect(page.getByRole('heading', { name: headingName, level: 1 })).toBeVisible({ timeout: 15_000 });
}

/** No admin entry point anywhere in the chrome — top-strip icon (xl+) and
 *  bottom-nav tab both routerLink to exactly '/admin' and are both gated by
 *  the same ADMIN_NAV.permissions check, so a plain href lookup catches
 *  either regardless of viewport-driven CSS visibility. */
async function expectNoAdminNavEntry(page: Page) {
  await expect(page.locator('a[href="/admin"]')).toHaveCount(0);
}

async function expectAdminNavEntry(page: Page) {
  await expect(page.locator('a[href="/admin"]').first()).toBeAttached();
}

test.describe('Admin-settings RBAC gating', () => {
  test('admin (Lab Admin): reaches every tenant-admin screen', async ({ page }) => {
    await loginAs(page, 'admin');
    await expectAdminNavEntry(page);

    await expectAllowed(page, '/admin/users', /users\s*&\s*access/i);
    await expectAllowed(page, '/admin/tests', /test master/i);
    await expectAllowed(page, '/admin/lab-settings', /lab settings/i);
    await expectAllowed(page, '/admin/workflows', /workflow builder/i);
    await expectAllowed(page, '/admin/billing', /billing config/i);
  });

  for (const role of ['labTech', 'pathologist', 'sampleCollector'] as const) {
    test(`${role}: blocked from every tenant-admin screen + no admin nav entry`, async ({ page }) => {
      await loginAs(page, role);

      await expectBlocked(page, '/admin/users');
      await expectBlocked(page, '/admin/tests');
      await expectBlocked(page, '/admin/lab-settings');
      await expectBlocked(page, '/admin/workflows');
      await expectBlocked(page, '/admin/billing');

      await expectNoAdminNavEntry(page);
    });
  }

  test('manager (Branch Manager): blocked from Users/Tests/Workflows — ' +
       'but reaches Lab Settings/Billing via manage_branches (finding, see header comment)', async ({ page }) => {
    await loginAs(page, 'manager');

    // Correctly blocked — single-permission guards Branch Manager doesn't hold.
    await expectBlocked(page, '/admin/users');
    await expectBlocked(page, '/admin/tests');
    await expectBlocked(page, '/admin/workflows');

    // ⚠ NOT blocked — the guard's manage_branches fallback admits Branch
    // Manager into the real screen. This is the finding documented above.
    await expectAllowed(page, '/admin/lab-settings', /lab settings/i);
    await expectAllowed(page, '/admin/billing', /billing config/i);

    // ⚠ Consequently the Admin nav entry point is ALSO visible to Branch
    // Manager (ADMIN_NAV.permissions includes manage_branches) — not
    // "absent for non-admins" as a strict reading would expect.
    await expectAdminNavEntry(page);
  });

  test('manager (Branch Manager): cannot actually persist a Lab Settings change ' +
       '(backend write endpoint requires manage_tenant only)', async ({ page }) => {
    await loginAs(page, 'manager');
    await page.goto('/admin/lab-settings');
    await expect(page.getByRole('heading', { name: /lab settings/i, level: 1 })).toBeVisible({ timeout: 15_000 });

    // Flip Sample identification to Manual — a real tenant-wide PATCH
    // (setScanMode → PATCH /api/tenants/current). If the backend correctly
    // enforces manage_tenant on the write, this should error, not succeed.
    const manualOption = page.getByRole('button', { name: /manual entry/i });
    const patchResponse = page.waitForResponse(
      r => r.url().includes('/api/tenants/current') && r.request().method() === 'PATCH',
      { timeout: 15_000 }
    );
    await manualOption.click();
    const resp = await patchResponse;
    expect(resp.ok(), 'Branch Manager must NOT be able to write tenant config — backend should 401/403 this PATCH').toBe(false);
  });
});

test.describe('Admin-settings — a Lab Admin change actually persists', () => {
  test('admin: toggling Sample identification (scan ⇄ manual) persists across reload, then is restored', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/admin/lab-settings');
    await expect(page.getByRole('heading', { name: /lab settings/i, level: 1 })).toBeVisible({ timeout: 15_000 });

    const scanOption = page.getByRole('button', { name: /^scan \(qr \/ barcode\)/i });
    const manualOption = page.getByRole('button', { name: /manual entry/i });

    // Whatever mode we start in, drive to a known state (scan) first so the
    // test is deterministic regardless of prior runs' leftovers.
    if (!(await scanOption.getAttribute('class'))?.includes('pf-ls__gate-opt--on')) {
      await scanOption.click();
      await expect(page.getByText(/scan mode.*qr\/barcode scanner shown/i)).toBeVisible({ timeout: 10_000 });
    }

    // Flip to Manual — assert the toast, the pressed state, AND that it
    // survives a full reload (i.e. it's actually persisted server-side, not
    // just an optimistic local signal).
    await manualOption.click();
    await expect(page.getByText(/manual entry.*scanner hidden/i)).toBeVisible({ timeout: 10_000 });
    await expect(manualOption).toHaveClass(/pf-ls__gate-opt--on/);

    await page.reload();
    await expect(page.getByRole('heading', { name: /lab settings/i, level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /manual entry/i })).toHaveClass(/pf-ls__gate-opt--on/);

    // Restore — leave the tenant exactly as this test found it.
    await page.getByRole('button', { name: /^scan \(qr \/ barcode\)/i }).click();
    await expect(page.getByText(/scan mode.*qr\/barcode scanner shown/i)).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await expect(page.getByRole('heading', { name: /lab settings/i, level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /^scan \(qr \/ barcode\)/i })).toHaveClass(/pf-ls__gate-opt--on/);
  });
});
