import type { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect, isPhone, projectName } from './support/form-factor';
import { resetNeg, installNegBackend, go, neg, ME } from './support/neg-backend';

/**
 * Light theme (owner-approved mock light-mode-v6, 2026-11-21): new design light = brand band + soft violet glass
 * panels, readable text ramp, soft pastel chart colours, deep rose only for words that mean "late". Dark is untouched.
 * Every main screen is shot in light AND dark (the dark set is diffed against the pre-change build — must not move).
 * The token checks run on Frontdesk and Lab. API mocked, fake data only.
 * Screenshots: SHOTS_DIR/<project>/lt-<screen>--{light,dark}.png   (LT_SHOTS_ONLY=1 = screenshots only, no checks)
 */
const OUT_BASE = process.env['SHOTS_DIR'] || path.join(os.homedir(), 'Developer/pf-work/screens/light-theme');
const SHOTS_ONLY = process.env['LT_SHOTS_ONLY'] === '1';

// A fixed clock (page + data) so both runs render the same times and dates.
const FIXED = new Date('2026-11-21T05:00:00Z');
const now = FIXED.getTime();
const ago = (m: number) => new Date(now - m * 60000).toISOString();
const today = ago(0).slice(0, 10);
const pat = (n: number, name: string, age: number, sex: string) => ({ id: `p${n}`, displayName: name, firstName: name.split(' ')[0], age, sex, gender: sex, mrn: `AA00${String(n).padStart(2, '0')}`, phone: '+919876543210' });
const HAE = { id: 'hae', name: 'Haematology', code: 'HAE' };
const BIO = { id: 'bio', name: 'Biochemistry', code: 'BIO' };
const order = (n: number, name: string, age: number, sex: string, priority = 'Normal') =>
  ({ id: `ord-${n}`, orderNumber: `LAB-2611-0001${String(n).padStart(2, '0')}`, dailyNo: n, dailyNoDay: today, priority, patient: pat(n, name, age, sex) });
type Line = Record<string, unknown>;
const line = (id: string, test: string, dept: typeof HAE, sample: { id: string; barcode: string; rec: number }, o: ReturnType<typeof order>, extra: Line = {}): Line => ({
  id, status: 'pending', assignedTo: ME.id,
  test: { id: `t-${id}`, name: test, tatHours: 2, departmentId: dept.id, department: dept },
  subOrder: { id: sample.id, barcode: sample.barcode, receivedAtLab: ago(sample.rec), departmentId: dept.id, department: dept, order: o },
  ...extra,
});
const S = (id: string, barcode: string, rec: number) => ({ id, barcode, rec });
const O1 = order(3, 'Ms. Arya Stark', 30, 'F', 'Urgent');
const O2 = order(7, 'Mrs. Venkatalakshmi Subramaniam', 62, 'F');
const O3 = order(11, 'Mr. Prem Kumar K', 41, 'M');
const MY_WORK: Line[] = [
  line('l1', 'Complete Blood Count', HAE, S('s1', '0126101', 40), O1),
  line('l2', 'ESR', HAE, S('s1', '0126101', 40), O1),
  line('l3', 'Liver Function Test', BIO, S('s2', '0126102', 190), O2, { status: 'in_progress' }),
  line('l5', 'Lipid Profile', BIO, S('s3', '0126103', 30), O3, { status: 're_entry', rejectionReason: 'Sample looks haemolysed — please re-run' }),
];
const PV: Line[] = [
  line('v1', 'Complete Blood Count', HAE, S('s21', '0126117', 50), O2, { status: 'entered', assignedTo: null, resultedAt: ago(12), currentResult: '{"flags":{"critical":true}}' }),
  line('v4', 'Liver Function Test', BIO, S('s23', '0126118', 200), O3, { status: 'entered', assignedTo: null, resultedAt: ago(90) }),
];
const cstage = (label: string, state: string, extra: Record<string, unknown> = {}) => ({ key: label.toLowerCase(), label, state, ...extra });
const CULTURES = [
  { orderTestId: 'cu1', caseState: 'in_progress', createdAt: ago(26 * 60), patient: { age: 34, sex: 'Female', mrn: 'AA0031' }, barcode: 'MICRO26001', sampleId: 'sc1', patientName: 'Mrs. Shanthi M', dailyNo: 31, dailyNoDay: today,
    testName: 'Bacterial Culture & Sensitivity', departmentName: 'Microbiology', specimen: 'Urine',
    stages: [cstage('Gram / Direct smear', 'done', { doneAt: ago(25 * 60) }), cstage('Growth', 'open', { incubateUntil: ago(-90) }), cstage('AST', 'open')] },
  { orderTestId: 'cu2', caseState: 'in_progress', createdAt: ago(50 * 60), patient: { age: 62, sex: 'Female', mrn: 'AA0007' }, barcode: 'MICRO26002', sampleId: 'sc2', patientName: 'Mrs. Lakshmi R', dailyNo: 32, dailyNoDay: today,
    testName: 'Blood Culture', departmentName: 'Microbiology', specimen: 'Blood', stages: [cstage('Gram / Direct smear', 'done'), cstage('Growth', 'open', { incubateUntil: ago(40) })] },
];
const EXPENSES = [
  { id: 'e1', date: today, category: 'Consumables', description: 'Vacutainers (box of 100)', amount: 1450, paidBy: 'Cash', createdByName: 'Kavya Desk' },
  { id: 'e2', date: today, category: 'Utilities', description: 'Electricity — November', amount: 6200, paidBy: 'UPI', createdByName: 'Kavya Desk' },
];

