'use strict';
/**
 * TCP transports.
 *   TcpServerTransport — we listen; the analyzer connects to us (common for
 *                        LIS ports on haematology/chemistry analyzers).
 *   TcpClientTransport — we connect to the analyzer's LIS port, reconnecting
 *                        after drops, and backing off when the peer accepts
 *                        and closes us again and again (e.g. an analyzer
 *                        that only accepts ONE LIS connection and another
 *                        program — or a stale connection of our own —
 *                        already holds it).
 *
 * Common transport interface (see ./index.js):
 *   start() / stop() (Promises — stop() destroys the socket, clears every
 *   timer and AWAITS the actual 'close' before resolving, so a caller that
 *   starts a replacement transport right after stop() never ends up with two
 *   live sockets to the same analyzer), write(bytes, sessionId?)
 *   events: 'data' (buf, sessionId), 'session-start' (id), 'session-end' (id),
 *           'status' ('listening'|'connected'|'disconnected'|'error'), 'error' (err)
 */
const net = require('net');
const { EventEmitter } = require('events');

let seq = 0;
const nextId = (p) => `${p}-${++seq}`;

// How soon after 'connect' a 'close' counts as "the peer rejected us again"
// (back off) rather than an ordinary drop of an established connection
// (reconnect at the base interval).
const IMMEDIATE_CLOSE_MS = 2000;
// reconnectMs multipliers for repeated immediate closes: 1×, 2×, 6×, 12× —
// with the 5s default that is the owner's 5s → 10s → 30s → 60s (capped)
// sequence; capped again by maxReconnectMs regardless of reconnectMs.
const BACKOFF_STEPS = [1, 2, 6, 12];

class TcpServerTransport extends EventEmitter {
  constructor({ port, host = '0.0.0.0' } = {}) {
    super();
    this.port = Number(port);
    this.host = host || '0.0.0.0';
    this.sockets = new Map();
    this.server = null;
    this.kind = 'tcp-server';
  }

  describe() { return `TCP server ${this.host}:${this.port}`; }

  start() {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((sock) => {
        const id = nextId('tcp');
        this.sockets.set(id, sock);
        sock.setNoDelay(true);
        sock.setKeepAlive(true, 30000);
        this.emit('session-start', id, { remote: `${sock.remoteAddress}:${sock.remotePort}` });
        this.emit('status', 'connected');
        sock.on('data', (buf) => this.emit('data', buf, id));
        sock.on('error', (e) => this.emit('error', e));
        sock.on('close', () => {
          this.sockets.delete(id);
          this.emit('session-end', id);
          this.emit('status', this.sockets.size ? 'connected' : 'listening');
        });
      });
      this.server.once('error', (e) => { this.emit('status', 'error'); reject(e); });
      this.server.listen(this.port, this.host, () => {
        this.server.removeAllListeners('error');
        this.server.on('error', (e) => { this.emit('error', e); this.emit('status', 'error'); });
        this.port = this.server.address().port;
        this.emit('status', 'listening');
        resolve();
      });
    });
  }

  write(bytes, sessionId) {
    if (sessionId && this.sockets.has(sessionId)) { this.sockets.get(sessionId).write(bytes); return; }
    for (const s of this.sockets.values()) s.write(bytes);
  }

  stop() {
    return new Promise((resolve) => {
      for (const s of this.sockets.values()) s.destroy();
      this.sockets.clear();
      if (!this.server) { resolve(); return; }
      this.server.close(() => { this.emit('status', 'disconnected'); resolve(); });
      this.server = null;
    });
  }
}

class TcpClientTransport extends EventEmitter {
  constructor({ host, port, reconnectMs = 5000, maxReconnectMs = 60000 } = {}) {
    super();
    this.host = host;
    this.port = Number(port);
    this.reconnectMs = reconnectMs;
    this.maxReconnectMs = maxReconnectMs;
    this.sock = null;
    this.sessionId = null;
    this.stopped = true;
    this.timer = null;
    this.kind = 'tcp-client';
    this.closeGraceMs = 1500;  // how long stop() waits for the peer to release the connection before destroying it
    this.connectedAt = null;   // set on 'connect', cleared on 'close' — tells an immediate close from a real drop
    this.failStreak = 0;       // consecutive immediate-closes — drives the backoff
    this.hintedBusy = false;   // the "accepted and closed" hint is logged once per problem episode
  }

