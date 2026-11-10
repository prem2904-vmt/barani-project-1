/**
 * CORTEX IMPORT — "a case sheet from a paper sheet" (dev beta). One console switch, `pf.cortexImport()`
 * (localStorage `pf.cortexImport` === '1'), like the other betas. The Studio button shows only when the switch is on (Studio
 * itself sits behind the case-sheet gate) and the server hasn't said it isn't available (a 404 / 424 from the start call). The
 * server enforces its own gates (dev only, PF Sense switch, Claude set up); this decides what the UI SHOWS.
 */
import { FlagStorage, safeLocalStorage } from './casesheet-gate';

export const CORTEX_IMPORT_FLAG_KEY = 'pf.cortexImport';

export function readCortexImportFlag(storage: FlagStorage | null | undefined): boolean {
  try { return storage?.getItem(CORTEX_IMPORT_FLAG_KEY) === '1'; } catch { return false; }
}

/** Is the console switch on in this browser? (Studio is only reachable through the case-sheet gate already.) */
export function cortexImportOn(storage: FlagStorage | null | undefined = safeLocalStorage()): boolean {
  return readCortexImportFlag(storage);
}

/** Install `window.pf.cortexImport(on = true)` silently; merges into any existing `window.pf`; reloads to apply. */
export function installPfCortexImport(
  win: { pf?: Record<string, unknown> } & Record<string, unknown>,
  storage: FlagStorage,
  reload: () => void,
): void {
  const pf = (win.pf && typeof win.pf === 'object') ? win.pf : {};
  pf['cortexImport'] = (on: unknown = true): void => {
    try {
      if (on === false || on === 0 || on === 'off') storage.removeItem(CORTEX_IMPORT_FLAG_KEY);
      else storage.setItem(CORTEX_IMPORT_FLAG_KEY, '1');
    } catch { /* storage blocked */ }
    reload();
  };
  win.pf = pf;
}
