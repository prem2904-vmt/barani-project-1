import type { Page, Route } from '@playwright/test';
import * as path from 'node:path';
import { test, expect, isTouch, isPhone, shotsDir } from './support/form-factor';
import { resetNeg, installNegBackend, go, neg } from './support/neg-backend';

/**
 * Notifications redesign (owner-approved 2026-11-19): the /notifications page and the bell popover.
 * API mocked with made-up data only. Asserts what the owner complained about — empty icon tiles, truncated titles,
 * duplicate alerts, no full list — plus: "See all" navigates, nothing scrolls but the list, one action per row,
 * Acknowledge on a merged row, touch targets >= 44px. Light and dark, every form factor
 * (run the desktop / tablet / phone projects). Screenshots: SHOTS_DIR/<project>/notifications-*.png.
 */
const SHOTS = process.env['SHOTS_DIR'] || '/tmp/notifications-v2-shots';

const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const LONG_TITLE = 'Critical result entered for a sample that is still waiting on a pathologist to look at it and release the report';
const LONG_BODY = 'Potassium 10.0 mmol/L for Mr. Kumar Prem is far above the critical bound of 6.5 and needs a phone call to the doctor before anything else is done at the bench';

type N = { id: string; tenantId: string; recipientId: string; type: string; title: string; body?: string; isRead: boolean; createdAt: string; referenceType?: string | null; referenceId?: string | null };
const mk = (id: string, type: string, title: string, body: string | undefined, minAgo: number, over: Partial<N> = {}): N => ({
  id, tenantId: 't-demo', recipientId: 'app-1', type, title, body, isRead: false, createdAt: ago(minAgo), referenceType: null, referenceId: null, ...over,
});

const HEAD: N[] = [
  mk('c1', 'critical_value', 'Critical result entered', 'Haemoglobin 6.1 g/dL for Ms. Sansa Stark (LAB-2611-000009)', 5, { referenceType: 'order_test', referenceId: 'ot-9' }),
  mk('c2', 'critical_value', 'Critical result entered', 'Haemoglobin 6.1 g/dL for Ms. Sansa Stark (LAB-2611-000009)', 22, { referenceType: 'order_test', referenceId: 'ot-9' }),
  mk('c3', 'lms.critical_value', LONG_TITLE, LONG_BODY, 33, { referenceType: 'order_test', referenceId: 'ot-77' }),
  mk('l1', 'tat_breach', 'Test past TAT', 'Complete Blood Count for Mr. Prem Kumar K is 21 h past due (Sample 26398)', 41, { referenceType: 'order_sample', referenceId: 's-398' }),
  mk('r1', 'report_blocked', 'Report generation blocked', 'The final report for Mrs. G Gowthami (LAB-2610-000025) could not be made: an unpaid balance is on the bill', 55, { referenceType: 'order', referenceId: 'o-25' }),
  mk('m1', 'result_comment_added', 'Dr. Rao replied', 'Please repeat the potassium, sample looked haemolysed (LAB-2611-000016)', 70, { referenceType: 'order_test', referenceId: 'ot-16', isRead: true }),
  mk('r2', 'report_ready', 'Report ready', 'LAB-2611-000012 · Chennai Main', 90, { referenceType: 'report', referenceId: 'rep-12' }),
  mk('s1', 'sample_rejection', 'Sample rejected', 'Haemolysed tube for Mr. Sathish Kumar, a new draw is needed (Sample 26401)', 26 * 60, { referenceType: 'order_sample', referenceId: 's-401', isRead: true }),
  mk('y1', 'critical_value', 'Critical result entered', 'Potassium 10 mmol/L for Mr. Kumar Prem (LAB-2611-000016)', 27 * 60, { referenceType: 'order_test', referenceId: 'ot-16', isRead: true }),
  mk('sys1', 'user_created', 'New staff account created', 'Ravi Kumar was added as a Lab Technician', 28 * 60),
  mk('sys2', 'whatsapp_credits_low', 'WhatsApp credits running low', 'Only 40 message credits are left on the shared number', 29 * 60, { referenceType: 'whatsapp_billing', referenceId: null }),
];
const KINDS = ['report_ready', 'tat_breach', 'sample_rejection', 'result_comment_added', 'inventory_low_stock', 'billed_not_collected', 'package_dispatched', 'bill_settled', 'office_mention', 'report_delivered'];
const FILLER: N[] = Array.from({ length: 150 }, (_, i) => {
  const type = KINDS[i % KINDS.length];
  const ref = type === 'report_ready' || type === 'report_delivered' ? 'report' : type === 'tat_breach' || type === 'sample_rejection' ? 'order_sample' : type === 'result_comment_added' ? 'order_test' : type === 'billed_not_collected' ? 'order' : null;
  return mk(`f${i}`, type, `Alert number ${i + 1}`, `Detail line for alert ${i + 1} (LAB-2611-${String(100 + i).padStart(6, '0')})`, 30 * 60 + i * 47, { referenceType: ref, referenceId: ref ? `ref-${i}` : null, isRead: i % 3 !== 0 });
});
const ALL: N[] = [...HEAD, ...FILLER];

