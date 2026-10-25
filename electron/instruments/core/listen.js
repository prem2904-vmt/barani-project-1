'use strict';
/**
 * Listen mode — "what is this analyzer sending?"
 *
 * Opens the configured transport WITHOUT uploading anything, captures every
 * byte, and runs an auto link so a handshaking analyzer keeps talking (ENQ →
 * we ACK like a real LIS; MLLP → we send the HL7 ACK). After each complete
 * message it re-runs detection over the whole capture and emits the parsed
 * preview. Nothing leaves the host.
 *
 * Events: 'raw' ({dir, text}), 'message' (InstrumentMessage), 'detect'
 * (DetectResult), 'status' (state), 'error' (Error), 'session'
 * ({ id, remote, local, since } — a TCP peer connected).
 */
const { EventEmitter } = require('events');
const { createTransport } = require('./transports');
const { createLink, describeFrame } = require('./link');
const { parseMessage, buildAck } = require('./parsers');
const { detect, optInFrames } = require('./detect');
const { visible } = require('./bytes');

const MAX_CAPTURE = 512 * 1024;

class ListenSession extends EventEmitter {
  constructor({ transport, link = { type: 'auto' }, parser = { type: 'auto' } } = {}, deps = {}) {
    super();
    this.transportCfg = transport;
    this.linkCfg = link && link.type ? link : { type: 'auto' };
    this.parserCfg = parser && parser.type ? parser : { type: 'auto' };
    this.deps = deps;
    this.chunks = [];
    this.size = 0;
    this.messages = [];
    this.links = new Map();
    this.t = null;
  }

  async start() {
    this.t = createTransport(this.transportCfg, this.deps);
    this.t.on('status', (s) => this.emit('status', s));
    this.t.on('error', (e) => this.emit('error', e));
    // Who connected (wizard: "connected from 192.168.1.30 on port 5604").
    this.t.on('session-start', (id, info) => this.emit('session', { id, ...(info || {}) }));
    this.t.on('session-end', (id) => { const l = this.links.get(id); if (l) { l.flush(); l.close(); } this.links.delete(id); });
    this.t.on('data', (buf, id) => {
      this._capture(buf);
      this.emit('raw', { dir: 'in', text: visible(buf) });
      let l = this.links.get(id);
      if (!l) { l = this._link(id); this.links.set(id, l); }
      l.feed(buf);
    });
    this.t.on('file', (text) => {
      this._capture(Buffer.from(text, 'latin1'));
      this.emit('raw', { dir: 'in', text: visible(text) });
      this._onMessage(text, {});
    });
    await this.t.start();
  }

  _link(id) {
    const l = createLink(this.linkCfg, {
      write: (bytes) => { this.emit('raw', { dir: 'out', text: visible(bytes) }); this.t.write(bytes, id); },
      reply: (text) => buildAck(text),
    });
    l.on('message', (text, meta) => this._onMessage(text, meta));
    // stx-etx / sinocare-sn: a readable line per frame under the raw bytes.
    l.on('frame', (f) => { const n = f && f.kind ? describeFrame(f) : null; if (n) this.emit('raw', { dir: 'note', text: `\n— ${n.replace(/^<< /, '')} —\n` }); });
    return l;
  }

  _capture(buf) {
    if (this.size >= MAX_CAPTURE) return;
    this.chunks.push(Buffer.from(buf));
    this.size += buf.length;
  }

  _onMessage(text, meta) {
    let msgs = [];
    try { msgs = parseMessage(text, this.parserCfg, meta); } catch (e) { this.emit('error', e); }
    for (const m of msgs) { this.messages.push(m); this.emit('message', m); }
    this.emit('detect', this.result().detect);
  }

  raw() { return Buffer.concat(this.chunks); }

  /** The bound port (a TCP server started on port 0 learns its real one). */
  port() { return this.t && this.t.port != null ? this.t.port : null; }

  result() {
    const raw = this.raw();
    const d = detect(raw);
    const { messages, text, ...detectOnly } = d;
    return { raw: visible(raw), detect: detectOnly, messages: messages.length ? messages : this.messages };
  }

  async stop() {
    for (const l of this.links.values()) { l.flush(); l.close(); }
    this.links.clear();
    if (this.t) await this.t.stop();
    return this.result();
  }
}

/** Parse pasted/captured text with auto detection (no transport). */
function preview(raw, config = {}) {
  const d = detect(raw);
  const { messages, text, ...detectOnly } = d;
  let msgs = messages;
  if (config && config.parser && config.parser.type && config.parser.type !== 'auto') {
    if (d.link === 'stx-etx' || d.link === 'sinocare-sn') msgs = optInFrames(raw, d.link).flatMap((t) => parseMessage(t, config.parser, { link: d.link }));
    else msgs = parseMessage(text, config.parser, { link: d.link });
  }
  return { raw: visible(raw), detect: detectOnly, messages: msgs };
}

module.exports = { ListenSession, preview };
