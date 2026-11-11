import { test, expect } from '@playwright/test';
import { STACK, api, openAs, settle, shot, expectNoVisibleAiText, expectNoNativeControls, type Theme } from './cs-stack';

/**
 * PREPARE TAB (owner 2026-11-11) on the real stack: a "Prepare" tab right after Frontdesk for anyone with a case-sheet permission
 * while Prepare is on for the lab; Departments → a form → choose the patient (the lab's own patients) → the sheet; My case sheets;
 * the lab admin's switch in Settings → IPD turns it off (tab gone, /prepare bounces, the API refuses new sheets) and back on.
 */
test.describe.configure({ mode: 'serial' });

const PATIENT = { id: '', last: '' };
test.beforeAll(async () => {
  PATIENT.last = 'Prep' + String(Date.now()).slice(-6).split('').map(d => 'abcdefghij'[Number(d)]).join('');
  const phone = '9' + String(Date.now()).slice(-8) + String(Math.floor(Math.random() * 10));
  PATIENT.id = (await api<{ id: string }>(STACK.admin, 'POST', '/api/patients',
    { firstName: 'Meenakshi', fathersName: PATIENT.last, phone, sex: 'Female', dateOfBirth: '1979-05-04' })).id;
  await api(STACK.admin, 'PUT', '/api/casesheets/prepare', { enabled: true });
});

for (const theme of ['light', 'dark'] as Theme[]) {
  test(`doctor: Prepare tab after Frontdesk → Departments → choose patient → sheet → My case sheets (${theme})`, async ({ browser }) => {
    // the tab order, as a user who has both Frontdesk and Prepare (the seeded doctor has no front desk)
    const adm = await openAs(browser, STACK.admin, '/frontdesk', { theme });
    await settle(adm.page, 1200);
    const tabs = adm.page.locator('nav a, nav button').filter({ hasText: /^(Frontdesk|Prepare)$/ });
    await expect(adm.page.locator('nav').getByText('Prepare', { exact: true }).first()).toBeVisible();
    const labels = (await tabs.allInnerTexts()).map(t => t.trim());
    expect(labels.indexOf('Prepare')).toBe(labels.indexOf('Frontdesk') + 1);
    await shot(adm.page, 'prepare-01-tab', { theme });
    await adm.ctx.close();

    const { ctx, page } = await openAs(browser, STACK.doctor, '/prepare', { theme });
    await settle(page, 1200);
    await page.locator('nav').getByText('Prepare', { exact: true }).first().click();
    await expect(page).toHaveURL(/\/prepare$/);
    await expect(page.locator('[data-my-sheets]')).toBeVisible();
    await shot(page, 'prepare-02-departments', { theme });

    await page.locator('.dp__row', { hasText: 'General Medicine' }).first().click();
    await settle(page);
    await page.locator('.dp__tile').first().click();
    const step = page.locator('[data-patient-step]');
    await expect(step).toBeVisible();
    await step.locator('[data-ps-search]').fill(PATIENT.last);
    await expect(step.locator('[data-ps-pick]').first()).toBeVisible();
    await shot(page, 'prepare-03-choose-patient', { theme });
    await expectNoNativeControls(page);
    await step.locator('[data-ps-pick]').first().click();
    await expect(page).toHaveURL(/\/casesheets\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await settle(page, 1200);
    await shot(page, 'prepare-04-sheet', { theme });

    await page.goto('/prepare/cases');
    await settle(page, 1000);
    await expect(page.getByText(`Meenakshi ${PATIENT.last}`).first()).toBeVisible();
    await expect(page.locator('[data-new-sheet]')).toBeVisible();
    await shot(page, 'prepare-05-my-case-sheets', { theme });
    await expectNoVisibleAiText(page);
    await ctx.close();
  });
}

test('phone: the Prepare tab and Departments', async ({ browser }) => {
  const { ctx, page } = await openAs(browser, STACK.doctor, '/prepare', { viewport: 'phone' });
  await settle(page, 1200);
  await expect(page.locator('.dp__row').first()).toBeVisible();
  await shot(page, 'prepare-06-departments', { viewport: 'phone' });
  await ctx.close();
});

test('admin: the switch in Settings → IPD turns Prepare off (tab gone, /prepare bounces, API refuses) and back on', async ({ browser }) => {
  const { ctx, page } = await openAs(browser, STACK.admin, '/admin/ipd');
  await settle(page, 1200);
  const card = page.locator('[data-prepare-switch]');
  await expect(card).toBeVisible();
  await shot(page, 'prepare-07-ipd-switch-on');
  await card.locator('button[role="switch"]').click();
  await expect(card).toContainText('cannot start new case sheets');
  await settle(page, 800);
  await expect(page.locator('nav').getByText('Prepare', { exact: true })).toHaveCount(0);
  await shot(page, 'prepare-08-ipd-switch-off');

  const doc = await openAs(browser, STACK.doctor, '/prepare');
  await settle(doc.page, 1200);
  await expect(doc.page).not.toHaveURL(/\/prepare/);
  await expect(doc.page.locator('nav').getByText('Prepare', { exact: true })).toHaveCount(0);
  const forms = await api<{ items?: { id: string }[] } | { id: string }[]>(STACK.doctor, 'GET', '/api/casesheets/forms?for=fill');
  const formId = (Array.isArray(forms) ? forms : forms.items ?? [])[0]?.id;
  await expect(api(STACK.doctor, 'POST', '/api/casesheets/sheets', { formId, patientId: PATIENT.id, contextKind: 'patient' }))
    .rejects.toThrow(/403.*prepare_off/);
  await doc.ctx.close();

  await card.locator('button[role="switch"]').click();
  await expect(card).toContainText('Prepare tab next to Frontdesk');
  await settle(page, 800);
  await expect(page.locator('nav').getByText('Prepare', { exact: true }).first()).toBeVisible();
  await ctx.close();
});

// Owner rule 2026-11-11: every dev lab gets Prepare unless an admin switched IPD off (the switch-off path is tested above).
test('a lab that never set IPD still gets the Prepare tab', async ({ browser }) => {
  const { ctx, page } = await openAs(browser, STACK.plainLab.admin, '/frontdesk');
  await settle(page, 1500);
  await expect(page.locator('nav').getByText('Prepare', { exact: true }).first()).toBeVisible();
  await ctx.close();
});
