import type { BrowserContext, Page } from '@playwright/test';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  test, expect, shotsDir, isTouch, isPhone, isDesktopApp, projectName, engine,
  expectDeviceTier, expectNoHorizontalScroll, expectRowFits,
} from './support/form-factor';
import { openComms as sharedOpenComms, pickCommsTab as sharedPickCommsTab } from './support/neg-backend';

/**
 * Settings → Communication (WhatsApp, Email, SMS) + Email sharing + SMS Chat (2026-11-13), element-based,
 * API mocked (the prefrontal-mw contract in pf-work/comms/BRIEF.md), demo data only.
 *
 * Runs once per form-factor project of playwright.screens.config.ts (support/form-factor.ts):
 *   phone / tablet / tablet-landscape (touch)  → SMS rows (iOS UA → `sms:NUMBER&body=`)
 *   desktop / desktop-app (mouse)              → never SMS
 * The desktop app is the shared preload stub (window.electronAPI, hash routing); Electron is never launched.
 * Screenshots: SHOTS_DIR/<project>/.
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/comms/cm-ui');
const out = () => shotsDir(OUT_BASE);

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
const pat = (id: string, name: string, email: string | null) => ({ id, displayName: name, firstName: name.split(' ')[0], gender: 'F', sex: 'Female', age: 34, mrn: `26${id.padStart(4, '0')}`, phone: PATIENT_PHONE, email });
const sample = (id: string, orderId: string) => ({
  id, orderId, status: 'received', barcode: `B-${id}`, tubeColor: 'lavender', rejectionCount: 0, collectedAt: iso(minsAgo(60)),
  department: { id: 'd1', name: 'Haematology', code: 'HEM' }, tests: [{ id: `${id}-t`, status: 'validated', test: { name: 'Haemoglobin', parameters: PARAMS, sampleType: 'Whole blood' } }],
});
const order = (id: string, n: number, name: string, email: string | null, extra: Record<string, unknown> = {}) => ({
  id, orderNumber: `LAB-2611-0000${n}`, dailyNo: n, dailyNoDay: iso(now).slice(0, 10), patientId: `p${n}`, branchId: 'b1', patient: pat(String(n), name, email),
  priority: 'Normal', source: 'walkin', collectionType: 'walkin', status: 'validated', billStatus: 'paid', netPaid: 400,
  createdAt: iso(minsAgo(120)), updatedAt: iso(now), samples: [sample(`${id}-s`, id)], ...extra,
});
const PLAIN = order('op', 4, 'Priya Nair', 'priya@example.com');
const WITH_DOC = order('od', 6, 'Anitha Raj', 'anitha@example.com', { refDoctorId: 'doc1', refDoctorName: 'Dr. Ravi Kumar', refDoctorPhone: DOCTOR_PHONE, refDoctorEmail: 'ravi@clinic.example' });
const ORDERS = [PLAIN, WITH_DOC];
const report = (o: { id: string; patient: unknown }) => ({ id: `r-${o.id}`, orderId: o.id, type: 'final', status: 'generated', qrToken: `tok-${o.id}`, createdAt: iso(minsAgo(10)), patient: o.patient });
const BILL = (o: { id: string; patientId: string }) => ({
  id: `b-${o.id}`, orderId: o.id, patientId: o.patientId, branchId: 'b1', type: 'lab', invoiceNumber: 'INV-001033', isInterstate: false,
  subTotal: 400, overrideDiscount: 0, totalDiscount: 0, totalTaxable: 400, totalCgst: 0, totalSgst: 0, totalIgst: 0, totalTax: 0,
  totalPayable: 400, totalPaid: 400, balance: 0, status: 'paid', createdAt: iso(minsAgo(120)),
  items: [{ id: 'bi1', itemType: 'test', itemId: 't1', name: 'Complete Blood Count', quantity: 1, unitPrice: 400, discount: 0, taxable: 400, gstRate: 0, cgst: 0, sgst: 0, igst: 0, total: 400 }],
  payments: [{ id: 'pay1', amount: 400, mode: 'cash', paidAt: iso(minsAgo(110)) }],
});

/** The lab's email settings as the server keeps them — the Prefrontal sender is NOT set up yet (owner: visible). */
let EMAIL: Record<string, unknown>;
let SMS_CHAT: boolean;
/** GET /api/tenants/module-config — the backend's camelCase keys (emailShare / smsChat); {} = every switch on. */
let MODULES: Record<string, boolean>;
/** POST /api/billing/{id}/email answers 400 with this code (invalid_pdf / pdf_too_large) when set. */
let INVOICE_REFUSAL: string | null;
const freshEmail = () => ({
  enabled: true, mode: 'platform', fromName: 'Demo Lab', replyTo: 'desk@demolab.example', platformAddress: 'reports@prefrontal.health',
  own: null, ready: false, problem: "Prefrontal email isn't set up on this server yet",
});
const WA_SETTINGS = {
  autoSendEnabled: false, sendUpdatedReports: false, templateName: null, templateLanguage: null, canSend: false,
  sender: { source: 'platform', displayName: 'Prefrontal', status: 'not_connected', tokenStored: false, canConnect: false },
  platform: { enabled: true, configured: false, webhookConfigured: false, defaultTemplateName: 'report_ready', defaultTemplateLanguage: 'en' },
};

