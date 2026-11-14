import type { Page } from '@playwright/test';
import { test, expect } from './support/form-factor';
import { resetNeg, installNegBackend, go, visible, type StorageMode } from './support/neg-backend';

/**
 * NEGATIVE scenarios, the Start menu hint and a browser whose storage fails (private window, full disk, blocked
 * site data), 2026-11-14: the app still loads, the hint can be dismissed for the session and nothing crashes.
 * API mocked, demo data only.
 */
const deskReady = (page: Page) => page.locator('pf-patient-search').or(page.locator('[aria-label="Completed"]')).locator('visible=true').first();
const hint = (page: Page) => page.locator('[data-start-hint]').locator('visible=true');

async function boot(page: Page, context: import('@playwright/test').BrowserContext, storage: StorageMode) {
  resetNeg();
  await installNegBackend(page, context, { storage, seedHintSeen: false });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await go(page, '/frontdesk');
  await expect(deskReady(page)).toBeVisible({ timeout: 60_000 });
  return errors;
}

test.beforeEach(() => { test.setTimeout(150_000); });

test.describe('neg-storage: Start menu hint', () => {
  test('"Got it" hides the hint, and it stays hidden after a reload', async ({ page, context }) => {
    const errors = await boot(page, context, 'normal');
    await expect(hint(page)).toBeVisible({ timeout: 20_000 });
    await visible(page, '[data-start-hint] button').click();
    await expect(hint(page)).toHaveCount(0);
    await page.reload();
    await expect(deskReady(page)).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    await expect(hint(page)).toHaveCount(0);
    // Safari (WebKit) reports the requests a reload cancels mid-flight as "Fetch API cannot load … due to access
    // control checks" (every API call here is answered by the mock — it's the reload, not CORS). Only those are ignored.
    expect(errors.filter(e => !/due to access control checks\.$/.test(e)), 'no uncaught errors').toEqual([]);
  });

  test('storage cannot be written (private window / full disk): the app loads and the hint can still be dismissed for the session', async ({ page, context }) => {
    const errors = await boot(page, context, 'write-throws');
    await expect(hint(page)).toBeVisible({ timeout: 20_000 });
    await visible(page, '[data-start-hint] button').click();
    await expect(hint(page)).toHaveCount(0);
    // Still gone a moment later (no re-render brings it back within the session).
    await page.waitForTimeout(1500);
    await expect(hint(page)).toHaveCount(0);
    expect(errors, 'no uncaught errors').toEqual([]);
  });

  test('storage cannot even be read: the app does not crash (the hint, if shown, can be dismissed)', async ({ page, context }) => {
    resetNeg();
    await installNegBackend(page, context, { storage: 'all-throws', seedHintSeen: false });
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await go(page, '/frontdesk');
    // Either the front desk or the sign-in page is shown — a working screen, never a blank page.
    await expect.poll(async () => (await page.locator('body').innerText()).trim().length, { timeout: 60_000 }).toBeGreaterThan(20);
    if (await hint(page).count()) {
      await visible(page, '[data-start-hint] button').click();
      await expect(hint(page)).toHaveCount(0);
    }
    expect(errors, 'no uncaught errors').toEqual([]);
  });
});
