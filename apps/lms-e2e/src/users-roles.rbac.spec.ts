import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * USERS & ROLES ADMIN — create users, edit role permissions, create roles —
 * AND the permission gate around those screens.
 *
 * Ground truth:
 *  - UI: apps/lms/src/app/features/admin/users-access/
 *        (users-access.component.ts, user-invite.component.ts,
 *         role-editor.component.ts)
 *  - Routes: apps/lms/src/app/app.routes.ts — /admin/users, /admin/users/invite,
 *    /admin/users/:id/edit, /admin/roles/new, /admin/roles/:id/edit are ALL
 *    gated by a single permissionGuard('manage_users') (no OR-fallback like
 *    lab-settings/billing have — see admin-settings.rbac.spec.ts header).
 *  - Backend: prefrontal-mw Controllers/UsersController.cs + RolesController.cs,
 *    both class-level [RequirePermission("manage_users")]. Per RoleSeeder.cs
 *    only "Lab Admin" (our 'admin' seeded role) holds manage_users — Lab
 *    Technician, Pathologist, Sample Collector and Branch Manager hold none of
 *    it, so they're all blocked here (no manage_branches fallback exists for
 *    these two routes, unlike lab-settings/billing).
 *  - "Create user" is username + password ONLY (synthetic AuthEmail minted
 *    server-side) — no email is collected. Role permissions all live under a
 *    single "lms" module (PermissionSeeder.cs), so the role editor renders one
 *    permission group.
 *
 * Roles created by this spec are NEW throwaway roles (unique per-run name) —
 * we never touch a seeded role's permissions, since other RBAC specs depend
 * on the seeded role→permission matrix (RoleSeeder.cs).
 *
 * WRITES ARE OPT-IN (E2E_ALLOW_WRITES=1, LOCAL backend + DB only). The two
 * functional tests create a user and a role and there is no role delete
 * endpoint (RolesController.cs), so every run against the shared dev backend
 * (the default `lms:serve` apiUrl) left an "E2E Throwaway Role <ts>" and an
 * "e2euser<ts>" in the Micro World tenant — they showed up in Users & Roles
 * (4 of each on dev, 2026-08-21; cleanup SQL in the RBAC audit). The read-only
 * permission-gate tests below always run.
 */
const ALLOW_WRITES = process.env['E2E_ALLOW_WRITES'] === '1';

const FORBIDDEN_HEADING = /forbidden/i;

async function expectBlocked(page: Page, path: string) {
  await page.goto(path);
  await page.waitForURL(/\/403$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: FORBIDDEN_HEADING })).toBeVisible();
}

/** Locate the permission row (label.perm-row) whose mono code text matches
 *  exactly — the code span is unique per permission (unlike the human name,
 *  which can be ambiguous to match against). */
function permRow(page: Page, code: string) {
  return page.locator('label.perm-row').filter({ has: page.getByText(code, { exact: true }) });
}

