/**
 * TSPL label generation.
 *
 * TSPL (TSC Printer Language) is the most widely-supported command set on the
 * cheap thermal LABEL printers used for sample tubes — TSC, Godex, many
 * rebadged BLE units. We emit element commands (TEXT / BARCODE / QRCODE) rather
 * than a raster so the label stays tiny over BLE and crisp at any print head.
 *
 * If a given printer turns out NOT to speak TSPL, ONLY this file changes — the
 * transport (the native plugin) and everything above it stay identical. Swap in
 * an ESC-POS or CPCL builder here and the rest of the app is unaffected.
 */

export interface LabelInput {
  /** The scannable value — sample/tube id (e.g. "HAEM260800001"). */
  code: string;
  /** Bold top line, usually patient name. */
  title?: string;
  /** Extra lines under the barcode (test name, date, age/sex …). */
  lines?: string[];
  /** Physical label size in mm. Defaults to a 40×25 mm tube label. */
  widthMm?: number;
  heightMm?: number;
  /** Gap between labels in mm (defaults 2). */
  gapMm?: number;
  /** Copies. Defaults 1. */
  copies?: number;
  /** Add a QR alongside the 1D barcode. Off by default (narrow tube labels). */
  qr?: boolean;
}

/** 8 dots/mm is the common 203-dpi head; used to place elements in dots. */
const DPMM = 8;

function esc(s: string): string {
  // TSPL string literals are double-quoted; backslash-escape embedded quotes.
  return (s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Build a TSPL program for one label as raw bytes. */
export function buildTsplLabel(label: LabelInput): Uint8Array {
  const w = label.widthMm ?? 40;
  const h = label.heightMm ?? 25;
  const gap = label.gapMm ?? 2;
  const copies = Math.max(1, label.copies ?? 1);
  const pad = 16; // left margin in dots (2 mm)

  const lines: string[] = [
    `SIZE ${w} mm, ${h} mm`,
    `GAP ${gap} mm, 0 mm`,
    `DIRECTION 1`,
    `REFERENCE 0,0`,
    `CLS`,
  ];

  let y = 12;
  if (label.title) {
    lines.push(`TEXT ${pad},${y},"3",0,1,1,"${esc(label.title)}"`);
    y += 34;
  }

  // Code-128 of the id — narrow bar 2, height ~ half the label.
  const barH = Math.round(h * DPMM * 0.38);
  lines.push(`BARCODE ${pad},${y},"128",${barH},1,0,2,2,"${esc(label.code)}"`);
  y += barH + 8;

  // Human-readable id under the bars.
  lines.push(`TEXT ${pad},${y},"2",0,1,1,"${esc(label.code)}"`);
  y += 26;

  for (const ln of label.lines ?? []) {
    lines.push(`TEXT ${pad},${y},"1",0,1,1,"${esc(ln)}"`);
    y += 22;
  }

  if (label.qr) {
    const qx = Math.round(w * DPMM) - 96;
    lines.push(`QRCODE ${qx},12,H,4,A,0,"${esc(label.code)}"`);
  }

  lines.push(`PRINT 1,${copies}`);

  const program = lines.join('\r\n') + '\r\n';
  return new TextEncoder().encode(program);
}

/** Base64-encode raw bytes (browser-safe, no Buffer). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
