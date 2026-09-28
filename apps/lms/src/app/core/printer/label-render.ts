import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import bwipjs from 'bwip-js/browser';
import { FittedLine, LabelLineSpec, QUIET_MODULES, code128Modules, fitLabelText, tubeLabelGeometry } from './label-layout';

/**
 * Render a specimen label to a packed 1-bpp bitmap for a direct-thermal label
 * printer (Detonger/Dothantech DP-series). Runs in the browser/renderer using
 * the same barcode/QR libs as the on-screen preview, so what you see is what
 * prints. The packed buffer is handed to the transport (Electron USB IPC now;
 * the Capacitor BLE plugin later) which owns the printer command encoding.
 *
 * Geometry: 203 dpi = 8 dots/mm, head prints ≤ 384 dots (48 mm) wide. The
 * layout is LANDSCAPE (text left, code right) from label-layout.ts, the same
 * geometry the DOM label card prints with.
 */
export type LabelCodeMode = 'barcode' | 'qr' | 'datamatrix';

export interface LabelData {
  /** Sample ID — the 1D barcode / Data Matrix value, and the label's headline. */
  code: string;
  /** QR payload (the app uses MRN|SampleID). Defaults to `code`. */
  qrValue?: string;
  patientName?: string;
  ageSex?: string;
  mrn?: string;
  deptCode?: string;
  tube?: string;
  /** Tube goes to a partner (referral) lab — the label is otherwise
   *  identical; "OUTSOURCED" prints prominently on top. */
  outsourced?: boolean;
}

/** The label's text lines, top to bottom — ONE order for both print paths
 *  (bitmap + DOM card). Pure — unit-tested. An outsourced tube adds only the
 *  heavy "OUTSOURCED" line on top; every other line is exactly the normal
 *  label's. `px` is the legacy 20 mm-baseline size × s; `maxMm`/`minMm`/
 *  `maxLines` drive the landscape fit (label-layout.ts). */
export function labelTextLines(data: LabelData, s = 1): (LabelLineSpec & { px: number })[] {
  const lines: (LabelLineSpec & { px: number })[] = [];
  const add = (l: LabelLineSpec, px: number) => lines.push({ ...l, px: Math.round(px * s) });
  if (data.outsourced) add({ role: 'flag', text: 'OUTSOURCED', heavy: true, mono: false, maxMm: 2.4, minMm: 1.6, maxLines: 1 }, 18);
  if (data.patientName) add({ role: 'name', text: `${data.patientName}${data.ageSex ? '  ' + data.ageSex : ''}`, heavy: true, mono: false, maxMm: 3.0, minMm: 1.7, maxLines: 2 }, 20);
  if (data.mrn) add({ role: 'meta', text: `MRN ${data.mrn}`, heavy: false, mono: true, maxMm: 2.3, minMm: 1.6, maxLines: 1 }, 14);
  // Dept then Sample ID (OPS-36): department reads immediately above the
  // sample id so the label groups by dept → sample id.
  if (data.deptCode) add({ role: 'dept', text: data.deptCode, heavy: false, mono: false, maxMm: 2.3, minMm: 1.6, maxLines: 1 }, 15);
  add({ role: 'id', text: data.code, heavy: true, mono: true, maxMm: 3.4, minMm: 2.0, maxLines: 1 }, 22);
  if (data.tube) add({ role: 'extra', text: data.tube, heavy: false, mono: false, maxMm: 2.0, minMm: 1.5, maxLines: 2 }, 13);
  return lines;
}

export interface PackedBitmap {
  widthDots: number;
  heightDots: number;
  /** base64 of ceil(w/8)*h bytes, row-major, MSB-first, bit set = black. */
  packed: string;
}

const DPMM = 8;
const HEAD_MAX = 384; // 48 mm printable

/**
 * Landscape bitmap: patient text on the LEFT, the code on the RIGHT (the same
 * geometry as the DOM label — label-layout.ts). A 1-D barcode keeps its
 * 10-module quiet zones and an integer narrow bar (2 dots = 0.25 mm when it
 * fits, never < 1 dot); text shrinks, then wraps — it is never cut.
 */
