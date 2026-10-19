/**
 * Runtime configuration ("build once, deploy many").
 *
 * Before Angular bootstraps, the web build fetches `/config.json` from its own
 * origin and merges the values INTO the exported `environment` object (in
 * place, known keys only, type-checked), so every existing `environment.apiUrl`
 * call site keeps working. Any failure (404, bad JSON, wrong types, timeout)
 * keeps the built-in values and warns once — it never blocks or crashes.
 *
 * Shape served by the host:
 *   { "apiUrl": string, "reportPublicBaseUrl": string,
 *     "auth": { "supabaseUrl": string, "supabaseAnonKey": string } }
 *
 * Only the web production environment sets `runtimeConfig: true`; phone and
 * desktop builds keep their baked-in settings.
 */
export interface RuntimeConfigTarget {
  runtimeConfig?: boolean;
  apiUrl: string;
  reportPublicBaseUrl?: string;
  auth: { supabaseUrl: string; supabaseAnonKey: string };
}

export interface RuntimeConfigOptions {
  /** Defaults to `/config.json` (own origin). */
  url?: string;
  /** Defaults to 4000 ms. */
  timeoutMs?: number;
  /** Defaults to console.warn. */
  warn?: (message: string) => void;
}

type FetchFn = (input: string, init?: { cache?: 'no-store'; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Merge the known, correctly-typed keys of `raw` into `target`. Returns how many were applied. */
export function mergeRuntimeConfig(target: RuntimeConfigTarget, raw: unknown): number {
  if (!isRecord(raw)) return 0;
  let applied = 0;
  if (isNonEmptyString(raw['apiUrl'])) { target.apiUrl = raw['apiUrl']; applied++; }
  if (isNonEmptyString(raw['reportPublicBaseUrl'])) { target.reportPublicBaseUrl = raw['reportPublicBaseUrl']; applied++; }
  const auth = raw['auth'];
  if (isRecord(auth)) {
    if (isNonEmptyString(auth['supabaseUrl'])) { target.auth.supabaseUrl = auth['supabaseUrl']; applied++; }
    if (isNonEmptyString(auth['supabaseAnonKey'])) { target.auth.supabaseAnonKey = auth['supabaseAnonKey']; applied++; }
  }
  return applied;
}

/**
 * Fetch `/config.json` and merge it into `target`. Resolves `true` when at
 * least one value was applied; never rejects.
 */
export async function loadRuntimeConfig(
  target: RuntimeConfigTarget,
  fetchFn: FetchFn | undefined = typeof fetch === 'function' ? (fetch as unknown as FetchFn) : undefined,
  options: RuntimeConfigOptions = {},
): Promise<boolean> {
  if (!target.runtimeConfig) return false;
  const warn = options.warn ?? ((m: string) => console.warn(m));
  const url = options.url ?? '/config.json';
  const timeoutMs = options.timeoutMs ?? 4000;
  if (!fetchFn) { warn('[runtime-config] fetch unavailable; using built-in settings.'); return false; }

  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => { ctrl?.abort(); resolve('timeout'); }, timeoutMs);
  });
  try {
    const work = (async () => {
      const res = await fetchFn(url, { cache: 'no-store', signal: ctrl?.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })();
    work.catch(() => { /* settled via the race below */ });
    const raw = await Promise.race([work, timeout]);
    if (raw === 'timeout') throw new Error(`timed out after ${timeoutMs} ms`);
    const applied = mergeRuntimeConfig(target, raw);
    if (applied === 0) throw new Error('no usable settings in the file');
    return true;
  } catch (e) {
    warn(`[runtime-config] ${url} not applied (${e instanceof Error ? e.message : String(e)}); using built-in settings.`);
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
