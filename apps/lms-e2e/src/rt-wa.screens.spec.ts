import type { Page, BrowserContext } from '@playwright/test';
import { test, expect, shotsDir, expectLayout, expectFitsWidth, isDesktopApp, isDesktopWeb, bridgeCalls } from './support/form-factor';
import { deskTab } from './support/frontdesk';
import { openChat, expectedVia } from './support/whatsapp';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * WhatsApp sharing re-test (OPS-122 + the 2026-11-13 owner asks), element-based, API mocked, demo data only, light:
 *  1. Front desk Completed row → Share → WhatsApp (WhatsApp Chat, web): a NEW TAB opens (window.open with NO popup
 *     features), it opens IN the click (about:blank first, before the report fetch answers) and is pointed at
 *     WhatsApp's click-to-chat link; no "blocked" / error toast.
 *  2. An order whose referral doctor has a number: the Share menu offers "Send to patient" / "Send to doctor";
 *     each opens the chat of the right number with the right message.
 *  3. The order drawer's Referral doctor line shows the doctor's phone.
 *  4. The front-desk invoice viewer's WhatsApp button (OPS-122): a new tab to the patient with the invoice message,
 *     the invoice PDF downloads and the "attach it" hint shows (OPS-126: the PDF goes with it).
 * Every form factor (playwright.screens.config.ts projects): the web opens a NEW TAB; the desktop app calls the dock
 * bridge (electronAPI.whatsapp.open) and copies the invoice PDF (whatsapp.setPdf, copyToClipboard) — no tab, no
 * download; a phone / tablet opens wa.me (this browser can't share files) and saves the PDF.
 * WhatsApp itself is never contacted: web.whatsapp.com / wa.me are answered by a stub page.
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/retest-1113/rt-wa');
let OUT = OUT_BASE;

const TENANT = { id: 't-demo', name: 'Demo Lab' };
const ME = { id: 'app-1', authId: 'sub-1', first: 'Kavya', last: 'Desk' };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub: string) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 86400, email: `${sub}@demo.test` })}.sig`;

const now = new Date();
const iso = (d: Date) => d.toISOString();
const minsAgo = (m: number) => new Date(now.getTime() - m * 60000);
const PARAMS = JSON.stringify({ parameters: [{ name: 'hb', title: 'Haemoglobin', unit: 'g/dL' }] });
const PATIENT_PHONE = '+919876543210';
const DOCTOR_PHONE = '+919845012345';
const pat = (id: string, name: string) => ({ id, displayName: name, firstName: name.split(' ')[0], gender: 'F', sex: 'Female', age: 34, mrn: `26${id.padStart(4, '0')}`, phone: PATIENT_PHONE });
const tline = (id: string, name: string) => ({ id, status: 'validated', test: { name, parameters: PARAMS, sampleType: 'Whole blood' } });
const sample = (id: string, orderId: string) => ({
  id, orderId, status: 'received', barcode: `B-${id}`, tubeColor: 'lavender', rejectionCount: 0, collectedAt: iso(minsAgo(60)),
  department: { id: 'd1', name: 'Haematology', code: 'HEM' }, tests: [tline(`${id}-t`, 'Haemoglobin')],
});
const order = (id: string, n: number, name: string, extra: Record<string, unknown> = {}) => ({
  id, orderNumber: `LAB-2611-0000${n}`, dailyNo: n, dailyNoDay: iso(now).slice(0, 10), patientId: `p${n}`, branchId: 'b1', patient: pat(String(n), name),
  priority: 'Normal', source: 'walkin', collectionType: 'walkin', status: 'validated', billStatus: 'paid', netPaid: 400,
  createdAt: iso(minsAgo(120)), updatedAt: iso(now), samples: [sample(`${id}-s`, id)], ...extra,
});
const PLAIN = order('op', 4, 'Priya Nair');
const WITH_DOC = order('od', 6, 'Anitha Raj', { refDoctorId: 'doc1', refDoctorName: 'Dr. Ravi Kumar', refDoctorPhone: DOCTOR_PHONE });
const ORDERS = [PLAIN, WITH_DOC];
const report = (o: { id: string; patient: unknown }) => ({
  id: `r-${o.id}`, orderId: o.id, type: 'final', status: 'generated', qrToken: `tok-${o.id}`, createdAt: iso(minsAgo(10)), patient: o.patient,
});
const BILL = (o: { id: string; patientId: string }) => ({
  id: `b-${o.id}`, orderId: o.id, patientId: o.patientId, branchId: 'b1', type: 'lab', invoiceNumber: 'INV-001033', isInterstate: false,
  subTotal: 400, overrideDiscount: 0, totalDiscount: 0, totalTaxable: 400, totalCgst: 0, totalSgst: 0, totalIgst: 0, totalTax: 0,
  totalPayable: 400, totalPaid: 400, balance: 0, status: 'paid', createdAt: iso(minsAgo(120)),
  items: [{ id: 'bi1', itemType: 'test', itemId: 't1', name: 'Complete Blood Count', quantity: 1, unitPrice: 400, discount: 0, taxable: 400, gstRate: 0, cgst: 0, sgst: 0, igst: 0, total: 400 }],
  payments: [{ id: 'pay1', amount: 400, mode: 'cash', paidAt: iso(minsAgo(110)) }],
});

/** Slow the report fetch so the test can see the tab open BEFORE it answers (the click's own window). */
let reportDelayMs = 0;
let reportAnswered = false;

async function backend(page: Page, context: BrowserContext) {
  const cors = (origin: string) => ({ 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
  const ok = (origin: string, data: unknown) => ({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: true, data }) });
  await page.route(/prefrontal\.health\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    const u = new URL(req.url()); const p = u.pathname;
    if (p === '/api/auth/me') return route.fulfill(ok(origin, { id: ME.id, authId: ME.authId, firstName: ME.first, fathersName: ME.last, displayName: `${ME.first} ${ME.last}`, email: 'desk@demo.test', tenantId: TENANT.id, tenantName: TENANT.name, branchId: 'b1', branchName: 'Main', roles: ['Lab Admin'], permissions: ['*'], branches: [{ id: 'b1', name: 'Main' }], modules: ['lab'], hasPin: false }));
    if (p === '/api/tenants/modules') return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: false }) });
    if (p === '/api/tenants/current') return route.fulfill(ok(origin, { id: TENANT.id, name: TENANT.name }));
    if (p === '/api/tenants/branches') return route.fulfill(ok(origin, [{ id: 'b1', name: 'Main' }]));
    if (p === '/api/process-workflows/active') return route.fulfill(ok(origin, null));
    // No server sender → the ONE WhatsApp mode is WhatsApp Chat.
    if (p === '/api/whatsapp/settings') return route.fulfill(ok(origin, { canSend: false }));
    if (p === '/api/orders/today' || p === '/api/orders/range') return route.fulfill(ok(origin, ORDERS));
    if (p === '/api/billing/outstanding') return route.fulfill(ok(origin, { due: [], refundsOwed: [] }));
    const byOrder = /^\/api\/reports\/by-order\/([^/]+)$/.exec(p);
    if (byOrder) {
      const o = ORDERS.find(x => x.id === byOrder[1]);
      if (reportDelayMs) await new Promise(r => setTimeout(r, reportDelayMs));
      reportAnswered = true;
      return route.fulfill(o ? ok(origin, report(o)) : { status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: false, error: 'not_found', message: 'No report for this order' }) });
    }
    const st = /^\/api\/whatsapp\/reports\/r-([^/]+)$/.exec(p);
    if (st) {
      const o = ORDERS.find(x => x.id === st[1]) as Record<string, any> | undefined;
      return route.fulfill(ok(origin, { reportId: `r-${st[1]}`, patientId: o?.['patientId'], patientOptOut: false, autoSendEnabled: false, configured: false, canSend: false, latest: null, history: [],
        referralDoctor: o?.['refDoctorPhone'] ? { name: o['refDoctorName'], phone: o['refDoctorPhone'] } : null }));
    }
    if (p === '/api/billing/' && req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const o = ORDERS.find(x => x.id === body.orderId) ?? PLAIN;
      return route.fulfill(ok(origin, BILL(o)));
    }
    if (p === '/api/config/invoice-template') return route.fulfill(ok(origin, { labName: TENANT.name, showLogo: false }));
    const track = /^\/api\/orders\/([^/]+)\/track-token$/.exec(p);
    if (track) return route.fulfill(ok(origin, { token: `trk-${track[1]}` }));
    const one = /^\/api\/orders\/([^/]+)$/.exec(p);
    if (one) return route.fulfill(ok(origin, ORDERS.find(x => x.id === one[1]) ?? PLAIN));
    if (req.method() === 'GET') return route.fulfill(ok(origin, []));
    return route.fulfill(ok(origin, {}));
  });
  await page.route(/supabase\.co\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ access_token: jwt(ME.authId), refresh_token: `rt-${ME.authId}`, token_type: 'bearer', expires_in: 86400, user: { id: ME.authId, aud: 'authenticated', email: 'desk@demo.test' } }) });
  });
  // WhatsApp is never contacted: the new tab lands on a stub.
  await context.route(/(whatsapp\.com|wa\.me)\//, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>WhatsApp (stub)</title><p>stub</p>' }));
  await page.routeWebSocket(/\/hubs\//, ws => { ws.onMessage(() => ws.send('{}\x1e')); });
  await page.addInitScript(([session]) => {
    if (!sessionStorage.getItem('pf.e2e.seeded')) {
      sessionStorage.setItem('pf.e2e.seeded', '1'); localStorage.clear();
      localStorage.setItem('pf.session', session as string); localStorage.setItem('pf-design', 'new');
      localStorage.setItem('pf.wa.manual.reminded', '1');
    }
    // Record every window.open (url, target, features) and still open it for real.
    const w = window as unknown as { __opens: string[][]; open: typeof window.open };
    w.__opens = [];
    const orig = window.open.bind(window);
    w.open = ((...a: unknown[]) => { w.__opens.push(a.map(x => String(x))); return orig(...(a as Parameters<typeof window.open>)); }) as typeof window.open;
  }, [JSON.stringify({ access_token: jwt(ME.authId), refresh_token: `rt-${ME.authId}` })] as const);
}

async function light(page: Page) {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => { const r = document.documentElement; r.classList.remove('dark'); r.classList.add('light'); r.setAttribute('data-theme', 'light'); });
  await page.waitForTimeout(300);
}

async function openDesk(page: Page) {
  await page.goto('/frontdesk');
  await page.getByPlaceholder(/Search patient/).locator('visible=true').first().waitFor({ timeout: 60_000 });
  await light(page);
  await deskTab(page, 'Completed');
  await expect(page.getByText('Priya Nair').locator('visible=true').first()).toBeVisible({ timeout: 20_000 });
}

/** The row's Share button (one per Completed row): a grid row (`.pf-wrow`, ≥1024) or the shared work list's row
 *  (`.pf-wl__row`, below 1024 — owner 2026-11-21, small-screens), which draws the same Next cell. */
function shareButton(page: Page, name: string) {
  return page.locator('.pf-wrow, pf-work-list .pf-wl__row').filter({ hasText: name })
    .locator('button[aria-label="Share report"]').locator('visible=true').first();
}

const opens = (page: Page) => page.evaluate(() => (window as unknown as { __opens: string[][] }).__opens);
const noErrorToast = async (page: Page) => {
  await expect(page.getByText(/blocked the WhatsApp/i)).toHaveCount(0);
  await expect(page.getByText(/Could not prepare the report/i)).toHaveCount(0);
  await expect(page.getByText(/Could not open WhatsApp/i)).toHaveCount(0);
};
const chat = (url: string) => { const u = new URL(url); return { origin: u.origin, path: u.pathname, phone: u.searchParams.get('phone'), text: u.searchParams.get('text') ?? '' }; };

const noWindowOpen = async (page: Page) => expect(await opens(page), 'the desktop app opens no browser tab').toEqual([]);

test.describe('rt-wa: WhatsApp sharing at every form factor', () => {
  test.beforeEach(async ({ page, context }) => {
    test.setTimeout(150_000);
    OUT = shotsDir(OUT_BASE);
    reportDelayMs = 0; reportAnswered = false;
    await backend(page, context);
  });

  test('1. Share → WhatsApp opens the patient\'s chat in ONE click (web: a new tab opened in the click; desktop app: the dock; touch: wa.me); no error toast', async ({ page }) => {
    await openDesk(page);
    await expectLayout(page, 'front desk Completed');
    reportDelayMs = 1500;
    await shareButton(page, 'Priya Nair').click();
    // No doctor number on this order: the ONE WhatsApp row.
    await expect(page.locator('[data-test="share-whatsapp-doctor"]')).toHaveCount(0);
    await expectFitsWidth(page, '[data-test="share-whatsapp"]', 'share menu row');
    let answeredAtOpen: boolean | null = null;
    if (isDesktopWeb()) page.once('popup', () => { answeredAtOpen = reportAnswered; });
    const c = await openChat(page, () => page.locator('[data-test="share-whatsapp"]').locator('visible=true').first().click());
    expect(c.via).toBe(expectedVia(false));
    expect(c.phone).toBe('919876543210');
    expect(c.text).toContain('Dear Priya Nair, your report from Demo Lab is ready.');
    expect(c.text).toContain('/reports/public/tok-op');
    const calls = await opens(page);
    if (isDesktopWeb()) {
      // The tab exists while the report is still being fetched: it was opened by the click itself.
      expect(answeredAtOpen).toBe(false);
      expect(calls[0]).toEqual(['about:blank', '_blank']);          // the click opened the tab at once
      expect(calls.every(x => x.length <= 2)).toBe(true);            // never "popup=yes,width=…" → a tab, not a window
    } else if (isDesktopApp()) {
      await noWindowOpen(page);
      await expect(page.locator('[data-testid=wa-dock]')).toBeVisible();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/rt-wa-desktop-app-dock-open.png` });
    } else {
      expect(calls.some(x => x[0] === 'about:blank'), 'touch: no blank tab primed').toBe(false);
    }
    await noErrorToast(page);
  });

  test('2. a referral doctor with a number: "Send to patient" / "Send to doctor", each to the right number', async ({ page }) => {
    await openDesk(page);
    await shareButton(page, 'Anitha Raj').click();
    const toPatient = page.locator('[data-test="share-whatsapp-patient"]').locator('visible=true').first();
    const toDoctor = page.locator('[data-test="share-whatsapp-doctor"]').locator('visible=true').first();
    await expect(toPatient).toHaveText(/Send to patient/);
    await expect(toDoctor).toHaveText(/Send to doctor/);
    await expect(page.locator('[data-test="share-whatsapp"]').locator('visible=true')).toHaveCount(0);
    await expectFitsWidth(page, '[data-test="share-whatsapp-doctor"]', 'share menu doctor row');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/rt-wa-share-menu-doctor-choice.png` });

    let c = await openChat(page, () => toDoctor.click());
    expect(c.via).toBe(expectedVia(false));
    expect(c.phone).toBe('919845012345');
    expect(c.text).toContain('Dear Dr. Ravi Kumar, the report of Anitha Raj from Demo Lab is ready.');
    await noErrorToast(page);

    await shareButton(page, 'Anitha Raj').click();
    c = await openChat(page, () => page.locator('[data-test="share-whatsapp-patient"]').locator('visible=true').first().click());
    expect(c.phone).toBe('919876543210');
    expect(c.text).toContain('Dear Anitha Raj, your report from Demo Lab is ready.');
    await noErrorToast(page);
    if (isDesktopApp()) { await noWindowOpen(page); expect((await bridgeCalls(page, 'whatsapp.open')).length).toBe(2); }
  });

  test('3. the order drawer shows the referral doctor\'s phone', async ({ page }) => {
    await openDesk(page);
    await page.getByText('Anitha Raj').locator('visible=true').first().click();
    const phone = page.locator('[data-test="drawer-doctor-phone"]');
    await expect(phone).toBeVisible({ timeout: 15_000 });
    await expect(phone).toHaveText(DOCTOR_PHONE);
    await expect(phone).toHaveAttribute('href', `tel:${DOCTOR_PHONE}`);
    await expectFitsWidth(page, '[data-test="drawer-doctor-phone"]', 'doctor phone');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/rt-wa-drawer-doctor-phone.png` });
    // An order without a referral doctor shows no phone.
    await page.keyboard.press('Escape');
    await page.locator('button[aria-label="Close"]').locator('visible=true').first().click().catch(() => {});
    await page.getByText('Priya Nair').locator('visible=true').first().click();
    await expect(page.locator('[data-test="drawer-doctor-phone"]')).toHaveCount(0);
  });

  test('4. invoice viewer → WhatsApp: the patient\'s chat with the invoice message, and the PDF goes with it (web/touch: downloaded + hint; desktop app: copied to the clipboard) (OPS-122/126)', async ({ page }) => {
    await openDesk(page);
    await page.getByText('Priya Nair').locator('visible=true').first().click();
    await page.locator('button[aria-label="View invoice"]').locator('visible=true').first().click();
    const wa = page.locator('[data-test="invoice-whatsapp"]');
    await expect(wa).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/rt-wa-invoice-viewer-whatsapp.png` });
    const downloads: string[] = [];
    page.on('download', d => downloads.push(d.suggestedFilename()));
    const c = await openChat(page, () => wa.click());
    expect(c.via).toBe(expectedVia(false));
    expect(c.phone).toBe('919876543210');
    expect(c.text).toContain('your invoice from Demo Lab');
    expect(c.text).toContain('INV-001033');
    if (isDesktopApp()) {
      await expect.poll(async () => (await bridgeCalls(page, 'whatsapp.setPdf')).length, { message: 'the PDF is handed to main' }).toBe(1);
      const pdf = (await bridgeCalls(page, 'whatsapp.setPdf'))[0].args[0] as { name: string; copyToClipboard: boolean; bytes: { bytes: number } };
      expect(pdf.name).toBe('INV-001033.pdf');
      expect(pdf.copyToClipboard).toBe(true);
      expect(pdf.bytes.bytes).toBeGreaterThan(100);
      await page.waitForTimeout(800);
      expect(downloads, 'the desktop app downloads nothing').toEqual([]);
      await noWindowOpen(page);
      await expect(page.locator('[data-testid=wa-dock]')).toBeVisible();
      // Our dock header: the PDF is on the clipboard — paste it (and it is not called a "report").
      const line = page.locator('[data-testid=wa-dock-line]');
      await expect(line).toHaveText(/^PDF copied — press (Ctrl|Cmd)\+V in the chat to attach it, then Send\.$/);
      await expect(page.locator('[data-testid=wa-dock-pdf]')).toBeVisible();
    } else {
      await expect.poll(() => downloads, { message: 'the invoice PDF downloads' }).toEqual(['INV-001033.pdf']);
      await expect(page.getByText('The PDF was downloaded — attach it with the paperclip.')).toBeVisible({ timeout: 10_000 });
      if (isDesktopWeb()) expect((await opens(page)).every(x => x.length <= 2)).toBe(true);
    }
    await noErrorToast(page);
  });
});
