import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { PasskeyService } from './passkey.service';
import { PasskeyError } from './passkey-webauthn';
import { PlatformService } from '../services/platform.service';
import { BetaFeaturesService } from '../services/beta-features.service';
import { signal } from '@angular/core';

/** PasskeyService against Supabase Auth's /auth/v1/passkeys/* endpoints. */
const SB = environment.auth.supabaseUrl;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

type Route = (init: RequestInit) => Response | Promise<Response>;
function setup(routes: Record<string, Route>, opts: { available?: boolean } = {}) {
  TestBed.resetTestingModule();
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const key = `${init.method ?? 'GET'} ${url.replace(`${SB}/auth/v1`, '')}`;
    const r = routes[key];
    if (!r) return json(404, { error_code: 'not_found' });
    return r(init);
  }));
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { getAccessToken: async () => 'user-jwt' } },
      { provide: PlatformService, useValue: { isElectron: signal(false), isCapacitor: signal(false) } },
      { provide: BetaFeaturesService, useValue: { enabled: () => true } },
    ],
  });
  const svc = TestBed.inject(PasskeyService);
  vi.spyOn(svc, 'availability').mockReturnValue(opts.available === false
    ? { ok: false, reason: 'desktop' } : { ok: true, reason: null });
  return { svc, calls };
}

function stubCredentials(impl: { get?: () => Promise<unknown>; create?: () => Promise<unknown> }) {
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: { get: vi.fn(impl.get ?? (async () => null)), create: vi.fn(impl.create ?? (async () => null)) },
  });
  return navigator.credentials as unknown as { get: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
}

const assertion = { id: 'c1', toJSON: () => ({ id: 'c1', rawId: 'c1', type: 'public-key', response: {} }) };
const OPTIONS = { challenge_id: 'ch-1', options: { challenge: 'AQID', rpId: 'med-dev.prefrontal.health' } };

afterEach(() => vi.unstubAllGlobals());

describe('PasskeyService.authenticate (sign-in, discoverable — no username)', () => {
  it('fetches a challenge, asks the browser, verifies, and returns the Supabase session tokens', async () => {
    const { svc, calls } = setup({
      'POST /passkeys/authentication/options': () => json(200, OPTIONS),
      'POST /passkeys/authentication/verify': () => json(200, { access_token: 'acc', refresh_token: 'ref', user: { id: 'sub' } }),
    });
    const creds = stubCredentials({ get: async () => assertion });
    await expect(svc.authenticate()).resolves.toEqual({ access_token: 'acc', refresh_token: 'ref' });
    const getArg = creds.get.mock.calls[0][0] as CredentialRequestOptions;
    expect(getArg.publicKey?.allowCredentials).toBeUndefined();     // discoverable
    expect('mediation' in getArg).toBe(false);                       // modal by default
    const verify = JSON.parse(calls[1].init.body as string);
    expect(verify).toEqual({ challenge_id: 'ch-1', credential: assertion.toJSON() });
    // anonymous: apikey only, never a bearer
    expect((calls[0].init.headers as Record<string, string>)['Authorization']).toBeUndefined();
    expect((calls[0].init.headers as Record<string, string>)['apikey']).toBe(environment.auth.supabaseAnonKey);
  });

  it('passes conditional mediation (autofill) through', async () => {
    const { svc } = setup({
      'POST /passkeys/authentication/options': () => json(200, OPTIONS),
      'POST /passkeys/authentication/verify': () => json(200, { session: { access_token: 'a', refresh_token: 'r' } }),
    });
    const creds = stubCredentials({ get: async () => assertion });
    await svc.authenticate({ mediation: 'conditional' });
    expect((creds.get.mock.calls[0][0] as CredentialRequestOptions).mediation).toBe('conditional');
  });

  it('cancel in the browser dialog → PasskeyError cancelled, nothing verified', async () => {
    const { svc, calls } = setup({ 'POST /passkeys/authentication/options': () => json(200, OPTIONS) });
    stubCredentials({ get: async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); } });
    await expect(svc.authenticate()).rejects.toMatchObject({ kind: 'cancelled' });
    expect(calls).toHaveLength(1);
  });

  it('an unknown passkey → not_found; server down → network', async () => {
    const a = setup({
      'POST /passkeys/authentication/options': () => json(200, OPTIONS),
      'POST /passkeys/authentication/verify': () => json(400, { error_code: 'webauthn_credential_not_found' }),
    });
    stubCredentials({ get: async () => assertion });
    await expect(a.svc.authenticate()).rejects.toMatchObject({ kind: 'not_found' });

    const b = setup({});
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(b.svc.authenticate()).rejects.toMatchObject({ kind: 'network' });
  });

  it('refuses where passkeys are unavailable (Electron / phone apps / beta off)', async () => {
    const { svc, calls } = setup({}, { available: false });
    await expect(svc.authenticate()).rejects.toBeInstanceOf(PasskeyError);
    expect(calls).toHaveLength(0);
  });
});

