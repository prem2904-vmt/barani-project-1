import { test, expect, type Page } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { STACK, blocked, expectNoVisibleAiText, openAs, shot } from '../support/local-stack';

/**
 * Test Master → Pending changes (beta `assistant`), on the LOCAL full stack.
 * Needs the mw host started with PF_LAB_E2E_TM=1 (LabFlowE2EHost seeds one
 * batch of proposals through the real propose path at boot; dropping
 * `<PF_STACK>.tmseed` seeds a fresh batch and rewrites `<PF_STACK>.tm.json`).
 * Every action is ONE proposal at a time — there is no bulk control to test.
 *  - a price change: Approve → applied
 *  - a clinical edit: Approve opens the SOP checkbox dialog; Approve stays
 *    disabled until it is ticked
 *  - a changed-since-suggested price: no Approve until Re-review
 *  - Reject with a note
 * Screenshots: light + dark desktop, phone (list + sheet), the clinical dialog.
 */
type Seed = { batch: number; price: string; priceLabel: string; clinical: string; clinicalLabel: string; stale: string; staleLabel: string;
  reject: string; rejectLabel: string; failed: string; failedLabel: string; create?: string; bundle?: string; offered?: string; guessed?: string; error?: string };

const STACK_PATH = process.env['PF_STACK'] ?? '';
const ADMIN = STACK.admin;

function readSeed(): Seed | null {
  try { return JSON.parse(readFileSync(`${STACK_PATH}.tm.json`, 'utf8')) as Seed; } catch { return null; }
}

/** A fresh batch of proposals from the host (rows from earlier batches stay in the inbox too). */
async function freshBatch(): Promise<Seed> {
  const before = readSeed()?.batch ?? -1;
  writeFileSync(`${STACK_PATH}.tmseed`, '1');
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 500));
    const s = readSeed();
    if (s?.error) throw new Error(`seed failed: ${s.error}`);
    if (s && s.batch > before && !existsSync(`${STACK_PATH}.tmseed`)) return s;
  }
  throw new Error('the host did not seed a new batch (started with PF_LAB_E2E_TM=1?)');
}

/** API as the admin WITH the beta header (the inbox answers an empty 404 without it). */
async function tm<T = Record<string, unknown>>(path: string): Promise<T> {
  const res = await fetch(`${STACK.apiUrl}/api/tm-proposals${path}`, {
    headers: { authorization: `Bearer ${ADMIN.authId}`, 'X-PF-BETA': 'assistant' },
  });
  const j = await res.json() as { data: T };
  return j.data;
}

async function openPending(page: Page) {
  await expect(page.locator('pf-tm-pending-panel')).toBeVisible({ timeout: 40_000 });
  await expect(page.locator('.pf-tmp__grid .ag-row').first()).toBeVisible({ timeout: 30_000 });
}

async function pickRow(page: Page, label: string) {
  const row = page.locator('.pf-tmp__grid .ag-row').filter({ hasText: label }).first();
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await expect(page.locator('[data-tmp-detail] .pf-tmp__target')).toHaveText(label, { timeout: 15_000 });
}

test.afterEach(() => { expect(blocked, 'no request left the machine').toEqual([]); });

test('screens: Pending (N) in the band, the list + review card, light and dark, phone sheet', async ({ browser }) => {
  const seed = await freshBatch();
  for (const theme of ['light', 'dark'] as const) {
    const { ctx, page } = await openAs(browser, ADMIN, '/admin/tests?view=pending', { theme, beta: ['assistant'] });
    await openPending(page);
    // The band switch carries "Pending" with its count; no bulk control anywhere.
    await expect(page.locator('pf-segmented').getByText('Pending').first()).toBeVisible();
    await expect(page.getByText(/approve all|select all|accept all/i)).toHaveCount(0);
    expect(await page.locator('.pf-tmp input[type="checkbox"], .pf-tmp [role="checkbox"]').count()).toBe(0);
    expect(await page.locator('.pf-tmp__grid .ag-row').count()).toBeGreaterThanOrEqual(5);
    await pickRow(page, seed.clinicalLabel);
    await expect(page.locator('[data-tmp-clinical]')).toBeVisible();
    await expectNoVisibleAiText(page);
    await shot(page, `tm-pending-clinical-${theme}`);
    await pickRow(page, seed.staleLabel);
    await expect(page.locator('[data-tmp-stale]')).toBeVisible();
    await shot(page, `tm-pending-stale-${theme}`);
    await pickRow(page, seed.failedLabel);
    await expect(page.locator('[data-tmp-failed]')).toBeVisible();
    await shot(page, `tm-pending-failed-${theme}`);
    await pickRow(page, seed.priceLabel);
    await shot(page, `tm-pending-price-${theme}`);
    await ctx.close();
  }
  for (const theme of ['light', 'dark'] as const) {
    const { ctx, page } = await openAs(browser, ADMIN, '/admin/tests?view=pending', { theme, beta: ['assistant'], viewport: { width: 390, height: 844 } });
    await openPending(page);
    await shot(page, `tm-pending-phone-list-${theme}`);
    await page.locator('.pf-tmp__grid .ag-row').filter({ hasText: seed.clinicalLabel }).first().click();
    await expect(page.locator('.pf-tmp__side--sheet [data-tmp-detail]')).toBeVisible({ timeout: 15_000 });
    await shot(page, `tm-pending-phone-sheet-${theme}`);
    // Approve from the sheet: the dialog is on top and clickable (the sheet steps aside).
    await page.locator('.pf-tmp__side--sheet [data-tmp-approve]').click();
    await expect(page.locator('.pf-dh-check')).toBeVisible();
    await shot(page, `tm-pending-phone-dialog-${theme}`);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.pf-tmp__side--sheet')).toBeVisible();
    await ctx.close();
  }
});

