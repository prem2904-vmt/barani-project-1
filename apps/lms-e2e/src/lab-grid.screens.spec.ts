import type { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect, isPhone, isTouch, projectName, expectNoHorizontalScroll, belowGrid } from './support/form-factor';
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

const cstage = (label: string, state: string, extra: Record<string, unknown> = {}) => ({ key: label.toLowerCase(), label, state, ...extra });
const CULTURES = [
  { orderTestId: 'cu1', caseState: 'in_progress', createdAt: ago(26 * 60), patient: { age: 34, sex: 'Female', mrn: 'AA0031' }, barcode: 'MICRO26001', sampleId: 'sc1', patientName: 'Mrs. Shanthi M', dailyNo: 31, dailyNoDay: today,
    testName: 'Bacterial Culture & Sensitivity', departmentName: 'Microbiology', specimen: 'Urine',
    stages: [cstage('Gram / Direct smear', 'done', { doneAt: ago(25 * 60), doneByName: 'Ravi T' }), cstage('Growth', 'open', { incubateUntil: ago(-90) }), cstage('ID', 'open'), cstage('AST', 'open')] },
  { orderTestId: 'cu2', caseState: 'in_progress', createdAt: ago(50 * 60), patient: { age: 62, sex: 'Female', mrn: 'AA0007' }, barcode: 'MICRO26002', sampleId: 'sc2', patientName: LONG, dailyNo: 32, dailyNoDay: today,
    testName: 'Blood Culture', departmentName: 'Microbiology', specimen: 'Blood',
    stages: [cstage('Gram / Direct smear', 'done', { doneAt: ago(49 * 60) }), cstage('Growth', 'open', { incubateUntil: ago(40) }), cstage('AST', 'open')] },
  { orderTestId: 'cu3', caseState: 'in_progress', createdAt: ago(3 * 60), patient: { age: 41, sex: 'Male', mrn: 'AA0011' }, barcode: 'MICRO26003', sampleId: 'sc3', patientName: 'Mr. Prem Kumar K', dailyNo: 33, dailyNoDay: today,
    testName: 'Pus Culture', departmentName: 'Microbiology', specimen: 'Pus', stages: [cstage('Gram / Direct smear', 'picked', { holderName: 'Ravi T', pickedAt: ago(20) }), cstage('Growth', 'open')] },
  { orderTestId: 'cu4', caseState: 'awaiting_signout', createdAt: ago(72 * 60), barcode: 'MICRO26004', sampleId: 'sc4', patientName: 'Baby Leo S', dailyNo: 34, dailyNoDay: today,
    testName: 'Stool Culture', departmentName: 'Microbiology', specimen: 'Stool', stages: [cstage('Gram / Direct smear', 'done'), cstage('Growth', 'done')] },
];

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
      case '/api/microbiology/culture-queue': return ok(CULTURES);
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
    test.skip(belowGrid(), 'below 1024px this list is the shared pf-work-list — covered by small-screens.screens.spec.ts');
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
        // No Tests column; the band's sort picker is gone (headers sort); the head is title + count only (owner 2026-11-21).
        await expect(page.locator('[data-testid="mw-grid"] .ag-header-cell[col-id="tests"]')).toHaveCount(0);
        await expect(page.locator('pf-hero-band pf-lab-sort')).toHaveCount(0);
        const head = await visible(page, '.pf-mw-pane__hdr--tabs').boundingBox();
        expect(head!.height, 'card head stays one row').toBeLessThan(72);
        await expect(page.locator('[data-testid="mw-find"], [data-testid="mw-pill"], [data-testid="mw-filter-btn"]').locator('visible=true')).toHaveCount(0);
        // The BAND search narrows the list and the count says so.
        await visible(page, 'pf-hero-band input').fill('Arya');
        await expect(page.locator('[data-testid="mw-grid"] .ag-row.mwg-row').locator('visible=true')).toHaveCount(1);
        await shot(page, `mywork-search-${mode}`);
        await visible(page, 'pf-hero-band input').fill('');
        // Header (column) filters like Test Master: the Status set filter narrows the rows; the icon is a 44px target on touch.
        const fbtn = visible(page, '[data-testid="mw-grid"] .ag-header-cell[col-id="status"] .ag-header-cell-filter-button');
        if (await fbtn.count()) {
          await fbtn.click();
          await expect(visible(page, '.ag-filter pf-work-set-filter, .ag-popup pf-work-set-filter')).toBeVisible();
          await shot(page, `mywork-colfilter-${mode}`);
          await visible(page, 'pf-work-set-filter [data-value="Draft"]').click();   // filter value = the status word
          await expect(page.locator('[data-testid="mw-grid"] .ag-row.mwg-row:not(.ag-opacity-zero)').locator('visible=true')).toHaveCount(1);
          await expect(visible(page, '[data-testid="mw-grid"] .ag-header-cell[col-id="status"]')).toHaveClass(/ag-header-cell-filtered/);
          await visible(page, 'pf-work-set-filter .wsf__clear').click();
          await page.keyboard.press('Escape');
        }
        // Due (time left to TAT) instead of a journey ring (owner 2026-11-21): rose once late, never folded away.
        await expect(page.locator('[data-testid="mw-grid"] pf-journey-ring')).toHaveCount(0);
        await expect(visible(page, '[data-testid="mw-grid"] .ag-header-cell[col-id="due"]')).toBeVisible();
        await expect(visible(page, '[data-testid="mw-grid"] .mwg-due.wg-tat--late')).toHaveText(/late$/);
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
    test.skip(belowGrid(), 'below 1024px this list is the shared pf-work-list — covered by small-screens.screens.spec.ts');
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

  test(`My Work — Culture tab on the same grid (${mode})`, async ({ page }) => {
    test.skip(belowGrid(), 'below 1024px this list is the shared pf-work-list — covered by small-screens.screens.spec.ts');
    await go(page, '/lab/my-work');
    await theme(page, dark);
    await page.getByText('Ms. Arya Stark').locator('visible=true').first().waitFor({ timeout: 60_000 }).catch(() => undefined);
    if (isPhone()) await labTab(page, 'Culture bench');
    else await visible(page, '.pf-mw-seg [data-tab="culture"], .pf-mw-seg [role="radio"]:has-text("Culture")').click();
    await page.getByText('MICRO26001').locator('visible=true').first().waitFor({ timeout: 60_000 }).catch(() => undefined);
    await settle(page);
    await shot(page, `mywork-culture-${mode}`);
    if (SHOTS_ONLY) return;
    await expectNoHorizontalScroll(page);
    if (!isPhone()) {
      await expect(visible(page, '[data-testid="cg-grid"] .ag-row')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-testid="cg-grid"] .ag-row.cg-row').locator('visible=true')).toHaveCount(4);
      // The patient line matches My Work ("34/F · AA0031"); MICRO26004 (older API shape, no patient) falls back to its specimen.
      await expect(visible(page, '[data-testid="cg-grid"] .ag-row:has-text("Mrs. Shanthi M") .wg-who__meta').first()).toHaveText('34/F · AA0031');
      await expect(visible(page, '[data-testid="cg-grid"] .ag-row:has-text("Baby Leo S") .wg-who__meta').first()).toHaveText('Stool');
      expect(await touchAudit(page, '.pf-mw-pane', '[data-testid="cg-grid"] .ag-row button')).toEqual([]);
      if (isTouch()) expect(await visible(page, '[data-testid="cg-grid"] .ag-row').evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(63.5);
      // The read-due case is rose; the BAND search narrows (no head search any more, owner 2026-11-21).
      await expect(visible(page, '[data-testid="cg-grid"] .ag-row.wg-row--urgent')).toBeVisible();
      await expect(page.locator('[data-testid="cg-find"]').locator('visible=true')).toHaveCount(0);
      await visible(page, 'pf-hero-band input').fill('Shanthi');
      await expect(page.locator('[data-testid="cg-grid"] .ag-row.cg-row:not(.ag-opacity-zero)').locator('visible=true')).toHaveCount(1);
      await visible(page, 'pf-hero-band input').fill('');
      await page.mouse.click(4, 4);
      // Due = the next read: "in 1h 30m" while incubating, rose "40m late" once the read is due.
      await expect(page.locator('[data-testid="cg-grid"] pf-journey-ring')).toHaveCount(0);
      await expect(visible(page, '[data-testid="cg-grid"] .cg-due.wg-tat--late')).toHaveText(/late$/);
      await expect(visible(page, '[data-testid="cg-grid"] .cg-due:not(.wg-tat--late)')).toHaveText(/^in /);
    } else {
      await expect(visible(page, '[data-testid="cg-cards"]')).toBeVisible({ timeout: 20_000 });
      expect(await touchAudit(page, '.pf-mw-pane', '[data-testid="cg-cards"] button')).toEqual([]);
    }
  });

  test(`Pathologist queue (${mode})`, async ({ page }) => {
    test.skip(belowGrid(), 'below 1024px this list is the shared pf-work-list — covered by small-screens.screens.spec.ts');
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
        // Rebalanced at every width: the status word (line 1 of the two lines, design D) stays on one line, the entered
        // time is never clipped; filter icons are spaced.
        const lay = await page.evaluate(() => {
          const out: string[] = [];
          for (const p of Array.from(document.querySelectorAll<HTMLElement>('[data-testid="pv-grid"] .ag-row .pv-status .pf-sw__now'))) {
            const lh = parseFloat(getComputedStyle(p).lineHeight) || 20;
            if (p.getBoundingClientRect().height > lh * 1.6 + 6) out.push(`wraps: ${p.textContent?.trim()}`);
          }
          for (const p of Array.from(document.querySelectorAll<HTMLElement>('[data-testid="pv-grid"] .pv-wait-sub'))) {
            if (p.scrollWidth > p.clientWidth + 1) out.push(`clipped: ${p.textContent?.trim()}`);
          }
          return out;
        });
        expect(lay).toEqual([]);
        // Due instead of a journey ring — shown at EVERY width (tablet portrait included): rose "Nm late" when past TAT.
        await expect(page.locator('[data-testid="pv-grid"] pf-journey-ring')).toHaveCount(0);
        await expect(visible(page, '[data-testid="pv-grid"] .ag-header-cell[col-id="due"]')).toBeVisible();
        await expect(visible(page, '[data-testid="pv-grid"] .pv-due.wg-tat--late')).toHaveText(/late$/);
        await expect(visible(page, '[data-testid="pv-grid"] .pv-due:not(.wg-tat--late)')).toHaveText(/^in /);
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

  test(`no work grid scrolls sideways — card widths 520 · 600 · 720 · 900 · 1200 (${mode})`, async ({ page }) => {
    test.skip(isPhone() || isTouch(), 'card widths are set on the desktop layout');
    /** Pin a card to a width, let the grid re-tier, then measure: no horizontal overflow, nothing outside the card. */
    const measure = async (cardSel: string, gridSel: string, w: number) => {
      await page.evaluate(([sel, w]) => {
        const el = document.querySelector<HTMLElement>(sel as string)!;
        // The work pane's own rules use !important (pf-mw-pane--solo), so the pin must too.
        for (const [k, v] of [['flex', `0 0 ${w}px`], ['width', `${w}px`], ['max-width', `${w}px`], ['min-width', `${w}px`], ['justify-self', 'start']])
          el.style.setProperty(k, v, 'important');
      }, [cardSel, w] as const);
      // The grid re-tiers its columns after the resize (ResizeObserver → column fit): wait for the FINAL layout —
      // read again until it is clean, up to 8s (slow engines under load need more than one 700ms beat). A real
      // overflow stays and fails with its list.
      await page.waitForTimeout(700);
      let found: string[] = [];
      for (const t0 = Date.now(); ; await page.waitForTimeout(250)) {
        found = await read(cardSel, gridSel, w);
        if (!found.length || Date.now() - t0 > 8000) return found;
      }
    };
    const read = (cardSel: string, gridSel: string, w: number) => page.evaluate(([cardSel, gridSel, w]) => {
        const out: string[] = [];
        const card = document.querySelector<HTMLElement>(cardSel as string)!.getBoundingClientRect();
        if (Math.abs(card.width - (w as number)) > 2) out.push(`card is ${Math.round(card.width)}px, not ${w}px`);
        for (const vp of Array.from(document.querySelectorAll<HTMLElement>(`${gridSel} .ag-center-cols-viewport, ${gridSel} .ag-body-viewport`))) {
          if (vp.getBoundingClientRect().width === 0) continue;
          if (vp.scrollWidth > vp.clientWidth + 1) out.push(`grid scrolls sideways by ${vp.scrollWidth - vp.clientWidth}px`);
        }
        for (const b of Array.from(document.querySelectorAll<HTMLElement>(`${gridSel} .ag-row button, ${gridSel} .ag-row .wg-pill`))) {
          const r = b.getBoundingClientRect();
          if (r.width && (r.right > card.right + 0.5 || r.left < card.left - 0.5)) out.push(`${b.getAttribute('aria-label') || b.textContent?.trim()} clipped`);
        }
        return out;
      }, [cardSel, gridSel, w] as const);
    const widths = [520, 600, 720, 900, 1200];
    // My Work (sample focus is the widest plan).
    focus = 'sample';
    await go(page, '/lab/my-work');
    await theme(page, dark);
    await expect(visible(page, '[data-testid="mw-grid"] .ag-row')).toBeVisible({ timeout: 60_000 });
    for (const w of widths) {
      expect(await measure('.pf-mw-pane:has(> .pf-mw-pane__hdr--tabs)', '[data-testid="mw-grid"]', w), `My Work at ${w}px`).toEqual([]);
      if (w === 520) await shot(page, `nosideways-mywork-520-${mode}`);
    }
    // Culture (same pane).
    await visible(page, '.pf-mw-seg [data-tab="culture"], .pf-mw-seg [role="radio"]:has-text("Culture")').click();
    await expect(visible(page, '[data-testid="cg-grid"] .ag-row')).toBeVisible({ timeout: 30_000 });
    for (const w of widths) {
      expect(await measure('.pf-mw-pane:has(> .pf-mw-pane__hdr--tabs)', '[data-testid="cg-grid"]', w), `Culture at ${w}px`).toEqual([]);
      if (w === 520) await shot(page, `nosideways-culture-520-${mode}`);
    }
    // Pathologist.
    await go(page, '/pathologist');
    await theme(page, dark);
    await expect(visible(page, '[data-testid="pv-grid"] .ag-row')).toBeVisible({ timeout: 60_000 });
    for (const w of widths) {
      expect(await measure('.pv-queue', '[data-testid="pv-grid"]', w), `Pathologist at ${w}px`).toEqual([]);
      if (w === 520) await shot(page, `nosideways-pathologist-520-${mode}`);
    }
  });
}