const acks: string[] = [];
const patches: string[] = [];

async function installNotifications(page: Page) {
  const cors = (origin: string) => ({ 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
  const ok = (route: Route, data: unknown) => {
    const origin = route.request().headers()['origin'] ?? 'http://127.0.0.1';
    return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: true, data }) });
  };
  // Registered AFTER installNegBackend, so it answers first for these paths.
  await page.route(/prefrontal\.health\/api\/(notifications|critical-results)/, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    const u = new URL(req.url());
    if (req.method() === 'GET' && u.pathname.startsWith('/api/notifications')) {
      const limit = Number(u.searchParams.get('limit') || 50);
      return ok(route, ALL.slice(0, limit));
    }
    if (req.method() === 'PATCH' && /\/api\/notifications\/[^/]+\/read$/.test(u.pathname)) { patches.push(u.pathname); return ok(route, {}); }
    const a = /\/api\/critical-results\/order-test\/([^/]+)\/acknowledge$/.exec(u.pathname);
    if (a) { acks.push(a[1]); return ok(route, [{ id: 'e-' + a[1], status: 'acknowledged' }]); }
    return route.fulfill({ status: 404, headers: cors(origin), body: '{}' });
  });
}

async function theme(page: Page, mode: 'light' | 'dark') {
  await page.addInitScript((m) => { try { localStorage.setItem('pf-theme', m); } catch { /* blocked */ } }, mode);
}

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(240_000);
  resetNeg(); acks.length = 0; patches.length = 0;
  neg.hook = null;
  await installNegBackend(page, context);
  await installNotifications(page);
});

const shot = (page: Page, name: string) => page.screenshot({ path: path.join(shotsDir(SHOTS), `notifications-${name}.png`) });
const vis = (page: Page, sel: string) => page.locator(sel).locator('visible=true');

/** Every icon tile in `root` carries a drawn icon: real <path>s with data, and a box you can see. */
async function expectNoEmptyTiles(page: Page, root: string, min = 1) {
  const r = await page.evaluate((sel) => {
    const tiles = [...document.querySelectorAll(`${sel} .pf-type-icon`)] as HTMLElement[];
    return tiles.map(t => {
      const paths = [...t.querySelectorAll('svg path')];
      const box = t.querySelector('svg')?.getBoundingClientRect();
      return { paths: paths.length, withData: paths.filter(p => (p.getAttribute('d') || '').length > 3).length, w: Math.round(box?.width ?? 0), h: Math.round(box?.height ?? 0), tw: Math.round(t.getBoundingClientRect().width) };
    });
  }, root);
  expect(r.length, 'icon tiles present').toBeGreaterThanOrEqual(min);
  for (const t of r) { expect(t.paths).toBeGreaterThan(0); expect(t.withData).toBe(t.paths); expect(t.w).toBeGreaterThan(8); expect(t.h).toBeGreaterThan(8); expect(t.tw).toBeGreaterThan(24); }
}

/** No title / body is cut off: nothing ellipsised, nothing clipped, every text node fully inside its row. */
async function expectNoTruncation(page: Page, rootSel: string, textSel: string) {
  const bad = await page.evaluate(([root, sel]) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(`${root} ${sel}`)) {
      const cs = getComputedStyle(el);
      if (cs.textOverflow === 'ellipsis') out.push('ellipsis: ' + el.textContent);
      if (el.scrollWidth > el.clientWidth + 1 && cs.display !== 'inline') out.push('clipped x: ' + el.textContent);
      let p: HTMLElement | null = el;
      while (p && !p.matches(root)) {
        const pcs = getComputedStyle(p);
        if ((pcs.overflowX === 'hidden' || pcs.overflowX === 'clip') && el.getBoundingClientRect().right > p.getBoundingClientRect().right + 1) out.push('outside ' + p.className + ': ' + el.textContent);
        if (pcs.webkitLineClamp && pcs.webkitLineClamp !== 'none') out.push('line-clamp: ' + el.textContent);
        p = p.parentElement;
      }
    }
    return out;
  }, [rootSel, textSel] as const);
  expect(bad).toEqual([]);
}

