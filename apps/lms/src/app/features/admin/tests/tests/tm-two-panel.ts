import { DestroyRef, signal, WritableSignal } from '@angular/core';

/**
 * Test Master's two-panel frame, shared by every view in its band switch
 * (Option groups, Microbiology, Pricing) so they read exactly like the
 * Individual view: LEFT a side card (~340px), RIGHT the main card — a
 * pf-card__head (icon + label + count + tools) over a FLUSH grid that fills
 * to the bottom. Both cards are the same height; only their bodies scroll.
 * ≤900px: one column, the side card becomes a bottom sheet.
 */

/** A reactive media query as a signal (false where matchMedia is missing). */
export function mediaSignal(query: string, ref: DestroyRef): WritableSignal<boolean> {
  const out = signal(false);
  if (typeof window === 'undefined' || !window.matchMedia) return out;
  const m = window.matchMedia(query);
  out.set(!!m.matches);
  const fn = (e: MediaQueryListEvent) => out.set(e.matches);
  try { m.addEventListener?.('change', fn); ref.onDestroy(() => m.removeEventListener?.('change', fn)); } catch { /* old engines */ }
  return out;
}

/** The narrow breakpoint Test Master uses for its departments sheet. */
export const TM_NARROW = '(max-width: 900px)';

/** Component styles for the frame (each panel adds them to its `styles`). */
export const TM_TWO_PANEL_STYLES = `
  .pf-2p { flex: 1 1 auto; min-height: 0; display: grid; gap: 16px; align-items: stretch;
    grid-template-columns: var(--pf-side-w, 340px) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
  .pf-2p--narrow { grid-template-columns: minmax(0, 1fr); }
  .pf-2p__side, .pf-2p__main { min-width: 0; min-height: 0; }
  .pf-2p__side > .pf-card__body { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
  .pf-2p__head { flex-wrap: wrap; row-gap: 8px; }
  /* Pill fit (owner 2026-11-20): a head with a status pill is ONE row — the pill collapses, the head never wraps. */
  .pf-2p__head:has(> pf-segmented) { flex-wrap: nowrap; }
  .pf-2p__head .pf-card__label { white-space: nowrap; }
  .pf-2p__name { text-transform: none; letter-spacing: 0; font-size: 14px; color: var(--text-primary); white-space: normal; min-width: 0; }
  .pf-2p__count { flex: none; margin-left: auto; font-size: 12.5px; font-weight: 500; color: var(--text-tertiary); white-space: nowrap; }
  .pf-2p__tools { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; flex: none; }
  .pf-2p__body { flex: 1 1 auto; min-height: 0; position: relative; display: flex; flex-direction: column; }
  .pf-2p__grid { display: block; flex: 1 1 auto; width: 100%; height: 100%; min-height: 280px; }
  .pf-2p__skel { position: absolute; inset: 0; z-index: 6; overflow: hidden; background: var(--pf-card-bg, var(--bg-primary)); }
  .pf-2p__main ::ng-deep .ag-root-wrapper { border: 0; border-radius: 0; }
  .pf-2p__hbtn { height: 34px; min-height: 34px; flex: none; }
  .pf-2p__handle { display: none; }
  /* Narrow: the side card is a bottom sheet above the navbar. */
  .pf-2p__backdrop { position: fixed; inset: 0 0 var(--pf-nav-h, 0px) 0; z-index: 1001; background: rgba(0, 0, 0, .45); }
  .pf-2p__side.pf-2p__sheet { position: fixed; top: auto; left: 0; right: 0; bottom: var(--pf-nav-h, 0px); z-index: 1002;
    height: min(78dvh, calc(100dvh - env(safe-area-inset-top, 0px) - var(--pf-nav-h, 0px) - 8px));
    border-radius: 20px 20px 0 0; animation: pf-rise var(--pf-dur-sheet, 360ms) var(--pf-spring-bounce, ease) both; }
  .pf-2p__sheet .pf-2p__handle { display: block; flex: none; width: 40px; height: 5px; margin: 8px auto 2px; border-radius: 999px; background: var(--pf-line); }
  @media (min-width: 641px) { .pf-2p__side.pf-2p__sheet { left: max(16px, calc(50% - 300px)); right: max(16px, calc(50% - 300px)); } }
  @media (prefers-reduced-motion: reduce) { .pf-2p__side.pf-2p__sheet { animation: none; } }
`;
