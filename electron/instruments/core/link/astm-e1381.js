'use strict';
/**
 * ASTM E1381 (CLSI LIS01-A2) low-level link protocol.
 *
 *   Establishment:  sender → ENQ, receiver → ACK (or NAK = busy)
 *   Transfer:       STX FN <text ≤ 240> ETB|ETX C1 C2 CR LF   (one frame)
 *                   receiver → ACK (good) | NAK (bad checksum / bad FN)
 *   Termination:    sender → EOT
 *
 * FN = frame number 0-7, the first frame of a session is 1, then modulo 8.
 * Checksum = sum of the bytes FN … ETB|ETX (inclusive) mod 256, as two
 * upper-case hex characters. A record longer than 240 characters is split
 * into intermediate frames (ETB) + a final frame (ETX).
 *
 * AstmReceiver is what the LIS (us) runs; AstmSender is what an analyzer
 * runs — used by the simulators and, later, for host-query replies.
 * Both are pure state machines over a `write(bytes)` callback: no sockets,
 * no timers they don't own, no Electron.
 */
const { EventEmitter } = require('events');
const { C, toBuffer } = require('../bytes');

const MAX_FRAME_TEXT = 240;

/** Checksum of FN…ETX/ETB (a latin1 string or Buffer), two hex chars. */
function checksum(body) {
  const b = toBuffer(body);
  let sum = 0;
  for (const x of b) sum = (sum + x) & 0xff;
  return sum.toString(16).toUpperCase().padStart(2, '0');
}

/**
 * Encode a full message (records separated by CR) into E1381 frames.
 * Returns an array of Buffers, each a complete frame incl. STX … CR LF.
 * @param {string} message  E1394 text, records terminated by CR
 * @param {{maxText?:number, startFn?:number}} [opts]
 */
function encodeFrames(message, { maxText = MAX_FRAME_TEXT, startFn = 1 } = {}) {
  const records = String(message).split('\r').filter((r) => r.length > 0).map((r) => r + '\r');
  const frames = [];
  let fn = startFn % 8;
  for (const rec of records) {
    for (let i = 0; i < rec.length; i += maxText) {
      const text = rec.slice(i, i + maxText);
      const last = i + maxText >= rec.length;
      const term = last ? C.ETX : C.ETB;
      const body = `${fn}${text}${String.fromCharCode(term)}`;
      frames.push(Buffer.concat([
        Buffer.from([C.STX]), Buffer.from(body, 'latin1'),
        Buffer.from(checksum(body), 'latin1'), Buffer.from([C.CR, C.LF]),
      ]));
      fn = (fn + 1) % 8;
    }
  }
  return frames;
}

/**
 * Parse one frame (Buffer starting with STX, ending with CR LF).
 * @returns {{ok:boolean, fn:number, text:string, final:boolean, reason?:string}}
 */
function decodeFrame(frame) {
  const f = toBuffer(frame);
  if (f[0] !== C.STX) return { ok: false, reason: 'no STX' };
  // Locate the terminator (ETX or ETB) — the LAST one before C1 C2 CR LF.
  const termIdx = f.length - 5;
  if (termIdx < 2) return { ok: false, reason: 'short frame' };
  const term = f[termIdx];
  if (term !== C.ETX && term !== C.ETB) return { ok: false, reason: 'no ETX/ETB' };
  if (f[f.length - 2] !== C.CR || f[f.length - 1] !== C.LF) return { ok: false, reason: 'no CR LF' };
  const body = f.subarray(1, termIdx + 1);          // FN … ETX/ETB
  const given = f.subarray(termIdx + 1, termIdx + 3).toString('latin1').toUpperCase();
  const fnChar = String.fromCharCode(f[1]);
  const fn = Number.parseInt(fnChar, 10);
  const text = f.subarray(2, termIdx).toString('latin1');
  if (!(fn >= 0 && fn <= 7)) return { ok: false, fn, text, reason: 'bad frame number' };
  const want = checksum(body);
  if (given !== want) return { ok: false, fn, text, final: term === C.ETX, reason: `checksum ${given} != ${want}` };
  return { ok: true, fn, text, final: term === C.ETX };
}

