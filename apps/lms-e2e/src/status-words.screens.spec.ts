import type { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect, isPhone, projectName } from './support/form-factor';
import { resetNeg, installNegBackend, go, neg, visible, ME } from './support/neg-backend';
import { deskAllStatuses } from './support/frontdesk';

/**
 * Status words + one search per screen (owner design D, 2026-11-21) — API mocked, fake data only.
 *  - NO pill / dot / status tag inside any grid cell (Frontdesk WORK, My Work, Culture, Pathologist, Results);
 *    each status cell is `<pf-status-words>`: line 1 now, line 2 detail;
 *  - Frontdesk "Where now" = the journey ring + two lines (the Journey column is gone; the ring still opens the
 *    journey view);
 *  - the BAND search filters the list live; Enter still opens; the card-head search box is gone; My Work's head is
 *    title + count (no status pills, no Filters button — the Department column filters).
 * Screenshots: SHOTS_DIR/<project>/status-words-*.png (light + dark).
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/status-words');

const now = Date.now();
const ago = (m: number) => new Date(now - m * 60000).toISOString();
const today = ago(0).slice(0, 10);
const LONG = 'Ms. Meenakshi Sundareswaran Ramanathan Iyer';

/** Old pill / dot / tag markup that must never be inside a grid cell again. */
const PILL = '.wg-pill, .wg-dot, .wg-tag, .fd-flow__stage, .fd-flow__dot, .pf-rq2-pill, .pf-sg-pill, .pv-status__dot';

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────────────────
const pat = (n: number, name: string, age = 34, sex = 'Female') =>
  ({ id: `p${n}`, displayName: name, firstName: name.split(' ')[1] ?? name, age, sex, gender: sex[0], mrn: `AA00${String(n).padStart(2, '0')}`, phone: '+919876543210' });
const smp = (id: string, orderId: string, status: string) => ({
  id, orderId, status, barcode: `B-${id}`, tubeColor: 'grey', rejectionCount: 0, departmentId: 'd1', department: { id: 'd1', name: 'Biochemistry', code: 'BIO' },
  collectedAt: status === 'pending' ? null : ago(30), createdAt: ago(60),
  tests: [{ id: `${id}-t`, subOrderId: id, testId: 'y', name: 'Glucose', status: status === 'received' ? 'validated' : 'pending', test: { name: 'Glucose' } }],
});
const ord = (n: number, name: string, status: string, tubes: string[], stage = 10) => ({
  id: `o${n}`, orderNumber: `LAB-2611-0000${n}`, dailyNo: n, dailyNoDay: today, patientId: `p${n}`, branchId: 'b1', patient: pat(n, name),
  module: 'lab', priority: 'Normal', source: 'walkin', collectionType: 'walkin', status, createdAt: ago(90), updatedAt: ago(stage),
  samples: tubes.map((s, i) => smp(`o${n}s${i}`, `o${n}`, s)),
});
const FD_ORDERS = [
  ord(1, LONG, 'billed', ['pending', 'pending'], 42),
  ord(2, 'Ms. Arya Stark', 'created', ['pending'], 12),
  ord(3, 'Mr. Sathish Kumar', 'sample_collected', ['collected'], 22),
  ord(4, 'Nithin Ragav Gopalakrishnan', 'billed', ['received'], 41),
  ord(5, 'Master Sasi Kumar', 'validated', ['received'], 5),
];

const HAE = { id: 'hae', name: 'Haematology', code: 'HAE' };
const BIO = { id: 'bio', name: 'Biochemistry', code: 'BIO' };
const lorder = (n: number, name: string, priority = 'Normal') =>
  ({ id: `ord-${n}`, orderNumber: `LAB-2611-0001${n}`, dailyNo: n, dailyNoDay: today, priority, patient: pat(n, name) });
