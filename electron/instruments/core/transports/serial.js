'use strict';
/**
 * RS-232 / USB-serial transport over the `serialport` package (a native
 * module — loaded lazily so the rest of the core runs without it, e.g. in
 * tests or a TCP-only Raspberry Pi install). A SerialPort class can be
 * injected (`deps.SerialPort`) for tests / @serialport/binding-mock.
 *
 * Params: path, baudRate, dataBits (5-8), parity (none|even|odd|mark|space),
 * stopBits (1|1.5|2), rtscts (hardware flow), xon/xoff (software flow).
 * The port re-opens after errors/unplugs every reconnectMs.
 */
const { EventEmitter } = require('events');

function loadSerialPort() {
  try {
    // eslint-disable-next-line global-require
    return require('serialport').SerialPort;
  } catch (e) {
    const err = new Error('The serialport module is not installed on this host (npm i serialport)');
    err.cause = e;
    throw err;
  }
}

/** List serial ports (empty list when serialport is unavailable). */
async function listSerialPorts(deps = {}) {
  let SP;
  try { SP = deps.SerialPort || loadSerialPort(); } catch { return []; }
  const ports = await SP.list();
  return ports.map((p) => ({ path: p.path, manufacturer: p.manufacturer || undefined, serialNumber: p.serialNumber || undefined }));
}

class SerialTransport extends EventEmitter {
  constructor(cfg = {}, deps = {}) {
    super();
    this.cfg = cfg;
    this.deps = deps;
    this.port = null;
    this.stopped = true;
    this.timer = null;
    this.sessionId = null;
    this.reconnectMs = cfg.reconnectMs || 5000;
    this.kind = 'serial';
  }

  describe() {
    const c = this.cfg;
    const par = (c.parity || 'none')[0].toUpperCase();
    return `Serial ${c.path} ${c.baudRate || 9600} ${c.dataBits || 8}${par}${c.stopBits || 1}`;
  }

  start() {
    this.stopped = false;
    return this._open();
  }

  _open() {
    const SP = this.deps.SerialPort || loadSerialPort();
    const c = this.cfg;
    return new Promise((resolve) => {
      const port = new SP({
        path: c.path,
        baudRate: Number(c.baudRate) || 9600,
        dataBits: Number(c.dataBits) || 8,
        parity: c.parity || 'none',
        stopBits: Number(c.stopBits) || 1,
        rtscts: !!c.rtscts,
        xon: !!c.xon,
        xoff: !!c.xon,
        autoOpen: false,
      });
      this.port = port;
      port.on('data', (buf) => this.emit('data', buf, this.sessionId));
      port.on('error', (e) => this.emit('error', e));
      port.on('close', () => {
        if (this.sessionId) this.emit('session-end', this.sessionId);
        this.sessionId = null;
        this.emit('status', 'disconnected');
        this._schedule();
      });
      port.open((err) => {
        if (err) {
          this.emit('error', err);
          this.emit('status', 'error');
          this._schedule();
          resolve();
          return;
        }
        this.sessionId = `serial-${Date.now()}`;
        this.emit('session-start', this.sessionId, { remote: c.path });
        this.emit('status', 'connected');
        resolve();
      });
    });
  }

  _schedule() {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { if (!this.stopped) this._open().catch((e) => this.emit('error', e)); }, this.reconnectMs);
    if (this.timer.unref) this.timer.unref();
  }

  write(bytes) { if (this.port && this.port.isOpen) this.port.write(bytes); }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    return new Promise((resolve) => {
      if (!this.port || !this.port.isOpen) { resolve(); return; }
      this.port.close(() => resolve());
    });
  }
}

module.exports = { SerialTransport, listSerialPorts, loadSerialPort };
