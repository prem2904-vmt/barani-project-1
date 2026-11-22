import type { Browser, Page } from '@playwright/test';
import { test, expect, routeOf, isTouch } from '../support/form-factor';
import { STACK, LAB_URL, api, newContext, settle, shot } from './cs-stack';

/**
 * Re-test 2026-11-13 (rt-lab) of the case-sheet bar change, on the real case-sheet stack. Companion of
 * bar-1113.screens.spec.ts: the BEHAVIOUR of the three bar controls and the logo, and the one-time Start hint.
 * Every form-factor project of playwright.casesheets.pc.config.ts (desktop, phone, tablet, desktop app).
 */
test.describe.configure({ mode: 'serial' });
let sheetUrl = '';

async function open(browser: Browser, url: string, viewport?: 'desktop' | 'phone'): Promise<Page> {
  const ctx = await newContext(browser, STACK.admin, { viewport, theme: 'light' });
  const page = await ctx.newPage();
  await page.goto(url);
  await settle(page, 1200);
  return page;
}
const stepOn = (page: Page) => page.locator('#lf-menu .lf-step--on .lf-step__t');

test('create a draft lab case sheet for an invented patient', async ({ browser }) => {
  const phone = '9' + String(Date.now()).slice(-8) + String(Math.floor(Math.random() * 10));
  const p = await api<{ id: string }>(STACK.admin, 'POST', '/api/patients', { firstName: 'Kiran', fathersName: 'Pillai', phone, sex: 'Male', dateOfBirth: '1990-02-11' });
  const page = await open(browser, `${LAB_URL}/casesheets/new?patientId=${p.id}&dept=ENT`, 'desktop');
  const ent = page.locator('.pf-tp__item', { hasText: 'ENT' }).first();
  if (await ent.isVisible().catch(() => false)) { await ent.click(); await settle(page); }
  await page.locator('.dp__tile', { hasText: 'Nose History' }).first().click();
  await expect(page).toHaveURL(/\/casesheets\/[0-9a-f-]{36}/);
  sheetUrl = LAB_URL + routeOf(page.url()).split('?')[0];
  await page.context().close();
});

test('Back is off on the first page; Next and Back walk the pages; Pages menu shows where you are', async ({ browser }) => {
  const page = await open(browser, sheetUrl);
  const bar = page.locator('[data-sheetbar]');
  await expect(bar.locator('.lf-back')).toBeDisabled();
  await bar.locator('.lf-pages').first().click();
  const first = (await stepOn(page).first().textContent())?.trim();
  await page.keyboard.press('Escape');
  await bar.locator('.lf-next').click();
  await settle(page, 500);
  await expect(bar.locator('.lf-back')).toBeEnabled();
  await bar.locator('.lf-pages').first().click();
  const second = (await stepOn(page).first().textContent())?.trim();
  expect(second).not.toBe(first);
  await page.keyboard.press('Escape');
  await bar.locator('.lf-back').click();
  await settle(page, 500);
  await expect(bar.locator('.lf-back')).toBeDisabled();
  await bar.locator('.lf-pages').first().click();
  expect((await stepOn(page).first().textContent())?.trim()).toBe(first);
  await page.context().close();
});

test('the logo goes to Departments (not to a front-desk start screen) and the sheet is kept as a draft', async ({ browser }) => {
  const page = await open(browser, sheetUrl);
  const logo = page.locator('.pf-brand-lockup[data-start-trigger]');
  await expect(logo).toHaveAttribute('aria-label', 'Back to Departments');
  await logo.click();
  await settle(page, 800);
  await expect(page).toHaveURL(/\/casesheets(\/new|\?|$|#)/);
  await expect(page.locator('[data-sheetbar]')).toHaveCount(0);
  await shot(page, 'bar-retest-logo-departments', { theme: 'light' });
  // the draft is still there
  await page.goto(sheetUrl);
  await settle(page, 1000);
  await expect(page.locator('[data-sheetbar]')).toBeVisible();
  await page.context().close();
});

test('Back / Pages / Next all reachable (finger-sized on touch) and the logo label is the same', async ({ browser }) => {
  const page = await open(browser, sheetUrl);
  const bar = page.locator('[data-sheetbar]');
  if (isTouch()) for (const sel of ['.lf-back', '.lf-pages', '.lf-next']) {
    const b = (await bar.locator(sel).first().boundingBox())!;
    expect(b.height, `${sel} finger-sized`).toBeGreaterThanOrEqual(36);
  }
  await expect(bar.locator('.lf-next')).toBeVisible();
  await bar.locator('.lf-next').click();
  await settle(page, 500);
  await expect(bar.locator('.lf-back')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Back to Departments', exact: true })).toBeVisible();
  await page.context().close();
});

test('Start hint: shown once, stays gone after Got it and a reload; the chevron opens the Start menu', async ({ browser }) => {
  const page = await open(browser, `${LAB_URL}/frontdesk`);
  await expect(page.locator('[data-start-hint]')).toBeVisible();
  await page.locator('[data-start-hint] button', { hasText: 'Got it' }).click();
  await expect(page.locator('[data-start-hint]')).toHaveCount(0);
  await page.reload();
  await settle(page, 1200);
  await expect(page.locator('[data-start-hint]')).toHaveCount(0);
  await expect(page.locator('[data-start-chev]').locator('visible=true').first()).toBeVisible();   // phone: the logo badge's chevron
  await page.locator('[data-start-trigger]').locator('visible=true').first().click();
  await expect(page.locator('[data-start-menu]')).toBeVisible();
  await page.context().close();
});

test('opening the Start menu also settles the hint; a case sheet never shows the hint', async ({ browser }) => {
  const page = await open(browser, `${LAB_URL}/frontdesk`);
  await expect(page.locator('[data-start-hint]')).toBeVisible();
  await page.locator('[data-start-trigger]').locator('visible=true').first().click();
  await expect(page.locator('[data-start-menu]')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await settle(page, 1200);
  await expect(page.locator('[data-start-hint]')).toHaveCount(0);
  await page.goto(sheetUrl);
  await settle(page, 1000);
  await expect(page.locator('[data-start-hint]')).toHaveCount(0);
  await page.context().close();
});
