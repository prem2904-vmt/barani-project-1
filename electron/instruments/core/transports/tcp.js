'use strict';
/**
 * TCP transports.
 *   TcpServerTransport — we listen; the analyzer connects to us (common for
 *                        LIS ports on haematology/chemistry analyzers).
 *   TcpClientTransport — we connect to the analyzer's LIS port, reconnecting
 *                        after drops.
 *
 * Common transport interface (see ./index.js):
 *   start() / stop() (Promises), write(bytes, sessionId?)
 *   events: 'data' (buf, sessionId), 'session-start' (id), 'session-end' (id),
 *           'status' ('listening'|'connected'|'disconnected'|'error'), 'error' (err)
 */
const net = require('net');
const { EventEmitter } = require('events');

let seq = 0;
const nextId = (p) => `${p}-${++seq}`;

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
  constructor({ host, port, reconnectMs = 5000 } = {}) {
    super();
    this.host = host;
    this.port = Number(port);
    this.reconnectMs = reconnectMs;
    this.sock = null;
    this.sessionId = null;
    this.stopped = true;
    this.timer = null;
    this.kind = 'tcp-client';
  }

  describe() { return `TCP client → ${this.host}:${this.port}`; }

  start() {
    this.stopped = false;
    this._connect();
    return Promise.resolve();
  }

  _connect() {
    if (this.stopped) return;
    const sock = net.createConnection({ host: this.host, port: this.port });
    this.sock = sock;
    sock.setNoDelay(true);
    sock.on('connect', () => {
      sock.setKeepAlive(true, 30000);
      this.sessionId = nextId('tcpc');
      this.emit('session-start', this.sessionId, { remote: `${this.host}:${this.port}` });
      this.emit('status', 'connected');
    });
    sock.on('data', (buf) => this.emit('data', buf, this.sessionId));
    sock.on('error', (e) => this.emit('error', e));
    sock.on('close', () => {
      if (this.sessionId) this.emit('session-end', this.sessionId);
      this.sessionId = null;
      this.sock = null;
      this.emit('status', 'disconnected');
      if (!this.stopped) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this._connect(), this.reconnectMs);
        if (this.timer.unref) this.timer.unref();
      }
    });
  }

  write(bytes) { if (this.sock) this.sock.write(bytes); }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.sock) this.sock.destroy();
    this.sock = null;
    return Promise.resolve();
  }
}

module.exports = { TcpServerTransport, TcpClientTransport };
