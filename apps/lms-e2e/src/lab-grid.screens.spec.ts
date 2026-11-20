import type { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect, isPhone, isTouch, projectName, expectNoHorizontalScroll } from './support/form-factor';
import { resetNeg, installNegBackend, go, neg, visible, ME } from './support/neg-backend';

/**
 * Lab grid (owner 2026-11-20): /lab/my-work and /pathologist on the Results / Frontdesk grid — shared pf-data-grid,
 * one primary row action at the row end (+ ⋯), whole row = the old tap, touch rows 64 with ≥44 px controls 8 px apart,
 * columns fold at 641–1279, phones get card rows. API mocked, fake data only.
 * Screenshots: SHOTS_DIR/<project>/lab-grid-*.png  (LAB_GRID_SHOTS_ONLY=1 = just the screenshots, for the before set).
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/lab-grid');
const SHOTS_ONLY = process.env['LAB_GRID_SHOTS_ONLY'] === '1';

const now = Date.now();
const ago = (m: number) => new Date(now - m * 60000).toISOString();
const today = ago(0).slice(0, 10);
const pat = (n: number, name: string, age: number, sex: string) => ({ id: `p${n}`, displayName: name, firstName: name.split(' ')[0], age, sex, gender: sex, mrn: `AA00${String(n).padStart(2, '0')}`, phone: '+919876543210' });
const HAE = { id: 'hae', name: 'Haematology', code: 'HAE' };
const BIO = { id: 'bio', name: 'Biochemistry', code: 'BIO' };
const order = (n: number, name: string, age: number, sex: string, priority = 'Normal') =>
  ({ id: `ord-${n}`, orderNumber: `LAB-2611-0001${String(n).padStart(2, '0')}`, dailyNo: n, dailyNoDay: today, priority, patient: pat(n, name, age, sex) });
type Line = Record<string, unknown>;
const line = (id: string, test: string, dept: typeof HAE, sample: { id: string; barcode: string; rec: number }, o: ReturnType<typeof order>, extra: Line = {}): Line => ({
  id, status: 'pending', assignedTo: ME.id,
  test: { id: `t-${id}`, name: test, tatHours: 2, departmentId: dept.id, department: dept },
  subOrder: { id: sample.id, barcode: sample.barcode, receivedAtLab: ago(sample.rec), departmentId: dept.id, department: dept, order: o },
  ...extra,
});

const LONG = 'Mrs. Venkatalakshmi Subramaniam Ramachandran';
const O1 = order(3, 'Ms. Arya Stark', 30, 'F', 'Urgent');
const O2 = order(7, LONG, 62, 'F');
const O3 = order(11, 'Mr. Prem Kumar K', 41, 'M');
const O4 = order(12, 'Baby Leo S', 1, 'M');
const S = (id: string, barcode: string, rec: number) => ({ id, barcode, rec });
const MY_WORK: Line[] = [
  line('l1', 'Complete Blood Count', HAE, S('s1', '0126101', 40), O1),
  line('l2', 'ESR', HAE, S('s1', '0126101', 40), O1),
  line('l3', 'Liver Function Test', BIO, S('s2', '0126102', 150), O2, { status: 'in_progress', currentResult: '{"values":{"alt":"40"}}' }),
  line('l4', 'Renal Function Test', BIO, S('s2', '0126102', 150), O2),
  line('l5', 'Lipid Profile', BIO, S('s3', '0126103', 30), O3, { status: 're_entry', rejectionReason: 'Sample looks haemolysed — please re-run' }),
  line('l6', 'HbA1c', BIO, S('s4', '0126104', 20), O4),
  line('l7', 'Peripheral smear', HAE, S('s5', '0126105', 10), O4),
];
const QUEUE: Line[] = [
  line('q1', 'Thyroid profile', BIO, S('s6', '0126106', 25), order(14, 'Mr. Sathish Kumar', 29, 'M'), { assignedTo: null }),
  line('q2', 'Blood sugar (fasting)', BIO, S('s7', '0126107', 15), order(15, 'Ms. Sansa Stark', 28, 'F', 'Urgent'), { assignedTo: null }),
  line('q3', 'Dengue NS1', HAE, S('s8', '0126108', 95), order(16, 'Master Sasi Kumar', 9, 'M'), { assignedTo: 'other-tech' }),
];
const COMPLETED: Line[] = [
  line('c1', 'Urine routine', BIO, S('s9', '0126109', 80), order(17, 'Nithin Ragav G', 32, 'M'), { status: 'validated', resultedAt: ago(30), validatedAt: ago(10) }),
  line('c2', 'Complete Blood Count', HAE, S('s10', '0126110', 70), order(18, 'Ms. Priya Nair', 36, 'F'), { status: 'entered', resultedAt: ago(20) }),
  line('c3', 'CRP', BIO, S('s11', '0126111', 60), order(19, 'Mr. Rahul Dev', 45, 'M'), { status: 'validated', resultedAt: ago(15), validatedAt: ago(5) }),
];
// Pathologist queue: entered lines; one critical (not acknowledged), one mine, one overdue.
const PV: Line[] = [
  line('v1', 'Complete Blood Count', HAE, S('s21', '0126117', 50), order(21, LONG, 44, 'F'), { status: 'entered', assignedTo: null, resultedAt: ago(12), currentResult: '{"flags":{"critical":true}}' }),
  line('v2', 'ESR', HAE, S('s21', '0126117', 50), order(21, LONG, 44, 'F'), { status: 'entered', assignedTo: null, resultedAt: ago(12) }),
  line('v3', 'Culture & sensitivity', BIO, S('s22', '1126001', 30), order(22, 'Ms. Arya Stark', 30, 'F', 'Urgent'), { status: 'entered', assignedTo: null, resultedAt: ago(8), validatorAssignedTo: ME.id }),
  line('v4', 'Liver Function Test', BIO, S('s23', '0126118', 200), order(23, 'Mr. Prem Kumar K', 41, 'M'), { status: 'entered', assignedTo: null, resultedAt: ago(90) }),
  line('v5', 'Thyroid profile', BIO, S('s24', '0126119', 40), order(24, 'Baby Leo S', 1, 'M'), { status: 'entered', assignedTo: null, resultedAt: ago(5) }),
];
const CRIT = [{ id: 'cr1', status: 'open', source: 'live', orderTestId: 'v1', orderId: 'ord-21', resultVersion: 1, patientId: 'p21', patientName: LONG, testId: 't-v1', testName: 'Complete Blood Count', summary: 'Hb 5.1 g/dL CL', values: [], detectedAt: ago(10), alertedCount: 1, acknowledgements: [] }];

let focus: 'patient' | 'sample' = 'patient';

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(300_000);
  resetNeg();
  focus = 'patient';
  neg.hook = r => {
    if (r.method !== 'GET') return undefined;
    const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
    switch (r.path) {
      case '/api/results/my-work': return ok(MY_WORK);
      case '/api/results/service-queue': return ok(QUEUE);
      case '/api/results/completed': return ok(COMPLETED);
      case '/api/validation/queue': return ok(PV);
      case '/api/validation/scope': return ok({ scoped: true, departments: [HAE, BIO], validatedToday: 14, validatedTodayByMe: 6 });
      case '/api/critical-results/lookup': return ok(CRIT);
      case '/api/tenants/branch-lab-config': return ok({ effectiveQueueFocus: focus, queueFocus: focus });
      case '/api/users/': return ok([{ id: 'other-tech', displayName: 'Ravi T' }]);
      default: return undefined;
    }
  };
  await installNegBackend(page, context);
});

async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
}
const shot = async (page: Page, name: string) => {
  const OUT = path.join(OUT_BASE, projectName()); fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/lab-grid-${name}.png` });
};
const settle = (page: Page) => page.waitForTimeout(900);

/** Pick a My Work tab from the band's segmented (wide) or the phone tab strip. */
async function labTab(page: Page, label: string) {
  if (isPhone()) {
    // Phones: the icon tab strip under the band (Completed is "Done" there).
    const name = label === 'Completed' ? 'Done' : label;
    await page.locator(`.pf-mtabs [role="tab"][aria-label="${name}"]`).locator('visible=true').first().click();
    return;
  }
  const radio = page.locator(`[role="radio"]:has-text("${label}")`).locator('visible=true').first();
  if (await radio.count()) { await radio.click(); return; }
  const compact = page.locator('pf-segmented [data-seg-compact]').locator('visible=true').first();
  if (await compact.count()) { await compact.click(); await page.getByRole('menuitemradio', { name: new RegExp(`^${label}`) }).locator('visible=true').first().click(); }
}

