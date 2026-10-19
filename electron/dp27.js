'use strict';
/**
 * Detonger DP27 (Dothantech LPAPI) printer encoder — Node port of the
 * reverse-engineered protocol in sb-child/dz-print (MPL-2.0). Validated
 * byte-for-byte against that project's unit-test vectors.
 *
 * Print commands (ESC-style): 1b40 init · 1f2a print-row · 1f2b skip+row ·
 * 1f2e repeat-row · 1b4a feed · 0c form-feed. Everything is wrapped for USB in
 * a 1e <varlen> <payload> frame. Structured host commands (settings/queries)
 * use <grp><type><varlen><data><checksum>.
 */

function checksum(arr, start, end) {
  let x = 0;
  for (let i = start; i < end; i++) x = (x + arr[i]) >>> 0;
  return (x & 0xff) ^ 0xff;
}
function toVariableBytes(n) {
  if (n < 0) throw new Error('negative');
  if (n < 192) return Buffer.from([n]);
  if (n < 16384) return Buffer.from([(n >> 8) | 0xc0, n & 0xff]);
  if (n < 4194304) return Buffer.from([(n >> 16) | 0xc0, (n >> 8) & 0xff, n & 0xff]);
  throw new Error('too large');
}
function packageUsb(payload) {
  return Buffer.concat([Buffer.from([0x1e]), toVariableBytes(payload.length), payload]);
}
function hostCommand(code16, data = Buffer.alloc(0), fixedChecksum = false) {
  const grp = (code16 >> 8) & 0xff, type = code16 & 0xff;
  const lenBuf = toVariableBytes(data.length);
  const buf = Buffer.concat([Buffer.from([grp, type]), lenBuf, Buffer.from(data), Buffer.from([0])]);
  buf[buf.length - 1] = fixedChecksum ? 0x88 : checksum(buf, 1, buf.length);
  return buf;
}

const resetPrinter = () => Buffer.from([0x1b, 0x40]);
const nextPaper = () => Buffer.from([0x0c]);
function feedLines(n) {
  const out = []; let r = n;
  while (r > 0) { const x = r >= 255 ? 255 : r; r -= x; out.push(Buffer.from([0x1b, 0x4a, x])); }
  return out;
}
function repeatLine(count) {
  const out = []; let r = count;
  while (r > 0) { const x = r >= 192 ? 192 : r; r -= x; out.push(Buffer.from([0x1f, 0x2e, x - 1])); }
  return out;
}
function printLine(maxWidth, dots) {
  const w = Math.min(maxWidth, dots.length), bytes = Math.ceil(w / 8);
  const b = Buffer.alloc(bytes);
  for (let idx = 0; idx < w; idx++) if (dots[idx]) b[idx >> 3] |= 1 << (7 - (idx & 7));
  return Buffer.concat([Buffer.from([0x1f, 0x2a, w & 0xff, (w >> 8) & 0xff]), b]);
}
function skipPrintLine(maxWidth, skip, dots) {
  const w = Math.min(maxWidth - skip, dots.length);
  const skipBytes = Math.floor(skip / 8), skipOffset = skip % 8;
  const bytesToPrint = 1 + Math.ceil(w / 8);
  const off = new Array(skipOffset).fill(false).concat(dots);
  const b = Buffer.alloc(bytesToPrint), take = skipOffset + w;
  for (let idx = 0; idx < take; idx++) if (off[idx]) b[idx >> 3] |= 1 << (7 - (idx & 7));
  return Buffer.concat([Buffer.from([0x1f, 0x2b, skipBytes, bytesToPrint]), b]);
}

// bmp: { w, h, pix: boolean[] } (pix[y*w + x], true = black)
function bitmapToCommands(bmp) {
  const { w, h, pix } = bmp;
  const lineEmpty = (y) => { for (let x = 0; x < w; x++) if (pix[y * w + x]) return false; return true; };
  const sameLine = (a, b) => { for (let x = 0; x < w; x++) if (pix[a * w + x] !== pix[b * w + x]) return false; return true; };
  const firstBlack = (y) => { for (let x = 0; x < w; x++) if (pix[y * w + x]) return x; return -1; };
  const lastBlack = (y) => { for (let x = w - 1; x >= 0; x--) if (pix[y * w + x]) return x; return -1; };
  const cmds = []; let y = 0;
  while (y < h) {
    let empty = 0;
    for (let i = y; i < h && lineEmpty(i); i++) empty++;
    if (empty > 0) { cmds.push(...feedLines(empty)); y += empty; continue; }
    let rep = 0;
    if (y > 0) { for (let i = y; i < h && sameLine(y - 1, i); i++) rep++; }
    if (rep > 0) { cmds.push(...repeatLine(rep)); y += rep; continue; }
    const fb = firstBlack(y), lb = lastBlack(y), row = [];
    for (let x = 0; x <= lb; x++) row.push(pix[y * w + x]);
    if (fb > 0) cmds.push(skipPrintLine(w, fb, row.slice(fb)));
    else cmds.push(printLine(w, row));
    y += 1;
  }
  return cmds;
}
function buildUsbJob(bmp, { maxPacket = 2048, density = null, speed = null } = {}) {
  const pre = [];
  if (density != null) pre.push(packageUsb(hostCommand(0x1f43, Buffer.from([density]))));
  if (speed != null) pre.push(packageUsb(hostCommand(0x1f44, Buffer.from([speed]))));
  const cmds = [resetPrinter(), ...bitmapToCommands(bmp), nextPaper()];
  const frames = []; let batch = [], size = 0;
  const flush = () => { if (batch.length) { frames.push(packageUsb(Buffer.concat(batch))); batch = []; size = 0; } };
  for (const c of cmds) { if (size + c.length > maxPacket) flush(); batch.push(c); size += c.length; }
  flush();
  return Buffer.concat([...pre, ...frames]);
}

module.exports = { checksum, toVariableBytes, packageUsb, hostCommand, buildUsbJob, bitmapToCommands };
