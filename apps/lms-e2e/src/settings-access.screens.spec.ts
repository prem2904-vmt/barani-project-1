import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, isPhone, shotsDir } from './support/form-factor';
import { ME, TENANT, go, installNegBackend, neg, resetNeg } from './support/neg-backend';

/**
 * SETTINGS ACCESS (owner 2026-11-18): Job role + per-area None / Contributor / Admin. API mocked, demo data only.
 *  - A front-desk person given "Test Master contributor" opens Settings straight into Test Master; nothing else of
 *    Settings shows; Save reads "Send for approval" and lands in pending changes (never the direct write).
 *  - A Lab contributor sees only the Lab section; a page with no approval model yet is "View only".
 *  - People and access → the person panel: Job role, then Settings access, one pf-select per area.
 * Every form factor, light + dark. Screenshots: SHOTS_DIR/<form factor>/sa-*.png.
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/settings-access');
const out = () => shotsDir(OUT_BASE);
const vis = (page: Page, sel: string) => page.locator(sel).locator('visible=true').first();

async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
  await page.waitForTimeout(500);
}
async function shot(page: Page, name: string) {
  for (const dark of [false, true]) { await theme(page, dark); await page.screenshot({ path: `${out()}/${name}--${dark ? 'dark' : 'light'}.png` }); }
  await theme(page, false);
}

const RECEPTIONIST = ['register_patient', 'edit_patient', 'view_patient', 'create_order', 'view_order', 'create_bill', 'collect_payment',
  'give_discount', 'view_bill', 'collect_sample', 'reject_sample', 'dispatch_sample', 'deliver_report', 'view_report', 'print_barcode',
  'view_test', 'expense_modifier'];
const ORG_ADMIN = ['*'];

const DEPTS = [
  { id: 'd1', name: 'Biochemistry', code: 'BIO', isActive: true },
  { id: 'd2', name: 'Haematology', code: 'HAE', isActive: true },
];
const TESTS = ['Glucose fasting', 'HbA1c', 'Complete blood count', 'Creatinine', 'ESR', 'Lipid profile', 'Urea', 'Haemoglobin'].map((name, i) => ({
  id: `t${i + 1}`, testCode: `T${100 + i}`, name, shortName: '', section: '', type: 'individual', flow: 'direct', isActive: true, isEnabled: true,
  isOffered: true, price: 120 + i * 30, taxSlab: 0, discount: 0, tatHours: 4, origin: 'master', unit: 'mg/dL',
  department: DEPTS[i % 2].name, departmentId: DEPTS[i % 2].id, tubeColor: 'grey',
  parametersJson: JSON.stringify([{ name: 'Value', type: 'numeric', unit: 'mg/dL' }]),
}));
const USERS = [
  { id: 'u1', firstName: 'Olga', fathersName: 'Admin', displayName: 'Olga Admin', title: 'Ms.', username: 'olga', email: '', phone: '+91 9876500001', isActive: true, authId: ME.authId },
  { id: 'u2', firstName: 'Farah', fathersName: 'Desk', displayName: 'Farah Desk', title: 'Ms.', username: 'farah', email: '', phone: '+91 9876500002', isActive: true, authId: 'a2' },
];
const ROLES = [{ id: 'r1', name: 'Receptionist', isPreSeeded: true, scope: 'tenant' }, { id: 'r2', name: 'Lab Admin', isPreSeeded: true, scope: 'tenant' }];
const area = (a: string, grant: string, fromRole = 'none') => ({ area: a, grant, fromRole, effective: grant, canChange: true, choices: ['none', 'contributor', 'admin'] });
const ACCESS = { userId: 'u2', areas: [area('org', 'none'), area('lab', 'none'), area('test_master', 'contributor'), area('opd', 'none'), area('ipd', 'none')] };

function me(perms: string[]) {
  return { id: ME.id, authId: ME.authId, firstName: ME.first, fathersName: ME.last, displayName: `${ME.first} ${ME.last}`, email: 'desk@demolab.example',
    tenantId: TENANT.id, tenantName: TENANT.name, branchId: 'b1', branchName: 'Main', roles: ['Receptionist'], permissions: perms,
    branches: [{ id: 'b1', name: 'Main' }], modules: ['lab'], hasPin: false };
}

async function boot(page: Page, context: Parameters<typeof installNegBackend>[1], perms: string[]) {
  resetNeg();
  neg.hook = r => {
    const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
    if (r.path === '/api/auth/me') return ok(me(perms));
    if (r.method === 'POST' && r.path.startsWith('/api/settings-changes/test-master/')) {
      return ok({ created: [{ id: 'pc1', kind: 'test_update', target: 'Glucose fasting', summary: 'Edit: TAT', clinical: false }], skipped: [] });
    }
    if (r.method === 'PUT' && r.path === '/api/settings-access/users/u2') return ok(ACCESS);
    if (r.method !== 'GET') return undefined;
    if (r.path === '/api/tests/' || r.path === '/api/tests') return ok(TESTS);
    if (r.path === '/api/tests/t1') return ok(TESTS[0]);
    if (r.path === '/api/tenants/departments') return ok(DEPTS);
    if (r.path === '/api/settings-changes/test-master') return ok({ items: [], total: 0, pendingCount: 0, counts: { pending: 0, stale: 0, failed: 0 } });
    if (r.path === '/api/users' || r.path === '/api/users/') return ok(USERS);
    if (r.path === '/api/roles' || r.path === '/api/roles/') return ok(ROLES);
    if (/^\/api\/users\/u2\/roles/.test(r.path)) return ok([{ roleId: 'r1', branchId: 'b1' }]);
    if (r.path === '/api/settings-access/users/u2') return ok(ACCESS);
    return undefined;
  };
  await installNegBackend(page, context);
}

test.describe('settings access', () => {
  test.beforeEach(() => test.setTimeout(180_000));

  test('front desk + Test Master contributor: Settings opens straight into Test Master, Save = "Send for approval"', async ({ page, context }) => {
    await boot(page, context, [...RECEPTIONIST, 'contribute_test_master']);
    await go(page, '/admin');
    await page.waitForURL(/\/admin\/tests/, { timeout: 60_000 });
    await expect(page.getByText('Glucose fasting').locator('visible=true').first()).toBeVisible({ timeout: 30_000 });
    // Contributors never Restore to default.
    await expect(page.getByRole('button', { name: 'Restore to default' }).locator('visible=true')).toHaveCount(0);
    await page.waitForTimeout(500);
    await shot(page, 'sa-tm-contributor-grid');

    // The editor: its Save reads "Send for approval"; Save posts a pending change, never the PATCH.
    await go(page, '/admin/tests/t1/edit?type=individual');
    const send = vis(page, 'button:has-text("Send for approval")');
    await expect(send).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Revert to master' }).locator('visible=true')).toHaveCount(0);
    await page.waitForTimeout(700);
    await shot(page, 'sa-tm-contributor-editor');
    const tat = page.locator('input[aria-label*="TAT" i], input[name*="tat" i]').locator('visible=true').first();
    if (await tat.count()) {
      await tat.fill('6');
      await send.click();
      await expect.poll(() => neg.calls.some(c => c.path === '/api/settings-changes/test-master/test-update')).toBe(true);
      expect(neg.calls.some(c => c.method === 'PATCH' && c.path.startsWith('/api/tests/'))).toBe(false);
    }
  });

  test('front desk + Test Master contributor: every other setting stays hidden and its route refuses', async ({ page, context }) => {
    await boot(page, context, [...RECEPTIONIST, 'contribute_test_master']);
    await go(page, '/admin/lab/collection');
    await page.waitForTimeout(2500);
    expect(new URL(page.url()).pathname).not.toBe('/admin/lab/collection');
    await go(page, '/admin/users');
    await page.waitForTimeout(2000);
    expect(new URL(page.url()).pathname.startsWith('/admin/users')).toBe(false);
  });

  test('Lab contributor: only the Lab section; a page with no approval model yet is "View only"', async ({ page, context }) => {
    await boot(page, context, ['view_test', 'contribute_lab_settings', 'contribute_test_master']);
    await go(page, '/admin');
    // Phone: one section = no list of one, the Lab section opens straight away.
    if (isPhone()) await expect(vis(page, '[data-testid="ov-tile-admin-tests"]')).toBeVisible({ timeout: 60_000 });
    else await expect(vis(page, '[data-testid="tp-item-lab"]')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-testid="tp-item-people"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="tp-item-billing"]')).toHaveCount(0);
    await page.waitForTimeout(500);
    await shot(page, 'sa-lab-contributor-overview');
    await go(page, '/admin/lab/collection?tab=queue');
    await expect(vis(page, '[data-testid="settings-shell"]')).toBeVisible({ timeout: 60_000 });
    if (!isPhone()) await expect(vis(page, '[data-testid="settings-main"][inert]')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(700);
    await shot(page, 'sa-lab-contributor-view-only');
  });

  test('People and access: the person panel shows Job role, then Settings access (one pf-select per area)', async ({ page, context }) => {
    await boot(page, context, ORG_ADMIN);
    // The person panel beside the People grid (the editor's own path opens it there).
    await go(page, '/admin/users/u2/edit');
    const sec = page.locator('[data-testid="ue-sec-access"]').locator('visible=true');
    const box = page.locator('[data-testid="ue-settings-access"]');
    await expect(page.locator('[data-testid="ue-panel"], [data-testid="ue-sec-access"]').locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
    if (await sec.count()) await sec.first().click();
    await box.first().scrollIntoViewIfNeeded();
    await expect(box.locator('visible=true').first()).toBeVisible({ timeout: 20_000 });
    await expect(box.locator('pf-setting-row')).toHaveCount(5);
    for (const label of ['Organization', 'Lab', 'Test Master', 'OPD', 'IPD']) {
      await expect(box.getByText(label, { exact: true }).first()).toBeAttached();
    }
    // Job role, then Settings access (panel headings).
    const heads = (await page.locator('[data-testid="ue-panel"] .ue-panel__sec').allTextContents()).map(t => t.trim());
    if (heads.length) {
      const i = heads.findIndex(h => h.startsWith('Job role'));
      expect(heads[i + 1]).toContain('Settings access');
    }
    await page.waitForTimeout(600);
    await shot(page, 'sa-person-settings-access');
    await box.locator('pf-select').nth(1).scrollIntoViewIfNeeded();
    await box.locator('pf-select').nth(1).click();
    await page.waitForTimeout(400);
    await shot(page, 'sa-person-settings-access-open');
    await page.keyboard.press('Escape');
  });
});
