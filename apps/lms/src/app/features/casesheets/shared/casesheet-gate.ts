/**
 * CASE SHEETS — the ONE visibility rule for every case-sheet surface (pure, DOM-free). Case sheets are PART OF IPD
 * (owner 2026-11-10, plan §11 Q1); same pattern as the OPD dark build (features/opd/shared/opd-gate.ts).
 *
 * Case sheets are invisible unless BOTH:
 *   1. the build / runtime environment is DEV (the beta gate's dev check, core/beta/beta-gate.ts
 *      `isDevEnvironment`) — the server adds `CaseSheets:Enabled` on top; AND
 *   2. one of:
 *      - the tenant EXPLICITLY has IPD on — its stored ModulesJson says `ipd.enabled === true`. The "no module row ⇒
 *        every module on" default and the catalog default never count;
 *      - the tenant is a personal case-sheet space (`/me.tenantKind === 'personal'`, plan §4.1);
 *      - the person typed `pf.casesheets()` in the browser console (localStorage `pf.casesheets` === '1'). While the
 *        flag is set every API call carries `X-PF-CASESHEETS: 1` (casesheet-header.interceptor.ts) and the server's
 *        CaseSheetAccess admits case-sheet calls for it.
 *
 * The server enforces the same rule (CaseSheetAccess + [RequireCaseSheets] → empty 404), so this only decides what
 * the UI SHOWS.
 */
import { FlagStorage, isApiRequest, safeLocalStorage } from '../../opd/shared/opd-gate';

export type { FlagStorage } from '../../opd/shared/opd-gate';
export { isApiRequest } from '../../opd/shared/opd-gate';

/** localStorage key of the console flag. */
export const CASESHEETS_FLAG_KEY = 'pf.casesheets';

/** Request header sent on every API call while the console flag is set. */
export const CASESHEETS_HEADER = 'X-PF-CASESHEETS';

export interface CasesheetGateInputs {
  /** Dev build / runtime (core/beta/beta-gate.ts isDevEnvironment). */
  isDev: boolean;
  /** localStorage[pf.casesheets] === '1'. */
  consoleFlag: boolean;
  /** The tenant's STORED module map explicitly has ipd.enabled === true. */
  ipdExplicit: boolean;
  /** /me tenantKind === 'personal'. */
  personalTenant: boolean;
}

/** visible = dev && (explicit IPD || personal tenant || console flag). */
export function casesheetsVisible(i: CasesheetGateInputs): boolean {
  return i.isDev && (i.ipdExplicit || i.personalTenant || i.consoleFlag);
}

/**
 * Explicit-only IPD: true only for a stored module map whose `ipd.enabled` is literally `true`. A missing map (no
 * module row — "every module on" for the lab modules), a missing ipd entry or anything non-boolean is OFF.
 */
export function ipdExplicitlyOn(modules: Record<string, { enabled?: unknown } | undefined> | null | undefined): boolean {
  return modules?.['ipd']?.enabled === true;
}

export function readCasesheetsFlag(storage: FlagStorage | null | undefined): boolean {
  try { return storage?.getItem(CASESHEETS_FLAG_KEY) === '1'; } catch { return false; }
}

/**
 * Install `window.pf.casesheets(on = true)` SILENTLY: merges into any existing `window.pf` object (never replaces
 * it — `pf.opd` and the beta switches live there too), prints nothing, returns nothing useful. Setting / clearing
 * the flag reloads so every surface re-evaluates. Idempotent.
 */
export function installPfCasesheets(
  win: { pf?: Record<string, unknown> } & Record<string, unknown>,
  storage: FlagStorage,
  reload: () => void,
): void {
  const pf = (win.pf && typeof win.pf === 'object') ? win.pf : {};
  pf['casesheets'] = (on: unknown = true): void => {
    try {
      if (on === false || on === 0 || on === 'off') storage.removeItem(CASESHEETS_FLAG_KEY);
      else storage.setItem(CASESHEETS_FLAG_KEY, '1');
    } catch { /* storage blocked — nothing to do */ }
    reload();
  };
  win.pf = pf;
}

/** Extra headers for a raw `fetch` to our API (bypasses the HttpClient interceptors): `{ 'X-PF-CASESHEETS': '1' }`
 *  while the flag is set. */
export function casesheetsHeaders(storage: FlagStorage | null | undefined = safeLocalStorage()): Record<string, string> {
  return readCasesheetsFlag(storage) ? { [CASESHEETS_HEADER]: '1' } : {};
}

export { safeLocalStorage };
