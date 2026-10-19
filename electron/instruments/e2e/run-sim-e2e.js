#!/usr/bin/env node
'use strict';
/**
 * Real-backend end-to-end run: connector core + simulators against a live
 * LMS API (the prefrontal-mw integration test InstrumentSimE2ETests starts
 * the API on a local port, seeds the instruments / orders / barcodes, runs
 * this script, then asserts the database).
 *
 *   node electron/instruments/e2e/run-sim-e2e.js --fixture fixture.json [--out report.json]
 *
 * fixture.json:
 *   { "apiUrl": "http://127.0.0.1:5xxx",
 *     "instruments": [ { "id", "key", "dialect": "astm-5part|hl7-5part|text-3part",
 *                        "connectorTransport": "tcp-server|tcp-client|serial",
 *                        "samples": ["<barcode normal/rerun>", "<barcode bad-checksum>", "<burst…>"],
 *                        "unknownId": "999999999" } ] }
 *
 * Writes { results: [ per-instrument report | { skipped } ] } and exits 0 when
 * every non-skipped run delivered everything (queue drained, all sent ok).
 */
const fs = require('fs');
const { runScenario, openVirtualSerialPair } = require('./harness');

function arg(n) { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; }

async function main() {
  const fixture = JSON.parse(fs.readFileSync(arg('fixture'), 'utf8'));
  const results = [];
  let pair = null;
  for (const inst of fixture.instruments) {
    const base = { instrumentId: inst.id, dialect: inst.dialect, connectorTransport: inst.connectorTransport };
    try {
      if (inst.connectorTransport === 'serial' && !pair) pair = await openVirtualSerialPair();
      const r = await runScenario({
        apiUrl: fixture.apiUrl, instrumentId: inst.id, deviceKey: inst.key, dialect: inst.dialect,
        connectorTransport: inst.connectorTransport, samples: inst.samples, unknownId: inst.unknownId,
        serialPair: pair, scenario: inst.scenario || 'all', timeoutMs: 60000, verbose: !!fixture.verbose,
      });
      results.push({ ...base, ...r });
      process.stderr.write(`e2e: ${inst.dialect} via ${inst.connectorTransport}: ${r.skipped ? `SKIPPED (${r.skipped})` : `${r.sent.length} sent, ${r.uploaded.length} uploaded, queue ${r.queueLeft}`}\n`);
    } catch (e) {
      results.push({ ...base, error: e.message });
      process.stderr.write(`e2e: ${inst.dialect} via ${inst.connectorTransport}: ERROR ${e.message}\n`);
    }
  }
  if (pair && pair.close) pair.close();
  const out = JSON.stringify({ results }, null, 2);
  if (arg('out')) fs.writeFileSync(arg('out'), out); else process.stdout.write(out + '\n');
  const ok = results.every((r) => r.skipped || (!r.error && r.queueLeft === 0 && r.sent.every((s) => s.ok)));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { process.stderr.write(`${e.stack || e.message}\n`); process.exit(1); });
