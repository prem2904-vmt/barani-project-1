/**
 * Pane splitter — the pure rules behind `<pf-pane-splitter>` (shared, so any
 * two-panel screen can adopt it; Frontdesk is the first, owner 2026-11-19).
 *
 * The side card's width is ONE number in px, written as the `--pf-side-w`
 * custom property on the row that holds both cards. No saved value = the
 * stylesheet's default `--pf-side-w` (the app's one side-card width). Every
 * width is clamped: at least `min` px, at most `maxFraction` of the row.
 */

export interface SplitterBounds {
  /** Smallest side-card width, px. */
  min: number;
  /** Largest side-card width as a fraction of the row (0–1). */
  maxFraction: number;
}

export const SPLITTER_DEFAULTS: SplitterBounds = { min: 300, maxFraction: 0.45 };

/** Arrow-key step, px (Shift = ×4). */
export const SPLITTER_STEP = 16;

/** The allowed [min, max] for a row `rowWidth` px wide. A row too narrow for
 *  the minimum collapses the range to the minimum (never max < min). */
export function splitterRange(rowWidth: number, b: SplitterBounds = SPLITTER_DEFAULTS): { min: number; max: number } {
  const min = Math.max(0, Math.round(b.min));
  const max = Number.isFinite(rowWidth) && rowWidth > 0 ? Math.floor(rowWidth * b.maxFraction) : min;
  return { min, max: Math.max(min, max) };
}

/** Clamp a wanted width into the row's range (rounded to whole px). */
export function clampSideWidth(want: number, rowWidth: number, b: SplitterBounds = SPLITTER_DEFAULTS): number {
  const { min, max } = splitterRange(rowWidth, b);
  if (!Number.isFinite(want)) return min;
  return Math.min(max, Math.max(min, Math.round(want)));
}

/** The next width for a key press, or null when the key isn't the splitter's.
 *  ←/→ move by `step` (Shift ×4), End = the maximum; Home is the RESET key and
 *  is answered by the component (it removes the saved width), so it is null here. */
export function keyedSideWidth(key: string, shift: boolean, current: number, rowWidth: number,
  b: SplitterBounds = SPLITTER_DEFAULTS, step = SPLITTER_STEP): number | null {
  const d = shift ? step * 4 : step;
  if (key === 'ArrowLeft') return clampSideWidth(current - d, rowWidth, b);
  if (key === 'ArrowRight') return clampSideWidth(current + d, rowWidth, b);
  if (key === 'End') return splitterRange(rowWidth, b).max;
  return null;
}

/** Read a saved width (px). Anything missing / malformed / blocked = null
 *  (the default applies). Never throws: private mode, blocked storage. */
export function readSideWidth(key: string, storage: Pick<Storage, 'getItem'> | null = safeStorage()): number | null {
  if (!key || !storage) return null;
  try {
    const raw = storage.getItem(key);
    if (raw === null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  } catch {
    return null;
  }
}

/** Save (or with `null`, forget) the width. Never throws. */
export function writeSideWidth(key: string, width: number | null, storage: Pick<Storage, 'setItem' | 'removeItem'> | null = safeStorage()): void {
  if (!key || !storage) return;
  try {
    if (width === null) storage.removeItem(key);
    else storage.setItem(key, String(Math.round(width)));
  } catch { /* quota / private mode: the width just isn't remembered */ }
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
