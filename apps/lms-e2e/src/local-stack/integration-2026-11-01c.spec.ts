import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STACK, SHOTS, api, blocked, expectNoVisibleAiText, openAs, platform, shot } from '../support/local-stack';

/**
 * Integration 2026-11-01c — the report designer's new style switches and the
 * "fresh lab" report template, on the local full stack (never a real host):
 *  - designer: Fit long text, "45 Y / Male", Page N of M and Compact all show in
 *    the PDF preview; the Issues chip is gone while Fit long text is on.
 *  - a newly provisioned lab gets a report template row that starts from the SAME
 *    product default a template-less lab prints (only the style keys differ).
 * Needs `PF_DB` (the local prefrontal_test_* database the host runs on) for the
 * provisioned tenant's login id and for removing a row to stand in for an old lab.
 * Everything is local; nothing is written anywhere else.
 */
const ADMIN = STACK.admin;
const THEMES = ['light', 'dark'] as const;
const PF_DB = process.env['PF_DB'] ?? '';

test.afterEach(() => { expect(blocked, 'no request left the machine').toEqual([]); });

function psql(sql: string): string {
  if (!/^prefrontal_test_/.test(PF_DB)) throw new Error('PF_DB must be a local prefrontal_test_* database');
  return execFileSync('psql', ['-d', PF_DB, '-Atc', sql], { encoding: 'utf8' }).trim();
}

