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
  opts: { widthMm: number; heightMm: number; codeMode: LabelCodeMode }
): PackedBitmap {
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
    const bcH = Math.round(hDots * 0.42);
    const bcY = hDots - bcH - MY;
    const bcW = wDots - 2 * MX;
    try {
      const tmp = document.createElement('canvas');
      JsBarcode(tmp, data.code, { format: 'CODE128', displayValue: false, margin: 0, height: 100, width: 2, background: '#ffffff', lineColor: '#000000' });
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, MX, bcY, bcW, bcH);
    } catch { /* un-encodable */ }
    layoutText(true, MX, MY, wDots - 2 * MX, bcY - 4);
    // code text just under the bars
    mono(data.code, MX, hDots - Math.round(2 * s), Math.round(16 * s), false, wDots - 2 * MX);
  } else {
    // 2D code (QR / Data Matrix) sits on the right; text block on the left.
    const codeSize = Math.min(hDots - 2 * MY, Math.round(wDots * 0.42));
    const codeX = wDots - codeSize - MX;
    const codeY = Math.round((hDots - codeSize) / 2);
    if (opts.codeMode === 'qr') drawQr(ctx, data.qrValue ?? data.code, codeX, codeY, codeSize);
    else drawDataMatrix(ctx, data.code, codeX, codeY, codeSize);
    layoutText(false, MX, MY, codeX - MX - Math.round(8 * s), hDots - MY);
  }

  // ── shared text layout ──
  function layoutText(wide: boolean, left: number, top: number, maxW: number, bottom: number) {
    const line = (baseline: number) => Math.round(baseline * s);
    if (data.patientName)
      drawText(`${data.patientName}${data.ageSex ? '  ' + data.ageSex : ''}`, left, line(28), Math.round(20 * s), true, maxW);
    if (data.mrn && bottom > line(50))
      mono(`MRN ${data.mrn}`, left, line(50), Math.round(14 * s), false, maxW);
    mono(data.code, left, line(82), Math.round(22 * s), true, maxW);
    if (data.deptCode && bottom > line(110))
      drawText(data.deptCode, left, line(110), Math.round(15 * s), false, maxW);
    if (data.tube && bottom > line(132))
      drawText(data.tube, left, line(132), Math.round(13 * s), false, maxW);
  }

  return pack(ctx, wDots, hDots);
}

function drawQr(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number): void {
  const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size, bits = qr.modules.data;
  const mod = Math.max(2, Math.floor(size / n));
  const px = mod * n, ox = x + Math.round((size - px) / 2), oy = y + Math.round((size - px) / 2);
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (bits[r * n + c]) ctx.fillRect(ox + c * mod, oy + r * mod, mod, mod);
}

function drawDataMatrix(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number): void {
  try {
    const tmp = document.createElement('canvas');
    bwipjs.toCanvas(tmp, { bcid: 'datamatrix', text: value, scale: 4, paddingwidth: 0, paddingheight: 0, barcolor: '000000', backgroundcolor: 'ffffff' });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, x, y, size, size);
  } catch { /* un-encodable */ }
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
