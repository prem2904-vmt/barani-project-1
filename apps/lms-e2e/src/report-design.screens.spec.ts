import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, isPhone, shotsDir } from './support/form-factor';
import { resetNeg, installNegBackend, go, neg } from './support/neg-backend';

/**
 * Report design (owner 2026-11-17): sections = LEFT side card, the section's fields fill the RIGHT card; ONE Save in
 * the band's corner; NO live preview (Preview / Alt+P opens the page at A4); "Warnings n" in the card head — and a
 * warning LANDS on its field, highlighted (owner bug: it went elsewhere and lit nothing).
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/report-design');
const out = () => shotsDir(OUT_BASE);
const vis = (page: Page, sel: string) => page.locator(sel).locator('visible=true').first();
async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
  await page.waitForTimeout(400);
}
async function shot(page: Page, name: string) {
  for (const dark of [false, true]) { await theme(page, dark); await page.screenshot({ path: `${out()}/${name}--${dark ? 'dark' : 'light'}.png` }); }
  await theme(page, false);
}

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(180_000);
  resetNeg();
  neg.hook = r => (r.method === 'GET' && r.path === '/api/tenants/departments'
    ? { status: 200, body: { success: true, data: [{ id: 'd1', name: 'Biochemistry', code: 'BIO', isActive: true }] } } : undefined);
  await installNegBackend(page, context);
});

test.describe('Report design', () => {
  test('two-panel, ONE band Save, no live preview; Preview popup at A4', async ({ page }) => {
    await go(page, '/admin/reports?tab=patient');
    await expect(vis(page, '[data-testid="rt-main-head"]')).toContainText('Patient strip', { timeout: 60_000 });
    await expect(page.locator('.pf-rt-aside')).toHaveCount(0);
    if (!isPhone()) await expect(vis(page, '[data-testid="rt-nav"]')).toContainText('Letterhead');
    await expect(page.locator('pf-hero-band [data-testid="band-save"]')).toHaveCount(1);
    await expect(vis(page, 'pf-hero-band [data-testid="band-save"] .pf-ssv__save')).toBeDisabled();
    await page.waitForTimeout(800);
    await shot(page, 'rd-patient');
    await vis(page, '[data-testid="rt-preview"]').click();
    await expect(vis(page, '[data-testid="rt-preview-popup"] iframe')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1200);
    await shot(page, 'rd-preview');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="rt-preview-popup"]')).toHaveCount(0);
    await expect(vis(page, '[data-testid="rt-preview"]')).toBeFocused();
  });

  test('every warning lands on its field, focused and outlined; the Preview outlines its spot', async ({ page }) => {
    await go(page, '/admin/reports?tab=letterhead');
    const chip = vis(page, '[data-testid="rt-warnings"]');
    await expect(chip).toBeVisible({ timeout: 60_000 });
    await expect(chip).toContainText(/Warnings \d+/);
    await chip.click();
    await expect(vis(page, '[data-testid="rt-warnlist"] .pf-rt-warnlist__go')).toBeVisible({ timeout: 10_000 });
    const n = await page.locator('[data-testid="rt-warnlist"] .pf-rt-warnlist__go').count();
    expect(n).toBeGreaterThan(0);
    await shot(page, 'rd-warnings');
    for (let i = 0; i < n; i++) {
      if (i > 0) { await vis(page, '[data-testid="rt-warnings"]').click(); }
      await vis(page, `[data-testid="rt-warning-${i}"]`).click();
      const head = vis(page, '[data-testid="rt-main-head"]');
      await expect(head).toContainText('Patient strip');
      const sw = page.locator('#pf-long-text [aria-label="Fit long text"]');
      await expect(sw).toBeFocused({ timeout: 10_000 });
      await expect(page.locator('#pf-long-text')).toHaveClass(/pf-rt-flash/);
      await page.waitForTimeout(700);   // the smooth scroll settles
      // The card head and the band never move; the row is inside the body scroller's visible box.
      const geo = await page.evaluate(() => {
        const headEl = document.querySelector('[data-testid="rt-main-head"]')!.getBoundingClientRect();
        const card = document.querySelector('.pf-rt-main')!.getBoundingClientRect();
        const body = document.querySelector('.pf-rt-main__body')!.getBoundingClientRect();
        const row = document.querySelector('#pf-long-text')!.getBoundingClientRect();
        return { headTop: headEl.top, cardTop: card.top, bodyTop: body.top, bodyBottom: body.bottom, rowTop: row.top, rowBottom: row.bottom,
                 cardScroll: (document.querySelector('.pf-rt-main') as HTMLElement).scrollTop, docScroll: document.scrollingElement!.scrollTop };
      });
      expect(Math.abs(geo.headTop - geo.cardTop), 'card head stays at the top of its card').toBeLessThan(3);
      expect(geo.cardScroll, 'the card itself never scrolls').toBe(0);
      if (!isPhone()) {
        // Desktop / tablet: the page holds still — only the card body scrolls, the head stays in view.
        expect(geo.headTop, 'card head in the viewport').toBeGreaterThanOrEqual(0);
        expect(geo.docScroll, 'the page never scrolls').toBe(0);
        expect(geo.rowTop, 'row inside the body scroller').toBeGreaterThanOrEqual(geo.bodyTop - 1);
        expect(geo.rowTop, 'row inside the body scroller').toBeLessThan(geo.bodyBottom);
      } else {
        // Phones scroll the page: the row is in the viewport.
        await expect(page.locator('#pf-long-text')).toBeInViewport();
      }
      // Only navigating: the page is not dirty.
      await expect(vis(page, 'pf-hero-band [data-testid="band-save"] .pf-ssv__save')).toBeDisabled();
      await expect(page.locator('[data-testid="unsaved-state"]')).toHaveCount(0);
      if (i === 0) { await shot(page, 'rd-warning-landed'); }
    }
    await vis(page, '[data-testid="rt-warnings"]').click();
    await vis(page, '[data-testid="rt-warnlist"] .pf-rt-warnlist__see').click();
    await expect(vis(page, '[data-testid="rt-preview-spot"]')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await shot(page, 'rd-preview-spot');
  });

  test('switching section with unsaved changes asks "Save your changes?"; Stay keeps the section', async ({ page }) => {
    await go(page, '/admin/reports?tab=patient');
    await expect(vis(page, '[data-testid="rt-main-head"]')).toContainText('Patient strip', { timeout: 60_000 });
    await vis(page, '#pf-long-text [aria-label="Fit long text"]').click();
    await expect(vis(page, 'pf-hero-band [data-testid="band-save"] .pf-ssv__save')).toBeEnabled();
    await vis(page, '[data-sec="footer"]').click();
    await expect(page.getByText('Save your changes?')).toBeVisible();
    await page.getByRole('button', { name: 'Stay' }).click();
    await expect(vis(page, '[data-testid="rt-main-head"]')).toContainText('Patient strip');
  });

  for (const w of [1440, 1720, 2560]) {
    test(`at ${w}px: the sections side card is LEFT of the editor card, top-aligned, same height; no page scroll`, async ({ page }) => {
      test.skip(isPhone());
      await page.setViewportSize({ width: w, height: 1000 });
      for (const tab of ['letterhead', 'columns', 'footer', 'patient']) {
        await go(page, `/admin/reports?tab=${tab}`);
        await expect(vis(page, '[data-testid="rt-main-head"]')).toBeVisible({ timeout: 60_000 });
        await page.waitForTimeout(800);
        const g = await page.evaluate(() => {
          const a = document.querySelector('[data-testid="rt-nav"]')!.getBoundingClientRect();
          const b = document.querySelector('.pf-rt-main')!.getBoundingClientRect();
          const se = document.scrollingElement!;
          return { ax: a.left, aw: a.width, at: a.top, ah: a.height, bx: b.left, bt: b.top, bh: b.height,
                   over: se.scrollHeight - se.clientHeight, nested: [...document.querySelectorAll<HTMLElement>('.pf-rt-main .pf-card:not(.pf-rt-pv__panel)')]
                     .filter(c => { const cs = getComputedStyle(c); return c.offsetHeight > 0 && (cs.borderTopWidth !== '0px' || cs.boxShadow !== 'none'); }).length };
        });
        expect(g.ax + g.aw, `${tab}: side card left of the main card`).toBeLessThanOrEqual(g.bx + 1);
        expect(Math.abs(g.at - g.bt), `${tab}: top-aligned`).toBeLessThan(3);
        expect(Math.abs(g.ah - g.bh), `${tab}: same height`).toBeLessThan(3);
        expect(g.over, `${tab}: no page scroll`).toBeLessThanOrEqual(2);
        expect(g.nested, `${tab}: never card-in-card`).toBe(0);
        if (w === 1720 && tab !== 'patient') await shot(page, `rd-${tab}-1720`);
      }
    });
  }

  test('ONE Save: no Save / Apply buttons inside any section; Apply to all marks the page and the band Save persists', async ({ page }) => {
    for (const tab of ['letterhead', 'patient', 'columns', 'table', 'sequence', 'footer']) {
      await go(page, `/admin/reports?tab=${tab}`);
      await expect(vis(page, '[data-testid="rt-main-head"]')).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(600);
      const saves = await page.locator('.pf-rt-main button, .pf-rt-main pf-touch-btn').filter({ hasText: /^\s*Save\b/ }).count();
      expect(saves, `${tab}: no Save inside the section`).toBe(0);
    }
    await go(page, '/admin/reports?tab=columns');
    await expect(vis(page, '[data-testid="ce-apply-all"]')).toBeVisible({ timeout: 60_000 });
    await vis(page, '[data-testid="ce-apply-all"]').click();
    await expect(vis(page, 'pf-hero-band [data-testid="band-save"] .pf-ssv__save')).toBeEnabled();
    await expect(vis(page, '[data-testid="ce-apply-all-pending"]')).toBeVisible();
  });
});
