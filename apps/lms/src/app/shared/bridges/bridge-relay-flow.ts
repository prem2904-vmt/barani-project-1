/**
 * "Set up a new Bridge's Wi-Fi" — the phone relay (bridge-api v1, D.2 / E.1).
 * Native only (the phone joins the Bridge's own hotspot). The order matters:
 * every SERVER call happens before the hotspot join (the phone may lose its
 * internet while on the hotspot, esp. iOS), and the server is polled only
 * after leaving it.
 *
 *  1 claim (secret + serial) while still online → reservation + activation
 *  2 join the hotspot  (ssid derived from the serial, psk from the QR)
 *  3 GET /local/v1/identity over the pin from the QR; serial must match
 *  4 GET /local/v1/wifi/networks
 *  5 the user picks a network + enters its password       (UI)
 *  6 POST /local/v1/activate (activation) → POST /local/v1/wifi
 *  7 leave the hotspot
 *  8 poll GET /api/bridges/{id} until online — 3 min, then guidance
 *
 * Plain class with injected ports so the state machine is unit-tested
 * without Angular or a device.
 */
import { signal } from '@angular/core';
import { hotspotTarget, LocalResult } from './bridge-local.service';
import type { BridgeQrPayload } from './bridge-qr';
import type {
  BridgeActivation, BridgeDto, ClaimRequest, ClaimResultDto, LocalIdentity, LocalTarget, LocalWifiAccepted,
  LocalWifiNetworks, LocalActivateResult, WifiCredentials, WifiNetwork,
} from './bridge.models';

export type RelayStep =
  | 'idle' | 'claiming' | 'joining' | 'verifying' | 'scanning' | 'pick_network'
  | 'sending' | 'leaving' | 'waiting_online' | 'online' | 'timeout' | 'failed';

export interface RelayState {
  step: RelayStep;
  /** Error code (bridge-status.ts bridgeErrorText) when `failed`. */
  error?: string;
  errorMessage?: string;
  /** The step that failed (progress UI). */
  failedAt?: RelayStep;
  networks?: WifiNetwork[];
  bridge?: BridgeDto;
  identity?: LocalIdentity;
}

export interface RelayPorts {
  claim(body: ClaimRequest): Promise<ClaimResultDto>;
  getBridge(id: string): Promise<BridgeDto>;
  joinHotspot(ssid: string, psk: string | null): Promise<LocalResult<true>>;
  leaveHotspot(): Promise<void>;
  verifiedIdentity(t: LocalTarget, serial: string): Promise<LocalResult<LocalIdentity>>;
  wifiNetworks(t: LocalTarget, rescan?: boolean): Promise<LocalResult<LocalWifiNetworks>>;
  activate(t: LocalTarget, a: BridgeActivation): Promise<LocalResult<LocalActivateResult>>;
  setWifi(t: LocalTarget, c: WifiCredentials): Promise<LocalResult<LocalWifiAccepted>>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export const RELAY_ONLINE_TIMEOUT_MS = 180_000;
export const RELAY_POLL_MS = 5_000;

function codeOf(e: unknown): { code: string; message?: string } {
  const any = e as { code?: string; message?: string } | null;
  return { code: any?.code || 'request_failed', message: any?.message };
}

export class BridgeRelayFlow {
  readonly state = signal<RelayState>({ step: 'idle' });
  private activation: BridgeActivation | null = null;
  private claimed: ClaimResultDto | null = null;
  private bridgeId: string | null = null;
  private cancelled = false;
  private readonly target: LocalTarget;

  constructor(private readonly ports: RelayPorts, private readonly qr: BridgeQrPayload, private readonly opts: { name?: string; branchId?: string } = {}) {
    this.target = hotspotTarget(qr.tlsFingerprint);
  }

  cancel(): void { this.cancelled = true; }

