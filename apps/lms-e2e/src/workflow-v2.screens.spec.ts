import * as os from 'node:os';
import * as path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect, isPhone, isTouch, isDesktop, shotsDir, expectNoHorizontalScroll, orientation, engine } from './support/form-factor';
import { resetNeg, installNegBackend, go, neg } from './support/neg-backend';

/**
 * Work steps — the owner-approved workflow redesign (2026-11-19, layout A in Test Master's frame): work areas LEFT
 * (the navigation, in order), the selected area RIGHT (who works here, actions with full names, lock pill, Move to,
 * on/off). Hover peek (long-press sheet on touch) with drag out; See it as a role; Warnings; branch differences;
 * search that jumps; History with Restore; ONE band Save + unsaved prompt. Light + dark, every form factor.
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/workflow-v2');
const out = () => shotsDir(OUT_BASE);
const vis = (page: Page, sel: string) => page.locator(sel).locator('visible=true').first();
async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
  await page.waitForTimeout(350);
}
async function shot(page: Page, name: string) {
  for (const dark of [false, true]) { await theme(page, dark); await page.screenshot({ path: `${out()}/${name}--${dark ? 'dark' : 'light'}.png` }); }
  await theme(page, false);
}

// ── Fake data (the shipped Standard flow + a branch copy) ──
const cat = (id: string, name: string, icon: string, order: number, roles: string[]) => ({ id, name, icon, color: '#7c3aed', order, roles });
const act = (id: string, type: string, categoryId: string, enabled = true, order = 0) => ({ id, type, categoryId, enabled, order });
const STANDARD = () => ({
  categories: [
    cat('frontdesk', 'Frontdesk', 'reception', 0, ['Receptionist', 'Branch Manager', 'Lab Admin']),
    cat('homecoll', 'Home Visits', 'home', 1, ['Home Collection Agent', 'Sample Collector', 'Receptionist']),
    cat('lab', 'Lab', 'flask', 2, ['Lab Technician', 'Lab Admin']),
    cat('validate', 'Validate', 'check', 3, ['Pathologist', 'Lab Admin']),
    cat('results', 'Results', 'report', 4, ['Receptionist', 'Branch Manager', 'Lab Admin']),
    cat('messages', 'Messages', 'chat', 5, []),
  ],
  actions: [
    act('a1', 'appointment', 'frontdesk', true, 0), act('a2', 'patient_registration', 'frontdesk', true, 1),
    act('a3', 'walk_in_order', 'frontdesk', true, 2), act('a4', 'billing', 'frontdesk', true, 3),
    act('a5', 'sample_collection', 'frontdesk', true, 4), act('a6', 'queue', 'frontdesk', true, 5),
    act('a7', 'dispatch', 'frontdesk', true, 6), act('a8', 'home_visits', 'homecoll'),
    act('a9', 'lab_intake', 'lab', true, 0), act('a10', 'result_entry', 'lab', true, 1),
    act('a11', 'validate', 'validate'), act('a12', 'results', 'results'), act('a13', 'messages', 'messages'),
  ],
});
const ROLES = ['Receptionist', 'Branch Manager', 'Lab Admin', 'Home Collection Agent', 'Sample Collector', 'Lab Technician', 'Pathologist'];
const BRANCHES = [{ id: 'b1', name: 'Main' }, { id: 'b2', name: 'Chennai Main' }];

interface Wf { id: string; name: string; isActive: boolean; branchId: string | null; configJson: string; version: number; updatedAt: string; isSystemDefault?: boolean }
let wfs: Wf[] = [];
let puts: { path: string; body: any }[] = [];
function seed() {
  const branch = STANDARD();
  branch.actions = branch.actions.filter(a => a.type !== 'queue');           // Chennai Main has no Queue
  wfs = [
    { id: 'w1', name: 'Standard flow', isActive: true, branchId: null, configJson: JSON.stringify(STANDARD()), version: 3, updatedAt: '2026-11-18T10:00:00Z' },
    { id: 'w2', name: 'Evening flow', isActive: false, branchId: null, configJson: JSON.stringify(STANDARD()), version: 1, updatedAt: '2026-11-10T10:00:00Z' },
    { id: 'w3', name: 'Chennai flow', isActive: true, branchId: 'b2', configJson: JSON.stringify(branch), version: 2, updatedAt: '2026-11-15T10:00:00Z' },
  ];
  puts = [];
}
const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(180_000);
  resetNeg();
  seed();
  neg.hook = r => {
    if (r.method === 'GET' && r.path === '/api/process-workflows') return ok(wfs);
    if (r.method === 'GET' && r.path === '/api/process-workflows/active') return ok(wfs[0]);
    if (r.method === 'GET' && /^\/api\/process-workflows\/[^/]+\/history$/.test(r.path)) {
      const old = STANDARD(); old.categories[0].name = 'Front office';
      return ok([
        { id: 'h3', version: 3, name: 'Standard flow', at: '2026-11-18T10:00:00Z', by: 'Kavya Desk', kind: 'save', configJson: JSON.stringify(STANDARD()) },
        { id: 'h2', version: 2, name: 'Standard flow', at: '2026-11-12T08:30:00Z', by: 'Ravi Kumar', kind: 'save', configJson: JSON.stringify(old) },
        { id: 'h1', version: 1, name: 'Standard flow', at: '2026-11-01T08:30:00Z', by: null, kind: 'baseline', configJson: JSON.stringify(old) },
      ]);
    }
    if (r.method === 'PUT' && r.path.startsWith('/api/process-workflows/')) {
      puts.push({ path: r.path, body: r.body });
      const id = r.path.split('/').pop()!;
      const w = wfs.find(x => x.id === id)!;
      w.configJson = r.body.configJson; w.name = r.body.name; w.version++;
      return ok(w);
    }
    if (r.method === 'GET' && r.path === '/api/tenants/branches') return ok(BRANCHES);
    if (r.method === 'GET' && r.path === '/api/roles') return ok(ROLES.map(name => ({ id: 'r-' + name, name })));
    if (r.method === 'GET' && r.path === '/api/permissions') return ok([]);
    return undefined;
  };
  await installNegBackend(page, context);
});

async function open(page: Page) {
  await go(page, '/admin/process');
  await expect(vis(page, '[data-testid="wf-main"]')).toBeVisible({ timeout: 60_000 });
  await expect(vis(page, '[data-testid="wf-area-name"]')).toHaveText('Frontdesk');
  await page.waitForTimeout(500);
}
/** Select a work area: the side card row (wide) or the picker sheet (phone / tablet portrait). */
async function selectArea(page: Page, id: string) {
  const side = page.locator('[data-testid="wf-side"]');
  if (await side.count()) { await vis(page, `[data-testid="wf-side"] [data-testid="wf-area-${id}"]`).click(); return; }
  await vis(page, '[data-testid="wf-area-picker"]').click();
  await vis(page, `[data-testid="wf-area-sheet"] [data-testid="wf-area-${id}"]`).click();
  await expect(page.locator('[data-testid="wf-area-sheet"]')).toHaveCount(0);
}
async function pickSelect(page: Page, host: Locator, label: string | RegExp) {
  await host.locator('.pf-dd__trigger').click();
  await vis(page, '.pf-dd__option').waitFor();
  await page.locator('.pf-dd__option', { hasText: label }).locator('visible=true').first().click();
}
const narrow = (page: Page) => page.evaluate(() => window.matchMedia('(max-width: 900px)').matches);