describe('PasskeyService manage (signed in)', () => {
  it('register: challenge with the user token → create() → verify → names it after the device', async () => {
    const { svc, calls } = setup({
      'POST /passkeys/registration/options': () => json(200, { challenge_id: 'r-1', options: { challenge: 'AQID', rp: { name: 'Prefrontal' }, user: { id: 'CQo', name: 'u', displayName: 'U' }, pubKeyCredParams: [] } }),
      'POST /passkeys/registration/verify': () => json(200, { id: 'pk-1', created_at: '2026-10-31T05:00:00Z' }),
      'PATCH /passkeys/pk-1': (init) => json(200, { id: 'pk-1', friendly_name: JSON.parse(init.body as string).friendly_name, created_at: '2026-10-31T05:00:00Z' }),
    });
    stubCredentials({ create: async () => ({ id: 'c2', toJSON: () => ({ id: 'c2' }) }) });
    const item = await svc.register();
    expect(item.id).toBe('pk-1');
    expect(item.friendlyName).toBeTruthy();
    expect((calls[0].init.headers as Record<string, string>)['Authorization']).toBe('Bearer user-jwt');
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ challenge_id: 'r-1', credential: { id: 'c2' } });
  });

  it('list / rename / remove call GET, PATCH, DELETE with the user token', async () => {
    const { svc, calls } = setup({
      'GET /passkeys': () => json(200, [{ id: 'pk-1', friendly_name: 'My laptop', created_at: '2026-10-01T00:00:00Z', last_used_at: '2026-10-30T00:00:00Z' }]),
      'PATCH /passkeys/pk-1': () => json(200, { id: 'pk-1', friendly_name: 'Desk', created_at: '2026-10-01T00:00:00Z' }),
      'DELETE /passkeys/pk-1': () => new Response(null, { status: 204 }),
    });
    expect(await svc.list()).toEqual([{ id: 'pk-1', friendlyName: 'My laptop', createdAt: '2026-10-01T00:00:00Z', lastUsedAt: '2026-10-30T00:00:00Z' }]);
    expect((await svc.rename('pk-1', '  Desk  ')).friendlyName).toBe('Desk');
    await svc.remove('pk-1');
    expect(calls.map(c => c.init.method)).toEqual(['GET', 'PATCH', 'DELETE']);
    expect(calls.every(c => (c.init.headers as Record<string, string>)['Authorization'] === 'Bearer user-jwt')).toBe(true);
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ friendly_name: 'Desk' });
  });

  it('a 401 on add asks for a fresh sign-in, in plain words', async () => {
    const { svc } = setup({ 'POST /passkeys/registration/options': () => json(401, { msg: 'reauth' }) });
    await expect(svc.register()).rejects.toMatchObject({ kind: 'reauth' });
  });
});
