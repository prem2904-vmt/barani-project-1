import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, isDesktopApp, shotsDir, expectLayout, expectFitsWidth } from './support/form-factor';
import { go, installNegBackend, resetNeg } from './support/neg-backend';

/**
 * AUDIT TRAIL v2 (owner 2026-11-19) on every form factor, light + dark. API mocked, demo data only; the page is the
 * real app. The trail is a timeline of human sentences grouped by day: no raw record id is ever on screen (only the
 * "Technical details" a person asks for), the rows one save wrote are ONE event, expanding shows the changes in plain
 * words, and the timeline scrolls inside its card (the page never scrolls). Narrow screens: the filters are a sheet
 * opened from the filter icon in the search.
 * Screenshots: SHOTS_DIR/<form factor>/audit-*.png
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/audit-v2');
const out = () => shotsDir(OUT_BASE);
const vis = (page: Page, sel: string) => page.locator(sel).locator('visible=true').first();
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
  await page.waitForTimeout(450);
}
async function shot(page: Page, name: string) {
  for (const dark of [false, true]) { await theme(page, dark); await page.screenshot({ path: `${out()}/${name}--${dark ? 'dark' : 'light'}.png` }); }
  await theme(page, false);
}

// ── Demo data (ids are real-looking GUIDs so "no id on screen" means something) ──
const g = (n: number) => `${n.toString(16).padStart(8, '0')}-aaaa-4bbb-8ccc-${(n * 7919).toString(16).padStart(12, '0')}`;
const U_ADMIN = g(1), U_DOC = g(2), U_DESK = g(3);
const O1 = g(11), O2 = g(12), O3 = g(13);
const S1 = g(21), S2 = g(22), S3 = g(23);
const OT1 = g(31), PAY1 = g(41), T1 = g(51), T_GONE = g(52), UR1 = g(61), REP1 = g(71), W1 = g(81), BILL1 = g(91);

/** IST calendar day `daysAgo` days back, as yyyy-MM-dd. */
const istDay = (daysAgo: number) => new Date(Date.now() + 5.5 * 3600_000 - daysAgo * 86400_000).toISOString().slice(0, 10);
const at = (daysAgo: number, hhmm: string, sec = 0) => new Date(`${istDay(daysAgo)}T${hhmm}:${String(sec).padStart(2, '0')}+05:30`).toISOString();
const ch = (o: unknown) => JSON.stringify(o);

interface Row { id: string; entityType: string; entityId: string; action: string; userId?: string; userName?: string; at: string; changes: string | null }
let seq = 0;
const row = (entityType: string, entityId: string, action: string, userId: string, when: string, changes: unknown = null): Row =>
  ({ id: g(1000 + ++seq), entityType, entityId, action, userId, userName: userId, at: when, changes: changes === null ? null : ch(changes) });