let holdLab = false;
test.beforeEach(async ({ page, context }) => {
  test.setTimeout(240_000);
  resetNeg();
  holdLab = false;
  neg.hook = r => {
    if (r.method !== 'GET') return undefined;
    const ok = (data: unknown, delayMs = 0) => ({ status: 200, body: { success: true, data }, delayMs });
    switch (r.path) {
      case '/api/results/my-work': return ok(MY_WORK, holdLab ? 60_000 : 0);
      case '/api/results/completed': return ok([]);
      case '/api/validation/queue': return ok(PV);
      case '/api/validation/scope': return ok({ scoped: true, departments: [HAE, BIO], validatedToday: 14, validatedTodayByMe: 6 });
      case '/api/tenants/branch-lab-config': return ok({ effectiveQueueFocus: 'patient', queueFocus: 'patient' });
      case '/api/microbiology/culture-queue': return ok(CULTURES);
      case '/api/expenses': return ok(EXPENSES);
      case '/api/config/billing': return ok({ gstEnabled: false, gstScope: 'intra', allowDiscounts: true, maxDiscountPct: 10, invoicePrefix: 'INV', invoiceStartNumber: 1001 });
      default: return undefined;
    }
  };
  await page.clock.setFixedTime(FIXED);
  await installNegBackend(page, context);
  // Freeze motion (the ambient flow, shimmers, carets) so the before/after dark sets compare pixel for pixel.
  await page.addInitScript(() => {
    const css = '*,*::before,*::after{animation-play-state:paused!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important}';
    const add = () => { const s = document.createElement('style'); s.setAttribute('data-lt-freeze', ''); s.textContent = css; document.head.appendChild(s); };
    if (document.head) add(); else document.addEventListener('DOMContentLoaded', add);
  });
});

async function theme(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate(d => { const r = document.documentElement; r.classList.toggle('dark', d); r.classList.toggle('light', !d); r.setAttribute('data-theme', d ? 'dark' : 'light'); }, dark);
}
/** Light then dark (the theme switch's view transition must finish before each shot). */
async function shots(page: Page, name: string) {
  const out = path.join(OUT_BASE, projectName()); fs.mkdirSync(out, { recursive: true });
  for (const dark of [false, true]) {
    await theme(page, dark);
    await page.waitForTimeout(1100);
    await page.screenshot({ path: `${out}/lt-${name}--${dark ? 'dark' : 'light'}.png` });
  }
  await theme(page, false);
  if (process.env['LT_PROBE'] === '1') {
    await page.waitForTimeout(1100);
    // Dev aid: the big opaque surfaces on screen (the panels the glass must reach), by class.
    const found = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('body *')).filter(e => {
      const r = e.getBoundingClientRect(); if (r.width < 220 || r.height < 120) return false;
      const c = getComputedStyle(e); const bg = c.backgroundColor;
      return bg !== 'rgba(0, 0, 0, 0)' && parseFloat(c.borderTopLeftRadius) >= 12 && !e.closest('pf-hero-band, .pf-chrome');
    }).map(e => `${e.tagName.toLowerCase()}.${String(e.className).split(' ').slice(0, 4).join('.')} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)} ${getComputedStyle(e).backgroundColor}`));
    fs.appendFileSync(path.join(out, 'probe.txt'), `## ${name}\n${found.join('\n')}\n`);
  }
}
const settle = async (page: Page, text?: string) => {
  if (text) await page.getByText(text).locator('visible=true').first().waitFor({ timeout: 45_000 }).catch(() => undefined);
  await page.waitForTimeout(1200);
};

