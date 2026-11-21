import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, isPhone, projectName, shotsDir } from './support/form-factor';
import { neg, resetNeg, installNegBackend, go } from './support/neg-backend';
import { DOCTORS, HOSPITALS } from './support/referring';

/**
 * Settings › Front desk (owner 2026-11-21):
 *  B) Referring doctors / hospitals: "Add doctor" / "Add hospital" and "Paste from sheet" in the group head; the paste
 *     sheet checks every row (name required, duplicates flagged, an unknown hospital offered for creation), links a
 *     doctor to several hospitals, and saves through the existing endpoints; Save stays disabled until there is a row.
 *  C) Every settings panel keeps its inner padding: a row's label sits >= 16px from the card's left edge and its
 *     control >= 16px from the right edge (Booking slots, Priority engine — and every other Lab settings page);
 *     number fields show no browser spinner.
 * API mocked, fake data only. Screenshots: SHOTS_DIR/<project>/fd-*.png
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/settings-grids2');
const FD = '/admin/lab/front-desk';

let doctors = [...DOCTORS];
let hospitals = [...HOSPITALS];
test.beforeEach(async ({ page, context }) => {
  test.setTimeout(180_000);
  resetNeg();
  doctors = [...DOCTORS];
  hospitals = [...HOSPITALS];
  let n = 0;
  neg.hook = r => {
    const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
    if (r.method === 'POST' && r.path === '/api/referring-network/hospitals') {
      const h = { id: `hn${++n}`, ...r.body, isActive: true, doctorCount: 0 };
      hospitals = [...hospitals, h];
      return ok(h);
    }
    if (r.method === 'POST' && r.path === '/api/referring-network/doctors') {
      const ids: string[] = r.body.hospitalIds ?? [];
      const d = { id: `dn${++n}`, ...r.body, isActive: true, hospitals: ids.map(id => ({ id, name: hospitals.find(h => h.id === id)?.name ?? id })) };
      doctors = [...doctors, d];
      return ok(d);
    }
    if (r.method !== 'GET') return undefined;
    switch (r.path) {
      case '/api/referring-network/hospitals': return ok(hospitals);
      case '/api/referring-network/doctors': return ok(doctors);
      case '/api/appointments/config': return ok({ branchId: 'b1', queueMode: 'token_queue', slotMinutes: 30, maxConcurrentSlots: 2, open24h: false, startTime: '07:00', endTime: '20:00' });
      default: return undefined;
    }
  };
  await installNegBackend(page, context);
});

async function shot(page: Page, name: string) {
  const dir = shotsDir(OUT_BASE);
  for (const dark of [false, true]) {
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/fd-${name}-${dark ? 'dark' : 'light'}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => { const r = document.documentElement; r.classList.remove('dark'); r.classList.add('light'); r.setAttribute('data-theme', 'light'); });
}
const vis = (page: Page, sel: string) => page.locator(sel).locator('visible=true').first();
const posts = (p: string) => neg.calls.filter(c => c.method === 'POST' && c.path === p);
/** The Front desk frame lists its groups in a side card (one group at a time): open one by its name. */
async function category(page: Page, name: string) {
  const btn = page.getByRole('button', { name: new RegExp(`^${name}\\b`) }).locator('visible=true').first();
  // The side list renders after the settings load (never a count() race); a phone may list the groups one under
  // the other instead (no button) — then there is nothing to open.
  if (await btn.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false)) await btn.click();
  await settled(page);
}
/** The panel body slides in (translateX 14px, 260ms): measure only once every animation has finished. */
async function settled(page: Page) {
  await page.waitForTimeout(80);
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'), undefined, { timeout: 5000 }).catch(() => undefined);
}

/** Each visible settings row: label left offset / control right offset from its card (the nearest card box). */
async function rowInsets(page: Page) {
  return page.locator('pf-setting-row').evaluateAll(rows => rows.filter(r => (r as HTMLElement).offsetParent && r.getBoundingClientRect().width > 0).map(r => {
    const card = (r.closest('.pf-ss__card, .pf-tp__panel, .pf-card') ?? document.body) as HTMLElement;
    const c = card.getBoundingClientRect();
    const lab = r.querySelector('.pf-srow__label')!.getBoundingClientRect();
    // The control COLUMN (the row's right column every input aligns to), not a child's own box.
    const ctl = (r.querySelector('.pf-srow__ctl') as HTMLElement).getBoundingClientRect();
    return { label: r.querySelector('.pf-srow__label')!.textContent!.trim(),
      // A STACKED row holds wide content (a preview, a list) at the card's width by design: only its label is checked.
      left: Math.round(lab.left - c.left), right: r.classList.contains('pf-srow--stack') ? 99 : Math.round(c.right - ctl.right) };
  }));
}

