import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * Test Master LIST — two cards, REAL layout (ND-PATTERN "two jobs on one
 * screen"; jsdom can't lay out). Seeded Micro World Lab Admin, READ-ONLY
 * (no switch is flipped, nothing is saved):
 *  - 1440: DEPARTMENTS is the ~340px SIDE card on the LEFT (filter first),
 *    the grid the MAIN card on the right; a row tap filters; collapse → a
 *    slim strip on the left edge and back; no page scroll.
 *  - 375: no side column; the band pill's "Departments" opens a sheet above
 *    the always-visible navbar.
 * Screenshots (1440 expanded / collapsed, 375, light + dark) into $SHOTS_DIR.
 * CORS_RELAY=1 relays backend calls so it can run against a static build on
 * a non-allowlisted port (BASE_URL=…:4310).
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

test.describe('Test Master — main card + DEPARTMENTS side card', () => {
  test('1440 expanded / collapsed, 375 sheet', async ({ page }) => {
    await relayCors(page);
    await loginAs(page, 'admin');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/admin/tests');

    const main = page.locator('.pf-tm-panels > section.nd-card.pf-tm-main');
    const side = page.locator('.pf-tm-panels > aside.nd-card.pf-tm-side');
    await expect(main).toBeVisible({ timeout: 30_000 });
    // A remembered collapse from an earlier run: open it first.
    if (await page.locator('.pf-tm-strip').isVisible().catch(() => false)) {
      await page.locator('.pf-tm-strip button').click();
    }
    await expect(side).toBeVisible();
    await expect(page.locator('.ag-row').first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(600);

    // Side LEFT (~340px, BILLING header), main RIGHT filling the rest.
    const mb = (await main.boundingBox())!;
    const sb = (await side.boundingBox())!;
    expect(sb.x + sb.width).toBeLessThanOrEqual(mb.x + 1);
    expect(sb.width).toBeGreaterThan(320);
    expect(sb.width).toBeLessThan(360);
    await expect(side.locator('.nd-card__head .nd-card__label')).toHaveText(/departments/i);
    await expect(main.locator('.nd-card__note')).toContainText('Double-click a cell to edit');
    const deptRows = side.locator('.pf-tm-dept-row');
    expect(await deptRows.count()).toBeGreaterThan(2);
    const ps = await noPageScroll(page);
    expect(ps.doc).toBeLessThanOrEqual(1);
    expect(ps.main).toBeLessThanOrEqual(1);
    await shoot(page, '1440-expanded');

    // Row tap filters the grid (read-only; "All" restores it).
    const count = main.locator('.pf-tm-count');
    const all = (await count.innerText()).trim();
    await deptRows.nth(1).locator('.pf-tm-dept').click();
    await expect(deptRows.nth(1).locator('.pf-tm-dept')).toHaveAttribute('aria-pressed', 'true');
    await expect(count).not.toHaveText(all);
    await deptRows.nth(0).locator('.pf-tm-dept').click();
    await expect(count).toHaveText(all);

    // Collapse → strip; the grid takes the room.
    await side.locator('.pf-tm-side__collapse').click();
    const strip = page.locator('.pf-tm-strip');
    await expect(strip).toBeVisible();
    await page.waitForTimeout(500);
    const stb = (await strip.boundingBox())!;
    expect(stb.width).toBeLessThan(64);
    expect(stb.x + stb.width).toBeLessThanOrEqual((await main.boundingBox())!.x + 1);   // strip on the LEFT edge
    expect((await main.boundingBox())!.width).toBeGreaterThan(mb.width + 250);
    await shoot(page, '1440-collapsed');
    await strip.locator('button').click();
    await expect(side).toBeVisible();

    // ── Phone ───────────────────────────────────────────────────────────
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(600);
    await expect(side).toHaveCount(0);
    await expect(strip).toHaveCount(0);
    const mw = (await main.boundingBox())!.width;
    expect(mw).toBeGreaterThan(300);
    await shoot(page, '375');
    const btn = page.locator('pf-hero-band .pf-tm-deptchip');
    await expect(btn).toBeVisible();
    await btn.click();
    const sheet = page.locator('.pf-tm-side--sheet');
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(500);
    // The sheet sits above the always-visible bottom navbar.
    const sheetBottom = (await sheet.boundingBox())!;
    const navH = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nd-nav-h')) || 0);
    expect(sheetBottom.y + sheetBottom.height).toBeLessThanOrEqual(812 - navH + 1);
    await shoot(page, '375-sheet');
    await sheet.locator('button[aria-label="Close departments"]').click();
    await expect(sheet).toHaveCount(0);
  });
});
