/**
 * The drag ghost IS the picked-up card's own tube (owner bug 2026-11-21: the ghost was a separate bright SVG
 * that didn't match the card). A deep clone of the card's tube SVG with every element's COMPUTED paint copied
 * inline, so it keeps the card's exact colours, fill level and theme even after it moves to <body> (where
 * the component's ancestor-scoped / theme rules no longer reach it).
 */
const PAINT = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'stop-color', 'stop-opacity', 'filter', 'color', 'visibility', 'display'] as const;

export function cloneTubeVisual(src: Element | null | undefined): Element | null {
  if (!src || typeof getComputedStyle !== 'function') return null;
  const clone = src.cloneNode(true) as Element;
  const a = [src, ...Array.from(src.querySelectorAll('*'))];
  const b = [clone, ...Array.from(clone.querySelectorAll('*'))];
  for (let i = 0; i < a.length && i < b.length; i++) {
    const cs = getComputedStyle(a[i]);
    const st = (b[i] as HTMLElement | SVGElement).style;
    if (!st) continue;
    for (const p of PAINT) {
      const v = cs.getPropertyValue(p);
      if (v) st.setProperty(p, v);
    }
    // Moving parts (blood level, tick pop) are frozen where they are now.
    st.setProperty('transition', 'none');
    st.setProperty('animation', 'none');
  }
  const box = src.getBoundingClientRect();
  const root = clone as SVGElement;
  if (box.width && box.height) {
    root.setAttribute('width', String(Math.round(box.width)));
    root.setAttribute('height', String(Math.round(box.height)));
    root.style.setProperty('width', `${Math.round(box.width)}px`);
    root.style.setProperty('height', `${Math.round(box.height)}px`);
  }
  root.setAttribute('aria-hidden', 'true');
  root.setAttribute('data-ghost-clone', '');
  return clone;
}
