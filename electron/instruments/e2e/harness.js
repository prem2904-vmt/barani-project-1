'use strict';
/**
 * End-to-end harness pieces shared by the local e2e test (fake API) and
 * the real-backend run (run-sim-e2e.js, driven by the prefrontal-mw
 * integration test InstrumentSimE2ETests).
 *
 *   openVirtualSerialPair()  socat pty pair, else sim/pty-pair.py, else null
 *   runScenario(...)         connector core + one simulator dialect over one
 *                            transport, until the upload queue is empty
 */
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { Connector } = require('../core/connector');
const { runSim } = require('../sim/cbc-sim');

function which(bin) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim().split('\n')[0] : null;
}

function serialPortAvailable() {
  try { require.resolve('serialport'); return true; } catch { return false; }
}

/**
 * A virtual null-modem cable. Prefers socat (the documented tool); falls back
 * to the bundled python relay. Resolves { a, b, via, close() } or
 * { skipped: reason }.
 */
async function openVirtualSerialPair() {
  if (!serialPortAvailable()) return { skipped: 'serialport module not installed' };
  const socat = which('socat');
  if (socat) {
    const p = spawn(socat, ['-d', '-d', 'pty,raw,echo=0', 'pty,raw,echo=0'], { stdio: ['ignore', 'ignore', 'pipe'] });
    const paths = await new Promise((resolve) => {
      const found = [];
      let buf = '';
      const t = setTimeout(() => resolve(null), 5000);
      p.stderr.on('data', (d) => {
        buf += d.toString();
        for (const m of buf.matchAll(/PTY is (\S+)/g)) if (!found.includes(m[1])) found.push(m[1]);
        if (found.length >= 2) { clearTimeout(t); resolve(found); }
      });
    });
    if (paths) return { a: paths[0], b: paths[1], via: 'socat', close: () => p.kill() };
    p.kill();
  }
  const py = which('python3');
  if (!py || process.platform === 'win32') return { skipped: 'neither socat nor python3 available' };
  const p = spawn(py, [path.join(__dirname, '..', 'sim', 'pty-pair.py')], { stdio: ['ignore', 'pipe', 'inherit'] });
  const line = await new Promise((resolve) => {
    let buf = '';
    const t = setTimeout(() => resolve(null), 5000);
    p.stdout.on('data', (d) => { buf += d.toString(); const i = buf.indexOf('\n'); if (i >= 0) { clearTimeout(t); resolve(buf.slice(0, i)); } });
  });
  if (!line) { p.kill(); return { skipped: 'pty relay did not start' }; }
  const { a, b } = JSON.parse(line);
  return { a, b, via: 'python pty relay (socat not installed)', close: () => p.kill() };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

const DIALECT_LINK = { 'astm-5part': 'astm-e1381', 'hl7-5part': 'mllp', 'text-3part': 'raw' };

/**
 * Run one connector ⇄ simulator pairing to completion.
 * @param {object} o
 * @param {string} o.apiUrl, o.instrumentId, o.deviceKey
 * @param {'astm-5part'|'hl7-5part'|'text-3part'} o.dialect
 * @param {'tcp-server'|'tcp-client'|'serial'} o.connectorTransport  the CONNECTOR's side
 * @param {string[]} o.samples   [primary, badChecksumSample?, ...burst]
 * @param {string} [o.unknownId]
 * @param {string} [o.scenario]  default 'all'
 * @param {object} [o.serialPair] from openVirtualSerialPair()
 * @param {Function} [o.fetchImpl]
 */
async function runScenario(o) {
  const dataDir = o.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'pf-inst-e2e-'));
  const uploaded = [];
  const events = [];
  let override;
  let simOpts;
  if (o.connectorTransport === 'tcp-server') {
    override = { type: 'tcp-server', host: '127.0.0.1', port: 0 };
  } else if (o.connectorTransport === 'tcp-client') {
    const port = await freePort();
    override = { type: 'tcp-client', host: '127.0.0.1', port, reconnectMs: 200 };
    simOpts = { transport: 'tcp-server', port };
  } else if (o.connectorTransport === 'serial') {
    if (!o.serialPair || o.serialPair.skipped) return { skipped: (o.serialPair && o.serialPair.skipped) || 'no serial pair' };
    override = { type: 'serial', path: o.serialPair.a, baudRate: 9600, reconnectMs: 500 };
    simOpts = { transport: 'serial', serialPath: o.serialPair.b, baud: 9600 };
  } else {
    throw new Error(`unsupported connector transport ${o.connectorTransport}`);
  }

  const connector = new Connector({
    instrumentId: o.instrumentId,
    apiUrl: o.apiUrl,
    deviceKey: o.deviceKey,
    dataDir,
    fetchImpl: o.fetchImpl,
    transportOverride: override,
    heartbeatMs: 1000,
    queueOpts: { baseDelayMs: 100, maxDelayMs: 1000 },
  });
  connector.on('uploaded', (u) => uploaded.push({ sampleId: u.sampleId, ...u.result }));
  connector.on('status', (s) => events.push(s.state));

  let sim;
  try {
    if (o.connectorTransport === 'tcp-client') {
      // The simulated analyzer listens first; the connector dials in.
      const simP = runSim({ dialect: o.dialect, samples: o.samples, scenario: o.scenario || 'all', unknownId: o.unknownId || '999999999', delay: 150, quiet: !o.verbose, ...simOpts });
      await new Promise((r) => setTimeout(r, 150));
      await connector.start();
      sim = await simP;
    } else {
      await connector.start();
      if (o.connectorTransport === 'tcp-server') simOpts = { transport: 'tcp-client', host: '127.0.0.1', port: connector.transport.port };
      sim = await runSim({ dialect: o.dialect, samples: o.samples, scenario: o.scenario || 'all', unknownId: o.unknownId || '999999999', delay: 150, quiet: !o.verbose, ...simOpts });
    }
    // Every message the analyzer delivered must reach the server.
    const want = sim.sent.filter((s) => s.ok).length;
    const deadline = Date.now() + (o.timeoutMs || 30000);
    while (Date.now() < deadline) {
      if (connector.queue.length === 0 && uploaded.length >= want) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const rawNaks = connector.rawlog.recent(500).filter((e) => e.dir === 'note' && /NAK/.test(e.text)).length;
    return {
      dialect: o.dialect,
      link: DIALECT_LINK[o.dialect],
      connectorTransport: o.connectorTransport,
      via: o.serialPair && o.connectorTransport === 'serial' ? o.serialPair.via : undefined,
      sent: sim.sent.map((s) => ({ kind: s.kind, sampleId: s.sampleId, run: s.run, qc: s.qc, ok: s.ok, naks: s.naks || 0, retransmits: s.retransmits || 0, ack: s.ack, results: s.results })),
      uploaded,
      queueLeft: connector.queue.length,
      nakNotes: rawNaks,
      status: connector.status(),
    };
  } finally {
    await connector.stop();
  }
}

module.exports = { runScenario, openVirtualSerialPair, freePort, which };