type Line = Record<string, unknown>;
const line = (id: string, test: string, dept: typeof HAE, s: { id: string; barcode: string; rec: number }, o: ReturnType<typeof lorder>, extra: Line = {}): Line => ({
  id, status: 'pending', assignedTo: ME.id,
  test: { id: `t-${id}`, name: test, tatHours: 2, departmentId: dept.id, department: dept },
  subOrder: { id: s.id, barcode: s.barcode, receivedAtLab: ago(s.rec), departmentId: dept.id, department: dept, order: o },
  ...extra,
});
const S = (id: string, barcode: string, rec: number) => ({ id, barcode, rec });
const MY_WORK: Line[] = [
  line('l1', 'Complete Blood Count', HAE, S('s1', '0126101', 40), lorder(3, 'Ms. Arya Stark', 'Urgent')),
  line('l3', 'Liver Function Test', BIO, S('s2', '0126102', 150), lorder(7, LONG), { status: 'in_progress', currentResult: '{"values":{"alt":"40"}}' }),
  line('l5', 'Lipid Profile', BIO, S('s3', '0126103', 30), lorder(11, 'Mr. Prem Kumar K'), { status: 're_entry', rejectionReason: 'Sample looks haemolysed — please re-run' }),
  line('l6', 'HbA1c', BIO, S('s4', '0126104', 20), lorder(12, 'Baby Leo S')),
];
const PV: Line[] = [
  line('v1', 'Complete Blood Count', HAE, S('s21', '0126117', 50), lorder(21, LONG), { status: 'entered', assignedTo: null, resultedAt: ago(12), currentResult: '{"flags":{"critical":true}}' }),
  line('v4', 'Liver Function Test', BIO, S('s23', '0126118', 200), lorder(23, 'Mr. Prem Kumar K'), { status: 'entered', assignedTo: null, resultedAt: ago(90) }),
  line('v5', 'Thyroid profile', BIO, S('s24', '0126119', 40), lorder(24, 'Baby Leo S'), { status: 'entered', assignedTo: null, resultedAt: ago(5) }),
];
const CRIT = [{ id: 'cr1', status: 'open', source: 'live', orderTestId: 'v1', orderId: 'ord-21', resultVersion: 1, patientId: 'p21', patientName: LONG, testId: 't-v1',
  testName: 'Complete Blood Count', summary: 'Hb 5.1 g/dL CL', values: [], detectedAt: ago(10), alertedCount: 1, acknowledgements: [] }];
const cstage = (label: string, state: string, extra: Record<string, unknown> = {}) => ({ key: label.toLowerCase(), label, state, ...extra });
const CULTURES = [
  { orderTestId: 'cu1', caseState: 'in_progress', createdAt: ago(26 * 60), patient: { age: 34, sex: 'Female', mrn: 'AA0031' }, barcode: 'MICRO26001', sampleId: 'sc1', patientName: 'Mrs. Shanthi M',
    dailyNo: 31, dailyNoDay: today, testName: 'Bacterial Culture & Sensitivity', departmentName: 'Microbiology', specimen: 'Urine',
    stages: [cstage('Gram / Direct smear', 'done'), cstage('Growth', 'open', { incubateUntil: ago(-90) }), cstage('AST', 'open')] },
  { orderTestId: 'cu2', caseState: 'in_progress', createdAt: ago(50 * 60), patient: { age: 62, sex: 'Female', mrn: 'AA0007' }, barcode: 'MICRO26002', sampleId: 'sc2', patientName: LONG,
    dailyNo: 32, dailyNoDay: today, testName: 'Blood Culture', departmentName: 'Microbiology', specimen: 'Blood',
    stages: [cstage('Gram / Direct smear', 'done'), cstage('Growth', 'open', { incubateUntil: ago(40) })] },
];
const rep = (n: number, name: string, deliveryStatus: string, extra: Record<string, unknown> = {}) => ({
  id: `rq-${n}`, orderId: `ord-${n}`, patientId: `p${n}`, type: 'final', status: 'generated', deliveryStatus, qrToken: `tok-${n}`, createdAt: ago(10 + n * 9),
  order: { id: `ord-${n}`, orderNumber: `LAB-2611-0002${n}`, dailyNo: n, dailyNoDay: today, patient: pat(n, name) }, ...extra,
});
const REPORTS = [
  rep(1, 'Ms. Meera Iyer', 'pending'),
  rep(2, 'Mr. Prem Kumar K', 'delivered', { deliveredVia: 'whatsapp' }),
  rep(3, 'Nithin Ragav G', 'failed', { deliveryNote: 'WhatsApp number invalid' }),
  rep(4, 'Ms. Arya Stark', 'pending', { type: 'partial' }),
];

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(240_000);
  resetNeg();
  neg.bills = [{ orderId: 'o4', balance: 450 }];
  neg.hook = r => {
    if (r.method !== 'GET') return undefined;
    const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
    switch (r.path) {
      case '/api/orders/today': case '/api/orders/range': return ok(FD_ORDERS);
      case '/api/results/my-work': return ok(MY_WORK);
      case '/api/results/service-queue': return ok([]);
      case '/api/results/completed': return ok([]);
      case '/api/validation/queue': return ok(PV);
      case '/api/validation/scope': return ok({ scoped: true, departments: [HAE, BIO], validatedToday: 4, validatedTodayByMe: 2 });
      case '/api/critical-results/lookup': return ok(CRIT);
      case '/api/tenants/branch-lab-config': return ok({ effectiveQueueFocus: 'sample', queueFocus: 'sample' });
      case '/api/microbiology/culture-queue': return ok(CULTURES);
      case '/api/orders/partial-ready': return ok([]);
      default: return undefined;
    }
  };
  await installNegBackend(page, context);
  // The Results queue needs its query string (status tab): a route registered after the backend's runs first.
  await page.route(/prefrontal\.health\/api\/reports\/queue/, async route => {
    const origin = route.request().headers()['origin'] ?? 'http://127.0.0.1';
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const status = new URL(route.request().url()).searchParams.get('status') ?? 'all';
    const items = REPORTS.filter(r => status === 'all' || r.deliveryStatus === status);
    const n = (k: string) => REPORTS.filter(r => r.deliveryStatus === k).length;
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ success: true,
      data: { items, total: items.length, page: 1, pageSize: 50, hasMore: false, counts: { all: REPORTS.length, pending: n('pending'), delivered: n('delivered'), failed: n('failed') } } }) });
  });
});

