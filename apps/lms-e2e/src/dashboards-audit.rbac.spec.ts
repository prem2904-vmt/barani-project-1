import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * DASHBOARDS / AUDIT-LOG GATING — who can reach the TAT/ops dashboard and the
 * audit trail.
 *
 * Ground truth is apps/lms/src/app/app.routes.ts (route `canActivate` guards),
 * cross-checked against prefrontal-mw's Prefrontal/Seed/RoleSeeder.cs:
 *   - view_dashboard + view_tat_dashboard → Branch Manager, Lab Admin (also
 *     Inventory Manager, not a seeded/testable role here).
 *   - view_audit_log → Branch Manager, Lab Admin.
 * So manager + admin should reach both screens; labTech, sampleCollector and
 * pathologist hold neither permission and must be blocked.
 *
 * ⚠ ROUTE-SHAPE NOTE: there is only ONE dashboard route, not separate
 * "dashboard" + "tat" routes as the task brief assumed. `/dashboard` is
 * gated by `permissionGuard(['view_tat_dashboard', 'view_dashboard'])` +
 * `moduleGuard('reports')` and renders TatBoardComponent (h1 "TAT Board") —
 * it IS the TAT board; `view_dashboard` and `view_tat_dashboard` are just two
 * alternate ways to unlock the same single screen. There is no separate
 * `/tat` path. The audit trail is `/admin/audit`, gated by
 * `permissionGuard('view_audit_log')`, rendering AuditLogComponent
 * (h1 "Audit trail").
 *
 * `permissionGuard(...)` (core/auth/permission.guard.ts) redirects a user
 * lacking every listed permission to `/403`, which renders the "Forbidden"
 * placeholder screen (features/shared/placeholder.component.ts) — same block
 * signature used across the other RBAC specs (see admin-settings.rbac.spec.ts).
 *
 * Seeded roles (apps/lms-e2e/src/support/auth.ts → ROLE_CREDS) map to mw
 * roles as: labTech→"Lab Technician", pathologist→"Pathologist",
 * sampleCollector→"Sample Collector", manager→"Branch Manager",
 * admin→"Lab Admin".
 *
 * Nav-entry check: neither `/dashboard` nor `/admin/audit` has a dedicated
 * top-strip/bottom-nav entry in this build — both are defined in MORE_NAV
 * (layout/nav-items.ts, ids 'tat'/'audit') but that list is only ever
 * *computed*, never rendered by top-strip.component.html or
 * bottom-nav.component.html (grepped both templates — no reference). The
 * only live links to these routes are content tiles inside the already-
 * admin-gated /admin and /admin/manage screens (admin-overview.component.ts
 * routerLink="/dashboard"; admin-dashboard.component.ts tile href
 * "/admin/audit"). Since labTech/sampleCollector/pathologist can never reach
 * /admin at all (adminGuard, covered by admin-settings.rbac.spec.ts), "nav
 * entry absent" for those roles is asserted the meaningful way: no link to
 * either route exists anywhere on the page they actually land on after login.
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
  await expect(page).toHaveURL(new RegExp(path.replace(/\//g, '\\/') + '$'));
  await expect(page.getByRole('heading', { name: headingName, level: 1 })).toBeVisible({ timeout: 15_000 });
}

async function expectNoLinksTo(page: Page, paths: string[]) {
  for (const path of paths) {
    await expect(page.locator(`a[href="${path}"]`)).toHaveCount(0);
  }
}

test.describe('Dashboards/Audit-log RBAC gating', () => {
  test('admin (Lab Admin): reaches the TAT dashboard and the audit trail', async ({ page }) => {
    await loginAs(page, 'admin');
    await expectAllowed(page, '/dashboard', /tat board/i);
    await expectAllowed(page, '/admin/audit', /audit trail/i);
  });

  test('manager (Branch Manager): reaches the TAT dashboard and the audit trail', async ({ page }) => {
    await loginAs(page, 'manager');
    await expectAllowed(page, '/dashboard', /tat board/i);
    await expectAllowed(page, '/admin/audit', /audit trail/i);
  });

  for (const role of ['labTech', 'sampleCollector', 'pathologist'] as const) {
    test(`${role}: blocked from the TAT dashboard and the audit trail + no nav entry to either`, async ({ page }) => {
      await loginAs(page, role);

      // No link to either gated screen anywhere on the page this role
      // actually lands on (their own landing route — labTech/sampleCollector
      // → their work areas, pathologist → /pathologist).
      await expectNoLinksTo(page, ['/dashboard', '/admin/audit']);

      await expectBlocked(page, '/dashboard');
      await expectBlocked(page, '/admin/audit');
    });
  }
});
