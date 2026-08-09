/**
 * Send a PDF blob URL to the browser's print dialog through an off-screen
 * iframe.
 *
 * Why this exists: every caller used to inline its own copy of this, sized
 * `width:0;height:0`. A zero-size iframe never lays out the embedded PDF, so
 * `contentWindow.print()` fires against an empty document and the sheet comes
 * out BLANK — reproduced on Safari and seen intermittently on Chrome. The frame
 * therefore has real A4 dimensions and is parked off-screen instead of being
 * collapsed.
 *
 * `onload` also can't be trusted for a PDF blob (the plugin may render after
 * the event, or never fire it at all), so a settle timer prints as a backstop
 * and a `printed` latch keeps the dialog from opening twice.
 */
export function printPdfBlobUrl(
  blobUrl: string,
  opts: {
    /** Revoke the blob URL during cleanup. Leave false when the caller still
     *  needs the URL (e.g. an on-screen preview shares it). */
    revokeOnDone?: boolean;
    /** Called when the iframe route fails outright, so the caller can decide
     *  between opening a tab and doing nothing (a visible preview needs no
     *  fallback). Defaults to opening the PDF in a new tab. */
    onFallback?: (url: string) => void;
  } = {}
): void {
  const { revokeOnDone = false, onFallback } = opts;

  const frame = document.createElement('iframe');
  // Real A4 box (794×1123 CSS px ≈ 210×297mm at 96dpi) so the PDF actually
  // renders a page; pushed off-screen rather than sized to nothing.
  frame.style.cssText =
    'position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;opacity:0;pointer-events:none;';
  frame.setAttribute('aria-hidden', 'true');
  frame.src = blobUrl;

  let printed = false;
  const fire = () => {
    if (printed) return;
    printed = true;
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      if (onFallback) onFallback(blobUrl);
      else window.open(blobUrl, '_blank');
    }
  };

  frame.onload = () => {
    // One frame of settle time lets the PDF viewer paint before we print.
    setTimeout(fire, 250);
  };
  // Backstop for viewers that never fire onload for a blob PDF.
  setTimeout(fire, 1_500);

  document.body.appendChild(frame);
  setTimeout(() => {
    frame.remove();
    if (revokeOnDone) { try { URL.revokeObjectURL(blobUrl); } catch { /* noop */ } }
  }, 60_000);
}
