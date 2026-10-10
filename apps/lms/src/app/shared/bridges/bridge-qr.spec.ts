import { describe, expect, it } from 'vitest';
import {
  BRIDGE_QR_HOST, bridgeQrErrorText, crockfordEncode, formatBridgeQr, formatClaimCode, formatClaimCodeInput, hotspotSsidFor,
  isBridgeSerial, normalizeClaimCode, normalizeCrockford, parseBridgeQr, serialShortOf,
} from './bridge-qr';
import { VECTOR_CLAIM_SECRET, VECTOR_FP, VECTOR_PSK, VECTOR_QR_URL, VECTOR_SERIAL } from './testing/bridge-fixtures';

const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('bridge-api v1 B.0 shared vectors', () => {
  it('claim secret "7K2Q-F9MX-RT" normalises to 7K2QF9MXRT and hashes to the contract vector', async () => {
    const n = normalizeClaimCode('7K2Q-F9MX-RT');
    expect(n).toBe(VECTOR_CLAIM_SECRET);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('pfb-claim-v1:' + n));
    expect(b64url(digest)).toBe('nJhJ1Tv1GotpfobwPaigmefiO86JwX50fkzQXV0nBGI');
  });

  it('Crockford(first 10 bytes of SHA-256("x")) = 5NRHCGNQ4TR480B2', async () => {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('x')));
    expect(crockfordEncode(d.slice(0, 10))).toBe(VECTOR_FP);
  });
});

describe('human-code normalisation (B.0)', () => {
  it.each([
    ['7k2qf-9mxrt', '7K2QF9MXRT'],
    [' 7K2Q F9MX RT ', '7K2QF9MXRT'],
    ['oOiIlL', '001111'],
  ])('%s → %s', (raw, want) => expect(normalizeCrockford(raw)).toBe(want));

  it('a claim code is exactly 10 Crockford characters after normalisation', () => {
    expect(normalizeClaimCode('7K2QF-9MXRT')).toBe('7K2QF9MXRT');
    expect(normalizeClaimCode('7K2QF-9MXR')).toBeNull();
    expect(normalizeClaimCode('7K2QF-9MXRU')).toBeNull(); // U is not Crockford
    expect(normalizeClaimCode('')).toBeNull();
  });

  it('display + as-you-type formatting', () => {
    expect(formatClaimCode('7k2qf9mxrt')).toBe('7K2QF-9MXRT');
    expect(formatClaimCodeInput('7k2q')).toBe('7K2Q');
    expect(formatClaimCodeInput('7k2qf9')).toBe('7K2QF-9');
    expect(formatClaimCodeInput('7k2qf-9mxrt-extra')).toBe('7K2QF-9MXRT');
    expect(formatClaimCodeInput('ab!c#u')).toBe('ABC');
  });

  it('serial helpers', () => {
    expect(isBridgeSerial(VECTOR_SERIAL)).toBe(true);
    expect(isBridgeSerial('10000000abcd1234')).toBe(false);
    expect(serialShortOf(VECTOR_SERIAL)).toBe('ABCD-1234');
    expect(hotspotSsidFor(VECTOR_SERIAL)).toBe('Prefrontal-Bridge-1234');
  });
});

describe('QR payload v1 (B.6) — the same table as prefrontal-bridge/src/qr-payload.js', () => {
  const S = VECTOR_SERIAL, C = VECTOR_CLAIM_SECRET, P = VECTOR_PSK, F = VECTOR_FP;

  it.each([
    ['prod URL', `https://lab.prefrontal.health/b#1.${S}.${C}.${P}.${F}`],
    ['any host with path /b (dev/stage parse prod labels)', `https://med-dev.prefrontal.health/b#1.${S}.${C}.${P}.${F}`],
    ['bare payload (from /local/v1/qr)', `1.${S}.${C}.${P}.${F}`],
    ['bare fragment', `#1.${S}.${C}.${P}.${F}`],
    ['lower-case Crockford fields', `https://lab.prefrontal.health/b#1.${S}.${C.toLowerCase()}.${P.toLowerCase()}.${F.toLowerCase()}`],
  ])('%s parses', (_label, input) => {
    const r = parseBridgeQr(input);
    expect(r).toEqual({ ok: true, payload: {
      version: 1, serial: S, serialShort: 'ABCD-1234', claimSecret: C, claimCode: '7K2QF-9MXRT',
      hotspotPsk: P, hotspotSsid: 'Prefrontal-Bridge-1234', tlsFingerprint: F,
    } });
  });

  it('an EMPTY P means an open hotspot (psk null)', () => {
    const r = parseBridgeQr(`https://lab.prefrontal.health/b#1.${S}.${C}..${F}`);
    expect(r.ok && r.payload.hotspotPsk).toBeNull();
  });

  it.each([
    ['another path', `https://lab.prefrontal.health/x#1.${S}.${C}.${P}.${F}`, 'not_bridge'],
    ['a URL with no fragment', 'https://lab.prefrontal.health/b', 'not_bridge'],
    ['a sample barcode', 'LAB26001', 'not_bridge'],
    ['empty', '', 'not_bridge'],
    ['lower-case serial', `1.${S.toLowerCase()}.${C}.${P}.${F}`, 'invalid'],
    ['short serial', `1.ABCD1234.${C}.${P}.${F}`, 'invalid'],
    ['9-char secret', `1.${S}.${C.slice(1)}.${P}.${F}`, 'invalid'],
    ['11-char psk', `1.${S}.${C}.${P.slice(1)}.${F}`, 'invalid'],
    ['15-char pin', `1.${S}.${C}.${P}.${F.slice(1)}`, 'invalid'],
    ['U in the pin', `1.${S}.${C}.${P}.${F.slice(1)}U`, 'invalid'],
    ['too few fields', `1.${S}.${C}.${P}`, 'invalid'],
  ])('%s → %s', (_l, input, err) => {
    const r = parseBridgeQr(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(err);
  });

  it('a newer version says "Update the app"', () => {
    const r = parseBridgeQr(`https://lab.prefrontal.health/b#2.${S}.${C}.${P}.${F}.extra`);
    expect(r).toEqual({ ok: false, error: 'unsupported_version', version: 2 });
    expect(bridgeQrErrorText('unsupported_version')).toBe('Update the app to add this Bridge.');
  });

  it('encode ∘ parse round-trips (fixtures URL included)', () => {
    const { url, payload } = formatBridgeQr({ serial: S, claimSecret: '7k2q-f9mx-rt', hotspotPsk: P, tlsFingerprint: F });
    expect(url).toBe(VECTOR_QR_URL);
    expect(url.startsWith(`https://${BRIDGE_QR_HOST}/b#`)).toBe(true);
    expect(parseBridgeQr(payload).ok).toBe(true);
    expect(formatBridgeQr({ serial: S, claimSecret: C, hotspotPsk: null, tlsFingerprint: F }).payload).toBe(`1.${S}.${C}..${F}`);
  });

  it('never throws on junk', () => {
    for (const junk of [null, undefined, 42, {}, '#', 'https://', '1....', 'http://[::1/b#1']) {
      expect(() => parseBridgeQr(junk)).not.toThrow();
    }
  });
});
