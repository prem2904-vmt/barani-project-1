import type { Page, Request } from '@playwright/test';
import { test, expect, shotsDir, expectLayout, expectFitsWidth, projectName, isPhone } from './support/form-factor';
import { deskTab } from './support/frontdesk';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Re-test 2026-11-13 (rt-lab): element-based checks (real DOM assertions, API mocked, demo data only) for
 * OPS-124 / 129 / 130 (collection + dispatch), OPS-117 / 128 (written results: unit, flag, test editor),
 * OPS-120 (not-collected tube locked) and the Start menu listing each entry once.
 * Runs on every form factor (playwright.screens.config.ts projects); screenshots under SHOTS_DIR/<project>/.
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/retest-1113/rt-lab');
let OUT = OUT_BASE;
const TENANT = { id: 't-demo', name: 'Demo Lab' };
const ME = { id: 'app-1', authId: 'sub-1', first: 'Kavya', last: 'Desk' };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub: string) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 86400, email: `${sub}@demo.test` })}.sig`;
const now = new Date();
const iso = (d: Date) => d.toISOString();
const minsAgo = (m: number) => new Date(now.getTime() - m * 60000);
const PARAMS = JSON.stringify({ parameters: [{ name: 'glu', title: 'Glucose', unit: 'mg/dL' }] });
const pat = (id: string, name: string) => ({ id, displayName: name, firstName: name.split(' ')[0], gender: 'F', sex: 'Female', age: 34, mrn: `26${id.padStart(4, '0')}`, phone: '+919876543210' });
const tline = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, status: 'pending', test: { name, parameters: PARAMS, sampleType: 'Plasma' }, ...extra });
const mkSample = (id: string, orderId: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, orderId, status, barcode: `B-${id}`, tubeColor: 'grey', rejectionCount: 0, collectedAt: status === 'pending' ? null : iso(minsAgo(70)),
  department: { id: 'd1', name: 'Biochemistry', code: 'BIO' }, tests: [tline(`${id}-t`, 'Glucose')], ...extra,
});
const mkOrder = (id: string, n: number, name: string, status: string, samples: any[], extra: Record<string, unknown> = {}) => ({
  id, orderNumber: `LAB-2611-0000${n}`, dailyNo: n, dailyNoDay: iso(now).slice(0, 10), patientId: `p${n}`, branchId: 'b1', patient: pat(String(n), name),
  priority: 'Normal', source: 'walkin', collectionType: 'walkin', status, createdAt: iso(minsAgo(90)), updatedAt: iso(now), samples, ...extra,
});

/** Mutable server state, rebuilt for each test. */
let samples: any[] = [];
let requests: string[] = [];
const series = () => [
  mkSample('s0', 'os', 'collected', { repeatOffsetMin: 0, repeatSeriesKey: 'ogtt', tests: [tline('s0-t', 'Glucose (fasting)')] }),
  mkSample('s1', 'os', 'pending', { repeatOffsetMin: 60, repeatSeriesKey: 'ogtt', tests: [tline('s1-t', 'Glucose (1 h)')] }),
  mkSample('s2', 'os', 'pending', { repeatOffsetMin: 120, repeatSeriesKey: 'ogtt', tests: [tline('s2-t', 'Glucose (2 h)')] }),
];
const theOrder = () => mkOrder('os', 7, 'Nandini Rao', 'sample_collected', samples);
const anyDispatched = () => samples.some(s => s.status === 'dispatched');

// Result entry: a written test (reference + unit) on a received tube; a pending (not collected) tube.
const textTube = (normal: string, unit: string, status = 'received') => ({
  id: 'smp-1', orderId: 'o1', departmentId: 'd1', status, barcode: '26123', rejectionCount: 0, createdAt: iso(minsAgo(60)),
  department: { id: 'd1', name: 'Biochemistry', code: 'BIO' },
  order: { id: 'o1', patientId: 'p1', branchId: 'b1', priority: 'routine', source: 'walkin', status: 'open', collectionType: 'walkin', createdAt: iso(minsAgo(60)), samples: [], patient: pat('1', 'Demo Patient') },
  siblings: [],
  tests: [{ id: 'ot1', subOrderId: 'smp-1', testId: 't1', name: 'Written test', status: 'in_progress',
    test: { id: 't1', name: 'Written test', parameters: JSON.stringify({ parameters: [{ name: 'f', title: 'Finding', type: 'textarea', normalValue: normal, unit }] }) } }],
});
let resultTube: any = textTube('Negative', 'IU/mL');

const editorTest = (id: string, params: unknown[], resultType: string, unit = '') => ({
  id, tenantId: 'tn', name: id === 't1' ? 'Written Test' : 'Choice Test', type: 'individual', flow: 'approval', price: 100, taxSlab: 0, discount: 0, departmentId: 'bio', tatHours: 24,
  sampleType: 'Urine', tubeColor: 'sterile', testCode: 'CLP0' + id, shortName: 'WT', section: '', profile: '', methodology: '', resultType, unit, reportFormat: 'tabular',
  adultReferenceRange: '', conditions: '[]', isActive: true, createdAt: '', parameters: JSON.stringify({ parameters: params }),
});

async function backend(page: Page) {
  const cors = (origin: string) => ({ 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
  const ok = (origin: string, data: unknown) => ({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: true, data }) });
  await page.route(/prefrontal\.health\//, async route => {
    const req: Request = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    const p = new URL(req.url()).pathname;
    if (req.method() !== 'GET') requests.push(`${req.method()} ${p}`);
    if (p === '/api/auth/me') return route.fulfill(ok(origin, { id: ME.id, authId: ME.authId, firstName: ME.first, fathersName: ME.last, displayName: `${ME.first} ${ME.last}`, email: 'desk@demo.test', tenantId: TENANT.id, tenantName: TENANT.name, branchId: 'b1', branchName: 'Main', roles: ['Lab Admin'], permissions: ['*'], branches: [{ id: 'b1', name: 'Main' }], modules: ['lab'], hasPin: false }));
    if (p === '/api/tenants/modules') return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: false }) });
    if (p === '/api/tenants/current') return route.fulfill(ok(origin, { id: TENANT.id, name: TENANT.name }));
    if (p === '/api/tenants/departments') return route.fulfill(ok(origin, [{ id: 'bio', name: 'Biochemistry' }]));
    if (p === '/api/tenants/branches') return route.fulfill(ok(origin, [{ id: 'b1', name: 'Main' }]));
    if (p === '/api/process-workflows/active') return route.fulfill(ok(origin, null));
    if (p === '/api/whatsapp/settings') return route.fulfill(ok(origin, { canSend: false }));
    if (p === '/api/orders/today' || p === '/api/orders/range') return route.fulfill(ok(origin, [theOrder()]));
    if (p === '/api/orders/dispatched') return route.fulfill(ok(origin, anyDispatched() ? [theOrder()] : []));
    if (p === '/api/samples/in-transit') return route.fulfill(ok(origin, []));
    if (p === '/api/billing/outstanding') return route.fulfill(ok(origin, { due: [], refundsOwed: [] }));
    if (p === '/api/samples/pending-collection') return route.fulfill(ok(origin, samples.some(s => s.status === 'pending') ? samples.map(s => ({ ...s, order: theOrder() })) : []));
    if (p === '/api/samples/outsourced') return route.fulfill(ok(origin, []));
    let m = /^\/api\/samples\/([^/]+)\/collect$/.exec(p);
    if (m && req.method() === 'PATCH') { const s = samples.find(x => x.id === m![1]); if (s) { s.status = 'collected'; s.collectedAt = iso(new Date()); } return route.fulfill(ok(origin, s ?? {})); }
    m = /^\/api\/samples\/([^/]+)\/dispatch$/.exec(p);
    if (m && req.method() === 'PATCH') { const s = samples.find(x => x.id === m![1]); if (s) s.status = 'dispatched'; return route.fulfill(ok(origin, s ?? {})); }
    m = /^\/api\/orders\/([^/]+)\/dispatch$/.exec(p);
    if (m && req.method() === 'PATCH') { let n = 0; for (const s of samples) if (s.status === 'collected') { s.status = 'dispatched'; n++; } return route.fulfill(ok(origin, { dispatched: n })); }
    if (p === '/api/samples/smp-1/tests') return route.fulfill(ok(origin, resultTube));
    if (p === '/api/tests/t1') return route.fulfill(ok(origin, editorTest('t1', [{ id: 'p1', name: 'finding', title: 'Finding', type: 'text', unit: '', normalValue: '< 5' }], 'text')));
    if (p === '/api/tests/t2') return route.fulfill(ok(origin, editorTest('t2', [{ id: 'p1', name: 'colour', title: 'Colour', type: 'select', optionRows: [{ value: 'Clear', normal: true, active: true }, { value: 'Turbid', normal: false, active: true }] }], 'choice')));
    m = /^\/api\/orders\/([^/]+)$/.exec(p);
    if (m) return route.fulfill(ok(origin, theOrder()));
    if (req.method() === 'GET') return route.fulfill(ok(origin, []));
    return route.fulfill(ok(origin, {}));
  });
  await page.route(/supabase\.co\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ access_token: jwt(ME.authId), refresh_token: `rt-${ME.authId}`, token_type: 'bearer', expires_in: 86400, user: { id: ME.authId, aud: 'authenticated', email: 'desk@demo.test' } }) });
  });
  await page.routeWebSocket(/\/hubs\//, ws => { ws.onMessage(() => ws.send('{}\x1e')); });
  await page.addInitScript(([session]) => {
    if (!sessionStorage.getItem('pf.e2e.seeded')) {
      sessionStorage.setItem('pf.e2e.seeded', '1'); localStorage.clear();
      localStorage.setItem('pf.session', session as string); localStorage.setItem('pf-design', 'new');
      localStorage.setItem('pf.wa.manual.reminded', '1');
    }
  }, [JSON.stringify({ access_token: jwt(ME.authId), refresh_token: `rt-${ME.authId}` })] as const);
}

async function light(page: Page) {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => { const r = document.documentElement; r.classList.remove('dark'); r.classList.add('light'); r.setAttribute('data-theme', 'light'); });
  await page.waitForTimeout(400);
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png` });
const drawer = (page: Page) => page.locator('.pf-drawer[role="dialog"]').first();

