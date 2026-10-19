/**
 * OPD DARK BUILD — the ONE visibility rule for every OPD surface (pure, DOM-free).
 *
 * OPD is invisible to everyone unless:
 *   - the tenant EXPLICITLY has OPD on (server `/me.opdEntitled`, i.e. the
 *     tenant's ModulesJson opd.enabled === true — the "no module row ⇒ every
 *     module on" default never counts) — the go-live path, OR
 *   - the person typed `pf.opd()` in the browser console (localStorage
 *     `pf.opd` === '1'). ANY signed-in user may; there is no allowlist. While
 *     the flag is set every API call carries `X-PF-OPD: 1`
 *     (opd-preview.interceptor.ts) and the server admits OPD calls for it.
 *
 * The server enforces the same rule (Services/Opd/OpdAccess.cs + [RequireOpd]
 * → 404 without the header or entitlement), so this only decides what the UI
 * SHOWS.
 */

/** localStorage key of the console flag. Works in production builds. */
export const OPD_FLAG_KEY = 'pf.opd';

/** Request header sent on every API call while the console flag is set. */
export const OPD_PREVIEW_HEADER = 'X-PF-OPD';

export interface OpdGateInputs {
  /** localStorage[pf.opd] === '1'. */
  consoleFlag: boolean;
  /** Server: the tenant explicitly has OPD on. */
  tenantEntitled: boolean;
}

/** visible = console flag OR explicit tenant entitlement. */
export function opdVisible(i: OpdGateInputs): boolean {
  return i.consoleFlag || i.tenantEntitled;
}

/** Console preview (flag set) — the preview treats the user as OPD-scoped for
 *  the new-order fork. */
export function opdConsolePreview(i: OpdGateInputs): boolean {
  return i.consoleFlag;
}

/** True for requests to our API (same predicate as authInterceptor). */
export function isApiRequest(url: string): boolean {
  return url.startsWith('/api') || url.includes('/api/');
}

/** Minimal storage surface (localStorage in the app, a fake in specs). */
export interface FlagStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export function readOpdFlag(storage: FlagStorage | null | undefined): boolean {
  try { return storage?.getItem(OPD_FLAG_KEY) === '1'; } catch { return false; }
}

/**
 * Install `window.pf.opd(on = true)` SILENTLY: merges into any existing
 * `window.pf` object (never replaces it), prints nothing, returns nothing
 * useful. Setting / clearing the flag reloads so every surface re-evaluates.
 * Idempotent.
 */
export function installPfOpd(
  win: { pf?: Record<string, unknown> } & Record<string, unknown>,
  storage: FlagStorage,
  reload: () => void,
): void {
  const pf = (win.pf && typeof win.pf === 'object') ? win.pf : {};
  pf['opd'] = (on: unknown = true): void => {
    try {
      if (on === false || on === 0 || on === 'off') storage.removeItem(OPD_FLAG_KEY);
      else storage.setItem(OPD_FLAG_KEY, '1');
    } catch { /* storage blocked — nothing to do */ }
    reload();
  };
  win.pf = pf;
}

/** The browser's localStorage, or null when unavailable / blocked. */
export function safeLocalStorage(): FlagStorage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/** Extra headers for a raw `fetch` to our API (the /me bootstrap bypasses the
 *  HttpClient interceptors): `{ 'X-PF-OPD': '1' }` while the flag is set. */
export function opdPreviewHeaders(storage: FlagStorage | null | undefined = safeLocalStorage()): Record<string, string> {
  return readOpdFlag(storage) ? { [OPD_PREVIEW_HEADER]: '1' } : {};
}
