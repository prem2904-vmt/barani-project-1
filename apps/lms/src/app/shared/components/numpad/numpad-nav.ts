/**
 * DOM helpers for the result numpad: the "Next" order (reading order, down
 * the list) and the popover placement. Pure functions over the DOM so specs
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

export interface Box { top: number; left: number; width: number; height: number; }
export type Placement = 'below' | 'above' | 'right' | 'left';
export interface PopoverSpot { top: number; left: number; placement: Placement; }

/**
 * Where the popover goes: below the field, else above, else to its right,
 * else its left — the first side where the whole pad fits inside the
 * viewport WITHOUT covering the field. `null` when no side fits (the caller
 * then docks the pad as a bottom sheet).
 */
export function placePopover(
  field: Box,
  pad: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 8,
  margin = 8,
): PopoverSpot | null {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const maxLeft = viewport.width - pad.width - margin;
  const maxTop = viewport.height - pad.height - margin;
  if (maxLeft < margin - 0.5 || maxTop < margin - 0.5) return null;
  const alignX = clamp(field.left, margin, maxLeft);
  const alignY = clamp(field.top + field.height / 2 - pad.height / 2, margin, maxTop);

  const below = field.top + field.height + gap;
  if (below + pad.height <= viewport.height - margin) return { top: below, left: alignX, placement: 'below' };
  const above = field.top - gap - pad.height;
  if (above >= margin) return { top: above, left: alignX, placement: 'above' };
  const right = field.left + field.width + gap;
  if (right + pad.width <= viewport.width - margin) return { top: alignY, left: right, placement: 'right' };
  const left = field.left - gap - pad.width;
  if (left >= margin) return { top: alignY, left, placement: 'left' };
  return null;
}

/** The element that scrolls `el` (nearest overflowing ancestor, else the page). */
export function scrollParentOf(el: HTMLElement): HTMLElement {
  const doc = el.ownerDocument;
  const view = doc.defaultView;
  for (let n = el.parentElement; n && n !== doc.body; n = n.parentElement) {
    const oy = view?.getComputedStyle(n).overflowY ?? '';
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return (doc.scrollingElement as HTMLElement) ?? doc.documentElement;
}
