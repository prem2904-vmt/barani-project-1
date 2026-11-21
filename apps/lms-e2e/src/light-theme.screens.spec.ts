import type { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect, isPhone, projectName } from './support/form-factor';
import { resetNeg, installNegBackend, go, neg, ME } from './support/neg-backend';
import { expectGridGlass as gridGlass, expectSecondaryContrast } from './support/grid-glass';
const expectGridGlass = async (page: Page, tag: string) => { await theme(page, false); await page.waitForTimeout(300); await gridGlass(page, tag); };

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

const DEPTS = [
  { id: 'd1', name: 'Biochemistry', code: 'BIO', isActive: true },
  { id: 'd2', name: 'Haematology', code: 'HAE', isActive: true },
];
const TM_NAMES = ['Transferrin', 'Iron Studies', 'Serum Ferritin', 'Total Iron Binding Capacity', 'Vitamin B12', 'Folic Acid', 'Haemoglobin A1c', 'Liver Function Test'];
const TESTS = Array.from({ length: 24 }, (_, i) => {
  const d = DEPTS[i % 2];
  return {
    id: `t${i + 1}`, testCode: `${d.code}${100 + i}`, name: TM_NAMES[i % TM_NAMES.length], shortName: `S${i}`, section: 'Routine',
    type: 'individual', isActive: true, price: 120 + i * 30, priceIsDefault: false, isOffered: true,
    tatHours: 4, department: { id: d.id, name: d.name, code: d.code }, departmentId: d.id, tubeColor: 'Red', parameters: '[]',
  };
});

const CPAT = { id: 'pc1', displayName: 'Sathish Kumar', firstName: 'Sathish', gender: 'M', sex: 'Male', age: 34, mrn: '260001', phone: '+919876543210' };
const CPARAMS = JSON.stringify({ parameters: [{ name: 'glu', title: 'Glucose', unit: 'mg/dL' }] });
const CSAMPLES = ['a', 'b', 'c'].map((k, i) => ({
  id: `cs${k}`, orderId: 'oc1', status: 'pending', barcode: `B-c${k}`, tubeColor: ['grey', 'red', 'lavender'][i], rejectionCount: 0, collectedAt: null, createdAt: ago(90),
  department: { id: 'bio', name: 'Biochemistry', code: 'BIO' }, tests: [{ id: `cs${k}-t`, status: 'pending', test: { name: ['Glucose', 'Lipid Profile', 'CBC'][i], parameters: CPARAMS, sampleType: 'Plasma' } }],
}));
const CORDER = { id: 'oc1', orderNumber: 'LAB-2611-00001', dailyNo: 1, dailyNoDay: today, patientId: 'pc1', branchId: 'b1', patient: CPAT, priority: 'Normal', source: 'walkin', collectionType: 'walkin', status: 'created', createdAt: ago(90), updatedAt: ago(5), samples: CSAMPLES };

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
      case '/api/tests': case '/api/tests/': return ok(TESTS);
      case '/api/samples/pending-collection': return ok(CSAMPLES.map(x => ({ ...x, order: CORDER })));
      case '/api/orders/oc1': return ok(CORDER);
      case '/api/tenants/departments': return ok(DEPTS);
      case '/api/config/billing': return ok({ gstEnabled: false, gstScope: 'intra', allowDiscounts: true, maxDiscountPct: 10, invoicePrefix: 'INV', invoiceStartNumber: 1001 });
      default: return undefined;
    }
  };
  await page.clock.setFixedTime(FIXED);
  await installNegBackend(page, context);
  // Freeze motion (the ambient flow, shimmers, carets) so the before/after dark sets compare pixel for pixel.
  if (process.env['LT_NOFREEZE'] !== '1') await page.addInitScript(() => {
    // Every animation jumps to its END state (entrances finish, loops stand still): menus and dialogs show, nothing moves.
    const css = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition:none!important;caret-color:transparent!important}';
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
  if (process.env['LT_PROBE'] === '1') await probe(page, name);
  if (!SHOTS_ONLY && !NO_GLASS_CHECK.has(name)) await expectGlass(page, name);
}
/** Screens with no docked panel to check (an intake form, a loading form, the order sheet open over the page). */
const NO_GLASS_CHECK = new Set(['lab-receive', 'patient-new', 'frontdesk-order']);