const wide = (page: Page) => !isPhone() && (page.viewportSize()?.width ?? 0) >= 1024;
async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
  await page.waitForTimeout(1100);   // ThemeService's view transition
}
async function shots(page: Page, name: string) {
  const OUT = path.join(OUT_BASE, projectName()); fs.mkdirSync(OUT, { recursive: true });
  for (const dark of [false, true]) {
    await theme(page, dark);
    await page.screenshot({ path: `${OUT}/status-words-${name}-${dark ? 'dark' : 'light'}.png` });
  }
  await theme(page, false);
}

/** No old pill / dot / tag inside any cell of the grids matched by `grid`; status cells are words. */
async function expectWordsNoPills(page: Page, grid: string, minWords = 1) {
  const r = await page.evaluate(([grid, pill]) => {
    const cells = Array.from(document.querySelectorAll<HTMLElement>(`${grid} .ag-cell, ${grid} .ag-full-width-row`)).filter(c => c.getBoundingClientRect().width > 0);
    const pills = cells.flatMap(c => Array.from(c.querySelectorAll<HTMLElement>(pill)).map(p => `${c.getAttribute('col-id')}: ${p.className} "${(p.textContent ?? '').trim().slice(0, 30)}"`));
    const words = cells.reduce((n, c) => n + c.querySelectorAll('pf-status-words .pf-sw__now').length, 0);
    return { cells: cells.length, pills, words };
  }, [grid, PILL] as const);
  expect(r.cells, `${grid}: cells on screen`).toBeGreaterThan(0);
  expect(r.pills, `${grid}: no pill inside a grid cell (${projectName()})`).toEqual([]);
  expect(r.words, `${grid}: status words drawn`).toBeGreaterThanOrEqual(minWords);
}
/** Headers never truncate: each header label's text fits its box. */
async function expectHeadersWhole(page: Page, grid: string) {
  const cut = await page.evaluate(g => Array.from(document.querySelectorAll<HTMLElement>(`${g} .ag-header-cell-text`))
    .filter(e => e.getBoundingClientRect().width > 0 && e.scrollWidth > e.clientWidth + 1).map(e => e.textContent ?? ''), grid);
  expect(cut, `${grid}: header text cut`).toEqual([]);
}