/**
 * Receiver side (LIS). Feed it raw transport bytes; it answers ENQ/frames
 * with ACK/NAK via `write` and emits:
 *   'message' (text)          — a complete E1394 message (records joined)
 *   'frame'   ({fn, ok, reason}) — every frame seen (for logs/tests)
 *   'state'   ('idle'|'receiving')
 *   'timeout' ()              — frame timeout; the partial message is discarded
 */
class AstmReceiver extends EventEmitter {
  /**
   * @param {{write:(b:Buffer)=>void, frameTimeoutMs?:number, busy?:()=>boolean}} opts
   */
  constructor({ write, frameTimeoutMs = 30000, busy } = {}) {
    super();
    this.write = write;
    this.frameTimeoutMs = frameTimeoutMs;
    this.busy = busy || (() => false);
    this.state = 'idle';
    this.buf = Buffer.alloc(0);
    this.text = '';
    this.expectedFn = 1;
    this.lastAcceptedFn = null;
    this.timer = null;
  }

  _set(state) {
    if (this.state !== state) { this.state = state; this.emit('state', state); }
  }

  _arm() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.emit('timeout');
      this.reset();
    }, this.frameTimeoutMs);
    if (this.timer.unref) this.timer.unref();
  }

  reset() {
    clearTimeout(this.timer);
    this.timer = null;
    this.buf = Buffer.alloc(0);
    this.text = '';
    this.expectedFn = 1;
    this.lastAcceptedFn = null;
    this._set('idle');
  }

  feed(data) {
    const bytes = toBuffer(data);
    for (let i = 0; i < bytes.length; i++) this._byte(bytes[i]);
  }

  _byte(b) {
    if (this.state === 'idle') {
      if (b === C.ENQ) {
        if (this.busy()) { this.write(Buffer.from([C.NAK])); return; }
        this.buf = Buffer.alloc(0);
        this.text = '';
        this.expectedFn = 1;
        this.lastAcceptedFn = null;
        this._set('receiving');
        this.write(Buffer.from([C.ACK]));
        this._arm();
      }
      // Anything else while idle is line noise — ignored.
      return;
    }

    // receiving
    if (this.buf.length === 0) {
      if (b === C.EOT) {
        clearTimeout(this.timer);
        const text = this.text;
        this.reset();
        if (text.length) this.emit('message', text);
        return;
      }
      if (b === C.ENQ) {
        // Sender restarted the session (e.g. after its own timeout). Accept.
        this.text = '';
        this.expectedFn = 1;
        this.lastAcceptedFn = null;
        this.write(Buffer.from([C.ACK]));
        this._arm();
        return;
      }
      if (b !== C.STX) return; // noise between frames
    }
    this.buf = Buffer.concat([this.buf, Buffer.from([b])]);
    // A frame ends with CR LF after ETX/ETB C1 C2.
    const n = this.buf.length;
    if (n >= 6 && this.buf[n - 1] === C.LF && this.buf[n - 2] === C.CR
        && (this.buf[n - 5] === C.ETX || this.buf[n - 5] === C.ETB)) {
      const frame = this.buf;
      this.buf = Buffer.alloc(0);
      this._frame(frame);
    } else if (n > 1024) {
      // Runaway garbage — drop and NAK so the sender retransmits.
      this.buf = Buffer.alloc(0);
      this.emit('frame', { ok: false, reason: 'overlong frame' });
      this.write(Buffer.from([C.NAK]));
    }
  }

  _frame(frame) {
    const d = decodeFrame(frame);
    this._arm();
    if (!d.ok) {
      this.emit('frame', { ok: false, fn: d.fn, reason: d.reason });
      this.write(Buffer.from([C.NAK]));
      return;
    }
    if (d.fn === this.expectedFn) {
      this.text += d.text;
      this.lastAcceptedFn = d.fn;
      this.expectedFn = (d.fn + 1) % 8;
      this.emit('frame', { ok: true, fn: d.fn, final: d.final });
      this.write(Buffer.from([C.ACK]));
      return;
    }
    if (d.fn === this.lastAcceptedFn) {
      // Our ACK was lost and the sender repeated the frame: ACK, don't append.
      this.emit('frame', { ok: true, fn: d.fn, duplicate: true });
      this.write(Buffer.from([C.ACK]));
      return;
    }
    this.emit('frame', { ok: false, fn: d.fn, reason: `frame number ${d.fn} != ${this.expectedFn}` });
    this.write(Buffer.from([C.NAK]));
  }

  close() { clearTimeout(this.timer); this.timer = null; }
}

