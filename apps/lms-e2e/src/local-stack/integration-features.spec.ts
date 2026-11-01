import { test, expect, type Browser, type Page } from '@playwright/test';
import {
  STACK, api, platform, openAs, shot, expectNoVisibleAiText, expectNothingBlocked, blocked, type OpenOpts,
} from '../support/local-stack';
import { registerPatient, createOrder, collectSample, enterResult, type RegisteredPatient, type PlacedOrder, type EnteredResult } from '../support/flows';

/**
 * Integration 2026-11-01 — tonight's features end to end on the LOCAL stack
 * (see playwright.local.config.ts): Share to Messages, Edit referral →
 * amended report, PF Sense switches + monthly limit, analyzer images empty
 * state, and the "no visible AI text" rule. One clinical record is driven
 * through the real UI first and reused by the later steps (serial).
 */
test.describe.configure({ mode: 'serial' });

// Which test made a blocked request (the list is shared by the worker).
let seenBlocked = 0;
test.afterEach(async ({}, info) => {
  const fresh = blocked.slice(seenBlocked);
  seenBlocked = blocked.length;
  if (fresh.length) console.log(`[blocked during "${info.title}"]`, fresh.join(' | '));
});

const ADMIN = STACK.admin;
const ASHA = STACK.colleague;
let patient: RegisteredPatient;
let order: PlacedOrder;
let result: EnteredResult;

async function adminPage(browser: Browser, path: string, opts: OpenOpts = {}): Promise<Page> {
  const { page } = await openAs(browser, ADMIN, path, opts);
  return page;
}

/** The patient's order detail (profile `?order=<id>` deep link). */
async function openOrderDetail(page: Page) {
  if (!page.url().includes('order=')) await page.goto(`/frontdesk/patients/${patient.patientId}?order=${order.orderId}`);
  await expect(page.locator('.pf-lo-detail__acts')).toBeVisible({ timeout: 20_000 });
}

/** Send whatever the open share sheet holds to Asha. */
async function sendToAsha(page: Page) {
  const sheet = page.locator('.pf-ss[role="dialog"]');
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  await sheet.getByPlaceholder('Search people and groups').fill('Asha');
  await sheet.locator('.pf-ss__row', { hasText: ASHA.name }).first().click();
  const [resp] = await Promise.all([
    page.waitForResponse(r => /\/api\/(chat|messages|conversations|share)/i.test(r.url()) && r.request().method() === 'POST', { timeout: 20_000 }),
    sheet.getByRole('button', { name: /^Send/ }).click(),
  ]);
  expect(resp.ok()).toBe(true);
  await expect(sheet).toBeHidden({ timeout: 15_000 });
}

test('clinical record: register → order → collect → result (auto-validated, final report)', async ({ browser }) => {
  const page = await adminPage(browser, '/');
  patient = await registerPatient(page);
  await expectNoVisibleAiText(page);
  order = await createOrder(page, patient);
  const sample = await collectSample(page, order.orderId);
  result = await enterResult(page, order, sample);
  expect(result.status).toBe('validated');
  await expectNoVisibleAiText(page);
  await page.context().close();
});

test('(a) share a patient, an order and a result value to a colleague; the receiver opens the card', async ({ browser }) => {
  const page = await adminPage(browser, `/frontdesk/patients/${patient.patientId}`);
  // Patient — More actions → Send to a colleague.
  await page.getByRole('button', { name: 'More actions' }).first().click();
  await page.getByRole('menuitem', { name: /Send to a colleague/ }).click();
  await sendToAsha(page);
  await expectNoVisibleAiText(page);

  // Order — Lab Orders → the order → Send to colleague.
  await openOrderDetail(page);
  await page.getByRole('button', { name: 'Send to colleague' }).first().click();
  await sendToAsha(page);

  // Result value — result entry → "Ask about <parameter>".
  await page.goto(`/lab/sample/${result.sampleId}`);
  await page.getByRole('button', { name: new RegExp(`^Ask about ${result.testName}`) }).first().click();
  await sendToAsha(page);
  await expectNoVisibleAiText(page);
  await page.context().close();

  // Receiver: Asha opens Messages → the chat with the admin → three cards.
  for (const theme of ['light', 'dark'] as const) {
    const { ctx, page: asha } = await openAs(browser, ASHA, '/messages', { theme });
    await asha.locator('.pf-mnd-row', { hasText: ADMIN.name }).first().click();
    // This run's three cards (a rerun on the same DB keeps older ones above).
    const cards = asha.locator('pf-share-card');
    const mine = cards.filter({ hasText: patient.firstName });
    await expect(mine).toHaveCount(2, { timeout: 20_000 });                // patient + order
    await expect(mine.filter({ hasNotText: /LAB-/ })).toHaveCount(1);     // patient
    await expect(mine.filter({ hasText: /LAB-/ })).toHaveCount(1);        // order (its number)
    const resultCard = cards.filter({ hasText: `sample ${result.barcode}` });
    await expect(resultCard).toHaveCount(1);                                // the result value
    await expect(resultCard).toContainText(`${result.testName} ${result.value}`);
    await resultCard.scrollIntoViewIfNeeded();
    await expectNoVisibleAiText(asha);
    await shot(asha, `share-card-messages-${theme}`);
    if (theme === 'light') {
      // Open the result card → lands on that sample's result entry, the row in focus.
      await resultCard.click();
      await asha.waitForURL(new RegExp(`/lab/sample/${result.sampleId}`), { timeout: 20_000 });
      await expect(asha.locator('tr.pf-sre__grow', { hasText: result.testName })).toBeVisible({ timeout: 20_000 });
      // And the patient card → that patient's profile.
      await asha.goBack();
      await asha.locator('pf-share-card').filter({ hasText: patient.firstName }).filter({ hasNotText: /LAB-/ }).first().click();
      await asha.waitForURL(new RegExp(`/frontdesk/patients/${patient.patientId}`), { timeout: 20_000 });
    }
    await ctx.close();
  }
});

