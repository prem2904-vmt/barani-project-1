import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

/**
 * STORAGE — REAL end to end. Everything is local, nothing touches dev/stage:
 *   - backend = prefrontal-mw `StorageE2EHost` (Prefrontal.Tests.Integration/
 *     StorageE2E/StorageE2EHost.cs) — the real app on Kestrel, a local
 *     prefrontal_test_* database, test-only auth, and the REAL
 *     SpacesStorageService against a local MinIO (through S3FaultProxy) — the
 *     same real stack every backend StorageE2EBase test uses;
 *   - UI = a static build pointed at that backend (apiUrl) and at a dead
 *     Supabase URL; token refreshes are answered in-page from a made-up
 *     unsigned session — see calls-real.local.spec.ts, this file's model.
 * See playwright.storage.config.ts for the exact one-time setup + run command.
 *
 * The host seeds, through its own real API, a patient with: a finalized
 * report whose PDF is really stored (POST /api/reports/{id}/pdf against real
 * MinIO), a result-entry attachment image, and a chat attachment — and
 * writes their ids + a login (authId) to STORAGE_E2E_OUT.
 */
type Seed = {
  apiUrl: string; authId: string; colleagueAuthId: string; tenantId: string; branchId: string;
  patientId: string; orderId: string; sampleId: string; orderTestId: string; reportId: string;
  resultAttachmentUrl: string; conversationId: string; chatAttachmentUrl: string;
};
const OUT = process.env['STORAGE_E2E_OUT'];
const SEED: Seed | null = OUT ? (JSON.parse(readFileSync(OUT, 'utf8')) as Seed) : null;
/** StorageE2EHost.cs polls for this sibling file: its PRESENCE makes every
 *  S3 call answer 500 InternalError (so a live request hits the app's real
 *  503 storage_error mapping); deleting it clears the fault. */
const FAULT_PATH = OUT ? `${OUT}.fault` : null;

