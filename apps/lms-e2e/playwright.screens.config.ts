import { defineConfig } from '@playwright/test';
import { formFactorProjects } from './src/support/form-factor';

/**
 * Screens suite (API mocked, production build served locally): every spec runs on EVERY form factor —
 * phone, tablet (portrait + landscape), desktop browser and the desktop app (Electron preload stubbed in-page,
 * never launched). See src/support/form-factor.ts. Screenshots: SHOTS_DIR/<project>/.
 *
 *   BASE_URL=http://127.0.0.1:<free port> PW_CHROME_PATH=<chromium> SHOTS_DIR=<dir> \
 *     ./node_modules/.bin/playwright test --config=apps/lms-e2e/playwright.screens.config.ts [--project=tablet]
 *
 * PW_WEBKIT=1 adds phone-webkit / tablet-webkit (iPhone / iPad Safari) — needs `npx playwright install webkit` once.
 * PW_WORKERS sets the parallelism (default 4; specs keep their mock state per worker process).
 */
export default defineConfig({
  testDir: './src',
  testMatch: /(whatsapp-manual|whatsapp-auto-chat|wizard-port|idcard-size|fx-desk|fx-int|rt-lab|rt-fd|rt-wa|cm-comms)\.screens\.spec\.ts/,
  retries: 0,
  workers: Number(process.env['PW_WORKERS'] || 4),
  fullyParallel: false,
  use: { baseURL: process.env['BASE_URL'] || 'http://127.0.0.1:4317', screenshot: 'only-on-failure' },
  projects: formFactorProjects({
    launch: process.env['PW_CHROME_PATH'] ? { launchOptions: { executablePath: process.env['PW_CHROME_PATH'] } } : { channel: 'chrome' },
    webkit: process.env['PW_WEBKIT'] === '1',
  }),
});
