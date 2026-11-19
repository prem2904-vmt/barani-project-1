import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, isPhone, expectLayout, shotsDir } from './support/form-factor';
import { neg, resetNeg, installNegBackend, go } from './support/neg-backend';

/**
 * Turnaround (/dashboard) and Day closing (/finance/daily), the 2026-11-19 redesign, on EVERY form factor, light + dark.
 * API mocked (a fake service: demo data only, the close endpoint only records what it was sent); the pages are the real app.
 * Screenshots: SHOTS_DIR/<form factor>/tat-*.png, closing-*.png
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/tat-closing');
const out = () => shotsDir(OUT_BASE);
const vis = (page: Page, sel: string) => page.locator(sel).locator('visible=true').first();
const narrow = (page: Page) => (page.viewportSize()?.width ?? 1440) <= 900;

async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
  await page.waitForTimeout(450);
}
/** Screenshot in light and dark; in each theme nothing on the screen may be yellow. */
async function shot(page: Page, name: string, root: string) {
  for (const dark of [false, true]) {
    await theme(page, dark);
    expect(await yellowOnes(page, root), `${name}: no yellow (${dark ? 'dark' : 'light'})`).toEqual([]);
    await page.screenshot({ path: `${out()}/${name}--${dark ? 'dark' : 'light'}.png` });
  }
  await theme(page, false);
}

/** Every visible element under `root` whose text, background or border colour is a yellow / amber. */
async function yellowOnes(page: Page, root: string): Promise<string[]> {
  return page.evaluate(sel => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const ctx = cv.getContext('2d', { willReadFrequently: true })!;
    const rgba = (c: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255];
    };
    const yellow = (c: string): boolean => {
      if (!c || c === 'transparent' || c.startsWith('rgba(0, 0, 0, 0')) return false;
      const [r, g, b, a] = rgba(c);
      if (a < 0.08) return false;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx - mn < 40 || mx < 110) return false;                    // grey or near-black
      const h = mx === r ? ((g - b) / (mx - mn)) * 60 : mx === g ? (2 + (b - r) / (mx - mn)) * 60 : (4 + (r - g) / (mx - mn)) * 60;
      const hue = (h + 360) % 360;
      return hue >= 36 && hue <= 66 && (mx - mn) / mx > 0.35;
    };
    const bad: string[] = [];
    for (const rootEl of document.querySelectorAll<HTMLElement>(sel)) {
      for (const e of [rootEl, ...rootEl.querySelectorAll<HTMLElement>('*')]) {
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const s = getComputedStyle(e);
        const hit = [['color', s.color], ['background', s.backgroundColor], ['border', s.borderTopWidth !== '0px' ? s.borderTopColor : '']].find(([, c]) => yellow(c));
        if (hit) bad.push(`${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)} ${hit[0]}=${hit[1]}`);
      }
    }
    return bad.slice(0, 8);
  }, root);
}

/** The page itself never scrolls (the cards do). */
async function expectNoPageScroll(page: Page, tag: string) {
  const over = await page.evaluate(() => {
    const d = document.scrollingElement ?? document.documentElement;
    return d.scrollHeight - d.clientHeight;
  });
  expect(over, `${tag}: the page does not scroll (px over)`).toBeLessThanOrEqual(1);
}