interface Call { method: string; path: string; body: any }
let calls: Call[] = [];

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus && !page.isClosed()) {
    await page.screenshot({ path: `${out()}/FAIL--${info.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 80)}.png` }).catch(() => {});
    const text = await page.evaluate(() => document.body.innerText.slice(0, 1500)).catch(() => '');
    console.log('[fail page]', projectName(), page.url(), text.replace(/\s+/g, ' '));
  }
});

/** The mocked backend + the session on the project's own page / context (the desktop-app bridge comes from the fixture). */
async function setup(page: Page, context: BrowserContext): Promise<Page> {
  await backend(page, context);
  return page;
}

async function backend(page: Page, context: BrowserContext) {
  const cors = (origin: string) => ({ 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
  const ok = (origin: string, data: unknown) => ({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: true, data }) });
  await page.route(/prefrontal\.health\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    const u = new URL(req.url()); const p = u.pathname; const m = req.method();
    const ctype = req.headers()['content-type'] ?? '';
    let body: any = null;
    if (ctype.startsWith('multipart/')) { const buf = req.postDataBuffer(); body = { multipart: true, raw: buf ? buf.toString('latin1') : '' }; }
    else { try { body = req.postData() ? JSON.parse(req.postData()!) : null; } catch { body = req.postData(); } }
    if (m !== 'GET') calls.push({ method: m, path: p, body });
    if (p === '/api/auth/me') return route.fulfill(ok(origin, { id: ME.id, authId: ME.authId, firstName: ME.first, fathersName: ME.last, displayName: `${ME.first} ${ME.last}`, email: 'admin@demolab.example', tenantId: TENANT.id, tenantName: TENANT.name, branchId: 'b1', branchName: 'Main', roles: ['Lab Admin'], permissions: ['*'], branches: [{ id: 'b1', name: 'Main' }], modules: ['lab'], hasPin: false }));
    if (p === '/api/tenants/modules') return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: false }) });
    if (p === '/api/tenants/module-config') return route.fulfill(ok(origin, MODULES));
    if (p === '/api/tenants/current') return route.fulfill(ok(origin, { id: TENANT.id, name: TENANT.name }));
    if (p === '/api/tenants/branches') return route.fulfill(ok(origin, [{ id: 'b1', name: 'Main' }]));
    if (p === '/api/process-workflows/active') return route.fulfill(ok(origin, null));
    // ── Communication contract ──
    if (p === '/api/settings/communication' && m === 'GET') return route.fulfill(ok(origin, { whatsapp: { auto: true, chat: true, cloudReady: false }, email: EMAIL, sms: { chat: SMS_CHAT } }));
    if (p === '/api/settings/communication/email' && m === 'PUT') {
      const own = body.own ? { host: body.own.host, port: body.own.port, security: body.own.security, username: body.own.username, fromAddress: body.own.fromAddress,
        passwordSet: !!body.own.password || !!(EMAIL['own'] as any)?.passwordSet } : null;
      EMAIL = { ...EMAIL, enabled: body.enabled, mode: body.mode, fromName: body.fromName, replyTo: body.replyTo, own,
        ready: body.mode === 'own' && !!own?.passwordSet, problem: body.mode === 'own' && own?.passwordSet ? null : "Prefrontal email isn't set up on this server yet" };
      return route.fulfill(ok(origin, EMAIL));
    }
    if (p === '/api/settings/communication/email/test') return route.fulfill(ok(origin, EMAIL['ready'] ? { ok: true } : { ok: false, error: "Prefrontal email isn't set up on this server yet" }));
    if (p === '/api/settings/communication/sms') { SMS_CHAT = !!body.chat; return route.fulfill(ok(origin, { chat: SMS_CHAT })); }
    const em = /^\/api\/reports\/by-order\/([^/]+)\/email$/.exec(p);
    if (em) {
      const o = ORDERS.find(x => x.id === em[1]) as any;
      const sent: unknown[] = []; const skipped: unknown[] = [];
      if (body.to !== 'doctor') sent.push({ kind: 'patient', address: o.patient.email });
      if (body.to !== 'patient') { if (o.refDoctorEmail) sent.push({ kind: 'doctor', address: o.refDoctorEmail }); else skipped.push({ kind: 'doctor', reason: 'no_email' }); }
      return route.fulfill(ok(origin, { sent, skipped }));
    }
    const be = /^\/api\/billing\/([^/]+)\/email$/.exec(p);
    if (be && INVOICE_REFUSAL) return route.fulfill({ status: 400, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: false, error: INVOICE_REFUSAL, message: 'The invoice PDF is too large to e-mail.', field: 'pdf' }) });
    if (be) return route.fulfill(ok(origin, { sent: [{ kind: 'patient', address: 'priya@example.com' }], skipped: [] }));
    // ── WhatsApp (not set up on the server → WhatsApp Chat) ──
    if (p === '/api/whatsapp/settings') return route.fulfill(ok(origin, WA_SETTINGS));
    if (p.startsWith('/api/whatsapp/templates')) return route.fulfill(ok(origin, []));
    // ── Front desk ──
    if (p === '/api/orders/today' || p === '/api/orders/range') return route.fulfill(ok(origin, ORDERS));
    if (p === '/api/billing/outstanding') return route.fulfill(ok(origin, { due: [], refundsOwed: [] }));
    const byOrder = /^\/api\/reports\/by-order\/([^/]+)$/.exec(p);
    if (byOrder) { const o = ORDERS.find(x => x.id === byOrder[1]); return route.fulfill(ok(origin, o ? report(o) : null)); }
    const st = /^\/api\/whatsapp\/reports\/r-([^/]+)$/.exec(p);
    if (st) {
      const o = ORDERS.find(x => x.id === st[1]) as any;
      return route.fulfill(ok(origin, { reportId: `r-${st[1]}`, patientOptOut: false, canSend: false, latest: null, history: [], referralDoctor: o?.refDoctorPhone ? { name: o.refDoctorName, phone: o.refDoctorPhone } : null }));
    }
    if (p === '/api/billing/' && m === 'POST') { const o = ORDERS.find(x => x.id === body?.orderId) ?? PLAIN; return route.fulfill(ok(origin, BILL(o))); }
    if (p === '/api/config/invoice-template') return route.fulfill(ok(origin, { labName: TENANT.name, showLogo: false }));
    const track = /^\/api\/orders\/([^/]+)\/track-token$/.exec(p);
    if (track) return route.fulfill(ok(origin, { token: `trk-${track[1]}` }));
    const one = /^\/api\/orders\/([^/]+)$/.exec(p);
    if (one) return route.fulfill(ok(origin, ORDERS.find(x => x.id === one[1]) ?? PLAIN));
    if (m === 'GET') return route.fulfill(ok(origin, []));
    return route.fulfill(ok(origin, {}));
  });
  await page.route(/supabase\.co\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ access_token: jwt(ME.authId), refresh_token: `rt-${ME.authId}`, token_type: 'bearer', expires_in: 86400, user: { id: ME.authId, aud: 'authenticated', email: 'admin@demolab.example' } }) });
  });
  await context.route(/whatsapp\.com\//, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>WhatsApp (stub)</title>' }));
  await page.routeWebSocket(/\/hubs\//, ws => { ws.onMessage(() => ws.send('{}\x1e')); });
  await page.addInitScript(([session]) => {
    if (!sessionStorage.getItem('pf.e2e.seeded')) {
      sessionStorage.setItem('pf.e2e.seeded', '1'); localStorage.clear();
      localStorage.setItem('pf.session', session as string); localStorage.setItem('pf-design', 'new');
      localStorage.setItem('pf.wa.manual.reminded', '1');
      localStorage.setItem('pf.startHintSeen', '1');
    }
    // Record every sms: link the app opens (an anchor click) instead of leaving the page.
    const w = window as unknown as { __sms: string[] };
    w.__sms = [];
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if ((this.getAttribute('href') || '').startsWith('sms:')) { w.__sms.push(this.getAttribute('href')!); return; }
      return click.call(this);
    };
  }, [JSON.stringify({ access_token: jwt(ME.authId), refresh_token: `rt-${ME.authId}` })] as const);
}

