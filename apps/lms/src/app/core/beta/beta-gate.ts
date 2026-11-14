/**
 * BETA FEATURES — the ONE visibility rule for every beta surface (pure,
 * DOM-free). Same pattern as the OPD dark build (features/opd/shared/opd-gate.ts).
 *
 * A beta surface is visible only when ALL three hold:
 *   1. the person switched it on in THIS browser's console — `pf.mcp()`,
 *      `pf.passkeys()`, `pf.assistant()`, `pf.support()`, `pf.neuron()` (localStorage `pf.beta.<name>` = '1';
 *      `pf.<name>(false)` turns it off; `pf.beta()` prints which are on);
 *   2. the server allows it — GET /api/beta-features, which sees the
 *      `X-PF-BETA: <comma list>` header the interceptor adds while any switch
 *      is on;
 *   3. the build / runtime environment is DEV.
 * Any error / missing answer ⇒ OFF. Stage / prod only on the owner's explicit
 * confirmation (the server flag), never by default.
 */

export type BetaFeatureKey = 'mcp' | 'passkeys' | 'assistant' | 'support' | 'neuron';
export const BETA_FEATURE_KEYS: readonly BetaFeatureKey[] = ['mcp', 'passkeys', 'assistant', 'support', 'neuron'];
export type BetaFeatureFlags = Record<BetaFeatureKey, boolean>;
export const ALL_BETA_OFF: Readonly<BetaFeatureFlags> = Object.freeze({ mcp: false, passkeys: false, assistant: false, support: false, neuron: false });

/** Request header sent on API calls while any console switch is on. */
export const BETA_HEADER = 'X-PF-BETA';

/** localStorage key of one console switch. */
export function betaFlagKey(key: BetaFeatureKey): string {
  return `pf.beta.${key}`;
}

/** The DEV Supabase project — every build carries its project URL (web:
 *  the host's /config.json merged into `environment`; desktop / phone: their
 *  env file), so it is the per-environment fact the dev check reads. */
export const DEV_SUPABASE_PROJECT_URL = 'https://cottlnsbjnstsgknsgzu.supabase.co';

export function isDevEnvironment(env: { auth?: { supabaseUrl?: string } } | null | undefined): boolean {
  const url = (env?.auth?.supabaseUrl ?? '').trim().replace(/\/+$/, '').toLowerCase();
  return url === DEV_SUPABASE_PROJECT_URL;
}

/** Minimal storage surface (localStorage in the app, a fake in specs). */
export interface BetaStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export function safeBetaStorage(): BetaStorage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/** Which console switches are on in this browser. */
export function readBetaSwitches(storage: BetaStorage | null | undefined): BetaFeatureFlags {
  const out: BetaFeatureFlags = { ...ALL_BETA_OFF };
  for (const k of BETA_FEATURE_KEYS) {
    try { out[k] = storage?.getItem(betaFlagKey(k)) === '1'; } catch { out[k] = false; }
  }
  return out;
}

/** `X-PF-BETA` value ("mcp,passkeys"), or null when no switch is on. */
export function betaHeaderValue(storage: BetaStorage | null | undefined = safeBetaStorage()): string | null {
  const on = readBetaSwitches(storage);
  const list = BETA_FEATURE_KEYS.filter(k => on[k]);
  return list.length ? list.join(',') : null;
}

/** Extra headers for a raw `fetch` to our API (bypasses HttpClient interceptors). */
export function betaHeaders(storage: BetaStorage | null | undefined = safeBetaStorage()): Record<string, string> {
  const v = betaHeaderValue(storage);
  return v ? { [BETA_HEADER]: v } : {};
}

/**
 * Server answer → allowed flags: only a literal `true` counts. Accepts the API
 * envelope ({ success, data }) or the bare object; `aiConnector` is read as an
 * alias of `mcp`.
 */
export function parseBetaFlags(body: unknown): BetaFeatureFlags {
  const rec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const src = rec(body) && rec(body['data']) ? body['data'] : body;
  const out: BetaFeatureFlags = { ...ALL_BETA_OFF };
  if (!rec(src)) return out;
  out.mcp = src['mcp'] === true || src['aiConnector'] === true;
  out.passkeys = src['passkeys'] === true;
  out.assistant = src['assistant'] === true;
  out.support = src['support'] === true;
  out.neuron = src['neuron'] === true;
  return out;
}

/** visible = console switch && server allows && dev env. */
export function betaVisible(i: { switchOn: boolean; serverAllowed: boolean; isDev: boolean }): boolean {
  return i.switchOn && i.serverAllowed && i.isDev;
}

/**
 * Install `window.pf.mcp() / .passkeys() / .assistant() / .support() / .neuron() / .beta()` SILENTLY:
 * merges into any existing `window.pf` (never replaces it — `pf.opd` lives
 * there too). A switch change reloads so every surface re-evaluates.
 * Idempotent.
 */
export function installPfBeta(
  win: { pf?: Record<string, unknown> } & Record<string, unknown>,
  storage: BetaStorage,
  reload: () => void,
  log: (msg: string) => void = (m) => console.info(m),
): void {
  const pf = (win.pf && typeof win.pf === 'object') ? win.pf : {};
  for (const k of BETA_FEATURE_KEYS) {
    pf[k] = (on: unknown = true): void => {
      try {
        if (on === false || on === 0 || on === 'off') storage.removeItem(betaFlagKey(k));
        else storage.setItem(betaFlagKey(k), '1');
      } catch { /* storage blocked */ }
      reload();
    };
  }
  pf['beta'] = (): string[] => {
    const on = readBetaSwitches(storage);
    const list = BETA_FEATURE_KEYS.filter(k => on[k]);
    log(list.length ? `Beta on in this browser: ${list.join(', ')}` : 'No beta features on in this browser.');
    return list;
  };
  win.pf = pf;
}
