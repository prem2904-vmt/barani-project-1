import type { Page } from '@playwright/test';
import { test, expect } from './support/form-factor';
import {
  neg, resetNeg, installNegBackend, openDesk, shareButton, visible, toast, serverError, forbidden, type NegAnswer,
} from './support/neg-backend';

/**
 * NEGATIVE scenarios, emailing a REPORT from the front desk Share menu (2026-11-14): whatever goes wrong, the person
 * reads a plain reason, nothing claims "emailed", and a double click is ONE request. API mocked, demo data only.
 */
const EMAIL_PATH = '/api/reports/by-order/op/email';
const NO_TECH_SPEAK = /Http failure|HttpErrorResponse|Unknown Error|\b50[0-9] |status code/i;

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(150_000);
  resetNeg();
  await installNegBackend(page, context);
});

const hook = (answer: NegAnswer | ((body: any) => NegAnswer)) => {
  neg.hook = r => r.method === 'POST' && r.path === EMAIL_PATH ? (typeof answer === 'function' ? answer(r.body) : answer) : undefined;
};
async function emailPriya(page: Page) {
  await openDesk(page);
  await shareButton(page, 'Priya Nair').click();
  await visible(page, '[data-test="share-email"]').click();
}
const toasts = (page: Page) => page.locator('.toast-item').locator('visible=true');
const never = async (page: Page) => expect(await page.getByText(/Report emailed to/).locator('visible=true').count(), 'nothing claims "emailed"').toBe(0);

test.describe('neg-email-share: report email', () => {
  test('the server fails with a reason (500): that reason is the toast, not "emailed"', async ({ page }) => {
    hook(serverError(500, 'The mail server is down for maintenance'));
    await emailPriya(page);
    await expect(toast(page, 'The mail server is down for maintenance')).toBeVisible({ timeout: 10_000 });
    await never(page);
    expect(neg.calls.filter(c => c.path === EMAIL_PATH)).toHaveLength(1);
  });

  test('the server fails with no explanation (500, empty body): a plain toast, no technical text', async ({ page }) => {
    hook(serverError(500));
    await emailPriya(page);
    await expect(toasts(page).first()).toBeVisible({ timeout: 10_000 });
    expect(await toasts(page).first().innerText()).not.toMatch(NO_TECH_SPEAK);
    await expect(toasts(page).first()).toContainText(/try again/i);
    await never(page);
  });

  test('email sharing is switched off (403 module_disabled): the server\'s plain reason, not "emailed"', async ({ page }) => {
    hook(forbidden('module_disabled', 'Email sharing is turned off for this lab'));
    await emailPriya(page);
    await expect(toast(page, 'Email sharing is turned off for this lab')).toBeVisible({ timeout: 10_000 });
    await never(page);
  });

  test('403 with no explanation: plain "no permission" words', async ({ page }) => {
    hook({ status: 403 });
    await emailPriya(page);
    await expect(toasts(page).first()).toBeVisible({ timeout: 10_000 });
    expect(await toasts(page).first().innerText()).not.toMatch(NO_TECH_SPEAK);
    await expect(toasts(page).first()).toContainText(/permission/i);
    await never(page);
  });

  test('the connection drops (network failure): plain words about the connection, not "emailed"', async ({ page }) => {
    hook({ abort: true });
    await emailPriya(page);
    await expect(toasts(page).first()).toBeVisible({ timeout: 10_000 });
    expect(await toasts(page).first().innerText()).not.toMatch(NO_TECH_SPEAK);
    await expect(toasts(page).first()).toContainText(/connection|reach/i);
    await never(page);
  });

  test('the patient asked not to get messages (server skips "opted_out"): "Not emailed" with that reason', async ({ page }) => {
    hook({ status: 200, body: { success: true, data: { sent: [], skipped: [{ kind: 'patient', reason: 'opted_out' }] } } });
    await emailPriya(page);
    await expect(toast(page, 'Not emailed to the patient: they asked not to get messages')).toBeVisible({ timeout: 10_000 });
    await never(page);
  });

  test('no email address on file (server skips "no_email"): "Not emailed" with that reason', async ({ page }) => {
    hook({ status: 200, body: { success: true, data: { sent: [], skipped: [{ kind: 'patient', reason: 'no_email' }] } } });
    await emailPriya(page);
    await expect(toast(page, 'Not emailed to the patient: no email address on file')).toBeVisible({ timeout: 10_000 });
    await never(page);
  });

  test('a patient with no email address has no Email row in the Share menu, so nothing can be sent', async ({ page }) => {
    await openDesk(page, 'Noor Khan');
    await shareButton(page, 'Noor Khan').click();
    await expect(visible(page, '[data-test="share-whatsapp"]')).toBeVisible();
    await expect(page.locator('[data-test^="share-email"]').locator('visible=true')).toHaveCount(0);
    expect(neg.calls.filter(c => /\/email$/.test(c.path))).toEqual([]);
  });

  test('double click on Email sends exactly ONE request', async ({ page }) => {
    hook({ delayMs: 800 });
    await openDesk(page);
    await shareButton(page, 'Priya Nair').click();
    const row = visible(page, '[data-test="share-email"]');
    await expect(row).toBeVisible();
    // Two clicks in the same instant: before the screen can re-render, like a fast double tap.
    await row.evaluate(el => { (el as HTMLElement).click(); (el as HTMLElement).click(); });
    await expect(toast(page, 'Report emailed to priya@example.com')).toBeVisible({ timeout: 15_000 });
    expect(neg.calls.filter(c => c.path === EMAIL_PATH)).toHaveLength(1);
  });

  test('Invoice viewer: double click on Email sends exactly ONE request, and a server failure is not "emailed"', async ({ page }) => {
    neg.hook = r => r.method === 'POST' && /^\/api\/billing\/[^/]+\/email$/.test(r.path) ? { status: 500, delayMs: 800 } : undefined;
    await openDesk(page);
    await page.getByText('Priya Nair').locator('visible=true').first().click();
    await visible(page, 'button[aria-label="View invoice"]').click();
    const email = visible(page, '[data-test="invoice-email"]');
    await expect(email).toBeVisible({ timeout: 30_000 });
    await expect(email).toBeEnabled({ timeout: 15_000 });
    await email.evaluate(el => { (el as HTMLElement).click(); (el as HTMLElement).click(); });
    await expect(toasts(page).first()).toBeVisible({ timeout: 15_000 });
    await expect(toasts(page).first()).not.toContainText(/Invoice emailed/);
    expect(await toasts(page).first().innerText()).not.toMatch(NO_TECH_SPEAK);
    expect(neg.calls.filter(c => /^\/api\/billing\/[^/]+\/email$/.test(c.path))).toHaveLength(1);
  });
});
