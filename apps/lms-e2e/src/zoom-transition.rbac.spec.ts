import { test, expect, type Locator, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * List → detail ZOOM — every lab module pair, in a real browser (jsdom has no
 * View Transitions). For each pair it taps a tile 5 times and asserts, per tap:
 *   - document.startViewTransition was invoked, as a zoom (pf-vt-zoom-in);
 *   - the OLD snapshot held exactly ONE `pf-zoom` element: the tapped tile;
 *   - the NEW snapshot held exactly ONE `pf-zoom` element: a [pfZoomTarget];
 *   - the morph ran to the end: that target was still in the DOM, still
 *     named, when the transition finished (the old flake: the skeleton was
 *     swapped for the loaded card mid-morph and Chrome cut the zoom short);
 * and that going back reverses it (pf-vt-zoom-out, the card named in the old
 * state). READ-ONLY: every write is answered locally; queue data the seeded
 * tenant lacks is shaped from its real service queue.
 *
 *   BASE_URL=http://localhost:4318 CORS_RELAY=1 playwright test zoom-transition
 */

const RUNS = 5;

/** Wraps startViewTransition to record what each snapshot contained. */
const INSTRUMENT = () => {
  const w = window as any;
  w.__vt = [];
  const orig = (document as any).startViewTransition?.bind(document);
  if (!orig) return;
  const snap = () => Array.from(document.querySelectorAll<HTMLElement>('[data-pf-zoom-named]'))
    .filter(el => getComputedStyle(el).getPropertyValue('view-transition-name') === 'pf-zoom')
    .map(el => ({ el, src: el.getAttribute('data-zoom-src'), target: el.getAttribute('data-zoom-target') }));
  (document as any).startViewTransition = (arg: any) => {
    const cb = typeof arg === 'function' ? arg : arg?.update;
    const rec: any = { cls: '', oldNamed: [], newNamed: [], ready: 'pending', ranToEnd: null, ms: 0 };
    w.__vt.push(rec);
    let newEls: HTMLElement[] = [];
    const t = orig(async () => {
      // The old state was captured just before this callback runs.
      rec.cls = document.documentElement.className.split(/\s+/).filter((c: string) => c.startsWith('pf-vt')).join(' ');
      rec.oldNamed = snap().map(({ src, target }) => ({ src, target }));
      const r = await cb?.();
      await Promise.resolve();           // the service names the target in a microtask
      const s = snap();
      newEls = s.map(x => x.el);
      rec.newNamed = s.map(({ src, target }) => ({ src, target }));
      return r;
    });
    let readyAt = 0;
    t.ready.then(() => { readyAt = performance.now(); rec.ready = 'ok'; },
      (e: any) => { rec.ready = 'ERR ' + (e?.name || '') + ' ' + (e?.message || ''); });
    t.finished.then(() => {
      rec.ms = Math.round(performance.now() - readyAt);
      rec.ranToEnd = newEls.length > 0 && newEls.every(el => el.isConnected);
    }, () => { rec.ranToEnd = false; });
    return t;
  };
};

const corsFor = (page: Page) => {
  const origin = new URL(page.url() || 'http://localhost').origin;
  return { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' };
};

async function relayAndGuard(page: Page) {
  if (process.env['CORS_RELAY']) {
    await page.route(/prefrontal\.health\/api\//, async route => {
      const origin = new URL(page.url() || 'http://localhost').origin;
      const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
        'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const res = await route.fetch();
      await route.fulfill({ response: res, headers: { ...res.headers(), ...cors } });
    });
  }
  // Read-only: answer every write locally (claims, pdf cache, drafts…).
  await page.route(/\/api\//, async route => {
    const m = route.request().method();
    if (m === 'GET' || m === 'OPTIONS' || /\/api\/auth\//.test(route.request().url())) return route.fallback();
    const origin = new URL(page.url() || 'http://localhost').origin;
    await route.fulfill({ json: { success: true, data: {} }, headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' } });
  });
}

/** The seeded tenant's real service queue, re-shaped for the tab under test. */
async function shapeQueues(page: Page, opts: { focus?: 'patient' | 'sample'; pool?: boolean } = {}) {
  let me = '';
  page.on('response', async r => {
    if (/\/api\/auth\/me(\?|$)/.test(r.url())) {
      try { const j = await r.json(); const d = j?.data ?? j; me = d?.id ?? d?.user?.id ?? me; } catch { /* ignore */ }
    }
  });
  const reshape = async (route: any, fn: (row: any) => void) => {
    const url = route.request().url().replace(/\/api\/[^?]+(\?.*)?$/, '/api/results/service-queue?includeAssigned=true');
    const res = await route.fetch({ url });
    const body = await res.json();
    const wrap = body && !Array.isArray(body) && Array.isArray(body.data);
    const rows = (wrap ? body.data : body) as any[];
    rows.forEach(fn);
    await route.fulfill({ response: res, json: wrap ? { ...body, data: rows } : rows, headers: { ...res.headers(), ...corsFor(page) } });
  };
  const now = new Date().toISOString();
  await page.route(/\/api\/results\/my-work/, r => reshape(r, row => {
    row.assignedTo = me; row.status = 'pending';
    if (row.subOrder) { row.subOrder.scanVerifiedAt = now; row.subOrder.scanVerifiedBy = me; }
  }));
  await page.route(/\/api\/results\/completed/, r => reshape(r, row => { row.assignedTo = me; row.status = 'entered'; }));
  await page.route(/\/api\/validation\/queue/, r => reshape(r, row => { row.status = 'entered'; }));
  if (opts.pool) {
    // The unclaimed pool, shaped from the tenant's tubes (the live pool may be empty).
    await page.route(/\/api\/results\/service-queue/, r => reshape(r, row => {
      row.assignedTo = null; row.status = 'pending';
      if (row.subOrder) { row.subOrder.scanVerifiedAt = null; row.subOrder.scanVerifiedBy = null; }
    }));
  }
  if (opts.focus) {
    await page.route(/\/api\/tenants\/branch-lab-config/, async r => {
      const res = await r.fetch();
      const j = await res.json();
      (j?.data ?? j).effectiveQueueFocus = opts.focus;
      await r.fulfill({ response: res, json: j, headers: { ...res.headers(), ...corsFor(page) } });
    });
  }
}

async function start(page: Page, opts: Parameters<typeof shapeQueues>[1] = {}) {
  await page.addInitScript(INSTRUMENT);
  await relayAndGuard(page);
  await shapeQueues(page, opts);
  await loginAs(page, 'admin');
  await page.setViewportSize({ width: 1440, height: 900 });
}

const records = (page: Page) => page.evaluate(() => (window as any).__vt as any[]);
const clearRecords = (page: Page) => page.evaluate(() => { (window as any).__vt.length = 0; });

/** Wait until the last transition has finished (or none started). */
async function settle(page: Page) {
  await page.waitForFunction(() => {
    const v = (window as any).__vt as any[];
    return v.length > 0 && v[v.length - 1].ranToEnd !== null;
  }, null, { timeout: 8_000 }).catch(() => {});
}

interface Verdict { ok: boolean; why: string }

function judgeIn(v: any[], key: string | null): Verdict {
  const z = v.find(r => /pf-vt-zoom-in/.test(r.cls));
  if (!v.length) return { ok: false, why: 'startViewTransition never called' };
  if (!z) return { ok: false, why: 'no zoom-in transition: ' + JSON.stringify(v) };
  if (z.oldNamed.length !== 1) return { ok: false, why: 'old snapshot named ' + JSON.stringify(z.oldNamed) };
  if (key && z.oldNamed[0].src !== key) return { ok: false, why: `old named ${z.oldNamed[0].src}, tapped ${key}` };
  if (z.newNamed.length !== 1 || z.newNamed[0].target === null) return { ok: false, why: 'new snapshot named ' + JSON.stringify(z.newNamed) };
  if (z.ready !== 'ok') return { ok: false, why: 'ready ' + z.ready };
  if (!z.ranToEnd) return { ok: false, why: `cut short (target left the DOM), ran ${z.ms}ms` };
  return { ok: true, why: `ok ${z.ms}ms` };
}
function judgeOut(v: any[]): Verdict {
  const z = v.find(r => /pf-vt-zoom-out/.test(r.cls));
  if (!z) return { ok: false, why: 'no zoom-out transition: ' + JSON.stringify(v) };
  if (z.oldNamed.length !== 1 || z.oldNamed[0].target === null) return { ok: false, why: 'old snapshot named ' + JSON.stringify(z.oldNamed) };
  if (z.ready !== 'ok') return { ok: false, why: 'ready ' + z.ready };
  return { ok: true, why: `ok ${z.ms}ms` };
}

/**
 * One pair, RUNS times: open the list, tap a source, check the zoom in; go
 * back, check the zoom out. `tap` returns the tapped source (or null = no data).
 */
async function runPair(page: Page, name: string, p: {
  list: () => Promise<void>;
  source: () => Locator;
  tap?: (src: Locator) => Promise<void>;
  detail: RegExp | null;          // null = in-page detail (no URL change)
  back?: () => Promise<void>;
}) {
  let pass = 0, backPass = 0;
  const notes: string[] = [];
  for (let i = 0; i < RUNS; i++) {
    await p.list();
    const src = p.source();
    try { await src.first().waitFor({ state: 'visible', timeout: 20_000 }); } catch { test.skip(true, `${name}: no list data`); return; }
    const tile = src.nth(i % await src.count());
    const key = await tile.evaluate(el => (el.closest('[data-zoom-src]') ?? el.querySelector('[data-zoom-src]'))?.getAttribute('data-zoom-src') ?? null);
    await page.waitForTimeout(250);        // let the list settle (no live refresh mid-tap)
    await clearRecords(page);
    if (p.tap) await p.tap(tile); else await tile.click();
    if (p.detail) await page.waitForURL(p.detail, { timeout: 20_000 });
    await settle(page);
    const vin = judgeIn(await records(page), key);
    if (vin.ok) pass++;
    notes.push(`#${i + 1} in: ${vin.why}`);

    await page.waitForTimeout(300);
    await clearRecords(page);
    if (p.back) await p.back(); else await page.goBack();
    await settle(page);
    const vout = judgeOut(await records(page));
    if (vout.ok) backPass++;
    notes.push(`#${i + 1} back: ${vout.why}`);
  }
  console.log(`ZOOM ${name}: in ${pass}/${RUNS}, back ${backPass}/${RUNS}\n  ` + notes.join('\n  '));
  expect(pass, notes.join('\n')).toBe(RUNS);
  expect(backPass, notes.join('\n')).toBe(RUNS);
}

async function myWork(page: Page, tab: 'My Work' | 'Completed' | 'Queue' | 'Culture') {
  await page.goto('/lab/my-work');
  await page.waitForLoadState('networkidle').catch(() => {});
  const label = tab === 'Queue' ? /^\s*(Queue|Service)/ : new RegExp('^\\s*' + tab);
  const seg = page.locator('pf-segmented button, [role="tab"], button').filter({ hasText: label }).first();
  if (tab === 'Culture') {
    const c = page.locator('pf-segmented button[aria-label="Culture"], .pf-mtab[aria-label="Culture bench"]').first();
    if (await c.count()) await c.click();
  } else if (await seg.count()) await seg.click();
  await page.waitForLoadState('networkidle').catch(() => {});
}

test.describe('List → detail zoom, every lab module (5 taps each)', () => {
  test.describe.configure({ retries: 0 });
  test.setTimeout(300_000);
  // Pending relayed fetches must not outlive the page (teardown noise).
  test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'ignoreErrors' }); });

  test('My Work tile → sample result entry', async ({ page }) => {
    await start(page, { focus: 'sample' });
    await runPair(page, 'my-work → /lab/sample', {
      list: () => myWork(page, 'My Work'),
      source: () => page.locator('.pf-tq[data-zoom-src]:visible'),
      tap: t => t.locator('.pf-tq__main').click(),
      detail: /\/lab\/sample\//,
    });
  });

  test('Completed tile → sample (read-only view)', async ({ page }) => {
    await start(page, { focus: 'sample' });
    await runPair(page, 'completed → /lab/sample?view=1', {
      list: () => myWork(page, 'Completed'),
      source: () => page.locator('.pf-tq--done[data-zoom-src]:visible'),
      tap: t => t.locator('.pf-tq__main').click(),
      detail: /\/lab\/sample\/.*view=1/,
    });
  });

  test('Queue tile → scan-to-claim → sample', async ({ page }) => {
    await start(page, { focus: 'sample', pool: true });
    await runPair(page, 'queue → scan to claim → /lab/sample', {
      list: () => myWork(page, 'Queue'),
      source: () => page.locator('.pf-tq[data-zoom-src]:visible'),
      // The real gate: tap → claim scanner → type the tube's code → claim
      // (answered locally) → the tapped tile is re-armed → navigate.
      tap: async t => {
        await t.locator('.pf-tq__main').click();
        const modal = page.getByRole('dialog', { name: 'Scan vial to claim' });
        await modal.waitFor({ timeout: 10_000 });
        const code = ((await modal.getByText(/Expected/).locator('..').textContent()) ?? '').replace(/\D+/g, '');
        const input = modal.locator('input:visible').first();
        // The camera may flip to manual on its own (permission denied); only
        // toggle when no field is showing yet.
        for (let k = 0; k < 3 && !(await input.isVisible().catch(() => false)); k++) {
          const manual = modal.getByRole('button', { name: /enter manually/i }).last();
          if (await manual.isVisible().catch(() => false)) await manual.click();
          await input.waitFor({ timeout: 2_000 }).catch(() => {});
        }
        await input.fill(code);
        await input.press('Enter');
      },
      detail: /\/lab\/sample\//,
    });
  });

  test('Patient-group tube row → sample', async ({ page }) => {
    await start(page, { focus: 'patient' });
    await runPair(page, 'patient-group tube → /lab/sample', {
      list: async () => {
        await myWork(page, 'My Work');
        const hdr = page.locator('pf-tile button.w-full').first();
        await hdr.waitFor({ timeout: 20_000 }).catch(() => {});
        if (!(await page.locator('li.pf-tube-tile:visible').count())) await hdr.click().catch(() => {});
      },
      source: () => page.locator('li.pf-tube-tile[data-zoom-src]:visible'),
      tap: t => t.click({ position: { x: 24, y: 12 } }),
      detail: /\/lab\/sample\//,
    });
  });

  test('Culture tile → culture case page', async ({ page }) => {
    await start(page, { focus: 'sample' });
    await runPair(page, 'culture tile → /lab/culture', {
      list: () => myWork(page, 'Culture'),
      source: () => page.locator('li.pf-cc[data-zoom-src]:visible'),
      tap: t => t.locator('.pf-cc__hdr').click(),
      detail: /\/lab\/culture\//,
    });
  });

  test('Culture tube in My Work → /lab/sample REDIRECTED to /lab/culture', async ({ page }) => {
    await start(page, { focus: 'sample' });
    // Make every tube culture-only: cultureSampleRedirectGuard sends
    // /lab/sample/:id to /lab/culture/:orderTestId (a different URL + key).
    await page.route(/\/api\/samples\/[^/]+\/tests/, async r => {
      const res = await r.fetch();
      const j = await res.json();
      const s = j?.data ?? j;
      for (const t of s?.tests ?? []) { t.test = { ...(t.test ?? {}), parameters: JSON.stringify({ microFormat: 'culture_sensitivity' }) }; }
      await r.fulfill({ response: res, json: j, headers: { ...res.headers(), ...corsFor(page) } });
    });
    await runPair(page, 'my-work tube → redirect → /lab/culture', {
      list: () => myWork(page, 'My Work'),
      source: () => page.locator('.pf-tq[data-zoom-src]:visible'),
      tap: t => t.locator('.pf-tq__main').click(),
      detail: /\/lab\/culture\//,
    });
  });

  test('Pathologist pending row → validation review', async ({ page }) => {
    await start(page);
    await runPair(page, 'pending validation → /lab/sample?validate=1', {
      list: async () => { await page.goto('/pathologist'); await page.waitForLoadState('networkidle').catch(() => {}); },
      source: () => page.locator('pf-tile[data-zoom-src]:visible'),
      tap: t => t.locator('button').first().click(),
      detail: /\/lab\/sample\/.*validate=1|\/pathologist\/validate\/|\/lab\/culture\//,
    });
  });

  test('Report queue row → report viewer', async ({ page }) => {
    await start(page);
    await runPair(page, 'report queue → /reports/view', {
      list: async () => { await page.goto('/reports'); await page.waitForLoadState('networkidle').catch(() => {}); },
      source: () => page.locator('.pf-rq-row[data-zoom-src]:visible'),
      tap: t => t.locator('.pf-rq-act[title="View on screen"]').click(),
      detail: /\/reports\/view\//,
    });
  });

  test('Collect patient card → collection view (in-page)', async ({ page }) => {
    await start(page);
    await runPair(page, 'collect card → collection view', {
      list: async () => { await page.goto('/lab/collect'); await page.waitForLoadState('networkidle').catch(() => {}); },
      source: () => page.locator('button.pf-sc__card[data-zoom-src]:visible'),
      detail: null,
      back: () => page.locator('.pf-drawer pf-hero-band .pf-hb__back').first().click(),
    });
  });
});
