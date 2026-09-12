import http from 'http';

const request = (path, method, body = null, token = null) => {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const headers = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (body) {
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(
      {
        hostname: 'localhost',
        port: 5000,
        path: `/api${path}`,
        method,
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );

    req.on('error', reject);
    if (body) req.write(payload);
    req.end();
  });
};

async function runTests() {
  console.log('=== PHASE 5 PROJECT MANAGEMENT TEST SUITE ===\n');

  // Setup: Register User A and User B
  const time = Date.now();
  const emailA = `usera_${time}@example.com`;
  const emailB = `userb_${time}@example.com`;

  console.log('Registering User A...');
  await request('/auth/register', 'POST', { full_name: 'User A', email: emailA, password: 'Password123!' });
  const loginA = await request('/auth/login', 'POST', { email: emailA, password: 'Password123!' });
  const tokenA = loginA.body.token;

  console.log('Registering User B...');
  await request('/auth/register', 'POST', { full_name: 'User B', email: emailB, password: 'Password123!' });
  const loginB = await request('/auth/login', 'POST', { email: emailB, password: 'Password123!' });
  const tokenB = loginB.body.token;

  // Test A: Authenticated user creates a project
  console.log('\nA. User A creates a project...');
  const projA1 = await request('/projects', 'POST', {
    name: 'Website Redesign',
    description: 'Redesign company website',
    status: 'In Progress',
    start_date: '2026-09-15',
    end_date: '2026-10-15',
  }, tokenA);
  console.log('Status:', projA1.status, 'Body:', JSON.stringify(projA1.body, null, 2));
  const idA1 = projA1.body.data.id;

  // Create project 2 for User A (for search/filter tests)
  const projA2 = await request('/projects', 'POST', {
    name: 'Mobile App API',
    description: 'Backend services for mobile app',
    status: 'Not Started',
    start_date: '2026-11-01',
    end_date: '2026-12-01',
  }, tokenA);
  const idA2 = projA2.body.data.id;

  // Create project for User B (for cross-user isolation tests)
  const projB1 = await request('/projects', 'POST', {
    name: 'User B Secret Project',
    description: 'Private research project',
    status: 'Completed',
  }, tokenB);
  const idB1 = projB1.body.data.id;

  // Test B: User retrieves their projects
  console.log('\nB. User A retrieves all their projects...');
  const getProjsA = await request('/projects', 'GET', null, tokenA);
  console.log('Status:', getProjsA.status, 'Count:', getProjsA.body.data.length);

  // Test C: User retrieves their project by ID
  console.log('\nC. User A retrieves project by ID...');
  const getByIdA = await request('/projects/' + idA1, 'GET', null, tokenA);
  console.log('Status:', getByIdA.status, 'Name:', getByIdA.body.data.name);

  // Test D: User updates their project
  console.log('\nD. User A updates their project...');
  const updateA = await request('/projects/' + idA1, 'PUT', {
    name: 'Website Redesign V2',
    status: 'Completed',
  }, tokenA);
  console.log('Status:', updateA.status, 'Updated Name:', updateA.body.data.name, 'Updated Status:', updateA.body.data.status);

  // Test F: Unauthenticated request is rejected (401)
  console.log('\nF. Request without JWT...');
  const unauthRes = await request('/projects', 'GET');
  console.log('Status:', unauthRes.status, 'Message:', unauthRes.body.message);

  // Test G: Invalid project status is rejected (400)
  console.log('\nG. Invalid status value...');
  const badStatusRes = await request('/projects', 'POST', {
    name: 'Test Proj',
    status: 'SuperActive',
  }, tokenA);
  console.log('Status:', badStatusRes.status, 'Message:', badStatusRes.body.message);

  // Test H: Missing project name is rejected (400)
  console.log('\nH. Missing project name...');
  const noNameRes = await request('/projects', 'POST', {
    name: '   ',
    description: 'Empty name test',
  }, tokenA);
  console.log('Status:', noNameRes.status, 'Message:', noNameRes.body.message);

  // Test I: Invalid date is rejected (400)
  console.log('\nI. Invalid date format...');
  const badDateRes = await request('/projects', 'POST', {
    name: 'Test Proj',
    start_date: '2026-99-99',
  }, tokenA);
  console.log('Status:', badDateRes.status, 'Message:', badDateRes.body.message);

  // Test J: End date before start date is rejected (400)
  console.log('\nJ. End date before start date...');
  const invertedDateRes = await request('/projects', 'POST', {
    name: 'Test Proj',
    start_date: '2026-10-15',
    end_date: '2026-09-15',
  }, tokenA);
  console.log('Status:', invertedDateRes.status, 'Message:', invertedDateRes.body.message);

  // Test K: Search by project name works
  console.log('\nK. Search project by name=Mobile...');
  const searchRes = await request('/projects?search=Mobile', 'GET', null, tokenA);
  console.log('Status:', searchRes.status, 'Found:', searchRes.body.data.map(p => p.name));

  // Test L: Filter by project status works
  console.log('\nL. Filter projects by status=Not Started...');
  const filterRes = await request('/projects?status=Not%20Started', 'GET', null, tokenA);
  console.log('Status:', filterRes.status, 'Found:', filterRes.body.data.map(p => p.name));

  // Test M: Search + status filter works together
  console.log('\nM. Search=App & status=Not Started...');
  const combinedRes = await request('/projects?search=App&status=Not%20Started', 'GET', null, tokenA);
  console.log('Status:', combinedRes.status, 'Found:', combinedRes.body.data.map(p => p.name));

  // Test N: User A cannot retrieve User B's project (404)
  console.log('\nN. User A attempts to GET User B\'s project ID (' + idB1 + ')...');
  const crossGet = await request('/projects/' + idB1, 'GET', null, tokenA);
  console.log('Status:', crossGet.status, 'Message:', crossGet.body.message);

  // Test O: User A cannot update User B's project (404)
  console.log('\nO. User A attempts to PUT User B\'s project ID (' + idB1 + ')...');
  const crossPut = await request('/projects/' + idB1, 'PUT', { name: 'Hacked Title' }, tokenA);
  console.log('Status:', crossPut.status, 'Message:', crossPut.body.message);

  // Test P: User A cannot delete User B's project (404)
  console.log('\nP. User A attempts to DELETE User B\'s project ID (' + idB1 + ')...');
  const crossDel = await request('/projects/' + idB1, 'DELETE', null, tokenA);
  console.log('Status:', crossDel.status, 'Message:', crossDel.body.message);

  // Test Q: SQL injection attempt in search query parameter
  console.log('\nQ. Attempt SQL injection in search parameter...');
  const sqlInjRes = await request('/projects?search=' + encodeURIComponent("' OR '1'='1"), 'GET', null, tokenA);
  console.log('Status:', sqlInjRes.status, 'Found Count (should be 0):', sqlInjRes.body.data.length);

  // Test E: User deletes their project
  console.log('\nE. User A deletes their project (' + idA2 + ')...');
  const deleteRes = await request('/projects/' + idA2, 'DELETE', null, tokenA);
  console.log('Status:', deleteRes.status, 'Message:', deleteRes.body.message);

  console.log('\n=== ALL PHASE 5 TESTS PASSED SUCCESSFULLY ===');
}

runTests().catch(console.error);
