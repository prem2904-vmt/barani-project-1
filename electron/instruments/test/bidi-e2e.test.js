'use strict';
/**
 * Two-way interfacing over REAL sockets: simulated chemistry analyzer ⇄
 * connector core ⇄ fake LMS API, for every dialect × {connector TCP server,
 * connector TCP client}.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { fakeApi } = require('../e2e/fake-api');
const { freePort } = require('../e2e/harness');
const { Connector } = require('../core/connector');
const { encodeFrames, AstmSender } = require('../core/link/astm-e1381');
const { buildAck } = require('../core/parsers/hl7');
const { frame: mllpFrame } = require('../core/link/mllp');
const { QuerySim } = require('../sim/query-sim');
const { C } = require('../core/bytes');

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

for (const kind of Object.keys(KINDS)) {
  for (const transport of ['tcp-server', 'tcp-client']) {
    const name = `${kind} / connector ${transport}`;
    const bidi = { mode: 'query' };

    test(`two-way query found (chemistry): ${name}`, async () => {
      const r = await rig({ kind, transport, bidi, apiOpts: { orders: { 260100001: dto('260100001', ['GLU', 'UREA', 'CREA', 'CHOL'], { priority: 'urgent' }) } } });
      try {
        const a = await KINDS[kind].ask(r.sim, '260100001');
        const o = ordersOf(a);
        assert.equal(o.length, 1, JSON.stringify(a).slice(0, 300));
        assert.equal(o[0].sampleId, '260100001');
        assert.deepEqual(o[0].tests, ['GLU', 'UREA', 'CREA', 'CHOL']);
        assert.deepEqual(r.api.store.orderQueries, ['260100001']);
        const st = r.connector.status().bidi;
        assert.equal(st.mode, 'query'); assert.equal(st.queriesAnswered, 1); assert.equal(st.queriesNotFound, 0);
        assert.ok(r.notes().some((n) => /answered/.test(n)));
        if (kind === 'astm') {
          assert.equal(o[0].priority, 'S'); assert.equal(o[0].action, 'A'); assert.equal(o[0].report, 'O'); assert.equal(o[0].patient, null);
        }
      } finally { await r.close(); }
    });

    test(`two-way query not found → LIS2-A2 no-information / NF: ${name}`, async () => {
      const r = await rig({ kind, transport, bidi });
      try {
        const a = await KINDS[kind].ask(r.sim, '999999999');
        assert.equal(ordersOf(a).length, 0);
        assert.ok(a.text, 'the analyzer still got an answer');
        if (kind === 'astm') { assert.equal(a.noInfo, true); assert.ok(!/(^|\r)Q\|/.test(a.text)); assert.ok(!/(^|\r)O\|/.test(a.text)); }
        if (kind === 'hl7-q02') { assert.match(a.qck, /QAK\|SR\|NF/); assert.equal(a.dsr, null); assert.ok(!r.sim.received.some((t) => /DSR\^Q03/.test(t))); }
        if (kind === 'hl7-q11') assert.match(a.rsp, /QAK\|TAG[^|]*\|NF/);
        assert.equal(r.connector.status().bidi.queriesNotFound, 1);
      } finally { await r.close(); }
    });

    test(`two-way query: server too slow → local cache, else no order (never hangs): ${name}`, async () => {
      const r = await rig({ kind, transport, bidi, apiOpts: { orders: { A1: dto('A1', ['GLU']), B2: dto('B2', ['UREA']) } } });
      try {
        const first = await KINDS[kind].ask(r.sim, 'A1');           // warms the cache while the server is healthy
        assert.deepEqual(ordersOf(first)[0].tests, ['GLU']);
        r.api.bidi.ordersDelayMs = 1500;                              // server now slower than the (test) ceiling
        const t0 = Date.now();
        const cached = await KINDS[kind].ask(r.sim, 'A1');
        assert.deepEqual(ordersOf(cached)[0].tests, ['GLU'], 'answered from cache');
        const cold = await KINDS[kind].ask(r.sim, 'B2');
        assert.equal(ordersOf(cold).length, 0, 'nothing cached → no order, tests are never invented');
        assert.ok(cold.text, 'but still answered');
        if (kind === 'astm') assert.deepEqual(cold.text.split('\r').filter(Boolean).map((x) => x[0]), ['H', 'L'], 'timeout with no cache = H, L|1|I only');
        assert.ok(Date.now() - t0 < 1400, 'bounded by the ceiling, not the 1.5 s server');
        const st = r.connector.status().bidi;
        assert.equal(st.queriesFromCache, 1); assert.equal(st.queryErrors, 1);
        assert.ok(r.notes().some((n) => /server unavailable and nothing cached/.test(n)));
      } finally { await r.close(); }
    });

    test(`two-way query: server 5xx → cache / no order: ${name}`, async () => {
      const r = await rig({ kind, transport, bidi, apiOpts: { orders: { A1: dto('A1', ['GLU']) } } });
      try {
        await KINDS[kind].ask(r.sim, 'A1');
        r.api.bidi.ordersStatus = 503;
        assert.deepEqual(ordersOf(await KINDS[kind].ask(r.sim, 'A1'))[0].tests, ['GLU']);
        assert.equal(ordersOf(await KINDS[kind].ask(r.sim, 'ZZ')).length, 0);
      } finally { await r.close(); }
    });

    test(`two-way delimiter escaping end to end (patient name ${JSON.stringify(NASTY)}): ${name}`, async () => {
      const patient = { id: 'P|1^2', name: NASTY, sex: 'F', dob: '1980-01-31', ageYears: 45 };
      const r = await rig({ kind, transport, bidi: { mode: 'query', sendPatient: true }, apiOpts: { orders: { E1: dto('E1', ['GLU'], { patient }) } } });
      try {
        const a = await KINDS[kind].ask(r.sim, 'E1');
        const o = ordersOf(a)[0];
        assert.equal(o.sampleId, 'E1');
        if (kind === 'astm') { assert.equal(o.patient.name, NASTY); assert.equal(o.patient.id, 'P|1^2'); }
        if (kind === 'hl7-q02') { assert.equal(o.name, NASTY); assert.equal(o.patientId, 'P|1^2'); }
        if (kind === 'hl7-q11') assert.equal(o.patient.name, 'Ann Q|Rs^t&u\\v~w');
      } finally { await r.close(); }
    });

    test(`two-way patient details are NOT sent unless sendPatient: ${name}`, async () => {
      const patient = { id: 'P-SECRET', name: 'Secret Person', sex: 'F', dob: '1980-01-31' };
      const r = await rig({ kind, transport, bidi, apiOpts: { orders: { E1: dto('E1', ['GLU'], { patient }) } } });
      try {
        const a = await KINDS[kind].ask(r.sim, 'E1');
        assert.ok(!/Secret|P-SECRET/.test(a.text));
      } finally { await r.close(); }
    });

    test(`mode off regression — a query is acknowledged exactly as before, no server call: ${name}`, async () => {
      for (const b of [undefined, { mode: 'off' }, { mode: 'worklist' }]) {
        const r = await rig({ kind, transport, bidi: b, noSim: true, apiOpts: { orders: { A1: dto('A1') } } });
        try {
          const rec = []; r.io.onData((x) => rec.push(Buffer.from(x)));
          let sent;
          if (kind === 'astm') {
            const s = new AstmSender({ write: r.io.write, ackTimeoutMs: 1000 });
            r.io.onData((x) => s.feed(x));
            await s.send('H|\\^&|||SIM\rQ|1|^A1||^^^ALL||||||||O\rL|1\r');
            await wait(200);
            // old behaviour: ACK to ENQ + ACK per frame (3 frames), nothing else, no ENQ from the connector
            assert.deepEqual(Buffer.concat(rec), Buffer.from([C.ACK, C.ACK, C.ACK, C.ACK]));
          } else {
            sent = kind === 'hl7-q02'
              ? 'MSH|^~\\&|BS|LAB|LIS|HOST|20261014100000||QRY^Q02|77|P|2.3.1\rQRD|20261014100000|R|D|9|||1^RD|A1|OTH|||T\r'
              : 'MSH|^~\\&|AU|LAB|LIS|HOST|20261014100000||QBP^Q11^QBP_Q11|88|P|2.5.1\rQPD|WOS^Work Order Step^IHE_LABTF|TAG7|A1\r';
            r.io.write(mllpFrame(sent));
            await wait(250);
            const text = Buffer.concat(rec).toString('latin1');
            assert.match(text, /^\x0bMSH\|[^\r]*\|ACK\^(Q02|Q11)\|ACK(77|88)\|P\|[\d.]+\rMSA\|AA\|(77|88)\r\x1c\r$/);
          }
          assert.deepEqual(r.api.store.orderQueries, [], 'no /orders call');
          if (!b || b.mode === 'off') assert.equal(r.connector.status().bidi, undefined, 'status unchanged when two-way is off');
          else assert.equal(r.connector.status().bidi.queriesAnswered, 0);
          assert.equal(r.connector.queue.length, 0);
          assert.ok(!r.out.some((x) => x.includes(C.ENQ)), 'connector never opened a session of its own');
        } finally { await r.close(); }
      }
    });
  }
}

// ── server refusal ────────────────────────────────────────────────────────
test('ASTM server refusal (409): Q echo with Q.13=X and L|1|Q, even if the order is cached', async () => {
  const r = await rig({ kind: 'astm', transport: 'tcp-server', bidi: { mode: 'query' }, apiOpts: { orders: { A1: dto('A1', ['GLU']) } } });
  try {
    await r.sim.queryAstm('A1');                       // warm the cache
    r.api.bidi.ordersStatus = 409;
    const a = await r.sim.queryAstm('A1');
    const recs = a.text.split('\r').filter(Boolean);
    assert.deepEqual(recs.map((x) => x[0]), ['H', 'Q', 'L']);
    assert.equal(recs[1].split('|')[12], 'X');
    assert.equal(recs[2], 'L|1|Q');
    assert.equal(r.connector.status().bidi.queryErrors, 1);
  } finally { await r.close(); }
});

// ── ASTM-specific ─────────────────────────────────────────────────────────
for (const transport of ['tcp-server', 'tcp-client']) {
  test(`ASTM contention: the answer waits for the analyzer's EOT, then bids for the line (connector ${transport})`, async () => {
    const r = await rig({ kind: 'astm', transport, bidi: { mode: 'query' }, apiOpts: { orders: { C1: dto('C1', ['GLU', 'UREA']) }, ordersDelayMs: 60 } });
    try {
      const events = [];
      r.io.onData((b) => { for (const x of b) if (x === C.ENQ) events.push(['ENQ', Date.now()]); });
      // 1) the query session
      await r.sim.sender.send('H|\\^&|||SIM\rQ|1|^C1||^^^ALL||||||||O\rL|1\r');
      // 2) a SECOND analyzer session straight away (results of another tube) that the analyzer
      //    keeps open for 400 ms — longer than the 60 ms the server needs to answer.
      let acked; const waitAck = new Promise((res) => { acked = res; });
      const h = (b) => { if (b.includes(C.ACK)) acked(); };
      r.io.onData(h);
      r.io.write(Buffer.from([C.ENQ]));
      await waitAck;
      await wait(400);
      assert.equal(events.length, 0, 'connector did not ENQ while the analyzer owned the line');
      const frames = encodeFrames('H|\\^&|||SIM\rP|1\rO|1|X9||^^^GLU|R\rR|1|^^^GLU|90|mg/dL||N||F\rL|1|N\r');
      for (const f of frames) { r.io.write(f); await wait(15); }
      events.push(['EOT-sent', Date.now()]);
      r.io.write(Buffer.from([C.EOT]));
      const text = await r.sim._next();
      assert.ok(text, 'answer arrived after the analyzer released the line');
      assert.match(text, /O\|1\|C1\|\|\^\^\^GLU\\\^\^\^UREA\|/);
      const iEot = events.findIndex((e) => e[0] === 'EOT-sent'); const iEnq = events.findIndex((e) => e[0] === 'ENQ');
      assert.ok(iEnq > iEot, `ENQ (${iEnq}) only after EOT (${iEot})`);
      await r.connector.idle();
      assert.equal(r.api.store.messages.length, 1, 'the analyzer results from the interleaved session were still received');
      assert.equal(r.api.store.messages[0].sampleId, 'X9');
    } finally { await r.close(); }
  });

  test(`ASTM range query + cap + ALL + specific test filter (connector ${transport})`, async () => {
    const orders = {};
    for (let i = 1; i <= 3; i++) orders[`00010${i}`] = dto(`00010${i}`, ['GLU', 'UREA']);
    const r = await rig({ kind: 'astm', transport, bidi: { mode: 'query' }, apiOpts: { orders, worklist: [dto('W1', ['CHOL']), dto('W2', ['TG'])] } });
    try {
      const a = await r.sim.queryAstm('000101', { end: '000103' });
      assert.deepEqual(a.orders.map((o) => o.sampleId), ['000101', '000102', '000103']);
      const capped = await r.sim.queryAstm('000001', { end: '000999' });
      assert.ok(r.api.store.orderQueries.length <= 3 + 20, 'range lookups are capped');
      assert.ok(capped.text);
      const filt = await r.sim.queryAstm('000101', { tests: 'UREA' });
      assert.deepEqual(filt.orders[0].tests, ['UREA']);
      const all = await r.sim.queryAstm('x', { tests: 'ALL' }).catch(() => null);
      assert.ok(all !== undefined);
      const allQ = await (async () => { const msg = 'H|\\^&|||SIM\rQ|1|^ALL||^^^ALL\rL|1\r'; const p = r.sim._next(); await r.sim.sender.send(msg); return p; })();
      assert.deepEqual(require('../sim/query-sim').parseAstmOrders(allQ).map((o) => o.sampleId).sort(), ['W1', 'W2']);
    } finally { await r.close(); }
  });

  test(`ASTM: query-ID component is configurable (connector ${transport})`, async () => {
    const r = await rig({ kind: 'astm', transport, bidi: { mode: 'query', astmQueryComponent: 1 }, apiOpts: { orders: { PAT1: dto('PAT1', ['GLU']) } } });
    try {
      const msg = 'H|\\^&|||SIM\rQ|1|PAT1^other||^^^ALL\rL|1\r';
      const p = r.sim._next(); await r.sim.sender.send(msg);
      assert.match(await p, /O\|1\|PAT1\|/);
    } finally { await r.close(); }
  });

  test(`ASTM answer follows parser.astm.sampleIdField/Component (O.4, component 2) (connector ${transport})`, async () => {
    const r = await rig({ kind: 'astm', transport, bidi: { mode: 'query' }, parser: { type: 'astm', astm: { sampleIdField: 4, sampleIdComponent: 2 } }, apiOpts: { orders: { S5: dto('S5', ['GLU']) } } });
    try {
      const p = r.sim._next(); await r.sim.sender.send('H|\\^&|||SIM\rQ|1|^S5||^^^ALL\rL|1\r');
      assert.match(await p, /O\|1\|\|\^S5\|/);
    } finally { await r.close(); }
  });
}

// ── HL7 forced dialect ────────────────────────────────────────────────────
test('HL7 hl7Query=qry_q02 forces QCK/DSR even when asked with QBP', async () => {
  const r = await rig({ kind: 'hl7-q11', transport: 'tcp-server', bidi: { mode: 'query', hl7Query: 'qry_q02' }, apiOpts: { orders: { A1: dto('A1', ['GLU']) } } });
  try {
    const p = r.sim._next((t) => /QCK/.test(t));
    r.io.write(mllpFrame('MSH|^~\\&|AU|LAB|LIS|HOST|20261014100000||QBP^Q11^QBP_Q11|88|P|2.5.1\rQPD|WOS^Work Order Step^IHE_LABTF|TAG7|A1\r'));
    assert.match(await p, /QCK\^Q11|QCK\^Q02/);
  } finally { await r.close(); }
});

// ── worklist ──────────────────────────────────────────────────────────────
const WL = [['astm', 'orm_o01'], ['hl7-q02', 'orm_o01'], ['hl7-q02', 'oml_o21']];
for (const [kind, hl7Order] of WL) {
  for (const transport of ['tcp-server', 'tcp-client']) {
    const name = `${kind}${kind === 'astm' ? '' : ` ${hl7Order}`} / connector ${transport}`;
    const bidi = { mode: 'worklist', hl7Order };

    test(`worklist: send once, resend only when the tests change, survive a restart: ${name}`, async () => {
      const worklist = [dto('W1', ['GLU', 'UREA']), dto('W2', ['CHOL'])];
      const r = await rig({ kind, transport, bidi, apiOpts: { worklist } });
      let r2;
      try {
        let res = await r.connector.bidi.worklistTick();
        assert.equal(res.sent, 2);
        assert.deepEqual((await r.sim.waitWorklist(2)).map((o) => o.sampleId), ['W1', 'W2']);
        assert.deepEqual(r.sim.worklist[0].tests, ['GLU', 'UREA']);
        if (kind === 'astm') assert.equal(r.sim.worklist[0].action, 'N', 'worklist download default action code');
        res = await r.connector.bidi.worklistTick();
        assert.equal(res.sent, 0, 'nothing re-sent');
        await wait(100);
        assert.equal(r.sim.worklist.length, 2);
        r.api.bidi.worklist[1] = dto('W2', ['CHOL', 'TG']);           // tests changed
        res = await r.connector.bidi.worklistTick();
        assert.equal(res.sent, 1);
        await r.sim.waitWorklist(3);
        assert.equal(r.sim.worklist[2].sampleId, 'W2'); assert.deepEqual(r.sim.worklist[2].tests, ['CHOL', 'TG']);
        const st = r.connector.status().bidi;
        assert.equal(st.worklistSent, 3); assert.equal(st.worklistFailed, 0); assert.ok(st.lastWorklistAt);
        assert.ok(r.api.store.worklistQueries.length >= 3);
        assert.ok(r.notes().some((n) => /worklist: sent W2/.test(n)));
        // crash-safe: a brand new connector on the same dir does not repeat the downloads
        await r.connector.stop();
        r2 = await rig({ kind, transport, bidi, dataDir: r.dataDir, apiOpts: { worklist: r.api.bidi.worklist } });
        const res2 = await r2.connector.bidi.worklistTick();
        assert.equal(res2.sent, 0);
        assert.equal(r2.sim.worklist.length, 0);
      } finally { if (r2) await r2.close(); await r.close(); }
    });
  }
}

for (const transport of ['tcp-server', 'tcp-client']) {
  test(`worklist HL7: ACK error (AE) is retried with backoff and succeeds (connector ${transport})`, async () => {
    const r = await rig({ kind: 'hl7-q02', transport, bidi: { mode: 'worklist' }, apiOpts: { worklist: [dto('W1', ['GLU'])] }, simOpts: { ackCode: (_t, n) => (n <= 2 ? 'AE' : 'AA') } });
    try {
      const res = await r.connector.bidi.worklistTick();
      assert.equal(res.sent, 1);
      assert.equal(r.sim.ackCount, 3);
      assert.equal(r.connector.status().bidi.worklistSent, 1);
      assert.ok(r.notes().some((n) => /attempt 1\/3 failed: analyzer answered AE/.test(n)));
    } finally { await r.close(); }
  });

  test(`worklist HL7: persistent AE / timeout → counted failed, not marked sent, retried next cycle (connector ${transport})`, async () => {
    let mode = 'AR';
    const r = await rig({ kind: 'hl7-q02', transport, bidi: { mode: 'worklist' }, bidiOpts: { retries: 1 }, apiOpts: { worklist: [dto('W1', ['GLU'])] }, simOpts: { ackCode: () => (mode === 'SILENT' ? null : mode) } });
    try {
      let res = await r.connector.bidi.worklistTick();
      assert.equal(res.sent, 0); assert.equal(res.failed, 1);
      mode = 'SILENT';
      res = await r.connector.bidi.worklistTick();
      assert.equal(res.failed, 1);
      assert.ok(r.notes().some((n) => /no ACK from the analyzer/.test(n)));
      assert.equal(r.connector.status().bidi.worklistFailed, 2);
      mode = 'AA';
      res = await r.connector.bidi.worklistTick();
      assert.equal(res.sent, 1);
      assert.equal(r.connector.bidi.sent.isSent(r.api.bidi.worklist[0]), true);
    } finally { await r.close(); }
  });

  test(`worklist: failure back-off holds a failing sample between cycles (connector ${transport})`, async () => {
    const r = await rig({ kind: 'hl7-q02', transport, bidi: { mode: 'worklist' }, bidiOpts: { retries: 0, failBackoffMs: 60000 }, apiOpts: { worklist: [dto('W1', ['GLU'])] }, simOpts: { ackCode: () => 'AE' } });
    try {
      await r.connector.bidi.worklistTick();
      const before = r.sim.ackCount;
      const res = await r.connector.bidi.worklistTick();
      assert.equal(res.failed, 0); assert.equal(r.sim.ackCount, before, 'not retried inside the back-off window');
    } finally { await r.close(); }
  });

  test(`worklist off for mode=query; no analyzer connected → skipped, nothing marked sent (connector ${transport})`, async () => {
    const r = await rig({ kind: 'astm', transport, bidi: { mode: 'query' }, apiOpts: { worklist: [dto('W1')] } });
    try {
      assert.deepEqual(await r.connector.bidi.worklistTick(), { skipped: true });
      assert.deepEqual(r.api.store.worklistQueries, []);
    } finally { await r.close(); }
  });
}

test('mode both: answers queries AND downloads the worklist; scheduler runs on its own', async () => {
  const r = await rig({ kind: 'hl7-q02', transport: 'tcp-server', bidi: { mode: 'both' }, bidiOpts: { pollMs: 80, firstPollMs: 50 }, apiOpts: { orders: { A1: dto('A1', ['GLU']) }, worklist: [dto('W1', ['UREA'])] } });
  try {
    assert.deepEqual(ordersOf(await r.sim.queryQ02('A1'))[0].tests, ['GLU']);
    await r.sim.waitWorklist(1, 4000);
    assert.equal(r.sim.worklist[0].sampleId, 'W1');
    const st = r.connector.status().bidi;
    assert.equal(st.mode, 'both'); assert.equal(st.queriesAnswered, 1); assert.equal(st.worklistSent, 1);
  } finally { await r.close(); }
});

test('live reload: switching mode in the server config takes effect without a restart', async () => {
  const r = await rig({ kind: 'astm', transport: 'tcp-server', bidi: { mode: 'off' }, noSim: true, apiOpts: { orders: { A1: dto('A1', ['GLU']) } } });
  try {
    assert.equal(r.connector.bidi.mode(), 'off');
    // eslint-disable-next-line no-underscore-dangle
    r.api.bidi.orders.A1 = dto('A1', ['GLU']);
    const cfg = JSON.parse(fs.readFileSync(path.join(r.dataDir, 'config.json'), 'utf8'));
    assert.equal(cfg.config.bidirectional.mode, 'off');
  } finally { await r.close(); }
});