const HAND: Row[] = [
  // One save: the order + its tube (two rows, ONE event).
  row('OrderEntity', O1, 'update', U_ADMIN, at(0, '09:42', 1), { status: { old: 'collected', new: 'billed' }, updatedAt: { old: at(0, '09:00'), new: at(0, '09:42') }, rowVersion: { old: 4, new: 5 } }),
  row('OrderSampleEntity', S1, 'update', U_ADMIN, at(0, '09:42', 1), { status: { old: 'collected', new: 'billed' }, updatedAt: { old: at(0, '09:00'), new: at(0, '09:42') } }),
  row('PaymentEntity', PAY1, 'create', U_DESK, at(0, '09:30'), { id: PAY1, billId: BILL1, amount: 400, mode: 'upi', paidAt: at(0, '09:30') }),
  row('OrderTestEntity', OT1, 'update', U_DOC, at(0, '09:10'), { status: { old: 'entered', new: 'validated' }, validatedBy: { old: null, new: U_DOC } }),
  // Two tubes collected together: one plural sentence.
  row('OrderSampleEntity', S2, 'update', U_DESK, at(0, '08:50', 2), { status: { old: 'pending', new: 'collected' }, collectedBy: { old: null, new: U_DESK } }),
  row('OrderSampleEntity', S3, 'update', U_DESK, at(0, '08:50', 2), { status: { old: 'pending', new: 'collected' }, collectedBy: { old: null, new: U_DESK } }),
  row('TestEntity', T1, 'update', U_ADMIN, at(0, '08:20'), { price: { old: 1100, new: 1200 }, updatedAt: { old: at(3, '10:00'), new: at(0, '08:20') } }),
  row('UserRoleEntity', UR1, 'create', U_ADMIN, at(0, '08:05'), { id: UR1, userId: g(4), roleId: g(5), branchId: g(6) }),
  row('Auth', U_DESK, 'login', U_DESK, at(0, '08:00')),
  row('TestEntity', T_GONE, 'delete', U_ADMIN, at(1, '17:15'), { id: T_GONE, name: 'Old Panel X', price: 900, testCode: 'OPX' }),
  row('OrderEntity', O3, 'update', U_DESK, at(1, '16:40'), { status: { old: 'billed', new: 'cancelled' }, priority: { old: 'stat', new: 'normal' } }),
  row('ReportEntity', REP1, 'update', U_DOC, at(1, '15:05'), { deliveredVia: { old: null, new: 'whatsapp' }, deliveryStatus: { old: 'pending', new: 'sent' } }),
  row('SettingsAccess', U_DESK, 'settings_access.changed', U_ADMIN, at(1, '12:00'), { test_master: { old: 'none', new: 'contributor' } }),
  // A type the mapping table has never heard of → the generic sentence.
  row('WidgetEntity', W1, 'update', U_ADMIN, at(1, '11:30'), { name: { old: 'Main', new: 'Main Road' }, ownerId: { old: g(7), new: g(8) } }),
];
/** Filler so the timeline is longer than its card and has a second page. */
const FILLER: Row[] = Array.from({ length: 66 }, (_, i) =>
  row('OrderTestResultEntity', g(200 + i), 'create', U_DOC, at(2, `${String(17 - Math.floor(i / 12)).padStart(2, '0')}:${String(58 - (i % 12) * 4).padStart(2, '0')}`),
    { id: g(200 + i), orderTestId: OT1, action: 'entered', version: 1 }));
const ROWS = [...HAND, ...FILLER];

const REFS: Record<string, unknown> = {
  [U_ADMIN]: { kind: 'user', label: 'Admin User' }, [U_DOC]: { kind: 'user', label: 'Dr. Meena Rao' }, [U_DESK]: { kind: 'user', label: 'Kavya Desk' },
  [O1]: { kind: 'order', label: 'LAB-2611-000016', orderId: O1, patient: 'Mr. Kumar Prem' },
  [O2]: { kind: 'order', label: 'LAB-2611-000015', orderId: O2, patient: 'Mrs. Anitha Raj' },
  [O3]: { kind: 'order', label: 'LAB-2611-000009', orderId: O3, patient: 'Ms. Noor Khan' },
  [S1]: { kind: 'sample', label: '2611-0042', orderId: O1 }, [S2]: { kind: 'sample', label: '2611-0040', orderId: O2 }, [S3]: { kind: 'sample', label: '2611-0041', orderId: O2 },
  [OT1]: { kind: 'orderTest', label: 'Complete Blood Count', orderId: O2, sampleId: S2 },
  [PAY1]: { kind: 'payment', orderId: O1, sub: 'upi' }, [BILL1]: { kind: 'bill', label: 'INV-001033', orderId: O1 },
  [T1]: { kind: 'test', label: 'Vitamin D (25-OH)', sub: 'VITD' },
  [UR1]: { kind: 'userRole', label: 'Ravi Kumar', sub: 'Phlebotomist at Chennai Main' },
  [REP1]: { kind: 'report', orderId: O2, sub: 'final' },
  ...Object.fromEntries(FILLER.map(r => [r.entityId, { kind: 'result', label: 'Haemoglobin', orderId: O2, sampleId: S2, sub: 'v1' }])),
};
const ME = {
  id: U_ADMIN, authId: 'sub-1', firstName: 'Admin', fathersName: 'User', displayName: 'Admin User', email: 'admin@demolab.example',
  tenantId: 't-demo', tenantName: 'Demo Lab', branchId: 'b1', branchName: 'Main', roles: ['Lab Admin'], permissions: ['*'],
  branches: [{ id: 'b1', name: 'Main' }], modules: ['lab'], hasPin: false,
};

/** Every /api/audit/logs query the page sent (the filter assertions read these). */
let logQueries: URLSearchParams[] = [];

