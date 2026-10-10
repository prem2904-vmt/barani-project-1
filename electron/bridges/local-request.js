'use strict';
/**
 * HTTPS to a Bridge's local API (bridge-api v1, B.3) with the pinned
 * self-signed certificate. The cert is not CA-signed and has no matching
 * hostname, so normal verification is replaced by ONE check: the leaf's SPKI
 * pin must equal the pin the app passed (QR `F`, else mDNS TXT `fp`).
 *
 * The TLS handshake is done FIRST and the pin checked on the connected
 * socket; only then is the HTTP request (which may carry a Wi-Fi password)
 * written to it. (Node skips `checkServerIdentity` for a self-signed chain,
 * so a pin check there would never run.)
 *
 * The renderer can't reach anything else through this: only `https://`, only
 * private / link-local IPv4 hosts, only `/local/v1/…` paths, GET/POST, small
 * bodies, a hard timeout. Errors come back as `Error("<code>: …")` so the UI
 * maps them (pin_mismatch / local_unreachable / bad_request).
 */
const https = require('https');
const tls = require('tls');
const { normalizePin, pinOfCertDer } = require('./pin');

const MAX_BODY = 64 * 1024;
const MAX_RESPONSE = 1024 * 1024;
const MAX_TIMEOUT = 30_000;

function isPrivateIpv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(host || ''));
  if (!m) return false;
  if ([m[1], m[2], m[3], m[4]].some((x) => Number(x) > 255)) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/** Validate a renderer request; returns the parsed parts or throws `bad_request`. */
function checkRequest(req, opts = {}) {
  const o = req && typeof req === 'object' ? req : {};
  let url;
  try { url = new URL(String(o.url || '')); } catch { throw new Error('bad_request: url'); }
  if (url.protocol !== 'https:') throw new Error('bad_request: https only');
  const loopbackOk = opts.allowLoopback && url.hostname === '127.0.0.1';
  if (!isPrivateIpv4(url.hostname) && !loopbackOk) throw new Error('bad_request: private IPv4 hosts only');
  if (!url.pathname.startsWith('/local/v1/')) throw new Error('bad_request: path');
  const method = o.method === 'POST' ? 'POST' : o.method === 'GET' || o.method == null ? 'GET' : null;
  if (!method) throw new Error('bad_request: method');
  const pin = normalizePin(o.pinFingerprint);
  if (!/^[0-9A-HJKMNP-TV-Z]{16}$/.test(pin)) throw new Error('bad_request: pin');
  const body = o.body == null ? undefined : String(o.body);
  if (body && Buffer.byteLength(body) > MAX_BODY) throw new Error('bad_request: body too large');
  const timeoutMs = Math.min(MAX_TIMEOUT, Math.max(1000, Number(o.timeoutMs) || 10_000));
  return { url, method, pin, body, timeoutMs };
}

/** TLS-connect and verify the pin before anything is sent. */
function connectPinned(host, port, pin, timeoutMs) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port, rejectUnauthorized: false, ALPNProtocols: ['http/1.1'] });
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('local_unreachable: timeout')); }, timeoutMs);
    sock.once('secureConnect', () => {
      clearTimeout(timer);
      let got = '';
      try { const peer = sock.getPeerCertificate(); got = peer && peer.raw ? pinOfCertDer(peer.raw) : ''; } catch { got = ''; }
      if (got !== pin) { sock.destroy(); reject(new Error('pin_mismatch: certificate does not match the Bridge pin')); return; }
      resolve(sock);
    });
    sock.once('error', (e) => { clearTimeout(timer); reject(new Error('local_unreachable: ' + e.message)); });
  });
}

/**
 * @returns {Promise<{status:number, body:string}>}
 */
async function localRequest(req, opts = {}) {
  const { url, method, pin, body, timeoutMs } = checkRequest(req, opts);
  const port = Number(url.port) || 443;
  const sock = await connectPinned(url.hostname, port, pin, timeoutMs);
  return new Promise((resolve, reject) => {
    const r = https.request({
      host: url.hostname,
      port,
      path: url.pathname + url.search,
      method,
      headers: { Accept: 'application/json', Connection: 'close', ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) },
      // No agent (agent:false would open its OWN CA-verified connection and
      // ignore createConnection): the already-verified socket is the only one.
      createConnection: () => sock,
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => { size += c.length; if (size > MAX_RESPONSE) { res.destroy(); reject(new Error('local_unreachable: response too large')); } else chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', (e) => reject(new Error('local_unreachable: ' + e.message)));
    });
    r.on('timeout', () => r.destroy(new Error('local_unreachable: timeout')));
    r.on('error', (e) => { sock.destroy(); reject(String(e.message).startsWith('local_unreachable') ? e : new Error('local_unreachable: ' + e.message)); });
    r.on('close', () => sock.destroy());
    if (body) r.write(body);
    r.end();
  });
}

module.exports = { localRequest, checkRequest, isPrivateIpv4, connectPinned };
