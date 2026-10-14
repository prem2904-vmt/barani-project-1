'use strict';
/**
 * A tiny stand-in for the LMS instrument endpoints (device side only), for
 * backend-free tests and demos. Mirrors the contract: X-Instrument-Key auth,
 * envelope { success, data }, idempotent POST /messages, qc / unmatched /
 * matched states by a known-barcode list, superseded re-runs.
 */
const http = require('http');
const { applyMaps } = require('../core/mapper');

function fakeApi({ instruments = {}, knownBarcodes = [], failFirst = 0, orders = {}, worklist = [], ordersDelayMs = 0, ordersStatus = 200 } = {}) {
  // instruments: { [id]: { key, name, config, codeMaps } }
  const store = { messages: [], heartbeats: [], requests: 0, orderQueries: [], worklistQueries: [] };
  // Two-way (contract §2): `orders` = { [sampleId]: DeviceOrdersDto }, `worklist` = DeviceOrdersDto[]; tests mutate them live.
  const bidi = { orders, worklist, ordersDelayMs, ordersStatus };
  let failures = failFirst;
  const server = http.createServer((req, res) => {
    store.requests++;
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    const m = /^\/api\/instruments\/([^/]+)\/(config|heartbeat|messages|orders|worklist)$/.exec(req.url.split('?')[0]);
    if (!m) return send(404, { success: false, error: 'not_found' });
    const inst = instruments[m[1]];
    if (!inst || req.headers['x-instrument-key'] !== inst.key) return send(401, { success: false, error: 'invalid_instrument_key' });
    if (failures > 0 && m[2] === 'messages') { failures--; return send(503, { success: false, error: 'unavailable' }); }
    if (m[2] === 'orders' || m[2] === 'worklist') {
      const u = new URL(req.url, 'http://x');
      const respond = () => {
        if (bidi.ordersStatus !== 200) return send(bidi.ordersStatus, { success: false, error: 'unavailable' });
        if (m[2] === 'orders') {
          const sid = u.searchParams.get('sampleId');
          store.orderQueries.push(sid);
          const dto = bidi.orders[sid];
          return send(200, { success: true, data: dto || { sampleId: sid, found: false, priority: 'normal', collectedAt: null, specimen: null, patient: null, tests: [], unmapped: [] } });
        }
        store.worklistQueries.push(u.searchParams.get('since'));
        return send(200, { success: true, data: { items: bidi.worklist, serverTime: new Date().toISOString() } });
      };
      if (bidi.ordersDelayMs) setTimeout(respond, bidi.ordersDelayMs); else respond();
      return undefined;
    }
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const json = body ? JSON.parse(body) : null;
      if (m[2] === 'config') return send(200, { success: true, data: { id: m[1], name: inst.name, config: inst.config, codeMaps: inst.codeMaps || [], heartbeatSeconds: 30 } });
      if (m[2] === 'heartbeat') { store.heartbeats.push(json); return send(200, { success: true, data: { ok: true, serverTime: new Date().toISOString() } }); }
      const dup = store.messages.find((x) => x.instrumentId === m[1] && x.idempotencyKey === json.idempotencyKey);
      if (dup) return send(200, { success: true, data: { messageId: dup.id, state: dup.state, duplicate: true, matchedLines: dup.matchedLines, unmappedCodes: dup.unmapped } });
      const msg = json.message;
      let state = 'unmatched';
      if (msg.qc) state = 'qc';
      else if (knownBarcodes.includes(msg.sampleId)) state = 'matched';
      const { mapped, unmapped } = applyMaps(msg, inst.codeMaps || []);
      if (state === 'matched') {
        for (const prev of store.messages) if (prev.sampleId === msg.sampleId && prev.state === 'matched') prev.state = 'superseded';
      }
      const row = { id: `m${store.messages.length + 1}`, instrumentId: m[1], idempotencyKey: json.idempotencyKey, sampleId: msg.sampleId, state, mapped, unmapped, matchedLines: state === 'matched' ? mapped.length : 0, payload: json };
      store.messages.push(row);
      return send(200, { success: true, data: { messageId: row.id, state, duplicate: false, matchedLines: row.matchedLines, unmappedCodes: unmapped } });
    });
    return undefined;
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ url: `http://127.0.0.1:${server.address().port}`, store, bidi, close: () => new Promise((r) => server.close(() => r())), setFailures: (n) => { failures = n; } });
  }));
}

module.exports = { fakeApi };
