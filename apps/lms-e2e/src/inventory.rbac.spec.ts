import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * INVENTORY RBAC gating — who can reach the two Inventory routes:
 *   - /admin/inventory  (admin catalogue/config screen)
 *   - /stores           (operator work area — receive/issue/count)
 *
 * Ground truth is apps/lms/src/app/app.routes.ts, cross-checked live against
 * prefrontal-mw (:5270) for this seeded tenant ("Micro World"):
 *
 *   { path: 'admin/inventory', canActivate: [permissionGuard('manage_inventory'), moduleGuard('inventory')] }
 *   { path: 'stores',          canActivate: [permissionGuard(['inventory_receive','inventory_issue','inventory_count','manage_inventory']), moduleGuard('inventory')] }
 *
 * Two independent gates stack on both routes:
 *   1. permissionGuard — redirects to /403 when the user lacks every listed
 *      permission code. Per RoleSeeder.cs, among the 5 authenticatable seeded
 *      roles ONLY "Lab Admin" (our `admin`) holds any inventory_* permission
 *      (manage_inventory) — labTech, sampleCollector, pathologist and manager
 *      hold none, so they're blocked here, full stop.
 *   2. moduleGuard('inventory') — redirects to '/' when the tenant's
 *      INVENTORY MODULE (TenantEntitlementsService, GET /api/tenants/modules)
 *      is off. Confirmed live for Micro World: modulesJson has
 *      `"inventory":{"enabled":true,...}` — the module IS ON for this tenant,
 *      so this gate does not block anyone here; permissionGuard is the sole
 *      discriminator between roles.
 *
 * NOTE — a THIRD, separate switch exists and is OFF for this tenant/branch:
 * BranchLabConfig.inventoryEnabled (GET /api/tenants/branch-lab-config)
 * confirmed `"inventoryEnabled": false` for Micro World's branch. That flag
 * only gates the Stores NAV LINK's visibility (nav-items.ts `requiresInventory`,
 * read by top-strip/bottom-nav via BranchLabConfigService.inventoryEnabled) —
 * it is NOT wired into either route's canActivate guards, and neither
 * InventoryComponent nor StoresComponent self-check it. So the nav entry is
 * absent for every role (including admin) on this tenant, but DIRECT
 * navigation to the URL is governed purely by permissionGuard + the tenant
 * module flag above. This spec therefore asserts direct-URL access (the
 * actual security boundary), not nav-link presence, and documents the no-nav
 * finding separately without treating it as a block.
 *
 * Expected matrix (this tenant):
 *   admin            → /admin/inventory ALLOWED, /stores ALLOWED
 *   labTech          → both BLOCKED (/403)
 *   sampleCollector  → both BLOCKED (/403)
 *   pathologist      → both BLOCKED (/403)
 *   manager          → both BLOCKED (/403)
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
  // Give the guard + lazy chunk a moment, then confirm we were NOT bounced
  // (neither to /403 by permissionGuard, nor to / by moduleGuard).
  await expect(page).toHaveURL(new RegExp(path.replace(/\//g, '\\/') + '$'));
  await expect(page.getByRole('heading', { name: headingName, level: 1 })).toBeVisible({ timeout: 15_000 });
}

/** Neither the top-strip icon (xl+) nor the bottom-nav tab render a Stores
 *  entry on this tenant — BranchLabConfig.inventoryEnabled is false for
 *  Micro World's branch (a nav-visibility gate, independent of the route
 *  guards). True for every role, including admin. */
async function expectNoStoresNavEntry(page: Page) {
  await expect(page.locator('a[href="/stores"]')).toHaveCount(0);
}

test.describe('Inventory RBAC gating', () => {
  test('admin (Lab Admin): reaches both inventory routes directly (nav link absent — branch config off)', async ({ page }) => {
    await loginAs(page, 'admin');

    await expectAllowed(page, '/admin/inventory', /^inventory$/i);
    await expectAllowed(page, '/stores', /inventory desk/i);

    // Documents the module-vs-nav distinction: module is ON (route access
    // works), but the Stores nav link is still absent because the separate
    // branch-level inventoryEnabled switch is off for this tenant.
    await expectNoStoresNavEntry(page);
  });

  for (const role of ['labTech', 'pathologist', 'sampleCollector', 'manager'] as const) {
    test(`${role}: blocked from both inventory routes + no Stores nav entry`, async ({ page }) => {
      await loginAs(page, role);

      await expectBlocked(page, '/admin/inventory');
      await expectBlocked(page, '/stores');

      await expectNoStoresNavEntry(page);
    });
  }
});
