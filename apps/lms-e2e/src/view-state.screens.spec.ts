import type { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect, projectName } from './support/form-factor';
import { resetNeg, installNegBackend, go, neg, visible, openDesk, ME, TENANT, jwt } from './support/neg-backend';

/**
 * Screen view state (owner 2026-11-21): "set a filter, go to another screen and come back WITHOUT refreshing — the
 * filters must come back exactly as left". Every case sets a filter, leaves through the BOTTOM NAV, comes back
 * (browser Back = in-app popstate, no reload — a window marker proves it) and checks the filter AND the filtered
 * list. Plus: a reload restores defaults; sign-out clears. Desktop + tablet (behaviour only). API mocked, fake data.
 */
const now = Date.now();
const ago = (m: number) => new Date(now - m * 60000).toISOString();
const today = new Date(now + 330 * 60000).toISOString().slice(0, 10);

// ── Lab (My Work / Pathologist) ──
const HAE = { id: 'hae', name: 'Haematology', code: 'HAE' };
const pat = (n: number, name: string) => ({ id: `p${n}`, displayName: name, firstName: name.split(' ')[0], age: 30 + n, sex: 'F', gender: 'F', mrn: `AA00${n}`, phone: '+919876543210' });
const ord = (n: number, name: string) => ({ id: `ord-${n}`, orderNumber: `LAB-2611-00010${n}`, dailyNo: n, dailyNoDay: today, priority: 'Normal', patient: pat(n, name) });
const line = (id: string, test: string, n: number, name: string, extra: Record<string, unknown> = {}) => ({
  id, status: 'pending', assignedTo: ME.id,
  test: { id: `t-${id}`, name: test, tatHours: 2, departmentId: HAE.id, department: HAE },
  subOrder: { id: `s${n}`, barcode: `01261${n}`, receivedAtLab: ago(30), departmentId: HAE.id, department: HAE, order: ord(n, name) },
  ...extra,
});
const MY_WORK = [line('l1', 'Complete Blood Count', 1, 'Ms. Arya Stark'), line('l2', 'ESR', 2, 'Mr. Prem Kumar K')];
const PV = [
  line('v1', 'Complete Blood Count', 3, 'Ms. Sansa Stark', { status: 'entered', assignedTo: null, resultedAt: ago(5) }),
  line('v2', 'Thyroid profile', 4, 'Baby Leo S', { status: 'entered', assignedTo: null, resultedAt: ago(8) }),
];

// ── Results ──
const rep = (n: number, name: string, deliveryStatus: string) => ({
  id: `rq-${n}`, orderId: `ord-r${n}`, patientId: `pr${n}`, type: 'final', status: 'generated', deliveryStatus, qrToken: `tok-${n}`,
  createdAt: ago(20 + n), order: { id: `ord-r${n}`, orderNumber: `LAB-2611-0002${n}`, dailyNo: 20 + n, dailyNoDay: today, patient: { displayName: name, age: 40, sex: 'M', mrn: `RR00${n}`, phone: '+919876543210' } },
  ...(deliveryStatus === 'delivered' ? { deliveredVia: 'print' } : {}),
});
const QUEUE = [rep(1, 'Mr. Rahul Dev', 'pending'), rep(2, 'Ms. Nila Raman', 'delivered'), rep(3, 'Mr. Kiran Bose', 'pending')];
function queuePage(url: URL) {
  const status = url.searchParams.get('status') ?? 'all';
  const rows = QUEUE.filter(r => status === 'all' || r.deliveryStatus === status);
  const n = (s: string) => QUEUE.filter(r => r.deliveryStatus === s).length;
  return { items: rows, total: rows.length, page: 1, pageSize: 50, hasMore: false, counts: { all: QUEUE.length, pending: n('pending'), delivered: n('delivered'), failed: 0 } };
}

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(240_000);
  const p = projectName();
  test.skip(!(p === 'desktop' || p === 'tablet-landscape'), 'behaviour suite: desktop + tablet (iPad landscape)');
  resetNeg();
  neg.hook = r => {
    const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
    if (r.method === 'POST' && r.path === '/api/auth/login') {
      return ok({ accessToken: jwt(ME.authId), refreshToken: `rt-${ME.authId}`, mustChangePassword: false, tenant: { id: TENANT.id, name: TENANT.name } });
    }
    if (r.method !== 'GET') return undefined;
    switch (r.path) {
      case '/api/results/my-work': return ok(MY_WORK);
      case '/api/results/service-queue': return ok([]);
      case '/api/results/completed': return ok([]);
      case '/api/validation/queue': return ok(PV);
      case '/api/validation/scope': return ok({ scoped: true, departments: [HAE], validatedToday: 0, validatedTodayByMe: 0 });
      case '/api/orders/partial-ready': return ok([]);
      case '/api/expenses': return ok({ from: today, to: today, today, scope: 'own', closedThrough: null, days: [], entries: [], truncated: false, totalExpenses: 0, totalCashIn: 0 });
      case '/api/tenants/branch-lab-config': return ok({ effectiveQueueFocus: 'sample', queueFocus: 'sample' });
      default: return undefined;
    }
  };
  await installNegBackend(page, context);
  await page.route(/prefrontal\.health\/api\/reports\/queue/, async route => {
    const origin = route.request().headers()['origin'] ?? 'http://127.0.0.1';
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ success: true, data: queuePage(new URL(route.request().url())) }) });
  });
});

