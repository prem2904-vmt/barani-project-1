import type { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect, isPhone, expectNoHorizontalScroll } from './support/form-factor';
import { resetNeg, installNegBackend, go, neg, visible } from './support/neg-backend';

/**
 * Reports v2 (owner 2026-11-19): Test Master's frame on /reports — band = lab + search, LEFT side card STATUS (dots +
 * counts), RIGHT main card = the reports grid (# · Patient · Order · Status · Generated · Sent · Actions); "Unpaid"
 * under the pill; partly-reported orders open inline. ≤900px the filter is a menu under the filter button inside the
 * search; ≤640px two-line rows, a tap opens the actions sheet. Every form factor, light + dark. API mocked, fake data.
 * Screenshots: SHOTS_DIR/<project>/reports-v2-*.png
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/reports-v2');

const now = new Date();
const iso = (m: number) => new Date(now.getTime() - m * 60000).toISOString();
const today = iso(0).slice(0, 10);
const pat = (n: number, name: string, age: number, sex: string) => ({ displayName: name, age, sex, mrn: `AA00${String(n).padStart(2, '0')}`, phone: '+919876543210' });
const rep = (n: number, name: string, age: number, sex: string, deliveryStatus: string, extra: Record<string, unknown> = {}) => ({
  id: `rq-${n}`, orderId: `ord-${n}`, patientId: `p${n}`, type: 'final', status: 'generated', deliveryStatus, qrToken: `tok-${n}`,
  createdAt: iso(10 + n * 9), order: { id: `ord-${n}`, orderNumber: `LAB-2611-0001${String(n).padStart(2, '0')}`, dailyNo: n, dailyNoDay: today, patient: pat(n, name, age, sex) },
  ...extra,
});
const QUEUE = [
  rep(1, 'Ms. Arya Stark', 30, 'F', 'pending'),
  rep(2, 'Mr. Prem Kumar K', 30, 'M', 'pending', { type: 'partial' }),
  rep(3, 'Mr. Sathish Kumar', 29, 'M', 'pending'),
  rep(4, 'Nithin Ragav G', 32, 'M', 'delivered', { deliveredVia: 'whatsapp' }),
  rep(6, 'Baby Leo S', 1, 'M', 'failed', { deliveryNote: 'Number not on WhatsApp' }),
  rep(7, 'Ms. Sansa Stark', 28, 'F', 'delivered', { deliveredVia: 'print' }),
  rep(8, 'Master Sasi Kumar', 9, 'M', 'pending'),
  // An older order: its daily chip carries the day ("21 · 15 Nov") and Generated a date.
  rep(21, 'Ms. Priya Older', 41, 'F', 'pending', { createdAt: '2026-11-15T09:15:00Z', order: { id: 'ord-21', orderNumber: 'LAB-2611-000016', dailyNo: 21, dailyNoDay: '2026-11-15', patient: pat(21, 'Ms. Priya Older', 41, 'F') } }),
];
const HB = JSON.stringify({ parameters: [{ name: 'hb', title: 'Haemoglobin', unit: 'g/dL' }, { name: 'wbc', title: 'WBC count', unit: '/µL' }] });
const GLU = JSON.stringify({ parameters: [{ name: 'glu', title: 'Glucose, fasting', unit: 'mg/dL' }] });
const PARTIAL = {
  id: 'ord-5', orderNumber: 'LAB-2611-000105', dailyNo: 5, dailyNoDay: today, createdAt: iso(70), patient: pat(5, 'Mr. Sam Altman', 32, 'M'),
  samples: [
    { id: 's5a', status: 'received', departmentId: 'hae', department: { id: 'hae', name: 'Haematology', code: 'HAE' }, tests: [
      { id: 't5a', status: 'validated', test: { name: 'Complete Blood Count', parameters: HB },
        currentResult: JSON.stringify({ values: { hb: '11.4', wbc: '12800' }, flagged: { hb: { flag: 'L', range: '13–17' }, wbc: { flag: 'H', range: '4000–11000' } } }) }] },
    { id: 's5b', status: 'received', departmentId: 'bio', department: { id: 'bio', name: 'Biochemistry', code: 'BIO' }, tests: [
      { id: 't5b', status: 'validated', test: { name: 'Glucose', parameters: GLU }, currentResult: JSON.stringify({ values: { glu: '96' } }) }] },
    { id: 's5c', status: 'received', departmentId: 'imm', department: { id: 'imm', name: 'Immunology', code: 'IMM' }, tests: [
      { id: 't5c', status: 'in_progress', test: { name: 'Thyroid profile', parameters: JSON.stringify({ parameters: [] }) }, currentResult: null }] },
  ],
};
const DOT = { completed: 'violet', partial: 'sky', delivered: 'green', failed: 'rose' };

function queuePage(url: URL) {
  const status = url.searchParams.get('status') ?? 'all';
  const rows = QUEUE.filter(r => status === 'all' || r.deliveryStatus === status);
  const n = (s: string) => QUEUE.filter(r => r.deliveryStatus === s).length;
  return { items: rows, total: rows.length, page: 1, pageSize: 50, hasMore: false, counts: { all: QUEUE.length, pending: n('pending'), delivered: n('delivered'), failed: n('failed') } };
}

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(240_000);
  resetNeg();
  neg.bills = [{ orderId: 'ord-3', balance: 200 }];
  neg.hook = r => {
    if (r.method !== 'GET') return undefined;
    const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
    if (r.path === '/api/reports/queue') return undefined; // answered below (needs the query string)
    if (r.path === '/api/orders/partial-ready') return ok([PARTIAL]);
    return undefined;
  };
  await installNegBackend(page, context);
  // The queue needs its query string (status tab): a route registered after the backend's runs first.
  await page.route(/prefrontal\.health\/api\/reports\/queue/, async route => {
    const origin = route.request().headers()['origin'] ?? 'http://127.0.0.1';
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'content-type': 'application/json' },
      body: JSON.stringify({ success: true, data: queuePage(new URL(route.request().url())) }) });
  });
});

async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
}
const isNarrow = (page: Page) => (page.viewportSize()?.width ?? 1440) <= 900;
const shot = async (page: Page, project: string, name: string) => {
  const OUT = path.join(OUT_BASE, project); fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/reports-v2-${name}.png` });
};

async function open(page: Page, dark: boolean) {
  await go(page, '/reports');
  await theme(page, dark);
  await expect(visible(page, '[data-testid="rq-main"]')).toBeVisible({ timeout: 60_000 });
}

/** Pick a status: the side card (wide) or the filter menu inside the search (≤900px). */
async function pick(page: Page, label: string) {
  if (isNarrow(page)) {
    await visible(page, '[data-testid="rq-filter"]').click();
    await page.getByRole('menuitemradio', { name: new RegExp(`^${label}`) }).locator('visible=true').first().click();
    await expect(visible(page, '[data-testid="rq-filter"]')).toContainText(label);
  } else {
    await visible(page, `[data-testid="rq-side"] .pf-side-item:has-text("${label}")`).click();
  }
}

