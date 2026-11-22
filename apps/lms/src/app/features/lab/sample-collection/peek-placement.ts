/**
 * Where the hold-to-peek popover goes: beside the POINTER / finger, never the tile or screen centre
 * (owner bug 2026-11-21). Right of the pointer (left when there is no room), lifted a little so the
 * finger does not cover it, clamped inside the viewport. Viewport coordinates for a `position: fixed`
 * element rendered in <body>.
 */
export const PEEK_W = 260;
export const PEEK_MAX_H = 260;
const GAP = 16;
const EDGE = 8;

export function peekPlacement(px: number, py: number, vw: number, vh: number, w = PEEK_W, h = PEEK_MAX_H): { x: number; y: number } {
  let x = px + GAP;
  if (x + w > vw - EDGE) x = px - w - GAP;
  x = Math.max(EDGE, Math.min(x, vw - w - EDGE));
  let y = py - 24;
  y = Math.max(EDGE, Math.min(y, vh - h - EDGE));
  return { x: Math.round(x), y: Math.round(y) };
}
