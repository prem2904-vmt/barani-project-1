import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, isPhone, isDesktop, expectLayout, shotsDir } from './support/form-factor';
import { neg, resetNeg, installNegBackend, go } from './support/neg-backend';

/**
 * TEST EDITOR ALIGNMENT (owner 2026-11-17: "bring the live preview to the left and align it properly"; then: live previews on the RIGHT).
 * API mocked, demo data only; the editor is the real app. Checks: the live preview side card is RIGHT of the
 * main card with the same top / bottom edges; Basics fields sit on a 12-column grid (Type · Flow · Department
 * share a top edge, Test code · Short name · Section · Methodology share the next); Profiles are a dense
 * checklist with the search + "n selected" in the section header. Desktop is also shot at 3440 wide.
 * Screenshots: SHOTS_DIR/<form factor>/te-*.png (light + dark).
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/test-editor-align');
const out = () => shotsDir(OUT_BASE);
const vis = (page: Page, sel: string) => page.locator(sel).locator('visible=true').first();

async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
  await page.waitForTimeout(900);
}
async function shot(page: Page, name: string) {
  for (const dark of [false, true]) { await theme(page, dark); await page.screenshot({ path: `${out()}/${name}--${dark ? 'dark' : 'light'}.png` }); }
  await theme(page, false);
}

const DEPTS = [
  { id: 'd1', name: 'Haematology', code: 'HEM', isActive: true, catalogKey: 'hem' },
  { id: 'd2', name: 'Biochemistry', code: 'BIO', isActive: true, catalogKey: 'bio' },
];
const OGTT = {
  id: 't1', tenantId: 'tn', name: 'Glucose Tolerance Test (OGTT)', testCode: 'BIO005', shortName: 'OGTT', type: 'individual', flow: 'direct',
  taxSlab: 0, price: 450, discount: 0, isActive: true, isEnabled: true, isOffered: true, department: 'Biochemistry', departmentId: 'd2',
  section: 'Glucose', methodology: 'GOD-POD', sampleType: 'Fluoride plasma', tubeColor: 'grey', unit: 'mg/dL', tatHours: 6, origin: 'master',
  parametersJson: JSON.stringify([{ name: 'Glucose', type: 'numeric', unit: 'mg/dL' }]),
};
const PROFILE_NAMES = [
  'Diabetic Profile', 'Antenatal Profile', 'Master Health Check', 'Executive Health Check', 'Fever Panel', 'Liver Function Test',
  'Renal Function Test', 'Thyroid Profile', 'Lipid Profile', 'Cardiac Risk Markers', 'Pre-operative Panel', 'Women Wellness',
  'Senior Citizen Check', 'Gestational Diabetes Screen', 'Metabolic Panel', 'Electrolyte Panel', 'Anaemia Profile', 'Iron Studies',
  'Vitamin Panel', 'Arthritis Profile', 'Hormone Panel (Female)', 'Hormone Panel (Male)', 'Pancreatic Panel', 'Coagulation Profile',
];
const PROFILES = PROFILE_NAMES.map((name, i) => ({
  id: `p${i + 1}`, tenantId: 'tn', name, testCode: `PRO${String(i + 1).padStart(3, '0')}`, type: 'profile', flow: 'direct', taxSlab: 0,
  price: 900, discount: 0, isActive: true, isEnabled: true, isOffered: true, department: 'Biochemistry', departmentId: 'd2', origin: 'master',
  parameters: JSON.stringify({ items: [0, 3, 13].includes(i) ? [{ testId: 't1' }] : [] }),
}));

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(150_000);
  resetNeg();
  neg.hook = r => {
    if (r.method !== 'GET') return undefined;
    const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
    if (r.path === '/api/tests/') return ok([OGTT, ...PROFILES]);
    if (r.path === '/api/tests/t1') return ok(OGTT);
    if (r.path === '/api/tenants/departments') return ok(DEPTS);
    return undefined;
  };
  await installNegBackend(page, context);
});

async function open(page: Page) {
  await go(page, '/admin/tests/t1/edit?type=individual');
  await expect(vis(page, '#sec-identity')).toBeVisible({ timeout: 60_000 });
  await expect(vis(page, '.pf-profpanel__item')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(900);
}

/** Top edges of the visible Basics fields, by label. */
async function fieldTops(page: Page, labels: string[]) {
  const out: Record<string, { x: number; y: number; w: number }> = {};
  for (const l of labels) {
    const f = page.locator('#sec-identity .pf-uf').filter({ has: page.locator('.pf-uf__lbl', { hasText: new RegExp(`^${l}$`) }) }).first();
    const b = (await f.boundingBox())!;
    out[l] = { x: b.x, y: b.y, w: b.width };
  }
  return out;
}

