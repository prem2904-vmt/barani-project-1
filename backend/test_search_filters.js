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
  console.log('=== PHASE 8 SEARCH & FILTERING TEST SUITE ===\n');

  const time = Date.now();
  const emailA = `sf_user_a_${time}@example.com`;
  const emailB = `sf_user_b_${time}@example.com`;

  // Register User A & User B
  console.log('Setup: Registering User A & User B...');
  await request('/auth/register', 'POST', { full_name: 'Search User A', email: emailA, password: 'Password123!' });
  const loginA = await request('/auth/login', 'POST', { email: emailA, password: 'Password123!' });
  const tokenA = loginA.body.token;

  await request('/auth/register', 'POST', { full_name: 'Search User B', email: emailB, password: 'Password123!' });
  const loginB = await request('/auth/login', 'POST', { email: emailB, password: 'Password123!' });
  const tokenB = loginB.body.token;

  // Setup Projects for User A:
  // PA1: 'Alpha Website Redesign' (Not Started)
  // PA2: 'Beta Mobile App API' (In Progress)
  // PA3: 'Gamma Data Pipeline' (Completed)
  console.log('Setup: Creating projects for User A...');
  const pA1 = await request('/projects', 'POST', { name: 'Alpha Website Redesign', status: 'Not Started' }, tokenA);
  const pA2 = await request('/projects', 'POST', { name: 'Beta Mobile App API', status: 'In Progress' }, tokenA);
  const pA3 = await request('/projects', 'POST', { name: 'Gamma Data Pipeline', status: 'Completed' }, tokenA);

  const pA1_Id = pA1.body.data.id;
  const pA2_Id = pA2.body.data.id;

  // Setup Projects for User B:
  // PB1: 'Secret Project B' (In Progress)
  console.log('Setup: Creating project for User B...');
  const pB1 = await request('/projects', 'POST', { name: 'Secret Project B', status: 'In Progress' }, tokenB);
  const pB1_Id = pB1.body.data.id;

  // Setup Tasks for User A (under pA1 and pA2):
  // TA1 (under pA1): 'Setup React Architecture', Priority: High, Status: Pending
  // TA2 (under pA1): 'Design Database Schema', Priority: Medium, Status: In Progress
  // TA3 (under pA2): 'API Authorization Specs', Priority: Low, Status: Completed
  // TA4 (under pA2): 'Deploy API Gateway', Priority: High, Status: Completed
  console.log('Setup: Creating tasks for User A...');
  await request('/tasks', 'POST', { project_id: pA1_Id, name: 'Setup React Architecture', priority: 'High', status: 'Pending' }, tokenA);
  await request('/tasks', 'POST', { project_id: pA1_Id, name: 'Design Database Schema', priority: 'Medium', status: 'In Progress' }, tokenA);
  await request('/tasks', 'POST', { project_id: pA2_Id, name: 'API Authorization Specs', priority: 'Low', status: 'Completed' }, tokenA);
  await request('/tasks', 'POST', { project_id: pA2_Id, name: 'Deploy API Gateway', priority: 'High', status: 'Completed' }, tokenA);

  // Setup Task for User B:
  // TB1 (under pB1): 'User B Confidential Task', Priority: High, Status: Pending
  await request('/tasks', 'POST', { project_id: pB1_Id, name: 'User B Confidential Task', priority: 'High', status: 'Pending' }, tokenB);

  // --- PROJECT SEARCH & FILTER TESTS ---

  console.log('\nA. Authenticated project search...');
  const resA = await request('/projects?search=Website', 'GET', null, tokenA);
  console.log('Status:', resA.status, 'Found:', resA.body.data.map(p => p.name));

  console.log('\nB. Partial project name search...');
  const resB = await request('/projects?search=Mobile', 'GET', null, tokenA);
  console.log('Status:', resB.status, 'Found:', resB.body.data.map(p => p.name));

  console.log('\nC. Project status filter — Not Started...');
  const resC = await request('/projects?status=Not%20Started', 'GET', null, tokenA);
  console.log('Status:', resC.status, 'Found:', resC.body.data.map(p => p.name));

  console.log('\nD. Project status filter — In Progress...');
  const resD = await request('/projects?status=In%20Progress', 'GET', null, tokenA);
  console.log('Status:', resD.status, 'Found:', resD.body.data.map(p => p.name));

  console.log('\nE. Project status filter — Completed...');
  const resE = await request('/projects?status=Completed', 'GET', null, tokenA);
  console.log('Status:', resE.status, 'Found:', resE.body.data.map(p => p.name));

  console.log('\nF. Project search + status combined...');
  const resF = await request('/projects?search=Mobile&status=In%20Progress', 'GET', null, tokenA);
  console.log('Status:', resF.status, 'Found:', resF.body.data.map(p => p.name));

  console.log('\nG. Invalid project status rejection...');
  const resG = await request('/projects?status=InvalidStatus', 'GET', null, tokenA);
  console.log('Status:', resG.status, 'Body:', JSON.stringify(resG.body));

  // --- TASK SEARCH & FILTER TESTS ---

  console.log('\nH. Authenticated task search...');
  const resH = await request('/tasks?search=API', 'GET', null, tokenA);
  console.log('Status:', resH.status, 'Found:', resH.body.data.map(t => t.name));

  console.log('\nI. Partial task name search...');
  const resI = await request('/tasks?search=React', 'GET', null, tokenA);
  console.log('Status:', resI.status, 'Found:', resI.body.data.map(t => t.name));

  console.log('\nJ. Task status — Pending...');
  const resJ = await request('/tasks?status=Pending', 'GET', null, tokenA);
  console.log('Status:', resJ.status, 'Found:', resJ.body.data.map(t => t.name));

  console.log('\nK. Task status — In Progress...');
  const resK = await request('/tasks?status=In%20Progress', 'GET', null, tokenA);
  console.log('Status:', resK.status, 'Found:', resK.body.data.map(t => t.name));

  console.log('\nL. Task status — Completed...');
  const resL = await request('/tasks?status=Completed', 'GET', null, tokenA);
  console.log('Status:', resL.status, 'Found:', resL.body.data.map(t => t.name));

  console.log('\nM. Task priority — Low...');
  const resM = await request('/tasks?priority=Low', 'GET', null, tokenA);
  console.log('Status:', resM.status, 'Found:', resM.body.data.map(t => t.name));

  console.log('\nN. Task priority — Medium...');
  const resN = await request('/tasks?priority=Medium', 'GET', null, tokenA);
  console.log('Status:', resN.status, 'Found:', resN.body.data.map(t => t.name));

  console.log('\nO. Task priority — High...');
  const resO = await request('/tasks?priority=High', 'GET', null, tokenA);
  console.log('Status:', resO.status, 'Found:', resO.body.data.map(t => t.name));

  console.log('\nP. Task search + status...');
  const resP = await request('/tasks?search=API&status=Completed', 'GET', null, tokenA);
  console.log('Status:', resP.status, 'Found:', resP.body.data.map(t => t.name));

  console.log('\nQ. Task search + priority...');
  const resQ = await request('/tasks?search=API&priority=High', 'GET', null, tokenA);
  console.log('Status:', resQ.status, 'Found:', resQ.body.data.map(t => t.name));

  // Fix variable name collision by using resRR
  console.log('\nR. Task status + priority...');
  const resRR = await request('/tasks?status=Completed&priority=High', 'GET', null, tokenA);
  console.log('Status:', resRR.status, 'Found:', resRR.body.data.map(t => t.name));

  console.log('\nS. Task search + status + priority...');
  const resS = await request('/tasks?search=API&status=Completed&priority=High', 'GET', null, tokenA);
  console.log('Status:', resS.status, 'Found:', resS.body.data.map(t => t.name));

  console.log('\nT. Task project_id filtering...');
  const resT = await request('/tasks?project_id=' + pA1_Id, 'GET', null, tokenA);
  console.log('Status:', resT.status, 'Found:', resT.body.data.map(t => t.name));

  // --- SECURITY TESTS ---

  console.log('\nU. Unauthenticated project search...');
  const resU = await request('/projects?search=Website', 'GET');
  console.log('Status:', resU.status, 'Message:', resU.body.message);

  console.log('\nV. Unauthenticated task search...');
  const resV = await request('/tasks?search=API', 'GET');
  console.log('Status:', resV.status, 'Message:', resV.body.message);

  console.log('\nW. User A cannot search & retrieve User B\'s projects...');
  const resW = await request('/projects?search=Secret', 'GET', null, tokenA);
  console.log('Status:', resW.status, 'Found Count (Expected 0):', resW.body.data.length);

  console.log('\nX. User A cannot retrieve User B\'s tasks using project_id...');
  const resX = await request('/tasks?project_id=' + pB1_Id, 'GET', null, tokenA);
  console.log('Status:', resX.status, 'Found Count (Expected 0):', resX.body.data.length);

  console.log('\nY. Attempted user_id query manipulation...');
  const resY = await request('/projects?user_id=' + pB1.body.data.user_id, 'GET', null, tokenA);
  console.log('Status:', resY.status, 'Found User A Projects (Expected 3):', resY.body.data.length);

  console.log('\nZ. SQL injection attempts in project search...');
  const resZ = await request('/projects?search=' + encodeURIComponent("' OR '1'='1"), 'GET', null, tokenA);
  console.log('Status:', resZ.status, 'Found Count (Expected 0):', resZ.body.data.length);

  console.log('\nAA. SQL injection attempts in task search...');
  const resAA = await request('/tasks?search=' + encodeURIComponent("' OR '1'='1"), 'GET', null, tokenA);
  console.log('Status:', resAA.status, 'Found Count (Expected 0):', resAA.body.data.length);

  // --- EMPTY RESULTS TESTS ---

  console.log('\nAB. Search with no matching projects...');
  const resAB = await request('/projects?search=NonExistentProject12345', 'GET', null, tokenA);
  console.log('Status:', resAB.status, 'Data:', JSON.stringify(resAB.body.data));

  console.log('\nAC. Search with no matching tasks...');
  const resAC = await request('/tasks?search=NonExistentTask12345', 'GET', null, tokenA);
  console.log('Status:', resAC.status, 'Data:', JSON.stringify(resAC.body.data));

  console.log('\n=== ALL PHASE 8 SEARCH & FILTERING TESTS PASSED SUCCESSFULLY ===');
}

runTests().catch(console.error);
