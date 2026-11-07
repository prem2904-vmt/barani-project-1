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


// ── Patient ID card ──────────────────────────────────────────────────────
// OPS-102: the ID card used to print through printLabelOnly() + the global
// `.pf-print-label { position:absolute; left:0; top:0; width:auto }` rule,
// which is built for tube labels. Inside the profile modal an ancestor's
// overflow / transform clipped the card, so the QR was cut. The card now has
// its own path, like the tube labels: it is CLONED to a root on <body>
// (no ancestor box can clip it), with its own @page size.

export const ID_CARD_PRINT_ROOT_ID = 'pf-idcard-print-root';
export const ID_CARD_PRINT_STYLE_ID = 'pf-idcard-print-page';
/** Card paper (mm): a CR80-style card with a little margin around it. */
export const ID_CARD_PAGE_MM = { w: 92, h: 62 } as const;

/** Print ONLY this patient ID card, on its own @page, never clipped. */
export function printIdCard(card: HTMLElement, onDone?: () => void): void {
  const cleanup = prepareIdCardPrint(card);
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
}

/** Build the print-only DOM + @page rule for the card; returns the cleanup. Exported so the
 *  layout can be asserted without a print dialog. */
export function prepareIdCardPrint(card: HTMLElement): () => void {
  const doc = document;
  doc.getElementById(ID_CARD_PRINT_ROOT_ID)?.remove();
  doc.getElementById(ID_CARD_PRINT_STYLE_ID)?.remove();

  const root = doc.createElement('div');
  root.id = ID_CARD_PRINT_ROOT_ID;
  const clone = card.cloneNode(true) as HTMLElement;
  clone.classList.remove('pf-print-label');   // the tube-label rule must never position this copy
  const src = card.querySelectorAll('canvas');
  clone.querySelectorAll('canvas').forEach((c, i) => {
    const o = src[i];
    if (!o) return;
    c.width = o.width; c.height = o.height;
    try { c.getContext('2d')?.drawImage(o, 0, 0); } catch { /* ignore */ }
  });
  root.appendChild(clone);

  const style = doc.createElement('style');
  style.id = ID_CARD_PRINT_STYLE_ID;
  style.textContent = idCardPrintCss();
  doc.head.appendChild(style);
  doc.body.appendChild(root);
  doc.body.classList.add('pf-printing-idcard');

  return () => {
    doc.body.classList.remove('pf-printing-idcard');
    root.remove();
    style.remove();
  };
}

/** The print stylesheet for the ID card: its own page, the card in normal flow (no absolute
 *  position, no transform, no overflow clip) and its whole height shown. */
export function idCardPrintCss(): string {
  const { w, h } = ID_CARD_PAGE_MM;
  return `
#${ID_CARD_PRINT_ROOT_ID} { display: none; }
@media print {
  @page { size: ${w}mm ${h}mm; margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; height: auto !important; min-height: 0 !important; overflow: visible !important; }
  body.pf-printing-idcard > *:not(#${ID_CARD_PRINT_ROOT_ID}) { display: none !important; }
  body.pf-printing-idcard #${ID_CARD_PRINT_ROOT_ID} { display: block !important; position: static !important; transform: none !important; overflow: visible !important; width: ${w}mm; padding: 3mm; box-sizing: border-box; }
  #${ID_CARD_PRINT_ROOT_ID} > * { position: static !important; transform: none !important; overflow: visible !important; width: 100% !important; max-width: none !important; margin: 0 !important; break-inside: avoid; page-break-inside: avoid; box-shadow: none !important; }
  #${ID_CARD_PRINT_ROOT_ID}, #${ID_CARD_PRINT_ROOT_ID} * { visibility: visible !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;
}