const vis = (page: Page, sel: string) => page.locator(sel).locator('visible=true');
const shown = (page: Page, text: string) => page.getByText(text).locator('visible=true');

/** Mark the window: a full reload would drop it. */
async function mark(page: Page) { await page.evaluate(() => { (window as unknown as { __vs: number }).__vs = 1; }); }
async function stillSameWindow(page: Page) {
  expect(await page.evaluate(() => (window as unknown as { __vs?: number }).__vs), 'came back without a reload').toBe(1);
}

/** Leave through the bottom nav (another screen), then come back with Back (in-app popstate). */
async function awayAndBack(page: Page) {
  await mark(page);
  // Typing raises the (soft-)keyboard state, which tucks the bar away: leave the field first.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.mouse.click(5, 300);
  await page.waitForTimeout(500);
  const before = page.url();
  // The bar: the bottom pill (phones / tablets) or the desktop work-area links (same nav, drawn in the strip).
  const btn = vis(page, 'nav.pf-bottom-nav .pf-nav-btn:not(.pf-nav-btn--active):not(.pf-nav-btn--more), nav[aria-label="Work areas"] a.pf-topnav-link:not(.pf-topnav-link--on)').first();
  await expect(btn).toBeVisible({ timeout: 20_000 });
  await btn.click();
  await expect.poll(() => page.url(), { timeout: 20_000 }).not.toBe(before);
  await page.waitForTimeout(600);
  await page.goBack();
  await expect.poll(() => page.url(), { timeout: 20_000 }).toBe(before);
  await page.waitForTimeout(900);
  await stillSameWindow(page);
}

