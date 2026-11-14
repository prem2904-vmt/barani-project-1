import type { Page } from '@playwright/test';
import { test, expect, routeOf } from './support/form-factor';
import { deskTab } from './support/frontdesk';
import {
  neg, resetNeg, installNegBackend, openDesk, visible, toast, dueBill, serverError,
} from './support/neg-backend';

/**
 * NEGATIVE scenarios, front desk and lab result entry (2026-11-14):
 *   a referral change that fails to save · a Payments-due order that no longer exists · a result that fails to save.
 * Nothing may pretend it worked, the screen keeps working, the old value stays. API mocked, demo data only.
 */
const NO_TECH_SPEAK = /Http failure|HttpErrorResponse|Unknown Error|\b50[0-9] |status code/i;
const errorToast = (page: Page) => page.locator('.toast-item:has(.toast-icon[data-level="error"])').locator('visible=true');

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(150_000);
  resetNeg();
  await installNegBackend(page, context);
});

// ───────────────────────── front desk ─────────────────────────
async function openReferralDialog(page: Page) {
  await openDesk(page, 'Rekha Menon');
  await page.getByText('Rekha Menon').locator('visible=true').first().click();
  await expect(page.locator('.pf-drawer__meta')).toContainText('Dr. Rao', { timeout: 20_000 });
  await page.locator('[data-test=drawer-edit-referral]').click();
  const dlg = page.getByRole('dialog', { name: /Edit referral/ });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByText('Booked as')).toBeVisible({ timeout: 20_000 });
  // Change the referral source (a real change, so Save is allowed).
  await dlg.locator('#pf-erd-source button[aria-haspopup="listbox"]').click();
  await page.locator('[role="listbox"]').getByRole('option', { name: 'Hospital', exact: true }).first().click();
  const save = dlg.getByRole('button', { name: 'Save referral' });
  await expect(save).toBeEnabled();
  return { dlg, save };
}

test.describe('neg-desk-lab: front desk', () => {
  test('Changing the referral fails to save (500 with a reason): the reason is shown in the dialog, the old referral stays, nothing says "updated"', async ({ page }) => {
    neg.hook = r => r.method === 'PATCH' && /\/referral$/.test(r.path) ? serverError(500, 'The order is locked by another user') : undefined;
    const { dlg, save } = await openReferralDialog(page);
    await save.click();
    await expect(dlg.getByRole('alert')).toContainText('The order is locked by another user', { timeout: 10_000 });
    await expect(page.getByText('Referral updated')).toHaveCount(0);
    await expect(save).toBeEnabled();                       // can retry
    expect(neg.calls.filter(c => c.method === 'PATCH' && /\/referral$/.test(c.path))).toHaveLength(1);
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(dlg).toHaveCount(0);
    await expect(page.locator('.pf-drawer__meta')).toContainText('Dr. Rao');      // the old value is kept
    await expect(page.locator('.pf-drawer__meta')).not.toContainText('Dr. Rao Jr');
  });

  test('Changing the referral fails with no explanation (500, empty body): plain words in the dialog, no technical text', async ({ page }) => {
    neg.hook = r => r.method === 'PATCH' && /\/referral$/.test(r.path) ? serverError(500) : undefined;
    const { dlg, save } = await openReferralDialog(page);
    await save.click();
    const err = dlg.getByRole('alert');
    await expect(err).toBeVisible({ timeout: 10_000 });
    expect(await err.innerText()).not.toMatch(NO_TECH_SPEAK);
    await expect(err).toContainText(/try again/i);
    await expect(page.getByText('Referral updated')).toHaveCount(0);
    await expect(save).toBeEnabled();
  });

  test('Payments due lists an order the server cannot find (404 on the order read): the list still shows the other dues and nothing crashes', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    neg.bills = [dueBill('od', 100), dueBill('gone', 150)];
    neg.hook = r => r.method === 'GET' && r.path === '/api/orders/gone'
      ? { status: 404, body: { success: false, error: 'not_found', message: 'Order not found' } } : undefined;
    await openDesk(page, 'Noor Khan');
    await deskTab(page, 'Payments due');
    await expect(page.getByText('Anitha Raj').locator('visible=true').first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    await expect(page.getByText('Anitha Raj').locator('visible=true').first()).toBeVisible();
    await expect(errorToast(page)).toHaveCount(0);
    await expect(page.getByText(NO_TECH_SPEAK)).toHaveCount(0);
    expect(errors, 'no uncaught errors').toEqual([]);
  });
});

