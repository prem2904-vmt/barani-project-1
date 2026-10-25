'use strict';
/**
 * Tiny pure-JS raster canvas + PNG encoder (node zlib only — no native deps)
 * for analyzer graphs the connector draws itself (the LifeDx HBPro sends its
 * chromatogram as numbers, not as an image). Drawing happens at SS× the
 * output size and is box-downsampled on encode, which anti-aliases lines and
 * text for free. RGB, 8 bits, no alpha.
 */
const zlib = require('node:zlib');

// Classic 5×7 (+ descender row) font, ASCII 0x20–0x7E, 5 columns per glyph,
// bit 0 = top row.
const FONT = Buffer.from(
  '0000000000' + '00005f0000' + '0007000700' + '147f147f14' + '242a7f2a12' + '2313086462' + '3649562050' + '0008070300' +
  '001c224100' + '0041221c00' + '2a1c7f1c2a' + '08083e0808' + '0080703000' + '0808080808' + '0000606000' + '2010080402' +
  '3e5149453e' + '00427f4000' + '7249494946' + '2141494d33' + '1814127f10' + '2745454539' + '3c4a494931' + '4121110907' +
  '3649494936' + '464949291e' + '0000140000' + '0040340000' + '0008142241' + '1414141414' + '0041221408' + '0201590906' +
  '3e415d594e' + '7c1211127c' + '7f49494936' + '3e41414122' + '7f4141413e' + '7f49494941' + '7f09090901' + '3e41415173' +
  '7f0808087f' + '00417f4100' + '2040413f01' + '7f08142241' + '7f40404040' + '7f021c027f' + '7f0408107f' + '3e4141413e' +
  '7f09090906' + '3e4151215e' + '7f09192946' + '2649494932' + '03017f0103' + '3f4040403f' + '1f2040201f' + '3f4038403f' +
  '6314081463' + '0304780403' + '6159494d43' + '007f414141' + '0204081020' + '004141417f' + '0402010204' + '4040404040' +
  '0003070800' + '2054547840' + '7f28444438' + '3844444428' + '384444287f' + '3854545418' + '00087e0902' + '18a4a49c78' +
  '7f08040478' + '00447d4000' + '2040403d00' + '7f10284400' + '00417f4000' + '7c04780478' + '7c08040478' + '3844444438' +
  'fc18242418' + '18242418fc' + '7c08040408' + '4854545424' + '04043f4424' + '3c4040207c' + '1c2040201c' + '3c4030403c' +
  '4428102844' + '4c9090907c' + '4464544c44' + '0008364100' + '0000770000' + '0041360800' + '0201020402',
  'hex');

class Canvas {
  /** @param {number} w output width  @param {number} h output height  @param {number} [ss] supersampling factor */
  constructor(w, h, ss = 3, bg = [255, 255, 255]) {
    this.w = w; this.h = h; this.ss = ss;
    this.W = w * ss; this.H = h * ss;
    this.px = Buffer.alloc(this.W * this.H * 3);
    for (let i = 0; i < this.W * this.H; i++) { this.px[i * 3] = bg[0]; this.px[i * 3 + 1] = bg[1]; this.px[i * 3 + 2] = bg[2]; }
  }

  /** Hi-res pixel (integer coords in the SS space). */
  _set(x, y, c) {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    const i = (y * this.W + x) * 3;
    this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2];
  }

  /** Filled rectangle, output coordinates (fractional allowed). */
  rect(x, y, w, h, c) {
    const s = this.ss;
    const x0 = Math.round(x * s), y0 = Math.round(y * s), x1 = Math.round((x + w) * s), y1 = Math.round((y + h) * s);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this._set(xx, yy, c);
  }

  /** Line of `width` output px, output coordinates. */
  line(xa, ya, xb, yb, c, width = 1) {
    const s = this.ss;
    const r = Math.max(0.5, (width * s) / 2);
    const ax = xa * s, ay = ya * s, bx = xb * s, by = yb * s;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const minX = Math.floor(Math.min(ax, bx) - r), maxX = Math.ceil(Math.max(ax, bx) + r);
    const minY = Math.floor(Math.min(ay, by) - r), maxY = Math.ceil(Math.max(ay, by) + r);
    for (let y = Math.max(0, minY); y <= Math.min(this.H - 1, maxY); y++) {
      for (let x = Math.max(0, minX); x <= Math.min(this.W - 1, maxX); x++) {
        const px = x + 0.5, py = y + 0.5;
        let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = ax + t * dx - px, ey = ay + t * dy - py;
        if (ex * ex + ey * ey <= r * r) this._set(x, y, c);
      }
    }
  }

  /** Text width in output px at `size` (output px per font dot). */
  textWidth(str, size = 1) { return String(str).length * 6 * size - size; }

  /** Text with its top-left at (x, y), output coordinates; size = output px per font dot (0.5 steps fine). */
  text(str, x, y, c, size = 1) {
    const d = size * this.ss;               // hi-res px per dot
    let cx = x * this.ss;
    const top = y * this.ss;
    for (const ch of String(str)) {
      const code = ch.charCodeAt(0);
      const g = code >= 0x20 && code <= 0x7e ? (code - 0x20) * 5 : 0;
      for (let col = 0; col < 5; col++) {
        const bits = FONT[g + col];
        for (let row = 0; row < 8; row++) {
          if (!(bits & (1 << row))) continue;
          const x0 = Math.round(cx + col * d), y0 = Math.round(top + row * d);
          const x1 = Math.round(cx + (col + 1) * d), y1 = Math.round(top + (row + 1) * d);
          for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this._set(xx, yy, c);
        }
      }
      cx += 6 * d;
    }
  }

  /** Box-downsampled RGB rows of the output image. */
  pixels() {
    const { w, h, ss, W } = this;
    const out = Buffer.alloc(w * h * 3);
    const n = ss * ss;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
        const k = ((y * ss + j) * W + (x * ss + i)) * 3;
        r += this.px[k]; g += this.px[k + 1]; b += this.px[k + 2];
      }
      const o = (y * w + x) * 3;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n);
    }
    return out;
  }

  /** PNG bytes. */
  toPng() { return encodePng(this.w, this.h, this.pixels()); }
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** 8-bit RGB PNG from packed rows (w*h*3 bytes). */
function encodePng(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter: none
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { Canvas, encodePng, crc32 };
