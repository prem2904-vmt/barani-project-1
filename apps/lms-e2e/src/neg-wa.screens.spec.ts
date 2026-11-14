import type { Page } from '@playwright/test';
import { test, expect, isDesktopApp, isDesktopWeb, isTouch, bridgeCalls } from './support/form-factor';
import { neg, resetNeg, installNegBackend, toast, DOCTOR_PHONE } from './support/neg-backend';
import { installWhatsAppRecorder, opens, shares } from './support/whatsapp';

/**
 * NEGATIVE scenarios, WhatsApp Chat (the manual "Send on WhatsApp" from the report view), 2026-11-14:
 *   the window cannot open · the doctor-choice is cancelled · the patient opted out and the person cancels ·
 *   the desktop app's WhatsApp panel will not load.
 * WhatsApp itself is never contacted (stub pages); the desktop app is the in-page bridge stub. API mocked, demo data only.
 */
const REPORT = '/reports/view/rep-1';
const SEND = '.pf-rv-act--send';

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(150_000);
  resetNeg();
  await installNegBackend(page, context);
  await installWhatsAppRecorder(page, context);
});

async function openReport(page: Page) {
  await page.goto(REPORT);
  await expect(page.locator(SEND).locator('visible=true').first()).toBeVisible({ timeout: 60_000 });
}
const send = (page: Page) => page.locator(SEND).locator('visible=true').first();
const cancelBtn = (page: Page) => page.getByRole('button', { name: 'Cancel', exact: true }).locator('visible=true').first();
const anyErrorToast = (page: Page) => page.locator('.toast-item:has(.toast-icon[data-level="error"])').locator('visible=true');

/** What WhatsApp was asked to open on this form factor (a chat link in a tab / wa.me, the share sheet or the dock). */
async function waOpened(page: Page): Promise<number> {
  if (isDesktopApp()) return (await bridgeCalls(page, 'whatsapp.open')).length;
  const tabs = (await opens(page)).filter(o => /whatsapp\.com|wa\.me/.test(o[0] ?? '')).length;
  return tabs + (await shares(page)).length;
}

test.describe('neg-wa: WhatsApp Chat', () => {
  test('WhatsApp cannot be opened (web: the browser blocks the pop-up; app: the panel refuses; phone: the share sheet is closed): a plain message or a quiet stop, never "opened"', async ({ page, context }) => {
    if (isDesktopWeb()) {
      await page.addInitScript(() => { window.open = (() => null) as typeof window.open; });
    } else if (isDesktopApp()) {
      await page.addInitScript(() => {
        const api = (window as any).electronAPI;
        const real = api.whatsapp.open;
        api.whatsapp.open = async (url: string) => { await real(url); return { ok: false, error: 'blocked' }; };
      });
    } else {
      // A phone / tablet that can share files: the person closes the share sheet.
      await page.addInitScript(() => {
        const nav = navigator as any;
        nav.canShare = () => true;
        nav.share = async () => { throw new DOMException('Share canceled', 'AbortError'); };
      });
    }
    await openReport(page);
    await send(page).click();
    if (isDesktopWeb()) {
      await expect(toast(page, 'Your browser blocked the WhatsApp tab. Allow pop-ups for this site, then try again.')).toBeVisible({ timeout: 15_000 });
    } else if (isDesktopApp()) {
      await expect(toast(page, 'Could not open WhatsApp. Try again.')).toBeVisible({ timeout: 15_000 });
    } else {
      // Cancelled by the person: no error, and wa.me is not opened behind their back.
      await page.waitForTimeout(800);
      expect((await opens(page)).filter(o => /wa\.me/.test(o[0] ?? ''))).toEqual([]);
      await expect(anyErrorToast(page)).toHaveCount(0);
    }
    // The send is not marked as done and the button can be used again.
    await expect(send(page)).not.toHaveClass(/pf-rv-act--done/);
    await expect(send(page)).toBeEnabled();
    expect(neg.calls.filter(c => /deliver|sent|mark/i.test(c.path))).toEqual([]);
  });

  test('Referral-doctor choice: Cancel sends nothing and opens nothing', async ({ page }) => {
    neg.reportDoctor = { name: 'Dr. Ravi Kumar', phone: DOCTOR_PHONE };
    await openReport(page);
    await send(page).click();
    await expect(page.getByRole('heading', { name: 'Send the report on WhatsApp' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Send to doctor' }).locator('visible=true').first()).toBeVisible();
    await cancelBtn(page).click();
    await expect(page.getByRole('heading', { name: 'Send the report on WhatsApp' })).toHaveCount(0);
    await page.waitForTimeout(600);
    expect(await waOpened(page), 'nothing opened').toBe(0);
    await expect(anyErrorToast(page)).toHaveCount(0);
    // No leftover blank tab either (web: the tab primed in the click is closed again).
    expect(page.context().pages().filter(p => p.url() === 'about:blank' && p !== page)).toHaveLength(0);
    await expect(send(page)).toBeEnabled();
  });

  test('Patient opted out of WhatsApp: the warning is shown and Cancel opens nothing', async ({ page }) => {
    neg.optOut = true;
    await openReport(page);
    await send(page).click();
    await expect(page.getByRole('heading', { name: 'This patient opted out of WhatsApp' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Send anyway' }).locator('visible=true').first()).toBeVisible();
    await cancelBtn(page).click();
    await expect(page.getByRole('heading', { name: 'This patient opted out of WhatsApp' })).toHaveCount(0);
    await page.waitForTimeout(600);
    expect(await waOpened(page), 'nothing opened').toBe(0);
    expect(page.context().pages().filter(p => p.url() === 'about:blank' && p !== page)).toHaveLength(0);
    await expect(send(page)).not.toHaveClass(/pf-rv-act--done/);
  });

  test('Desktop app: WhatsApp\'s panel "didn\'t load here" is said plainly with the Browser / WhatsApp app way out', async ({ page }) => {
    test.skip(!isDesktopApp(), 'the docked WhatsApp panel exists only in the desktop app (phone: share sheet / wa.me; web: a tab)');
    await page.addInitScript(() => {
      const api = (window as any).electronAPI;
      const onState = api.whatsapp.onState;
      api.whatsapp.onState = (cb: (s: unknown) => void) => onState((st: any) => cb({ ...st, failed: st.open ? true : st.failed }));
    });
    await openReport(page);
    await send(page).click();
    const dock = page.locator('[data-testid=wa-dock]');
    await expect(dock).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid=wa-dock-card]')).toContainText("WhatsApp didn't load here.");
    await expect(dock).toContainText('Open the same chat in your browser or the WhatsApp app.');
    await expect(dock.getByTestId('wa-dock-card').getByRole('button', { name: 'Browser', exact: true })).toBeVisible();
    await expect(dock.getByTestId('wa-dock-card').getByRole('button', { name: 'WhatsApp app', exact: true })).toBeVisible();
    await dock.getByTestId('wa-dock-card').getByRole('button', { name: 'Browser', exact: true }).click();
    await expect.poll(async () => (await bridgeCalls(page, 'whatsapp.openElsewhere')).map(c => c.args[0])).toEqual(['browser']);
    // The person can still close the panel.
    await page.locator('[data-testid=wa-dock-close]').click();
    await expect(dock).toHaveCount(0);
    expect(isTouch()).toBe(false);
  });
});
