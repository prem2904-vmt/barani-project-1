import type { jsPDF } from 'jspdf';

/**
 * Overlap detector for the report renderer.
 *
 * `recordDrawing(doc)` wraps `doc.text` / `doc.addImage` for one render and
 * remembers every box drawn (page, x, y, w, h). `findOverlaps` reports any two
 * boxes on the same page that intersect by more than `tol` points on BOTH axes.
 *
 * Used three ways, one detector: the specs (so "long names never overlap" is
 * an assertion, not a screenshot), the template editor's "Issues" chip (run on
 * the live preview render) and, later, the tidy-up step.
 *
 * It only reads: the wrapped calls pass straight through with the same
 * arguments, so the PDF is byte-for-byte what it would have been.
 */

export interface DrawnBox {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'text' | 'image';
  /** First 60 characters of the text (diagnostics). */
  text?: string;
  /** Draw order — a stable id for the pair report. */
  seq: number;
}

export interface Overlap {
  page: number;
  a: DrawnBox;
  b: DrawnBox;
  /** Overlap extent on each axis (pt). */
  dx: number;
  dy: number;
}

export interface DrawRecording {
  boxes: DrawnBox[];
  /** Restore the document's own methods. */
  stop(): void;
}

type TextOpts = { align?: 'left' | 'center' | 'right' | 'justify'; maxWidth?: number; angle?: number; baseline?: string } | undefined;

/** Anything this large is a watermark / background wash, not content. */
const WASH_FONT_PT = 30;
const WASH_IMAGE_AREA = 0.4 * 595.28 * 841.89;

export function recordDrawing(doc: jsPDF): DrawRecording {
  const d = doc as unknown as Record<string, unknown> & {
    text: (...a: unknown[]) => unknown;
    addImage: (...a: unknown[]) => unknown;
    getFontSize(): number;
    getTextWidth(t: string): number;
    getLineHeightFactor?(): number;
    internal: { getCurrentPageInfo(): { pageNumber: number } };
  };
  const boxes: DrawnBox[] = [];
  let seq = 0;
  const origText = d.text;
  const origImage = d.addImage;
  const page = () => d.internal.getCurrentPageInfo().pageNumber;

  d.text = function (this: unknown, ...args: unknown[]) {
    try {
      const [t, x, y, opts] = args as [string | string[], number, number, TextOpts];
      const lines = (Array.isArray(t) ? t : [t]).map(s => String(s ?? ''));
      const size = d.getFontSize();
      const rotated = !!opts?.angle;
      if (!rotated && size < WASH_FONT_PT && lines.some(l => l.trim()) && isFinite(x) && isFinite(y)) {
        const step = size * (d.getLineHeightFactor?.() ?? 1.15);
        lines.forEach((l, i) => {
          if (!l.trim()) return;
          const w = d.getTextWidth(l);
          const align = opts?.align ?? 'left';
          const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
          // Cap-height above the baseline, descender below.
          // jsPDF baseline option: the y is the text's top / middle / bottom, not the alphabetic baseline.
          const up = opts?.baseline === 'top' ? 0 : opts?.baseline === 'middle' ? size * 0.46
            : opts?.baseline === 'bottom' ? size * 0.92 : size * 0.72;
          boxes.push({ page: page(), x: left, y: y + i * step - up, w, h: size * 0.92, kind: 'text', text: l.slice(0, 60), seq: seq++ });
        });
      }
    } catch { /* measuring never breaks a render */ }
    return origText.apply(this, args);
  };

  d.addImage = function (this: unknown, ...args: unknown[]) {
    try {
      // addImage(data, format, x, y, w, h, ...)  — the form the renderer uses.
      const [, , x, y, w, h] = args as [unknown, unknown, number, number, number, number];
      if (typeof x === 'number' && typeof w === 'number' && w * h < WASH_IMAGE_AREA) {
        boxes.push({ page: page(), x, y, w, h, kind: 'image', seq: seq++ });
      }
    } catch { /* never breaks a render */ }
    return origImage.apply(this, args);
  };

  return { boxes, stop() { d.text = origText; d.addImage = origImage; } };
}

/** Pairs of boxes (same page) that intersect by more than `tol` pt on both axes. */
export function findOverlaps(boxes: ReadonlyArray<DrawnBox>, tol = 0.5): Overlap[] {
  const out: Overlap[] = [];
  const byPage = new Map<number, DrawnBox[]>();
  for (const b of boxes) (byPage.get(b.page) ?? byPage.set(b.page, []).get(b.page)!).push(b);
  for (const [page, list] of byPage) {
    const sorted = list.slice().sort((p, q) => p.x - q.x);
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        if (b.x >= a.x + a.w - tol) break;                     // sorted by x: nothing further can overlap
        const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (dx > tol && dy > tol) out.push(a.seq < b.seq ? { page, a, b, dx, dy } : { page, a: b, b: a, dx, dy });
      }
    }
  }
  return out;
}

/** One-line description of a finding, for a list in the editor. */
export function describeOverlap(o: Overlap): string {
  const name = (b: DrawnBox) => (b.kind === 'text' ? `"${b.text ?? ''}"` : 'an image');
  return `Page ${o.page}: ${name(o.a)} runs into ${name(o.b)}`;
}
