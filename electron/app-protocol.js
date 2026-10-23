/*
 * app://prefrontal — the secure custom origin the packaged desktop app loads
 * its UI from. A file:// page sends `Origin: null` on every fetch/XHR, which
 * the APIs' CORS rejects; app://prefrontal is a real, stable origin the
 * servers can allow (`app://prefrontal`).
 *
 * resolveAppRequest() is pure (no Electron) so it is unit-tested in
 * electron/test/app-protocol.test.js. install() wires it to protocol.handle.
 */
const fs = require('fs');
const path = require('path');

const APP_SCHEME = 'app';
const APP_HOST = 'prefrontal';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
const APP_ENTRY = `${APP_ORIGIN}/index.html`;
// Virtual blank page (not a file) used by the one-time storage migration.
const MIGRATE_PATH = '/__pf_migrate__';

const PRIVILEGES = { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
};

function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

/**
 * Map a request URL to a file under `root`.
 * Returns { status: 200, file, mime } or { status: 404 }.
 * - anything resolving outside `root` (.., encoded .., backslashes, NUL, symlinks) -> 404
 * - extension-less unknown paths fall back to index.html (SPA); a missing
 *   asset (has an extension) is a real 404, never index.html.
 */
function resolveAppRequest(root, requestUrl) {
  const notFound = { status: 404 };
  let u;
  try { u = new URL(requestUrl); } catch { return notFound; }
  if (u.protocol !== `${APP_SCHEME}:` || u.hostname !== APP_HOST) return notFound;

  let rel;
  try { rel = decodeURIComponent(u.pathname); } catch { return notFound; }
  if (rel.includes('\0') || rel.includes('\\')) return notFound;

  const base = path.resolve(root);
  const inside = (p) => p === base || p.startsWith(base + path.sep);
  const entry = path.join(base, 'index.html');
  const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
  const serve = (p) => ({ status: 200, file: p, mime: mimeFor(p) });

  const target = path.resolve(base, '.' + (rel.startsWith('/') ? rel : '/' + rel));
  if (!inside(target)) return notFound;

  if (rel === '/' || rel === '') return isFile(entry) ? serve(entry) : notFound;
  if (isFile(target)) {
    // symlink escape check (best-effort; asar paths have no symlinks)
    let rb = base; let rt = target;
    try { rb = fs.realpathSync(base); rt = fs.realpathSync(target); } catch { /* keep lexical */ }
    if (!(rt === rb || rt.startsWith(rb + path.sep))) return notFound;
    return serve(target);
  }
  if (path.extname(target) !== '') return notFound; // missing asset, not an SPA route
  return isFile(entry) ? serve(entry) : notFound;
}

/** Register before app 'ready'. */
function registerScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: PRIVILEGES }]);
}

/** Call after app 'ready'. */
function install(protocol, root) {
  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const u = new URL(request.url);
      if (u.hostname === APP_HOST && u.pathname === MIGRATE_PATH) {
        return new Response('<!doctype html><title>migrate</title>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      const r = resolveAppRequest(root, request.url);
      if (r.status !== 200) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
      const body = await fs.promises.readFile(r.file);
      return new Response(body, { status: 200, headers: { 'content-type': r.mime, 'cache-control': 'no-cache' } });
    } catch {
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    }
  });
}

module.exports = { APP_SCHEME, APP_HOST, APP_ORIGIN, APP_ENTRY, MIGRATE_PATH, PRIVILEGES, resolveAppRequest, mimeFor, registerScheme, install };
