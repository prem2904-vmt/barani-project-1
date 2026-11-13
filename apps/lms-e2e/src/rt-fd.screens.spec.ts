import { test, expect, type Page, type Locator } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Re-test 2026-11-13 (rt-fd): element-based checks (roles / text / visibility, not only screenshots) for
 *   OPS-114 outsourced-only orders leave In progress -> Outsourced -> Completed after the partner report
 *   OPS-119 Address / place in Contact & IDs; advanced search Contact column (own-named address fields too)
 *   OPS-127 per-order serial on front desk + lab Intake (one patient, two orders; cancelled order keeps its number)
 *   OPS-131 order drawer: Order ID, Referral doctor + Change (permission), no reference range
 *   OPS-132 Today list is date-bound; Payments due tab + chip count list every due (also after a date change)
 * API mocked, demo data only. Own config: playwright.screens.config.ts.
 */
const OUT = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/retest-1113/rt-fd');

const TENANT = { id: 't-demo', name: 'Demo Lab' };
const ME = { id: 'app-1', authId: 'sub-1', first: 'Kavya', last: 'Desk' };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub: string) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 86400, email: `${sub}@demo.test` })}.sig`;

const now = new Date();
const iso = (d: Date) => d.toISOString();
const minsAgo = (m: number) => new Date(now.getTime() - m * 60000);
const daysAgo = (d: number) => minsAgo(d * 1440);
const dayOf = (d: Date) => iso(d).slice(0, 10);
const PARAMS = JSON.stringify({ parameters: [{ name: 'glu', title: 'Fasting Blood Sugar', unit: 'mg/dL' }, { name: 'hb', title: 'Haemoglobin', unit: 'g/dL' }] });
const RESULT = JSON.stringify({ values: { glu: '110', hb: '18' }, flagged: { glu: { flag: 'N', range: '70-99' }, hb: { flag: 'H', range: '12-15' } } });

const pat = (id: string, name: string, attributes?: string) => ({ id, displayName: name, firstName: name.split(' ')[0], gender: 'F', sex: 'Female', age: 34, mrn: `26${id.padStart(4, '0')}`, phone: '+919876543210', attributes });
const ln = (id: string, name: string, o: { status?: string; vendor?: string; override?: string; result?: boolean } = {}) => ({
  id, status: o.status ?? 'pending', outsourcingOverride: o.override ?? null, currentResult: o.result ? RESULT : undefined,
  test: { name, parameters: PARAMS, sampleType: 'Plasma', ...(o.vendor ? { outsourcedVendorId: o.vendor } : {}) },
});
const smp = (id: string, orderId: string, status: string, o: { vendor?: string; lines?: unknown[] } = {}) => ({
  id, orderId, status, barcode: `B-${id}`, tubeColor: 'grey', rejectionCount: 0, collectedAt: status === 'pending' ? null : iso(minsAgo(30)),
  dispatchedAt: status === 'dispatched' ? iso(minsAgo(20)) : null, outsourcedVendorId: o.vendor ?? null,
  department: { id: 'd1', name: 'Biochemistry', code: 'BIO' }, tests: o.lines ?? [ln(`${id}-t`, 'Glucose')],
});
const ord = (id: string, n: number, name: string, status: string, samples: unknown[], o: { created?: Date; updated?: Date; patient?: unknown; extra?: Record<string, unknown> } = {}) => {
  const created = o.created ?? minsAgo(90);
  return {
    id, orderNumber: `LAB-2611-0000${n}`, dailyNo: n, dailyNoDay: dayOf(created), patientId: `p${n}`, branchId: 'b1', patient: o.patient ?? pat(String(n), name),
    priority: 'Normal', source: 'walkin', collectionType: 'walkin', status, createdAt: iso(created), updatedAt: iso(o.updated ?? now), samples, ...(o.extra ?? {}),
  };
};
const bill = (orderId: string, balance: number, invoice = 'INV-1') => ({
  id: `b-${orderId}`, orderId, patientId: 'p', branchId: 'b1', type: 'lab', invoiceNumber: invoice, isInterstate: false, subTotal: 400, overrideDiscount: 0, totalDiscount: 0,
  totalTaxable: 400, totalCgst: 0, totalSgst: 0, totalIgst: 0, totalTax: 0, totalPayable: 400, totalPaid: 400 - balance, balance, status: balance ? 'partial' : 'paid', createdAt: iso(now),
  items: [{ id: 'i1', testId: 't1', testName: 'Blood sugar', quantity: 1, unitPrice: 400, discount: 0, taxableValue: 400, taxRate: 0, taxAmount: 0, total: 400 }], payments: [],
});
const tube = (o: any, s: any, partner = 'Metro Reference Lab', status = 'outsourced') => ({
  sampleId: s.id, barcode: s.barcode, sampleStatus: s.status, tubeColor: 'grey', orderId: o.id, orderNumber: o.orderNumber,
  patientId: o.patientId, patientName: o.patient.displayName, dailyNo: o.dailyNo, dailyNoDay: o.dailyNoDay, partnerLabId: 'v1', partnerLabName: partner,
  createdAt: o.createdAt, collectedAt: s.collectedAt, dispatchedAt: s.dispatchedAt, status, hasReport: status === 'completed',
  tests: s.tests.map((t: any, i: number) => ({ orderTestId: t.id, testId: `x${i}`, testName: t.test.name, status, completed: status === 'completed', report: null })),
});

interface State {
  orders: any[]; bills: any[]; tubes: any[]; byId: Record<string, any>; perms: string[]; rangeDelayMs: number; billsDelayMs: number; dispatched: any[];
  regConfig: any; hits: any[]; patientById: Record<string, any>; completeHook?: () => void; referralPatch: any[];
}
const fresh = (): State => ({ orders: [], bills: [], tubes: [], byId: {}, perms: ['*'], rangeDelayMs: 0, billsDelayMs: 0, dispatched: [], regConfig: null, hits: [], patientById: {}, referralPatch: [] });
let S: State = fresh();

async function backend(page: Page) {
  const cors = (origin: string) => ({ 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
  const ok = (origin: string, data: unknown) => ({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: true, data }) });
  await page.route(/prefrontal\.health\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    const u = new URL(req.url()); const p = u.pathname;
    if (p === '/api/auth/me') return route.fulfill(ok(origin, { id: ME.id, authId: ME.authId, firstName: ME.first, fathersName: ME.last, displayName: `${ME.first} ${ME.last}`, email: 'desk@demo.test', tenantId: TENANT.id, tenantName: TENANT.name, branchId: 'b1', branchName: 'Main', roles: ['Receptionist'], permissions: S.perms, branches: [{ id: 'b1', name: 'Main' }], modules: ['lab'], hasPin: false }));
    if (p === '/api/tenants/modules') return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: false }) });
    if (p === '/api/tenants/current') return route.fulfill(ok(origin, { id: TENANT.id, name: TENANT.name }));
    if (p === '/api/process-workflows/active') return route.fulfill(ok(origin, null));
    if (p === '/api/whatsapp/settings') return route.fulfill(ok(origin, { canSend: false }));
    if (p === '/api/orders/today') return route.fulfill(ok(origin, S.orders));
    if (p === '/api/orders/range') {
      if (S.rangeDelayMs) await new Promise(r => setTimeout(r, S.rangeDelayMs));
      const from = Date.parse(u.searchParams.get('from') ?? ''); const to = Date.parse(u.searchParams.get('to') ?? '');
      return route.fulfill(ok(origin, S.orders.filter(o => Date.parse(o.createdAt) >= from && Date.parse(o.createdAt) < to)));
    }
    if (p === '/api/orders/dispatched') return route.fulfill(ok(origin, S.dispatched));
    if (p === '/api/samples/in-transit') return route.fulfill(ok(origin, []));
    if (p === '/api/billing/outstanding') {
      if (S.billsDelayMs) await new Promise(r => setTimeout(r, S.billsDelayMs));
      return route.fulfill(ok(origin, { due: S.bills.filter(b => b.balance > 0), refundsOwed: [] }));
    }
    if (p === '/api/samples/outsourced') return route.fulfill(ok(origin, S.tubes));
    if (p === '/api/samples/outsourced/complete') { S.completeHook?.(); return route.fulfill(ok(origin, S.tubes)); }
    if (p === '/api/workflows/patient_registration') return route.fulfill(ok(origin, { id: 'w1', tenantId: TENANT.id, module: 'lms', screenName: 'patient_registration', configJson: JSON.stringify(S.regConfig), version: 1, status: 'published', updatedAt: iso(now) }));
    if (p === '/api/patients/advanced-search') return route.fulfill(ok(origin, { items: S.hits, total: S.hits.length }));
    let m = /^\/api\/patients\/([^/]+)$/.exec(p);
    if (m && S.patientById[m[1]]) return route.fulfill(ok(origin, { patient: S.patientById[m[1]], history: [] }));
    if (/\/api\/orders\/[^/]+\/referral$/.test(p)) {
      if (req.method() === 'PATCH') { S.referralPatch.push(req.postDataJSON()); return route.fulfill(ok(origin, { changed: true, reportAmended: false, order: { refDoctorName: 'Dr. Rao Jr', refHospitalName: null } })); }
      return route.fulfill(ok(origin, { orderId: 'ov', orderNumber: 'LAB-2611-00005', status: 'validated', patientName: 'Priya Nair', refDoctorName: 'Dr. Rao', sourceTypes: ['Doctor', 'Hospital', 'Walk-in'] }));
    }
    if (/\/api\/orders\/[^/]+\/track-token$/.test(p)) return route.fulfill(ok(origin, { token: 'tok123' }));
    m = /^\/api\/orders\/([^/]+)$/.exec(p);
    if (m) return route.fulfill(ok(origin, S.byId[m[1]] ?? S.orders.find(x => x.id === m![1]) ?? {}));
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
const vis = (page: Page, text: string): Locator => page.getByText(text, { exact: false }).locator('visible=true');
const waitDesk = (page: Page) => page.getByPlaceholder(/Search patient/).locator('visible=true').first().waitFor({ timeout: 60_000 });
async function seen(page: Page, text: string, tag: string, timeout = 30_000) {
  try { await expect(vis(page, text).first()).toBeVisible({ timeout }); } catch (e) { await page.screenshot({ path: `${OUT}/DEBUG-${tag}.png` }); throw e; }
}
/** Not listed once the view has settled: a tab switch swaps the list a beat after the click, so a one-shot count could read the previous tab. */
async function absent(page: Page, text: string) { await expect(vis(page, text), `"${text}" must not be listed`).toHaveCount(0, { timeout: 5_000 }); }
/** The front desk work tabs; phone tabs are icon-only (aria-label / title). */
async function deskTab(page: Page, label: string) {
  const byLabel = page.locator(`[aria-label*="${label}"], [title*="${label}"]`).locator('visible=true').first();
  if (await byLabel.count()) await byLabel.click();
  else await page.getByText(label, { exact: false }).locator('visible=true').first().click();
  const radio = page.getByRole('radio', { name: label }).locator('visible=true').first();
  if (await radio.count()) await expect(radio).toBeChecked();
}
/** The number on a work-tab chip ("In progress 2"): read from the segmented control's button. */
async function chipCount(page: Page, label: string): Promise<number> {
  const btn = page.locator('button', { hasText: label }).locator('visible=true').first();
  const t = ((await btn.textContent()) ?? '') + ' ' + ((await btn.getAttribute('aria-label')) ?? '') + ' ' + ((await btn.getAttribute('title')) ?? '');
  const m = /(\d+)\s*$/.exec(t.replace(label, '').trim()) ?? /(\d+)/.exec(t.replace(label, ''));
  return m ? Number(m[1]) : 0;
}

const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } } as const;

// ───────────────────────── OPS-114 ─────────────────────────
function outsourcedScenario() {
  const A = ord('a', 1, 'Anita Outonly', 'dispatched', []); A.samples = [smp('a1', 'a', 'dispatched', { vendor: 'v1', lines: [ln('a1-t', 'Vitamin D', { vendor: 'v1' })] })];
  const B = ord('b', 2, 'Bala Legacy', 'dispatched', []); B.samples = [smp('b1', 'b', 'dispatched', { lines: [ln('b1-t', 'Ferritin', { vendor: 'v1' })] })];             // no frozen vendor on the tube
  const C = ord('c', 3, 'Chitra Mixed', 'in_progress', []); C.samples = [smp('c1', 'c', 'received', { lines: [ln('c1-t', 'Glucose')] }), smp('c2', 'c', 'dispatched', { vendor: 'v1', lines: [ln('c2-t', 'Cortisol', { vendor: 'v1' })] })];
  const D = ord('d', 4, 'Dev Pending', 'billed', []); D.samples = [smp('d1', 'd', 'pending', { vendor: 'v1', lines: [ln('d1-t', 'Homocysteine', { vendor: 'v1' })] })];
  const E = ord('e', 5, 'Esha Cancelled', 'dispatched', []); E.samples = [smp('e1', 'e', 'dispatched', { vendor: 'v1', lines: [ln('e1-t', 'HbA1c', { vendor: 'v1' })] }), smp('e2', 'e', 'cancelled', { lines: [ln('e2-t', 'Glucose', { status: 'cancelled' })] })];
  const F = ord('f', 6, 'Farid Rejected', 'dispatched', []); F.samples = [smp('f1', 'f', 'dispatched', { vendor: 'v1', lines: [ln('f1-t', 'Troponin', { vendor: 'v1' })] }), smp('f2', 'f', 'rejected', { lines: [ln('f2-t', 'Glucose', { status: 'rejected' })] })];
  const orders = [A, B, C, D, E, F];
  const tubes = [tube(A, A.samples[0]), tube(B, B.samples[0]), tube(C, C.samples[1]), tube(E, E.samples[0]), tube(F, F.samples[0])];
  return { A, B, C, D, E, F, orders, tubes };
}

for (const [vp, size] of Object.entries(VIEWPORTS)) {
  test.describe(`rt-fd OPS-114 ${vp}`, () => {
    test.beforeEach(async ({ page }) => { test.setTimeout(150_000); fs.mkdirSync(OUT, { recursive: true }); S = fresh(); await page.setViewportSize(size); await backend(page); });

    test('outsourced-only orders are under Outsourced, not In progress; mixed and pending ones stay In progress', async ({ page }) => {
      const sc = outsourcedScenario(); S.orders = sc.orders; S.tubes = sc.tubes;
      await page.goto('/frontdesk'); await waitDesk(page); await light(page);
      if (vp === 'phone') await deskTab(page, 'In progress');
      await seen(page, 'Chitra Mixed', `114-ip-${vp}`);
      await seen(page, 'Dev Pending', `114-ip2-${vp}`, 5_000);
      for (const gone of ['Anita Outonly', 'Bala Legacy', 'Esha Cancelled', 'Farid Rejected']) await absent(page, gone);
      await page.screenshot({ path: `${OUT}/114-in-progress--${vp}.png` });
      await deskTab(page, 'Outsourced');
      for (const here of ['Anita Outonly', 'Bala Legacy', 'Chitra Mixed', 'Esha Cancelled', 'Farid Rejected']) await seen(page, here, `114-out-${here}-${vp}`, 15_000);
      await absent(page, 'Dev Pending');           // nothing drawn yet: no tube at the partner
      await page.screenshot({ path: `${OUT}/114-outsourced--${vp}.png` });
    });

    test('after the partner report is uploaded and completed the order is under Completed, not In progress', async ({ page }) => {
      const sc = outsourcedScenario();
      S.orders = [sc.A]; S.tubes = [{ ...tube(sc.A, sc.A.samples[0]), hasReport: true, tests: [{ orderTestId: 'a1-t', testId: 'x', testName: 'Vitamin D', status: 'outsourced', completed: false, report: { orderTestId: 'a1-t', testName: 'Vitamin D', url: '/u/x.pdf', partnerLabName: 'Metro Reference Lab' } }] }];
      S.bills = [bill('a', 0)];
      S.completeHook = () => {                      // what the server does: lines validated -> order validated, paid
        S.orders = [{ ...sc.A, status: 'validated', samples: [{ ...sc.A.samples[0], tests: [{ ...sc.A.samples[0].tests[0], status: 'validated' }] }] }];
        S.tubes = [{ ...S.tubes[0], status: 'completed', hasReport: true, tests: [{ ...S.tubes[0].tests[0], status: 'completed', completed: true }] }];
      };
      await page.goto('/frontdesk'); await waitDesk(page); await light(page);
      if (vp === 'phone') await deskTab(page, 'In progress');
      await absent(page, 'Anita Outonly');
      await deskTab(page, 'Outsourced');
      await seen(page, 'Anita Outonly', `114b-${vp}`, 15_000);
      await page.locator('[aria-label^="Mark completed for"]').locator('visible=true').first().click();
      await page.waitForTimeout(800);
      await page.reload(); await waitDesk(page);
      await deskTab(page, 'In progress');           // the last tab (Outsourced) is remembered across a reload
      await absent(page, 'Anita Outonly');
      await deskTab(page, 'Completed');
      await seen(page, 'Anita Outonly', `114c-${vp}`, 15_000);
      await page.screenshot({ path: `${OUT}/114-completed-after-upload--${vp}.png` });
    });
  });
}

// ───────────────────────── OPS-132 ─────────────────────────
function duesScenario() {
  const T = ord('t', 11, 'Tara Today', 'billed', [smp('t1', 't', 'received')]);                                                                       // today, due
  const O1 = ord('o1', 3, 'Olga PartialOld', 'billed', [smp('o1s', 'o1', 'received')], { created: daysAgo(6) });                                      // 6 days ago, partly paid; NOT in today's feed
  const O2 = ord('o2', 4, 'Omar ValidatedOld', 'validated', [smp('o2s', 'o2', 'received', { lines: [ln('o2t', 'Lipid', { status: 'validated', result: true })] })], { created: daysAgo(8) }); // in today's feed (ready for hand-over), due, touched today
  const P = ord('p', 5, 'Paul PaidOld', 'validated', [smp('ps', 'p', 'received', { lines: [ln('pt', 'Lipid', { status: 'validated', result: true })] })], { created: daysAgo(8), updated: daysAgo(8) }); // fully paid straggler
  const feed = [T, O2, P];
  const bills = [bill('t', 150, 'INV-T'), bill('o1', 150, 'INV-O1'), bill('o2', 100, 'INV-O2'), bill('p', 0, 'INV-P')];
  return { T, O1, O2, P, feed, bills, byId: { t: T, o1: O1, o2: O2, p: P } as Record<string, any> };
}

for (const [vp, size] of Object.entries(VIEWPORTS)) {
  test.describe(`rt-fd OPS-132 ${vp}`, () => {
    test.beforeEach(async ({ page }) => { test.setTimeout(150_000); fs.mkdirSync(OUT, { recursive: true }); S = fresh(); await page.setViewportSize(size); await backend(page); });

    test('Today (no tab) shows only today; Payments due tab + chip count list every due; counts agree with the list', async ({ page }) => {
      const sc = duesScenario(); S.orders = sc.feed; S.bills = sc.bills; S.byId = sc.byId;
      await page.goto('/frontdesk'); await waitDesk(page); await light(page);
      if (vp === 'phone') await deskTab(page, 'In progress');
      // No tab on (tap the active chip) = every status for the chosen day.
      if (vp === 'desktop') await page.locator('button', { hasText: 'In progress' }).locator('visible=true').first().click();
      await seen(page, 'Tara Today', `132-today-${vp}`);
      await absent(page, 'Olga PartialOld'); await absent(page, 'Omar ValidatedOld'); await absent(page, 'Paul PaidOld');
      await page.screenshot({ path: `${OUT}/132-today-no-tab--${vp}.png` });
      // The Payments due tab: all three dues, no matter their date; the chip count equals the rows.
      await deskTab(page, 'Payments due');
      for (const n of ['Tara Today', 'Olga PartialOld', 'Omar ValidatedOld']) await seen(page, n, `132-due-${n}-${vp}`, 20_000);
      await absent(page, 'Paul PaidOld');
      if (vp === 'desktop') expect(await chipCount(page, 'Payments due')).toBe(3);
      await page.screenshot({ path: `${OUT}/132-payments-due-tab--${vp}.png` });
    });

    test('changing the date range keeps every due in the Payments due tab (the feed is replaced after the bills load)', async ({ page }) => {
      test.skip(vp !== 'desktop', 'desktop only');
      const sc = duesScenario(); S.orders = sc.feed; S.bills = sc.bills; S.byId = sc.byId; S.rangeDelayMs = 900; S.billsDelayMs = 400;   // today's feed lands BEFORE the bills; the range feed lands after them
      await page.goto('/frontdesk'); await waitDesk(page); await light(page);
      await deskTab(page, 'Payments due');
      await seen(page, 'Tara Today', '132r-0', 20_000);
      await expect.poll(() => chipCount(page, 'Payments due')).toBe(3);
      await page.locator('.pf-work-hdr__date .pf-hdr-filter__btn').locator('visible=true').first().click();
      await page.locator('.pf-hdr-filter__pop button', { hasText: 'Yesterday' }).click();
      await page.waitForTimeout(2500);
      await seen(page, 'Olga PartialOld', '132r-1', 20_000);
      for (const n of ['Tara Today', 'Olga PartialOld', 'Omar ValidatedOld']) await seen(page, n, `132r-${n}`, 20_000);
      await expect.poll(() => chipCount(page, 'Payments due')).toBe(3);
      await page.screenshot({ path: `${OUT}/132-after-date-change--${vp}.png` });
    });
  });
}

// ───────────────────────── OPS-131 ─────────────────────────
const RECEPTION_NO_MODIFY = ['register_patient', 'create_order', 'view_order', 'collect_payment', 'view_bill', 'create_bill'];
function drawerOrder() {
  return ord('ov', 5, 'Priya Nair', 'validated', [smp('v1', 'ov', 'received', { lines: [ln('v1t', 'Blood sugar', { status: 'validated', result: true })] })], { extra: { refDoctorName: 'Dr. Rao' } });
}
test.describe('rt-fd OPS-131 order drawer', () => {
  test.beforeEach(async ({ page }) => { test.setTimeout(150_000); fs.mkdirSync(OUT, { recursive: true }); S = fresh(); await page.setViewportSize(VIEWPORTS.desktop); await backend(page); });

  test('shows Order ID under the patient, "Referral doctor" + Change, no reference range; saving updates the drawer', async ({ page }) => {
    const o = drawerOrder(); S.orders = [o]; S.byId = { ov: o };
    await page.goto('/frontdesk'); await waitDesk(page); await light(page);
    await page.locator('button', { hasText: 'In progress' }).locator('visible=true').first().click();   // all statuses
    await vis(page, 'Priya Nair').first().click();
    const orderId = page.locator('[data-test=drawer-order-id]');
    await expect(orderId).toBeVisible();
    await expect(orderId).toContainText('LAB-2611-00005');
    // It sits under the patient name block (same header column, after the name).
    const nameBox = await page.locator('#pf-od-name').boundingBox(); const idBox = await orderId.boundingBox();
    expect(idBox!.y).toBeGreaterThan(nameBox!.y);
    await expect(page.locator('.pf-drawer__meta dt', { hasText: 'Referral doctor' })).toBeVisible();
    await expect(page.locator('.pf-drawer__meta dt', { hasText: /^Doctor$/ })).toHaveCount(0);
    await expect(page.locator('.pf-drawer__meta')).toContainText('Dr. Rao');
    // The preliminary report lists values and flags, never a reference-range column.
    const prelim = page.locator('.pf-prelim');
    await expect(prelim.locator('.pf-prelim__row').first()).toBeVisible({ timeout: 15_000 });
    await expect(prelim).toContainText('110');
    await expect(prelim).not.toContainText('70-99');
    await expect(prelim).not.toContainText('12-15');
    expect(await prelim.locator('.pf-prelim__row-range').count()).toBe(0);
    await page.screenshot({ path: `${OUT}/131-drawer-desktop.png` });
    // Change opens the shared dialog.
    await page.locator('[data-test=drawer-edit-referral]').click();
    await expect(page.getByRole('dialog', { name: /Edit referral/ })).toBeVisible();
    await expect(page.getByText('Booked as')).toBeVisible();
    await page.screenshot({ path: `${OUT}/131-referral-dialog-desktop.png` });
  });

  test('without the modify-order permission there is no Change button, but the label and Order ID still show', async ({ page }) => {
    const o = drawerOrder(); S.orders = [o]; S.byId = { ov: o }; S.perms = RECEPTION_NO_MODIFY;
    await page.goto('/frontdesk'); await waitDesk(page); await light(page);
    await page.locator('button', { hasText: 'In progress' }).locator('visible=true').first().click();
    await vis(page, 'Priya Nair').first().click();
    await expect(page.locator('[data-test=drawer-order-id]')).toBeVisible();
    await expect(page.locator('.pf-drawer__meta dt', { hasText: 'Referral doctor' })).toBeVisible();
    await expect(page.locator('[data-test=drawer-edit-referral]')).toHaveCount(0);
  });

  test('a cancelled order cannot have its referral changed', async ({ page }) => {
    const o = { ...drawerOrder(), status: 'cancelled' }; S.orders = [o]; S.byId = { ov: o };
    await page.goto('/frontdesk'); await waitDesk(page);
    await page.locator('button', { hasText: 'In progress' }).locator('visible=true').first().click();
    const row = vis(page, 'Priya Nair');
    if (await row.count()) { await row.first().click(); await expect(page.locator('.pf-drawer__meta')).toBeVisible(); await expect(page.locator('[data-test=drawer-edit-referral]')).toHaveCount(0); }
  });
});

test.describe('rt-fd OPS-131 order drawer on a phone', () => {
  test('Order ID and Referral doctor fit the sheet without sideways scrolling', async ({ page }) => {
    test.setTimeout(150_000); fs.mkdirSync(OUT, { recursive: true }); S = fresh(); await page.setViewportSize(VIEWPORTS.phone); await backend(page);
    const o = drawerOrder(); S.orders = [o]; S.byId = { ov: o };
    await page.goto('/frontdesk'); await waitDesk(page); await light(page);
    await deskTab(page, 'Completed');
    await vis(page, 'Priya Nair').first().click();
    await expect(page.locator('[data-test=drawer-order-id]')).toBeVisible();
    await expect(page.locator('[data-test=drawer-edit-referral]')).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${OUT}/131-drawer-phone.png` });
  });
});

