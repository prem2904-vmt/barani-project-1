#!/usr/bin/env node
'use strict';
/**
 * Headless host for the instrument connector core — the same core the
 * desktop app runs, without Electron. Intended for a Raspberry Pi (or any
 * small Linux box) wired to the analyzer.
 *
 *   node electron/instruments/host-node.js pair --api https://… --instrument <id> --key <deviceKey>
 *   node electron/instruments/host-node.js run            (runs every paired connector)
 *   node electron/instruments/host-node.js list
 *   node electron/instruments/host-node.js unpair --instrument <id>
 *
 * State lives in $PF_INSTRUMENTS_DIR (default ~/.prefrontal-instruments).
 * Keys are stored with the plain codec in a 0600 file — on a Pi, protect the
 * SD card / use full-disk encryption. (A systemd unit + OS keyring are the
 * Pi follow-up; see README "Known gaps".)
 */
const os = require('os');
const path = require('path');
const { ConnectorManager } = require('./core/manager');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const cmd = process.argv[2] || 'run';
  const baseDir = process.env.PF_INSTRUMENTS_DIR || path.join(os.homedir(), '.prefrontal-instruments');
  const m = new ConnectorManager({ baseDir });
  m.on('status', (s) => process.stdout.write(`[${new Date().toISOString()}] ${s.name}: ${s.state} queue=${s.queueLength}${s.lastError ? ` err=${s.lastError}` : ''}\n`));
  if (cmd === 'pair') {
    const r = await m.pair({ apiUrl: arg('api'), instrumentId: arg('instrument'), deviceKey: arg('key') || process.env.PF_INSTRUMENT_KEY });
    process.stdout.write(`${JSON.stringify(r)}\n`);
    await m.stopAll();
    process.exit(r.ok ? 0 : 1);
  }
  if (cmd === 'unpair') { process.stdout.write(`${JSON.stringify(await m.unpair(arg('instrument')))}\n`); process.exit(0); }
  if (cmd === 'list') { m._read(); process.stdout.write(`${JSON.stringify(m.list().map(({ status, ...p }) => p), null, 2)}\n`); process.exit(0); }
  await m.load();
  const shutdown = async () => { await m.stopAll(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
