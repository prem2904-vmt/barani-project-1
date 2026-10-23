// node --test electron/test/*.test.js — pure resolver tests (no Electron).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveAppRequest, mimeFor, APP_ENTRY, PRIVILEGES } = require('../app-protocol');
const { mergeMissing } = require('../storage-migration');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-app-'));
const root = path.join(tmp, 'browser');
fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
fs.writeFileSync(path.join(root, 'index.html'), '<html></html>');
fs.writeFileSync(path.join(root, 'main-ABC.js'), 'x');
fs.writeFileSync(path.join(root, 'styles.css'), 'x');
fs.writeFileSync(path.join(root, 'assets', 'a b.png'), 'x');
fs.writeFileSync(path.join(tmp, 'secret.txt'), 'secret');
try { fs.symlinkSync(path.join(tmp, 'secret.txt'), path.join(root, 'link.txt')); } catch { /* windows */ }
const rel = (p) => `app://prefrontal${p}`;

test('entry, root and chunks resolve with correct MIME', () => {
  assert.equal(resolveAppRequest(root, APP_ENTRY).file, path.join(root, 'index.html'));
  assert.equal(resolveAppRequest(root, rel('/')).file, path.join(root, 'index.html'));
  const js = resolveAppRequest(root, rel('/main-ABC.js'));
  assert.equal(js.status, 200);
  assert.match(js.mime, /^text\/javascript/);
  assert.match(resolveAppRequest(root, rel('/styles.css')).mime, /^text\/css/);
  assert.equal(resolveAppRequest(root, rel('/assets/a%20b.png')).mime, 'image/png');
  assert.equal(mimeFor('x.woff2'), 'font/woff2');
  assert.equal(mimeFor('x.unknown'), 'application/octet-stream');
});

test('query string and hash are ignored', () => {
  assert.equal(resolveAppRequest(root, rel('/main-ABC.js?v=1#x')).status, 200);
});

test('path traversal is rejected', () => {
  for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/assets/../../secret.txt',
    '/%2e%2e%2fsecret.txt', '/..\\secret.txt', '/%5c..%5csecret.txt', '/a%00.js', '/%E0%A4%A']) {
    assert.equal(resolveAppRequest(root, rel(p)).status, 404, p);
  }
});

test('symlink escaping the bundle dir is rejected', { skip: !fs.existsSync(path.join(root, 'link.txt')) }, () => {
  assert.equal(resolveAppRequest(root, rel('/link.txt')).status, 404);
});

test('index fallback only for non-asset paths', () => {
  assert.equal(resolveAppRequest(root, rel('/orders/123')).file, path.join(root, 'index.html'));
  assert.equal(resolveAppRequest(root, rel('/missing.js')).status, 404);
  assert.equal(resolveAppRequest(root, rel('/chunk-NOPE.css')).status, 404);
  assert.equal(resolveAppRequest(root, rel('/assets/nope.png')).status, 404);
});

test('wrong scheme/host and missing bundle are 404', () => {
  assert.equal(resolveAppRequest(root, 'file:///etc/passwd').status, 404);
  assert.equal(resolveAppRequest(root, 'app://evil/index.html').status, 404);
  assert.equal(resolveAppRequest(root, 'nonsense').status, 404);
  assert.equal(resolveAppRequest(path.join(tmp, 'nope'), APP_ENTRY).status, 404);
});

test('scheme privileges allow fetch + CORS + secure context', () => {
  assert.deepEqual(PRIVILEGES, { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true });
});

test('storage migration merge never overwrites existing keys, drops non-strings', () => {
  assert.deepEqual(mergeMissing({ a: '1', b: '2', c: null }, ['b']), { a: '1' });
  assert.deepEqual(mergeMissing(null, []), {});
});
