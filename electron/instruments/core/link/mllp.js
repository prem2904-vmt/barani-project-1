'use strict';
/**
 * HL7 v2 Minimal Lower Layer Protocol:  <VT> message <FS><CR>
 *
 * MllpReceiver emits 'message' (text) per framed block and, when given a
 * `reply(text) → string|null` hook, writes the framed reply (the HL7 ACK)
 * back through `write`. Pure state machine — no sockets.
 */
const { EventEmitter } = require('events');
const { C, toBuffer } = require('../bytes');

function frame(text) {
  return Buffer.concat([Buffer.from([C.VT]), Buffer.from(String(text), 'latin1'), Buffer.from([C.FS, C.CR])]);
}

class MllpReceiver extends EventEmitter {
  constructor({ write, reply, maxBytes = 1024 * 1024 } = {}) {
    super();
    this.write = write;
    this.reply = reply;
    this.maxBytes = maxBytes;
    this.inBlock = false;
    this.chunks = [];
    this.size = 0;
  }

  feed(data) {
    const bytes = toBuffer(data);
    let start = 0;
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (!this.inBlock) {
        if (b === C.VT) { this.inBlock = true; this.chunks = []; this.size = 0; start = i + 1; }
        continue;
      }
      if (b === C.FS) {
        this.chunks.push(bytes.subarray(start, i));
        const text = Buffer.concat(this.chunks).toString('latin1');
        this.inBlock = false;
        this.chunks = [];
        this.size = 0;
        // The trailing CR after FS is consumed by the idle branch (ignored).
        this._deliver(text);
        start = i + 1;
      }
    }
    if (this.inBlock && start < bytes.length) {
      const part = bytes.subarray(start);
      this.size += part.length;
      if (this.size > this.maxBytes) {
        this.inBlock = false; this.chunks = []; this.size = 0;
        this.emit('overflow');
        return;
      }
      this.chunks.push(Buffer.from(part));
    }
  }

  _deliver(text) {
    this.emit('message', text);
    if (this.reply && this.write) {
      try {
        const ack = this.reply(text);
        if (ack) this.write(frame(ack));
      } catch (e) {
        this.emit('error', e);
      }
    }
  }

  reset() { this.inBlock = false; this.chunks = []; this.size = 0; }
  close() {}
}

module.exports = { MllpReceiver, frame };
