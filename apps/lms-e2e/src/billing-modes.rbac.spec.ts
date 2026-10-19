import { test, expect, type Page, type Locator, type Response } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * BILLING CONFIG MODES (/admin/billing) — functional "every tab + save +
 * restore" coverage for the admin billing-configuration screen. This is the
 * "all modes" layer; RBAC gating for /admin/billing itself (who reaches the
 * screen, who can write) is already covered by admin-config-access.rbac.spec.ts
 * (route guard + Branch Manager write-block).
 *
 * Ground truth: apps/lms/src/app/features/admin/billing-config/billing-config.component.ts
 *   - 3 segmented tabs (GST Setup / Discounts / Invoice) via setTab(). The
 *     `_tab` signal always initializes to 'gst', so every `page.reload()`
 *     resets the active tab back to GST Setup — callers must re-click their
 *     tab after any reload.
 *   - ONE header "Save" button (pf-screen-header actions slot, a
 *     <pf-touch-btn>) posts the WHOLE TenantBillingConfig object via
 *     POST /api/config/billing (saveConfig()), regardless of which tab is
 *     active — toast "Billing config saved". Scoped to `pf-screen-header` so
 *     it never collides with a per-branch GSTIN row's own "Save" button (GST
 *     tab) or "Save letterhead" (Invoice tab).
 *   - The Invoice tab's letterhead/template block is a SEPARATE save action:
 *     "Save letterhead" (a plain <button>, not pf-touch-btn) posts the whole
 *     invoice-template object via POST /api/config/invoice-template
 *     (saveTpl()) — toast "Letterhead saved". Independent of the header Save.
 *   - GST tab: master pf-toggle for gstEnabled (role="switch", the only
 *     switch on this tab). Below it, a tile whose scope-cards + filing-
 *     frequency select are gated `[style.pointer-events]="gstEnabled ? 'auto'
 *     : 'none'"` — if gstEnabled is currently OFF, those controls are
 *     unclickable, so the scope test below force-enables gstEnabled first
 *     (and restores it) if needed. Scope is 3 ".pf-scope-card" buttons ("Per
 *     branch"/"Per region"/"Per tenant", active class "pf-scope-active").
 *     Per-branch GSTIN rows (their own "Save" ghost button, POST
 *     /api/config/gst) are OUT OF SCOPE here — a different endpoint, and no
 *     branch is guaranteed seeded on every dev tenant.
 *   - Discounts tab: allowDiscounts pf-toggle (only switch on this tab); the
 *     3 pf-number-input fields below it (Level-1 max %, Level-2 override %,
 *     approval threshold %) are `[disabled]="!allowDiscounts"` — same
 *     force-enable-then-restore guard applies. None of these labels are
 *     `for`-linked to their input (a plain preceding <label class="pf-label">
 *     sibling of the <pf-number-input> custom element, not a native label
 *     association), so there is no getByLabel hook; they're addressed by DOM
 *     position (`pf-number-input input.field` .nth(0/1/2), documented order).
 *   - Invoice tab: invoicePrefix is a plain text <input> that IS a direct
 *     following-sibling of its <label> (addressed via `label:text-is(...)` +
 *     `xpath=following-sibling::input[1]`, same pattern report-template.rbac.spec.ts
 *     uses for its footer-text input); invoiceStartNumber is a pf-number-input
 *     (not exercised here — only the prefix + preview per the task); the live
 *     preview is `.pf-invoice-preview`'s second <p>; invoiceOnFullPaymentOnly
 *     ("Issue invoice only on full payment" / proforma) is a pf-toggle and the
 *     only switch on this tab — not gated by anything else.
 *   - Invoice template: "Template style" chips (.pf-tpl-chip, active class
 *     .pf-tpl-chip--on) are always rendered; "Print size" chips share the
 *     SAME class but only render `@if (tpl().template === 'cashbill')`. Each
 *     group is scoped via its own preceding `<label class="pf-label">`
 *     sibling so the two chip rows are never conflated.
 *
 * Response-body shape for both save endpoints is NOT asserted (the component
 * itself never reads the POST response body — saveConfig()/saveTpl() only
 * branch on subscribe next/error), so every save is verified by response.ok()
 * + toast + a real `page.reload()` re-fetch, matching the harness convention
 * (admin-config-access.rbac.spec.ts / report-template.rbac.spec.ts).
 *
 * Every mutating test restores its original value in a `finally` block
 * (notifications-config.rbac.spec.ts's pattern) and re-verifies the restore
 * persisted across a reload — a 200 on the restore POST alone doesn't prove
 * the row actually landed.
 *
 * This file repeatedly mutates the SAME tenant-wide singleton rows
 * (TenantBillingConfig / invoice-template), so — like
 * report-template.rbac.spec.ts — it runs serially with generous per-test
 * headroom rather than relying on nxE2EPreset's default parallel workers.
 */
test.describe.configure({ mode: 'serial' });
test.beforeEach(() => {
  test.setTimeout(75_000);
});

type BillingTab = 'GST Setup' | 'Discounts' | 'Invoice';

async function gotoBillingConfig(page: Page) {
  await page.goto('/admin/billing');
  await expect(page.getByRole('heading', { name: /billing config/i, level: 1 })).toBeVisible({ timeout: 15_000 });
}

/** Reload while staying on /admin/billing. The component's tab signal always
 *  re-initializes to 'gst', so callers must re-click their tab afterward. */
async function reloadBillingConfig(page: Page) {
  await page.reload();
  await expect(page.getByRole('heading', { name: /billing config/i, level: 1 })).toBeVisible({ timeout: 15_000 });
}

async function clickTab(page: Page, tab: BillingTab) {
  await page.getByRole('button', { name: tab, exact: true }).click();
}

/** Header "Save" — posts the whole billing config. Scoped to pf-screen-header
 *  (see file header) and works from any tab since the button isn't tab-scoped. */
async function saveBillingConfig(page: Page): Promise<Response> {
  const saveBtn = page.locator('pf-screen-header').getByRole('button', { name: 'Save', exact: true });
  const resp = page.waitForResponse(
    r => r.url().includes('/api/config/billing') && r.request().method() === 'POST',
    { timeout: 15_000 }
  );
  await saveBtn.click();
  const r = await resp;
  expect(r.ok(), 'POST /api/config/billing should succeed').toBe(true);
  await expect(page.getByText(/billing config saved/i).last()).toBeVisible({ timeout: 10_000 });
  return r;
}

/** Invoice tab's "Save letterhead" — posts the whole invoice-template object. */
async function saveLetterhead(page: Page): Promise<Response> {
  const resp = page.waitForResponse(
    r => r.url().includes('/api/config/invoice-template') && r.request().method() === 'POST',
    { timeout: 15_000 }
  );
  await page.getByRole('button', { name: 'Save letterhead' }).click();
  const r = await resp;
  expect(r.ok(), 'POST /api/config/invoice-template should succeed').toBe(true);
  await expect(page.getByText(/letterhead saved/i).last()).toBeVisible({ timeout: 10_000 });
  return r;
}

// ── GST tab ──────────────────────────────────────────────────────────────

test.describe('Billing Config — GST tab (admin, real save + restore)', () => {
  test('Enable-GST toggle persists via POST /api/config/billing, reload confirms, restored', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoBillingConfig(page);
    // GST is the default tab, but click it explicitly for a stable start state.
    await clickTab(page, 'GST Setup');

    const toggle = page.getByRole('switch'); // the sole switch on the GST tab.
    const original = (await toggle.getAttribute('aria-checked')) === 'true';

    try {
      await toggle.click();
      await saveBillingConfig(page); // captures POST + asserts ok + "saved" toast
      // Proof is the RELOAD-persisted state, not the transient post-click attr.
      await reloadBillingConfig(page);
      await clickTab(page, 'GST Setup');
      await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', String(!original));
    } finally {
      await clickTab(page, 'GST Setup');
      const t = page.getByRole('switch');
      if ((await t.getAttribute('aria-checked')) !== String(original)) {
        await t.click();
        await saveBillingConfig(page);
      }
      await reloadBillingConfig(page);
      await clickTab(page, 'GST Setup');
      await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', String(original));
    }
  });

  test('GST scope selection persists via POST /api/config/billing, reload confirms, restored', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoBillingConfig(page);
    await clickTab(page, 'GST Setup');

    // The scope tile is `pointer-events: none` while gstEnabled is off
    // (component: [style.pointer-events]="config().gstEnabled ? 'auto' : 'none'")
    // — force it on for this test if needed, and restore it at the end.
    const gstToggle = page.getByRole('switch');
    const gstWasOn = (await gstToggle.getAttribute('aria-checked')) === 'true';
    if (!gstWasOn) {
      await gstToggle.click();
      await expect(gstToggle).toHaveAttribute('aria-checked', 'true');
      await saveBillingConfig(page);
    }

    try {
      const scopeBtn = {
        branch: page.getByRole('button', { name: /per branch/i }),
        region: page.getByRole('button', { name: /per region/i }),
        tenant: page.getByRole('button', { name: /per tenant/i }),
      } as const;
      const order = ['branch', 'region', 'tenant'] as const;

      async function activeScope(): Promise<(typeof order)[number]> {
        for (const key of order) {
          if ((await scopeBtn[key].getAttribute('class'))?.includes('pf-scope-active')) return key;
        }
        throw new Error('No GST scope option is marked active — pf-scope-active class not found on any button.');
      }

      const original = await activeScope();
      const next = order[(order.indexOf(original) + 1) % order.length];

      try {
        // Scope tile becomes interactive only once gstEnabled propagates;
        // click() auto-waits for actionability. Proof is reload-persistence.
        await scopeBtn[next].click();
        await saveBillingConfig(page);

        await reloadBillingConfig(page);
        await clickTab(page, 'GST Setup');
        await expect(scopeBtn[next]).toHaveClass(/pf-scope-active/);
      } finally {
        await clickTab(page, 'GST Setup');
        if ((await activeScope()) !== original) {
          await scopeBtn[original].click();
          await saveBillingConfig(page);
        }
        await reloadBillingConfig(page);
        await clickTab(page, 'GST Setup');
        await expect(scopeBtn[original]).toHaveClass(/pf-scope-active/);
      }
    } finally {
      if (!gstWasOn) {
        await clickTab(page, 'GST Setup');
        const t = page.getByRole('switch');
        if ((await t.getAttribute('aria-checked')) === 'true') {
          await t.click();
          await saveBillingConfig(page);
        }
      }
    }
  });
});

