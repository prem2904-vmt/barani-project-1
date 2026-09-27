import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';

/**
 * MESSAGES — realtime + account switch + calls, FULLY OFFLINE (Messages RCA
 * 2026-09-27). No backend, no real accounts, nothing ever leaves the browser:
 *  - every API call to the (dev) API host and Supabase is answered in the
 *    page from made-up fixtures (two demo people "Admin User" and "Priya
 *    Sharma" in a made-up "Demo Lab");
 *  - both SignalR hubs are local fakes (routeWebSocket, JSON protocol) that
 *    record the access_token each socket was opened with, every invocation
 *    and whether the socket was closed.
 *
 * Asserts: after "Add account" (in-place sign-in, NO reload) the Admin
 * sockets are closed and fresh ones open with Priya's token; a message sent
 * as Priya goes over Priya's socket; the new-message pop-up shows and opens
 * the thread; the call screens (outgoing / incoming / in-call / minimised)
 * render the ND design with the callee's name. Screenshots (light + dark,
 * 1440 + 375) into $SHOTS_DIR / $POPUP_SHOTS_DIR when set.
 *
 * Run against a static build on a spare port, with fake media devices:
 *   BASE_URL=http://127.0.0.1:4317 ./node_modules/.bin/playwright test \
 *     --config=apps/lms-e2e/playwright.config.ts --project=smoke messages-realtime
 */

const SHOTS = process.env['SHOTS_DIR'] || '';
const POPUP_SHOTS = process.env['POPUP_SHOTS_DIR'] || '';
const POPOVER_SHOTS = process.env['POPOVER_SHOTS_DIR'] || '';

test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  permissions: ['microphone'],
});

