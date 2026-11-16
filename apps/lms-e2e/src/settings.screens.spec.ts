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
  test('overview: grouped list, selected section tiles, no KPI cards', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await go(page, '/admin');
    await expect(tid(page, 'tp-item-lab')).toBeVisible({ timeout: 60_000 });
    const groups = await page.locator('[data-testid^="tp-group-"]').evaluateAll(els => els.map(e => (e.textContent ?? '').trim().toUpperCase()));
    expect(groups).toEqual(['DEPARTMENTS', 'ORGANIZATION', 'ALL DEPARTMENTS']);
    await expect(page.getByText('Cash in')).toHaveCount(0);
    await expect(page.getByText('Balance due')).toHaveCount(0);
    if (isPhone()) {
      // phone: list first
      await expect(page.locator('[data-testid="ov-tiles"]')).toHaveCount(0);
      await expectLayout(page, 'settings list');
      await shot(page, 'settings-phone-list');
      await tid(page, 'tp-item-lab').click();
      await expect(page).toHaveURL(/section=lab/);
      await expect(tid(page, 'tp-back')).toBeVisible();
      await expect(tid(page, 'ov-tile-admin-kpis')).toBeVisible();
      await expectLayout(page, 'settings section');
      await shot(page, 'settings-phone-section');
      await tid(page, 'tp-back').click();
      await expect(tid(page, 'tp-item-lab')).toBeVisible();
      await expect(page.locator('[data-testid="ov-tiles"]')).toHaveCount(0);
    } else {
      await expect(tid(page, 'ov-tile-admin-tests')).toBeVisible();
      await expectLayout(page, 'settings overview');
      await shot(page, 'settings-lab');
      await tid(page, 'tp-item-finance').click();
      await expect(page).toHaveURL(/section=finance/);
      await expect(tid(page, 'ov-tile-admin-billing')).toBeVisible();
      await expectLayout(page, 'settings finance');
      await shot(page, 'settings-finance');
    }
    expect(errors, 'no uncaught errors').toEqual([]);
  });

  test('old deep links open the page on that section', async ({ page }) => {
    await go(page, '/admin/manage?cat=org');
    await expect(page).toHaveURL(/\/admin\?section=org/, { timeout: 60_000 });
    await expect(tid(page, 'ov-tile-admin-branches')).toBeVisible();
    await go(page, '/lab/settings');
    await expect(page).toHaveURL(/\/admin\?section=lab/, { timeout: 60_000 });
    await expect(tid(page, 'ov-tile-admin-tests')).toBeVisible();
  });

  test('search finds a setting from any section', async ({ page }) => {
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
