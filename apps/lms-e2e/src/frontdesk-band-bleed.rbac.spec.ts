import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * Frontdesk hero band — full bleed on PHONES (REAL layout; jsdom can't lay out).
 * Regression: on ≤640px the global styles.scss "PAGE PADDING" rule gave the
 * Frontdesk section.pf-page a 12px gutter ON TOP of the header's own padding,
 * so the band's 1rem bleed stopped 10px short of the screen edge — a dark gap
 * in the top-left corner, Frontdesk only. The band must sit flush (left 0,
 * right 0) at the same top as every other screen, in both themes.
 * Seeded Micro World Lab Admin, READ-ONLY (every non-GET API call aborted).
 * CORS_RELAY=1 relays backend calls so it can run against a static build.
 */

async function relayCors(page: Page) {
  if (!process.env['CORS_RELAY']) return;
  await page.route(/prefrontal\.health\/api\//, async route => {
    const origin = new URL(page.url() || 'http://localhost').origin;
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    // In-flight polls can outlive the test — never fail teardown on them.
    const res = await route.fetch().catch(() => null);
    if (!res) return route.abort().catch(() => {});
    await route.fulfill({ response: res, headers: { ...res.headers(), ...cors } }).catch(() => {});
  });
}

async function readOnly(page: Page, writes: string[]) {
  await page.route(/\/api\//, async route => {
    const req = route.request();
    const m = req.method();
    if (m !== 'GET' && m !== 'OPTIONS' && m !== 'HEAD') { writes.push(`${m} ${req.url()}`); return route.abort(); }
    return route.fallback();
  });
}

async function bandRect(page: Page, path: string) {
  await page.goto(path);
  const band = page.locator('.pf-hb__band').first();
  await expect(band).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(400);
  return band.evaluate(el => {
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(window.innerWidth - r.right) };
  });
}

test.describe('Frontdesk — hero band is flush on phones', () => {
  test('375 + 570, dark + light: band left/right 0, same top as My Work', async ({ page }) => {
    test.setTimeout(180_000);
    await relayCors(page);
    await loginAs(page, 'admin');
    const writes: string[] = [];
    await readOnly(page, writes);

    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate(t => { localStorage.setItem('pf-theme', t); localStorage.setItem('pf-design', 'new'); }, theme);
      await page.emulateMedia({ colorScheme: theme });
      for (const width of [375, 570]) {
        await page.setViewportSize({ width, height: 900 });
        const ref = await bandRect(page, '/lab/my-work');
        const fd = await bandRect(page, '/frontdesk');
        expect(fd.left, `${theme} ${width} left`).toBe(0);
        expect(fd.right, `${theme} ${width} right`).toBe(0);
        expect(fd.top, `${theme} ${width} top`).toBe(ref.top);

        // The cards keep a sensible inset: the body gutter == the bleed (14–16px).
        const inset = await page.locator('.pf-page__body').evaluate(el => parseFloat(getComputedStyle(el).paddingLeft));
        expect(inset).toBeGreaterThanOrEqual(14);
        expect(inset).toBeLessThanOrEqual(16);
      }
    }
    expect(writes).toEqual([]);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