/**
 * Sender side (analyzer role). `send(message)` resolves when the receiver
 * has ACKed every frame and EOT was sent; rejects on give-up.
 *
 * Fault injection for simulators/tests: `corrupt(frameIndex, attempt)` →
 * true corrupts that frame's checksum on that attempt (attempt starts at 1).
 */
class AstmSender extends EventEmitter {
  constructor({ write, ackTimeoutMs = 15000, maxRetries = 6, busyRetryMs = 10000, maxText = MAX_FRAME_TEXT, corrupt, beforeEnq } = {}) {
    super();
    // Optional async gate run before EVERY ENQ (host-query replies: wait for
    // the analyzer's EOT first — E1381 contention handling, see bidi/index.js).
    this.beforeEnq = beforeEnq || null;
    this.write = write;
    this.ackTimeoutMs = ackTimeoutMs;
    this.maxRetries = maxRetries;
    this.busyRetryMs = busyRetryMs;
    this.maxText = maxText;
    this.corrupt = corrupt || (() => false);
    this._waiter = null;
    this.stats = { frames: 0, naks: 0, retransmits: 0 };
  }

  feed(data) {
    const bytes = toBuffer(data);
    for (const b of bytes) {
      if ((b === C.ACK || b === C.NAK || b === C.ENQ || b === C.EOT) && this._waiter) {
        const w = this._waiter;
        this._waiter = null;
        clearTimeout(w.timer);
        w.resolve(b);
      }
    }
  }

  _await() {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this._waiter = null; resolve(null); }, this.ackTimeoutMs);
      if (timer.unref) timer.unref();
      this._waiter = { resolve, timer };
    });
  }

  async send(message) {
    const frames = encodeFrames(message, { maxText: this.maxText });
    // Establishment (retry on NAK = busy / timeout).
    let established = false;
    for (let attempt = 0; attempt <= this.maxRetries && !established; attempt++) {
      if (this.beforeEnq) await this.beforeEnq(attempt);
      this.write(Buffer.from([C.ENQ]));
      const r = await this._await();
      if (r === C.ACK) established = true;
      else if (r === C.NAK || r === C.ENQ) await new Promise((res) => setTimeout(res, Math.min(this.busyRetryMs, this.ackTimeoutMs)));
    }
    if (!established) throw new Error('ASTM: receiver never ACKed ENQ');

    for (let i = 0; i < frames.length; i++) {
      let attempt = 0;
      for (;;) {
        attempt++;
        let frame = frames[i];
        if (this.corrupt(i, attempt)) {
          frame = Buffer.from(frame);
          // Flip the first checksum character to a different valid hex digit.
          const idx = frame.length - 4;
          frame[idx] = frame[idx] === 0x30 ? 0x31 : 0x30;
        }
        this.stats.frames++;
        if (attempt > 1) this.stats.retransmits++;
        this.write(frame);
        const r = await this._await();
        if (r === C.ACK) break;
        if (r === C.EOT) { this.write(Buffer.from([C.EOT])); throw new Error('ASTM: receiver requested stop'); }
        if (r === C.NAK) this.stats.naks++;
        if (attempt > this.maxRetries) {
          this.write(Buffer.from([C.EOT]));
          throw new Error(`ASTM: frame ${i + 1} rejected ${attempt} times`);
        }
      }
    }
    this.write(Buffer.from([C.EOT]));
    return { frames: frames.length, ...this.stats };
  }
}

module.exports = { AstmReceiver, AstmSender, checksum, encodeFrames, decodeFrame, MAX_FRAME_TEXT };
