import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';

/**
 * Notification bell — critical / urgent / routine rows (Work Register #6:
 * critical & urgent result alerts, backend catalog event
 * `urgent_report_ready`). FULLY OFFLINE (same pattern as
 * messages-realtime.smoke.spec.ts): no backend, no real tenant, nothing ever
 * leaves the browser — every API call to the (dev) API host and Supabase is
 * answered in the page from made-up fixtures, and both SignalR hubs are
 * local fakes (routeWebSocket).
 *
 * Proves, for a Lab Admin seeing three bell rows (critical_value, the new
 * urgent_report_ready, and a routine report_ready for contrast):
 *  - tone: rose / amber / emerald respectively — urgent_report_ready is
 *    visually distinct from the routine report_ready;
 *  - label: "urgent — ready to report" on the new row;
 *  - tapping the urgent_report_ready row navigates to /reports (NOT the
 *    generic /lab/collect Collect screen the shared `order` referenceType
 *    would otherwise resolve to).
 * Screenshots (light + dark) into $SHOTS_DIR.
 *
 * Run against a static build on a spare port (never 4200/4201 — those
 * belong to the nx dev server other e2e layers reuse):
 *   npx nx run lms:build:development
 *   node apps/lms-e2e/serve-spa.mjs dist/apps/lms/browser 4317 &
 *   BASE_URL=http://127.0.0.1:4317 SHOTS_DIR=/tmp/shots \
 *     ./node_modules/.bin/playwright test \
 *     --config=apps/lms-e2e/playwright.config.ts --project=smoke \
 *     notification-bell-alerts
 */

const SHOTS = process.env['SHOTS_DIR'] || '';

// ── Made-up fixtures (no real tenant) ───────────────────────────────────
const TENANT = { id: 't-demo', name: 'Demo Lab' };
const ME = { id: 'app-admin', authId: 'sub-admin', first: 'Admin', last: 'User' };

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub: string) =>
  `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 86_400 })}.sig`;
const subOf = (token: string | null): string | null => {
  try { return JSON.parse(Buffer.from(token!.split('.')[1], 'base64url').toString()).sub; } catch { return null; }
};

const NOW = Date.now();
const NOTIFICATIONS = [
  {
    id: 'n-critical-1', tenantId: TENANT.id, recipientId: ME.id, type: 'critical_value',
    title: 'Critical: Potassium 6.8 mmol/L — Ravi Kumar (2610-00012)',
    body: 'Immediate clinical attention required', referenceId: 'ot-1', referenceType: 'order_test',
    isRead: false, createdAt: new Date(NOW - 2 * 60_000).toISOString(),
  },
  {
    id: 'n-urgent-1', tenantId: TENANT.id, recipientId: ME.id, type: 'urgent_report_ready',
    title: 'Urgent order ready to report — Order #2610-00045',
    body: 'Validated result awaiting report generation', referenceId: 'ord-45', referenceType: 'order',
    isRead: false, createdAt: new Date(NOW - 6 * 60_000).toISOString(),
  },
  {
    id: 'n-routine-1', tenantId: TENANT.id, recipientId: ME.id, type: 'report_ready',
    title: 'Report ready — Order #2610-00032',
    body: 'Final report generated and ready to view', referenceId: 'rep-32', referenceType: 'report',
    isRead: true, createdAt: new Date(NOW - 3 * 3_600_000).toISOString(),
  },
];

interface Hub { ws: WebSocketRoute; closed: boolean }

/** Every API / Supabase call answered in the page; both SignalR hubs are
 *  local fakes — nothing ever reaches a real host. */
