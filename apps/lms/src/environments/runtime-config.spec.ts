import { loadRuntimeConfig, mergeRuntimeConfig, RuntimeConfigTarget, startWithRuntimeConfig } from './runtime-config';

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

  it('app mode (case sheets, plan §4.4): only "lms" / "casesheets" are applied', async () => {
    const env = builtIn();
    await loadRuntimeConfig(env, reply({ mode: 'casesheets' }), { warn });
    expect(env.mode).toBe('casesheets');
    expect(mergeRuntimeConfig(env, { mode: 'lms' })).toBe(1);
    expect(env.mode).toBe('lms');
    for (const bad of ['admin', 1, true, null, { x: 1 }]) {
      const e = builtIn();
      expect(mergeRuntimeConfig(e, { mode: bad })).toBe(0);
      expect(e).not.toHaveProperty('mode');
    }
  });

  it('mergeRuntimeConfig counts applied keys', () => {
    expect(mergeRuntimeConfig(builtIn(), { apiUrl: 'https://a.example', auth: { supabaseUrl: 'https://b.example' } })).toBe(2);
  });
});

describe('startWithRuntimeConfig', () => {
  const fail = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const good = async () => ({ ok: true, status: 200, json: async () => ({ apiUrl: 'https://stg-api' }) });
  const hosts = ['dev.example.com', 'localhost'];
  let queue: Array<() => Promise<void>>;
  const schedule = (fn: () => Promise<void>) => { queue.push(fn); };
  beforeEach(() => { queue = []; document.body.innerHTML = ''; });
  const base = () => builtIn({ fallbackHosts: hosts });

  it('success: merges and bootstraps', async () => {
    const env = base(); let boots = 0;
    await startWithRuntimeConfig(env, () => boots++, { fetchFn: good, hostname: 'stg.example.com', schedule, warn: () => undefined });
    expect(boots).toBe(1);
    expect(env.apiUrl).toBe('https://stg-api');
  });

  it('failure on a fallback host: built-ins, bootstraps, no message', async () => {
    const env = base(); let boots = 0;
    await startWithRuntimeConfig(env, () => boots++, { fetchFn: fail, hostname: 'dev.example.com', schedule, warn: () => undefined });
    expect(boots).toBe(1);
    expect(env.apiUrl).toBe('https://dev-api');
    expect(document.body.textContent).not.toContain("Can't load settings");
  });

  it('failure elsewhere: no bootstrap, message shown, retries, bootstraps on later success', async () => {
    const env = base(); let boots = 0; let calls = 0;
    const flaky = async () => (++calls <= 3 ? fail() : good());
    await startWithRuntimeConfig(env, () => boots++, { fetchFn: flaky, hostname: 'stg.example.com', schedule, warn: () => undefined });
    expect(boots).toBe(0);
    expect(document.body.textContent).toContain("Can't load settings");
    expect(document.body.textContent).toContain('Try again');
    expect(env.apiUrl).toBe('https://dev-api');
    await queue.shift()!();            // retry 1 (call 2) fails
    expect(boots).toBe(0);
    await queue.shift()!();            // retry 2 (call 3) fails
    expect(boots).toBe(0);
    await queue.shift()!();            // retry 3 (call 4) succeeds
    expect(boots).toBe(1);
    expect(env.apiUrl).toBe('https://stg-api');
    expect(document.body.textContent).not.toContain("Can't load settings");
  });

  it('stops retrying after the limit and keeps the button', async () => {
    const env = base(); let boots = 0;
    await startWithRuntimeConfig(env, () => boots++, { fetchFn: fail, hostname: 'stg.example.com', schedule, warn: () => undefined, retryMs: 5000, maxRetryMs: 15000 });
    for (let i = 0; i < 3; i++) await queue.shift()!();
    expect(queue.length).toBe(0);
    expect(boots).toBe(0);
    expect(document.querySelector('button')).not.toBeNull();
  });

  it('Try again button reloads', async () => {
    let reloaded = 0;
    await startWithRuntimeConfig(base(), () => undefined, { fetchFn: fail, hostname: 'stg.example.com', schedule, warn: () => undefined, reload: () => { reloaded++; } });
    document.querySelector('button')!.click();
    expect(reloaded).toBe(1);
  });

  it('flag off: bootstraps without fetching', async () => {
    let boots = 0;
    await startWithRuntimeConfig(builtIn({ runtimeConfig: false }), () => boots++, { fetchFn: fail, hostname: 'stg.example.com', schedule });
    expect(boots).toBe(1);
  });
});

describe('url safety', () => {
  it('rejects http:// and non-URLs', () => {
    const env = builtIn();
    expect(mergeRuntimeConfig(env, { apiUrl: 'http://evil.example.com', reportPublicBaseUrl: 'javascript:alert(1)' })).toBe(0);
    expect(env).toEqual(builtIn());
  });
  it('allows http on localhost and 127.0.0.1', () => {
    const env = builtIn();
    expect(mergeRuntimeConfig(env, { apiUrl: 'http://localhost:5270' })).toBe(1);
    expect(env.apiUrl).toBe('http://localhost:5270');
    expect(mergeRuntimeConfig(env, { apiUrl: 'http://127.0.0.1:5270' })).toBe(1);
  });
});
