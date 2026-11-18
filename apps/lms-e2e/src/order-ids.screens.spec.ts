import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, isPhone, expectLayout, shotsDir } from './support/form-factor';
import { neg, resetNeg, installNegBackend, go } from './support/neg-backend';

/**
 * Order IDs per module (2026-11-18) on EVERY form factor, light + dark. API mocked, demo data only; the pages, bands and
 * cards are the real app. Lab › Sample numbers (Order ID), Organization › Patient numbers, OPD › Visit numbers and
 * Pharmacy › Dispense numbers (the last two are OPD-gated: the console flag `pf.opd` opens the gate, as `pf.opd()` does).
 * Screenshots: SHOTS_DIR/<form factor>/order-ids-*.png
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/order-ids');
const out = () => shotsDir(OUT_BASE);
const vis = (page: Page, sel: string) => page.locator(sel).locator('visible=true').first();

async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
  await page.waitForTimeout(450);
}
async function shot(page: Page, name: string) {
  for (const dark of [false, true]) { await theme(page, dark); await page.screenshot({ path: `${out()}/${name}--${dark ? 'dark' : 'light'}.png` }); }
  await theme(page, false);
}

const ME = {
  id: 'app-1', authId: 'sub-1', firstName: 'Kavya', fathersName: 'Desk', displayName: 'Kavya Desk', email: 'admin@demolab.example',
  tenantId: 't-demo', tenantName: 'Demo Lab', branchId: 'b1', branchName: 'Main', roles: ['Lab Admin'], permissions: ['*'],
  branches: [{ id: 'b1', name: 'Main' }], modules: ['lab'], hasPin: false,
};
/** What the server answers for each module's order-ID row (a custom OPD row; nothing saved yet for Pharmacy). */
const ROWS: Record<string, unknown> = {
  lab: { enabled: true, datePrefix: 'yymm', separator: '-', padding: 6, serialMode: 'numeric', letterCount: 2, prefix: null },
  opd: { enabled: true, datePrefix: 'yymmdd', separator: '/', padding: 4, serialMode: 'numeric', letterCount: 2, prefix: 'VIS' },
  pharmacy: null,
};

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(150_000);
  resetNeg();
  await page.addInitScript(() => { try { localStorage.setItem('pf.opd', '1'); } catch { /* storage blocked */ } });
  neg.hook = r => {
    const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
    if (r.method !== 'GET') return undefined;
    switch (r.path) {
      case '/api/auth/me': return ok({ ...ME, opdEntitled: true, opdAccess: true });
      case '/api/config/patient-id': return ok({ enabled: false, datePrefix: 'ddmmyy', separator: '-', padding: 4, serialMode: 'numeric', letterCount: 2 });
      case '/api/config/sample-id': return ok({ enabled: true, datePrefix: 'yymm', separator: '-', padding: 5, serialMode: 'numeric', letterCount: 2 });
      case '/api/tenants/branch-lab-config': return ok({ labStructure: 'auto', labelCodeMode: 'barcode', queueFocusMode: 'auto', effectiveQueueFocus: 'patient', inventoryEnabled: true });
      case '/api/tenants/branches': return ok([{ id: 'b1', name: 'Main', defaultLabCode: 'LAB', isActive: true }]);
      case '/api/tenants/lab-spaces': return ok([{ id: 's1', branchId: 'b1', name: 'Microbiology', code: 'MIC', order: 1 }]);
      default: return undefined;
    }
  };
  await installNegBackend(page, context);
  // Registered AFTER the shared backend so it answers first (Playwright matches the newest route first).
  // The order-ID endpoint answers by ?module= (the shared mock sees the path only, so route it here).
  await page.route(/\/api\/config\/order-id/, async (route, req) => {
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const u = new URL(req.url());
    const module = u.searchParams.get('module') ?? 'lab';
    if (req.method() !== 'GET') {
      let body: unknown = null; try { body = JSON.parse(req.postData() ?? 'null'); } catch { /* not json */ }
      neg.calls.push({ method: req.method(), path: u.pathname + u.search, body });
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ success: true, data: body }) });
    }
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ success: true, data: ROWS[module] ?? null }) });
  });
});

