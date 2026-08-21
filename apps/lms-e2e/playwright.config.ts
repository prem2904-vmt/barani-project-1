import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';
import { existsSync } from 'node:fs';

// LMS app served by nx (reused if already running on :4200).
const baseURL = process.env['BASE_URL'] || 'http://localhost:4200';

// Captured logged-in state (written by auth.setup.ts). When absent, the
// `authed` specs skip rather than fail.
const STORAGE = 'apps/lms-e2e/.auth/user.json';
const hasStorage = existsSync(STORAGE);

export default defineConfig({
  ...nxE2EPreset(__filename, { testDir: './src' }),
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    ignoreHTTPSErrors: true,
  },
  retries: 2,
  workers: process.env.CI ? 1 : 3,
  webServer: {
    command: 'npx nx run lms:serve',
    url: 'http://localhost:4200',
    reuseExistingServer: true,
    cwd: workspaceRoot,
    timeout: 180_000,
  },
  projects: [
    // Unauthenticated smoke — needs no backend.
    {
      name: 'smoke',
      testMatch: /.*\.smoke\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
    // One-time login → saves storageState. Runs only when creds are provided.
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
    // Authenticated flows — reuse the captured session; skip if none.
    {
      name: 'authed',
      testMatch: /.*\.authed\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        storageState: hasStorage ? STORAGE : undefined,
      },
    },
    // RBAC / multi-role — each test signs in as its own seeded role (no shared
    // session). Verifies who-can-see/do-what per the role→permission matrix.
    {
      name: 'rbac',
      testMatch: /.*\.rbac\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
});