// ───────────────────────── demo data ─────────────────────────
const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60000).toISOString();
const line = (id: string, orderId: string, patient: string, testName: string, status: string, elapsed: number, remaining: number) => ({
  orderTestId: id, orderId, patient, test: testName, status, receivedAtLab: ago(elapsed), elapsedMinutes: elapsed, remainingMinutes: remaining,
  level: remaining < 0 ? 'urgent' : remaining <= 60 ? 'high' : 'normal',
});
const TAT_ROWS = [
  // Order A: three biochemistry tests in one tube, all late — ONE sample row.
  line('t1', 'ord-a', 'Ravi Kumar', 'Glucose fasting', 'pending', 300, -60),
  line('t2', 'ord-a', 'Ravi Kumar', 'Creatinine', 'in_progress', 300, -45),
  line('t3', 'ord-a', 'Ravi Kumar', 'Urea', 'awaiting_validation', 300, -30),
  // Order A's haematology tube is a second sample.
  line('t4', 'ord-a', 'Ravi Kumar', 'Complete blood count', 'entered', 300, -20),
  line('t5', 'ord-b', 'Asha Devi', 'Urine culture', 'in_progress', 600, -15),
  line('t6', 'ord-c', 'Meenakshi Sundaram', 'TSH', 'pending', 200, 40),
  line('t7', 'ord-d', 'John Paul', 'Lipid profile', 'in_progress', 30, 210),
  line('t8', 'ord-d', 'John Paul', 'HbA1c', 'received', 30, 450),
];
const DEPTS = [
  { id: 'd-bio', name: 'Biochemistry', isActive: true }, { id: 'd-hem', name: 'Haematology', isActive: true }, { id: 'd-mic', name: 'Microbiology', isActive: true },
];
const cat = (name: string, departmentId: string, parameters: string | null = null) => ({ id: name, name, departmentId, parameters });
const CATALOG = [
  cat('Glucose fasting', 'd-bio'), cat('Creatinine', 'd-bio'), cat('Urea', 'd-bio'), cat('TSH', 'd-bio'), cat('Lipid profile', 'd-bio'), cat('HbA1c', 'd-bio'),
  cat('Complete blood count', 'd-hem'), cat('Urine culture', 'd-mic', JSON.stringify({ microFormat: 'culture_sensitivity' })),
];

const istDay = (offset: number) => new Date(NOW + 330 * 60000 - offset * 86400000).toISOString().slice(0, 10);
const TODAY = istDay(0);
const PAY = [{ mode: 'upi', count: 9, total: 3200 }, { mode: 'cash', count: 6, total: 2750 }, { mode: 'card', count: 2, total: 900 }];
const REF = [{ mode: 'cash', count: 1, total: 250 }];
const closure = (id: string, day: number, variance: number, note: string | null, closedBy: string) => ({
  id, date: istDay(day), shift: null, openingBalance: 1500, expectedCash: 4000, countedCash: 4000 + variance, variance, note, closedBy,
  closedAt: new Date(NOW - day * 86400000).toISOString(), totalsJson: JSON.stringify({ payments: PAY, refunds: REF }),
});
const CLOSURES = [closure('c1', 1, 0, null, 'app-1'), closure('c2', 2, -20, 'Coins short', 'app-2'), closure('c3', 3, 100, 'Extra float', 'app-1')];
const statement = (date: string, c: unknown = null) => ({
  date, shift: null, openingBalance: 1500, payments: PAY, refunds: REF, totalCollected: 6850, totalRefunded: 250, net: 6600,
  cashCollected: 2750, cashRefunded: 250, expectedCash: 4000, closure: c,
});

/** What the fake close endpoint was sent, and the closure it then answers with. */
let closedToday: ReturnType<typeof closure> | null = null;

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(180_000);
  resetNeg();
  closedToday = null;
  neg.hook = r => {
    const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
    if (r.method === 'POST' && r.path === '/api/finance/close') {
      closedToday = { ...closure('c-new', 0, 0, r.body?.note ?? null, 'app-1'), countedCash: r.body.countedCash, variance: Math.round((r.body.countedCash - 4000) * 100) / 100 };
      return ok(closedToday);
    }
    if (r.method !== 'GET') return undefined;
    switch (r.path) {
      case '/api/dashboard/tat': return ok({ summary: { total: TAT_ROWS.length, urgent: 5, high: 1, normal: 2 }, rows: TAT_ROWS });
      case '/api/tenants/departments': return ok(DEPTS);
      case '/api/tests': return ok(CATALOG);
      case '/api/finance/closures': return ok(closedToday ? [closedToday, ...CLOSURES] : CLOSURES);
      default: return undefined;
    }
  };
  await installNegBackend(page, context);
  // Registered AFTER the shared backend so it answers first: the statement answers by ?date= (the shared mock sees the path only).
  await page.route(/\/api\/finance\/daily/, async (route, req) => {
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const date = new URL(req.url()).searchParams.get('date') ?? TODAY;
    const c = date === TODAY ? closedToday : CLOSURES.find(x => x.date === date) ?? null;
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ success: true, data: statement(date, c) }) });
  });
});

