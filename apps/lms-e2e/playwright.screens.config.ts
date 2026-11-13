import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './src', testMatch: /(whatsapp-manual|whatsapp-auto-chat|wizard-port|idcard-size|fx-desk|fx-int|rt-lab)\.screens\.spec\.ts/, retries: 0, workers: 1,
  use: { baseURL: process.env['BASE_URL'] || 'http://127.0.0.1:4317', ...devices['Desktop Chrome'], ...(process.env['PW_CHROME_PATH'] ? { launchOptions: { executablePath: process.env['PW_CHROME_PATH'] } } : { channel: 'chrome' as const }) },
});
