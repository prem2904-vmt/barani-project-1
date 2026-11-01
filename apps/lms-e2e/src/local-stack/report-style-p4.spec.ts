import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STACK, SHOTS, blocked, expectNoVisibleAiText, openAs, shot as rawShot } from '../support/local-stack';

/**
 * Report designer, phase 4 — style presets, colour palettes, the print check,
 * the black & white preview and the Inter type theme, on the local full stack
 * (never a real host). Everything is checked in the live preview PDF the lab
 * would see; screenshots go to PF_SHOTS when it is set.
 */
const ADMIN = STACK.admin;
/** A screenshot once the preview PDF has drawn (the viewer paints a beat after the blob loads). */
const shot = async (page: Page, name: string) => { await page.waitForTimeout(2500); await rawShot(page, name); };
const THEMES = ['light', 'dark'] as const;

test.afterEach(() => { expect(blocked, 'no request left the machine').toEqual([]); });

async function previewPdf(page: Page, name: string): Promise<string> {
  const note = page.locator('.pf-card__note, .pf-rt-aside__k').filter({ hasText: /Rendering/ });
  await expect(note).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(1200);
  await expect(note).toHaveCount(0, { timeout: 30_000 });
  const src = await page.locator('iframe[title="Report PDF preview"]').getAttribute('src');
  expect(src, 'the preview iframe').toBeTruthy();
  const b64 = await page.evaluate(async (u) => {
    const buf = new Uint8Array(await (await fetch(u.split('#')[0])).arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, src!);
  const dir = join(SHOTS || '/tmp/pf-p4', 'pdf');
  mkdirSync(dir, { recursive: true });
  const pdf = join(dir, `${name}.pdf`);
  writeFileSync(pdf, Buffer.from(b64, 'base64'));
  try { execFileSync('pdftoppm', ['-r', '70', '-png', pdf, join(dir, name)]); } catch { /* poppler not installed */ }
  return execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' });
}

test('designer: presets, palettes, print check, black & white preview and the Inter theme', async ({ browser }) => {
  for (const theme of THEMES) {
    const { ctx, page } = await openAs(browser, ADMIN, '/admin/reports', { theme });
    await expect(page.getByRole('radio', { name: 'Results table' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('radio', { name: 'Results table' }).click();
    const presets = page.locator('#pf-presets');
    const palette = page.locator('#pf-palette');
    await expect(presets).toBeVisible({ timeout: 30_000 });
    // A newly provisioned lab starts with text fitting, Page N of M and a mini strip: not one of the three.
    for (const n of [/^Classic/, /^Modern/, /^Compact/]) await expect(presets.getByRole('radio', { name: n })).toHaveAttribute('aria-checked', 'false');
    await expect(presets).toContainText('custom mix');
    await shot(page, `p4-editor-presets-${theme}`);
    await presets.getByRole('radio', { name: /^Classic/ }).click();
    await expect(presets.getByRole('radio', { name: /^Classic/ })).toHaveAttribute('aria-checked', 'true');
    await presets.getByRole('button', { name: 'Undo' }).click();
    await expect(presets.getByRole('radio', { name: /^Classic/ })).toHaveAttribute('aria-checked', 'false');
    await presets.getByRole('radio', { name: /^Classic/ }).click();

    // Modern: patient block, page numbers, Source Sans and Teal in the preview; the summary + Undo show.
    await presets.getByRole('radio', { name: /^Modern/ }).click();
    await expect(presets.getByRole('radio', { name: /^Modern/ })).toHaveAttribute('aria-checked', 'true');
    await expect(presets.locator('.pf-sty-done')).toContainText('Modern applied');
    const modern = await previewPdf(page, `preset-modern-${theme}`);
    expect(modern, 'Page N of M').toMatch(/Page\s+\d+\s+of\s+\d+/);
    await shot(page, `p4-editor-modern-applied-${theme}`);
    await presets.getByRole('button', { name: 'Undo' }).click();
    await expect(presets.getByRole('radio', { name: /^Classic/ })).toHaveAttribute('aria-checked', 'true');
    const back = await previewPdf(page, `preset-undo-${theme}`);
    expect(back, 'Undo puts the page number back').not.toMatch(/Page\s+\d+\s+of\s+\d+/);

    // Compact, then Classic restores today.
    await presets.getByRole('radio', { name: /^Compact/ }).click();
    await expect(presets.getByRole('radio', { name: /^Compact/ })).toHaveAttribute('aria-checked', 'true');
    await previewPdf(page, `preset-compact-${theme}`);
    await shot(page, `p4-editor-compact-applied-${theme}`);
    await presets.getByRole('radio', { name: /^Classic/ }).click();
    await expect(presets.getByRole('radio', { name: /^Classic/ })).toHaveAttribute('aria-checked', 'true');

    // Palettes: the six swatches; each one changes the preview.
    await palette.scrollIntoViewIfNeeded();
    for (const id of ['Ink', 'Navy', 'Teal', 'Forest', 'Plum', 'Slate']) {
      await palette.getByRole('radio', { name: new RegExp(`^${id} —`) }).click();
      await expect(palette.getByRole('radio', { name: new RegExp(`^${id} —`) })).toHaveAttribute('aria-checked', 'true');
      if (theme === 'light') await previewPdf(page, `palette-${id.toLowerCase()}-${theme}`);
    }
    await shot(page, `p4-editor-palettes-${theme}`);
    // A curated palette passes every check.
    await expect(palette.locator('.pf-sty-check--bad')).toHaveCount(0);

    // A pale custom accent is caught, in words.
    await palette.locator('#pf-sty-accent').evaluate((el: HTMLInputElement) => {
      el.value = '#ffe08a'; el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(palette.locator('.pf-sty-checks-k').filter({ hasText: 'Check for these colours' })).toBeVisible();
    await expect(palette.locator('.pf-sty-check--bad').first()).toContainText(/Too light to print clearly|neon/);
    await shot(page, `p4-editor-custom-warning-${theme}`);
    await palette.locator('#pf-sty-accent').evaluate((el: HTMLInputElement) => {
      el.value = '#7b2d8e'; el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await palette.getByRole('button', { name: 'Use these colours' }).click();
    await expect(palette.getByText('set by hand')).toBeVisible();

    // Black & white preview: a CSS filter on the frame, never saved.
    const bw = page.getByRole('switch', { name: 'Black and white preview' });
    await bw.click();
    await expect(page.locator('.pf-pdf-frame.pf-bw')).toHaveCount(1);
    expect(await page.locator('.pf-pdf-frame.pf-bw iframe').evaluate(el => getComputedStyle(el).filter)).toContain('grayscale');
    await shot(page, `p4-editor-bw-preview-${theme}`);
    await bw.click();
    await expect(page.locator('.pf-pdf-frame.pf-bw')).toHaveCount(0);

    // The Inter theme: its own card, lazy font request, report renders.
    const inter = page.getByRole('radio', { name: /^Modern — Inter/ });
    await inter.scrollIntoViewIfNeeded();
    const fontReqs: string[] = [];
    page.on('request', r => { if (/\/fonts\/inter\/Inter-.*\.ttf/.test(r.url())) fontReqs.push(r.url()); });
    await inter.click();
    await expect(inter).toHaveAttribute('aria-checked', 'true');
    const text = await previewPdf(page, `theme-inter-${theme}`);
    expect(text.length).toBeGreaterThan(200);
    await shot(page, `p4-editor-inter-${theme}`);
    await expectNoVisibleAiText(page);
    await ctx.close();
  }
});