/** Every visible button inside a grid row / card row: inside the card, ≥44×44 on touch, ≥8 px from its neighbour. */
async function touchAudit(page: Page, cardSel: string, btnSel: string) {
  return page.evaluate(([cardSel, btnSel]) => {

    const touch = matchMedia('(pointer: coarse)').matches || !matchMedia('(hover: hover) and (pointer: fine)').matches;
    const out: string[] = [];
    const rows = new Map<Element, DOMRect[]>();
    for (const b of Array.from(document.querySelectorAll<HTMLElement>(btnSel))) {
      const r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const name = b.getAttribute('aria-label') || b.textContent?.trim() || b.className;
      const card = b.closest(cardSel)?.getBoundingClientRect();
      if (card && (r.right > card.right + 0.5 || r.left < card.left - 0.5)) out.push(`${name} outside the card (${Math.round(r.left)}–${Math.round(r.right)} vs ${Math.round(card.left)}–${Math.round(card.right)})`);
      if (touch && (r.width < 43.5 || r.height < 43.5)) out.push(`${name} is ${Math.round(r.width)}×${Math.round(r.height)} on touch`);
      const row = b.closest('.ag-row, li, [data-row]') ?? document.body;
      rows.set(row, [...(rows.get(row) ?? []), r]);
    }
    if (touch) for (const rects of rows.values()) {
      const s = [...rects].sort((a, b) => a.left - b.left);
      for (let i = 1; i < s.length; i++) {
        const sameLine = s[i].top < s[i - 1].bottom && s[i].bottom > s[i - 1].top;
        if (sameLine && s[i].left - s[i - 1].right < 7.5) out.push(`gap ${Math.round(s[i].left - s[i - 1].right)}px between row controls`);
      }
    }
    return out;
  }, [cardSel, btnSel] as const);
}