/** Owner 2026-11-21 (light-glass2): in LIGHT every docked OUTER panel is glass — its own background and its ::before
 *  layer are translucent (alpha <= 0.8) with a backdrop blur — and the empty body of a grid inside it paints nothing
 *  (the glass shows through). Floats (modal dialogs, menus, dropdowns) and the band / bottom bar are not panels. */
async function expectGlass(page: Page, tag: string) {
  await theme(page, false);
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const alpha = (c: string) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return 1; const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? Number(p[3]) : 1; };
    const FLOAT = '[role="dialog"][aria-modal="true"], .pf-dh-root, .sm-panel, .pf-dd__panel, pf-hero-band, .pf-chrome, pf-journey-overlay';
    const big = (e: Element) => { const b = e.getBoundingClientRect(); return b.width >= 200 && b.height >= 150 && parseFloat(getComputedStyle(e).borderTopLeftRadius) >= 10; };
    const panels = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter(e => {
      if (!big(e) || e.closest(FLOAT)) return false;
      for (let p = e.parentElement; p; p = p.parentElement) if (big(p)) return false;
      return true;
    });
    const bad: string[] = [];
    for (const e of panels) {
      const c = getComputedStyle(e), b = getComputedStyle(e, '::before');
      const name = String(e.className).split(' ').slice(0, 3).join('.');
      const own = alpha(c.backgroundColor);
      const glassBefore = b.content !== 'none' && alpha(b.backgroundColor) <= 0.8 && /blur/.test(b.backdropFilter || (b as unknown as Record<string, string>)['webkitBackdropFilter'] || '');
      const glassSelf = own <= 0.8 && /blur/.test(c.backdropFilter || '');
      if (own > 0.8 || !(glassBefore || glassSelf)) bad.push(`${name}: bg ${c.backgroundColor}, ::before ${b.content !== 'none' ? b.backgroundColor + ' ' + b.backdropFilter : 'none'}`);
      // Empty grid body: the point under the last row paints nothing up to the panel.
      const grid = e.querySelector<HTMLElement>('.ag-root-wrapper');
      if (grid) {
        const g = grid.getBoundingClientRect();
        const rows = Array.from(grid.querySelectorAll<HTMLElement>('.ag-row')).map(x => x.getBoundingClientRect().bottom).filter(y => y > 0);
        const last = rows.length ? Math.max(...rows) : g.top + 60;
        if (g.bottom - last > 40) {
          const x = g.left + g.width / 2, y = g.bottom - 20;
          const hit = document.elementFromPoint(x, y) as HTMLElement | null;
          for (let el = hit && e.contains(hit) ? hit : null; el && el !== e; el = el.parentElement) {
            if (el.closest('.ag-overlay')) break;   // the "no rows" message sits in the overlay, itself transparent
            if (alpha(getComputedStyle(el).backgroundColor) > 0.05) { bad.push(`${name}: empty grid body painted by ${String(el.className).slice(0, 60)} (${getComputedStyle(el).backgroundColor})`); break; }
          }
        }
      }
    }
    return { count: panels.length, bad };
  });
  // Phones may open on a short tab (Lab: the Intake strip) with no big panel; wider screens always have one.
  if (!isPhone()) expect(r.count, `${tag}: a docked panel on screen`).toBeGreaterThan(0);
  expect(r.bad, `${tag}: every docked panel is glass (light)`).toEqual([]);
}
/** Dev aid (LT_PROBE=1): every big rounded surface on screen — its own background, its ::before glass, whether a
 *  bigger rounded surface holds it, and any role=dialog ancestor. Written to <shots>/<project>/probe.txt. */