async function blurField(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(500);
}

// ───────────────────────── Turnaround ─────────────────────────
const RAW_STATUS = /in_progress|awaiting_validation|\bpending\b|\bentered\b|\breceived\b/;

async function openTat(page: Page) {
  await go(page, '/dashboard');
  await expect(vis(page, '[data-testid="tat-main"]')).toBeVisible({ timeout: 60_000 });
  await expect(vis(page, '[data-testid="tat-main"] .ag-row')).toBeVisible({ timeout: 30_000 });
}
/** Pick a bucket in the side card (in its sheet on a narrow screen). */
async function pickBucket(page: Page, id: string) {
  if (narrow(page)) await vis(page, '[data-testid="tat-sheet-chip"]').click();
  await vis(page, `[data-testid="tat-bucket-${id}"]`).click();
  await page.waitForTimeout(400);
}
const gridRows = (page: Page) => page.locator('[data-testid="tat-main"] .ag-cell[col-id="patient"]');
const gridText = (page: Page) => page.locator('[data-testid="tat-main"]').innerText();

test.describe('Turnaround', () => {
  test('opens on Overdue grouped by sample, in plain words: no raw status, no yellow, no page scroll', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await openTat(page);
    // Overdue = Ravi's biochemistry tube (3 tests), his haematology tube and Asha's culture: 3 samples, 5 tests.
    await expect(gridRows(page)).toHaveCount(3);
    await expect(vis(page, '[data-testid="tat-main"]')).toContainText('3 tests');
    const text = await gridText(page);
    expect(text).not.toMatch(RAW_STATUS);
    expect(text).not.toMatch(/_/);
    for (const w of ['Waiting for result', 'In progress', 'Waiting to validate', 'Culture incubating']) expect(text.toLowerCase(), w).toContain(w.toLowerCase());
    expect(await page.locator('[data-testid="tat-page"] pf-tile').count(), 'no card per test').toBe(0);
    if (!narrow(page)) {
      const side = vis(page, '[data-testid="tat-side"]');
      await expect(side.locator('[data-testid="tat-bucket-overdue"]')).toHaveAttribute('aria-pressed', 'true');
      await expect(side.locator('[data-testid="tat-bucket-overdue"]')).toContainText('3 · 5 tests');
      await expect(side.locator('[data-testid="tat-bucket-dueSoon"]')).toContainText('1 · 1 test');
      await expect(side.locator('[data-testid="tat-bucket-onTrack"]')).toContainText('1 · 2 tests');
      await expect(side.locator('[data-testid="tat-bucket-all"]')).toContainText('5 · 8 tests');
      await expect(side.locator('[data-testid="tat-dept-d-bio"]')).toContainText('1 late');
      await expect(vis(page, '[data-testid="tat-summary"]')).toContainText('Overdue · 3 samples · 5 tests');
    }
    await expectLayout(page, 'tat');
    if (!isPhone()) await expectNoPageScroll(page, 'tat');
    await shot(page, 'tat-overdue-by-sample', '[data-testid="tat-page"]');
    expect(errors, 'no uncaught errors').toEqual([]);
  });

  test('By test shows one row per test; All in progress shows everything; the side card is a sheet when narrow', async ({ page }) => {
    await openTat(page);
    await vis(page, '[data-testid="tat-main"] pf-segmented').getByText('By test').click();
    await expect(gridRows(page)).toHaveCount(5);
    await pickBucket(page, 'all');
    await expect(gridRows(page)).toHaveCount(8);
    expect(await gridText(page)).not.toMatch(RAW_STATUS);
    await vis(page, '[data-testid="tat-main"] pf-segmented').getByText('By sample').click();
    await expect(gridRows(page)).toHaveCount(5);
    if (!isPhone()) await expectNoPageScroll(page, 'tat all');
    await shot(page, 'tat-all-by-sample', '[data-testid="tat-page"]');
    if (narrow(page)) {
      await vis(page, '[data-testid="tat-sheet-chip"]').click();
      await expect(vis(page, '[data-testid="tat-side"][role="dialog"]')).toBeVisible();
      await page.waitForTimeout(400);
      await shot(page, 'tat-sheet', '[data-testid="tat-page"]');
    }
  });

  test('the search finds a patient or a test; Open goes to the result screen', async ({ page }) => {
    await openTat(page);
    await pickBucket(page, 'all');
    await vis(page, 'pf-hero-band input[placeholder="Search patient, sample number or test…"]').fill('lipid');
    await expect(gridRows(page)).toHaveCount(1);
    await expect(vis(page, '[data-testid="tat-main"]')).toContainText('John Paul');
    await blurField(page);
    await gridRows(page).first().click();
    await expect(page).toHaveURL(/\/lab\/result\/t7/, { timeout: 30_000 });
  });
});

