import { expect, type Page } from '@playwright/test';

/**
 * Front desk work tabs at every form factor. Two layouts of the same tabs:
 *  - labelled segmented chips (`role=radio`, desktop / desktop app / tablet landscape): tapping the ACTIVE chip turns
 *    it off (= every status for the chosen day);
 *  - icon tabs (`role=tab` .pf-mtab, phone + tablet portrait): one is always on, the label is the aria-label.
 */
const tabLoc = (page: Page, label: string) =>
  page.locator(`[role=radio][aria-label="${label}"], [role=tab][aria-label="${label}"], [role=radio][title="${label}"]`).locator('visible=true').first();

/** The icon-tab layout (phone, tablet portrait) is on screen. */
export async function iconTabs(page: Page): Promise<boolean> {
  return (await page.locator('.pf-mtab[role=tab]').locator('visible=true').count()) > 0;
}

const isOn = async (page: Page, label: string) => {
  const t = tabLoc(page, label);
  return (await t.getAttribute('aria-selected')) === 'true' || (await t.getAttribute('aria-checked')) === 'true';
};

/** The work pill collapsed to its selected-pill menu (a tight work card, pf-segmented fit): pick from the menu. */
const workMenu = (page: Page) => page.locator('.pf-work-hdr pf-segmented [data-seg-compact]').locator('visible=true').first();
async function pickFromWorkMenu(page: Page, label: string | null): Promise<boolean> {
  const m = workMenu(page);
  if (!(await m.count())) return false;
  await m.click();
  await page.getByRole('menuitemradio', { name: label ? new RegExp(`^${label}`) : /^All statuses/ }).locator('visible=true').first().click();
  return true;
}

/** Make `label` the selected work tab (never toggles an already-selected chip off). */
export async function deskTab(page: Page, label: string): Promise<void> {
  if (await pickFromWorkMenu(page, label)) return;
  const t = tabLoc(page, label);
  if (await t.count()) {
    if (!(await isOn(page, label))) await t.click();
    await expect.poll(() => isOn(page, label), { message: `work tab "${label}" selected` }).toBe(true);
    return;
  }
  // A layout without the aria label (older chips): the text.
  await page.getByText(label, { exact: false }).locator('visible=true').first().click();
}

/** "Every status for the day": the chip layout turns the active chip off; the icon-tab layout has no such state,
 *  so it shows In progress (where today's open orders are). */
export async function deskAllStatuses(page: Page): Promise<void> {
  if (await iconTabs(page)) { await deskTab(page, 'In progress'); return; }
  if (await pickFromWorkMenu(page, null)) return;
  const t = tabLoc(page, 'In progress');
  if (!(await t.count())) return;
  if (!(await isOn(page, 'In progress'))) await t.click();   // select first…
  await t.click();                                             // …then tap it off
  await expect.poll(() => isOn(page, 'In progress')).toBe(false);
}

/** The count on a work tab (chip "Payments due 3", or the icon tab's badge), in either layout. */
export async function tabCount(page: Page, label: string): Promise<number> {
  let t = tabLoc(page, label);
  if (!(await t.count())) {
    // A tight work card collapses the pill to its selected-pill menu ("● Payments due 3 ⌄"): read the count there
    // when that tab is the selected one.
    const m = workMenu(page);
    if (!(await m.count()) || !((await m.textContent()) ?? '').includes(label)) return 0;
    t = m;
  }
  const txt = ((await t.textContent()) ?? '').replace(label, ' ');
  const m = /(\d+)\s*$/.exec(txt.trim()) ?? /(\d+)/.exec(txt);
  return m ? Number(m[1]) : 0;
}

/**
 * The work row's "Dispatch drawn tubes" (a series with more draws to come). The flow grid / shared work list shows ONE
 * Next button per row (Collect here) and every other action in the row's ⋯ "More actions" menu (approved Frontdesk
 * flow-grid design, 2026-11-19), so Dispatch is a menu row. Opens the menu and returns the row's menu item.
 */
export async function openRowMenu(page: Page, patient: string) {
  const trigger = page.locator(`button[aria-label="More actions for ${patient}"]`).locator('visible=true').first();
  await expect(trigger).toBeVisible({ timeout: 60_000 });
  await trigger.click();
  return page.locator('[role="menu"]').locator('visible=true').first();
}
export async function dispatchDrawnItem(page: Page, patient: string) {
  const menu = await openRowMenu(page, patient);
  return menu.locator('[data-action="dispatch-drawn"]');
}
