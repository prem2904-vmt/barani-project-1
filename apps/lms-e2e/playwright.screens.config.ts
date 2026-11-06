import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './src', testMatch: /whatsapp-manual\.screens\.spec\.ts/, retries: 0, workers: 1,
  use: { baseURL: process.env['BASE_URL'] || 'http://127.0.0.1:4317', ...devices['Desktop Chrome'], channel: 'chrome' },
});
