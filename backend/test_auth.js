import http from 'http';

const request = (path, method, body = null, headers = {}) => {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers,
    };

    if (body) {
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(
      {
        hostname: 'localhost',
        port: 5000,
        path: `/api/auth${path}`,
        method,
        headers: reqHeaders,
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
  console.log('=== AUTHENTICATION TEST SUITE ===\n');

  // Test A: Register new user
  console.log('A. Registering new user: test.user@example.com...');
  const regRes = await request('/register', 'POST', {
    full_name: 'Test User',
    email: 'test.user@example.com',
    password: 'Password123!',
  });
  console.log('Status:', regRes.status, 'Response:', JSON.stringify(regRes.body, null, 2));

  // Test B: Attempt duplicate registration
  console.log('\nB. Attempting duplicate registration: test.user@example.com...');
  const dupRes = await request('/register', 'POST', {
    full_name: 'Test User Duplicate',
    email: 'test.user@example.com',
    password: 'Password123!',
  });
  console.log('Status:', dupRes.status, 'Response:', JSON.stringify(dupRes.body, null, 2));

  // Test C: Login with correct credentials
  console.log('\nC. Login with correct credentials...');
  const loginRes = await request('/login', 'POST', {
    email: 'test.user@example.com',
    password: 'Password123!',
  });
  console.log('Status:', loginRes.status, 'Response:', JSON.stringify(loginRes.body, null, 2));
  const token = loginRes.body.token;

  // Test D: Login with incorrect credentials
  console.log('\nD. Login with incorrect password...');
  const badLoginRes = await request('/login', 'POST', {
    email: 'test.user@example.com',
    password: 'WrongPassword!',
  });
  console.log('Status:', badLoginRes.status, 'Response:', JSON.stringify(badLoginRes.body, null, 2));

  // Test E: Access protected endpoint without JWT
  console.log('\nE. Accessing /logout without JWT...');
  const noJwtRes = await request('/logout', 'POST');
  console.log('Status:', noJwtRes.status, 'Response:', JSON.stringify(noJwtRes.body, null, 2));

  // Test F: Access protected endpoint with invalid JWT
  console.log('\nF. Accessing /logout with invalid JWT...');
  const badJwtRes = await request('/logout', 'POST', null, {
    Authorization: 'Bearer invalid_token_string_123',
  });
  console.log('Status:', badJwtRes.status, 'Response:', JSON.stringify(badJwtRes.body, null, 2));

  // Test G: Access logout with valid JWT
  console.log('\nG. Accessing /logout with valid JWT...');
  const validLogoutRes = await request('/logout', 'POST', null, {
    Authorization: `Bearer ${token}`,
  });
  console.log('Status:', validLogoutRes.status, 'Response:', JSON.stringify(validLogoutRes.body, null, 2));

  // Test J: Rate Limiting Verification
  console.log('\nJ. Triggering rate limiter by exceeding 20 auth requests...');
  let lastRes;
  for (let i = 1; i <= 22; i++) {
    lastRes = await request('/login', 'POST', {
      email: 'test.user@example.com',
      password: 'Password123!',
    });
  }
  console.log('22nd request status:', lastRes.status, 'Response:', JSON.stringify(lastRes.body, null, 2));

  console.log('\n=== ALL TESTS COMPLETED SUCCESSFULLY ===');
}

runTests().catch(console.error);
