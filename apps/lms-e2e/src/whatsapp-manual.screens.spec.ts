import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Review screenshots of the manual "Send on WhatsApp": (1) the DESKTOP-app
 * dock (Electron not launched: a fake bridge + an overlay at the rect
 * electron/whatsapp-dock.js gives the WebContentsView) and (2) the WEB
 * popup as two side-by-side windows. Offline; MOCK WhatsApp page only.
 * Not part of the suite (own config: playwright.screens.config.ts).
 */
const OUT = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/whatsapp-manual');

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


// Same maths as electron/whatsapp-dock.js (dockWidth / dockLayout) at 1440x900.
const HEADER_CSS = 112;
const dockWidth = (cw: number) => Math.max(0, Math.min(Math.round(Math.min(480, Math.max(380, cw * 0.24))), cw - 560));

const MSG = 'Dear Meena Iyer, your report from Demo Lab is ready. View it here: https://app.prefrontal.health/r/tok123';

function mockChat(dark: boolean): string {
  const c = dark
    ? { bg: '#0b141a', bar: '#202c33', txt: '#e9edef', sub: '#8696a0', bub: '#005c4b', comp: '#202c33', inp: '#2a3942', side: '#111b21' }
    : { bg: '#efeae2', bar: '#f0f2f5', txt: '#111b21', sub: '#667781', bub: '#d9fdd3', comp: '#f0f2f5', inp: '#ffffff', side: '#ffffff' };
  return `<!doctype html><meta charset=utf-8><style>
  *{box-sizing:border-box}body{margin:0;height:100vh;display:flex;flex-direction:column;font:14px system-ui,sans-serif;background:${c.bg};color:${c.txt};position:relative}
  .top{display:flex;align-items:center;gap:10px;padding:10px 14px;background:${c.bar};height:56px}
  .av{width:36px;height:36px;border-radius:50%;background:#8b9aa6;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600}
  .nm{font-weight:600}.st{font-size:12px;color:${c.sub}}
  .chat{flex:1;padding:18px 14px;display:flex;flex-direction:column;gap:8px;overflow:hidden}
  .day{align-self:center;background:${c.side};color:${c.sub};font-size:12px;padding:4px 10px;border-radius:8px}
  .in{align-self:flex-start;background:${c.side};padding:8px 10px;border-radius:8px;max-width:80%}
  .comp{display:flex;align-items:flex-end;gap:8px;padding:10px;background:${c.comp}}
  .inp{flex:1;background:${c.inp};border-radius:10px;padding:10px 12px;line-height:1.4;word-break:break-word;border:2px solid #25d36655}
  .send{width:42px;height:42px;border-radius:50%;background:#1fa855;display:flex;align-items:center;justify-content:center;flex:none}
  .tag{position:absolute;right:8px;top:62px;font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:${c.sub};background:${c.side};padding:2px 6px;border-radius:6px;opacity:.9}
  </style>
  <div class=top><div class=av>M</div><div><div class=nm>Meena Iyer</div><div class=st>+91 98765 43210</div></div></div>
  <div class=tag>mock WhatsApp page</div>
  <div class=chat><div class=day>Today</div><div class=in>Hello, is my report ready?</div></div>
  <div class=comp><div class=inp>${MSG}</div><div class=send><svg width=20 height=20 viewBox="0 0 24 24" fill="#fff"><path d="M3 20.5v-6.7l9-1.8-9-1.8V3.5L22 12 3 20.5Z"/></svg></div></div>`;
}

async function bridge(page: Page, widthCss: number) {
  await page.addInitScript(([w, top]) => {
    const subs: ((s: unknown) => void)[] = [];
    const st = { open: false, width: 0, top, loading: false, failed: false, pdfName: null as string | null };
    const emit = () => subs.forEach(f => f({ ...st }));
    (window as any).__waSetPdfCalled = false;
    (window as any).electronAPI = { whatsapp: {
      open: async () => { st.open = true; st.width = w; st.loading = false; st.failed = false; st.pdfName = null; emit();
        // Fallback: if the viewer never hands a PDF (offline), main would still have one from the service; show the chip anyway.
        setTimeout(() => { if (!(window as any).__waSetPdfCalled && st.open) { st.pdfName = 'report-LAB-2611-000042.pdf'; emit(); } }, 1200);
        return { ok: true }; },
      close: async () => { st.open = false; st.pdfName = null; emit(); },
      state: async () => ({ ...st }),
      onState: (cb: (s: unknown) => void) => { subs.push(cb); return () => { const i = subs.indexOf(cb); if (i >= 0) subs.splice(i, 1); }; },
      setPdf: async (p: { name: string }) => { (window as any).__waSetPdfCalled = true; st.pdfName = p.name.replace(/\.pdf$/i, '') + '.pdf'; emit(); return { ok: true }; },
      startDrag: () => {}, signOut: async () => {}, openElsewhere: async () => {},
    } };
  }, [widthCss, HEADER_CSS] as const);
}

