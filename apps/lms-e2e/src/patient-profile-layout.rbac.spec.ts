import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * Patient profile — REAL layout (ND-PATTERN "Patient profile"; jsdom can't
 * lay out). Seeded Micro World Lab Admin, READ-ONLY: after login every
 * non-GET API call is aborted, so nothing is ordered, merged or edited.
 *  - 1440: the band pill = FULL name + "22/M · MRN · phone" (+ ABHA, flags);
 *    ONE primary "New order"; HISTORY main card (search, then the neutral
 *    filter) + SUMMARY ~400px on the right; an order row zooms into the
 *    order and back; Trends / Timeline; collapse → strip → back; no page
 *    scroll, no monospace, no native select.
 *  - 375: history full width, the primary full width in the bottom bar
 *    above the navbar, 44px targets, Summary + More as sheets.
 * PATIENT_ID picks the patient (default: the owner's reference patient, else
 * the first patient the search finds). Screenshots (light + dark) into
 * $SHOTS_DIR. CORS_RELAY=1 relays backend calls so it can run against a
 * static build on a spare port.
 */

const SHOTS = process.env['SHOTS_DIR'] || '';
const PATIENT_ID = process.env['PATIENT_ID'] || '32c6cd34-1a99-4aea-ad43-f9889d8b3bf0';

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

