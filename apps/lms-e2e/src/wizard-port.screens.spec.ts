import type { Page } from '@playwright/test';
import { test, expect, shotsDir, expectLayout, expectFitsWidth, isDesktopApp } from './support/form-factor';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * "Connect an analyzer" at every form factor. The desktop app (Electron NOT launched: the form-factor bridge stub +
 * the netdiag `instruments.diag` merged in) runs the wizard's "Find the analyzer" step with the fixed-port editor;
 * the web, a phone and a tablet can't reach the lab PC's network, so they say "Open this on the lab PC" and offer
 * "Add an instrument by hand". Offline. Screenshots: SHOTS_DIR/<project>/.
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/wizard-port');

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

async function offlineBackend(page: Page, phone: string | null, optOut = false) {
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
    if (p === '/api/whatsapp/settings') return route.fulfill(ok(origin, { canSend: false }));
    if (p === '/api/whatsapp/reports/rep-1') return route.fulfill(ok(origin, { patientOptOut: optOut, configured: false, autoSendEnabled: false, canSend: false, latest: null }));
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


const SNAP = {
  platform: 'win32', hostname: 'LAB-RECEPTION', suggestedPort: 5604,
  adapters: [
    { name: 'Ethernet', description: 'Realtek PCIe GbE Family Controller', gateway: '192.168.1.1', ipv4: [{ address: '192.168.1.8' }] },
    { name: 'Ethernet 2', description: 'ASIX AX88179 USB 3.0 to Gigabit Ethernet Adapter', gateway: null, ipv4: [{ address: '192.168.1.10' }] },
  ],
  profiles: [{ name: 'Network 3', alias: 'Ethernet', category: 'Private' }, { name: 'Network', alias: 'Ethernet 2', category: 'Private' }],
  firewall: { supported: true, blockRules: 0, ourRule: true, ourRulePorts: ['5599-5610'] },
  problems: [],
};

async function seedWizard(page: Page, withDiag: boolean) {
  await page.addInitScript(([session, snap, diagOn]) => {
    if (!sessionStorage.getItem('pf.e2e.seeded')) {
      sessionStorage.setItem('pf.e2e.seeded', '1');
      localStorage.clear();
      localStorage.setItem('pf.session', session as string);
      localStorage.setItem('pf-design', 'new');
    }
    const w = window as any;
    if (!diagOn) return;
    const scanSubs: ((e: unknown) => void)[] = [];
    w.__ports = [5604, 5599, 5600, 5601, 5602, 5603, 5605, 5606, 5607, 5608, 5609, 5610];
    const diag = {
      snapshot: async () => snap,
      ports: async () => [], nextPort: async () => 5604, fixFirewall: async () => ({ ok: true }),
      arp: async () => [], probe: async () => ({ open: [] }),
      scanStart: async (p: { ports: number[] }) => ({ scanId: 'scan-1', ports: p.ports.map((port) => ({ port, ok: true })) }),
      scanPort: async (p: { port: number; previous?: number }) => {
        if (p.port === 5100) return { ok: false, error: 'Port 5100 is used by the analyzer "Medonic M51" on this PC. Pick another port, or open that analyzer instead.', code: 'port_in_use' };
        if (p.port === 8080) return { ok: false, error: 'Port 8080 is used by Skype (PID 4410). Close that program, or pick another port for this analyzer.', code: 'port_in_use' };
        return { ok: true, port: p.port, ports: [p.port, 5599, 5600, 5601, 5602, 5603, 5604, 5605, 5606, 5607, 5608, 5609] };
      },
      scanStop: async () => ({ ports: [] }),
      onScan: (cb: (e: unknown) => void) => { scanSubs.push(cb); return () => {}; },
    };
    w.__emitScan = (e: unknown) => scanSubs.forEach((f) => f(e));
    // MERGE into the desktop-app bridge (support/form-factor.ts): only the netdiag part is this screen's.
    w.electronAPI = { ...(w.electronAPI || { isElectron: true }), instruments: { ...((w.electronAPI || {}).instruments || {}), diag } };
  }, [JSON.stringify({ access_token: jwt(ME.authId), refresh_token: `rt-${ME.authId}` }), SNAP, withDiag] as const);
}

async function setTheme(page: Page, d: boolean) {
  await page.emulateMedia({ colorScheme: d ? 'dark' : 'light' });
  await page.evaluate(x => { const r = document.documentElement; r.classList.toggle('dark', x); r.classList.toggle('light', !x); r.setAttribute('data-theme', x ? 'dark' : 'light'); }, d);
  await page.waitForTimeout(500);
}

for (const d of [false, true]) {
  const mode = d ? 'dark' : 'light';
  test(`wizard port ${mode}`, async ({ page }) => {
    test.setTimeout(120_000);
    const OUT = shotsDir(OUT_BASE);
    await offlineBackend(page, null);
    await seedWizard(page, isDesktopApp());
    await page.goto('/admin/instruments/connect');
    if (!isDesktopApp()) {
      // Not the lab PC: no network checks here; the way forward is the desktop app, or adding by hand.
      await expect(page.getByText('Open this on the lab PC')).toBeVisible({ timeout: 30_000 });
      await setTheme(page, d);
      await expect(page.getByRole('button', { name: 'Add an instrument by hand' })).toBeVisible();
      await expectFitsWidth(page, '.pf-empty', 'desktop-only notice');
      await expect(page.getByRole('button', { name: /Next: find the analyzer/ })).toHaveCount(0);
      await expectLayout(page, 'connect wizard (not the lab PC)');
      await page.screenshot({ path: `${OUT}/0-open-on-lab-pc-${mode}.png` });
      return;
    }
    await expect(page.getByRole('button', { name: /Next: find the analyzer/ })).toBeEnabled({ timeout: 30_000 });
    await setTheme(page, d);
    await expectLayout(page, 'connect wizard');
    await page.getByRole('button', { name: /Next: find the analyzer/ }).click();
    await expect(page.locator('.pf-cw-instr__v').nth(1)).toHaveText('5604');
    await page.screenshot({ path: `${OUT}/1-suggested-${mode}.png` });
    await page.getByRole('button', { name: 'Change the port' }).click();
    await page.screenshot({ path: `${OUT}/2-editor-${mode}.png` });
    await page.locator('.pf-cw-port__in').fill('8080');
    await page.getByRole('button', { name: 'Use this port' }).click();
    await expect(page.locator('.pf-cw-port')).toContainText('Skype');
    await page.screenshot({ path: `${OUT}/3-busy-${mode}.png` });
    await page.locator('.pf-cw-port__in').fill('6100');
    await page.getByRole('button', { name: 'Use this port' }).click();
    await expect(page.locator('.pf-cw-instr__v').nth(1)).toHaveText('6100');
    await expect(page.getByText('does not open port 6100')).toBeVisible();
    await page.screenshot({ path: `${OUT}/4-changed-firewall-${mode}.png` });
    await page.evaluate(() => (window as any).__emitScan({ scanId: 'scan-1', kind: 'detect', port: 6100, remote: '192.168.1.21:49731', messages: 1,
      detect: { protocol: 'hl7', link: 'mllp', confidence: 0.92, reasons: ['MSH segment found (HL7 v2)'], proposed: { link: { type: 'mllp' }, parser: { type: 'hl7' } } },
      guess: { make: 'Medonic', model: 'M51', profileKey: 'medonic-m51-cbc', label: 'Medonic M51' } }));
    await expect(page.locator('.pf-cw-headline')).toContainText('Medonic M51');
    await page.screenshot({ path: `${OUT}/5-connected-on-chosen-${mode}.png` });
  });
}
