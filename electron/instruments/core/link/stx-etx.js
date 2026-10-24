'use strict';
/**
 * STX/ETX text link with a bare ACK — no frame number, no checksum, no CR LF,
 * no ENQ/EOT handshake:   <STX> record text <ETX>   →   we answer <ACK>
 *
 * First seen on the LifeDx HBPro (HbA1c HPLC): it sends one fixed-width ASCII
 * record per run and RETRANSMITS the identical record every few seconds until
 * it gets an <ACK> after the <ETX>. So we ACK every complete frame (each
 * retransmit too — the analyzer needs to hear it), but hand an identical
 * record to the parser only once per `dedupeMs` window.
 *
 * Only used when the instrument's link type is 'stx-etx' (the auto link never
 * picks it), so ASTM / MLLP / raw behave exactly as before.
 *
 * Events: 'message' (text), 'frame' ({ kind:'stx-etx', ok, duplicate, length, acked }), 'overflow'.
 */
const { EventEmitter } = require('events');
const { C, toBuffer } = require('../bytes');

const DEFAULT_DEDUPE_MS = 60000;

class StxEtxReceiver extends EventEmitter {
  /**
   * @param {object} o
   * @param {(b:Buffer)=>void} [o.write]   bytes back to the analyzer
   * @param {number} [o.dedupeMs]         identical frames inside this window are ACKed but not re-delivered (0 = off)
   * @param {boolean} [o.ack]             send <ACK> after each frame (default true)
   * @param {() => number} [o.now]
   */
  constructor({ write, dedupeMs = DEFAULT_DEDUPE_MS, ack = true, maxBytes = 256 * 1024, now = () => Date.now() } = {}) {
    super();
    this.write = write;
    this.dedupeMs = Number.isFinite(Number(dedupeMs)) ? Number(dedupeMs) : DEFAULT_DEDUPE_MS;
    this.ack = ack !== false;
    this.maxBytes = maxBytes;
    this.now = now;
    this.inFrame = false;
    this.chunks = [];
    this.size = 0;
    this.last = null;          // { text, at }
  }

  feed(data) {
    const bytes = toBuffer(data);
    let start = 0;
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b === C.STX) {
        // A new STX always (re)starts a frame — a half frame is dropped.
        this.inFrame = true; this.chunks = []; this.size = 0; start = i + 1;
        continue;
      }
      if (!this.inFrame) continue;
      if (b === C.ETX) {
        this.chunks.push(bytes.subarray(start, i));
        const text = Buffer.concat(this.chunks).toString('latin1');
        this.inFrame = false; this.chunks = []; this.size = 0;
        this._complete(text);
        start = i + 1;
      }
    }
    if (this.inFrame && start < bytes.length) {
      const part = bytes.subarray(start);
      this.size += part.length;
      if (this.size > this.maxBytes) { this.inFrame = false; this.chunks = []; this.size = 0; this.emit('overflow'); return; }
      this.chunks.push(Buffer.from(part));
    }
  }

  _complete(text) {
    if (this.ack && this.write) this.write(Buffer.from([C.ACK]));
    const t = this.now();
    const duplicate = !!(this.last && this.last.text === text && this.dedupeMs > 0 && t - this.last.at < this.dedupeMs);
    this.last = { text, at: t };
    this.emit('frame', { kind: 'stx-etx', ok: true, duplicate, length: text.length, acked: !!(this.ack && this.write) });
    if (duplicate) return;
    if (text.replace(/[\s\x00-\x1f]/g, '').length) this.emit('message', text);
  }

  /** New connection: drop a half frame. The dedupe memory survives (the
   *  analyzer may reconnect and resend the same record). */
  reset() { this.inFrame = false; this.chunks = []; this.size = 0; }
  close() { this.reset(); }
}

module.exports = { StxEtxReceiver, DEFAULT_DEDUPE_MS };