test.describe('Work steps — workflow redesign', () => {
  test('layout A: work areas = the navigation (left), the selected area (right), ONE band Save, the live status line', async ({ page }) => {
    await open(page);
    await expect(page.locator('pf-hero-band [data-testid="band-save"]')).toHaveCount(1);
    await expect(vis(page, 'pf-hero-band [data-testid="band-save"] .pf-ssv__save')).toBeDisabled();
    if (!(await narrow(page))) {
      await expect(vis(page, '[data-testid="wf-status"]')).toContainText('Standard flow is live · Save changes the navigation for everyone at once');
      const names = await page.locator('[data-testid="wf-side"] .wf-area__name').allTextContents();
      expect(names).toEqual(['Frontdesk', 'Collect', 'Home Visits', 'Lab', 'Validate', 'Results', 'Messages']);
      // Same height side + main card (Test Master frame); the side card is the shared 340px.
      const [s, m] = await Promise.all([vis(page, '[data-testid="wf-side"]').boundingBox(), vis(page, '[data-testid="wf-main"]').boundingBox()]);
      expect(Math.abs(s!.height - m!.height)).toBeLessThan(3);
      expect(Math.round(s!.width)).toBe(340);
    } else {
      await expect(vis(page, '[data-testid="wf-area-picker"]')).toContainText('Frontdesk');
    }
    // Full names + hint, never truncated; the lock pill says why.
    const order = vis(page, '[data-type="walk_in_order"]');
    await expect(order.locator('.wf-act__name')).toHaveText('New Order');
    await expect(order.locator('[data-testid="wf-lock"]')).toHaveText('Stays in Frontdesk: can’t move to another area');
    const clipped = await page.locator('.wf-act__name, .wf-act__hint, .wf-lock').evaluateAll(els => els.filter(e => e.scrollWidth > e.clientWidth + 1).length);
    expect(clipped, 'no truncated action text').toBe(0);
    await expectNoHorizontalScroll(page, 'work steps');
    // No yellow anywhere on the page.
    const yellow = await page.evaluate(() => Array.from(document.querySelectorAll('pf-wf-editor *')).some(e => {
      const cs = getComputedStyle(e as Element);
      return [cs.color, cs.backgroundColor, cs.borderTopColor].some(c => /rgb\(245, 158, 11\)|rgb\(234, 179, 8\)|rgb\(250, 204, 21\)/.test(c));
    }));
    expect(yellow).toBe(false);
    await shot(page, 'wf-layout');
  });

  test('nothing clickable at the bottom of the screen (only the app’s own bottom nav)', async ({ page }) => {
    await open(page);
    const bad = await page.evaluate(() => {
      const vh = window.innerHeight;
      const nav = document.querySelector('pf-bottom-nav, .pf-bnav, nav[aria-label*="Main"]');
      return Array.from(document.querySelectorAll('pf-process-builder button, pf-process-builder a, pf-process-builder input'))
        .filter(el => {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (!r.width || !r.height || r.top < vh * 0.85 || r.top > vh) return false;
          // Scrolled card content (the action rows) is fine; a pinned bar is not.
          return !(el as HTMLElement).closest('.wf-main__body, .wf-side__body, .wf-acts') && !(nav && nav.contains(el));
        }).map(el => (el as HTMLElement).innerText || el.getAttribute('aria-label'));
    });
    expect(bad).toEqual([]);
  });

  test('peek: hover (long-press on touch) shows the area’s roles + actions with switches; drag one into Frontdesk', async ({ page }) => {
    await open(page);
    if (isTouch() || (await narrow(page))) {
      if (await page.locator('[data-testid="wf-side"]').count() === 0) {
        await vis(page, '[data-testid="wf-area-picker"]').click();
      }
      const row = vis(page, '[data-testid="wf-area-results"]');
      // Long-press: the peek opens as a sheet (the area sheet closes under it).
      await row.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 });
      await page.waitForTimeout(700);
      const peek = vis(page, '[data-testid="wf-peek"]');
      await expect(peek).toBeVisible();
      await expect(peek).toContainText('Show Results in the navigation');
      await expect(peek).toContainText('Receptionist, Branch Manager, Lab Admin');
      await shot(page, 'wf-peek-sheet');
      await page.keyboard.press('Escape');
      return;
    }
    await vis(page, '[data-testid="wf-area-homecoll"]').hover();
    const peek = vis(page, '[data-testid="wf-peek"]');
    await expect(peek).toBeVisible({ timeout: 5_000 });
    await expect(peek).toContainText('Home Collection Agent, Sample Collector, Receptionist');
    await expect(peek).toContainText('Show Home Visits in the navigation');
    await page.screenshot({ path: `${out()}/wf-peek--light.png` });
    await theme(page, true);
    await page.mouse.move(5, 5);
    await vis(page, '[data-testid="wf-area-homecoll"]').hover();
    await expect(vis(page, '[data-testid="wf-peek"]')).toBeVisible({ timeout: 5_000 });
    await page.screenshot({ path: `${out()}/wf-peek--dark.png` });
    await theme(page, false);
    // Synthetic mouse drags of CDK drag-drop are unreliable in Playwright's WebKit / Firefox builds: there the
    // peek is checked and the keyboard equivalent (Move to) is covered by its own test.
    if (engine() !== 'chromium') return;
    // Drag "Home Visits" out of the peek into Frontdesk's list (between rows, below the peek).
    // The theme flip re-lays the page under the resting pointer, which can close the hover peek: hover again and
    // wait for the row + the target to be on screen before measuring (boundingBox() is null for a closed peek).
    await vis(page, '[data-testid="wf-area-homecoll"]').hover();
    const src = vis(page, '[data-testid="wf-peek"]').locator('.wf-peek__row', { hasText: 'Home Visits' });
    const target = vis(page, '[data-type="dispatch"]');
    await expect(src).toBeVisible({ timeout: 5_000 });
    await expect(target).toBeVisible();
    const a = (await src.boundingBox())!; const b = (await target.boundingBox())!;
    await page.mouse.move(a.x + 20, a.y + a.height / 2);
    await page.mouse.down();
    const tx = b.x + b.width / 2, ty = b.y + 8;
    for (let i = 1; i <= 14; i++) await page.mouse.move(a.x + 20 + ((tx - a.x - 20) * i) / 14, a.y + a.height / 2 + ((ty - a.y - a.height / 2) * i) / 14);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out()}/wf-peek-drag--light.png` });
    await page.mouse.up();
    await expect(vis(page, '[data-testid="wf-actions"] [data-type="home_visits"]')).toBeVisible();
    await expect(vis(page, 'pf-hero-band [data-testid="band-save"] .pf-ssv__save')).toBeEnabled();
    await expect(page.locator('[data-testid="wf-area-homecoll"] .wf-count').first()).toHaveText('0');
  });

  test('Move to (keyboard): an action moves to another work area; a locked one has no Move to', async ({ page }) => {
    await open(page);
    await expect(page.locator('[data-testid="wf-move-walk_in_order"]')).toHaveCount(0);
    await vis(page, '[data-testid="wf-move-billing"]').focus();
    await page.keyboard.press('ArrowDown');
    const menu = vis(page, '[data-testid="wf-move-menu"]');
    await expect(menu).toBeVisible();
    await shot(page, 'wf-move-menu');
    await menu.locator('[data-id="area:results"]').click();
    await expect(page.locator('[data-testid="wf-actions"] [data-type="billing"]')).toHaveCount(0);
    await selectArea(page, 'results');
    await expect(vis(page, '[data-testid="wf-actions"] [data-type="billing"]')).toBeVisible();
  });

  test('See it as a role: areas it can’t see are dimmed, the banner counts them, its chip is lit', async ({ page }) => {
    await open(page);
    await pickSelect(page, vis(page, '[data-testid="wf-seeas-pick"]'), 'Receptionist');
    if (await narrow(page)) await vis(page, '[data-testid="wf-area-picker"]').click();
    const banner = vis(page, '[data-testid="wf-seeas"]');
    await expect(banner).toContainText('Seeing as Receptionist: 4 of 7 areas');
    await expect(page.locator('.wf-area.is-dim').locator('visible=true')).toHaveCount(3);
    await shot(page, 'wf-seeas');
    await banner.locator('[data-testid="wf-seeas-stop"]').click();
    await expect(page.locator('[data-testid="wf-seeas"]')).toHaveCount(0);
  });

  test('Warnings (soft rose): an action off everywhere → "Nobody can reach Queue" → Show me lands on the row', async ({ page }) => {
    await open(page);
    await vis(page, '[data-testid="wf-switch-queue"]').click();
    await selectArea(page, 'lab');
    const chip = vis(page, '[data-testid="wf-warnings"]');
    await expect(chip).toContainText(/Warnings\s*1/);
    await chip.click();
    await expect(vis(page, '[data-testid="wf-warnlist"]')).toContainText('Nobody can reach Queue');
    await shot(page, 'wf-warnings');
    await vis(page, '[data-testid="wf-showme-0"]').click();
    await expect(vis(page, '[data-testid="wf-area-name"]')).toHaveText('Frontdesk');
    await expect(vis(page, '[data-type="queue"]')).toHaveClass(/wf-flash/);
    await page.waitForTimeout(600);
    await shot(page, 'wf-warning-landed');
  });

  test('branches: "<branch> · n changes"; the changed area says so (violet) with Reset to default', async ({ page }) => {
    await open(page);
    const branch = vis(page, '[data-testid="wf-branch"]');
    await branch.locator('.pf-dd__trigger').click();
    await expect(vis(page, '.pf-dd__option:has-text("Chennai Main · 1 change")')).toBeVisible();
    await page.locator('.pf-dd__option', { hasText: 'Chennai Main' }).locator('visible=true').first().click();
    await expect(vis(page, '[data-testid="wf-changed"]')).toHaveText('Changed for Chennai Main');
    await expect(vis(page, '[data-testid="wf-status"], [data-testid="wf-area-picker"]')).toBeVisible();
    await shot(page, 'wf-branch');
    await vis(page, '[data-testid="wf-reset"]').click();
    await vis(page, '.pf-dh-root button:has-text("Reset")').click();
    await expect(page.locator('[data-testid="wf-changed"]')).toHaveCount(0);
    await expect(vis(page, '[data-testid="wf-actions"] [data-type="queue"]')).toBeVisible();
  });

  test('search jumps to the match: "dispatch" → its area opens and the row is lit', async ({ page }) => {
    await open(page);
    await selectArea(page, 'lab');
    await vis(page, 'pf-hero-band .pf-hb__input').fill('dispatch');
    if (!isPhone()) await expect(vis(page, '[data-testid="wf-search-note"]')).toHaveText('1 match — in Frontdesk');
    await expect(vis(page, '[data-testid="wf-area-name"]')).toHaveText('Frontdesk');
    await expect(vis(page, '[data-type="dispatch"]')).toHaveClass(/wf-flash/);
    await page.waitForTimeout(500);
    await shot(page, 'wf-search');
  });

  test('History: saved versions with who / when; Restore puts one on screen as unsaved changes; Save PUTs the same payload', async ({ page }) => {
    await open(page);
    if (await page.locator('[data-testid="wf-side"]').count()) await vis(page, '[data-testid="wf-history"]').click();
    else { await vis(page, '[data-testid="wf-area-picker"]').click(); await vis(page, '[data-testid="wf-area-sheet"] button:has-text("History")').click(); }
    const panel = vis(page, '[data-testid="wf-history-panel"]');
    await expect(panel.locator('[data-testid="wf-version"]')).toHaveCount(3);
    await expect(panel).toContainText('Ravi Kumar');
    await expect(panel).toContainText('Before history was kept');
    await shot(page, 'wf-history');
    await panel.locator('[data-testid="wf-restore-2"]').click();
    await expect(page.locator('[data-testid="wf-history-panel"]')).toHaveCount(0);
    await expect(vis(page, '[data-testid="wf-area-name"]')).toHaveText('Front office');
    const save = vis(page, 'pf-hero-band [data-testid="band-save"] .pf-ssv__save');
    await expect(save).toBeEnabled();
    await save.click();
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0].path).toBe('/api/process-workflows/w1');
    expect(Object.keys(puts[0].body).sort()).toEqual(['branchId', 'configJson', 'name']);
    const cfg = JSON.parse(puts[0].body.configJson);
    expect(cfg.categories[0].name).toBe('Front office');
    await expect(save).toBeDisabled();
  });

  test('unsaved changes: switching workflow asks "Save your changes?"; Stay keeps them', async ({ page }) => {
    await open(page);
    await vis(page, '[data-testid="wf-switch-queue"]').click();
    await vis(page, '[data-testid="wf-workflow"]').click();
    await vis(page, '[data-testid="wf-workflow-menu"] [data-id="wf:w2"]').click();
    const dlg = vis(page, '.pf-dh-root:has-text("Save your changes?")');
    await expect(dlg).toBeVisible();
    await shot(page, 'wf-unsaved');
    await dlg.locator('button:has-text("Stay")').click();
    await expect(vis(page, '[data-testid="wf-workflow"]')).toContainText('Standard flow');
    await expect(vis(page, 'pf-hero-band [data-testid="band-save"] .pf-ssv__save')).toBeEnabled();
  });

  test('the Workflow picker holds New / Duplicate / Set active (no band corner buttons)', async ({ page }) => {
    await open(page);
    const corner = await page.locator('pf-hero-band .pf-hb__actions button').allTextContents();
    expect(corner.map(s => s.trim()).filter(s => /^(New|Duplicate|Set active)$/.test(s))).toEqual([]);
    await vis(page, '[data-testid="wf-workflow"]').click();
    const menu = vis(page, '[data-testid="wf-workflow-menu"]');
    await expect(menu.locator('.wfm-l')).toHaveText(['Standard flow', 'Evening flow', 'New workflow', 'Duplicate', 'Set active']);
    await shot(page, 'wf-workflow-menu');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="wf-workflow-menu"]')).toHaveCount(0);
  });

  test('add: + Add action offers the unused actions (Lost & Found); + Add role adds a chip', async ({ page }) => {
    await open(page);
    await vis(page, 'button[data-testid="wf-add-action"]').click();
    const menu = vis(page, '[data-testid="wf-add-action-menu"]');
    await expect(menu.locator('.wfm-l')).toHaveText(['Lost & Found']);
    await menu.locator('[data-id="lost_and_found"]').click();
    await expect(vis(page, '[data-testid="wf-actions"] [data-type="lost_and_found"]')).toBeVisible();
    await vis(page, 'button[data-testid="wf-add-role"]').click();
    await vis(page, '[data-testid="wf-add-role-menu"] [data-id="Pathologist"]').click();
    await expect(vis(page, '[data-testid="wf-who"] [data-role="Pathologist"]')).toBeVisible();
    if (isDesktop()) await shot(page, 'wf-added');
  });
});

test.describe('Work steps — orientation sanity', () => {
  test('tablet portrait / phone use the picker; landscape keeps the side card', async ({ page }) => {
    await open(page);
    const n = await narrow(page);
    expect(await page.locator('[data-testid="wf-side"]').count()).toBe(n ? 0 : 1);
    if (n) {
      await vis(page, '[data-testid="wf-area-picker"]').click();
      await expect(vis(page, '[data-testid="wf-area-sheet"]')).toBeVisible();
      await shot(page, `wf-area-sheet-${orientation()}`);
    }
  });
});
