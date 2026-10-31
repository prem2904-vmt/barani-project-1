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
 *   'stx-etx'    → StxEtxReceiver (<STX> text <ETX>, we answer <ACK>; LifeDx HBPro)
 *   'sinocare-sn'→ SinocareReceiver ("SN" + len + type + JSON + CRC16; iCARE-2100)
 *   'auto'       → decides on the first significant byte of a session:
 *                  ENQ → ASTM, VT → MLLP, anything else → raw.
 */
const { EventEmitter } = require('events');
const { C, toBuffer } = require('../bytes');
const { AstmReceiver } = require('./astm-e1381');
const { MllpReceiver } = require('./mllp');
const { RawReceiver } = require('./raw');
const { StxEtxReceiver } = require('./stx-etx');
const { SinocareReceiver, newContext } = require('./sinocare-sn');

/** Sinocare patient context per link config object: the connector reuses one
 *  config object for every TCP connection of an instrument (until a config
 *  change), and the iCARE reconnects between its Patient and result frames. */
const SINOCARE_CONTEXTS = new WeakMap();
function sinocareContext(cfg) {
  let c = SINOCARE_CONTEXTS.get(cfg);
  if (!c) { c = newContext(); SINOCARE_CONTEXTS.set(cfg, c); }
  return c;
}

/** `link.echo` (written by the server's echoMode setting, e.g. via remote
 *  support) → the Sinocare replyMode. An explicit `replyMode` always wins;
 *  unset = undefined = the receiver's default ('none'), byte-identical. */
function echoReplyMode(v) {
  if (v === true || v === 'on' || v === 'echo') return 'echo';
  if (v === false || v === 'off' || v === 'none') return 'none';
  return undefined;
}

function buildConcrete(type, cfg, io) {
  switch (type) {
    case 'astm-e1381':
    case 'astm':
      return new AstmReceiver({ write: io.write, frameTimeoutMs: cfg.frameTimeoutMs || 30000, checksum: cfg.checksum });
    case 'mllp':
    case 'hl7':
      return new MllpReceiver({ write: io.write, reply: io.reply });
    // Opt-in only (explicit link.type) — the auto link never picks these.
    case 'stx-etx':
      return new StxEtxReceiver({ write: io.write, dedupeMs: cfg.dedupeMs ?? undefined, ack: cfg.ack !== false });
    case 'sinocare-sn':
      return new SinocareReceiver({ write: io.write, replyMode: cfg.replyMode ?? echoReplyMode(cfg.echo), ackJson: cfg.ackJson, context: sinocareContext(cfg) });
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

/** One log line for a stx-etx / sinocare-sn 'frame' event (null for any other link). */
function describeFrame(f) {
  if (f.kind === 'stx-etx') {
    return f.duplicate ? `<< same record again (analyzer retransmit) — ${f.acked ? 'ACKed, ' : ''}not read twice` : `<< STX/ETX record, ${f.length} chars${f.acked ? ' — ACK sent' : ''}`;
  }
  if (f.kind === 'sinocare-sn') {
    const t = f.type != null ? `0x${Number(f.type).toString(16).padStart(4, '0')}` : '?';
    if (!f.ok) return `SN frame ignored: ${f.reason}`;
    return `<< SN frame type ${t}${f.resource ? ` (${f.resource})` : ''}, CRC ok${f.replied ? ' — reply sent' : ''}`;
  }
  return null;
}

function createLink(cfg, io) { return new Link(cfg, io); }

module.exports = { createLink, Link, normalizeType, isAutoNoiseByte, describeFrame, echoReplyMode };
