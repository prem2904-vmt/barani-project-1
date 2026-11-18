import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, isPhone, isDesktop, formFactor, expectLayout, shotsDir } from './support/form-factor';
import { neg, resetNeg, installNegBackend, go } from './support/neg-backend';

/**
 * TEST EDITOR v2 (owner 2026-11-18): the five sections are the LEFT side card (340px, shared pf-sg-side) and the
 * selected section fills the RIGHT main card; NO permanent live preview — a "Preview" button (Alt+P) opens an A4
 * popup that closes with focus returned. Basics fits 1440×900 with no page scroll; Profiles (selected first,
 * search + filter) scroll INSIDE their list. Phones/tablets <900px get a section picker instead of the side card.
 * API mocked, demo data only; the editor is the real app. Screenshots: SHOTS_DIR/<form factor>/te-*.png (light + dark).
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/test-editor-v2');
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
    const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
    // The engine's sample report for the Preview popup (demo values only).
    if (r.method === 'POST' && r.path === '/api/report-layout/preview/t1') {
      return ok({
        testId: 't1', testName: OGTT.name, departmentName: 'Biochemistry', sampleType: 'Fluoride plasma',
        columns: [
          { id: 'c-name', name: 'name', label: 'Investigation', order: 1, width: 34, type: 'name', locked: false },
          { id: 'c-result', name: 'result', label: 'Result', order: 2, width: 20, type: 'result', locked: false },
          { id: 'c-unit', name: 'unit', label: 'Unit', order: 3, width: 16, type: 'unit', locked: false },
          { id: 'c-range', name: 'range', label: 'Reference range', order: 4, width: 30, type: 'range', locked: false },
        ],
        sections: [{ id: 's1', type: 'grid', label: null, isVisible: true, rows: [
          { id: 'r1', parameterName: 'Glucose', title: 'Glucose', unit: 'mg/dL', isMerged: false, isBold: false, color: null,
            cells: { name: 'Glucose', result: '112', unit: 'mg/dL', range: '70 - 140' } },
        ] }],
      });
    }
    if (r.method !== 'GET') return undefined;
    if (r.path === '/api/tests/') return ok([OGTT, ...[...PROFILES].reverse()]); // served out of order on purpose: the editor sorts like Test Master
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

/** Switch section: the side card on wide screens, the picker below 900px. */
async function goSection(page: Page, id: 'identity' | 'pricing' | 'results' | 'layout', label: RegExp) {
  if (page.viewportSize()!.width >= 900) await vis(page, `.pf-te2-sidebtn[data-sec="${id}"]`).click();
  else {
    await vis(page, '.pf-te2-pick pf-select').click();
    await page.getByRole('option', { name: label }).locator('visible=true').first().click();
  }
  await expect(vis(page, `#sec-${id}`)).toBeVisible();
  await page.waitForTimeout(500);
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

test.describe('test editor v2', () => {
  test('side card left, no permanent preview, field grid, Profiles list, sections (1440 + 1720)', async ({ page }) => {
    await open(page);
    await expectLayout(page, 'test editor');

    // No permanent live preview anywhere; the band has no tab strip.
    await expect(page.locator('#pf-te2-preview, .pf-livewrap, pf-report-pdf-preview')).toHaveCount(0);
    await expect(page.locator('.pf-te2-tabs, [role="tablist"]')).toHaveCount(0);
    await expect(vis(page, '#sec-identity .pf-card__head .pf-te2-previewbtn')).toBeVisible();

    // Profiles: dense rows, selected first (+ removable chips), search + filter, scroll INSIDE the list box.
    const row = (await vis(page, '.pf-profpanel__item').boundingBox())!;
    expect(row.height, 'profile row is a real tap target').toBeGreaterThanOrEqual(44);
    expect(row.height, 'still a compact list').toBeLessThanOrEqual(60);
    const chk = (await vis(page, '.pf-profpanel__item .pf-row__check').boundingBox())!;
    expect(chk.width, 'check circle >= 22px').toBeGreaterThanOrEqual(22);
    // Running numbers 1, 2, 3… and Test Master's code order (selected first, keeping their order).
    const rows = await page.locator('.pf-profpanel__item').evaluateAll(els => els.map(e => ({
      no: e.querySelector('.pf-profpanel__no')?.textContent?.trim(), code: e.querySelector('.pf-profpanel__code')?.textContent?.trim() ?? '',
      on: e.classList.contains('pf-row--in'), hasTitle: !!e.getAttribute('title') })));
    expect(rows.map(r => r.no)).toEqual(rows.map((_, i) => String(i + 1)));
    const selected = rows.filter(r => r.on).map(r => r.code), rest = rows.filter(r => !r.on).map(r => r.code);
    expect(selected, 'selected keep TM order').toEqual([...selected].sort());
    expect(rest, 'the others follow TM code order').toEqual([...rest].sort());
    expect(rows.some(r => r.hasTitle), 'no native tooltip').toBe(false);
    await expect(vis(page, '.pf-profpanel__head .pf-profpanel__count')).toHaveText('3 selected');
    await expect(vis(page, '.pf-profpanel__tools input[type="search"]')).toBeVisible();
    await expect(vis(page, '.pf-profpanel__tools pf-select')).toBeVisible();
    await expect(page.locator('.pf-profpanel__chips .pf-lp-chip')).toHaveCount(3);
    await expect(page.locator('.pf-profpanel__item.pf-row--in')).toHaveCount(3);
    const firstThree = await page.locator('.pf-profpanel__item').evaluateAll(
      els => els.slice(0, 3).every(e => e.classList.contains('pf-row--in')));
    expect(firstThree, 'selected profiles come first').toBe(true);
    const box = await page.locator('.pf-profpanel__grid').evaluate(e => ({ sh: e.scrollHeight, ch: e.clientHeight }));
    expect(box.ch, 'list box has a sensible max height').toBeLessThanOrEqual(300);
    expect(box.sh, 'the 24 profiles scroll inside it').toBeGreaterThan(box.ch);

    const sizes = isDesktop() ? [[1440, 900], [1720, 1000]] : formFactor() === 'tablet' ? [[0, 0], [1024, 1366], [1366, 1024]] : [[0, 0]];
    for (const [w, h] of sizes) {
      if (w) { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(1200); }
      const vw = page.viewportSize()!.width;
      if (vw >= 900) {
        const side = (await page.locator('aside.pf-sg-side').boundingBox())!;
        const main = (await vis(page, '#sec-identity').boundingBox())!;
        expect(side.x, 'sections side card on the LEFT').toBeLessThan(main.x);
        expect(Math.abs(side.width - 340), 'side card is 340px').toBeLessThan(2);
        expect(Math.abs(side.y - main.y), 'side + main card tops align').toBeLessThan(2);
        expect(Math.abs((side.y + side.height) - (main.y + main.height)), 'side + main card bottoms align').toBeLessThan(2);
        expect(await page.locator('.pf-te2-sidebtn').count()).toBe(5);
      } else {
        await expect(vis(page, '.pf-te2-pick pf-select')).toBeVisible();
        await expect(page.locator('aside.pf-sg-side')).toBeHidden();
      }
      if (w === 1440) {
        const sc = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: window.innerHeight }));
        expect(sc.sh, 'no page scroll on Basics at 1440×900').toBeLessThanOrEqual(sc.ih + 1);
      }
      const cardW = (await vis(page, '#sec-identity').boundingBox())!.width;
      if (cardW > 800) {
        const t = await fieldTops(page, ['Type', 'Flow', 'Department', 'Test code', 'Short name', 'Section', 'Methodology']);
        const row1 = [t['Type'], t['Flow'], t['Department']];
        const row2 = [t['Test code'], t['Short name'], t['Section'], t['Methodology']];
        for (const r of [row1, row2]) {
          const y0 = r[0].y;
          for (const f of r) expect(Math.abs(f.y - y0), 'fields in a row share a top edge').toBeLessThan(2);
          for (const f of r) expect(Math.abs(f.w - r[0].w)).toBeLessThan(2);
        }
        expect(t['Test code'].y, 'codes row below the type row').toBeGreaterThan(t['Type'].y);
      }
      await shot(page, `te-basics${w ? '-' + w : ''}`);
    }
    if (isDesktop()) await page.setViewportSize({ width: 1440, height: 900 });

    await goSection(page, 'results', /Result entry/);
    await shot(page, 'te-results');
    await goSection(page, 'layout', /Printed report/);
    await shot(page, 'te-layout');
    await goSection(page, 'pricing', /Price/);
    await shot(page, 'te-pricing');
    await goSection(page, 'identity', /Basics/);
  });

  test('Preview popup: button + Alt+P open it, Esc / Close return focus to where the user was', async ({ page }) => {
    await open(page);
    const btn = vis(page, '#sec-identity .pf-card__head .pf-te2-previewbtn');
    await btn.focus();
    await btn.click();
    const dlg = page.getByTestId('preview-dialog');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('pf-report-pdf-preview')).toHaveCount(1);
    await expect(page.getByTestId('preview-close')).toBeFocused();
    // A4 scale on a big screen: the page is 794px wide.
    if (isDesktop()) {
      await expect.poll(async () => (await dlg.locator('iframe').first().boundingBox())?.width ?? 0, { timeout: 30_000 }).toBeGreaterThan(780);
    } else {
      await page.waitForTimeout(2500);
    }
    await page.waitForTimeout(1500);
    await shot(page, 'te-preview');
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(btn).toBeFocused();

    if (isDesktop()) {
      // Alt+P toggles; focus returns to the field the user was in.
      const name = vis(page, '#sec-identity .pf-te2-name');
      await name.click();
      await page.keyboard.press('Alt+KeyP');
      await expect(dlg).toBeVisible();
      await page.getByTestId('preview-close').click();
      await expect(dlg).toHaveCount(0);
      await expect(name).toBeFocused();
    }
  });
});
