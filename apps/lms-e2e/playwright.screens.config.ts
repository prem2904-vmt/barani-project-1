import { defineConfig } from '@playwright/test';
import { browsersFromEnv, formFactorProjects } from './src/support/form-factor';

/**
 * Screens suite (API mocked, production build served locally): every spec runs on EVERY form factor —
 * phone, tablet (portrait + landscape), desktop browser and the desktop app (Electron preload stubbed in-page,
 * never launched). See src/support/form-factor.ts. Screenshots: SHOTS_DIR/<project>/.
 *
 *   BASE_URL=http://127.0.0.1:<free port> PW_CHROME_PATH=<chromium> SHOTS_DIR=<dir> \
 *     ./node_modules/.bin/playwright test --config=apps/lms-e2e/playwright.screens.config.ts [--project=tablet]
 *
 * PW_BROWSERS=webkit,firefox,chrome,edge (or all) adds Safari (phone/tablet/desktop), Firefox, Chrome and Edge projects —
 * run them in the Playwright image (tools/e2e-browsers.sh); PW_WEBKIT=1 still adds WebKit.
 * PW_WORKERS sets the parallelism (default 4; specs keep their mock state per worker process).
 */
export default defineConfig({
  testDir: './src',
  testMatch: /(whatsapp-manual|whatsapp-auto-chat|wizard-port|idcard-size|fx-desk|fx-int|rt-lab|rt-fd|rt-wa|cm-comms|neg-comms|neg-email-share|neg-wa|neg-storage|neg-desk-lab|files|bugs-1116|settings|settings-v2|lab-departments|rehome-lab|rehome-org|settings-grids|test-editor-align|unsaved-dialog|tm-views|settings-bottom|report-design|side-cards|prepare-two-panel|settings-access|prices-neuron|order-ids|collect-two-panel|workflow-v2|reports-v2|critical-results|frontdesk-v2)\.screens\.spec\.ts/,
  retries: 0,
  workers: Number(process.env['PW_WORKERS'] || 4),
  fullyParallel: false,
  use: { baseURL: process.env['BASE_URL'] || 'http://127.0.0.1:4317', screenshot: 'only-on-failure', actionTimeout: 20_000 },
  projects: formFactorProjects({
    launch: process.env['PW_CHROME_PATH'] ? { launchOptions: { executablePath: process.env['PW_CHROME_PATH'] } } : { channel: 'chrome' },
    browsers: browsersFromEnv(),
  }),
});
