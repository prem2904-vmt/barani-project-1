import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './support/form-factor';
import { resetNeg, installNegBackend, go, TENANT } from './support/neg-backend';

/**
 * Cortex bug batch 2026-11-16 (OPS-135 / 137 / 141 / 142), real screens at every form factor, light + dark.
 * API mocked, demo data only. Screenshots: SHOTS_DIR/<project>/OPS-<n>-*.png
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/bugs-1116');
const now = new Date();
const iso = (d: Date) => d.toISOString();

const cors = (origin: string) => ({ 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
const ok = (origin: string, data: unknown) => ({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: true, data }) });

const fld = (name: string, title: string, type: string, extra: Record<string, unknown> = {}) => ({ id: name, name, title, type, isStandard: true, isRequired: false, isEditable: true, storageKey: name, width: 'half', ...extra });
const REG_CONFIG = {
  id: 'cfg', name: 'patient_registration', title: 'Patient Registration', module: 'lms', screenName: 'patient_registration', version: 1, status: 'published', globalConditions: [], actions: [],
  steps: [{ id: 'st1', name: 'basic_info', title: 'Basic Info', type: 'entry', isRequired: true, canSkip: false, isStandard: true, fields: [
    fld('first_name', 'First name', 'text', { isRequired: true }), fld('fathers_name', 'Last name', 'text', { isRequired: true }),
    fld('phone', 'Phone', 'phone', { isRequired: true }), fld('date_of_birth', 'Date of birth', 'date'),
    fld('sex', 'Sex', 'select', { isRequired: true, options: ['Male', 'Female', 'Other'].map(v => ({ value: v, label: v })) }),
  ] }],
};

const TUBE = {
  id: 's1', orderId: 'oc', status: 'pending', barcode: 'B-s1', tubeColor: 'lavender', rejectionCount: 0, createdAt: iso(now),
  department: { id: 'd1', name: 'Haematology', code: 'HEM' },
  tests: [{ id: 's1-t', status: 'pending', test: { name: 'Haemoglobin', parameters: JSON.stringify({ parameters: [{ name: 'hb', title: 'Hb', unit: 'g/dL' }] }), sampleType: 'Whole blood' } }],
};
const COLLECT_ORDER = {
  id: 'oc', orderNumber: 'LAB-2611-00031', dailyNo: 31, dailyNoDay: iso(now).slice(0, 10), patientId: 'p31', branchId: 'b1',
  patient: { id: 'p31', displayName: 'Baby Sumathi', firstName: 'Sumathi', gender: 'F', sex: 'Female', age: 0, mrn: '260031', phone: '+919876543210' },
  priority: 'Normal', source: 'walkin', collectionType: 'walkin', status: 'billed', createdAt: iso(now), updatedAt: iso(now), samples: [TUBE],
};

const PUBLIC_SNAP = JSON.stringify({
  patient: { displayName: 'Baby Sumathi N', age: 0, ageDisplay: '6 M', ageYears: 0.5, sex: 'Female', mrn: '260031' },
  order: { orderNumber: 'LAB-2611-000015' }, type: 'partial', isPartial: true,
});

async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
}

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(150_000);
  resetNeg();
  await installNegBackend(page, context);
  // Specific answers on top of the shared mock; everything else falls through to it.
  await page.route(/prefrontal\.health\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    const p = new URL(req.url()).pathname;
    if (req.method() === 'OPTIONS') return route.fallback();
    if (p === '/api/workflows/patient_registration') return route.fulfill(ok(origin, { id: 'w1', tenantId: TENANT.id, module: 'lms', screenName: 'patient_registration', configJson: JSON.stringify(REG_CONFIG), version: 1, status: 'published', updatedAt: iso(now) }));
    if (p === '/api/samples/pending-collection') return route.fulfill(ok(origin, [{ ...TUBE, order: COLLECT_ORDER }]));
    if (p === '/api/orders/oc') return route.fulfill(ok(origin, COLLECT_ORDER));
    if (p === '/api/samples/s1/collect') return route.fulfill(ok(origin, { ...TUBE, status: 'collected' }));
    if (p === '/api/public/report/tok-baby' && req.method() === 'GET') return route.fulfill(ok(origin, { state: 'active', lab: { name: 'Arun Lab' } }));
    if (p === '/api/public/report/tok-baby/verify') return route.fulfill(ok(origin, {
      org: 'Arun Lab', patient: 'B••• S•••', reportReady: false, report: { id: 'r1', type: 'partial', createdAt: iso(now), data: PUBLIC_SNAP },
    }));
    return route.fallback();
  });
});

test.describe('bugs-1116', () => {
  for (const dark of [false, true]) {
    const mode = dark ? 'dark' : 'light';

    test(`OPS-135 registration: 6 typed in Years then Months stays 6 (${mode})`, async ({ page }, info) => {
      const OUT = path.join(OUT_BASE, info.project.name); fs.mkdirSync(OUT, { recursive: true });
      await go(page, '/frontdesk/patients/new');
      await theme(page, dark);
      const age = page.locator('input[aria-label^="Age in"]').locator('visible=true').first();
      await expect(age).toBeVisible({ timeout: 60_000 });
      await age.fill('6');
      const months = page.getByRole('radio', { name: 'Mo', exact: true }).locator('visible=true').first();
      await months.click();
      await expect(age).toHaveValue('6');
      await expect(months).toHaveAttribute('aria-checked', 'true');
      await page.screenshot({ path: `${OUT}/OPS-135-age-months-${mode}.png` });
      await page.getByRole('radio', { name: 'Days', exact: true }).locator('visible=true').first().click();
      await expect(age).toHaveValue('6');
      await page.getByRole('radio', { name: 'Yrs', exact: true }).locator('visible=true').first().click();
      await expect(age).toHaveValue('6');
    });

    test(`OPS-142 collection: drawing the last tube stays on the page until Done (${mode})`, async ({ page }, info) => {
      const OUT = path.join(OUT_BASE, info.project.name); fs.mkdirSync(OUT, { recursive: true });
      await go(page, '/lab/collect?orderId=oc&from=/frontdesk');
      await theme(page, dark);
      const tile = page.locator('.pf-sc-tile').locator('visible=true').first();
      await expect(tile).toBeVisible({ timeout: 60_000 });
      await tile.click();
      await expect.poll(() => page.evaluate(() => document.querySelectorAll('.pf-tube--done').length), { timeout: 10_000 }).toBeGreaterThan(0);
      await page.waitForTimeout(1500);
      expect(new URL(page.url()).pathname + new URL(page.url()).hash).toMatch(/lab\/collect/);
      // Phone / tablet: the actions live in the "More collection actions" sheet.
      const more = page.getByRole('button', { name: 'More collection actions' }).locator('visible=true');
      if (await more.count()) { await page.screenshot({ path: `${OUT}/OPS-142-collected-stays-${mode}.png` }); await more.first().click(); }
      const done = page.getByRole('button', { name: /^Done$/ }).locator('visible=true').first();
      await expect(done).toBeVisible();
      await page.screenshot({ path: `${OUT}/OPS-142-collected-done-${mode}.png` });
      await done.click();
      await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).hash, { timeout: 10_000 }).toMatch(/frontdesk/);
    });

    test(`OPS-137 public report link: a 6-month-old shows months (${mode})`, async ({ page }, info) => {
      const OUT = path.join(OUT_BASE, info.project.name); fs.mkdirSync(OUT, { recursive: true });
      await go(page, '/reports/public/tok-baby');
      await theme(page, dark);
      const input = page.getByTestId('pr-secret');
      await expect(input).toBeVisible({ timeout: 60_000 });
      await input.fill('3210');
      await page.getByTestId('pr-open').click();
      await expect(page.getByText('6 months · Female')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(/\b0 y\b/)).toHaveCount(0);
      await page.screenshot({ path: `${OUT}/OPS-137-public-report-${mode}.png` });
    });

    test(`OPS-141 report patient strip: age formats have no duplicate (${mode})`, async ({ page }, info) => {
      const OUT = path.join(OUT_BASE, info.project.name); fs.mkdirSync(OUT, { recursive: true });
      await go(page, '/admin/reports');
      await theme(page, dark);
      const tab = page.getByText('Patient strip', { exact: true }).locator('visible=true').first();
      await expect(tab).toBeVisible({ timeout: 60_000 });
      await tab.click();
      await page.getByText('One field', { exact: true }).locator('visible=true').first().click();
      const sel = page.locator('pf-select', { hasText: /As the layout prints it|45 Y|45 Years|45 yrs|45Y/ }).locator('visible=true').first();
      await sel.locator('button[aria-haspopup="listbox"]').click();
      const opts = page.locator('[role="listbox"] [role="option"]').locator('visible=true');
      await expect(opts.first()).toBeVisible();
      const texts = (await opts.allInnerTexts()).map(t => t.trim());
      expect(texts).toEqual(['As the layout prints it', '45 Y', '45 Years', '45 yrs', '45Y']);
      expect(new Set(texts.map(t => t.toLowerCase())).size).toBe(texts.length);
      await page.screenshot({ path: `${OUT}/OPS-141-age-format-options-${mode}.png` });
    });
  }
});
