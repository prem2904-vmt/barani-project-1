import { test, expect, type Page } from '@playwright/test';
import { STACK, api, blocked, expectNoVisibleAiText, openAs, platform, shot as rawShot } from '../support/local-stack';

/**
 * Report designer, phase 8 - Cortex "Tidy up" (beta `assistant`, dev only) on the LOCAL full stack with a SCRIPTED model
 * (mw host started with PF_LAB_E2E_FAKE_MODEL=1: no network, no key). A template with planted problems (a name that runs past the
 * margin, a tagline on top of it, High/Low that look alike in black and white, a patient strip long names run into) is tidied:
 * the review card lists every change with its reason, the model's pick joins as a Cortex change, Before | After shows both,
 * Apply is one undo step, Undo restores the exact template, nothing is saved until Save, Cancel changes nothing.
 */
const ADMIN = STACK.admin;
const BETA = ['assistant'];
const shot = async (page: Page, name: string) => { await page.waitForTimeout(1500); await rawShot(page, name); };

test.afterEach(() => { expect(blocked, 'no request left the machine').toEqual([]); });

type Tpl = Record<string, unknown> & { metadata?: string | null };
const tpl = () => api<Tpl>(ADMIN, 'GET', '/api/config/report-template');
async function setTpl(t: Tpl) { await api(ADMIN, 'POST', '/api/config/report-template', t); }

let original: Tpl;
const PLANTED = (t: Tpl): Tpl => {
  const meta = JSON.parse(t.metadata ?? '{}') as Record<string, unknown>;
  meta['headerLayout'] = { v: 1, items: { name: { align: 'left', x: 8, y: 19 }, tagline: { align: 'left', x: 9.2, y: 20.2 } } };
  delete meta['reportStyle'];
  return {
    ...t,
    metadata: JSON.stringify(meta),
    flagStyle: 'bold_color', abnormalColor: '#d93025', abnormalLowColor: '#b5651d',
    patientColumnsJson: JSON.stringify([['name', 'age', 'sex', 'mrn'], ['specimen', 'refdoctor', 'refhospital'], ['barcode', 'registered']]),
  };
};

test.beforeAll(async () => { original = await tpl(); await setTpl(PLANTED(original)); });
test.afterAll(async () => { await setTpl(original); await platform('PUT', `/tenants/${STACK.tenantId}/pf-sense`, { enabled: true, features: { report_tidy: true }, capTokens: null }).catch(() => undefined); });

const button = (page: Page) => page.getByRole('button', { name: /Tidy up with Cortex/ }).first();