async function probe(page: Page, name: string) {
  await theme(page, false);
  await page.waitForTimeout(800);
  const found = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('body *')).filter(e => {
    const r = e.getBoundingClientRect(); if (r.width < 200 || r.height < 150) return false;
    const c = getComputedStyle(e);
    return parseFloat(c.borderTopLeftRadius) >= 10 && !e.closest('pf-hero-band, .pf-chrome');
  }).map(e => {
    const c = getComputedStyle(e), b = getComputedStyle(e, '::before');
    const r = e.getBoundingClientRect();
    let p = e.parentElement; let holder = '';
    while (p) { const pr = p.getBoundingClientRect(); if (parseFloat(getComputedStyle(p).borderTopLeftRadius) >= 10 && pr.width >= 200) { holder = String(p.className).split(' ').slice(0, 2).join('.'); break; } p = p.parentElement; }
    const dlg = e.closest('[role="dialog"]');
    return `${e.tagName.toLowerCase()}.${String(e.className).split(' ').slice(0, 4).join('.')} ${Math.round(r.width)}x${Math.round(r.height)} bg=${c.backgroundColor} before=${b.content !== 'none' ? b.backgroundColor + ' ' + b.backdropFilter : '-'}${holder ? ' IN ' + holder : ''}${dlg ? ' DLG ' + String(dlg.className).slice(0, 40) : ''}`;
  }));
  const out = path.join(OUT_BASE, projectName()); fs.mkdirSync(out, { recursive: true });
  fs.appendFileSync(path.join(out, 'probe.txt'), `## ${name}\n${found.join('\n')}\n`);
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
/** Background alpha of a floating surface: the element itself, else its biggest painted child (a host wrapper). */
async function surfaceAlpha(page: Page, sel: string): Promise<{ found: boolean; alpha: number; what: string }> {
  return page.evaluate(sel => {
    const alpha = (c: string) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return 1; const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? Number(p[3]) : 1; };
    const el = Array.from(document.querySelectorAll<HTMLElement>(sel)).find(e => e.getBoundingClientRect().width > 0);
    if (!el) return { found: false, alpha: -1, what: '' };
    if (getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)') return { found: true, alpha: alpha(getComputedStyle(el).backgroundColor), what: `${el.tagName}.${String(el.className).slice(0, 60)}` };
    const cands = [...Array.from(el.querySelectorAll<HTMLElement>(':scope > *, :scope > * > *'))]
      .filter(e => getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)')
      .sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height);
    const s = cands[0];
    return s ? { found: true, alpha: alpha(getComputedStyle(s).backgroundColor), what: `${s.tagName}.${String(s.className).slice(0, 60)}` } : { found: true, alpha: 0, what: 'no background' };
  }, sel);
}
async function expectOpaqueFloat(page: Page, sel: string, tag: string) {
  if (SHOTS_ONLY) return;
  await theme(page, false);
  await page.waitForTimeout(300);
  const a = await surfaceAlpha(page, sel);
  expect(a.found, `${tag}: on screen`).toBe(true);
  expect(a.alpha, `${tag}: near-opaque in light (${a.what})`).toBeGreaterThanOrEqual(0.95);
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
    // Owner 2026-11-21 (glass that reads, as mock v6): panels at ~.5 white so the brand pools show through.
    expect(f.panelAlpha, `${tag}: glass panel is translucent`).toBeGreaterThanOrEqual(0.4);
    expect(f.panelAlpha, `${tag}: glass panel is translucent`).toBeLessThan(0.8);
    expect(f.panelBlur, `${tag}: glass panel blurs`).toContain('blur(18px)');
  } else {
    expect(f.panelAlpha, `${tag}: no backdrop-filter → near-solid panel`).toBeGreaterThan(0.9);
  }
}

