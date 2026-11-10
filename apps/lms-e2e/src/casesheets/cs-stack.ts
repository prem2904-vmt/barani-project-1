import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The case-sheet local stack (playwright.casesheets.config.ts): prefrontal-mw `CaseSheetsE2EHost` + one production
 * build served in LMS mode and in casesheets mode. Every login is an unsigned test JWT the host's test-only auth handler
 * reads (it never reaches Supabase); every request to a real *.prefrontal.health / *.supabase.co host is aborted and
 * fails the run, except the Google leg of the public sign-in, which {@link answerGoogle} answers in-page.
 */
export interface Person { authId: string; name: string; email?: string }
export interface CsStack {
  apiUrl: string; tenantId: string; branchId: string; templateTenantId: string;
  admin: Person; doctor: Person;
  plainLab: { tenantId: string; admin: Person };
  personal: Person;
  patients: { id: string; name: string }[];
  forms: { generalConsult: string; woundReview: string; entNose: string };
}

export const STACK = JSON.parse(readFileSync(process.env['PF_CS_STACK'] ?? '', 'utf8')) as CsStack;
export const LAB_URL = process.env['CS_LAB_URL'] || 'http://127.0.0.1:4371';
export const PUBLIC_URL = process.env['CS_PUBLIC_URL'] || 'http://127.0.0.1:4372';
export const SHOTS = process.env['CS_SHOTS'] ?? '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

for (const u of [STACK.apiUrl, LAB_URL, PUBLIC_URL]) {
  const h = new URL(u).hostname;
  if (h !== '127.0.0.1' && h !== 'localhost') throw new Error(`case-sheet E2E refuses non-local host ${h}`);
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** Unsigned test JWT (the mw TestAuthHandler reads sub / email / app_metadata). */
export function jwt(sub: string, extra: Record<string, unknown> = {}): string {
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400, email: `${sub}@test.invalid`, ...extra })}.sig`;
}
export const googleClaims = (email: string) => ({ email, app_metadata: { provider: 'google', providers: ['google'] }, session_id: `sess-${email}` });

export const blocked: string[] = [];

export type Theme = 'light' | 'dark';
export const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  ipad: { width: 1024, height: 1366 },
  desktop: { width: 1440, height: 900 },
} as const;
export type ViewportName = keyof typeof VIEWPORTS;

export interface OpenOpts { theme?: Theme; viewport?: ViewportName; signedIn?: boolean; tokenExtra?: Record<string, unknown> }

/** Guard + (optionally) a signed-in session on a fresh context. */
export async function newContext(browser: Browser, person: Person | null, opts: OpenOpts = {}): Promise<BrowserContext> {
  const name = opts.viewport ?? 'desktop';
  const vp = VIEWPORTS[name];
  const mobile = name === 'phone';
  const ctx = await browser.newContext({
    viewport: vp, colorScheme: opts.theme ?? 'light', acceptDownloads: true,
    deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: name !== 'desktop',
  });
  await ctx.route(/prefrontal\.health|supabase\.co/, r => {
    blocked.push(r.request().url());
    return r.abort();
  });
  const session = person
    ? JSON.stringify({ access_token: jwt(person.authId, opts.tokenExtra ?? {}), refresh_token: `rt-${person.authId}` })
    : '';
  await ctx.addInitScript(([s, theme]) => {
    if (!sessionStorage.getItem('pf.e2e.seeded')) {
      sessionStorage.setItem('pf.e2e.seeded', '1');
      localStorage.clear();
      if (s) localStorage.setItem('pf.session', s);
      localStorage.setItem('pf-design', 'new');
      localStorage.setItem('pf-theme', theme);
    }
  }, [session, opts.theme ?? 'light'] as const);
  return ctx;
}

export async function openAs(browser: Browser, person: Person | null, url: string, opts: OpenOpts = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await newContext(browser, person, opts);
  const page = await ctx.newPage();
  await page.goto(url);
  return { ctx, page };
}

/** Answer the Google leg (GoTrue authorize → our /auth/callback, PKCE token exchange) for `person`. Only Google's part. */
export async function answerGoogle(ctx: BrowserContext, person: Person): Promise<void> {
  await ctx.route(/supabase\.co\/auth\/v1\/authorize/, r => {
    const u = new URL(r.request().url());
    const back = new URL(u.searchParams.get('redirect_to') ?? `${PUBLIC_URL}/auth/callback`);
    back.searchParams.set('code', 'e2e-google-code');
    return r.fulfill({ status: 302, headers: { location: back.toString() } });
  });
  await ctx.route(/supabase\.co\/auth\/v1\/token/, r => {
    const req = r.request();
    const origin = req.headers()['origin'] ?? '*';
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const token = jwt(person.authId, googleClaims(person.email ?? ''));
    return r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({
      access_token: token, refresh_token: `rt-${person.authId}`, token_type: 'bearer', expires_in: 86400,
      user: { id: person.authId, aud: 'authenticated', email: person.email, app_metadata: { provider: 'google', providers: ['google'] } },
    }) });
  });
  await ctx.route(/supabase\.co\/auth\/v1\/logout/, r => r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }));
}

/** Raw JSON from the case-sheet API (Prepare contract, no ApiResponse wrapper) or the LMS (unwrapped `data`). */
export async function api<T = any>(as: Person, method: string, path: string, body?: unknown, extra: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${STACK.apiUrl}${path}`, {
    method, headers: { authorization: `Bearer ${jwt(as.authId, extra)}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  if (!text) return undefined as T;
  const j = JSON.parse(text);
  return (j && typeof j === 'object' && 'success' in j && 'data' in j ? j.data : j) as T;
}

export async function settle(page: Page, ms = 500): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(ms);
}

/** Screenshot `<name>--<viewport>--<theme>.png` (full page optional). */
export async function shot(page: Page, name: string, o: { viewport?: ViewportName; theme?: Theme; fullPage?: boolean } = {}): Promise<string> {
  if (!SHOTS) return '';
  await settle(page, 450);
  const file = join(SHOTS, `${name}--${o.viewport ?? 'desktop'}--${o.theme ?? 'light'}.png`);
  await page.screenshot({ path: file, fullPage: o.fullPage ?? false });
  return file;
}

/** Visible "AI" text (copy rule: "Cortex" / "AI connector" only). */
export async function expectNoVisibleAiText(page: Page): Promise<void> {
  const hits = await page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent ?? '';
      if (!/\bAI\b/.test(t) || /AI connector/i.test(t)) continue;
      const el = n.parentElement;
      if (!el || el.getClientRects().length === 0) continue;
      out.push(t.trim().slice(0, 120));
    }
    return out;
  });
  expect(hits, `visible "AI" text on ${page.url()}`).toEqual([]);
}

/** No native <select> / <datalist> anywhere on screen (owner rule). */
export async function expectNoNativeControls(page: Page): Promise<void> {
  expect(await page.locator('select:visible, datalist').count(), `native select/datalist on ${page.url()}`).toBe(0);
}

/** No sideways page scroll (phone rule). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, `horizontal overflow on ${page.url()}`).toBeLessThanOrEqual(1);
}

export function expectNothingBlocked(allow: RegExp[] = []): void {
  expect(blocked.filter(u => !allow.some(a => a.test(u))), 'requests to real *.prefrontal.health / *.supabase.co hosts').toEqual([]);
}
