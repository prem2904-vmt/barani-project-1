#!/usr/bin/env node
'use strict';
/**
 * CBC analyzer simulator.
 *
 *   node electron/instruments/sim/cbc-sim.js --dialect astm-5part --transport tcp-client --port 5001 --sample 260100023
 *
 * Options
 *   --dialect     astm-5part | hl7-5part | text-3part         (default astm-5part)
 *   --transport   tcp-client  (sim connects to the connector's TCP server)
 *                 tcp-server  (sim listens; the connector connects to it)
 *                 serial      (sim writes to --serial-path)   (default tcp-client)
 *   --host        host for tcp-client                          (default 127.0.0.1)
 *   --port        TCP port                                     (default 5001)
 *   --serial-path serial device (e.g. /dev/ttys004), --baud (default 9600)
 *   --sample      sample barcode(s), comma separated / repeatable (default 260100001)
 *   --count       burst: N samples (IDs continue from the last --sample)
 *   --scenario    normal | rerun | qc | unknown | badchecksum | burst | all   (default normal)
 *   --unknown-id  barcode used by the unknown scenario         (default 999999999)
 *   --delay       ms between messages                          (default 300)
 *   --json        print a JSON summary of everything sent
 *
 * Exit code 0 when every message was accepted at the link layer (ASTM:
 * all frames ACKed; HL7: MSA|AA received; text: written).
 */
const net = require('net');
const { AstmSender } = require('../core/link/astm-e1381');
const { MllpReceiver, frame: mllpFrame } = require('../core/link/mllp');
const { DIALECTS } = require('./dialects');

function parseArgs(argv) {
  const o = { dialect: 'astm-5part', transport: 'tcp-client', host: '127.0.0.1', port: 5001, samples: [], scenario: 'normal', delay: 300, baud: 9600, unknownId: '999999999' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => argv[++i];
    switch (a) {
      case '--dialect': o.dialect = v(); break;
      case '--transport': o.transport = v(); break;
      case '--host': o.host = v(); break;
      case '--port': o.port = Number(v()); break;
      case '--serial-path': o.serialPath = v(); break;
      case '--baud': o.baud = Number(v()); break;
      case '--sample': o.samples.push(...String(v()).split(',').map((s) => s.trim()).filter(Boolean)); break;
      case '--count': o.count = Number(v()); break;
      case '--scenario': o.scenario = v(); break;
      case '--unknown-id': o.unknownId = v(); break;
      case '--delay': o.delay = Number(v()); break;
      case '--json': o.json = true; break;
      case '--quiet': o.quiet = true; break;
      case '-h': case '--help': o.help = true; break;
      default: throw new Error(`unknown option ${a}`);
    }
  }
  if (!o.samples.length) o.samples = ['260100001'];
  return o;
}

function nextId(id, n) {
  const m = /^(.*?)(\d+)$/.exec(id);
  if (!m) return `${id}-${n}`;
  return m[1] + String(Number(m[2]) + n).padStart(m[2].length, '0');
}

/** The ordered list of jobs a scenario sends. */
function plan(o) {
  const s0 = o.samples[0];
  const jobs = [];
  const add = (j) => jobs.push({ run: 1, ...j });
  const scen = o.scenario === 'all' ? ['normal', 'rerun', 'qc', 'unknown', 'badchecksum', 'burst'] : [o.scenario];
  for (const sc of scen) {
    // 'all' uses samples[0] for the normal run, samples[1] for the bad-checksum
    // run and samples[2…] for the burst; a lone 'normal' sends every sample.
    if (sc === 'normal') (o.scenario === 'all' ? [s0] : o.samples).forEach((s) => add({ kind: 'normal', sampleId: s }));
    if (sc === 'rerun') add({ kind: 'rerun', sampleId: s0, run: 2 });
    if (sc === 'qc') add({ kind: 'qc', sampleId: 'QC-L1-24117', qc: true });
    if (sc === 'unknown') add({ kind: 'unknown', sampleId: o.unknownId });
    if (sc === 'badchecksum') add({ kind: 'badchecksum', sampleId: o.samples[1] || s0, run: o.samples[1] ? 1 : 3, corrupt: true });
    if (sc === 'burst') {
      const n = o.count || 5;
      const base = o.samples[o.samples.length - 1];
      const ids = o.samples.length > 2 ? o.samples.slice(2) : Array.from({ length: n }, (_x, i) => nextId(base, i + 1));
      ids.forEach((s) => add({ kind: 'burst', sampleId: s }));
    }
  }
  if (o.scenario === 'normal' && o.count > 1) {
    for (let i = 1; i < o.count; i++) add({ kind: 'burst', sampleId: nextId(s0, i) });
  }
  return jobs;
}

