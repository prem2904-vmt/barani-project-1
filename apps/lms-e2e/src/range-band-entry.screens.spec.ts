import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect, projectName } from './support/form-factor';
import { neg, resetNeg, installNegBackend, resultTube } from './support/neg-backend';

/**
 * Result ENTRY shows ONLY the patient's matching reference band (sex + age), as the report prints it.
 * Hemoglobin has an adult-male and an adult-female band; the patient is a woman -> only the F band.
 * API mocked, fake data. Light + dark screenshots saved for review.
 */
const PARAM = {
  name: 'hb', title: 'Haemoglobin', type: 'numeric', unit: 'g/dL',
  referenceRanges: [
    { sex: 'M', minAge: 18, maxAge: 120, ageUnit: 'years', min: 13, max: 17 },
    { sex: 'F', minAge: 18, maxAge: 120, ageUnit: 'years', min: 12, max: 15 },
  ],
};
const dob = new Date(Date.now() - 34 * 365.25 * 864e5).toISOString().slice(0, 10);

test.beforeEach(async ({ page, context }) => {
  test.setTimeout(150_000);
  resetNeg();
  await installNegBackend(page, context);
  neg.hook = r => {
    if (r.method === 'GET' && r.path === '/api/samples/smp-1/tests') {
      const t = resultTube() as any;
      t.order.patient = { ...t.order.patient, displayName: 'Ms. Arya Stark', sex: 'F', gender: 'F', dateOfBirth: dob, age: 34 };
      t.tests[0].name = 'Haemoglobin';
      t.tests[0].test = { id: 't1', name: 'Haemoglobin', parameters: JSON.stringify({ parameters: [PARAM] }) };
      return { status: 200, body: { success: true, data: t } };
    }
    return undefined;
  };
});

test('entry screen lists only the woman\'s band', async ({ page }) => {
  await page.goto('/lab/sample/smp-1');
  const cell = page.locator('.pf-sre__gc-range').filter({ hasText: /\d/ }).first();
  await expect(cell).toBeAttached({ timeout: 60_000 });
  const txt = (await cell.innerText()).replace(/\s+/g, ' ');
  expect(txt).toContain('12');
  expect(txt).toContain('15');
  expect(txt).not.toContain('13');
  expect(txt).not.toMatch(/Male/i);
  for (const dark of [false, true]) {
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
    await page.waitForTimeout(400);
    const out = path.join(process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/range-band'), projectName());
    fs.mkdirSync(out, { recursive: true });
    await page.screenshot({ path: `${out}/entry-${dark ? 'dark' : 'light'}.png` });
  }
});
