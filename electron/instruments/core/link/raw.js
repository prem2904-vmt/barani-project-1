'use strict';
/**
 * Raw text link: no handshake. A message ends at a configurable terminator
 * string (e.g. "\u0004", "\f", "\r\n\r\n") OR after `idleMs` of silence —
 * whichever comes first. Typical for analyzers that just "print" results to
 * a serial port / socket.
 */
const { EventEmitter } = require('events');
const { toLatin1 } = require('../bytes');

class RawReceiver extends EventEmitter {
  constructor({ terminator = null, idleMs = 1500, maxBytes = 1024 * 1024 } = {}) {
    super();
    this.terminator = terminator ? String(terminator) : null;
    this.idleMs = idleMs;
    this.maxBytes = maxBytes;
    this.buf = '';
    this.timer = null;
  }

  feed(data) {
    this.buf += toLatin1(data);
    if (this.terminator) {
      let idx;
      while ((idx = this.buf.indexOf(this.terminator)) >= 0) {
        const msg = this.buf.slice(0, idx);
        this.buf = this.buf.slice(idx + this.terminator.length);
        this._emit(msg);
      }
    }
    if (this.buf.length > this.maxBytes) { this._emit(this.buf); this.buf = ''; }
    clearTimeout(this.timer);
    if (this.buf.length && this.idleMs > 0) {
      this.timer = setTimeout(() => this.flush(), this.idleMs);
      if (this.timer.unref) this.timer.unref();
    }
  }

  flush() {
    clearTimeout(this.timer);
    const msg = this.buf;
    this.buf = '';
    this._emit(msg);
  }

  _emit(msg) {
    if (msg && msg.replace(/[\s\x00-\x1f]/g, '').length) this.emit('message', msg);
  }

  reset() { clearTimeout(this.timer); this.buf = ''; }
  close() { clearTimeout(this.timer); }
}

module.exports = { RawReceiver };
