'use strict';
/**
 * The Bridge TLS pin (bridge-api v1, B.0 `fp`): Crockford base32 of the first
 * 10 bytes of SHA-256(leaf certificate SubjectPublicKeyInfo, DER) → 16 chars.
 * Shared vector: Crockford(first 10 bytes of SHA-256("x")) = "5NRHCGNQ4TR480B2".
 */
const crypto = require('crypto');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function crockfordEncode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Human-input normalisation (B.0): upper-case, drop "-"/spaces, O→0, I/L→1. */
function normalizePin(s) {
  return String(s || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

function pinOfBytes(bytes) {
  return crockfordEncode(crypto.createHash('sha256').update(bytes).digest().subarray(0, 10));
}

/** Pin of a DER certificate (Buffer) — via its SPKI. */
function pinOfCertDer(der) {
  const x = new crypto.X509Certificate(der);
  const spki = x.publicKey.export({ type: 'spki', format: 'der' });
  return pinOfBytes(spki);
}

module.exports = { crockfordEncode, normalizePin, pinOfBytes, pinOfCertDer, ALPHABET };
