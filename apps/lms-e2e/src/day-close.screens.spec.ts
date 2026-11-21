import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, isPhone, expectLayout, shotsDir } from './support/form-factor';
import { neg, resetNeg, installNegBackend, go } from './support/neg-backend';

/**
 * THE day-close (owner 2026-11-21: one day-close per branch per day). Expenses → Day closing and Finance → Daily
 * statement open the same screen on the same record: closing from Expenses shows closed in Finance and vice versa,
 * reopen too. API mocked by a fake service holding ONE day-close for the branch (demo data only); the pages are the
 * real app. Screenshots: SHOTS_DIR/<form factor>/day-close-*.png (light + dark).
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/day-closing');
const out = () => shotsDir(OUT_BASE);
const vis = (page: Page, sel: string) => page.locator(sel).locator('visible=true').first();
const narrow = (page: Page) => (page.viewportSize()?.width ?? 1440) <= 900;

async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
  await page.waitForTimeout(450);
}
async function shot(page: Page, name: string) {
  for (const dark of [false, true]) {
    await theme(page, dark);
    await page.screenshot({ path: `${out()}/${name}--${dark ? 'dark' : 'light'}.png` });
  }
  await theme(page, false);
}

const NOW = Date.now();
const TODAY = new Date(NOW + 330 * 60000).toISOString().slice(0, 10);
const PAY = [{ mode: 'upi', count: 4, total: 1800 }, { mode: 'cash', count: 3, total: 1500 }];
const REF = [{ mode: 'cash', count: 1, total: 100 }];
const FIG = {
  version: 2, date: TODAY, opening: 1000, openingSource: 'previous_closure', openingFrom: TODAY,
  collections: PAY, collectionBuckets: { cash: 1500, upi: 1800, card: 0, other: 0 }, totalCollected: 3300, cashCollected: 1500,
  refunds: REF, totalRefunded: 100, cashRefunded: 100,
  billed: { bills: 6, grossBilled: 3600, discount: 300, tax: 0 }, activity: { patients: 6, orders: 6, tests: 14 },
  expenses: { count: 3, expenses: 450, cashIn: 200, cashExpenses: 350, cashTopUps: 200, byMode: [],
    byPerson: [{ userId: 'u1', name: 'Asha Raman', count: 2, expenses: 350, cashIn: 0, cashExpenses: 350 }, { userId: 'u2', name: 'Kavya Desk', count: 1, expenses: 100, cashIn: 200, cashExpenses: 0 }] },
  expectedCash: 2250,   // 1000 + 1500 − 100 − 350 + 200
};

/** The ONE day-close of the branch for today, whichever screen wrote it. */
let store: null | { counted: number; note: string | null; closedAt: string; by: string } = null;
/** A legacy close made in the expense book alone (before the one day-close): closed, no count, no closure row. */
let legacy = false;
const LEGACY_AT = new Date(NOW - 3600_000).toISOString();
const closureOf = () => store && ({
  id: 'dc-today', date: TODAY, shift: null, openingBalance: 1000, expectedCash: 2250, countedCash: store.counted,
  variance: Math.round((store.counted - 2250) * 100) / 100, note: store.note, closedBy: 'app-1', closedAt: store.closedAt,
  closedByName: store.by, source: 'day_close', totalsJson: JSON.stringify({ payments: PAY, refunds: REF, figures: FIG }),
});
const statement = () => {
  const c = closureOf();
  return {
    date: TODAY, shift: null, openingBalance: 1000, openingSource: 'previous_closure', openingFrom: TODAY,
    payments: PAY, refunds: REF, totalCollected: 3300, totalRefunded: 100, net: 3200, cashCollected: 1500, cashRefunded: 100,
    cashExpenses: 350, cashTopUps: 200, expectedCash: 2250, closure: c,
    dayClose: {
      date: TODAY, today: TODAY, isClosed: !!c || legacy, canClose: !c && !legacy, canReopen: !!c || legacy, fromSnapshot: !!c, figures: FIG,
      countedCash: c?.countedCash ?? null, variance: c?.variance ?? null, note: c?.note ?? (legacy ? 'Old book close' : null),
      closedAt: c?.closedAt ?? (legacy ? LEGACY_AT : null),
      closedByName: c ? store!.by : legacy ? 'Admin User' : null, lastClosed: c ? TODAY : null,
      source: c ? 'day_close' : legacy ? 'expense_book' : null,
    },
  };
};
const book = () => ({
  from: TODAY, to: TODAY, today: TODAY, scope: 'all', closedThrough: store ? TODAY : null, truncated: false,
  days: [{ date: TODAY, opening: 1000, cashIn: 200, expenses: 450, closing: 750, isClosed: !!store, openingSet: false, entryCount: 3, closedByName: store?.by ?? null }],
  entries: [], totalExpenses: 450, totalCashIn: 200, opening: 1000, closing: 750, byCategory: [], byMode: [],
});

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(180_000);
  resetNeg();
  store = null;
  legacy = false;
  neg.hook = r => {
    const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
    if (r.method === 'POST' && r.path === '/api/finance/close') {
      if (store) return { status: 200, body: { success: false, error: 'already_closed', message: 'Already closed for this branch.' } };
      store = { counted: r.body.countedCash, note: r.body.note ?? null, closedAt: new Date().toISOString(), by: 'Kavya Desk' };
      return ok(closureOf());
    }
    if (r.method === 'POST' && r.path === `/api/finance/closures/${TODAY}/reopen`) { store = null; return ok(statement()); }
    if (r.method !== 'GET') return undefined;
    switch (r.path) {
      case '/api/finance/closures': return ok(store ? [closureOf()] : legacy
        ? [{ id: 'xd-today', date: TODAY, shift: null, openingBalance: 1000, note: 'Old book close', closedBy: 'u0', closedAt: LEGACY_AT, closedByName: 'Admin User', source: 'expense_book' }]
        : []);
      case '/api/expenses': return ok(book());
      case '/api/expenses/categories': return ok([]);
      default: return undefined;
    }
  };
  await installNegBackend(page, context);
  await page.route(/\/api\/finance\/daily/, async (route, req) => {
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ success: true, data: statement() }) });
  });
});

