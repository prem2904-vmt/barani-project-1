import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { environment } from '../../../environments/environment';
import {
  ConsentError, OAuthConsentClient, consentErrorText, isConsentNeeded, redirectHost, safeRedirectUrl,
} from './oauth-consent.client';

/**
 * The consent half of Supabase's OAuth 2.1 server, called with the token
 * AuthService owns (the app has no Supabase SDK session on purpose — see the
 * client's header). Pins the endpoints/headers the SDK itself uses, the
 * one-refresh-then-retry rule, and the plain-words error mapping.
 */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function setup(token: string | null = 'tok-1') {
  const auth = {
    getAccessToken: vi.fn(async () => token),
    refreshSession: vi.fn(async () => 'ok' as const),
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: auth }] });
  return { client: TestBed.inject(OAuthConsentClient), auth };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('OAuthConsentClient', () => {
  it('GETs the authorization with the app token + anon key (the SDK\'s endpoint)', async () => {
    const fetchMock = vi.fn(async () => json(200, { authorization_id: 'a1', client: { name: 'Claude' }, redirect_uri: 'https://claude.ai/cb', scope: 'openid' }));
    vi.stubGlobal('fetch', fetchMock);
    const { client } = setup();
    const d = await client.getDetails('a1');
    expect(isConsentNeeded(d)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${environment.auth.supabaseUrl}/auth/v1/oauth/authorizations/a1`);
    expect(init.method).toBe('GET');
    const h = init.headers as Record<string, string>;
    expect(h['Authorization']).toBe('Bearer tok-1');
    expect(h['apikey']).toBe(environment.auth.supabaseAnonKey);
    expect(init.body).toBeUndefined();
  });

  it('approve / deny POST {action} to …/consent and return the redirect', async () => {
    const fetchMock = vi.fn(async () => json(200, { redirect_url: 'https://claude.ai/cb?code=x&state=s' }));
    vi.stubGlobal('fetch', fetchMock);
    const { client } = setup();
    expect((await client.approve('a 1')).redirect_url).toContain('code=x');
    await client.deny('a1');
    const [u1, i1] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [u2, i2] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(u1).toBe(`${environment.auth.supabaseUrl}/auth/v1/oauth/authorizations/a%201/consent`);
    expect(i1.method).toBe('POST');
    expect(JSON.parse(String(i1.body))).toEqual({ action: 'approve' });
    expect(u2).toMatch(/\/a1\/consent$/);
    expect(JSON.parse(String(i2.body))).toEqual({ action: 'deny' });
  });

  it('a 401 refreshes once and retries with the new token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(401, { msg: 'JWT expired' }))
      .mockResolvedValueOnce(json(200, { redirect_url: 'https://claude.ai/cb' }));
    vi.stubGlobal('fetch', fetchMock);
    const { client, auth } = setup();
    const r = await client.getDetails('a1');
    expect(isConsentNeeded(r)).toBe(false);
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps failures to plain kinds: 404 expired, 401 twice signed-out, network, unknown', async () => {
    const { client, auth } = setup();
    vi.stubGlobal('fetch', vi.fn(async () => json(404, { msg: 'authorization not found' })));
    await expect(client.getDetails('a1')).rejects.toMatchObject({ kind: 'expired' });

    vi.stubGlobal('fetch', vi.fn(async () => json(401, {})));
    auth.refreshSession.mockResolvedValueOnce('dead' as never);
    await expect(client.getDetails('a1')).rejects.toMatchObject({ kind: 'signed-out' });

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(client.approve('a1')).rejects.toMatchObject({ kind: 'network' });

    vi.stubGlobal('fetch', vi.fn(async () => json(400, { msg: 'authorization request has expired' })));
    await expect(client.approve('a1')).rejects.toMatchObject({ kind: 'expired' });

    vi.stubGlobal('fetch', vi.fn(async () => json(400, { msg: 'weird' })));
    await expect(client.approve('a1')).rejects.toBeInstanceOf(ConsentError);
  });

  it('no token / no id never calls Supabase', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { client } = setup(null);
    await expect(client.getDetails('a1')).rejects.toMatchObject({ kind: 'signed-out' });
    await expect(client.approve('')).rejects.toMatchObject({ kind: 'missing' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('consent helpers', () => {
  it('safeRedirectUrl: https anywhere, http only on this machine, nothing else', () => {
    expect(safeRedirectUrl('https://claude.ai/api/mcp/auth_callback?code=1')).toContain('https://claude.ai/');
    expect(safeRedirectUrl('http://localhost:6274/oauth/callback')).toContain('http://localhost:6274');
    expect(safeRedirectUrl('http://127.0.0.1:3000/cb')).not.toBeNull();
    expect(safeRedirectUrl('http://evil.example/cb')).toBeNull();
    expect(safeRedirectUrl('javascript:alert(1)')).toBeNull();
    expect(safeRedirectUrl('data:text/html,hi')).toBeNull();
    expect(safeRedirectUrl('/relative')).toBeNull();
    expect(safeRedirectUrl(undefined)).toBeNull();
  });

  it('redirectHost names the host only; consentErrorText is plain words', () => {
    expect(redirectHost('https://claude.ai/api/mcp/auth_callback')).toBe('claude.ai');
    expect(redirectHost('nope')).toBeNull();
    for (const k of ['missing', 'expired', 'signed-out', 'network', 'unknown'] as const) {
      expect(consentErrorText(k)).not.toMatch(/supabase|http|[45]\d\d|error_code/i);
    }
  });
});
