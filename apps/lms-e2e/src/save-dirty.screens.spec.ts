import * as os from 'node:os';
import * as path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect, isPhone, shotsDir } from './support/form-factor';
import { neg, resetNeg, installNegBackend, go, toast } from './support/neg-backend';

/**
 * SAVE ONLY WHEN SOMETHING CHANGED (owner 2026-11-19): every Save is DISABLED on load (the kit's disabled primary,
 * aria-disabled, "No changes to save"), enables after a change, disables again when the change is put back, and
 * disables after a successful save. A failed save keeps it enabled; Ctrl/Cmd+S does nothing while nothing changed.
 * API mocked, demo data only — the pages, the band and the guards are the real app.
 * Screenshots: SHOTS_DIR/<form factor>/save-dirty-*.png
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/save-skeleton');
const out = () => shotsDir(OUT_BASE);
const vis = (page: Page, sel: string) => page.locator(sel).locator('visible=true').first();

async function shot(page: Page, name: string) {
  for (const dark of [false, true]) {
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${out()}/save-dirty-${name}--${dark ? 'dark' : 'light'}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => { const r = document.documentElement; r.classList.remove('dark'); r.classList.add('light'); r.setAttribute('data-theme', 'light'); });
}
/** Save is there (never hidden) and disabled with the "no changes" words. */
async function expectSaveOff(save: Locator) {
  await expect(save).toBeVisible();
  await expect(save).toBeDisabled();
  await expect(save).toHaveAttribute('aria-disabled', 'true');
  await expect(save).toHaveAttribute('title', 'No changes to save');
}
async function expectSaveOn(save: Locator) {
  await expect(save).toBeEnabled();
  await expect(save).not.toHaveAttribute('aria-disabled', 'true');
}
const saveKey = async (page: Page) => page.keyboard.press('ControlOrMeta+s');

const BILLING = {
  gstEnabled: false, gstScope: 'intra', filingFrequency: 'monthly', allowDiscounts: true, maxDiscountPct: 10, overrideDiscountPct: 20,
  approvalThresholdPct: 15, invoicePrefix: 'INV', invoiceStartNumber: 1001, invoiceOnFullPaymentOnly: false,
};
const TEST = {
  id: 't1', testCode: 'BIO100', name: 'Demo glucose', shortName: '', section: '', type: 'individual', flow: 'direct', isActive: true,
  price: 150, priceIsDefault: false, tatHours: 4, department: { id: 'd1', name: 'Biochemistry', code: 'BIO' }, departmentId: 'd1',
  tubeColor: 'Grey', parameters: JSON.stringify({ parameters: [{ name: 'glu', title: 'Glucose', type: 'number', unit: 'mg/dL' }] }),
};
const TESTS = [TEST, { ...TEST, id: 't2', testCode: 'BIO101', name: 'Demo urea' }];

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(180_000);
  resetNeg();
  neg.hook = r => {
    if (r.method !== 'GET') return undefined;
    const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
    switch (r.path) {
      case '/api/config/billing': return ok(BILLING);
      case '/api/tests/': case '/api/tests': return ok(TESTS);
      case '/api/tests/t1': return ok(TEST);
      case '/api/tenants/departments': return ok([{ id: 'd1', name: 'Biochemistry', code: 'BIO', isActive: true }]);
      // A letterhead the lab has already arranged (the edited layout, nothing overridden yet) — keys in another order than
      // the page writes them: the compare is by value.
      case '/api/config/report-template': return ok({ labName: 'Demo Lab', metadata: JSON.stringify({ headerLayout: { items: {}, v: 1 } }) });
      default: return undefined;
    }
  };
  await installNegBackend(page, context);
});