test('Frontdesk WORK: Where now = ring + two lines, no Journey column, no pill; band search filters; no card search', async ({ page }) => {
  await go(page, '/frontdesk');
  await page.getByPlaceholder(/Search patient/).locator('visible=true').first().waitFor({ timeout: 60_000 });
  await deskAllStatuses(page);
  await expect(page.locator('input[placeholder="Search this list"]').locator('visible=true')).toHaveCount(0);
  if (!wide(page)) { await shots(page, 'frontdesk'); return; }
  await expect(page.locator('.pf-fd-flow .ag-row').locator('visible=true').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(600);
  await expect(page.locator('.pf-fd-flow .ag-header-cell[col-id="journey"]')).toHaveCount(0);
  await expect(visible(page, '.pf-fd-flow .ag-header-cell[col-id="where"]')).toContainText('Where now');
  const where = page.locator('.pf-fd-flow .ag-row[row-id="o1"] .ag-cell[col-id="where"]').first();
  await expect(where.locator('pf-journey-ring')).toHaveCount(1);
  await expect(where.locator('.pf-sw__now')).toHaveText(/\S/);
  await expect(where.locator('.pf-sw__detail')).toHaveText(/\S/);
  // Late row (42 min at its stage) → line 1 is the rose tone; a finished report → green.
  await expect(where.locator('pf-status-words')).toHaveAttribute('data-tone', 'late');
  await expect(page.locator('.pf-fd-flow .ag-row[row-id="o5"] .ag-cell[col-id="where"] pf-status-words').first()).toHaveAttribute('data-tone', 'done');
  await expectWordsNoPills(page, '.pf-fd-flow', 3);
  await expectHeadersWhole(page, '.pf-fd-flow');
  await shots(page, 'frontdesk');
  // The ring still opens the journey view.
  await where.locator('.pf-jring__btn').click();
  const dlg = page.locator('pf-journey-overlay [role="dialog"][aria-modal="true"]');
  await expect(dlg).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  // ONE search: the band filters the list live.
  const band = visible(page, 'pf-hero-band pf-patient-search input');
  await band.fill('Arya');
  await expect(page.locator('.pf-fd-flow .ag-row').locator('visible=true')).toHaveCount(1);
  await expect(visible(page, '.pf-fd-flow .ag-row')).toContainText('Ms. Arya Stark');
  await band.fill('');
  await expect.poll(() => page.locator('.pf-fd-flow .ag-row').locator('visible=true').count()).toBeGreaterThan(1);
});

test('Lab My Work: words, no Draft / Re-entry tags, head = title + count, Department column; band filters + Enter opens', async ({ page }) => {
  test.skip(['phone', 'tablet'].includes(projectName()), 'below 1024px this list is the shared pf-work-list — covered by small-screens.screens.spec.ts');
  await go(page, '/lab/my-work');
  await page.getByText('Ms. Arya Stark').locator('visible=true').first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  if (isPhone()) { await shots(page, 'mywork'); return; }
  await expect(page.locator('[data-testid="mw-find"], [data-testid="mw-pill"], [data-testid="mw-filter-btn"]').locator('visible=true')).toHaveCount(0);
  await expect(page.locator('.pf-mw-pane__hdr--tabs input[type="search"]').locator('visible=true')).toHaveCount(0);
  await expectWordsNoPills(page, '[data-testid="mw-grid"]', 3);
  await expect(page.locator('[data-testid="mw-grid"] .wg-tag')).toHaveCount(0);
  const re = page.locator('[data-testid="mw-grid"] .ag-row').filter({ hasText: 'Mr. Prem Kumar K' }).locator('pf-status-words').first();
  await expect(re).toHaveAttribute('data-tone', 'late');
  await expect(re.locator('.pf-sw__now')).toHaveText('Re-entry');
  if ((await page.locator('[data-testid="mw-grid"] .ag-header-cell[col-id="dept"]').locator('visible=true').count()) === 0) {
    test.info().annotations.push({ type: 'fold', description: 'Department folds into the patient line on this width' });
  }
  await expectHeadersWhole(page, '[data-testid="mw-grid"]');
  await shots(page, 'mywork');
  // The band search filters the list…
  const band = visible(page, 'pf-hero-band input');
  await band.fill('Arya');
  await expect(page.locator('[data-testid="mw-grid"] .ag-row.mwg-row').locator('visible=true')).toHaveCount(1);
  await shots(page, 'mywork-search');
  // …and Enter still opens the sample.
  await band.fill('0126101');
  await band.press('Enter');
  await expect(page).toHaveURL(/\/lab\/(sample|result|entry)/, { timeout: 20_000 });
});

test('Culture tab: Next step in words (rose when the read is due), no pills, no head search', async ({ page }) => {
  test.skip(['phone', 'tablet'].includes(projectName()), 'below 1024px this list is the shared pf-work-list — covered by small-screens.screens.spec.ts');
  await go(page, '/lab/my-work');
  await page.getByText('Ms. Arya Stark').locator('visible=true').first().waitFor({ timeout: 60_000 });
  if (isPhone()) return;
  const tab = page.locator('[role="radio"]:has-text("Culture")').locator('visible=true').first();
  if (!(await tab.count())) { test.info().annotations.push({ type: 'skip', description: 'no culture tab here' }); return; }
  await tab.click();
  await expect(visible(page, '[data-testid="cg-grid"] .ag-row')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(600);
  await expect(page.locator('[data-testid="cg-find"], [data-testid="cg-pill"]').locator('visible=true')).toHaveCount(0);
  await expectWordsNoPills(page, '[data-testid="cg-grid"]', 2);
  await expect(page.locator('[data-testid="cg-grid"] .ag-row').filter({ hasText: 'MICRO26002' }).locator('pf-status-words').first()).toHaveAttribute('data-tone', 'late');
  await shots(page, 'culture');
});

test('Pathologist: Critical / Not acknowledged in words, Department column, no pills', async ({ page }) => {
  test.skip(['phone', 'tablet'].includes(projectName()), 'below 1024px this list is the shared pf-work-list — covered by small-screens.screens.spec.ts');
  await go(page, '/pathologist');
  await page.getByText(LONG).locator('visible=true').first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  if (isPhone()) { await shots(page, 'pathologist'); return; }
  await expectWordsNoPills(page, '[data-testid="pv-grid"]', 1);
  await expect(page.locator('.pv-queue__head pf-segmented.pv-depts').locator('visible=true')).toHaveCount(0);
  const crit = page.locator('[data-testid="pv-grid"] pf-status-words').filter({ hasText: 'Critical' }).first();
  if (await crit.count()) {
    await expect(crit).toHaveAttribute('data-tone', 'late');
    await expect(crit.locator('.pf-sw__detail')).toHaveText('Not acknowledged');
  }
  await expectHeadersWhole(page, '[data-testid="pv-grid"]');
  await shots(page, 'pathologist');
});

test('Results: Ready / Not sent yet · Delivered / how · Failed / reason — words, no pill', async ({ page }) => {
  test.skip(['phone', 'tablet'].includes(projectName()), 'below 1024px this list is the shared pf-work-list — covered by small-screens.screens.spec.ts');
  await go(page, '/reports');
  await page.getByText('Ms. Meera Iyer').locator('visible=true').first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  if (isPhone()) {
    await expect(page.locator('.pf-rq2-list .pf-rq2-pill')).toHaveCount(0);
    await shots(page, 'results');
    return;
  }
  // The list opens on Ready: Ready / Not sent yet in normal text.
  await expectWordsNoPills(page, '.pf-rq2-grid', 1);
  const ready = page.locator('.pf-rq2-grid .ag-row').filter({ hasText: 'Ms. Meera Iyer' }).locator('pf-status-words').first();
  await expect(ready).toHaveAttribute('data-tone', 'normal');
  await expect(ready.locator('.pf-sw__detail')).toHaveText('Not sent yet');
  // Delivered (soft green) through the Filters card's Status rows.
  const delivered = page.locator('[data-testid="rq-filters"] , .pf-rq2-f').getByText('Delivered', { exact: true }).locator('visible=true').first();
  if (await delivered.count()) {
    await delivered.click();
    const dw = page.locator('.pf-rq2-grid .ag-row').filter({ hasText: 'Mr. Prem Kumar K' }).locator('pf-status-words').first();
    await expect(dw).toHaveAttribute('data-tone', 'done');
    await expect(dw.locator('.pf-sw__now')).toHaveText('Delivered');
    await expectWordsNoPills(page, '.pf-rq2-grid', 1);
  }
  await expectHeadersWhole(page, '.pf-rq2-grid');
  await shots(page, 'results');
});
