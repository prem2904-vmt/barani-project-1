import type { BrowserContext, Page } from '@playwright/test';

/**
 * NEGATIVE-scenario backend for the screens suites (API mocked, demo data only): one mocked prefrontal-mw that a
 * spec can make FAIL on purpose. `neg.hook` sees every request first and may answer with an error status (with or
 * without a JSON body), abort the connection (a network failure) or delay the answer; everything else is the
 * happy-path contract (comms settings, front desk, report view, result entry, billing dues).
 *
 *   neg.hook = r => (r.method === 'POST' && r.path.endsWith('/email')) ? { status: 500 } : undefined;
 *
 * `neg.calls` records every non-GET request (path + parsed body) so a test can assert "exactly one request" or
 * "nothing was sent". Call `resetNeg()` in beforeEach, then `installNegBackend(page, context)` before navigating.
 */
export const TENANT = { id: 't-demo', name: 'Demo Lab' };
export const ME = { id: 'app-1', authId: 'sub-1', first: 'Kavya', last: 'Desk' };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
export const jwt = (sub: string) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 86400, email: `${sub}@demo.test` })}.sig`;

const now = new Date();
const iso = (d: Date) => d.toISOString();
const minsAgo = (m: number) => new Date(now.getTime() - m * 60000);
const PARAMS = JSON.stringify({ parameters: [{ name: 'hb', title: 'Haemoglobin', unit: 'g/dL' }] });
export const PATIENT_PHONE = '+919876543210';
export const DOCTOR_PHONE = '+919845012345';

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
/** Completed-tab orders: a patient with an email, one without, one with a referral doctor (Dr. Rao). */
export const PLAIN = order('op', 4, 'Priya Nair', 'priya@example.com');
export const NO_EMAIL = order('on', 5, 'Noor Khan', null);
export const WITH_DOC = order('od', 6, 'Anitha Raj', 'anitha@example.com', { refDoctorId: 'doc1', refDoctorName: 'Dr. Ravi Kumar', refDoctorPhone: DOCTOR_PHONE, refDoctorEmail: 'ravi@clinic.example' });
export const REFERRED = order('orf', 7, 'Rekha Menon', 'rekha@example.com', { refDoctorName: 'Dr. Rao' });
export const ORDERS = [PLAIN, NO_EMAIL, WITH_DOC, REFERRED];

const report = (o: { id: string; patient: unknown }) => ({ id: `r-${o.id}`, orderId: o.id, type: 'final', status: 'generated', qrToken: `tok-${o.id}`, createdAt: iso(minsAgo(10)), patient: o.patient });
const BILL = (o: { id: string; patientId: string }) => ({
  id: `b-${o.id}`, orderId: o.id, patientId: o.patientId, branchId: 'b1', type: 'lab', invoiceNumber: 'INV-001033', isInterstate: false,
  subTotal: 400, overrideDiscount: 0, totalDiscount: 0, totalTaxable: 400, totalCgst: 0, totalSgst: 0, totalIgst: 0, totalTax: 0,
  totalPayable: 400, totalPaid: 400, balance: 0, status: 'paid', createdAt: iso(minsAgo(120)),
  items: [{ id: 'bi1', itemType: 'test', itemId: 't1', name: 'Complete Blood Count', quantity: 1, unitPrice: 400, discount: 0, taxable: 400, gstRate: 0, cgst: 0, sgst: 0, igst: 0, total: 400 }],
  payments: [{ id: 'pay1', amount: 400, mode: 'cash', paidAt: iso(minsAgo(110)) }],
});
/** A bill with money still due (Payments due tab). */
export const dueBill = (orderId: string, balance: number) => ({ ...BILL({ id: orderId, patientId: 'p' }), id: `bd-${orderId}`, orderId, totalPaid: 400 - balance, balance, status: 'partial' });

/** The /report view's report (the manual WhatsApp send from there). */
const REPORT_VIEW = () => ({
  id: 'rep-1', orderId: 'ord-1', patientId: 'p1', type: 'final', status: 'generated', deliveryStatus: 'pending', createdAt: iso(now), qrToken: 'tok123',
  patient: { displayName: 'Meena Iyer', phone: PATIENT_PHONE },
  data: JSON.stringify({ patient: { displayName: 'Meena Iyer', age: 42, sex: 'Female', mrn: 'MRN-1001', phone: PATIENT_PHONE }, order: { id: 'ord-1', orderNumber: 'LAB-2611-000042' }, type: 'final', isPartial: false, tests: [] }),
});

/** A written test on a received tube (result entry). */
export const resultTube = () => ({
  id: 'smp-1', orderId: 'o1', departmentId: 'd1', status: 'received', barcode: '26123', rejectionCount: 0, createdAt: iso(minsAgo(60)),
  department: { id: 'd1', name: 'Biochemistry', code: 'BIO' },
  order: { id: 'o1', patientId: 'p1', branchId: 'b1', priority: 'routine', source: 'walkin', status: 'open', collectionType: 'walkin', createdAt: iso(minsAgo(60)), samples: [], patient: pat('1', 'Demo Patient', null) },
  siblings: [],
  tests: [{ id: 'ot1', subOrderId: 'smp-1', testId: 't1', name: 'Written test', status: 'in_progress',
    test: { id: 't1', name: 'Written test', parameters: JSON.stringify({ parameters: [{ name: 'f', title: 'Finding', type: 'textarea', normalValue: 'Negative', unit: 'IU/mL' }] }) } }],
});

const WA_SETTINGS = {
  autoSendEnabled: false, sendUpdatedReports: false, templateName: null, templateLanguage: null, canSend: false,
  sender: { source: 'platform', displayName: 'Prefrontal', status: 'not_connected', tokenStored: false, canConnect: false },
  platform: { enabled: true, configured: false, webhookConfigured: false, defaultTemplateName: 'report_ready', defaultTemplateLanguage: 'en' },
};

export interface NegRequest { method: string; path: string; body: any }
export type NegAnswer =
  | { status: number; body?: unknown; text?: string; delayMs?: number }
  | { abort: true }
  | { delayMs: number }
  | undefined;

export interface NegState {
  calls: NegRequest[];
  hook: ((r: NegRequest) => NegAnswer) | null;
  email: Record<string, unknown>;
  modules: Record<string, boolean>;
  /** The patient's WhatsApp opt-out + referral doctor for the report view (rep-1). */
  optOut: boolean;
  reportDoctor: { name: string; phone: string } | null;
  bills: unknown[];
  tube: ReturnType<typeof resultTube>;
}

export const neg: NegState = {
  calls: [], hook: null, email: {}, modules: {}, optOut: false, reportDoctor: null, bills: [], tube: resultTube(),
};

const freshEmail = () => ({
  enabled: true, mode: 'platform', fromName: 'Demo Lab', replyTo: 'desk@demolab.example', platformAddress: 'reports@prefrontal.health',
  own: null, ready: true, problem: null,
});
export function resetNeg(): void {
  neg.calls = []; neg.hook = null; neg.email = freshEmail(); neg.modules = {}; neg.optOut = false; neg.reportDoctor = null; neg.bills = []; neg.tube = resultTube();
}

/** Server answers for the hook. */
export const serverError = (status = 500, message?: string): NegAnswer => message ? { status, body: { success: false, error: 'server_error', message } } : { status };
export const forbidden = (error: string, message: string): NegAnswer => ({ status: 403, body: { success: false, error, message } });

/** How the browser's storage behaves in a spec. */
export type StorageMode = 'normal' | 'write-throws' | 'all-throws';

export async function installNegBackend(page: Page, context: BrowserContext, o: { storage?: StorageMode; seedHintSeen?: boolean } = {}): Promise<void> {
  const cors = (origin: string) => ({ 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
  const json = (origin: string, status: number, body: unknown) => ({ status, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const ok = (origin: string, data: unknown) => json(origin, 200, { success: true, data });
  await page.route(/prefrontal\.health\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    const p = new URL(req.url()).pathname; const m = req.method();
    let body: any = null;
    try { body = req.postData() ? JSON.parse(req.postData()!) : null; } catch { body = req.postData(); }
    if (m !== 'GET') neg.calls.push({ method: m, path: p, body });
    const a = neg.hook?.({ method: m, path: p, body });
    if (a) {
      if ('delayMs' in a && a.delayMs) await new Promise(r => setTimeout(r, a.delayMs));
      if ('abort' in a) return route.abort('failed');
      if ('status' in a) {
        if (a.text !== undefined || a.body === undefined) return route.fulfill({ status: a.status, headers: { ...cors(origin), 'content-type': 'text/plain' }, body: a.text ?? '' });
        return route.fulfill(json(origin, a.status, a.body));
      }
    }
    if (p === '/api/auth/me') return route.fulfill(ok(origin, { id: ME.id, authId: ME.authId, firstName: ME.first, fathersName: ME.last, displayName: `${ME.first} ${ME.last}`, email: 'admin@demolab.example', tenantId: TENANT.id, tenantName: TENANT.name, branchId: 'b1', branchName: 'Main', roles: ['Lab Admin'], permissions: ['*'], branches: [{ id: 'b1', name: 'Main' }], modules: ['lab'], hasPin: false }));
    if (p === '/api/tenants/modules') return route.fulfill(json(origin, 200, { success: false }));
    if (p === '/api/tenants/module-config') return route.fulfill(ok(origin, neg.modules));
    if (p === '/api/tenants/current') return route.fulfill(ok(origin, { id: TENANT.id, name: TENANT.name }));
    if (p === '/api/tenants/branches') return route.fulfill(ok(origin, [{ id: 'b1', name: 'Main' }]));
    if (p === '/api/process-workflows/active') return route.fulfill(ok(origin, null));
    // ── Communication ──
    if (p === '/api/settings/communication' && m === 'GET') return route.fulfill(ok(origin, { whatsapp: { auto: true, chat: true, cloudReady: false }, email: neg.email, sms: { chat: true } }));
    if (p === '/api/settings/communication/email' && m === 'PUT') { neg.email = { ...neg.email, enabled: body.enabled, mode: body.mode, fromName: body.fromName, replyTo: body.replyTo }; return route.fulfill(ok(origin, neg.email)); }
    if (p === '/api/settings/communication/email/test') return route.fulfill(ok(origin, { ok: true }));
    // ── Email share ──
    const em = /^\/api\/reports\/by-order\/([^/]+)\/email$/.exec(p);
    if (em) { const o = ORDERS.find(x => x.id === em[1]) as any; return route.fulfill(ok(origin, { sent: [{ kind: 'patient', address: o.patient.email }], skipped: [] })); }
    const be = /^\/api\/billing\/([^/]+)\/email$/.exec(p);
    if (be) return route.fulfill(ok(origin, { sent: [{ kind: 'patient', address: 'priya@example.com' }], skipped: [] }));
    // ── WhatsApp ──
    if (p === '/api/whatsapp/settings') return route.fulfill(ok(origin, WA_SETTINGS));
    if (p.startsWith('/api/whatsapp/templates')) return route.fulfill(ok(origin, []));
    if (p === '/api/whatsapp/reports/rep-1') return route.fulfill(ok(origin, { reportId: 'rep-1', patientOptOut: neg.optOut, configured: false, autoSendEnabled: false, canSend: false, latest: null, history: [], referralDoctor: neg.reportDoctor }));
    const st = /^\/api\/whatsapp\/reports\/r-([^/]+)$/.exec(p);
    if (st) return route.fulfill(ok(origin, { reportId: `r-${st[1]}`, patientOptOut: false, canSend: false, latest: null, history: [], referralDoctor: null }));
    // ── Report view ──
    if (p === '/api/reports/rep-1' || p === '/api/reports/by-order/ord-1') return route.fulfill(ok(origin, REPORT_VIEW()));
    if (p === '/api/config/report-template') return route.fulfill(ok(origin, { labName: TENANT.name, dateFormat: 'dd MMM yyyy', timeFormat: '24h' }));
    const byOrder = /^\/api\/reports\/by-order\/([^/]+)$/.exec(p);
    if (byOrder) { const o = ORDERS.find(x => x.id === byOrder[1]); return route.fulfill(ok(origin, o ? report(o) : null)); }
    // ── Front desk ──
    if (p === '/api/orders/today' || p === '/api/orders/range') return route.fulfill(ok(origin, ORDERS));
    if (p === '/api/billing/outstanding') return route.fulfill(ok(origin, { due: neg.bills, refundsOwed: [] }));
    if (p === '/api/billing/' && m === 'POST') { const o = ORDERS.find(x => x.id === body?.orderId) ?? PLAIN; return route.fulfill(ok(origin, BILL(o))); }
    if (p === '/api/config/invoice-template') return route.fulfill(ok(origin, { labName: TENANT.name, showLogo: false }));
    const track = /^\/api\/orders\/([^/]+)\/track-token$/.exec(p);
    if (track) return route.fulfill(ok(origin, { token: `trk-${track[1]}` }));
    const ref = /^\/api\/orders\/([^/]+)\/referral$/.exec(p);
    if (ref) {
      const o = ORDERS.find(x => x.id === ref[1]) as any;
      if (m === 'PATCH') return route.fulfill(ok(origin, { changed: true, reportAmended: false, order: { refDoctorName: 'Dr. Rao Jr', refHospitalName: null } }));
      return route.fulfill(ok(origin, { orderId: o?.id, orderNumber: o?.orderNumber, status: 'validated', patientName: o?.patient.displayName, refDoctorName: o?.refDoctorName ?? null, sourceTypes: ['Doctor', 'Hospital', 'Walk-in'] }));
    }
    const one = /^\/api\/orders\/([^/]+)$/.exec(p);
    if (one) return route.fulfill(ok(origin, ORDERS.find(x => x.id === one[1]) ?? PLAIN));
    // ── Result entry ──
    if (p === '/api/samples/smp-1/tests') return route.fulfill(ok(origin, neg.tube));
    if (p === '/api/samples/smp-1/results/draft' && m === 'POST') return route.fulfill(ok(origin, { sample: neg.tube }));
    if (m === 'GET') return route.fulfill(ok(origin, []));
    return route.fulfill(ok(origin, {}));
  });
  await page.route(/supabase\.co\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    return route.fulfill(json(origin, 200, { access_token: jwt(ME.authId), refresh_token: `rt-${ME.authId}`, token_type: 'bearer', expires_in: 86400, user: { id: ME.authId, aud: 'authenticated', email: 'admin@demolab.example' } }));
  });
  await context.route(/(whatsapp\.com|wa\.me)\//, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>WhatsApp (stub)</title><p>stub</p>' }));
  await page.routeWebSocket(/\/hubs\//, ws => { ws.onMessage(() => ws.send('{}\x1e')); });
  await page.addInitScript(([session, storage, hint]) => {
    // A frame without storage (the report designer's PDF preview iframe) has nothing to seed.
    let store: Storage | null = null;
    try { store = window.sessionStorage; } catch { store = null; }
    if (!store) return;
    // Seed with the REAL storage first, then (maybe) break it for the app.
    if (!sessionStorage.getItem('pf.e2e.seeded')) {
      sessionStorage.setItem('pf.e2e.seeded', '1'); localStorage.clear();
      localStorage.setItem('pf.session', session as string); localStorage.setItem('pf-design', 'new');
      localStorage.setItem('pf.wa.manual.reminded', '1');
      if (hint) localStorage.setItem('pf.startHintSeen', '1');
    }
    if (storage !== 'normal') {
      const boom = () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); };
      // Session keys must survive a write failure (a full / private-mode disk still READS fine); 'all-throws' breaks reads too.
      const realGet = Storage.prototype.getItem;
      Storage.prototype.setItem = boom;
      Storage.prototype.removeItem = boom;
      Storage.prototype.getItem = storage === 'all-throws' ? boom : realGet;
    }
  }, [JSON.stringify({ access_token: jwt(ME.authId), refresh_token: `rt-${ME.authId}` }), o.storage ?? 'normal', o.seedHintSeen !== false] as const);
}

/** Plain-language light theme (the screens specs screenshot-free). */
export async function lightTheme(page: Page): Promise<void> {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => { const r = document.documentElement; r.classList.remove('dark'); r.classList.add('light'); r.setAttribute('data-theme', 'light'); });
}

// ───────────────────────── shared page helpers ─────────────────────────
import { expect } from '@playwright/test';
import { isDesktopApp } from './form-factor';

/** page.goto(route); the desktop-app bridge turns a deep path into the hash route Electron uses (/#/path). */
export async function go(page: Page, route: string): Promise<void> {
  await page.goto(route);
  if (isDesktopApp()) expect(new URL(page.url()).hash, 'desktop app routes with a hash').toMatch(/^#\//);
}
export const visible = (page: Page, sel: string) => page.locator(sel).locator('visible=true').first();
export const toast = (page: Page, text: string | RegExp) => page.getByText(text).locator('visible=true').first();

/** Message channels live at Organization › Message channels (Settings shell); each channel is a category (`?tab=`). */
export const COMMS_TAB: Record<string, string> = { WhatsApp: 'whatsapp', Email: 'email', SMS: 'sms' };
export async function openComms(page: Page, tab?: string): Promise<void> {
  await go(page, `/admin/org/channels?tab=${tab ?? 'whatsapp'}`);
  await expect(visible(page, '[data-testid="comms-page"]')).toBeVisible({ timeout: 60_000 });
}
/** Switch channel the way a person does: the shell's category in the left panel (wide), or back to the list and pick it (phone). */
export async function pickCommsTab(page: Page, label: string): Promise<void> {
  const id = COMMS_TAB[label] ?? label.toLowerCase();
  const item = page.locator(`[data-testid="tp-item-${id}"]`).locator('visible=true').first();
  if (!(await item.count())) {
    const back = page.locator('.pf-hb__back').locator('visible=true').first();
    if (await back.count()) await back.click();
  }
  await page.locator(`[data-testid="tp-item-${id}"]`).locator('visible=true').first().click();
  await expect(page).toHaveURL(new RegExp(`tab=${id}`));
  await expect(visible(page, '[data-testid="comms-page"]')).toBeVisible({ timeout: 20_000 });
}

/** Front desk → Completed tab, with the first demo patient listed. */
export async function openDesk(page: Page, waitFor = 'Priya Nair'): Promise<void> {
  await go(page, '/frontdesk');
  const tab = page.locator('[aria-label="Completed"], [title*="Completed"]').locator('visible=true').first()
    .or(page.getByText('Completed', { exact: true }).locator('visible=true').first());
  await expect(tab.first()).toBeVisible({ timeout: 60_000 });
  await tab.first().click();
  await expect(page.getByText(waitFor).locator('visible=true').first()).toBeVisible({ timeout: 20_000 });
}
export function shareButton(page: Page, name: string) {
  return page.locator(':is(.pf-wrow, li, tr)').filter({ hasText: name }).locator('button[aria-label="Share report"]').locator('visible=true').first();
}
