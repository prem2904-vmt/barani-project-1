import { test, expect, type Browser, type Page } from '@playwright/test';
import { STACK, api, jwt, openAs, prepareContext, shot, expectNoVisibleAiText, expectNothingBlocked } from '../support/local-stack';

/**
 * First login with a temporary password (local stack, playwright.local.config.ts):
 * an admin resets a colleague's password → the colleague signs in → the
 * set-password screen (sign-in look, inline validation) → home, never back.
 * Also the restored-session case: a reload before the password is replaced
 * lands on /set-password, not in an app whose every call answers 403.
 *
 * The password grant itself is Supabase (unreachable here by design), so ONLY
 * POST /api/auth/login is answered in the browser with the colleague's local
 * test token + the server's own `mustChangePassword`; /me, change-password and
 * everything after are the real local mw.
 */
test.describe.configure({ mode: 'serial' });

const ADMIN = STACK.admin;
const ASHA = STACK.colleague;
const NEW_PASSWORD = `Local-e2e-${Date.now()}-pw`;
let ashaId = '';

interface UserRow { id: string; authId?: string; firstName?: string }

async function resetAshaToTemporary(): Promise<void> {
  if (!ashaId) {
    const rows = await api<UserRow[] | { items: UserRow[] }>(ADMIN, 'GET', '/api/users?search=Asha');
    const list = Array.isArray(rows) ? rows : rows.items;
    ashaId = list.find(u => u.authId === ASHA.authId)?.id ?? list.find(u => u.firstName === 'Asha')?.id ?? '';
    expect(ashaId, 'the seeded colleague').not.toBe('');
  }
  await api(ADMIN, 'POST', `/api/users/${ashaId}/reset-password`, { newPassword: 'Temp-pass-1234' });
}

async function signInWithTemporaryPassword(browser: Browser, viewport = { width: 1440, height: 900 }): Promise<Page> {
  const ctx = await browser.newContext({ viewport });
  await prepareContext(ctx, ASHA);
  // Start signed out (prepareContext seeds a session for the other specs).
  await ctx.addInitScript(() => {
    if (!sessionStorage.getItem('pf.e2e.signedOut')) {
      sessionStorage.setItem('pf.e2e.signedOut', '1');
      localStorage.removeItem('pf.session');
    }
  });
  await ctx.route('**/api/auth/login', async r => {
    const me = await api<{ mustChangePassword?: boolean; tenantId: string; tenantName: string }>(ASHA, 'GET', '/api/auth/me');
    await r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: {
        accessToken: jwt(ASHA.authId), refreshToken: `rt-${ASHA.authId}`,
        mustChangePassword: me.mustChangePassword === true,
        tenant: { id: me.tenantId, name: me.tenantName },
      } }),
    });
  });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.locator('#lg-org').fill('Micro World');
  await page.locator('#lg-username').fill('asha');
  await page.locator('#lg-password').fill('Temp-pass-1234');
  await page.locator('#lg-password').press('Enter');
  return page;
}

test.afterAll(async () => {
  // Never leave the shared colleague owing a password change.
  try { await api(ASHA, 'POST', '/api/auth/change-password', { newPassword: NEW_PASSWORD }); } catch { /* already set */ }
});

test('temporary password → set-password screen → validation → home, never back', async ({ browser }) => {
  await resetAshaToTemporary();
  const page = await signInWithTemporaryPassword(browser);
  await expect(page).toHaveURL(/\/set-password/, { timeout: 30_000 });

  // The sign-in screen's shell + card, not the app shell.
  await expect(page.locator('.lg .lg__card')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await expect(page.locator('nav, pf-bottom-nav, pf-top-strip')).toHaveCount(0);
  await expect(page.locator('#sp-new-pw')).toHaveAttribute('autocomplete', 'new-password');
  await expect(page.locator('#sp-confirm-pw')).toHaveAttribute('autocomplete', 'new-password');
  await expectNoVisibleAiText(page);
  await shot(page, 'first-login-1-set-password');

  // Too short / mismatch: inline, and submitting says why (no silent no-op).
  await page.locator('#sp-new-pw').fill('short');
  await expect(page.getByText('At least 8 characters.')).toBeVisible();
  await page.locator('#sp-confirm-pw').fill('shortx');
  await expect(page.getByText('The two passwords don’t match yet.')).toBeVisible();
  await page.locator('#sp-confirm-pw').press('Enter');
  await expect(page.getByRole('alert')).toHaveText(/8–64 characters/);
  await expect(page).toHaveURL(/\/set-password/);

  // Show / hide.
  await page.getByRole('button', { name: 'Show password' }).first().click();
  await expect(page.locator('#sp-new-pw')).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).first().click();
  await expect(page.locator('#sp-new-pw')).toHaveAttribute('type', 'password');

  // A good pair → saved on the server → home.
  await page.locator('#sp-new-pw').fill(NEW_PASSWORD);
  await page.locator('#sp-confirm-pw').fill(NEW_PASSWORD);
  const [resp] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/api/auth/change-password') && r.request().method() === 'POST'),
    page.getByRole('button', { name: /Save and continue/ }).click(),
  ]);
  expect(resp.ok()).toBe(true);
  await expect(page).not.toHaveURL(/\/(set-password|login)/, { timeout: 30_000 });
  expect((await api<{ mustChangePassword?: boolean }>(ASHA, 'GET', '/api/auth/me')).mustChangePassword).not.toBe(true);
  await shot(page, 'first-login-2-home');

  // Never back: a reload and a direct visit both stay out of set-password.
  await page.reload();
  await expect(page).not.toHaveURL(/\/set-password/, { timeout: 20_000 });
  await page.goto('/set-password');
  await expect(page).not.toHaveURL(/\/set-password/, { timeout: 20_000 });
  await page.context().close();
});

test('a reload before the password is replaced comes back to set-password (restored session)', async ({ browser }) => {
  await resetAshaToTemporary();
  // A stored session + cached profile, as after a reload / reopened app.
  const { page } = await openAs(browser, ASHA, '/', { viewport: { width: 390, height: 844 } });
  await expect(page).toHaveURL(/\/set-password/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  // Phone: no sideways scroll.
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw).toBeLessThanOrEqual(cw);
  await shot(page, 'first-login-3-restored-phone');

  // Reload again: now booted from the CACHED profile (the guard lets the
  // app through before /me answers) — the gate still brings it back.
  await page.goto('/frontdesk');
  await expect(page).toHaveURL(/\/set-password/, { timeout: 30_000 });

  await page.locator('#sp-new-pw').fill(NEW_PASSWORD);
  await page.locator('#sp-confirm-pw').fill(NEW_PASSWORD);
  await page.locator('#sp-confirm-pw').press('Enter');
  await expect(page).not.toHaveURL(/\/(set-password|login)/, { timeout: 30_000 });
  await page.context().close();
  expectNothingBlocked();
});