test.describe('Users & Roles admin — functional (as admin)', () => {
  test.skip(!ALLOW_WRITES, 'Creates users/roles that cannot be deleted — run only against a LOCAL backend+DB with E2E_ALLOW_WRITES=1.');
  test('creates a new user (username + password + role) — POST succeeds and it appears in the user list', async ({ page }) => {
    await loginAs(page, 'admin');

    await page.goto('/admin/users?tab=users');
    await expect(page.getByRole('heading', { name: /users\s*&\s*access/i, level: 1 })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /^create user$/i }).click();
    await expect(page).toHaveURL(/\/admin\/users\/invite$/);
    await expect(page.getByRole('heading', { name: /create user/i, level: 1 })).toBeVisible({ timeout: 15_000 });

    const username = `e2euser${Date.now()}`;
    const password = 'E2ePass1234';

    await page.getByPlaceholder('e.g. drpriya').fill(username);
    await page.getByPlaceholder('Minimum 8 characters').fill(password);

    // Any one role is enough to satisfy "a role" — pick whichever the tenant
    // has seeded first; the assertion is about the user being created and
    // persisted, not about which specific role it holds.
    const firstRoleChip = page.locator('label.pf-role-chip').first();
    await expect(firstRoleChip).toBeVisible({ timeout: 15_000 });
    await firstRoleChip.locator('input[type="checkbox"]').check();

    const createBtn = page.getByRole('button', { name: /^create user$/i });
    await expect(createBtn).toBeEnabled();

    const createResponse = page.waitForResponse(
      r => r.url().includes('/api/users') && r.request().method() === 'POST',
      { timeout: 15_000 }
    );
    await createBtn.click();
    const resp = await createResponse;
    expect(resp.ok(), 'POST /api/users must succeed').toBe(true);
    const body = await resp.json();
    expect(body.success, `expected success:true, got ${JSON.stringify(body)}`).toBe(true);
    expect(body.data?.username).toBe(username);

    // Lands back on the users list.
    await expect(page).toHaveURL(/\/admin(\/users)?\?(.*&)?(tab=users|section=people)/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /users\s*&\s*access/i, level: 1 })).toBeVisible({ timeout: 15_000 });

    // Real persistence check: search + reload, not just the optimistic toast.
    await page.getByPlaceholder(/search name or username/i).fill(username);
    await expect(page.getByText(username, { exact: false }).first()).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(page.getByRole('heading', { name: /users\s*&\s*access/i, level: 1 })).toBeVisible({ timeout: 15_000 });
    await page.getByPlaceholder(/search name or username/i).fill(username);
    await expect(page.getByText(username, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('creates a new throwaway role with a permission set, then toggles a permission on/off on that SAME role — persisted across reload', async ({ page }) => {
    await loginAs(page, 'admin');

    // ── Step A: create a new role with a chosen permission set ──────────
    await page.goto('/admin/roles/new');
    await expect(page.getByRole('heading', { name: /create role/i, level: 1 })).toBeVisible({ timeout: 15_000 });

    const roleName = `E2E Throwaway Role ${Date.now()}`;
    await page.getByPlaceholder('e.g. Billing Supervisor').fill(roleName);

    // Grant two harmless, view-only permissions to start.
    await permRow(page, 'view_dashboard').locator('input[type="checkbox"]').check();
    await permRow(page, 'view_report').locator('input[type="checkbox"]').check();

    const createRoleResponse = page.waitForResponse(
      r => r.url().includes('/api/roles') && r.request().method() === 'POST',
      { timeout: 15_000 }
    );
    await page.getByRole('button', { name: /^save$/i }).click();
    const createResp = await createRoleResponse;
    expect(createResp.ok(), 'POST /api/roles/ must succeed').toBe(true);
    const createBody = await createResp.json();
    expect(createBody.success, `expected success:true, got ${JSON.stringify(createBody)}`).toBe(true);
    const roleId: string = createBody.data.id;
    expect(roleId).toBeTruthy();
    expect(createBody.data.name).toBe(roleName);

    // Lands back on the roles list.
    await expect(page).toHaveURL(/\/admin(\/users)?\?(.*&)?(tab=roles|section=people)/, { timeout: 15_000 });

    // ── Step B: open that SAME (throwaway, non-seeded) role and toggle ──
    await page.goto(`/admin/roles/${roleId}/edit`);
    await expect(page.getByRole('heading', { name: new RegExp(`permissions.*${roleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), level: 1 })).toBeVisible({ timeout: 15_000 });

    // Confirm the permissions we granted on create are actually reflected.
    await expect(permRow(page, 'view_dashboard').locator('input[type="checkbox"]')).toBeChecked();
    await expect(permRow(page, 'view_report').locator('input[type="checkbox"]')).toBeChecked();
    await expect(permRow(page, 'view_audit_log').locator('input[type="checkbox"]')).not.toBeChecked();

    // Toggle: turn a new one ON (view_audit_log), turn an existing one OFF (view_report).
    await permRow(page, 'view_audit_log').locator('input[type="checkbox"]').check();
    await permRow(page, 'view_report').locator('input[type="checkbox"]').uncheck();

    const patchResponse = page.waitForResponse(
      r => r.url().includes(`/api/roles/${roleId}/permissions`) && r.request().method() === 'PATCH',
      { timeout: 15_000 }
    );
    await page.getByRole('button', { name: /^save$/i }).click();
    const patchResp = await patchResponse;
    expect(patchResp.ok(), 'PATCH /api/roles/:id/permissions must succeed').toBe(true);
    const patchBody = await patchResp.json();
    expect(patchBody.success, `expected success:true, got ${JSON.stringify(patchBody)}`).toBe(true);

    // Lands back on the roles list.
    await expect(page).toHaveURL(/\/admin(\/users)?\?(.*&)?(tab=roles|section=people)/, { timeout: 15_000 });

    // ── Step C: reload the SAME edit page — real server-side persistence ─
    await page.goto(`/admin/roles/${roleId}/edit`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });

    await expect(permRow(page, 'view_dashboard').locator('input[type="checkbox"]')).toBeChecked();
    await expect(permRow(page, 'view_audit_log').locator('input[type="checkbox"]')).toBeChecked();
    await expect(permRow(page, 'view_report').locator('input[type="checkbox"]')).not.toBeChecked();

    // This is a brand-new throwaway role (isPreSeeded: false, unique name),
    // never a seeded one — no restoration needed; the seeded role→permission
    // matrix other RBAC specs depend on was never touched.
  });
});

test.describe('Users & Roles admin — permission gate', () => {
  for (const role of ['labTech', 'manager'] as const) {
    test(`${role}: blocked from /admin/users and /admin/roles/new (→ /403) — lacks manage_users`, async ({ page }) => {
      await loginAs(page, role);

      await expectBlocked(page, '/admin/users');
      await expectBlocked(page, '/admin/roles/new');
    });
  }

  test('admin (Lab Admin): reaches both /admin/users and /admin/roles/new', async ({ page }) => {
    await loginAs(page, 'admin');

    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: /users\s*&\s*access/i, level: 1 })).toBeVisible({ timeout: 15_000 });

    await page.goto('/admin/roles/new');
    await expect(page.getByRole('heading', { name: /create role/i, level: 1 })).toBeVisible({ timeout: 15_000 });
  });
});