/** In-app navigation without the bottom nav (router listens to popstate) — used after a sign-in. */
async function inApp(page: Page, path: string) {
  await page.evaluate(p => {
    const hash = location.hash.startsWith('#/');
    if (hash) location.hash = '#' + p;
    else { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate', { state: {} })); }
  }, path);
}

/** Click until the control reports the state (the first tap after a load can land on a settling layout). */
async function clickUntil(page: Page, sel: () => ReturnType<Page['locator']>, attr: string, value: string) {
  await expect(async () => {
    const el = sel();
    if ((await el.getAttribute(attr)) !== value) await el.click();
    await expect(sel()).toHaveAttribute(attr, value, { timeout: 5000 });
  }).toPass({ timeout: 20_000 });
}

async function bandSearch(page: Page) {
  const box = vis(page, '.pf-hb__input').first();
  await expect(box).toBeVisible({ timeout: 60_000 });
  return box;
}

// ─────────────────────────────── Frontdesk ───────────────────────────────
async function openFrontdesk(page: Page) { await openDesk(page); }
const fdFind = (page: Page) => vis(page, '.pf-work-find__input').first();

test.describe('Frontdesk', () => {
  test('work search + Yesterday survive navigating away and back; Back to today resets', async ({ page }) => {
    await openFrontdesk(page);
    await fdFind(page).fill('Noor');
    await expect(shown(page, 'Priya Nair')).toHaveCount(0);
    await expect(shown(page, 'Noor Khan').first()).toBeVisible();
    await awayAndBack(page);
    await expect(fdFind(page)).toHaveValue('Noor');
    await expect(shown(page, 'Noor Khan').first()).toBeVisible();
    await expect(shown(page, 'Priya Nair')).toHaveCount(0);

    // Yesterday: the header pill (classic) or More filters (new design).
    const pill = vis(page, '.pf-work-hdr__date [role="radio"][data-value="yesterday"]').first();
    if (await pill.count()) await pill.click();
    else {
      await page.getByRole('button', { name: /^More filters/ }).locator('visible=true').first().click({ force: true });
      await page.locator('pf-fd-more-filters').getByText('Yesterday', { exact: true }).locator('visible=true').first().click();
      await page.keyboard.press('Escape');
    }
    await expect(shown(page, 'Noor Khan')).toHaveCount(0);           // today's order is not in yesterday's list
    await awayAndBack(page);
    const back = vis(page, '[data-testid="back-to-today"]').first();
    await expect(back, 'came back on Yesterday, and it says so').toBeVisible();
    await expect(fdFind(page)).toHaveValue('Noor');
    await expect(shown(page, 'Noor Khan')).toHaveCount(0);
    for (const dark of [false, true]) {
      await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
      await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
      await page.waitForTimeout(400);
      const out = path.join(process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/view-state'), projectName());
      fs.mkdirSync(out, { recursive: true });
      await page.screenshot({ path: `${out}/fd-back-to-today-${dark ? 'dark' : 'light'}.png` });
    }
    await back.click();
    await expect(vis(page, '[data-testid="back-to-today"]')).toHaveCount(0);
    await expect(shown(page, 'Noor Khan').first()).toBeVisible({ timeout: 20_000 });
  });

  test('a full reload restores the defaults', async ({ page }) => {
    await openFrontdesk(page);
    await fdFind(page).fill('Noor');
    await expect(shown(page, 'Priya Nair')).toHaveCount(0);
    await page.reload();
    await expect(shown(page, 'Priya Nair').first()).toBeVisible({ timeout: 60_000 });
    await expect(fdFind(page)).toHaveValue('');
  });

  test('sign-out clears the kept state (signing back in starts fresh)', async ({ page }) => {
    await openFrontdesk(page);
    await fdFind(page).fill('Noor');
    await expect(shown(page, 'Priya Nair')).toHaveCount(0);
    await mark(page);
    // Start menu → Account → Sign out.
    // Leave the search (it tucks the bar away), then: desktop = the avatar menu; tablet = Start menu → Account.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.mouse.click(5, 300);
    await page.waitForTimeout(500);
    const avatar = vis(page, '.pf-avatar-btn').first();
    if (await avatar.count()) await avatar.click();
    else {
      await vis(page, '[data-start-trigger]').first().click();
      await vis(page, '[data-sm-account]').first().click();
    }
    await page.getByText('Sign out', { exact: true }).locator('visible=true').first().click();
    const org = vis(page, 'input[placeholder="Your organization name"]').first();
    await expect(org).toBeVisible({ timeout: 30_000 });
    await org.fill(TENANT.name);
    await vis(page, 'input[placeholder="Your username"]').first().fill('kavya');
    await vis(page, 'input[type="password"]').first().fill('demo-password');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.url(), { timeout: 30_000 }).not.toMatch(/login/);
    await stillSameWindow(page);
    await inApp(page, '/frontdesk');
    await expect(shown(page, 'Priya Nair').first()).toBeVisible({ timeout: 60_000 });
    await expect(fdFind(page)).toHaveValue('');
  });
});

// ─────────────────────────────── Lab ───────────────────────────────
test.describe('Lab', () => {
  test('My Work: the head search survives navigation (list still filtered)', async ({ page }) => {
    await go(page, '/lab/my-work');
    const find = vis(page, '[data-testid="mw-find"]').first();
    await expect(find).toBeVisible({ timeout: 60_000 });
    await expect(shown(page, 'Ms. Arya Stark').first()).toBeVisible({ timeout: 30_000 });
    await find.fill('Prem');
    await expect(shown(page, 'Ms. Arya Stark')).toHaveCount(0);
    await awayAndBack(page);
    await expect(vis(page, '[data-testid="mw-find"]').first()).toHaveValue('Prem');
    await expect(shown(page, 'Mr. Prem Kumar K').first()).toBeVisible({ timeout: 20_000 });
    await expect(shown(page, 'Ms. Arya Stark')).toHaveCount(0);
  });

  test('Pathologist: the band search survives navigation (queue still filtered)', async ({ page }) => {
    await go(page, '/pathologist');
    const box = await bandSearch(page);
    await expect(shown(page, 'Ms. Sansa Stark').first()).toBeVisible({ timeout: 30_000 });
    await box.fill('Leo');
    await expect(shown(page, 'Ms. Sansa Stark')).toHaveCount(0);
    await awayAndBack(page);
    await expect(await bandSearch(page)).toHaveValue('Leo');
    await expect(shown(page, 'Baby Leo S').first()).toBeVisible({ timeout: 20_000 });
    await expect(shown(page, 'Ms. Sansa Stark')).toHaveCount(0);
  });

  test('Critical results: the band search comes back', async ({ page }) => {
    await go(page, '/lab/critical-results');
    const box = await bandSearch(page);
    await box.fill('Hb low');
    await awayAndBack(page);
    await expect(await bandSearch(page)).toHaveValue('Hb low');
  });
});

// ─────────────────────────────── Results ───────────────────────────────
test.describe('Results', () => {
  test('status filter in the Filters card survives navigation (grid still filtered)', async ({ page }) => {
    await go(page, '/reports');
    const side = visible(page, '[data-testid="rq-side"]');
    await expect(side).toBeVisible({ timeout: 60_000 });
    const names = () => vis(page, '.ag-row .pf-rq2-who__name');
    await expect(names().first()).toBeVisible({ timeout: 60_000 });
    await clickUntil(page, () => side.locator('[data-filter="delivered"]'), 'aria-pressed', 'true');
    await expect(shown(page, 'Mr. Rahul Dev')).toHaveCount(0, { timeout: 10_000 });
    await awayAndBack(page);
    const side2 = visible(page, '[data-testid="rq-side"]');
    await expect(side2.locator('[data-filter="delivered"]')).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });
    await expect(shown(page, 'Ms. Nila Raman').first()).toBeVisible({ timeout: 20_000 });
    await expect(shown(page, 'Mr. Rahul Dev')).toHaveCount(0);
  });
});

