import { test, expect, type Page } from '@playwright/test';

/**
 * "WhatsApp Chat" (manual) on the WEB, desktop 1440×900 — FULLY OFFLINE.
 * No backend, no real accounts, and the REAL WhatsApp site is never loaded:
 * `window.open` is stubbed and records its calls; a second test opens a
 * MOCK WhatsApp page in the real popup (web.whatsapp.com is routed to a
 * local HTML) to check where the phone-shaped window lands.
 *
 * Asserts: the report's ⋮ / band show "WhatsApp Chat" for a lab without
 * any WhatsApp set-up; ONE click opens ONLY the click-to-chat link in ONE
 * named window ("pf-whatsapp", 420 wide, full height, flush right) with NO
 * dialog; the consent reminder is an info toast on the FIRST send of a
 * device only; a repeat click reuses that name; a patient who opted out gets
 * the only dialog (Send anyway / Cancel); a patient without a mobile gets a
 * plain message and nothing opens. Screenshots (light + dark) into $SHOTS_DIR.
 *
 *   node serve-spa.mjs dist/apps/lms/browser 4319 &
 *   BASE_URL=http://127.0.0.1:4319 SHOTS_DIR=/tmp/shots ./node_modules/.bin/playwright test \
 *     --config=apps/lms-e2e/playwright.offline.config.ts whatsapp-manual
 */

const SHOTS = process.env['SHOTS_DIR'] || '';

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

async function openReport(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/reports/view/rep-1');
  await expect(page.locator('.pf-rv-act--send')).toBeVisible({ timeout: 30_000 });
}

async function dark(page: Page) {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => { const r = document.documentElement; r.classList.add('dark'); r.classList.remove('light'); r.setAttribute('data-theme', 'dark'); });
  await page.waitForTimeout(400);
}

