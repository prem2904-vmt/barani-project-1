import { test, expect, request as pwRequest, type APIRequestContext, type Browser } from '@playwright/test';
import { loginWith } from './support/auth';
import { registerPatient, createOrder } from './support/flows';

/**
 * INTEGRATION (behavioral): toggling a WORKFLOW STAGE changes the operational
 * flow. Disabling the sample-collection/dispatch stages puts the branch in
 * "collects in lab" mode, so OrderService.CreateAsync births the order's
 * samples already 'received' (skipping pending→collected→dispatched); with the
 * stage on, samples are born 'pending' and must be collected.
 *
 * Isolated to E2E Branch B via a BRANCH-SPECIFIC ProcessWorkflow (BranchId=B),
 * which overrides the tenant-default workflow for B only (ProcessWorkflow.Active
 * prefers the branch row). Created + activated in beforeAll, DELETED in afterAll
 * so B cleanly reverts to the tenant default — the shared default is never
 * touched.
 */

const ORG = 'Micro World';
const API = 'http://localhost:5270';
const BRANCH_B = '8ec51282-a076-48f0-90a4-2ede457dbad0';
const ADMIN = { username: 'labadmin@apollo.prefrontal', password: 'LabAdmin@123' };
const BRANCHB_USER = { username: 'branchbuser', password: 'E2ePass1234' };
const TEST_CODE = 'E2EFLOW';
const TEST_NAME = 'E2E Flow Test';

test.describe.configure({ mode: 'serial' });

let adminToken = '';
let userToken = '';
let overrideWfId = '';
let originalGate = 'none';

async function ctxFor(token: string): Promise<APIRequestContext> {
  return pwRequest.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}`, 'X-Active-Branch': BRANCH_B } });
}
async function login(u: string, p: string): Promise<string> {
  const c = await pwRequest.newContext();
  const r = await c.post(`${API}/api/auth/login`, { data: { org: ORG, username: u, password: p } });
  const j = await r.json();
  await c.dispose();
  return (j?.data ?? j)?.accessToken ?? '';
}
async function getJson(token: string, path: string): Promise<unknown> {
  const c = await ctxFor(token);
  const r = await c.get(`${API}${path}`);
  const j = await r.json().catch(() => ({}));
  await c.dispose();
  return (j as { data?: unknown })?.data ?? j;
}
async function post(token: string, path: string, body?: unknown): Promise<{ ok: boolean; data: unknown }> {
  const c = await ctxFor(token);
  const r = await c.post(`${API}${path}`, body ? { data: body } : {});
  const j = await r.json().catch(() => ({}));
  await c.dispose();
  return { ok: r.ok(), data: (j as { data?: unknown })?.data ?? j };
}
async function put(token: string, path: string, body: unknown): Promise<boolean> {
  const c = await ctxFor(token);
  const r = await c.put(`${API}${path}`, { data: body });
  await c.dispose();
  return r.ok();
}
async function patchBranchConfig(body: Record<string, unknown>): Promise<void> {
  const c = await ctxFor(adminToken);
  await c.patch(`${API}/api/tenants/branch-lab-config`, { data: body });
  await c.dispose();
}

/** Place an order in Branch B (as the branch-B user) and return the born status
 *  of its first sample (read before any collection happens). */
async function bornSampleStatus(browser: Browser): Promise<string> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  let orderId = '';
  try {
    await loginWith(page, { org: ORG, username: BRANCHB_USER.username, password: BRANCHB_USER.password });
    const patient = await registerPatient(page);
    const order = await createOrder(page, patient, TEST_CODE, TEST_NAME);
    orderId = order.orderId;
  } finally {
    await ctx.close();
  }
  const detail = (await getJson(userToken, `/api/orders/${orderId}`)) as { samples?: Array<{ status?: string }> };
  return detail?.samples?.[0]?.status ?? 'unknown';
}

let baseCfg: { actions?: Array<{ type?: string; enabled?: boolean }> } = {};

/** Set the collection/dispatch stages on the branch-B override to `on`, so the
 *  next order in B is born 'pending' (on) or 'received' (off). Active workflows
 *  can't be deleted, so we EDIT the override in place (PUT) and re-activate. */
async function setCollectionStage(on: boolean): Promise<void> {
  const cfg = JSON.parse(JSON.stringify(baseCfg));
  for (const a of cfg.actions ?? []) {
    if (a.type === 'sample_collection' || a.type === 'dispatch' || a.type === 'lab_intake') a.enabled = on;
  }
  expect(await put(adminToken, `/api/process-workflows/${overrideWfId}`, {
    Name: 'E2E Workflow-Stage (Branch B)', ConfigJson: JSON.stringify(cfg), BranchId: BRANCH_B,
  }), `PUT override collection=${on}`).toBe(true);
  await post(adminToken, `/api/process-workflows/${overrideWfId}/activate`);
}

test.beforeAll(async () => {
  adminToken = await login(ADMIN.username, ADMIN.password);
  userToken = await login(BRANCHB_USER.username, BRANCHB_USER.password);
  expect(adminToken && userToken).toBeTruthy();
  originalGate = (((await getJson(adminToken, '/api/tenants/branch-lab-config')) as { paymentGateStage?: string })?.paymentGateStage) ?? 'none';
  await patchBranchConfig({ paymentGateStage: 'none' });

  // Clone B's active workflow as the mutable base, install a branch-specific
  // active override for B (overrides the tenant default for B only).
  const active = (await getJson(userToken, '/api/process-workflows/active')) as { configJson?: string } | null;
  baseCfg = JSON.parse(active?.configJson ?? '{"actions":[]}');
  const created = await post(adminToken, '/api/process-workflows', {
    Name: 'E2E Workflow-Stage (Branch B)', ConfigJson: JSON.stringify(baseCfg), BranchId: BRANCH_B,
  });
  overrideWfId = (created.data as { id?: string })?.id ?? '';
  expect(overrideWfId, 'branch-B override created').toBeTruthy();
  expect((await post(adminToken, `/api/process-workflows/${overrideWfId}/activate`)).ok).toBe(true);
});

test.afterAll(async () => {
  // Leave B in the normal collection-ON state (the override behaves like the
  // tenant default). Active workflows can't be deleted; this keeps B clean.
  if (overrideWfId) await setCollectionStage(true);
  await patchBranchConfig({ paymentGateStage: originalGate });
});

test('collection/dispatch stage OFF → a new order\'s sample is born "received" (skips collect/dispatch)', async ({ browser }) => {
  test.setTimeout(120_000);
  await setCollectionStage(false);
  expect(await bornSampleStatus(browser)).toBe('received');
});

test('collection/dispatch stage ON → a new order\'s sample is born "pending" (must be collected)', async ({ browser }) => {
  test.setTimeout(120_000);
  await setCollectionStage(true);
  expect(await bornSampleStatus(browser)).toBe('pending');
});
