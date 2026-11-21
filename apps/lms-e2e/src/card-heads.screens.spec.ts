import type { Page } from '@playwright/test';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect, shotsDir, isPhone, projectName } from './support/form-factor';
import { resetNeg, installNegBackend, go, neg } from './support/neg-backend';

/**
 * Owner screenshot review 2026-11-21 (polish-1121) — API mocked, fake data only:
 *  1. Card heads are ONE row at every size: title (+count) left, pills (collapsing to the selected-pill menu) and
 *     actions (44px icons when narrow) right; nothing clipped; the Branches row action stays in full view on phone.
 *  2. No extra toolbar row under a head: a group shown alone hands its tools (Hospitals | Doctors, Add, Paste, Reset)
 *     to the main card's head.
 *  3. Auto-assign: a multi-select holds its chips (max 2 + "+N") and never overlaps the next row.
 *  5. Frontdesk › Outsourced on a phone: one primary + ⋯, so the patient name keeps at least half the row.
 * Screenshots: SHOTS_DIR/<project>/ch-*.png (light + dark).
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/polish-1121');

const FIXED = new Date('2026-11-21T05:00:00Z');
const ago = (m: number) => new Date(FIXED.getTime() - m * 60000).toISOString();
const today = ago(0).slice(0, 10);
const BRANCHES = [
  { id: 'b1', name: 'Main', code: 'MAIN', city: 'Chennai', state: 'Tamil Nadu', isActive: true },
  { id: 'b2', name: 'Anna Nagar Collection Centre', code: 'ANN', city: 'Chennai', state: 'Tamil Nadu', isActive: true },
  { id: 'b3', name: 'Velachery', code: 'VEL', city: 'Chennai', state: 'Tamil Nadu', isActive: true },
  { id: 'b4', name: 'Tambaram', code: 'TAM', city: 'Chennai', state: 'Tamil Nadu', isActive: false },
];
const DEPTS = [
  { id: 'd1', name: 'Clinical Pathology', code: 'CP', isActive: true },
  { id: 'd2', name: 'Haematology', code: 'HAE', isActive: true },
  { id: 'd3', name: 'Biochemistry', code: 'BIO', isActive: true },
];
const USERS = ['Admin User', 'Anand Krishnan', 'Front Desk', 'Kavya Desk', 'Meena Lakshmi', 'Ravi Shankar'].map((n, i) => ({
  id: `u${i + 1}`, displayName: n, firstName: n.split(' ')[0], email: `u${i + 1}@demolab.example`, isActive: true,
}));
const ROLES = [{ id: 'r1', name: 'Technician' }, { id: 'r2', name: 'Pathologist' }, { id: 'r3', name: 'Lab Admin' }];
const CONFIGS = [
  { departmentId: 'd1', assigneeUserIdsJson: JSON.stringify(USERS.slice(0, 5).map(u => u.id)), autoAssignRoleIdsJson: JSON.stringify(['r1', 'r2', 'r3']),
    validatorUserIdsJson: JSON.stringify(['u1', 'u2', 'u4']), validatorRoleIdsJson: null },
  { departmentId: 'd2', assigneeUserIdsJson: JSON.stringify(['u2']), autoAssignRoleIdsJson: null, validatorUserIdsJson: null, validatorRoleIdsJson: null },
];
const DOCTORS = Array.from({ length: 11 }, (_, i) => ({ id: `doc${i}`, name: `Dr. Referrer ${i + 1}`, phone: '+919845012345', isActive: true, hospitalIds: [] }));
const HOSPITALS = Array.from({ length: 3 }, (_, i) => ({ id: `h${i}`, name: `City Hospital ${i + 1}`, isActive: true }));
const LONG = 'Suganthan Arulvelan Ramaswamy';
const report = { url: 'https://spaces.example/partner.pdf', name: 'partner.pdf', type: 'application/pdf', attachToReport: true, inReport: true };
const OUTSOURCED = [
  { sampleId: 'os1', barcode: 'BIO26004', sampleStatus: 'outsourced', orderId: 'o4', orderNumber: 'LAB-2611-000157', patientId: 'p4', patientName: LONG, dailyNo: 4, dailyNoDay: today,
    partnerLabId: 'pl1', partnerLabName: 'ABC Lab', createdAt: ago(300), collectedAt: ago(280), dispatchedAt: ago(240), status: 'completed', hasReport: true,
    tests: [{ orderTestId: 'ot1', testId: 't1', testName: 'Vitamin D (25-OH)', status: 'completed', completed: true, report }] },
  { sampleId: 'os2', barcode: 'BIO26005', sampleStatus: 'outsourced', orderId: 'o6', orderNumber: 'LAB-2611-000158', patientId: 'p6', patientName: 'Ms. Kavya Nair', dailyNo: 6, dailyNoDay: today,
    partnerLabId: 'pl1', partnerLabName: 'ABC Lab', createdAt: ago(200), collectedAt: ago(190), dispatchedAt: ago(150), status: 'outsourced', hasReport: true,
    tests: [{ orderTestId: 'ot2', testId: 't2', testName: 'Anti-TPO', status: 'outsourced', completed: false, report: { ...report, attachToReport: false } }] },
];

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(240_000);
  resetNeg();
  neg.hook = r => {
    if (r.method !== 'GET') return undefined;
    const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
    switch (r.path) {
      case '/api/tenants/branches': return ok(BRANCHES);
      case '/api/tenants/departments': return ok(DEPTS);
      case '/api/users/picker': return ok(USERS);
      case '/api/roles/picker': return ok(ROLES);
      case '/api/tenants/auto-assign-configs': return ok(CONFIGS);
      case '/api/tenants/branch-lab-config': return ok({ autoAssignEnabled: true, autoAssignValidatorsEnabled: true, effectiveQueueFocus: 'patient', queueFocus: 'patient' });
      case '/api/referring-network/doctors': return ok(DOCTORS);
      case '/api/referring-network/hospitals': return ok(HOSPITALS);
      case '/api/samples/outsourced': case '/api/samples/outsourced-legacy':
        return ok({ items: OUTSOURCED, total: OUTSOURCED.length, page: 1, pageSize: 50, counts: { outsourced: 1, completed: 1 } });
      default: return undefined;
    }
  };
  await page.clock.setFixedTime(FIXED);
  await installNegBackend(page, context);
});

async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
}
async function shots(page: Page, name: string) {
  const out = shotsDir(OUT_BASE);
  for (const dark of [false, true]) {
    await theme(page, dark);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/ch-${name}--${dark ? 'dark' : 'light'}.png` });
  }
  await theme(page, false);
}

/** The main card head of the Settings frame, on screen (phones open the detail from the side list first). */
const HEAD = '.pf-tp__head, .pf-sg-main__head';
async function settingsHead(page: Page, tab?: string) {
  const head = page.locator(HEAD).locator('visible=true').first();
  if (!(await head.count()) && tab) {
    const item = page.locator(`[data-testid="tp-item-${tab}"]`).locator('visible=true').first();
    if (await item.count()) await item.click();
  }
  await expect(page.locator(HEAD).locator('visible=true').first()).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(900);
  return page.locator(HEAD).locator('visible=true').first();
}

