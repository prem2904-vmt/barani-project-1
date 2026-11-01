/**
 * Rate card → JPEG pages, in the browser (the backend only ever receives JPEG pages; it has no PDF library).
 *  - a photo / scan (JPEG, PNG, WebP, HEIC the browser can decode) is drawn on a canvas, its long edge capped at
 *    {@link MAX_EDGE} px, and saved as JPEG;
 *  - a PDF is rendered page by page with pdfjs-dist (the same worker the report viewers use) and saved the same way.
 * Limits mirror the server: 6 pages, 15 MB in all. Pure decisions live in {@link planPages} / {@link fitEdge} so they
 * are unit-tested without a DOM.
 */

import { InjectionToken } from '@angular/core';

export const MAX_PAGES = 6;
export const MAX_EDGE = 1600;
export const MAX_TOTAL_BYTES = 15 * 1024 * 1024;
/** A source file we refuse before reading it (a huge PDF would stall the tab). */
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
export const JPEG_QUALITY = 0.82;

export type RateCardPrepareError =
  | 'nothing' | 'too_many_pages' | 'too_large' | 'unsupported_type' | 'unreadable';

export class RateCardPrepareException extends Error {
  constructor(readonly code: RateCardPrepareError) { super(code); }
}

/** Plain words for each prepare failure. */
export const PREPARE_WORDS: Readonly<Record<RateCardPrepareError, string>> = {
  nothing: 'Add a photo or a PDF of the rate card.',
  too_many_pages: 'A rate card can have at most 6 pages. Add fewer pages.',
  too_large: 'That is over 15 MB. Try fewer pages or a smaller photo.',
  unsupported_type: 'Add a photo (JPEG, PNG, WebP) or a PDF.',
  unreadable: 'Couldn’t open that file. Try a clearer photo or another PDF.',
};

export type SourceKind = 'pdf' | 'image';

/** pdf | image | null from the file's declared type, falling back to its extension. */
export function sourceKind(f: { type: string; name: string }): SourceKind | null {
  const t = (f.type || '').toLowerCase();
  if (t === 'application/pdf' || /\.pdf$/i.test(f.name)) return 'pdf';
  if (t.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)) return 'image';
  return null;
}

/** Scale so the long edge is at most `max` (never up). */
export function fitEdge(w: number, h: number, max = MAX_EDGE): { w: number; h: number } {
  const long = Math.max(w, h);
  if (!(long > max)) return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
  const k = max / long;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/**
 * Decide, before any work, what a pick turns into: images count one page each, a PDF counts its pages (known only
 * after opening it, so `pdfPages` supplies them). Throws the typed refusal.
 */
export function planPages(files: readonly { type: string; name: string; size: number }[], pdfPages: (i: number) => number = () => 1): number {
  if (!files.length) throw new RateCardPrepareException('nothing');
  let pages = 0;
  files.forEach((f, i) => {
    const k = sourceKind(f);
    if (!k) throw new RateCardPrepareException('unsupported_type');
    if (f.size > MAX_SOURCE_BYTES) throw new RateCardPrepareException('too_large');
    pages += k === 'pdf' ? pdfPages(i) : 1;
  });
  if (pages > MAX_PAGES) throw new RateCardPrepareException('too_many_pages');
  return pages;
}

export interface PrepareProgress { done: number; total: number; }

function canvasToJpeg(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new RateCardPrepareException('unreadable'))), 'image/jpeg', JPEG_QUALITY));
}

async function imagePage(file: File): Promise<Blob> {
  let bmp: ImageBitmap | null = null;
  try { bmp = await createImageBitmap(file); } catch { /* fall back to <img> */ }
  let w: number, h: number, draw: (ctx: CanvasRenderingContext2D, W: number, H: number) => void;
  if (bmp) {
    const b = bmp; w = b.width; h = b.height; draw = (ctx, W, H) => ctx.drawImage(b, 0, 0, W, H);
  } else {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new RateCardPrepareException('unreadable')); i.src = url; });
      w = img.naturalWidth; h = img.naturalHeight; draw = (ctx, W, H) => ctx.drawImage(img, 0, 0, W, H);
      return await render(w, h, draw);
    } finally { URL.revokeObjectURL(url); }
  }
  try { return await render(w, h, draw); } finally { bmp?.close(); }
}

async function render(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, W: number, H: number) => void): Promise<Blob> {
  if (!w || !h) throw new RateCardPrepareException('unreadable');
  const { w: W, h: H } = fitEdge(w, h);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) throw new RateCardPrepareException('unreadable');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);   // JPEG has no alpha: a transparent PNG must not turn black
  draw(ctx, W, H);
  return canvasToJpeg(c);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pdfPage(page: any): Promise<Blob> {
  const base = page.getViewport({ scale: 1 });
  const { w } = fitEdge(base.width, base.height);
  const viewport = page.getViewport({ scale: w / base.width });
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.floor(viewport.width)); c.height = Math.max(1, Math.floor(viewport.height));
  const ctx = c.getContext('2d');
  if (!ctx) throw new RateCardPrepareException('unreadable');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  try { await page.render({ canvasContext: ctx, viewport }).promise; } catch { throw new RateCardPrepareException('unreadable'); }
  return canvasToJpeg(c);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function openPdf(file: File): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = 'assets/pdf.worker.min.mjs';
  try { return await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise; } catch { throw new RateCardPrepareException('unreadable'); }
}

/**
 * Turn the picked files into JPEG pages (in order). `onProgress` reports pages finished out of the total.
 * Throws {@link RateCardPrepareException}; the caller words it with {@link PREPARE_WORDS}.
 */
export async function prepareRateCardPages(files: readonly File[], onProgress: (p: PrepareProgress) => void = () => undefined): Promise<Blob[]> {
  // Open every PDF first: its page count decides whether the pick fits at all.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docs = new Map<number, any>();
  const counts = new Map<number, number>();
  for (let i = 0; i < files.length; i++) {
    if (sourceKind(files[i]) === 'pdf' && files[i].size <= MAX_SOURCE_BYTES) {
      const d = await openPdf(files[i]);
      docs.set(i, d); counts.set(i, Number(d.numPages) || 1);
    }
  }
  const total = planPages(files, (i) => counts.get(i) ?? 1);
  const out: Blob[] = [];
  const step = () => onProgress({ done: out.length, total });
  step();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const doc = docs.get(i);
    if (doc) {
      for (let p = 1; p <= doc.numPages; p++) {
        out.push(await pdfPage(await doc.getPage(p)));
        step();
      }
    } else {
      out.push(await imagePage(f));
      step();
    }
  }
  if (out.reduce((n, b) => n + b.size, 0) > MAX_TOTAL_BYTES) throw new RateCardPrepareException('too_large');
  return out;
}

/** The panel prepares pages through this token so a spec can supply canvas-free pages (no module mocking). */
export const RATE_CARD_PREPARE = new InjectionToken<typeof prepareRateCardPages>('RATE_CARD_PREPARE', {
  providedIn: 'root',
  factory: () => prepareRateCardPages,
});
