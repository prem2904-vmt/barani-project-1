/**
 * Desktop (Electron) kiosk full screen — the Esc rule.
 *
 * Esc already means "close this" all over the app (DialogService, pf-select,
 * action menus, sheets, popovers, the pf-keys keypad, search fields). It may
 * only leave full screen when the app did NOT use it. Most of the app's Esc
 * handlers are plain `document:keydown.escape` listeners that never call
 * preventDefault, so "not defaultPrevented" alone is not enough. The rule:
 *
 *   1. Snapshot BEFORE any app handler runs (window, capture phase — the first
 *      listener of the dispatch): was an overlay open, or was focus in a field
 *      that uses Esc itself? A handler that closes a popover removes it from
 *      the DOM before the bubble phase, so the check must happen up front.
 *   2. Decide AFTER every handler ran (window, bubble phase, deferred one
 *      task): leave full screen only when the event reached the window, was
 *      not defaultPrevented and the snapshot said nothing owned the Esc.
 *      stopPropagation by any handler means the bubble listener never fires —
 *      also "consumed".
 *
 * Everything here is pure DOM logic (no Angular), so the spec can drive it
 * with real KeyboardEvents in the test DOM.
 */

/** Things that are open ON TOP of the page and close on Esc. Visible ones
 *  only (see isShown). A new overlay type opts in with `data-pf-esc`. */
export const ESC_OVERLAY_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
  '[role="menu"]',
  // A popup's trigger says it is open (pf-select combobox, menu buttons).
  '[aria-haspopup]:not([aria-haspopup="false"])[aria-expanded="true"]',
  '[role="combobox"][aria-expanded="true"]',
  // The on-screen keypads (pf-keys search keypad, result number pad).
  'pf-keys-panel .pf-k',
  'pf-numpad-panel .pf-np',
  '[data-pf-esc]',
].join(', ');

/** A listbox is an overlay only when it floats (pf-select panel, search
 *  drops) — inline listboxes (tube picker, lists on a page) are not. */
const LISTBOX_SELECTOR = '[role="listbox"]';

function isShown(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (!el.isConnected || el.hidden || el.closest('[hidden], [inert]')) return false;
  if (getComputedStyle(el).visibility === 'hidden') return false;
  // display:none on the element or any ancestor (walked, not getClientRects,
  // so it holds in a layout-less test DOM too).
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (getComputedStyle(n).display === 'none') return false;
  }
  return true;
}

function floats(el: Element): boolean {
  const pos = getComputedStyle(el as HTMLElement).position;
  return pos === 'fixed' || pos === 'absolute';
}

/** Is anything open that the app's own Esc handling will close? */
export function overlayOpen(doc: Document = document): boolean {
  for (const el of Array.from(doc.querySelectorAll(ESC_OVERLAY_SELECTOR))) {
    if (isShown(el)) return true;
  }
  for (const el of Array.from(doc.querySelectorAll(LISTBOX_SELECTOR))) {
    if (isShown(el) && floats(el)) return true;
  }
  return false;
}

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'tel', 'url', 'number', 'password']);

/** Focus sits in a field that uses Esc itself: a search / text box with
 *  something typed (Esc clears it), or any content-editable area. An EMPTY
 *  field does not hold the Esc, or a focused-on-load login box would pin the
 *  window full screen. */
export function fieldOwnsEsc(active: Element | null): boolean {
  if (!active || !(active instanceof HTMLElement)) return false;
  if (active.isContentEditable) return true;
  if (active instanceof HTMLTextAreaElement) return active.value.length > 0;
  if (active instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has((active.type || '').toLowerCase()) && active.value.length > 0;
  }
  return false;
}

/** What the capture-phase snapshot records for one keydown. */
export interface EscSnapshot {
  event: KeyboardEvent;
  owned: boolean;
}

/** A bare Esc press (no modifiers, not a repeat, not mid-IME composition). */
export function isBareEsc(ev: KeyboardEvent): boolean {
  return (ev.key === 'Escape' || ev.key === 'Esc')
    && !ev.repeat && !ev.isComposing
    && !ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey;
}

/** Capture phase: did something own this Esc before any handler ran? */
export function snapshotEsc(ev: KeyboardEvent, doc: Document = document): EscSnapshot {
  const owned = !!doc.fullscreenElement   // HTML fullscreen (a video): Chromium's own Esc
    || overlayOpen(doc)
    || fieldOwnsEsc(doc.activeElement);
  return { event: ev, owned };
}

/** Bubble phase (after every handler): leave full screen? */
export function escLeavesFullScreen(ev: KeyboardEvent, snap: EscSnapshot | null): boolean {
  if (!isBareEsc(ev)) return false;
  if (ev.defaultPrevented) return false;
  // No snapshot for THIS event → our capture listener didn't see it start
  // (synthetic dispatch straight at the window): don't guess.
  if (!snap || snap.event !== ev) return false;
  return !snap.owned;
}

/**
 * Install the two listeners on `win`. `leave` is called (at most once per
 * Esc, one task after dispatch) when the Esc was not used by the app.
 * Returns the uninstaller.
 */
export function installEscToLeaveFullScreen(
  win: Window,
  isFullScreen: () => boolean,
  leave: () => void,
): () => void {
  let snap: EscSnapshot | null = null;
  const capture = (ev: Event) => {
    const k = ev as KeyboardEvent;
    snap = isBareEsc(k) && isFullScreen() ? snapshotEsc(k, win.document) : null;
  };
  const bubble = (ev: Event) => {
    const k = ev as KeyboardEvent;
    const s = snap;
    if (!s || s.event !== k) return;
    // One task later: every listener (incl. window listeners added after
    // ours) has run, so a late preventDefault is still seen.
    win.setTimeout(() => {
      if (isFullScreen() && escLeavesFullScreen(k, s)) leave();
    }, 0);
  };
  win.addEventListener('keydown', capture, true);
  win.addEventListener('keydown', bubble, false);
  return () => {
    win.removeEventListener('keydown', capture, true);
    win.removeEventListener('keydown', bubble, false);
  };
}
