import { test, expect } from '@playwright/test';

/**
 * LMS UI — unauthenticated smoke. No backend, no seeded data required: proves
 * the app boots and the login surface renders. The UI analog of the mw
 * backend's "NoAuth_Returns401" matrix and the first layer of the E2E net.
 *
 * Authenticated flows (register patient → order → collect → result → report)
 * live in *.authed.spec.ts and require the mw backend on :5270 + a seeded test
 * organization/user — see apps/lms-e2e/README.md.
 */

test.describe('LMS login surface (unauthenticated)', () => {
  test('app boots and shows the Sign in form', async ({ page }) => {
    await page.goto('/');
    // Guard sends an unauthenticated visitor to the login screen.
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /username/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
  });

  test('shows the organization + password fields and lockout hint', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/organization/i).first()).toBeVisible();
    await expect(page.getByText(/password/i).first()).toBeVisible();
    await expect(page.getByText(/locked out/i)).toBeVisible();
  });

  test('carries the Prefrontal brand', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/prefrontal/i).first()).toBeVisible();
  });
});
