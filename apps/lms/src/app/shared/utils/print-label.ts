/**
 * Print ONLY the element(s) marked `.pf-print-label`, nothing else on the page.
 *
 * Adds `pf-printing-label` to <body>; the global print stylesheet (styles.scss)
 * hides everything except `.pf-print-label` while that class is present, so a
 * barcode/QR label prints on its own instead of the whole screen. The class is
 * removed on `afterprint` (with a timeout fallback for browsers that don't fire
 * it, e.g. when the user cancels the dialog).
 */
export function printLabelOnly(): void {
  const body = document.body;
  body.classList.add('pf-printing-label');
  const done = () => {
    body.classList.remove('pf-printing-label');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  try { window.print(); } finally { setTimeout(done, 1500); }
}

/** Root + style element ids used by {@link printTubeLabels}. */
export const TUBE_PRINT_ROOT_ID = 'pf-tube-print-root';
export const TUBE_PRINT_STYLE_ID = 'pf-tube-print-page';

/**
 * Print specimen TUBE labels at their exact physical size.
 *
 * Every `.pf-tl` inside a `.pf-print-label` block whose card is marked
 * `.pf-lc--printing` is cloned onto its own page of W × H mm (read from the
 * label's `data-w-mm` / `data-h-mm`, i.e. the station's Printing → Label size),
 * and an `@page { size: W H; margin: 0 }` rule is injected for the job. The
 * rest of the app is `display:none` while printing, so no blank labels are fed
 * after the real ones (the old visibility-hidden pass still laid the page out).
 *
 * Returns the number of labels queued (0 → falls back to printLabelOnly()).
 */
export function printTubeLabels(onDone?: () => void): number {
  const doc = document;
  const labels = Array.from(doc.querySelectorAll<HTMLElement>('.pf-print-label .pf-lc--printing .pf-tl'));
  if (!labels.length) { printLabelOnly(); onDone?.(); return 0; }
  const cleanup = prepareTubePrint(labels);
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    cleanup();
    window.removeEventListener('afterprint', done);
    onDone?.();
  };
  window.addEventListener('afterprint', done);
  try { window.print(); } finally { setTimeout(done, 1500); }
  return labels.length;
}

/** Build the print-only DOM + @page rule for `labels`; returns the cleanup.
 *  Split out (and exported) so the layout can be asserted without a print
 *  dialog. */
export function prepareTubePrint(labels: HTMLElement[]): () => void {
  const doc = document;
  doc.getElementById(TUBE_PRINT_ROOT_ID)?.remove();
  doc.getElementById(TUBE_PRINT_STYLE_ID)?.remove();

  const first = labels[0];
  const w = Number(first.dataset['wMm']) || 50;
  const h = Number(first.dataset['hMm']) || 25;

  const root = doc.createElement('div');
  root.id = TUBE_PRINT_ROOT_ID;
  for (const el of labels) {
    const page = doc.createElement('div');
    page.className = 'pf-tl-page';
    const clone = el.cloneNode(true) as HTMLElement;
    // Canvases don't clone their pixels — copy them (codes are SVG today,
    // this keeps any canvas-based code working too).
    const src = el.querySelectorAll('canvas');
    clone.querySelectorAll('canvas').forEach((c, i) => {
      const o = src[i];
      if (!o) return;
      c.width = o.width; c.height = o.height;
      try { c.getContext('2d')?.drawImage(o, 0, 0); } catch { /* ignore */ }
    });
    page.appendChild(clone);
    root.appendChild(page);
  }

  const style = doc.createElement('style');
  style.id = TUBE_PRINT_STYLE_ID;
  style.textContent = tubePrintCss(w, h);
  doc.head.appendChild(style);
  doc.body.appendChild(root);
  doc.body.classList.add('pf-printing-tubes');

  return () => {
    doc.body.classList.remove('pf-printing-tubes');
    root.remove();
    style.remove();
  };
}

/** The print stylesheet for a W × H mm tube-label job. */
export function tubePrintCss(widthMm: number, heightMm: number): string {
  const W = `${Math.round(widthMm * 10) / 10}mm`;
  const H = `${Math.round(heightMm * 10) / 10}mm`;
  return `
#${TUBE_PRINT_ROOT_ID} { display: none; }
@media print {
  @page { size: ${W} ${H}; margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; height: auto !important; min-height: 0 !important; overflow: visible !important; }
  body.pf-printing-tubes > *:not(#${TUBE_PRINT_ROOT_ID}) { display: none !important; }
  body.pf-printing-tubes #${TUBE_PRINT_ROOT_ID} { display: block !important; }
  #${TUBE_PRINT_ROOT_ID} .pf-tl-page { width: ${W}; height: ${H}; overflow: hidden; break-after: page; page-break-after: always; break-inside: avoid; }
  #${TUBE_PRINT_ROOT_ID} .pf-tl-page:last-child { break-after: auto; page-break-after: auto; }
  #${TUBE_PRINT_ROOT_ID} .pf-tl { width: ${W} !important; height: ${H} !important; box-shadow: none !important; zoom: 1 !important; }
  #${TUBE_PRINT_ROOT_ID}, #${TUBE_PRINT_ROOT_ID} * { visibility: visible !important; color: #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;
}
