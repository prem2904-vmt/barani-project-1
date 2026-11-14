import { defineConfig } from '@playwright/test';
import { formFactorProjects } from './src/support/form-factor';

/**
 * NEURON, REAL BACKEND (no mocks): the sheet editor driven against prefrontal-mw's `NeuronE2EHost`
 * (Prefrontal.Tests.Integration): the real app on Kestrel, a throwaway local prefrontal_test_* database
 * (migrations apply on boot), local MinIO for object storage, test-only auth. The UI is a production build served
 * statically with a /config.json that points at that host; Chrome resolves *.prefrontal.health / *.supabase.co to
 * nothing, so no request can reach a shared environment.
 *
 *   # 1. backend (mw repo, dev PC)   PF_NEURON_E2E_HOST=1 PF_NEURON_E2E_PORT=5271 PREFRONTAL_TEST_DB=prefrontal_test_neuron_e2e \
 *   #    Cors__AllowedOrigins__7=http://127.0.0.1:4392 PF_NEURON_E2E_OUT=/path/stack.json \
 *   #    dotnet test Prefrontal.Tests.Integration --filter FullyQualifiedName~NeuronE2EHost
 *   # 2. UI: nx run lms:build:production (+ tools/fetch-neuron.sh first), copy dist/apps/lms/browser, add config.json
 *   #    {"apiUrl":"http://127.0.0.1:5271",...}, node apps/lms-e2e/serve-spa.mjs <dir> 4392
 *   # 3. PF_STACK=/path/stack.json BASE_URL=http://127.0.0.1:4392 PW_CHROME_PATH=<chromium> SHOTS_DIR=<dir> \
 *   #    ./node_modules/.bin/playwright test --config=apps/lms-e2e/playwright.neuron-real.config.ts
 */
export default defineConfig({
  testDir: './src',
  testMatch: /neuron-real\.local\.spec\.ts/,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  timeout: 240_000,
  reporter: [['list']],
  use: { baseURL: process.env['BASE_URL'] || 'http://127.0.0.1:4392', screenshot: 'only-on-failure', trace: 'off' },
  projects: formFactorProjects({
    names: ['desktop', 'phone'],
    launch: {
      launchOptions: {
        ...(process.env['PW_CHROME_PATH'] ? { executablePath: process.env['PW_CHROME_PATH'] } : {}),
        args: ['--host-resolver-rules=MAP *.prefrontal.health ~NOTFOUND, MAP prefrontal.health ~NOTFOUND, MAP *.supabase.co ~NOTFOUND'],
      },
    },
  }),
});
