/**
 * jsdom has no Path2D; BarcodeDisplayComponent builds one in a static
 * initializer, so any spec that imports a page embedding it must load this
 * FIRST (side-effect import). Test-only; excluded from the app build.
 */
const g = globalThis as { Path2D?: unknown };
if (typeof g.Path2D === 'undefined') {
  g.Path2D = class {
    constructor(_d?: unknown) { /* no-op */ }
    addPath() { /* no-op */ }
    closePath() { /* no-op */ }
    moveTo() { /* no-op */ }
    lineTo() { /* no-op */ }
    rect() { /* no-op */ }
    arc() { /* no-op */ }
  };
}
export {};