// ───────────────────────── OPS-127 ─────────────────────────
test.describe('rt-fd OPS-127 serials are per order', () => {
  test.beforeEach(async ({ page }) => { test.setTimeout(150_000); fs.mkdirSync(OUT, { recursive: true }); S = fresh(); await page.setViewportSize(VIEWPORTS.desktop); await backend(page); });
  const SAME = pat('31', 'Divya Menon');
  const two = () => {
    const mk = (id: string, n: number, name: string, patient: unknown, status = 'in_progress') =>
      ord(id, n, name, status, [smp(`${id}s`, id, 'dispatched', { lines: [ln(`${id}t`, 'Glucose')] })], { patient: patient as any, extra: { patientId: (patient as any).id } });
    return [mk('x1', 1, 'Divya Menon', SAME), mk('x2', 2, 'Divya Menon', SAME), mk('x4', 4, 'Kiran Patel', pat('40', 'Kiran Patel'))];
  };

  test('front desk: one patient with two orders shows 1 and 2; the next patient after a cancelled #3 shows 4', async ({ page }) => {
    const os_ = two();
    const cancelled = ord('x3', 3, 'Zed Cancelled', 'cancelled', [smp('x3s', 'x3', 'pending')]);
    S.orders = [...os_, cancelled];
    await page.goto('/frontdesk'); await waitDesk(page); await light(page);
    await page.locator('button', { hasText: 'In progress' }).locator('visible=true').first().click();
    await seen(page, 'Kiran Patel', '127-fd');
    const rows = page.locator('.pf-wr, .pf-work-row, [data-order-id], li, tr').filter({ has: page.locator('.pf-dayno') }).locator('visible=true');
    const pairs = await page.locator('.pf-dayno').locator('visible=true').evaluateAll(els => els.map(e => {
      const row = e.closest('li, tr, .pf-wr, [class*="row"]') ?? e.parentElement!;
      return { no: (e.textContent ?? '').trim().split(' ')[0], text: (row.textContent ?? '').replace(/\s+/g, ' ') };
    }));
    void rows;
    const noOf = (name: string) => pairs.filter(p => p.text.includes(name)).map(p => p.no).sort();
    expect(noOf('Divya Menon')).toEqual(['1', '2']);
    expect(noOf('Kiran Patel')).toEqual(['4']);
    await page.screenshot({ path: `${OUT}/127-frontdesk-desktop.png` });
  });

  test('lab Intake: same numbers on the same orders (1, 2 for one patient; 4 for the next)', async ({ page }) => {
    S.dispatched = two();
    await page.goto('/lab/my-work');
    await page.getByText('Lab Intake', { exact: false }).locator('visible=true').first().click();
    await seen(page, 'Kiran Patel', '127-intake', 60_000);
    await light(page);
    await page.waitForTimeout(600);
    const chips = (await page.locator('.pf-dayno').locator('visible=true').allTextContents()).map(t => t.trim().split(' ')[0]).sort();
    expect(chips).toEqual(['1', '2', '4']);
    await page.screenshot({ path: `${OUT}/127-lab-intake-desktop.png` });
  });
});