/** The designer's preview PDF (the iframe blob) saved to SHOTS/<name>.pdf, plus its text and a PNG of page 1 (and 2). */
async function previewPdf(page: Page, name: string): Promise<string> {
  await expect(page.locator('.pf-card__note, .pf-rt-aside__k').filter({ hasText: /Rendering/ })).toHaveCount(0, { timeout: 30_000 });
  await page.waitForTimeout(900);
  await expect(page.locator('.pf-card__note, .pf-rt-aside__k').filter({ hasText: /Rendering/ })).toHaveCount(0, { timeout: 30_000 });
  const src = await page.locator('iframe[title="Report PDF preview"]').getAttribute('src');
  expect(src, 'the preview iframe').toBeTruthy();
  const b64 = await page.evaluate(async (u) => {
    const buf = new Uint8Array(await (await fetch(u.split('#')[0])).arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, src!);
  mkdirSync(SHOTS, { recursive: true });
  const pdf = join(SHOTS, `${name}.pdf`);
  writeFileSync(pdf, Buffer.from(b64, 'base64'));
  execFileSync('pdftoppm', ['-r', '70', '-png', pdf, join(SHOTS, name)]);
  return execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' });
}

async function sw(page: Page, label: string, on: boolean) {
  const el = page.getByRole('switch', { name: label, exact: true });
  await expect(el).toBeVisible({ timeout: 20_000 });
  if ((await el.getAttribute('aria-checked')) !== String(on)) await el.click();
  await expect(el).toHaveAttribute('aria-checked', String(on));
}

test('report designer: Fit long text, "45 Y / Male", Page N of M and Compact show in the preview; Issues clears with fit on', async ({ browser }) => {
  for (const theme of THEMES) {
    const { ctx, page } = await openAs(browser, ADMIN, '/admin/reports', { theme });
    await expect(page.getByRole('radio', { name: 'Patient strip' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('radio', { name: 'Patient strip' }).click();
    await expect(page.locator('iframe[title="Report PDF preview"]')).toBeVisible({ timeout: 60_000 });

    // Fit OFF first: where long names can overlap, the Issues chip shows; turning Fit ON clears it.
    await sw(page, 'Fit long text', false);
    await page.waitForTimeout(2500);
    const chip = page.locator('.pf-rt-issues');
    const chipWhenOff = await chip.count();
    await shot(page, `designer-fit-off-${theme}`);
    await sw(page, 'Fit long text', true);
    await expect(chip).toHaveCount(0, { timeout: 30_000 });
    test.info().annotations.push({ type: `issues-chip-when-fit-off-${theme}`, description: String(chipWhenOff) });

    // Age & sex as one field: "45 Y / Male".
    await page.getByRole('radio', { name: 'One field' }).click();
    await expect(page.locator('.pf-ps-sample__v')).toContainText('45 Y / Male');
    // Page N of M.
    await sw(page, 'Page N of M', true);
    await shot(page, `designer-patient-${theme}`);

    // Compact density (Results table tab).
    await page.getByRole('radio', { name: 'Results table' }).click();
    await page.getByRole('radio', { name: 'Compact', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Compact', exact: true })).toBeChecked();
    await shot(page, `designer-density-${theme}`);

    const text = await previewPdf(page, `designer-preview-${theme}`);
    expect(text, 'Page N of M in the preview footer').toMatch(/Page\s+\d+\s+of\s+\d+/);
    expect(text, 'age / sex as one field in the preview').toMatch(/45\s*Y\s*\/\s*Male|\d+\s*Y\s*\/\s*(Male|Female)/);
    await expectNoVisibleAiText(page);
    await ctx.close();
  }
});

test('a fresh lab: its report template row prints the same product default as a lab with no row', async ({ browser }) => {
  const stamp = Date.now();
  const make = async (label: string) => {
    const name = `Fresh Lab ${label} ${stamp}`;
    const r = await platform<{ tenantId: string }>('POST', '/tenants', {
      name, adminEmail: `fresh-${label}-${stamp}@test.invalid`, adminFirstName: 'Fresh', adminFathersName: label, adminPassword: 'Temp-pass-1234!',
    });
    const authId = psql(`select "AuthId" from users where "TenantId"='${r.tenantId}' limit 1`);
    expect(authId, 'the provisioned admin').toMatch(/^[0-9a-f-]{36}$/);
    psql(`update users set "MustChangePassword"=false where "TenantId"='${r.tenantId}'`);   // local test DB only
    return { name, tenantId: r.tenantId, person: { authId, name: `Fresh ${label}` } };
  };
  const fresh = await make('A');      // new tenant: gets the seeded template row
  const old = await make('B');        // stands in for an old lab: its row is removed -> no row, like before
  psql(`delete from report_templates where "TenantId"='${old.tenantId}'`);

  type Tpl = Record<string, unknown> | null;
  const freshTpl = await api<Tpl>(fresh.person, 'GET', '/api/config/report-template');
  const oldTpl = await api<Tpl>(old.person, 'GET', '/api/config/report-template');
  expect(oldTpl ?? null, 'a lab with no row: the API answers null (the UI falls back to the product default)').toBeNull();
  expect(freshTpl, 'a new lab has a template row').not.toBeNull();
  expect(freshTpl!['labName']).toBe(fresh.name);
  // Same product default as a template-less lab prints.
  expect(freshTpl!['groupByDepartment']).toBe(false);
  expect(freshTpl!['tagline']).toBe('Accurate | Caring | Instant');
  expect(freshTpl!['endOfReportText']).toBe('****End of Report****');
  expect(freshTpl!['headerPreset']).toBe('classic');
  expect(freshTpl!['patientLayout']).toBe('three-col');
  expect(freshTpl!['letterpadMode']).toBe(false);
  const meta = JSON.parse(String(freshTpl!['metadata'])) as { reportStyle: unknown };
  expect(meta.reportStyle).toEqual({ fit: { enabled: true }, pageNumbers: 'n-of-m', patient: { continuation: 'mini' } });

  const texts: Record<string, string> = {};
  for (const [key, who] of [['fresh', fresh], ['old', old]] as const) {
    for (const theme of THEMES) {
      const { ctx, page } = await openAs(browser, who.person, '/admin/reports', { theme });
      await expect(page.getByRole('radio', { name: 'Patient strip' })).toBeVisible({ timeout: 60_000 });
      await shot(page, `fresh-lab-letterhead-${key}-${theme}`);
      await page.getByRole('radio', { name: 'Patient strip' }).click();
      await expect(page.locator('iframe[title="Report PDF preview"]')).toBeVisible({ timeout: 60_000 });
      await shot(page, `fresh-lab-designer-${key}-${theme}`);
      texts[`${key}-${theme}`] = await previewPdf(page, `fresh-lab-preview-${key}-${theme}`);
      await ctx.close();
    }
  }
  writeFileSync(join(SHOTS, 'fresh-lab-preview-fresh.txt'), texts['fresh-light']);
  writeFileSync(join(SHOTS, 'fresh-lab-preview-old.txt'), texts['old-light']);
  // The header / patient block / table column titles are the same lines in both; only the lab name and the
  // style keys (Page N of M, the continuation strip) may differ.
  const norm = (t: string, n: string) => t.replaceAll(n, 'LAB').replace(/Prefrontal Pathology Lab/g, 'LAB').replace(/Page\s+\d+\s+of\s+\d+|Page\s+\d+/g, 'PAGE')
    .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const a = norm(texts['fresh-light'], fresh.name), b = norm(texts['old-light'], old.name);
  const onlyFresh = a.filter(l => !b.includes(l)), onlyOld = b.filter(l => !a.includes(l));
  test.info().annotations.push({ type: 'lines-only-in-fresh', description: JSON.stringify(onlyFresh) });
  test.info().annotations.push({ type: 'lines-only-in-old', description: JSON.stringify(onlyOld) });
  writeFileSync(join(SHOTS, 'fresh-lab-diff.json'), JSON.stringify({ onlyFresh, onlyOld }, null, 2));
});
