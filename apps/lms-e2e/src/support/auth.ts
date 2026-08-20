import { test, type Page } from '@playwright/test';

/**
 * LMS auth helper. Unlike Cortex (Google OAuth), the LMS login is
 * organization + username + password, so it IS automatable — no captured
 * session needed. Creds come from env so nothing secret lives in the repo:
 *   E2E_ORG, E2E_USERNAME, E2E_PASSWORD
 * pointing at a SEEDED TEST organization on the mw backend (:5270). Never use
 * real patient-facing credentials.
 */

export const creds = () => ({
  org: process.env.E2E_ORG ?? '',
  username: process.env.E2E_USERNAME ?? '',
  password: process.env.E2E_PASSWORD ?? '',
});

export const hasCreds = (): boolean => {
  const c = creds();
  return !!(c.org && c.username && c.password);
};

/** Skip an authed spec (with a clear reason) when creds/backend aren't wired. */
export function requireCreds(): void {
  test.skip(!hasCreds(), 'No E2E creds — set E2E_ORG/E2E_USERNAME/E2E_PASSWORD + run mw on :5270 (see apps/lms-e2e/README.md).');
}

/** Drive the real login form and wait until the app leaves /login. */
export async function login(page: Page): Promise<void> {
  const c = creds();
  await page.goto('/login');
  await page.getByPlaceholder(/your organization name/i).fill(c.org);
  await page.getByPlaceholder(/your username/i).fill(c.username);
  await page.getByPlaceholder('••••••••').fill(c.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  // Landed inside the app (guard no longer bounces to /login).
  await page.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 15_000 });
}
