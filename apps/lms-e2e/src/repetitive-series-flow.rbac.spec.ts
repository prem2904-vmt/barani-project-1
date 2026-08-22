import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';

/**
 * INTEGRATION (behavioral): the TIME-DEPENDENT / repetitive-series feature
 * (OGTT-style: one test drawn at timed offsets). A profile whose Parameters is
 * { repetitive:true, items:[{testId,offsetMin}...] } expands at order time into
 * ONE tube per distinct time point (OrderService), each stamped repeatOffsetMin
 * + a shared repeatProfileTestId. Verified by API-observable facts only (no
 * wall-clock waits — offsets are real minutes but every assertion here is
 * immediate): expansion, per-tube collect, close-collection → missed, 409 guard.
 *
 * Isolated on E2E Branch B. The profile E2EOGTT draws E2EFLOW at offsets 0/1/2.
 */

const ORG = 'Micro World';
const API = 'http://localhost:5270';
const B = '8ec51282-a076-48f0-90a4-2ede457dbad0';
const DEPT1 = '07871286-9056-4983-8e24-2b21b17054e8';
const TEST1 = 'be12e4e4-4dfb-4e0a-ab7f-9a2d0beee7a9';
const ADMIN = { username: 'labadmin@apollo.prefrontal', password: 'LabAdmin@123' };

test.describe.configure({ mode: 'serial' });

let token = '';
let profileId = '';
let seriesOrderId = '';

async function ctx(): Promise<APIRequestContext> {
  return pwRequest.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}`, 'X-Active-Branch': B } });
}
const unwrap = (j: unknown) => (j as { data?: unknown })?.data ?? j;

async function req(method: 'get' | 'post' | 'patch', path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  const c = await ctx();
  const r = await c[method](`${API}${path}`, body !== undefined ? { data: body } : {});
  const j = await r.json().catch(() => ({}));
  await c.dispose();
  return { status: r.status(), data: unwrap(j) };
}
async function orderSamples(orderId: string): Promise<Array<{ id: string; repeatOffsetMin: number; repeatProfileTestId?: string; status: string }>> {
  const d = (await req('get', `/api/orders/${orderId}`)).data as { samples?: Array<{ id: string; repeatOffsetMin: number; repeatProfileTestId?: string; status: string }> };
  return d?.samples ?? [];
}
async function newPatient(): Promise<string> {
  const p = (await req('post', '/api/patients', { FirstName: 'Series', FathersName: 'E2E', Phone: '9' + Date.now().toString().slice(-9), Sex: 'male', DateOfBirth: '1990-01-01' })).data as { id?: string };
  return p?.id ?? '';
}
async function placeOrder(testIds: string[]): Promise<string> {
  const pid = await newPatient();
  const o = (await req('post', '/api/orders', { PatientId: pid, Priority: 'routine', Source: 'walkin', CollectionType: 'lab', TestIds: testIds })).data as { id?: string };
  return o?.id ?? '';
}

test.beforeAll(async () => {
  const lc = await pwRequest.newContext();
  const lr = await lc.post(`${API}/api/auth/login`, { data: { org: ORG, username: ADMIN.username, password: ADMIN.password } });
  token = (unwrap(await lr.json()) as { accessToken?: string })?.accessToken ?? '';
  await lc.dispose();
  expect(token).toBeTruthy();
  await req('patch', '/api/tenants/branch-lab-config', { paymentGateStage: 'none' });

  // Ensure the OGTT repetitive profile exists (E2EFLOW drawn at 0/1/2 min).
  const tests = (await req('get', '/api/tests/?activeOnly=true')).data as Array<{ id: string; testCode: string }>;
  profileId = tests.find((t) => t.testCode === 'E2EOGTT')?.id ?? '';
  if (!profileId) {
    const created = (await req('post', '/api/tests', {
      Name: 'E2E OGTT Series', Type: 'profile', Flow: 'direct', TestCode: 'E2EOGTT',
      DepartmentId: DEPT1, Price: 100, TaxSlab: 0, TatHours: 24, SampleType: 'Serum',
      ParametersJson: JSON.stringify({ repetitive: true, items: [{ testId: TEST1, offsetMin: 0 }, { testId: TEST1, offsetMin: 1 }, { testId: TEST1, offsetMin: 2 }] }),
    })).data as { id?: string };
    profileId = created?.id ?? '';
  }
  expect(profileId, 'repetitive profile E2EOGTT').toBeTruthy();
  seriesOrderId = await placeOrder([profileId]);
  expect(seriesOrderId, 'series order placed').toBeTruthy();
});

test('a repetitive profile expands into one tube per timed point (offsets 0/1/2, one series id)', async () => {
  const s = await orderSamples(seriesOrderId);
  expect(s.length, '3 timed tubes').toBe(3);
  expect(s.map((x) => x.repeatOffsetMin).sort((a, b) => a - b)).toEqual([0, 1, 2]);
  expect(new Set(s.map((x) => x.repeatProfileTestId)).size, 'all share one series id').toBe(1);
});

test('collecting the anchor (offset 0) collects only that tube; later points stay pending', async () => {
  const s = await orderSamples(seriesOrderId);
  const anchor = s.find((x) => x.repeatOffsetMin === 0)!;
  expect((await req('patch', `/api/samples/${anchor.id}/collect`, {})).status).toBe(200);
  const after = await orderSamples(seriesOrderId);
  const byOffset = Object.fromEntries(after.map((x) => [x.repeatOffsetMin, x.status]));
  expect(byOffset[0]).toBe('collected');
  expect(byOffset[1]).toBe('pending');
  expect(byOffset[2]).toBe('pending');
});

test('close-collection marks every uncollected timed point "missed" (anchor kept)', async () => {
  const res = await req('patch', `/api/orders/${seriesOrderId}/close-collection`, {});
  expect(res.status).toBe(200);
  expect((res.data as { missed?: number })?.missed).toBe(2);
  const byOffset = Object.fromEntries((await orderSamples(seriesOrderId)).map((x) => [x.repeatOffsetMin, x.status]));
  expect(byOffset[0]).toBe('collected');
  expect(byOffset[1]).toBe('missed');
  expect(byOffset[2]).toBe('missed');
});

test('close-collection is refused (409) on a non-series order', async () => {
  const nonSeriesOrder = await placeOrder([TEST1]);
  const res = await req('patch', `/api/orders/${nonSeriesOrder}/close-collection`, {});
  expect(res.status).toBe(409);
});
