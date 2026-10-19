import { test, expect, devices, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * Reports list — REAL layout (ND-PATTERN "Reports list"; jsdom can't lay out).
 * Seeded Micro World Lab Admin, READ-ONLY: after login every non-GET API call
 * is aborted (the page's self-healing backfill POST included), so nothing is
 * generated, delivered or archived.
 *  - 1440 + 375, light + dark: All and Partial (first partial card open).
 *  - ONE status filter (the band pill), no stats strip, no primary, no
 *    monospace, no native select; phones: the filter scrolls inside its own
 *    row, no page-level horizontal scroll, 44px targets.
 * Screenshots into $SHOTS_DIR. CORS_RELAY=1 relays backend calls so it can
 * run against a static build on a spare port (BASE_URL).
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

async function blockWrites(page: Page, writes: string[]) {
  await page.route(/\/api\//, async route => {
    const m = route.request().method();
    if (m === 'GET' || m === 'OPTIONS' || m === 'HEAD') return route.fallback();
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
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/${name}-${theme}.png`, fullPage: false });
  }
  await setTheme(page, 'light');
}

async function pageChecks(page: Page) {
  // One filter; no duplicate strip; no primary; one font; no native select.
  await expect(page.locator('.pf-rq-seg[role=radiogroup]')).toHaveCount(1);
  await expect(page.locator('.pf-rq-stats:visible, .pf-rq-stat:visible')).toHaveCount(0);
  await expect(page.locator('.nd-btn--primary:visible, .pf-hb-btn--primary:visible')).toHaveCount(0);
  const mono = await page.evaluate(() => Array.from(document.querySelectorAll('.pf-rq-page *'))
    .filter(e => /mono|courier/i.test(getComputedStyle(e).fontFamily)).length);
  expect(mono).toBe(0);
  expect(await page.locator('.pf-rq-page select').count()).toBe(0);
  const hscroll = await page.evaluate(() => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth);
  expect(hscroll).toBeLessThanOrEqual(1);
}

async function openPartial(page: Page) {
  await page.locator('.pf-rq-seg [data-filter="partial"]').click();
  await expect(page.locator('.pf-rq-card--partial, .pf-rq-body .nd-empty').first()).toBeVisible({ timeout: 30_000 });
  const card = page.locator('.pf-rq-card--partial').first();
  if (await card.count()) {
    const toggle = card.locator('.pf-rq-card__toggle');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await page.waitForTimeout(450);
    await expect(card.locator('.pf-rq-card__collapse')).not.toHaveAttribute('inert', '');
  } else {
    await expect(page.locator('.pf-rq-body .nd-empty')).toBeVisible();
  }
}

test.describe('Reports list — ND', () => {
  test('1440 + 375: All and Partial, one filter, no primary', async ({ page, browser }) => {
    test.setTimeout(240_000);
    await relayCors(page);
    await loginAs(page, 'admin');
    const writes: string[] = [];
    await blockWrites(page, writes);

    // ── 1440 ──
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/reports');
    await expect(page.locator('.pf-rq-seg')).toBeVisible({ timeout: 30_000 });
    await page.locator('.pf-rq-seg [data-filter="all"]').click();
    await expect(page.locator('.pf-rq-card--report').first()).toBeVisible({ timeout: 30_000 });
    await pageChecks(page);
    await shoot(page, '1440-all');

    await openPartial(page);
    await pageChecks(page);
    await shoot(page, '1440-partial');

    // ── 375: a phone (touch, no hover) — row actions become 44px icons ──
    const phoneCtx = await browser.newContext({
      ...devices['iPhone 13'], viewport: { width: 375, height: 812 }, ignoreHTTPSErrors: true,
      baseURL: process.env['BASE_URL'], storageState: await page.context().storageState(),
    });
    const phone = await phoneCtx.newPage();
    await relayCors(phone);
    await blockWrites(phone, writes);
    await phone.goto('/reports');
    await expect(phone.locator('.pf-rq-seg')).toBeVisible({ timeout: 30_000 });
    await openPartial(phone);
    await pageChecks(phone);
    // The filter scrolls inside its own row; its radios are 44px targets.
    const item = (await phone.locator('.pf-rq-seg [role=radio]').first().boundingBox())!;
    expect(item.height).toBeGreaterThanOrEqual(44);
    const tools = await phone.evaluate(() => {
      const t = document.querySelector('.pf-hb__tools') as HTMLElement;
      return getComputedStyle(t).overflowX;
    });
    expect(['auto', 'scroll']).toContain(tools);
    await shoot(phone, '375-partial');

    await phone.locator('.pf-rq-seg [data-filter="all"]').click();
    await expect(phone.locator('.pf-rq-card--report').first()).toBeVisible();
    for (const b of await phone.locator('.pf-rq-card--report').first().locator('.nd-rowact').all()) {
      const bb = (await b.boundingBox())!;
      expect(bb.height).toBeGreaterThanOrEqual(44);
      expect(bb.width).toBeGreaterThanOrEqual(40);
    }
    await pageChecks(phone);
    await shoot(phone, '375-all');
    await phoneCtx.close();

    expect(writes.filter(w => !/\/api\/reports\/backfill/.test(w))).toEqual([]);
  });
});