async function noPageScroll(page: Page) {
  const r = await page.evaluate(() => {
    const d = document.scrollingElement!;
    return { sh: d.scrollHeight, ch: d.clientHeight, bsh: document.body.scrollHeight, sw: d.scrollWidth, cw: d.clientWidth };
  });
  expect(r.sh, 'document does not scroll vertically').toBeLessThanOrEqual(r.ch + 1);
  expect(r.sw, 'document does not scroll sideways').toBeLessThanOrEqual(r.cw + 1);
}

for (const mode of ['light', 'dark'] as const) {
  test.describe(`${mode}`, () => {
    test.beforeEach(async ({ page }) => { await theme(page, mode); });

    test(`page: tiles drawn, titles whole, duplicates merged, one action, no page scroll (${mode})`, async ({ page }) => {
      await go(page, '/notifications');
      await expect(vis(page, '[data-testid="nt-page"]').first()).toBeVisible({ timeout: 60_000 });
      await expect(vis(page, '[data-testid="nt-row"]').first()).toBeVisible({ timeout: 30_000 });

      // Unread view first (the default): the head counts unread.
      const unreadHead = (await vis(page, '[data-testid="nt-count"]').first().innerText()).replace(/\s+/g, ' ');
      expect(unreadHead).toMatch(/^\d+ unread$/);

      await expectNoEmptyTiles(page, '[data-testid="nt-main"]', 5);
      await expectNoTruncation(page, '[data-testid="nt-main"]', '.nt-sentence, .nt-title, .nt-text, .nt-meta');

      // The long title is whole, on screen, wrapping (taller than one line).
      const long = vis(page, `[data-testid="nt-title"]:has-text("${LONG_TITLE.slice(0, 30)}")`).first();
      await expect(long).toBeVisible();
      expect((await long.innerText()).trim()).toBe(LONG_TITLE);
      const lh = await long.evaluate(e => parseFloat(getComputedStyle(e).lineHeight) || 18);
      expect((await long.boundingBox())!.height, 'a long title wraps instead of being cut').toBeGreaterThan(lh * 1.5);
      await expect(vis(page, '.nt-text').filter({ hasText: LONG_BODY.slice(0, 40) }).first()).toBeVisible();

      // Duplicates: the c1/c2 pair is ONE row saying "alerted 2 times"; no two rows are the same kind + same result.
      const merged = vis(page, '[data-testid="nt-row"][data-count="2"]');
      await expect(merged).toHaveCount(1);
      await expect(merged.first()).toContainText('alerted 2 times');
      await expect(merged.first()).toContainText('Haemoglobin 6.1 g/dL');
      const sig = await page.evaluate(() => [...document.querySelectorAll('[data-testid="nt-row"]')].map(r => (r.querySelector('.nt-title')?.textContent ?? '') + '|' + (r.querySelector('.nt-text')?.textContent ?? '')));
      expect(new Set(sig).size, 'no duplicate rows').toBe(sig.length);

      // Meta line is the normal font, never monospace.
      const fam = await vis(page, '.nt-meta').first().evaluate(e => getComputedStyle(e).fontFamily.toLowerCase());
      expect(fam).not.toMatch(/mono|courier|consolas/);

      // One action button per row at most; critical = Acknowledge.
      const counts = await page.evaluate(() => [...document.querySelectorAll('[data-testid="nt-row"]')].map(r => r.querySelectorAll('.nt-act button').length));
      expect(Math.max(...counts)).toBeLessThanOrEqual(1);
      await expect(merged.first().locator('[data-testid="nt-ack"]')).toBeVisible();

      await noPageScroll(page);
      // Two panels from 1024px up; below that (phone, iPad portrait) one card and the kinds in the filter sheet.
      if (page.viewportSize()!.width >= 1024) await expect(vis(page, '[data-testid="nt-side"]').first()).toBeVisible();
      else await expect(vis(page, '[data-testid="nt-filter"]').first()).toBeVisible();
      await shot(page, `page-${mode}`);
    });

    test(`page: inbox groups filter the list; Unread | All; search (${mode})`, async ({ page }) => {
      await go(page, '/notifications');
      await expect(vis(page, '[data-testid="nt-row"]').first()).toBeVisible({ timeout: 60_000 });
      const wide = !isPhone() && !(await vis(page, '[data-testid="nt-side"]').count() === 0);
      if (wide) {
        // Side card: All first, then the six groups, each with a dot and a badge.
        const names = await vis(page, '[data-testid="nt-side"] .nt__kname').allInnerTexts();
        expect(names.map(s => s.trim())).toEqual(['All', 'Critical results', 'Running late', 'Reports & sharing', 'Samples', 'Messages', 'System']);
        await vis(page, '[data-testid="nt-kind-critical"]').first().click();
        await expect(vis(page, '[data-testid="nt-group"]').first()).toHaveText(/CRITICAL RESULTS/);
        const kinds = await page.evaluate(() => [...document.querySelectorAll('[data-testid="nt-row"]')].map(r => r.getAttribute('data-kind')));
        expect(kinds.length).toBeGreaterThan(0);
        expect(new Set(kinds)).toEqual(new Set(['critical_value']));
        await expect(page).toHaveURL(/kind=critical/);
        await vis(page, '[data-testid="nt-kind-all"]').first().click();
        await expect(vis(page, '[data-testid="nt-group"]').first()).toHaveText(/^ALL$/);
      } else {
        // Phone / iPad portrait: one card, the kinds in a filter sheet opened from its head.
        await expect(vis(page, '[data-testid="nt-side"]')).toHaveCount(0);
        const pick = vis(page, '[data-testid="nt-filter"]').first();
        await expect(pick).toBeVisible();
        await pick.click();
        const sheet = page.locator('[data-testid="nt-sheet"]');
        await expect(sheet).toBeVisible();
        const names = await sheet.locator('.nt__kname').allInnerTexts();
        expect(names.map(s => s.trim())).toEqual(['All', 'Critical results', 'Running late', 'Reports & sharing', 'Samples', 'Messages', 'System']);
        const sb = (await sheet.boundingBox())!;
        const vp = page.viewportSize()!;
        expect(sb.y).toBeGreaterThanOrEqual(0); expect(sb.y + sb.height).toBeLessThanOrEqual(vp.height + 1);
        await page.waitForTimeout(450);   // the sheet's rise has finished
        await shot(page, `sheet-${mode}`);
        // Esc closes it and the focus goes back to the filter button.
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);
        await expect(pick).toBeFocused();
        await pick.click();
        await sheet.locator('[data-testid="nt-sheet-kind-critical"]').click();
        await expect(sheet).toHaveCount(0);
        await expect(pick).toContainText('Critical results');
        const kinds = await page.evaluate(() => [...document.querySelectorAll('[data-testid="nt-row"]')].map(r => r.getAttribute('data-kind')));
        expect(kinds.length).toBeGreaterThan(0);
        expect(new Set(kinds)).toEqual(new Set(['critical_value']));
        await expect(page).toHaveURL(/kind=critical/);
        await pick.click();
        await sheet.locator('[data-testid="nt-sheet-kind-all"]').click();
      }
      // Unread | All
      const seg = vis(page, '.nt__head pf-segmented button');
      await expect(seg.first()).toBeVisible();
      const before = await vis(page, '[data-testid="nt-row"]').count();
      await vis(page, '.nt__head pf-segmented button[data-value="all"]').first().click();
      await expect.poll(async () => vis(page, '[data-testid="nt-row"]').count()).toBeGreaterThanOrEqual(before);
      // Search (the band pill)
      const input = page.locator('.pf-hb__input').locator('visible=true').first();
      // the band shortens the placeholder on a narrow field (placeholder-fit, 2026-11-21); the full sentence stays in data-ph-full
      await expect(input).toHaveAttribute('data-ph-full', 'Search notifications by patient, order or test…');
      await input.fill('Gowthami');
      await expect(vis(page, '[data-testid="nt-row"]')).toHaveCount(1);
      await input.fill('zzzz-nothing');
      await expect(vis(page, '[data-testid="nt-empty"]').first()).toBeVisible();
      await noPageScroll(page);
    });

    test(`page: infinite scroll draws and loads more inside the card; the page never scrolls (${mode})`, async ({ page }) => {
      await go(page, '/notifications');
      await expect(vis(page, '[data-testid="nt-row"]').first()).toBeVisible({ timeout: 60_000 });
      await vis(page, '.nt__head pf-segmented button[data-value="all"]').first().click();
      const scroller = vis(page, '[data-testid="nt-scroll"]').first();
      const first = await vis(page, '[data-testid="nt-row"]').count();
      expect(first).toBeLessThan(ALL.length);
      let last = first;
      for (let i = 0; i < 12; i++) {
        await scroller.evaluate(e => { e.scrollTop = e.scrollHeight; });
        await page.waitForTimeout(350);
        const c = await vis(page, '[data-testid="nt-row"]').count();
        if (c > last) last = c;
      }
      expect(last, 'more rows drawn by scrolling').toBeGreaterThan(first);
      expect(last).toBeGreaterThan(100);
      await noPageScroll(page);
      const sc = await scroller.evaluate(e => ({ oy: getComputedStyle(e).overflowY, sh: e.scrollHeight, ch: e.clientHeight }));
      expect(sc.oy).toBe('auto');
      expect(sc.sh).toBeGreaterThan(sc.ch);
      // Day headings.
      const days = await vis(page, '.nt-day').allInnerTexts();
      expect(days[0]).toBe('TODAY');
      expect(days.some(d => d.startsWith('YESTERDAY'))).toBe(true);
    });

    test(`page: Acknowledge on the merged critical row acknowledges the result once and reads both alerts (${mode})`, async ({ page }) => {
      await go(page, '/notifications');
      const row = vis(page, '[data-testid="nt-row"][data-count="2"]').first();
      await expect(row).toBeVisible({ timeout: 60_000 });
      await row.locator('[data-testid="nt-ack"]').click();
      await expect.poll(() => acks.length).toBe(1);
      expect(acks).toEqual(['ot-9']);
      // Both alerts are read — two PATCHes that land in either order (Edge under load: c2 a moment after c1).
      await expect.poll(() => patches.sort().join(',')).toContain('/api/notifications/c1/read');
      await expect.poll(() => patches.sort().join(',')).toContain('/api/notifications/c2/read');
      // The button is gone and the row reads as read.
      await expect(row.locator('[data-testid="nt-ack"]')).toHaveCount(0);
    });

    test(`touch: actions, kinds and controls are at least 44px (${mode})`, async ({ page }) => {
      test.skip(!isTouch(), 'touch only');
      await go(page, '/notifications');
      await expect(vis(page, '[data-testid="nt-row"]').first()).toBeVisible({ timeout: 60_000 });
      const small = await page.evaluate(() => {
        const out: string[] = [];
        for (const b of document.querySelectorAll<HTMLElement>('[data-testid="nt-main"] .nt-act button, [data-testid="nt-main"] .nt-open, [data-testid="nt-side"] .pf-side-item, [data-testid="nt-mark-all"]')) {
          const r = b.getBoundingClientRect();
          if (r.width > 0 && r.height < 43.5) out.push(`${b.className.split(' ')[0]} ${Math.round(r.height)}px "${(b.textContent || '').trim().slice(0, 24)}"`);
        }
        return out;
      });
      expect(small).toEqual([]);
    });

    test(`bell: popover is tidy, "See all notifications" opens the page (${mode})`, async ({ page }) => {
      await go(page, '/frontdesk');
      const bell = page.locator('.pf-bell-btn').locator('visible=true').first();
      await expect(bell).toBeVisible({ timeout: 60_000 });
      await expect(bell.locator('.pf-bell-badge')).toBeVisible({ timeout: 30_000 });
      await bell.click();
      const pop = page.locator('[data-testid="bell-popover"]');
      await expect(pop).toBeVisible();
      await expect(pop.locator('.pf-bell-row').first()).toBeVisible({ timeout: 30_000 });
      const head = (await pop.locator('.pf-bell-header').innerText()).replace(/\s+/g, ' ');
      expect(head).toMatch(/Notifications · \d+ unread/);
      await expect(pop.getByText('Mark all read')).toBeVisible();

      const rows = await pop.locator('.pf-bell-row').count();
      expect(rows).toBeLessThanOrEqual(6);
      await expectNoEmptyTiles(page, '[data-testid="bell-popover"]', 3);
      await expectNoTruncation(page, '[data-testid="bell-popover"]', '.pf-bell-rtitle, .pf-bell-body-text');
      await expect(pop.locator('.pf-bell-row[data-x], .pf-bell-row').filter({ hasText: 'Alerted 2 times' })).toHaveCount(1);
      // Fits the viewport.
      const box = (await pop.boundingBox())!;
      const vp = page.viewportSize()!;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
      expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1);
      await shot(page, `bell-${mode}`);

      // Esc closes and the focus is back on the bell.
      await page.keyboard.press('Escape');
      await expect(pop).toHaveCount(0);
      await expect(bell).toBeFocused();
      await bell.click();
      await expect(pop).toBeVisible();

      await pop.locator('[data-testid="bell-see-all"]').click();
      await expect(page).toHaveURL(/\/notifications(\?|$)/);
      await expect(vis(page, '[data-testid="nt-page"]').first()).toBeVisible({ timeout: 30_000 });
      await expect(pop).toHaveCount(0);
      await noPageScroll(page);
    });
  });
}
