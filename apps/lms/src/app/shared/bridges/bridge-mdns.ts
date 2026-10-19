/**
 * mDNS / Bonjour discovery (bridge-api v1, B.5) — pure parsing of what the
 * native plugin / Electron main report. Service `_prefrontal-bridge._tcp`,
 * port 8443, instance "Prefrontal Bridge <last4>", TXT:
 *
 *   v=1  sn=<16 hex>  cs=u|p|c  ver=<x.y.z>  fp=<16 Crockford>  ip=<IPv4>  md=<model>
 *
 * TXT is unauthenticated: `fp` is trust-on-first-use and the identity is
 * re-verified through `GET /local/v1/identity` over the pinned channel.
 */
import { isBridgeSerial, isCrockford, normalizeCrockford, serialShortOf } from './bridge-qr';
import { BRIDGE_LOCAL_HTTPS_PORT, BridgeMdnsEvent, DiscoveredBridge, LocalClaimState } from './bridge.models';

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export function isIpv4(s: unknown): s is string { return typeof s === 'string' && IPV4_RE.test(s); }

function claimStateOf(cs: string | undefined): LocalClaimState | null {
  switch ((cs ?? '').toLowerCase()) {
    case 'u': return 'unclaimed';
    case 'p': return 'pending';
    case 'c': return 'claimed';
    default: return null;
  }
}

/** Lower-case the TXT keys (Bonjour keys are case-insensitive) and keep strings only. */
export function normalizeTxt(txt: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!txt || typeof txt !== 'object') return out;
  for (const [k, v] of Object.entries(txt)) {
    if (typeof v === 'string') out[k.toLowerCase()] = v;
    else if (ArrayBuffer.isView(v)) out[k.toLowerCase()] = new TextDecoder().decode(v as Uint8Array);
  }
  return out;
}

/**
 * A discovery event → a usable Bridge, or null when it isn't a v1 Bridge we
 * can talk to (unknown TXT version, bad serial / pin, no IPv4 to reach).
 */
export function parseDiscovered(e: BridgeMdnsEvent | null | undefined): DiscoveredBridge | null {
  if (!e) return null;
  const txt = normalizeTxt(e.txt as Record<string, unknown> | null | undefined);
  if (txt['v'] !== '1') return null;
  const serial = (txt['sn'] ?? '').toUpperCase();
  if (!isBridgeSerial(serial)) return null;
  const fp = normalizeCrockford(txt['fp']);
  if (fp.length !== 16 || !isCrockford(fp)) return null;
  const claimState = claimStateOf(txt['cs']);
  if (!claimState) return null;
  // Prefer the TXT ip (the Bridge's own address on this interface), then an
  // IPv4 the resolver returned. Link-local IPv6 needs a scope id the WebView
  // can't express, so an IPv6-only Bridge is not reachable from here.
  const addrs = (e.addresses ?? []).filter(isIpv4);
  const host = isIpv4(txt['ip']) ? txt['ip'] : addrs[0] ?? (isIpv4(e.host) ? e.host : null);
  if (!host) return null;
  const port = Number.isInteger(e.port) && (e.port as number) > 0 ? (e.port as number) : BRIDGE_LOCAL_HTTPS_PORT;
  return {
    serial,
    serialShort: serialShortOf(serial),
    name: e.name || `Prefrontal Bridge ${serial.slice(-4)}`,
    host,
    port,
    claimState,
    version: txt['ver'] || undefined,
    model: txt['md'] || undefined,
    fingerprint: fp,
  };
}

/** Upsert by serial (a Bridge re-announces on every TXT change). */
export function upsertDiscovered(list: readonly DiscoveredBridge[], b: DiscoveredBridge): DiscoveredBridge[] {
  const i = list.findIndex((x) => x.serial === b.serial);
  if (i === -1) return [...list, b].sort((a, z) => a.serial.localeCompare(z.serial));
  const next = list.slice();
  next[i] = b;
  return next;
}

/** A `bridgeLost` names the instance (and maybe the TXT): drop by serial or name. */
export function removeDiscovered(list: readonly DiscoveredBridge[], e: BridgeMdnsEvent): DiscoveredBridge[] {
  const sn = normalizeTxt(e.txt as Record<string, unknown> | null | undefined)['sn']?.toUpperCase();
  return list.filter((x) => (sn ? x.serial !== sn : x.name !== e.name));
}
