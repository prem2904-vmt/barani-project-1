import { defineConfig, devices } from '@playwright/test';

/**
 * OFFLINE specs (no backend, no webServer): every API / Supabase call and
 * both SignalR hubs are answered inside the page. Point BASE_URL at a static
 * build on a spare port (never 4200/4201), e.g.
 *   node serve-spa.mjs dist/apps/lms/browser 4317 &
 *   BASE_URL=http://127.0.0.1:4317 ./node_modules/.bin/playwright test \
 *     --config=apps/lms-e2e/playwright.offline.config.ts
 */
export default defineConfig({
  testDir: './src',
  testMatch: /(messages-realtime|notification-bell-alerts)\.smoke\.spec\.ts/,
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env['BASE_URL'] || 'http://127.0.0.1:4317',
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
});