const PAGES: Array<{ name: string; url: string; ready: string; text: string; absent?: string }> = [
  { name: 'lab-order-id', url: '/admin/lab/sample-numbers?tab=order', ready: '[data-testid="order-id-format-lab"]', text: 'Order ID' },
  { name: 'org-patient-numbers', url: '/admin/org/numbers?tab=patient', ready: '[data-testid="fmt-row"]', text: 'Custom format', absent: 'Order ID' },
  { name: 'opd-visit-numbers', url: '/admin/opd/numbers', ready: '[data-testid="order-id-format-opd"]', text: 'Visit numbers' },
  { name: 'pharmacy-dispense-numbers', url: '/admin/pharmacy/numbers', ready: '[data-testid="order-id-format-pharmacy"]', text: 'Dispense numbers' },
];

test.describe('order IDs per module', () => {
  for (const pg of PAGES) {
    test(pg.name, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      await go(page, pg.url);
      await expect(vis(page, pg.ready)).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText(pg.text, { exact: false }).locator('visible=true').first()).toBeVisible();
      if (pg.absent) await expect(page.getByText(pg.absent, { exact: false }).locator('visible=true')).toHaveCount(0);
      await expectLayout(page, pg.name);
      await shot(page, `order-ids-${pg.name}`);
      expect(errors, 'no uncaught errors').toEqual([]);
    });
  }

  test('the old Organization ?tab=order link lands on Lab › Sample numbers (Order ID)', async ({ page }) => {
    await go(page, '/admin/organization?tab=order');
    await expect(page).toHaveURL(/\/admin\/lab\/sample-numbers\?tab=order/, { timeout: 60_000 });
    await expect(vis(page, '[data-testid="order-id-format-lab"]')).toBeVisible({ timeout: 60_000 });
  });

  test('Lab order ID: a prefix edit lights the band Save (the only Save) and posts module=lab', async ({ page }) => {
    await go(page, '/admin/lab/sample-numbers?tab=order');
    await expect(vis(page, '[data-testid="order-id-format-lab"]')).toBeVisible({ timeout: 60_000 });
    await expect(vis(page, '[data-testid="order-id-preview"]')).toHaveText(/^LAB-\d{4}-000001$/);
    await vis(page, '[data-testid="order-id-format-lab"] input[aria-label="Prefix"]').fill('ab');
    await expect(vis(page, '[data-testid="order-id-preview"]')).toHaveText(/^AB-\d{4}-000001$/);
    await expect(page.locator('[data-testid="savebar-save"]').locator('visible=true')).toHaveCount(1);
    await expectLayout(page, 'lab-order-id-dirty');
    await shot(page, 'order-ids-lab-order-id-dirty');
    await vis(page, '[data-testid="savebar-save"]').click();
    await expect.poll(() => neg.calls.find(c => c.path === '/api/config/order-id?module=lab')?.body)
      .toEqual({ enabled: true, datePrefix: 'yymm', separator: '-', padding: 6, serialMode: 'numeric', letterCount: 2, prefix: 'AB' });
  });

  test('Pharmacy: opt in with Custom format, a Save posts module=pharmacy', async ({ page }) => {
    await go(page, '/admin/pharmacy/numbers');
    await expect(vis(page, '[data-testid="order-id-format-pharmacy"]')).toBeVisible({ timeout: 60_000 });
    await expect(vis(page, '[data-testid="order-id-preview"]')).toHaveText(/^PD-\d{4}-000001$/);
    await vis(page, '[data-testid="order-id-format-pharmacy"] button[role="switch"][aria-label="Custom Dispense number format"]').click();
    await vis(page, '[data-testid="order-id-format-pharmacy"] input[aria-label="Prefix"]').fill('dsp');
    await expectLayout(page, 'pharmacy-dispense-numbers-open');
    await shot(page, 'order-ids-pharmacy-dispense-numbers-open');
    await vis(page, '[data-testid="savebar-save"]').click();
    await expect.poll(() => neg.calls.find(c => c.path === '/api/config/order-id?module=pharmacy')?.body)
      .toEqual({ enabled: true, datePrefix: 'yymm', separator: '-', padding: 6, serialMode: 'numeric', letterCount: 2, prefix: 'DSP' });
  });

  test('phone: nothing overflows sideways on the new pages', async ({ page }) => {
    test.skip(!isPhone(), 'phone only');
    for (const [url, sel] of [['/admin/lab/sample-numbers?tab=order', 'order-id-format-lab'], ['/admin/opd/numbers', 'order-id-format-opd']] as const) {
      await go(page, url);
      await expect(vis(page, `[data-testid="${sel}"]`)).toBeVisible({ timeout: 60_000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    }
  });
});