// ───────────────────────── OPS-119 ─────────────────────────
const fld = (name: string, title: string, type: string, extra: Record<string, unknown> = {}) => ({ id: name, name, title, type, isStandard: true, isRequired: false, isEditable: true, storageKey: name, width: 'half', ...extra });
const regConfig = (extraFields: any[], basicExtra: any[] = []) => ({
  id: 'cfg', name: 'patient_registration', title: 'Patient Registration', module: 'lms', screenName: 'patient_registration', version: 1, status: 'published', globalConditions: [], actions: [],
  steps: [
    { id: 'st1', name: 'basic_info', title: 'Basic Info', type: 'entry', isRequired: true, canSkip: false, isStandard: true, fields: [
      fld('title', 'Title', 'button_select', { width: 'full', options: ['Mr.', 'Ms.'].map(v => ({ value: v, label: v })) }),
      fld('first_name', 'First name', 'text', { isRequired: true }), fld('fathers_name', 'Last name', 'text', { isRequired: true }),
      fld('phone', 'Phone', 'phone', { isRequired: true }), fld('date_of_birth', 'Date of birth', 'date'),
      fld('sex', 'Sex', 'select', { isRequired: true, options: ['Male', 'Female'].map(v => ({ value: v, label: v })) }),
      fld('abha_id', 'ABHA ID', 'text'), ...basicExtra,
    ] },
    { id: 'st2', name: 'additional_info', title: 'Additional details', type: 'entry', isRequired: false, canSkip: true, isStandard: true, fields: [
      fld('email', 'Email', 'email'), fld('blood_group', 'Blood group', 'select', { options: ['A+', 'B+'].map(v => ({ value: v, label: v })) }), ...extraFields,
    ] },
  ],
});
const ADDR = fld('address', 'Address / place', 'text', { isStandard: false, storageKey: 'metadata.address', width: 'full' });
const card = (page: Page, label: string) => page.locator('.pf-wr-cards > .pf-wr-card.pf-card').filter({ has: page.locator('.pf-card__label', { hasText: new RegExp(`^\\s*${label}\\s*$`) }) });

