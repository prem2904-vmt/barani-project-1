import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * Test editor — reference ranges (ND-PATTERN §16, the simple model: H, L, CL,
 * CH and a report box). Signs in as the seeded Lab Admin, opens Haemoglobin
 * (HEM011 — sex/age groups, or $TEST_CODE / $TEST_ID), goes to Result entry
 * and checks the ONE compact table (Who · Age · L · H · CL · CH · Report
 * text), the one-line tester at 1440, and the group cards at 375.
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

test.describe('Test editor — reference ranges: H, L, CL, CH and a report box', () => {
  test('Who · Age · L · H · CL · CH · Report text at 1440, cards at 375 (read-only)', async ({ page }) => {
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
    // ONE table; no chips, bars, zones, AG-Grid or footnotes.
    await expect(table.locator('table.rtb__table')).toHaveCount(1);
    await expect(page.locator('pf-range-insight, .rin__bar, .pf-rrgrid, .rtb__flag, .rtb__chip, .rtb__warn')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Advanced — edit every field/ })).toHaveCount(0);
    await expect(table.locator('thead th')).toHaveText(['Who', 'Age', /^L/, 'H', 'CL', 'CH', 'Report text', /Remove/]);
    const rows = table.locator('tbody tr.rtb__row');
    expect(await rows.count()).toBeGreaterThanOrEqual(2);
    // Every row: four number boxes + the report text box (typed, or the fallback as placeholder).
    await expect(rows.first().locator('input.rtb__in--lim')).toHaveCount(4);
    const txt = rows.first().locator('input.rtb__in--text');
    expect(((await txt.inputValue()) || (await txt.getAttribute('placeholder')) || '').length).toBeGreaterThan(0);
    // Ages read in natural units — never fractional years.
    const ages = (await rows.locator('.rtb__agebtn span').allTextContents()).map(t => t.trim());
    for (const a of ages) expect(a).toMatch(/^(Any age|up to .+|[\d.]+(–[\d.]+)? (day|days|month|months|year|years)(\+)?( – [\d.]+ (day|days|month|months|year|years))?)$/);
    expect(ages.join(' ')).not.toMatch(/0\.0\d/);
    // Problems are one plain line under their row (legacy data included) —
    // never more than one line per group.
    expect(await table.locator('.rtb__msg').count()).toBeLessThanOrEqual(await rows.count());
    // Fits the Result entry card: no sideways scroll at 1440.
    const over1440 = await table.evaluate(el => {
      const card = (el.closest('.nd-card__body') ?? document.body).getBoundingClientRect();
      return Math.max(0, ...[...el.querySelectorAll('table, input, pf-select, .rtb__agebtn')].map(t => t.getBoundingClientRect().right - card.right));
    });
    expect(over1440).toBeLessThanOrEqual(1);

    // Try a value — one line: a woman of 35 with 6 g/dL.
    await table.locator('.rtb__in--try').fill('6');
    await table.locator('.rtb__sel--try').click();
    await page.locator('.pf-dd__option', { hasText: 'Female' }).first().click();
    await table.locator('.rtb__in--tage').fill('35');
    await expect(table.locator('.rtb__verdict')).toHaveText(/Critical low|Low/);
    const mono = await table.evaluate(el => [...el.querySelectorAll('*')]
      .filter(e => /mono|courier|menlo/i.test(getComputedStyle(e).fontFamily)).length);
    expect(mono).toBe(0);

    await table.scrollIntoViewIfNeeded();
    await shoot(page, 'ranges-1440-table');
    // The age editor opens under its row (natural units).
    await rows.first().locator('.rtb__agebtn').click();
    await expect(table.locator('.rtb__ageed')).toBeVisible();
    await shoot(page, 'ranges-1440-age');
    await rows.first().locator('.rtb__agebtn').click();

    // Phones: one card per group — who · age, then the report text; tap to edit; 44px / 16px; no sideways scroll.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(400);
    const cards = table.locator('.rtb__card');
    await expect(table.locator('table.rtb__table')).toHaveCount(0);
    expect(await cards.count()).toBeGreaterThanOrEqual(2);
    await expect(cards.first().locator('.rtb__l1')).toContainText('·');
    expect(((await cards.first().locator('.rtb__l2').textContent()) ?? '').trim().length).toBeGreaterThan(0);
    await cards.first().scrollIntoViewIfNeeded();
    await shoot(page, 'ranges-375-cards');
    await cards.first().locator('.rtb__cardhead').click();
    await expect(cards.first().locator('.rtb__grid2 input')).toHaveCount(4);
    await expect(cards.first().locator('input.rtb__in--text')).toHaveCount(1);
    const box = await cards.first().locator('.rtb__grid2 input').first().boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    const fs = await cards.first().locator('.rtb__grid2 input').first().evaluate(e => parseFloat(getComputedStyle(e).fontSize));
    expect(fs).toBeGreaterThanOrEqual(16);
    await cards.first().locator('.rtb__grid2').scrollIntoViewIfNeeded();
    await shoot(page, 'ranges-375-edit');
    const overflow = await table.evaluate(el => {
      const card = (el.closest('.nd-card__body') ?? document.body).getBoundingClientRect();
      return Math.max(0, ...[...el.querySelectorAll('.rtb__card, input, .rtb__try')]
        .map(t => t.getBoundingClientRect().right - card.right));
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
