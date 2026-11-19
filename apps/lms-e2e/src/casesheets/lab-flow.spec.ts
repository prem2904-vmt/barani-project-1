import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import {
  STACK, LAB_URL, SHOTS, api, openAs, settle, shot, expectNoVisibleAiText, expectNoNativeControls, expectNothingBlocked,
} from './cs-stack';

/**
 * LAB — a doctor's case sheet from the patient profile to the PDF and an amend, on the real stack
 * (CaseSheetsE2EHost: Micro World has ipd explicitly on; masters General Medicine / ENT authored on the platform API).
 * Prepare's ENT fixture form drives a multi-select whose options reveal follow-up fields AND switch on whole pages;
 * "Wound review" carries a photo + a body map.
 */
test.describe.configure({ mode: 'serial' });

/** A fresh invented patient per run (re-runnable on one host): the profile starts with no sheets. */
const PATIENT = { id: '', name: 'Selvi Murugan' };
const WOUND_PATIENT = { id: '', name: 'Ravi Kannan' };
async function newPatient(first: string, last: string, sex: string, dob: string): Promise<string> {
  const phone = '9' + String(Date.now()).slice(-8) + String(Math.floor(Math.random() * 10));
  const p = await api<{ id: string }>(STACK.admin, 'POST', '/api/patients', { firstName: first, fathersName: last, phone, sex, dateOfBirth: dob });
  return p.id;
}
test.beforeAll(async () => {
  PATIENT.id = await newPatient('Selvi', 'Murugan', 'Female', '1984-03-12');
  WOUND_PATIENT.id = await newPatient('Ravi', 'Kannan', 'Male', '1971-08-30');
});

let sheetId = '';

async function field(page: Page, key: string) { return page.locator(`fe-field[data-field="${key}"]`).first(); }

/** Go to a page by title: the desktop rail when shown, else the Pages menu in the bar (touch tiers). */
async function goToStep(page: Page, title: string | 'last') {
  const rail = page.locator('.lf-rail');
  if (await rail.isVisible()) {
    const s = title === 'last' ? rail.locator('.lf-step').last() : rail.locator('.lf-step', { hasText: title }).first();
    await s.click();
  } else {
    await page.locator('.lf-pages').first().click();
    const menu = page.locator('#lf-menu');
    await expect(menu).toBeVisible();
    const s = title === 'last' ? menu.locator('.lf-step').last() : menu.locator('.lf-step', { hasText: title }).first();
    await s.click();
  }
  await settle(page, 350);
}

/** Answer every still-empty field on the current page (first option / a short value). */
async function answerPage(page: Page) {
  const fields = page.locator('.lf-page fe-field');
  for (let i = 0; i < await fields.count(); i++) {
    const f = fields.nth(i);
    if (!(await f.isVisible())) continue;
    const groups = f.locator('[role="radiogroup"], [role="group"]');
    if (await f.locator('[data-option]').count()) {
      if ((await f.locator('[aria-checked="true"]').count()) === 0) await f.locator('[data-option]').first().click();
    } else if (await groups.count() && await f.locator('[aria-checked]').count()) {
      if ((await f.locator('[aria-checked="true"]').count()) === 0) await f.locator('[aria-checked]').first().click();
    }
    const inputs = f.locator('input:visible:not([type=file]), textarea:visible');
    for (let j = 0; j < await inputs.count(); j++) {
      const inp = inputs.nth(j);
      if (await inp.inputValue().catch(() => 'x')) continue;
      const numeric = /numeric|decimal/.test((await inp.getAttribute('inputmode')) ?? '') || (await inp.getAttribute('type')) === 'number';
      await inp.fill(numeric ? '3' : 'Seen in clinic').catch(() => undefined);
    }
  }
  await settle(page, 300);
}

