// electron/bridges — mDNS response parsing + the discovery loop (no sockets).
// Run: npm run test:electron
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { parseResponse, txtToMap, instanceLabel, SERVICE } = require('../bridges/mdns-parse');
const { BridgeDiscovery, STALE_MS } = require('../bridges/discovery');

const INST = 'Prefrontal Bridge 1234._prefrontal-bridge._tcp.local';
const TXT = ['v=1', 'sn=10000000ABCD1234', 'cs=u', 'ver=0.2.0', 'fp=5NRHCGNQ4TR480B2', 'ip=192.168.1.23', 'md=pi5'].map((s) => Buffer.from(s));

function fullResponse(ttl = 120) {
  return {
    answers: [{ name: SERVICE, type: 'PTR', ttl, data: INST }],
    additionals: [
      { name: INST, type: 'SRV', ttl: 120, data: { port: 8443, target: 'prefrontal-bridge-1234.local', priority: 0, weight: 0 } },
      { name: INST, type: 'TXT', ttl: 120, data: TXT },
      { name: 'prefrontal-bridge-1234.local', type: 'A', ttl: 120, data: '192.168.1.23' },
      { name: 'prefrontal-bridge-1234.local', type: 'AAAA', ttl: 120, data: 'fe80::1' },
    ],
  };
}

test('TXT buffers → lower-cased key/value map (B.5 keys)', () => {
  assert.deepEqual(txtToMap(TXT), { v: '1', sn: '10000000ABCD1234', cs: 'u', ver: '0.2.0', fp: '5NRHCGNQ4TR480B2', ip: '192.168.1.23', md: 'pi5' });
  assert.deepEqual(txtToMap([Buffer.from('FLAG'), Buffer.from('K=a=b')]), { flag: '', k: 'a=b' });
  assert.deepEqual(txtToMap(null), {});
});

test('instance label strips the service suffix', () => {
  assert.equal(instanceLabel(INST), 'Prefrontal Bridge 1234');
  assert.equal(instanceLabel(INST + '.'), 'Prefrontal Bridge 1234');
});

test('a full response → one found event in the native-plugin shape (IPv4 only)', () => {
  const { found, lost } = parseResponse(fullResponse());
  assert.equal(lost.length, 0);
  assert.deepEqual(found, [{
    name: 'Prefrontal Bridge 1234', host: 'prefrontal-bridge-1234.local', port: 8443,
    txt: { v: '1', sn: '10000000ABCD1234', cs: 'u', ver: '0.2.0', fp: '5NRHCGNQ4TR480B2', ip: '192.168.1.23', md: 'pi5' },
    addresses: ['192.168.1.23'],
  }]);
});

test('other services are ignored; a PTR goodbye (ttl 0) is "lost"', () => {
  assert.deepEqual(parseResponse({ answers: [{ name: '_http._tcp.local', type: 'PTR', ttl: 120, data: 'x._http._tcp.local' }] }), { found: [], lost: [] });
  const r = parseResponse(fullResponse(0));
  assert.equal(r.found.length, 0);
  assert.equal(r.lost[0].name, 'Prefrontal Bridge 1234');
});

function fakeMdns() {
  const e = new EventEmitter();
  e.queries = [];
  e.query = (q) => e.queries.push(q);
  e.destroyed = false;
  e.destroy = () => { e.destroyed = true; };
  return e;
}

test('discovery: queries PTR on start, emits found, prunes stale, stops cleanly', () => {
  let now = 1_000_000;
  const m = fakeMdns();
  const d = new BridgeDiscovery({ factory: () => m, now: () => now });
  const found = [];
  const lost = [];
  d.on('found', (e) => found.push(e));
  d.on('lost', (e) => lost.push(e));
  d.start();
  assert.deepEqual(m.queries[0], { questions: [{ name: SERVICE, type: 'PTR' }] });
  m.emit('response', fullResponse());
  assert.equal(found.length, 1);
  assert.equal(found[0].txt.sn, '10000000ABCD1234');
  now += STALE_MS + 1;
  d.prune();
  assert.equal(lost.length, 1);
  d.stop();
  assert.equal(m.destroyed, true);
  assert.equal(d.running, false);
});

test('discovery: PTR-only answer re-queries, and SRV/TXT arriving later merge in', () => {
  const m = fakeMdns();
  const d = new BridgeDiscovery({ factory: () => m });
  const found = [];
  d.on('found', (e) => found.push(e));
  d.start();
  m.emit('response', { answers: [{ name: SERVICE, type: 'PTR', ttl: 120, data: INST }] });
  assert.equal(found.length, 0);
  assert.equal(m.queries.length, 2);
  const full = fullResponse();
  m.emit('response', { answers: full.answers, additionals: full.additionals });
  assert.equal(found.length, 1);
  assert.equal(found[0].port, 8443);
  d.stop();
});
