import type { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect, isPhone, expectNoHorizontalScroll } from './support/form-factor';
import { resetNeg, installNegBackend, go, neg, visible } from './support/neg-backend';

/**
 * Results FILTERS (owner 2026-11-20: "just like the Expenses filter, rather than 'To send'"): the LEFT side card is
 * Filters — Dates (IST) presets + From / To, a Status breakdown (dot · count · share bar; tap filters, tap again
 * clears), the To send groups, Referring doctor + Delivered via (pf-select) — and the main card head carries "N of M"
 * and Send all. ≤900px the same card is a sheet from ONE Filters button inside the search. API mocked, fake data.
 * Screenshots: SHOTS_DIR/<project>/rq-filters-*.png
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/rq-filters');

const now = new Date();
const iso = (m: number) => new Date(now.getTime() - m * 60000).toISOString();
const istDay = (m: number) => new Date(now.getTime() - m * 60000 + 330 * 60000).toISOString().slice(0, 10);
const DAY = 24 * 60;
const pat = (n: number, name: string, age: number, sex: string) => ({ displayName: name, age, sex, mrn: `AA00${String(n).padStart(2, '0')}`, phone: '+919876543210' });
const rep = (n: number, name: string, deliveryStatus: string, mins: number, doctor: string | null, extra: Record<string, unknown> = {}) => ({
  id: `rq-${n}`, orderId: `ord-${n}`, patientId: `p${n}`, type: 'final', status: 'generated', deliveryStatus, qrToken: `tok-${n}`,
  createdAt: iso(mins), order: { id: `ord-${n}`, orderNumber: `LAB-2611-0001${String(n).padStart(2, '0')}`, dailyNo: n, dailyNoDay: istDay(mins), refDoctorName: doctor, patient: pat(n, name, 30 + n, n % 2 ? 'F' : 'M') },
  ...extra,
});
const QUEUE = [
  rep(1, 'Ms. Arya Stark', 'pending', 20, 'Dr. Meena Raghavan'),
  rep(2, 'Mr. Prem Kumar K', 'pending', 35, 'Dr. Arun Kumar', { type: 'partial' }),
  rep(3, 'Mr. Sathish Kumar', 'pending', 50, 'Dr. Arun Kumar'),
  rep(4, 'Nithin Ragav G', 'delivered', 70, 'Dr. Meena Raghavan', { deliveredVia: 'whatsapp' }),
  rep(6, 'Baby Leo S', 'failed', 90, null, { deliveryNote: 'Number not on WhatsApp' }),
  rep(7, 'Ms. Sansa Stark', 'delivered', DAY + 30, 'Dr. Arun Kumar', { deliveredVia: 'print' }),
  rep(8, 'Master Sasi Kumar', 'pending', DAY + 60, 'Dr. Meena Raghavan'),
  rep(9, 'Ms. Lakshmi Narayanan Subramaniam', 'pending', 3 * DAY, null),
  rep(10, 'Mr. Ravi Shankar Venkataraman', 'delivered', 12 * DAY, 'Dr. Meena Raghavan', { deliveredVia: 'email' }),
  rep(21, 'Ms. Priya Older', 'pending', 45 * DAY, 'Dr. Arun Kumar'),
];
const HB = JSON.stringify({ parameters: [{ name: 'hb', title: 'Haemoglobin', unit: 'g/dL' }] });
const PARTIAL = {
  id: 'ord-5', orderNumber: 'LAB-2611-000105', dailyNo: 5, dailyNoDay: istDay(0), createdAt: iso(60), refDoctorName: 'Dr. Meena Raghavan', patient: pat(5, 'Mr. Sam Altman', 32, 'M'),
  samples: [
    { id: 's5a', status: 'received', departmentId: 'hae', department: { id: 'hae', name: 'Haematology', code: 'HAE' }, tests: [
      { id: 't5a', status: 'validated', test: { name: 'Complete Blood Count', parameters: HB }, currentResult: JSON.stringify({ values: { hb: '11.4' } }) }] },
    { id: 's5c', status: 'received', departmentId: 'imm', department: { id: 'imm', name: 'Immunology', code: 'IMM' }, tests: [
      { id: 't5c', status: 'in_progress', test: { name: 'Thyroid profile', parameters: JSON.stringify({ parameters: [] }) }, currentResult: null }] },
  ],
};

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
    if (r.path === '/api/orders/partial-ready') return { status: 200, body: { success: true, data: [PARTIAL] } };
    return undefined;
  };
  await installNegBackend(page, context);
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
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/rq-filters-${name}.png` });
};
async function open(page: Page, dark: boolean) {
  await go(page, '/reports');
  await theme(page, dark);
  await expect(visible(page, '[data-testid="rq-main"]')).toBeVisible({ timeout: 60_000 });
}
/** The filter card: the side card (wide) or the sheet (≤900px, opened here). */
async function card(page: Page) {
  if (!isNarrow(page)) return visible(page, '[data-testid="rq-side"]');
  if (!(await page.locator('[data-testid="rq-filters-sheet"]').count())) await visible(page, '[data-testid="rq-filters-btn"]').click();
  const sheet = visible(page, '[data-testid="rq-filters-sheet"]');
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(500);   // the rise has settled
  return sheet;
}
async function closeSheet(page: Page) {
  if (!isNarrow(page)) return;
  await visible(page, '[data-testid="rq-filters-sheet"] [aria-label="Close filters"]').click();
  await expect(page.locator('[data-testid="rq-filters-sheet"]')).toHaveCount(0);
}
const names = (page: Page) => page.locator(isPhone() ? '.pf-rq2-prow__name' : '.ag-row .pf-rq2-who__name').locator('visible=true');

