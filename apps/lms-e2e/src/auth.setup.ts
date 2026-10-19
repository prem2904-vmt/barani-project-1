import { test as setup, expect } from '@playwright/test';
import { creds, hasCreds } from './support/auth';

const STORAGE = 'apps/lms-e2e/.auth/user.json';

/**
 * One-time login → saves the app's logged-in localStorage (multi-account
 * registry) to storageState so authed specs start signed in. Credentials come
 * from env (the seeded Micro World demo staff for local runs):
 *   E2E_ORG='Micro World' E2E_USERNAME='labadmin@apollo.prefrontal' E2E_PASSWORD='LabAdmin@123'
 * Requires the mw backend on :5270.
 */
setup('authenticate', async ({ page }) => {
  setup.skip(!hasCreds(), 'No E2E creds set — export E2E_ORG/E2E_USERNAME/E2E_PASSWORD.');
  const c = creds();

  await page.goto('/login');
  await page.getByPlaceholder(/your organization name/i).fill(c.org);
  await page.getByPlaceholder(/your username/i).fill(c.username);
  await page.getByPlaceholder('••••••••').fill(c.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();

  // Landed inside the app (guard no longer bounces to /login).
  await page.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 20_000 });
  await expect(page).not.toHaveURL(/\/login/);

  await page.context().storageState({ path: STORAGE });
});
