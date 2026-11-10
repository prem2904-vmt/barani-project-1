import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { STACK, settle, shot, type Theme } from './cs-stack';

/**
 * ADMIN CONSOLE — "Case sheet masters" (prefrontal-admin-ui feat/casesheets-wp8) on a LOCAL admin-mw whose product API
 * is the case-sheet host: the console talks to the real platform passthrough → template-tenant masters seeded by the
 * host. Runs only when CS_ADMIN_URL is set (served build + /config.json platformApi) and CS_ADMIN_JWT_SECRET is the
 * local admin-mw's throwaway Supabase:JwtSecret: the session is a locally signed HS256 token for the seeded super admin
 * (admin-mw validates it like any Supabase token; nothing reaches Supabase).
 */
const ADMIN_URL = process.env['CS_ADMIN_URL'] ?? '';
const SECRET_FILE = process.env['CS_ADMIN_JWT_SECRET_FILE'] ?? '';
const EMAIL = process.env['CS_ADMIN_EMAIL'] ?? 'e2e-console@test.invalid';
const SUPA = 'https://dkpzeiutuuasqgjnnylu.supabase.co';

test.skip(!ADMIN_URL || !SECRET_FILE, 'admin console stack not configured');

function hs256(payload: Record<string, unknown>, secret: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payload);
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

for (const theme of ['light', 'dark'] as Theme[]) {
  test(`case sheet masters in the console (${theme})`, async ({ browser }) => {
    const secret = readFileSync(SECRET_FILE, 'utf8').trim();
    const now = Math.floor(Date.now() / 1000);
    const sub = '00000000-0000-4000-8000-00000000e2e0';
    const token = hs256({ sub, aud: 'authenticated', role: 'authenticated', iss: `${SUPA}/auth/v1`, email: EMAIL, iat: now, exp: now + 3600 }, secret);
    const session = { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'e2e-rt',
      user: { id: sub, aud: 'authenticated', role: 'authenticated', email: EMAIL, app_metadata: { provider: 'google' }, user_metadata: {} } };
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
    await ctx.route(/supabase\.co/, r => r.abort());
    await ctx.addInitScript(([s, t]) => {
      localStorage.setItem('sb-dkpzeiutuuasqgjnnylu-auth-token', s);
      localStorage.setItem('pf-theme', t);
      localStorage.setItem('theme', t);
    }, [JSON.stringify(session), theme] as const);
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
    page.on('response', r => { if (r.status() >= 400) console.log('HTTP', r.status(), r.request().method(), r.url().slice(0, 160)); });
    page.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 300)));
    await page.goto(`${ADMIN_URL}/casesheet-masters`);
    await settle(page, 2500);
    await expect(page.getByText('General Medicine').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('ENT').first()).toBeVisible();
    await shot(page, 'admin-console-01-masters', { theme });

    await page.getByText('Nose History Taking', { exact: false }).first().click();
    await settle(page, 6000);
    console.log('URL', page.url());
    await shot(page, 'admin-console-02-master-open', { theme });
    await ctx.close();
    void STACK;
  });
}
