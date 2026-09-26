import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * Billing counter — REAL layout (ND-PATTERN "two jobs on one screen"; jsdom
 * can't lay out). Seeded Micro World Lab Admin, READ-ONLY: after login every
 * non-GET API call is aborted (and asserted never sent).
 *  - 1440: the band + ONE pill search (scan icon inside), BILLING main card
 *    on the LEFT, MONEY (~400px) on the RIGHT, no tabs, no page scroll,
 *    no monospace computed, no native date control visible, no primary with
 *    nothing selected; the grouped type-ahead; collapse → a strip on the
 *    RIGHT edge and back.
 *  - 375: one card at a time via the pill's two-way switch.
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

test.describe('Billing counter — BILLING + MONEY', () => {
  test('1440 two cards + grouped search + collapse, 375 switch', async ({ page }) => {
    test.setTimeout(180_000);
    await relayCors(page);
    await loginAs(page, 'admin');
    const writes: string[] = [];
    await blockWrites(page, writes);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/billing-counter');

    const main = page.locator('.pf-bc-panels > section.nd-card.pf-bc-main');
    await expect(main).toBeVisible({ timeout: 30_000 });
    if (await page.locator('.pf-bc-strip').isVisible().catch(() => false)) {
      await page.locator('.pf-bc-strip__btn').click();
    }
    const side = page.locator('.pf-bc-panels > aside.nd-card.pf-bc-side');
    await expect(side).toBeVisible();
    await page.waitForTimeout(800);

    // Band + ONE pill search, scan inside; no tabs.
    const input = page.locator('pf-hero-band .pf-hb__search input.pf-bc-us__input');
    await expect(input).toHaveAttribute('placeholder', 'Search patient, phone, MRN, order or invoice ID');
    await expect(page.locator('pf-hero-band .pf-hb__inline .pf-bc-scan')).toBeVisible();
    await expect(page.locator('.pf-bc-switch')).toHaveCount(0);
    await expect(page.getByText('Find & bill')).toHaveCount(0);

    // BILLING left, MONEY ~400px right.
    const mb = (await main.boundingBox())!;
    const sb = (await side.boundingBox())!;
    expect(mb.x + mb.width).toBeLessThanOrEqual(sb.x + 1);
    expect(sb.width).toBeGreaterThan(380);
    expect(sb.width).toBeLessThan(420);
    await expect(main.locator('.nd-card__label')).toHaveText(/billing/i);
    await expect(side.locator('.nd-card__label')).toHaveText(/money/i);
    // No primary while nothing is selected.
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

    // Grouped type-ahead (read-only GETs).
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

    // Pick the first patient → their orders to bill; open one → ONE primary.
    const firstPatient = drop.locator('.pf-bc-drop__group').first().locator('[role="option"]').first();
    if (await firstPatient.count()) {
      await firstPatient.click();
      await expect(main.locator('.pf-bc-subject__name')).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(1500);
      await shoot(page, '1440-patient');
      const orow = main.locator('.pf-bc-orow').first();
      if (await orow.count()) {
        await orow.click();
        await expect(main.locator('.pf-bc-items')).toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(800);
        expect(await page.locator('.nd-btn--primary:visible, .pf-hb-btn--primary:visible').count()).toBeLessThanOrEqual(1);
        await shoot(page, '1440-order');
      }
      await main.locator('.pf-bc-clear').click();
    } else {
      await input.press('Escape');
    }

    // A balance row (if any) opens the order in BILLING with ONE primary.
    const mrow = side.locator('.pf-bc-mrow').first();
    if (await mrow.count()) {
      await mrow.click();
      await expect(main.locator('.pf-bc-subject__name')).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(600);
      expect(await page.locator('.nd-btn--primary:visible').count()).toBeLessThanOrEqual(1);
      await shoot(page, '1440-balance');
      await main.locator('.pf-bc-clear').click();
    }

    // Collapse → a strip on the RIGHT edge; BILLING takes the room.
    await side.locator('.pf-bc-collapse').click();
    const strip = page.locator('.pf-bc-strip');
    await expect(strip).toBeVisible();
    await page.waitForTimeout(500);
    const stb = (await strip.boundingBox())!;
    expect(stb.width).toBeLessThan(64);
    expect(stb.x).toBeGreaterThanOrEqual((await main.boundingBox())!.x + (await main.boundingBox())!.width - 1);
    expect((await main.boundingBox())!.width).toBeGreaterThan(mb.width + 300);
    await shoot(page, '1440-collapsed');
    await strip.locator('button').click();
    await expect(side).toBeVisible();

    // ── Phone ───────────────────────────────────────────────────────────
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(700);
    const sw = page.locator('pf-hero-band .pf-bc-switch');
    await expect(sw).toBeVisible();
    await expect(main).toBeVisible();
    await expect(page.locator('.pf-bc-side')).toHaveCount(0);
    expect((await main.boundingBox())!.width).toBeGreaterThan(300);
    const sideways = await page.evaluate(() => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth);
    expect(sideways).toBeLessThanOrEqual(1);
    await shoot(page, '375-billing');
    await sw.getByRole('radio', { name: /money/i }).click();
    await expect(page.locator('.pf-bc-side')).toBeVisible();
    await expect(main).toHaveCount(0);
    await page.waitForTimeout(400);
    await shoot(page, '375-money');

    expect(writes, 'no writes may be sent').toEqual([]);
  });
});