  describe() { return `TCP client → ${this.host}:${this.port}`; }

  start() {
    this.stopped = false;
    this.failStreak = 0;
    this.hintedBusy = false;
    this._connect();
    return Promise.resolve();
  }

  _connect() {
    if (this.stopped) return;
    const sock = net.createConnection({ host: this.host, port: this.port });
    this.sock = sock;
    sock.setNoDelay(true);
    // Every handler below checks `this.sock === sock`: once stop() (or a
    // fresh _connect()) has moved this.sock on, THIS socket's own events are
    // no-ops — the only way to guarantee never more than one live client
    // socket per instrument even if a stale socket's events are still
    // in flight when it is superseded.
    sock.on('connect', () => {
      if (this.sock !== sock) return;
      sock.setKeepAlive(true, 30000);
      this.connectedAt = Date.now();
      this.sessionId = nextId('tcpc');
      this.emit('session-start', this.sessionId, { remote: `${this.host}:${this.port}` });
      this.emit('status', 'connected');
    });
    sock.on('data', (buf) => { if (this.sock === sock) this.emit('data', buf, this.sessionId); });
    sock.on('error', (e) => { if (this.sock === sock) this.emit('error', e); });
    sock.on('close', () => {
      if (this.sock !== sock) return; // superseded — this socket's own close is a no-op
      const wasConnected = this.connectedAt != null;
      const immediate = wasConnected && (Date.now() - this.connectedAt) < IMMEDIATE_CLOSE_MS;
      this.connectedAt = null;
      if (this.sessionId) this.emit('session-end', this.sessionId);
      this.sessionId = null;
      this.sock = null;
      this.emit('status', 'disconnected');
      if (this.stopped) return;
      let delay = this.reconnectMs;
      if (immediate) {
        // The peer (TCP-level) accepted us and closed us again right away —
        // typically an analyzer that only allows ONE LIS connection and
        // something else (another program, or a connection of our own it
        // hasn't noticed is gone) already holds the slot. Hammering it every
        // reconnectMs just keeps losing the race; back off instead.
        const idx = Math.min(this.failStreak, BACKOFF_STEPS.length - 1);
        delay = Math.min(this.reconnectMs * BACKOFF_STEPS[idx], this.maxReconnectMs);
        this.failStreak++;
        if (!this.hintedBusy) {
          this.hintedBusy = true;
          this.emit('error', new Error('The analyzer accepted and closed the connection — it may only allow one LIS connection; another program (or a stale connection) may be holding it.'));
        }
      } else {
        this.failStreak = 0;
        this.hintedBusy = false;
      }
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this._connect(), delay);
      if (this.timer.unref) this.timer.unref();
    });
  }

  write(bytes) { if (this.sock) this.sock.write(bytes); }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
    const sock = this.sock;
    this.sock = null;
    this.sessionId = null;
    this.connectedAt = null;
    if (!sock || sock.destroyed) return Promise.resolve();
    // Await the ACTUAL close (not just calling destroy()) so a caller that
    // starts a replacement transport right after stop() resolves never ends
    // up with two live sockets to the same analyzer at once.
    //
    // destroy() alone only closes OUR end: the peer (a one-client analyzer)
    // notices the FIN later, so a replacement could still connect while the
    // analyzer believes the old client is attached and refuse it — the
    // reconnect loop seen on the Mindray BC-5130. So close gracefully
    // (FIN, then wait for the peer's FIN/close = it has released the slot) and
    // only destroy as a fallback if the peer doesn't answer in time.
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(fallback); resolve(); };
      const fallback = setTimeout(() => { sock.destroy(); }, this.closeGraceMs);
      if (fallback.unref) fallback.unref();
      sock.once('close', finish);
      sock.on('error', () => {});
      sock.end();
    });
  }
}

module.exports = { TcpServerTransport, TcpClientTransport };
