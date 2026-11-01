import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { STACK, SHOTS, blocked, expectNoVisibleAiText, openAs, shot as rawShot } from '../support/local-stack';

/**
 * Report designer, phase 7 - the Charts card on the Results table tab: trend charts as pictures or drawn
 * sharply in the report's colours, charts across the page, the range bar. Plus one combined sanity pass of
 * phases 5 + 6 (an image letterhead with the sign-off once at the end). Local full stack (never a real host);
 * the preview PDFs are saved with every page.
 */
const ADMIN = STACK.admin;
const OUT = join(SHOTS || '/tmp/pf-p7', 'files');
const shot = async (page: Page, name: string) => { await page.waitForTimeout(2500); await rawShot(page, name); };
const THEMES = ['light', 'dark'] as const;

test.afterEach(() => { expect(blocked, 'no request left the machine').toEqual([]); });

async function readPdf(page: Page, name: string): Promise<string> {
  const note = page.locator('.pf-card__note, .pf-rt-aside__k').filter({ hasText: /Rendering/ });
  await expect(note).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(2500);
  await expect(note).toHaveCount(0, { timeout: 30_000 });
  const src = await page.locator('iframe[title="Report PDF preview"]').getAttribute('src');
  expect(src, 'the preview iframe').toBeTruthy();
  const b64 = await page.evaluate(async (u) => {
    const buf = new Uint8Array(await (await fetch(u.split('#')[0])).arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, src!);
  const dir = join(SHOTS || '/tmp/pf-p7', 'pdf');
  mkdirSync(dir, { recursive: true });
  const pdf = join(dir, `${name}.pdf`);
  writeFileSync(pdf, Buffer.from(b64, 'base64'));
  try { execFileSync('pdftoppm', ['-r', '80', '-png', pdf, join(dir, name)]); } catch { /* poppler not installed */ }
  return execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' });
}

test('designer: Charts card - pictures, sharp charts (2 / 3 across / one per row), range bar, light and dark', async ({ browser }) => {
  for (const theme of THEMES) {
    const { page } = await openAs(browser, ADMIN, '/admin/reports', { theme });
    await page.getByRole('radio', { name: 'Results table' }).click();
    const card = page.locator('pf-report-chart-panel-card');
    await expect(card).toBeVisible({ timeout: 60_000 });
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByRole('radio', { name: /^Pictures/ })).toHaveAttribute('aria-checked', 'true');
    const asPictures = await readPdf(page, `trend-pictures-${theme}`);
    expect(asPictures).toMatch(/TRENDOGRAM/);
    expect(asPictures).not.toMatch(/Where it falls/);
    await shot(page, `p7-editor-pictures-${theme}`);

    await card.getByRole('radio', { name: /^Sharp/ }).click();
    await expect(card.getByRole('radio', { name: 'Two across' })).toHaveAttribute('aria-checked', 'true');
    const sharp2 = await readPdf(page, `trend-sharp-2-${theme}`);
    expect(sharp2).toMatch(/Normal range/);
    await card.scrollIntoViewIfNeeded();
    await shot(page, `p7-editor-sharp-${theme}`);

    await card.getByRole('radio', { name: 'Three across' }).click();
    await readPdf(page, `trend-sharp-3-${theme}`);
    await card.getByRole('radio', { name: 'One per row' }).click();
    await readPdf(page, `trend-sharp-list-${theme}`);
    await card.getByRole('radio', { name: 'Two across' }).click();

    await card.getByRole('switch', { name: 'Range bar' }).click();
    await expect(card.getByRole('switch', { name: 'Range bar' })).toHaveAttribute('aria-checked', 'true');
    const bar = await readPdf(page, `rangebar-${theme}`);
    expect(bar).toMatch(/Where it falls/);
    await card.scrollIntoViewIfNeeded();
    await shot(page, `p7-editor-rangebar-${theme}`);
    await expectNoVisibleAiText(page);
  }
});

test('designer: Modern preset brings sharp charts and the range bar; Classic puts the pictures back', async ({ browser }) => {
  const { page } = await openAs(browser, ADMIN, '/admin/reports', { theme: 'light' });
  await page.getByRole('radio', { name: 'Results table' }).click();
  const card = page.locator('pf-report-chart-panel-card');
  await expect(card).toBeVisible({ timeout: 60_000 });
  await page.getByRole('radio', { name: /^Modern/ }).click();
  await expect(card.getByRole('radio', { name: /^Sharp/ })).toHaveAttribute('aria-checked', 'true');
  await expect(card.getByRole('switch', { name: 'Range bar' })).toHaveAttribute('aria-checked', 'true');
  await readPdf(page, 'modern-preset');
  await shot(page, 'p7-editor-modern-preset');
  await page.getByRole('radio', { name: /^Classic/ }).click();
  await expect(card.getByRole('radio', { name: /^Pictures/ })).toHaveAttribute('aria-checked', 'true');
  await expect(card.getByRole('switch', { name: 'Range bar' })).toHaveAttribute('aria-checked', 'false');
});

test('combined P5 + P6 sanity: one image letterhead, the sign-off once at the end', async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const w = 1260, h = 240, buf = Buffer.alloc(w * h * 3, 255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    const c: [number, number, number] = y < 60 || (x > 40 && x < 200 && y > 50 && y < 210) ? [27, 94, 120] : (x > 240 && x < 900 && y > 90 && y < 120) ? [60, 70, 90] : [255, 255, 255];
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
  }
  const strip = join(OUT, 'letterhead-strip.png');
  await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toFile(strip);
  for (const theme of THEMES) {
    const { page } = await openAs(browser, ADMIN, '/admin/reports', { theme });
    const lh = page.locator('pf-report-letterhead-card');
    await expect(lh).toBeVisible({ timeout: 60_000 });
    await lh.getByRole('radio', { name: /^Image letterhead/ }).click();
    await lh.locator('input[type=file]').setInputFiles(strip);
    await expect(lh.getByText('Replace the letterhead image')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('radio', { name: 'Footer' }).click();
    const sg = page.locator('pf-report-signature-card');
    await expect(sg).toBeVisible({ timeout: 60_000 });
    await sg.getByRole('radio', { name: /Once, at the end/ }).click();
    await expect(sg).toContainText(/once, after End of Report/);
    await sg.scrollIntoViewIfNeeded();
    await shot(page, `p7-combined-footer-${theme}`);
    await page.getByRole('radio', { name: 'Results table' }).click();
    const text = await readPdf(page, `combined-p5-p6-${theme}`);
    expect(text).toMatch(/End of Report/i);
    await shot(page, `p7-combined-pdf-${theme}`);
  }
});