/** Open the sim-side byte pipe: { write, onData(cb), close, ready } */
async function openIo(o) {
  const listeners = [];
  const emit = (b) => listeners.forEach((f) => f(b));
  if (o.transport === 'tcp-client') {
    const sock = await new Promise((resolve, reject) => {
      const s = net.createConnection({ host: o.host, port: o.port }, () => resolve(s));
      s.once('error', reject);
    });
    sock.on('data', emit);
    return { write: (b) => sock.write(b), onData: (f) => listeners.push(f), close: () => new Promise((r) => sock.end(r)), describe: `tcp-client → ${o.host}:${o.port}` };
  }
  if (o.transport === 'tcp-server') {
    const server = net.createServer();
    await new Promise((r, j) => { server.once('error', j); server.listen(o.port, '127.0.0.1', r); });
    if (!o.quiet) process.stderr.write(`sim: listening on 127.0.0.1:${server.address().port}, waiting for the connector…\n`);
    const sock = await new Promise((resolve) => server.once('connection', resolve));
    sock.on('data', emit);
    return {
      write: (b) => sock.write(b),
      onData: (f) => listeners.push(f),
      close: () => new Promise((r) => { sock.end(); server.close(() => r()); }),
      describe: `tcp-server :${server.address().port}`,
    };
  }
  if (o.transport === 'serial') {
    // eslint-disable-next-line global-require
    const { SerialPort } = require('serialport');
    const port = new SerialPort({ path: o.serialPath, baudRate: o.baud || 9600, autoOpen: false });
    await new Promise((r, j) => port.open((e) => (e ? j(e) : r())));
    port.on('data', emit);
    return { write: (b) => port.write(b), onData: (f) => listeners.push(f), close: () => new Promise((r) => port.drain(() => port.close(() => r()))), describe: `serial ${o.serialPath}` };
  }
  throw new Error(`unknown transport ${o.transport}`);
}

async function sendOne(io, dialectName, job, o) {
  const d = DIALECTS[dialectName];
  const built = d.build({ ...job });
  const out = { kind: job.kind, sampleId: job.sampleId, run: job.run, qc: !!job.qc, results: built.results, ok: false };
  if (dialectName === 'astm-5part') {
    const sender = new AstmSender({
      write: io.write,
      ackTimeoutMs: o.ackTimeoutMs || 5000,
      busyRetryMs: 500,
      // Corrupt the 2nd frame's checksum on the first attempt → expect NAK + retransmit.
      corrupt: job.corrupt ? (i, attempt) => i === 1 && attempt === 1 : undefined,
    });
    io.onData((b) => sender.feed(b));
    const st = await sender.send(built.text);
    Object.assign(out, { ok: true, frames: st.frames, naks: st.naks, retransmits: st.retransmits });
  } else if (dialectName === 'hl7-5part') {
    const ack = await new Promise((resolve) => {
      const rx = new MllpReceiver({});
      const t = setTimeout(() => resolve(null), o.ackTimeoutMs || 5000);
      rx.on('message', (m) => { clearTimeout(t); resolve(m); });
      io.onData((b) => rx.feed(b));
      io.write(mllpFrame(built.text));
    });
    out.ack = ack ? (/MSA\|(\w+)/.exec(ack) || [])[1] || null : null;
    out.ok = out.ack === 'AA';
  } else {
    io.write(Buffer.from(built.text, 'latin1'));
    out.ok = true;
  }
  if (job.corrupt && dialectName !== 'astm-5part') out.note = 'bad-checksum injection applies to ASTM only';
  return out;
}

async function runSim(o) {
  if (!DIALECTS[o.dialect]) throw new Error(`unknown dialect ${o.dialect} (astm-5part | hl7-5part | text-3part)`);
  const jobs = plan(o);
  const sent = [];
  // One connection per job so each message gets a fresh listener set; this
  // is also how many analyzers behave (connect, send, disconnect) — except
  // serial / tcp-server, which keep one line open.
  const persistent = o.transport !== 'tcp-client';
  let io = persistent ? await openIo(o) : null;
  try {
    for (const job of jobs) {
      const conn = persistent ? io : await openIo(o);
      const r = await sendOne(conn, o.dialect, job, o);
      sent.push(r);
      if (!o.quiet) {
        process.stderr.write(`sim: ${o.dialect} ${r.kind.padEnd(11)} sample ${r.sampleId} → ${r.ok ? 'accepted' : 'NOT accepted'}`
          + `${r.naks ? ` (NAK ×${r.naks}, retransmitted ×${r.retransmits})` : ''}${r.ack ? ` ACK=${r.ack}` : ''}\n`);
      }
      if (!persistent) await conn.close();
      if (o.delay) await new Promise((res) => setTimeout(res, o.delay));
    }
  } finally {
    if (persistent && io) { await new Promise((r) => setTimeout(r, 200)); await io.close(); io = null; }
  }
  return { dialect: o.dialect, transport: o.transport, sent, ok: sent.every((s) => s.ok) };
}

module.exports = { runSim, plan, parseArgs, nextId };

if (require.main === module) {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.message}\n`); process.exit(2); }
  if (o.help) { process.stdout.write(require('fs').readFileSync(__filename, 'utf8').split('*/')[0]); process.exit(0); }
  runSim(o).then((r) => {
    if (o.json) process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    process.exit(r.ok ? 0 : 1);
  }).catch((e) => { process.stderr.write(`sim failed: ${e.message}\n`); process.exit(1); });
}