function filtered(q: URLSearchParams): Row[] {
  const types = (q.get('entityTypes') ?? '').split(',').filter(Boolean);
  const text = (q.get('q') ?? '').toLowerCase();
  return ROWS.filter(r => (types.length === 0 || types.includes(r.entityType))
    && (!q.get('userId') || r.userId === q.get('userId'))
    && (!text || JSON.stringify([REFS[r.entityId], REFS[(REFS[r.entityId] as { orderId?: string } | undefined)?.orderId ?? ''], REFS[r.userId ?? '']]).toLowerCase().includes(text)));
}

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(150_000);
  resetNeg();
  logQueries = [];
  await installNegBackend(page, context);
  // Registered AFTER the shared backend so these answer first (Playwright matches the newest route first).
  await page.route(/\/api\/(audit\/|auth\/me)/, async (route, req) => {
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const u = new URL(req.url());
    const ok = (data: unknown) => route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ success: true, data }) });
    if (u.pathname === '/api/auth/me') return ok(ME);
    const rows = filtered(u.searchParams);
    if (u.pathname === '/api/audit/facets') {
      const by = (key: (r: Row) => string) => Object.entries(rows.reduce<Record<string, number>>((m, r) => { m[key(r)] = (m[key(r)] ?? 0) + 1; return m; }, {}));
      return ok({
        types: by(r => r.entityType).map(([entityType, count]) => ({ entityType, count })),
        users: by(r => r.userId ?? '').map(([userId, count]) => ({ userId, name: (REFS[userId] as { label: string }).label, count })),
        total: rows.length,
      });
    }
    logQueries.push(u.searchParams);
    const page_ = Number(u.searchParams.get('page') ?? 1), size = Number(u.searchParams.get('pageSize') ?? 50);
    return ok({ items: rows.slice((page_ - 1) * size, page_ * size), total: rows.length, page: page_, pageSize: size, refs: REFS });
  });
});

async function open(page: Page) {
  await go(page, '/admin/audit');
  await expect(vis(page, '[data-testid="audit-event"]')).toBeVisible({ timeout: 60_000 });
}
const sentence = (page: Page, i: number) =>
  page.locator('[data-testid="audit-event"] .pf-au__text').nth(i).evaluate(e => (e.textContent ?? '').replace(/\s+/g, ' ').trim());
/** The page itself never scrolls: only the timeline does, inside its card. */
async function expectNoPageScroll(page: Page) {
  const m = await page.evaluate(() => {
    const d = document.scrollingElement!;
    const s = document.querySelector<HTMLElement>('[data-testid="audit-scroll"]')!;
    return { page: d.scrollHeight - d.clientHeight, card: s.scrollHeight - s.clientHeight, bottom: s.getBoundingClientRect().bottom, vh: window.innerHeight };
  });
  expect(m.page, 'the page does not scroll').toBeLessThanOrEqual(1);
  expect(m.card, 'the timeline scrolls inside its card').toBeGreaterThan(50);
  expect(m.bottom, 'the card ends inside the screen').toBeLessThanOrEqual(m.vh + 1);
}
const narrow = (page: Page) => (page.viewportSize()!.width <= 900);