/** ONE row: every visible item of every visible card head crosses the head's middle line and sits inside it. */
async function expectHeadsOneRow(page: Page, tag: string) {
  const r = await page.evaluate(() => {
    const shown = (e: Element) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
    const heads = Array.from(document.querySelectorAll<HTMLElement>('.pf-tp__head, .pf-sg-main__head, .pf-sgroup__head, .pf-card__head')).filter(shown)
      .filter(h => !h.closest('[role="dialog"], .pf-sheet, .pf-ss__main :is(.pf-wac, .pf-wab, .pf-ls__card, .pf-cm__card)'));
    const WRAP = '.pf-tp__tools, .pf-ss__acts, .pf-ov__acts, .pf-sgroup__tools, .pf-card__spacer';
    return heads.map(h => {
      const hb = h.getBoundingClientRect();
      const mid = hb.top + hb.height / 2;
      // + a collapsed pill's visible menu button (it may be wider than its shrunk host).
      const items = Array.from(h.querySelectorAll<HTMLElement>(':scope > *, :scope :is(.pf-tp__tools, .pf-ss__acts, .pf-ov__acts, .pf-sgroup__tools) > *, :scope pf-segmented [data-seg-compact]'))
        .filter(e => !e.matches(WRAP) && shown(e));
      // Items never sit on top of each other (a tools strip overflowing over the title).
      const overlaps = items.flatMap((a, i) => items.slice(i + 1).filter(b => {
        if (a.contains(b) || b.contains(a)) return false;
        const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
        return Math.min(x.right, y.right) - Math.max(x.left, y.left) > 2 && Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 2;
      }).map(b => `${a.tagName.toLowerCase()}.${String(a.className).split(' ')[0]} overlaps ${b.tagName.toLowerCase()}.${String(b.className).split(' ')[0]}`));
      const bad = overlaps.concat(items.filter(e => { const b = e.getBoundingClientRect(); return b.top > mid + 1 || b.bottom < mid - 1 || b.right > hb.right + 1 || b.left < hb.left - 1; })
        .map(e => `${e.tagName.toLowerCase()}.${String(e.className).split(' ').slice(0, 2).join('.')} [${Math.round(e.getBoundingClientRect().top - hb.top)}..${Math.round(e.getBoundingClientRect().bottom - hb.top)} of ${Math.round(hb.height)}, right ${Math.round(e.getBoundingClientRect().right - hb.right)}]`));
      return { head: String(h.className).split(' ').slice(0, 3).join('.'), height: Math.round(hb.height), bad };
    });
  });
  expect(r.length, `${tag}: a card head on screen`).toBeGreaterThan(0);
  for (const h of r) {
    expect(h.bad, `${tag}: ${h.head} is ONE row (h ${h.height})`).toEqual([]);
    // One row: 44px touch controls + at most a two-line title (whole words).
    expect(h.height, `${tag}: ${h.head} is one row tall`).toBeLessThanOrEqual(84);
  }
}