test('(b) edit referral on an order with a released report → amended report shows the new doctor', async ({ browser }) => {
  const before = await api<{ id: string; status?: string; version?: number }>(ADMIN, 'GET', `/api/reports/by-order/${order.orderId}`);
  expect(before?.id).toBeTruthy();
  const doctor = `Dr. Kavitha Subramanian ${Date.now().toString().slice(-4)}`;

  for (const theme of ['light', 'dark'] as const) {
    const page = await adminPage(browser, `/frontdesk/patients/${patient.patientId}?order=${order.orderId}`, { theme });
    await openOrderDetail(page);
    // The order's ⋮ menu → Edit referral.
    await page.locator('.pf-lo-act--more').first().click();
    await page.getByRole('menuitem', { name: /Edit referral/ }).click();
    const dlg = page.locator('.pf-erd[role="dialog"]');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('.pf-erd__note')).toContainText('amended report');
    await expectNoVisibleAiText(page);
    await shot(page, `edit-referral-dialog-${theme}`);
    if (theme === 'dark') { await dlg.getByRole('button', { name: 'Cancel' }).click(); await page.context().close(); break; }

    // Pick a new doctor (typed → "Add …").
    await dlg.locator('#pf-erd-doctor .pf-dd__trigger').first().click();
    await dlg.locator('#pf-erd-doctor input.pf-dd__combox').fill(doctor);
    await page.getByRole('option', { name: new RegExp(`Add.*${doctor.split(' ').slice(-1)[0]}`) }).first().click();
    await dlg.locator('#pf-erd-reason').fill('Wrong doctor picked at booking');
    await dlg.getByRole('button', { name: 'Save referral' }).click();
    // One confirm (DialogService) before the amended report is issued.
    const amend = page.getByRole('button', { name: 'Save and amend' });
    await expect(amend).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(`amended report referred by ${doctor}`)).toBeVisible();
    const [patch] = await Promise.all([
      page.waitForResponse(r => /\/api\/orders\/[0-9a-f-]{36}\/referral$/i.test(r.url()) && r.request().method() !== 'GET', { timeout: 20_000 }),
      amend.click(),
    ]);
    expect(patch.ok()).toBe(true);
    await expect(dlg).toBeHidden({ timeout: 20_000 });
    await page.context().close();
  }

  // Server truth: the report for this order is now an amended one carrying the new doctor.
  await expect.poll(async () => {
    const r = await api<Record<string, unknown>>(ADMIN, 'GET', `/api/reports/by-order/${order.orderId}`);
    return JSON.stringify(r);
  }, { timeout: 20_000 }).toContain(doctor);
  const after = await api<Record<string, unknown>>(ADMIN, 'GET', `/api/reports/by-order/${order.orderId}`);
  expect(JSON.stringify(after).toLowerCase()).toContain('amend');

  // And the report viewer shows it.
  for (const theme of ['light', 'dark'] as const) {
    const page = await adminPage(browser, `/frontdesk/patients/${patient.patientId}?order=${order.orderId}`, { theme });
    await openOrderDetail(page);
    await page.locator('.pf-lo-act--report').first().click();
    await page.waitForTimeout(2500);
    await shot(page, `amended-report-${theme}`);
    await page.context().close();
  }
});

