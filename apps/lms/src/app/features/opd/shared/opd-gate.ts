/**
 * OPD DARK BUILD — the ONE visibility rule for every OPD surface (pure, DOM-free).
 *
 * OPD is invisible to everyone unless:
 *   - the tenant EXPLICITLY has OPD on (server `/me.opdEntitled`, i.e. the
 *     tenant's ModulesJson opd.enabled === true — the "no module row ⇒ every
 *     module on" default never counts), OR
 *   - the person typed `pf.opd()` in the browser console (localStorage
 *     `pf.opd` === '1') AND the server confirms they may (`/me.opdAccess`,
 *     the owner-preview allowlist). Anyone else typing it sees nothing.
 *
 * The server enforces the same rule (Services/Opd/OpdAccess.cs + [RequireOpd]
 * → 404), so this only decides what the UI SHOWS.
 */

/** localStorage key of the console flag. Works in production builds. */
export const OPD_FLAG_KEY = 'pf.opd';

export interface OpdGateInputs {
  /** localStorage[pf.opd] === '1'. */
  consoleFlag: boolean;
  /** Server: the caller's OPD calls are admitted (entitled OR allowlisted). */
  serverAccess: boolean;
  /** Server: the tenant explicitly has OPD on. */
  tenantEntitled: boolean;
}

/** visible = entitled OR (flag AND server access). Entitlement alone needs no
 *  flag; the flag alone (no server access) shows nothing. */
export function opdVisible(i: OpdGateInputs): boolean {
  if (i.tenantEntitled && i.serverAccess) return true;
  return i.consoleFlag && i.serverAccess;
}

/** Owner preview specifically (flag + server allowlist, tenant not entitled) —
 *  the preview treats the owner as OPD-scoped for the new-order fork. */
export function opdConsolePreview(i: OpdGateInputs): boolean {
  return i.consoleFlag && i.serverAccess;
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
