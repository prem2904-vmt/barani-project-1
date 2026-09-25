import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './support/auth';

/**
 * /admin — ND-PATTERN real-layout audit (jsdom can't compute styles). Signs
 * in as the seeded Micro World Lab Admin and visits every /admin page plus a
 * representative record of each editor (user, role, workflow screen, field),
 * at 1440 and 375. Per page it asserts: the band is there (back · tenant ·
 * actions), AT MOST one primary on the page, no page-level scroll, and no
 * monospace / green / teal computed anywhere in the page (tube caps, the
 * report preview and the PF Sense glow are the functional exceptions).
 * READ-ONLY: nothing is saved. Screenshots (light + dark) into $SHOTS_DIR.
 *
 * CORS_RELAY=1 relays the backend calls from the runner so it can run
 * against a static build on a non-allowlisted port (BASE_URL=…:4310).
 * ONLY=users,roles… limits the pages (by key).
 */

const SHOTS = process.env['SHOTS_DIR'] || '';
const ONLY = (process.env['ONLY'] || '').split(',').map(s => s.trim()).filter(Boolean);

type Ids = { userId?: string; roleId?: string; screen?: string; stepId?: string; fieldId?: string };
type PageDef = { key: string; url: (ids: Ids) => string | null; editor?: boolean };

const PAGES: PageDef[] = [
  { key: 'overview', url: () => '/admin' },
  { key: 'manage', url: () => '/admin/manage' },
  { key: 'modules', url: () => '/admin/modules' },
  { key: 'lab-settings-hub', url: () => '/lab/settings' },
  { key: 'microbiology', url: () => '/admin/microbiology' },
  { key: 'users', url: () => '/admin/users' },
  { key: 'user-invite', url: () => '/admin/users/invite', editor: true },
  { key: 'user-edit', url: i => i.userId ? `/admin/users/${i.userId}/edit` : null, editor: true },
  { key: 'role-new', url: () => '/admin/roles/new', editor: true },
  { key: 'role-edit', url: i => i.roleId ? `/admin/roles/${i.roleId}/edit` : null, editor: true },
  { key: 'tests', url: () => '/admin/tests' },
  { key: 'test-new', url: () => '/admin/tests/new?type=individual', editor: true },
  { key: 'branches', url: () => '/admin/branches' },
  { key: 'vendors', url: () => '/admin/vendors' },
  { key: 'referral-labs', url: () => '/admin/referral-labs' },
  { key: 'lab-settings', url: () => '/admin/lab-settings' },
  { key: 'organization', url: () => '/admin/organization' },
  { key: 'billing', url: () => '/admin/billing' },
  { key: 'inventory', url: () => '/admin/inventory' },
  { key: 'reports', url: () => '/admin/reports' },
  { key: 'referring-network', url: () => '/admin/referring-network' },
  { key: 'partners', url: () => '/admin/partners' },
  { key: 'notifications', url: () => '/admin/notifications' },
  { key: 'workflows', url: () => '/admin/workflows' },
  { key: 'workflow-screen', url: i => i.screen ? `/admin/workflows/${i.screen}` : null, editor: true },
  { key: 'field-new', url: i => i.screen && i.stepId ? `/admin/workflows/${i.screen}/steps/${i.stepId}/fields/new` : null, editor: true },
  { key: 'field-edit', url: i => i.screen && i.stepId && i.fieldId ? `/admin/workflows/${i.screen}/steps/${i.stepId}/fields/${i.fieldId}/edit` : null, editor: true },
  { key: 'process', url: () => '/admin/process' },
  { key: 'kpis', url: () => '/admin/kpis' },
  { key: 'audit', url: () => '/admin/audit' },
  { key: 'appointments', url: () => '/admin/appointments' },
  { key: 'home-collection', url: () => '/admin/home-collection' },
  { key: 'opd', url: () => '/admin/opd' },
  { key: 'opd-doctors', url: () => '/admin/opd/doctors' },
  { key: 'opd-settings', url: () => '/admin/opd/settings' },
  { key: 'ipd-placeholder', url: () => '/admin/ipd' },
  { key: 'setup', url: () => '/setup' },
  { key: 'printing', url: () => '/printing' },
  { key: 'signature', url: () => '/signature' },
];

async function relayCors(page: Page) {
  if (!process.env['CORS_RELAY']) return;
  await page.route(/prefrontal\.health\/api\//, async route => {
    const origin = new URL(page.url() || 'http://localhost').origin;
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const res = await route.fetch();
    await route.fulfill({ response: res, headers: { ...res.headers(), ...cors } });
  });
}

async function setTheme(page: Page, theme: 'dark' | 'light') {
  // The app's ThemeService follows the system scheme in its default 'system'
  // mode — emulate it so JS-themed surfaces (AG-Grid) flip too.
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((t) => {
    const r = document.documentElement;
    r.classList.toggle('dark', t === 'dark');
    r.classList.toggle('light', t === 'light');
    r.setAttribute('data-theme', t);
  }, theme);
}

const rows = (body: any): any[] => Array.isArray(body) ? body : (body?.data ?? []);

