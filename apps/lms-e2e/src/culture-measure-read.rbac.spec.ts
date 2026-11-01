import { test, expect, type Page, type Route } from '@playwright/test';
import { existsSync } from 'node:fs';
import { loginAs } from './support/auth';

/**
 * Measure zones from plate — REAL OpenCV on a REAL plate photo.
 *
 * Signs in as the seeded Micro World Lab Admin, opens a culture case with
 * the AST stage rewritten open in the browser (organism E. coli, nothing
 * written on the server — the pick is answered locally), opens Measure,
 * UPLOADS the plate photo (PLATE_JPG) and lets OpenCV.js (lazy, the BUNDLED
 * same-origin asset — any CDN request is blocked and fails the test) find
 * the rim, the disks and the zones. Asserts the overlays (disk badges after
 * glare filtering), that the PIT disk (lower right, the one with a zone)
 * reads above 6 mm, and that the code list renders.
 *
 * The AI endpoint is answered in the browser: first "absent" (404 → Codes:
 * pick manually), then with the prototype's real read (7 of 8 codes, CAZ
 * unread → "Probably CAZ 30") to show the filled state. Screenshots at
 * 1440 / 375, light + dark into $SHOTS_DIR.
 */

const SHOTS = process.env['SHOTS_DIR'] || '';
const PLATE = process.env['PLATE_JPG'] || '';
/** Where the PIT disk sits in plate.jpg (image px) — the only zone. */
const PIT = { x: 374, y: 800 };

/** The prototype's single-call answer, keyed by POSITION on the plate (our
 *  numbering is reading order, so the tile n is looked up by where it is). */
const PROTOTYPE_READ: { x: number; y: number; code: string; conf: number }[] = [
  { x: 294, y: 523, code: 'AMC 30', conf: 0.97 },
  { x: 172, y: 569, code: 'CFM 5', conf: 0.7 },
  { x: 412, y: 575, code: 'UNKNOWN', conf: 0 },          // CAZ 30? — unread
  { x: 286, y: 655, code: 'IPM 10', conf: 0.95 },
  { x: 146, y: 705, code: 'CTR 30', conf: 0.93 },
  { x: 438, y: 682, code: 'CPM 30', conf: 0.8 },
  { x: 234, y: 808, code: 'CFS 105', conf: 0.85 },
  { x: 374, y: 800, code: 'PIT 100/10', conf: 0.9 },
];

