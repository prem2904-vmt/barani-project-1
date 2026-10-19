'use strict';
/** Shared rig for the two-way socket tests (not a test file itself). */
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { fakeApi } = require('../e2e/fake-api');
const { freePort } = require('../e2e/harness');
const { Connector } = require('../core/connector');
const { QuerySim } = require('../sim/query-sim');

const ID = '11111111-2222-3333-4444-555555555555';
const KEY = 'pfi_test_key';
const NASTY = 'Ann Q|Rs^t&u\\v~w';
const dto = (id, codes = ['GLU', 'UREA', 'CREA', 'CHOL'], over = {}) => ({
  sampleId: id, found: true, priority: 'normal', collectedAt: '2026-10-14T05:10:00Z', specimen: 'Serum', patient: null,
  tests: codes.map((c) => ({ code: c, testCatalogKey: `K-${c}`, name: c })), unmapped: [], ...over,
});
const KINDS = {
  astm: { link: 'astm-e1381', simKind: 'astm', ask: (s, id) => s.queryAstm(id) },
  'hl7-q02': { link: 'mllp', simKind: 'hl7', ask: (s, id) => s.queryQ02(id) },
  'hl7-q11': { link: 'mllp', simKind: 'hl7', ask: (s, id) => s.queryQ11(id) },
};
const ordersOf = (r) => r.orders || (r.order ? [r.order] : []);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const FAST = { holdMs: 20, retryBaseMs: 40, ackTimeoutMs: 400, queryTimeoutMs: 400, busyRetryMs: 60, failBackoffMs: 0, pollMs: 60000, firstPollMs: 600000 };

function ioOf(sock) {
  const ls = [];
  sock.on('data', (b) => ls.forEach((f) => f(b)));
  sock.on('error', () => {});
  return { write: (b) => sock.write(b), onData: (f) => ls.push(f), close: () => new Promise((r) => { sock.end(); sock.once('close', r); setTimeout(r, 200); }), sock };
}

/**
 * @param {{kind:'astm'|'hl7-q02'|'hl7-q11', transport:'tcp-server'|'tcp-client', bidi?:object, apiOpts?:object, parser?:object, dataDir?:string, bidiOpts?:object, simOpts?:object, noSim?:boolean}} o
 */
async function rig(o) {
  const k = KINDS[o.kind];
  const api = await fakeApi({
    instruments: { [ID]: { key: KEY, name: 'Sim chem', config: { transport: { type: 'tcp-server', port: 0 }, link: { type: k.link }, parser: o.parser || { type: 'auto' }, ...(o.bidi ? { bidirectional: o.bidi } : {}) }, codeMaps: [] } },
    ...(o.apiOpts || {}),
  });
  const dataDir = o.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'pf-bidi-e2e-'));
  let override; let simServer; let simSock;
  if (o.transport === 'tcp-client') {
    const port = await freePort();
    override = { type: 'tcp-client', host: '127.0.0.1', port, reconnectMs: 100 };
    simServer = net.createServer();
    await new Promise((r) => simServer.listen(port, '127.0.0.1', r));
    var accepted = new Promise((r) => simServer.once('connection', r));
  } else override = { type: 'tcp-server', host: '127.0.0.1', port: 0 };
  const connector = new Connector({ instrumentId: ID, apiUrl: api.url, deviceKey: KEY, dataDir, transportOverride: override, heartbeatMs: 60000, queueOpts: { baseDelayMs: 50, maxDelayMs: 500 }, bidiOpts: { ...FAST, ...(o.bidiOpts || {}) } });
  await connector.start();
  if (o.transport === 'tcp-client') simSock = await accepted;
  else simSock = await new Promise((res, rej) => { const s = net.createConnection({ host: '127.0.0.1', port: connector.transport.port }, () => res(s)); s.once('error', rej); });
  const io = ioOf(simSock);
  const sim = o.noSim ? null : new QuerySim(io, { kind: k.simKind, timeoutMs: 3000, ...(o.simOpts || {}) });
  // wait until the connector registered the session
  for (let i = 0; i < 100 && !connector.links.size; i++) await wait(10);
  const out = [];
  connector.on('raw', (e) => { if (e.dir === 'out') out.push(Buffer.from(e.bytes)); });
  const notes = () => connector.rawlog.recent(500).filter((e) => e.dir === 'note').map((e) => e.text);
  return {
    api, connector, sim, io, out, notes, dataDir,
    async close() { await io.close(); await connector.stop(); if (simServer) await new Promise((r) => simServer.close(r)); await api.close(); },
  };
}


module.exports = { ID, KEY, NASTY, dto, KINDS, ordersOf, wait, FAST, ioOf, rig };