/** No tools row under the head: a visible group-tools strip whose group title is hidden (the frame shows the group alone). */
async function expectNoToolsRow(page: Page, tag: string) {
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="settings-main"] .pf-sgroup__tools, .pf-ov__inline .pf-sgroup__tools'))
    .filter(t => t.getBoundingClientRect().height > 0 && t.children.length > 0)
    .filter(t => { const l = t.closest('.pf-sgroup__head')?.querySelector('.pf-sgroup__label'); return !l || getComputedStyle(l).display === 'none'; })
    .map(t => (t.textContent ?? '').trim().slice(0, 60)));
  expect(rows, `${tag}: no toolbar row under the card head`).toEqual([]);
}

const PAGES: [string, string, string?][] = [
  ['branches', '/admin/branches'],
  ['channels', '/admin/org/channels?tab=whatsapp', 'whatsapp'],
  ['referring', '/admin/lab/front-desk?tab=referring', 'referring'],
  ['columns', '/admin/lab/front-desk?tab=columns', 'columns'],
  ['auto-assign', '/admin/lab/collection?tab=assign', 'assign'],
  ['departments', '/admin/lab/departments?tab=departments', 'departments'],
  ['agents', '/admin/lab/home-collection?tab=agents', 'agents'],
  ['users', '/admin/users'],
  ['referral-labs', '/admin/referral-labs'],
  ['email', '/admin/org/channels?tab=email', 'email'],
  ['validation', '/admin/lab/results?tab=validation', 'validation'],
  ['sample-format', '/admin/lab/sample-numbers?tab=format', 'format'],
  ['gst', '/admin/billing?tab=gst', 'gst'],
];