test.describe('WhatsApp Chat (manual) — web, offline', () => {
  test('every lab: band + ⋮ say "WhatsApp Chat"; one click, no dialog; ONE named phone-shaped window on the right', async ({ page }) => {
    test.setTimeout(120_000);
    await offlineBackend(page, '+919876543210');
    await seed(page, { stubOpen: true });
    await openReport(page);

    const send = page.locator('.pf-rv-act--send');
    await expect(send).toHaveAttribute('aria-label', 'WhatsApp Chat');
    await expect(send).toContainText('WhatsApp Chat');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/report-actions-light.png` });

    // The ⋮: one manual row, no "automatic" for a lab without a sender.
    await page.locator('.pf-rv-act--more').click();
    const menu = page.locator('[role=menu]');
    await expect(menu.getByRole('menuitem', { name: /WhatsApp Chat/ })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /automatic/ })).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/report-menu-light.png` });
    if (SHOTS) { await dark(page); await page.screenshot({ path: `${SHOTS}/report-menu-dark.png` }); }
    await page.locator('.pf-am-backdrop').click({ position: { x: 20, y: 400 } });
    await expect(menu).toHaveCount(0);

    // ONE click: no dialog; the consent reminder is a one-time info toast.
    const toast = page.getByText('Only send if the patient agreed to get reports on WhatsApp.');
    await send.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __waOpens: unknown[][] }).__waOpens.length)).toBe(1);
    await expect(page.locator('pf-dialog-host [role=dialog], pf-dialog-host [role=alertdialog]')).toHaveCount(0);
    await expect(toast).toBeVisible();
    await page.waitForTimeout(700);   // let the toast finish sliding in
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/first-send-reminder-dark.png` });

    const opens = await page.evaluate(() => (window as unknown as { __waOpens: unknown[][] }).__waOpens);
    expect(opens.length).toBe(1);
    const [url, name, features] = opens[0] as [string, string, string];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://web.whatsapp.com/send');
    expect([...u.searchParams.keys()]).toEqual(['phone', 'text']);
    expect(u.searchParams.get('phone')).toBe('919876543210');
    expect(u.searchParams.get('text')).toContain('Dear Meena Iyer, your report from Demo Lab is ready. View it here: ');
    expect(name).toBe('pf-whatsapp');
    expect(features).toBe('popup=yes,width=420,height=875,left=1020,top=25');

    // A repeat click reuses the SAME named window, no dialog, and NO reminder again.
    await page.waitForFunction(() => !document.body.innerText.includes('Only send if the patient agreed'), null, { timeout: 15_000 });
    await send.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __waOpens: unknown[][] }).__waOpens.length)).toBe(2);
    const again = await page.evaluate(() => (window as unknown as { __waOpens: unknown[][] }).__waOpens);
    expect(again[1][1]).toBe('pf-whatsapp');
    await expect(page.locator('pf-dialog-host [role=dialog], pf-dialog-host [role=alertdialog]')).toHaveCount(0);
    await page.waitForTimeout(500);
    await expect(toast).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('pf.wa.manual.reminded'))).toBe('1');

    // Light first-send reminder for review: forget the device flag, send again.
    if (SHOTS) {
      await page.emulateMedia({ colorScheme: 'light' });
      await page.evaluate(() => { const r = document.documentElement; r.classList.remove('dark'); r.classList.add('light'); r.setAttribute('data-theme', 'light');
        localStorage.removeItem('pf.wa.manual.reminded'); });
      await send.click();
      await expect(toast).toBeVisible();
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${SHOTS}/first-send-reminder-light.png` });
    }
  });

  test('patient opted out of WhatsApp: the ONLY dialog; Cancel opens nothing, Send anyway opens', async ({ page }) => {
    test.setTimeout(120_000);
    await offlineBackend(page, '+919876543210', true);
    await seed(page, { stubOpen: true });
    await openReport(page);
    const send = page.locator('.pf-rv-act--send');
    const host = page.locator('pf-dialog-host');
    const opens = () => page.evaluate(() => (window as unknown as { __waOpens: unknown[][] }).__waOpens.length);
    await send.click();
    await expect(host).toContainText('This patient opted out of WhatsApp');
    await expect(host).toContainText('+91 98765 43210');
    await page.waitForTimeout(700);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/opted-out-light.png` });
    await host.getByRole('button', { name: 'Cancel' }).click();
    expect(await opens()).toBe(0);
    await send.click();
    await host.getByRole('button', { name: 'Send anyway' }).click();
    await expect.poll(opens).toBe(1);
  });

  test('no mobile on file: a plain message, nothing opens', async ({ page }) => {
    test.setTimeout(120_000);
    await offlineBackend(page, null);
    await seed(page, { stubOpen: true });
    await openReport(page);
    await page.locator('.pf-rv-act--send').click();
    const host = page.locator('pf-dialog-host');
    await expect(host).toContainText('No mobile number');
    await expect(host).toContainText("This patient has no valid mobile number on file.");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/no-mobile-light.png` });
    await host.getByRole('button', { name: 'OK' }).click();
    expect(await page.evaluate(() => (window as unknown as { __waOpens: unknown[][] }).__waOpens.length)).toBe(0);
  });

  test('the real popup (MOCK WhatsApp page) lands as a phone-shaped window at the right edge', async ({ page, context }) => {
    test.setTimeout(120_000);
    // Never the real site: every whatsapp.com request gets a local mock page.
    await context.route(/whatsapp\.(com|net)/, route => route.fulfill({
      status: 200, contentType: 'text/html',
      body: `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width"><title>Mock WhatsApp</title>
        <body style="margin:0;font:15px system-ui;background:#efeae2;color:#111">
        <div style="background:#202c33;color:#e9edef;padding:14px 16px;font-weight:600">MOCK WhatsApp — chat with +91 98765 43210</div>
        <div style="padding:16px"><div style="background:#fff;border-radius:8px;padding:10px 12px;max-width:85%">(message box pre-filled by WhatsApp; the person presses Send)</div></div>
        <script>document.title='Mock WhatsApp '+location.search</script></body>`,
    }));
    await offlineBackend(page, '+919876543210');
    await seed(page, { stubOpen: false });
    await openReport(page);
    const popupP = page.waitForEvent('popup');
    await page.locator('.pf-rv-act--send').click();
    const popup = await popupP;
    await popup.waitForLoadState();
    expect(new URL(popup.url()).pathname).toBe('/send');
    const geo = await popup.evaluate(() => ({ w: window.outerWidth, h: window.outerHeight, x: window.screenX, y: window.screenY, name: window.name,
      screenW: screen.availWidth, screenH: screen.availHeight }));
    console.log('popup geometry', JSON.stringify(geo));
    expect(geo.name).toBe('pf-whatsapp');
    expect(geo.w).toBeLessThanOrEqual(440);   // phone-shaped
    // What the app asked for: flush right + full height of the screen it is on.
    // (Headless Chrome has no real screen and clamps the position, so the
    // request — not the headless window's x — is the thing to check.)
    const asked = await page.evaluate(() => ({ f: (window as unknown as { __waOpens: unknown[][] }).__waOpens[0][2] as string,
      w: screen.availWidth, h: screen.availHeight, l: (screen as unknown as { availLeft?: number }).availLeft ?? 0, t: (screen as unknown as { availTop?: number }).availTop ?? 0 }));
    console.log('popup asked', JSON.stringify(asked));
    expect(asked.f).toBe(`popup=yes,width=420,height=${asked.h},left=${asked.l + asked.w - 420},top=${asked.t}`);
    if (SHOTS) {
      await popup.screenshot({ path: `${SHOTS}/popup-mock-whatsapp.png` });
      // A picture of the placement: the app at 1440×900 with the popup's rect drawn on top.
      await page.evaluate(g => {
        const d = document.createElement('div');
        d.id = 'pf-wa-placement';
        d.style.cssText = `position:fixed;z-index:2147483647;left:${g.w - 420}px;top:0;width:420px;height:100vh;` +
          'border:3px dashed #7c3aed;background:rgba(124,58,237,.12);font:600 14px system-ui;color:#4c1d95;display:flex;align-items:center;justify-content:center;text-align:center;padding:16px;box-sizing:border-box';
        d.textContent = `WhatsApp window "${g.name}" requested as: ${g.f} — 420 wide, full height, flush right on this ${g.w}×${g.h} screen`;
        document.body.appendChild(d);
      }, { ...geo, ...asked });
      await page.screenshot({ path: `${SHOTS}/web-popup-placement.png` });
    }
    // Same name again → the browser reuses the window (no second popup with the mock page).
    await page.evaluate(() => document.getElementById('pf-wa-placement')?.remove());
    let second = false;
    page.once('popup', () => { second = true; });
    await page.locator('.pf-rv-act--send').click();
    await page.waitForTimeout(800);
    expect(second).toBe(false);
    expect(page.context().pages().length).toBe(2);   // the app + ONE WhatsApp window
  });
});
