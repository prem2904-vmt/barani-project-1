import { DestroyRef, Signal, inject, signal } from '@angular/core';

/**
 * Studio is a DESKTOP tool first (owner, 2026-11-02: "most of the time Studio
 * is used on the web"). These signals decide the desktop extras:
 *
 * - `deskSignal()`: a mouse / trackpad computer (`html.device-desktop` from
 *   index.html AND `(hover: hover) and (pointer: fine)`, the PF-PATTERN web
 *   query). Denser rows, hover actions, checkboxes for multi-select and the
 *   searchable palette are for this mode only; tablets keep 48px targets.
 * - `mediaSignal(query)`: a width breakpoint (layout only, never density).
 *
 * Both follow `matchMedia` changes live and stop listening when the owner is
 * destroyed.
 */
export const DESK_QUERY = '(hover: hover) and (pointer: fine)';

/** ≥1280: pages | form | question (with "What it writes" as a tab). */
export const STUDIO_3COL = '(min-width: 1280px)';
/** ≥1760: the narrative gets its own column, always in view. */
export const STUDIO_4COL = '(min-width: 1760px)';

function mm(query: string): MediaQueryList | null {
  try {
    return typeof matchMedia === 'function' ? matchMedia(query) : null;
  } catch {
    return null;
  }
}

function isDesktopDevice(): boolean {
  if (typeof document === 'undefined') return false;
  const root = document.documentElement;
  // the device class is set before the first paint; no class at all (tests) = decide by the pointer alone
  if (root.classList.contains('device-touch')) return false;
  return true;
}

export function mediaSignal(query: string): Signal<boolean> {
  const list = mm(query);
  const s = signal(!!list?.matches);
  if (list) {
    const on = (e: MediaQueryListEvent) => s.set(e.matches);
    list.addEventListener?.('change', on);
    inject(DestroyRef, { optional: true })?.onDestroy(() => list.removeEventListener?.('change', on));
  }
  return s.asReadonly();
}

export function deskSignal(): Signal<boolean> {
  const list = mm(DESK_QUERY);
  const s = signal(!!list?.matches && isDesktopDevice());
  if (list) {
    const on = (e: MediaQueryListEvent) => s.set(e.matches && isDesktopDevice());
    list.addEventListener?.('change', on);
    inject(DestroyRef, { optional: true })?.onDestroy(() => list.removeEventListener?.('change', on));
  }
  return s.asReadonly();
}

/** ⌘ on a Mac, Ctrl elsewhere (for the words on screen; both keys work everywhere). */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const p = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || navigator.userAgent;
  return /Mac|iPhone|iPad/i.test(p);
}

/** True when a key press belongs to a text box (the shortcut must not steal it). */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const t = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'range', 'file'].includes(t);
  }
  return !!el.closest('[role="combobox"], [role="listbox"], .pf-dd__panel');
}
