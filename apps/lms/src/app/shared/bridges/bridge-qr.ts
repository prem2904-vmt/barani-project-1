/**
 * Bridge QR payload (bridge-api v1, B.6) and the human-code rules of B.0.
 * Pure — no Angular. Reference parser for the app; the Bridge's twin is
 * `prefrontal-bridge/src/qr-payload.js`. The wire format must stay identical
 * (the spec tables in bridge-qr.spec.ts mirror the Bridge's).
 *
 *   https://lab.prefrontal.health/b#1.<S>.<C>.<P>.<F>
 *     1  payload version (literal)
 *     S  serial, 16 hex, uppercase
 *     C  claim secret, 10 Crockford
 *     P  hotspot WPA2 PSK, 12 Crockford; EMPTY when the hotspot is open
 *     F  TLS pin, 16 Crockford
 *
 * The secrets ride in the FRAGMENT so they never reach a web server or a CDN
 * log. Any host whose path is `/b` parses (dev/stage builds read prod labels).
 */

export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const BRIDGE_QR_HOST = 'lab.prefrontal.health';
export const BRIDGE_QR_PATH = '/b';
export const BRIDGE_QR_VERSION = 1;

const SERIAL_RE = /^[0-9A-F]{16}$/;
const CROCKFORD_RE = /^[0-9A-HJKMNP-TV-Z]+$/;

/** B.0 human-input normalisation: uppercase, drop "-" and whitespace,
 *  O→0, I→1, L→1. Does not validate. */
