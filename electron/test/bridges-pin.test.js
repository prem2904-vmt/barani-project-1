// electron/bridges — TLS pin (B.0 vector) + pinned local HTTPS against a real
// self-signed P-256 certificate generated with openssl. Run: npm run test:electron
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const { crockfordEncode, normalizePin, pinOfBytes, pinOfCertDer } = require('../bridges/pin');
const { localRequest, checkRequest, isPrivateIpv4 } = require('../bridges/local-request');

test('B.0 vector: Crockford(first 10 bytes of SHA-256("x")) = 5NRHCGNQ4TR480B2', () => {
  assert.equal(pinOfBytes(Buffer.from('x')), '5NRHCGNQ4TR480B2');
  assert.equal(crockfordEncode(crypto.createHash('sha256').update('x').digest().subarray(0, 10)), '5NRHCGNQ4TR480B2');
});

test('pin normalisation follows B.0 (upper, no dashes, O→0, I/L→1)', () => {
  assert.equal(normalizePin('5nrh-cgnq 4tr4-8ob2'), '5NRHCGNQ4TR480B2');
  assert.equal(normalizePin('il'), '11');
});

test('only https + private IPv4 + /local/v1/ + GET/POST + a 16-char pin are accepted', () => {
  const ok = { url: 'https://192.168.1.23:8443/local/v1/identity', method: 'GET', pinFingerprint: '5NRHCGNQ4TR480B2' };
  assert.equal(checkRequest(ok).url.hostname, '192.168.1.23');
  for (const bad of [
    { ...ok, url: 'http://192.168.1.23:8443/local/v1/identity' },
    { ...ok, url: 'https://8.8.8.8/local/v1/identity' },
    { ...ok, url: 'https://lab.prefrontal.health/local/v1/identity' },
    { ...ok, url: 'https://192.168.1.23:8443/api/config' },
    { ...ok, method: 'DELETE' },
    { ...ok, pinFingerprint: 'short' },
    { ...ok, body: 'x'.repeat(70 * 1024) },
  ]) assert.throws(() => checkRequest(bad), /bad_request/);
  assert.equal(isPrivateIpv4('10.42.0.1'), true);
  assert.equal(isPrivateIpv4('172.31.255.1'), true);
  assert.equal(isPrivateIpv4('172.32.0.1'), false);
  assert.equal(isPrivateIpv4('169.254.10.1'), true);
  assert.equal(isPrivateIpv4('127.0.0.1'), false);
});

function makeCert() {
  try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); } catch { return null; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfb-cert-'));
  const key = path.join(dir, 'key.pem');
  const crt = path.join(dir, 'crt.pem');
  execFileSync('openssl', ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', key], { stdio: 'ignore' });
  execFileSync('openssl', ['req', '-new', '-x509', '-key', key, '-out', crt, '-days', '30', '-subj', '/CN=10000000ABCD1234'], { stdio: 'ignore' });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
}

test('pinned request: right pin → JSON body; wrong pin → pin_mismatch and NOTHING is sent', async (t) => {
  const pair = makeCert();
  if (!pair) { t.skip('openssl not available'); return; }
  const der = new crypto.X509Certificate(pair.cert).raw;
  const pin = pinOfCertDer(der);
  assert.match(pin, /^[0-9A-HJKMNP-TV-Z]{16}$/);
  // Same computation from the SPKI directly.
  const spki = new crypto.X509Certificate(pair.cert).publicKey.export({ type: 'spki', format: 'der' });
  assert.equal(pin, pinOfBytes(spki));

  const received = [];
  const server = https.createServer({ key: pair.key, cert: pair.cert }, (req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received.push({ path: req.url, body });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, data: { serial: '10000000ABCD1234', echo: body ? JSON.parse(body) : null } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const ok = await localRequest({ url: `https://127.0.0.1:${port}/local/v1/wifi`, method: 'POST', body: JSON.stringify({ ssid: 'LabWiFi', psk: 'secret123' }), pinFingerprint: pin }, { allowLoopback: true });
    assert.equal(ok.status, 200);
    assert.deepEqual(JSON.parse(ok.body).data.echo, { ssid: 'LabWiFi', psk: 'secret123' });
    assert.equal(received.length, 1);

    await assert.rejects(
      localRequest({ url: `https://127.0.0.1:${port}/local/v1/wifi`, method: 'POST', body: '{"psk":"must-not-leak"}', pinFingerprint: '5NRHCGNQ4TR480B2' }, { allowLoopback: true }),
      /pin_mismatch/,
    );
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(received.length, 1, 'the wrong-pin request never reached the server');

    await assert.rejects(localRequest({ url: `https://127.0.0.1:${port}/local/v1/identity`, pinFingerprint: pin }), /bad_request/, 'loopback is refused outside tests');
  } finally {
    server.close();
  }
});
