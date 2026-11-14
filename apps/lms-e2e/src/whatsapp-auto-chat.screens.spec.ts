import type { Page } from '@playwright/test';
import { test, expect, shotsDir, expectLayout, expectFitsWidth, isDesktopApp, isTouch, bridgeCalls } from './support/form-factor';
import { installWhatsAppRecorder, openChat, expectedVia } from './support/whatsapp';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Review screenshots of WhatsApp Auto / WhatsApp Chat: the report band button in both modes
 * (light + dark) and what ONE click does at each form factor: web = a new tab + the PDF downloaded; desktop app =
 * the dock + the PDF copied (whatsapp.setPdf); phone / tablet = the share sheet with the PDF + the message.
 * Offline; fake patient only. Every form factor (playwright.screens.config.ts projects); shots in SHOTS_DIR/<project>/.
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/whatsapp-auto-chat');
const out = () => shotsDir(OUT_BASE);

const TENANT = { id: 't-demo', name: 'Demo Lab' };
const ME = { id: 'app-1', authId: 'sub-1', first: 'Kavya', last: 'Desk' };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub: string) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 86400, email: `${sub}@demo.test` })}.sig`;

function report(phone: string | null) {
  return {
    id: 'rep-1', orderId: 'ord-1', patientId: 'p1', type: 'final', status: 'generated',
    deliveryStatus: 'pending', createdAt: new Date().toISOString(), qrToken: 'tok123',
    patient: { displayName: 'Meena Iyer', phone },
    data: JSON.stringify({
      patient: { displayName: 'Meena Iyer', age: 42, sex: 'Female', mrn: 'MRN-1001', phone },
      order: { id: 'ord-1', orderNumber: 'LAB-2611-000042' },
      type: 'final', isPartial: false, tests: [],
    }),
  };
}

async function offlineBackend(page: Page, phone: string | null, o: { canSend?: boolean; platform?: Record<string, boolean> } = {}) {
  const cors = (origin: string) => ({ 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
    'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
  const ok = (origin: string, data: unknown) => ({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' },
    body: JSON.stringify({ success: true, data }) });
  await page.route(/prefrontal\.health\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    const p = new URL(req.url()).pathname;
    if (p === '/api/auth/me') {
      return route.fulfill(ok(origin, {
        id: ME.id, authId: ME.authId, firstName: ME.first, fathersName: ME.last, displayName: `${ME.first} ${ME.last}`,
        email: 'desk@demo.test', tenantId: TENANT.id, tenantName: TENANT.name, branchId: 'b1', branchName: 'Main',
        roles: ['Lab Admin'], permissions: ['*'], branches: [{ id: 'b1', name: 'Main' }], modules: ['lab'], hasPin: false,
      }));
    }
    if (p === '/api/tenants/modules') return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: false }) });
    if (p === '/api/tenants/current') return route.fulfill(ok(origin, { id: TENANT.id, name: TENANT.name }));
    if (p === '/api/process-workflows/active') return route.fulfill(ok(origin, null));
    // A lab with NO WhatsApp set-up at all: manual sending is still there.
    if (p === '/api/whatsapp/settings') return route.fulfill(ok(origin, { canSend: !!o.canSend, autoEntitled: o.platform?.['whatsappAuto'] !== false }));
    if (p === '/api/tenants/module-config') return route.fulfill(ok(origin, { inventory: true, messages: true, homeCollection: true, reports: true, ...(o.platform ?? {}) }));
    if (/\/api\/reports\/rep-1\/pdf$/.test(p)) return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/pdf' }, body: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF') });
    if (p === '/api/whatsapp/reports/rep-1') return route.fulfill(ok(origin, { patientOptOut: false, configured: !!o.canSend, autoSendEnabled: !!o.canSend, canSend: !!o.canSend, autoEntitled: o.platform?.['whatsappAuto'] !== false, latest: null, history: [] }));
    if (p === '/api/reports/rep-1' || p === '/api/reports/by-order/ord-1') return route.fulfill(ok(origin, report(phone)));
    if (p === '/api/config/report-template') return route.fulfill(ok(origin, { labName: TENANT.name, dateFormat: 'dd MMM yyyy', timeFormat: '24h' }));
    if (req.method() === 'GET') return route.fulfill(ok(origin, []));
    return route.fulfill(ok(origin, {}));
  });
  await page.route(/supabase\.co\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' },
      body: JSON.stringify({ access_token: jwt(ME.authId), refresh_token: `rt-${ME.authId}`, token_type: 'bearer', expires_in: 86400,
        user: { id: ME.authId, aud: 'authenticated', email: 'desk@demo.test' } }) });
  });
  await page.routeWebSocket(/\/hubs\//, ws => { ws.onMessage(() => ws.send('{}\x1e')); });
}

async function seed(page: Page) {
  await page.addInitScript(([session]) => {
    if (!sessionStorage.getItem('pf.e2e.seeded')) {
      sessionStorage.setItem('pf.e2e.seeded', '1');
      localStorage.clear();
      localStorage.setItem('pf.session', session as string);
      localStorage.setItem('pf-design', 'new');
      localStorage.setItem('pf.wa.manual.reminded', '1');
    }
  }, [JSON.stringify({ access_token: jwt(ME.authId), refresh_token: `rt-${ME.authId}` })] as const);
}

async function setTheme(page: Page, d: boolean) {
  await page.emulateMedia({ colorScheme: d ? 'dark' : 'light' });
  await page.evaluate(x => { const r = document.documentElement; r.classList.toggle('dark', x); r.classList.toggle('light', !x); r.setAttribute('data-theme', x ? 'dark' : 'light'); }, d);
  await page.waitForTimeout(500);
}

async function openReport(page: Page, d: boolean, o: { canSend?: boolean; platform?: Record<string, boolean> } = {}) {
  await offlineBackend(page, '+919876543210', o);
  await seed(page);
  await page.goto('/reports/view/rep-1');
  await expect(page.locator('.pf-rv-act--send')).toBeVisible({ timeout: 30_000 });
  await setTheme(page, d);
  await expectLayout(page, 'report view');
  await expectFitsWidth(page, '.pf-rv-act--send', 'WhatsApp button');
}

for (const d of [false, true]) {
  const mode = d ? 'dark' : 'light';

  test(`report button: WhatsApp Chat ${mode}`, async ({ page }) => {
    test.setTimeout(120_000);
    await openReport(page, d, { canSend: false });
    await expect(page.locator('.pf-rv-act--send')).toContainText('WhatsApp Chat');
    await page.screenshot({ path: `${out()}/report-button-chat-${mode}.png` });
  });

  test(`report button: WhatsApp Auto ${mode}`, async ({ page }) => {
    test.setTimeout(120_000);
    await openReport(page, d, { canSend: true });
    await expect(page.locator('.pf-rv-act--send')).toContainText('WhatsApp Auto');
    await page.screenshot({ path: `${out()}/report-button-auto-${mode}.png` });
  });

  test(`report button: Auto switched off by Prefrontal falls back to WhatsApp Chat ${mode}`, async ({ page }) => {
    test.setTimeout(120_000);
    await openReport(page, d, { canSend: true, platform: { whatsappAuto: false, whatsappChat: true } });
    await expect(page.locator('.pf-rv-act--send')).toContainText('WhatsApp Chat');
  });

  test(`report button: both off, no WhatsApp button ${mode}`, async ({ page }) => {
    test.setTimeout(120_000);
    await offlineBackend(page, '+919876543210', { canSend: true, platform: { whatsappAuto: false, whatsappChat: false } });
    await seed(page);
    await page.goto('/reports/view/rep-1');
    await expect(page.locator('.pf-rv-in').locator('visible=true').first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await expect(page.locator('.pf-rv-act--send')).toHaveCount(0);
    await setTheme(page, d);
    await expectLayout(page, 'report view, no WhatsApp');
    await page.screenshot({ path: `${out()}/report-button-none-${mode}.png` });
  });

  test(`WhatsApp Chat: one click/tap opens the chat and the PDF goes with it, no card, no toast ${mode}`, async ({ page, context }) => {
    test.setTimeout(120_000);
    const touch = isTouch();
    await installWhatsAppRecorder(page, context, { share: touch });
    await page.addInitScript((t: boolean) => {
      localStorage.setItem('pf.wa.manual.pdfhint', '1');
      if (!t) { (navigator as any).canShare = undefined; (navigator as any).share = undefined; }
    }, touch);
    await openReport(page, d, { canSend: false });
    const downloads: string[] = [];
    page.on('download', dl => downloads.push(dl.suggestedFilename()));
    const c = await openChat(page, () => page.locator('.pf-rv-act--send').click());
    expect(c.via).toBe(expectedVia(touch));
    if (touch) {
      // ONE tap: the share sheet carries the PDF + the message.
      expect(c.files[0]?.[1]).toBe('application/pdf');
      expect(c.text).toContain('your report from');
    } else {
      expect(c.phone).toBe('919876543210');
      expect(c.text).toContain('your report from');
    }
    if (isDesktopApp()) {
      await expect.poll(async () => (await bridgeCalls(page, 'whatsapp.setPdf')).length, { message: 'the PDF is handed to main (clipboard)' }).toBe(1);
      const pdf = (await bridgeCalls(page, 'whatsapp.setPdf'))[0].args[0] as { name: string; copyToClipboard: boolean };
      expect(pdf.name).toMatch(/^report-.*\.pdf$/);
      expect(pdf.copyToClipboard).toBe(true);
      await page.waitForTimeout(800);
      expect(downloads, 'the desktop app downloads nothing').toEqual([]);
      await expect(page.locator('[data-testid=wa-dock]')).toBeVisible();
    } else if (!touch) {
      await expect.poll(() => downloads, { message: 'the PDF downloads at the same moment' }).toHaveLength(1);
      expect(downloads[0]).toMatch(/^report-.*\.pdf$/);
    } else {
      await page.waitForTimeout(800);
      expect(downloads, 'the share sheet carried the file: nothing saved').toEqual([]);
    }
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid=wa-pdf-card]')).toHaveCount(0);
    await expect(page.locator('.toast-item')).toHaveCount(0);
    await page.screenshot({ path: `${out()}/after-click-${mode}.png` });
  });
}
