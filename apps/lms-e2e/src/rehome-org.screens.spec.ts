import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, expectLayout, shotsDir } from './support/form-factor';
import { resetNeg, installNegBackend, go } from './support/neg-backend';

/**
 * Settings re-home — Organization pages (profile, numbers, channels, billing categories, credit accounts) on EVERY form
 * factor, light + dark. API mocked, demo data only. Screenshots: SHOTS_DIR/<form factor>/rehome-org-*.png
 * OPD / IPD / Pharmacy pages are behind their gates, which the demo tenant has closed: they are covered by unit specs.
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/rehome-org');
const out = () => shotsDir(OUT_BASE);

async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
  await page.waitForTimeout(450);
}
async function shot(page: Page, name: string) {
  for (const dark of [false, true]) { await theme(page, dark); await page.screenshot({ path: `${out()}/${name}--${dark ? 'dark' : 'light'}.png` }); }
  await theme(page, false);
}

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(150_000);
  resetNeg();
  await installNegBackend(page, context);
});

const PAGES: Array<{ name: string; url: string; marker: string }> = [
  { name: 'profile', url: '/admin/org/profile?tab=name', marker: '[data-testid="org-profile"]' },
  { name: 'numbers', url: '/admin/org/numbers?tab=patient', marker: '[data-testid="fmt-row"]' },
  { name: 'channels', url: '/admin/org/channels?tab=whatsapp', marker: '[data-testid="comms-page"]' },
  { name: 'billing-gst', url: '/admin/billing?tab=gst', marker: 'text=Allow discounts' },
  { name: 'billing-invoice', url: '/admin/billing?tab=invoice', marker: '[data-testid="bc-name-ro"]' },
  { name: 'billing-payments', url: '/admin/billing?tab=payments', marker: '[data-testid="billing-payments"]' },
  { name: 'billing-credit', url: '/admin/billing?tab=credit', marker: 'pf-vendors' },
  { name: 'finance-credit', url: '/finance/credit-accounts', marker: 'pf-vendors' },
];

test.describe('settings re-home: organization pages', () => {
  for (const p of PAGES) {
    test(p.name, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      await go(page, p.url);
      await expect(page.locator(p.marker).locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
      await expectLayout(page, `rehome ${p.name}`);
      await shot(page, `rehome-org-${p.name}`);
      // The invoice tab's live PDF preview (a blob iframe) reports a storage read in headless Chromium; that preview
      // is untouched by this change, so only that one message is tolerated there.
      const real = p.name === 'billing-invoice' ? errors.filter(e => !/reading 'getItem'/.test(e)) : errors;
      expect(real, 'no uncaught errors').toEqual([]);
    });
  }

  // IPD on the demo tenant (case sheets on): IPD departments and case sheets are full-screen pages (DESIGN-V2 rule 2);
  // IPD alerts open inside the Settings frame.
  for (const [name, url, marker, hosted] of [
    ['ipd-departments', '/admin/ipd/departments', 'pf-hero-band', false],
    ['ipd-case-sheets', '/admin/ipd/myprefrontal', 'pf-hero-band', false],
    ['ipd-alerts', '/admin/ipd/alerts', 'pf-notifications-config', true],
  ] as const) {
    test(name, async ({ page }) => {
      await go(page, url);
      await expect(page.locator(marker).first()).toBeAttached({ timeout: 60_000 });
      await expect(page.locator('[data-testid="settings-shell"]').locator('visible=true')).toHaveCount(hosted ? 1 : 0, { timeout: 20_000 });
      await page.waitForTimeout(1200);
      await shot(page, `rehome-${name}`);
    });
  }

  test('old links keep working: /setup opens the profile', async ({ page }) => {
    await go(page, '/setup');
    await expect(page).toHaveURL(/\/admin\/org\/profile/, { timeout: 60_000 });
    await expect(page.locator('[data-testid="org-profile"]').locator('visible=true').first()).toBeVisible();
  });

  test('credit accounts: setup in Billing has no money actions; Finance has them', async ({ page }) => {
    await go(page, '/admin/billing?tab=credit');
    await expect(page.locator('pf-vendors').locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Record payment').locator('visible=true')).toHaveCount(0);
    await go(page, '/finance/credit-accounts');
    await expect(page.locator('pf-vendors').locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Add vendor').locator('visible=true')).toHaveCount(0);
  });
});