  /**
   * Steps 1–4. Ends on `pick_network` or `failed`. Pass the claim result when
   * the Bridge was already added (e.g. "Set up its Wi-Fi" right after Add) —
   * the claim is not repeated.
   */
  async start(existing?: ClaimResultDto | null): Promise<void> {
    this.cancelled = false;
    let claim: ClaimResultDto;
    if (existing?.activation) {
      claim = existing;
    } else if (this.bridgeId && this.activation && this.claimed) {
      claim = this.claimed;
    } else {
      // 1 — claim while the phone is still online.
      this.state.set({ step: 'claiming' });
      try {
        claim = await this.ports.claim({ method: 'secret', claimSecret: this.qr.claimSecret, serial: this.qr.serial, name: this.opts.name, branchId: this.opts.branchId });
      } catch (e) {
        const { code, message } = codeOf(e);
        return this.fail(code, message);
      }
    }
    this.claimed = claim;
    this.bridgeId = claim.bridge.id;
    this.activation = claim.activation ?? null;
    if (claim.state === 'claimed' && claim.bridge.status === 'online') {
      // Already online (it reached the server by itself) — nothing to relay.
      this.state.set({ step: 'online', bridge: claim.bridge });
      return;
    }
    if (!this.activation) return this.fail('request_failed', 'The server did not return the activation details.');
    if (this.cancelled) return;
    // 2 — join the Bridge's own hotspot.
    this.state.set({ step: 'joining', bridge: claim.bridge });
    const joined = await this.ports.joinHotspot(this.qr.hotspotSsid, this.qr.hotspotPsk);
    if (!joined.ok) return this.fail(joined.error, joined.message);
    // 3 — identity over the QR's pin.
    this.state.set({ step: 'verifying', bridge: claim.bridge });
    const id = await this.ports.verifiedIdentity(this.target, this.qr.serial);
    if (!id.ok) { await this.ports.leaveHotspot(); return this.fail(id.error, id.message); }
    // 4 — the networks the Bridge saw before it started its hotspot.
    await this.scan(false, id.data, claim.bridge);
  }

  /** "Rescan" drops the hotspot ~10 s on the Bridge (single radio). */
  async rescan(): Promise<void> {
    await this.scan(true, this.state().identity, this.state().bridge);
  }

  private async scan(rescan: boolean, identity?: LocalIdentity, bridge?: BridgeDto): Promise<void> {
    this.state.set({ step: 'scanning', identity, bridge });
    const nets = await this.ports.wifiNetworks(this.target, rescan);
    if (!nets.ok) { await this.ports.leaveHotspot(); return this.fail(nets.error, nets.message); }
    this.state.set({ step: 'pick_network', identity, bridge, networks: sortNetworks(nets.data.networks ?? []) });
  }

  /** Steps 6–8 with the user's choice. */
  async sendWifi(creds: WifiCredentials): Promise<void> {
    const prev = this.state();
    if (!this.activation || !this.bridgeId) return this.fail('request_failed');
    this.state.set({ ...prev, step: 'sending' });
    const act = await this.ports.activate(this.target, this.activation);
    if (!act.ok && act.error !== 'already_claimed') { await this.ports.leaveHotspot(); return this.fail(act.error, act.message); }
    const wifi = await this.ports.setWifi(this.target, creds);
    if (!wifi.ok) { this.state.set({ ...prev, step: 'pick_network', error: wifi.error, errorMessage: wifi.message }); return; }
    // 7 — leave, so the phone is back on its own network for the server.
    this.state.set({ ...prev, step: 'leaving', error: undefined });
    await this.ports.leaveHotspot();
    await this.waitOnline();
  }

  /** Step 8 (also the "Check again" button after a timeout). */
  async waitOnline(): Promise<void> {
    if (!this.bridgeId) return;
    const start = this.ports.now();
    this.state.update((s) => ({ ...s, step: 'waiting_online', error: undefined }));
    while (!this.cancelled && this.ports.now() - start < RELAY_ONLINE_TIMEOUT_MS) {
      try {
        const b = await this.ports.getBridge(this.bridgeId);
        if (b.status === 'online') { this.state.set({ step: 'online', bridge: b }); return; }
      } catch { /* the phone may still be switching networks */ }
      await this.ports.sleep(RELAY_POLL_MS);
    }
    if (!this.cancelled) this.state.update((s) => ({ ...s, step: 'timeout' }));
  }

  private fail(error: string, errorMessage?: string): void {
    this.state.update((s) => ({ ...s, step: 'failed', error, errorMessage, failedAt: s.step === 'failed' ? s.failedAt : s.step }));
  }
}

/** In-use first, then strongest; one row per SSID; hidden (empty) SSIDs dropped. */
export function sortNetworks(list: readonly WifiNetwork[]): WifiNetwork[] {
  const best = new Map<string, WifiNetwork>();
  for (const n of list) {
    if (!n?.ssid) continue;
    const prev = best.get(n.ssid);
    if (!prev || (n.signal ?? -999) > (prev.signal ?? -999) || n.inUse) best.set(n.ssid, n);
  }
  return [...best.values()].sort((a, b) => Number(!!b.inUse) - Number(!!a.inUse) || (b.signal ?? -999) - (a.signal ?? -999) || a.ssid.localeCompare(b.ssid));
}