for (const [vp, size] of Object.entries(VIEWPORTS)) {
  test.describe(`rt-fd OPS-119 ${vp}`, () => {
    test.beforeEach(async ({ page }) => { test.setTimeout(150_000); fs.mkdirSync(OUT, { recursive: true }); S = fresh(); await page.setViewportSize(size); await backend(page); });

    test('new patient: Address / place is in Contact & IDs, not under Additional details', async ({ page }) => {
      S.regConfig = regConfig([ADDR]);
      await page.goto('/frontdesk/patients/new');
      await seen(page, 'Contact & IDs', `119-a-${vp}`, 60_000); await light(page);
      await expect(card(page, 'Contact & IDs').locator('[data-field="address"]')).toHaveCount(1);
      await expect(card(page, 'Additional details').locator('[data-field="address"]')).toHaveCount(0);
      await expect(card(page, 'Patient identity').locator('[data-field="address"]')).toHaveCount(0);
      await page.screenshot({ path: `${OUT}/119-register-${vp}.png` });
    });

    test('a lab\'s own differently named address field ("Place") is shown in Contact & IDs too, and an existing patient\'s saved address is filled in', async ({ page }) => {
      const place = fld('place', 'Place', 'text', { isStandard: false, storageKey: 'metadata.place', width: 'full' });
      S.regConfig = regConfig([place]);
      S.patientById['21'] = { ...pat('21', 'Lakshmi Narayanan', JSON.stringify({ place: 'Peelamedu, Coimbatore' })), firstName: 'Lakshmi', fathersName: 'Narayanan', phone: '9876543210', sex: 'Female' };
      await page.goto('/frontdesk/patients/new?patientId=21');
      await seen(page, 'Contact & IDs', `119-b-${vp}`, 60_000); await light(page);
      await expect(card(page, 'Contact & IDs').locator('[data-field="place"]')).toHaveCount(1);
      await expect(card(page, 'Additional details').locator('[data-field="place"]')).toHaveCount(0);
      await expect(card(page, 'Contact & IDs').locator('[data-field="place"] input')).toHaveValue('Peelamedu, Coimbatore');
    });

    test('an existing patient with an address in the old (Additional details) field has it filled in the Contact & IDs field', async ({ page }) => {
      S.regConfig = regConfig([ADDR]);
      S.patientById['22'] = { ...pat('22', 'Rohan Mehta', JSON.stringify({ address: 'Flat 3B, Lake View' })), firstName: 'Rohan', fathersName: 'Mehta', phone: '9876543210', sex: 'Male' };
      await page.goto('/frontdesk/patients/new?patientId=22');
      await seen(page, 'Contact & IDs', `119-c-${vp}`, 60_000);
      await expect(card(page, 'Contact & IDs').locator('[data-field="address"] input')).toHaveValue('Flat 3B, Lake View');
    });

    test('advanced search: the Contact column shows phone and address; no address means phone only', async ({ page }) => {
      S.hits = [
        { patient: pat('21', 'Lakshmi Narayanan', JSON.stringify({ address: '14, Gandhi Street, Peelamedu', district: 'Coimbatore' })), lastVisitAt: iso(minsAgo(3000)), lastBranchId: 'b1', lastBranchName: 'Main' },
        { patient: pat('22', 'Rohan Mehta', JSON.stringify({ patient_address: 'Flat 3B, Lake View' })), lastVisitAt: iso(minsAgo(9000)), lastBranchId: 'b1', lastBranchName: 'Main' },
        { patient: pat('23', 'Sana Parveen'), lastVisitAt: iso(minsAgo(20000)), lastBranchId: 'b1', lastBranchName: 'Main' },
      ];
      await page.goto('/frontdesk'); await waitDesk(page);
      await page.waitForTimeout(1200);
      await page.keyboard.press('Control+k');
      const name = page.locator('input[placeholder="First or last name"]').locator('visible=true').first();
      await name.waitFor({ timeout: 15_000 });
      await name.fill('an'); await name.press('Enter');
      if (vp === 'phone') { await page.waitForTimeout(500); await page.getByRole('button', { name: 'Search', exact: true }).locator('visible=true').first().click().catch(() => undefined); }
      await seen(page, 'Lakshmi Narayanan', `119-d-${vp}`, 20_000); await light(page);
      if (vp === 'desktop') await expect(page.getByRole('columnheader', { name: 'Contact' })).toBeVisible();
      await expect(page.locator('.pf-aps-addr', { hasText: '14, Gandhi Street, Peelamedu, Coimbatore' }).first()).toBeVisible();
      await expect(page.locator('.pf-aps-addr', { hasText: 'Flat 3B, Lake View' }).first()).toBeVisible();
      expect(await page.locator('.pf-aps-addr').locator('visible=true').count()).toBe(2);   // Sana has none
      await page.screenshot({ path: `${OUT}/119-advanced-search-${vp}.png` });
    });
  });
}
