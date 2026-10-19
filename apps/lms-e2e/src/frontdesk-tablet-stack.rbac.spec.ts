import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * Frontdesk landing — tablet stack (REAL layout; jsdom can't lay out).
 * Regression: at 641–1023px the two panes stack, but the Appointments pane
 * kept the desktop row split as an inline `flex-basis: N%` — in the column
 * that became a HEIGHT, squeezing the pane below its content, and with
 * `overflow: visible` its "Open calendar" button painted over the work card's
 * In progress / Completed tabs. Every child must stay inside its own card and
 * the cards must not overlap.
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

test.describe('Frontdesk — tablet stack keeps content inside its card', () => {
  test('820 / 1000, dark + light: Appointments content inside its card, no overlap with the work card', async ({ page }) => {
    test.setTimeout(180_000);
    await relayCors(page);
    await loginAs(page, 'admin');
    const writes: string[] = [];
    await readOnly(page, writes);

    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate(t => { localStorage.setItem('pf-theme', t); localStorage.setItem('pf-design', 'new'); }, theme);
      await page.emulateMedia({ colorScheme: theme });
      for (const [width, height] of [[1000, 760], [820, 1180]] as const) {
        await page.setViewportSize({ width, height });
        await page.goto('/frontdesk');
        const appt = page.locator('.pf-appt-split > .pf-appt-split__pane:not(.pf-appt-split__pane--work)').first();
        await expect(appt).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(800);

        const m = await page.evaluate(() => {
          const rect = (e: Element | null) => {
            if (!e) return null;
            const r = e.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
          };
          const apptEl = document.querySelector('.pf-appt-split > .pf-appt-split__pane:not(.pf-appt-split__pane--work)');
          const workEl = document.querySelector('.pf-appt-split__pane--work');
          const btn = apptEl?.querySelector('.nd-empty__action');
          return { appt: rect(apptEl), work: rect(workEl), btn: btn && (btn as HTMLElement).offsetParent ? rect(btn) : null };
        });
        const tag = `${theme} ${width}`;
        expect(m.appt, tag).not.toBeNull();
        if (m.btn) {
          // "Open calendar" sits inside the Appointments card.
          expect(m.btn.top, `${tag} btn top`).toBeGreaterThanOrEqual(m.appt!.top);
          expect(m.btn.bottom, `${tag} btn bottom`).toBeLessThanOrEqual(m.appt!.bottom + 0.5);
          expect(m.btn.left, `${tag} btn left`).toBeGreaterThanOrEqual(m.appt!.left);
          expect(m.btn.right, `${tag} btn right`).toBeLessThanOrEqual(m.appt!.right);
        }
        // The two cards never overlap.
        if (m.work) expect(m.appt!.bottom, `${tag} appt/work overlap`).toBeLessThanOrEqual(m.work.top + 0.5);
      }
    }
    expect(writes).toEqual([]);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