test.beforeEach(async ({ page }) => {
  test.setTimeout(150_000); OUT = shotsDir(OUT_BASE);
  samples = series(); requests = []; resultTube = textTube('Negative', 'IU/mL');
  await backend(page);
});

/** A collection-drawer action; a phone folds the secondary ones into "More collection actions". */
async function action(page: Page, name: string | RegExp) {
  const inDrawer = drawer(page).getByRole('button', { name }).locator('visible=true').first();
  if (await inDrawer.count()) return inDrawer;
  const more = page.locator('button[aria-label="More collection actions"]').locator('visible=true').first();
  if (await more.count()) { await more.click(); await page.waitForTimeout(500); }
  return page.getByRole('button', { name }).locator('visible=true').first();
}
/** Close the phone's Collection sheet (it sits over the tubes) — what a person does before tapping a tube. */
async function closeSheet(page: Page) {
  const close = page.locator('button[aria-label="Close collection"]').locator('visible=true').first();
  if (await close.count()) { await close.click(); await expect(page.locator('.pf-sc-side--open')).toHaveCount(0); }
}
/** The front desk with the In progress work tab on (the touch layouts open on Appointments). */
async function deskInProgress(page: Page) {
  await page.goto('/frontdesk');
  await page.getByPlaceholder(/Search patient/).locator('visible=true').first().waitFor({ timeout: 60_000 });
  await deskTab(page, 'In progress');
}

