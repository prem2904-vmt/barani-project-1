import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * Billing counter — REAL layout (ND-PATTERN §17; jsdom can't lay out).
 * Seeded Micro World Lab Admin, READ-ONLY: after login every non-GET API call
 * is aborted (and asserted never sent), so no payment is ever taken.
 *  - 1440: the band + ONE pill search (scan icon inside); QUEUE ("Waiting to
 *    pay", oldest first) on the LEFT, BILLING (the cart) in the middle,
 *    MONEY (~400px) on the RIGHT; no tabs, no page scroll, no monospace
 *    computed, no native date control visible, no primary with nothing
 *    picked; a queue pick → the cart with the inline payment panel and at
 *    most one primary, never a hop to /frontdesk/order; Pay later picked →
 *    exactly one primary "Save — pay later" (not clicked); the grouped
 *    type-ahead; collapse → a strip on the RIGHT edge and back.
 *  - 375: the queue full screen → tap → the cart (Pay later: 44px choices,
 *    16px inputs, one primary) → band back → the queue;
 *    the pill's two-way switch shows Money.
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

/** After login: nothing may be written. Aborts + records any write. */
async function blockWrites(page: Page, writes: string[]) {
  await page.route(/\/api\//, async route => {
    const m = route.request().method();
    if (m === 'GET' || m === 'OPTIONS' || m === 'HEAD') return route.fallback();
    // Every write is aborted; billing / order / patient writes must never
    // even be attempted from this screen.
    const url = route.request().url();
    if (/\/api\/(billing|orders|patients|payments)/.test(url)) writes.push(`${m} ${url}`);
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

test.describe('Billing counter — QUEUE + BILLING + MONEY', () => {
  test('1440 queue → cart, grouped search, collapse; 375 list → cart → back, switch', async ({ page }) => {
    test.setTimeout(180_000);
    await relayCors(page);
    await loginAs(page, 'admin');
    const writes: string[] = [];
    await blockWrites(page, writes);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/billing-counter');

    const queue = page.locator('.pf-bc-panels > section.nd-card.pf-bc-queue');
    const main = page.locator('.pf-bc-panels > section.nd-card.pf-bc-main');
    await expect(queue).toBeVisible({ timeout: 30_000 });
    await expect(main).toBeVisible();
    if (await page.locator('.pf-bc-strip').isVisible().catch(() => false)) {
      await page.locator('.pf-bc-strip__btn').click();
    }
    const side = page.locator('.pf-bc-panels > aside.nd-card.pf-bc-side');
    await expect(side).toBeVisible();
    await page.waitForTimeout(1500);

    // Band + ONE pill search, scan inside; no tabs.
    const input = page.locator('pf-hero-band .pf-hb__search input.pf-bc-us__input');
    await expect(input).toHaveAttribute('placeholder', 'Search patient, phone, MRN, order or invoice ID');
    await expect(page.locator('pf-hero-band .pf-hb__inline .pf-bc-scan')).toBeVisible();
    await expect(page.locator('.pf-bc-switch')).toHaveCount(0);

    // QUEUE left · BILLING middle · MONEY ~400px right.
    const qb = (await queue.boundingBox())!;
    const mb = (await main.boundingBox())!;
    const sb = (await side.boundingBox())!;
    expect(qb.x + qb.width).toBeLessThanOrEqual(mb.x + 1);
    expect(mb.x + mb.width).toBeLessThanOrEqual(sb.x + 1);
    expect(sb.width).toBeGreaterThan(380);
    expect(sb.width).toBeLessThan(420);
    await expect(queue.locator('.nd-card__label')).toHaveText(/waiting to pay/i);
    await expect(main.locator('.nd-card__label')).toHaveText(/billing/i);
    await expect(side.locator('.nd-card__label')).toHaveText(/money/i);
    // Oldest first.
    const since = await queue.locator('.pf-bc-qrow').evaluateAll(els =>
      els.map(e => new Date(e.getAttribute('data-since') || '').getTime()));
    for (let i = 1; i < since.length; i++) expect(since[i]).toBeGreaterThanOrEqual(since[i - 1]);
    if (since.length === 0) await expect(queue.locator('.pf-bc-empty__title')).toHaveText('No one waiting to pay');
    // No primary while nothing is picked.
    expect(await page.locator('.nd-btn--primary:visible, .pf-hb-btn--primary:visible').count()).toBe(0);
    // Kit date (typed) — no visible native date control.
    await expect(side.locator('pf-nd-date input[type="text"]')).toHaveAttribute('placeholder', 'dd/mm/yyyy');
    const visibleNativeDates = await page.locator('input[type="date"]').evaluateAll(els =>
      els.filter(e => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(e).opacity !== '0'; }).length);
    expect(visibleNativeDates).toBe(0);
    // Noto only: nothing on the screen computes to a monospace family.
    const mono = await page.evaluate(() => Array.from(document.querySelectorAll('.pf-bc *'))
      .filter(e => /mono|courier/i.test(getComputedStyle(e).fontFamily)).length);
    expect(mono).toBe(0);
    const ps = await noPageScroll(page);
    expect(ps.doc).toBeLessThanOrEqual(1);
    expect(ps.main).toBeLessThanOrEqual(1);
    await shoot(page, '1440');

    // A queue pick → the cart + the payment panel, taken HERE.
    const firstRow = queue.locator('.pf-bc-qrow').first();
    if (await firstRow.count()) {
      await firstRow.click();
      await expect(main.locator('.pf-bc-subject__name')).toBeVisible({ timeout: 15_000 });
      await expect(main.locator('pf-inline-payment-panel, .pf-bc-pay, .pf-bc-dues').first()).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(1200);
      expect(await page.locator('.nd-btn--primary:visible').count()).toBeLessThanOrEqual(1);
      expect(page.url()).not.toContain('/frontdesk/order');
      await expect(queue.locator('.pf-bc-qrow[aria-pressed="true"]')).toHaveCount(1);
      const noSideways = await page.evaluate(() => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth);
      expect(noSideways).toBeLessThanOrEqual(1);
      await shoot(page, '1440-cart');
      // Pay later: a neutral choice in the panel; the ONE primary becomes
      // "Save — pay later" (never clicked — writes are blocked anyway).
      const later = main.locator('.pf-ipp__kind', { hasText: 'Pay later' });
      if (await later.count()) {
        await later.click();
        await expect(page.locator('.nd-btn--primary:visible')).toHaveCount(1);
        await expect(page.locator('.nd-btn--primary:visible')).toHaveText(/Save — pay later/);
        await shoot(page, '1440-paylater');
      }
      await main.locator('.pf-bc-clear').click();
    }

    // Grouped type-ahead (read-only GETs); typing also filters the queue.
    await input.click();
    await input.fill('ra');
    const drop = page.locator('#pf-bc-drop');
    await expect(drop).toBeVisible();
    await expect(drop.locator('.pf-bc-drop__title')).toHaveText(['Patients', 'Orders & invoices'], { timeout: 15_000 });
    await page.waitForTimeout(1200);
    const db = (await drop.boundingBox())!;
    const pill = (await page.locator('pf-hero-band .pf-hb__search').boundingBox())!;
    expect(Math.abs(db.width - pill.width)).toBeLessThanOrEqual(2);
    await shoot(page, '1440-search');
    await input.press('Escape');
    await input.fill('');

    // Collapse MONEY → a strip on the RIGHT edge; BILLING takes the room.
    const mainBefore = (await main.boundingBox())!.width;
    await side.locator('.pf-bc-collapse').click();
    const strip = page.locator('.pf-bc-strip');
    await expect(strip).toBeVisible();
    await page.waitForTimeout(500);
    const stb = (await strip.boundingBox())!;
    expect(stb.width).toBeLessThan(64);
    const mAfter = (await main.boundingBox())!;
    expect(stb.x).toBeGreaterThanOrEqual(mAfter.x + mAfter.width - 1);
    expect(mAfter.width).toBeGreaterThan(mainBefore + 300);
    await shoot(page, '1440-collapsed');
    await strip.locator('button').click();
    await expect(side).toBeVisible();

    // ── Phone ───────────────────────────────────────────────────────────
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(700);
    const sw = page.locator('pf-hero-band .pf-bc-switch');
    await expect(sw).toBeVisible();
    await expect(queue).toBeVisible();
    await expect(page.locator('.pf-bc-main')).toHaveCount(0);
    await expect(page.locator('.pf-bc-side')).toHaveCount(0);
    expect((await queue.boundingBox())!.width).toBeGreaterThan(300);
    const sideways = await page.evaluate(() => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth);
    expect(sideways).toBeLessThanOrEqual(1);
    await shoot(page, '375-queue');
    const phoneRow = queue.locator('.pf-bc-qrow').first();
    if (await phoneRow.count()) {
      const h = (await phoneRow.boundingBox())!.height;
      expect(h).toBeGreaterThanOrEqual(44);
      await phoneRow.click();
      await expect(main).toBeVisible({ timeout: 15_000 });
      await expect(queue).toHaveCount(0);
      await expect(main.locator('.pf-bc-subject__name')).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(1000);
      expect(page.url()).not.toContain('/frontdesk/order');
      await shoot(page, '375-cart');
      const laterPh = main.locator('.pf-ipp__kind', { hasText: 'Pay later' });
      if (await laterPh.count()) {
        await laterPh.click();
        expect((await laterPh.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        const adv = main.locator('.pf-ipp__input').first();
        expect(await adv.evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
        await expect(page.locator('.nd-btn--primary:visible')).toHaveCount(1);
        await shoot(page, '375-paylater');
      }
      await page.locator('pf-hero-band .pf-hb__back').click();
      await expect(queue).toBeVisible();
      expect(page.url()).toContain('/billing-counter');
    }
    await sw.getByRole('radio', { name: /money/i }).click();
    await expect(page.locator('.pf-bc-side')).toBeVisible();
    await expect(queue).toHaveCount(0);
    await page.waitForTimeout(400);
    await shoot(page, '375-money');

    expect(writes, 'no writes may be sent').toEqual([]);
  });
});
