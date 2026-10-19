import { defineConfig, devices } from '@playwright/test';

/**
 * REAL call E2E (calls-real.local.spec.ts) — 2–4 isolated browser contexts
 * with Chromium fake media against a LOCAL stack only:
 *  - backend: prefrontal-mw Prefrontal.Tests.Integration `CallsE2EHost`
 *    (real app on Kestrel, local prefrontal_test_* DB, test-only auth);
 *  - UI: a static build whose environment points at that backend, served on a
 *    spare port.
 * No webServer here on purpose: nothing may fall back to :4200 / dev.
 *
 *   CALLS_BASE_URL=http://127.0.0.1:4391 CALLS_USERS=/path/users.json \
 *   CALLS_SHOTS=/path/shots ./node_modules/.bin/playwright test \
 *     --config=apps/lms-e2e/playwright.calls.config.ts
 */
export default defineConfig({
  testDir: './src',
  testMatch: /calls-real\.local\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    baseURL: process.env['CALLS_BASE_URL'] || 'http://127.0.0.1:4391',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    },
  },
});