for (const dark of [false, true]) {
  const mode = dark ? 'dark' : 'light';

  test(`My Work — patient focus, sample focus, queue, completed (${mode})`, async ({ page }) => {
    await go(page, '/lab/my-work');
    await theme(page, dark);
    if (isPhone()) await labTab(page, 'My Work');
    await page.getByText('Ms. Arya Stark').locator('visible=true').first().waitFor({ timeout: 60_000 }).catch(() => undefined);
    await settle(page);
    await shot(page, `mywork-patient-${mode}`);
    if (!SHOTS_ONLY) {
      await expectNoHorizontalScroll(page);
      if (!isPhone()) {
        await expect(visible(page, '[data-testid="mw-grid"] .ag-row')).toBeVisible({ timeout: 20_000 });
        // Names wrap, never an ellipsis.
        const long = visible(page, `[data-testid="mw-grid"] .wg-who__name:has-text("${LONG}")`);
        await expect(long).toBeVisible();
        expect(await long.evaluate(e => getComputedStyle(e).textOverflow)).not.toBe('ellipsis');
        // Touch: rows are the shared 64; controls ≥44 and 8 apart, inside the card.
        if (isTouch()) {
          const h = await visible(page, '[data-testid="mw-grid"] .ag-row').evaluate(e => e.getBoundingClientRect().height);
          expect(h).toBeGreaterThanOrEqual(63.5);
        }
        expect(await touchAudit(page, '.pf-mw-pane', '[data-testid="mw-grid"] .ag-row button')).toEqual([]);
        // No Tests column; the band's sort picker is gone (headers sort); the head is ONE row with its filters.
        await expect(page.locator('[data-testid="mw-grid"] .ag-header-cell[col-id="tests"]')).toHaveCount(0);
        await expect(page.locator('pf-hero-band pf-lab-sort')).toHaveCount(0);
        const head = await visible(page, '.pf-mw-pane__hdr--tabs').boundingBox();
        expect(head!.height, 'card head stays one row').toBeLessThan(72);
        expect(await touchAudit(page, '.pf-mw-pane', '.pf-mw-pane__hdr--tabs > .mw-filterwrap > button, .pf-mw-pane__hdr--tabs > .mw-find')).toEqual([]);
        // Search narrows the list and the count says so.
        await visible(page, '[data-testid="mw-find"]').fill('Arya');
        await expect(page.locator('[data-testid="mw-grid"] .ag-row.mwg-row').locator('visible=true')).toHaveCount(1);
        await shot(page, `mywork-search-${mode}`);
        await visible(page, '[data-testid="mw-find"]').fill('');
        await page.mouse.click(4, 4);
        // Filters: priority + department (+ window on Completed).
        await visible(page, '[data-testid="mw-filter-btn"]').click();
        await expect(visible(page, '[data-testid="mw-filters"]')).toBeVisible();
        await shot(page, `mywork-filters-${mode}`);
        await visible(page, '[data-testid="mw-filters"] [data-filter="priority"] [role="radio"]:has-text("Urgent")').click();
        await expect(page.locator('[data-testid="mw-grid"] .ag-row.mwg-row').locator('visible=true')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await expect(visible(page, '[data-testid="mw-filter-btn"]')).toHaveClass(/mw-filterbtn--on/);
        await visible(page, '[data-testid="mw-filter-btn"]').click();
        await visible(page, '[data-testid="mw-filters"] .mwf__clear').click();
        await page.keyboard.press('Escape');
        // Header (column) filters like Test Master: the Status set filter narrows the rows; the icon is a 44px target on touch.
        const fbtn = visible(page, '[data-testid="mw-grid"] .ag-header-cell[col-id="status"] .ag-header-cell-filter-button');
        if (await fbtn.count()) {
          await fbtn.click();
          await expect(visible(page, '.ag-filter pf-work-set-filter, .ag-popup pf-work-set-filter')).toBeVisible();
          await shot(page, `mywork-colfilter-${mode}`);
          await visible(page, 'pf-work-set-filter [data-value="Draft"]').click();
          await expect(page.locator('[data-testid="mw-grid"] .ag-row.mwg-row:not(.ag-opacity-zero)').locator('visible=true')).toHaveCount(1);
          await expect(visible(page, '[data-testid="mw-grid"] .ag-header-cell[col-id="status"]')).toHaveClass(/ag-header-cell-filtered/);
          await visible(page, 'pf-work-set-filter .wsf__clear').click();
          await page.keyboard.press('Escape');
        }
        // The shared journey ring opens the journey view (the row tap stays the row's).
        await visible(page, '[data-testid="mw-grid"] .ag-row pf-journey-ring .pf-jring__btn').click();
        await expect(visible(page, 'pf-journey-overlay [role="dialog"]')).toBeVisible();
        await shot(page, `mywork-journey-${mode}`);
        await page.keyboard.press('Escape');
        await expect(page.locator('pf-journey-overlay [role="dialog"]').locator('visible=true')).toHaveCount(0);
        // Row tap (patient focus) opens the patient's tubes; a tube tap opens result entry (scan gate).
        await visible(page, `[data-testid="mw-grid"] .ag-row .wg-who__name:has-text("${LONG}")`).click();
        await expect(visible(page, '[data-testid="mw-grid"] .mwg-tubes')).toBeVisible();
        await shot(page, `mywork-patient-open-${mode}`);
        expect(await touchAudit(page, '.pf-mw-pane', '[data-testid="mw-grid"] .mwg-tubes button')).toEqual([]);
      } else {
        await expect(visible(page, '[data-testid="mw-cards"]')).toBeVisible({ timeout: 20_000 });
        expect(await touchAudit(page, '.pf-mw-pane', '[data-testid="mw-cards"] button')).toEqual([]);
        expect(await touchAudit(page, '.pf-mw-pane', '.pf-mw-pane__hdr--tabs > .mw-filterwrap > button, .pf-mw-pane__hdr--tabs > .mw-find')).toEqual([]);
        // Phones: Filters is a bottom sheet (with Sort — no column headers on a phone).
        await visible(page, '[data-testid="mw-filter-btn"]').click();
        await expect(visible(page, '[data-testid="mw-filters"]')).toBeVisible();
        await expect(visible(page, '[data-testid="mw-filters"] pf-lab-sort')).toBeVisible();
        await shot(page, `mywork-filters-${mode}`);
        await page.keyboard.press('Escape');
      }
    }

    await labTab(page, 'Queue');
    await settle(page);
    await shot(page, `mywork-queue-${mode}`);
    if (!SHOTS_ONLY && !isPhone()) {
      await expect(visible(page, '[data-testid="mw-grid"] .ag-row')).toBeVisible({ timeout: 20_000 });
      await expect(visible(page, '[data-testid="mw-grid"] [data-action="pick"]')).toBeVisible();
      expect(await touchAudit(page, '.pf-mw-pane', '[data-testid="mw-grid"] .ag-row button')).toEqual([]);
    }

    await labTab(page, 'Completed');
    await settle(page);
    await shot(page, `mywork-completed-${mode}`);
    if (!SHOTS_ONLY && !isPhone()) {
      await expect(visible(page, '[data-testid="mw-grid"] .ag-row')).toBeVisible({ timeout: 20_000 });
      expect(await touchAudit(page, '.pf-mw-pane', '[data-testid="mw-grid"] .ag-row button')).toEqual([]);
    }
  });

  test(`My Work — sample focus (${mode})`, async ({ page }) => {
    focus = 'sample';
    await go(page, '/lab/my-work');
    await theme(page, dark);
    if (isPhone()) await labTab(page, 'My Work');
    await page.getByText('0126101').locator('visible=true').first().waitFor({ timeout: 60_000 }).catch(() => undefined);
    await settle(page);
    await shot(page, `mywork-sample-${mode}`);
    if (!SHOTS_ONLY && !isPhone()) {
      await expect(visible(page, '[data-testid="mw-grid"] .ag-row')).toBeVisible({ timeout: 20_000 });
      await expect(visible(page, '[data-testid="mw-grid"] [data-action="enter"]')).toBeVisible();
      expect(await touchAudit(page, '.pf-mw-pane', '[data-testid="mw-grid"] .ag-row button')).toEqual([]);
      await expectNoHorizontalScroll(page);
    }
  });

  test(`Pathologist queue (${mode})`, async ({ page }) => {
    await go(page, '/pathologist');
    await theme(page, dark);
    await page.getByText('0126117').locator('visible=true').first().waitFor({ timeout: 60_000 }).catch(() => undefined);
    await settle(page);
    await shot(page, `pathologist-${mode}`);
    if (!SHOTS_ONLY) {
      await expectNoHorizontalScroll(page);
      if (!isPhone()) {
        await expect(visible(page, '[data-testid="pv-grid"] .ag-row')).toBeVisible({ timeout: 20_000 });
        await expect(visible(page, `[data-testid="pv-grid"] .pv-who__name:has-text("${LONG}")`)).toBeVisible();
        await expect(visible(page, '[data-testid="pv-grid"] .pv-ack')).toBeVisible();
        await visible(page, '[data-testid="pv-grid"] .ag-row pf-journey-ring .pf-jring__btn').click();
        await expect(visible(page, 'pf-journey-overlay [role="dialog"]')).toBeVisible();
        await shot(page, `pathologist-journey-${mode}`);
        await page.keyboard.press('Escape');
        expect(await touchAudit(page, '.pv-queue', '[data-testid="pv-grid"] .ag-row button')).toEqual([]);
        if (isTouch()) {
          const h = await visible(page, '[data-testid="pv-grid"] .ag-row').evaluate(e => e.getBoundingClientRect().height);
          expect(h).toBeGreaterThanOrEqual(63.5);
        }
        // Side card left, same height as the main card (Test Master frame) when there is room for it.
        const side = await visible(page, '.pv-side').boundingBox().catch(() => null);
        const main = (await visible(page, '.pv-queue').boundingBox())!;
        if (side && side.width > 0 && (page.viewportSize()?.width ?? 0) > 1023) {
          expect(side.x).toBeLessThan(main.x);
          expect(Math.abs(side.height - main.height)).toBeLessThan(2);
        }
      } else {
        await expect(visible(page, '[data-testid="pv-cards"]')).toBeVisible({ timeout: 20_000 });
        expect(await touchAudit(page, '.pv-queue', '[data-testid="pv-cards"] button')).toEqual([]);
      }
    }
  });
}