async function setTheme(page: Page, d: boolean) {
  await page.emulateMedia({ colorScheme: d ? 'dark' : 'light' });
  await page.evaluate(x => { const r = document.documentElement; r.classList.toggle('dark', x); r.classList.toggle('light', !x); r.setAttribute('data-theme', x ? 'dark' : 'light'); }, d);
  await page.waitForTimeout(500);
}

for (const d of [false, true]) {
  const mode = d ? 'dark' : 'light';

  test(`desktop dock ${mode}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const w = dockWidth(1440);
    await bridge(page, w);
    await offlineBackend(page, '+919876543210');
    await seed(page, { stubOpen: true });
    await page.goto('/reports/view/rep-1');
    await expect(page.locator('.pf-rv-act--send')).toBeVisible({ timeout: 30_000 });
    await setTheme(page, d);
    // First-send reminder off: clean shot (only the real "WhatsApp is open"-type toast, if any).
    await page.evaluate(() => localStorage.setItem('pf.wa.manual.reminded', '1'));
    await page.locator('.pf-rv-act--send').click();
    await expect(page.locator('[data-testid=wa-dock]')).toBeVisible();
    // Overlay = the native WebContentsView rect: x = W - width, y = header, to the bottom.
    await page.evaluate(([html, w, top]) => {
      const f = document.createElement('iframe');
      f.id = 'mock-native-view'; f.srcdoc = html as string;
      f.style.cssText = `position:fixed;z-index:2147483647;left:${window.innerWidth - (w as number)}px;top:${top}px;width:${w}px;height:${window.innerHeight - (top as number)}px;border:0;border-left:1px solid rgba(127,127,127,.35)`;
      document.body.appendChild(f);
    }, [mockChat(d), w, HEADER_CSS] as const);
    await page.waitForTimeout(1200);
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/desktop-panel-${mode}.png` });
    const lay = await page.evaluate(() => {
      const r = (s: string) => { const b = document.querySelector(s)?.getBoundingClientRect(); return b && { x: b.x, y: b.y, w: b.width, h: b.height }; };
      return { app: r('app-root'), strip: r('.pf-wad'), bar: r('.pf-wad__bar'), row: r('.pf-wad__row'), pdf: r('.pf-wad__pdf') };
    });
    console.log('LAYOUT', mode, JSON.stringify(lay));
  });

  test(`web side window ${mode}`, async ({ page, browser }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1020, height: 900 });
    await offlineBackend(page, '+919876543210');
    await seed(page, { stubOpen: true });
    await page.goto('/reports/view/rep-1');
    await expect(page.locator('.pf-rv-act--send')).toBeVisible({ timeout: 30_000 });
    await setTheme(page, d);
    await page.evaluate(() => localStorage.setItem('pf.wa.manual.reminded', '1'));
    await page.locator('.pf-rv-act--send').click();
    await expect.poll(() => page.evaluate(() => (window as any).__waOpens.length)).toBe(1);
    await page.waitForTimeout(800);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-shots-'));
    await page.screenshot({ path: `${tmp}/app.png` });
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, colorScheme: d ? 'dark' : 'light' });
    const p2 = await ctx.newPage();
    await p2.setContent(mockChat(d));
    await p2.screenshot({ path: `${tmp}/wa.png` });
    await ctx.close();
    // Two OS-style windows side by side on a 1440x900 screen, thin divider.
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p3 = await ctx2.newPage();
    await p3.setContent(`<style>*{margin:0;box-sizing:border-box}body{width:1440px;height:900px;display:flex;background:#1b1d22;overflow:hidden}
      .w{display:flex;flex-direction:column;background:#000}.tb{height:0}.tb *{display:none}img{display:block}
      .div{width:1px;background:#6b7280;flex:none}</style>
      <div class=w><img src="data:image/png;base64,${fs.readFileSync(`${tmp}/app.png`).toString('base64')}"></div><div class=div></div><div class=w><img src="data:image/png;base64,${fs.readFileSync(`${tmp}/wa.png`).toString('base64')}"></div>`);
    await p3.waitForTimeout(500);
    await p3.screenshot({ path: `${OUT}/web-side-window-${mode}.png` });
    await ctx2.close();
  });
}
