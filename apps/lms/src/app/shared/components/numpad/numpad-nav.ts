/**
 * DOM helpers for the result numpad: the "Next" order (reading order, down
 * the list) and the scroller that lifts a field clear of the docked pad. Pure functions over the DOM so specs
 * can drive them without the overlay.
 */

/** Elements a field marker may resolve to (a wrapper such as the pf-select
 *  host resolves to its trigger button). */
const FOCUSABLE = 'input, textarea, select, button, [tabindex]:not([tabindex="-1"])';

/** The element that actually takes focus for a field marker. */
export function focusTargetOf(field: HTMLElement): HTMLElement | null {
  if (field.matches(FOCUSABLE)) return field;
  return field.querySelector<HTMLElement>(FOCUSABLE);
}

function hiddenByStyle(el: Element, root: Element | null): boolean {
  const view = el.ownerDocument?.defaultView;
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n.hasAttribute('hidden') || n.hasAttribute('inert')) return true;
    const cs = view?.getComputedStyle(n);
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return true;
    if (n === root) break;
  }
  return false;
}

/**
 * Can "Next" land here? Skips hidden, disabled, read-only and explicitly
 * skipped fields (`data-numpad-skip` — calculated results).
 */
export function isNavigable(el: HTMLElement, root: HTMLElement | null = null): boolean {
  if (!el.isConnected) return false;
  if ((el as HTMLInputElement).disabled) return false;
  if ((el as HTMLInputElement).readOnly) return false;
  if (el.getAttribute('aria-disabled') === 'true' || el.getAttribute('aria-readonly') === 'true') return false;
  if (el.closest('[data-numpad-skip]')) return false;
  if (hiddenByStyle(el, root)) return false;
  return true;
}

/** The navigable focus targets under `root`, in document (reading) order. */
export function navigableFields(root: HTMLElement, selector: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const marker of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
    if (marker.closest('[data-numpad-skip]')) continue;
    const t = focusTargetOf(marker);
    if (t && !out.includes(t) && isNavigable(t, root)) out.push(t);
  }
  return out;
}

/**
 * The field after `from` in reading order. Works even when `from` itself is
 * not in the list (a skipped calculated field the tech tapped into): the
 * first field that FOLLOWS it in the document wins.
 */
export function nextField(fields: readonly HTMLElement[], from: HTMLElement): HTMLElement | null {
  const idx = fields.findIndex(f => f === from || f.contains(from));
  if (idx >= 0) return fields[idx + 1] ?? null;
  return fields.find(f => !!(from.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING)) ?? null;
}

/**
 * The PAGE scroller that holds `el` — the one the pad lifts the field in.
 *
 * Not simply the nearest overflowing ancestor: a results table sits in a
 * horizontally scrolling wrapper (`overflow-x: auto` computes overflow-y to
 * auto too), and padding / scrolling THAT box scrolled the rows out of their
 * own card on the iPad — the card looked cut off under its header. So a
 * candidate must really scroll vertically AND be page-sized (at least 40% of
 * the viewport); otherwise the document scroller is used.
 */
export function scrollParentOf(el: HTMLElement): HTMLElement {
  const doc = el.ownerDocument;
  const view = doc.defaultView;
  const minH = (view?.innerHeight ?? 0) * 0.4;
  for (let n = el.parentElement; n && n !== doc.body; n = n.parentElement) {
    const oy = view?.getComputedStyle(n).overflowY ?? '';
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1 && n.clientHeight >= minH) return n;
  }
  return (doc.scrollingElement as HTMLElement) ?? doc.documentElement;
}