// ── Discounts tab ────────────────────────────────────────────────────────

test.describe('Billing Config — Discounts tab (admin, real save + restore)', () => {
  test('Level-1 max discount % persists via POST /api/config/billing, reload confirms, restored', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoBillingConfig(page);
    await clickTab(page, 'Discounts');

    // The 3 number-inputs are `[disabled]="!allowDiscounts"` — force it on
    // for this test if needed, and restore it at the end.
    const allowToggle = page.getByRole('switch');
    const allowWasOn = (await allowToggle.getAttribute('aria-checked')) === 'true';
    if (!allowWasOn) {
      await allowToggle.click();
      await expect(allowToggle).toHaveAttribute('aria-checked', 'true');
      await saveBillingConfig(page);
    }

    try {
      // Nth pf-number-input in DOM order on the Discounts tab: 0 Level-1
      // max %, 1 Level-2 override %, 2 approval threshold %.
      const input = page.locator('pf-number-input input.field').nth(0);
      await expect(input).toBeVisible({ timeout: 10_000 });
      await expect(input).toBeEnabled();
      const original = await input.inputValue();
      const originalNum = Number(original) || 0;
      const newNum = originalNum === 42 ? 33 : 42;

      try {
        await input.fill(String(newNum));
        await input.blur();
        await expect(input).toHaveValue(String(newNum));
        await saveBillingConfig(page);

        await reloadBillingConfig(page);
        await clickTab(page, 'Discounts');
        await expect(page.locator('pf-number-input input.field').nth(0)).toHaveValue(String(newNum));
      } finally {
        await clickTab(page, 'Discounts');
        const restoreInput = page.locator('pf-number-input input.field').nth(0);
        const current = await restoreInput.inputValue().catch(() => null);
        if (current !== original) {
          await restoreInput.fill(original);
          await restoreInput.blur();
          await saveBillingConfig(page);
        }
        await reloadBillingConfig(page);
        await clickTab(page, 'Discounts');
        await expect(page.locator('pf-number-input input.field').nth(0)).toHaveValue(original);
      }
    } finally {
      if (!allowWasOn) {
        await clickTab(page, 'Discounts');
        const t = page.getByRole('switch');
        if ((await t.getAttribute('aria-checked')) === 'true') {
          await t.click();
          await saveBillingConfig(page);
        }
      }
    }
  });
});