test.describe('card heads: one row at every size, no toolbar row under them', () => {
  for (const [name, route, tab] of PAGES) {
    test(`Settings › ${name}`, async ({ page }) => {
      await go(page, route);
      await settingsHead(page, tab);
      await expectHeadsOneRow(page, name);
      await expectNoToolsRow(page, name);
      if (['branches', 'channels', 'referring', 'columns', 'auto-assign'].includes(name)) await shots(page, name);
    });
  }

  test('Branches: the row action is fully on screen; the pills collapse on a phone', async ({ page }) => {
    await go(page, '/admin/branches');
    const head = await settingsHead(page);
    await expect(page.locator('.ag-row').locator('visible=true').first()).toBeVisible({ timeout: 30_000 });
    const r = await page.evaluate(() => {
      const grid = Array.from(document.querySelectorAll<HTMLElement>('.ag-root-wrapper')).find(e => e.getBoundingClientRect().width > 0)!;
      const g = grid.getBoundingClientRect();
      const acts = Array.from(grid.querySelectorAll<HTMLElement>('.pf-sg-acts-cell button')).filter(e => e.getBoundingClientRect().width > 0);
      return { n: acts.length, out: acts.filter(a => { const b = a.getBoundingClientRect(); return b.right > g.right + 1 || b.left < g.left - 1 || b.right > window.innerWidth; }).length };
    });
    expect(r.n, 'row actions on screen').toBeGreaterThan(0);
    expect(r.out, 'no row action cut off at the edge').toBe(0);
    if (isPhone()) await expect(head.locator('pf-segmented [data-seg-compact]').first()).toBeVisible();
    // Narrow head: "Add branch" is a 44px icon with its words as name + tooltip.
    const add = head.getByRole('button', { name: /Add branch/ });
    await expect(add).toBeVisible();
    if (isPhone()) {
      const b = (await add.boundingBox())!;
      expect(b.width, 'icon action ≥ 44px').toBeGreaterThanOrEqual(44);
      expect(await add.getAttribute('title')).toMatch(/Add branch/);
    }
  });

  test('Front desk › Referring doctors: Hospitals | Doctors, Add and Paste sit IN the card head', async ({ page }) => {
    await go(page, '/admin/lab/front-desk?tab=referring');
    const head = await settingsHead(page, 'referring');
    await expect(head.locator('[data-testid="rn-add"]')).toBeVisible();
    await expect(head.locator('[data-testid="rn-paste-open"]')).toBeVisible();
    await expect(head.locator('pf-segmented').first()).toBeVisible();
    await go(page, '/admin/lab/front-desk?tab=columns');
    const head2 = await settingsHead(page, 'columns');
    await expect(head2.locator('[data-testid="fdgc-reset"]')).toBeVisible();
  });

  test('Auto-assign: the multi-selects hold their chips (2 + "+N") and never overlap the next row', async ({ page }) => {
    await go(page, '/admin/lab/collection?tab=assign');
    await settingsHead(page, 'assign');
    await expect(page.locator('.pf-ls__dept').first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll<HTMLElement>('.pf-ls__dept')).filter(e => e.getBoundingClientRect().height > 0);
      const bad: string[] = []; let more = 0; let maxChips = 0;
      rows.forEach((row, i) => {
        const rb = row.getBoundingClientRect();
        row.querySelectorAll<HTMLElement>('pf-select').forEach(sel => {
          const sb = sel.getBoundingClientRect();
          if (sb.bottom > rb.bottom + 0.5) bad.push(`row ${i}: select bottom ${Math.round(sb.bottom - rb.bottom)}px below its row`);
          sel.querySelectorAll<HTMLElement>('.pf-dd__chip').forEach(c => { const cb = c.getBoundingClientRect(); if (cb.bottom > sb.bottom + 0.5 || cb.right > sb.right + 0.5) bad.push(`row ${i}: a chip spills out of its select`); });
          maxChips = Math.max(maxChips, sel.querySelectorAll('.pf-dd__chip:not(.pf-dd__chip--more)').length);
          more += sel.querySelectorAll('.pf-dd__chip--more').length;
        });
        const next = rows[i + 1]?.getBoundingClientRect();
        if (next && next.top < rb.bottom - 1.5) bad.push(`row ${i} overlaps row ${i + 1}`);
      });
      return { bad, more, maxChips };
    });
    expect(r.bad).toEqual([]);
    expect(r.maxChips, 'at most 2 chips in a field').toBeLessThanOrEqual(2);
    expect(r.more, 'the rest is a "+N" count').toBeGreaterThan(0);
  });
});

