import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Review screenshots of WhatsApp Auto / WhatsApp Chat: the report band button in both modes
 * (light + dark) and the web / phone "Report PDF" card. Offline; fake patient only.
 * Not part of the suite (own config: playwright.screens.config.ts).
 */
const OUT = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/whatsapp-auto-chat');

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

async function seed(page: Page, opts: { stubOpen: boolean }) {
  await page.addInitScript(([session, stub]) => {
    if (!sessionStorage.getItem('pf.e2e.seeded')) {
      sessionStorage.setItem('pf.e2e.seeded', '1');
      localStorage.clear();
      localStorage.setItem('pf.session', session as string);
      localStorage.setItem('pf-design', 'new');
    }
    if (stub) {
      // A 1440-wide screen at the origin (the popup's placement reads it).
      Object.defineProperty(window.screen, 'availWidth', { get: () => 1440 });
      Object.defineProperty(window.screen, 'availHeight', { get: () => 875 });
      Object.defineProperty(window.screen, 'availLeft', { get: () => 0 });
      Object.defineProperty(window.screen, 'availTop', { get: () => 25 });
      const calls: unknown[][] = [];
      (window as unknown as { __waOpens: unknown[][] }).__waOpens = calls;
      window.open = ((...a: unknown[]) => { calls.push(a); return { opener: {}, focus() {}, closed: false } as unknown as Window; }) as typeof window.open;
    } else {
      // Record, then really open (the mock WhatsApp page).
      const calls: unknown[][] = [];
      (window as unknown as { __waOpens: unknown[][] }).__waOpens = calls;
      const real = window.open.bind(window);
      window.open = ((...a: Parameters<typeof window.open>) => { calls.push(a); return real(...a); }) as typeof window.open;
    }
  }, [JSON.stringify({ access_token: jwt(ME.authId), refresh_token: `rt-${ME.authId}` }), opts.stubOpen] as const);
}



async function setTheme(page: Page, d: boolean) {
  await page.emulateMedia({ colorScheme: d ? 'dark' : 'light' });
  await page.evaluate(x => { const r = document.documentElement; r.classList.toggle('dark', x); r.classList.toggle('light', !x); r.setAttribute('data-theme', x ? 'dark' : 'light'); }, d);
  await page.waitForTimeout(500);
}

async function openReport(page: Page, d: boolean, o: { canSend?: boolean; platform?: Record<string, boolean>; w?: number; h?: number } = {}) {
  await page.setViewportSize({ width: o.w ?? 1440, height: o.h ?? 900 });
  await offlineBackend(page, '+919876543210', o);
  await seed(page, { stubOpen: true });
  await page.goto('/reports/view/rep-1');
  await expect(page.locator('.pf-rv-act--send')).toBeVisible({ timeout: 30_000 });
  await setTheme(page, d);
  await page.evaluate(() => localStorage.setItem('pf.wa.manual.reminded', '1'));
}

for (const d of [false, true]) {
  const mode = d ? 'dark' : 'light';

  test(`report button: WhatsApp Chat ${mode}`, async ({ page }) => {
    test.setTimeout(120_000);
    await openReport(page, d, { canSend: false });
    await expect(page.locator('.pf-rv-act--send')).toContainText('WhatsApp Chat');
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/report-button-chat-${mode}.png` });
  });

  test(`report button: WhatsApp Auto ${mode}`, async ({ page }) => {
    test.setTimeout(120_000);
    await openReport(page, d, { canSend: true });
    await expect(page.locator('.pf-rv-act--send')).toContainText('WhatsApp Auto');
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/report-button-auto-${mode}.png` });
  });

  test(`report button: Auto switched off by Prefrontal falls back to WhatsApp Chat ${mode}`, async ({ page }) => {
    test.setTimeout(120_000);
    await openReport(page, d, { canSend: true, platform: { whatsappAuto: false, whatsappChat: true } });
    await expect(page.locator('.pf-rv-act--send')).toContainText('WhatsApp Chat');
  });

  test(`report button: both off, no WhatsApp button ${mode}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await offlineBackend(page, '+919876543210', { canSend: true, platform: { whatsappAuto: false, whatsappChat: false } });
    await seed(page, { stubOpen: true });
    await page.goto('/reports/view/rep-1');
    await expect(page.locator('.pf-rv-in').first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await expect(page.locator('.pf-rv-act--send')).toHaveCount(0);
    await setTheme(page, d);
    await page.screenshot({ path: `${OUT}/report-button-none-${mode}.png` });
  });

  test(`web PDF card (Download PDF) ${mode}`, async ({ page }) => {
    test.setTimeout(120_000);
    await openReport(page, d, { canSend: false });
    await page.locator('.pf-rv-act--send').click();
    await expect(page.locator('[data-testid=wa-pdf-card]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid=wa-pdf-download]')).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/web-pdf-card-download-${mode}.png` });
  });

  test(`web PDF card (Share PDF primary) ${mode}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      (navigator as any).canShare = () => true;
      (navigator as any).share = async () => undefined;
    });
    await openReport(page, d, { canSend: false });
    await page.locator('.pf-rv-act--send').click();
    await expect(page.locator('[data-testid=wa-pdf-share]')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/web-pdf-card-share-${mode}.png` });
  });

  test(`phone Share PDF card ${mode}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      (navigator as any).canShare = () => true;
      (navigator as any).share = async () => undefined;
    });
    await offlineBackend(page, '+919876543210', { canSend: false });
    await seed(page, { stubOpen: true });
    await page.goto('/reports/view/rep-1');
    await expect(page.locator('.pf-rv-act--send')).toBeVisible({ timeout: 30_000 });
    await setTheme(page, d);
    await page.evaluate(() => localStorage.setItem('pf.wa.manual.reminded', '1'));
    await page.locator('.pf-rv-act--send').click();
    await expect(page.locator('[data-testid=wa-pdf-card]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid=wa-pdf-share]')).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/phone-pdf-card-${mode}.png` });
    await ctx.close();
  });
}
