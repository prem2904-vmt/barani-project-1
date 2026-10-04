'use strict';
/**
 * A tiny stand-in for the LMS instrument endpoints (device side only), for
 * backend-free tests and demos. Mirrors the contract: X-Instrument-Key auth,
 * envelope { success, data }, idempotent POST /messages, qc / unmatched /
 * matched states by a known-barcode list, superseded re-runs.
 */
const http = require('http');
const { applyMaps } = require('../core/mapper');

function fakeApi({ instruments = {}, knownBarcodes = [], failFirst = 0 } = {}) {
  // instruments: { [id]: { key, name, config, codeMaps } }
  const store = { messages: [], heartbeats: [], requests: 0 };
  let failures = failFirst;
  const server = http.createServer((req, res) => {
    store.requests++;
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    const m = /^\/api\/instruments\/([^/]+)\/(config|heartbeat|messages)$/.exec(req.url.split('?')[0]);
    if (!m) return send(404, { success: false, error: 'not_found' });
    const inst = instruments[m[1]];
    if (!inst || req.headers['x-instrument-key'] !== inst.key) return send(401, { success: false, error: 'invalid_instrument_key' });
    if (failures > 0 && m[2] === 'messages') { failures--; return send(503, { success: false, error: 'unavailable' }); }
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
    resolve({ url: `http://127.0.0.1:${server.address().port}`, store, close: () => new Promise((r) => server.close(() => r())), setFailures: (n) => { failures = n; } });
  }));
}

module.exports = { fakeApi };
