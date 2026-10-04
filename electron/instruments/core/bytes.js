'use strict';
/**
 * Control characters used by the lab-instrument link protocols, plus helpers
 * to render raw bytes visibly (<STX>, <ETX>, <CR> …) for the raw log and the
 * listen-mode capture. Pure Node — no Electron.
 */

const C = Object.freeze({
  NUL: 0x00, SOH: 0x01, STX: 0x02, ETX: 0x03, EOT: 0x04, ENQ: 0x05, ACK: 0x06,
  LF: 0x0a, VT: 0x0b, CR: 0x0d, NAK: 0x15, ETB: 0x17, FS: 0x1c,
});

const NAMES = {
  0x00: 'NUL', 0x01: 'SOH', 0x02: 'STX', 0x03: 'ETX', 0x04: 'EOT', 0x05: 'ENQ', 0x06: 'ACK',
  0x07: 'BEL', 0x08: 'BS', 0x09: 'TAB', 0x0a: 'LF', 0x0b: 'VT', 0x0c: 'FF', 0x0d: 'CR',
  0x15: 'NAK', 0x17: 'ETB', 0x1c: 'FS', 0x1d: 'GS', 0x1e: 'RS', 0x1f: 'US', 0x7f: 'DEL',
};

/** Buffer | string → latin1 string (byte-preserving: 1 char per byte). */
function toLatin1(data) {
  if (data == null) return '';
  if (Buffer.isBuffer(data)) return data.toString('latin1');
  if (data instanceof Uint8Array) return Buffer.from(data).toString('latin1');
  return String(data);
}

/** string | Buffer → Buffer (latin1 for strings, so control chars survive). */
function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  return Buffer.from(String(data ?? ''), 'latin1');
}

/**
 * Render bytes with control characters made visible: "<STX>1H|\^&<CR>…".
 * A CR or LF is followed by a real newline so a log stays readable.
 */
function visible(data, { newlines = true } = {}) {
  const s = toLatin1(data);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      const name = NAMES[code] || `x${code.toString(16).padStart(2, '0')}`;
      out += `<${name}>`;
      if (newlines && (code === C.LF || (code === C.CR && s.charCodeAt(i + 1) !== C.LF))) out += '\n';
    } else {
      out += s[i];
    }
  }
  return out;
}

module.exports = { C, NAMES, toLatin1, toBuffer, visible };
