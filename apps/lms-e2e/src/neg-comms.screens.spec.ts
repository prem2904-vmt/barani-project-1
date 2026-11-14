import { test, expect } from './support/form-factor';
import {
  neg, resetNeg, installNegBackend, openComms, pickCommsTab, visible, toast, serverError, type NegAnswer,
} from './support/neg-backend';

/**
 * NEGATIVE scenarios, Settings → Communication (2026-11-14): every failure is said in plain words, the screen keeps
 * working and nothing pretends it worked. API mocked (support/neg-backend.ts), demo data only; runs on every
 * form-factor project of playwright.screens.config.ts.
 */
test.beforeEach(async ({ page, context }) => {
  test.setTimeout(150_000);
  resetNeg();
  await installNegBackend(page, context);
});

const TEST_PATH = '/api/settings/communication/email/test';
const SAVE_PATH = '/api/settings/communication/email';
/** "Http failure response for https://…: 500 Internal Server Error" must never reach a person. */
const NO_TECH_SPEAK = /Http failure|HttpErrorResponse|Unknown Error|\b50[0-9] |status code/i;

async function sendTest(page: import('@playwright/test').Page) {
  await openComms(page, 'email');
  await visible(page, '[data-testid="cm-test-to"]').fill('owner@demolab.example');
  const send = visible(page, '[data-testid="cm-test-send"]');
  await expect(send).toBeEnabled({ timeout: 20_000 });
  await send.click();
  return send;
}
const result = (page: import('@playwright/test').Page) => visible(page, '[data-testid="cm-test-result"]');

test.describe('neg-comms: Send test email', () => {
  test('the mail server refuses (502 with a reason): the reason is shown as "Not sent", nothing says "Sent", the button works again', async ({ page }) => {
    neg.hook = r => r.path === TEST_PATH ? { status: 502, body: { success: false, error: 'smtp_failed', message: 'The mail server refused the sign-in' } } : undefined;
    const send = await sendTest(page);
    await expect(result(page)).toHaveAttribute('data-ok', 'no');
    await expect(result(page)).toContainText('Not sent: The mail server refused the sign-in');
    await expect(page.getByText('Sent to owner@demolab.example')).toHaveCount(0);
    await expect(send).toBeEnabled();
    // Fixed on the server → the same button now works.
    neg.hook = null;
    await send.click();
    await expect(result(page)).toHaveAttribute('data-ok', 'yes');
    expect(neg.calls.filter(c => c.path === TEST_PATH)).toHaveLength(2);
  });

  test('the server fails with no explanation (500, empty body): plain words, no technical text, button works again', async ({ page }) => {
    neg.hook = r => r.path === TEST_PATH ? serverError(500) : undefined;
    const send = await sendTest(page);
    await expect(result(page)).toHaveAttribute('data-ok', 'no');
    await expect(result(page)).toContainText('Not sent:');
    expect(await result(page).innerText()).not.toMatch(NO_TECH_SPEAK);
    await expect(send).toBeEnabled();
  });

  test('too many test emails (429): a plain "try again later" message', async ({ page }) => {
    neg.hook = r => r.path === TEST_PATH ? { status: 429 } : undefined;
    const send = await sendTest(page);
    await expect(result(page)).toHaveAttribute('data-ok', 'no');
    await expect(result(page)).toContainText(/try again/i);
    expect(await result(page).innerText()).not.toMatch(NO_TECH_SPEAK);
    await expect(send).toBeEnabled();
  });

  test('the connection drops during the test send: plain words, button works again', async ({ page }) => {
    neg.hook = r => r.path === TEST_PATH ? { abort: true } : undefined;
    const send = await sendTest(page);
    await expect(result(page)).toHaveAttribute('data-ok', 'no');
    expect(await result(page).innerText()).not.toMatch(NO_TECH_SPEAK);
    await expect(result(page)).toContainText(/connection|reach|network|internet/i);
    await expect(send).toBeEnabled();
  });

  test('the server says "not sent" inside a normal answer ({ ok:false, error }): shown as "Not sent"', async ({ page }) => {
    neg.hook = (r): NegAnswer => r.path === TEST_PATH ? { status: 200, body: { success: true, data: { ok: false, error: 'The sender address is not allowed' } } } : undefined;
    await sendTest(page);
    await expect(result(page)).toHaveAttribute('data-ok', 'no');
    await expect(result(page)).toContainText('Not sent: The sender address is not allowed');
  });
});

