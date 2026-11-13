import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * OPS-122/131/132 review screenshots: the front desk Today list (no past dues), the order drawer
 * (Order ID, Referral doctor + Change, no reference range) and the invoice viewer WhatsApp button. Offline; demo data only.
 * Not part of the suite (own config: playwright.screens.config.ts).
 */
const OUT = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/fix-1113/fx-desk');

const TENANT = { id: 't-demo', name: 'Demo Lab' };
const ME = { id: 'app-1', authId: 'sub-1', first: 'Kavya', last: 'Desk' };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub: string) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 86400, email: `${sub}@demo.test` })}.sig`;


const now = new Date();
const iso = (d: Date) => d.toISOString();
const old = new Date(now.getTime() - 5 * 86400000);
const PARAMS = JSON.stringify({ parameters: [{ name: 'glu', title: 'Fasting Blood Sugar', unit: 'mg/dL' }, { name: 'hb', title: 'Haemoglobin', unit: 'g/dL' }] });
const RESULT = JSON.stringify({ values: { glu: '110', hb: '18' }, flagged: { glu: { flag: 'N', range: '70-99' }, hb: { flag: 'H', range: '12-15' } } });
const pat = (id: string, name: string) => ({ id, displayName: name, firstName: name.split(' ')[0], gender: 'F', age: 34, mrn: `26${id.padStart(4, '0')}`, phone: '+919876543210' });
const line = (id: string, status: string) => ({ id, status, currentResult: RESULT, test: { name: 'Blood sugar', parameters: PARAMS } });
const order = (id: string, n: number, name: string, createdAt: Date, status: string, extra: Record<string, unknown> = {}) => ({
  id, orderNumber: `LAB-2611-0000${n}`, dailyNo: n, dailyNoDay: iso(createdAt).slice(0, 10), patientId: `p${n}`, branchId: 'b1', patient: pat(String(n), name),
  priority: 'Normal', source: 'walkin', collectionType: 'walkin', status, createdAt: iso(createdAt), updatedAt: iso(now),
  samples: [{ id: `${id}-s1`, orderId: id, status: status === 'validated' ? 'received' : 'collected', barcode: `2611${n}`, department: { id: 'd1', name: 'Biochemistry', code: 'BIO' }, tests: [line(`${id}-t1`, status === 'validated' ? 'validated' : 'pending')] }],
  ...extra,
});
const A = order('oa', 12, 'Meena Iyer', now, 'validated', { refDoctorName: 'Dr. Rao' });
const B = order('ob', 5, 'Hemanth Kumar', old, 'billed');     // created 5 days ago, due, touched today
const C = order('oc', 13, 'Savitha Rajan', now, 'billed');    // created today, due
const bill = (o: { id: string }, balance: number) => ({ id: `b-${o.id}`, orderId: o.id, patientId: 'p', branchId: 'b1', type: 'lab', invoiceNumber: `INV-0010${o.id.length}`, isInterstate: false, subTotal: 400, overrideDiscount: 0, totalDiscount: 0,
  totalTaxable: 400, totalCgst: 0, totalSgst: 0, totalIgst: 0, totalTax: 0, totalPayable: 400, totalPaid: 400 - balance, balance, status: balance ? 'partial' : 'paid', createdAt: iso(now),
  items: [{ id: 'i1', testId: 't1', testName: 'Blood sugar', quantity: 1, unitPrice: 400, discount: 0, taxableValue: 400, taxRate: 0, taxAmount: 0, total: 400 }], payments: [] });
const ORDERS = [A, B, C];

async function backend(page: Page, o: { perms?: string[] } = {}) {
  const cors = (origin: string) => ({ 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
  const ok = (origin: string, data: unknown) => ({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: true, data }) });
  await page.route(/prefrontal\.health\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    const u = new URL(req.url()); const p = u.pathname;
    if (p === '/api/auth/me') return route.fulfill(ok(origin, { id: ME.id, authId: ME.authId, firstName: ME.first, fathersName: ME.last, displayName: `${ME.first} ${ME.last}`, email: 'desk@demo.test', tenantId: TENANT.id, tenantName: TENANT.name, branchId: 'b1', branchName: 'Main', roles: ['Lab Admin'], permissions: o.perms ?? ['*'], branches: [{ id: 'b1', name: 'Main' }], modules: ['lab'], hasPin: false }));
    if (p === '/api/tenants/modules') return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: false }) });
    if (p === '/api/tenants/current') return route.fulfill(ok(origin, { id: TENANT.id, name: TENANT.name }));
    if (p === '/api/process-workflows/active') return route.fulfill(ok(origin, null));
    if (p === '/api/whatsapp/settings') return route.fulfill(ok(origin, { canSend: false }));
    if (p === '/api/orders/today' || p === '/api/orders/range') return route.fulfill(ok(origin, ORDERS));
    if (p === '/api/billing/outstanding') return route.fulfill(ok(origin, { due: [bill(B, 150), bill(C, 150)], refundsOwed: [] }));
    if (p === '/api/billing/' && req.method() === 'POST') return route.fulfill(ok(origin, bill(A, 0)));
    if (p === '/api/config/invoice-template') return route.fulfill(ok(origin, { labName: TENANT.name }));
    if (/\/api\/orders\/[^/]+\/track-token$/.test(p)) return route.fulfill(ok(origin, { token: 'tok123' }));
    if (/\/api\/orders\/[^/]+\/referral$/.test(p)) return route.fulfill(ok(origin, { orderId: 'oa', orderNumber: A.orderNumber, status: 'validated', patientName: 'Meena Iyer', refDoctorName: 'Dr. Rao', sourceTypes: ['Doctor', 'Hospital', 'Self'] }));
    const m = /^\/api\/orders\/([^/]+)$/.exec(p);
    if (m) return route.fulfill(ok(origin, ORDERS.find(x => x.id === m[1]) ?? A));
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

test('fx-desk screens', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await backend(page);
  await page.goto('/frontdesk');
  await expect(page.getByText('Savitha Rajan').first()).toBeVisible({ timeout: 60_000 });
  await light(page);
  // Today + no status chip (tap the active "In progress" chip off): only today's orders; the 5-day-old due is NOT listed.
  await page.getByText('In progress', { exact: false }).first().click();
  await expect(page.getByText('Meena Iyer').first()).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/01-today-no-filter.png` });
  expect(await page.getByText('Hemanth Kumar').count()).toBe(0);
  // Order drawer.
  await page.getByText('Meena Iyer').first().click();
  await expect(page.locator('[data-test=drawer-order-id]')).toBeVisible();
  await expect(page.locator('.pf-prelim__row').first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/02-order-drawer.png` });
  // Referral dialog.
  await page.locator('[data-test=drawer-edit-referral]').click();
  await expect(page.locator('.pf-erd__card')).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/03-referral-dialog.png` });
  await page.locator('.pf-erd__close').click();
  // Invoice viewer.
  await page.getByRole('button', { name: 'View invoice' }).click();
  await expect(page.locator('[data-test=invoice-whatsapp]')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/04-invoice-viewer-whatsapp.png` });
});
