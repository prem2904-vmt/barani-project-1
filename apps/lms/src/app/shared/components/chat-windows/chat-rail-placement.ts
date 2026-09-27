/**
 * Where the minimised-chat rail (the floating "SA" heads) may sit without
 * covering the page's own controls — above all the primary action (owner's
 * iPad: the head sat on "Continue to payment" on Order & Payments).
 *
 * Pure geometry so it is unit-testable: the component measures the heads and
 * answers "what control is under this point?" (via elementsFromPoint, its own
 * heads skipped); this picks the smallest upward lift that clears it.
 */

export interface Box { left: number; top: number; right: number; bottom: number }

/** What a point of the page holds, ignoring the rail itself. */
export type Hit = 'primary' | 'control' | null;

/** Primary / call-to-action buttons across the app (ND, band, order,
 *  billing counter, patient profile, collection bar …) plus an explicit
 *  opt-in `data-pf-cta` for anything new. Covering one of these is never OK. */
export const PRIMARY_SELECTOR = [
  '[data-pf-cta]',
  '.nd-btn--primary', '.pf-hb-btn--primary', '.nd-ctx__primary',
  '.pf-oc-btn--primary', '.pf-btn-primary', '.btn-primary', '.pf-bc-primary',
  '.pf-mbar__btn--primary', '.pf-sc-bar__cta', '.pf-pp-act', '.pf-cartbar__inner',
  'button[type="submit"]',
].join(',');

/** Anything tappable. Covering one is avoided when there is room. */
export const CONTROL_SELECTOR = [
  PRIMARY_SELECTOR, 'button', 'a[href]', 'input:not([type="hidden"])', 'select', 'textarea',
  '[role="button"]', '[role="tab"]', '[role="link"]', '[contenteditable="true"]',
].join(',');

/** Centre + four inset corners of a head: enough to catch any control a
 *  44px circle overlaps, cheap enough to probe on every re-plan. */
export function samplePoints(b: Box, inset = 4): Array<[number, number]> {
  const cx = (b.left + b.right) / 2;
  const cy = (b.top + b.bottom) / 2;
  return [
    [cx, cy],
    [b.left + inset, b.top + inset], [b.right - inset, b.top + inset],
    [b.left + inset, b.bottom - inset], [b.right - inset, b.bottom - inset],
  ];
}

function lifted(b: Box, lift: number): Box {
  return { left: b.left, right: b.right, top: b.top - lift, bottom: b.bottom - lift };
}

/**
 * Smallest lift (px, upward, multiple of `step`, ≤ `maxLift`) at which no
 * head covers any control; failing that, the smallest at which none covers a
 * PRIMARY; failing that, 0 (never fly off into the header).
 * `heads` are the head boxes at lift 0; `primaries` the visible primary
 * actions' boxes (checked by rectangle, `gap` px apart).
 */
export function planRailLift(
  heads: Box[],
  hitAt: (x: number, y: number) => Hit,
  maxLift: number,
  step = 8,
  primaries: Box[] = [],
  gap = 6,
): number {
  if (!heads.length) return 0;
  // Primaries by exact geometry (+ a small breathing gap): a head must not
  // even graze one. Other controls by probing points under the head.
  const onPrimary = (h: Box) => primaries.some(p =>
    h.left < p.right + gap && h.right > p.left - gap && h.top < p.bottom + gap && h.bottom > p.top - gap);
  const clash = (lift: number, level: 'any' | 'primary') =>
    heads.some(h0 => {
      const h = lifted(h0, lift);
      if (onPrimary(h)) return true;
      return samplePoints(h).some(([x, y]) => {
        const k = hitAt(x, y);
        return level === 'any' ? k !== null : k === 'primary';
      });
    });
  const cap = Math.max(0, Math.floor(maxLift));
  for (const level of ['any', 'primary'] as const) {
    for (let lift = 0; lift <= cap; lift += step) {
      if (!clash(lift, level)) return lift;
    }
  }
  return 0;
}

/** Keep a dragged rail on screen: between the dock and the top chrome. */
export function clampLift(lift: number, maxLift: number): number {
  if (!Number.isFinite(lift)) return 0;
  return Math.round(Math.min(Math.max(0, lift), Math.max(0, maxLift)));
}

/** Persisted per-user rail position. */
export interface RailPosition { side: 'left' | 'right'; lift: number }

export function parseRailPosition(raw: string | null): RailPosition {
  try {
    const v = raw ? JSON.parse(raw) : null;
    const side = v?.side === 'left' ? 'left' : 'right';
    const lift = typeof v?.lift === 'number' && Number.isFinite(v.lift) ? Math.max(0, Math.round(v.lift)) : 0;
    return { side, lift };
  } catch {
    return { side: 'right', lift: 0 };
  }
}
