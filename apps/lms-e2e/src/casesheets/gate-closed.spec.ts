import { test, expect } from '@playwright/test';
import { STACK, LAB_URL, api, jwt, openAs, settle, shot, expectNothingBlocked } from './cs-stack';

/**
 * GATE CLOSED: "Plain Lab" has no module row (the legacy "all on" default) — ipd is NOT explicitly on, so case sheets
 * do not exist for it: no Case sheet button, the /admin/ipd placeholder unchanged, the routes bounce, the API is an empty 404.
 */
const PLAIN = STACK.plainLab.admin;

test('a lab without ipd explicitly on sees no case sheets anywhere', async ({ browser }) => {
  const phone = '8' + String(Date.now()).slice(-9);
  const p = await api<{ id: string }>(PLAIN, 'POST', '/api/patients', { firstName: 'Anand', fathersName: 'Gopal', phone, sex: 'Male', dateOfBirth: '1990-01-01' });

  const me = await api<{ caseSheetsAccess?: boolean; caseSheetsEntitled?: boolean }>(PLAIN, 'GET', '/api/auth/me');
  expect(me.caseSheetsAccess ?? false).toBe(false);
  expect(me.caseSheetsEntitled ?? false).toBe(false);
  const raw = await fetch(`${STACK.apiUrl}/api/casesheets/forms`, { headers: { authorization: `Bearer ${jwt(PLAIN.authId)}` } });
  expect(raw.status).toBe(404);
  expect(await raw.text()).toBe('');

  const { ctx, page } = await openAs(browser, PLAIN, `${LAB_URL}/frontdesk/patients/${p.id}`);
  await settle(page, 1500);
  await expect(page.getByText('Anand Gopal').first()).toBeVisible();
  await expect(page.locator('[data-act="casesheet"]')).toHaveCount(0);
  await expect(page.getByText('Case sheets', { exact: true })).toHaveCount(0);
  await shot(page, 'gate-01-plain-lab-patient-profile');

  await page.goto(`${LAB_URL}/admin/ipd`);
  await settle(page, 1200);
  await expect(page.getByText('MyPrefrontal')).toHaveCount(0);
  await shot(page, 'gate-02-plain-lab-admin-ipd');

  for (const path of ['/casesheets/new', `/casesheets/patient/${p.id}`, '/admin/ipd/myprefrontal']) {
    await page.goto(`${LAB_URL}${path}`);
    await settle(page, 800);
    expect(new URL(page.url()).pathname, `${path} must bounce`).not.toBe(path);
  }
  await ctx.close();
});

test.afterAll(() => expectNothingBlocked());