// ── Invoice tab ──────────────────────────────────────────────────────────

test.describe('Billing Config — Invoice tab (admin, real save + restore)', () => {
  test('"Issue invoice only on full payment" (proforma) toggle persists, reload confirms, restored', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoBillingConfig(page);
    await clickTab(page, 'Invoice');

    const toggle = page.getByRole('switch'); // the sole switch on the Invoice tab.
    const original = (await toggle.getAttribute('aria-checked')) === 'true';

    try {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', String(!original));
      await saveBillingConfig(page);

      await reloadBillingConfig(page);
      await clickTab(page, 'Invoice');
      await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', String(!original));
    } finally {
      await clickTab(page, 'Invoice');
      const t = page.getByRole('switch');
      if ((await t.getAttribute('aria-checked')) !== String(original)) {
        await t.click();
        await saveBillingConfig(page);
      }
      await reloadBillingConfig(page);
      await clickTab(page, 'Invoice');
      await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', String(original));
    }
  });

  test('Invoice prefix change updates the live preview, persists via Save, restored', async ({ page }) => {
    await loginAs(page, 'admin');
    await gotoBillingConfig(page);
    await clickTab(page, 'Invoice');

    const prefixInput = page.locator('label.pf-label:text-is("Invoice prefix")').locator('xpath=following-sibling::input[1]');
    const preview = page.locator('.pf-invoice-preview p').last();

    const original = await prefixInput.inputValue();
    const newPrefix = 'E2E' + Date.now().toString().slice(-5);

    try {
      await prefixInput.fill(newPrefix);
      await expect(preview).toContainText(newPrefix);
      await saveBillingConfig(page);

      await reloadBillingConfig(page);
      await clickTab(page, 'Invoice');
      await expect(prefixInput).toHaveValue(newPrefix);
      await expect(preview).toContainText(newPrefix);
    } finally {
      await clickTab(page, 'Invoice');
      if ((await prefixInput.inputValue()) !== original) {
        await prefixInput.fill(original);
        if (original) await expect(preview).toContainText(original);
        await saveBillingConfig(page);
      }
      await reloadBillingConfig(page);
      await clickTab(page, 'Invoice');
      await expect(prefixInput).toHaveValue(original);
    }
  });
});

