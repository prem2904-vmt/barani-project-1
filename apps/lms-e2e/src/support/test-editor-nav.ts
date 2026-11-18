import type { Page } from '@playwright/test';

/** Open a Test Master editor section (v2 navigation): the LEFT side card from 900px up, the section picker below. */
export async function openEditorSection(page: Page, id: 'identity' | 'pricing' | 'results' | 'layout' | 'consumables', label: RegExp): Promise<void> {
  if ((page.viewportSize()?.width ?? 1440) >= 900) {
    await page.locator(`.pf-te2-sidebtn[data-sec="${id}"]`).locator('visible=true').first().click();
  } else {
    await page.locator('.pf-te2-pick pf-select').locator('visible=true').first().click();
    await page.getByRole('option', { name: label }).locator('visible=true').first().click();
  }
}
