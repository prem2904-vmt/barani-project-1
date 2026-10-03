// The app nav's real footprint, published by the shell (which renders the
// nav) as CSS variables on <html>:
//   --pf-nav-h    → how much of the viewport bottom the visible nav covers
//                   (docked bar, or floating pill + the gap under it);
//   --pf-nav-left → how wide a left rail (iPad) is, edge included.
// Full-screen pages (the OPD consult) size themselves with these instead of
// guessed tokens, so nothing can ever sit under the nav.

export interface NavRect { top: number; left: number; right: number; bottom: number; width: number; height: number; }

/** Where the visible app nav sits, as insets: a bar or floating pill along
 *  the bottom reserves from its top edge down (safe area and float gap
 *  included); a rail down the left edge reserves its right edge. A hidden
 *  (0×0) element or one docked at the top reserves nothing. Pure. */
export function navInsets(rects: readonly NavRect[], vw: number, vh: number): { bottom: number; left: number } {
  let bottom = 0, left = 0;
  for (const r of rects) {
    if (!r.width || !r.height) continue;
    if (r.top >= vh / 2 && r.height <= vh / 3) bottom = Math.max(bottom, Math.ceil(vh - r.top));
    else if (r.left <= 8 && r.height >= vh / 2 && r.width <= vw / 3) left = Math.max(left, Math.ceil(r.right));
  }
  return { bottom, left };
}

/** The elements that can be the visible nav: the docked bottom bar (the
 *  shell's chrome under the bottom-bar mode), the phone pill / iPad rail. */
export const NAV_SELECTORS = '.pf-chrome, nav.pf-bottom-nav, nav.pf-bottom-nav .pf-pill';

/** Measure the visible nav now and write the two variables on `root`. */
export function publishNavInsets(doc: Document, win: Window): { bottom: number; left: number } {
  const els = Array.from(doc.querySelectorAll<HTMLElement>(NAV_SELECTORS)).filter(el => {
    const st = win.getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden';
  });
  const next = navInsets(els.map(el => el.getBoundingClientRect()), win.innerWidth, win.innerHeight);
  const root = doc.documentElement;
  root.style.setProperty('--pf-nav-h', `${next.bottom}px`);
  root.style.setProperty('--pf-nav-left', `${next.left}px`);
  return next;
}
