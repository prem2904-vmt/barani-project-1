import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * MESSAGES — new design, REAL layout (ND-PATTERN §17; jsdom can't lay out).
 * Seeded Micro World Lab Admin. READ-ONLY:
 *  - the chat REST calls are answered in the browser from made-up fixtures
 *    (no real conversation is read or written);
 *  - both SignalR hubs are a local fake WebSocket (routeWebSocket) that
 *    answers the handshake + every invocation locally — SendMessage,
 *    MarkConversationRead, SetTyping never reach the server — and pushes
 *    one MessageReceived to prove the realtime path + the fade-in.
 * 1440: CONVERSATIONS card LEFT (~360px), thread card right, one primary
 * (Send), mic inside the field, no page scroll, navbar visible, Noto (no
 * monospace). 375: the list is the screen, a tap pushes the thread, the
 * composer sits above the navbar, 16px inputs, back pops the thread.
 * Screenshots (light + dark) into $SHOTS_DIR. CORS_RELAY=1 relays backend
 * calls so it can run against a static build on a spare port.
 */

const SHOTS = process.env['SHOTS_DIR'] || '';

async function relayCors(page: Page) {
  if (!process.env['CORS_RELAY']) return;
  await page.route(/prefrontal\.health\/api\//, async route => {
    const origin = new URL(page.url() || 'http://localhost').origin;
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const res = await route.fetch();
    await route.fulfill({ response: res, headers: { ...res.headers(), ...cors } });
  });
}

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((t) => {
    const r = document.documentElement;
    r.classList.toggle('dark', t === 'dark');
    r.classList.toggle('light', t === 'light');
    r.setAttribute('data-theme', t);
  }, theme);
}