export function renderLabelBitmap(
  data: LabelData,
  opts: { widthMm: number; heightMm: number; codeMode: LabelCodeMode; offsetXmm?: number; offsetYmm?: number; codeScalePct?: number; rotation?: number }
): PackedBitmap {
  const codeScale = (opts.codeScalePct ?? 100) / 100;
  const rot = (((opts.rotation ?? 0) % 360) + 360) % 360; // rotates the CODE only
  const wDots = Math.min(HEAD_MAX, Math.round(opts.widthMm * DPMM));
  // Print ~1 mm short of the label so nothing bleeds into the die-cut gap.
  const hDots = Math.max(48, Math.round((opts.heightMm - 1) * DPMM));

  const modules = opts.codeMode === 'barcode' ? code128Modules(data.code) : 0;
  const g = tubeLabelGeometry(wDots / DPMM, hDots / DPMM, opts.codeMode, modules || undefined);
  const d = (mm: number) => Math.round(mm * DPMM);

  const canvas = document.createElement('canvas');
  canvas.width = wDots; canvas.height = hDots;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, wDots, hDots);
  ctx.fillStyle = '#000';
  ctx.textAlign = 'left';

  // Alignment nudge: shift everything drawn after this by the configured mm so
  // the operator can position the content on the label without exact sizing.
  const ox = Math.round((opts.offsetXmm ?? 0) * DPMM);
  const oy = Math.round((opts.offsetYmm ?? 0) * DPMM);
  if (ox || oy) ctx.translate(ox, oy);

  // ── code (right) ──
  if (opts.codeMode === 'barcode') {
    try {
      const box = { x: d(g.code.x), y: d(g.code.y), w: d(g.code.w), h: d(g.code.h) };
      const sideways = rot === 90 || rot === 270;
      const along = sideways ? box.h : box.w; // the axis the bars run across
      const n = (modules || 1) + 2 * QUIET_MODULES;
      // Integer narrow bar so every module is the same width on the head.
      const mod = Math.max(1, Math.min(3, Math.floor(along / n)));
      const barLen = Math.round((sideways ? box.w : box.h) * Math.min(1, codeScale));
      const tmp = document.createElement('canvas');
      JsBarcode(tmp, data.code, { format: 'CODE128', displayValue: false, margin: 0, height: barLen, width: mod, background: '#ffffff', lineColor: '#000000' });
      blitRotated(ctx, tmp, box.x + Math.round((box.w - (sideways ? tmp.height : tmp.width)) / 2),
        box.y + Math.round((box.h - (sideways ? tmp.width : tmp.height)) / 2),
        sideways ? tmp.height : tmp.width, sideways ? tmp.width : tmp.height, rot, true);
    } catch { /* un-encodable */ }
  } else {
    // Code size % shrinks the square; it never grows past its box (that
    // would run into the text column).
    const size = Math.max(24, Math.min(d(g.code.w), Math.round(d(g.code.w) * codeScale)));
    const codeX = d(g.code.x) + d(g.code.w) - size;
    const codeY = Math.round((hDots - size) / 2);
    const codeImg = opts.codeMode === 'qr'
      ? renderQr(data.qrValue ?? data.code, size)
      : renderDataMatrix(data.code, size);
    if (codeImg) blitRotated(ctx, codeImg, codeX, codeY, size, size, rot);
  }

  // ── text (left): shrink → wrap, never cut; centred vertically ──
  const maxW = d(g.text.w);
  const specs = labelTextLines(data);
  const fitted = fitLabelText(specs, g.text.w, g.text.h);
  const fontOf = (l: FittedLine, px: number) => `bold ${px}px ${l.mono ? 'monospace' : 'sans-serif'}`;
  const laid: { l: FittedLine; px: number; rows: string[] }[] = fitted.map((l) => {
    let px = Math.max(10, d(l.fontMm));
    ctx.font = fontOf(l, px);
    // Real metrics: shrink until it fits its line budget (floor = min size)…
    const minPx = Math.max(10, d(l.minMm));
    let rows = wrapText(ctx, l.text, maxW);
    while (rows.length > l.maxLines && px > minPx) { px--; ctx.font = fontOf(l, px); rows = wrapText(ctx, l.text, maxW); }
    return { l, px, rows }; // …then it simply takes more rows.
  });
  const gapPx = Math.max(1, Math.round(hDots / 90));
  let total = laid.reduce((h, r) => h + r.rows.length * Math.round(r.px * 1.08), 0) + gapPx * (laid.length - 1);
  const topY = d(g.text.y);
  // If the real metrics overflow the column, scale the whole block down.
  if (total > d(g.text.h)) {
    const k = d(g.text.h) / total;
    for (const r of laid) { r.px = Math.max(10, Math.floor(r.px * k)); ctx.font = fontOf(r.l, r.px); r.rows = wrapText(ctx, r.l.text, maxW); }
    total = laid.reduce((h, r) => h + r.rows.length * Math.round(r.px * 1.08), 0) + gapPx * (laid.length - 1);
  }
  let cursor = topY + Math.max(0, Math.round((d(g.text.h) - total) / 2));
  for (const r of laid) {
    ctx.font = fontOf(r.l, r.px);
    for (const row of r.rows) {
      const lh = Math.round(r.px * 1.08);
      const y = cursor + Math.round(r.px * 0.86);
      ctx.fillText(row, d(g.text.x), y);
      // Faux-bold: heavy lines redraw at a 1px offset so anti-aliased strokes
      // carry enough ink through thermal thresholding (not on tiny text,
      // where the extra pixel column fills the counters in).
      if (r.l.heavy && r.px >= 16) ctx.fillText(row, d(g.text.x) + 1, y);
      cursor += lh;
    }
    cursor += gapPx;
  }

  return pack(ctx, wDots, hDots);
}

