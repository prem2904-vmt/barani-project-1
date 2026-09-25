import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * Result entry — REAL layout (jsdom can't lay out, which is how a phone row
 * once collapsed the parameter name to ~0px, one letter per line).
 *
 * Signs in as the seeded Micro World Lab Admin (support/auth ROLE_CREDS),
 * finds a tube from the Lab queue, opens /lab/sample/:id and checks, at
 * 375×812: the name cell is ≥200px wide, the result field is full width and
 * ≥44px tall, the band carries the two 44px icon actions, there is no
 * bottom action bar and no tabs control. Also screenshots 375 (dark +
 * light), 768 and 1440 into $SHOTS_DIR when set.
 */

const SHOTS = process.env['SHOTS_DIR'] || '';

/** Open a tube the way a tech does: My Work's band search (type the sample
 *  ID + Enter → /lab/sample/:id). Tries the queue tiles first. Read-only:
 *  the spec never types into a result field, so nothing is claimed/saved. */
async function openSample(page: Page): Promise<boolean> {
  await page.goto('/lab/my-work');
  await page.waitForLoadState('networkidle').catch(() => {});
  const tile = page.locator('[data-vt-sample]').first();
  if (await tile.count()) {
    await page.goto(`/lab/sample/${await tile.getAttribute('data-vt-sample')}`);
    return true;
  }
  const code = process.env['RESULT_BARCODE'] || '26124';
  const input = page.locator('pf-hero-band input.pf-hb__input');
  await input.fill(code);
  await input.press('Enter');
  try {
    await page.waitForURL(/\/lab\/sample\//, { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.evaluate((t) => {
    const r = document.documentElement;
    r.classList.toggle('dark', t === 'dark');
    r.classList.toggle('light', t === 'light');
    r.setAttribute('data-theme', t);
  }, theme);
}

test.describe('Result entry — real layout', () => {
  test('phone 375: stacked rows, wide name, full-width field, icon actions in the band', async ({ page }) => {
    await loginAs(page, 'admin');
    const opened = await openSample(page);
    test.skip(!opened, 'No sample to open (set RESULT_BARCODE to a tube in the Lab).');

    await page.setViewportSize({ width: 375, height: 812 });
    const row = page.locator('.pf-sre__grow').first();
    await expect(row).toBeVisible({ timeout: 20_000 });

    const nameBox = await row.locator('td.pf-sre__gc-param').boundingBox();
    expect(nameBox!.width).toBeGreaterThanOrEqual(200);
    const field = row.locator('td.pf-sre__gc-result').locator('input.pf-sre__ginput, textarea.pf-sre__ginput, .pf-dd__trigger, input[type="checkbox"]').first();
    const fBox = await field.boundingBox();
    const rowBox = await row.boundingBox();
    if (!(await field.getAttribute('type'))?.includes('checkbox')) {
      expect(fBox!.height).toBeGreaterThanOrEqual(44);
      expect(fBox!.width).toBeGreaterThanOrEqual(rowBox!.width - 40);
    }
    // Range / unit lines are gone on phones (they live in the "i" peek).
    await expect(row.locator('td.pf-sre__gc-range')).toBeHidden();
    // Band actions: 44px icons; no bottom action bar; no tabs control.
    const submit = page.locator('pf-hero-band .pf-sre-submit');
    const sBox = await submit.boundingBox();
    expect(Math.round(sBox!.width)).toBeGreaterThanOrEqual(44);
    expect(Math.round(sBox!.height)).toBeGreaterThanOrEqual(44);
    await expect(page.locator('.nd-bottombar')).toHaveCount(0);
    await expect(page.locator('.pf-sre-tabs')).toBeHidden();
    // The card label follows the phone type scale (12px), not the global h2 cap.
    const labelSize = await page.locator('.pf-sre-card__label').first().evaluate((e) => getComputedStyle(e).fontSize);
    expect(labelSize).toBe('12px');

    if (SHOTS) {
      // Let the "not in your queue" toast leave before the screenshots.
      await page.waitForTimeout(6500);
      for (const theme of ['dark', 'light'] as const) {
        await setTheme(page, theme);
        await page.waitForTimeout(200);
        await page.screenshot({ path: `${SHOTS}/375-${theme}.png` });
      }
      const info = row.locator('.pf-sre__info-btn');
      if (await info.count()) {
        await info.click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${SHOTS}/375-light-peek.png` });
      }
      for (const w of [768, 1440]) {
        await page.setViewportSize({ width: w, height: 900 });
        for (const theme of ['dark', 'light'] as const) {
          await setTheme(page, theme);
          await page.waitForTimeout(300);
          await page.screenshot({ path: `${SHOTS}/${w}-${theme}.png` });
        }
      }
    }
  });
});
