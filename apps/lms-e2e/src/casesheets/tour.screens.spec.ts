import { test, expect, type Browser, type Page } from '@playwright/test';
import {
  STACK, LAB_URL, PUBLIC_URL, VIEWPORTS, api, newContext, answerGoogle, googleClaims, settle, shot,
  expectNothingBlocked, type Theme, type ViewportName, type Person,
} from './cs-stack';

/**
 * PROOF SCREENSHOTS — every case-sheet screen at phone 390×844, iPad 1024×1366 (portrait) and desktop 1440×900, light and
 * dark, from the data the flow specs left on the host (run lab-flow, studio-flow and public-flow first). Each screen also
 * asserts no sideways page scroll. Files: `tour-<screen>--<viewport>--<theme>.png` under CS_SHOTS.
 */
const VPS = Object.keys(VIEWPORTS) as ViewportName[];
const THEMES: Theme[] = ['light', 'dark'];

interface Data {
  patientId: string; entDraft: string; finished: string; woundDraft: string; formId: string;
  personalCase: string;
}
let D: Data;

test.beforeAll(async () => {
  const sheets = await api<{ items: { id: string; state: string; formTitle: string; patientId: string; formId: string }[] }>(STACK.admin, 'GET', '/api/casesheets/sheets?pageSize=100');
  const fin = sheets.items.find(s => s.state === 'final' && /Nose/.test(s.formTitle));
  const entDraft = sheets.items.find(s => s.state === 'draft' && /Nose/.test(s.formTitle) && s.patientId === fin?.patientId);
  const wound = sheets.items.find(s => s.state === 'draft' && /Wound/.test(s.formTitle));
  const forms = await api<{ items: { id: string; origin: string; title: string }[] }>(STACK.admin, 'GET', '/api/casesheets/forms?pageSize=100');
  const copy = forms.items.find(f => f.origin === 'override');
  const mine = await api<{ items: { id: string }[] }>(STACK.personal, 'GET', '/api/casesheets/sheets?pageSize=10', undefined, googleClaims(STACK.personal.email ?? ''));
  if (!fin || !entDraft || !wound || !copy || !mine.items.length) throw new Error('run lab-flow, studio-flow and public-flow first');
  D = { patientId: fin.patientId, entDraft: entDraft.id, finished: fin.id, woundDraft: wound.id, formId: copy.id, personalCase: mine.items[0].id };
});

async function open(browser: Browser, who: Person | null, url: string, vp: ViewportName, theme: Theme, personal = false): Promise<Page> {
  const ctx = await newContext(browser, who, { viewport: vp, theme, tokenExtra: personal && who ? googleClaims(who.email ?? '') : {} });
  const page = await ctx.newPage();
  await page.goto(url);
  await settle(page, 1200);
  return page;
}

async function done(page: Page, name: string, vp: ViewportName, theme: Theme) {
  await shot(page, `tour-${name}`, { viewport: vp, theme });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect.soft(over, `${name} ${vp} ${theme}: no sideways page scroll`).toBeLessThanOrEqual(1);
  await page.context().close();
}

