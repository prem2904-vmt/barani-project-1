import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';

/**
 * INTEGRATION (behavioral): SPACES drive vial grouping. Under LabStructure=
 * 'auto', two departments that share the SAME tube colour merge into ONE vial
 * when placed in the SAME lab space, and split into TWO vials when in DIFFERENT
 * spaces (OrderService groups by (SpaceKey, ColourKey)). This is the real,
 * narrow "spaces → tubes" effect — spaces change vial COUNT/merge, never the
 * tube colour itself (that's the test/department; see tube-derivation-flow).
 *
 * On E2E Branch B: two red-tube departments (E2EFD/E2EFD2) each with a red test
 * (E2EFLOW/E2EFLOW2), two lab spaces, LabStructure='auto' (fixture:
 * scripts/configure-branch-b-spaces.mjs). Ordered together via the API; the
 * order's sample count is the vial count.
 */

const ORG = 'Micro World';
const API = 'http://localhost:5270';
const B = '8ec51282-a076-48f0-90a4-2ede457dbad0';
const DEPT1 = '07871286-9056-4983-8e24-2b21b17054e8';
const DEPT2 = '895defcc-ab91-424b-bc8d-8ce305e22913';
const TEST1 = 'be12e4e4-4dfb-4e0a-ab7f-9a2d0beee7a9';
const TEST2 = 'd9f297ea-4ece-42e0-a5b1-2ce671d8af3c';
const SPACE1 = '953aa465-5eb9-43a9-aacf-bee7086eb3cf';
const SPACE2 = 'e56bb5db-c8ed-46fd-9566-28bb713748eb';
const ADMIN = { username: 'labadmin@apollo.prefrontal', password: 'LabAdmin@123' };

test.describe.configure({ mode: 'serial' });

let token = '';

async function ctx(): Promise<APIRequestContext> {
  return pwRequest.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}`, 'X-Active-Branch': B } });
}
const unwrap = (j: unknown) => (j as { data?: unknown })?.data ?? j;

async function linkDeptSpace(deptId: string, spaceId: string): Promise<void> {
  const c = await ctx();
  await c.patch(`${API}/api/tenants/departments/${deptId}/space`, { data: { SpaceId: spaceId, BranchId: B } });
  await c.dispose();
}
/** Register a NEW patient (unique phone so we never hit the duplicate path),
 *  order BOTH red tests together, return the vial (sample) count. */
async function vialCount(): Promise<number> {
  const c = await ctx();
  const phone = '9' + Date.now().toString().slice(-9);
  const pr = await c.post(`${API}/api/patients`, { data: { FirstName: 'Vial', FathersName: 'Merge', Phone: phone, Sex: 'male', DateOfBirth: '1990-01-01' } });
  const pid = (unwrap(await pr.json().catch(() => ({}))) as { id?: string })?.id;
  expect(pid, 'patient registered').toBeTruthy();
  const or = await c.post(`${API}/api/orders`, { data: { PatientId: pid, Priority: 'routine', Source: 'walkin', CollectionType: 'lab', TestIds: [TEST1, TEST2] } });
  const oid = (unwrap(await or.json().catch(() => ({}))) as { id?: string })?.id;
  expect(oid, 'order created').toBeTruthy();
  const detail = unwrap(await (await c.get(`${API}/api/orders/${oid}`)).json().catch(() => ({}))) as { samples?: unknown[] };
  await c.dispose();
  return detail?.samples?.length ?? -1;
}

test.beforeAll(async () => {
  const lc = await pwRequest.newContext();
  const lr = await lc.post(`${API}/api/auth/login`, { data: { org: ORG, username: ADMIN.username, password: ADMIN.password } });
  token = (unwrap(await lr.json()) as { accessToken?: string })?.accessToken ?? '';
  await lc.dispose();
  expect(token).toBeTruthy();
  const c = await ctx();
  await c.patch(`${API}/api/tenants/branch-lab-config`, { data: { labStructure: 'auto', paymentGateStage: 'none' } });
  await c.dispose();
});

test.afterAll(async () => {
  // Leave both departments in the same space (harmless default).
  await linkDeptSpace(DEPT1, SPACE1);
  await linkDeptSpace(DEPT2, SPACE1);
});

test('same space → two same-colour tests MERGE into one vial', async () => {
  await linkDeptSpace(DEPT1, SPACE1);
  await linkDeptSpace(DEPT2, SPACE1);
  expect(await vialCount(), 'same colour + same space → 1 merged vial').toBe(1);
});

test('different spaces → the same two tests SPLIT into two vials', async () => {
  await linkDeptSpace(DEPT1, SPACE1);
  await linkDeptSpace(DEPT2, SPACE2);
  expect(await vialCount(), 'same colour but different spaces → 2 vials').toBe(2);
});