test.describe('Save only when something changed', () => {
  test('Settings band Save (Billing › GST): off on load, on after a change, off after putting it back, off after saving', async ({ page }) => {
    await go(page, '/admin/billing?tab=gst');
    const sw = vis(page, 'button[role="switch"][aria-label="Allow discounts"]');
    if (isPhone()) {
      const item = vis(page, '[data-testid="tp-item-gst"]');
      await expect(sw.or(item)).toBeVisible({ timeout: 60_000 });
      if (!(await sw.isVisible())) await item.click();
    }
    await expect(sw).toBeVisible({ timeout: 60_000 });
    const save = vis(page, 'pf-hero-band [data-testid="band-save"] .pf-ssv__save');
    await expectSaveOff(save);
    await shot(page, 'band-off');

    // Ctrl/Cmd+S with nothing changed: nothing is sent.
    await saveKey(page);
    await page.waitForTimeout(400);
    expect(neg.calls.filter(c => c.path === '/api/config/billing'), 'nothing saved').toEqual([]);

    await sw.click();
    await expectSaveOn(save);
    if (!isPhone()) await expect(vis(page, '[data-testid="unsaved-state"]')).toBeVisible();   // phones keep only the button
    await shot(page, 'band-on');
    await sw.click();                                       // back to how it was
    await expectSaveOff(save);

    // A failed save keeps Save enabled.
    neg.hook = (prev => (r: Parameters<NonNullable<typeof neg.hook>>[0]) =>
      r.method === 'POST' && r.path === '/api/config/billing' ? { status: 500, body: { success: false, error: 'server_error', message: 'Down for a moment' } } : prev?.(r))(neg.hook);
    await sw.click();
    await save.click();
    await expect.poll(() => neg.calls.filter(c => c.path === '/api/config/billing').length).toBe(1);
    // The failed save has ANSWERED (its reason is on screen) before the next try: the request is counted when the mock
    // receives it, a beat before the page gets the 500 — a key press in that beat lands while the first save is still
    // in flight, and the page rightly refuses a second save on top of it (release gate 2026-11-21).
    await expect(toast(page, 'Down for a moment')).toBeVisible();
    await expectSaveOn(save);
    await expect(save).toHaveText(/Save/);

    // A successful save (Ctrl/Cmd+S presses the enabled Save) → disabled again.
    resetHookToOk();
    await saveKey(page);
    await expect.poll(() => neg.calls.filter(c => c.path === '/api/config/billing').length).toBe(2);
    await expectSaveOff(save);
  });

  test('Test editor: off on load, on after an edit, off when the edit is undone, off after Save', async ({ page }) => {
    await go(page, '/admin/tests/t1/edit?type=individual');
    const nameInput = vis(page, '#sec-identity input');
    await expect(nameInput).toHaveValue('Demo glucose', { timeout: 60_000 });
    const save = vis(page, '[data-testid="te-save"]');
    await expectSaveOff(save);
    await nameInput.fill('Demo glucose (fasting)');
    await expectSaveOn(save);
    await expect(vis(page, '.pf-te2-savestate')).toContainText('Unsaved changes');
    await shot(page, 'test-editor-on');
    await nameInput.fill('Demo glucose');
    await expectSaveOff(save);
    await nameInput.fill('Demo glucose (fasting)');
    await save.click();
    await expect.poll(() => neg.calls.filter(c => c.method === 'PATCH' && c.path === '/api/tests/t1').length).toBe(1);
    expect(neg.calls.find(c => c.method === 'PATCH')!.body).toEqual({ name: 'Demo glucose (fasting)' });
    await expectSaveOff(save);
  });

  test('Test Master batch Save: off on load, on after a cell edit, off after editing it back, off after Save', async ({ page }) => {
    test.skip(isPhone(), 'phone: the grid keeps the code + name only and edits open the editor; the editor case above covers phones');
    await go(page, '/admin/tests');
    const save = vis(page, '[data-testid="tm-save"]');
    await expect(vis(page, '.ag-row [col-id="name"]')).toBeVisible({ timeout: 60_000 });
    await expectSaveOff(save);
    const cell = vis(page, '.ag-row[row-id="t2"] [col-id="name"]');
    const edit = async (v: string) => {
      await cell.dblclick();
      const input = page.locator('.ag-row[row-id="t2"] [col-id="name"] input');
      await expect(input).toBeVisible();
      await input.fill(v);
      await input.press('Enter');
    };
    await edit('Demo urea (serum)');
    await expectSaveOn(save);
    await expect(save).toContainText('(1)');
    await shot(page, 'test-master-on');
    await edit('Demo urea');
    await expectSaveOff(save);
    await edit('Demo urea (serum)');
    await save.click();
    await expect.poll(() => neg.calls.filter(c => c.method === 'PATCH' && c.path === '/api/tests/t2').length).toBe(1);
    await expectSaveOff(save);
  });

  test('Report design: the band Save is off until a setting changes, and off again when it is put back', async ({ page }) => {
    await go(page, '/admin/reports?tab=letterhead');
    await expect(vis(page, '[data-testid="rt-main-head"]')).toContainText('Letterhead', { timeout: 60_000 });
    const save = vis(page, 'pf-hero-band [data-testid="band-save"] .pf-ssv__save');
    await expectSaveOff(save);
    // A letterhead element's print switch (the left column) — never the preview's Guides switch (a view option).
    const sw = vis(page, '.pf-rhe-side button.pf-toggle[role="switch"]:not([disabled])');
    await sw.click();
    await expectSaveOn(save);
    await sw.click();
    await expectSaveOff(save);
  });
});

/** The beforeEach mocks, answering POSTs with the default ok again. */
function resetHookToOk() {
  neg.hook = r => {
    if (r.method !== 'GET') return undefined;
    const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
    if (r.path === '/api/config/billing') return ok(BILLING);
    return undefined;
  };
}
