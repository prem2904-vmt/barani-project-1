import { defineConfig, devices } from '@playwright/test';

/**
 * CASE SHEETS — local full stack (WP11). Nothing remote:
 *  - backend: prefrontal-mw `CaseSheetsE2EHost` (Prefrontal.Tests.Integration): the REAL app on Kestrel, a fresh local
 *    prefrontal_test_* database, test-only auth instead of Supabase, the case-sheet environment gate opened by config the
 *    way the integration harness opens it; masters seeded over the platform API;
 *  - UI: one production build served twice — LMS mode (CS_LAB_URL, /config.json {apiUrl}) and the public case-sheet
 *    site (CS_PUBLIC_URL, /config.json {apiUrl, mode:"casesheets"}).
 * Chrome can't reach *.prefrontal.health / *.supabase.co (aborted); the Google leg of sign-in is answered in-page.
 *
 *   PF_CS_STACK=/path/stack.json CS_SHOTS=~/Developer/pf-work/screens/casesheets \
 *   CS_LAB_URL=http://127.0.0.1:4371 CS_PUBLIC_URL=http://127.0.0.1:4372 \
 *   ./node_modules/.bin/playwright test --config=apps/lms-e2e/playwright.casesheets.config.ts
 */
export default defineConfig({
  testDir: './src/casesheets',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    baseURL: process.env['CS_LAB_URL'] || 'http://127.0.0.1:4371',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    acceptDownloads: true,
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    launchOptions: {
      args: ['--host-resolver-rules=MAP *.prefrontal.health ~NOTFOUND, MAP prefrontal.health ~NOTFOUND'],
    },
  },
});