test.describe('audit trail v2', () => {
  test('a timeline of sentences grouped by day: no raw id, merged rows, no page scroll', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await open(page);

    // Grouped by day, newest first.
    const days = await page.locator('[data-testid="audit-day"]').allTextContents();
    expect(days[0].trim()).toBe('Today');
    expect(days[1]).toMatch(/^Yesterday · \d{1,2} [A-Z][a-z]{2}$/);
    expect(days.length).toBeGreaterThanOrEqual(3);

    // Sentences, never ids. The order + its tube are ONE event; two tubes read as one plural line.
    expect(await sentence(page, 0)).toBe('Admin User billed order LAB-2611-000016 for Mr. Kumar Prem');
    const all = await page.locator('[data-testid="audit-event"] .pf-au__text').evaluateAll(els => els.map(e => (e.textContent ?? '').replace(/\s+/g, ' ').trim()));
    expect(all).toContain('Kavya Desk took a payment for order LAB-2611-000016 ₹400 by UPI · for Mr. Kumar Prem');
    expect(all).toContain('Dr. Meena Rao validated Complete Blood Count for Mrs. Anitha Raj · LAB-2611-000015');
    expect(all).toContain('Kavya Desk collected 2 samples for Mrs. Anitha Raj · LAB-2611-000015');
    expect(all).toContain('Admin User changed the price of Vitamin D (25-OH) ₹1,100 → ₹1,200');
    expect(all).toContain('Admin User gave Ravi Kumar the Phlebotomist role at Chennai Main');
    expect(all).toContain('Kavya Desk signed in');
    expect(all).toContain('Admin User deleted the test Old Panel X from Test Master');
    expect(all, 'an unknown record type still reads as a sentence').toContain('Admin User changed a widget (Name: Main → Main Road)');
    expect(all.filter(s => s.includes('LAB-2611-000016') && s.includes('billed')).length, 'the order and its tube are one event').toBe(1);
    // A delete / cancel reads in rose.
    const danger = await page.locator('[data-testid="audit-event"] .pf-au__verb.is-danger').allTextContents();
    expect(danger.map(s => s.trim())).toEqual(expect.arrayContaining(['deleted the test', 'cancelled order']));
    // Every event carries a neutral area chip with a dot.
    await expect(page.locator('[data-testid="audit-event"]').first().locator('[data-testid="audit-area"]')).toHaveText('Orders & billing');

    expect(await page.evaluate(() => document.body.innerText), 'no raw id anywhere on the screen').not.toMatch(GUID);
    expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/updatedAt|rowVersion/);
    await expectLayout(page, 'audit');
    await expectNoPageScroll(page);
    await shot(page, 'audit-timeline');
    expect(errors, 'no uncaught errors').toEqual([]);
  });

  test('expanding an event shows the changes in plain words, the record link and Technical details on demand', async ({ page }) => {
    await open(page);
    const first = page.locator('[data-testid="audit-event"]').first();
    await first.locator('.pf-au__row').click();
    const detail = first.locator('[data-testid="audit-detail"]');
    await expect(detail).toBeVisible();
    // Status only: updatedAt / rowVersion are plumbing.
    await expect(detail.locator('[data-testid="audit-change"]')).toHaveCount(1);
    await expect(detail.locator('[data-testid="audit-change"] dt')).toHaveText('Status');
    await expect(detail.locator('.pf-au__from')).toHaveText('Sample collected');
    await expect(detail.locator('.pf-au__to')).toHaveText('Billed');
    await expect(detail.locator('[data-testid="audit-also"]')).toHaveText('Also updated: 1 sample (same moment)');
    const link = detail.locator('[data-testid="audit-open"]');
    await expect(link).toHaveText('Open order');
    expect(await link.getAttribute('href')).toContain(`/o/${O1}`);
    await expect(detail.locator('[data-testid="audit-raw"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.body.innerText), 'still no raw id').not.toMatch(GUID);
    await expectNoPageScroll(page);
    await expectLayout(page, 'audit-expanded');
    await shot(page, 'audit-expanded');

    // The raw diff is one tap away, for support.
    await detail.locator('[data-testid="audit-tech"]').click();
    await expect(detail.locator('[data-testid="audit-raw"]')).toContainText(O1);
    await expect(detail.locator('[data-testid="audit-raw"]')).toContainText('updatedAt');
    await expectNoPageScroll(page);
    await shot(page, 'audit-technical');
  });

  test('filters: the SHOW card on wide screens, a sheet from the filter icon on narrow ones', async ({ page }) => {
    await open(page);
    if (narrow(page)) {
      await expect(page.locator('[data-testid="audit-side"]')).toHaveCount(0);
      await vis(page, '[data-testid="audit-filters-btn"]').click();
      await expect(vis(page, '[data-testid="audit-sheet"]')).toBeVisible();
      await expectFitsWidth(page, '[data-testid="audit-sheet"]', 'audit sheet');
      await page.waitForTimeout(350);
      await shot(page, 'audit-filter-sheet');
    } else {
      await expect(vis(page, '[data-testid="audit-side"]')).toBeVisible();
      // Same height, side by side.
      const [a, b] = await Promise.all([vis(page, '[data-testid="audit-side"]').boundingBox(), vis(page, '[data-testid="audit-activity"]').boundingBox()]);
      expect(Math.abs(a!.height - b!.height), 'the two cards are the same height').toBeLessThanOrEqual(1);
      expect(a!.x + a!.width, 'SHOW is on the left').toBeLessThanOrEqual(b!.x);
    }
    const side = vis(page, narrow(page) ? '[data-testid="audit-sheet"]' : '[data-testid="audit-side"]');
    await expect(side.locator('[data-testid="audit-areas"] .pf-au__arealbl')).toHaveText(
      ['Everything', 'Orders & billing', 'Samples', 'Results & reports', 'Test Master', 'Settings', 'People & access']);
    await expect(side.locator('[data-area="all"] .pf-au__n')).toHaveText(String(ROWS.length));
    await expect(side.locator('[data-area="samples"] .pf-au__n')).toHaveText('3');
    await expect(side.locator('select, datalist')).toHaveCount(0);

    // What changed → Samples: the list narrows at once (a sheet closes itself).
    await side.locator('[data-area="samples"]').click();
    await expect.poll(() => logQueries.at(-1)?.get('entityTypes') ?? '').toContain('OrderSampleEntity');
    await expect(page.locator('[data-testid="audit-event"]')).toHaveCount(2);
    if (narrow(page)) await expect(page.locator('[data-testid="audit-sheet"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="audit-event"] [data-testid="audit-area"]').first()).toHaveText('Samples');
    await shot(page, 'audit-filter-samples');

    // When → Today.
    if (narrow(page)) await vis(page, '[data-testid="audit-filters-btn"]').click();
    const side2 = vis(page, narrow(page) ? '[data-testid="audit-sheet"]' : '[data-testid="audit-side"]');
    const before = logQueries.at(-1)!.get('from');
    await side2.locator('[data-testid="audit-when"] [role="radio"]').first().click();
    await expect.poll(() => logQueries.at(-1)?.get('from')).not.toBe(before);
    await expect(side2.locator('[data-testid="audit-when"] [role="radio"]').first()).toHaveAttribute('aria-checked', 'true');
  });

  test('search finds a person, patient, order number or test; an empty result says so', async ({ page }) => {
    await open(page);
    const input = vis(page, 'pf-hero-band .pf-hb__input');
    // the band shortens the placeholder on a narrow field (placeholder-fit, 2026-11-21); the full sentence stays in data-ph-full
    await expect(input).toHaveAttribute('data-ph-full', 'Search a person, patient, order number or test…');
    await input.fill('Kumar Prem');
    await expect.poll(() => logQueries.at(-1)?.get('q')).toBe('Kumar Prem');
    await expect(page.locator('[data-testid="audit-event"]')).toHaveCount(2);
    await input.fill('zzzz nothing');
    await expect(vis(page, '[data-testid="audit-empty"]')).toContainText('Nothing matches');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.waitForTimeout(500);
    await shot(page, 'audit-empty');
  });

  test('older changes load as the timeline nears its end (inside the card)', async ({ page }) => {
    await open(page);
    const count = () => page.locator('[data-testid="audit-event"]').count();
    const first = await count();
    await page.locator('[data-testid="audit-scroll"]').evaluate(e => { e.scrollTop = e.scrollHeight; });
    await expect.poll(() => logQueries.some(q => q.get('page') === '2')).toBe(true);
    await expect.poll(count).toBeGreaterThan(first);
    await page.locator('[data-testid="audit-scroll"]').evaluate(e => { e.scrollTop = e.scrollHeight; });
    await expect(vis(page, '[data-testid="audit-more"]')).toHaveText('That is everything in this window.');
    await expectNoPageScroll(page);
  });

  test('Export downloads the readable rows with the raw ids in extra columns', async ({ page }) => {
    test.skip(isDesktopApp(), 'the browser download path; the desktop app saves through its own bridge');
    await open(page);
    const [dl] = await Promise.all([page.waitForEvent('download'), vis(page, '[data-testid="audit-export"]').click()]);
    expect(dl.suggestedFilename()).toMatch(/^audit-trail-\d{4}-\d{2}-\d{2}\.csv$/);
    const fs = await import('node:fs');
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    const lines = csv.replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toBe('When (IST),Who,What happened,Area,Changes,Entity type,Entity id,Action,User id,Audit row id');
    expect(lines.length).toBe(ROWS.length + 1);
    expect(lines[1]).toContain('Admin User billed order LAB-2611-000016 for Mr. Kumar Prem');
    expect(lines[1]).toContain('Status: Sample collected → Billed');
    expect(lines[1]).toContain(`OrderEntity,${O1},update,${U_ADMIN}`);
  });
});
