import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * LOCAL full stack (playwright.local.config.ts): the integrated mw on
 * 127.0.0.1 via prefrontal-mw `LabFlowE2EHost` (fresh local prefrontal_test_*
 * DB, migrations applied on boot, test-only auth instead of Supabase) and a
 * static production build of this app served on 127.0.0.1:4300 whose
 * /config.json points apiUrl at that host. Nothing leaves the machine: every
 * request to *.prefrontal.health / *.supabase.co is aborted and fails the run.
 */
export interface StackPerson { authId: string; name: string }
export interface Stack { apiUrl: string; tenantId: string; branchId: string; admin: StackPerson; colleague: StackPerson }

export const STACK = JSON.parse(readFileSync(process.env['PF_STACK'] ?? '', 'utf8')) as Stack;
export const PLATFORM_TOKEN = process.env['PF_PLATFORM_TOKEN'] ?? 'local-test';
export const SHOTS = process.env['PF_SHOTS'] ?? '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

for (const u of [STACK.apiUrl, process.env['LOCAL_BASE_URL'] || 'http://127.0.0.1:4300']) {
  const h = new URL(u).hostname;
  if (h !== '127.0.0.1' && h !== 'localhost') throw new Error(`local-stack E2E refuses non-local host ${h}`);
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** Unsigned test JWT — the mw TestAuthHandler reads its `sub` (the seeded AuthId). */
export const jwt = (sub: string) =>
  `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400, email: `${sub}@test.invalid` })}.sig`;

/** Requests to real hosts that were blocked (each one fails the spec that made it). */
export const blocked: string[] = [];

export interface OpenOpts { theme?: 'light' | 'dark'; beta?: string[]; viewport?: { width: number; height: number } }

/** Install the guard + the signed-in session on a context (every page in it). */
export async function prepareContext(ctx: BrowserContext, person: StackPerson, opts: OpenOpts = {}): Promise<void> {
  await ctx.route(/prefrontal\.health|supabase\.co/, r => {
    let from = '';
    try { from = r.request().frame().url(); } catch { /* service worker */ }
    blocked.push(`${r.request().url()} (page ${from})`);
    return r.abort();
  });
  await ctx.addInitScript(([session, theme, beta]) => {
    if (!sessionStorage.getItem('pf.e2e.seeded')) {
      sessionStorage.setItem('pf.e2e.seeded', '1');
      localStorage.clear();
      localStorage.setItem('pf.session', session);
      localStorage.setItem('pf-design', 'new');
      localStorage.setItem('pf-theme', theme);
      for (const k of JSON.parse(beta) as string[]) localStorage.setItem(`pf.beta.${k}`, '1');
    }
  }, [JSON.stringify({ access_token: jwt(person.authId), refresh_token: `rt-${person.authId}` }), opts.theme ?? 'light', JSON.stringify(opts.beta ?? [])] as const);
}

export async function openAs(browser: Browser, person: StackPerson, path = '/', opts: OpenOpts = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    viewport: opts.viewport ?? { width: 1440, height: 900 },
    colorScheme: opts.theme ?? 'light',
  });
  await prepareContext(ctx, person, opts);
  const page = await ctx.newPage();
  await page.goto(path);
  return { ctx, page };
}

export async function api<T = unknown>(as: StackPerson, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${STACK.apiUrl}${path}`, {
    method, headers: { authorization: `Bearer ${as.authId}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  const j = JSON.parse(text) as { success?: boolean; data: T; error?: unknown };
  if (j.success === false) throw new Error(`${method} ${path} → ${text}`);
  return j.data;
}

/** The platform (admin-console) API — service token, server to server. */
export async function platform<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${STACK.apiUrl}/api/platform${path}`, {
    method, headers: { 'X-Platform-Service-Token': PLATFORM_TOKEN, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`platform ${method} ${path} → ${res.status} ${text}`);
  const j = JSON.parse(text) as { success?: boolean; data: T };
  if (j.success === false) throw new Error(`platform ${method} ${path} → ${text}`);
  return j.data;
}

export async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

/** "AI" as a visible word, except inside the AI connector surface. */
export async function expectNoVisibleAiText(page: Page): Promise<void> {
  const hits = await page.evaluate(() => {
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent ?? '';
      if (!/\bAI\b/.test(t)) continue;
      const el = n.parentElement;
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || el.getClientRects().length === 0) continue;
      if (el.closest('[data-ai-connector], .pf-mcp, pf-ai-connector, pf-mcp-connector')) continue;
      if (/AI connector/i.test(t)) continue;
      out.push(t.trim().slice(0, 120));
    }
    return out;
  });
  expect(hits, `visible "AI" text on ${page.url()}`).toEqual([]);
}

export function expectNothingBlocked(): void {
  expect(blocked, 'requests to real *.prefrontal.health / *.supabase.co hosts').toEqual([]);
}