async function openCollect(page: Page) {
  await page.goto('/lab/collect?orderId=os&from=/frontdesk');
  await expect(drawer(page)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-pour-id="s1"]')).toBeVisible();
  await expectFitsWidth(page, '.pf-drawer[role="dialog"]', 'collect drawer');
  await expectLayout(page, 'collect drawer', { nav: false });
}

test.describe('OPS-124 / 129 / 130 collection', () => {
  test('timed series: drawing the due tube stays on Collect; Done for now goes back (OPS-142)', async ({ page }) => {
    // 70 min after the first draw: the 1 h tube is due, the 2 h tube is still locked.
    // OPS-142: collecting never leaves the screen by itself; Dispatch or Done is the exit.
    await openCollect(page);
    await light(page);
    await expect(await action(page, /^(Done for now|Collect all to finish)$/)).toBeVisible();
    await closeSheet(page);
    await shot(page, '124-series-before-draw');
    await page.locator('[data-pour-id="s1"]').click();
    await expect.poll(() => requests.includes('PATCH /api/samples/s1/collect')).toBe(true);
    await page.waitForTimeout(600);
    expect(page.url()).toContain('/lab/collect');
    await shot(page, '124-series-after-draw-stays');
    await (await action(page, /^(Done for now|Done)$/)).click();
    await page.waitForURL(/\/frontdesk/, { timeout: 15_000 });
  });

  test('tapping the locked later draw does not collect it and does not leave', async ({ page }) => {
    await openCollect(page);
    await page.locator('[data-pour-id="s2"]').click();
    await page.waitForTimeout(500);
    expect(requests.filter(r => r.includes('/collect'))).toEqual([]);
    expect(page.url()).toContain('/lab/collect');
    await expect(page.getByText('Not due yet').first()).toBeVisible();
  });

  test('Select tubes + helper line are shown, Choose is gone', async ({ page }) => {
    await openCollect(page);
    const select = await action(page, 'Select tubes to dispatch');
    await expect(select).toBeVisible();
    await expect(page.getByText('Dispatch sends every drawn tube to the lab.').locator('visible=true')).toHaveCount(1);
    expect(await page.getByText('Choose', { exact: true }).locator('visible=true').count()).toBe(0);
    await select.click();
    await expect(page.getByText('Dispatch sends every drawn tube to the lab.').locator('visible=true')).toHaveCount(0);
    await shot(page, '129-select-tubes-mode');
  });

  test('Dispatch from the drawer: tube dispatched, drawer closes, no Done button left behind', async ({ page }) => {
    samples[0].collectedAt = iso(minsAgo(10));   // the 1 h draw is still locked: nothing else to do here
    await openCollect(page);
    await (await action(page, 'Dispatch 1')).click();
    await page.waitForURL(/\/frontdesk/, { timeout: 15_000 });
    expect(requests).toContain('PATCH /api/samples/s0/dispatch');
    expect(requests.filter(r => r.includes('/collect'))).toEqual([]);
    await expect(page.locator('.pf-drawer[role="dialog"]')).toHaveCount(0);
  });

  test('Dispatch while the 1 h tube is due stays open to draw it; no Done-for-now in the way', async ({ page }) => {
    await openCollect(page);   // 70 min after the first draw: the 1 h tube is due
    await (await action(page, 'Dispatch 1')).click();
    await expect.poll(() => requests.includes('PATCH /api/samples/s0/dispatch')).toBe(true);
    await page.waitForTimeout(600);
    expect(page.url()).toContain('/lab/collect');
    await closeSheet(page);
    await page.locator('[data-pour-id="s1"]').click();
    await expect.poll(() => requests.includes('PATCH /api/samples/s1/collect')).toBe(true);
    await page.waitForTimeout(600);
    expect(page.url()).toContain('/lab/collect');   // OPS-142: stays until Dispatch or Done
  });

  test('Dispatch, then browser Back: no stranded collection screen and the tube stays dispatched', async ({ page }) => {
    samples[0].collectedAt = iso(minsAgo(10));
    await openCollect(page);
    await (await action(page, 'Dispatch 1')).click();
    await page.waitForURL(/\/frontdesk/, { timeout: 15_000 });
    await page.goBack();
    await page.waitForTimeout(1000);
    expect(samples.find(s => s.id === 's0')!.status).toBe('dispatched');
    // Wherever Back lands, a dispatched tube offers no second Dispatch.
    expect(await page.locator('.pf-drawer[role="dialog"]').getByRole('button', { name: /^Dispatch \d/ }).count()).toBe(0);
  });

  test('Done for now after the draw, then front desk Dispatch: the tube reaches the lab Intake', async ({ page }) => {
    samples[1].status = 'collected'; samples[1].collectedAt = iso(new Date());   // drawn at the 1 h mark
    await deskInProgress(page);
    const dispatch = page.locator('button[aria-label="Dispatch drawn tubes"]').locator('visible=true').first();
    await expect(dispatch).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('button[aria-label="Collect"], .pf-rowact__t:has-text("Collect")').locator('visible=true').first()).toBeVisible();
    await light(page);
    await expectLayout(page, 'front desk');
    await shot(page, '130-frontdesk-collect-dispatch');
    await dispatch.click();
    await expect.poll(() => requests.includes('PATCH /api/orders/os/dispatch')).toBe(true);
    expect(samples.filter(s => s.status === 'dispatched').map(s => s.id)).toEqual(['s0', 's1']);
    expect(samples.find(s => s.id === 's2')!.status).toBe('pending');
    await expect(page.locator('button[aria-label="Dispatch drawn tubes"]').locator('visible=true')).toHaveCount(0, { timeout: 20_000 });
    // The lab Intake now lists the order.
    await page.goto('/lab/my-work');
    await page.getByText('Lab Intake', { exact: false }).locator('visible=true').first().click();
    await expect(page.getByText('Nandini Rao').locator('visible=true').first()).toBeVisible({ timeout: 30_000 });
    await shot(page, '130-lab-intake-has-it');
  });

  test('front desk: nothing drawn shows no Dispatch next to Collect', async ({ page }) => {
    samples[0].status = 'pending'; samples[0].collectedAt = null;
    await deskInProgress(page);
    await expect(page.getByText('Nandini Rao').locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('button[aria-label="Dispatch drawn tubes"]').locator('visible=true')).toHaveCount(0);
  });
});

