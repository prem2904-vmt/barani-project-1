import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * 2026-11-13 fix batch (release/fix-1113) integrated review screenshots, light mode, API mocked, demo data only:
 *  a. sample collection drawer of a timed series: "Select tubes" + helper line
 *  b. front desk In progress row: Collect and Dispatch side by side (part-collected order)
 *  c. test editor: free-text test shows Unit picker + Reference box
 *  d. patient registration Contact & IDs shows Address / place; advanced search Contact column with address
 *  e. front desk: an all-outsourced dispatched order sits under Outsourced, not In progress
 *  g. front desk Completed row: Share menu offers WhatsApp (one entry; Chat here because no Cloud sender)
 *  h. lab Intake (receive): one patient with two orders today shows serials 1 and 2
 * Not part of the suite (own config: playwright.screens.config.ts).
 */
const OUT = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/fix-1113/fx-int');

const TENANT = { id: 't-demo', name: 'Demo Lab' };
const ME = { id: 'app-1', authId: 'sub-1', first: 'Kavya', last: 'Desk' };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub: string) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 86400, email: `${sub}@demo.test` })}.sig`;

const now = new Date();
const iso = (d: Date) => d.toISOString();
const minsAgo = (m: number) => new Date(now.getTime() - m * 60000);
const PARAMS = JSON.stringify({ parameters: [{ name: 'glu', title: 'Glucose', unit: 'mg/dL' }] });
const pat = (id: string, name: string, attributes?: string) => ({ id, displayName: name, firstName: name.split(' ')[0], gender: 'F', sex: 'Female', age: 34, mrn: `26${id.padStart(4, '0')}`, phone: '+919876543210', attributes });
const tline = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, status: 'pending', test: { name, parameters: PARAMS, sampleType: 'Plasma' }, ...extra });
const sample = (id: string, orderId: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, orderId, status, barcode: `B-${id}`, tubeColor: 'grey', rejectionCount: 0, collectedAt: status === 'pending' ? null : iso(minsAgo(30)),
  department: { id: 'd1', name: 'Biochemistry', code: 'BIO' }, tests: [tline(`${id}-t`, 'Glucose')], ...extra,
});
const order = (id: string, n: number, name: string, status: string, samples: unknown[], extra: Record<string, unknown> = {}) => ({
  id, orderNumber: `LAB-2611-0000${n}`, dailyNo: n, dailyNoDay: iso(now).slice(0, 10), patientId: `p${n}`, branchId: 'b1', patient: pat(String(n), name),
  priority: 'Normal', source: 'walkin', collectionType: 'walkin', status, createdAt: iso(minsAgo(90)), updatedAt: iso(now), samples, ...extra,
});

// a/b: a timed series (anchor drawn, 1h and 2h to come) on one order.
const SERIES_ORDER = order('os', 7, 'Nandini Rao', 'billed', [
  sample('s0', 'os', 'collected', { repeatOffsetMin: 0, repeatSeriesKey: 'ogtt', tests: [tline('s0-t', 'Glucose (fasting)')] }),
  sample('s1', 'os', 'pending', { repeatOffsetMin: 60, repeatSeriesKey: 'ogtt', tests: [tline('s1-t', 'Glucose (1 h)')] }),
  sample('s2', 'os', 'pending', { repeatOffsetMin: 120, repeatSeriesKey: 'ogtt', tests: [tline('s2-t', 'Glucose (2 h)')] }),
]);
// e: both tubes at a partner lab, already dispatched.
const OUT_ORDER = order('oo', 9, 'Imran Sheikh', 'in_progress', [
  sample('o1', 'oo', 'dispatched', { outsourcedVendorId: 'v1', tests: [tline('o1-t', 'Vitamin D 25-OH')] }),
  sample('o2', 'oo', 'dispatched', { outsourcedVendorId: 'v1', tubeColor: 'red', tests: [tline('o2-t', 'Serum Ferritin')] }),
]);
const OTHER_ORDER = order('ox', 11, 'Meena Iyer', 'billed', [sample('x1', 'ox', 'received', { tests: [tline('x1-t', 'Haemoglobin')] })]);
const ORDERS = [SERIES_ORDER, OUT_ORDER, OTHER_ORDER];
// f: an older order (created 6 days ago) with an outstanding balance; NOT in today's feed.
const OLD_ORDER = { ...order('od', 3, 'Hemanth Kumar', 'billed', [sample('d1', 'od', 'received', { tests: [tline('d1-t', 'Lipid profile')] })]), createdAt: iso(minsAgo(6 * 1440)), dailyNoDay: iso(minsAgo(6 * 1440)).slice(0, 10) };
const OLD_BILL = { id: 'b-od', orderId: 'od', patientId: 'p3', branchId: 'b1', type: 'lab', invoiceNumber: 'INV-00091', isInterstate: false, subTotal: 900, overrideDiscount: 0, totalDiscount: 0, totalTaxable: 900, totalCgst: 0, totalSgst: 0, totalIgst: 0, totalTax: 0, totalPayable: 900, totalPaid: 400, balance: 500, status: 'partial', createdAt: iso(minsAgo(6 * 1440)), items: [], payments: [] };
const OUT_TUBES = OUT_ORDER.samples.map((s: any, i: number) => ({
  sampleId: s.id, barcode: s.barcode, sampleStatus: 'dispatched', tubeColor: s.tubeColor, orderId: 'oo', orderNumber: OUT_ORDER.orderNumber,
  patientId: 'p9', patientName: 'Imran Sheikh', dailyNo: 9, dailyNoDay: iso(now).slice(0, 10), partnerLabId: 'v1', partnerLabName: 'Metro Reference Lab',
  createdAt: iso(minsAgo(90)), collectedAt: iso(minsAgo(60)), dispatchedAt: iso(minsAgo(20)), status: 'outsourced', hasReport: false,
  tests: [{ orderTestId: `ot${i}`, testId: `t${i}`, testName: i === 0 ? 'Vitamin D 25-OH' : 'Serum Ferritin', status: 'outsourced', completed: false, report: null }],
}));

// g: a validated (completed) order for the Share menu; extra feeds are set per test.
const DONE_ORDER = order('ov', 5, 'Priya Nair', 'validated', [sample('v1', 'ov', 'received', { tests: [tline('v1-t', 'Haemoglobin')] })]);
// h: ONE patient (same patient id) with TWO orders today, dispatched to the lab: serials 1 and 2.
const TWIN_PATIENT = pat('31', 'Divya Menon');
const twin = (id: string, n: number, test: string) => ({
  ...order(id, n, 'Divya Menon', 'in_progress', [sample(`${id}-s`, id, 'dispatched', { dispatchedAt: iso(minsAgo(15 - n)), tests: [tline(`${id}-t`, test)] })]),
  patientId: 'p31', patient: TWIN_PATIENT,
});
const TWIN_ORDERS = [twin('ot1', 1, 'Glucose (fasting)'), twin('ot2', 2, 'Thyroid profile')];
let extraToday: unknown[] = [];
let dispatchedFeed: unknown[] = [];

// d: registration config (the seeded Micro World shape) and two search hits.
const fld = (name: string, title: string, type: string, extra: Record<string, unknown> = {}) => ({ id: name, name, title, type, isStandard: true, isRequired: false, isEditable: true, storageKey: name, width: 'half', ...extra });
const REG_CONFIG = {
  id: 'cfg', name: 'patient_registration', title: 'Patient Registration', module: 'lms', screenName: 'patient_registration', version: 1, status: 'published', globalConditions: [], actions: [],
  steps: [
    { id: 'st1', name: 'basic_info', title: 'Basic Info', type: 'entry', isRequired: true, canSkip: false, isStandard: true, fields: [
      fld('title', 'Title', 'button_select', { width: 'full', options: ['Mr.', 'Mrs.', 'Ms.', 'Dr.'].map(v => ({ value: v, label: v })) }),
      fld('first_name', 'First name', 'text', { isRequired: true }), fld('fathers_name', 'Last name', 'text', { isRequired: true }),
      fld('phone', 'Phone', 'phone', { isRequired: true }), fld('date_of_birth', 'Date of birth', 'date'),
      fld('sex', 'Sex', 'select', { isRequired: true, options: ['Male', 'Female', 'Other'].map(v => ({ value: v, label: v })) }),
      fld('abha_id', 'ABHA ID', 'text'), fld('aadhaar_last4', 'Aadhaar (last 4)', 'text'),
    ] },
    { id: 'st2', name: 'additional_info', title: 'Additional details', type: 'entry', isRequired: false, canSkip: true, isStandard: true, fields: [
      fld('email', 'Email', 'email'), fld('blood_group', 'Blood group', 'select', { options: ['A+', 'B+', 'O+', 'AB+'].map(v => ({ value: v, label: v })) }),
      fld('address', 'Address / place', 'text', { isStandard: false, storageKey: 'metadata.address', width: 'full' }),
    ] },
  ],
};
const HITS = [
  { patient: pat('21', 'Lakshmi Narayanan', JSON.stringify({ address: '14, Gandhi Street, Peelamedu', district: 'Coimbatore', state: 'Tamil Nadu' })), lastVisitAt: iso(minsAgo(3000)), lastBranchId: 'b1', lastBranchName: 'Main' },
  { patient: pat('22', 'Rohan Mehta', JSON.stringify({ address: 'Flat 3B, Lake View Apartments' })), lastVisitAt: iso(minsAgo(9000)), lastBranchId: 'b1', lastBranchName: 'Main' },
  { patient: pat('23', 'Sana Parveen'), lastVisitAt: iso(minsAgo(20000)), lastBranchId: 'b1', lastBranchName: 'Main' },
];

// c: a free-text test.
const TEXT_TEST = {
  id: 't1', tenantId: 'tn', name: 'Urine Culture Remarks', type: 'individual', flow: 'approval', price: 100, taxSlab: 0, discount: 0, departmentId: 'bio', tatHours: 24,
  sampleType: 'Urine', tubeColor: 'sterile', testCode: 'CLP026', shortName: 'UCR', section: '', profile: '', methodology: '', resultType: 'text', unit: 'mg/dL', reportFormat: 'tabular',
  adultReferenceRange: '', conditions: '[]', isActive: true, createdAt: '',
  parameters: JSON.stringify({ parameters: [{ id: 'p1', name: 'finding', title: 'Finding', type: 'text', unit: 'mg/dL', normalValue: 'Less than 5' }] }),
};

async function backend(page: Page) {
  const cors = (origin: string) => ({ 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
  const ok = (origin: string, data: unknown) => ({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: true, data }) });
  const missing: string[] = [];
  await page.route(/prefrontal\.health\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    const u = new URL(req.url()); const p = u.pathname;
    if (p === '/api/auth/me') return route.fulfill(ok(origin, { id: ME.id, authId: ME.authId, firstName: ME.first, fathersName: ME.last, displayName: `${ME.first} ${ME.last}`, email: 'desk@demo.test', tenantId: TENANT.id, tenantName: TENANT.name, branchId: 'b1', branchName: 'Main', roles: ['Lab Admin'], permissions: ['*'], branches: [{ id: 'b1', name: 'Main' }], modules: ['lab'], hasPin: false }));
    if (p === '/api/tenants/modules') return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: false }) });
    if (p === '/api/tenants/current') return route.fulfill(ok(origin, { id: TENANT.id, name: TENANT.name }));
    if (p === '/api/tenants/departments') return route.fulfill(ok(origin, [{ id: 'bio', name: 'Biochemistry' }, { id: 'mic', name: 'Microbiology' }]));
    if (p === '/api/tenants/branches') return route.fulfill(ok(origin, [{ id: 'b1', name: 'Main' }]));
    if (p === '/api/process-workflows/active') return route.fulfill(ok(origin, null));
    if (p === '/api/whatsapp/settings') return route.fulfill(ok(origin, { canSend: false }));
    if (p === '/api/orders/today' || p === '/api/orders/range') return route.fulfill(ok(origin, [...ORDERS, ...extraToday]));
    if (p === '/api/orders/dispatched') return route.fulfill(ok(origin, dispatchedFeed));
    if (p === '/api/samples/in-transit') return route.fulfill(ok(origin, []));
    if (p === '/api/billing/outstanding') return route.fulfill(ok(origin, { due: [OLD_BILL], refundsOwed: [] }));
    if (p === '/api/samples/pending-collection') return route.fulfill(ok(origin, SERIES_ORDER.samples.filter(s => s.status === 'pending').map(s => ({ ...s, order: SERIES_ORDER }))));
    if (p === '/api/samples/outsourced') return route.fulfill(ok(origin, OUT_TUBES));
    if (p === '/api/workflows/patient_registration') return route.fulfill(ok(origin, { id: 'w1', tenantId: TENANT.id, module: 'lms', screenName: 'patient_registration', configJson: JSON.stringify(REG_CONFIG), version: 1, status: 'published', updatedAt: iso(now) }));
    if (p === '/api/patients/advanced-search') return route.fulfill(ok(origin, { items: HITS, total: HITS.length }));
    if (p === '/api/tests/t1') return route.fulfill(ok(origin, TEXT_TEST));
    const m = /^\/api\/orders\/([^/]+)$/.exec(p);
    if (m) return route.fulfill(ok(origin, [...ORDERS, OLD_ORDER].find(x => x.id === m[1]) ?? SERIES_ORDER));
    if (req.method() === 'GET') { missing.push(p); return route.fulfill(ok(origin, [])); }
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
      localStorage.setItem('pf.startHintSeen', '1');   // a returning user: the one-time Start-menu hint (bb806320) would cover the phone collection actions
    }
  }, [JSON.stringify({ access_token: jwt(ME.authId), refresh_token: `rt-${ME.authId}` })] as const);
  return missing;
}

async function light(page: Page) {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => { const r = document.documentElement; r.classList.remove('dark'); r.classList.add('light'); r.setAttribute('data-theme', 'light'); });
  await page.waitForTimeout(500);
}

/** Wait for a VISIBLE match (phone lays the desk out in tabs, so the first match may be hidden); keep a debug PNG if it never shows. */
async function see(page: Page, text: string, tag: string, timeout = 60_000) {
  const loc = page.getByText(text).locator('visible=true').first();
  try { await expect(loc).toBeVisible({ timeout }); } catch (e) { await page.screenshot({ path: `${OUT}/DEBUG-${tag}.png` }); throw e; }
  return loc;
}

/** Switch the front desk work list to a tab ("In progress", "Outsourced"); phone tabs are icon-only (aria-label / title). */
async function deskTab(page: Page, label: string) {
  const byLabel = page.locator(`[aria-label*="${label}"], [title*="${label}"]`).locator('visible=true').first();
  if (await byLabel.count()) { await byLabel.click(); return; }
  await page.getByText(label, { exact: false }).locator('visible=true').first().click();
}

const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } } as const;

for (const [vp, size] of Object.entries(VIEWPORTS)) {
  test.describe(`fx-int ${vp}`, () => {
    test.beforeEach(async ({ page }) => { test.setTimeout(150_000); fs.mkdirSync(OUT, { recursive: true }); await page.setViewportSize(size); await backend(page); });

    test('a. collection drawer: Select tubes + helper', async ({ page }) => {
      await page.goto('/lab/collect?orderId=os&from=/frontdesk');
      await page.waitForSelector('text=Nandini Rao', { timeout: 60_000 });
      if (vp === 'phone') { await page.locator('button[aria-label="More collection actions"]').click(); await page.waitForTimeout(600); }
      await see(page, 'Select tubes', `a-${vp}`);
      await see(page, 'Dispatch sends every drawn tube to the lab.', `a2-${vp}`, 10_000);
      await light(page);
      await page.screenshot({ path: `${OUT}/a-collect-drawer-select-tubes--${vp}.png` });
    });

    test('b. front desk In progress: Collect and Dispatch side by side', async ({ page }) => {
      await page.goto('/frontdesk');
      await page.getByPlaceholder(/Search patient/).locator('visible=true').first().waitFor({ timeout: 60_000 });
      if (vp === 'phone') await deskTab(page, 'In progress'); // desktop opens on In progress already
      await see(page, 'Nandini Rao', `fd-${vp}`);
      await light(page);
      await expect(page.locator('button[aria-label="Dispatch drawn tubes"]').locator('visible=true').first()).toBeVisible();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/b-frontdesk-collect-dispatch--${vp}.png` });
      // The all-outsourced order is NOT listed under In progress.
      expect(await page.getByText('Imran Sheikh').locator('visible=true').count()).toBe(0);
    });

    test('e. front desk: all-outsourced dispatched order is under Outsourced', async ({ page }) => {
      await page.goto('/frontdesk');
      await page.getByPlaceholder(/Search patient/).locator('visible=true').first().waitFor({ timeout: 60_000 });
      await light(page);
      await deskTab(page, 'Outsourced');
      await see(page, 'Imran Sheikh', `e-${vp}`, 15_000);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/e-frontdesk-outsourced-tab--${vp}.png` });
    });

    test('f. Payments due tab lists an older due while Today is selected', async ({ page }) => {
      await page.goto('/frontdesk');
      await page.getByPlaceholder(/Search patient/).locator('visible=true').first().waitFor({ timeout: 60_000 });
      await light(page);
      // Today (no chip): the 6-day-old due is NOT in the list.
      if (vp === 'phone') await deskTab(page, 'In progress'); // desktop opens on In progress already
      await see(page, 'Nandini Rao', `f0-${vp}`);
      expect(await page.getByText('Hemanth Kumar').locator('visible=true').count()).toBe(0);
      await deskTab(page, 'Payments due');
      await see(page, 'Hemanth Kumar', `f-${vp}`, 20_000);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/f-payments-due-tab-older-due--${vp}.png` });
    });

    test('g. Completed row Share menu offers WhatsApp', async ({ page }) => {
      extraToday = [DONE_ORDER];
      try {
        await page.goto('/frontdesk');
        await page.getByPlaceholder(/Search patient/).locator('visible=true').first().waitFor({ timeout: 60_000 });
        await light(page);
        await deskTab(page, 'Completed');
        await see(page, 'Priya Nair', `g-${vp}`, 20_000);
        await page.locator('button[aria-label="Share report"]').locator('visible=true').first().click();
        await see(page, 'WhatsApp', `g2-${vp}`, 10_000);
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${OUT}/g-share-menu-whatsapp--${vp}.png` });
      } finally { extraToday = []; }
    });

    test('h. lab Intake: one patient, two orders, serials 1 and 2', async ({ page }) => {
      test.skip(vp !== 'desktop', 'desktop only');
      dispatchedFeed = TWIN_ORDERS;
      try {
        await page.goto('/lab/my-work');
        await page.getByText('Lab Intake', { exact: false }).locator('visible=true').first().click();   // the collapsed Intake rail
        await see(page, 'Divya Menon', `h-${vp}`, 60_000);
        await light(page);
        await page.waitForTimeout(800);
        const chips = (await page.locator('.pf-dayno').locator('visible=true').allTextContents()).map(t => t.trim().split(' ')[0]);
        expect(chips).toEqual(expect.arrayContaining(['1', '2']));
        await page.screenshot({ path: `${OUT}/h-lab-intake-serials--${vp}.png` });
      } finally { dispatchedFeed = []; }
    });

    test('d. registration Contact & IDs has the address; advanced search Contact column', async ({ page }) => {
      await page.goto('/frontdesk');
      await page.getByPlaceholder(/Search patient/).locator('visible=true').first().waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1500);
      await page.keyboard.press('Control+k');
      const name = page.locator('input[placeholder="First or last name"]').locator('visible=true').first();
      await name.waitFor({ timeout: 15_000 });   // the dialog opens after the shortcut; filling before it races
      await name.fill('an'); await name.press('Enter');
      if (vp === 'phone') { await page.waitForTimeout(500); await page.getByRole('button', { name: 'Search', exact: true }).locator('visible=true').first().click().catch(() => undefined); }
      await see(page, 'Lakshmi Narayanan', `d-adv-${vp}`, 15_000);
      await page.getByText('Lakshmi Narayanan').locator('visible=true').first().scrollIntoViewIfNeeded();
      await light(page);
      await page.screenshot({ path: `${OUT}/d2-advanced-search-contact-address--${vp}.png` });
      await page.goto('/frontdesk/patients/new');
      await see(page, 'Contact & IDs', `d-reg-${vp}`);
      await see(page, 'Address / place', `d-reg2-${vp}`, 10_000);
      await light(page);
      await page.getByText('Address / place').locator('visible=true').first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/d1-register-contact-address--${vp}.png` });
    });
  });
}

test('c. test editor: free-text test shows Unit + Reference', async ({ page }) => {
  test.setTimeout(150_000);
  fs.mkdirSync(OUT, { recursive: true });
  await page.setViewportSize(VIEWPORTS.desktop);
  await backend(page);
  await page.goto('/admin/tests/t1/edit?type=individual');
  await expect(page.getByText('Urine Culture Remarks').first()).toBeVisible({ timeout: 60_000 });
  await light(page);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/c1-test-editor-first-view--desktop.png` });
  await page.getByRole('tab', { name: /Result entry/ }).or(page.getByText('Result entry', { exact: true })).first().click();
  await page.waitForTimeout(600);
  const unit = page.locator('.pf-uf__lbl', { hasText: 'Unit' }).first();
  try { await expect(unit).toBeVisible({ timeout: 15_000 }); } catch (e) { await page.screenshot({ path: `${OUT}/DEBUG-c.png` }); throw e; }
  await unit.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/c2-test-editor-unit-reference--desktop.png` });
  await expect(page.getByText('Prints in the Reference range column').first()).toBeVisible();
});
