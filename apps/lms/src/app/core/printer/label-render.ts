import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import bwipjs from 'bwip-js/browser';

/**
 * Render a specimen label to a packed 1-bpp bitmap for a direct-thermal label
 * printer (Detonger/Dothantech DP-series). Runs in the browser/renderer using
 * the same barcode/QR libs as the on-screen preview, so what you see is what
 * prints. The packed buffer is handed to the transport (Electron USB IPC now;
 * the Capacitor BLE plugin later) which owns the printer command encoding.
 *
 * Geometry: 203 dpi = 8 dots/mm, head prints ≤ 384 dots (48 mm) wide. Tuned +
 * hardware-validated on a 50 × 20 mm label; fonts/positions scale with height
 * so other label sizes stay balanced.
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
}

export interface PackedBitmap {
  widthDots: number;
  heightDots: number;
  /** base64 of ceil(w/8)*h bytes, row-major, MSB-first, bit set = black. */
  packed: string;
}

const DPMM = 8;
const HEAD_MAX = 384; // 48 mm printable

export function renderLabelBitmap(
  data: LabelData,
  opts: { widthMm: number; heightMm: number; codeMode: LabelCodeMode; offsetXmm?: number; offsetYmm?: number; codeScalePct?: number; rotation?: number }
): PackedBitmap {
  const codeScale = (opts.codeScalePct ?? 100) / 100;
  const rot = (((opts.rotation ?? 0) % 360) + 360) % 360; // rotates the CODE only
  const wDots = Math.min(HEAD_MAX, Math.round(opts.widthMm * DPMM));
  // Print ~1 mm short of the label so nothing bleeds into the die-cut gap.
  const hDots = Math.max(48, Math.round((opts.heightMm - 1) * DPMM));
  const s = hDots / 160; // scale from the 20 mm baseline
  const MX = Math.round(12 * Math.min(1.4, Math.max(0.7, s)));
  const MY = Math.round(8 * s);

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

  // Faux-bold: heavy lines redraw at 1px offsets so anti-aliased strokes carry
  // enough ink through thermal thresholding; small lines stay plain.
  const drawText = (text: string, x: number, y: number, px: number, heavy: boolean, maxW: number) => {
    ctx.font = `bold ${px}px sans-serif`;
    ctx.fillText(text, x, y, maxW);
    if (heavy) { ctx.fillText(text, x + 1, y, maxW); ctx.fillText(text, x, y + 1, maxW); }
  };
  const mono = (text: string, x: number, y: number, px: number, heavy: boolean, maxW: number) => {
    ctx.font = `bold ${px}px monospace`;
    ctx.fillText(text, x, y, maxW);
    if (heavy) { ctx.fillText(text, x + 1, y, maxW); ctx.fillText(text, x, y + 1, maxW); }
  };

  if (opts.codeMode === 'barcode') {
    // 1D barcode is a full-width band at the bottom; text stacks above it.
    const bcH = Math.round(hDots * 0.42 * codeScale);
    const bcY = hDots - bcH - MY;
    const bcW = wDots - 2 * MX;
    try {
      const tmp = document.createElement('canvas');
      JsBarcode(tmp, data.code, { format: 'CODE128', displayValue: false, margin: 0, height: 100, width: 2, background: '#ffffff', lineColor: '#000000' });
      blitRotated(ctx, tmp, MX, bcY, bcW, bcH, rot);
    } catch { /* un-encodable */ }
    layoutText(MX, MY, wDots - 2 * MX, bcY - 4);
    // code text just under the bars
    mono(data.code, MX, hDots - Math.round(2 * s), Math.round(16 * s), false, wDots - 2 * MX);
  } else {
    // 2D code (QR / Data Matrix) sits on the right; text block on the left.
    const codeBase = Math.min(hDots - 2 * MY, Math.round(wDots * 0.42));
    const codeSize = Math.max(24, Math.min(hDots - 2 * MY, Math.round(codeBase * codeScale)));
    const codeX = wDots - codeSize - MX;
    const codeY = Math.round((hDots - codeSize) / 2);
    const codeImg = opts.codeMode === 'qr'
      ? renderQr(data.qrValue ?? data.code, codeSize)
      : renderDataMatrix(data.code, codeSize);
    if (codeImg) blitRotated(ctx, codeImg, codeX, codeY, codeSize, codeSize, rot);
    layoutText(MX, MY, codeX - MX - Math.round(8 * s), hDots - MY);
  }

  // ── shared text layout: stack the present lines and centre the block
  //    vertically within [top, bottom] so the label isn't top-heavy. ──
  function layoutText(left: number, top: number, maxW: number, bottom: number) {
    const lines: { text: string; px: number; heavy: boolean; mono: boolean }[] = [];
    if (data.patientName) lines.push({ text: `${data.patientName}${data.ageSex ? '  ' + data.ageSex : ''}`, px: Math.round(20 * s), heavy: true, mono: false });
    if (data.mrn) lines.push({ text: `MRN ${data.mrn}`, px: Math.round(14 * s), heavy: false, mono: true });
    lines.push({ text: data.code, px: Math.round(22 * s), heavy: true, mono: true });
    if (data.deptCode) lines.push({ text: data.deptCode, px: Math.round(15 * s), heavy: false, mono: false });
    if (data.tube) lines.push({ text: data.tube, px: Math.round(13 * s), heavy: false, mono: false });

    const gap = Math.round(6 * s);
    const totalH = lines.reduce((sum, l) => sum + l.px, 0) + gap * (lines.length - 1);
    let cursor = Math.max(top, top + Math.round((bottom - top - totalH) / 2));
    for (const l of lines) {
      cursor += l.px; // advance to this line's baseline
      (l.mono ? mono : drawText)(l.text, left, cursor, l.px, l.heavy, maxW);
      cursor += gap;
    }
  }

  return pack(ctx, wDots, hDots);
}

/** Draw a pre-rendered code image onto ctx at (x,y,w,h), rotated about its
 *  centre — used so the CODE can rotate while the text stays upright. */
function blitRotated(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number, w: number, h: number, rot: number): void {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  if (rot) ctx.rotate((rot * Math.PI) / 180);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
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
