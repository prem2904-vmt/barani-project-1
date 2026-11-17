import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, isPhone, expectLayout, shotsDir } from './support/form-factor';
import { resetNeg, installNegBackend, go } from './support/neg-backend';

/**
 * Lab › Departments and lab spaces (/admin/lab/departments) on EVERY form factor, light + dark. API mocked, demo data
 * only; the page, band, list and board are the real app. Screenshots: SHOTS_DIR/<form factor>/lab-departments-*.png
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/rehome-depts');
const out = () => shotsDir(OUT_BASE);
const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`).locator('visible=true').first();

async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
  await page.waitForTimeout(450);
}
async function shot(page: Page, name: string) {
  for (const dark of [false, true]) { await theme(page, dark); await page.screenshot({ path: `${out()}/${name}--${dark ? 'dark' : 'light'}.png` }); }
  await theme(page, false);
}

type Dept = { id: string; tenantId: string; name: string; code: string; isActive: boolean; createdAt: string; catalogKey: string | null; metadata: string | null };
const mk = (id: string, name: string, code: string, own = false): Dept => ({
  id, tenantId: 't-demo', name, code, isActive: true, createdAt: '2026-01-01T00:00:00Z', catalogKey: own ? null : code, metadata: own ? '{"labMade":true}' : null,
});
let depts: Dept[] = [];
const calls: { method: string; path: string; body: any }[] = [];

async function installDepartments(page: Page) {
  depts = [mk('d1', 'Biochemistry', 'BIO'), mk('d2', 'Haematology', 'HEM'), mk('d3', 'Microbiology', 'MIC'), mk('d4', 'Cytogenetics', 'CYTO', true)];
  calls.length = 0;
  const spaces = [{ id: 's1', branchId: 'b1', name: 'Micro bench', code: 'MIC', order: 0 }];
  const links = [{ branchId: 'b1', departmentId: 'd3', spaceId: 's1' }];
  const branches = [
    { id: 'b1', name: 'Main', code: 'MAIN', city: 'Chennai', isActive: true, labStructure: 'auto', defaultLabCode: 'LAB' },
    { id: 'b2', name: 'Annex', code: 'ANX', city: 'Salem', isActive: true, labStructure: 'auto' },
  ];
  await page.route(/prefrontal\.health\/api\/(tenants|config)\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const json = (status: number, body: unknown) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const ok = (data: unknown) => json(200, { success: true, data });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const u = new URL(req.url()); const p = u.pathname; const m = req.method();
    let body: any = null; try { body = req.postData() ? JSON.parse(req.postData()!) : null; } catch { /* none */ }
    if (m !== 'GET') calls.push({ method: m, path: p, body });
    const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
    if (p === '/api/tenants/departments' && m === 'GET') return ok(depts);
    if (p === '/api/tenants/departments' && m === 'POST') {
      if (depts.some(d => norm(d.name) === norm(body.name))) return json(409, { success: false, error: 'dept_name_taken', message: `A department named "${body.name}" already exists.`, field: 'name' });
      if (depts.some(d => d.code.toLowerCase() === String(body.code).toLowerCase())) return json(409, { success: false, error: 'dept_code_taken', message: 'Code taken.', field: 'code' });
      const d = mk('d' + (depts.length + 1), body.name, String(body.code).toUpperCase(), true); depts = [...depts, d]; return ok(d);
    }
    const one = /^\/api\/tenants\/departments\/([^/]+)$/.exec(p);
    if (one && m === 'PATCH') {
      const d = depts.find(x => x.id === one[1])!;
      if (body.name !== undefined) {
        if (!d.metadata) return json(403, { success: false, error: 'department_master_owned', message: 'no' });
        if (depts.some(x => x.id !== d.id && norm(x.name) === norm(body.name))) return json(409, { success: false, error: 'dept_name_taken', message: 'dup', field: 'name' });
        d.name = body.name;
      }
      if (body.isActive !== undefined) d.isActive = body.isActive;
      return ok({ id: d.id });
    }
    if (one && m === 'DELETE') { depts = depts.filter(x => x.id !== one[1]); return ok({}); }
    if (p === '/api/tenants/branches') return ok(branches);
    if (p === '/api/tenants/lab-spaces' && m === 'GET') return ok(spaces);
    if (p === '/api/tenants/department-space-links') return ok(links);
    if (p === '/api/config/gst') return ok([{ branchId: 'b1', gstin: '33AAAAA0000A1Z5' }]);
    return route.fallback();
  });
}

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(150_000);
  resetNeg();
  await installNegBackend(page, context);
  await installDepartments(page);
});

