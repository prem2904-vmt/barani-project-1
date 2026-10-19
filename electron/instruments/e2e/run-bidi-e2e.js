#!/usr/bin/env node
'use strict';
/**
 * Two-way (bidirectional) real-backend driver: ONE connector (core) against a
 * live LMS API + one simulated analyzer over a real TCP socket. Driven by the
 * prefrontal-mw integration test InstrumentBidiSimE2ETests, which seeds the
 * instruments / orders, calls this once per phase and asserts the database.
 *
 *   node electron/instruments/e2e/run-bidi-e2e.js --case case.json [--out report.json]
 *
 * case.json
 *   { apiUrl, instrumentId, key, dataDir,
 *     kind:   "astm" | "hl7-q02" | "hl7-q11",            analyzer protocol / query shape
 *     action: "query" | "worklist",
 *     // query
 *     queries: ["<barcode>", ...],                       asked in order on ONE connection
 *     sendResults: true,                                 then the analyzer reports GLU/... for every answered sample
 *                                                        (only the codes it was told), on a second connection
 *     simTimeoutMs: 4000,                                how long the analyzer waits for an answer
 *     // worklist
 *     waitMs: 3000, settleMs: 2500, expectItems: 1,      wait until N downloads, then keep listening settleMs
 *     pollMs: 400,                                       connector poll cadence (test knob; the server clamps the setting to >= 15 s)
 *   }
 *
 * Report: { queries:[{sampleId, tests, priority, patient, noInfo, answered, text}], worklist:[...],
 *           fetchCalls:[url...], rawOut:"<latin1 of every byte the connector wrote>", status, uploaded, queueLeft, notes }
 */
const fs = require('fs');
const net = require('net');
const { Connector } = require('../core/connector');
const { QuerySim } = require('../sim/query-sim');
const { sendOne, openIo } = require('../sim/cbc-sim');

function arg(n) { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const c = JSON.parse(fs.readFileSync(arg('case'), 'utf8'));
  const astm = c.kind === 'astm';
  const fetchCalls = [];
  const fetchImpl = (url, opts) => { fetchCalls.push(String(url).replace(/^https?:\/\/[^/]+/, '')); return globalThis.fetch(url, opts); };
  const uploaded = [];
  const out = [];
  const connector = new Connector({
    instrumentId: c.instrumentId, apiUrl: c.apiUrl, deviceKey: c.key, dataDir: c.dataDir, fetchImpl,
    transportOverride: { type: 'tcp-server', host: '127.0.0.1', port: 0 },
    heartbeatMs: 60000, queueOpts: { baseDelayMs: 100, maxDelayMs: 1000 },
    bidiOpts: { firstPollMs: 300, pollMs: c.pollMs || 60000, holdMs: 40, retryBaseMs: 200, ackTimeoutMs: 3000, ...(c.bidiOpts || {}) },
  });
  connector.on('uploaded', (u) => uploaded.push({ sampleId: u.sampleId, ...u.result }));
  connector.on('raw', (e) => { if (e.dir === 'out') out.push(Buffer.from(e.bytes).toString('latin1')); });
  await connector.start();
  const port = connector.transport.port;

  const report = { kind: c.kind, action: c.action, queries: [], worklist: [], fetchCalls, uploaded };
  let io;
  try {
    io = await openIo({ transport: 'tcp-client', host: '127.0.0.1', port, quiet: true });
    const sim = new QuerySim(io, { kind: astm ? 'astm' : 'hl7', timeoutMs: c.simTimeoutMs || 4000 });
    for (let i = 0; i < 100 && !connector.links.size; i++) await wait(20);

    if (c.action === 'query') {
      for (const id of c.queries || []) {
        const r = astm ? await sim.queryAstm(id) : c.kind === 'hl7-q11' ? await sim.queryQ11(id) : await sim.queryQ02(id);
        const orders = r.orders || (r.order ? [r.order] : []);
        report.queries.push({
          sampleId: id, answered: r.text != null, noInfo: astm ? r.noInfo === true : !r.found,
          tests: orders.flatMap((o) => o.tests), priority: orders[0] && orders[0].priority,
          patient: orders[0] ? (orders[0].patient || (orders[0].name ? { id: orders[0].patientId, name: orders[0].name } : null)) : null, text: r.text,
        });
      }
      if (c.sendResults) {
        const dialect = astm ? 'astm-chem' : 'hl7-chem';
        for (const q of report.queries.filter((x) => x.tests.length)) {
          const rio = await openIo({ transport: 'tcp-client', host: '127.0.0.1', port, quiet: true });
          try {
            const sent = await sendOne(rio, dialect, { kind: 'normal', sampleId: q.sampleId, run: 1, tests: q.tests }, {});
            (report.sent = report.sent || []).push({ sampleId: q.sampleId, ok: sent.ok, codes: sent.results.map((r) => r.code) });
          } finally { await wait(150); await rio.close(); }
        }
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline && (connector.queue.length > 0 || uploaded.length < (report.sent || []).length)) await wait(100);
      }
    } else {
      const until = Date.now() + (c.waitMs || 4000);
      while (sim.worklist.length < (c.expectItems || 1) && Date.now() < until) await wait(50);
      await wait(c.settleMs || 2000);          // more polls happen here: nothing may be re-sent
      report.worklist = sim.worklist.map((o) => ({ ...o }));
      report.received = sim.received.length;
    }
  } finally {
    if (io) await io.close().catch(() => {});
    report.rawOut = out.join('');
    report.status = connector.status();
    report.queueLeft = connector.queue.length;
    report.notes = connector.rawlog.recent(500).filter((e) => e.dir === 'note').map((e) => e.text);
    await connector.stop();
  }
  const text = JSON.stringify(report, null, 2);
  if (arg('out')) fs.writeFileSync(arg('out'), text); else process.stdout.write(text + '\n');
  process.exit(0);
}

main().catch((e) => { process.stderr.write(`${e.stack || e.message}\n`); process.exit(1); });