export function normalizeCrockford(input: unknown): string {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

/** Crockford base32 encode (MSB-first, no padding) — B.0 `fp`, codes. */
export function crockfordEncode(bytes: Uint8Array): string {
  let value = 0;
  let bits = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += CROCKFORD_ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += CROCKFORD_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function isCrockford(s: string): boolean {
  return s.length > 0 && CROCKFORD_RE.test(s);
}

/** A typed / scanned claim code → its 10-character canonical form, or null. */
export function normalizeClaimCode(input: unknown): string | null {
  const n = normalizeCrockford(input);
  return n.length === 10 && isCrockford(n) ? n : null;
}

/** "7K2QF9MXRT" → "7K2QF-9MXRT" (display form under the QR). */
export function formatClaimCode(code: string): string {
  const n = normalizeCrockford(code);
  return n.length === 10 ? `${n.slice(0, 5)}-${n.slice(5)}` : n;
}

/** As-you-type formatting for the claim-code field: canonical characters,
 *  a dash after the fifth, never more than 10. Invalid characters drop out. */
export function formatClaimCodeInput(raw: string): string {
  const n = normalizeCrockford(raw).replace(/[^0-9A-HJKMNP-TV-Z]/g, '').slice(0, 10);
  return n.length > 5 ? `${n.slice(0, 5)}-${n.slice(5)}` : n;
}

export function isBridgeSerial(s: unknown): s is string {
  return typeof s === 'string' && SERIAL_RE.test(s);
}

/** SSID is derived, never encoded: "Prefrontal-Bridge-" + last 4 of the serial. */
export function hotspotSsidFor(serial: string): string {
  return `Prefrontal-Bridge-${String(serial ?? '').slice(-4)}`;
}

/** "10000000ABCD1234" → "ABCD-1234" (B.0 serialShort). */
export function serialShortOf(serial: string): string {
  const s = String(serial ?? '').toUpperCase();
  if (s.length < 8) return s;
  const last8 = s.slice(-8);
  return `${last8.slice(0, 4)}-${last8.slice(4)}`;
}

export interface BridgeQrPayload {
  version: 1;
  serial: string;
  serialShort: string;
  /** Canonical 10 characters. */
  claimSecret: string;
  /** "XXXXX-XXXXX". */
  claimCode: string;
  /** null = open hotspot. */
  hotspotPsk: string | null;
  hotspotSsid: string;
  tlsFingerprint: string;
}

export type BridgeQrError =
  /** Not a Bridge code at all (another QR, a URL with another path). */
  | 'not_bridge'
  /** A newer payload version: "Update the app to add this Bridge". */
  | 'unsupported_version'
  /** A Bridge code with a broken field. */
  | 'invalid';

export type BridgeQrParse =
  | { ok: true; payload: BridgeQrPayload }
  | { ok: false; error: BridgeQrError; version?: number };

/** Words for a failed parse (the add screen shows these verbatim). */
export function bridgeQrErrorText(e: BridgeQrError): string {
  switch (e) {
    case 'unsupported_version': return 'Update the app to add this Bridge.';
    case 'invalid': return 'This Bridge code is damaged. Type the claim code printed under the QR instead.';
    default: return 'That is not a Prefrontal Bridge code.';
  }
}

/**
 * Parse a scanned / pasted QR: the full URL (any host, path `/b`), the bare
 * fragment (`1.S.C.P.F`, as `/local/v1/qr` returns it) or `#1.S.C.P.F`.
 * Never throws.
 */
export function parseBridgeQr(input: unknown): BridgeQrParse {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, error: 'not_bridge' };
  let fragment = raw;
  const hash = raw.indexOf('#');
  if (hash !== -1) {
    const before = raw.slice(0, hash);
    fragment = raw.slice(hash + 1);
    if (before) {
      let url: URL;
      try { url = new URL(before); } catch { return { ok: false, error: 'not_bridge' }; }
      if (url.pathname !== BRIDGE_QR_PATH) return { ok: false, error: 'not_bridge' };
    }
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    // A URL with no fragment can't carry a Bridge payload.
    return { ok: false, error: 'not_bridge' };
  }
  const parts = fragment.split('.');
  if (!/^\d+$/.test(parts[0] ?? '')) return { ok: false, error: 'not_bridge' };
  const version = Number(parts[0]);
  if (!Number.isInteger(version) || version < 1) return { ok: false, error: 'not_bridge' };
  if (version !== BRIDGE_QR_VERSION) return { ok: false, error: 'unsupported_version', version };
  if (parts.length !== 5) return { ok: false, error: 'invalid', version };
  const [, serial, cRaw, pRaw, fRaw] = parts;
  if (!isBridgeSerial(serial)) return { ok: false, error: 'invalid', version };
  const claimSecret = normalizeCrockford(cRaw);
  if (claimSecret.length !== 10 || !isCrockford(claimSecret)) return { ok: false, error: 'invalid', version };
  const psk = pRaw ? normalizeCrockford(pRaw) : '';
  if (psk && (psk.length !== 12 || !isCrockford(psk))) return { ok: false, error: 'invalid', version };
  const fp = normalizeCrockford(fRaw);
  if (fp.length !== 16 || !isCrockford(fp)) return { ok: false, error: 'invalid', version };
  return {
    ok: true,
    payload: {
      version: 1,
      serial,
      serialShort: serialShortOf(serial),
      claimSecret,
      claimCode: formatClaimCode(claimSecret),
      hotspotPsk: psk || null,
      hotspotSsid: hotspotSsidFor(serial),
      tlsFingerprint: fp,
    },
  };
}

/** Encode (the inverse of parse) — used by tests and fixtures. */
export function formatBridgeQr(
  p: { serial: string; claimSecret: string; hotspotPsk?: string | null; tlsFingerprint: string },
  host = BRIDGE_QR_HOST,
): { payload: string; url: string } {
  const payload = `${BRIDGE_QR_VERSION}.${p.serial}.${normalizeCrockford(p.claimSecret)}.${p.hotspotPsk ? normalizeCrockford(p.hotspotPsk) : ''}.${normalizeCrockford(p.tlsFingerprint)}`;
  return { payload, url: `https://${host}${BRIDGE_QR_PATH}#${payload}` };
}

/** sessionStorage key the public `/b` page hands the scanned payload over in
 *  (never a query param — the secret must not land in history / logs). */
export const BRIDGE_QR_HANDOFF_KEY = 'pf.bridge.qr';
