import { defineConfig, devices } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

/**
 * LOCAL FULL STACK — the integrated mw + this app, nothing remote:
 *  - backend: prefrontal-mw `LabFlowE2EHost` (Prefrontal.Tests.Integration):
 *    the REAL app on Kestrel, a fresh local prefrontal_test_* database
 *    (migrations apply on boot, the tenant is provisioned through the
 *    production seeder), test-only auth instead of Supabase;
 *  - UI: a production build served statically on 127.0.0.1:4300 with a
 *    /config.json whose apiUrl is that host (no source change, no apiUrl edit).
 * Chrome resolves *.prefrontal.health and *.supabase.co to nothing, so no
 * request can reach dev / stage / prod even by mistake.
 *
 *   # 1. backend (mw repo)
 *   PF_LAB_E2E_HOST=1 PF_LAB_E2E_PORT=5270 PREFRONTAL_TEST_DB=prefrontal_test_lab_e2e \
 *   Platform__ServiceToken=local-test Cors__AllowedOrigins__7=http://127.0.0.1:4300 \
 *   PF_LAB_E2E_OUT=/tmp/pf-lab-e2e/stack.json \
 *   dotnet test Prefrontal.Tests.Integration --filter FullyQualifiedName~LabFlowE2EHost
 *   # 2. UI: nx build lms --configuration=production; copy dist/apps/lms/browser to a
 *   #    scratch dir, add config.json {"apiUrl":"http://127.0.0.1:5270", ...}, then
 *   node apps/lms-e2e/serve-spa.mjs <scratch-dir> 4300
 *   # 3. run
 *   PF_STACK=/tmp/pf-lab-e2e/stack.json PF_SHOTS=/path/shots ./node_modules/.bin/playwright test \
 *     --config=apps/lms-e2e/playwright.local.config.ts
 */
const baseURL = process.env['LOCAL_BASE_URL'] || 'http://127.0.0.1:4300';
const STORAGE = 'apps/lms-e2e/.auth/local-admin.json';

// The clinical-flow specs reuse the `page` fixture: sign them in as the
// host's lab admin through storageState (an unsigned test JWT the mw test
// auth handler accepts; it never reaches Supabase).
const stackPath = process.env['PF_STACK'];
if (stackPath) {
  const stack = JSON.parse(readFileSync(stackPath, 'utf8')) as { admin: { authId: string } };
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const sub = stack.admin.authId;
  const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400, email: `${sub}@test.invalid` })}.sig`;
  mkdirSync('apps/lms-e2e/.auth', { recursive: true });
  writeFileSync(STORAGE, JSON.stringify({
    cookies: [],
    origins: [{ origin: baseURL, localStorage: [
      { name: 'pf.session', value: JSON.stringify({ access_token: token, refresh_token: `rt-${sub}` }) },
      { name: 'pf-design', value: 'new' },
      { name: 'pf-theme', value: 'light' },
    ] }],
  }));
}

export default defineConfig({
  testDir: './src',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 150_000,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    baseURL,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'off',
    launchOptions: {
      args: ['--host-resolver-rules=MAP *.prefrontal.health ~NOTFOUND, MAP prefrontal.health ~NOTFOUND, MAP *.supabase.co ~NOTFOUND'],
    },
  },
  projects: [
    {
      name: 'clinical',
      testMatch: /(register|order|collect|result|report|billing|amend)\.authed\.spec\.ts/,
      use: { storageState: STORAGE },
    },
    {
      name: 'features',
      testMatch: /local-stack\/.*\.spec\.ts/,
    },
  ],
});