/** Finish; while the "answers still needed" dialog lists gaps, take me there and answer that page. */
async function finishAnswering(page: Page, shotName?: string) {
  for (let round = 0; round < 25; round++) {
    await goToStep(page, 'last');
    await page.locator('.lf-finish').first().click();
    const needed = page.getByRole('dialog').filter({ hasText: /still needed/ });
    const report = page.locator('[data-report]');
    await expect(needed.or(report)).toBeVisible();
    if (await report.isVisible()) return;
    if (round === 0 && shotName) await shot(page, shotName);
    await needed.getByRole('button', { name: 'Take me there' }).click();
    await settle(page, 400);
    await answerPage(page);
  }
  throw new Error('still incomplete after 25 rounds');
}

async function nextPage(page: Page) {
  await page.locator('.lf-next').first().click();
  await settle(page, 350);
}

test('patient profile shows the Case sheet button and an empty sheet list', async ({ browser }) => {
  const { ctx, page } = await openAs(browser, STACK.doctor, `${LAB_URL}/patients/${PATIENT.id}`);
  await expect(page.locator('[data-act="casesheet"]').first()).toBeVisible();
  await expect(page.getByText('Case sheets', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('No case sheets yet.')).toBeVisible();
  await shot(page, 'lab-01-patient-profile-empty');
  await expectNoVisibleAiText(page);
  await ctx.close();
});

test('Departments for the patient → ENT → fill across pages (follow-ups, a conditional page) → narrative → finish → PDF → amend', async ({ browser }) => {
  const { ctx, page } = await openAs(browser, STACK.doctor, `${LAB_URL}/patients/${PATIENT.id}`);
  await page.locator('[data-act="casesheet"]').first().click();
  await expect(page).toHaveURL(/\/casesheets\/new\?patientId=/);
  await expect(page.getByText(`Case sheet for ${PATIENT.name}`, { exact: false })).toBeVisible();
  await shot(page, 'lab-02-departments');
  await expectNoNativeControls(page);

  await page.locator('.pf-tp__item', { hasText: 'ENT' }).first().click();
  await settle(page);
  await shot(page, 'lab-03-departments-ent-forms');
  await page.locator('.dp__tile', { hasText: 'Nose History' }).first().click();
  await expect(page).toHaveURL(/\/casesheets\/[0-9a-f-]{36}/);
  sheetId = page.url().split('/casesheets/')[1].split(/[?#]/)[0];
  await expect(page.locator('#cs-page-h')).toHaveText(/Patient Information/);
  await shot(page, 'lab-04-fill-first-page');

  // patient snapshot came from the LMS patient? (name field) — fill what's empty.
  const name = (await field(page, 'patientName')).locator('input').first();
  if (!(await name.inputValue())) await name.fill(PATIENT.name);
  const age = (await field(page, 'age')).locator('input').first();
  if (await age.count()) { if (!(await age.inputValue())) await age.fill('42'); }
  else { await (await field(page, 'age')).locator('.fe-numbox').click(); await page.keyboard.type('42'); await page.keyboard.press('Enter'); }
  await (await field(page, 'sex')).locator('[data-option="female"]').first().click().catch(async () => (await field(page, 'sex')).getByText('Female').first().click());

  // the multi-select: two complaints; each reveals its follow-up fields
  const complaints = await field(page, 'complaints');
  await complaints.scrollIntoViewIfNeeded();
  await expect(page.locator('fe-field[data-field="obstructionSide"]')).toHaveCount(0);
  await complaints.locator('[data-option="obstruction"]').first().click();
  await complaints.locator('[data-option="discharge"]').first().click();
  await expect(page.locator('fe-field[data-field="obstructionSide"]').first()).toBeVisible();
  await expect(page.locator('fe-field[data-field="dischargeSide"]').first()).toBeVisible();
  await page.locator('fe-field[data-field="obstructionSide"]').first().scrollIntoViewIfNeeded();
  await shot(page, 'lab-05-fill-multiselect-followups');
  const obsSide = page.locator('fe-field[data-field="obstructionSide"] [data-option]').first();
  if (await obsSide.count()) await obsSide.click();

  // Pages: the conditional pages (Obstruction / Discharge details) exist now
  await expect.poll(() => page.locator('.lf-step', { hasText: 'Nasal Obstruction Details' }).count(), { message: 'conditional page in the page list' }).toBeGreaterThan(0);
  await nextPage(page);
  await expect(page.locator('#cs-page-h')).toHaveText(/Timeline/);
  await shot(page, 'lab-06-fill-second-page');
  await nextPage(page);
  await expect(page.locator('#cs-page-h')).toHaveText(/Nasal Obstruction Details/);
  await page.locator('fe-field').nth(0).locator('[data-option]').first().click();
  await shot(page, 'lab-07-fill-conditional-page');

  // narrative card (side sheet)
  await page.locator('.lf-hbtn[aria-label="Narrative"]').click();
  await expect(page.locator('#cs-narrative')).toHaveClass(/lf-nv--open/);
  await shot(page, 'lab-08-narrative-card');
  await page.locator('.cs-nvclose').click();

  // jump to the last page via the rail, then Finish → report dialog
  await finishAnswering(page, 'lab-09a-finish-answers-still-needed');
  const report = page.locator('[data-report]');
  await expect(report).toBeVisible();
  const openedWith = await report.locator('.rp__body').innerText();
  // the words to check must be the CURRENT answers (Timeline was answered "3" just before Finish)
  await expect.soft(report.locator('.rp__body'), 'Edit your report shows the latest answers').toContainText('3 months', { timeout: 10_000 });
  console.log('REPORT_OPENED_STALE', !openedWith.includes('3 months'));
  await shot(page, 'lab-09-finish-report-dialog');
  await report.locator('.rp__tab', { hasText: 'PDF preview' }).click();
  await shot(page, 'lab-10-finish-report-pdf-tab');
  await report.locator('[data-finish-now]').click();

  // final view
  await expect(page.locator('app-final-view')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-fv-print]')).toBeVisible();
  await shot(page, 'lab-11-final-view');

  // PDF: the print path (session bytes → the LMS's one off-screen print frame). Headless Chrome's printer crashes the
  // renderer, so the frame is caught at hand-off: its blob URL is recorded instead of printed, and its bytes are the PDF.
  await page.evaluate(() => {
    const w = window as unknown as { __printSrc?: string };
    const orig = Node.prototype.appendChild;
    Node.prototype.appendChild = function <T extends Node>(this: Node, n: T): T {
      if (n instanceof HTMLIFrameElement && n.src.startsWith('blob:')) { w.__printSrc = n.src; return n; }
      return orig.call(this, n) as T;
    };
  });
  // (the bytes came with the session when the final view opened: GET sheets/{id}/pdf, no link)
  await page.locator('[data-fv-print]').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printSrc?: string }).__printSrc ?? ''), { message: 'the print frame' }).toMatch(/^blob:/);
  const b64 = await page.evaluate(async () => {
    const src = (window as unknown as { __printSrc: string }).__printSrc;
    const buf = new Uint8Array(await (await fetch(src)).arrayBuffer());
    let bin = ''; for (const x of buf) bin += String.fromCharCode(x);
    return btoa(bin);
  });
  const bytes = Buffer.from(b64, 'base64');
  expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
  if (SHOTS) {
    const pdfPath = join(SHOTS, 'lab-12-case-sheet.pdf');
    writeFileSync(pdfPath, bytes);
    try { execFileSync('pdftoppm', ['-png', '-r', '110', '-f', '1', '-l', '1', '-singlefile', pdfPath, join(SHOTS, 'lab-12-pdf-page1')]); }
    catch (e) { console.log('pdftoppm unavailable:', String(e).slice(0, 120)); }
  }

  // amend → a new draft
  const finalUrl = page.url();
  await page.getByRole('button', { name: /Amend/ }).click();
  const confirm = page.getByRole('dialog').filter({ hasText: 'Amend this case sheet?' });
  await expect(confirm).toBeVisible();
  await shot(page, 'lab-12b-amend-confirm');
  await confirm.getByRole('button', { name: 'Start the amendment' }).click();
  await expect(page).not.toHaveURL(finalUrl, { timeout: 20_000 });
  await expect(page.locator('app-final-view')).toHaveCount(0, { timeout: 20_000 });
  await expect(page).toHaveURL(/\/casesheets\/[0-9a-f-]{36}/);
  await shot(page, 'lab-13-amend-new-draft');
  const sheets = await api<{ items: { id: string; status: string }[] }>(STACK.doctor, 'GET', `/api/casesheets/sheets?patientId=${PATIENT.id}`);
  expect(sheets.items.length).toBeGreaterThanOrEqual(2);
  await ctx.close();
});

