import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * Test editor — reference ranges, EXPLAINED (ND-PATTERN "Reference ranges &
 * conditions"). Signs in as the seeded Lab Admin, opens Haemoglobin (HEM011 —
 * sex/age bands with criticals, or $TEST_CODE / $TEST_ID), goes to Result
 * entry and checks the plain range table + the one-line tester at 1440 and 375.
 * READ-ONLY: edits stay in the draft and it never saves.
 * Screenshots (1440 / 375 × light / dark) into $SHOTS_DIR when set.
 * CORS_RELAY=1 relays backend calls so a static build on :4310 can run it.
 */

const SHOTS = process.env['SHOTS_DIR'] || '';
const CODE = process.env['TEST_CODE'] || 'HEM011';

async function relayCors(page: Page) {
  if (!process.env['CORS_RELAY']) return;
  await page.route(/prefrontal\.health\/api\/|localhost:5270\/api\//, async route => {
    const origin = new URL(page.url() || 'http://localhost').origin;
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const res = await route.fetch();
    await route.fulfill({ response: res, headers: { ...res.headers(), ...cors } });
  });
}

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((t) => {
    const r = document.documentElement;
    r.classList.toggle('dark', t === 'dark');
    r.classList.toggle('light', t === 'light');
    r.setAttribute('data-theme', t);
  }, theme);
}

async function shoot(page: Page, name: string) {
  if (!SHOTS) return;
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/${name}-${theme}.png`, fullPage: false });
  }
  await setTheme(page, 'light');
}

async function openEditor(page: Page): Promise<boolean> {
  const direct = process.env['TEST_ID'];
  if (direct) { await page.goto(`/admin/tests/${direct}/edit?type=individual`); return true; }
  const listed = page.waitForResponse(r => /\/api\/tests\/(\?.*)?$/.test(new URL(r.url()).pathname + new URL(r.url()).search)
    && r.request().method() === 'GET', { timeout: 30_000 });
  await page.goto('/admin/tests');
  const res = await listed.catch(() => null);
  if (!res) return false;
  const body = await res.json().catch(() => null);
  const rows: any[] = Array.isArray(body) ? body : (body?.data ?? []);
  const t = rows.find(r => (r.testCode ?? '').toUpperCase() === CODE);
  if (!t) return false;
  await page.goto(`/admin/tests/${t.id}/edit?type=individual`);
  return true;
}

test.describe('Test editor — reference ranges as a plain table', () => {
  test('plain range table + tester at 1440 and 375 (read-only)', async ({ page }) => {
    await relayCors(page);
    // Never write: fail loudly if anything tries to save.
    await page.route(/\/api\/(tests|report-layout\/test)\//, route =>
      ['PATCH', 'PUT', 'DELETE'].includes(route.request().method()) ||
      (route.request().method() === 'POST' && !/preview/.test(route.request().url()))
        ? route.abort() : route.fallback());
    await loginAs(page, 'admin');
    await page.setViewportSize({ width: 1440, height: 900 });
    test.skip(!(await openEditor(page)), `${CODE} not in this tenant's Test Master`);
    await page.locator('[role="tab"][data-sec="results"]').click();

    const table = page.locator('pf-range-table').first();
    await expect(table).toBeVisible({ timeout: 20_000 });
    // No range bars / zone ruler / AG-Grid in the default view.
    await expect(page.locator('pf-range-insight, .rin__bar')).toHaveCount(0);
    await expect(page.locator('.pf-rrgrid')).toHaveCount(0);
    const bands = table.locator('.rtb__band');
    expect(await bands.count()).toBeGreaterThanOrEqual(1);
    // Rows read in severity order: Critical low → … → Critical high.
    const order = ['Critical low', 'Low', 'Normal', 'High', 'Critical high'];
    const labels = (await bands.first().locator('tbody th').allTextContents()).map(t => t.trim());
    const idx = labels.map(l => order.indexOf(l)).filter(i => i >= 0);
    expect(idx.length).toBeGreaterThanOrEqual(2);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    await expect(bands.first().locator('.rtb__edges')).toContainText('Exactly on a limit');

    // Try a value — one line: a woman of 35 with 6 g/dL.
    await table.locator('.rtb__in--try').fill('6');
    await table.getByRole('radio', { name: 'Woman' }).click();
    await table.locator('.rtb__in--tage').fill('35');
    await expect(table.locator('.rtb__verdict')).toHaveText(/Critical low|Low/);
    const mono = await table.evaluate(el => [...el.querySelectorAll('*')]
      .filter(e => /mono|courier|menlo/i.test(getComputedStyle(e).fontFamily)).length);
    expect(mono).toBe(0);

    await bands.first().scrollIntoViewIfNeeded();
    await shoot(page, 'ranges-1440-table');
    await table.locator('.rtb__try').scrollIntoViewIfNeeded();
    await shoot(page, 'ranges-1440-tester');

    // "Advanced" still reaches the grid (read-only check, then back).
    await page.getByRole('button', { name: /Advanced — edit every field/ }).first().click();
    await expect(page.locator('.pf-rrgrid').first()).toBeVisible();
    await page.getByRole('button', { name: 'Back to the simple table' }).first().click();

    // Phones: 44px fields, no sideways scroll.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(400);
    await bands.first().scrollIntoViewIfNeeded();
    await shoot(page, 'ranges-375-table');
    await table.locator('.rtb__in--try').fill('6');
    await table.getByRole('radio', { name: 'Woman' }).click();
    await table.locator('.rtb__in--tage').fill('35');
    await table.locator('.rtb__try').scrollIntoViewIfNeeded();
    const val = await table.locator('.rtb__in--try').boundingBox();
    expect(val!.height).toBeGreaterThanOrEqual(44);
    const overflow = await table.evaluate(el => {
      const card = (el.closest('.nd-card__body') ?? document.body).getBoundingClientRect();
      return Math.max(0, ...[...el.querySelectorAll('.rtb__table td, .rtb__table input, .rtb__head, .rtb__try')]
        .map(t => t.getBoundingClientRect().right - card.right));
    });
    expect(overflow).toBeLessThanOrEqual(1);
    await shoot(page, 'ranges-375-tester');
  });
});
