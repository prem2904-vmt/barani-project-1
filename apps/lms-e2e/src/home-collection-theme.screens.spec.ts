import type { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect, projectName, belowGrid, expectLayout } from './support/form-factor';
import { resetNeg, installNegBackend, go, neg } from './support/neg-backend';

/**
 * Front desk → Unassigned home collections (/frontdesk/home-collection) in the app's ND pattern (owner 2026-11-22:
 * "this screen is not following our theme"): band (back + logo + Refresh), the visits as the MAIN card — AG-Grid
 * ≥1024px, the shared pf-work-list below — and an ASSIGN side card (the picked visit + agent picker + ONE Assign).
 * Light + dark, every form factor, no native controls, no sideways scroll. API mocked, fake data only.
 * Screenshots: SHOTS_DIR/<project>/hc-*--{light,dark}.png
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/theme-home-collection');

const VISITS = [
  { id: 'hv1', patientId: 'p1', branchId: 'b1', type: 'appointment', collectionType: 'home', status: 'booked', slotTime: '07:30', appointmentDate: '2026-11-22', address: '14 Gandhi Road, T Nagar', pincode: '600017', patient: { id: 'p1', displayName: 'Ms. Meenakshi Sundareswaran', phone: '9840012345' } },
  { id: 'hv2', patientId: 'p2', branchId: 'b1', type: 'appointment', collectionType: 'home', status: 'booked', slotTime: '08:00', appointmentDate: '2026-11-22', address: '2/7 Lake View Street, Velachery', pincode: '600042', patient: { id: 'p2', displayName: 'Mr. Sathish Kumar', phone: '9840098765' } },
  { id: 'hv3', patientId: 'p3', branchId: 'b1', type: 'appointment', collectionType: 'home', status: 'booked', slotTime: '09:15', appointmentDate: '2026-11-22', address: null, pincode: null, patient: { id: 'p3', displayName: 'Ms. Priya Nair' } },
  { id: 'hv4', patientId: 'p4', branchId: 'b1', type: 'appointment', collectionType: 'home', status: 'booked', slotTime: null, appointmentDate: '2026-11-22', address: '88 Anna Salai', pincode: '600002', patient: { id: 'p4', displayName: 'Mr. Prem Kumar K', phone: '9000011111' } },
];
const AGENTS = [
  { id: 'ag1', userId: 'u-ravi', isActive: true, pincodes: ['600017'], user: { displayName: 'Ravi Shankar' } },
  { id: 'ag2', userId: 'u-anu', isActive: true, pincodes: [], user: { firstName: 'Anu', fathersName: 'Mohan' } },
  { id: 'ag3', userId: 'u-old', isActive: false, pincodes: [], user: { displayName: 'Retired Agent' } },
];

let visits = VISITS;
test.beforeEach(async ({ page, context }) => {
  test.setTimeout(120_000);
  resetNeg();
  visits = VISITS;
  neg.hook = r => {
    const ok = (data: unknown) => ({ status: 200, body: { success: true, data } });
    if (r.method === 'GET' && r.path === '/api/home-collection/unassigned') return ok(visits);
    if (r.method === 'GET' && r.path === '/api/home-collection/agents') return ok(AGENTS);
    const m = /^\/api\/home-collection\/appointments\/([^/]+)\/assign$/.exec(r.path);
    if (m && r.method === 'PATCH') { visits = visits.filter(v => v.id !== m[1]); return ok({ ...VISITS.find(v => v.id === m[1]), assignedAgentUserId: (r.body as { agentUserId?: string })?.agentUserId }); }
    return undefined;
  };
  await installNegBackend(page, context);
  await page.addInitScript(() => {
    const css = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important}';
    const add = () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); };
    if (document.head) add(); else document.addEventListener('DOMContentLoaded', add);
  });
});

async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
}
async function shots(page: Page, name: string) {
  const out = path.join(OUT_BASE, projectName()); fs.mkdirSync(out, { recursive: true });
  for (const dark of [false, true]) {
    await theme(page, dark);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, `hc-${name}--${dark ? 'dark' : 'light'}.png`) });
  }
  await theme(page, false);
}
async function open(page: Page) {
  await go(page, '/frontdesk/home-collection');
  await expect(page.getByText('Mr. Sathish Kumar').locator('visible=true').first()).toBeVisible({ timeout: 45_000 });
}

test('screenshots (light + dark)', async ({ page }) => {
  await open(page);
  await shots(page, 'list');
});

test('ND frame: band, visits main card (grid ≥1024 / shared list below), ASSIGN side card; no native controls', async ({ page }) => {
  await open(page);
  await expect(page.locator('pf-hero-band').locator('visible=true').first()).toBeVisible();
  const main = page.locator('[data-testid="hc-main"]');
  await expect(main).toBeVisible();
  await expect(main.locator('.pf-card__label')).toHaveText(/unassigned visits/i);
  if (belowGrid()) {
    await expect(page.locator('[data-testid="hc-list"] .pf-wl__row').locator('visible=true')).toHaveCount(VISITS.length);
    await expect(page.locator('[data-testid="hc-grid"]')).toHaveCount(0);
  } else {
    await expect(page.locator('[data-testid="hc-grid"] .ag-row')).toHaveCount(VISITS.length);
    // The ASSIGN side card is always beside the grid (Pick a visit until one is chosen).
    await expect(page.locator('[data-testid="hc-side"]')).toBeVisible();
    await expect(page.locator('[data-testid="hc-side"] .pf-card__label')).toHaveText(/assign/i);
  }
  expect(await page.locator('select, datalist').count(), 'no native select / datalist').toBe(0);
  await expectLayout(page, 'home-collection');
});

test('assign: pick a visit, choose an active agent, Assign sends the PATCH and the visit leaves the list', async ({ page }) => {
  await open(page);
  if (belowGrid()) await page.locator('[data-testid="hc-list"] .pf-wl__row').filter({ hasText: 'Mr. Sathish Kumar' }).locator('visible=true').first().click();
  else await page.locator('[data-testid="hc-grid"] .ag-row').filter({ hasText: 'Mr. Sathish Kumar' }).first().click();
  const side = page.locator('[data-testid="hc-side"]').locator('visible=true').first();
  await expect(side).toContainText('Mr. Sathish Kumar');
  await expect(side).toContainText('600042');
  const assign = side.locator('[data-testid="hc-assign"]');
  await expect(assign).toBeDisabled();
  await side.locator('pf-select .pf-dd__trigger').click();
  // Only ACTIVE agents are offered.
  await expect(page.locator('.pf-dd__option', { hasText: 'Retired Agent' })).toHaveCount(0);
  await page.locator('.pf-dd__option', { hasText: 'Anu Mohan' }).first().click();
  await expect(assign).toBeEnabled();
  await shots(page, 'assign');
  await assign.click();
  await expect.poll(() => neg.calls.find(c => c.method === 'PATCH')?.path).toBe('/api/home-collection/appointments/hv2/assign');
  expect(neg.calls.find(c => c.method === 'PATCH')?.body).toEqual({ agentUserId: 'u-anu' });
  await expect(page.getByText('Mr. Sathish Kumar').locator('visible=true')).toHaveCount(0);
});

test('empty: nothing waiting says so in words', async ({ page }) => {
  visits = [];
  await go(page, '/frontdesk/home-collection');
  await expect(page.getByText(/every home-collection request has an agent/i).locator('visible=true').first()).toBeVisible({ timeout: 45_000 });
  await shots(page, 'empty');
});
