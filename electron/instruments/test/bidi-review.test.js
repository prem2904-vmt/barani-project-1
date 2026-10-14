'use strict';
/** Review fixes for two-way: auth/permanent = refusal (never the cache), stale cache, privacy, ACK tolerance, stuck samples, timers. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { OrderCache, SentJournal, CACHE_MAX_TTL_MS } = require('../core/bidi/store');
const { normalizeBidi } = require('../core/bidi');
const H = require('../core/bidi/hl7');
const { ID, dto, ordersOf, wait, rig } = require('./bidi-rig');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pf-bidi-rev-'));
const PT = { id: 'P-SECRET', name: 'Secret Person', sex: 'F', dob: '1980-01-31' };

// ── store ──────────────────────────────────────────────────────────────────
test('cache: patient stripped, replace() is exact, delete/clear, TTL capped at 4 h, files 0600 / dir 0700', () => {
  const dir = path.join(tmp(), 'inst');
  const c = new OrderCache({ dir, ttlMs: 99 * 3600 * 1000 });
  assert.equal(c.ttlMs, CACHE_MAX_TTL_MS);
  c.setTtl(48 * 3600 * 1000);
  assert.equal(c.ttlMs, 4 * 3600 * 1000);
  c.setTtl(3600 * 1000);
  assert.equal(c.ttlMs, 3600 * 1000);
  c.put(dto('A', ['GLU'], { patient: PT })); c.put(dto('B', ['UREA'])); c.save();
  assert.equal(c.get('A').patient, null);
  assert.ok(!/Secret|P-SECRET/.test(fs.readFileSync(c.file, 'utf8')));
  c.replace([dto('C', ['CHOL'])]);
  assert.deepEqual([...c.map.keys()], ['C']);
  c.delete('C'); assert.equal(c.get('C'), null);
  c.put(dto('D', ['TG'])); c.clear(); assert.equal(c.map.size, 0);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(c.file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    const j = new SentJournal({ dir }); j.mark(dto('A'));
    assert.equal(fs.statSync(j.file).mode & 0o777, 0o600);
  }
});

test('cache: fingerprint change purges (mode / sendPatient), same fingerprint keeps', () => {
  const dir = tmp();
  const c = new OrderCache({ dir });
  c.fingerprint('query|0'); c.put(dto('A')); c.save();
  assert.equal(new OrderCache({ dir }).fingerprint('query|0'), false);
  assert.equal(new OrderCache({ dir }).map.size, 1);
  const c2 = new OrderCache({ dir });
  assert.equal(c2.fingerprint('query|1'), true);
  assert.equal(c2.map.size, 0);
  assert.equal(new OrderCache({ dir }).map.size, 0);
});

test('journal: prunes and compacts at runtime, not only at load', () => {
  const dir = tmp();
  let t = 1_000_000;
  const j = new SentJournal({ dir, now: () => t, keepMs: 1000 });
  for (let i = 0; i < 100; i++) j.mark(dto(`OLD${i}`, ['GLU']));
  t += 5000;
  for (let i = 0; i < 100; i++) j.mark(dto(`NEW${i}`, ['GLU']));
  assert.equal(j.map.size, 100, 'aged entries dropped without a restart');
  const k = new SentJournal({ dir: tmp(), now: () => t, keepMs: 1e9 });
  for (let i = 0; i < 300; i++) k.mark(dto('SAME', ['GLU', `T${i}`]));
  assert.equal(fs.readFileSync(k.file, 'utf8').split('\n').filter(Boolean).length, 1, 'journal compacted at runtime');
});

test('hl7: only QRY^Q02 is a Q02 query; dialect names and the mindray alias', () => {
  const q = (t) => `MSH|^~\\&|BS|LAB|LIS|HOST|2026||${t}|1|P|2.3.1\rQRD|2026|R|D|1|||1^RD|S1|OTH\r`;
  assert.equal(H.classifyHl7(q('QRY^Q02')).kind, 'qry_q02');
  assert.equal(H.classifyHl7(q('QRY^Q01')), null);
  assert.equal(H.classifyHl7(q('QRY^A19')), null);
  assert.equal(H.pickDialect({ sendingApp: 'zzz' }, 'mindray'), 'mindray-bs');
  assert.equal(normalizeBidi({ hl7Dialect: 'mindray' }).hl7Dialect, 'mindray-bs');
  assert.equal(normalizeBidi({ hl7Dialect: 'autolab' }).hl7Dialect, 'autolab');
  assert.equal(H.pickDialect({ sendingApp: 'zzz' }, 'nonsense'), 'generic');
});

// ── H1: auth / permanent = refusal ─────────────────────────────────────────
for (const status of [401, 403, 409]) {
  test(`H1: ${status} on /orders is a refusal — never the cache — and the cache is cleared`, async () => {
    for (const kind of ['astm', 'hl7-q02', 'hl7-q11']) {
      const r = await rig({ kind, transport: 'tcp-server', bidi: { mode: 'query' }, apiOpts: { orders: { A1: dto('A1', ['GLU']) } } });
      try {
        const ask = (id) => (kind === 'astm' ? r.sim.queryAstm(id) : kind === 'hl7-q02' ? r.sim.queryQ02(id) : r.sim.queryQ11(id));
        assert.equal(ordersOf(await ask('A1')).length, 1);
        assert.equal(r.connector.bidi.cache.map.size, 1);
        r.api.bidi.ordersStatus = status;
        const a = await ask('A1');
        assert.equal(ordersOf(a).length, 0, 'cache not served');
        if (kind === 'astm') { const recs = a.text.split('\r').filter(Boolean); assert.deepEqual(recs.map((x) => x[0]), ['H', 'Q', 'L']); assert.equal(recs[1].split('|')[12], 'X'); assert.equal(recs[2], 'L|1|Q'); }
        if (kind === 'hl7-q02') assert.match(a.qck, /MSA\|AE\|/);
        if (kind === 'hl7-q11') assert.match(a.rsp, /MSA\|AE\|/);
        assert.equal(r.connector.bidi.cache.map.size, 0, 'whole cache dropped');
        assert.equal(r.connector.status().bidi.queryErrors, 1);
      } finally { await r.close(); }
    }
  });
}

// ── H2: stale cache ────────────────────────────────────────────────────────
test('H2: server found:false deletes the cached entry (a validated tube is not re-served during a blip)', async () => {
  const r = await rig({ kind: 'astm', transport: 'tcp-server', bidi: { mode: 'query' }, apiOpts: { orders: { A1: dto('A1', ['GLU']) } } });
  try {
    assert.equal((await r.sim.queryAstm('A1')).orders.length, 1);
    delete r.api.bidi.orders.A1;                       // now validated / cancelled on the server
    assert.equal((await r.sim.queryAstm('A1')).orders.length, 0);
    assert.equal(r.connector.bidi.cache.get('A1'), null);
    r.api.bidi.ordersStatus = 503;
    const a = await r.sim.queryAstm('A1');
    assert.equal(a.orders.length, 0, 'blip does not resurrect it');
  } finally { await r.close(); }
});

test('H2: a successful worklist poll REPLACES the cache with exactly the returned set', async () => {
  const r = await rig({ kind: 'astm', transport: 'tcp-server', bidi: { mode: 'both' }, apiOpts: { orders: { Q1: dto('Q1', ['GLU']) }, worklist: [dto('W1', ['UREA']), dto('W2', ['CHOL'])] } });
  try {
    await r.sim.queryAstm('Q1');
    assert.deepEqual([...r.connector.bidi.cache.map.keys()], ['Q1']);
    await r.connector.bidi.worklistTick();
    assert.deepEqual([...r.connector.bidi.cache.map.keys()].sort(), ['W1', 'W2']);
    r.api.bidi.worklist.splice(0, 1);
    await r.connector.bidi.worklistTick();
    assert.deepEqual([...r.connector.bidi.cache.map.keys()], ['W2']);
  } finally { await r.close(); }
});

// ── M1: privacy ─────────────────────────────────────────────────────────────
test('M1: cache holds barcode + tests only — a cached answer carries no patient even with sendPatient on', async () => {
  const r = await rig({ kind: 'astm', transport: 'tcp-server', bidi: { mode: 'query', sendPatient: true }, apiOpts: { orders: { A1: dto('A1', ['GLU'], { patient: PT }) } } });
  try {
    const live = await r.sim.queryAstm('A1');
    assert.match(live.text, /Secret Person/);
    assert.ok(!/Secret|P-SECRET/.test(fs.readFileSync(path.join(r.dataDir, 'bidi-cache.json'), 'utf8')));
    r.api.bidi.ordersStatus = 503;
    const cached = await r.sim.queryAstm('A1');
    assert.deepEqual(cached.orders[0].tests, ['GLU']);
    assert.ok(!/Secret|P-SECRET/.test(cached.text));
  } finally { await r.close(); }
});

test('M1: turning sendPatient off or changing the mode purges the cache', async () => {
  const r = await rig({ kind: 'astm', transport: 'tcp-server', bidi: { mode: 'query', sendPatient: true }, apiOpts: { orders: { A1: dto('A1', ['GLU']) } } });
  try {
    await r.sim.queryAstm('A1');
    assert.equal(r.connector.bidi.cache.map.size, 1);
    r.connector.remote.config.bidirectional = { mode: 'query', sendPatient: false };
    r.connector.bidi.refresh();
    assert.equal(r.connector.bidi.cache.map.size, 0);
    await r.sim.queryAstm('A1');
    assert.equal(r.connector.bidi.cache.map.size, 1);
    r.connector.remote.config.bidirectional = { mode: 'both', sendPatient: false };
    r.connector.bidi.refresh();
    assert.equal(r.connector.bidi.cache.map.size, 0);
  } finally { await r.close(); }
});

// ── M2: ASTM ALL ────────────────────────────────────────────────────────────
const ALL_Q = 'H|\\^&|||SIM\rQ|1|^ALL||^^^ALL\rL|1\r';
test('M2: ASTM ALL — permanent/auth/409 refuses (no cache); only a transient error may use the cache', async () => {
  const r = await rig({ kind: 'astm', transport: 'tcp-server', bidi: { mode: 'both' }, apiOpts: { orders: { A1: dto('A1', ['GLU']) }, worklist: [dto('W1', ['UREA'])] } });
  try {
    const askAll = async () => { const p = r.sim._next(); await r.sim.sender.send(ALL_Q); return p; };
    await r.sim.queryAstm('A1');                        // cache has A1
    r.api.bidi.ordersStatus = 503;
    const transient = await askAll();
    assert.match(transient, /O\|1\|A1\|/, 'transient error → cached orders');
    r.api.bidi.ordersStatus = 403;
    const refused = (await askAll()).split('\r').filter(Boolean);
    assert.deepEqual(refused.map((x) => x[0]), ['H', 'Q', 'L']);
    assert.equal(refused[2], 'L|1|Q');
    assert.equal(r.connector.bidi.cache.map.size, 0);
  } finally { await r.close(); }
});

// ── M3: HL7 ACK tolerance + stuck samples ───────────────────────────────────
test('M3: one outstanding download — an ACK with an empty / wrong MSA-2 is accepted (and logged)', async () => {
  for (const ackRef of [() => '', () => 'WRONG']) {
    const r = await rig({ kind: 'hl7-q02', transport: 'tcp-server', bidi: { mode: 'worklist' }, apiOpts: { worklist: [dto('W1', ['GLU'])] }, simOpts: { ackRef } });
    try {
      const res = await r.connector.bidi.worklistTick();
      assert.equal(res.sent, 1);
      assert.ok(r.notes().some((n) => /accepted for .* \(only one download outstanding\)/.test(n)));
    } finally { await r.close(); }
  }
});

test('M3: after 5 failed cycles a sample is parked (visible in status/lastError) until its test set changes', async () => {
  let code = 'AE';
  const r = await rig({ kind: 'hl7-q02', transport: 'tcp-server', bidi: { mode: 'worklist' }, bidiOpts: { retries: 0, failBackoffMs: 0 }, apiOpts: { worklist: [dto('W1', ['GLU'])] }, simOpts: { ackCode: () => code } });
  try {
    for (let i = 0; i < 5; i++) await r.connector.bidi.worklistTick();
    assert.equal(r.sim.ackCount, 5);
    assert.match(r.connector.status().bidi.lastError, /gave up after 5 failed cycles/);
    assert.deepEqual(r.connector.status().bidi.stuck, ['W1']);
    await r.connector.bidi.worklistTick();
    assert.equal(r.sim.ackCount, 5, 'no further retries');
    code = 'AA';
    r.api.bidi.worklist[0] = dto('W1', ['GLU', 'UREA']);   // tests changed → fresh start
    const res = await r.connector.bidi.worklistTick();
    assert.equal(res.sent, 1);
    assert.deepEqual(r.connector.status().bidi.stuck, []);
  } finally { await r.close(); }
});

// ── L3: timers ──────────────────────────────────────────────────────────────
test('L3: mode off / query = no timer; worklist modes start it; switching off stops it', async () => {
  for (const [bidi, want] of [[undefined, false], [{ mode: 'off' }, false], [{ mode: 'query' }, false], [{ mode: 'worklist' }, true], [{ mode: 'both' }, true]]) {
    const r = await rig({ kind: 'astm', transport: 'tcp-server', bidi, noSim: true });
    try {
      assert.equal(!!r.connector.bidi.timer, want, JSON.stringify(bidi));
      if (want) {
        r.connector.remote.config.bidirectional = { mode: 'off' };
        r.connector.bidi.refresh();
        assert.equal(r.connector.bidi.timer, null);
        r.connector.remote.config.bidirectional = { mode: 'both' };
        r.connector.bidi.refresh();
        assert.ok(r.connector.bidi.timer);
      }
    } finally { await r.close(); }
  }
});
