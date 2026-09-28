import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * Report view — REAL layout (ND-PATTERN "Report view"; jsdom can't lay out).
 * Seeded Micro World Lab Admin, READ-ONLY: after login every non-GET API
 * call is aborted, so nothing is delivered, archived or edited.
 *  - 1440: Results list → tap View → the PREVIEW card (skeleton first — the
 *    pdf.js worker is held so the mid-load state is captured) → the painted
 *    pages; ONE band primary "Send WhatsApp", the pill = patient · order ·
 *    status · date, REPORT ~400px on the right, collapse → strip → back,
 *    no page scroll, no monospace, no native select.
 *  - 375: the preview full width, the primary + ⋮ as 44px icons, the
 *    ⋮ report-actions sheet above the navbar, Details opens the REPORT sheet.
 * REPORT_ID picks a report (default: the first on the Results list).
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

async function blockWrites(page: Page, writes: string[]) {
  await page.route(/\/api\//, async route => {
    const m = route.request().method();
    if (m === 'GET' || m === 'OPTIONS' || m === 'HEAD') return route.fallback();
    // The per-test layout PREVIEW is a read-only POST (it resolves a layout
    // against the values; nothing is stored) — the PDF needs it.
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
    await page.waitForTimeout(400);
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

/** Hold the pdf.js worker so the skeleton stays up until released. */
async function holdWorker(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  await page.route(/pdf\.worker\.min\.mjs/, async route => { await gate; await route.fallback(); });
  return () => release();
}

test.describe('Report view — PREVIEW + REPORT', () => {
  test('1440 list → skeleton → pages, one primary, side card; 375 icons + sheets', async ({ page }) => {
    test.setTimeout(240_000);
    await relayCors(page);
    await loginAs(page, 'admin');
    const writes: string[] = [];
    await blockWrites(page, writes);
    await page.setViewportSize({ width: 1440, height: 900 });

    const release = await holdWorker(page);
    const id = process.env['REPORT_ID'];
    if (id) {
      await page.goto(`/reports/view/${id}`);
    } else {
      await page.goto('/reports');
      const view = page.locator('.pf-rq-row .pf-rq-act[title="View on screen"]').first();
      await expect(view).toBeVisible({ timeout: 30_000 });
      await view.click();
      await page.waitForURL(/\/reports\/view\//);
    }

    const card = page.locator('section.nd-card.pf-rv-card');
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.pf-rv-ctx .pf-rv-chip--patient')).toBeVisible({ timeout: 30_000 });
    // Mid-load: the page-shaped skeleton.
    await expect(card.locator('.pf-rv-skel')).toBeVisible();
    if (await page.locator('.pf-rv-strip').isVisible().catch(() => false)) await page.locator('.pf-rv-strip__btn').click();
    await page.waitForTimeout(600);
    await shoot(page, '1440-loading');

    release();
    await expect(card.locator('.pf-rv-pages--in canvas.pf-rv-pdfpage').first()).toBeVisible({ timeout: 60_000 });
    await expect(card.locator('.pf-rv-skel')).toHaveCount(0);

    // ONE primary: Send WhatsApp.
    const primaries = page.locator('.nd-btn--primary:visible, .pf-hb-btn--primary:visible');
    await expect(primaries).toHaveCount(1);
    await expect(primaries.first()).toHaveAttribute('aria-label', 'Send WhatsApp');
    await expect(page.locator('.pf-rv-act--print')).toBeVisible();
    // Pill: patient · order · status · date.
    await expect(page.locator('.pf-rv-ctx .pf-rv-chip--status')).toBeVisible();
    await expect(page.locator('.pf-rv-ctx .pf-rv-ctx__date')).toBeVisible();
    // REPORT on the right, ~400px.
    const side = page.locator('aside.nd-card.pf-rv-side');
    await expect(side).toBeVisible();
    const cb = (await card.boundingBox())!;
    const sb = (await side.boundingBox())!;
    expect(cb.x + cb.width).toBeLessThanOrEqual(sb.x + 1);
    expect(sb.width).toBeGreaterThan(380);
    expect(sb.width).toBeLessThan(420);
    const mono = await page.evaluate(() => Array.from(document.querySelectorAll('.pf-rv *'))
      .filter(e => /mono|courier/i.test(getComputedStyle(e).fontFamily)).length);
    expect(mono).toBe(0);
    expect(await page.locator('.pf-rv select').count()).toBe(0);
    const ps = await noPageScroll(page);
    expect(ps.doc).toBeLessThanOrEqual(1);
    expect(ps.main).toBeLessThanOrEqual(1);
    await shoot(page, '1440');

    // Collapse → a strip on the RIGHT edge → back.
    await page.locator('.pf-rv-collapse').click();
    await expect(page.locator('.pf-rv-strip')).toBeVisible();
    await page.waitForTimeout(450);
    await shoot(page, '1440-collapsed');
    await page.locator('.pf-rv-strip__btn').click();
    await expect(side).toBeVisible();

    // ── 375 ──
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(700);
    await expect(page.locator('.pf-rv-side')).toHaveCount(0);
    const send = page.locator('.pf-rv-act--send');
    const more = page.locator('.pf-rv-act--more');
    for (const b of [send, more]) {
      const bb = (await b.boundingBox())!;
      expect(bb.width).toBeGreaterThanOrEqual(44);
      expect(bb.height).toBeGreaterThanOrEqual(44);
    }
    await expect(page.locator('.pf-rv-act--print')).toBeHidden();
    const pb = (await page.locator('.pf-rv-card').boundingBox())!;
    expect(pb.width).toBeGreaterThanOrEqual(370);
    const ps2 = await noPageScroll(page);
    expect(ps2.doc).toBeLessThanOrEqual(1);
    await shoot(page, '375');

    // The ⋮ report-actions menu (pf-actions-menu) is a bottom sheet on phones.
    await more.click();
    const sheet = page.locator('[role=menu].pf-am-panel--sheet');
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(450);
    await shoot(page, '375-more');
    await page.locator('.pf-am-cancel').click();

    await page.locator('.pf-rv-ctx__details').click();
    await expect(page.locator('.pf-rv-sheet--details')).toBeVisible();
    await page.waitForTimeout(450);
    await shoot(page, '375-details');

    expect(writes).toEqual([]);
  });
});