// ─────────────────────────────── Others ───────────────────────────────
test.describe('Other screens', () => {
  test('Expenses: Today + the search come back', async ({ page }) => {
    await go(page, '/expenses');
    const box = await bandSearch(page);
    await box.fill('fuel');
    await clickUntil(page, () => vis(page, '.pf-xt__seg [role="radio"]').filter({ hasText: 'Today' }).first(), 'aria-checked', 'true');
    await awayAndBack(page);
    await expect(await bandSearch(page)).toHaveValue('fuel');
    await expect(vis(page, '.pf-xt__seg [role="radio"]').filter({ hasText: 'Today' }).first()).toHaveAttribute('aria-checked', 'true');
  });

  test('Test Master: the band search comes back', async ({ page }) => {
    await go(page, '/admin/tests');
    const box = await bandSearch(page);
    await box.fill('thyroid');
    await awayAndBack(page);
    await expect(await bandSearch(page)).toHaveValue('thyroid');
  });

  test('Insights: the search comes back', async ({ page }) => {
    await go(page, '/insights');
    const box = await bandSearch(page);
    await box.fill('urine');
    await awayAndBack(page);
    await expect(await bandSearch(page)).toHaveValue('urine');
  });

  test('Stores: the search comes back', async ({ page }) => {
    await go(page, '/stores');
    const box = await bandSearch(page);
    await box.fill('gloves');
    await awayAndBack(page);
    await expect(await bandSearch(page)).toHaveValue('gloves');
  });
});
