import { mergeRuntimeConfig, RuntimeConfigTarget } from './runtime-config';

/** /config.json can carry the passkey RP ID (dev = the dev Supabase project; no env key). */
const target = (): RuntimeConfigTarget => ({
  runtimeConfig: true, apiUrl: 'https://dev-api',
  auth: { supabaseUrl: 'https://dev.supabase.co', supabaseAnonKey: 'k', passkeyRpId: 'med-dev.prefrontal.health' },
});

describe('runtime config — passkeys', () => {
  it('takes a bare-domain passkeyRpId (lower-cased)', () => {
    const t = target();
    expect(mergeRuntimeConfig(t, { auth: { passkeyRpId: 'Med.Prefrontal.Health' } })).toBe(1);
    expect(t.auth.passkeyRpId).toBe('med.prefrontal.health');
  });
  it('ignores an RP ID with a scheme, port or path', () => {
    for (const bad of ['https://med.prefrontal.health', 'med.prefrontal.health:443', 'med.prefrontal.health/x', '', 42]) {
      const t = target();
      expect(mergeRuntimeConfig(t, { auth: { passkeyRpId: bad } })).toBe(0);
      expect(t.auth.passkeyRpId).toBe('med-dev.prefrontal.health');
    }
  });
  it('has no env key: dev is the dev Supabase project (core/beta/beta-gate.ts)', () => {
    const t = target();
    expect(mergeRuntimeConfig(t, { env: 'dev' })).toBe(0);
    expect((t as unknown as Record<string, unknown>)['env']).toBeUndefined();
  });
});