test('a price change: Approve applies it', async ({ browser }) => {
  const seed = await freshBatch();
  const { ctx, page } = await openAs(browser, ADMIN, '/admin/tests?view=pending', { beta: ['assistant'] });
  await openPending(page);
  await pickRow(page, seed.priceLabel);
  await expect(page.locator('.pf-tmp__diff thead th')).toHaveText(['Field', 'Current', 'Proposed']);
  await page.locator('[data-tmp-approve]').click();
  await expect(page.getByText(`Approved: ${seed.priceLabel}`).first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await tm<{ status: string }>(`/${seed.price}`)).status).toBe('approved');
  await ctx.close();
});

test('a clinical change needs the SOP checkbox; Approve stays disabled until it is ticked', async ({ browser }) => {
  const seed = await freshBatch();
  for (const theme of ['light', 'dark'] as const) {
    const { ctx, page } = await openAs(browser, ADMIN, '/admin/tests?view=pending', { theme, beta: ['assistant'] });
    await openPending(page);
    await pickRow(page, seed.clinicalLabel);
    await page.locator('[data-tmp-approve]').click();
    const approve = page.locator('pf-touch-btn[data-action="approve"] button');
    await expect(page.getByText('Clinical values change')).toBeVisible();
    await expect(page.getByText('I checked these values against the lab’s SOP')).toBeVisible();
    await expect(approve).toBeDisabled();
    await page.locator('.pf-dh-check').click();
    await expect(approve).toBeEnabled();
    await shot(page, `tm-pending-clinical-dialog-${theme}`);
    if (theme === 'light') { await page.getByRole('button', { name: 'Cancel' }).click(); await ctx.close(); continue; }
    await approve.click();
    await expect(page.getByText(`Approved: ${seed.clinicalLabel}`).first()).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await tm<{ status: string }>(`/${seed.clinical}`)).status).toBe('approved');
    await ctx.close();
  }
});

test('a change made since it was suggested must be re-reviewed before Approve', async ({ browser }) => {
  const seed = await freshBatch();
  const { ctx, page } = await openAs(browser, ADMIN, '/admin/tests?view=pending', { beta: ['assistant'] });
  await openPending(page);
  await pickRow(page, seed.staleLabel);
  await expect(page.locator('[data-tmp-stale]')).toContainText('Changed since suggested');
  await expect(page.locator('.pf-tmp__diff thead th')).toHaveText(['Field', 'Current now', 'At proposal', 'Proposed']);
  await expect(page.locator('[data-tmp-approve]')).toHaveCount(0);
  await page.locator('[data-tmp-rereview]').click();
  await expect(page.locator('[data-tmp-approve]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-tmp-stale]')).toHaveCount(0);
  await page.locator('[data-tmp-approve]').click();
  await expect.poll(async () => (await tm<{ status: string }>(`/${seed.stale}`)).status).toBe('approved');
  await ctx.close();
});

test('reject with a note', async ({ browser }) => {
  const seed = await freshBatch();
  const { ctx, page } = await openAs(browser, ADMIN, '/admin/tests?view=pending', { beta: ['assistant'] });
  await openPending(page);
  await pickRow(page, seed.rejectLabel);
  await expect(page.locator('[data-tmp-source]')).toHaveText('Outside assistant through the AI connector · claude-desktop');
  await page.locator('[data-tmp-reject]').click();
  await page.locator('textarea.pf-dh-field').fill('Old partner list, not our prices');
  await shot(page, 'tm-pending-reject-dialog-light');
  await page.locator('.pf-dh-actions pf-touch-btn').filter({ hasText: 'Reject' }).locator('button').click();
  await expect(page.getByText(`Rejected: ${seed.rejectLabel}`).first()).toBeVisible({ timeout: 20_000 });
  const row = await tm<{ status: string; resolutionNote: string }>(`/${seed.reject}`);
  expect(row.status).toBe('rejected');
  expect(row.resolutionNote).toBe('Old partner list, not our prices');
  await ctx.close();
});
