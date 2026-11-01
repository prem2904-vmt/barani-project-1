import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { STACK, SHOTS, blocked, openAs, shot as rawShot } from '../support/local-stack';

/**
 * Report designer, phase 5 - Letterhead type (Digital / Pre-printed paper / Image
 * letterhead), measuring a stationery scan, the slim letterhead on later pages. On
 * the local full stack (never a real host); the preview PDFs are saved with every page.
 */
const ADMIN = STACK.admin;
const OUT = join(SHOTS || '/tmp/pf-p5', 'files');
const shot = async (page: Page, name: string) => { await page.waitForTimeout(2500); await rawShot(page, name); };
const THEMES = ['light', 'dark'] as const;

test.afterEach(() => { expect(blocked, 'no request left the machine').toEqual([]); });

/** A synthetic A4 stationery scan: cream paper, letterhead marks to 40 mm, footer marks from 271 mm. */
async function stationeryPng(): Promise<string> {
  const ppm = 4, w = 210 * ppm, h = 297 * ppm, buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const mm = y / ppm;
    for (let x = 0; x < w; x++) {
      const mx = x / ppm, i = (y * w + x) * 3;
      const band = (mm >= 8 && mm < 40) || (mm >= 271 && mm < 289);
      const mark = band && mx > 20 && mx < 190 && Math.floor(mx / 6) % 2 === 0;
      const logo = mm >= 10 && mm < 36 && mx >= 20 && mx < 46;
      const c: [number, number, number] = logo ? [27, 58, 107] : mark ? [120, 140, 170] : [247, 241, 226];
      buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
    }
  }
  mkdirSync(OUT, { recursive: true });
  const f = join(OUT, 'stationery-scan.png');
  await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toFile(f);
  return f;
}
/** A wide letterhead strip (210 x 40 mm). */
async function stripPng(): Promise<string> {
  const w = 1260, h = 240, buf = Buffer.alloc(w * h * 3, 255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    const band = y < 60, logo = x > 40 && x < 200 && y > 50 && y < 210, line = x > 240 && x < 900 && y > 90 && y < 120;
    const c: [number, number, number] = band ? [27, 94, 120] : logo ? [27, 94, 120] : line ? [60, 70, 90] : [255, 255, 255];
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
  }
  const f = join(OUT, 'letterhead-strip.png');
  await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toFile(f);
  return f;
}

async function previewPdf(page: Page, name: string): Promise<string> {
  const note = page.locator('.pf-card__note, .pf-rt-aside__k').filter({ hasText: /Rendering/ });
  await expect(note).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await expect(note).toHaveCount(0, { timeout: 30_000 });
  const src = await page.locator('iframe[title="Report PDF preview"]').getAttribute('src');
  expect(src, 'the preview iframe').toBeTruthy();
  const b64 = await page.evaluate(async (u) => {
    const buf = new Uint8Array(await (await fetch(u.split('#')[0])).arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, src!);
  const dir = join(SHOTS || '/tmp/pf-p5', 'pdf');
  mkdirSync(dir, { recursive: true });
  const pdf = join(dir, `${name}.pdf`);
  writeFileSync(pdf, Buffer.from(b64, 'base64'));
  try { execFileSync('pdftoppm', ['-r', '60', '-png', pdf, join(dir, name)]); } catch { /* poppler not installed */ }
  return execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' });
}

test('designer: Letterhead type - digital slim, pre-printed paper with a measured scan, image letterhead', async ({ browser }) => {
  const scan = await stationeryPng(), strip = await stripPng();
  for (const theme of THEMES) {
    const { page } = await openAs(browser, ADMIN, '/admin/reports', { theme });
    const card = page.locator('pf-report-letterhead-card');
    await expect(card).toBeVisible({ timeout: 60_000 });
    const tile = (n: RegExp) => card.getByRole('radio', { name: n });
    await expect(tile(/^Digital/)).toHaveAttribute('aria-checked', 'true');
    await card.scrollIntoViewIfNeeded();
    await shot(page, `p5-editor-digital-${theme}`);

    // Digital: slim later pages.
    await card.getByRole('radio', { name: 'Slim' }).click();
    await previewPdf(page, `digital-slim-${theme}`);
    await shot(page, `p5-editor-digital-slim-${theme}`);

    // Pre-printed paper: upload a scan, we measure it.
    await tile(/^Pre-printed paper/).click();
    await expect(tile(/^Pre-printed paper/)).toHaveAttribute('aria-checked', 'true');
    await card.locator('input[type=file]').setInputFiles(scan);
    await expect(card.locator('.pf-lhc-note')).toContainText(/Measured 4\d mm at the top and 2\d mm at the bottom/, { timeout: 60_000 });
    const top = Number(await card.locator('.pf-lhc-mm input').nth(0).inputValue());
    const bottom = Number(await card.locator('.pf-lhc-mm input').nth(1).inputValue());
    expect(top, 'measured top (ink to 40 mm + 2)').toBeGreaterThanOrEqual(41); expect(top).toBeLessThanOrEqual(43);
    expect(bottom, 'measured bottom (ink from 26 mm + 2)').toBeGreaterThanOrEqual(27); expect(bottom).toBeLessThanOrEqual(29);
    await previewPdf(page, `preprinted-digital-${theme}`);
    await shot(page, `p5-editor-preprinted-${theme}`);

    // Image letterhead.
    await tile(/^Image letterhead/).click();
    await card.locator('input[type=file]').setInputFiles(strip);
    await expect(card.getByText('Replace the letterhead image')).toBeVisible({ timeout: 60_000 });
    await previewPdf(page, `image-${theme}`);
    await shot(page, `p5-editor-image-${theme}`);

    // Back to Digital: the drawn letterhead returns.
    await tile(/^Digital/).click();
    const back = await previewPdf(page, `digital-back-${theme}`);
    expect(back).toMatch(/\S/);
    await shot(page, `p5-editor-back-digital-${theme}`);
  }
});
