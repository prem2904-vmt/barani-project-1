/**
 * Detonger DP27 (Dothantech LPAPI) encoder — TypeScript, browser-usable.
 * Mirrors electron/dp27.js (validated against sb-child/dz-print vectors).
 *
 * Two transports share these command builders; only the framing differs:
 *   • USB → each batch wrapped in a `1e <varlen>` frame (done in the main proc).
 *   • BLE → raw command bytes written straight to the write characteristic
 *     (service 0xae30 / char 0xae01), NO `1e` header. buildBleJob() emits that.
 */
import { PackedBitmap } from './label-render';

export const DP27_BLE = {
  service: 0xae30,
  writeChar: 0xae01,
};

function checksum(arr: number[], start: number, end: number): number {
  let x = 0;
  for (let i = start; i < end; i++) x = (x + arr[i]) >>> 0;
  return (x & 0xff) ^ 0xff;
}
function toVariableBytes(n: number): number[] {
  if (n < 192) return [n];
  if (n < 16384) return [(n >> 8) | 0xc0, n & 0xff];
  return [(n >> 16) | 0xc0, (n >> 8) & 0xff, n & 0xff];
}
/** Structured host command: <grp><type><varlen><data><checksum>. Used for the
 *  density/speed settings; over BLE these are sent as-is (no 1e wrapper). */
function hostCommand(code16: number, data: number[] = []): number[] {
  const buf = [(code16 >> 8) & 0xff, code16 & 0xff, ...toVariableBytes(data.length), ...data, 0];
  buf[buf.length - 1] = checksum(buf, 1, buf.length);
  return buf;
}

const reset = (): number[] => [0x1b, 0x40];
const formFeed = (): number[] => [0x0c];
function feedLines(n: number): number[] {
  const out: number[] = []; let r = n;
  while (r > 0) { const x = r >= 255 ? 255 : r; r -= x; out.push(0x1b, 0x4a, x); }
  return out;
}
function repeatLine(count: number): number[] {
  const out: number[] = []; let r = count;
  while (r > 0) { const x = r >= 192 ? 192 : r; r -= x; out.push(0x1f, 0x2e, x - 1); }
  return out;
}
function printLine(maxWidth: number, dots: boolean[]): number[] {
  const w = Math.min(maxWidth, dots.length), bytes = Math.ceil(w / 8);
  const b = new Array(bytes).fill(0);
  for (let i = 0; i < w; i++) if (dots[i]) b[i >> 3] |= 1 << (7 - (i & 7));
  return [0x1f, 0x2a, w & 0xff, (w >> 8) & 0xff, ...b];
}
function skipPrintLine(maxWidth: number, skip: number, dots: boolean[]): number[] {
  const w = Math.min(maxWidth - skip, dots.length);
  const skipBytes = Math.floor(skip / 8), skipOffset = skip % 8;
  const bytesToPrint = 1 + Math.ceil(w / 8);
  const off = new Array(skipOffset).fill(false).concat(dots);
  const b = new Array(bytesToPrint).fill(0), take = skipOffset + w;
  for (let i = 0; i < take; i++) if (off[i]) b[i >> 3] |= 1 << (7 - (i & 7));
  return [0x1f, 0x2b, skipBytes, bytesToPrint, ...b];
}

function unpack(bmp: PackedBitmap): { w: number; h: number; pix: boolean[] } {
  const w = bmp.widthDots, h = bmp.heightDots;
  const bpr = Math.ceil(w / 8);
  const bin = atob(bmp.packed);
  const pix = new Array(w * h).fill(false);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      pix[y * w + x] = (bin.charCodeAt(y * bpr + (x >> 3)) & (1 << (7 - (x & 7)))) !== 0;
  return { w, h, pix };
}

function bitmapToCommands(bmp: { w: number; h: number; pix: boolean[] }): number[] {
  const { w, h, pix } = bmp;
  const lineEmpty = (y: number) => { for (let x = 0; x < w; x++) if (pix[y * w + x]) return false; return true; };
  const sameLine = (a: number, b: number) => { for (let x = 0; x < w; x++) if (pix[a * w + x] !== pix[b * w + x]) return false; return true; };
  const firstBlack = (y: number) => { for (let x = 0; x < w; x++) if (pix[y * w + x]) return x; return -1; };
  const lastBlack = (y: number) => { for (let x = w - 1; x >= 0; x--) if (pix[y * w + x]) return x; return -1; };
  const cmds: number[] = []; let y = 0;
  while (y < h) {
    let empty = 0;
    for (let i = y; i < h && lineEmpty(i); i++) empty++;
    if (empty > 0) { cmds.push(...feedLines(empty)); y += empty; continue; }
    let rep = 0;
    if (y > 0) { for (let i = y; i < h && sameLine(y - 1, i); i++) rep++; }
    if (rep > 0) { cmds.push(...repeatLine(rep)); y += rep; continue; }
    const fb = firstBlack(y), lb = lastBlack(y), row: boolean[] = [];
    for (let x = 0; x <= lb; x++) row.push(pix[y * w + x]);
    if (fb > 0) cmds.push(...skipPrintLine(w, fb, row.slice(fb)));
    else cmds.push(...printLine(w, row));
    y += 1;
  }
  return cmds;
}

/** Build the raw BLE byte stream (no USB 1e framing). Chunk when writing. */
export function buildBleJob(bmp: PackedBitmap, opts: { density?: number; speed?: number } = {}): Uint8Array {
  const bytes: number[] = [];
  if (opts.density != null) bytes.push(...hostCommand(0x1f43, [opts.density]));
  if (opts.speed != null) bytes.push(...hostCommand(0x1f44, [opts.speed]));
  bytes.push(...reset(), ...bitmapToCommands(unpack(bmp)), ...formFeed());
  return new Uint8Array(bytes);
}
