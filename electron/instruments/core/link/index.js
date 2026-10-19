'use strict';
/**
 * Link-layer factory + an auto-sniffing link.
 *
 * Every link exposes: feed(bytes), reset(), close(), and emits
 * 'message' (text, { link }) for each complete message it reassembles.
 *
 * link.type:
 *   'astm-e1381' → AstmReceiver (ENQ/ACK/frames/EOT)
 *   'mllp'       → MllpReceiver (VT … FS CR), replies with the HL7 ACK
 *   'raw'        → RawReceiver (terminator / idle timeout)
 *   'auto'       → decides on the first significant byte of a session:
 *                  ENQ → ASTM, VT → MLLP, anything else → raw.
 */
const { EventEmitter } = require('events');
const { C, toBuffer } = require('../bytes');
const { AstmReceiver } = require('./astm-e1381');
const { MllpReceiver } = require('./mllp');
const { RawReceiver } = require('./raw');

function buildConcrete(type, cfg, io) {
  switch (type) {
    case 'astm-e1381':
    case 'astm':
      return new AstmReceiver({ write: io.write, frameTimeoutMs: cfg.frameTimeoutMs || 30000 });
    case 'mllp':
    case 'hl7':
      return new MllpReceiver({ write: io.write, reply: io.reply });
    case 'raw':
    default:
      return new RawReceiver({ terminator: cfg.terminator ?? null, idleMs: cfg.idleMs ?? 1500 });
  }
}

function normalizeType(type) {
  if (type === 'astm') return 'astm-e1381';
  if (type === 'hl7') return 'mllp';
  return type || 'auto';
}

/** Bytes to skip over while sniffing for the FIRST significant byte of a new
 *  auto-detected session: ordinary whitespace/NUL noise, plus any OTHER
 *  control byte besides ENQ (ASTM handshake) / VT (MLLP block) — neither is
 *  ever a valid start of either supported protocol, but some analyzers (e.g.
 *  the Mindray BC-5130) send a lone <STX> every few seconds as a keep-alive
 *  between messages. Without this, that stray byte alone would lock the
 *  session into 'raw' and break the real message that follows. */
function isAutoNoiseByte(b) {
  if (b === C.CR || b === C.LF || b === 0x20 || b === 0x00) return true;
  return b < 0x20 && b !== C.ENQ && b !== C.VT;
}

class Link extends EventEmitter {
  /**
   * @param {object} cfg   link config ({ type, frameTimeoutMs, terminator, idleMs })
   * @param {{write:(b:Buffer)=>void, reply?:(text:string)=>string|null}} io
   */
  constructor(cfg = {}, io = {}) {
    super();
    this.cfg = cfg || {};
    this.io = io;
    this.configured = normalizeType(this.cfg.type);
    this.inner = null;
    this.type = null;
    if (this.configured !== 'auto') this._use(this.configured);
  }

  _use(type) {
    if (this.inner) { this.inner.removeAllListeners(); this.inner.close?.(); }
    this.type = type;
    this.inner = buildConcrete(type, this.cfg, this.io);
    this.inner.on('message', (text) => this.emit('message', text, { link: this.type }));
    this.inner.on('frame', (f) => this.emit('frame', f));
    this.inner.on('timeout', () => this.emit('timeout'));
    this.inner.on('error', (e) => this.emit('error', e));
    this.emit('link', type);
  }

  feed(data) {
    let bytes = toBuffer(data);
    if (!this.inner) {
      // Auto: skip leading noise (whitespace/NUL/keep-alive control bytes),
      // decide on the first real byte.
      let i = 0;
      while (i < bytes.length && isAutoNoiseByte(bytes[i])) i++;
      if (i >= bytes.length) return;
      const b = bytes[i];
      if (b === C.ENQ) this._use('astm-e1381');
      else if (b === C.VT) this._use('mllp');
      else this._use('raw');
      bytes = bytes.subarray(i);
    }
    this.inner.feed(bytes);
  }

  /** New connection / session: an auto link re-sniffs. */
  reset() {
    if (this.configured === 'auto') {
      if (this.inner) { this.inner.removeAllListeners(); this.inner.close?.(); }
      this.inner = null;
      this.type = null;
    } else {
      this.inner?.reset();
    }
  }

  /** True while an ASTM session from the analyzer is in progress (between its ENQ and EOT). */
  isBusy() { return !!(this.inner && this.inner.state === 'receiving'); }

  /** Force-deliver a partially buffered raw message (e.g. connection closed). */
  flush() { if (this.inner && typeof this.inner.flush === 'function') this.inner.flush(); }

  close() { if (this.inner) this.inner.close?.(); }
}

function createLink(cfg, io) { return new Link(cfg, io); }

module.exports = { createLink, Link, normalizeType, isAutoNoiseByte };