/** Nothing in the card is clipped sideways; every control is ≥ 44px tall on touch; the head is one row. */
async function auditCard(page: Page, sel: string) {
  const bad = await page.evaluate(s => {
    const host = [...document.querySelectorAll<HTMLElement>(s)].find(e => e.getBoundingClientRect().width > 0)!;
    const box = host.getBoundingClientRect();
    const out: string[] = [];
    const touch = matchMedia('(pointer: coarse)').matches;
    for (const el of host.querySelectorAll<HTMLElement>('button, pf-select, pf-date, .pf-rq2-f__totname')) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      if (r.left < box.left - 0.5 || r.right > box.right + 0.5) out.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 20)}" overflows the card`);
      if (touch && el.tagName === 'BUTTON' && r.height < 43.5 && !el.closest('.pf-seg')) out.push(`button "${(el.textContent ?? '').trim().slice(0, 20)}" is ${Math.round(r.height)}px tall on touch`);
    }
    const head = host.querySelector<HTMLElement>('.pf-card__head')!.getBoundingClientRect();
    // One row: every head item shares the first line (a 44px touch control makes the head ~68px, which is fine).
    const tops = [...host.querySelector<HTMLElement>('.pf-card__head')!.children].map(e => (e as HTMLElement).getBoundingClientRect()).filter(r => r.width > 0);
    if (tops.some(r => r.top > head.top + head.height / 2)) out.push(`head wraps (${Math.round(head.height)}px)`);
    return out;
  }, sel);
  expect(bad, 'filter card audit').toEqual([]);
}