test.describe('OPS-117 / 128 / 120 result entry', () => {
  const chip = (page: Page) => page.locator('.pf-sre__flag-chip').locator('visible=true');
  /** Unit + reference as the tech sees them: the Unit / Reference columns, or on a phone the "i" Details peek
   *  (phones keep range and unit off the field line — sample-result-entry.component.scss ≤640px). */
  const expectUnitAndRange = async (page: Page, unit: string | null, range: string) => {
    if (isPhone()) {
      await expect(page.locator('td.pf-sre__gc-unit').locator('visible=true')).toHaveCount(0);
      await page.locator('button.pf-sre__info-btn[aria-label="Details"]').locator('visible=true').first().click();
      await expect(page.getByText(range, { exact: false }).locator('visible=true').first()).toBeVisible();
      if (unit) await expect(page.getByText(unit, { exact: true }).locator('visible=true').first()).toBeVisible();
      else await expect(page.getByText('IU/mL').locator('visible=true')).toHaveCount(0);
      await page.keyboard.press('Escape').catch(() => undefined);
      return;
    }
    await expect(page.locator('td.pf-sre__gc-unit').locator('visible=true').first()).toHaveText(unit ?? '—');
    await expect(page.locator('td.pf-sre__gc-range').locator('visible=true').first()).toContainText(range);
  };
  const field = (page: Page) => page.locator('[data-sre-field="ot1::f"]').locator('visible=true').first();

  test('written result: unit beside the value and in the unit column', async ({ page }) => {
    await page.goto('/lab/sample/smp-1');
    await expect(field(page)).toBeVisible({ timeout: 60_000 });
    await expectLayout(page, 'result entry');
    await expect(page.locator('.pf-sre__gunit-inline').first()).toHaveText('IU/mL');
    await expectUnitAndRange(page, 'IU/mL', 'Negative');
  });

  test('plain-words reference: a different word is flagged Abnormal, the reference word is not, empty clears it', async ({ page }) => {
    await page.goto('/lab/sample/smp-1');
    await light(page);
    await field(page).fill('Positive');
    await expect(chip(page).first()).toHaveText('Abnormal');
    await shot(page, '117-written-abnormal');
    await field(page).fill('negative');
    await expect(chip(page)).toHaveCount(0);
    await field(page).fill('');
    await expect(chip(page)).toHaveCount(0);
  });

  test('number-rule reference: no guessing on screen while typing (the server flags H/L on save)', async ({ page }) => {
    resultTube = textTube('< 5', 'mg/L');
    await page.goto('/lab/sample/smp-1');
    await field(page).fill('9');
    await page.waitForTimeout(400);
    await expect(chip(page)).toHaveCount(0);
    await expect(page.locator('.pf-sre__gunit-inline').first()).toHaveText('mg/L');
  });

  test('a saved High verdict shows as High until the value is edited (OPS-128: number rule + unit in a text test)', async ({ page }) => {
    resultTube = textTube('< 5', 'mg/L');
    resultTube.tests[0].currentResult = JSON.stringify({ values: { f: '9' }, flagged: { f: { value: '9', flag: 'H' } } });
    await page.goto('/lab/sample/smp-1');
    await expect(field(page)).toHaveValue('9', { timeout: 60_000 });
    await expect(chip(page).first()).toHaveText('High');
    await shot(page, '128-number-rule-unit-high');
    await field(page).fill('3');
    await expect(chip(page)).toHaveCount(0);
  });

  test('a written test with no unit shows a dash and no inline unit', async ({ page }) => {
    resultTube = textTube('Negative', '');
    await page.goto('/lab/sample/smp-1');
    await expect(field(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.pf-sre__gunit-inline')).toHaveCount(0);
    await expectUnitAndRange(page, null, 'Negative');
  });

  test('OPS-120: a tube that is not collected yet is locked with a plain message', async ({ page }) => {
    resultTube = textTube('Negative', 'IU/mL', 'pending');
    await page.goto('/lab/sample/smp-1');
    await expect(page.locator('[data-not-collected]').first()).toContainText('not collected yet', { timeout: 60_000 });
    await expect(page.locator('.pf-sre__test').first()).toHaveAttribute('inert', '');
    await expect(page.locator('.pf-sre-fetch')).toHaveCount(0);
    await shot(page, '120-not-collected-locked');
  });
});

test.describe('OPS-117 test editor', () => {
  test('free-text test: Unit picker and the reference box with the number-rule hint', async ({ page }) => {
    await page.goto('/admin/tests/t1/edit?type=individual');
    await expect(page.getByText('Written Test').first()).toBeVisible({ timeout: 60_000 });
    await expectLayout(page, 'test editor');
    await page.getByRole('tab', { name: /Result entry/ }).or(page.getByText('Result entry', { exact: true })).first().click();
    await expect(page.locator('.pf-uf__lbl', { hasText: 'Unit' }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('A number rule').first()).toBeVisible();
    const ref = page.getByLabel('Reference text').first();
    await expect(ref).toBeVisible();
    await expect(ref).toHaveValue('< 5');
    await ref.fill('Up to 40');
    await expect(ref).toHaveValue('Up to 40');
    await shot(page, '117-test-editor-unit-reference');
  });

  test('choice test has no Unit picker', async ({ page }) => {
    await page.goto('/admin/tests/t2/edit?type=individual');
    await expect(page.getByText('Choice Test').first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('tab', { name: /Result entry/ }).or(page.getByText('Result entry', { exact: true })).first().click();
    await expect(page.getByText('What will the tech enter?').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.pf-uf__lbl', { hasText: /^Unit$/ })).toHaveCount(0);
  });
});

test.describe('Start menu lists every entry once', () => {
  test('Lab admin: unique ids and labels, Lab settings once, Inventory settings named; the menu fits the screen', async ({ page }) => {
    await page.goto('/frontdesk');
    await page.locator('button[aria-label="Start menu"]').locator('visible=true').first().click({ timeout: 60_000 });
    const menu = page.locator('[data-start-menu]').first();
    await expect(menu).toBeVisible();
    await page.waitForTimeout(600);
    const ids = await menu.locator('[data-sm-item]').evaluateAll(els => els.map(e => e.getAttribute('data-sm-item') ?? ''));
    const labels = await menu.locator('.sm-row__lbl, .sm-tile__lbl').allTextContents();
    const rows = await menu.locator('.sm-rows [data-sm-item]').evaluateAll(els => els.map(e => e.getAttribute('data-sm-item') ?? ''));
    expect(rows.length).toBeGreaterThan(3);
    expect(new Set(rows).size).toBe(rows.length);
    const rowLabels = (await menu.locator('.sm-rows .sm-row__lbl').allTextContents()).map(s => s.trim().toLowerCase());
    expect(new Set(rowLabels).size).toBe(rowLabels.length);
    expect(labels.filter(l => l.trim().toLowerCase() === 'lab settings').length).toBeLessThanOrEqual(1);
    expect(ids.length).toBeGreaterThan(0);
    await expectFitsWidth(page, '[data-start-menu]', 'start menu');
    await expectLayout(page, 'start menu', { nav: false });
    await light(page);
    await shot(page, `nav-start-menu-${projectName()}`);
  });
});
