import { test, expect, type Page } from '@playwright/test';
import * as os from 'node:os';
import * as path from 'node:path';

/** Review screenshots: /printing "ID card size" row, light + dark. Offline. Own config: playwright.screens.config.ts. */
const OUT = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/idcard-size');

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

async function offlineBackend(page: Page) {
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


for (const mode of ['light', 'dark'] as const) {
  test(`ID card size row (${mode})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await offlineBackend(page);
    await page.addInitScript(([session, m]) => {
      if (!sessionStorage.getItem('pf.e2e.seeded')) {
        sessionStorage.setItem('pf.e2e.seeded', '1');
        localStorage.clear();
        localStorage.setItem('pf.session', session as string);
        localStorage.setItem('pf-design', 'new');
        localStorage.setItem('pf-theme', m as string);
        localStorage.setItem('pf.printConfig', JSON.stringify({ idCardWidthMm: 148, idCardHeightMm: 210 }));
      }
    }, [JSON.stringify({ access_token: jwt(ME.authId), refresh_token: `rt-${ME.authId}` }), mode] as const);
    await page.emulateMedia({ colorScheme: mode });
    await page.goto('/printing');
    const card = page.locator('.pf-card[data-card="idcard"]');
    await expect(card).toBeVisible({ timeout: 20000 });
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, `idcard-size-${mode}-page.png`) });
    await card.screenshot({ path: path.join(OUT, `idcard-size-${mode}-row.png`) });
  });
}
