import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * Appointments — REAL layout (ND-PATTERN §21; jsdom can't lay out).
 * Seeded Micro World Lab Admin, READ-ONLY: after login every non-GET API
 * call is aborted and recorded (nothing is booked, checked in or moved).
 * The calendar's GET is answered with the real list PLUS a few made-up
 * appointments for today (so the layout always has cards to show).
 *  - /frontdesk/appointments at 1440: band + ONE primary "New appointment",
 *    the pill (search + Day / Week / Month + date nav), CALENDAR main +
 *    DAY ~400px right; week + day grids with neutral cards; a card opens
 *    the detail in the side card; no page scroll, no monospace, no visible
 *    native date.
 *  - /frontdesk/appointments/new at 1440: ONE primary "Book appointment",
 *    the context-bar pill, 3 card columns, no page scroll; a slot pick +
 *    patient pick fill the pill.
 *  - 375: the day list first + a full-width primary; the booking page with
 *    2-column slot chips, 44px chips, 16px inputs.
 * Screenshots (light + dark) into $SHOTS_DIR. CORS_RELAY=1 relays backend
 * calls so it can run against a static build on a spare port.
 */

const SHOTS = process.env['SHOTS_DIR'] || '';

async function relayCors(page: Page) {
  if (!process.env['CORS_RELAY']) return;
  await page.route(/prefrontal\.health\/api\//, async route => {
    const origin = new URL(page.url() || 'http://localhost').origin;
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const res = await route.fetch();
    await route.fulfill({ response: res, headers: { ...res.headers(), ...cors } });
  });
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Made-up appointments (fixtures, never sent anywhere). */
function fixtures(): unknown[] {
  const t = new Date();
  const day = isoDay(t);
  const p = (id: string, first: string, last: string, title: string, age: number, sex: string, mrn: string) =>
    ({ id, firstName: first, fathersName: last, title, displayName: `${title} ${first} ${last}`, age, sex, mrn, phone: '9000000000' });
  const a = (id: string, pt: any, time: string, status: string, extra: any = {}) => ({
    id, tenantId: 't', patientId: pt.id, branchId: 'b', type: 'appointment', collectionType: 'walkin',
    appointmentDate: `${day}T00:00:00`, slotTime: time, status, consultationFee: 0, createdAt: '', patient: pt, ...extra,
  });
  const P1 = p('fx-p1', 'Paravai', 'Munusamy', 'Ms.', 44, 'Female', 'AA0007');
  const P2 = p('fx-p2', 'Anbu', 'Selvan', 'Mr.', 30, 'Male', 'AA0003');
  const P3 = p('fx-p3', 'Meena', 'Kumari', 'Mrs.', 25, 'Female', 'AA0004');
  const P4 = p('fx-p4', 'Karthikeyan', 'Ramasubramanian', 'Mr.', 61, 'Male', 'AA0011');
  return [
    a('fx-a1', P1, '09:00', 'completed', { testIds: 'x,y' }),
    a('fx-a2', P2, '10:30', 'checked_in', { tokenNumber: 4 }),
    a('fx-a3', P3, '10:30', 'booked', { notes: 'Fasting sample' }),
    a('fx-a4', P4, '12:00', 'booked', { collectionType: 'home_collection', address: '12 Anna Salai', pincode: '600002' }),
    a('fx-a5', P2, '15:30', 'no_show'),
  ];
}

async function readOnly(page: Page, writes: string[]) {
  await page.route(/\/api\//, async route => {
    const req = route.request();
    const m = req.method();
    if (m !== 'GET' && m !== 'OPTIONS' && m !== 'HEAD') { writes.push(`${m} ${req.url()}`); return route.abort(); }
    // The calendar's range read: the real list + today's fixtures.
    if (/\/api\/appointments\?from=/.test(req.url()) && !/appointments\/new/.test(page.url())) {
      const res = await route.fetch();
      let list: unknown[] = [];
      let wrap: Record<string, unknown> = { success: true };
      try { const j = await res.json(); if (Array.isArray(j)) list = j; else { wrap = j ?? wrap; list = (j?.data as unknown[]) ?? []; } } catch { /* keep empty */ }
      const origin = new URL(page.url() || 'http://localhost').origin;
      return route.fulfill({ status: 200, contentType: 'application/json',
        headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
        body: JSON.stringify({ ...wrap, success: true, data: [...list, ...fixtures()] }) });
    }
    return route.fallback();
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
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${SHOTS}/${name}-${theme}.png`, fullPage: false });
  }
  await setTheme(page, 'light');
}

async function noPageScroll(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector('.shell-main') as HTMLElement | null;
    const se = document.scrollingElement!;
    return { doc: se.scrollHeight - se.clientHeight, main: main ? main.scrollHeight - main.clientHeight : 0 };
  });
}

async function noMono(page: Page, root: string) {
  return page.evaluate((sel) => Array.from(document.querySelectorAll(`${sel} *`))
    .filter(e => /mono|courier/i.test(getComputedStyle(e).fontFamily)).length, root);
}

async function visibleNativeDates(page: Page) {
  return page.locator('input[type="date"]').evaluateAll(els =>
    els.filter(e => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(e).opacity !== '0'; }).length);
}

test.describe('Appointments — calendar + new appointment (nd)', () => {
  test('1440 calendar week / day + detail; booking page; 375 day list + booking', async ({ page }) => {
    test.setTimeout(240_000);
    await relayCors(page);
    await loginAs(page, 'admin');
    const writes: string[] = [];
    await readOnly(page, writes);

    // ── Calendar @1440 ──────────────────────────────────────────────────
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/frontdesk/appointments');
    const main = page.locator('.pf-apc-panels > section.nd-card.pf-apc-main');
    await expect(main).toBeVisible({ timeout: 30_000 });
    if (await page.locator('.pf-apc-strip').isVisible().catch(() => false)) await page.locator('.pf-apc-strip__btn').click();
    const side = page.locator('.pf-apc-panels > aside.nd-card.pf-apc-side');
    await expect(side).toBeVisible();

    // Band: ONE primary; the pill holds search + switch + nav.
    await expect(page.locator('.pf-hb-btn--primary:visible, .nd-btn--primary:visible')).toHaveCount(1);
    await expect(page.locator('pf-hero-band .pf-hb__actions .pf-hb-btn--primary')).toHaveText(/New appointment/);
    await expect(page.locator('pf-hero-band .pf-apc-search__input')).toHaveAttribute('placeholder', 'Search patient, phone or MRN');
    await expect(page.locator('pf-hero-band .pf-apc-views [role="radio"]')).toHaveText(['Day', 'Week', 'Month']);

    // Week.
    await page.locator('.pf-apc-views [role="radio"]', { hasText: 'Week' }).click();
    await page.locator('.pf-apc-nav__today').click();
    await expect(main.locator('.pf-apc-ev').first()).toBeVisible({ timeout: 15_000 });
    const mb = (await main.boundingBox())!;
    const sb = (await side.boundingBox())!;
    expect(mb.x + mb.width).toBeLessThanOrEqual(sb.x + 1);
    expect(sb.width).toBeGreaterThan(380);
    expect(sb.width).toBeLessThan(420);
    await expect(main.locator('.pf-apc-dayhdr')).toHaveCount(7);
    await expect(main.locator('.pf-apc-dayhdr--today')).toHaveCount(1);
    const card = main.locator('.pf-apc-ev', { hasText: 'Paravai Munusamy' });
    await expect(card.locator('.pf-apc-ev__meta')).toHaveText('09:00 · 44/F · AA0007');
    expect(await noMono(page, '.pf-apc')).toBe(0);
    expect(await visibleNativeDates(page)).toBe(0);
    const ps = await noPageScroll(page);
    expect(ps.doc).toBeLessThanOrEqual(1);
    expect(ps.main).toBeLessThanOrEqual(1);
    await main.locator('.pf-apc-time').evaluate(e => { e.scrollTop = 8.5 * 128; });
    await page.waitForTimeout(300);
    await shoot(page, 'calendar-week-1440');

    // Day.
    await page.locator('.pf-apc-views [role="radio"]', { hasText: 'Day' }).click();
    await expect(main.locator('.pf-apc-dayhdr')).toHaveCount(1);
    await main.locator('.pf-apc-time').evaluate(e => { e.scrollTop = 8.5 * 128; });
    await page.waitForTimeout(300);
    await shoot(page, 'calendar-day-1440');

    // A card → the detail in the side card (zoom); every action reachable.
    await main.locator('.pf-apc-ev', { hasText: 'Meena Kumari' }).click();
    const detail = page.locator('aside.pf-apc-detail');
    await expect(detail).toBeVisible();
    await expect(detail.locator('.pf-apc-acts .nd-btn')).toHaveText(['Open profile', 'Check in', 'Reschedule', 'No-show', 'Cancel appointment']);
    await expect(page.locator('.pf-hb-btn--primary:visible, .nd-btn--primary:visible')).toHaveCount(1);
    await page.waitForTimeout(500);
    await shoot(page, 'calendar-day-detail-1440');
    await detail.locator('.pf-apc-acts .nd-btn', { hasText: 'Reschedule' }).click();
    await expect(detail.locator('pf-nd-date input[type="text"]')).toBeVisible();
    expect(await visibleNativeDates(page)).toBe(0);
    await page.waitForTimeout(400);
    await shoot(page, 'calendar-reschedule-1440');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.locator('aside.pf-apc-side .pf-apc-strip7')).toBeVisible();

    // Month.
    await page.locator('.pf-apc-views [role="radio"]', { hasText: 'Month' }).click();
    await expect(main.locator('.pf-apc-mcell')).toHaveCount(42);
    await shoot(page, 'calendar-month-1440');

    // ── New appointment @1440 ───────────────────────────────────────────
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    await page.goto(`/frontdesk/appointments/new?date=${isoDay(tomorrow)}`);
    const grid = page.locator('.pf-bka-grid');
    await expect(grid).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.pf-hb-btn--primary:visible, .nd-btn--primary:visible')).toHaveCount(1);
    await expect(page.locator('pf-hero-band .pf-hb-btn--primary')).toHaveText(/Book appointment/);
    await expect(page.locator('.pf-bka-ctx__slot')).toContainText('Not picked');
    await expect(page.locator('.nd-card__label')).toHaveText(['Patient', 'Date', 'Time slot', 'Details']);
    const cols = await page.locator('.pf-bka-grid > *').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().x)));
    expect(new Set(cols).size).toBe(3);
    expect(await visibleNativeDates(page)).toBe(0);
    expect(await noMono(page, '.pf-bka')).toBe(0);
    const ps2 = await noPageScroll(page);
    expect(ps2.doc).toBeLessThanOrEqual(1);
    expect(ps2.main).toBeLessThanOrEqual(1);
    // Keyboard-first: the patient search has focus on arrival.
    await expect(page.locator('.pf-bka-pq')).toBeFocused();
    await shoot(page, 'new-empty-1440');
    // Book with nothing → inline errors, nothing sent.
    await page.locator('pf-hero-band .pf-hb-btn--primary').click();
    await expect(page.locator('#pf-bka-e-patient')).toBeVisible();
    await expect(page.locator('#pf-bka-e-slot')).toBeVisible();
    await shoot(page, 'new-errors-1440');
    // Pick a patient (Enter) → a slot → the pill fills.
    await page.locator('.pf-bka-pq').fill('ra');
    await expect(page.locator('#pf-bka-plist .pf-bka-result').first()).toBeVisible({ timeout: 15_000 });
    await page.locator('.pf-bka-pq').press('Enter');
    await expect(page.locator('.pf-bka-ctx__patient')).toBeVisible();
    await expect(page.locator('.pf-bka-date pf-nd-date input[type="text"]')).toBeFocused();
    const free = page.locator('.pf-bka-chip:not([aria-disabled="true"])').nth(2);
    if (await free.count()) {
      await free.click();
      await expect(page.locator('.pf-bka-ctx__slot')).not.toContainText('Not picked');
    }
    await page.waitForTimeout(400);
    await shoot(page, 'new-filled-1440');

    // ── Phones @375 ─────────────────────────────────────────────────────
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/frontdesk/appointments');
    const dayCard = page.locator('section.pf-apc-daycard');
    await expect(dayCard).toBeVisible({ timeout: 30_000 });
    await page.locator('.pf-apc-strip7__day--today').click();
    await expect(dayCard.locator('.pf-apc-row').first()).toBeVisible({ timeout: 15_000 });
    const cta = dayCard.locator('.pf-apc-foot .nd-btn--primary');
    await expect(cta).toBeVisible();
    expect(Math.round((await cta.boundingBox())!.width)).toBeGreaterThan(300);
    expect((await dayCard.locator('.pf-apc-row').first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const sideways = await page.evaluate(() => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth);
    expect(sideways).toBeLessThanOrEqual(1);
    await shoot(page, 'calendar-daylist-375');
    await page.locator('.pf-apc-views [role="radio"]', { hasText: 'Week' }).click();
    await page.locator('.pf-apc-time').evaluate(e => { e.scrollTop = 8.5 * 128; });
    await page.waitForTimeout(300);
    await shoot(page, 'calendar-week-375');
    await page.locator('.pf-apc-views [role="radio"]', { hasText: 'Day' }).click();
    await dayCard.locator('.pf-apc-row').first().click();
    await expect(page.locator('.pf-apc-sheet')).toBeVisible();
    await page.waitForTimeout(500);
    await shoot(page, 'calendar-detail-375');

    await page.goto(`/frontdesk/appointments/new?date=${isoDay(tomorrow)}`);
    await expect(page.locator('.pf-bka-grid')).toBeVisible({ timeout: 30_000 });
    const bar = page.locator('.nd-bottombar .nd-btn--primary');
    await expect(bar).toBeVisible();
    expect(Math.round((await bar.boundingBox())!.width)).toBeGreaterThan(300);
    await expect(page.locator('.pf-hb__actions .pf-hb-btn--primary')).toHaveCount(0);
    const chips = page.locator('.pf-bka-chip');
    if (await chips.count() >= 2) {
      const [a, b] = [(await chips.nth(0).boundingBox())!, (await chips.nth(1).boundingBox())!];
      expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
      expect(a.height).toBeGreaterThanOrEqual(44);
      const c3 = (await chips.nth(2).boundingBox())!;
      expect(c3.y).toBeGreaterThan(a.y);
    }
    const fs = await page.locator('.pf-bka-pq').evaluate(e => parseFloat(getComputedStyle(e).fontSize));
    expect(fs).toBeGreaterThanOrEqual(16);
    await shoot(page, 'new-375');
    await page.locator('.pf-bka-slots').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shoot(page, 'new-slots-375');

    expect(writes).toEqual([]);
  });
});