test.describe('light theme — every screen, light + dark', () => {
  test('Frontdesk (+ token checks)', async ({ page }) => {
    await go(page, '/frontdesk');
    await settle(page);
    // The WORK grid with rows (Completed holds the demo orders): the glass must read through the rows too.
    const done = page.locator('[role="radio"][aria-label="Completed"], [role="radio"]:has-text("Completed")').locator('visible=true').first();
    if (await done.count()) { await done.click(); await settle(page, 'Priya Nair'); }
    await shots(page, 'frontdesk');
    if (!SHOTS_ONLY) expectLightTokens(await lightFacts(page, '.pf-appt-split__pane'), 'Frontdesk');
    if (!SHOTS_ONLY) await expectGridGlass(page, 'Frontdesk');
    { const work = page.locator('.pf-appt-split__pane--work').locator('visible=true').first();
      if (await work.count()) {
        await theme(page, false); await page.waitForTimeout(400);
        await work.screenshot({ path: path.join(OUT_BASE, projectName(), 'lt-frontdesk-grid--light.png') });
        // Secondary text stays readable on the more see-through panel (owner 2026-11-21: panels at .5 + stronger pools).
        const b = (await work.boundingBox())!;
        if (!SHOTS_ONLY) await expectSecondaryContrast(page, 'Frontdesk WORK panel', b.x + 30, b.y + b.height - 60);
      } }
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
      await expectOpaqueFloat(page, '.pf-dh-card', 'dialog');
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
      await expectOpaqueFloat(page, '.pf-dd__panel', 'pf-select panel');
      await page.keyboard.press('Escape');
    }
  });

  test('Start menu is near-opaque over the page (light)', async ({ page }) => {
    await go(page, '/frontdesk');
    await settle(page, 'Priya Nair');
    const trig = page.locator('[data-start-trigger]').locator('visible=true').first();
    await expect(trig).toBeVisible({ timeout: 60_000 });
    await trig.click();
    await expect(page.locator('[data-start-menu]').locator('visible=true').first()).toBeVisible();
    await page.waitForTimeout(800);
    await shots(page, 'start-menu');
    if (process.env['LT_DEBUG'] === '1') console.log('SMDBG', await page.evaluate(() => {
      const out: string[] = []; let e = document.querySelector<HTMLElement>('[data-start-menu]');
      while (e && out.length < 12) { const c = getComputedStyle(e); out.push(`${e.tagName}.${String(e.className).slice(0, 50)} bg=${c.backgroundColor} img=${c.backgroundImage.slice(0, 40)} op=${c.opacity} filt=${c.filter} bf=${c.backdropFilter} mix=${c.mixBlendMode}`); e = e.parentElement; }
      return out.join('\n');
    }));
    await expectOpaqueFloat(page, '.sm-panel', 'Start menu');
  });

  test('Test Master scrolled right: pinned columns stay opaque (light)', async ({ page }) => {
    await go(page, '/admin/tests');
    await settle(page, 'Transferrin');
    await page.evaluate(() => {
      for (const v of Array.from(document.querySelectorAll<HTMLElement>('.ag-body-horizontal-scroll-viewport, .ag-center-cols-viewport'))) v.scrollLeft = 600;
    });
    await page.waitForTimeout(800);
    await shots(page, 'tm-scrolled');
    if (process.env['LT_DEBUG'] === '1') console.log('TMDBG', await page.evaluate(() => {
      const set = new Set<string>(); document.querySelectorAll('[class*="pinned"], [class*="ag-"]').forEach(e => String(e.className).split(/\s+/).filter(c => /pinned|left|right|cols|row|cell|viewport|container/.test(c)).forEach(c => set.add(c)));
      const cell = document.querySelector('.ag-cell'); const chain: string[] = []; let e = cell as HTMLElement | null;
      while (e && chain.length < 8) { chain.push(`${String(e.className).slice(0, 80)} bg=${getComputedStyle(e).backgroundColor}`); e = e.parentElement; }
      return [...set].join(' ') + '\n' + chain.join('\n');
    }));
    if (!SHOTS_ONLY && !isPhone()) {
      await theme(page, false);
      await page.waitForTimeout(300);
      // Owner 2026-11-21 (glass across the grid): the surface behind a pinned cell is FROSTED — a backdrop blur and a
      // near-opaque (>= .8) tint — so the scrolled cells passing under it are blurred, never readable.
      const r = await page.evaluate(() => {
        const alpha = (c: string) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return 1; const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? Number(p[3]) : 1; };
        const cell = Array.from(document.querySelectorAll<HTMLElement>('.ag-grid-pinned-left-cells .ag-cell, .ag-pinned-left-cols-container .ag-cell')).find(e => e.getBoundingClientRect().width > 0);
        if (!cell) return { found: false, alpha: -1, blur: '' };
        let e: HTMLElement | null = cell;
        while (e && getComputedStyle(e).backgroundColor === 'rgba(0, 0, 0, 0)' && !e.classList.contains('ag-root-wrapper')) e = e.parentElement;
        const cs = e ? getComputedStyle(e) : null;
        return { found: true, alpha: cs ? alpha(cs.backgroundColor) : 0, blur: cs ? (cs.backdropFilter || (cs as unknown as Record<string, string>)['webkitBackdropFilter'] || '') : '', what: e?.className };
      });
      expect(r.found, 'a pinned cell on screen').toBe(true);
      expect(r.alpha, `pinned cell surface is frosted, near-opaque (${(r as { what?: string }).what})`).toBeGreaterThanOrEqual(0.8);
      expect(r.blur, `pinned cell surface has a backdrop blur (${(r as { what?: string }).what})`).toMatch(/blur/);
      await expectGridGlass(page, 'Test Master');
    }
  });

  // Owner 2026-11-21: on Results (light) rows scrolling up showed THROUGH the column header. The header is near-opaque
  // frost (>= .9) above the rows: the point at a header cell's centre belongs to the header even mid-scroll.
  test('Results scrolled: rows never show through the grid header (light)', async ({ page }) => {
    const rep = (n: number) => ({ id: `rq-${n}`, orderId: `ord-r${n}`, patientId: `pr${n}`, type: 'final', status: 'generated', deliveryStatus: n % 3 ? 'pending' : 'delivered',
      qrToken: `tok-${n}`, createdAt: ago(10 + n * 9),
      order: { id: `ord-r${n}`, orderNumber: `LAB-2611-0${String(300 + n)}`, dailyNo: 40 + n, dailyNoDay: today, patient: { displayName: `Patient Number ${n + 1}`, age: 30, sex: 'F', mrn: `AA3${n}`, phone: '+919876543210' } } });
    const items = Array.from({ length: 40 }, (_, i) => rep(i));
    await page.route(/prefrontal\.health\/api\/reports\/queue/, async route => {
      const origin = route.request().headers()['origin'] ?? 'http://127.0.0.1';
      const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ success: true, data: { items, total: items.length, page: 1, pageSize: 50, hasMore: false, counts: { all: 40, pending: 27, delivered: 13, failed: 0 } } }) });
    });
    await go(page, '/reports');
    if ((page.viewportSize()?.width ?? 0) < 1024) { test.info().annotations.push({ type: 'form-factor', description: 'the grid lives at >= 1024px (phones: the list head is opaque)' }); return; }
    await expect(page.locator('.ag-row').locator('visible=true').first()).toBeVisible({ timeout: 45_000 });
    await theme(page, false);
    await page.evaluate(() => { for (const v of Array.from(document.querySelectorAll<HTMLElement>('.ag-body-viewport, .ag-grid-viewport, .ag-body'))) v.scrollTop = 300; });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT_BASE, projectName(), 'lt-results-scrolled--light.png') });
    const r = await page.evaluate(() => {
      const alpha = (c: string) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return 1; const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? Number(p[3]) : 1; };
      const head = Array.from(document.querySelectorAll<HTMLElement>('.ag-header')).find(e => e.getBoundingClientRect().width > 0)!;
      const cells = Array.from(head.querySelectorAll<HTMLElement>('.ag-header-cell')).filter(c => c.getBoundingClientRect().width > 20).slice(0, 5);
      const off = cells.filter(c => { const b = c.getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !hit || !hit.closest('.ag-header'); })
        .map(c => (c.textContent ?? '').trim());
      return { alpha: alpha(getComputedStyle(head).backgroundColor), n: cells.length, off };
    });
    expect(r.n, 'header cells on screen').toBeGreaterThan(0);
    expect(r.off, 'the header owns its cells mid-scroll (no row on top)').toEqual([]);
    expect(r.alpha, 'grid header is near-opaque in light').toBeGreaterThanOrEqual(0.9);
  });

  test('Collect vials: the tile surface follows DARK (page loaded light then switched, and a real dark load)', async ({ page }) => {
    // The surface under the middle of a vial tile (the tile, else the first painted ancestor).
    const tileBg = () => page.evaluate(() => {
      const t = Array.from(document.querySelectorAll<HTMLElement>('.pf-sc-tile')).find(e => e.getBoundingClientRect().width > 0);
      if (!t) return null;
      let e: HTMLElement | null = t; let bg = 'rgba(0, 0, 0, 0)';
      while (e && (bg = getComputedStyle(e).backgroundColor) === 'rgba(0, 0, 0, 0)') e = e.parentElement;
      const m = /rgba?\(([^)]+)\)/.exec(bg);
      const [r, g, b] = m ? m[1].split(/[ ,/]+/).filter(Boolean).map(Number) : [0, 0, 0];
      return { bg, what: e ? String(e.className).slice(0, 80) : '', lum: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 };
    });
    const openFirst = async () => {
      const card = page.locator('.pf-sc__pcard').locator('visible=true').first();
      await card.waitFor({ timeout: 45_000 }).catch(() => undefined);
      if (!(await page.locator('.pf-sc-tile').locator('visible=true').count()) && (await card.count())) await card.click();
      await page.locator('.pf-sc-tile').locator('visible=true').first().waitFor({ timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(1200);
    };
    const out = path.join(OUT_BASE, projectName()); fs.mkdirSync(out, { recursive: true });
    // A: loaded in light, then switched to dark at runtime (how the owner and the screen specs see it).
    await go(page, '/lab/collect');
    await openFirst();
    await theme(page, false); await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/lt-collect--light.png` });
    if (process.env['LT_PROBE'] === '1') await probe(page, 'collect');
    if (!SHOTS_ONLY) await expectGlass(page, 'collect');
    // Real motion for this check (the spec's freeze would hide a delayed transition): 400 ms after the switch.
    await page.evaluate(() => document.querySelectorAll('style[data-lt-freeze]').forEach(x => x.remove()));
    await theme(page, true); await page.waitForTimeout(400);
    const sw = await tileBg();
    await page.screenshot({ path: `${out}/lt-collect--dark.png` });
    // B: a real dark page load (OS + saved theme say dark before the app boots).
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript(() => { try { localStorage.setItem('pf-theme', 'dark'); } catch { /* ignore */ } });
    await page.reload();
    await openFirst();
    await page.screenshot({ path: `${out}/lt-collect-darkload--dark.png` });
    const load = await tileBg();
    if (process.env['LT_DEBUG'] === '1') console.log('CLDBG', JSON.stringify({ sw, load }));
    if (!SHOTS_ONLY) {
      expect(sw, 'a vial tile on screen').not.toBeNull();
      expect(sw!.lum, `runtime switch to dark: vial tile is not white (${sw!.bg} on ${sw!.what})`).toBeLessThan(0.4);
      expect(load!.lum, `dark page load: vial tile is not white (${load!.bg} on ${load!.what})`).toBeLessThan(0.4);
    }
  });
});