// ── Made-up fixtures ─────────────────────────────────────────────────────
const TENANT = { id: 't-demo', name: 'Demo Lab' };
type Who = { id: string; authId: string; first: string; last: string; username: string };
const ADMIN: Who = { id: 'app-admin', authId: 'sub-admin', first: 'Admin', last: 'User', username: 'admin' };
const PRIYA: Who = { id: 'app-priya', authId: 'sub-priya', first: 'Priya', last: 'Sharma', username: 'priya' };
const RAVI = { authId: 'sub-ravi', name: 'Ravi Kumar' };
// Two DIFFERENT colleagues who share the display name "Front Desk" (owner's
// duplicate) + a patient-anchored thread with the first one.
const FD1 = { authId: 'sub-fd1', name: 'Front Desk', email: 'frontdesk.main@t-demo.tenant.prefrontal' };
const FD2 = { authId: 'sub-fd2', name: 'Front Desk', email: 'frontdesk.annex@t-demo.tenant.prefrontal' };
const PEOPLE = [ADMIN, PRIYA];
const name = (w: Who) => `${w.first} ${w.last}`;

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub: string) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 86400, email: `${sub}@demo.test` })}.sig`;
const subOf = (token: string | null): string | null => {
  try { return JSON.parse(Buffer.from(token!.split('.')[1], 'base64url').toString()).sub; } catch { return null; }
};

function conversationsFor(sub: string) {
  const me = PEOPLE.find(p => p.authId === sub)!;
  const self = { userId: me.authId, displayName: name(me), email: '' };
  const other = me === ADMIN ? PRIYA : ADMIN;
  const extra = me === PRIYA ? [
    { id: 'c-fd1', isGroup: false, name: null, createdById: me.authId, lastMessageAt: new Date().toISOString(), unreadCount: 0,
      participants: [self, { userId: FD1.authId, displayName: FD1.name, email: FD1.email }], lastMessage: { id: 'x1', fromUserId: FD1.authId, body: 'Hi', sentAt: new Date().toISOString() }, isMuted: false },
    { id: 'c-fd1-patient', isGroup: false, name: null, createdById: me.authId, lastMessageAt: new Date().toISOString(), unreadCount: 0,
      contextType: 'patient', contextId: 'p1', contextLabel: 'Meena Iyer · 26117',
      participants: [self, { userId: FD1.authId, displayName: FD1.name, email: FD1.email }], lastMessage: null, isMuted: false },
    { id: 'c-fd2', isGroup: false, name: null, createdById: me.authId, lastMessageAt: new Date().toISOString(), unreadCount: 0,
      participants: [self, { userId: FD2.authId, displayName: FD2.name, email: FD2.email }], lastMessage: null, isMuted: false },
  ] : [];
  return [
    ...extra,
    { id: `c-${me.username}-ravi`, isGroup: false, name: null, createdById: me.authId, lastMessageAt: new Date().toISOString(), unreadCount: 0,
      participants: [self, { userId: RAVI.authId, displayName: RAVI.name, email: '' }], lastMessage: null, isMuted: false },
    { id: 'c-admin-priya', isGroup: false, name: null, createdById: ADMIN.authId, lastMessageAt: new Date().toISOString(), unreadCount: 0,
      participants: [self, { userId: other.authId, displayName: name(other), email: '' }], lastMessage: null, isMuted: false },
  ];
}

interface Hub { kind: 'chat' | 'signaling'; sub: string | null; ws: WebSocketRoute; closed: boolean; invocations: Array<{ target: string; args: unknown[] }> }

async function offlineBackend(page: Page) {
  const hubs: Hub[] = [];
  const cors = (origin: string) => ({ 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
    'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
  const ok = (origin: string, data: unknown) => ({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' },
    body: JSON.stringify({ success: true, data }) });

  await page.route(/prefrontal\.health\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    const url = new URL(req.url());
    const p = url.pathname;
    const sub = subOf((req.headers()['authorization'] ?? '').replace(/^Bearer\s+/i, ''));
    const me = PEOPLE.find(x => x.authId === sub);
    if (p === '/api/auth/login') {
      const body = JSON.parse(req.postData() ?? '{}');
      const who = PEOPLE.find(x => x.username === body.username);
      if (!who) return route.fulfill({ status: 401, headers: cors(origin), body: JSON.stringify({ success: false, error: { message: 'Invalid' } }) });
      return route.fulfill(ok(origin, { accessToken: jwt(who.authId), refreshToken: `rt-${who.authId}`, tenant: TENANT, mustChangePassword: false }));
    }
    if (p === '/api/auth/me') {
      if (!me) return route.fulfill({ status: 401, headers: cors(origin), body: '{}' });
      return route.fulfill(ok(origin, {
        id: me.id, authId: me.authId, firstName: me.first, fathersName: me.last, displayName: name(me),
        email: `${me.username}@demo.test`, tenantId: TENANT.id, tenantName: TENANT.name, branchId: 'b1', branchName: 'Main',
        roles: ['Lab Admin'], permissions: ['*'], branches: [{ id: 'b1', name: 'Main' }], modules: ['lab'], hasPin: false,
      }));
    }
    if (p === '/api/tenants/modules') return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: false }) });
    if (p === '/api/tenants/current') return route.fulfill(ok(origin, { id: TENANT.id, name: TENANT.name }));
    if (p === '/api/process-workflows/active') return route.fulfill(ok(origin, null));
    if (p === '/api/chat/conversations') return route.fulfill(ok(origin, sub ? conversationsFor(sub) : []));
    if (/\/api\/directory\/users$/.test(p)) {
      return route.fulfill(ok(origin, [
        ...PEOPLE.map(x => ({ id: x.authId, displayName: name(x), email: `${x.username}@demo.test`, isActive: true })),
        { id: RAVI.authId, displayName: RAVI.name, email: 'ravi@demo.test', isActive: true },
      ]));
    }
    if (req.method() === 'GET') return route.fulfill(ok(origin, []));
    return route.fulfill(ok(origin, {}));
  });
  await page.route(/supabase\.co\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    const body = JSON.parse(req.postData() ?? '{}');
    const sub = typeof body.refresh_token === 'string' ? body.refresh_token.replace(/^rt-/, '') : ADMIN.authId;
    return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' },
      body: JSON.stringify({ access_token: jwt(sub), refresh_token: `rt-${sub}`, token_type: 'bearer', expires_in: 86400,
        user: { id: sub, aud: 'authenticated', email: `${sub}@demo.test` } }) });
  });

  await page.routeWebSocket(/\/hubs\//, ws => {
    const u = new URL(ws.url());
    const hub: Hub = { kind: u.pathname.includes('chat') ? 'chat' : 'signaling', sub: subOf(u.searchParams.get('access_token')),
      ws, closed: false, invocations: [] };
    hubs.push(hub);
    const RS = '\x1e';
    const ping = setInterval(() => { try { ws.send(JSON.stringify({ type: 6 }) + RS); } catch { clearInterval(ping); } }, 5000);
    ws.onClose(() => { hub.closed = true; clearInterval(ping); });
    ws.onMessage(raw => {
      for (const frame of String(raw).split(RS).filter(Boolean)) {
        const msg = JSON.parse(frame);
        if (msg.protocol) { ws.send('{}' + RS); continue; }
        if (msg.type === 7) { hub.closed = true; continue; }
        if (msg.type !== 1 || !msg.target) continue;
        hub.invocations.push({ target: msg.target, args: msg.arguments ?? [] });
        if (msg.invocationId === undefined) continue;
        let result: unknown = null;
        if (msg.target === 'GetOnlineUsersWithStatus') result = { [RAVI.authId]: 'active', [ADMIN.authId]: 'active', [PRIYA.authId]: 'active', [FD1.authId]: 'active', [FD2.authId]: 'away' };
        if (msg.target === 'GetOnlineUsers') result = [RAVI.authId];
        if (msg.target === 'GetTurnCredentials') result = { iceServers: [], ttl: 3600, provider: 'none' };
        if (msg.target === 'StartCall') result = { sessionId: 's-out' };
        if (msg.target === 'AcceptCall') result = { sessionId: msg.arguments?.[0], participants: [ADMIN.authId] };
        ws.send(JSON.stringify({ type: 3, invocationId: msg.invocationId, result }) + RS);
      }
    });
  });
  return { hubs };
}

const send = (h: Hub, target: string, ...args: unknown[]) =>
  h.ws.send(JSON.stringify({ type: 1, target, arguments: args }) + '\x1e');

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((t) => {
    const r = document.documentElement;
    r.classList.toggle('dark', t === 'dark');
    r.classList.toggle('light', t === 'light');
    r.setAttribute('data-theme', t);
  }, theme);
}
async function shoot(page: Page, dir: string, nameBase: string, widths: number[] = [1440, 375]) {
  if (!dir) return;
  const vp = page.viewportSize()!;
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: w === 375 ? 812 : 900 });
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${dir}/${nameBase}-${w}-${theme}.png` });
    }
  }
  await setTheme(page, 'light');
  await page.setViewportSize(vp);
}

