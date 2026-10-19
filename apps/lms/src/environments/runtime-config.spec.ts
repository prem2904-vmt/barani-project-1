import { loadRuntimeConfig, mergeRuntimeConfig, RuntimeConfigTarget } from './runtime-config';

const builtIn = (over: Partial<RuntimeConfigTarget> = {}): RuntimeConfigTarget => ({
  runtimeConfig: true,
  apiUrl: 'https://dev-api',
  reportPublicBaseUrl: 'https://dev-web',
  auth: { supabaseUrl: 'https://dev.supabase.co', supabaseAnonKey: 'dev-key' },
  ...over,
});

const reply = (body: unknown, status = 200) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe('runtime config loader', () => {
  let warnings: string[];
  const warn = (m: string) => warnings.push(m);
  beforeEach(() => { warnings = []; });

  it('merges every known key into the same object', async () => {
    const env = builtIn();
    const ref = env;
    const ok = await loadRuntimeConfig(env, reply({
      apiUrl: 'https://stg-api', reportPublicBaseUrl: 'https://stg-web',
      auth: { supabaseUrl: 'https://stg.supabase.co', supabaseAnonKey: 'stg-key' },
    }), { warn });
    expect(ok).toBe(true);
    expect(env).toBe(ref);
    expect(env.apiUrl).toBe('https://stg-api');
    expect(env.reportPublicBaseUrl).toBe('https://stg-web');
    expect(env.auth).toEqual({ supabaseUrl: 'https://stg.supabase.co', supabaseAnonKey: 'stg-key' });
    expect(warnings).toEqual([]);
  });

  it('requests /config.json with no-store', async () => {
    let seen: { url: string; cache?: string } | null = null;
    await loadRuntimeConfig(builtIn(), async (url, init) => {
      seen = { url, cache: init?.cache };
      return { ok: true, status: 200, json: async () => ({ apiUrl: 'x' }) };
    }, { warn });
    expect(seen).toEqual({ url: '/config.json', cache: 'no-store' });
  });

  it('merges nested auth field by field', async () => {
    const env = builtIn();
    await loadRuntimeConfig(env, reply({ auth: { supabaseAnonKey: 'new-key' } }), { warn });
    expect(env.auth).toEqual({ supabaseUrl: 'https://dev.supabase.co', supabaseAnonKey: 'new-key' });
    expect(env.apiUrl).toBe('https://dev-api');
  });

  it('ignores unknown keys', async () => {
    const env = builtIn();
    await loadRuntimeConfig(env, reply({ apiUrl: 'https://stg-api', evil: 'x', production: false, auth: { bypass: true, extra: 1 } }), { warn });
    expect(env).not.toHaveProperty('evil');
    expect((env as unknown as Record<string, unknown>)['production']).toBeUndefined();
    expect(env.auth).not.toHaveProperty('bypass');
    expect(env.apiUrl).toBe('https://stg-api');
  });

  it('ignores wrongly-typed values but applies the valid ones', async () => {
    const env = builtIn();
    const ok = await loadRuntimeConfig(env, reply({ apiUrl: 42, reportPublicBaseUrl: 'https://stg-web', auth: 'nope' }), { warn });
    expect(ok).toBe(true);
    expect(env.apiUrl).toBe('https://dev-api');
    expect(env.reportPublicBaseUrl).toBe('https://stg-web');
    expect(env.auth.supabaseUrl).toBe('https://dev.supabase.co');
  });

  it('keeps built-ins and warns once when nothing usable is in the file', async () => {
    for (const body of [null, [], 'str', { apiUrl: '' }, { apiUrl: 1, auth: { supabaseUrl: false } }]) {
      const env = builtIn(); warnings = [];
      expect(await loadRuntimeConfig(env, reply(body), { warn })).toBe(false);
      expect(env).toEqual(builtIn());
      expect(warnings.length).toBe(1);
    }
  });

  it('falls back on 404', async () => {
    const env = builtIn();
    expect(await loadRuntimeConfig(env, reply({}, 404), { warn })).toBe(false);
    expect(env).toEqual(builtIn());
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('404');
  });

  it('falls back on invalid JSON', async () => {
    const env = builtIn();
    const ok = await loadRuntimeConfig(env, async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }), { warn });
    expect(ok).toBe(false);
    expect(env).toEqual(builtIn());
    expect(warnings.length).toBe(1);
  });

  it('falls back when the network rejects', async () => {
    const env = builtIn();
    expect(await loadRuntimeConfig(env, async () => { throw new TypeError('Failed to fetch'); }, { warn })).toBe(false);
    expect(env).toEqual(builtIn());
    expect(warnings.length).toBe(1);
  });

  it('falls back on timeout and aborts the request', async () => {
    const env = builtIn();
    let aborted = false;
    const hang = (_u: string, init?: { signal?: AbortSignal }) => new Promise<never>(() => {
      init?.signal?.addEventListener('abort', () => { aborted = true; });
    });
    const ok = await loadRuntimeConfig(env, hang, { warn, timeoutMs: 20 });
    expect(ok).toBe(false);
    expect(aborted).toBe(true);
    expect(env).toEqual(builtIn());
    expect(warnings[0]).toContain('timed out');
  });

  it('skips the fetch entirely when the flag is off', async () => {
    let called = false;
    const env = builtIn({ runtimeConfig: false });
    const ok = await loadRuntimeConfig(env, async () => { called = true; return { ok: true, status: 200, json: async () => ({ apiUrl: 'x' }) }; }, { warn });
    expect(ok).toBe(false);
    expect(called).toBe(false);
    expect(env).toEqual(builtIn({ runtimeConfig: false }));
    expect(warnings).toEqual([]);
  });

  it('mergeRuntimeConfig counts applied keys', () => {
    expect(mergeRuntimeConfig(builtIn(), { apiUrl: 'a', auth: { supabaseUrl: 'b' } })).toBe(2);
  });
});