// ── Invoice template (letterhead) ─────────────────────────────────────────

const PAPER_SIZE_LABELS: string[] = ['A4 sheet', 'Receipt 4"', 'Receipt 3"', 'Receipt 2.5"'];

function templateStyleGroup(page: Page): Locator {
  return page.locator('label.pf-label:text-is("Template style")').locator('xpath=following-sibling::div[1]');
}
function paperSizeGroup(page: Page): Locator {
  return page.locator('label.pf-label:text-is("Print size")').locator('xpath=following-sibling::div[1]');
}
async function activeChipLabel(group: Locator): Promise<string> {
  return (await group.locator('.pf-tpl-chip--on').innerText()).trim();
}

test.describe('Billing Config — Invoice template / letterhead (admin, real save + restore)', () => {
  test('switching to Cash Bill reveals the paper-size chips; template persists across reload; restored', async ({ page }) => {
    test.setTimeout(120_000);
    await loginAs(page, 'admin');
    await gotoBillingConfig(page);
    await clickTab(page, 'Invoice');

    const templateGroup = templateStyleGroup(page);
    const cashBill = () => templateStyleGroup(page).getByRole('button', { name: 'Cash Bill', exact: true });
    // Wait for the invoice-template to load — an active chip must exist before
    // reading it (reading innerText on a not-yet-rendered --on chip hangs).
    await expect(templateGroup.locator('.pf-tpl-chip--on')).toBeVisible({ timeout: 15_000 });
    const originalTemplate = (await templateGroup.locator('.pf-tpl-chip--on').innerText()).trim();

    try {
      // Switch to Cash Bill → the "Print size" row is `@if template==='cashbill'`.
      await cashBill().click();
      await expect(cashBill()).toHaveClass(/pf-tpl-chip--on/);
      // Key behaviour: the paper-size chips now render.
      await expect(page.locator('label.pf-label:text-is("Print size")')).toBeVisible({ timeout: 10_000 });
      await expect(paperSizeGroup(page).locator('.pf-tpl-chip')).not.toHaveCount(0);

      await saveLetterhead(page);
      await reloadBillingConfig(page);
      await clickTab(page, 'Invoice');
      await expect(cashBill()).toHaveClass(/pf-tpl-chip--on/); // persisted
    } finally {
      if (originalTemplate !== 'Cash Bill') {
        await clickTab(page, 'Invoice');
        await templateGroup.getByRole('button', { name: originalTemplate, exact: true }).click();
        await saveLetterhead(page);
        await reloadBillingConfig(page);
        await clickTab(page, 'Invoice');
        await expect(templateGroup.getByRole('button', { name: originalTemplate, exact: true })).toHaveClass(/pf-tpl-chip--on/);
      }
    }
  });
});
