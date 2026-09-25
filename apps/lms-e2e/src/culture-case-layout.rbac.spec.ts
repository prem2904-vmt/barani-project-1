import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * Culture case — REAL layout (jsdom can't lay out). Signs in as the seeded
 * Micro World Lab Admin (support/auth ROLE_CREDS), opens the first culture
 * case from My Work's Culture tab, and checks the nd pattern at 1440 and
 * 375: the context bar, ONE band primary ("Submit all results"), every stage
 * stacked (no tabs), Inoculate in the nav row, option controls FILLING the
 * control column with equal segments, stacked phone rows. Read-only: it never taps
 * an option, so no stage is picked. Screenshots into $SHOTS_DIR when set.
 */

const SHOTS = process.env['SHOTS_DIR'] || '';

async function openCase(page: Page): Promise<boolean> {
  const direct = process.env['CULTURE_ORDER_TEST_ID'];
  if (direct) { await page.goto(`/lab/culture/${direct}`); return true; }
  await page.goto('/lab/my-work');
  await page.waitForLoadState('networkidle').catch(() => {});
  const tab = page.locator('pf-segmented button[aria-label="Culture"], .pf-mtab[aria-label="Culture bench"]').first();
  if (!(await tab.count())) return false;
  await tab.click();
  const card = page.locator('li.pf-cc .pf-cc__hdr').first();
  try { await card.waitFor({ timeout: 15_000 }); } catch { return false; }
  await card.click();
  try { await page.waitForURL(/\/lab\/culture\//, { timeout: 15_000 }); return true; } catch { return false; }
}

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.evaluate((t) => {
    const r = document.documentElement;
    r.classList.toggle('dark', t === 'dark');
    r.classList.toggle('light', t === 'light');
    r.setAttribute('data-theme', t);
  }, theme);
}

async function shoot(page: Page, w: number) {
  if (!SHOTS) return;
  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/${w}-${theme}.png`, fullPage: false });
  }
}

test.describe('Culture case — real layout', () => {
  test('1440 + 375: context bar, one primary, stacked stages, filling options, stacked phone rows', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.setViewportSize({ width: 1440, height: 900 });
    const opened = await openCase(page);
    test.skip(!opened, 'No culture case to open (set CULTURE_ORDER_TEST_ID).');

    await expect(page.locator('.pf-cse-ctx .pf-cse-chip--id')).toBeVisible({ timeout: 20_000 });
    const primary = page.locator('pf-hero-band .pf-hb-btn--primary');
    await expect(primary).toHaveCount(1);
    await expect(primary).toContainText('Submit all results');
    await expect(page.locator('[role="tablist"].pf-cse-tabs')).toHaveCount(0);
    expect(await page.locator('section.pf-stg').count()).toBeGreaterThanOrEqual(2);
    await expect(page.locator('.pf-cse-nav .pf-cse-incubbtn.nd-btn--secondary')).toBeVisible();

    // Options FILL the control column, segments equal width.
    const row = page.locator('.pf-cse-row').filter({ has: page.locator('.pf-cse-opts--fill:not(.pf-cse-opts--many)') }).first();
    if (await row.count()) {
      const cw = (await row.locator('.pf-cse-row__ctl').boundingBox())!.width;
      const ow = (await row.locator('.pf-cse-opts').boundingBox())!.width;
      expect(ow).toBeGreaterThanOrEqual(cw - 2);
      const widths = await row.locator('.pf-cse-opt').evaluateAll(els => els.map(e => e.getBoundingClientRect().width));
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(2);
      const h = (await row.locator('.pf-cse-opt').first().boundingBox())!.height;
      expect(h).toBeGreaterThanOrEqual(36);
    }
    await shoot(page, 1440);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(300);
    if (await row.count()) {
      const name = (await row.locator('.pf-cse-row__name').boundingBox())!;
      const ctl = (await row.locator('.pf-cse-row__ctl').boundingBox())!;
      expect(ctl.y).toBeGreaterThan(name.y + name.height - 1);   // stacked below the name
    }
    const act = page.locator('pf-hero-band .pf-cse-act').first();
    const aBox = (await act.boundingBox())!;
    expect(Math.round(aBox.width)).toBeGreaterThanOrEqual(44);
    await shoot(page, 375);
  });
});
