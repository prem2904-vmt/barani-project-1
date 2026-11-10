import { test, expect } from '@playwright/test';
import {
  STACK, PUBLIC_URL, newContext, answerGoogle, settle, shot, expectNoVisibleAiText, expectNoNativeControls,
  expectNoHorizontalScroll, expectNothingBlocked,
} from './cs-stack';

/**
 * THE PUBLIC CASE-SHEET SITE (the same build, /config.json mode "casesheets"). Only Google's half of the sign-in is
 * answered in-page (GoTrue authorize + PKCE token); POST /api/casesheets/personal/enter, /me and every case-sheet call
 * are the real backend (the host's Supabase-user lookup is scripted for two subs).
 */
test.describe.configure({ mode: 'serial' });

/** An invented patient, unique per run (re-runnable on one host). */
const TAG = Array.from({ length: 4 }, () => 'abcdefghjkmnpqrstuvwxyz'[Math.floor(Math.random() * 23)]).join('');
const LAST = `Pillai${TAG.charAt(0).toUpperCase()}${TAG.slice(1)}`;

test('signed out: only the sign-in page, with the Google button', async ({ browser }) => {
  const ctx = await newContext(browser, null, { viewport: 'phone' });
  const page = await ctx.newPage();
  await page.goto(`${PUBLIC_URL}/cases`);
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByTestId('google-sign-in')).toBeVisible();
  await shot(page, 'public-01-sign-in', { viewport: 'phone' });
  // an LMS URL does not exist in this mode
  await page.goto(`${PUBLIC_URL}/frontdesk`);
  await settle(page);
  await expect(page).toHaveURL(/\/sign-in/);
  await expectNoHorizontalScroll(page);
  await ctx.close();
});

test('Google sign-in creates the personal space → Departments · Cases · Settings; the patient step; a sheet', async ({ browser }) => {
  const ctx = await newContext(browser, null, { viewport: 'phone' });
  await answerGoogle(ctx, STACK.personal);
  const page = await ctx.newPage();
  await page.goto(`${PUBLIC_URL}/sign-in`);
  const enter = page.waitForResponse(r => r.url().includes('/api/casesheets/personal/enter'));
  await page.getByTestId('google-sign-in').click();
  const res = await enter;
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.kind).toBe('personal');
  expect(body.caseSheets).toBe(true);
  await expect(page).not.toHaveURL(/sign-in|auth\/callback/, { timeout: 30_000 });
  await settle(page, 1000);
  const nav = page.getByRole('navigation', { name: 'Case sheets' });
  await expect(nav).toBeVisible();
  for (const t of ['Departments', 'Cases', 'Settings']) await expect(nav.getByText(t, { exact: true })).toBeVisible();
  await shot(page, 'public-02-departments', { viewport: 'phone' });
  await expectNoVisibleAiText(page);
  await expectNoHorizontalScroll(page);

  // Departments → a form → the patient step (search + quick-create)
  await page.locator('.dp__row', { hasText: 'General Medicine' }).first().click();
  await settle(page);
  await shot(page, 'public-03-department-forms', { viewport: 'phone' });
  await page.locator('.dp__tile', { hasText: 'General consultation' }).first().click();
  const step = page.locator('[data-patient-step]');
  await expect(step).toBeVisible();
  await shot(page, 'public-04-patient-step', { viewport: 'phone' });
  await step.locator('[data-ps-search]').fill(LAST);
  await expect(step.getByText(/No patient matches/)).toBeVisible();
  await shot(page, 'public-05-patient-step-no-match', { viewport: 'phone' });
  await step.locator('[data-ps-new]').click();
  await step.locator('[data-ps-first]').fill('Lakshmanan');
  await step.locator('[data-ps-last]').fill(LAST);
  await step.locator('[data-ps-age]').fill('58');
  await step.locator('pf-select').first().click();
  await page.locator('.pf-select__option, [role="option"]', { hasText: 'Male' }).first().click();
  await shot(page, 'public-06-patient-quick-create', { viewport: 'phone' });
  await expectNoNativeControls(page);
  await step.locator('[data-ps-add]').click();
  await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}/, { timeout: 30_000 });
  await settle(page, 1200);
  await shot(page, 'public-07-fill', { viewport: 'phone' });
  // the sheet's Back · Pages · Next ride the public bottom bar, in place of the three areas
  const bar = page.locator('[data-formbar]');
  await expect(bar.locator('.lf-next')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Case sheets' })).toHaveCount(0);
  const first = await page.locator('#cs-page-h').innerText();
  await bar.locator('.lf-next').click();
  await expect(page.locator('#cs-page-h')).not.toHaveText(first);
  await shot(page, 'public-07b-fill-next-page', { viewport: 'phone' });

  // Cases and Settings
  await page.goto(`${PUBLIC_URL}/cases`);
  await settle(page, 1000);
  await expect(page.getByText(`Lakshmanan ${LAST}`, { exact: false }).first()).toBeVisible();
  await shot(page, 'public-08-cases', { viewport: 'phone' });
  await page.goto(`${PUBLIC_URL}/settings`);
  await settle(page, 1000);
  await shot(page, 'public-09-settings-practice', { viewport: 'phone' });
  await expectNoNativeControls(page);
  await ctx.close();
});

test('a Google account that is lab staff in a lab without case sheets: the "not available" card', async ({ browser }) => {
  const ctx = await newContext(browser, null, { viewport: 'phone' });
  await answerGoogle(ctx, STACK.plainLab.admin);
  const page = await ctx.newPage();
  await page.goto(`${PUBLIC_URL}/sign-in`);
  const enter = page.waitForResponse(r => r.url().includes('/api/casesheets/personal/enter'));
  await page.getByTestId('google-sign-in').click();
  const body = await (await enter).json();
  expect(body.kind).toBe('lab');
  expect(body.caseSheets).toBe(false);
  await expect(page.getByTestId('cs-sign-in-notice')).toContainText('switched on for your lab', { timeout: 30_000 });
  await shot(page, 'public-10-not-available', { viewport: 'phone' });
  await ctx.close();
});

test.afterAll(() => expectNothingBlocked([/supabase\.co\/auth\/v1\/(authorize|token|logout)/]));