// ───────────────────────── Day closing ─────────────────────────
async function openClosing(page: Page) {
  await go(page, '/finance/daily');
  await expect(vis(page, '[data-testid="closing-main"]')).toBeVisible({ timeout: 60_000 });
  await expect(vis(page, '[data-testid="closing-count"]')).toBeVisible({ timeout: 30_000 });
}
const closeBtn = (page: Page) => vis(page, '[data-testid="close-day"]');
async function typeCount(page: Page, text: string) {
  await vis(page, '[data-testid="closing-count"]').fill(text);
}

test.describe('Day closing', () => {
  test('one strip, two columns, the Days list; no native number input, no yellow, no page scroll', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await openClosing(page);
    await expect(vis(page, '[data-testid="closing-state"]')).toHaveText(/Open/);
    await expect(vis(page, '[data-testid="closing-title"]')).toContainText('Today');
    expect(await page.locator('input[type="number"]').count(), 'no native number input').toBe(0);
    expect(await page.locator('[data-testid="closing-page"] select').count(), 'no native select').toBe(0);
    const count = vis(page, '[data-testid="closing-count"]');
    await expect(count).toHaveAttribute('type', 'text');
    await expect(count).toHaveAttribute('inputmode', 'decimal');
    const main = vis(page, '[data-testid="closing-main"]');
    for (const w of ['Opening cash', 'Collected', 'Refunds', 'Expected cash', 'Collected by mode', 'UPI', 'Cash', 'Card', 'Credit wallet', 'Net collected today', 'Count the cash', 'Cash in the drawer now'])
      await expect(main.getByText(w, { exact: false }).first(), w).toBeVisible();
    await expect(vis(page, '[data-testid="closing-expected"]')).toHaveText('₹4,000.00');
    expect(await page.locator('[data-testid="closing-page"] pf-kpi-strip, [data-testid="closing-page"] pf-tile').count(), 'a strip, not KPI cards').toBe(0);
    await expect(closeBtn(page)).toBeDisabled();
    if (narrow(page)) {
      await vis(page, '[data-testid="closing-sheet-chip"]').click();
      await expect(vis(page, '[data-testid="closing-side"][role="dialog"]')).toBeVisible();
      await page.waitForTimeout(400);
    }
    const side = vis(page, '[data-testid="closing-side"]');
    const days = side.locator('.pf-cl__day');
    await expect(days).toHaveCount(4);
    await expect(days.nth(0)).toContainText('Open');
    await expect(days.nth(1)).toContainText('Balanced');
    await expect(days.nth(1)).toContainText('Closed by Kavya Desk');
    await expect(days.nth(2)).toContainText('Short ₹20');
    await expect(days.nth(3)).toContainText('Over ₹100');
    if (narrow(page)) { await shot(page, 'closing-days-sheet', '[data-testid="closing-page"]'); await side.locator('button[aria-label="Close"]').click(); }
    await expectLayout(page, 'closing');
    if (!isPhone()) await expectNoPageScroll(page, 'closing');
    await shot(page, 'closing-open', '[data-testid="closing-page"]');
    expect(errors, 'no uncaught errors').toEqual([]);
  });

  test('short drawer: Close day waits for the count and the note, confirms with the amounts, then the day is read-only', async ({ page }) => {
    await openClosing(page);
    await expect(closeBtn(page)).toBeDisabled();
    await typeCount(page, '3950');
    const sum = vis(page, '[data-testid="closing-summary"]');
    await expect(sum).toContainText('Short by');
    await expect(sum).toContainText('₹50.00');
    await expect(closeBtn(page), 'short: the note is needed').toBeDisabled();
    await vis(page, '[data-testid="closing-note"]').fill('₹50 change given to a patient');
    await expect(closeBtn(page)).toBeEnabled();
    await expect(vis(page, '[data-testid="closing-help"]')).toContainText('₹3,950.00');
    await blurField(page);
    if (!isPhone()) await expectNoPageScroll(page, 'closing short');
    await shot(page, 'closing-short', '[data-testid="closing-page"]');

    await closeBtn(page).click();
    const dlg = vis(page, '.pf-dh-root[role="dialog"]');
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('₹4,000.00');
    await expect(dlg).toContainText('₹3,950.00');
    await expect(dlg).toContainText('short by ₹50.00');
    await page.waitForTimeout(400);
    await shot(page, 'closing-confirm', '.pf-dh-root');
    expect(neg.calls.some(c => c.path === '/api/finance/close'), 'nothing posted before the confirm').toBe(false);
    await dlg.locator('.pf-dh-actions pf-touch-btn').last().locator('button').click();
    await expect.poll(() => neg.calls.find(c => c.path === '/api/finance/close')?.body)
      .toEqual({ date: TODAY, shift: null, openingBalance: 1500, countedCash: 3950, note: '₹50 change given to a patient' });
    await expect(vis(page, '[data-testid="closing-state"]')).toHaveText(/Closed/);
    await expect(vis(page, '[data-testid="closing-count"]')).toBeDisabled();
    await expect(vis(page, '[data-testid="closing-note"]')).toBeDisabled();
    await expect(page.locator('[data-testid="close-day"]').locator('visible=true')).toHaveCount(0);
    await shot(page, 'closing-closed', '[data-testid="closing-page"]');
  });

  test('cancelling the confirm posts nothing; a balanced drawer needs no note; an over drawer does', async ({ page }) => {
    await openClosing(page);
    await typeCount(page, '4,000');
    await expect(vis(page, '[data-testid="closing-summary"]')).toContainText('Balanced');
    await expect(closeBtn(page)).toBeEnabled();
    await blurField(page);
    await closeBtn(page).click();
    const dlg = vis(page, '.pf-dh-root[role="dialog"]');
    await expect(dlg).toContainText('balanced');
    await dlg.locator('.pf-dh-actions pf-touch-btn').first().locator('button').click();
    await expect(dlg).toHaveCount(0);
    expect(neg.calls.some(c => c.path === '/api/finance/close')).toBe(false);
    await expect(vis(page, '[data-testid="closing-state"]')).toHaveText(/Open/);
    await typeCount(page, '4100.50');
    await expect(vis(page, '[data-testid="closing-summary"]')).toContainText('Over by');
    await expect(vis(page, '[data-testid="closing-summary"]')).toContainText('₹100.50');
    await expect(closeBtn(page)).toBeDisabled();
    await typeCount(page, 'abc');
    await expect(closeBtn(page)).toBeDisabled();
  });

  test('a past day opens read-only', async ({ page }) => {
    await openClosing(page);
    if (narrow(page)) await vis(page, '[data-testid="closing-sheet-chip"]').click();
    await vis(page, '[data-testid="closing-day-c2"]').click();
    await expect(vis(page, '[data-testid="closing-state"]')).toHaveText(/Closed/, { timeout: 30_000 });
    await expect(vis(page, '[data-testid="closing-count"]')).toBeDisabled();
    await expect(vis(page, '[data-testid="closing-note"]')).toHaveValue('Coins short');
    await expect(vis(page, '[data-testid="closing-summary"]')).toContainText('Short by');
    await expect(page.locator('[data-testid="close-day"]').locator('visible=true')).toHaveCount(0);
    if (!isPhone()) await expectNoPageScroll(page, 'closing past day');
    await shot(page, 'closing-past-day', '[data-testid="closing-page"]');
  });
});