test.describe('Frontdesk › Outsourced on a phone', () => {
  test('a row with several actions keeps the name at least half the row (one primary + ⋯)', async ({ page }) => {
    test.skip(!isPhone(), 'the phone list (390px)');
    await go(page, '/frontdesk');
    const tab = page.locator('[role="tab"][aria-label="Outsourced"], [role="tab"]:has-text("Outsourced"), [role="radio"]:has-text("Outsourced")').locator('visible=true').first();
    await expect(tab).toBeVisible({ timeout: 60_000 });
    await tab.click();
    const list = page.locator('[data-testid="out-list"]').locator('visible=true').first();
    await expect(list.locator('.pf-wl__row').first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
    const rows = await list.evaluate(l => Array.from(l.querySelectorAll<HTMLElement>('.pf-wl__row')).map(row => {
      const rb = row.getBoundingClientRect(); const nb = row.querySelector<HTMLElement>('.pf-wl__main')!.getBoundingClientRect();
      return { name: row.querySelector('.pf-wl__name')?.textContent?.trim() ?? '', share: nb.width / rb.width, buttons: row.querySelectorAll('.pf-wl__act button').length };
    }));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.share, `${r.name}: the name box is >= 50% of the row`).toBeGreaterThanOrEqual(0.5);
      expect(r.buttons, `${r.name}: one primary + ⋯`).toBeLessThanOrEqual(2);
    }
    await shots(page, `outsourced-${projectName()}`);
  });
});


/** Coordinator 2026-11-21: band search placeholders fit their field at 390px ("Search pa…" was clipped). */
test.describe('band search placeholders fit', () => {
  for (const [name, route] of [['frontdesk', '/frontdesk'], ['channels', '/admin/org/channels?tab=whatsapp'], ['referring', '/admin/lab/front-desk?tab=referring'],
    ['collection', '/admin/lab/collection?tab=assign'], ['my-work', '/lab/my-work'], ['results', '/reports'], ['test-master', '/admin/tests']] as const) {
    test(`${name}: the placeholder is never cut`, async ({ page }) => {
      await go(page, route);
      const input = page.locator(':is(pf-hero-band, .pf-hb) input[placeholder]').locator('visible=true').first();
      await expect(input).toBeVisible({ timeout: 45_000 });
      await page.waitForTimeout(900);
      const r = await input.evaluate((el: HTMLInputElement) => {
        const cs = getComputedStyle(el);
        const ctx = document.createElement('canvas').getContext('2d')!;
        ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        return { ph: el.placeholder, full: el.dataset['phFull'] ?? '', text: ctx.measureText(el.placeholder).width, room };
      });
      expect(r.text, `${name}: "${r.ph}" fits its field (${Math.round(r.text)} <= ${Math.round(r.room)}; full: "${r.full}")`).toBeLessThanOrEqual(r.room + 1);
      // A placeholder shows whenever one word fits (an empty one only when the field is squeezed below "Search").
      if (r.room >= 60) expect(r.ph.length, `${name}: a placeholder is shown`).toBeGreaterThan(0);
      if (isPhone() && name === 'frontdesk') await shots(page, 'band-search-frontdesk');
    });
  }
});
