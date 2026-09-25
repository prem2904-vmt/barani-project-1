import { ViewTransitionInfo } from '@angular/router';

/**
 * Queue → sample ZOOM (router view transitions, next to slide-transition.ts).
 *
 * Opening a tube from My Work zooms INTO result entry: the tapped tile morphs
 * into the first RESULTS card (both carry the same `view-transition-name`,
 * `sample-<id>`). Back / submit / save-draft to My Work reverses it.
 *
 * Only ONE tile is ever named, and only for the length of the transition:
 * tiles carry a harmless `data-vt-sample="<id>"` marker and this hook names
 * the one being opened. Naming every tile permanently would snapshot the
 * whole queue — including tiles scrolled under the band, which would flash
 * over it during the morph.
 *
 * Browsers without the View Transitions API never reach this hook (the
 * router swaps instantly); reduced motion skips it in slideTransition().
 */

/** Marker attribute on queue tiles: `[attr.data-vt-sample]="sampleId"`. */
export const SAMPLE_VT_ATTR = 'data-vt-sample';
/** Morph length (the nd spring; ~380–420ms reads as one continuous zoom). */
export const ZOOM_MS = 400;
export const ZOOM_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';   // --nd-spring
/** `view-transition-class` shared by the tile and the card (styles.scss). */
export const ZOOM_CLASS = 'pf-zoom';

/** `sample-<id>`, safe as a CSS <custom-ident> (GUIDs pass through). */
export function sampleVtName(id: string | null | undefined): string | null {
  const s = (id ?? '').trim();
  return s ? 'sample-' + s.replace(/[^A-Za-z0-9_-]/g, '_') : null;
}

export interface ZoomStep { dir: 'in' | 'out'; sampleId: string; }

const QUEUE = '/lab/my-work';
const SAMPLE = /^\/lab\/sample\/([^/]+)$/;

/** Which navigations zoom: My Work → /lab/sample/:id zooms IN, the reverse
 *  zooms OUT. Everything else (incl. sibling tube → tube) returns null. */
export function zoomDirection(from: string, to: string): ZoomStep | null {
  const path = (u: string) => (u || '').split(/[?#]/)[0].replace(/\/+$/, '');
  const f = path(from), t = path(to);
  const into = t.match(SAMPLE), outOf = f.match(SAMPLE);
  if (f === QUEUE && into) return { dir: 'in', sampleId: decodeURIComponent(into[1]) };
  if (outOf && t === QUEUE) return { dir: 'out', sampleId: decodeURIComponent(outOf[1]) };
  return null;
}

/** The queue tile for a sample, if it is on screen. */
export function tileFor(doc: Document, sampleId: string): HTMLElement | null {
  const esc = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(sampleId) : sampleId.replace(/["\\]/g, '\\$&');
  return doc.querySelector<HTMLElement>(`[${SAMPLE_VT_ATTR}="${esc}"]`);
}

function name(el: HTMLElement, n: string): void {
  el.style.setProperty('view-transition-name', n);
  el.style.setProperty('view-transition-class', ZOOM_CLASS);
}
function unname(el: HTMLElement): void {
  el.style.removeProperty('view-transition-name');
  el.style.removeProperty('view-transition-class');
}

/** Where the tile sat when we zoomed in — the target for the zoom-out when
 *  the queue hasn't re-rendered that tile yet (it reloads from the API). */
const lastTileRect = new Map<string, { left: number; top: number; width: number; height: number }>();

/** Run the zoom for this navigation. Returns false when it can't (no tile to
 *  zoom from) so the caller skips the transition — an instant swap. */
export function runZoom(info: ViewTransitionInfo, step: ZoomStep, doc: Document = document): boolean {
  const n = sampleVtName(step.sampleId);
  if (!n) return false;
  const root = doc.documentElement;
  const t = info.transition;

  if (step.dir === 'in') {
    const tile = tileFor(doc, step.sampleId);
    if (!tile) return false;
    const r = tile.getBoundingClientRect();
    lastTileRect.set(step.sampleId, { left: r.left, top: r.top, width: r.width, height: r.height });
    name(tile, n);   // old-state capture happens after this, at the next frame
    root.classList.add('pf-vt-zoom-in');
    t.finished.finally(() => { unname(tile); root.classList.remove('pf-vt-zoom-in'); }).catch(() => {});
    return true;
  }

  // OUT: the card already carries the name (bound in the template). Name the
  // tile in the NEW state once the queue has rendered.
  root.classList.add('pf-vt-zoom-out');
  let tile: HTMLElement | null = null;
  t.updateCallbackDone.then(() => {
    tile = tileFor(doc, step.sampleId);
    if (tile) name(tile, n);
  }).catch(() => {});
  // Tile not rendered yet → shrink the card back to where the tile was.
  t.ready.then(() => {
    const rect = lastTileRect.get(step.sampleId);
    if (tile || !rect || typeof root.animate !== 'function') return;
    root.animate(
      [{}, { transform: `translate(${rect.left}px, ${rect.top}px)`, width: `${rect.width}px`, height: `${rect.height}px`, opacity: 0 }],
      { duration: ZOOM_MS, easing: ZOOM_EASING, fill: 'forwards', pseudoElement: `::view-transition-group(${n})` },
    );
  }).catch(() => {});
  t.finished.finally(() => { if (tile) unname(tile); root.classList.remove('pf-vt-zoom-out'); }).catch(() => {});
  return true;
}

/** Test seam. */
export function _resetZoomMemory(): void { lastTileRect.clear(); }