test.describe('Settings › Front desk', () => {
  test('C: Booking slots + Priority engine rows keep a 16px inner gutter; no number spinners', async ({ page }) => {
    test.skip(isPhone(), 'phones: the card gutter is the phone gutter (14px) — desktop and tablet are asserted');
    await go(page, FD);
    for (const g of ['slots', 'priority']) {
      await category(page, g === 'slots' ? 'Booking slots' : 'Priority engine');
      await expect(page.locator(`[data-group="${g}"] pf-setting-row`).locator('visible=true').first()).toBeVisible({ timeout: 20_000 });
      const ins = await rowInsets(page);
      expect(ins.length, `${g}: rows`).toBeGreaterThan(0);
      for (const r of ins) {
        expect(r.left, `${g} › ${r.label}: label inset from the card's left edge at ${projectName()}`).toBeGreaterThanOrEqual(16);
        expect(r.right, `${g} › ${r.label}: control inset from the card's right edge at ${projectName()}`).toBeGreaterThanOrEqual(16);
      }
      const spin = await page.locator('input[type="number"]').evaluateAll(els => els.map(e => getComputedStyle(e).appearance));
      expect(spin.filter(a => a !== 'textfield' && a !== 'none'), 'no browser number spinners').toEqual([]);
      await shot(page, `padding-${g}`);
    }
  });

  test('C: every Lab settings page keeps the same row gutter', async ({ page }) => {
    test.skip(isPhone(), 'desktop and tablet are asserted');
    for (const route of ['/admin/lab/sample-numbers', '/admin/lab/collection', '/admin/lab/results', '/admin/lab/home-collection', FD, '/admin/lab/alerts', '/admin/reports']) {
      await go(page, route);
      await page.waitForTimeout(1200);
      const cats = await page.locator('aside button[aria-pressed], [aria-label$="categories"] button').locator('visible=true').allTextContents();
      const ins: Awaited<ReturnType<typeof rowInsets>> = [...await rowInsets(page)];
      for (const c of cats.slice(1)) {
        const name = c.trim().split(/\s{2,}|\n/)[0];
        const b = page.locator('aside button[aria-pressed], [aria-label$="categories"] button').filter({ hasText: name }).locator('visible=true').first();
        if (!(await b.count())) continue;
        await b.click();
        await settled(page);
        ins.push(...await rowInsets(page));
      }
      for (const r of ins) {
        expect(r.left, `${route} › ${r.label}: label inset at ${projectName()}`).toBeGreaterThanOrEqual(16);
        expect(r.right, `${route} › ${r.label}: control inset at ${projectName()}`).toBeGreaterThanOrEqual(16);
      }
      test.info().annotations.push({ type: 'rows', description: `${projectName()} ${route}: ${ins.length} rows` });
    }
  });

  test('B: Add doctor from the group head saves one doctor', async ({ page }) => {
    await go(page, FD);
    await category(page, 'Referring doctors');
    const add = vis(page, '[data-testid="rn-add"]');
    await add.scrollIntoViewIfNeeded();
    await expect(add).toHaveText(/Add doctor/);
    await expect(add).not.toHaveClass(/pf-btn--primary/);
    await shot(page, 'referring-head');
    await add.click();
    const dlg = vis(page, '[role="dialog"][aria-label="Add doctor"]');
    await expect(dlg).toBeVisible();
    await dlg.locator('input[placeholder="Dr. Priya Krishnan"]').fill('Dr. Kavin Raj');
    await dlg.getByRole('button', { name: 'Save doctor' }).click();
    await expect.poll(() => posts('/api/referring-network/doctors').length).toBe(1);
    expect(posts('/api/referring-network/doctors')[0].body).toMatchObject({ name: 'Dr. Kavin Raj', hospitalIds: [] });
  });

  test('B: paste 5 rows (1 duplicate, 1 new hospital) → checked row by row → Save creates the hospital and 4 doctors', async ({ page }) => {
    await go(page, FD);
    await category(page, 'Referring doctors');
    const open = vis(page, '[data-testid="rn-paste-open"]');
    await open.scrollIntoViewIfNeeded();
    await open.click();
    const panel = vis(page, '[data-testid="rn-paste"]');
    await expect(panel).toBeVisible();
    const save = panel.locator('[data-testid="rn-paste-save"]');
    await expect(save, 'Save stays disabled until there is a row').toBeDisabled();
    const tsv = [
      ['Name', 'Qualification', 'Hospital(s)', 'Department', 'Phone'],
      ['Dr. Kavin Raj', 'MBBS', 'Apollo Hospitals', 'Cardiology', '9840011111'],
      ['Dr. Nila Devi', 'MD', 'apollo hospitals; Kauvery', 'Medicine', '9840022222'],
      ['Dr. Priya Krishnan', 'MBBS, MD', 'Apollo Hospitals', 'Cardiology', ''],
      ['Dr. Omar Faiz', 'MS', 'Fortis Malar', 'Surgery', '9840033333'],
      ['Dr. Lakshmi Iyer', 'DGO', '', 'Obstetrics', ''],
    ].map(r => r.join('\t')).join('\n');
    await panel.locator('[data-testid="rn-paste-box"]').fill(tsv);
    await expect(panel.locator('[data-testid="rn-paste-count"]')).toHaveText('5 rows');
    const check = panel.locator('.ag-cell[col-id="check"] .pf-sw__now');
    await expect.poll(() => check.allTextContents()).toEqual(expect.arrayContaining(['Duplicate', 'New hospital']));
    const words = await check.allTextContents();
    expect(words.filter(w => w === 'Ready')).toHaveLength(3);
    expect(words.filter(w => w === 'Duplicate')).toHaveLength(1);
    expect(words.filter(w => w === 'New hospital')).toHaveLength(1);
    await expect(panel.locator('[data-testid="rn-paste-new-hospitals"]')).toContainText('Fortis Malar');
    await expect(save).toBeEnabled();
    await expect(save).toHaveText(/Save 4 doctors/);
    // The sheet itself sorts + filters like every grid.
    await expect(panel.locator('.ag-header-cell[col-id="name"]')).toHaveClass(/ag-header-cell-sortable/);
    await expect(panel.locator('.ag-header-cell[col-id="check"] .ag-header-cell-filter-button')).toHaveCount(1);
    await shot(page, 'paste-checked');
    await save.click();
    await page.getByRole('button', { name: 'Create and save' }).locator('visible=true').first().click();
    await expect.poll(() => posts('/api/referring-network/doctors').length).toBe(4);
    const hs = posts('/api/referring-network/hospitals');
    expect(hs.map(h => h.body.name)).toEqual(['Fortis Malar']);
    const bodies = posts('/api/referring-network/doctors').map(c => c.body);
    expect(bodies.find(b => b.name === 'Dr. Nila Devi').hospitalIds, 'works wherever they have worked: both hospitals').toEqual(['h1', 'h2']);
    expect(bodies.find(b => b.name === 'Dr. Omar Faiz').hospitalIds).toEqual(['hn1']);
    expect(bodies.find(b => b.name === 'Dr. Lakshmi Iyer').hospitalIds).toEqual([]);
    expect(bodies.some(b => b.name === 'Dr. Priya Krishnan'), 'the duplicate is never saved').toBe(false);
    await expect.poll(async () => (await check.allTextContents()).filter(w => w === 'Saved').length).toBe(4);
    await expect(save).toBeDisabled();
    await shot(page, 'paste-saved');
  });

  test('B: paste hospitals (Hospitals view) flags an existing name / code', async ({ page }) => {
    await go(page, FD);
    await category(page, 'Referring doctors');
    // The group's Hospitals | Doctors pill rides the card head now (owner 2026-11-21); it may be collapsed to its menu.
    const pill = page.locator('.pf-tp__head [role="radio"]:has-text("Hospitals")').locator('visible=true').first();
    if (await pill.count()) await pill.click();
    else {
      await vis(page, '.pf-tp__head pf-segmented [data-seg-compact]').click();
      await page.getByRole('menuitemradio', { name: /^Hospitals/ }).locator('visible=true').first().click();
    }
    await expect(vis(page, '[data-testid="rn-add"]')).toHaveText(/Add hospital/);
    await vis(page, '[data-testid="rn-paste-open"]').click();
    const panel = vis(page, '[data-testid="rn-paste"]');
    await panel.locator('[data-testid="rn-paste-box"]').fill('Fortis Malar\tFOR\nKAUVERY\t\nNew Clinic\tAPO');
    const check = panel.locator('.ag-cell[col-id="check"] .pf-sw__now');
    await expect.poll(() => check.allTextContents()).toEqual(['Ready', 'Duplicate', 'Duplicate']);
    await panel.locator('[data-testid="rn-paste-save"]').click();
    await expect.poll(() => posts('/api/referring-network/hospitals').length).toBe(1);
    expect(posts('/api/referring-network/hospitals')[0].body).toMatchObject({ name: 'Fortis Malar', code: 'FOR' });
  });
});
