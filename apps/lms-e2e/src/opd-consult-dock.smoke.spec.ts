import { test, expect, type Page } from '@playwright/test';

/**
 * OPD consult — the journey dock never sits under the app nav, FULLY OFFLINE.
 * No backend, no real accounts: every API / Supabase call is answered in the
 * page from made-up fixtures (a made-up "Demo Clinic", one demo patient).
 *
 * Asserts, under the new design's docked bottom bar (owner's setup) at
 * 1440×900 and 1024×768:
 *  - the shell publishes the nav's measured height as --pf-nav-h on <html>;
 *  - the dock's bottom edge is at or above the nav's top edge;
 *  - every axis pill / dot / label sits inside the dock's box;
 * and on My patients: a tile tap opens that patient's consult, the glance
 * card shows the next patient by default and follows hover.
 * Screenshots into $SHOTS_DIR when set.
 *
 *   node serve-spa.mjs dist/apps/lms/browser 4318 &
 *   BASE_URL=http://127.0.0.1:4318 SHOTS_DIR=/tmp/shots ./node_modules/.bin/playwright test \
 *     --config=apps/lms-e2e/playwright.offline.config.ts opd-consult-dock
 */

const SHOTS = process.env['SHOTS_DIR'] || '';

const TENANT = { id: 't-demo', name: 'Demo Clinic' };
const ME = { id: 'app-doc', authId: 'sub-doc', first: 'Asha', last: 'Rao' };
const PATIENT = { id: 'p-1', name: 'Meena Iyer', ageDisplay: '42 y', sex: 'F', mrn: 'MRN-1001' };
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub: string) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 86400, email: `${sub}@demo.test` })}.sig`;

const QUEUE = [
  { visitId: 'v-1', patientId: PATIENT.id, patientName: PATIENT.name, ageSex: '42 F', mrn: PATIENT.mrn, token: 3, tokenLabel: 'A3', status: 'waiting',
    serviceName: 'Consultation', departmentName: 'Dermatology', isFollowUp: true, checkedInAt: iso(0), hasVitals: true, allergyCount: 1, doctorUserId: ME.authId },
  { visitId: 'v-2', patientId: 'p-2', patientName: 'Ravi Kumar', ageSex: '35 M', mrn: 'MRN-1002', token: 4, tokenLabel: 'A4', status: 'waiting',
    serviceName: 'Consultation', departmentName: 'Dermatology', isFollowUp: false, checkedInAt: iso(0), hasVitals: false, allergyCount: 0, doctorUserId: ME.authId },
  { visitId: 'v-3', patientId: 'p-3', patientName: 'Lakshmi Narayanan', ageSex: '61 F', mrn: 'MRN-1003', token: 5, tokenLabel: 'A5', status: 'booked',
    serviceName: 'Consultation', departmentName: 'Dermatology', isFollowUp: false, checkedInAt: null, hasVitals: false, allergyCount: 0, doctorUserId: ME.authId },
];

function workspace(visitId: string) {
  const row = QUEUE.find(q => q.visitId === visitId) ?? QUEUE[0];
  return {
    visit: { id: row.visitId, patientId: row.patientId, doctorUserId: ME.authId, doctorName: 'Dr Asha Rao', departmentName: 'Dermatology',
      serviceName: 'Consultation', visitNumber: 'OPD-0042', visitDate: iso(0), token: row.token, tokenLabel: row.tokenLabel, status: 'in_consult',
      purpose: 'Itchy rash on forearms', isFollowUp: row.isFollowUp, canEdit: true, consultStartedAt: iso(0) },
    patient: { id: row.patientId, name: row.patientName, ageDisplay: '42 y', sex: 'F', mrn: row.mrn, phone: '98xxxxxx10' },
    vitals: { visitId: row.visitId, bpSys: 128, bpDia: 84, pulse: 78, spo2: 98, tempF: 98.4, weightKg: 64, heightCm: 158, recordedAt: iso(0) },
    vitalsHistory: [], consult: null, rx: [], investigations: [],
    allergies: [{ id: 'al-1', patientId: row.patientId, allergen: 'Penicillin', reaction: 'Rash', status: 'active' }],
    form: null, followUpRule: { withinDays: 7 },
    lastVisit: { visitId: 'pv-1', visitDate: iso(30), doctorName: 'Dr Asha Rao', diagnoses: [{ label: 'Contact dermatitis' }], rx: [] },
    currentMedicines: [], conditions: [], noteVisibilityDefault: 'doctor_only',
    pastVisits: [30, 75, 140, 220, 300].map((d, i) => ({ visitId: `pv-${i + 1}`, visitDate: iso(d), doctorName: 'Dr Asha Rao', departmentName: 'Dermatology', diagnoses: [{ label: 'Contact dermatitis' }] })),
    procedures: [], procedureOptions: [], billing: null, features: { procedureLater: true, procedureRecord: true }, media: [],
  };
}
const HISTORY = [30, 75, 140, 220, 300].map((d, i) => ({
  visitId: `pv-${i + 1}`, visitDate: iso(d), doctorName: 'Dr Asha Rao', departmentName: 'Dermatology',
  diagnoses: [{ label: i % 2 ? 'Eczema' : 'Contact dermatitis' }], chiefComplaint: 'Rash', advice: null, form: null, answers: null,
  rx: [], investigations: [], procedures: [],
}));

async function offlineBackend(page: Page) {
  const cors = (origin: string) => ({ 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
    'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
  const ok = (origin: string, data: unknown) => ({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' },
    body: JSON.stringify({ success: true, data }) });
  await page.route(/prefrontal\.health\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    const p = new URL(req.url()).pathname;
    if (p === '/api/auth/me') {
      return route.fulfill(ok(origin, {
        id: ME.id, authId: ME.authId, firstName: ME.first, fathersName: ME.last, displayName: `${ME.first} ${ME.last}`,
        email: 'doc@demo.test', tenantId: TENANT.id, tenantName: TENANT.name, branchId: 'b1', branchName: 'Main',
        roles: ['Lab Admin'], permissions: ['*'], branches: [{ id: 'b1', name: 'Main' }], modules: ['lab'], hasPin: false, opdEntitled: true,
      }));
    }
    if (p === '/api/tenants/modules') return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' }, body: JSON.stringify({ success: false }) });
    if (p === '/api/tenants/current') return route.fulfill(ok(origin, { id: TENANT.id, name: TENANT.name }));
    if (p === '/api/process-workflows/active') return route.fulfill(ok(origin, null));
    if (p === '/api/opd/consult/my-queue') return route.fulfill(ok(origin, QUEUE));
    if (/\/api\/opd\/consult\/patients\/[^/]+\/history$/.test(p)) return route.fulfill(ok(origin, HISTORY));
    if (/^\/api\/patients\/[^/]+$/.test(p)) return route.fulfill(ok(origin, { id: PATIENT.id, history: [] }));
    if (/\/lab-trends$/.test(p)) return route.fulfill(ok(origin, null));
    const ws = p.match(/^\/api\/opd\/consult\/(v-\d+)(\/start)?$/);
    if (ws) return route.fulfill(ok(origin, workspace(ws[1])));
    if (req.method() === 'GET') return route.fulfill(ok(origin, []));
    return route.fulfill(ok(origin, {}));
  });
  await page.route(/supabase\.co\//, async route => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? 'http://127.0.0.1';
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    return route.fulfill({ status: 200, headers: { ...cors(origin), 'content-type': 'application/json' },
      body: JSON.stringify({ access_token: jwt(ME.authId), refresh_token: `rt-${ME.authId}`, token_type: 'bearer', expires_in: 86400,
        user: { id: ME.authId, aud: 'authenticated', email: 'doc@demo.test' } }) });
  });
  await page.routeWebSocket(/\/hubs\//, ws => { ws.onMessage(() => ws.send('{}\x1e')); });
}

async function seed(page: Page) {
  await page.addInitScript(([session]) => {
    if (sessionStorage.getItem('pf.e2e.seeded')) return;
    sessionStorage.setItem('pf.e2e.seeded', '1');
    localStorage.clear();
    localStorage.setItem('pf.session', session);
    localStorage.setItem('pf-design', 'new');
    localStorage.setItem('pf-bottom-nav', '1');
  }, [JSON.stringify({ access_token: jwt(ME.authId), refresh_token: `rt-${ME.authId}` })]);
}

/** The visible nav's top edge, the dock's box, and every axis mark's box. */
async function geometry(page: Page) {
  return page.evaluate(() => {
    const vh = window.innerHeight;
    const navs = Array.from(document.querySelectorAll<HTMLElement>('.pf-chrome, nav.pf-bottom-nav'))
      .filter(el => getComputedStyle(el).display !== 'none')
      .map(el => el.getBoundingClientRect())
      .filter(r => r.height > 0 && r.top >= vh / 2);
    const navTop = navs.length ? Math.min(...navs.map(r => r.top)) : vh;
    const dock = document.querySelector('pf-journey-dock .jd')!.getBoundingClientRect();
    const marks = Array.from(document.querySelectorAll<HTMLElement>('pf-journey-dock .jd button, pf-journey-dock .jd pf-journey-axis *'))
      .filter(el => { const st = getComputedStyle(el); return st.display !== 'none' && st.visibility !== 'hidden'; })
      .map(el => ({ cls: el.className?.toString?.() ?? el.tagName, r: el.getBoundingClientRect() }))
      .filter(m => m.r.width > 0 && m.r.height > 0)
      .map(m => ({ cls: m.cls, top: m.r.top, bottom: m.r.bottom }));
    return {
      navH: getComputedStyle(document.documentElement).getPropertyValue('--pf-nav-h').trim(),
      navTop, vh, dockTop: dock.top, dockBottom: dock.bottom,
      outside: marks.filter(m => m.bottom > dock.bottom + 0.5 || m.top < dock.top - 0.5),
    };
  });
}

test.describe('OPD consult dock — offline', () => {
  for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
    test(`dock clears the bottom nav at ${vp.width}×${vp.height}`, async ({ page }) => {
      test.setTimeout(120_000);
      await offlineBackend(page);
      await seed(page);
      await page.setViewportSize(vp);
      await page.goto('/opd/consult/v-1');
      await expect(page.locator('pf-journey-dock .jd')).toBeVisible({ timeout: 30_000 });
      // Open the dock (expanded axis) if it starts collapsed.
      const expand = page.getByRole('button', { name: 'Expand the timeline' });
      if (await expand.count()) await expand.click();
      await expect(page.locator('pf-journey-dock pf-journey-axis')).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(600);

      const g = await geometry(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/consult-dock-${vp.width}x${vp.height}.png` });
      console.log(JSON.stringify({ vp, navH: g.navH, navTop: g.navTop, dockTop: g.dockTop, dockBottom: g.dockBottom, outside: g.outside.length }));
      expect(g.navH).toMatch(/^\d+px$/);
      expect(parseInt(g.navH, 10)).toBe(Math.ceil(g.vh - g.navTop));
      expect(g.dockBottom).toBeLessThanOrEqual(g.navTop + 0.5);
      expect(g.outside).toEqual([]);
      // Dark theme: same geometry, screenshot for review.
      if (SHOTS) {
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.evaluate(() => { const r = document.documentElement; r.classList.add('dark'); r.classList.remove('light'); r.setAttribute('data-theme', 'dark'); });
        await page.waitForTimeout(400);
        const d = await geometry(page);
        expect(d.dockBottom).toBeLessThanOrEqual(d.navTop + 0.5);
        expect(d.outside).toEqual([]);
        await page.screenshot({ path: `${SHOTS}/consult-dock-${vp.width}x${vp.height}-dark.png` });
      }
    });
  }

  // Release gate 2026-11-21: the Complete consult sheet's footer sat UNDER the bottom nav (elementFromPoint at the
  // buttons returned the nav bar), so a click never landed. The sheet now ends above the nav on every size.
  for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    test(`Complete consult sheet: the footer buttons are the topmost element at their centre at ${vp.width}×${vp.height}`, async ({ page }) => {
      test.setTimeout(120_000);
      await offlineBackend(page);
      await seed(page);
      await page.setViewportSize(vp);
      await page.goto('/opd/consult/v-1');
      const cta = page.locator('button[data-complete]').locator('visible=true').first();
      await expect(cta).toBeVisible({ timeout: 30_000 });
      await cta.click();
      // A prefill question may come first (DialogService): complete anyway.
      const anyway = page.getByRole('button', { name: 'Complete anyway' });
      if (await anyway.isVisible({ timeout: 1500 }).catch(() => false)) await anyway.click();
      const foot = page.locator('pf-consult-complete-sheet .cs__foot');
      await expect(foot).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(400);   // the sheet's slide-in
      const hits = await foot.locator('button').evaluateAll(bs => bs.map(b => {
        const r = b.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { label: b.textContent?.trim(), ok: !!top && (top === b || b.contains(top)), hit: top ? `${top.tagName}.${top.className}` : 'none', bottom: r.bottom, vh: innerHeight };
      }));
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/consult-complete-${vp.width}x${vp.height}.png` });
      expect(hits.length).toBe(2);
      for (const h of hits) expect(h.ok, `"${h.label}" is topmost at its centre (got ${h.hit})`).toBe(true);
      // And it clears the bottom nav: the buttons end above the nav's top edge.
      const g = await page.evaluate(() => {
        const vh = innerHeight;
        const navs = Array.from(document.querySelectorAll<HTMLElement>('.pf-chrome, nav.pf-bottom-nav'))
          .filter(el => getComputedStyle(el).display !== 'none').map(el => el.getBoundingClientRect()).filter(r => r.height > 0 && r.top >= vh / 2);
        return navs.length ? Math.min(...navs.map(r => r.top)) : vh;
      });
      for (const h of hits) expect(h.bottom).toBeLessThanOrEqual(g + 0.5);
      // Keep editing really closes it (the click lands).
      await foot.getByRole('button', { name: 'Keep editing' }).click();
      await expect(page.locator('pf-consult-complete-sheet')).toHaveCount(0);
    });
  }

  test('My patients: tile opens the consult; glance = next, follows hover', async ({ page }) => {
    test.setTimeout(120_000);
    await offlineBackend(page);
    await seed(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/opd/consult');
    const glance = page.locator('[data-glance]');
    await expect(glance).toContainText(PATIENT.name, { timeout: 30_000 });   // next in line (token A3)
    await page.locator('.mp__tile', { hasText: 'Ravi Kumar' }).locator('[data-open]').hover();
    await expect(glance).toContainText('Ravi Kumar');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/my-patients-hover-1440x900.png` });
    // Keyboard: focus + Enter opens.
    await page.locator('.mp__tile', { hasText: 'Lakshmi' }).locator('[data-open]').focus();
    await expect(glance).toContainText('Lakshmi');
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/opd\/consult\/v-3$/);
    // Click opens too.
    await page.goBack();
    await page.locator('.mp__tile', { hasText: 'Ravi Kumar' }).locator('[data-open]').click();
    await page.waitForURL(/\/opd\/consult\/v-2$/);
  });
});
