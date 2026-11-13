import { test, expect, type Browser, type Page } from '@playwright/test';
import { STACK, LAB_URL, api, newContext, settle, shot, type Theme, type ViewportName } from './cs-stack';

/**
 * PROOF SCREENSHOTS (2026-11-13 bar fixes) on the real case-sheet stack:
 *  - a lab case sheet open on page 2: the bottom bar is only the PF logo + Back · Pages · Next (desktop light/dark, phone),
 *    and the Pages menu opened from the bar;
 *  - a normal LMS screen (front desk): the Start-menu chevron after the wordmark + the one-time hint, then after "Got it".
 * Files: `bar-<screen>--<viewport>--<theme>.png` under CS_SHOTS.
 */
test.describe.configure({ mode: 'serial' });

let sheetUrl = '';

async function open(browser: Browser, url: string, vp: ViewportName, theme: Theme): Promise<Page> {
  const ctx = await newContext(browser, STACK.admin, { viewport: vp, theme });
  const page = await ctx.newPage();
  await page.goto(url);
  await settle(page, 1200);
  return page;
}

async function toPage2(page: Page) {
  await page.locator('[data-sheetbar] .lf-pages').first().click();
  const menu = page.locator('#lf-menu');
  await expect(menu).toBeVisible();
  await menu.locator('.lf-step').nth(1).click();
  await settle(page, 500);
}

async function expectSheetBar(page: Page) {
  const bar = page.locator('[data-sheetbar]');
  await expect(bar).toBeVisible();
  await expect(bar.locator('.lf-back')).toBeVisible();
  await expect(bar.locator('.lf-pages')).toBeVisible();
  await expect(bar.locator('.lf-next')).toBeVisible();
  await expect(page.locator('.pf-brand-lockup[data-start-trigger]')).toHaveAttribute('aria-label', 'Back to Departments');
  // nothing else of the bar is visible: no work areas / More, no messages, bell or avatar
  await expect(page.locator('.pf-nav-btn:visible')).toHaveCount(0);
  await expect(page.locator('.pf-ts-right :is(button, a):visible')).toHaveCount(0);
  await expect(page.locator('[data-start-hint]')).toHaveCount(0);
}

test('create a draft lab case sheet (ENT · Nose History) for an invented patient', async ({ browser }) => {
  const phone = '9' + String(Date.now()).slice(-8) + String(Math.floor(Math.random() * 10));
  const p = await api<{ id: string }>(STACK.admin, 'POST', '/api/patients', { firstName: 'Meena', fathersName: 'Iyer', phone, sex: 'Female', dateOfBirth: '1988-06-21' });
  const page = await open(browser, `${LAB_URL}/casesheets/new?patientId=${p.id}&dept=ENT`, 'desktop', 'light');
  const ent = page.locator('.dp__row', { hasText: 'ENT' }).first();
  if (await ent.isVisible().catch(() => false)) { await ent.click(); await settle(page); }
  await page.locator('.dp__tile', { hasText: 'Nose History' }).first().click();
  await expect(page).toHaveURL(/\/casesheets\/[0-9a-f-]{36}/);
  sheetUrl = page.url().split(/[?#]/)[0];
  await page.context().close();
});

for (const theme of ['light', 'dark'] as Theme[]) {
  test(`case sheet page 2 — desktop ${theme}`, async ({ browser }) => {
    const page = await open(browser, sheetUrl, 'desktop', theme);
    await toPage2(page);
    await expectSheetBar(page);
    await shot(page, 'bar-a-sheet-page2', { viewport: 'desktop', theme });
    if (theme === 'light') {
      await page.locator('[data-sheetbar] .lf-pages').first().click();
      await expect(page.locator('#lf-menu')).toBeVisible();
      await shot(page, 'bar-c-sheet-pages-menu', { viewport: 'desktop', theme });
    }
    await page.context().close();
  });
}

test('case sheet page 2 — phone light', async ({ browser }) => {
  const page = await open(browser, sheetUrl, 'phone', 'light');
  await toPage2(page);
  await expectSheetBar(page);
  await expect(page.getByRole('button', { name: 'Back to Departments', exact: true })).toBeVisible();
  // logo + Back + Pages + Next fit side by side at 390px, no overlap
  const boxes = await Promise.all(['.pf-brand-lockup[data-start-trigger]', '[data-sheetbar] .lf-back', '[data-sheetbar] .lf-pages', '[data-sheetbar] .lf-next']
    .map(async sel => (await page.locator(sel).first().boundingBox())!));
  for (let i = 1; i < boxes.length; i++) expect(boxes[i].x, `bar item ${i} starts after item ${i - 1}`).toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].width - 0.5);
  expect(boxes[3].x + boxes[3].width).toBeLessThanOrEqual(390);
  await shot(page, 'bar-b-sheet-page2', { viewport: 'phone', theme: 'light' });
  await page.context().close();
});

for (const theme of ['light', 'dark'] as Theme[]) {
  test(`front desk — Start hint + chevron, desktop ${theme}`, async ({ browser }) => {
    const page = await open(browser, `${LAB_URL}/frontdesk`, 'desktop', theme);
    await expect(page.locator('[data-start-hint]')).toBeVisible();
    await expect(page.locator('[data-start-chev]')).toBeVisible();
    await shot(page, 'bar-d-frontdesk-hint', { viewport: 'desktop', theme });
    if (theme === 'light') {
      await page.locator('[data-start-hint] button', { hasText: 'Got it' }).click();
      await expect(page.locator('[data-start-hint]')).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem('pf.startHintSeen'))).toBe('1');
      await shot(page, 'bar-e-frontdesk-after-got-it', { viewport: 'desktop', theme });
    }
    await page.context().close();
  });
}

test('front desk — phone light (logo badge chevron + hint)', async ({ browser }) => {
  const page = await open(browser, `${LAB_URL}/frontdesk`, 'phone', 'light');
  await expect(page.locator('[data-start-hint]')).toBeVisible();
  await expect(page.locator('.pf-avatar-btn[data-start-trigger] [data-start-chev]')).toBeVisible();
  await shot(page, 'bar-f-frontdesk-hint', { viewport: 'phone', theme: 'light' });
  await page.locator('[data-start-hint] button', { hasText: 'Got it' }).click();
  await shot(page, 'bar-f-frontdesk-after-got-it', { viewport: 'phone', theme: 'light' });
  await page.context().close();
});