test.describe('test editor alignment', () => {
  test('preview RIGHT, field grid aligned, dense Profiles checklist (1440 + 3440)', async ({ page }) => {
    await open(page);
    await expectLayout(page, 'test editor');

    // Profiles: dense rows (no 48px+ tiles), search + "n selected" in the section header.
    const row = (await vis(page, '.pf-profpanel__item').boundingBox())!;
    expect(row.height, 'profile row is dense').toBeLessThanOrEqual(44);
    await expect(vis(page, '.pf-profpanel__head .pf-profpanel__count')).toHaveText('3 selected');
    await expect(vis(page, '.pf-profpanel__head input[type="search"]')).toBeVisible();

    const widths = isDesktop() ? [1440, 3440] : [0];
    for (const w of widths) {
      if (w) { await page.setViewportSize({ width: w, height: w > 2000 ? 1440 : 900 }); await page.waitForTimeout(1500); }
      const vw = page.viewportSize()!.width;
      if (vw >= 1024) {
        const aside = (await page.locator('#pf-te2-preview').boundingBox())!;
        const main = (await vis(page, '#sec-identity').boundingBox())!;
        expect(aside.x, 'live preview on the RIGHT').toBeGreaterThan(main.x);
        expect(Math.abs(aside.y - main.y), 'side + main card tops align').toBeLessThan(2);
        expect(Math.abs((aside.y + aside.height) - (main.y + main.height)), 'side + main card bottoms align').toBeLessThan(2);
      }
      // Rows of 3 / 4 only when the card is wide; narrower cards step down to 2 per row, phones to 1.
      const cardW = (await vis(page, '#sec-identity').boundingBox())!.width;
      if (cardW > 800) {
        const t = await fieldTops(page, ['Type', 'Flow', 'Department', 'Test code', 'Short name', 'Section', 'Methodology']);
        const row1 = [t['Type'], t['Flow'], t['Department']];
        const row2 = [t['Test code'], t['Short name'], t['Section'], t['Methodology']];
        for (const r of [row1, row2]) {
          const y0 = r[0].y;
          for (const f of r) expect(Math.abs(f.y - y0), 'fields in a row share a top edge').toBeLessThan(2);
        }
        expect(t['Test code'].y, 'codes row below the type row').toBeGreaterThan(t['Type'].y);
        // Equal widths within a row.
        for (const r of [row1, row2]) for (const f of r) expect(Math.abs(f.w - r[0].w)).toBeLessThan(2);
      }
      await shot(page, `te-basics${w ? '-' + w : ''}`);
    }
    if (isDesktop()) await page.setViewportSize({ width: 1440, height: 900 });

    for (const sec of ['pricing', 'results'] as const) {
      await vis(page, `[role="tab"][data-sec="${sec}"]`).click();
      await expect(vis(page, `#sec-${sec}`)).toBeVisible();
      await page.waitForTimeout(500);
      await shot(page, `te-${sec}`);
    }
    if (isPhone()) {
      await vis(page, '[role="tab"][data-sec="identity"]').click();
      await vis(page, '.pf-te2-previewbtn').click();
      await expect(page.locator('#pf-te2-preview')).toBeVisible();
      await page.waitForTimeout(500);
      await shot(page, 'te-preview-sheet');
    }
  });
});