/** Computed light tokens + panel surfaces (run in LIGHT, new design). */
async function lightFacts(page: Page, panelSel: string) {
  await theme(page, false);
  await page.waitForTimeout(500);
  return page.evaluate(sel => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const v = (n: string) => cs.getPropertyValue(n).trim().toLowerCase();
    const probe = (prop: string, value: string) => {
      const el = document.createElement('span'); el.style.setProperty(prop, value); document.body.appendChild(el);
      const out = getComputedStyle(el).getPropertyValue(prop); el.remove(); return out;
    };
    const panel = Array.from(document.querySelectorAll<HTMLElement>(sel)).find(e => e.getBoundingClientRect().width > 0);
    // The glass is the panel's ::before layer (see _pf-light.scss — never backdrop-filter on the panel itself).
    const pcs = panel ? getComputedStyle(panel, '::before') : null;
    const alpha = (c: string) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return 1; const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? Number(p[3]) : 1; };
    return {
      designNew: root.classList.contains('design-new'),
      secondary: probe('color', 'var(--text-secondary)'),
      hint: probe('color', 'var(--text-muted)'),
      late: probe('color', 'var(--pf-late-text)'),
      lateBg: probe('background-color', 'var(--pf-late-bg)'),
      svcLab: probe('color', 'var(--pf-svc-lab)'),
      page: probe('background-color', 'var(--bg-primary)'),
      glass: CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'),
      panelFound: !!panel,
      panelAlpha: pcs ? alpha(pcs.backgroundColor) : -1,
      panelBlur: pcs ? (pcs.backdropFilter || (pcs as unknown as Record<string, string>)['webkitBackdropFilter'] || '') : '',
      raw: v('--pf-late-text'),
    };
  }, panelSel);
}
function expectLightTokens(f: Awaited<ReturnType<typeof lightFacts>>, tag: string) {
  expect(f.designNew, `${tag}: new design`).toBe(true);
  expect(f.secondary, `${tag}: secondary text`).toBe('rgb(86, 81, 112)');       // #565170
  expect(f.hint, `${tag}: hints / placeholders`).toBe('rgb(110, 105, 135)');     // #6e6987
  expect(f.late, `${tag}: late text`).toBe('rgb(192, 57, 94)');                  // #c0395e
  expect(f.lateBg, `${tag}: late pill`).toBe('rgb(253, 236, 241)');              // #fdecf1
  expect(f.svcLab, `${tag}: soft Lab colour`).toBe('rgb(134, 200, 234)');        // #86c8ea
  expect(f.page, `${tag}: page ground`).toBe('rgb(244, 240, 250)');              // #f4f0fa
  expect(f.panelFound, `${tag}: panel on screen`).toBe(true);
  if (f.glass) {
    expect(f.panelAlpha, `${tag}: glass panel is translucent`).toBeGreaterThan(0.55);
    expect(f.panelAlpha, `${tag}: glass panel is translucent`).toBeLessThan(0.8);
    expect(f.panelBlur, `${tag}: glass panel blurs`).toContain('blur(18px)');
  } else {
    expect(f.panelAlpha, `${tag}: no backdrop-filter → near-solid panel`).toBeGreaterThan(0.9);
  }
}

