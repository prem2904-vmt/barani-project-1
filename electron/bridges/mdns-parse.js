'use strict';
/**
 * Pure parsing of mDNS responses for Prefrontal Bridges (bridge-api v1, B.5):
 * service `_prefrontal-bridge._tcp.local`, port 8443, TXT
 * v / sn / cs / ver / fp / ip / md. Input = a multicast-dns (dns-packet)
 * response; output = the same event shape the native plugins emit:
 *   { name, host, port, txt: {k: v}, addresses: [ipv4…] }
 * A PTR with ttl 0 is a goodbye → "lost". No Electron, no sockets: tested
 * with plain objects (electron/test/bridges-mdns.test.js).
 */
const SERVICE = '_prefrontal-bridge._tcp.local';

const lc = (s) => String(s || '').toLowerCase().replace(/\.$/, '');

/** dns-packet TXT data (Buffer | string | array of them) → { key: value } (keys lower-cased). */
function txtToMap(data) {
  const out = {};
  const items = Array.isArray(data) ? data : data != null ? [data] : [];
  for (const it of items) {
    const s = Buffer.isBuffer(it) ? it.toString('utf8') : String(it);
    if (!s) continue;
    const eq = s.indexOf('=');
    const k = (eq === -1 ? s : s.slice(0, eq)).trim().toLowerCase();
    if (!k || k.length > 32) continue;
    out[k] = eq === -1 ? '' : s.slice(eq + 1).slice(0, 255);
  }
  return out;
}

/** "Prefrontal Bridge 1234._prefrontal-bridge._tcp.local" → "Prefrontal Bridge 1234". */
function instanceLabel(fqdn) {
  const s = String(fqdn || '').replace(/\.$/, '');
  const i = s.toLowerCase().lastIndexOf('.' + SERVICE);
  return i > 0 ? s.slice(0, i) : s;
}

/**
 * @param {{answers?: any[], additionals?: any[]}} packet
 * @returns {{ found: object[], lost: object[] }}
 */
function parseResponse(packet) {
  const records = [...(packet && packet.answers || []), ...(packet && packet.additionals || [])];
  const found = [];
  const lost = [];
  const ptrs = records.filter((r) => r && r.type === 'PTR' && lc(r.name) === SERVICE);
  for (const ptr of ptrs) {
    const inst = String(ptr.data || '');
    if (!inst) continue;
    if (ptr.ttl === 0) { lost.push({ name: instanceLabel(inst), host: null, port: null, txt: {}, addresses: [] }); continue; }
    const srv = records.find((r) => r && r.type === 'SRV' && lc(r.name) === lc(inst));
    const txt = records.find((r) => r && r.type === 'TXT' && lc(r.name) === lc(inst));
    const target = srv && srv.data ? lc(srv.data.target) : '';
    const addresses = records
      .filter((r) => r && r.type === 'A' && target && lc(r.name) === target && typeof r.data === 'string')
      .map((r) => r.data);
    found.push({
      name: instanceLabel(inst),
      host: target || null,
      port: srv && srv.data ? Number(srv.data.port) || null : null,
      txt: txt ? txtToMap(txt.data) : {},
      addresses: [...new Set(addresses)],
    });
  }
  return { found, lost };
}

module.exports = { SERVICE, parseResponse, txtToMap, instanceLabel };