test.describe('Messages realtime — offline', () => {
  test('add account = clean slate; pop-up; ND call screens', async ({ page }) => {
    test.setTimeout(240_000);
    const { hubs } = await offlineBackend(page);
    await page.addInitScript(([session]) => {
      if (sessionStorage.getItem('pf.e2e.seeded')) return;
      sessionStorage.setItem('pf.e2e.seeded', '1');
      localStorage.clear();
      localStorage.setItem('pf.session', session);
      localStorage.setItem('pf-design', 'new');
    }, [JSON.stringify({ access_token: jwt(ADMIN.authId), refresh_token: `rt-${ADMIN.authId}` })]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    // ── Admin is signed in; both hubs open with Admin's token ────────────
    await expect.poll(() => hubs.filter(h => h.kind === 'chat' && h.sub === ADMIN.authId).length, { timeout: 30_000 }).toBeGreaterThan(0);
    const adminChat = hubs.find(h => h.kind === 'chat' && h.sub === ADMIN.authId)!;

    // ── Add account → Priya signs in IN PLACE (no reload) ────────────────
    await page.locator('button.pf-avatar-btn').first().click();
    await page.getByRole('button', { name: /add account/i }).click();
    await page.waitForURL(/\/login/);
    await page.getByPlaceholder(/your username/i).fill(PRIYA.username);
    await page.getByPlaceholder('••••••••').fill('demo-password');
    // Add-account mode labels the submit "Add account".
    await page.locator('form button[type="submit"], button:has-text("Add account")').last().click();
    await page.waitForURL(url => !/\/login/.test(url.pathname), { timeout: 30_000 });

    // Admin's chat socket is CLOSED; a new one opened with Priya's token.
    await expect.poll(() => adminChat.closed, { timeout: 15_000 }).toBe(true);
    await expect.poll(() => hubs.filter(h => h.kind === 'chat' && h.sub === PRIYA.authId && !h.closed).length, { timeout: 30_000 }).toBeGreaterThan(0);
    const priyaChat = hubs.find(h => h.kind === 'chat' && h.sub === PRIYA.authId && !h.closed)!;
    for (const h of hubs.filter(x => x.sub === ADMIN.authId)) expect(h.closed).toBe(true);

    // ── Navbar Messages popover: presence dots + no ambiguous duplicates ──
    await page.getByRole('button', { name: 'Messages', exact: true }).click();
    const pop = page.locator('.pf-msgs-pop');
    await expect(pop).toBeVisible();
    await expect.poll(async () => pop.locator('pf-presence-dot').count(), { timeout: 10_000 }).toBeGreaterThan(3);
    const labels = await pop.locator('pf-presence-dot:not([hidden])').evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
    expect(labels).toContain('Online');
    expect(labels).toContain('Away');
    // The three "Front Desk" rows are told apart.
    const fdRows = pop.locator('.pf-msgs-pop__name', { hasText: 'Front Desk' });
    await expect(fdRows).toHaveCount(3);
    const fdText = (await fdRows.allInnerTexts()).map(t => t.trim());
    expect(new Set(fdText).size).toBe(3);
    expect(fdText.join('|')).toContain('Meena Iyer · 26117');
    expect(fdText.join('|')).toContain('@frontdesk.annex');
    // Live delta while the popover is open: the second Front Desk comes online.
    const priyaSigHub = () => hubs.find(h => h.kind === 'signaling' && h.sub === PRIYA.authId && !h.closed);
    await expect.poll(() => !!priyaSigHub(), { timeout: 30_000 }).toBe(true);
    const annexDot = pop.locator('.pf-msgs-pop__item', { hasText: '@frontdesk.annex' }).locator('pf-presence-dot');
    await expect(annexDot).toHaveAttribute('data-tone', 'away');
    send(priyaSigHub()!, 'UserPresenceChanged', { userId: FD2.authId, status: 'active' });
    await expect(annexDot).toHaveAttribute('data-tone', 'on');
    await page.waitForTimeout(300);
    await shoot(page, POPOVER_SHOTS, 'messages-popover', [1440]);
    // Picking a row closes the popover (opens that thread's window).
    await pop.locator('.pf-msgs-pop__item', { hasText: '@frontdesk.annex' }).click();
    await expect(pop).toHaveCount(0);

    // ── Pop-up for a message Priya isn't looking at ──────────────────────
    send(priyaChat, 'MessageReceived', { id: 'm-live-1', conversationId: 'c-priya-ravi', fromUserId: RAVI.authId,
      body: 'Sample 26117 looks haemolysed — can you redraw?', sentAt: new Date().toISOString(), kind: 'user' });
    const popup = page.locator('[data-testid="chat-popup"]');
    await expect(popup).toHaveCount(1, { timeout: 10_000 });
    await expect(popup).toContainText('Ravi Kumar');
    await expect(popup).toContainText('haemolysed');
    send(priyaChat, 'MessageReceived', { id: 'm-live-2', conversationId: 'c-priya-ravi', fromUserId: RAVI.authId,
      body: 'Patient is still at the desk.', sentAt: new Date().toISOString(), kind: 'user' });
    send(priyaChat, 'MessageReceived', { id: 'm-live-3', conversationId: 'c-priya-ravi', fromUserId: RAVI.authId,
      body: 'Thanks!', sentAt: new Date().toISOString(), kind: 'user' });
    await expect(page.locator('[data-testid="chat-popup-count"]')).toContainText('3 new messages');
    await page.locator('.pf-cpop').hover();          // hover pauses auto-dismiss for the shots
    await shoot(page, POPUP_SHOTS, 'popup-stack', [1440]);

    // My OWN message never pops.
    send(priyaChat, 'MessageReceived', { id: 'm-own', conversationId: 'c-admin-priya', fromUserId: PRIYA.authId,
      body: 'mine', sentAt: new Date().toISOString(), kind: 'user' });
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid="chat-popup"]', { hasText: 'mine' })).toHaveCount(0);

    // Click → opens the thread as a docked window; send goes over PRIYA's socket.
    await popup.first().locator('.pf-cpop__main').click();
    await expect(page.locator('[data-testid="chat-popup"]')).toHaveCount(0);
    const raviWin = page.locator('pf-chat-windows section.pf-cw__win', { hasText: 'Ravi Kumar' });
    const box = raviWin.locator('input.pf-cw__input');
    await expect(box).toBeVisible({ timeout: 10_000 });
    await box.fill('On it — sending the phlebotomist.');
    await box.press('Enter');
    await expect.poll(() => priyaChat.invocations.some(i => i.target === 'SendMessage'), { timeout: 10_000 }).toBe(true);
    expect(hubs.filter(h => h.sub === ADMIN.authId).some(h => h.invocations.some(i => i.target === 'SendMessage'))).toBe(false);

    // ── Calls (ND) ───────────────────────────────────────────────────────
    const priyaSig = () => hubs.find(h => h.kind === 'signaling' && h.sub === PRIYA.authId && !h.closed);
    await expect.poll(() => !!priyaSig(), { timeout: 30_000 }).toBe(true);

    // Outgoing from the docked window's call button → the callee's NAME.
    await raviWin.locator('button[aria-label="Voice call"]').click();
    const out = page.locator('[data-testid="call-outgoing"]');
    await expect(out).toBeVisible({ timeout: 15_000 });
    await expect(out.locator('[data-testid="call-outgoing-name"]')).toHaveText('Ravi Kumar');
    await page.waitForTimeout(400);
    await shoot(page, SHOTS, 'outgoing');

    // Callee joins → in call.
    await expect.poll(() => priyaSig()!.invocations.some(i => i.target === 'StartCall'), { timeout: 10_000 }).toBe(true);
    send(priyaSig()!, 'ParticipantJoined', { sessionId: 's-out', userId: RAVI.authId });
    const screen = page.locator('[data-testid="call-screen"]');
    await expect(screen).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="call-status"]')).toContainText('On call', { timeout: 15_000 });
    await page.locator('[data-testid="call-mute"]').click();
    await expect(page.locator('[data-testid="call-mute"]')).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);
    await shoot(page, SHOTS, 'in-call');

    // Round focus ring (keyboard focus on a round control).
    await page.locator('[data-testid="call-end"]').focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const ring = await page.locator('[data-testid="call-end"]').evaluate(e => ({
      shadow: getComputedStyle(e).boxShadow, radius: getComputedStyle(e).borderRadius, outline: getComputedStyle(e).outlineStyle }));
    expect(ring.radius).toMatch(/9999px|50%/);
    await page.waitForTimeout(450);          // let the theme transition settle
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/focus-ring-1440-light.png` });

    // No monospace anywhere in the call UI.
    const mono = await page.evaluate(() => Array.from(document.querySelectorAll('pf-call-overlay *'))
      .map(e => getComputedStyle(e).fontFamily).filter(f => /mono|courier|menlo|consolas/i.test(f)));
    expect(mono).toEqual([]);

    // Minimise → pill.
    await page.getByRole('button', { name: 'Minimise call' }).click();
    await expect(page.locator('[data-testid="call-pill"]')).toBeVisible();
    await page.waitForTimeout(300);
    await shoot(page, SHOTS, 'minimised');

    // End.
    await page.locator('[data-testid="call-pill"] button[aria-label="End call"]').click();
    await expect(page.locator('[data-testid="call-pill"]')).toHaveCount(0, { timeout: 10_000 });

    // Incoming (Admin calls Priya) → Decline stops it.
    send(priyaSig()!, 'IncomingCall', { sessionId: 's-in', callerId: ADMIN.authId, callerName: 'Admin User',
      callType: 'audio', participants: [ADMIN.authId] });
    const inc = page.locator('[data-testid="call-incoming"]');
    await expect(inc).toBeVisible({ timeout: 10_000 });
    await expect(inc).toContainText('Admin User');
    await expect(inc).toContainText('Incoming audio call');
    await page.waitForTimeout(400);
    await shoot(page, SHOTS, 'incoming');
    await page.locator('[data-testid="call-decline"]').click();
    await expect(inc).toHaveCount(0);
    await expect.poll(() => priyaSig()!.invocations.some(i => i.target === 'RejectCall')).toBe(true);
  });
});