// Hard safety rail, same as calls-real.local.spec.ts: this suite only ever
// talks to loopback, and every test below skips (not fails) without a seed —
// there is no scenario where this spec can reach dev/stage.
test.beforeAll(() => {
  if (!SEED) return;
  for (const u of [SEED.apiUrl, process.env['STORAGE_E2E_BASE_URL'] || 'http://127.0.0.1:4396']) {
    const h = new URL(u).hostname;
    if (h !== '127.0.0.1' && h !== 'localhost') throw new Error(`storage E2E refuses non-local host ${h}`);
  }
});

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub: string) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 86400, email: `${sub}@test.invalid` })}.sig`;

const blocked: string[] = [];

/** Same fake-session technique as calls-real.local.spec.ts: a made-up
 *  Supabase-shaped session in localStorage, token refreshes answered
 *  in-page from a fixed local port, and any request to a real
 *  *.prefrontal.health / *.supabase.co host aborted (and asserted empty). */
async function openAs(page: Page, authId: string, path: string): Promise<void> {
  await page.context().route(/prefrontal\.health|supabase\.co/, r => { blocked.push(r.request().url()); return r.abort(); });
  await page.context().route(/127\.0\.0\.1:59999/, async r => {
    const req = r.request();
    const origin = req.headers()['origin'] ?? '*';
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    return r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({ access_token: jwt(authId), refresh_token: `rt-${authId}`, token_type: 'bearer', expires_in: 86400,
        user: { id: authId, aud: 'authenticated', email: `${authId}@test.invalid` } }) });
  });
  await page.addInitScript(([session]) => {
    if (!sessionStorage.getItem('pf.e2e.seeded')) {
      sessionStorage.setItem('pf.e2e.seeded', '1');
      localStorage.clear();
      localStorage.setItem('pf.session', session as string);
      localStorage.setItem('pf-design', 'new');
    }
  }, [JSON.stringify({ access_token: jwt(authId), refresh_token: `rt-${authId}` })]);
  await page.goto(path);
}

test.afterAll(() => {
  if (!SEED) return;
  expect(blocked, 'no request may reach a real dev/stage/Supabase host').toEqual([]);
});

// Every test is a no-op (not a failure) without a live STORAGE_E2E_OUT —
// keeps `nx test` / a default `playwright test` run green without the local
// stack, per playwright.calls.config.ts's precedent.
test.describe('report PDF — view, download, print (real storage)', () => {
  test.skip(!SEED, 'STORAGE_E2E_OUT not set — see playwright.storage.config.ts for the one-time local setup');

  test('the stored report PDF loads from real object storage and download saves real PDF bytes', async ({ page }) => {
    const s = SEED!;
    await openAs(page, s.authId, `/reports/view/${s.reportId}`);

    // report-viewer.component.html: the PDF pages host is `.pf-rv-pages`
    // (aria-label "Report PDF"), and gets `.pf-rv-pages--in` once pdfReady()
    // flips — the PDF really rendered from the bytes GET /api/reports/{id}/pdf
    // streamed back from MinIO, not a client-side snapshot re-render.
    const pages = page.getByLabel('Report PDF');
    await expect(pages).toBeVisible({ timeout: 20_000 });
    await expect(pages).toHaveClass(/pf-rv-pages--in/, { timeout: 20_000 });

    // Download: the report-viewer menu's "Download PDF" action
    // (report-viewer.component.ts menuActions()/download()) saves the exact
    // bytes GET /api/reports/{id}/pdf served.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'Download PDF' }).click().catch(async () => {
        // The action menu may need an explicit trigger first — open it, then
        // its item. Selector left generic on purpose: see report-viewer.
        // component.ts `menuActions` for the full action list if this needs
        // adjusting once run against the live component.
        await page.getByRole('button', { name: /more|actions|menu/i }).first().click();
        await page.getByText('Download PDF', { exact: true }).click();
      }),
    ]);
    const path = await download.path();
    expect(path, 'download produced a real file').toBeTruthy();
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    if (stream) for await (const c of stream) chunks.push(c as Buffer);
    const bytes = Buffer.concat(chunks);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  test('print opens the browser print path without an error toast', async ({ page }) => {
    const s = SEED!;
    await openAs(page, s.authId, `/reports/view/${s.reportId}`);
    await expect(page.getByLabel('Report PDF')).toHaveClass(/pf-rv-pages--in/, { timeout: 20_000 });
    // window.print() is intercepted so the test doesn't hang on the native
    // dialog — the assertion is that PRINT DOESN'T ERROR (no raw storage
    // exception toast), not the OS dialog itself.
    await page.evaluate(() => { window.print = () => undefined; });
    await page.getByRole('menuitem', { name: 'Print' }).click().catch(async () => {
      await page.getByRole('button', { name: /more|actions|menu/i }).first().click();
      await page.getByText('Print', { exact: true }).click();
    });
    await expect(page.locator('.pf-toasts')).not.toContainText(/Amazon|Exception|storage_error/i);
  });
});

test.describe('result-entry attachment thumbnail (real storage)', () => {
  test.skip(!SEED, 'STORAGE_E2E_OUT not set — see playwright.storage.config.ts for the one-time local setup');

  test('the seeded result attachment image renders as a real thumbnail, not a broken link', async ({ page }) => {
    const s = SEED!;
    // app.routes.ts: 'lab/sample/:sampleId' (sample-result-entry.component),
    // the tube-level screen; attachmentsFor()/attachSrc() render each
    // attachment as `.pf-sre__attach-thumb img` — a missing (410) one
    // instead renders `[data-testid="sre-attach-missing"]`.
    await openAs(page, s.authId, `/lab/sample/${s.sampleId}`);
    await expect(page.locator('[data-testid="sre-attach-missing"]')).toHaveCount(0);
    const img = page.locator('.pf-sre__attach-thumb img').first();
    await expect(img).toBeVisible({ timeout: 20_000 });
    const natural = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
    expect(natural, 'a real image decoded, not a broken-image icon').toBeGreaterThan(0);
  });
});

test.describe('chat attachment (real storage)', () => {
  test.skip(!SEED, 'STORAGE_E2E_OUT not set — see playwright.storage.config.ts for the one-time local setup');

  test('the seeded chat voice-note attachment renders as a working audio player via the authenticated fetch', async ({ page }) => {
    const s = SEED!;
    await openAs(page, s.authId, '/messages');
    // messages-page.component.html: resolveAttachmentUrl() -> UploadsService,
    // an audio attachment (AttachmentMime "audio/mpeg", the host seeds
    // voice-note.mp3) renders as `.pf-msgs__attach-audio audio[src]`. A gone
    // (410) attachment instead renders `.pf-msgs__attach-card--gone` with
    // "No longer available on the server" — assert we did NOT land there.
    await expect(page.locator('.pf-msgs__attach-card--gone')).toHaveCount(0);
    const player = page.locator('.pf-msgs__attach-audio audio').first();
    await expect(player).toBeVisible({ timeout: 20_000 });
    // The <audio src> is a blob: URL only once UploadsService's authenticated
    // fetch actually landed — a bare '' src means the fetch never resolved.
    await expect.poll(async () => player.evaluate((el: HTMLAudioElement) => el.currentSrc || el.src),
      { timeout: 20_000 }).toMatch(/^blob:/);
  });
});

// ── Fault case ───────────────────────────────────────────────────────────
test.describe('storage fault (real 503 from a faulted MinIO)', () => {
  test.skip(!SEED, 'STORAGE_E2E_OUT not set — see playwright.storage.config.ts for the one-time local setup');

  test('a live upload during a real S3 fault shows the friendly 503 message, never raw SDK/exception text', async ({ page }) => {
    const s = SEED!;
    if (!FAULT_PATH) test.skip();
    await openAs(page, s.authId, `/lab/sample/${s.sampleId}`);
    writeFileSync(FAULT_PATH!, '1');
    try {
      // Give the host's 300ms poll loop time to flip S3FaultProxy.Fault on.
      await page.waitForTimeout(700);
      // Attach a new file to the seeded order-test while every S3 call
      // answers 500 InternalError — UploadStore.SaveAsync wraps that as
      // StorageWriteException -> the API's real 503 storage_error mapping
      // (UploadsController.StoreAsync). sample-result-entry.component.html
      // has ONE shared hidden `#attachInput`: pickAttachment(t, attachInput,
      // param) records WHICH order-test the next file belongs to, then opens
      // the picker — so the attach button must be clicked first (the host
      // seeds exactly one test on the order, so `.first()` is that row's).
      await page.locator('.pf-sre__attach-btn').first().click();
      await page.locator('input[type="file"]').setInputFiles({ name: 'fault-probe.png', mimeType: 'image/png',
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(64).fill(0)]) });
      // UploadsController.StoreAsync -> StorageWriteException.UserMessage:
      // "File storage couldn't save the file. Try again shortly." — the
      // real point of this test: the toast is friendly, not the SDK's own
      // AmazonServiceException / InternalError text.
      const toast = page.locator('.pf-toasts');
      await expect(toast).toContainText(/storage|couldn.t save|try again/i, { timeout: 15_000 });
      await expect(toast).not.toContainText(/Amazon|InternalError|HttpErrorResponseException|System\./);
    } finally {
      rmSync(FAULT_PATH!, { force: true });
      await page.waitForTimeout(700); // let the host clear the fault before the next test acts
    }
  });
});
