import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';

/**
 * CALLS — REAL end to end (owner request 2026-09-27: "test the calling
 * feature"). Every person is an isolated browser context with Chromium's fake
 * microphone; SignalR, the hub, the DB and WebRTC are all real. Nothing leaves
 * the machine:
 *   - backend = prefrontal-mw `CallsE2EHost` on 127.0.0.1 (local
 *     prefrontal_test_* database, test-only auth);
 *   - UI = static build pointed at that backend (apiUrl) and at a dead
 *     Supabase URL; Supabase token refreshes are answered in-page from a
 *     made-up unsigned session; any request to a real *.prefrontal.health /
 *     *.supabase.co host is aborted AND fails the test.
 *
 * Asserts on the media plane, not just the UI: RTCPeerConnection
 * connectionState 'connected', a live remote audio track, inbound-rtp bytes
 * growing, audio ENERGY flowing (and stopping when the talker mutes).
 * See playwright.calls.config.ts for the run command.
 */

type Person = { name: string; authId: string; tenant: 'T1' | 'T2' };
const CFG = JSON.parse(readFileSync(process.env['CALLS_USERS'] ?? '', 'utf8')) as { apiUrl: string; users: Person[]; groupId: string };
const API = CFG.apiUrl;
const [ASHA, BALA, CHITRA, DEV, XAVIER] = CFG.users;
const SHOTS = process.env['CALLS_SHOTS'] || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// Hard safety rail: this suite only ever talks to loopback.
for (const u of [API, process.env['CALLS_BASE_URL'] || 'http://127.0.0.1:4391']) {
  const h = new URL(u).hostname;
  if (h !== '127.0.0.1' && h !== 'localhost') throw new Error(`calls E2E refuses non-local host ${h}`);
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub: string) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 86400, email: `${sub}@test.invalid` })}.sig`;

const blocked: string[] = [];
interface Who { ctx: BrowserContext; page: Page; person: Person }

async function openAs(browser: Browser, person: Person, path = '/messages'): Promise<Who> {
  const ctx = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1280, height: 800 } });
  await ctx.route(/prefrontal\.health|supabase\.co/, r => { blocked.push(r.request().url()); return r.abort(); });
  await ctx.route(/127\.0\.0\.1:59999/, async r => {
    const req = r.request();
    const origin = req.headers()['origin'] ?? '*';
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    let sub = person.authId;
    try { const b = JSON.parse(req.postData() ?? '{}'); if (typeof b.refresh_token === 'string') sub = b.refresh_token.replace(/^rt-/, ''); } catch { /* */ }
    return r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({ access_token: jwt(sub), refresh_token: `rt-${sub}`, token_type: 'bearer', expires_in: 86400,
        user: { id: sub, aud: 'authenticated', email: `${sub}@test.invalid` } }) });
  });
  await ctx.addInitScript(([session]) => {
    if (!sessionStorage.getItem('pf.e2e.seeded')) {
      sessionStorage.setItem('pf.e2e.seeded', '1');
      localStorage.clear();
      localStorage.setItem('pf.session', session);
      localStorage.setItem('pf-design', 'new');
    }
    // Keep a handle on every peer connection the app creates.
    const Orig = window.RTCPeerConnection;
    const list: RTCPeerConnection[] = [];
    (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs = list;
    window.RTCPeerConnection = class extends Orig {
      constructor(...a: ConstructorParameters<typeof RTCPeerConnection>) { super(...a); list.push(this); }
    } as typeof RTCPeerConnection;
  }, [JSON.stringify({ access_token: jwt(person.authId), refresh_token: `rt-${person.authId}` })]);
  const page = await ctx.newPage();
  await gotoReady(page, path);
  return { ctx, page, person };
}

/** Load a route and wait until the signaling hub socket is open. */
async function gotoReady(page: Page, path: string) {
  const hub = page.waitForEvent('websocket', { predicate: ws => ws.url().includes('/hubs/signaling'), timeout: 30_000 });
  await page.goto(path);
  await hub;
  await page.waitForTimeout(1200); // presence snapshot lands
}

async function api<T = unknown>(as: Person, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${as.authId}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json() as { data: T };
  return j.data;
}

type PcStat = { state: string; inBytes: number; energy: number; liveRemoteTracks: number };
function pcStats(page: Page): Promise<PcStat[]> {
  return page.evaluate(async () => {
    const pcs = ((window as unknown as { __pcs: RTCPeerConnection[] }).__pcs ?? []).filter(pc => pc.connectionState !== 'closed');
    return Promise.all(pcs.map(async pc => {
      const s = await pc.getStats();
      let inBytes = 0, energy = 0;
      s.forEach((r: Record<string, unknown>) => {
        if (r['type'] === 'inbound-rtp' && r['kind'] === 'audio') {
          inBytes += Number(r['bytesReceived'] ?? 0);
          energy += Number(r['totalAudioEnergy'] ?? 0);
        }
      });
      const liveRemoteTracks = pc.getReceivers().filter(x => x.track?.kind === 'audio' && x.track.readyState === 'live').length;
      return { state: pc.connectionState, inBytes, energy, liveRemoteTracks };
    }));
  });
}

/** Wait until `page` holds exactly `n` open peer connections, all 'connected'. */
async function expectConnectedPeers(page: Page, n: number, timeout = 30_000) {
  await expect.poll(async () => {
    const st = await pcStats(page);
    return st.filter(s => s.state === 'connected' && s.liveRemoteTracks > 0).length === n && st.length === n;
  }, { timeout, message: `${n} connected peer(s)` }).toBe(true);
}

/** Media is really flowing into `page`: bytes AND audio energy grow on every peer. */
async function expectAudioFlowing(page: Page, windowMs = 2500) {
  const a = await pcStats(page);
  await page.waitForTimeout(windowMs);
  const b = await pcStats(page);
  expect(b.length).toBe(a.length);
  b.forEach((s, i) => {
    expect(s.inBytes, 'inbound-rtp bytes grow').toBeGreaterThan(a[i].inBytes);
    expect(s.energy - a[i].energy, 'inbound audio energy grows').toBeGreaterThan(0.0001);
  });
}

/** Inbound audio energy from ONE peer over a window (sum across receivers). */
async function energyDelta(page: Page, windowMs = 3000) {
  const sum = async () => (await pcStats(page)).reduce((t, s) => t + s.energy, 0);
  const a = await sum();
  await page.waitForTimeout(windowMs);
  return (await sum()) - a;
}

async function openConversation(page: Page, title: string) {
  await page.locator('.pf-mnd-row', { hasText: title }).first().click();
  await expect(page.getByRole('button', { name: 'Voice call' })).toBeVisible();
}

async function callFromThread(page: Page, title: string) {
  await openConversation(page, title);
  await page.getByRole('button', { name: 'Voice call' }).click();
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function closeAll(...who: Who[]) {
  for (const w of who) await w.ctx.close().catch(() => undefined);
}


test.beforeAll(async () => {
  // Direct threads the calls start from (created through the real API).
  for (const peer of [BALA, CHITRA, DEV]) await api(ASHA, 'POST', '/api/chat/conversations/direct', { otherUserId: peer.authId });
  await api(CHITRA, 'POST', '/api/chat/conversations/direct', { otherUserId: BALA.authId });
});

test.afterAll(() => {
  expect(blocked, 'no request may reach a real dev/stage/Supabase host').toEqual([]);
});

test('1:1 — ring, answer, audio both ways, mute stops outbound audio, hang-up tears down both', async ({ browser }) => {
  const bala = await openAs(browser, BALA);
  const asha = await openAs(browser, ASHA);
  try {
    await callFromThread(asha.page, BALA.name);
    await expect(asha.page.getByTestId('call-outgoing')).toBeVisible();
    await expect(asha.page.getByTestId('call-outgoing-name')).toHaveText(BALA.name);
    const ring = bala.page.getByTestId('call-incoming');
    await expect(ring).toBeVisible({ timeout: 10_000 });
    await expect(ring).toContainText(ASHA.name);
    await shot(asha.page, '1to1-01-outgoing'); await shot(bala.page, '1to1-02-incoming');

    await bala.page.getByTestId('call-answer').click();
    for (const w of [asha, bala]) {
      await expect(w.page.getByTestId('call-status')).toContainText('On call', { timeout: 20_000 });
      await expectConnectedPeers(w.page, 1);
    }
    await expectAudioFlowing(asha.page);
    await expectAudioFlowing(bala.page);
    await shot(asha.page, '1to1-03-in-call');

    // Mute: Asha's outbound audio stops (Bala receives no energy), Bala sees the chip.
    const before = await energyDelta(bala.page);
    expect(before).toBeGreaterThan(0.0001);
    await asha.page.getByTestId('call-mute').click();
    await expect(asha.page.getByTestId('call-mute')).toHaveAttribute('aria-pressed', 'true');
    await expect(bala.page.getByTestId('call-muted-chip')).toBeVisible();
    await bala.page.waitForTimeout(800);
    const muted = await energyDelta(bala.page);
    expect(muted, 'no audio energy reaches the peer while muted').toBeLessThan(before / 20);
    await asha.page.getByTestId('call-mute').click();
    await expect(bala.page.getByTestId('call-muted-chip')).toHaveCount(0);
    await bala.page.waitForTimeout(800);
    expect(await energyDelta(bala.page)).toBeGreaterThan(0.0001);

    // Hang-up by the callee tears down BOTH sides.
    await bala.page.getByTestId('call-end').click();
    for (const w of [asha, bala]) {
      await expect(w.page.getByTestId('call-screen')).toHaveCount(0, { timeout: 10_000 });
      await expect.poll(async () => (await pcStats(w.page)).length).toBe(0);
    }
  } finally { await closeAll(asha, bala); }
});

test('decline — caller is told, ring stops on every tab of the callee', async ({ browser }) => {
  const bala = await openAs(browser, BALA);
  const balaTab2 = await bala.ctx.newPage();
  await gotoReady(balaTab2, '/messages');
  const asha = await openAs(browser, ASHA);
  try {
    await callFromThread(asha.page, BALA.name);
    await expect(bala.page.getByTestId('call-incoming')).toBeVisible({ timeout: 10_000 });
    await expect(balaTab2.getByTestId('call-incoming')).toBeVisible({ timeout: 10_000 }); // rings everywhere
    await bala.page.getByTestId('call-decline').click();
    await expect(balaTab2.getByTestId('call-incoming')).toHaveCount(0, { timeout: 10_000 }); // declined elsewhere
    await expect(asha.page.getByTestId('call-outgoing')).toHaveCount(0, { timeout: 10_000 });
    await expect(asha.page.locator('.pf-toasts'), 'the caller must be told the call was declined (toast — the call screens are gone)').toContainText(/declined/i, { timeout: 5_000 });
    await shot(asha.page, 'decline-caller');
  } finally { await closeAll(asha, bala); }
});

test('answered on one tab — the other tab stops ringing and never joins', async ({ browser }) => {
  const bala = await openAs(browser, BALA);
  const balaTab2 = await bala.ctx.newPage();
  await gotoReady(balaTab2, '/messages');
  const asha = await openAs(browser, ASHA);
  try {
    await callFromThread(asha.page, BALA.name);
    await expect(balaTab2.getByTestId('call-incoming')).toBeVisible({ timeout: 10_000 });
    await bala.page.getByTestId('call-answer').click();
    await expect(balaTab2.getByTestId('call-incoming')).toHaveCount(0, { timeout: 10_000 });
    await expectConnectedPeers(asha.page, 1);
    expect((await pcStats(balaTab2)).length).toBe(0);
    await asha.page.getByTestId('call-end').click();
    await expect(bala.page.getByTestId('call-screen')).toHaveCount(0, { timeout: 10_000 });
  } finally { await closeAll(asha, bala); }
});

test('cancel before answer — ring stops; callee gets a Missed call line and a missed entry in Calls', async ({ browser }) => {
  const bala = await openAs(browser, BALA);
  const asha = await openAs(browser, ASHA);
  try {
    await callFromThread(asha.page, BALA.name);
    await expect(bala.page.getByTestId('call-incoming')).toBeVisible({ timeout: 10_000 });
    await asha.page.getByTestId('call-cancel').click();
    await expect(bala.page.getByTestId('call-incoming')).toHaveCount(0, { timeout: 10_000 });

    await openConversation(bala.page, ASHA.name);
    await expect(bala.page.getByText(/Missed call/).first(), 'missed-call line in the 1:1 thread').toBeVisible({ timeout: 10_000 });
    await bala.page.locator('.pf-mnd-filter [data-filter="calls"]').click();
    const row = bala.page.locator('.pf-mnd-callrow', { hasText: ASHA.name }).first();
    await expect(row, 'missed call listed in Calls').toBeVisible({ timeout: 10_000 });
    await expect(row).toHaveClass(/pf-mnd-callrow--missed/);
    await shot(bala.page, 'missed-calls-tab');
  } finally { await closeAll(asha, bala); }
});

test('busy — calling someone already on a call is refused at once (no ring over their call)', async ({ browser }) => {
  const bala = await openAs(browser, BALA);
  const asha = await openAs(browser, ASHA);
  const chitra = await openAs(browser, CHITRA);
  try {
    await callFromThread(asha.page, BALA.name);
    await bala.page.getByTestId('call-answer').click();
    await expectConnectedPeers(bala.page, 1);

    await callFromThread(chitra.page, BALA.name);
    await expect(chitra.page.locator('.pf-toasts'), 'caller is told the callee is busy').toContainText(/on another call right now/i, { timeout: 8_000 });
    await expect(chitra.page.locator('.pf-toasts'), 'no raw SignalR wrapper text').not.toContainText('HubException');
    await expect(chitra.page.getByTestId('call-outgoing')).toHaveCount(0);
    // Bala's live call is untouched.
    await expect(bala.page.getByTestId('call-incoming')).toHaveCount(0);
    await expectAudioFlowing(bala.page);
    await shot(chitra.page, 'busy-caller');
    await asha.page.getByTestId('call-end').click();
  } finally { await closeAll(asha, bala, chitra); }
});

test('conference — 3-way group call, all hear each other; a 4th is added mid-call; one leaves, rest continue', async ({ browser }) => {
  const bala = await openAs(browser, BALA);
  const chitra = await openAs(browser, CHITRA);
  const dev = await openAs(browser, DEV);
  const asha = await openAs(browser, ASHA);
  const gif: Array<{ w: Who; name: string }> = [];
  const frame = async (w: Who, name: string) => { await shot(w.page, `conf-${String(gif.length).padStart(2, '0')}-${name}`); gif.push({ w, name }); };
  try {
    await callFromThread(asha.page, 'Ward round');
    await expect(asha.page.getByTestId('call-outgoing')).toContainText('Ward round');
    await frame(asha, 'asha-ringing-group');
    for (const w of [bala, chitra]) {
      await expect(w.page.getByTestId('call-incoming')).toContainText('Ward round', { timeout: 10_000 });
    }
    await expect(dev.page.getByTestId('call-incoming')).toHaveCount(0); // not a member
    await frame(bala, 'bala-incoming-group');

    await bala.page.getByTestId('call-answer').click();
    await expectConnectedPeers(asha.page, 1);
    await chitra.page.getByTestId('call-answer').click();
    for (const w of [asha, bala, chitra]) await expectConnectedPeers(w.page, 2);
    for (const w of [asha, bala, chitra]) await expectAudioFlowing(w.page);
    for (const w of [asha, bala, chitra]) {
      await expect(w.page.getByTestId('call-tile')).toHaveCount(3);
      await expect(w.page.getByTestId('call-status')).toContainText('On call');
    }
    await frame(asha, 'asha-3way'); await frame(bala, 'bala-3way'); await frame(chitra, 'chitra-3way');

    // Add Dev (not in the group) mid-call.
    await asha.page.getByRole('button', { name: 'Add participant' }).first().click();
    await asha.page.locator('.pf-call-invite__item', { hasText: DEV.name }).click();
    await expect(dev.page.getByTestId('call-incoming')).toBeVisible({ timeout: 10_000 });
    await frame(dev, 'dev-incoming-invite');
    await dev.page.getByTestId('call-answer').click();
    for (const w of [asha, bala, chitra, dev]) await expectConnectedPeers(w.page, 3);
    for (const w of [asha, bala, chitra, dev]) await expectAudioFlowing(w.page);
    for (const w of [asha, bala, chitra, dev]) await expect(w.page.getByTestId('call-tile')).toHaveCount(4);
    await frame(dev, 'dev-4way'); await frame(asha, 'asha-4way');

    // Chitra leaves — the other three stay connected to each other.
    await chitra.page.getByTestId('call-end').click();
    await expect(chitra.page.getByTestId('call-screen')).toHaveCount(0, { timeout: 10_000 });
    for (const w of [asha, bala, dev]) await expectConnectedPeers(w.page, 2);
    for (const w of [asha, bala, dev]) await expect(w.page.getByTestId('call-tile')).toHaveCount(3);
    await expectAudioFlowing(dev.page);
    await frame(asha, 'asha-after-chitra-left');

    for (const w of [asha, bala]) await w.page.getByTestId('call-end').click();
    await expect(dev.page.getByTestId('call-screen')).toHaveCount(0, { timeout: 10_000 });
  } finally { await closeAll(asha, bala, chitra, dev); }
});

test('group — one member declines: the caller stays on with whoever answered', async ({ browser }) => {
  const bala = await openAs(browser, BALA);
  const chitra = await openAs(browser, CHITRA);
  const asha = await openAs(browser, ASHA);
  try {
    await callFromThread(asha.page, 'Ward round');
    await expect(bala.page.getByTestId('call-incoming')).toBeVisible({ timeout: 10_000 });
    await bala.page.getByTestId('call-answer').click();
    await expectConnectedPeers(asha.page, 1);
    await chitra.page.getByTestId('call-decline').click();
    await asha.page.waitForTimeout(1500);
    await expect(asha.page.getByTestId('call-screen'), 'Chitra declining must not end Asha\'s call with Bala').toBeVisible();
    await expectConnectedPeers(asha.page, 1);
    await expectAudioFlowing(bala.page);
    await asha.page.getByTestId('call-end').click();
  } finally { await closeAll(asha, bala, chitra); }
});

test('group — the last person on the call leaves while others still ring: the ring stops', async ({ browser }) => {
  const bala = await openAs(browser, BALA);
  const chitra = await openAs(browser, CHITRA);
  const asha = await openAs(browser, ASHA);
  try {
    await callFromThread(asha.page, 'Ward round');
    await expect(chitra.page.getByTestId('call-incoming')).toBeVisible({ timeout: 10_000 });
    await bala.page.getByTestId('call-answer').click();
    await expectConnectedPeers(bala.page, 1);
    await bala.page.getByTestId('call-end').click();
    await expect(asha.page.getByTestId('call-screen')).toHaveCount(0, { timeout: 10_000 });
    await expect(chitra.page.getByTestId('call-incoming'), 'Chitra must stop ringing once nobody is left').toHaveCount(0, { timeout: 10_000 });
  } finally { await closeAll(asha, bala, chitra); }
});

test('network drop — the signaling socket dies for ~10s mid-call: it reconnects, the session rehydrates, media keeps flowing', async ({ browser }) => {
  const bala = await openAs(browser, BALA);
  const asha = await openAs(browser, ASHA);
  // Bala's signaling socket goes through a local pass-through we can cut.
  let cut = false;
  const sockets: Array<{ close: (o?: { code?: number; reason?: string }) => Promise<void> }> = [];
  let opened = 0;
  await bala.ctx.routeWebSocket(/\/hubs\/signaling/, ws => {
    opened++;
    if (cut) { void ws.close({ code: 4001, reason: 'network down' }); return; }
    ws.connectToServer();
    sockets.push(ws);
  });
  try {
    await gotoReady(bala.page, '/messages'); // re-open through the pass-through
    await callFromThread(asha.page, BALA.name);
    await bala.page.getByTestId('call-answer').click();
    await expectConnectedPeers(asha.page, 1);
    await expectConnectedPeers(bala.page, 1);
    const before = opened;

    cut = true;
    for (const ws of sockets.splice(0)) await ws.close({ code: 4001, reason: 'network down' });
    await bala.page.waitForTimeout(10_000);          // retries refused meanwhile
    cut = false;
    await expect.poll(() => opened, { timeout: 45_000, message: 'signaling reconnected' }).toBeGreaterThan(before + 1);
    await expect.poll(() => sockets.length, { timeout: 45_000 }).toBeGreaterThan(0);
    await bala.page.waitForTimeout(3000);

    for (const w of [asha, bala]) {
      await expect(w.page.getByTestId('call-screen')).toBeVisible();
      await expectConnectedPeers(w.page, 1);
      await expectAudioFlowing(w.page);
    }
    // Signaling works again after the drop: mute state still relays.
    await bala.page.getByTestId('call-mute').click();
    await expect(asha.page.getByTestId('call-muted-chip')).toBeVisible({ timeout: 10_000 });
    await asha.page.getByTestId('call-end').click();
    await expect(bala.page.getByTestId('call-screen')).toHaveCount(0, { timeout: 10_000 });
  } finally { await closeAll(asha, bala); }
});

test('tenant isolation — another tenant never sees our people to call', async ({ browser }) => {
  const xavier = await openAs(browser, XAVIER);
  try {
    const dir = await api<Array<{ id: string }>>(XAVIER, 'GET', '/api/directory/users');
    for (const p of [ASHA, BALA, CHITRA, DEV]) expect(dir.map(d => d.id)).not.toContain(p.authId);
    await expect(xavier.page.locator('.pf-mnd-row', { hasText: ASHA.name })).toHaveCount(0);
  } finally { await closeAll(xavier); }
});
