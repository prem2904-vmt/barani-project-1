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

/** Make `label` the selected work tab (never toggles an already-selected chip off). */
export async function deskTab(page: Page, label: string): Promise<void> {
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
  const t = tabLoc(page, 'In progress');
  if (!(await t.count())) return;
  if (!(await isOn(page, 'In progress'))) await t.click();   // select first…
  await t.click();                                             // …then tap it off
  await expect.poll(() => isOn(page, 'In progress')).toBe(false);
}

/** The count on a work tab (chip "Payments due 3", or the icon tab's badge), in either layout. */
export async function tabCount(page: Page, label: string): Promise<number> {
  const t = tabLoc(page, label);
  if (!(await t.count())) return 0;
  const txt = ((await t.textContent()) ?? '').replace(label, ' ');
  const m = /(\d+)\s*$/.exec(txt.trim()) ?? /(\d+)/.exec(txt);
  return m ? Number(m[1]) : 0;
}