test('(c) PF Sense: platform switch hides the assistant and the server refuses; cap reached → "PF Sense is resting"', async ({ browser }) => {
  const beta = ['assistant'];
  // Off for the instruments assistant.
  await platform('PUT', `/tenants/${STACK.tenantId}/pf-sense`, { features: { instruments_assistant: false } });
  const status = await api<{ features: Record<string, boolean> }>(ADMIN, 'GET', '/api/pf-sense/status');
  expect(status.features['instruments_assistant']).toBe(false);
  let page = await adminPage(browser, '/admin/instruments', { beta });
  await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  await expect(page.getByRole('button', { name: /Ask Cortex/ })).toHaveCount(0);
  await expectNoVisibleAiText(page);
  const refused = await fetch(`${STACK.apiUrl}/api/assistant/instruments/chat`, {
    method: 'POST', headers: { authorization: `Bearer ${ADMIN.authId}`, 'content-type': 'application/json', 'X-PF-BETA': 'assistant' },
    body: JSON.stringify({ provider: 'gemini', messages: [{ role: 'user', content: 'hello' }] }),
  });
  const refusedText = await refused.text();
  expect(refusedText).toMatch(/pf_sense_off|turned off/);
  await page.context().close();

  // Back on, but the month's cap (120 tokens already used) set below usage.
  await platform('PUT', `/tenants/${STACK.tenantId}/pf-sense`, { features: { instruments_assistant: true }, capTokens: 100 });
  const s2 = await api<{ limitReached: boolean }>(ADMIN, 'GET', '/api/pf-sense/status');
  expect(s2.limitReached).toBe(true);
  for (const theme of ['light', 'dark'] as const) {
    page = await adminPage(browser, '/admin/instruments', { beta, theme });
    const btn = page.getByRole('button', { name: /Ask Cortex/ }).first();
    await expect(btn).toBeVisible({ timeout: 20_000 });
    await btn.click();
    await expect(page.getByText('Cortex is resting')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Cortex limit reached for this month — ask your admin.')).toBeVisible();
    await expectNoVisibleAiText(page);
    await shot(page, `pf-sense-limit-${theme}`);
    await page.context().close();
  }

  // Cap back to the default: the panel works; a held model call shows the thinking sparkle.
  await platform('PUT', `/tenants/${STACK.tenantId}/pf-sense`, { capTokens: null });
  for (const theme of ['light', 'dark'] as const) {
    const { ctx, page: p } = await openAs(browser, ADMIN, '/admin/instruments', { beta, theme });
    // No model may be called from a test: the engine list and the reply are answered in-page
    // (the reply is held so the "thinking" state stays on screen).
    await ctx.route(/\/api\/assistant\/providers/, r => r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [{ id: 'gemini', label: 'Engine 1', available: true, isDefault: true }] }) }));
    await ctx.route(/\/api\/assistant\/[^/]+\/chat/, () => new Promise(() => { /* held: thinking */ }));
    await p.reload();
    await p.getByRole('button', { name: /Ask Cortex/ }).first().click();
    const box = p.locator('.pf-asst textarea, .pf-asst input[type="text"]').first();
    await expect(box).toBeVisible({ timeout: 15_000 });
    await box.fill('Why is my analyzer not connecting?');
    await box.press('Enter');
    await expect(p.locator('.pf-asst__mark[data-ai-working="true"]')).toBeVisible({ timeout: 10_000 });
    await expect(p.getByText(/Cortex is thinking/)).toBeVisible();
    await expectNoVisibleAiText(p);
    await shot(p, `assistant-thinking-${theme}`);
    await ctx.close();
  }
});

test('(d) analyzer images: a new instrument shows the empty note, no sample graphs', async ({ browser }) => {
  const inst = await api<{ id: string }>(ADMIN, 'POST', '/api/instruments', {
    name: 'Bench analyzer E2E', make: 'Simulator', model: 'SIM-5P', serialNumber: `SIM-${Date.now().toString().slice(-6)}`,
    config: { transport: { type: 'tcp-server', port: 5011, host: '0.0.0.0' }, link: { type: 'auto' }, parser: { type: 'auto' } },
  });
  for (const theme of ['light', 'dark'] as const) {
    const page = await adminPage(browser, `/admin/instruments/${inst.id}`, { theme });
    // The images section lives on the editor's "Code mapping" tab.
    await page.getByRole('tab', { name: /Code mapping/ }).click();
    const section = page.locator('section.pf-ie-images');
    await expect(section).toBeVisible({ timeout: 15_000 });
    await expect(section.locator('.pf-ie-imgs__empty')).toHaveText(/No graphs received from this analyzer yet/);
    await expect(section.locator('.pf-ie-img')).toHaveCount(0);
    await expect(section).not.toContainText('sample shown');
    await section.scrollIntoViewIfNeeded();
    await expectNoVisibleAiText(page);
    await shot(page, `analyzer-images-empty-${theme}`);
    await page.context().close();
  }
});

test('(e) no visible "AI" text on the main screens; nothing reached a remote host', async ({ browser }) => {
  const page = await adminPage(browser, '/', { beta: ['assistant'] });
  for (const path of ['/frontdesk', `/frontdesk/patients/${patient.patientId}`, '/lab/my-work', '/lab/receive', '/pathologist',
    '/messages', '/admin/instruments', '/insights', '/admin/lab-settings', '/reports']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(800);
    await expectNoVisibleAiText(page);
  }
  await page.context().close();
  expectNothingBlocked();
});