test('hidden without the beta switch', async ({ browser }) => {
  const { page } = await openAs(browser, ADMIN, '/admin/reports', { theme: 'light', beta: [] });
  await expect(page.getByRole('button', { name: 'Save template' })).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  await expect(button(page)).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`tidy up: review, preview, apply = one undo step, undo, cancel (${theme})`, async ({ browser }) => {
    test.setTimeout(300_000);
    const before = await tpl();
    const { page } = await openAs(browser, ADMIN, '/admin/reports', { theme, beta: BETA });
    await expect(page.getByRole('button', { name: 'Save template' })).toBeVisible({ timeout: 60_000 });
    await expect(button(page)).toBeVisible({ timeout: 30_000 });
    await shot(page, `p8-editor-band-${theme}`);

    await button(page).click();
    const card = page.locator('pf-report-tidy-card');
    await expect(card.getByRole('dialog', { name: /Tidy up with Cortex/ })).toBeVisible({ timeout: 60_000 });
    await expect(card.getByText('Checking your report layout')).toHaveCount(0, { timeout: 120_000 });

    // The plain fixes, each with its reason.
    const rows = card.locator('.pf-td__row');
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    const text = (await card.innerText()).replace(/\s+/g, ' ');
    expect(text).toMatch(/Turn on text fitting/);
    expect(text).toMatch(/black and white/);
    expect(text).toMatch(/Bring letterhead items inside the margins/);
    expect(text).toMatch(/Move apart letterhead items that collide/);
    // Cortex is NOT called on open: only when asked. The scripted fake then picks the first offered option of each question.
    await expect(card.getByText('Cortex suggests')).toBeVisible();
    await expect(card.locator('.pf-td__chip--cortex')).toHaveCount(0);
    await shot(page, `p8-review-card-before-ask-${theme}`);
    await card.getByRole('button', { name: 'Ask Cortex for suggestions' }).click();

    await expect(card.locator('.pf-td__chip--cortex').first()).toBeVisible({ timeout: 60_000 });
    await expect(card.getByText(/Page N of M helps/)).toBeVisible();
    await expect(card.locator('iframe')).toHaveCount(2);
    await page.waitForTimeout(2500);
    await shot(page, `p8-review-card-${theme}`);
    await expectNoVisibleAiText(page);
    await card.getByText(/Page N of M helps/).scrollIntoViewIfNeeded();
    await shot(page, `p8-review-card-cortex-${theme}`);

    // Untick one change: the count drops and "After" keeps rendering.
    const n0 = await card.getByRole('checkbox').count();
    const apply = card.getByRole('button', { name: /^Apply/ });
    await expect(apply).toHaveText(new RegExp(`Apply ${n0} changes`));
    await card.getByRole('checkbox', { name: 'Make High and Low easy to tell apart in black and white' }).uncheck({ force: true });
    await expect(apply).toHaveText(new RegExp(`Apply ${n0 - 1} changes`));

    // Cancel changes nothing.
    await card.getByRole('button', { name: 'Cancel' }).click();
    await expect(card).toHaveCount(0);
    expect(JSON.stringify(await tpl())).toBe(JSON.stringify(before));
    await expect(page.getByText('All changes saved').first()).toBeVisible();

    // Apply = one undo step, nothing saved.
    await button(page).click();
    await expect(card.locator('.pf-td__row').first()).toBeVisible({ timeout: 120_000 });
    await card.getByRole('button', { name: 'Ask Cortex for suggestions' }).click();
    await expect(card.locator('.pf-td__chip--cortex').first()).toBeVisible({ timeout: 60_000 });
    await card.getByRole('button', { name: /^Apply/ }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByText('Unsaved changes').first()).toBeVisible();
    expect(JSON.stringify(await tpl()), 'nothing is saved by Apply').toBe(JSON.stringify(before));
    await shot(page, `p8-after-apply-${theme}`);

    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(page.getByText('All changes saved').first()).toBeVisible({ timeout: 15_000 });   // ONE undo step restores the exact template
  });
}

test('save after apply persists; the stored template changed only when Save was pressed', async ({ browser }) => {
  test.setTimeout(240_000);
  const { page } = await openAs(browser, ADMIN, '/admin/reports', { theme: 'light', beta: BETA });
  await expect(button(page)).toBeVisible({ timeout: 60_000 });
  await button(page).click();
  const card = page.locator('pf-report-tidy-card');
  await expect(card.locator('.pf-td__row').first()).toBeVisible({ timeout: 120_000 });
  await card.getByRole('button', { name: /^Apply/ }).click();
  await expect(page.getByText('Unsaved changes').first()).toBeVisible();
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByText('All changes saved').first()).toBeVisible({ timeout: 30_000 });
  const saved = await tpl();
  expect(JSON.parse(saved.metadata ?? '{}').reportStyle?.fit?.enabled).toBe(true);
  await setTpl(PLANTED(original));   // back to the planted state for the later tests
});

test('Cortex off for the lab: the button is gone; cap reached: the plain fixes still work and the limit is said in plain words', async ({ browser }) => {
  test.setTimeout(300_000);
  await platform('PUT', `/tenants/${STACK.tenantId}/pf-sense`, { features: { report_tidy: false } });
  let { page } = await openAs(browser, ADMIN, '/admin/reports', { theme: 'light', beta: BETA });
  await expect(page.getByRole('button', { name: 'Save template' })).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  await expect(button(page)).toHaveCount(0);

  await platform('PUT', `/tenants/${STACK.tenantId}/pf-sense`, { features: { report_tidy: true }, capTokens: 100 });
  ({ page } = await openAs(browser, ADMIN, '/admin/reports', { theme: 'light', beta: BETA }));
  await expect(button(page)).toBeVisible({ timeout: 60_000 });
  await button(page).click();
  const card = page.locator('pf-report-tidy-card');
  await expect(card.locator('.pf-td__row').first()).toBeVisible({ timeout: 120_000 });
  await card.getByRole('button', { name: 'Ask Cortex for suggestions' }).click();
  await expect(card.getByText(/limit/i).first()).toBeVisible({ timeout: 60_000 });
  await expect(card.getByRole('button', { name: /^Apply/ })).toBeEnabled();
  await shot(page, 'p8-cap-reached');
  await platform('PUT', `/tenants/${STACK.tenantId}/pf-sense`, { capTokens: null });
});
