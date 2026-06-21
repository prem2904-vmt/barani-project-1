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
