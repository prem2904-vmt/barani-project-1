/**
 * CORTEX BUILDER — "Cortex builds case sheet forms + option checks" (dev beta). One console switch, `pf.cortexBuilder()`
 * (localStorage `pf.cortexBuilder` === '1'), exactly like `pf.cortexImport()`. The Studio editor's Cortex / Checks buttons and
 * the lab switch show only when this is on (Studio sits behind the case-sheet gate already) AND
 * `GET /api/casesheets/builder/status` answered. The server enforces its own gates; this decides what the UI SHOWS.
 */
import { FlagStorage, safeLocalStorage } from './casesheet-gate';

export const CORTEX_BUILDER_FLAG_KEY = 'pf.cortexBuilder';

export function readCortexBuilderFlag(storage: FlagStorage | null | undefined): boolean {
  try { return storage?.getItem(CORTEX_BUILDER_FLAG_KEY) === '1'; } catch { return false; }
}

/** Is the console switch on in this browser? */
export function cortexBuilderOn(storage: FlagStorage | null | undefined = safeLocalStorage()): boolean {
  return readCortexBuilderFlag(storage);
}

/** Install `window.pf.cortexBuilder(on = true)` silently; merges into any existing `window.pf`; reloads to apply. */
export function installPfCortexBuilder(
  win: { pf?: Record<string, unknown> } & Record<string, unknown>,
  storage: FlagStorage,
  reload: () => void,
): void {
  const pf = (win.pf && typeof win.pf === 'object') ? win.pf : {};
  pf['cortexBuilder'] = (on: unknown = true): void => {
    try {
      if (on === false || on === 0 || on === 'off') storage.removeItem(CORTEX_BUILDER_FLAG_KEY);
      else storage.setItem(CORTEX_BUILDER_FLAG_KEY, '1');
    } catch { /* storage blocked */ }
    reload();
  };
  win.pf = pf;
}