/** Greedy word-wrap to `maxW` px; a single word wider than the column is
 *  broken by characters (so nothing is ever clipped). */
export function wrapText(ctx: Pick<CanvasRenderingContext2D, 'measureText'>, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const rows: string[] = [];
  let cur = '';
  const fits = (t: string) => ctx.measureText(t).width <= maxW;
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (fits(next)) { cur = next; continue; }
    if (cur) rows.push(cur);
    if (fits(w)) { cur = w; continue; }
    // Hard-break an over-long token.
    let chunk = '';
    for (const ch of w) {
      if (fits(chunk + ch) || !chunk) chunk += ch;
      else { rows.push(chunk); chunk = ch; }
    }
    cur = chunk;
  }
  if (cur) rows.push(cur);
  return rows.length ? rows : [''];
}

/** Draw a pre-rendered code image onto ctx at (x,y,w,h), rotated about its
 *  centre — used so the CODE can rotate while the text stays upright. */
function blitRotated(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number, w: number, h: number, rot: number, native = false): void {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  if (rot) ctx.rotate((rot * Math.PI) / 180);
  ctx.imageSmoothingEnabled = false;
  // native: (w,h) is the rotated FOOTPRINT; draw the image at its own pixel
  // size so barcode modules stay exact integer dots.
  if (native) ctx.drawImage(img, -img.width / 2, -img.height / 2);
  else ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

/** Render a QR to its own square canvas (crisp modules). */
function renderQr(value: string, size: number): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, size, size);
  const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size, bits = qr.modules.data;
  const mod = Math.max(2, Math.floor(size / n));
  const px = mod * n, o = Math.round((size - px) / 2);
  g.fillStyle = '#000';
  for (let r = 0; r < n; r++)
    for (let col = 0; col < n; col++)
      if (bits[r * n + col]) g.fillRect(o + col * mod, o + r * mod, mod, mod);
  return c;
}

/** Render a Data Matrix to its own square canvas. */
function renderDataMatrix(value: string, size: number): HTMLCanvasElement | null {
  try {
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff'; g.fillRect(0, 0, size, size);
    const tmp = document.createElement('canvas');
    bwipjs.toCanvas(tmp, { bcid: 'datamatrix', text: value, scale: 4, paddingwidth: 0, paddingheight: 0, barcolor: '000000', backgroundcolor: 'ffffff' });
    g.imageSmoothingEnabled = false;
    g.drawImage(tmp, 0, 0, size, size);
    return c;
  } catch { return null; }
}

function pack(ctx: CanvasRenderingContext2D, w: number, h: number): PackedBitmap {
  const img = ctx.getImageData(0, 0, w, h).data;
  const bytesPerRow = Math.ceil(w / 8);
  const out = new Uint8Array(bytesPerRow * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const lum = 0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2];
      if (lum < 150) out[y * bytesPerRow + (x >> 3)] |= 1 << (7 - (x & 7));
    }
  }
  let bin = '';
  for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
  return { widthDots: w, heightDots: h, packed: btoa(bin) };
}