async function waitClosing(page: Page) {
  await expect(vis(page, '[data-testid="closing-main"]')).toBeVisible({ timeout: 60_000 });
  await expect(vis(page, '[data-testid="closing-state"]')).toBeVisible({ timeout: 30_000 });
}
/** Finance → Daily statement. */
async function openFinance(page: Page) {
  await go(page, '/finance/daily');
  await waitClosing(page);
}
/** Expenses → Day closing (the section switch in the band; a phone may fold it into its compact menu). */
async function openFromExpenses(page: Page) {
  await go(page, '/expenses');
  await expect(vis(page, 'pf-segmented.pf-xt__tabs')).toBeVisible({ timeout: 60_000 });
  const radio = page.getByRole('radio', { name: 'Day closing' }).locator('visible=true');
  if (await radio.count()) await radio.first().click();
  else {
    await vis(page, 'pf-segmented.pf-xt__tabs .pf-seg-compact').click();
    await page.getByText('Day closing', { exact: true }).locator('visible=true').last().click();
  }
  await expect.poll(() => page.url(), { timeout: 30_000 }).toContain('/finance/daily');
  expect(page.url()).toContain(`date=${TODAY}`);
  await waitClosing(page);
}
async function closeWith(page: Page, counted: string, note?: string) {
  await vis(page, '[data-testid="closing-count"]').fill(counted);
  if (note) await vis(page, '[data-testid="closing-note"]').fill(note);
  await vis(page, '[data-testid="close-day"]').click();
  const dlg = vis(page, '.pf-dh-root[role="dialog"]');
  await expect(dlg).toBeVisible();
  await dlg.locator('.pf-dh-actions pf-touch-btn').last().locator('button').click();
  await expect(vis(page, '[data-testid="closing-state"]')).toHaveText(/Closed/, { timeout: 30_000 });
}
async function reopen(page: Page) {
  await vis(page, '[data-testid="closing-reopen"]').click();
  const dlg = vis(page, '.pf-dh-root[role="dialog"]');
  await expect(dlg).toBeVisible();
  await dlg.locator('.pf-dh-actions pf-touch-btn').last().locator('button').click();
  await expect(vis(page, '[data-testid="closing-state"]')).toHaveText(/Open/, { timeout: 30_000 });
}