for (const dark of [false, true]) {
  const mode = dark ? 'dark' : 'light';

  test(`Filters card: dates, status + To send breakdowns, doctor / channel selects; head "N of M" + Send all (${mode})`, async ({ page }, info) => {
    await open(page, dark);
    await expect(names(page).first()).toBeVisible({ timeout: 30_000 });
    // The old To send card, chip and status menu are gone.
    await expect(page.locator('[data-testid="rq-tosend-chip"], [data-testid="rq-filter"], [data-testid="rq-pill"]')).toHaveCount(0);
    const head = visible(page, '[data-testid="rq-main"] .pf-card__head');
    await expect(head.locator('[data-testid="rq-send-all"]')).toBeVisible();
    expect((await head.boundingBox())!.height, 'main head is one row').toBeLessThanOrEqual(64);
    if (!isNarrow(page)) {
      const side = await visible(page, '[data-testid="rq-side"]').boundingBox();
      const main = await visible(page, '[data-testid="rq-main"]').boundingBox();
      expect(side!.x + side!.width, 'filters LEFT of the grid').toBeLessThanOrEqual(main!.x);
      expect(Math.abs(side!.height - main!.height), 'same height').toBeLessThanOrEqual(2);
      await expect(head.locator('.pf-rq2-count')).toHaveText('6 of 11');   // Completed (default) of 10 reports + 1 order
    } else {
      await expect(visible(page, '[data-testid="rq-filters-n"]')).toHaveText('1');
    }
    await expectNoHorizontalScroll(page, `results ${mode}`);
    await shot(page, info.project.name, `default-${mode}`);

    const c = await card(page);
    await expect(c.locator('.pf-card__label')).toHaveText('Filters');
    expect(await c.locator('[data-testid="rq-dates"] [role=radio]').allInnerTexts()).toEqual(['All', 'Today', '7 days', 'This month']);
    expect(await c.locator('[data-testid="rq-statuses"] .pf-rq2-f__totname').allInnerTexts()).toEqual(['Completed', 'Partial', 'Delivered']);
    expect(await c.locator('[data-testid="rq-statuses"] .pf-rq2-f__totn').allInnerTexts()).toEqual(['6', '1', '3']);
    expect(await c.locator('[data-testid="rq-tosend"] .pf-rq2-f__totname').allInnerTexts()).toEqual(['Not sent yet', 'WhatsApp failed']);
    await expect(c.locator('pf-select[data-testid="rq-doctor"]')).toHaveCount(1);
    await expect(c.locator('pf-select[data-testid="rq-via"]')).toHaveCount(1);
    await expect(c.locator('select, datalist, input[type=date]:not(.pf-date__native)')).toHaveCount(0);
    await auditCard(page, isNarrow(page) ? '[data-testid="rq-filters-sheet"]' : '[data-testid="rq-side"]');
    if (isNarrow(page)) {
      // Nothing of the sheet hides behind the bottom nav.
      const navTop = await page.evaluate(() => window.innerHeight - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pf-nav-h')) || 0));
      const b = (await c.boundingBox())!;
      expect(b.y + b.height, 'sheet above the nav').toBeLessThanOrEqual(navTop + 1);
      await shot(page, info.project.name, `sheet-${mode}`);
    }

    // Today + Delivered: the grid narrows, the breakdown follows the dates, Clear shows up, Send all has nothing.
    await c.locator('[data-testid="rq-dates"] [data-preset="today"]').click();
    await expect(c.locator('[data-testid="rq-statuses"] .pf-rq2-f__totn')).toHaveText(['3', '1', '1']);
    await c.locator('[data-filter="delivered"]').click();
    await expect(c.locator('[data-filter="delivered"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(c.locator('[data-testid="rq-clear"]')).toBeVisible();
    await auditCard(page, isNarrow(page) ? '[data-testid="rq-filters-sheet"]' : '[data-testid="rq-side"]');
    if (isNarrow(page)) await shot(page, info.project.name, `sheet-today-${mode}`);
    await closeSheet(page);
    await expect(names(page)).toHaveText(['Nithin Ragav G'], { timeout: 10_000 });
    await expect(visible(page, '[data-testid="rq-main"] [data-testid="rq-send-all"]')).toBeDisabled();
    if (!isNarrow(page)) await expect(head.locator('.pf-rq2-count')).toHaveText('1 of 11');
    else await expect(visible(page, '[data-testid="rq-filters-n"]')).toHaveText('2');
    await expectNoHorizontalScroll(page, `results today ${mode}`);
    await shot(page, info.project.name, `today-delivered-${mode}`);

    // Doctor (pf-select) on top of 7 days: combined.
    const c2 = await card(page);
    await c2.locator('[data-filter="delivered"]').click();                  // tap again = clear
    await expect(c2.locator('[data-filter="delivered"]')).toHaveAttribute('aria-pressed', 'false');
    await c2.locator('[data-testid="rq-dates"] [data-preset="7d"]').click();
    await c2.locator('pf-select[data-testid="rq-doctor"] .pf-dd__trigger').click();
    await page.getByRole('option', { name: 'Dr. Meena Raghavan' }).locator('visible=true').first().click();
    await expect(c2.locator('[data-testid="rq-statuses"] .pf-rq2-f__totn')).toHaveText(['2', '1', '1']);
    await shot(page, info.project.name, `combined-card-${mode}`);
    await closeSheet(page);
    await expect(names(page)).toHaveCount(4, { timeout: 10_000 });   // Sam Altman (order) + Arya, Nithin, Sasi
    await shot(page, info.project.name, `combined-${mode}`);

    // Clear resets every filter.
    const c3 = await card(page);
    await c3.locator('[data-testid="rq-clear"]').click();
    await expect(c3.locator('[data-testid="rq-clear"]')).toHaveCount(0);
    await closeSheet(page);
    await expect(names(page)).toHaveCount(11, { timeout: 10_000 });
  });

  test(`To send: the group filters the grid; Retry / Send ride in the row; Send all in the head (${mode})`, async ({ page }, info) => {
    test.skip(isPhone(), 'phones: a row tap opens its sheet (Share on WhatsApp)');
    await open(page, dark);
    const c = await card(page);
    await c.locator('[data-filter="notsent"]').click();
    await closeSheet(page);
    await expect(names(page)).toHaveCount(5, { timeout: 10_000 });
    await expect(visible(page, '.ag-row [data-report="rq-1"] .pf-rq2-q__send')).toHaveText('Send');
    await expect(visible(page, '[data-testid="rq-main"] [data-testid="rq-scope"]')).toHaveText('Not sent yet');
    await expectNoHorizontalScroll(page, `results notsent ${mode}`);
    // Row controls stay inside the card (touch: ≥44px).
    const cut = await page.evaluate(() => {
      const main = document.querySelector('[data-testid="rq-main"]')!.getBoundingClientRect();
      const out: string[] = [];
      for (const b of Array.from(document.querySelectorAll<HTMLElement>('.ag-row button'))) {
        const r = b.getBoundingClientRect();
        if (!r.width) continue;
        if (r.right > main.right - 1) out.push(`${b.textContent?.trim() || b.getAttribute('aria-label')} clipped`);
        if (matchMedia('(pointer: coarse)').matches && r.height < 43.5) out.push(`${b.textContent?.trim() || b.getAttribute('aria-label')} ${Math.round(r.height)}px`);
      }
      return out;
    });
    expect(cut, 'row controls').toEqual([]);
    await page.waitForTimeout(600);
    await shot(page, info.project.name, `notsent-${mode}`);
  });
}

for (const dark of [false, true]) {
  const mode = dark ? 'dark' : 'light';
  test(`column filters in the header: funnels visible, Status bound to the card, Patient text filter, alignment (${mode})`, async ({ page }, info) => {
    test.skip(isPhone(), 'phones: two-line rows (no grid header)');
    await open(page, dark);
    await expect(names(page).first()).toBeVisible({ timeout: 30_000 });
    const btn = (id: string) => visible(page, `.ag-header-cell[col-id="${id}"] .ag-header-cell-filter-button`);
    for (const id of ['no', 'patient', 'status', 'actions']) {
      if (id === 'actions') await expect(page.locator('.ag-header-cell[col-id="actions"] .ag-header-cell-filter-button')).toHaveCount(0);
      else await expect(btn(id), `${id} funnel`).toBeVisible();
    }
    // Alignment: the status pill centred in its cell, the header label centred; the name left.
    const al = await page.evaluate(() => {
      const cell = [...document.querySelectorAll<HTMLElement>('.ag-row .ag-cell[col-id="status"]')].find(e => e.getBoundingClientRect().width > 0)!;
      const pill = cell.querySelector<HTMLElement>('.pf-rq2-pill')!.getBoundingClientRect(), c = cell.getBoundingClientRect();
      const name = document.querySelector<HTMLElement>('.ag-row .ag-cell[col-id="patient"] .pf-rq2-who__name')!.getBoundingClientRect();
      const pc = document.querySelector<HTMLElement>('.ag-row .ag-cell[col-id="patient"]')!.getBoundingClientRect();
      return { pillOff: Math.abs((pill.left + pill.width / 2) - (c.left + c.width / 2)), nameLeft: name.left - pc.left };
    });
    expect(al.pillOff, 'status pill centred').toBeLessThanOrEqual(3);
    expect(al.nameLeft, 'patient name left').toBeLessThanOrEqual(14);
    // Status header filter: the side card's choices; picking one presses the side-card row (one state).
    await btn('status').click();
    const pop = visible(page, '.pf-gcf');
    await expect(pop).toBeVisible();
    await expect(pop.locator('[role=radio][aria-checked="true"]')).toHaveAttribute('data-value', 'pending');
    for (const b of await pop.locator('[role=radio]').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.waitForTimeout(300);
    await shot(page, info.project.name, `col-status-${mode}`);
    await pop.locator('[data-value="delivered"]').click();
    await page.keyboard.press('Escape');
    await expect(names(page)).toHaveCount(3, { timeout: 10_000 });
    if (!isNarrow(page)) await expect(visible(page, '[data-testid="rq-side"] [data-filter="delivered"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.ag-header-cell[col-id="status"] .ag-header-cell-filter-button.ag-filter-active, .ag-header-cell-filtered[col-id="status"]').locator('visible=true').first()).toBeVisible();
    // Patient text filter (MRN) AND Delivered.
    await btn('patient').click();
    const input = page.locator('.ag-filter input[type="text"], .ag-filter input:not([type])').locator('visible=true').first();
    await input.fill('AA0007');
    await page.waitForTimeout(500);
    await shot(page, info.project.name, `col-patient-${mode}`);
    await page.keyboard.press('Escape');
    await expect(names(page)).toHaveText(['Ms. Sansa Stark'], { timeout: 10_000 });
    const count = page.locator('[data-testid="rq-main"] .pf-rq2-count');
    if (await count.isVisible()) await expect(count).toHaveText('1 of 11');   // the head's count gives way on a narrow head
    await expectNoHorizontalScroll(page, `results col filters ${mode}`);
    await shot(page, info.project.name, `col-filtered-${mode}`);
  });
}