async function offlineBackend(page: Page) {
  const hubs: Hub[] = [];
  const cors = (origin: string) => ({
    'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
    'access-control-allow-headers': '*', 'access-control-allow-methods': '*',
  });
  const ok = (origin: string, data: unknown) => ({
    status: 200, headers: { ...cors(origin), 'content-type': 'application/json' },
    body: JSON.stringify({ success: true, data }),
  });

  await page.route(/prefrontal\.health\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    const p = new URL(req.url()).pathname;
    const sub = subOf((req.headers()['authorization'] ?? '').replace(/^Bearer\s+/i, ''));

    if (p === '/api/auth/me') {
      if (sub !== ME.authId) return route.fulfill({ status: 401, headers: cors(origin), body: '{}' });
      return route.fulfill(ok(origin, {
        id: ME.id, authId: ME.authId, firstName: ME.first, fathersName: ME.last,
        displayName: `${ME.first} ${ME.last}`, email: 'admin@demo.test',
        tenantId: TENANT.id, tenantName: TENANT.name, branchId: 'b1', branchName: 'Main',
        roles: ['Lab Admin'], permissions: ['*'], branches: [{ id: 'b1', name: 'Main' }],
        modules: ['lab'], hasPin: false,
      }));
    }
    if (p === '/api/notifications/' || p === '/api/notifications') {
      if (req.method() === 'GET') return route.fulfill(ok(origin, NOTIFICATIONS));
    }
    if (/^\/api\/notifications\/[^/]+\/read$/.test(p)) return route.fulfill(ok(origin, {}));
    if (p === '/api/tenants/modules') return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: false }) });
    if (p === '/api/tenants/current') return route.fulfill(ok(origin, { id: TENANT.id, name: TENANT.name }));
    if (p === '/api/process-workflows/active') return route.fulfill(ok(origin, null));
    if (p === '/api/chat/conversations') return route.fulfill(ok(origin, []));
    if (req.method() === 'GET') return route.fulfill(ok(origin, []));
    return route.fulfill(ok(origin, {}));
  });

  // Defensive — not expected to be hit (the seeded JWT is valid for 24h).
  await page.route(/supabase\.co\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    return route.fulfill({
      status: 200, headers: { ...cors(origin), 'content-type': 'application/json' },
      body: JSON.stringify({ access_token: jwt(ME.authId), refresh_token: `rt-${ME.authId}`, token_type: 'bearer', expires_in: 86_400 }),
    });
  });

  // Both hubs (/hubs/chat, /hubs/work, /hubs/signaling): acknowledge the
  // SignalR JSON-Hub-Protocol handshake and answer any invocation with null
  // so nothing ever blocks on a real socket.
  await page.routeWebSocket(/\/hubs\//, ws => {
    const hub: Hub = { ws, closed: false };
    hubs.push(hub);
    const RS = '\x1e';
    ws.onClose(() => { hub.closed = true; });
    ws.onMessage(raw => {
      for (const frame of String(raw).split(RS).filter(Boolean)) {
        const msg = JSON.parse(frame);
        if (msg.protocol) { ws.send('{}' + RS); continue; }
        if (msg.type === 7) { hub.closed = true; continue; }
        if (msg.type === 1 && msg.invocationId !== undefined) {
          ws.send(JSON.stringify({ type: 3, invocationId: msg.invocationId, result: null }) + RS);
        }
      }
    });
  });

  return { hubs };
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
    await page.screenshot({ path: `${SHOTS}/${name}-${theme}.png` });
  }
  await setTheme(page, 'light');
}

test.describe('Notification bell — critical / urgent / routine rows (offline)', () => {
  test('urgent_report_ready is amber, labelled, and routes to /reports (not Collect)', async ({ page }) => {
    test.setTimeout(120_000);
    await offlineBackend(page);
    await page.addInitScript(([session]) => {
      localStorage.clear();
      localStorage.setItem('pf.session', session);
      localStorage.setItem('pf-design', 'new');
    }, [JSON.stringify({ access_token: jwt(ME.authId), refresh_token: `rt-${ME.authId}` })]);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/frontdesk');
    await expect(page.locator('.pf-bell-btn')).toBeVisible({ timeout: 30_000 });

    // Unread badge reflects the two unread rows (critical + urgent).
    await expect(page.locator('.pf-bell-badge')).toHaveText('2');

    await page.locator('.pf-bell-btn').click();
    const panel = page.locator('.pf-bell-panel');
    await expect(panel).toBeVisible();
    const rows = panel.locator('.pf-bell-row');
    await expect(rows).toHaveCount(3);

    // Critical row — rose tone.
    const criticalRow = panel.locator('.pf-bell-row', { hasText: 'Potassium 6.8' });
    await expect(criticalRow.locator('.pf-type-icon')).toHaveAttribute('data-tone', 'rose');

    // New urgent_report_ready row — amber tone, distinct label, distinct
    // from the routine (emerald) report_ready row below it.
    const urgentRow = panel.locator('.pf-bell-row', { hasText: 'Urgent order ready to report' });
    await expect(urgentRow.locator('.pf-type-icon')).toHaveAttribute('data-tone', 'amber');
    await expect(urgentRow).toContainText('urgent — ready to report');

    const routineRow = panel.locator('.pf-bell-row', { hasText: 'Report ready — Order #2610-00032' });
    await expect(routineRow.locator('.pf-type-icon')).toHaveAttribute('data-tone', 'emerald');

    await page.waitForTimeout(300);
    await shoot(page, 'bell-open-1440');

    // Tap the urgent row → /reports, never the generic /lab/collect Collect
    // screen that referenceType 'order' alone would otherwise resolve to.
    await urgentRow.click();
    await page.waitForURL(/\/reports(\?|$)/, { timeout: 15_000 });
    expect(new URL(page.url()).pathname).toBe('/reports');
    expect(new URL(page.url()).pathname).not.toBe('/lab/collect');
    await page.waitForTimeout(400);
    await shoot(page, 'after-click-reports-1440');
  });
});