test.describe('One day-close', () => {
  test('closing from Expenses shows as closed in Finance', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await openFromExpenses(page);
    await expect(vis(page, '[data-testid="closing-state"]')).toHaveText(/Open/);
    // The expected cash takes the staff cash expenses and top-ups; the cashier sees who spent what.
    await expect(vis(page, '[data-testid="closing-expected"]')).toHaveText('₹2,250.00');
    await expect(vis(page, '[data-testid="closing-expenses"]')).toContainText('Asha Raman');
    await expectLayout(page, 'day-close');
    await shot(page, 'day-close-open');

    await closeWith(page, '2200', '₹50 change given to a patient');
    expect(neg.calls.filter(c => c.path === '/api/finance/close').length, 'one close, on the one endpoint').toBe(1);
    expect(neg.calls.some(c => c.path.includes('/api/expenses/days/') && c.path.endsWith('/close')), 'no expense-book-only close').toBe(false);
    await expect(vis(page, '[data-testid="closing-help"]')).toContainText('by Kavya Desk');
    await shot(page, 'day-close-closed');

    // Finance's own entry: the same record, closed.
    await openFinance(page);
    await expect(vis(page, '[data-testid="closing-state"]')).toHaveText(/Closed/);
    await expect(vis(page, '[data-testid="closing-count"]')).toBeDisabled();
    await expect(vis(page, '[data-testid="closing-count"]')).toHaveValue('2200');
    await expect(vis(page, '[data-testid="closing-summary"]')).toContainText('Short by');
    if (narrow(page)) await vis(page, '[data-testid="closing-sheet-chip"]').click();
    await expect(vis(page, '[data-testid="closing-side"]').locator('.pf-cl__day').first()).toContainText('Closed by Kavya Desk');
    if (narrow(page)) await vis(page, '[data-testid="closing-side"] button[aria-label="Close"]').click();
    expect(errors, 'no uncaught errors').toEqual([]);
  });

  test('closing from Finance shows as closed in Expenses; reopening there opens it in Finance', async ({ page }) => {
    await openFinance(page);
    await closeWith(page, '2250');
    await openFromExpenses(page);
    await expect(vis(page, '[data-testid="closing-state"]')).toHaveText(/Closed/);
    await expect(vis(page, '[data-testid="closing-summary"]')).toContainText('Balanced');
    await expect(page.locator('[data-testid="close-day"]').locator('visible=true')).toHaveCount(0);
    if (!isPhone()) await shot(page, 'day-close-closed-from-finance');
    await reopen(page);
    expect(neg.calls.some(c => c.path === `/api/finance/closures/${TODAY}/reopen`)).toBe(true);
    await openFinance(page);
    await expect(vis(page, '[data-testid="closing-state"]')).toHaveText(/Open/);
    await expect(vis(page, '[data-testid="closing-count"]')).toBeEnabled();
  });

  test('a legacy expense-book close reads closed, no cash count, in the chip and the Days list', async ({ page }) => {
    legacy = true;
    await openFinance(page);
    const chip = vis(page, '[data-testid="closing-state"]');
    await expect(chip).toHaveText(/Closed · no cash count/);
    await expect(chip).toHaveAttribute('data-state', 'closed');
    await expect(vis(page, '[data-testid="closing-summary"]')).toContainText('No cash count');
    await expect(vis(page, '[data-testid="closing-count"]')).toBeDisabled();
    await expect(page.locator('[data-testid="close-day"]').locator('visible=true')).toHaveCount(0);
    if (narrow(page)) await vis(page, '[data-testid="closing-sheet-chip"]').click();
    await expect(vis(page, '[data-testid="closing-side"]').locator('.pf-cl__day').first()).toContainText('No count');
    if (narrow(page)) await vis(page, '[data-testid="closing-side"] button[aria-label="Close"]').click();
    if (!isPhone()) await shot(page, 'day-close-legacy');
  });
});