async function blockWrites(page: Page, writes: string[]) {
  await page.route(/\/api\//, async route => {
    const m = route.request().method();
    if (m === 'GET' || m === 'OPTIONS' || m === 'HEAD') return route.fallback();
    // Report PDF builds resolve layouts with a read-only POST preview.
    if (/\/api\/report-layout\/preview\//.test(route.request().url())) return route.fallback();
    writes.push(`${m} ${route.request().url()}`);
    return route.abort();
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
    await page.waitForTimeout(450);
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

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const TREND_FIXTURE = [{
  testId: 'fx-cbc', testName: 'Complete Blood Count', count: 5, parameters: [
    { parameter: 'Haemoglobin', unit: 'g/dL', referenceRange: '13 - 17', points: [
      { date: day(120), value: 12.1, flag: 'L' }, { date: day(90), value: 12.8, flag: 'L' }, { date: day(60), value: 13.4, flag: 'N' },
      { date: day(30), value: 14.2, flag: 'N' }, { date: day(2), value: 14.6, flag: 'N' }] },
    { parameter: 'WBC count', unit: '10^3/µL', referenceRange: '4 - 11', points: [
      { date: day(120), value: 7.2, flag: 'N' }, { date: day(90), value: 8.9, flag: 'N' }, { date: day(60), value: 11.8, flag: 'H' },
      { date: day(30), value: 9.4, flag: 'N' }, { date: day(2), value: 12.3, flag: 'H' }] },
    { parameter: 'Platelets', unit: '10^3/µL', referenceRange: '150 - 410', points: [
      { date: day(120), value: 210, flag: 'N' }, { date: day(90), value: 240, flag: 'N' }, { date: day(60), value: 260, flag: 'N' },
      { date: day(30), value: 232, flag: 'N' }, { date: day(2), value: 251, flag: 'N' }] },
  ],
}, {
  testId: 'fx-fbs', testName: 'Fasting Blood Sugar', count: 4, parameters: [
    { parameter: 'Glucose, fasting', unit: 'mg/dL', referenceRange: '70 - 100', points: [
      { date: day(100), value: 96, flag: 'N' }, { date: day(70), value: 104, flag: 'H' }, { date: day(40), value: 99, flag: 'N' },
      { date: day(5), value: 92, flag: 'N' }] },
  ],
}];

test.describe('Patient profile — HISTORY + SUMMARY', () => {
  test('1440 band + cards + order zoom; 375 bottom bar + sheets', async ({ page }) => {
    test.setTimeout(240_000);
    await relayCors(page);
    await loginAs(page, 'admin');
    const writes: string[] = [];
    await blockWrites(page, writes);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto(`/frontdesk/patients/${PATIENT_ID}`);
    const name = page.locator('.pf-pp-ctx .pf-pp-name');
    await expect(name).toBeVisible({ timeout: 30_000 });
    expect((await name.textContent())?.trim().length).toBeGreaterThan(2);
    await expect(page.locator('.pf-pp-ctx .pf-pp-meta')).toHaveText(/^\S+\/[MFO—] · /);
    if (await page.locator('.pf-pp-strip').isVisible().catch(() => false)) await page.locator('.pf-pp-strip__btn').click();

    // ONE primary: New order.
    const primaries = page.locator('.nd-btn--primary:visible, .pf-hb-btn--primary:visible');
    await expect(primaries).toHaveCount(1);
    await expect(primaries.first()).toHaveAttribute('aria-label', 'New order');
    // HISTORY main + SUMMARY on the right, ~400px.
    const card = page.locator('section.nd-card.pf-pp-main');
    const side = page.locator('aside.nd-card.pf-pp-side');
    await expect(card).toBeVisible();
    await expect(side).toBeVisible();
    const cb = (await card.boundingBox())!;
    const sb = (await side.boundingBox())!;
    expect(cb.x + cb.width).toBeLessThanOrEqual(sb.x + 1);
    expect(sb.width).toBeGreaterThan(380);
    expect(sb.width).toBeLessThan(420);
    // Card header: search first, then the filter.
    const fb = (await page.locator('.pf-pp-find').boundingBox())!;
    const gb = (await page.locator('.pf-pp-seg').boundingBox())!;
    expect(fb.x).toBeLessThan(gb.x);
    await page.waitForTimeout(800);
    const mono = await page.evaluate(() => Array.from(document.querySelectorAll('.pf-pp *'))
      .filter(e => /mono|courier/i.test(getComputedStyle(e).fontFamily)).length);
    expect(mono).toBe(0);
    expect(await page.locator('.pf-pp select, .pf-pp datalist').count()).toBe(0);
    const ps = await noPageScroll(page);
    expect(ps.doc).toBeLessThanOrEqual(1);
    expect(ps.main).toBeLessThanOrEqual(1);
    await shoot(page, '1440');

    // An order row zooms into the order (in the card) and back.
    const row = page.locator('.pf-lo-row').first();
    if (await row.count()) {
      await row.click();
      await expect(page.locator('.pf-lo-detail')).toBeVisible();
      await page.waitForTimeout(500);
      await shoot(page, '1440-order');
      await page.locator('.pf-lo-detail__back').click();
      await expect(page.locator('.pf-lo-row').first()).toBeVisible();
    }

    // Trends + Timeline behind the same filter.
    await page.locator('.pf-pp-seg [role=radio]', { hasText: 'Trends' }).click();
    await page.waitForTimeout(1500);
    await shoot(page, '1440-trends');
    // A made-up series (answered in the browser) so the restyled chart is
    // seen even when this patient has no repeat tests yet.
    await page.route(/\/lab-trends(\?|$)/, route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { tests: TREND_FIXTURE } }),
    }));
    await page.locator('.pf-pp-seg [role=radio]', { hasText: 'Timeline' }).click();
    await page.locator('.pf-pp-seg [role=radio]', { hasText: 'Trends' }).click();
    await expect(page.locator('.pf-lt__matrix')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1200);
    await shoot(page, '1440-trends-fixture');
    await page.locator('.pf-lt__cell').first().click();
    await expect(page.locator('.pf-lt__chart')).toBeVisible();
    await page.waitForTimeout(1200);
    await shoot(page, '1440-trends-chart');
    await page.unroute(/\/lab-trends(\?|$)/);
    await page.locator('.pf-pp-seg [role=radio]', { hasText: 'Timeline' }).click();
    await page.waitForTimeout(500);
    await shoot(page, '1440-timeline');
    await page.locator('.pf-pp-seg [role=radio]', { hasText: 'Orders' }).click();

    // More menu.
    await page.locator('.pf-pp-act--more').click();
    await expect(page.locator('.pf-pp-sheet--more')).toBeVisible();
    await page.waitForTimeout(400);
    await shoot(page, '1440-more');
    await page.keyboard.press('Escape');
    await expect(page.locator('.pf-pp-sheet--more')).toHaveCount(0);

    // Collapse → a strip on the RIGHT edge → back.
    await page.locator('.pf-pp-collapse').click();
    await expect(page.locator('.pf-pp-strip')).toBeVisible();
    await page.waitForTimeout(450);
    await shoot(page, '1440-collapsed');
    await page.locator('.pf-pp-strip__btn').click();
    await expect(side).toBeVisible();

    // ── 375 ──
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(800);
    await expect(page.locator('.pf-pp-side')).toHaveCount(0);
    const bar = page.locator('.pf-pp-bottombar__new');
    await expect(bar).toBeVisible();
    const bb = (await bar.boundingBox())!;
    expect(bb.width).toBeGreaterThan(300);
    expect(bb.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator('.nd-btn--primary:visible, .pf-hb-btn--primary:visible')).toHaveCount(1);
    for (const b of [page.locator('.pf-pp-act--more'), page.locator('.pf-pp-ctx__summary')]) {
      const r = (await b.boundingBox())!;
      expect(r.width).toBeGreaterThanOrEqual(44);
      expect(r.height).toBeGreaterThanOrEqual(44);
    }
    const mb = (await card.boundingBox())!;
    expect(mb.width).toBeGreaterThanOrEqual(370);
    const ps2 = await noPageScroll(page);
    expect(ps2.doc).toBeLessThanOrEqual(1);
    await shoot(page, '375');

    await page.locator('.pf-pp-ctx__summary').click();
    await expect(page.locator('.pf-pp-sheet--summary')).toBeVisible();
    await page.waitForTimeout(450);
    await shoot(page, '375-summary');
    await page.locator('.pf-pp-sheet--summary .pf-pp-close').click();

    await page.locator('.pf-pp-act--more').click();
    await expect(page.locator('.pf-pp-sheet--more')).toBeVisible();
    await page.waitForTimeout(450);
    await shoot(page, '375-more');
    await page.locator('.pf-pp-sheet__cancel').click();

    expect(writes).toEqual([]);
  });
});