async function shoot(page: Page, name: string) {
  if (!SHOTS) return;
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${SHOTS}/${name}-${theme}.png`, fullPage: false });
  }
  await setTheme(page, 'light');
}

async function noPageScroll(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector('.shell-main') as HTMLElement | null;
    const se = document.scrollingElement!;
    return { doc: se.scrollHeight - se.clientHeight, main: main ? main.scrollHeight - main.clientHeight : 0 };
  });
}

// ── Fixtures (made up; no real people or patients) ─────────────────────
const mins = (m: number, days = 0) => {
  const d = new Date(); d.setDate(d.getDate() - days); d.setMinutes(d.getMinutes() - m); return d.toISOString();
};
function fixtures(me: string) {
  const self = { userId: me, displayName: 'You', email: 'you@lab.test' };
  const convs = [
    { id: 'fx-c1', isGroup: false, name: null, createdById: me, lastMessageAt: mins(4), unreadCount: 2,
      participants: [self, { userId: 'fx-u2', displayName: 'Dr. Meenakshi Sundaravadivelu', email: 'meenakshi@lab.test' }],
      lastMessage: { id: 'fx-m4', fromUserId: 'fx-u2', body: 'Can you re-run the potassium on 26117? It looks haemolysed.', sentAt: mins(4) } },
    { id: 'fx-c2', isGroup: true, name: 'Haematology bench', createdById: me, lastMessageAt: mins(40), unreadCount: 0,
      participants: [self, { userId: 'fx-u3', displayName: 'Karthik Iyer', email: 'karthik@lab.test' },
        { userId: 'fx-u4', displayName: 'Priya Das', email: 'priya@lab.test' }],
      lastMessage: { id: 'fx-g1', fromUserId: me, body: 'CBC reruns are on the rack', sentAt: mins(40) } },
    { id: 'fx-c3', isGroup: false, name: null, createdById: me, lastMessageAt: mins(90, 1), unreadCount: 0,
      participants: [self, { userId: 'fx-u5', displayName: 'Rahul Menon', email: 'rahul@lab.test' }],
      lastMessage: { id: 'fx-r1', fromUserId: 'fx-u5', body: '', sentAt: mins(90, 1) } },
    { id: 'fx-c4', isGroup: false, name: null, createdById: me, lastMessageAt: mins(200, 3), unreadCount: 5,
      participants: [self, { userId: 'fx-u6', displayName: 'Front desk — Anna Nagar branch', email: 'fd@lab.test' }],
      lastMessage: { id: 'fx-f1', fromUserId: 'fx-u6', body: 'Patient is asking for the report ETA', sentAt: mins(200, 3) } },
  ];
  const msgs = [
    { id: 'fx-m1', conversationId: 'fx-c1', fromUserId: 'fx-u2', body: 'Morning! Is sample 26117 validated yet?', sentAt: mins(70, 1), kind: 'user' },
    { id: 'fx-m2', conversationId: 'fx-c1', fromUserId: me, body: 'Not yet, the analyser flagged it. Checking now.', sentAt: mins(62, 1), kind: 'user' },
    { id: 'fx-m3', conversationId: 'fx-c1', fromUserId: me, body: '', sentAt: mins(12), kind: 'user',
      attachmentUrl: '/uploads/fx-voice.webm', attachmentName: 'voice-9s.webm', attachmentMime: 'audio/webm', attachmentSize: 18432 },
    { id: 'fx-m5', conversationId: 'fx-c1', fromUserId: me, body: '', sentAt: mins(11), kind: 'user',
      attachmentUrl: '/uploads/fx-qc.pdf', attachmentName: 'QC-chart-Sep.pdf', attachmentMime: 'application/pdf', attachmentSize: 248000 },
    { id: 'fx-m4', conversationId: 'fx-c1', fromUserId: 'fx-u2', body: 'Can you re-run the potassium on 26117? It looks haemolysed.', sentAt: mins(4), kind: 'user' },
  ];
  const calls = [
    { id: 'fx-k1', roomId: 'r1', status: 'missed', callType: 'audio', source: null, direction: 'incoming',
      startedAt: mins(30), endedAt: null, durationSeconds: null, peer: { userId: 'fx-u2', displayName: 'Dr. Meenakshi Sundaravadivelu' } },
    { id: 'fx-k2', roomId: 'r2', status: 'ended', callType: 'audio', source: null, direction: 'outgoing',
      startedAt: mins(300, 1), endedAt: mins(296, 1), durationSeconds: 242, peer: { userId: 'fx-u5', displayName: 'Rahul Menon' } },
  ];
  const people = [
    { id: 'fx-u7', displayName: 'Meera Nair', email: 'meera@lab.test', isActive: true },
    { id: 'fx-u2', displayName: 'Dr. Meenakshi Sundaravadivelu', email: 'meenakshi@lab.test', isActive: true },
  ];
  return { convs, msgs, calls, people };
}

/** Everything chat-shaped is answered in the browser. Returns the log of
 *  write attempts (all answered locally) and hub invocations. */
async function answerChatLocally(page: Page) {
  const state = { me: '', writes: [] as string[], invocations: [] as string[], hubs: [] as WebSocketRoute[] };
  const origin = () => new URL(page.url() || 'http://localhost').origin;
  const cors = () => ({ 'access-control-allow-origin': origin(), 'access-control-allow-credentials': 'true',
    'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
  // The API envelope ApiService unwraps: { success, data }.
  const json = (data: unknown) => ({ status: 200, headers: { ...cors(), 'content-type': 'application/json' },
    body: JSON.stringify({ success: true, data }) });

  // Who am I (the fixtures' "mine" side) — read from the real /auth/me.
  await page.route(/\/api\/auth\/me(\?|$)/, async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors() });
    const res = await route.fetch();
    try { const d = await res.json(); state.me = d?.authId ?? d?.data?.authId ?? state.me; } catch { /* keep */ }
    await route.fulfill({ response: res, headers: { ...res.headers(), ...cors() } });
  });
  await page.route(/\/api\/(chat|calls|directory|uploads)\//, async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors() });
    const fx = fixtures(state.me || 'fx-me');
    const url = new URL(req.url());
    if (req.method() !== 'GET') { state.writes.push(`${req.method()} ${url.pathname}`); return route.fulfill(json({})); }
    const p = url.pathname;
    if (/\/api\/chat\/conversations$/.test(p)) return route.fulfill(json(fx.convs));
    const mm = /\/api\/chat\/conversations\/([^/]+)\/messages$/.exec(p);
    if (mm) return route.fulfill(json(fx.msgs.filter(m => m.conversationId === mm[1])));
    if (/\/pinned$/.test(p)) return route.fulfill(json([]));
    if (/\/api\/calls\/recent$/.test(p)) return route.fulfill(json(fx.calls));
    if (/\/api\/directory\/users$/.test(p)) return route.fulfill(json(fx.people));
    return route.fulfill(json([]));
  });
  // Both SignalR hubs: a local fake (JSON protocol). Nothing is forwarded.
  await page.routeWebSocket(/\/hubs\//, ws => {
    state.hubs.push(ws);
    const RS = '\x1e';
    const ping = setInterval(() => { try { ws.send(JSON.stringify({ type: 6 }) + RS); } catch { clearInterval(ping); } }, 5000);
    ws.onClose(() => clearInterval(ping));
    ws.onMessage(raw => {
      for (const frame of String(raw).split(RS).filter(Boolean)) {
        const msg = JSON.parse(frame);
        if (msg.protocol) { ws.send('{}' + RS); continue; }
        if (msg.type === 1 && msg.target) {
          state.invocations.push(msg.target);
          if (msg.invocationId !== undefined) {
            const result = /^Get/.test(msg.target) ? [] : null;
            ws.send(JSON.stringify({ type: 3, invocationId: msg.invocationId, result }) + RS);
          }
        }
      }
    });
  });
  return state;
}

/** Push one realtime message down every fake hub (the chat hub handles it). */
function pushIncoming(state: { hubs: WebSocketRoute[] }, body: string) {
  const m = { id: 'fx-live-' + Date.now(), conversationId: 'fx-c1', fromUserId: 'fx-u2', body, sentAt: new Date().toISOString(), kind: 'user' };
  for (const ws of state.hubs) {
    try { ws.send(JSON.stringify({ type: 1, target: 'MessageReceived', arguments: [m] }) + '\x1e'); } catch { /* closed */ }
  }
}

test.describe('Messages — new design, real layout', () => {
  test('1440 two cards + 375 push navigation (light + dark)', async ({ page }) => {
    test.setTimeout(180_000);
    await relayCors(page);
    const state = await answerChatLocally(page);
    await loginAs(page, 'admin');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/messages');

    const side = page.locator('.pf-mnd-panels > aside.nd-card.pf-mnd-side');
    const thread = page.locator('.pf-mnd-panels > section.nd-card.pf-mnd-thread');
    // A remembered collapse from an earlier run: open it first.
    await expect(page.locator('.pf-mnd-panels')).toBeVisible({ timeout: 30_000 });
    if (await page.locator('.pf-mnd-strip').isVisible().catch(() => false)) {
      await page.locator('.pf-mnd-strip button').click();
    }
    await expect(side).toBeVisible();
    await expect(side.locator('.pf-mnd-rows .pf-mnd-row')).toHaveCount(4, { timeout: 30_000 });
    await expect(side.locator('.nd-card__head .nd-card__label')).toHaveText(/conversations/i);
    await expect(thread.locator('.pf-mnd-placeholder')).toBeVisible();
    await page.waitForTimeout(500);
    await shoot(page, '1440-list');

    // Conversations LEFT (~360px), thread fills the rest on the right.
    const sb = (await side.boundingBox())!;
    const tb = (await thread.boundingBox())!;
    expect(sb.x + sb.width).toBeLessThanOrEqual(tb.x + 1);
    expect(sb.width).toBeGreaterThan(340);
    expect(sb.width).toBeLessThan(380);
    expect(tb.width).toBeGreaterThan(700);
    // Names are never cut; the unread count is a neutral chip + violet dot.
    await expect(side.locator('.pf-mnd-rows .pf-mnd-row__name').first()).toHaveText('Dr. Meenakshi Sundaravadivelu');
    const unread = side.locator('.pf-mnd-unread').first();
    await expect(unread).toHaveText('2');
    const unreadBg = await unread.evaluate(e => getComputedStyle(e).backgroundImage);
    expect(unreadBg).toBe('none');

    // Open the thread.
    await side.locator('.pf-mnd-row', { hasText: 'Meenakshi' }).click();
    await expect(thread.locator('.pf-mnd-thread__name')).toHaveText('Dr. Meenakshi Sundaravadivelu');
    await expect(thread.locator('.pf-mnd-bubble')).toHaveCount(5);
    await expect(thread.locator('.pf-mnd-day')).toHaveCount(2);
    await expect(thread.locator('.pf-mnd-voice')).toBeVisible();
    await expect(thread.locator('.pf-mnd-file')).toBeVisible();
    // Composer: mic INSIDE the field, one primary (Send), quiet attach.
    const field = thread.locator('.pf-mnd-composer .pf-mnd-field');
    await expect(field.locator('button[aria-label="Record a voice message"]')).toBeVisible();
    const fb = (await field.boundingBox())!;
    const mb = (await field.locator('button[aria-label="Record a voice message"]').boundingBox())!;
    expect(mb.x).toBeGreaterThan(fb.x); expect(mb.x + mb.width).toBeLessThanOrEqual(fb.x + fb.width + 0.5);
    expect(await page.locator('.nd-btn--primary:visible, .pf-hb-btn--primary:visible').count()).toBe(1);
    await expect(thread.locator('button.nd-btn--primary[aria-label="Send"]')).toBeVisible();
    // Composer sits at the thread card's floor; the page never scrolls.
    const cb = (await thread.locator('.pf-mnd-composer').boundingBox())!;
    const tb2 = (await thread.boundingBox())!;
    expect(Math.abs((cb.y + cb.height) - (tb2.y + tb2.height))).toBeLessThanOrEqual(2);
    const ps = await noPageScroll(page);
    expect(ps.doc).toBeLessThanOrEqual(1);
    expect(ps.main).toBeLessThanOrEqual(1);
    // Navbar never hidden; Noto everywhere (no monospace).
    expect(await page.evaluate(() => document.documentElement.classList.contains('pf-chat-immersive'))).toBe(false);
    const fonts = await page.evaluate(() => Array.from(document.querySelectorAll('.pf-mnd *'))
      .map(e => getComputedStyle(e).fontFamily).filter(f => /mono|courier/i.test(f)));
    expect(fonts).toEqual([]);

    // Realtime: a pushed message lands and fades in.
    pushIncoming(state, 'Rerun done — K+ 4.1, looks fine now.');
    const fresh = thread.locator('.pf-mnd-msg--fresh');
    await expect(fresh).toHaveCount(1, { timeout: 10_000 });
    await expect(fresh).toContainText('K+ 4.1');

    // Send (answered locally by the fake hub): Enter sends.
    const ta = field.locator('textarea');
    await ta.fill('Thanks, validating it now.');
    await ta.press('Enter');
    await expect(thread.locator('.pf-mnd-bubble--mine', { hasText: 'validating it now' })).toBeVisible();
    expect(state.invocations).toContain('SendMessage');
    await page.mouse.move(720, 150);
    await page.waitForTimeout(400);
    await shoot(page, '1440-thread');

    // Collapse → strip on the LEFT edge; the thread takes the room.
    await side.locator('button[aria-label="Hide conversations"]').click();
    const strip = page.locator('.pf-mnd-strip');
    await expect(strip).toBeVisible();
    await page.waitForTimeout(500);
    const stb = (await strip.boundingBox())!;
    expect(stb.width).toBeLessThan(64);
    expect((await thread.boundingBox())!.width).toBeGreaterThan(tb.width + 250);
    await shoot(page, '1440-collapsed');
    await strip.locator('button').click();
    await expect(side).toBeVisible();

    // ── Phone ───────────────────────────────────────────────────────────
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(600);
    // The open thread stays open across the resize; go back to the list.
    if (await thread.isVisible()) {
      await page.locator('pf-hero-band button[aria-label="Go back"]').click();
    }
    await expect(side).toBeVisible();
    await expect(thread).toHaveCount(0);
    const sw = (await side.boundingBox())!.width;
    expect(sw).toBeGreaterThan(330);
    const pill = page.locator('pf-hero-band [band-search] input');
    expect(await pill.evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
    const psp = await noPageScroll(page);
    expect(psp.doc).toBeLessThanOrEqual(1);
    expect(psp.main).toBeLessThanOrEqual(1);
    await shoot(page, '375-list');

    await side.locator('.pf-mnd-row', { hasText: 'Meenakshi' }).click();
    await expect(thread).toBeVisible();
    await expect(side).toHaveCount(0);
    await expect(thread).toHaveClass(/pf-mnd-push--forward/);
    await expect(page.locator('pf-hero-band button[aria-label="Go back"]')).toBeVisible();
    await page.waitForTimeout(500);
    // The docked navbar is visible (never hidden) and the composer sits
    // ABOVE it; the field is ≥16px text.
    const navTop = await page.evaluate(() => {
      let el = document.elementFromPoint(40, window.innerHeight - 8) as HTMLElement | null;
      if (!el || el.closest('.pf-band-page')) return null;
      while (el && getComputedStyle(el).position !== 'fixed') el = el.parentElement;
      return el ? el.getBoundingClientRect().top : null;
    });
    expect(navTop).not.toBeNull();
    expect(navTop!).toBeLessThan(812 - 40);
    const comp = (await thread.locator('.pf-mnd-composer').boundingBox())!;
    expect(comp.y + comp.height).toBeLessThanOrEqual(navTop! + 1);
    expect(await thread.locator('.pf-mnd-field textarea').evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
    const psp2 = await noPageScroll(page);
    expect(psp2.doc).toBeLessThanOrEqual(1);
    await page.mouse.move(187, 40);
    await page.locator('.pf-mnd-field textarea').blur();
    await page.waitForTimeout(300);
    await shoot(page, '375-thread');

    // Back chevron pops the thread → the list slides back.
    await page.locator('pf-hero-band button[aria-label="Go back"]').click();
    await expect(side).toBeVisible();
    await expect(side).toHaveClass(/pf-mnd-push--back/);

    // Every chat write + hub invocation was answered locally (read-only).
    expect(state.hubs.length).toBeGreaterThan(0);
  });
});
