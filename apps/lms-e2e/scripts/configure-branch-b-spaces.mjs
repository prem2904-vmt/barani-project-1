// Extend E2E Branch B for the spaces vial-merge test: a 2nd department + test
// sharing the SAME tube colour (red) as E2EFLOW, plus two lab spaces, and set
// LabStructure='auto' so space assignment drives vial grouping. Idempotent.
const BASE = 'http://localhost:5270';
const ORG = 'Micro World';
const ADMIN = { username: 'labadmin@apollo.prefrontal', password: 'LabAdmin@123' };
const BRANCH_B_CODE = 'E2E-B';
const DEPT2 = { Name: 'E2E Flow Dept 2', Code: 'E2EFD2', ContainerColor: 'red', ContainerLabel: 'E2E2' };
const TEST2 = {
  Name: 'E2E Flow Test 2', Type: 'individual', Flow: 'direct',
  Price: 100, TaxSlab: 0, TatHours: 24, TestCode: 'E2EFLOW2',
  SampleType: 'Serum', TubeColor: 'red', ResultType: 'numeric', Unit: 'U/L',
  ParametersJson: JSON.stringify([{ name: 'value', label: 'Value', type: 'numeric', unit: 'U/L' }]),
};
const SPACES = [{ Name: 'E2E Space 1', Code: 'E2ESP1' }, { Name: 'E2E Space 2', Code: 'E2ESP2' }];

const data = (j) => (j && j.data !== undefined ? j.data : j);
async function login(u, p) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org: ORG, username: u, password: p }) });
  return data(await r.json())?.accessToken ?? '';
}
async function api(method, path, token, branch, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(branch ? { 'X-Active-Branch': branch } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}

(async () => {
  const token = await login(ADMIN.username, ADMIN.password);
  const branches = data((await api('GET', '/api/tenants/branches', token)).j) || [];
  const B = branches.find((b) => b.code === BRANCH_B_CODE)?.id;
  if (!B) { console.log('Branch B missing'); process.exit(1); }

  // dept1 (existing) + test1 (existing).
  const depts = () => api('GET', '/api/tenants/departments', token, B).then((r) => data(r.j) || []);
  let ds = await depts();
  const dept1 = ds.find((d) => d.code === 'E2EFD');
  let dept2 = ds.find((d) => d.code === DEPT2.Code);
  if (!dept2) { await api('POST', '/api/tenants/departments', token, B, { ...DEPT2, BranchId: B }); ds = await depts(); dept2 = ds.find((d) => d.code === DEPT2.Code); }

  const tests = () => api('GET', '/api/tests/?activeOnly=true', token, B).then((r) => data(r.j) || []);
  let ts = await tests();
  const test1 = ts.find((t) => t.testCode === 'E2EFLOW');
  let test2 = ts.find((t) => t.testCode === TEST2.TestCode);
  if (!test2) { await api('POST', '/api/tests', token, B, { ...TEST2, DepartmentId: dept2.id }); ts = await tests(); test2 = ts.find((t) => t.testCode === TEST2.TestCode); }

  // Two lab spaces (idempotent by code).
  const listSpaces = () => api('GET', '/api/tenants/lab-spaces', token, B).then((r) => data(r.j) || []);
  let sp = await listSpaces();
  for (const s of SPACES) {
    if (!sp.find((x) => x.code === s.Code)) { await api('POST', '/api/tenants/lab-spaces', token, B, { ...s, BranchId: B }); }
  }
  sp = await listSpaces();
  const space1 = sp.find((x) => x.code === 'E2ESP1');
  const space2 = sp.find((x) => x.code === 'E2ESP2');

  // Auto lab structure so spaces drive vial grouping.
  await api('PATCH', '/api/tenants/branch-lab-config', token, B, { labStructure: 'auto' });

  console.log('=== SPACES FIXTURE ===');
  console.log('BRANCH_B_ID=' + B);
  console.log('DEPT1_ID=' + dept1?.id + ' DEPT2_ID=' + dept2?.id);
  console.log('TEST1_ID=' + test1?.id + ' TEST2_ID=' + test2?.id);
  console.log('SPACE1_ID=' + space1?.id + ' SPACE2_ID=' + space2?.id);
  console.log('ok =', !!(dept1 && dept2 && test1 && test2 && space1 && space2));
})();