test.describe('neg-comms: Save and read', () => {
  test('Save rejected with a field error (400): the reason is shown, what was typed is kept, still unsaved', async ({ page }) => {
    neg.hook = r => r.method === 'PUT' && r.path === SAVE_PATH
      ? { status: 400, body: { success: false, error: 'invalid_host', message: 'The mail host is not a valid address', field: 'host' } } : undefined;
    await openComms(page, 'email');
    await visible(page, '[data-testid="cm-email-mode"]').getByText('Our own mailbox', { exact: true }).click();
    await visible(page, '[data-testid="cm-smtp-host"]').fill('not a host');
    await visible(page, '[data-testid="cm-smtp-user"]').fill('reports@demolab.example');
    await visible(page, '[data-testid="cm-smtp-pass"]').fill('app-pass-123');
    await visible(page, '[data-testid="cm-smtp-from"]').fill('reports@demolab.example');
    const save = visible(page, '[data-testid="cm-email-save"]');
    await expect(save).toBeEnabled();
    await save.click();
    await expect(toast(page, 'The mail host is not a valid address')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Email settings saved')).toHaveCount(0);
    // Values kept; the form is still "unsaved" so the person can fix and retry.
    await expect(visible(page, '[data-testid="cm-smtp-host"]')).toHaveValue('not a host');
    await expect(visible(page, '[data-testid="cm-smtp-user"]')).toHaveValue('reports@demolab.example');
    await expect(save).toBeEnabled();
    expect(neg.calls.filter(c => c.method === 'PUT' && c.path === SAVE_PATH)).toHaveLength(1);
  });

  test('Save fails with no explanation (500): plain error, values kept', async ({ page }) => {
    neg.hook = r => r.method === 'PUT' && r.path === SAVE_PATH ? serverError(500) : undefined;
    await openComms(page, 'email');
    const name = visible(page, '[data-testid="cm-email-fromname"]');
    await name.fill('Demo Lab Reports');
    const save = visible(page, '[data-testid="cm-email-save"]');
    await save.click();
    const err = page.locator('.toast-item').locator('visible=true').first();
    await expect(err).toBeVisible({ timeout: 10_000 });
    expect(await err.innerText()).not.toMatch(NO_TECH_SPEAK);
    await expect(page.getByText('Email settings saved')).toHaveCount(0);
    await expect(name).toHaveValue('Demo Lab Reports');
    await expect(save).toBeEnabled();
  });

  for (const [label, answer] of [
    ['403 (no permission)', { status: 403, body: { success: false, error: 'forbidden', message: 'You do not have permission to see this' } }],
    ['500 (server error)', { status: 500 }],
    ['the connection drops', { abort: true }],
  ] as [string, NegAnswer][]) {
    test(`Settings cannot be read: ${label}: the page still opens with plain defaults, nothing crashes`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      neg.hook = r => r.method === 'GET' && r.path === '/api/settings/communication' ? answer : undefined;
      await openComms(page);
      await expect(visible(page, '[data-testid="ls-whatsapp"]')).toBeVisible({ timeout: 20_000 });
      await pickCommsTab(page, 'Email');
      await expect(visible(page, '[data-testid="cm-email-test"]')).toBeVisible({ timeout: 20_000 });
      await pickCommsTab(page, 'SMS');
      await expect(visible(page, '[data-testid="cm-sms"]')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(NO_TECH_SPEAK)).toHaveCount(0);
      expect(errors, 'no uncaught errors').toEqual([]);
    });
  }
});