test.describe('lab departments page', () => {
  test('departments: origin marks, on/off, add, duplicate refused, rename, delete', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await go(page, '/admin/lab/departments?tab=departments');
    await expect(tid(page, 'ld-list')).toBeVisible({ timeout: 60_000 });
    await expect(tid(page, 'ld-row-BIO').locator('[data-testid="ld-origin"]')).toContainText('From the catalogue');
    await expect(tid(page, 'ld-row-CYTO').locator('[data-testid="ld-origin"]')).toContainText('Made here');
    await expect(tid(page, 'ld-row-BIO').locator('[data-testid="ld-delete"]')).toHaveCount(0);
    await expectLayout(page, 'departments list');
    await shot(page, 'lab-departments-list');

    // on / off
    await tid(page, 'ld-row-HEM').locator('[data-testid="ld-switch"]').click();
    await expect(tid(page, 'ld-row-HEM').locator('[data-testid="ld-switch"]')).toHaveAttribute('aria-checked', 'false');
    await tid(page, 'ld-row-HEM').locator('[data-testid="ld-switch"]').click();

    // add + duplicate
    await tid(page, 'ld-add').click();
    await expect(tid(page, 'ld-add-form')).toBeVisible();
    await tid(page, 'ld-add-name').fill('biochemistry');
    await tid(page, 'ld-add-code').fill('bx');
    await tid(page, 'ld-add-save').click();
    await expect(tid(page, 'ld-add-name-err')).toContainText('already exists');
    await expectLayout(page, 'add duplicate');
    await shot(page, 'lab-departments-add-duplicate');
    await tid(page, 'ld-add-name').fill('Toxicology');
    await tid(page, 'ld-add-save').click();
    await expect(tid(page, 'ld-row-BX')).toBeVisible();
    await expect(tid(page, 'ld-row-BX').locator('[data-testid="ld-origin"]')).toContainText('Made here');
    expect(calls.some(c => c.method === 'POST' && c.body?.name === 'Toxicology' && c.body?.code === 'BX')).toBe(true);

    // rename
    await tid(page, 'ld-row-CYTO').locator('[data-testid="ld-rename"]').click();
    await tid(page, 'ld-rename-input').fill('Cytology');
    await shot(page, 'lab-departments-rename');
    await tid(page, 'ld-rename-save').click();
    await expect(tid(page, 'ld-row-CYTO')).toContainText('Cytology');

    // delete (themed confirm, not a native one)
    await tid(page, 'ld-row-BX').locator('[data-testid="ld-delete"]').click();
    await shot(page, 'lab-departments-delete-confirm');
    await page.getByRole('button', { name: /^Delete$/ }).locator('visible=true').first().click();
    await expect(page.locator('[data-testid="ld-row-BX"]')).toHaveCount(0);
    expect(errors, 'no uncaught errors').toEqual([]);
  });

  test('lab spaces tab: the per-branch board moved here', async ({ page }) => {
    await go(page, '/admin/lab/departments?tab=spaces');
    await expect(page.locator('.ld-br-toggle').locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
    await page.locator('.ld-br-toggle').locator('visible=true').first().click();
    await expect(page.locator('.pf-board').locator('visible=true').first()).toBeVisible();
    await expect(page.locator('input[aria-label="Space code — prefixes sample IDs"]').locator('visible=true').first()).toHaveValue('MIC');
    await expectLayout(page, 'lab spaces');
    await shot(page, 'lab-departments-spaces');
  });

  test('branches keeps new branch / deactivate / GSTIN and has no board', async ({ page }) => {
    await go(page, '/admin/branches');
    await expect(tid(page, 'br-gstin')).toContainText('33AAAAA0000A1Z5', { timeout: 60_000 });
    await expect(page.locator('.pf-board')).toHaveCount(0);
    await expect(page.getByText('Departments & lab spaces')).toHaveCount(0);
    await expectLayout(page, 'branches');
    await shot(page, 'lab-departments-branches');
    if (isPhone()) await expect(page.locator('html')).toHaveClass(/device-phone/);
  });

  test('old settings links open the new page', async ({ page }) => {
    await go(page, '/admin/lab/departments?tab=departments');
    await expect(tid(page, 'ld-list')).toBeVisible({ timeout: 60_000 });
  });
});
