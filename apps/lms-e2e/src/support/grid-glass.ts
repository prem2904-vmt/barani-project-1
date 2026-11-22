import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Light theme, glass across the grid (owner 2026-11-21): a grid row inside a docked glass panel must look exactly like
 * the panel's empty area — nothing solid between the panel glass and the rows. For each visible row (first few):
 *  - every element from the row up to (not including) the glass panel paints at most alpha .55;
 *  - the row's effective overlay (all those layers composited) equals the empty area's overlay within `tol`;
 *  - pinned cell blocks are frosted (backdrop blur).
 * Call with the page in LIGHT. Returns quietly below 1024px (lists, not grids).
 */
export async function expectGridGlass(page: Page, tag: string, tol = 0.04): Promise<void> {
  if ((page.viewportSize()?.width ?? 0) < 1024) return;
  const r = await page.evaluate(() => {
    const rgba = (c: string): [number, number, number, number] => {
      const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return [0, 0, 0, 0];
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    };
    const vis = (e: Element) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
    const isPanel = (e: Element) => {
      const b = getComputedStyle(e, '::before');
      return b.content !== 'none' && /blur/.test(b.backdropFilter || (b as unknown as Record<string, string>)['webkitBackdropFilter'] || '');
    };
    const chain = (el: Element | null) => { const out: Element[] = []; for (let e = el; e && !isPanel(e); e = e.parentElement) out.push(e); return out; };
    // Composite the layers top-down over nothing: [r,g,b,a] of the overlay the panel glass sees.
    const overlay = (els: Element[]) => {
      let [r, g, b, a] = [0, 0, 0, 0];
      for (const e of [...els].reverse()) {
        const [cr, cg, cb, ca] = rgba(getComputedStyle(e).backgroundColor);
        const na = ca + a * (1 - ca);
        if (na > 0) { r = (cr * ca + r * a * (1 - ca)) / na; g = (cg * ca + g * a * (1 - ca)) / na; b = (cb * ca + b * a * (1 - ca)) / na; }
        a = na;
      }
      return [r, g, b, a];
    };
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.ag-row')).filter(e => vis(e) && !e.closest('.ag-header')).slice(0, 4);
    const out = { rows: rows.length, panel: false, heavy: [] as string[], rowOverlay: [] as number[][], empty: null as number[] | null, pinnedNoBlur: [] as string[] };
    for (const row of rows) {
      const c = chain(row);
      if (c.length && c[c.length - 1].parentElement) out.panel = true;
      for (const e of c) if (rgba(getComputedStyle(e).backgroundColor)[3] > 0.55) out.heavy.push(`${e.tagName.toLowerCase()}.${String(e.className).split(' ').slice(0, 2).join('.')} ${getComputedStyle(e).backgroundColor}`);
      out.rowOverlay.push(overlay(c));
    }
    // The empty area: under the last row of the first grid, else the grid viewport itself.
    const grid = rows[0]?.closest('.ag-root-wrapper');
    if (grid) {
      const g = grid.getBoundingClientRect();
      const last = Math.max(...Array.from(grid.querySelectorAll('.ag-row')).filter(vis).map(x => x.getBoundingClientRect().bottom));
      const hit = g.bottom - last > 24 ? document.elementFromPoint(g.left + g.width / 2, g.bottom - 12) : grid.querySelector('.ag-body-viewport, .ag-grid-viewport, .ag-center-cols-viewport');
      if (hit) out.empty = overlay(chain(hit));
    }
    out.pinnedNoBlur = Array.from(document.querySelectorAll<HTMLElement>('.ag-row .ag-grid-pinned-left-cells, .ag-row .ag-grid-pinned-right-cells, .ag-pinned-left-cols-container, .ag-pinned-right-cols-container'))
      .filter(vis).filter(e => { const c = getComputedStyle(e); return !/blur/.test(c.backdropFilter || (c as unknown as Record<string, string>)['webkitBackdropFilter'] || ''); })
      .map(e => String(e.className).slice(0, 60));
    return out;
  });
  expect(r.rows, `${tag}: grid rows on screen`).toBeGreaterThan(0);
  expect(r.heavy, `${tag}: nothing solid between the panel glass and the rows`).toEqual([]);
  if (r.empty) {
    for (const o of r.rowOverlay) {
      expect(Math.abs(o[3] - r.empty[3]), `${tag}: a row reads like the empty panel area (row ${o.map(n => n.toFixed(2))} vs empty ${r.empty.map(n => n.toFixed(2))})`).toBeLessThanOrEqual(tol);
      if (o[3] > 0.02 && r.empty[3] > 0.02) for (let i = 0; i < 3; i++) expect(Math.abs(o[i] - r.empty[i]), `${tag}: row tint = empty tint`).toBeLessThanOrEqual(255 * tol);
    }
  }
  expect(r.pinnedNoBlur, `${tag}: every pinned cell block is frosted`).toEqual([]);
}

/** WCAG contrast of the theme's secondary text on the panel as it really paints (glass over the ambient pools):
 *  samples a 24×24 patch of empty panel at (x, y) from a screenshot and requires >= `min` (default 4.5). */
export async function expectSecondaryContrast(page: Page, tag: string, x: number, y: number, min = 4.5): Promise<number> {
  const { PNG } = await import('pngjs');
  const buf = await page.screenshot({ clip: { x, y, width: 24, height: 24 } });
  const png = PNG.sync.read(buf);
  let worst: number;
  const text = await page.evaluate(() => { const s = document.createElement('span'); s.style.color = 'var(--text-secondary)'; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; });
  const lum = (r: number, g: number, b: number) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const t = (/rgba?\(([^)]+)\)/.exec(text)?.[1] ?? '0,0,0').split(/[ ,/]+/).filter(Boolean).map(Number);
  const lt = lum(t[0], t[1], t[2]);
  // Dark text: the DARKEST sampled pixel of the panel is the worst case.
  let dark = 1;
  for (let i = 0; i < png.data.length; i += 4) dark = Math.min(dark, lum(png.data[i], png.data[i + 1], png.data[i + 2]));
  worst = (dark + 0.05) / (lt + 0.05);
  expect(worst, `${tag}: secondary text ${text} on the glass panel (darkest sampled pixel) >= ${min}:1`).toBeGreaterThanOrEqual(min);
  return worst;
}
