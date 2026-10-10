import { Injectable, InjectionToken, OnDestroy, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { PfBridgeLocal } from './bridge-local.plugin';
import { parseDiscovered, removeDiscovered, upsertDiscovered } from './bridge-mdns';
import { normalizeCrockford } from './bridge-qr';
import {
  BRIDGE_HOTSPOT_HOST, BRIDGE_LOCAL_HTTPS_PORT, BridgeActivation, BridgeClaimTicket, BridgeMdnsEvent,
  DiscoveredBridge, ElectronBridgesApi, LocalActivateResult, LocalEnvelope, LocalHttpRequest, LocalHttpResponse,
  LocalIdentity, LocalTarget, LocalWifiAccepted, LocalWifiNetworks, LocalWifiStatus, PfBridgeLocalPlugin,
  WifiCredentials,
} from './bridge.models';

/**
 * One local transport, whatever the platform: the Capacitor plugin on
 * iOS / Android, `window.electronAPI.bridges` on the desktop. Plain web has
 * none (mixed content + no mDNS), so it only ever uses the server paths.
 */
export interface BridgeLocalTransport {
  kind: 'native' | 'electron';
  capabilities(): Promise<{ discovery: boolean; hotspot: boolean }>;
  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;
  onFound(cb: (e: BridgeMdnsEvent) => void): () => void;
  onLost(cb: (e: BridgeMdnsEvent) => void): () => void;
  joinHotspot(ssid: string, psk: string | null): Promise<boolean>;
  leaveHotspot(): Promise<void>;
  request(req: LocalHttpRequest): Promise<LocalHttpResponse>;
}

export function nativeTransport(p: PfBridgeLocalPlugin): BridgeLocalTransport {
  const listen = (ev: 'bridgeFound' | 'bridgeLost', cb: (e: BridgeMdnsEvent) => void) => {
    let handle: { remove: () => unknown } | null = null;
    let gone = false;
    void p.addListener(ev, cb).then((h) => { if (gone) void h.remove(); else handle = h; }).catch(() => undefined);
    return () => { gone = true; if (handle) void handle.remove(); };
  };
  return {
    kind: 'native',
    capabilities: () => p.capabilities(),
    startDiscovery: () => p.startDiscovery(),
    stopDiscovery: () => p.stopDiscovery(),
    onFound: (cb) => listen('bridgeFound', cb),
    onLost: (cb) => listen('bridgeLost', cb),
    joinHotspot: async (ssid, psk) => (await p.joinHotspot({ ssid, psk: psk ?? '' })).joined === true,
    leaveHotspot: () => p.leaveHotspot(),
    request: (req) => p.request(req),
  };
}

export function electronTransport(a: ElectronBridgesApi): BridgeLocalTransport {
  return {
    kind: 'electron',
    capabilities: async () => ({ discovery: true, hotspot: false }),
    startDiscovery: async () => { await a.discoverStart(); },
    stopDiscovery: async () => { await a.discoverStop(); },
    onFound: (cb) => a.onFound(cb) ?? (() => undefined),
    onLost: (cb) => a.onLost(cb) ?? (() => undefined),
    joinHotspot: async () => false,
    leaveHotspot: async () => undefined,
    request: (req) => a.localRequest(req),
  };
}

/** Picks the transport. Specs provide their own double (no vi.mock). */
export const BRIDGE_LOCAL_SOURCE = new InjectionToken<() => BridgeLocalTransport | null>('BRIDGE_LOCAL_SOURCE', {
  providedIn: 'root',
  factory: () => () => {
    if (typeof window === 'undefined') return null;
    try { if (Capacitor.isNativePlatform()) return nativeTransport(PfBridgeLocal); } catch { /* not native */ }
    const api = (window as unknown as { electronAPI?: { bridges?: ElectronBridgesApi } }).electronAPI?.bridges;
    return api && typeof api.localRequest === 'function' ? electronTransport(api) : null;
  },
});

export type LocalResult<T> = { ok: true; data: T } | { ok: false; error: string; message?: string };

/** The Bridge's hotspot address (B.3), reached through the joined network. */
export function hotspotTarget(fingerprint: string): LocalTarget {
  return { host: BRIDGE_HOTSPOT_HOST, port: BRIDGE_LOCAL_HTTPS_PORT, fingerprint: normalizeCrockford(fingerprint), viaHotspot: true };
}

/** A Bridge found over mDNS on the lab LAN (TOFU pin from TXT). */
export function lanTarget(b: Pick<DiscoveredBridge, 'host' | 'port' | 'fingerprint'>): LocalTarget {
  return { host: b.host, port: b.port || BRIDGE_LOCAL_HTTPS_PORT, fingerprint: normalizeCrockford(b.fingerprint), viaHotspot: false };
}

export function localUrl(t: LocalTarget, path: string): string {
  return `https://${t.host}:${t.port}/local/v1${path}`;
}

/** Native errors arrive as `Error('pin_mismatch: …')` / `{ code }` — keep the code. */
export function localErrorCode(e: unknown): string {
  const any = e as { code?: unknown; message?: unknown } | null;
  if (any && typeof any.code === 'string' && /^[a-z_]+$/.test(any.code)) return any.code;
  const m = typeof any?.message === 'string' ? any.message : String(e ?? '');
  const head = /^([a-z_]+)(:|$)/.exec(m.trim());
  return head ? head[1] : 'local_unreachable';
}

/**
 * The Bridge local API (bridge-api v1, B.3) from the app. HTTPS :8443 with the
 * pinned self-signed cert (the pin = QR `F`, else mDNS TXT `fp` TOFU). Never
 * throws: every call returns a {@link LocalResult}, and on the plain web
 * `available` is false and calls answer `local_unavailable`.
 */
@Injectable({ providedIn: 'root' })
export class BridgeLocalService implements OnDestroy {
  private readonly source = inject(BRIDGE_LOCAL_SOURCE);
  private readonly transport: BridgeLocalTransport | null = (() => { try { return this.source(); } catch { return null; } })();

  /** Native or Electron: local discovery + requests exist. */
  readonly available = this.transport !== null;
  readonly kind = this.transport?.kind ?? null;
  /** The device can join a Bridge hotspot (native only; resolved async). */
  readonly canJoinHotspot = signal(false);
  readonly canDiscover = signal(false);
  readonly discovering = signal(false);
  readonly discovered = signal<DiscoveredBridge[]>([]);
  readonly ready: Promise<void>;

  private offFound: (() => void) | null = null;
  private offLost: (() => void) | null = null;

  constructor() {
    this.ready = this.transport
      ? this.transport.capabilities().then(
          (c) => { this.canDiscover.set(!!c?.discovery); this.canJoinHotspot.set(!!c?.hotspot); },
          () => undefined)
      : Promise.resolve();
  }

  async startDiscovery(): Promise<void> {
    const t = this.transport; if (!t || this.discovering()) return;
    this.discovered.set([]);
    this.offFound = t.onFound((e) => {
      const b = parseDiscovered(e);
      if (b) this.discovered.update((l) => upsertDiscovered(l, b));
    });
    this.offLost = t.onLost((e) => this.discovered.update((l) => removeDiscovered(l, e)));
    this.discovering.set(true);
    try { await t.startDiscovery(); } catch { this.discovering.set(false); }
  }

  async stopDiscovery(): Promise<void> {
    this.offFound?.(); this.offLost?.(); this.offFound = this.offLost = null;
    if (!this.discovering()) return;
    this.discovering.set(false);
    try { await this.transport?.stopDiscovery(); } catch { /* already stopped */ }
  }

  ngOnDestroy(): void { void this.stopDiscovery(); }

  async joinHotspot(ssid: string, psk: string | null): Promise<LocalResult<true>> {
    const t = this.transport;
    if (!t) return { ok: false, error: 'local_unavailable' };
    if (!this.canJoinHotspot()) return { ok: false, error: 'hotspot_unavailable' };
    try { return (await t.joinHotspot(ssid, psk)) ? { ok: true, data: true } : { ok: false, error: 'hotspot_join_failed' }; }
    catch (e) { const c = localErrorCode(e); return { ok: false, error: c === 'local_unreachable' ? 'hotspot_join_failed' : c }; }
  }

  async leaveHotspot(): Promise<void> {
    try { await this.transport?.leaveHotspot(); } catch { /* best effort */ }
  }

  identity(t: LocalTarget): Promise<LocalResult<LocalIdentity>> { return this.call<LocalIdentity>(t, 'GET', '/identity'); }
  claimTicket(t: LocalTarget, nonce: string): Promise<LocalResult<BridgeClaimTicket>> { return this.call<BridgeClaimTicket>(t, 'POST', '/claim-ticket', { nonce }); }
  activate(t: LocalTarget, activation: BridgeActivation): Promise<LocalResult<LocalActivateResult>> { return this.call<LocalActivateResult>(t, 'POST', '/activate', activation); }
  wifiNetworks(t: LocalTarget, rescan = false): Promise<LocalResult<LocalWifiNetworks>> { return this.call<LocalWifiNetworks>(t, 'GET', rescan ? '/wifi/networks?rescan=1' : '/wifi/networks', undefined, rescan ? 30_000 : undefined); }
  setWifi(t: LocalTarget, creds: WifiCredentials): Promise<LocalResult<LocalWifiAccepted>> { return this.call<LocalWifiAccepted>(t, 'POST', '/wifi', creds); }
  wifiStatus(t: LocalTarget): Promise<LocalResult<LocalWifiStatus>> { return this.call<LocalWifiStatus>(t, 'GET', '/wifi/status'); }

  /**
   * Identity over the pinned channel, checked against what we expected: the
   * Bridge's own `tlsFingerprint` must equal the pin we used and the serial
   * must be the one from the QR / TXT (a different Bridge on the same hotspot
   * address is refused).
   */
  async verifiedIdentity(t: LocalTarget, expectSerial: string): Promise<LocalResult<LocalIdentity>> {
    const r = await this.identity(t);
    if (!r.ok) return r;
    if (normalizeCrockford(r.data.tlsFingerprint) !== normalizeCrockford(t.fingerprint)) return { ok: false, error: 'pin_mismatch' };
    if ((r.data.serial ?? '').toUpperCase() !== expectSerial.toUpperCase()) return { ok: false, error: 'serial_mismatch' };
    return r;
  }

  private async call<T>(t: LocalTarget, method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 10_000): Promise<LocalResult<T>> {
    const tr = this.transport;
    if (!tr) return { ok: false, error: 'local_unavailable' };
    let res: LocalHttpResponse;
    try {
      res = await tr.request({
        url: localUrl(t, path), method, body: body === undefined ? undefined : JSON.stringify(body),
        pinFingerprint: normalizeCrockford(t.fingerprint), viaHotspot: t.viaHotspot, timeoutMs,
      });
    } catch (e) {
      return { ok: false, error: localErrorCode(e) };
    }
    let env: LocalEnvelope<T> | null = null;
    try { env = JSON.parse(res?.body ?? '') as LocalEnvelope<T>; } catch { env = null; }
    if (!env || typeof env !== 'object') return { ok: false, error: 'local_unreachable', message: `HTTP ${res?.status ?? 0}` };
    if (!env.success) return { ok: false, error: env.error || `http_${res.status}`, message: env.message };
    return { ok: true, data: env.data as T };
  }
}