for (const vp of VPS) for (const theme of THEMES) {
  test.describe(`${vp} ${theme}`, () => {
    test('lab screens', async ({ browser }) => {
      let p = await open(browser, STACK.admin, `${LAB_URL}/frontdesk/patients/${D.patientId}`, vp, theme);
      await done(p, 'lab-patient-profile', vp, theme);

      p = await open(browser, STACK.admin, `${LAB_URL}/casesheets/new?patientId=${D.patientId}&dept=General%20Medicine`, vp, theme);
      await expect(p.locator('.dp__tile').first()).toBeVisible();
      await done(p, 'lab-departments', vp, theme);

      p = await open(browser, STACK.admin, `${LAB_URL}/casesheets/${D.entDraft}`, vp, theme);
      await p.locator('.lf-rail .lf-step, #lf-menu .lf-step').first().waitFor({ state: 'attached' });
      if (await p.locator('.lf-rail').isVisible()) await p.locator('.lf-rail .lf-step').first().click();
      else { await p.locator('.lf-pages').first().click(); await p.locator('#lf-menu .lf-step').first().click(); }
      await settle(p, 600);
      await done(p, 'lab-fill-page1', vp, theme);

      p = await open(browser, STACK.admin, `${LAB_URL}/casesheets/${D.entDraft}`, vp, theme);
      await p.locator('fe-field[data-field="complaints"]').first().scrollIntoViewIfNeeded().catch(() => undefined);
      await p.locator('fe-field[data-field="obstructionSide"]').first().scrollIntoViewIfNeeded().catch(() => undefined);
      await settle(p, 400);
      await done(p, 'lab-fill-followups', vp, theme);

      // the page list: the Pages menu in the bar on touch tiers; the desktop has the rail instead (no Pages button)
      if (vp !== 'desktop') {
        p = await open(browser, STACK.admin, `${LAB_URL}/casesheets/${D.entDraft}`, vp, theme);
        await p.locator('.lf-pages').first().click();
        await expect(p.locator('#lf-menu')).toBeVisible();
        await done(p, 'lab-fill-pages-menu', vp, theme);
      }

      p = await open(browser, STACK.admin, `${LAB_URL}/casesheets/${D.entDraft}`, vp, theme);
      await p.locator('.lf-hbtn[aria-label="Narrative"]').click();
      await expect(p.locator('#cs-narrative')).toHaveClass(/lf-nv--open/);
      await done(p, 'lab-narrative', vp, theme);

      p = await open(browser, STACK.admin, `${LAB_URL}/casesheets/${D.entDraft}`, vp, theme);
      await p.keyboard.press('Control+Shift+Enter');
      await expect(p.locator('[data-report]')).toBeVisible();
      await done(p, 'lab-report-dialog', vp, theme);

      p = await open(browser, STACK.admin, `${LAB_URL}/casesheets/${D.finished}`, vp, theme);
      await expect(p.locator('app-final-view')).toBeVisible();
      await settle(p, 1500);
      await done(p, 'lab-final-view', vp, theme);

      p = await open(browser, STACK.admin, `${LAB_URL}/casesheets/patient/${D.patientId}`, vp, theme);
      await done(p, 'lab-sheet-list', vp, theme);

      p = await open(browser, STACK.admin, `${LAB_URL}/casesheets/${D.woundDraft}`, vp, theme);
      if (await p.locator('.lf-rail').isVisible()) await p.locator('.lf-rail .lf-step').first().click();
      else { await p.locator('.lf-pages').first().click(); await p.locator('#lf-menu .lf-step').first().click(); }
      await settle(p, 600);
      await done(p, 'lab-wound-followup', vp, theme);

      p = await open(browser, STACK.admin, `${LAB_URL}/casesheets/${D.woundDraft}`, vp, theme);
      if (await p.locator('.lf-rail').isVisible()) await p.locator('.lf-rail .lf-step').last().click();
      else { await p.locator('.lf-pages').first().click(); await p.locator('#lf-menu .lf-step').last().click(); }
      await settle(p, 1200);
      await done(p, 'lab-wound-pictures', vp, theme);
    });

    test('studio screens', async ({ browser }) => {
      let p = await open(browser, STACK.admin, `${LAB_URL}/admin/ipd`, vp, theme);
      await done(p, 'studio-ipd-hub', vp, theme);
      p = await open(browser, STACK.admin, `${LAB_URL}/admin/ipd/myprefrontal`, vp, theme);
      await done(p, 'studio-home', vp, theme);
      p = await open(browser, STACK.admin, `${LAB_URL}/admin/ipd/myprefrontal/forms/${D.formId}`, vp, theme);
      await settle(p, 2500);
      await done(p, 'studio-editor', vp, theme);
      p = await open(browser, STACK.admin, `${LAB_URL}/admin/ipd/myprefrontal/forms/${D.formId}/history`, vp, theme);
      await done(p, 'studio-history', vp, theme);
    });

    test('public site screens', async ({ browser }) => {
      const me = STACK.personal;
      let p = await open(browser, null, `${PUBLIC_URL}/sign-in`, vp, theme);
      await expect(p.getByTestId('google-sign-in')).toBeVisible();
      await done(p, 'public-sign-in', vp, theme);

      p = await open(browser, me, `${PUBLIC_URL}/`, vp, theme, true);
      await expect(p.locator('.dp__row').first()).toBeVisible();
      await done(p, 'public-departments', vp, theme);

      p = await open(browser, me, `${PUBLIC_URL}/?dept=General%20Medicine`, vp, theme, true);
      await p.locator('.dp__tile').first().click();
      await expect(p.locator('[data-patient-step]')).toBeVisible();
      await p.locator('[data-ps-search]').fill('Laksh');
      await settle(p, 800);
      await done(p, 'public-patient-step', vp, theme);

      p = await open(browser, me, `${PUBLIC_URL}/cases`, vp, theme, true);
      await done(p, 'public-cases', vp, theme);

      p = await open(browser, me, `${PUBLIC_URL}/cases/${D.personalCase}`, vp, theme, true);
      await done(p, 'public-fill', vp, theme);

      p = await open(browser, me, `${PUBLIC_URL}/settings`, vp, theme, true);
      await done(p, 'public-settings', vp, theme);

      // signed in already (a lab account whose lab has no case sheets): the "not available" card with Sign out
      p = await open(browser, STACK.plainLab.admin, `${PUBLIC_URL}/cases`, vp, theme);
      await expect(p.getByTestId('cs-unavailable')).toBeVisible({ timeout: 30_000 });
      await done(p, 'public-not-available-card', vp, theme);

      const ctx = await newContext(browser, null, { viewport: vp, theme });
      await answerGoogle(ctx, STACK.plainLab.admin);
      p = await ctx.newPage();
      await p.goto(`${PUBLIC_URL}/sign-in`);
      await p.getByTestId('google-sign-in').click();
      await expect(p.getByTestId('cs-sign-in-notice')).toContainText('switched on for your lab', { timeout: 30_000 });
      await done(p, 'public-not-available', vp, theme);
    });
  });
}

test.afterAll(() => expectNothingBlocked());