async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.evaluate((t) => {
    const r = document.documentElement;
    r.classList.toggle('dark', t === 'dark');
    r.classList.toggle('light', t === 'light');
    r.setAttribute('data-theme', t);
  }, theme);
}
async function shots(page: Page, name: string) {
  if (!SHOTS) return;
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/${name}-${theme}.png` });
  }
  await setTheme(page, 'light');
}

async function openCase(page: Page): Promise<boolean> {
  const direct = process.env['CULTURE_ORDER_TEST_ID'];
  if (direct) { await page.goto(`/lab/culture/${direct}`); return true; }
  await page.goto('/lab/my-work');
  await page.waitForLoadState('networkidle').catch(() => {});
  const tab = page.locator('pf-segmented button[aria-label="Culture"], .pf-mtab[aria-label="Culture bench"]').first();
  if (!(await tab.count())) return false;
  await tab.click();
  const card = page.locator('li.pf-cc .pf-cc__hdr').first();
  try { await card.waitFor({ timeout: 15_000 }); } catch { return false; }
  await card.click();
  try { await page.waitForURL(/\/lab\/culture\//, { timeout: 15_000 }); return true; } catch { return false; }
}

test.describe('Measure zones — OpenCV + one AI read', () => {
  test.setTimeout(240_000);

  test('real plate: disks, glare filtered, PIT zone > 6 mm, codes pending → manual → filled; 1440 + 375 shots', async ({ page }) => {
    test.skip(!PLATE || !existsSync(PLATE), 'Set PLATE_JPG to the real plate photo (ast-ocr/plate.jpg).');
    // CORS_RELAY=1: the app runs on a non-allowlisted origin (e.g. a static
    // build on :4310) — relay backend calls from the test runner, adding
    // the CORS header. Registered first, so the mocks below still win.
    if (process.env['CORS_RELAY']) {
      await page.route(/prefrontal\.health\/api\//, async route => {
        const origin = new URL(page.url() || 'http://localhost').origin;
        const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
          'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        const res = await route.fetch();
        await route.fulfill({ response: res, headers: { ...res.headers(), ...cors } });
      });
    }
    await loginAs(page, 'admin');
    await page.setViewportSize({ width: 1440, height: 900 });

    // READ-ONLY: AST open with an identified organism, pick answered locally.
    let lastCase: unknown = null;
    await page.route(/\/api\/microbiology\/culture\/[^/?]+(\?.*)?$/, async route => {
      if (route.request().method() !== 'GET') return route.continue();
      const res = await route.fetch();
      const body = await res.json();
      const openIt = (c: any) => {
        for (const st of c?.stages ?? []) {
          if (st.key === 'identification') {
            st.state = 'done';
            st.valuesJson = JSON.stringify({ fields: [{ name: 'organism', title: 'Organism', value: 'Escherichia coli' }] });
          }
          if (st.key === 'ast') { st.state = 'open'; st.holderUserId = null; st.holderName = null; st.valuesJson = null; }
        }
      };
      const c = body?.data ?? body;
      openIt(c);
      for (const sub of c?.subCultures ?? []) openIt(sub);
      lastCase = body;
      await route.fulfill({ response: res, json: body });
    });
    await page.route(/\/api\/microbiology\/culture\/.*\/stage\/ast\/pick/, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(lastCase) }));
    await page.route(/\/api\/culture\/ast\/ai-usage/, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { monthTokens: 1_200_000, capTokens: 2_000_000, calls: 14 } }) }));

    // The AI read: absent first (404), then the prototype's answer.
    let aiMode: 'absent' | 'hold' | 'real' = 'absent';
    let held: Route | null = null;
    let lastRequest: any = null;
    await page.route(/\/api\/culture\/ast\/disk-read$/, async route => {
      lastRequest = route.request().postDataJSON();
      if (aiMode === 'absent') return route.fulfill({ status: 404, body: '' });
      if (aiMode === 'hold') { held = route; return; }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer(lastRequest)) });
    });
    // Remember where each tile's disk sits (our numbering) for the answer.
    const tilePos = new Map<number, { x: number; y: number }>();
    const answer = (req: any) => {
      const allowed = new Set<string>(req?.candidates ?? []);
      return {
        success: true,
        data: {
          disks: (req?.tiles ?? []).map((n: number) => {
            const p = tilePos.get(n);
            const hit = p && PROTOTYPE_READ.find(r => Math.hypot(r.x - p.x, r.y - p.y) < 20);
            const code = hit && allowed.has(hit.code) ? hit.code : 'UNKNOWN';
            const suggestedCode = hit?.code === 'UNKNOWN' && allowed.has('CAZ 30') ? 'CAZ 30' : null;
            return { n, code, confidence: hit?.conf ?? 0, suggestedCode };
          }),
          model: 'gemma-4-26b-a4b-it', latencyMs: 134000,
          usage: { promptTokens: 474, outputTokens: 245, thoughtTokens: 5929, totalTokens: 6648 }, auditId: 'e2e-audit',
        },
      };
    };
    await page.route(/\/api\/culture\/ast\/disk-read\/.*\/confirm/, route => route.fulfill({ status: 200, body: '{}' }));

    // OpenCV must come from the app itself: block every CDN, record the load.
    const cdnHits: string[] = [];
    await page.route(/cdn\.jsdelivr\.net\/npm\/@techstark|cdnjs\.cloudflare\.com|unpkg\.com/, route => { cdnHits.push(route.request().url()); return route.abort(); });
    const cvLoads: string[] = [];
    page.on('requestfinished', r => { if (/opencv\.js/.test(r.url())) cvLoads.push(r.url()); });

    const opened = await openCase(page);
    test.skip(!opened, 'No culture case to open (set CULTURE_ORDER_TEST_ID).');
    expect(cvLoads, 'OpenCV is lazy — not loaded with the page').toEqual([]);
    const ast = page.locator('section.pf-stg').filter({ hasText: /sensitivity/i }).first();
    await expect(ast).toBeVisible({ timeout: 20_000 });
    const openBtn = ast.locator('.pf-cse__astbtn');
    test.skip(!(await openBtn.count()), 'AST stage not editable.');
    await openBtn.click();
    const measureBtn = page.locator('.ce-org pf-touch-btn').filter({ hasText: 'Measure' }).first();
    await expect(measureBtn).toBeVisible({ timeout: 10_000 });
    await setTheme(page, 'light');
    await measureBtn.click();

    const modal = page.locator('pf-plate-measure .pm-panel');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.pm-step')).toHaveCount(4);
    await modal.locator('.pm-capture input[type=file]').first().setInputFiles(PLATE);

    // Calibrate: OpenCV loads (CDN) and finds the rim.
    await expect(modal.locator('.pm-step[data-state="active"] .pm-step__lbl')).toHaveText('Calibrate');
    await expect(modal.locator('circle.pm-plate')).toHaveCount(1, { timeout: 120_000 });
    const origin = new URL(page.url()).origin;
    expect(cvLoads.length).toBe(1);
    expect(cvLoads[0]).toBe(`${origin}/assets/vendor/opencv/opencv.js`);
    expect(cdnHits).toEqual([]);
    console.log(`[measure] OpenCV loaded from ${cvLoads[0]}`);
    await expect(modal.locator('.pm-seg .nd-seg__item[aria-checked="true"]')).toHaveText(/90 mm/);
    await shots(page, 'calibrate-1440');

    // Measure & read — hold the AI call to see the pending state.
    aiMode = 'hold';
    await modal.locator('.pm-controls .nd-btn--primary').click();
    await expect(modal.locator('.pm-step[data-state="active"] .pm-step__lbl')).toHaveText('Measure & read', { timeout: 60_000 });
    const guide = modal.getByRole('button', { name: 'Got it' });
    if (await guide.isVisible().catch(() => false)) await guide.click();
    const badges = modal.locator('g.pm-disk');
    const count = await badges.count();
    console.log(`[measure] disks after glare filtering: ${count}; rejected: ${await modal.locator('.pm-rejtoggle').textContent()}`);
    expect(count).toBeGreaterThanOrEqual(8);

    // Where is each numbered disk? (for the PIT check + the mocked answer)
    const rings = await modal.locator('g.pm-disk').evaluateAll(gs => gs.map(g => {
      const e = g.querySelector('ellipse.pm-ring')!;
      return { n: Number(g.getAttribute('data-n')), x: Number(e.getAttribute('cx')), y: Number(e.getAttribute('cy')) };
    }));
    rings.forEach(r => tilePos.set(r.n, { x: r.x, y: r.y }));
    const pit = rings.find(r => Math.hypot(r.x - PIT.x, r.y - PIT.y) < 20);
    expect(pit, 'PIT disk detected').toBeTruthy();
    const pitMm = Number(await modal.locator(`.pm-drow[data-n="${pit!.n}"] input.pm-mm`).inputValue());
    console.log(`[measure] PIT disk #${pit!.n} zone = ${pitMm} mm`);
    expect(pitMm).toBeGreaterThan(6);
    const others = await modal.locator('.pm-drow input.pm-mm').evaluateAll(xs => xs.map(x => Number((x as HTMLInputElement).value)));
    console.log(`[measure] all zones: ${others.join(', ')}`);

    await expect(modal.locator('.pm-codesel--pending').first()).toBeVisible({ timeout: 10_000 });
    await expect(modal.locator('.pm-sense')).toContainText('Cortex · reading…');
    await expect(modal.locator('.pm-stage.nd-ai-glow')).toHaveAttribute('data-ai-working', 'true');
    await expect(modal.locator('.pm-list.nd-ai-glow')).toHaveAttribute('data-ai-working', 'true');
    expect(lastRequest?.tiles?.length).toBe(count);
    expect(String(lastRequest?.image ?? '')).not.toMatch(/^data:/);
    await shots(page, 'read-pending-1440');

    // Absent backend → manual fallback.
    await held!.fulfill({ status: 404, body: '' });
    await expect(modal.locator('[data-ai-working="true"]')).toHaveCount(0);
    await expect(modal.locator('.pm-note--manual')).toContainText('Cortex isn’t available — pick each disk’s code');
    await expect(modal.locator('.pm-codesel .pf-dd__value').first()).toHaveText('Unknown — tap to pick');
    await shots(page, 'read-manual-1440');
    // Review keeps the picker: pick PIT's code there → Apply enables.
    await modal.locator('.pm-controls .nd-btn--primary').click();   // Review
    const apply = modal.locator('.pm-controls .nd-btn--primary');
    await expect(apply).toHaveText(/Apply to table/);
    await expect(apply).toBeDisabled();
    await expect(modal.locator('.pm-drow pf-select.pm-codesel')).toHaveCount(count);
    await modal.locator(`.pm-drow[data-n="${pit!.n}"] .pf-dd__trigger`).click();
    await page.locator('#pf-overlay-host .pf-dd__option', { hasText: 'PIT 100/10' }).first().click();
    await expect(modal.locator('.pm-controls .pm-hinttext')).toContainText('1 zone goes to the AST table');
    await expect(apply).toBeEnabled();
    await expect(modal.locator(`.pm-drow[data-n="${pit!.n}"] .pm-drow__drug`)).toContainText('Piperacillin-Tazobactam');
    await shots(page, 'review-manual-picked-1440');
    await modal.getByRole('button', { name: 'Back' }).click();

    // Real answer → filled state (re-run the read through Recalibrate → Measure).
    aiMode = 'real';
    await modal.getByRole('button', { name: 'Recalibrate' }).click();
    await modal.locator('.pm-controls .nd-btn--primary').click();
    await expect(modal.locator('.pm-pf[aria-label="Read by Cortex"]').first()).toBeVisible({ timeout: 30_000 });
    const filled = await modal.locator('.pm-pf[aria-label="Read by Cortex"]').count();
    expect(await modal.textContent()).not.toMatch(/\bAI\b/);
    console.log(`[measure] codes filled by the mocked read: ${filled}; candidates sent: ${(lastRequest?.candidates ?? []).length}`);
    await shots(page, 'read-filled-1440');
    await modal.locator('.pm-controls .nd-btn--primary').click();   // Review
    await expect(modal.locator('.pm-controls .nd-btn--primary')).toHaveText(/Apply to table/);
    await shots(page, 'review-1440');
    await modal.getByRole('button', { name: 'Back' }).click();

    // Phones: the tall sheet, list under the plate.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(500);
    const box = (await modal.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(370);
    const stage = (await modal.locator('.pm-stage').boundingBox())!;
    const list = (await modal.locator('.pm-list').boundingBox())!;
    expect(list.y).toBeGreaterThanOrEqual(stage.y + stage.height - 1);
    await shots(page, 'read-filled-375');
    await modal.locator('.pm-list__in').evaluate(e => e.scrollTo(0, 99999));
    await shots(page, 'read-filled-375-list');
    await modal.locator('.pm-x').click();
  });
});
