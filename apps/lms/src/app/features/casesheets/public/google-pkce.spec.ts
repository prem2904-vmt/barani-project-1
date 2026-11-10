import {
  PKCE_KEY, PKCE_TTL_MS, PkceStorage, authorizeUrl, challengeFor, newVerifier, readEnterAnswer, safeNext, startPkce, takePkce,
} from './google-pkce';

function mem(): PkceStorage & { m: Map<string, string> } {
  const m = new Map<string, string>();
  return { m, getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } };
}

describe('Google sign-in PKCE (case-sheet site)', () => {
  it('S256 challenge matches RFC 7636 appendix B', async () => {
    expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('verifier: 43 base64url characters, random each time', () => {
    const a = newVerifier();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newVerifier()).not.toBe(a);
  });

  it('authorize URL = GoTrue /authorize with provider google, our callback and the S256 challenge', () => {
    const u = new URL(authorizeUrl('https://x.supabase.co/', 'https://prepare-dev.prefrontal.health/auth/callback', 'CH'));
    expect(u.origin + u.pathname).toBe('https://x.supabase.co/auth/v1/authorize');
    expect(u.searchParams.get('provider')).toBe('google');
    expect(u.searchParams.get('redirect_to')).toBe('https://prepare-dev.prefrontal.health/auth/callback');
    expect(u.searchParams.get('code_challenge')).toBe('CH');
    expect(u.searchParams.get('code_challenge_method')).toBe('s256');
  });

  it('start remembers the verifier + a SAFE next; take is single use', async () => {
    const s = mem();
    const url = await startPkce({ supabaseUrl: 'https://x.supabase.co', origin: 'https://cs.test', next: '/cases/1', storage: s, now: 1000 });
    const rec = JSON.parse(s.m.get(PKCE_KEY)!);
    expect(new URL(url).searchParams.get('code_challenge')).toBe(await challengeFor(rec.verifier));
    expect(new URL(url).searchParams.get('redirect_to')).toBe('https://cs.test/auth/callback');
    expect(takePkce(s, 2000)).toEqual({ verifier: rec.verifier, next: '/cases/1', at: 1000 });
    expect(takePkce(s, 2000)).toBeNull();
  });

  it('an expired, missing or garbled verifier is refused (and still removed)', async () => {
    const s = mem();
    await startPkce({ supabaseUrl: 'https://x', origin: 'https://cs.test', next: null, storage: s, now: 0 });
    expect(takePkce(s, PKCE_TTL_MS + 1)).toBeNull();
    expect(s.m.has(PKCE_KEY)).toBe(false);
    s.setItem(PKCE_KEY, '{nope');
    expect(takePkce(s)).toBeNull();
    s.setItem(PKCE_KEY, JSON.stringify({ verifier: 'short', at: Date.now() }));
    expect(takePkce(s)).toBeNull();
    expect(takePkce(null)).toBeNull();
  });

  it('safeNext: in-app paths only, never sign-in / callback / login, no open redirect', () => {
    expect(safeNext('/cases/9?x=1')).toBe('/cases/9?x=1');
    expect(safeNext('/settings')).toBe('/settings');
    for (const bad of [null, '', 'https://evil.com', '//evil.com', '/\\evil.com', '/sign-in', '/sign-in?e=x', '/auth/callback?code=1', '/login'])
      expect(safeNext(bad as string)).toBe('/');
  });

  it('personal/enter answers (final contract): personal, lab with / without case sheets, gate closed, refusals, 424, transient', () => {
    expect(readEnterAnswer(200, { kind: 'personal', labUser: false, created: true, caseSheets: true, tenantId: 'tp' }))
      .toEqual({ kind: 'personal', tenantId: 'tp', created: true });
    expect(readEnterAnswer(200, { kind: 'personal', labUser: false, created: false, caseSheets: true, tenantId: 'tp' }))
      .toEqual({ kind: 'personal', tenantId: 'tp', created: false });
    expect(readEnterAnswer(200, { kind: 'lab', labUser: true, created: false, caseSheets: true, tenantId: 't1' }))
      .toEqual({ kind: 'lab', tenantId: 't1', caseSheets: true });
    expect(readEnterAnswer(200, { kind: 'lab', labUser: true, created: false, caseSheets: false, tenantId: 't1' }))
      .toEqual({ kind: 'lab', tenantId: 't1', caseSheets: false });
    expect(readEnterAnswer(200, { something: 'else' })).toEqual({ kind: 'transient' });
    expect(readEnterAnswer(404, null)).toEqual({ kind: 'unavailable' });
    expect(readEnterAnswer(401, { code: 'not_signed_in' })).toEqual({ kind: 'refused', reason: 'not_signed_in' });
    for (const c of ['provider_not_allowed', 'email_missing', 'email_not_allowed', 'email_not_verified', 'account_blocked', 'account_inactive'])
      expect(readEnterAnswer(403, { status: 403, code: c })).toEqual({ kind: 'refused', reason: c });
    expect(readEnterAnswer(403, { code: 'something_new' })).toEqual({ kind: 'refused', reason: 'refused' });
    expect(readEnterAnswer(424, { code: 'verification_unavailable' })).toEqual({ kind: 'transient', reason: 'verification_unavailable' });
    for (const st of [0, 408, 429, 500, 503]) expect(readEnterAnswer(st, null)).toEqual({ kind: 'transient' });
  });
});
