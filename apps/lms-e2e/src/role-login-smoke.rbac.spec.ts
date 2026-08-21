import { test, expect } from '@playwright/test';
import { loginAs, ROLE_CREDS, type RoleKey } from './support/auth';

/**
 * Sanity: every seeded/e2e role signs in through the REAL UI login form and
 * lands inside the app (guard no longer bounces to /login). This is the
 * gate for the whole multi-role campaign — if a role can't log in, its
 * coverage is meaningless.
 */
const ALL_ROLES = Object.keys(ROLE_CREDS) as RoleKey[];

for (const role of ALL_ROLES) {
  test(`role ${role} (${ROLE_CREDS[role].role}) logs in via the UI`, async ({ page }) => {
    await loginAs(page, role);
    await expect(page).not.toHaveURL(/\/login/);
  });
}