for (const dark of [false, true]) {
  const mode = dark ? 'dark' : 'light';

  test(`layout: side card left + same height, grid columns, status dots, Unpaid under the pill (${mode})`, async ({ page }, info) => {
    test.skip(isPhone(), 'phones get the two-line rows');
    await open(page, dark);
    await pick(page, 'All');
    await expect(visible(page, '.ag-row .pf-rq2-who__name:has-text("Ms. Arya Stark")')).toBeVisible({ timeout: 30_000 });
    // Band: lab + search only — no band-corner buttons on web.
    await expect(page.locator('pf-hero-band .pf-hb__actions button').locator('visible=true')).toHaveCount(0);
    if (!isNarrow(page)) {
      const side = await visible(page, '[data-testid="rq-side"]').boundingBox();
      const main = await visible(page, '[data-testid="rq-main"]').boundingBox();
      expect(side!.x + side!.width, 'side card is LEFT of the grid').toBeLessThanOrEqual(main!.x);
      expect(Math.abs(side!.y - main!.y), 'same top').toBeLessThanOrEqual(1);
      expect(Math.abs(side!.height - main!.height), 'same height').toBeLessThanOrEqual(2);
      const items = page.locator('[data-testid="rq-side"] .pf-side-item');
      await expect(items).toHaveCount(5);
      expect(await items.locator('.pf-rq2-side__label').allInnerTexts()).toEqual(['All', 'Completed', 'Partial', 'Delivered', 'Failed']);
      expect(await items.locator('.pf-rq2-side__count').allInnerTexts()).toEqual(['9', '5', '1', '2', '1']);
      await expect(items.nth(0).locator('.pf-rq2-dot--ring')).toHaveCount(1);
      // Head actions (not in the band): Generate (secondary) + Refresh.
      await expect(visible(page, '[data-testid="rq-main"] .pf-rq-generate')).toHaveClass(/pf-btn--secondary/);
      await expect(visible(page, '[data-testid="rq-main"] .pf-rq2-refresh')).toBeVisible();
    } else {
      await expect(page.locator('[data-testid="rq-side"]')).toHaveCount(0);
      await expect(visible(page, '[data-testid="rq-filter"]')).toBeVisible();
    }
    const heads = await page.locator('.ag-header-cell-text').locator('visible=true').allInnerTexts();
    const compact = (page.viewportSize()?.width ?? 1440) < 1280;
    expect(heads).toEqual(compact ? ['#', 'Patient', 'Status', 'Sent', 'Actions'] : ['#', 'Patient', 'Order', 'Status', 'Generated', 'Sent', 'Actions']);
    // The grid fits its card: no sideways scroll, the Actions column fully in view.
    // Pills: neutral background, a small coloured dot per status.
    for (const [key] of Object.entries(DOT)) {
      const pill = visible(page, `.ag-row .pf-rq2-pill[data-status="${key}"]`);
      await expect(pill, key).toBeVisible();
      const dot = await pill.locator('.pf-rq2-dot').evaluate(e => getComputedStyle(e).backgroundColor);
      expect(dot, `${key} dot has a colour`).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    }
    // Rows auto-size their height and animate into place: measure once they have settled.
    await page.waitForTimeout(800);
    // Unpaid is quiet text on its own line UNDER the pill (never side by side).
    const row = page.locator('.ag-row').filter({ hasText: 'Mr. Sathish Kumar' }).locator('visible=true').first();
    const pill = await row.locator('.pf-rq2-pill').boundingBox();
    const unpaid = await row.locator('.pf-rq2-unpaid').boundingBox();
    expect(unpaid!.y, 'Unpaid sits under the pill').toBeGreaterThanOrEqual(pill!.y + pill!.height - 1);
    await expect(page.locator('.ag-row .pf-rq2-unpaid').locator('visible=true')).toHaveCount(1);
    // The # chip is never clipped; Order and Generated stay on ONE line.
    const old = page.locator('.ag-row').filter({ hasText: 'Ms. Priya Older' }).locator('visible=true').first();
    await expect(old.locator('.pf-dayno')).toContainText('21 · 15 Nov');
    const chip = await old.locator('.pf-dayno').boundingBox();
    const noCell = await old.locator('[col-id="no"]').boundingBox();
    expect(chip!.x + chip!.width, 'daily chip fits its cell').toBeLessThanOrEqual(noCell!.x + noCell!.width);
    if (!compact) {
      for (const col of ['order', 'generated']) {
        const h = await old.locator(`[col-id="${col}"] .pf-rq2-muted`).evaluate(e => e.getBoundingClientRect().height);
        expect(h, `${col} is one line`).toBeLessThan(24);
      }
    }
    // Actions are right-aligned in the last column: View · Download · Share ▾ · ⋯.
    const actHead = await visible(page, '.ag-header-cell[col-id="actions"]').boundingBox();
    const mainBox = await visible(page, '[data-testid="rq-main"]').boundingBox();
    expect(actHead!.x + actHead!.width, 'the Actions column ends inside the card').toBeLessThanOrEqual(mainBox!.x + mainBox!.width + 1);
    const lastBtn = await row.locator('.pf-rq-more').boundingBox();
    expect(lastBtn!.x + lastBtn!.width, 'the ⋯ is fully in view').toBeLessThanOrEqual(mainBox!.x + mainBox!.width);
    const firstBtn = await row.locator('.pf-rowact[aria-label="View"]').boundingBox();
    expect(Math.abs((firstBtn!.y + firstBtn!.height / 2) - (lastBtn!.y + lastBtn!.height / 2)), 'the row actions sit on ONE line').toBeLessThanOrEqual(3);
    const acts = row.locator('.pf-rq2-acts');
    await expect(acts.locator('.pf-rowact[aria-label="View"]')).toBeVisible();
    await expect(acts.locator('.pf-rowact[aria-label="Download"]')).toBeVisible();
    await expect(acts.locator('.pf-rq-split__face')).toBeVisible();
    await expect(acts.locator('.pf-rq-more')).toBeVisible();
    await expectNoHorizontalScroll(page, `reports ${mode}`);
    if (dark) {
      // Dark: the grid takes the card's surface (no stock grey slab): transparent rows + wrapper.
      const bgs = await page.evaluate(() => ['.ag-root-wrapper', '.ag-row'].map(s => getComputedStyle(document.querySelector(s)!).backgroundColor));
      expect(bgs, 'grid surfaces are the card').toEqual(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);
    }
    await shot(page, info.project.name, `all-${mode}`);
  });

  test(`partial order expands inline with Generate partial PDF at the top (${mode})`, async ({ page }, info) => {
    test.skip(isPhone(), 'phones: the sheet carries the breakdown');
    await open(page, dark);
    await pick(page, 'Partial');
    const row = page.locator('.ag-row').filter({ hasText: 'Mr. Sam Altman' }).locator('visible=true').first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    const details = row.locator('.pf-rq2-details');
    await expect(details).toHaveAttribute('aria-expanded', 'false');
    await details.click();
    await expect(details).toHaveAttribute('aria-expanded', 'true');
    const detail = visible(page, '[data-testid="rq-detail"]');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('Haematology');
    await expect(detail).toContainText('Biochemistry');
    await expect(detail).toContainText('Still pending');
    const gen = await detail.locator('.pf-rq-genpartial').boundingBox();
    const dept = await detail.locator('.pf-rq-dept').first().boundingBox();
    expect(gen!.y + gen!.height, 'Generate partial PDF is at the top').toBeLessThanOrEqual(dept!.y + 1);
    // Departments side by side (flat).
    const depts = detail.locator('.pf-rq-dept');
    const b0 = await depts.nth(0).boundingBox(), b1 = await depts.nth(1).boundingBox();
    if (!isNarrow(page)) expect(Math.abs(b0!.y - b1!.y), 'side by side').toBeLessThanOrEqual(1);
    expect(await depts.nth(0).evaluate(e => getComputedStyle(e).borderTopWidth)).toBe('0px');
    await shot(page, info.project.name, `partial-${mode}`);
    await details.click();
    await expect(page.locator('[data-testid="rq-detail"]')).toHaveCount(0);
  });

  test(`filter: side card or the filter menu under the search button (${mode})`, async ({ page }, info) => {
    await open(page, dark);
    if (isNarrow(page)) {
      const btn = visible(page, '[data-testid="rq-filter"]');
      await expect(btn).toContainText('Completed');
      await btn.click();
      const menu = visible(page, '.pf-am-panel[role=menu]');
      await expect(menu).toBeVisible();
      await expect(page.locator('.pf-am-panel--sheet')).toHaveCount(0);
      const b = await btn.boundingBox(), m = await menu.boundingBox();
      expect(m!.y, 'the menu opens right under the button').toBeGreaterThanOrEqual(b!.y + b!.height - 1);
      expect(m!.y - (b!.y + b!.height), 'anchored').toBeLessThanOrEqual(16);
      await page.waitForTimeout(500);   // the menu's open motion (scale) has settled
      const rows = page.locator('.pf-am-panel [role=menuitemradio]');
      await expect(rows).toHaveCount(5);
      for (let i = 0; i < 5; i++) expect((await rows.nth(i).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expect(rows.filter({ hasText: 'Completed' })).toHaveAttribute('aria-checked', 'true');
      await expect(rows.first().locator('.pf-am-item__dot--ring')).toHaveCount(1);
      await shot(page, info.project.name, `filter-menu-${mode}`);
      await page.keyboard.press('Escape');
      await expect(page.locator('.pf-am-panel')).toHaveCount(0);
    }
    await pick(page, 'Failed');
    const names = isPhone() ? '.pf-rq2-prow__name' : '.ag-row .pf-rq2-who__name';
    await expect(visible(page, `${names}:has-text("Baby Leo S")`)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(names).locator('visible=true')).toHaveCount(1);
  });

  test(`phone: rows fold to two lines; a tap opens the actions sheet (${mode})`, async ({ page }, info) => {
    test.skip(!isPhone(), 'phones only');
    await open(page, dark);
    await pick(page, 'All');
    const row = visible(page, '.pf-rq2-prow:has-text("Mr. Sathish Kumar")');
    await expect(row).toBeVisible({ timeout: 30_000 });
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(64);
    await expect(row.locator('.pf-rq2-prow__l2')).toContainText('Unpaid');
    await expect(row.locator('.pf-rq2-pill')).toContainText('Completed');
    // Band: Refresh icon; search with the filter button inside.
    await expect(visible(page, 'pf-hero-band .pf-rq2-bandrefresh')).toBeVisible();
    await expectNoHorizontalScroll(page, `reports phone ${mode}`);
    await shot(page, info.project.name, `phone-list-${mode}`);
    await row.click();
    const sheet = visible(page, '[data-testid="rq-sheet"]');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Unpaid — collect the balance before handing over');
    await expect(sheet.locator('.pf-btn--primary')).toHaveCount(1);
    await expect(sheet.locator('[data-testid="rq-sheet-primary"]')).toHaveText(/Share on WhatsApp|Print/);
    await expect(sheet.getByRole('button', { name: 'View', exact: true })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
    await expect(sheet.locator('.pf-rq2-sheet__item[data-action="regenerate"]')).toBeVisible();
    // Nothing of the sheet hides behind the bottom nav (measured once its rise has settled).
    await page.waitForTimeout(700);
    const navTop = await page.evaluate(() => window.innerHeight - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pf-nav-h')) || 0));
    expect((await sheet.boundingBox())!.y + (await sheet.boundingBox())!.height).toBeLessThanOrEqual(navTop + 1);
    await shot(page, info.project.name, `phone-sheet-${mode}`);
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('[data-testid="rq-sheet"]')).toHaveCount(0);
    // A partly-reported order: its departments + Generate partial PDF in the sheet.
    await visible(page, '.pf-rq2-prow:has-text("Mr. Sam Altman")').click();
    await expect(visible(page, '[data-testid="rq-sheet"] [data-testid="rq-detail"]')).toContainText('Haematology');
    await expect(visible(page, '[data-testid="rq-sheet"] .pf-rq-genpartial')).toBeVisible();
    await shot(page, info.project.name, `phone-partial-${mode}`);
  });
}

test('1720px: all seven columns, Order + Generated on one line, the daily chip whole (light + dark)', async ({ page }, info) => {
  test.skip(!['desktop', 'desktop-app'].includes(info.project.name), 'wide desktop only');
  await page.setViewportSize({ width: 1720, height: 1000 });
  await open(page, false);
  await pick(page, 'All');
  const old = page.locator('.ag-row').filter({ hasText: 'Ms. Priya Older' }).locator('visible=true').first();
  await expect(old).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  expect(await page.locator('.ag-header-cell-text').locator('visible=true').allInnerTexts()).toEqual(['#', 'Patient', 'Order', 'Status', 'Generated', 'Sent', 'Actions']);
  for (const col of ['order', 'generated']) {
    expect(await old.locator(`[col-id="${col}"] .pf-rq2-muted`).evaluate(e => e.getBoundingClientRect().height), col).toBeLessThan(24);
  }
  const chip = await old.locator('.pf-dayno').boundingBox(), cell = await old.locator('[col-id="no"]').boundingBox();
  expect(chip!.x + chip!.width).toBeLessThanOrEqual(cell!.x + cell!.width);
  await shot(page, info.project.name, 'all-1720-light');
  await theme(page, true);
  await shot(page, info.project.name, 'all-1720-dark');
});

test('actions keep their behaviour: View opens the report, ⋯ lists every action, Share ▾ offers the channels', async ({ page }) => {
  test.skip(isPhone(), 'phones: the sheet');
  await open(page, false);
  await pick(page, 'All');
  const row = page.locator('.ag-row').filter({ hasText: 'Ms. Arya Stark' }).locator('visible=true').first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.locator('.pf-rq-split__caret').click();
  const share = visible(page, '.pf-rq-menu[role=menu]');
  await expect(share).toBeVisible();
  await expect(share.getByRole('menuitem', { name: 'Print' })).toBeVisible();
  await visible(page, '.pf-rq-menu__bd').click();
  await row.locator('.pf-rq-more').click();
  const menu = visible(page, '.pf-am-panel[role=menu]');
  await expect(menu).toContainText('Copy patient link');
  await expect(menu).toContainText('Regenerate');
  await expect(menu).toContainText('Open patient');
  await page.keyboard.press('Escape');
  await expect(page.locator('.pf-am-panel')).toHaveCount(0);
  await row.locator('.pf-rowact[aria-label="View"]').click();
  await expect(page).toHaveURL(/\/reports\/view\/rq-1/);
});
