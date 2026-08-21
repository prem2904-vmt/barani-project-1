import { test, expect, request as pwRequest } from '@playwright/test';

/**
 * BRANCH-SCOPED DATA ISOLATION (P3).
 *
 * The genuinely-untested isolation boundary — cross-TENANT is already covered by
 * the mw IDOR net — is that the branch-scoped QUEUE endpoints hard-filter by the
 * caller's pinned branch (OrderRepository: `o.BranchId == user.BranchId`),
 * independent of the tenant's BranchIsolationEnabled flag. A user pinned to one
 * branch must not see another branch's orders.
 *
 * Fixture (apps/lms-e2e/scripts/branch-scope-fixture.mjs, run once): two
 * Lab-Admin users pinned one-per-branch — branchauser → the tenant's first
 * branch, branchbuser → a fresh "E2E Branch B". Neither of those branches holds
 * the demo order data (which lives in the seed/admin branch), so this proves
 * isolation with EXISTING data and no fragile UI seeding: the seed branch's
 * orders are invisible to users pinned to other branches. If scoping were
 * tenant-wide, the branch-pinned users would see the same large order set the
 * admin does.
 *
 * Verified at /api/orders/today — the exact endpoint the order queues render
 * from. Patients and audit are tenant-wide by design (PatientRepository /
 * AuditController); this file deliberately does NOT assert branch isolation on
 * those.
 */

const ORG = 'Micro World';
const PASSWORD = 'E2ePass1234';
const ADMIN = { username: 'labadmin@apollo.prefrontal', password: 'LabAdmin@123' };
const API = 'http://localhost:5270';

test.describe.configure({ mode: 'serial' });

async function apiToken(username: string, password: string): Promise<string> {
  const ctx = await pwRequest.newContext();
  const r = await ctx.post(`${API}/api/auth/login`, { data: { org: ORG, username, password } });
  const j = await r.json();
  await ctx.dispose();
  return (j?.data ?? j)?.accessToken ?? '';
}

async function ordersToday(token: string): Promise<Array<{ id?: string }>> {
  const ctx = await pwRequest.newContext();
  const r = await ctx.get(`${API}/api/orders/today`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  await ctx.dispose();
  const d = (j?.data ?? j) as unknown;
  return Array.isArray(d) ? (d as Array<{ id?: string }>) : [];
}

let adminOrders: Array<{ id?: string }> = [];
let adminToken = '';

test.beforeAll(async () => {
  adminToken = await apiToken(ADMIN.username, ADMIN.password);
  expect(adminToken, 'admin login').toBeTruthy();
  adminOrders = await ordersToday(adminToken);
});

test("admin's branch has a non-empty today queue (baseline for the isolation check)", async () => {
  expect(adminOrders.length, "admin's own branch should have demo orders today").toBeGreaterThan(0);
});

test('branch-B-pinned user sees NONE of the admin-branch orders (branch-scoped queue)', async () => {
  const token = await apiToken('branchbuser', PASSWORD);
  expect(token, 'branchbuser login').toBeTruthy();
  const mine = await ordersToday(token);
  const adminIds = new Set(adminOrders.map((o) => o.id));
  const leaked = mine.filter((o) => adminIds.has(o.id));
  expect(leaked, `branch B must not see any of the admin branch's ${adminOrders.length} orders`).toEqual([]);
});

test('branch-A-pinned user sees NONE of the admin-branch orders (branch-scoped queue)', async () => {
  const token = await apiToken('branchauser', PASSWORD);
  expect(token, 'branchauser login').toBeTruthy();
  const mine = await ordersToday(token);
  const adminIds = new Set(adminOrders.map((o) => o.id));
  const leaked = mine.filter((o) => adminIds.has(o.id));
  expect(leaked, `branch A must not see any of the admin branch's ${adminOrders.length} orders`).toEqual([]);
});
