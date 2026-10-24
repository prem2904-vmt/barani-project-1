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
  /** Hosts where the baked-in values are valid (dev + local). Elsewhere a failed load blocks bootstrap. */
  fallbackHosts?: readonly string[];
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

/** https only; plain http solely for local development hosts. */
export function isSafeUrl(v: unknown): v is string {
  if (!isNonEmptyString(v)) return false;
  try {
    const u = new URL(v);
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch { return false; }
}

/** Merge the known, correctly-typed keys of `raw` into `target`. Returns how many were applied. */
export function mergeRuntimeConfig(target: RuntimeConfigTarget, raw: unknown): number {
  if (!isRecord(raw)) return 0;
  let applied = 0;
  if (isSafeUrl(raw['apiUrl'])) { target.apiUrl = raw['apiUrl']; applied++; }
  if (isSafeUrl(raw['reportPublicBaseUrl'])) { target.reportPublicBaseUrl = raw['reportPublicBaseUrl']; applied++; }
  const auth = raw['auth'];
  if (isRecord(auth)) {
    if (isSafeUrl(auth['supabaseUrl'])) { target.auth.supabaseUrl = auth['supabaseUrl']; applied++; }
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

export interface StartDeps {
  fetchFn?: FetchFn;
  hostname?: string;
  doc?: Document;
  /** Schedules a retry; the callback returns a promise so tests can await it. */
  schedule?: (fn: () => Promise<void>, ms: number) => void;
  reload?: () => void;
  warn?: (message: string) => void;
  retryMs?: number;
  maxRetryMs?: number;
  timeoutMs?: number;
}

/**
 * Load the runtime settings, then call `bootstrap`.
 *  - success                         -> merge + bootstrap
 *  - failure on a fallbackHosts host -> keep built-ins, warn, bootstrap
 *  - failure anywhere else           -> NEVER bootstrap with the baked (dev) values;
 *    show a plain-DOM message and retry every 5 s for ~2 min, bootstrapping on success.
 */
export async function startWithRuntimeConfig(
  target: RuntimeConfigTarget,
  bootstrap: () => unknown,
  deps: StartDeps = {},
): Promise<void> {
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  const ok = await loadRuntimeConfig(target, deps.fetchFn, { warn, timeoutMs: deps.timeoutMs });
  if (ok || !target.runtimeConfig) { bootstrap(); return; }

  const host = (deps.hostname ?? (typeof location !== 'undefined' ? location.hostname : '')).toLowerCase();
  if ((target.fallbackHosts ?? []).includes(host)) { bootstrap(); return; }

  const doc = deps.doc ?? document;
  const schedule = deps.schedule ?? ((fn, ms) => { setTimeout(() => { void fn(); }, ms); });
  const reload = deps.reload ?? (() => location.reload());
  const retryMs = deps.retryMs ?? 5000;
  const maxAttempts = Math.max(1, Math.floor((deps.maxRetryMs ?? 120000) / retryMs));
  const ui = renderSettingsError(doc, reload);
  let attempts = 0;
  const attempt = async (): Promise<void> => {
    attempts++;
    const good = await loadRuntimeConfig(target, deps.fetchFn, { warn: () => { /* warned once already */ }, timeoutMs: deps.timeoutMs });
    if (good) { ui.remove(); bootstrap(); return; }
    if (attempts >= maxAttempts) { ui.giveUp(); return; }
    schedule(attempt, retryMs);
  };
  schedule(attempt, retryMs);
}

function renderSettingsError(doc: Document, reload: () => void): { remove(): void; giveUp(): void } {
  const style = doc.createElement('style');
  style.textContent =
    '.pf-cfg{font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;min-height:100vh;display:flex;' +
    'flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;' +
    'background:#fff;color:#111}.pf-cfg h1{font-size:1.25rem;margin:0 0 8px}.pf-cfg p{margin:0 0 16px}' +
    '.pf-cfg button{font:inherit;padding:8px 16px;border-radius:8px;border:1px solid #888;background:transparent;color:inherit;cursor:pointer}' +
    '@media (prefers-color-scheme:dark){.pf-cfg{background:#111;color:#eee}}';
  const root = doc.createElement('div');
  root.className = 'pf-cfg';
  root.setAttribute('role', 'alert');
  const h = doc.createElement('h1');
  h.textContent = "Can't load settings";
  const p = doc.createElement('p');
  p.textContent = "This page couldn't load its settings. Retrying…";
  const b = doc.createElement('button');
  b.type = 'button';
  b.textContent = 'Try again';
  b.addEventListener('click', reload);
  root.append(h, p, b);
  doc.body.append(style, root);
  return {
    remove: () => { root.remove(); style.remove(); },
    giveUp: () => { p.textContent = "This page couldn't load its settings. Check your connection, then try again."; },
  };
}