async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
  await page.waitForTimeout(350);
}
async function shot(page: Page, name: string) {
  for (const dark of [false, true]) {
    await theme(page, dark);
    await page.screenshot({ path: `${out()}/${name}--${dark ? 'dark' : 'light'}.png` });
  }
  await theme(page, false);
}
const noSideScroll = (page: Page) => expectNoHorizontalScroll(page, 'cm-comms');
/** page.goto(route); the desktop-app bridge turns a deep path into the hash route Electron uses (/#/path). */
async function go(page: Page, route: string) {
  await page.goto(route);
  if (isDesktopApp()) expect(new URL(page.url()).hash, 'desktop app routes with a hash').toMatch(/^#\//);
}
const visible = (page: Page, sel: string) => page.locator(sel).locator('visible=true').first();

async function openComms(page: Page, tab?: string) {
  await sharedOpenComms(page, tab);
  await theme(page, false);
}
const pickTab = sharedPickCommsTab;

async function openDesk(page: Page) {
  await go(page, '/frontdesk');
  // Phone: icon tabs (aria-label "Completed"); tablet / desktop: the "Completed" pill (title / text).
  const tab = page.locator('[aria-label="Completed"], [title*="Completed"]').locator('visible=true').first()
    .or(page.getByText('Completed', { exact: true }).locator('visible=true').first());
  await expect(tab.first()).toBeVisible({ timeout: 60_000 });
  await theme(page, false);
  await tab.first().click();
  await expect(page.getByText('Priya Nair').locator('visible=true').first()).toBeVisible({ timeout: 20_000 });
}
function shareButton(page: Page, name: string) {
  return page.locator(':is(.pf-wrow, li, tr)').filter({ hasText: name }).locator('button[aria-label="Share report"]').locator('visible=true').first();
}
const toast = (page: Page, text: string | RegExp) => page.getByText(text).locator('visible=true').first();

test.beforeEach(() => {
  calls = []; EMAIL = freshEmail(); SMS_CHAT = true; MODULES = {}; INVOICE_REFUSAL = null;
});

test.describe('cm-comms', () => {
  test.setTimeout(180_000);

  test(`Communication page: three tabs, WhatsApp cards, email "not set up yet", own mailbox save + write-only password + test send, SMS Chat`, async ({ page: pg, context }) => {
    const page = await setup(pg, context);
    await openComms(page);
    await expectDeviceTier(page);
    // The three channels are the setting's categories in the Settings shell (left panel on wide screens).
    if (!isPhone()) for (const t of ['whatsapp', 'email', 'sms']) await expect(visible(page, `[data-testid="tp-item-${t}"]`)).toBeVisible();
    // WhatsApp: the cards moved from Lab settings live here.
    await expect(visible(page, '[data-testid="ls-wa-chat"]')).toBeVisible({ timeout: 20_000 });
    await expect(visible(page, '[data-testid="ls-wa-chat-state"]')).toHaveText('On');
    // WhatsApp Auto (and "send again", the message picker) moved to Report design › Sending: not here.
    await expect(page.locator('[data-testid="rs-auto"], [data-testid="rs-auto-switch"]')).toHaveCount(0);
    await expect(page.getByText('WhatsApp Auto', { exact: true }).locator('visible=true')).toHaveCount(0);
    await noSideScroll(page);
    await page.screenshot({ path: `${out()}/comms-whatsapp--light.png` });

    // Email: the Prefrontal sender isn't set up yet — said plainly.
    await pickTab(page, 'Email');
    const status = visible(page, '[data-testid="cm-email-status"]');
    await expect(status).toHaveAttribute('data-ready', 'no');
    await expect(status).toContainText("Prefrontal email isn't set up on this server yet");
    await expect(visible(page, '[data-testid="cm-email-platform"]')).toContainText('reports@prefrontal.health');
    await expect(page.locator('select, datalist')).toHaveCount(0);
    await noSideScroll(page);
    await shot(page, 'comms-email-platform');

    // Own mailbox → SMTP fields; save sends the password once; afterwards it shows only "Saved".
    await visible(page, '[data-testid="cm-email-mode"]').getByText('Our own mailbox', { exact: true }).click();
    await expect(visible(page, '[data-testid="cm-email-own"]')).toBeVisible();
    await visible(page, '[data-testid="cm-smtp-host"]').fill('smtp.demolab.example');
    await visible(page, '[data-testid="cm-smtp-user"]').fill('reports@demolab.example');
    await visible(page, '[data-testid="cm-smtp-pass"]').fill('app-pass-123');
    await visible(page, '[data-testid="cm-smtp-from"]').fill('reports@demolab.example');
    await noSideScroll(page);
    await shot(page, 'comms-email-own-filled');
    await visible(page, '[data-testid="cm-email-save"]').click();
    await expect(toast(page, 'Email settings saved — ready to send')).toBeVisible({ timeout: 10_000 });
    const put = calls.find(c => c.method === 'PUT' && c.path === '/api/settings/communication/email')!;
    expect(put.body).toEqual({ enabled: true, mode: 'own', fromName: 'Demo Lab', replyTo: 'desk@demolab.example',
      own: { host: 'smtp.demolab.example', port: 587, security: 'starttls', username: 'reports@demolab.example', fromAddress: 'reports@demolab.example', password: 'app-pass-123' } });
    await expect(visible(page, '[data-testid="cm-smtp-pass-saved"]')).toContainText('Saved');
    await expect(page.locator('[data-testid="cm-smtp-pass"]')).toHaveCount(0);
    expect(await page.content()).not.toContain('app-pass-123');
    await expect(status).toHaveAttribute('data-ready', 'yes');

    // Test send with the saved settings.
    await visible(page, '[data-testid="cm-test-to"]').fill('owner@demolab.example');
    await visible(page, '[data-testid="cm-test-send"]').click();
    await expect(visible(page, '[data-testid="cm-test-result"]')).toContainText('Sent to owner@demolab.example');
    expect(calls.find(c => c.path === '/api/settings/communication/email/test')!.body).toEqual({ to: 'owner@demolab.example' });
    await expect(page.locator('.toast-item')).toHaveCount(0, { timeout: 15_000 });   // toasts gone
    await shot(page, 'comms-email-own-saved');

    // SMS Chat (deep link ?tab=sms): switch + the plain line + the "automatic SMS later" note.
    await openComms(page, 'sms');
    const sw = visible(page, '[data-testid="cm-sms-chat"]');
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(visible(page, '[data-testid="cm-sms-explain"]')).toContainText("opens the phone's own Messages app");
    await expect(visible(page, '[data-testid="cm-sms-auto-note"]')).toContainText('registered SMS provider');
    await noSideScroll(page);
    await shot(page, 'comms-sms');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(calls.find(c => c.path === '/api/settings/communication/sms')!.body).toEqual({ chat: false });
  });

  test(`Settings lists Message channels under Organization; the old Communication and WhatsApp links redirect`, async ({ page: pg, context }) => {
    const page = await setup(pg, context);
    await go(page, '/admin?section=channels');
    // One setting in the section: the overview shows it inline (owner), its channels as the card head's pill.
    await expect(page.locator('[data-testid="ov-inline"] [data-testid="comms-page"]').first()).toBeAttached({ timeout: 60_000 });
    await go(page, '/admin/communication?tab=email');
    await page.waitForURL(/\/admin\/org\/channels\?tab=email/, { timeout: 20_000 });
    await go(page, '/admin/whatsapp');
    await page.waitForURL(/\/admin\/org\/channels\?tab=whatsapp/, { timeout: 20_000 });
    await expect(visible(page, '[data-testid="ls-wa-chat"]')).toBeVisible({ timeout: 20_000 });
  });

  test(`Report design › Sending: WhatsApp Auto and "send again" save to the same WhatsApp settings API`, async ({ page: pg, context }) => {
    const page = await setup(pg, context);
    await go(page, '/admin/reports?tab=sending');
    const auto = visible(page, '[data-testid="rs-auto-switch"]');
    await expect(auto).toBeVisible({ timeout: 60_000 });
    await expect(auto).toHaveAttribute('aria-checked', 'false');
    await expect(visible(page, '[data-testid="rs-channels-link"]')).toHaveAttribute('href', /\/admin\/org\/channels$/);
    await auto.click();
    await expect.poll(() => calls.find(c => c.method === 'PUT' && c.path === '/api/whatsapp/settings')?.body).toEqual({ autoSendEnabled: true, sendUpdatedReports: false });
    calls = [];
    await visible(page, '[data-testid="rs-resend-switch"]').click();
    await expect.poll(() => calls.find(c => c.method === 'PUT' && c.path === '/api/whatsapp/settings')?.body).toHaveProperty('sendUpdatedReports');
    await noSideScroll(page);
    await shot(page, 'report-sending');
  });

  test(`Front desk Share: Email patient / doctor / both from the server answer; SMS only on phone + tablet with the right sms: link`, async ({ page: pg, context }) => {
    const page = await setup(pg, context);
    await openDesk(page);
    // A referral doctor with an email + phone: the Email heading with three rows.
    await shareButton(page, 'Anitha Raj').click();
    await expect(visible(page, '[data-test="share-email-both"]')).toHaveText(/Send to both/);
    await expect(visible(page, '[data-test="share-email-patient"]')).toHaveText(/Send to patient/);
    await expect(visible(page, '[data-test="share-email-doctor"]')).toHaveText(/Send to doctor/);
    if (isTouch()) {
      await expect(visible(page, '[data-test="share-sms-patient"]')).toBeVisible();
      await expect(visible(page, '[data-test="share-sms-doctor"]')).toBeVisible();
    } else {
      await expect(page.locator('[data-test^="share-sms"]')).toHaveCount(0);
    }
    await page.waitForTimeout(300);
    await shot(page, 'share-menu-doctor');
    await visible(page, '[data-test="share-email-doctor"]').click();
    await expect(toast(page, 'Report emailed to the referral doctor (ravi@clinic.example)')).toBeVisible({ timeout: 10_000 });
    expect(calls.find(c => c.path === '/api/reports/by-order/od/email')!.body).toEqual({ to: 'doctor' });

    await shareButton(page, 'Anitha Raj').click();
    await visible(page, '[data-test="share-email-both"]').click();
    await expect(toast(page, 'Report emailed to anitha@example.com and the referral doctor (ravi@clinic.example)')).toBeVisible({ timeout: 10_000 });

    // No doctor: ONE Email row → the patient.
    await shareButton(page, 'Priya Nair').click();
    await expect(page.locator('[data-test="share-email-doctor"]').locator('visible=true')).toHaveCount(0);
    if (isTouch()) await expect(visible(page, '[data-test="share-sms"]')).toHaveText(/SMS/);
    else await expect(page.locator('[data-test^="share-sms"]')).toHaveCount(0);
    await shot(page, 'share-menu-plain');
    await visible(page, '[data-test="share-email"]').click();
    await expect(toast(page, 'Report emailed to priya@example.com')).toBeVisible({ timeout: 10_000 });
    expect(calls.filter(c => c.path === '/api/reports/by-order/op/email').map(c => c.body)).toEqual([{ to: 'patient' }]);

    if (isTouch()) {
      // SMS: opens Messages with the report-ready line + the report link (iOS: &body=).
      await shareButton(page, 'Priya Nair').click();
      await visible(page, '[data-test="share-sms"]').click();
      await expect.poll(() => page.evaluate(() => (window as any).__sms as string[]), { timeout: 10_000 }).toHaveLength(1);
      const href = (await page.evaluate(() => (window as any).__sms as string[]))[0];
      expect(href.startsWith('sms:+919876543210&body=')).toBe(true);
      const body = decodeURIComponent(href.split('&body=')[1]);
      expect(body).toContain('Dear Priya Nair, your report from Demo Lab is ready.');
      expect(body).toContain('/reports/public/tok-op');
      // The doctor row → the doctor's number + the doctor message.
      await shareButton(page, 'Anitha Raj').click();
      await visible(page, '[data-test="share-sms-doctor"]').click();
      await expect.poll(() => page.evaluate(() => ((window as any).__sms as string[]).length), { timeout: 10_000 }).toBe(2);
      const doc = (await page.evaluate(() => (window as any).__sms as string[]))[1];
      expect(doc.startsWith('sms:+919845012345&body=')).toBe(true);
      expect(decodeURIComponent(doc.split('&body=')[1])).toContain('Dear Dr. Ravi Kumar, the report of Anitha Raj from Demo Lab is ready.');
    } else {
      expect(await page.evaluate(() => (window as any).__sms as string[])).toEqual([]);
    }
  });

  test(`Invoice viewer: Email next to WhatsApp, patient only, toast from the server answer`, async ({ page: pg, context }) => {
    // Record what the app itself puts in the form (name + first bytes of each file): WebKit's request interception
    // drops file contents from multipart bodies, so the wire body alone can't prove the PDF rode along there.
    await context.addInitScript(() => {
      const w = window as unknown as { __pfFormFiles?: { field: string; name: string; type: string; head: Promise<string> }[] };
      w.__pfFormFiles = [];
      const orig = FormData.prototype.append;
      FormData.prototype.append = function (this: FormData, field: string, v: string | Blob, name?: string) {
        if (v instanceof Blob) w.__pfFormFiles!.push({ field, name: name ?? (v as File).name ?? '', type: v.type, head: v.slice(0, 5).text() });
        return (orig as (...a: unknown[]) => void).call(this, field, v, name);
      } as typeof FormData.prototype.append;
    });
    const page = await setup(pg, context);
    await openDesk(page);
    await page.getByText('Priya Nair').locator('visible=true').first().click();
    await visible(page, 'button[aria-label="View invoice"]').click();
    const email = visible(page, '[data-test="invoice-email"]');
    await expect(email).toBeVisible({ timeout: 30_000 });
    await expect(visible(page, '[data-test="invoice-whatsapp"]')).toBeVisible();
    await page.waitForTimeout(500);
    // Download · WhatsApp · Email · Print · Close: every one on screen, none on top of another or of the
    // INVOICE label / number (a 390px phone wraps the actions onto their own row).
    const hdr = page.locator('.pf-inv-preview__hdr').locator('visible=true').first();
    for (const name of ['Download', 'WhatsApp', 'Email', 'Print']) await expect(hdr.getByRole('button', { name, exact: true })).toBeVisible();
    await expect(hdr.getByRole('button', { name: 'Close' })).toBeVisible();
    await expectRowFits(page, '.pf-inv-preview__hdr :is(.pf-inv-preview__eyebrow, .pf-inv-preview__num, .pf-inv-preview__btn, .pf-inv-preview__close)', 'invoice header');
    await shot(page, 'invoice-viewer-email');
    await email.click();
    await expect(toast(page, 'Invoice emailed to priya@example.com')).toBeVisible({ timeout: 10_000 });
    // The SAME invoice PDF the viewer shows rides along as multipart field `pdf` (INV-<number>.pdf).
    const inv = calls.find(c => c.path === '/api/billing/b-op/email')!.body;
    expect(inv.multipart).toBe(true);
    expect(inv.raw).toContain('name="pdf"; filename="INV-001033.pdf"');
    if (engine() !== 'webkit') expect(inv.raw).toContain('%PDF');
    const files = await page.evaluate(async () => {
      const list = (window as unknown as { __pfFormFiles?: { field: string; name: string; type: string; head: Promise<string> }[] }).__pfFormFiles ?? [];
      return Promise.all(list.map(async f => ({ field: f.field, name: f.name, type: f.type, head: await f.head })));
    });
    expect(files, 'the app put the invoice PDF itself in the form').toContainEqual({ field: 'pdf', name: 'INV-001033.pdf', type: 'application/pdf', head: '%PDF-' });
  });

  test(`Invoice viewer: a PDF the server refuses (400 pdf_too_large / invalid_pdf) is one plain toast, never "emailed"`, async ({ page: pg, context }) => {
    const page = await setup(pg, context);
    await openDesk(page);
    for (const [code, text] of [
      ['pdf_too_large', 'The invoice PDF is too large to email. Download it and send it another way.'],
      ['invalid_pdf', 'The invoice PDF could not be attached. Close it, open it again and try once more.'],
    ] as const) {
      INVOICE_REFUSAL = code;
      if (!(await page.locator('[data-test="invoice-email"]').locator('visible=true').count())) {
        await page.getByText('Priya Nair').locator('visible=true').first().click();
        await visible(page, 'button[aria-label="View invoice"]').click();
      }
      const email = visible(page, '[data-test="invoice-email"]');
      await expect(email).toBeVisible({ timeout: 30_000 });
      await expect(email).toBeEnabled({ timeout: 15_000 });
      await email.click();
      await expect(toast(page, text)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('Invoice emailed to', { exact: false }).locator('visible=true')).toHaveCount(0);
    }
    expect(calls.filter(c => c.path === '/api/billing/b-op/email').every(c => c.body.multipart)).toBe(true);
  });

  test(`Platform switches off (module-config camelCase emailShare / smsChat = false): no Email, no SMS anywhere`, async ({ page: pg, context }) => {
    MODULES = { emailShare: false, smsChat: false };
    const page = await setup(pg, context);
    await openDesk(page);
    // Invoice viewer: WhatsApp yes, Email no.
    await page.getByText('Priya Nair').locator('visible=true').first().click();
    await visible(page, 'button[aria-label="View invoice"]').click();
    await expect(visible(page, '[data-test="invoice-whatsapp"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-test="invoice-email"]')).toHaveCount(0);
    await visible(page, '.pf-inv-preview__close').click();
    await expect(page.locator('.pf-inv-preview')).toHaveCount(0);
    // Share menu: WhatsApp still shares; Email and SMS rows are gone on every form factor.
    await openDesk(page);
    await shareButton(page, 'Anitha Raj').click();
    await expect(page.locator('[data-test^="share-whatsapp"]').locator('visible=true').first()).toBeVisible();
    await expect(page.locator('[data-test^="share-email"]').locator('visible=true')).toHaveCount(0);
    await expect(page.locator('[data-test^="share-sms"]').locator('visible=true')).toHaveCount(0);
    // Settings → Communication says Prefrontal turned them off (the switch can't be flipped here).
    await openComms(page, 'sms');
    await expect(visible(page, '[data-testid="cm-sms-chat"]')).toBeDisabled();
    expect(calls.filter(c => /\/email$/.test(c.path))).toEqual([]);
  });
});