/** Record ids for the editor routes, from the app's own list calls. */
async function discover(page: Page): Promise<Ids> {
  const ids: Ids = {};
  const grab = async (path: string, re: RegExp) => {
    const p = page.waitForResponse(r => re.test(new URL(r.url()).pathname) && r.request().method() === 'GET', { timeout: 20_000 });
    await page.goto(path);
    return rows(await (await p.catch(() => null))?.json().catch(() => null));
  };
  const waitRoles = page.waitForResponse(r => /\/api\/roles\/?$/.test(new URL(r.url()).pathname) && r.request().method() === 'GET', { timeout: 20_000 });
  const users = await grab('/admin/users', /\/api\/users\/?$/);
  ids.userId = users.find(u => /labadmin/i.test(u.email ?? u.username ?? ''))?.id ?? users[0]?.id;
  const roles = rows(await (await waitRoles.catch(() => null))?.json().catch(() => null));
  ids.roleId = roles.find(r => /lab admin|technician/i.test(r.name ?? ''))?.id ?? roles[0]?.id;
  const wfs = await grab('/admin/workflows', /\/api\/workflows\/?$/);
  for (const w of wfs) {
    try {
      const cfg = JSON.parse(w.configJson ?? '{}');
      const step = (cfg.steps ?? []).find((s: any) => (s.fields ?? []).length) ?? cfg.steps?.[0];
      if (step) {
        ids.screen = w.screenName; ids.stepId = step.id; ids.fieldId = step.fields?.[0]?.id;
        break;
      }
    } catch { /* skip */ }
  }
  return ids;
}

async function audit(page: Page) {
  return page.evaluate(() => {
    const scope = document.querySelector('.shell-main') ?? document.body;
    const mono: string[] = []; const green: string[] = [];
    const hsl = (c: string) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(v => parseFloat(v));
      if (a < 0.2) return null;
      const R = r / 255, G = g / 255, B = b / 255;
      const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
      if (d < 0.12) return null;
      let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
      h = (h * 60 + 360) % 360;
      const l = (max + min) / 2;
      return { h, s: d / (1 - Math.abs(2 * l - 1)) };
    };
    const skip = '.pf-tube, .pf-tube__dot, pf-report-pdf-preview, .pf-livewrap__pdf, .nd-ai-glow, [data-functional], .ag-cell [class*="tube"], .pf-tc-dot, canvas, img, svg image';
    for (const el of Array.from(scope.querySelectorAll<HTMLElement>('*'))) {
      if (el.closest(skip)) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (el.offsetParent === null && cs.position !== 'fixed') continue;
      const tag = `${el.tagName.toLowerCase()}.${(el.className?.toString() || '').split(' ').filter(Boolean).slice(0, 2).join('.')}`;
      if ((el.textContent ?? '').trim() && /mono|courier|consolas|menlo/i.test(cs.fontFamily)) mono.push(tag);
      for (const c of [cs.color, cs.backgroundColor, cs.borderLeftColor]) {
        const x = hsl(c);
        if (x && x.h >= 90 && x.h <= 200 && x.s > 0.3) { green.push(`${tag} ${c}`); break; }
      }
    }
    const main = document.querySelector('.shell-main') as HTMLElement | null;
    const se = document.scrollingElement!;
    const primaries = Array.from(document.querySelectorAll<HTMLElement>('.pf-hb-btn--primary, .nd-btn--primary, pf-touch-btn .v-primary'))
      .filter(b => b.offsetParent !== null).length;
    return {
      mono: [...new Set(mono)].slice(0, 6), green: [...new Set(green)].slice(0, 6), primaries,
      band: !!document.querySelector('pf-hero-band'),
      scroll: Math.max(se.scrollHeight - se.clientHeight, main ? main.scrollHeight - main.clientHeight : 0),
    };
  });
}

test.describe('/admin — ND audit (real layout)', () => {
  test.setTimeout(15 * 60_000);
  test('every /admin page: band, ≤1 primary, no page scroll, no mono / green', async ({ page }) => {
    await relayCors(page);
    await loginAs(page, 'admin');
    await page.setViewportSize({ width: 1440, height: 900 });
    const ids = await discover(page);
    const failures: string[] = [];
    for (const def of PAGES) {
      if (ONLY.length && !ONLY.includes(def.key)) continue;
      const url = def.url(ids);
      if (!url) { failures.push(`${def.key}: no record to open (skipped)`); continue; }
      for (const w of [1440, 375] as const) {
        await page.setViewportSize({ width: w, height: w === 1440 ? 900 : 812 });
        await page.goto(url);
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
        await page.waitForTimeout(600);
        const r = await audit(page);
        if (!r.band) failures.push(`${def.key}@${w}: no band`);
        if (r.primaries > 1) failures.push(`${def.key}@${w}: ${r.primaries} primaries`);
        if (r.scroll > 1) failures.push(`${def.key}@${w}: page scrolls ${r.scroll}px`);
        if (r.mono.length) failures.push(`${def.key}@${w}: monospace ${r.mono.join(' | ')}`);
        if (r.green.length) failures.push(`${def.key}@${w}: green ${r.green.join(' | ')}`);
        if (SHOTS) {
          for (const theme of ['light', 'dark'] as const) {
            await setTheme(page, theme);
            await page.waitForTimeout(200);
            await page.screenshot({ path: `${SHOTS}/${def.key}-${w}-${theme}.png` });
          }
          await setTheme(page, 'light');
        }
      }
    }
    console.log('AUDIT\n' + (failures.join('\n') || 'clean'));
    expect(failures.filter(f => !f.endsWith('(skipped)'))).toEqual([]);
  });
});
