import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, isPhone, shotsDir } from './support/form-factor';
import { neg, resetNeg, installNegBackend, go } from './support/neg-backend';

/**
 * "Save your changes?" (owner 2026-11-17: users forget to Save — ask before they leave). API mocked, demo data only;
 * the pages, the dialog and the guards are the real app.
 *  - Settings overview: a change on Billing › GST, then another Settings section → the dialog; Stay keeps the change,
 *    Leave without saving discards it (the section opens fresh).
 *  - Leaving a page through the band's back (route guard): Front desk (booking slots), Message channels (email sender).
 * Screenshots: SHOTS_DIR/<form factor>/unsaved-*.png
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/unsaved-dialog');
const out = () => shotsDir(OUT_BASE);
const vis = (page: Page, sel: string) => page.locator(sel).locator('visible=true').first();
const dialogBox = (page: Page) => page.getByText('Save your changes?', { exact: true }).locator('visible=true').first();
const btn = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).locator('visible=true').first();

async function shot(page: Page, name: string) {
  for (const dark of [false, true]) {
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out()}/${name}--${dark ? 'dark' : 'light'}.png` });
  }
}

const BILLING = {
  gstEnabled: false, gstScope: 'intra', filingFrequency: 'monthly', allowDiscounts: true, maxDiscountPct: 10, overrideDiscountPct: 20,
  approvalThresholdPct: 15, invoicePrefix: 'INV', invoiceStartNumber: 1001, invoiceOnFullPaymentOnly: false,
};
const APPT = {
  branchId: 'b1', queueMode: 'token_queue', slotMinutes: 30, maxConcurrentSlots: 2, open24h: false,
  weeklyScheduleJson: JSON.stringify({ mon: [{ from: '08:00', to: '18:00' }] }),
  queueOptions: { baseAppointment: 100, baseWalkin: 50, baseFollowup: 80, waitWeight: 1, appointmentGraceMinutes: 10, latePenalty: 50, noShowThresholdMinutes: 30, avgCollectionMinutes: 5, urgentOverrideScore: 1000 },
};

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(150_000);
  resetNeg();
  neg.hook = r => {
    if (r.method !== 'GET') return undefined;
    const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
    switch (r.path) {
      case '/api/config/billing': return ok(BILLING);
      case '/api/tenants/branches': return ok([{ id: 'b1', name: 'Main', defaultLabCode: 'LAB', isActive: true }]);
      case '/api/appointments/config': return ok(APPT);
      default: return undefined;
    }
  };
  await installNegBackend(page, context);
});

test.describe('Save your changes?', () => {
  test('Billing › GST in the Settings overview: another section asks; Stay keeps, Leave discards', async ({ page }) => {
    test.skip(isPhone(), 'phone: the overview opens a section as a pushed detail; the band-back cases below cover the guard');
    await go(page, '/admin?section=billing');
    const sw = vis(page, '[data-testid="ov-inline"] button[role="switch"][aria-label="Allow discounts"]');
    await expect(sw).toBeVisible({ timeout: 60_000 });
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');

    // Another Settings section → the prompt.
    await vis(page, '[data-testid="tp-item-lab"]').click();
    await expect(dialogBox(page)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("You changed billing and taxes but haven't saved.").locator('visible=true').first()).toBeVisible();
    await shot(page, 'unsaved-billing-dialog');
    // Stay: still here, the change kept.
    await btn(page, 'Stay').click();
    await expect(dialogBox(page)).toBeHidden();
    await expect(page).toHaveURL(/section=billing/);
    await expect(sw).toHaveAttribute('aria-checked', 'false');

    // Leave without saving: the other section opens, nothing was saved, and Billing opens fresh.
    await vis(page, '[data-testid="tp-item-lab"]').click();
    await expect(dialogBox(page)).toBeVisible({ timeout: 10_000 });
    await btn(page, 'Leave without saving').click();
    await expect(page).toHaveURL(/section=lab/, { timeout: 20_000 });
    expect(neg.calls.filter(c => c.path === '/api/config/billing'), 'nothing saved').toEqual([]);
    await vis(page, '[data-testid="tp-item-billing"]').click();
    await expect(vis(page, '[data-testid="ov-inline"] button[role="switch"][aria-label="Allow discounts"]')).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });
  });

  test('Billing › GST page: the band back asks; Stay keeps the change; Leave goes', async ({ page }) => {
    await go(page, '/admin/billing?tab=gst');
    const sw = vis(page, 'button[role="switch"][aria-label="Allow discounts"]');
    await expect(sw).toBeVisible({ timeout: 60_000 });
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await vis(page, '.pf-hb__back').click();
    await expect(dialogBox(page)).toBeVisible({ timeout: 10_000 });
    await btn(page, 'Stay').click();
    await expect(page).toHaveURL(/\/admin\/billing/);
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await vis(page, '.pf-hb__back').click();
    await expect(dialogBox(page)).toBeVisible({ timeout: 10_000 });
    await btn(page, 'Leave without saving').click();
    await expect(page).not.toHaveURL(/\/admin\/billing/, { timeout: 20_000 });
  });

  test('Front desk (booking slots) and Message channels (email sender) ask before they are left', async ({ page }) => {
    // Front desk: the slot length is an explicit-Save field.
    await go(page, '/admin/lab/front-desk?tab=mode');
    const mode = vis(page, 'pf-appointments-config [aria-label="Queue mode"] [role="radio"][aria-checked="false"]');
    await expect(mode).toBeVisible({ timeout: 60_000 });
    await mode.click();
    await vis(page, '.pf-hb__back').click();
    await expect(dialogBox(page)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("You changed the front desk settings but haven't saved.").locator('visible=true').first()).toBeVisible();
    await shot(page, 'unsaved-front-desk-dialog');
    await btn(page, 'Leave without saving').click();
    await expect(page).not.toHaveURL(/\/admin\/lab\/front-desk/, { timeout: 20_000 });

    // Message channels › Email: the sender name.
    await go(page, '/admin/org/channels?tab=email');
    const from = vis(page, 'input[placeholder="e.g. Arun Labs"]');
    await expect(from).toBeVisible({ timeout: 60_000 });
    await from.fill('Demo Lab Reports');
    await vis(page, '.pf-hb__back').click();
    await expect(dialogBox(page)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("You changed the email settings but haven't saved.").locator('visible=true').first()).toBeVisible();
    await btn(page, 'Stay').click();
    await expect(from).toHaveValue('Demo Lab Reports');
    await vis(page, '.pf-hb__back').click();
    await btn(page, 'Leave without saving').click();
    await expect(page).not.toHaveURL(/\/admin\/org\/channels/, { timeout: 20_000 });
  });
});