// ───────────────────────── lab result entry ─────────────────────────
const field = (page: Page) => page.locator('[data-sre-field="ot1::f"]').locator('visible=true').first();
const DRAFT = '/api/samples/smp-1/results/draft';
const SUBMIT = '/api/samples/smp-1/results';
const isSample = (page: Page) => /\/lab\/sample\/smp-1/.test(routeOf(page.url()));

async function typeResult(page: Page) {
  await page.goto('/lab/sample/smp-1');
  await expect(field(page)).toBeVisible({ timeout: 60_000 });
  await field(page).fill('Positive');
  await expect(page.locator('.pf-sre__flag-chip').locator('visible=true').first()).toHaveText('Abnormal');
}
const saveDraft = (page: Page) => page.locator('button[aria-label="Save draft"]').locator('visible=true').first();

test.describe('neg-desk-lab: lab result entry', () => {
  test('Save draft fails (500 with a reason): an error toast, no "Draft saved", the person stays on the tube with the typed value', async ({ page }) => {
    neg.hook = r => r.method === 'POST' && r.path === DRAFT ? serverError(500, 'The result could not be stored') : undefined;
    await typeResult(page);
    await saveDraft(page).click();
    await expect(toast(page, 'The result could not be stored')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Draft saved')).toHaveCount(0);
    await page.waitForTimeout(1200);                        // the success path would have left for My work by now
    expect(isSample(page), 'still on the result entry').toBe(true);
    await expect(field(page)).toHaveValue('Positive');
    await expect(saveDraft(page)).toBeEnabled();
    await expect(saveDraft(page)).not.toHaveAttribute('title', /Saved/);
  });

  test('Save draft fails with no explanation (500, empty body): plain words, no technical text, nothing saved', async ({ page }) => {
    neg.hook = r => r.method === 'POST' && r.path === DRAFT ? serverError(500) : undefined;
    await typeResult(page);
    await saveDraft(page).click();
    await expect(errorToast(page).first()).toBeVisible({ timeout: 10_000 });
    expect(await errorToast(page).first().innerText()).not.toMatch(NO_TECH_SPEAK);
    await expect(page.getByText('Draft saved')).toHaveCount(0);
    expect(isSample(page)).toBe(true);
  });

  test('The background autosave fails: it stays quiet but never stamps "Saved" on the button', async ({ page }) => {
    neg.hook = r => r.method === 'POST' && r.path === DRAFT ? serverError(500) : undefined;
    await typeResult(page);
    await expect.poll(() => neg.calls.filter(c => c.path === DRAFT).length, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    await expect(saveDraft(page)).not.toHaveAttribute('title', /Saved/);
    await expect(page.locator('.pf-sre-act__saved')).toHaveCount(0);
    expect(isSample(page)).toBe(true);
  });

  test('Submit fails (500 with a reason): an error toast, no "Submitted", the person stays on the tube with the value', async ({ page }) => {
    neg.hook = r => r.method === 'POST' && r.path === SUBMIT ? serverError(500, 'The result could not be submitted') : undefined;
    await typeResult(page);
    await visible(page, 'button[aria-label="Submit results"]').click();
    await expect(toast(page, 'The result could not be submitted')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/^Submitted \d/)).toHaveCount(0);
    await page.waitForTimeout(1200);
    expect(isSample(page), 'still on the result entry').toBe(true);
    await expect(field(page)).toHaveValue('Positive');
    await expect(visible(page, 'button[aria-label="Submit results"]')).toBeEnabled();
  });
});