test('the patient profile lists the sheets; the patient sheet list page', async ({ browser }) => {
  const { ctx, page } = await openAs(browser, STACK.doctor, `${LAB_URL}/patients/${PATIENT.id}`);
  await expect(page.getByText('No case sheets yet.')).toHaveCount(0);
  await shot(page, 'lab-14-patient-profile-with-sheets');
  await page.goto(`${LAB_URL}/casesheets/patient/${PATIENT.id}`);
  await settle(page);
  await shot(page, 'lab-15-patient-sheet-list');
  await expectNoNativeControls(page);
  await ctx.close();
});

test('Wound review: a photo and the body map', async ({ browser }) => {
  const { ctx, page } = await openAs(browser, STACK.doctor, `${LAB_URL}/casesheets/new?patientId=${WOUND_PATIENT.id}`);
  await page.locator('.pf-tp__item', { hasText: 'General Medicine' }).first().click();
  await page.locator('.dp__tile', { hasText: 'Wound review' }).first().click();
  await expect(page).toHaveURL(/\/casesheets\/[0-9a-f-]{36}/);
  await (await field(page, 'complaint')).locator('input, textarea').first().fill('Non-healing wound over the left shin for 3 weeks');
  await (await field(page, 'discharge')).locator('[data-option="yes"]').first().click();
  await expect(page.locator('fe-field[data-field="dischargeType"]').first()).toBeVisible();
  await page.locator('fe-field[data-field="dischargeType"] [data-option="serous"]').first().click();
  await shot(page, 'lab-16-wound-conditional');
  // the last answer on the page auto-advances (legacy); a tap on Next here would land on the last page's Finish
  await expect(page.locator('#cs-page-h')).toHaveText(/Pictures/, { timeout: 5_000 }).catch(() => nextPage(page));
  await expect(page.locator('#cs-page-h')).toHaveText(/Pictures/);
  const upload = page.waitForResponse(r => /\/photos/.test(r.url()) && r.request().method() === 'POST', { timeout: 30_000 }).catch(() => null);
  await page.locator('fe-field[data-field="photos"] input[data-photo-input]').setInputFiles(join(__dirname, 'fixtures', 'wound.png'));
  const up = await upload;
  expect(up?.status(), 'photo upload').toBeLessThan(300);
  await settle(page, 1200);
  await shot(page, 'lab-17-photo-and-body-map');
  await page.locator('fe-field[data-field="site"]').first().scrollIntoViewIfNeeded();
  await shot(page, 'lab-18-body-map');
  await ctx.close();
});

/** A user who may build forms (Lab Admin) still sees a forked, draft-only master in Departments: Departments reads the fill view (?for=fill). */
test('a Lab Admin still sees a forked (draft-only) master in Departments', async ({ browser }) => {
  const forms = await api<{ items: { origin: string; title: string; published: unknown }[] }>(STACK.admin, 'GET', '/api/casesheets/forms?pageSize=100');
  test.skip(!forms.items.some(f => f.origin === 'override' && !f.published), 'needs the draft-only fork studio-flow makes');
  const { ctx, page } = await openAs(browser, STACK.admin, `${LAB_URL}/casesheets/new?patientId=${PATIENT.id}`);
  await expect(page.locator('.pf-tp__item', { hasText: 'ENT' })).toBeVisible({ timeout: 8_000 });
  await ctx.close();
});

test.afterAll(() => expectNothingBlocked());
