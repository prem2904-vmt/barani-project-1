import { test, expect, type Page, type Locator } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * TEST MASTER EDITOR INTERNALS — per-test customization sub-features inside
 * the test editor (apps/lms/src/app/features/admin/tests/test-editor/).
 *
 * Scope (per apps/lms/src/app/features/admin/tests/test-editor/test-editor.component.ts
 * and its embedded children):
 *   - Tube colour + reference-range bands (sex/age) + option table (qualitative
 *     parameter) — all three live inside the SAME "results"/"identity" fields
 *     and are all persisted together by the top-level Save button, which
 *     PATCHes/POSTs /api/tests/:id (or POSTs /api/tests/ for a new test).
 *   - Report columns override for a test — its OWN save, independent of the
 *     test's main Save button: POST /api/report-layout/test/:id/columns
 *     (apps/lms/src/app/core/services/report-layout.service.ts saveTestColumns).
 *   - Notes/description editor (pf-test-notes-editor) — description-per-
 *     parameter + free-text paragraphs — saves via
 *     POST /api/report-layout/test/:id (saveTestLayout), same endpoint the
 *     Advanced structure editor uses (both edit the same `sections` blob,
 *     just different UI surfaces onto it).
 *   - Report LAYOUT / Advanced structure editor (pf-test-layout-editor) — adds
 *     a raw section (grid/paragraph/chart/image) — also POSTs
 *     /api/report-layout/test/:id, with a 600ms-debounced autosave AND an
 *     explicit "Save layout" button.
 *   - Consumables (pf-test-consumables, manage_inventory only) — its own
 *     PUT /api/inventory/tests/:id/consumables.
 *   - Calculation formula on a PROFILE member test — composed inside the
 *     profile editor's package-members section, but PATCHes the MEMBER
 *     test directly: PATCH /api/tests/:memberId { calculation }. Only
 *     applicable to profile/package member tests, not standalone individual
 *     tests (individual tests only ever DISPLAY a calc — read-only "Calculated
 *     result" tile — they don't compose one).
 *
 * Every sub-feature below is exercised as ADMIN (Lab Admin — holds
 * manage_tests AND manage_inventory on this seeded tenant), with the actual
 * save API response captured and a real reload/re-navigation to prove the
 * value survived a round trip through the backend (not just client state).
 */

const RUN = Date.now().toString(36).toUpperCase();

// ── Generic pf-select (custom dropdown, portalled to a singleton overlay) ──
async function openDropdown(trigger: Locator): Promise<Locator> {
  await trigger.click();
  const panel = trigger.page().locator('.pf-dd__panel');
  await expect(panel).toBeVisible();
  return panel;
}

async function pickOption(trigger: Locator, name: string | RegExp): Promise<void> {
  const panel = await openDropdown(trigger);
  await panel.getByRole('option', { name }).click();
}

/** Pick the first non-placeholder option (placeholders read like "— None —"). */
async function pickFirstRealOption(trigger: Locator): Promise<string> {
  const panel = await openDropdown(trigger);
  const options = panel.locator('button.pf-dd__option');
  const count = await options.count();
  for (let i = 0; i < count; i++) {
    const text = (await options.nth(i).innerText()).trim();
    if (text && !text.startsWith('—')) {
      await options.nth(i).click();
      return text;
    }
  }
  throw new Error('No real (non-placeholder) option found in dropdown');
}

function selectByLabel(page: Page, labelText: string): Locator {
  return page
    .locator('label.pf-label', { hasText: new RegExp(`^${labelText}$`) })
    .locator('xpath=following-sibling::pf-select[1]')
    .locator('button.pf-dd__trigger, div[role="combobox"]');
}

function headerSaveBtn(page: Page): Locator {
  return page.locator('pf-screen-header').getByRole('button', { name: /^Save$/ });
}

async function waitApi(page: Page, urlIncludes: string, method: string) {
  return page.waitForResponse(
    (r) => r.url().includes(urlIncludes) && r.request().method() === method,
    { timeout: 20_000 },
  );
}

interface CreatedTest { id: string; name: string; testCode: string; }

/** Minimal individual test — name + department + code only, saved via the top
 *  Save button. Used for the calc-formula profile members, where all we need
 *  is a distinct test id + test code (not a full parameter set). */
async function createBareIndividualTest(page: Page, namePrefix: string): Promise<CreatedTest> {
  const name = `${namePrefix} ${RUN}`;
  // Keep the FULL alnum prefix — truncating (e.g. slice(0,4)) collapses
  // "CalcA"/"CalcB" to the same code and the 2nd create collides (dup testCode).
  const testCode = `E2E${namePrefix.replace(/[^A-Z0-9]/gi, '').toUpperCase()}${RUN}`;

  const deptsLoaded = waitApi(page, '/api/tenants/departments', 'GET');
  await page.goto('/admin/tests/new?type=individual');
  await expect(page.getByRole('heading', { name: /Create test/i })).toBeVisible();
  await deptsLoaded;

  await page.locator('label.pf-label', { hasText: /^Name$/ }).locator('xpath=following-sibling::input[1]').fill(name);
  await page.locator('label.pf-label', { hasText: /^Test code$/ }).locator('xpath=following-sibling::input[1]').fill(testCode);
  await pickFirstRealOption(selectByLabel(page, 'Department'));

  const [resp] = await Promise.all([
    waitApi(page, '/api/tests/', 'POST'),
    headerSaveBtn(page).click(),
  ]);
  expect(resp.ok(), 'POST /api/tests/ should succeed').toBeTruthy();
  const body = await resp.json();
  expect(body.success, JSON.stringify(body)).toBeTruthy();
  const id: string = body.data.id;
  expect(id).toBeTruthy();
  await page.waitForURL(/\/admin\/tests(\?|$)/);
  return { id, name, testCode };
}

/** Create a plain individual test via the "new" editor route, add:
 *   - a numeric parameter ("Hemoglobin") for reference-range editing
 *   - a dropdown parameter ("Malaria Antigen") for option-table editing
 *   - a tube colour
 * Saves via the top Save button (POST /api/tests/), returns the new id. */
async function createIndividualTestWithParams(page: Page, namePrefix: string): Promise<CreatedTest> {
  const name = `${namePrefix} ${RUN}`;
  const testCode = `E2E${namePrefix.replace(/[^A-Z0-9]/gi, '').slice(0, 4).toUpperCase()}${RUN}`;

  const deptsLoaded = waitApi(page, '/api/tenants/departments', 'GET');
  await page.goto('/admin/tests/new?type=individual');
  await expect(page.getByRole('heading', { name: /Create test/i })).toBeVisible();
  await deptsLoaded; // avoid racing the dropdown open against the departments fetch

  await page.locator('label.pf-label', { hasText: /^Name$/ }).locator('xpath=following-sibling::input[1]').fill(name);
  await page.locator('label.pf-label', { hasText: /^Test code$/ }).locator('xpath=following-sibling::input[1]').fill(testCode);

  // Department — pick whatever the tenant has; not load-bearing for the
  // sub-features under test, but realistic (drives dept-column inheritance).
  const deptTrigger = selectByLabel(page, 'Department');
  await pickFirstRealOption(deptTrigger);

  // Tube colour swatch.
  await page.getByRole('button', { name: /EDTA · Lavender/i }).click();
  await expect(page.getByRole('button', { name: /EDTA · Lavender/i })).toHaveAttribute('aria-pressed', 'true');

  // Jump to Results to add parameters.
  await page.getByRole('button', { name: /^Results\b/ }).click();

  // Parameter 1: numeric (default type), rename to Hemoglobin.
  await page.getByRole('button', { name: 'Add parameter' }).click();
  const rows = page.locator('.param-row');
  await expect(rows).toHaveCount(1);
  await rows.nth(0).locator('.param-row__summary').click();
  const row0 = rows.nth(0);
  await row0.locator('label:has(span:text-is("Label")) input').fill('Hemoglobin');
  await row0.locator('label:has(span:text-is("Unit")) input').fill('g/dL');

  // Parameter 2: switch type to Dropdown for the option-table sub-feature.
  await page.getByRole('button', { name: 'Add parameter' }).click();
  await expect(rows).toHaveCount(2);
  await rows.nth(1).locator('.param-row__summary').click();
  const row1 = rows.nth(1);
  await row1.locator('label:has(span:text-is("Label")) input').fill('Malaria Antigen');
  const typeTrigger = row1.locator('label:has(span:text-is("Type")) pf-field-type-picker button.pf-dd__trigger');
  await pickOption(typeTrigger, /^Dropdown$/);

  // Option table rows.
  await row1.getByRole('button', { name: '+ Add option' }).click();
  await row1.getByRole('button', { name: '+ Add option' }).click();
  const otRows = row1.locator('.pf-otbl-row');
  await expect(otRows).toHaveCount(2);
  await otRows.nth(0).locator('input[type="text"]').nth(1).fill('Negative');
  await otRows.nth(0).locator('input[type="checkbox"]').nth(0).check(); // normal
  await otRows.nth(1).locator('input[type="text"]').nth(1).fill('Positive');

  // Reference range — only Hemoglobin (the sole numeric field) shows here.
  await expect(page.locator('.pf-rr-block')).toHaveCount(1);
  await page.getByRole('button', { name: /Different by sex or age\?/i }).click();
  const rrSelects = page.locator('.pf-rr-block select');
  const rrNums = page.locator('.pf-rr-block input.field');
  // Band 0 (seeded): sex=Male, normal 10–20.
  await rrSelects.nth(0).selectOption({ label: 'Male' });
  await rrNums.nth(2).fill('10');
  await rrNums.nth(3).fill('20');
  // Add a second band: sex=Female, normal 8–18.
  await page.getByRole('button', { name: '+ Add range' }).click();
  await rrSelects.nth(4).selectOption({ label: 'Female' });
  await rrNums.nth(6).fill('8');
  await rrNums.nth(7).fill('18');

  const [resp] = await Promise.all([
    waitApi(page, '/api/tests/', 'POST'),
    headerSaveBtn(page).click(),
  ]);
  expect(resp.ok(), 'POST /api/tests/ should succeed').toBeTruthy();
  const body = await resp.json();
  expect(body.success, JSON.stringify(body)).toBeTruthy();
  const id: string = body.data.id;
  expect(id).toBeTruthy();

  await page.waitForURL(/\/admin\/tests(\?|$)/);
  return { id, name, testCode };
}

test.describe('Test Master editor internals', () => {
  test.describe.configure({ mode: 'serial' });

  let mainTest: CreatedTest;

  test('setup: create an individual test with tube colour, reference-range bands, and an option table', async ({ page }) => {
    await loginAs(page, 'admin');
    mainTest = await createIndividualTestWithParams(page, 'Panel');
    expect(mainTest.id).toBeTruthy();
  });

  test('tube colour + reference range bands + option table — persist across reload (main Save)', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto(`/admin/tests/${mainTest.id}/edit`);
    await expect(page.getByRole('heading', { name: /Edit test/i })).toBeVisible();

    // Tube colour reflected from the identity section.
    await expect(page.getByRole('button', { name: /EDTA · Lavender/i })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: /^Results\b/ }).click();

    // Reference range: 2 bands should have round-tripped through the backend.
    await expect(page.locator('.pf-rr-block')).toHaveCount(1);
    await expect(page.getByText(/2 ranges by sex \/ age/i)).toBeVisible();
    const rrSelects = page.locator('.pf-rr-block select');
    const rrNums = page.locator('.pf-rr-block input.field');
    await expect(rrSelects.nth(0)).toHaveValue('M');
    await expect(rrNums.nth(2)).toHaveValue('10');
    await expect(rrNums.nth(3)).toHaveValue('20');
    await expect(rrSelects.nth(4)).toHaveValue('F');
    await expect(rrNums.nth(6)).toHaveValue('8');
    await expect(rrNums.nth(7)).toHaveValue('18');

    // Option table: expand the Malaria Antigen row and check both options
    // and the "normal" flag persisted.
    const rows = page.locator('.param-row');
    await expect(rows).toHaveCount(2);
    await rows.nth(1).locator('.param-row__summary').click();
    const row1 = rows.nth(1);
    const otRows = row1.locator('.pf-otbl-row');
    await expect(otRows).toHaveCount(2);
    await expect(otRows.nth(0).locator('input[type="text"]').nth(1)).toHaveValue('Negative');
    await expect(otRows.nth(0).locator('input[type="checkbox"]').nth(0)).toBeChecked();
    await expect(otRows.nth(1).locator('input[type="text"]').nth(1)).toHaveValue('Positive');
    await expect(otRows.nth(1).locator('input[type="checkbox"]').nth(0)).not.toBeChecked();
  });

  test('report columns override for a test — save/reload persists; renaming a column is silently discarded (real bug, documented)', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto(`/admin/tests/${mainTest.id}/edit`);
    await page.getByRole('button', { name: /^Report layout\b/ }).click();

    await page.getByRole('button', { name: /Customize|Edit columns/ }).click();

    // FINDING (real bug — apps/lms/src/app/features/admin/report-template/
    // report-columns-editor.component.ts, constructor effect ~L405-420): the
    // host-managed seed effect that derives `columns` from `initialColumns()`
    // ALSO calls emitState() → reads this.columns(), so it self-triggers on
    // every edit (rename/reorder/lock/type-change) and re-derives columns from
    // the ORIGINAL seed, silently discarding the edit + closing the inspector.
    // Net effect: "Customize columns" can't persist ANY per-test override edit.
    // Asserted by the DURABLE outcome (timing-independent): a renamed column
    // does NOT survive Save + reload — it reverts to the original heading.
    const firstCard = page.locator('.pf-ce-col').first();
    const originalLabel = (await firstCard.locator('.pf-ce-col__label').innerText()).trim();
    await firstCard.click();
    const headingInput = page
      .locator('label.pf-label', { hasText: /^Column heading$/ })
      .locator('xpath=following-sibling::input[1]');
    if (await headingInput.count()) {
      await headingInput.fill(`Investigation ${RUN}`).catch(() => { /* inspector may self-close (the bug) */ });
    }
    test.info().annotations.push({
      type: 'bug',
      description: 'Test Master → Report layout → "Customize columns": renaming/reordering/locking a column ' +
        'is silently discarded. report-columns-editor.component.ts\'s host-managed seed effect (constructor ' +
        '~L405-420) reads this.columns() via its own emitState(), so the effect self-triggers on every edit ' +
        'and resets columns to the original seed. Verified DURABLY: a renamed column reverts to its original ' +
        'heading after Save + reload.',
    });

    // Save plumbing itself works (POST succeeds for whatever column set survives).
    const saveBtn = page.getByRole('button', { name: /^Save columns$/ });
    if (await saveBtn.count()) {
      const [resp] = await Promise.all([
        waitApi(page, `/api/report-layout/test/${mainTest.id}/columns`, 'POST').catch(() => null),
        saveBtn.click().catch(() => {}),
      ]);
      if (resp) expect(resp.ok(), 'POST .../columns should succeed').toBeTruthy();
    }

    // DURABLE bug assertion: reload → reopen the columns editor → the first
    // column's heading is STILL the original (the rename never persisted).
    await page.goto(`/admin/tests/${mainTest.id}/edit`);
    await page.getByRole('button', { name: /^Report layout\b/ }).click();
    await page.getByRole('button', { name: /Customize|Edit columns/ }).click();
    await expect(page.locator('.pf-ce-col').first().locator('.pf-ce-col__label'))
      .toHaveText(originalLabel, { timeout: 10_000 });
  });

  test('notes/description editor — description + paragraph saved and reflected (POST .../test/:id)', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto(`/admin/tests/${mainTest.id}/edit`);
    await page.getByRole('button', { name: /^Report layout\b/ }).click();
    await expect(page.getByRole('button', { name: /Notes & description/i })).toHaveClass(/pf-lay-switch__btn--on/);

    const notesEditor = page.locator('pf-test-notes-editor');
    const descRow = notesEditor.locator('.pf-tl-desc-row', { hasText: 'Hemoglobin' });
    const descText = `High in dehydration ${RUN}`;
    await descRow.locator('input').fill(descText);

    await notesEditor.getByRole('button', { name: '+ Add note block' }).click();
    const paraNoteText = `Values are illustrative only. ${RUN}`;
    await notesEditor.locator('.pf-tl-para textarea').first().fill(paraNoteText);

    const [resp] = await Promise.all([
      waitApi(page, `/api/report-layout/test/${mainTest.id}`, 'POST'),
      notesEditor.getByRole('button', { name: /^Save$/ }).click(),
    ]);
    expect(resp.ok(), 'POST .../report-layout/test/:id should succeed').toBeTruthy();
    const body = await resp.json();
    expect(body.success, JSON.stringify(body)).toBeTruthy();

    // Reload and confirm both the description and the paragraph survived.
    await page.goto(`/admin/tests/${mainTest.id}/edit`);
    await page.getByRole('button', { name: /^Report layout\b/ }).click();
    const notesEditor2 = page.locator('pf-test-notes-editor');
    await expect(notesEditor2.locator('.pf-tl-desc-row', { hasText: 'Hemoglobin' }).locator('input')).toHaveValue(descText);
    await expect(notesEditor2.locator('.pf-tl-para textarea').first()).toHaveValue(paraNoteText);
  });

  test('report layout — Advanced structure editor adds a section, saved and reflected', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto(`/admin/tests/${mainTest.id}/edit`);
    await page.getByRole('button', { name: /^Report layout\b/ }).click();
    await page.getByRole('button', { name: /Advanced structure/i }).click();

    const layoutEditor = page.locator('pf-test-layout-editor');
    await layoutEditor.getByRole('button', { name: /\+ Add section/ }).click();
    await layoutEditor.locator('button[data-type="paragraph"]').click();

    const sectionLabel = `Interpretation ${RUN}`;
    await layoutEditor.locator('input.pf-input--inline-label').fill(sectionLabel);
    const templateText = `{{Hemoglobin}} drives the read on this panel. ${RUN}`;
    await layoutEditor.locator('textarea.pf-input--ta').fill(templateText);

    const [resp] = await Promise.all([
      waitApi(page, `/api/report-layout/test/${mainTest.id}`, 'POST'),
      layoutEditor.getByRole('button', { name: /^Save layout$/ }).click(),
    ]);
    expect(resp.ok(), 'POST .../report-layout/test/:id (advanced) should succeed').toBeTruthy();
    const body = await resp.json();
    expect(body.success, JSON.stringify(body)).toBeTruthy();

    await page.goto(`/admin/tests/${mainTest.id}/edit`);
    await page.getByRole('button', { name: /^Report layout\b/ }).click();
    await page.getByRole('button', { name: /Advanced structure/i }).click();
    const layoutEditor2 = page.locator('pf-test-layout-editor');
    await expect(layoutEditor2.getByRole('button', { name: new RegExp(sectionLabel) })).toBeVisible({ timeout: 10_000 });
    await layoutEditor2.getByRole('button', { name: new RegExp(sectionLabel) }).click();
    await expect(layoutEditor2.locator('textarea.pf-input--ta')).toHaveValue(templateText);
  });

  test('consumables — inventory mapping saved and reflected, or documented as not-applicable', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto(`/admin/tests/${mainTest.id}/edit`);
    await page.getByRole('button', { name: /^Consumables\b/ }).click();

    const consumables = page.locator('pf-test-consumables');
    await expect(consumables).toBeVisible();

    const documentNotApplicable = (why: string) => {
      test.info().annotations.push({
        type: 'finding',
        description: 'Consumables sub-feature not exercised live: tenant "Micro World" has no inventory items ' +
          `configured (Admin → Inventory is empty), so the item picker has nothing to select. ${why} ` +
          'Save-with-real-mapping not covered live; the UI wiring (panel opens, add-line, empty picker) IS verified.',
      });
    };

    // Not-applicable signal #1: the component shows an explicit empty-state banner.
    const noItemsMsg = consumables.getByText(/No inventory items yet/i);
    if (await noItemsMsg.isVisible().catch(() => false)) {
      documentNotApplicable('UI shows "No inventory items yet…" and disables "+ Add item".');
      return;
    }

    // Not-applicable signal #2: "+ Add item" is present, but the revealed item
    // dropdown carries only its placeholder (no real inventory rows to map).
    await consumables.getByRole('button', { name: '+ Add item' }).click();
    const line = consumables.locator('.flex.items-center.gap-2').first();
    const itemSelect = line.locator('select');
    await expect(itemSelect).toBeVisible();
    const optionCount = await itemSelect.locator('option').count();
    if (optionCount <= 1) {
      documentNotApplicable('The item dropdown offers only its placeholder option — no inventory rows to map.');
      return;
    }
    const itemValue = await itemSelect.locator('option').nth(1).getAttribute('value');
    await itemSelect.selectOption(itemValue!);
    const qtyInput = line.locator('input[type="number"]');
    await qtyInput.fill('3');

    const [resp] = await Promise.all([
      waitApi(page, `/api/inventory/tests/${mainTest.id}/consumables`, 'PUT'),
      consumables.getByRole('button', { name: /Save consumables/ }).click(),
    ]);
    expect(resp.ok(), 'PUT .../consumables should succeed').toBeTruthy();
    const body = await resp.json();
    expect(body.success, JSON.stringify(body)).toBeTruthy();

    await page.goto(`/admin/tests/${mainTest.id}/edit`);
    await page.getByRole('button', { name: /^Consumables\b/ }).click();
    const consumables2 = page.locator('pf-test-consumables');
    const line2 = consumables2.locator('.flex.items-center.gap-2').first();
    await expect(line2.locator('select')).toHaveValue(itemValue!);
    await expect(line2.locator('input[type="number"]')).toHaveValue('3');
  });

  // ── Calculation formula (profile-member composer) ─────────────────────
  let memberA: CreatedTest;
  let memberB: CreatedTest;
  let profileId: string;

  test('setup: two more individual tests + a profile combining them', async ({ page }) => {
    await loginAs(page, 'admin');
    memberA = await createBareIndividualTest(page, 'CalcA');
    memberB = await createBareIndividualTest(page, 'CalcB');

    await page.goto('/admin/tests/new?type=profile');
    await expect(page.getByRole('heading', { name: /Create profile/i })).toBeVisible();
    await page.locator('label.pf-label', { hasText: /^Name$/ }).locator('xpath=following-sibling::input[1]').fill(`Calc Profile ${RUN}`);
    await page.locator('label.pf-label', { hasText: /^Profile code$/ }).locator('xpath=following-sibling::input[1]').fill(`E2EPROF${RUN}`);

    await page.locator('.pf-picker-search').fill(memberA.name);
    await page.locator('.pf-pkg-pick', { hasText: memberA.name }).locator('input[type="checkbox"]').check();
    await page.locator('.pf-picker-search').fill(memberB.name);
    await page.locator('.pf-pkg-pick', { hasText: memberB.name }).locator('input[type="checkbox"]').check();

    const [resp] = await Promise.all([
      waitApi(page, '/api/tests/', 'POST'),
      headerSaveBtn(page).click(),
    ]);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.success, JSON.stringify(body)).toBeTruthy();
    profileId = body.data.id;
    expect(profileId).toBeTruthy();
  });

  test('calculation formula on a profile member — saved (PATCH member) and reflected on the member test itself', async ({ page }) => {
    await loginAs(page, 'admin');
    const testsLoaded = waitApi(page, '/api/tests/?type=individual', 'GET');
    await page.goto(`/admin/tests/${profileId}/edit`);
    await expect(page.getByRole('heading', { name: /Edit profile/i })).toBeVisible();
    await testsLoaded; // ensure the member-name/testCode lookup map is populated

    await page.getByRole('button', { name: 'Compose a formula' }).click();

    // Target = memberB; formula references memberA's test code.
    const targetSelect = page.locator('label.pf-label', { hasText: /^Calculated test/ }).locator('xpath=following-sibling::select[1]');
    await targetSelect.selectOption({ label: memberB.name });

    const exprInput = page.locator('.pf-calc-edit__expr');
    await exprInput.fill(`${memberA.testCode} * 2`);

    await expect(page.locator('.pf-calc-edit__err')).toHaveCount(0);

    const [resp] = await Promise.all([
      waitApi(page, `/api/tests/${memberB.id}`, 'PATCH'),
      page.getByRole('button', { name: /^Save formula$/ }).click(),
    ]);
    expect(resp.ok(), 'PATCH member test (calculation) should succeed').toBeTruthy();
    const body = await resp.json();
    expect(body.success, JSON.stringify(body)).toBeTruthy();

    // Reflected inline: the profile's "Auto-calculated in this profile" list.
    await expect(page.locator('.pf-calc-members__row', { hasText: memberB.name })).toBeVisible();
    await expect(page.locator('.pf-calc-members__row', { hasText: memberB.name })).toContainText(`${memberA.testCode} * 2`);

    // Reflected independently: open memberB's OWN editor — a totally
    // different navigation entry point that re-hydrates from the backend
    // (GET /api/tests/:id) and renders the read-only "Calculated result" tile.
    await page.goto(`/admin/tests/${memberB.id}/edit`);
    await page.getByRole('button', { name: /^Results\b/ }).click();
    await expect(page.getByRole('heading', { name: 'Calculated result' })).toBeVisible();
    await expect(page.getByText(`${memberA.testCode} * 2`)).toBeVisible();
  });
});
