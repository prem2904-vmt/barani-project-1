import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, isPhone, expectLayout, shotsDir } from './support/form-factor';
import { resetNeg, installNegBackend, go } from './support/neg-backend';

/**
 * SETTINGS overview (two panels) on EVERY form factor, light + dark. API mocked, demo data only; the page, band,
 * list and tiles are the real app. Screenshots: SHOTS_DIR/<form factor>/settings-*.png
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/settings-2p');
const out = () => shotsDir(OUT_BASE);
const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`).locator('visible=true').first();

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

test.describe('settings two-panel', () => {
  test('overview: Departments then Organization, the selected section as tiles, no KPI cards', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await go(page, '/admin');
    await expect(tid(page, 'tp-item-lab')).toBeVisible({ timeout: 60_000 });
    const groups = await page.locator('[data-testid^="tp-group-"]').evaluateAll(els => els.map(e => (e.textContent ?? '').trim().toUpperCase()));
    expect(groups).toEqual(['DEPARTMENTS', 'ORGANIZATION']);
    await expect(page.getByText('All departments')).toHaveCount(0);
    await expect(page.getByText('Cash in')).toHaveCount(0);
    await expect(page.getByText('Balance due')).toHaveCount(0);
    if (isPhone()) {
      await expect(page.locator('[data-testid="ov-tiles"]')).toHaveCount(0);
      await expectLayout(page, 'settings list');
      await shot(page, 'settings-phone-list');
      await tid(page, 'tp-item-lab').click();
      await expect(page).toHaveURL(/section=lab/);
      await expect(tid(page, 'tp-back')).toBeVisible();
      await expect(tid(page, 'ov-tile-admin-lab-numbers')).toBeVisible();
      await expectLayout(page, 'settings section');
      await shot(page, 'settings-phone-section');
      await tid(page, 'tp-back').click();
      await expect(tid(page, 'tp-item-lab')).toBeVisible();
      await expect(page.locator('[data-testid="ov-tiles"]')).toHaveCount(0);
    } else {
      await expect(tid(page, 'ov-tile-admin-tests')).toBeVisible();
      await expectLayout(page, 'settings overview');
      await shot(page, 'settings-overview');
      await tid(page, 'tp-item-billing').click();
      await expect(page).toHaveURL(/section=billing/);
      await expect(tid(page, 'ov-tile-admin-billing')).toBeVisible();
      await expectLayout(page, 'settings billing');
      await shot(page, 'settings-billing');
    }
    expect(errors, 'no uncaught errors').toEqual([]);
  });

  test('opening a setting: the left panel becomes that setting\'s categories under a back arrow; the screen fills the right', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await go(page, '/admin?section=lab');
    await expect(tid(page, 'ov-tile-admin-lab-outsourcing')).toBeVisible({ timeout: 60_000 });
    await tid(page, 'ov-tile-admin-lab-outsourcing').click();
    if (isPhone()) {
      // phone: categories list first (no hop), then drill in
      await expect(page).toHaveURL(/\/admin\/lab\/outsourcing$/);
      await expect(tid(page, 'tp-nav-title')).toHaveText('Outsourcing');
      await expect(tid(page, 'tp-item-referral-labs')).toBeVisible();
      await expectLayout(page, 'settings inside (list)');
      await shot(page, 'settings-phone-inside-list');
      await tid(page, 'tp-item-partner-prices').click();
      await expect(page).toHaveURL(/\/admin\/partner-prices/);
      await expect(tid(page, 'tp-back')).toBeVisible();
      await expectLayout(page, 'settings inside (screen)');
      await shot(page, 'settings-phone-inside');
      await tid(page, 'tp-back').click();
      await expect(tid(page, 'tp-item-referral-labs')).toBeVisible();
      await tid(page, 'tp-nav-back').click();
      await expect(page).toHaveURL(/\/admin\?section=lab/);
    } else {
      await expect(page).toHaveURL(/\/admin\/referral-labs/, { timeout: 30_000 });
      await expect(tid(page, 'tp-nav-title')).toHaveText('Outsourcing');
      await expect(tid(page, 'tp-nav-back')).toBeVisible();
      await expect(tid(page, 'tp-item-referral-labs')).toHaveAttribute('aria-current', 'true');
      await expect(page.locator('.pf-tp__heading')).toHaveCount(0);
      await expectLayout(page, 'settings inside');
      await shot(page, 'settings-inside');
      await tid(page, 'tp-item-partner-prices').click();
      await expect(page).toHaveURL(/\/admin\/partner-prices/);
      // the shell's categories replace the page's own tabs / back chevron
      await expect(page.locator('pf-hero-band .pf-hb__back')).toHaveCount(0);
      await tid(page, 'tp-rail-toggle').click();
      await expect(page.locator('.pf-tp--rail')).toBeVisible();
      await shot(page, 'settings-inside-rail');
      await tid(page, 'tp-rail-toggle').click();
      await tid(page, 'tp-nav-back').click();
      await expect(page).toHaveURL(/\/admin\?section=lab/);
      await expect(tid(page, 'ov-tile-admin-lab-outsourcing')).toBeVisible();
    }
    expect(errors, 'no uncaught errors').toEqual([]);
  });

  test('a tabbed page is driven by its categories: Organization numbers → Patient ID / Order ID, no tab strip of its own', async ({ page }) => {
    await go(page, '/admin/org/numbers?tab=order');
    await expect(page.locator('.pf-tp__eyebrow').locator('visible=true').first()).toHaveText(/Patient and order numbers/i, { timeout: 60_000 });
    await expect(page.locator('pf-hero-band .pf-hb-tabs')).toHaveCount(0);
    if (!isPhone()) {
      await expect(tid(page, 'tp-nav-title')).toHaveText('Patient and order numbers');
      await expect(tid(page, 'tp-item-order')).toHaveAttribute('aria-current', 'true');
      await tid(page, 'tp-item-patient').click();
      await expect(page).toHaveURL(/tab=patient/);
      await shot(page, 'settings-inside-numbers');
    } else {
      await expect(tid(page, 'tp-back')).toBeVisible();
    }
  });

  test('old deep links open the new home', async ({ page }) => {
    await go(page, '/admin/manage?cat=org');
    await expect(page).toHaveURL(/\/admin\?section=profile/, { timeout: 60_000 });
    await go(page, '/lab/settings');
    await expect(page).toHaveURL(/\/admin\?section=lab/, { timeout: 60_000 });
    await go(page, '/admin/lab-settings?tab=queues');
    await expect(page).toHaveURL(/\/admin\/lab\/collection\?tab=queues/, { timeout: 60_000 });
    await go(page, '/admin/organization?tab=order');
    await expect(page).toHaveURL(/\/admin\/org\/numbers\?tab=order/, { timeout: 60_000 });
    await go(page, '/admin/partners');
    await expect(page).toHaveURL(/\/admin\/(lab\/outsourcing|referral-labs)/, { timeout: 60_000 });
    await expect(tid(page, 'tp-nav-title')).toHaveText('Outsourcing'); // the in-app hop to the first category has settled
    await page.waitForLoadState('networkidle');
    await go(page, '/admin/modules');
    await expect(page).toHaveURL(/\/admin$/, { timeout: 60_000 });
  });

  test('one entry point: the start menu and the profile menu have no Admin overview / Manage settings / Lab settings / Tenant branding', async ({ page }) => {
    await go(page, '/admin');
    await expect(tid(page, 'tp-item-lab')).toBeVisible({ timeout: 60_000 });
    for (const gone of ['Admin overview', 'Manage settings', 'Tenant branding']) await expect(page.getByText(gone, { exact: true })).toHaveCount(0);
  });

  test('search finds a setting from any section and opens it at its new home', async ({ page }) => {
    await go(page, '/admin');
    await expect(tid(page, 'tp-item-lab')).toBeVisible({ timeout: 60_000 });
    const input = page.locator('pf-hero-band .pf-hb__input').locator('visible=true').first();
    await input.fill('invoice');
    await expect(page.locator('[data-testid="settings-hit"]').locator('visible=true').first()).toBeVisible();
    await shot(page, 'settings-search');
    await input.fill('');
    await expect(tid(page, 'tp-item-lab')).toBeVisible();
  });
});
