
/** Synthetic pointer events (jsdom has no PointerEvent): what an iPad / Pencil / mouse sends. */
export function ptr(
  el: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
  o: { id?: number; kind?: string; pressure?: number; button?: number } = {},
): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: o.button ?? 0 });
  Object.defineProperties(e, {
    pointerId: { value: o.id ?? 1 },
    pointerType: { value: o.kind ?? 'pen' },
    pressure: { value: o.pressure ?? 0.5 },
    width: { value: 1 },
    height: { value: 1 },
  });
  el.dispatchEvent(e);
}