test.describe('light theme — every screen, light + dark', () => {
  test('Frontdesk (+ token checks)', async ({ page }) => {
    await go(page, '/frontdesk');
    await settle(page, 'Priya Nair');
    await shots(page, 'frontdesk');
    if (!SHOTS_ONLY) expectLightTokens(await lightFacts(page, '.pf-appt-split__pane'), 'Frontdesk');
  });

  test('Lab My Work + Culture + skeleton (+ token checks)', async ({ page }) => {
    await go(page, '/lab/my-work');
    await settle(page, 'Ms. Arya Stark');
    await shots(page, 'lab-mywork');
    if (!SHOTS_ONLY) expectLightTokens(await lightFacts(page, '.pf-mw-pane'), 'Lab');
    // Culture tab
    if (isPhone()) {
      const t = page.locator('.pf-mtabs [role="tab"][aria-label="Culture"]').locator('visible=true').first();
      if (await t.count()) await t.click();
    } else {
      const radio = page.locator('[role="radio"]:has-text("Culture")').locator('visible=true').first();
      if (await radio.count()) await radio.click();
      else {
        const compact = page.locator('pf-segmented [data-seg-compact]').locator('visible=true').first();
        if (await compact.count()) { await compact.click(); await page.getByRole('menuitemradio', { name: /^Culture/ }).locator('visible=true').first().click().catch(() => undefined); }
      }
    }
    await settle(page, 'Mrs. Shanthi M');
    await shots(page, 'lab-culture');
    // Skeleton: hold My Work's data.
    holdLab = true;
    await go(page, '/lab/my-work');
    await page.waitForTimeout(1500);
    await shots(page, 'lab-skeleton');
  });

  const SCREENS: [string, string, string?][] = [
    ['frontdesk-order', '/frontdesk/order'],
    ['patient-new', '/frontdesk/patients/new'],
    ['prepare', '/prepare'],
    ['lab-receive', '/lab/receive'],
    ['lab-collect', '/lab/collect'],
    ['lab-critical', '/lab/critical-results'],
    ['pathologist', '/pathologist', 'Liver Function Test'],
    ['results', '/reports'],
    ['expenses', '/expenses', 'Vacutainers'],
    ['insights', '/insights'],
    ['finance-daily', '/finance/daily'],
    ['settings', '/admin'],
    ['test-master', '/admin/tests'],
    ['test-editor', '/admin/tests/t1/edit?type=individual'],
    ['stores', '/stores'],
    ['messages', '/messages'],
    ['files', '/files'],
    ['notifications', '/notifications'],
    ['ipd', '/ipd'],
    ['pharmacy', '/pharmacy'],
  ];
  for (const [name, route, wait] of SCREENS) {
    test(`${name} (${route})`, async ({ page }) => {
      await go(page, route);
      await settle(page, wait);
      await page.waitForTimeout(1500);
      await shots(page, name);
    });
  }

  test('dialog (Test Master › Restore to default)', async ({ page }) => {
    await go(page, '/admin/tests');
    await page.waitForTimeout(2500);
    const b = page.getByRole('button', { name: /Restore to default/ }).locator('visible=true').first();
    if (await b.count()) {
      await b.click().catch(() => undefined);
      await page.locator('[role="dialog"], [role="alertdialog"]').locator('visible=true').first().waitFor({ timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(600);
      await shots(page, 'dialog');
    }
  });

  test('pf-select dropdown open (Settings › Billing)', async ({ page }) => {
    test.skip(isPhone(), 'phone: the overview opens a section as a pushed detail');
    await go(page, '/admin?section=billing');
    const sw = page.locator('[data-testid="ov-inline"] button[role="switch"][aria-label="Allow discounts"]').locator('visible=true').first();
    await sw.waitFor({ timeout: 60_000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    const trig = page.locator('[data-testid="ov-inline"] pf-select .pf-dd__trigger').locator('visible=true').first();
    if (await trig.count()) {
      await trig.scrollIntoViewIfNeeded().catch(() => undefined);
      await trig.click({ timeout: 8000 }).catch(() => trig.dispatchEvent('click'));
      await page.waitForTimeout(500);
      await shots(page, 'select-open');
      await page.keyboard.press('Escape');
    }
  });
});
