// Create fresh tenant users for the untested roles + verify each can log in.
// API base = local mw. Envelope: HTTP 200 even on logical failure; data holds payload.
const BASE = 'http://localhost:5270';
const ORG = 'Micro World';
const ADMIN = { username: 'labadmin@apollo.prefrontal', password: 'LabAdmin@123' };
const PASSWORD = 'E2ePass1234';

// role display name -> desired login username (alphanumeric, 3-32)
const WANT = [
  { role: 'Receptionist',        username: 'recepe2e',     first: 'E2E Receptionist' },
  { role: 'Billing Counter',     username: 'billinge2e',   first: 'E2E Billing' },
  { role: 'Home Collection Agent', username: 'homecolle2e', first: 'E2E HomeCollect' },
  { role: 'Store Keeper',        username: 'storekpre2e',  first: 'E2E StoreKeeper' },
  { role: 'Inventory Manager',   username: 'invmgre2e',    first: 'E2E InvManager' },
];

async function post(path, body, token) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}
async function get(path, token) {
  const r = await fetch(BASE + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}
const data = (j) => (j && j.data !== undefined ? j.data : j);

async function login(username, password) {
  const { j } = await post('/api/auth/login', { org: ORG, username, password });
  const d = data(j);
  return d && d.accessToken ? d.accessToken : null;
}

(async () => {
  const token = await login(ADMIN.username, ADMIN.password);
  if (!token) { console.log('ADMIN LOGIN FAILED'); process.exit(1); }
  console.log('admin login OK');

  const rolesResp = await get('/api/roles', token);
  const roles = data(rolesResp.j) || [];
  const byName = {};
  for (const r of roles) byName[r.name] = r.id;
  console.log('roles available:', Object.keys(byName).join(', '));

  const results = [];
  for (const w of WANT) {
    const roleId = byName[w.role];
    if (!roleId) { results.push({ ...w, created: false, reason: 'role name not found' }); continue; }
    const { j } = await post('/api/users', {
      username: w.username, password: PASSWORD, firstName: w.first, roleIds: [roleId],
    }, token);
    const d = data(j) || {};
    const code = j.code || j.error || (d && d.code);
    const created = !!d.id;
    const already = code && /exist/i.test(String(code));
    // verify login
    const tok = await login(w.username, PASSWORD);
    results.push({
      role: w.role, username: w.username, created, already: !!already,
      code: code || null, loginOK: !!tok,
    });
  }
  console.log('\n=== RESULTS ===');
  for (const r of results) console.log(JSON.stringify(r));
  const allLogin = results.every((r) => r.loginOK);
  console.log('\nALL_ROLES_LOGIN_OK=', allLogin);
})();
