#!/usr/bin/env node
// Tiny static SPA file server for the OFFLINE Playwright specs
// (messages-realtime.smoke.spec.ts, notification-bell-alerts.smoke.spec.ts):
// serves a `nx run lms:build` output on a SPARE port (never 4200/4201 — those
// belong to the nx dev server other e2e layers reuse) with client-side-route
// fallback to index.html, so Angular Router paths like /frontdesk resolve.
//
// Usage: node apps/lms-e2e/serve-spa.mjs dist/apps/lms/browser 4317
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const [, , rootArg, portArg] = process.argv;
if (!rootArg) {
  console.error('Usage: node serve-spa.mjs <dist-dir> [port]');
  process.exit(1);
}
const root = normalize(rootArg);
const port = Number(portArg || process.env.PORT || 4317);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
  // The Neuron spreadsheet engine (apps/lms/public/neuron-engine): a browser refuses to stream-compile wasm under any other type.
  '.wasm': 'application/wasm',
};

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let filePath = join(root, urlPath);
  if (!filePath.startsWith(root)) { res.writeHead(403); res.end('Forbidden'); return; }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(root, 'index.html'); // SPA fallback — Angular Router owns the path
  }
  const type = TYPES[extname(filePath)] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  createReadStream(filePath).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`serve-spa: ${root} on http://127.0.0.1:${port}`);
});
