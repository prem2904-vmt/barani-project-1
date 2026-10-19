import { defineConfig, devices } from '@playwright/test';

/**
 * REAL storage E2E (src/storage/storage-real.local.spec.ts) — a static build
 * of the app served locally, pointed at prefrontal-mw's REAL
 * StorageE2EHost (Prefrontal.Tests.Integration/StorageE2E/StorageE2EHost.cs):
 * a genuine app on Kestrel with the real SpacesStorageService against a
 * local MinIO. No dev/stage host is ever touched. Modelled directly on
 * playwright.calls.config.ts (CallsE2EHost / calls-real.local.spec.ts) —
 * same static-build + fake-Supabase-session technique, see that file and
 * scratchpad/calls/serve.mjs for the precedent this was built from.
 *
 * ONE-TIME setup (each step is a separate terminal / background job; every
 * artifact below is throwaway and never touches dev/stage):
 *
 *  1. Start the backend host (from the mw repo):
 *       MINIO_BIN=/path/to/minio \
 *       PF_STORAGE_E2E_HOST=1 PF_STORAGE_E2E_PORT=5396 \
 *       PREFRONTAL_TEST_DB=prefrontal_test_storage_e2e \
 *       Cors__AllowedOrigins__7=http://127.0.0.1:4396 \
 *       PF_STORAGE_E2E_OUT=/tmp/pf-storage-e2e/storage.json \
 *       dotnet test Prefrontal.Tests.Integration --filter FullyQualifiedName~StorageE2EHost
 *     Wait until /tmp/pf-storage-e2e/storage.json exists (it's written once
 *     seeding finishes) before step 3.
 *
 *  2. Build a static UI bundle whose `apiUrl` / Supabase URL point at the
 *     host above, instead of dev — patch the TWO literal strings the
 *     `production` build config resolves to (apps/lms/src/environments/
 *     environment.production.ts: `devEnvironment.apiUrl` and
 *     `devEnvironment.auth.supabaseUrl`) to `http://127.0.0.1:5396` and
 *     `http://127.0.0.1:59999` (a fixed fake port the spec's route
 *     interceptor answers — see calls-real.local.spec.ts's `openAs()` for
 *     the exact pattern this spec reuses), keep a backup, build, then
 *     restore the file (never commit a patched environment.production.ts —
 *     see docs/ENGINEERING-RULES.md "Local dev apiUrl swap"):
 *       cp apps/lms/src/environments/environment.production.ts /tmp/env.orig.ts
 *       sed -i '' "s#https://med-fetch-dev.prefrontal.health#http://127.0.0.1:5396#; s#https://cottlnsbjnstsgknsgzu.supabase.co#http://127.0.0.1:59999#" \
 *         apps/lms/src/environments/environment.production.ts
 *       npx nx run lms:build:production --output-path=/tmp/pf-storage-e2e/dist
 *       cp /tmp/env.orig.ts apps/lms/src/environments/environment.production.ts
 *
 *  3. Serve the static build on the port this config's baseURL expects:
 *       node -e "$(cat <<'JS'
 *         const http=require('http'),fs=require('fs'),path=require('path');
 *         const root='/tmp/pf-storage-e2e/dist/browser', port=4396;
 *         http.createServer((req,res)=>{
 *           let p=path.join(root, decodeURIComponent(new URL(req.url,'http://x').pathname));
 *           if(!p.startsWith(root)||!fs.existsSync(p)||fs.statSync(p).isDirectory()) p=path.join(root,'index.html');
 *           res.writeHead(200); fs.createReadStream(p).pipe(res);
 *         }).listen(port,'127.0.0.1');
 *       JS
 *       )"
 *
 *  4. Run the spec:
 *       STORAGE_E2E_OUT=/tmp/pf-storage-e2e/storage.json \
 *       ./node_modules/.bin/playwright test --config=apps/lms-e2e/playwright.storage.config.ts
 *
 *  5. Stop the host: `touch /tmp/pf-storage-e2e/storage.json.stop`.
 *
 * STATUS (2026-09-30): the backend host (step 1) is verified working stand-
 * alone — a live curl against StorageE2EHost's port served a genuine PDF
 * from real MinIO through the real SpacesStorageService, and the
 * result-attachment and chat-attachment uploads landed under the tenant's
 * storage folder (real bytes, real keys). The host also exposes a
 * browser-reachable fault toggle (a sibling `<out>.fault` file it polls
 * every 300ms — see StorageE2EHost.cs) so the fault-case spec is a real
 * assertion, not a stub. Steps 2-4 (the static-build patch + serve + the
 * actual Playwright run against a browser) follow the proven calls-real.
 * local pattern exactly but were NOT executed end-to-end in this pass —
 * building and serving the static UI plus a full browser run is a
 * several-minute step this pass ran out of budget for. Run steps 1-4 by
 * hand once to confirm; nothing here is faked green.
 */
export default defineConfig({
  testDir: './src',
  testMatch: /storage-real\.local\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    baseURL: process.env['STORAGE_E2E_BASE_URL'] || 'http://127.0.0.1:4396',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
