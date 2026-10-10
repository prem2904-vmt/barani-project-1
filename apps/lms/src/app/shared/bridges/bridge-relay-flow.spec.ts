import { describe, expect, it, vi } from 'vitest';
import { BridgeRelayFlow, RELAY_ONLINE_TIMEOUT_MS, RelayPorts, sortNetworks } from './bridge-relay-flow';
import { parseBridgeQr } from './bridge-qr';
import { FX_BRIDGE_PENDING, FX_IDENTITY, FX_LOCAL_NETWORKS, VECTOR_QR_URL, fxClaimResult } from './testing/bridge-fixtures';

const qr = (() => { const p = parseBridgeQr(VECTOR_QR_URL); if (!p.ok) throw new Error('fixture'); return p.payload; })();

function ports(over: Partial<RelayPorts> = {}) {
  let t = 0;
  const p: RelayPorts = {
    claim: vi.fn(async () => fxClaimResult('pending_device')),
    getBridge: vi.fn(async () => ({ ...FX_BRIDGE_PENDING, status: 'online' as const })),
    joinHotspot: vi.fn(async () => ({ ok: true as const, data: true as const })),
    leaveHotspot: vi.fn(async () => undefined),
    verifiedIdentity: vi.fn(async () => ({ ok: true as const, data: FX_IDENTITY })),
    wifiNetworks: vi.fn(async () => ({ ok: true as const, data: FX_LOCAL_NETWORKS })),
    activate: vi.fn(async () => ({ ok: true as const, data: { ok: true, claimState: 'pending' as const } })),
    setWifi: vi.fn(async () => ({ ok: true as const, data: { accepted: true, willDisconnect: true, retryAfterSec: 90 } })),
    sleep: vi.fn(async (ms: number) => { t += ms; }),
    now: () => t,
    ...over,
  };
  return p;
}

describe('BridgeRelayFlow — phone relay state machine', () => {
  it('happy path: claim (online) → join → verify pin → networks → activate + wifi → leave → online', async () => {
    const p = ports();
    const f = new BridgeRelayFlow(p, qr, { name: 'Haem', branchId: 'br1' });
    await f.start();
    expect(p.claim).toHaveBeenCalledWith({ method: 'secret', claimSecret: qr.claimSecret, serial: qr.serial, name: 'Haem', branchId: 'br1' });
    expect(p.joinHotspot).toHaveBeenCalledWith('Prefrontal-Bridge-1234', qr.hotspotPsk);
    expect((p.verifiedIdentity as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ host: '10.42.0.1', port: 8443, fingerprint: qr.tlsFingerprint, viaHotspot: true });
    expect(f.state().step).toBe('pick_network');
    expect(f.state().networks!.map((n) => n.ssid)).toEqual(['LabWiFi', 'Hospital-Staff', 'Guest']);
    // The claim happened BEFORE the hotspot join (server calls first).
    const order = [p.claim, p.joinHotspot].map((m) => (m as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]);
    expect(order[0]).toBeLessThan(order[1]);

    await f.sendWifi({ ssid: 'LabWiFi', security: 'wpa2-psk', psk: 'secret123' });
    expect(p.activate).toHaveBeenCalledWith(expect.anything(), fxClaimResult('pending_device').activation);
    expect(p.setWifi).toHaveBeenCalledWith(expect.anything(), { ssid: 'LabWiFi', security: 'wpa2-psk', psk: 'secret123' });
    expect(p.leaveHotspot).toHaveBeenCalled();
    // The server is polled only AFTER leaving the hotspot.
    const leaveAt = (p.leaveHotspot as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect((p.getBridge as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeGreaterThan(leaveAt);
    expect(f.state().step).toBe('online');
  });

  it('already claimed + online → nothing to relay', async () => {
    const p = ports({ claim: vi.fn(async () => fxClaimResult('claimed', { ...FX_BRIDGE_PENDING, status: 'online' })) });
    const f = new BridgeRelayFlow(p, qr);
    await f.start();
    expect(f.state().step).toBe('online');
    expect(p.joinHotspot).not.toHaveBeenCalled();
  });

  it('a passed claim result skips the claim', async () => {
    const p = ports();
    await new BridgeRelayFlow(p, qr).start(fxClaimResult('pending_device'));
    expect(p.claim).not.toHaveBeenCalled();
    expect(p.joinHotspot).toHaveBeenCalled();
  });

  it('claim error → failed at claiming with the code', async () => {
    const p = ports({ claim: vi.fn(async () => { throw Object.assign(new Error('Too many'), { code: 'too_many_pending' }); }) });
    const f = new BridgeRelayFlow(p, qr);
    await f.start();
    expect(f.state()).toMatchObject({ step: 'failed', error: 'too_many_pending', failedAt: 'claiming' });
  });

  it('hotspot join refused → failed at joining', async () => {
    const f = new BridgeRelayFlow(ports({ joinHotspot: vi.fn(async () => ({ ok: false as const, error: 'hotspot_join_failed' })) }), qr);
    await f.start();
    expect(f.state()).toMatchObject({ step: 'failed', error: 'hotspot_join_failed', failedAt: 'joining' });
  });

  it('a different Bridge on the hotspot (pin mismatch) → leaves the hotspot and fails', async () => {
    const p = ports({ verifiedIdentity: vi.fn(async () => ({ ok: false as const, error: 'pin_mismatch' })) });
    const f = new BridgeRelayFlow(p, qr);
    await f.start();
    expect(p.leaveHotspot).toHaveBeenCalled();
    expect(f.state()).toMatchObject({ step: 'failed', error: 'pin_mismatch', failedAt: 'verifying' });
  });

  it('a rejected Wi-Fi (invalid_wifi) returns to the picker with the error; activate "already_claimed" is fine', async () => {
    const p = ports({
      activate: vi.fn(async () => ({ ok: false as const, error: 'already_claimed' })),
      setWifi: vi.fn(async () => ({ ok: false as const, error: 'invalid_wifi' })),
    });
    const f = new BridgeRelayFlow(p, qr);
    await f.start();
    await f.sendWifi({ ssid: 'X', security: 'wpa2-psk', psk: 'short' });
    expect(f.state()).toMatchObject({ step: 'pick_network', error: 'invalid_wifi' });
    expect(p.leaveHotspot).not.toHaveBeenCalled();
  });

  it('never online within 3 minutes → timeout (Check again re-polls)', async () => {
    const p = ports({ getBridge: vi.fn(async () => ({ ...FX_BRIDGE_PENDING, status: 'pending' as const })) });
    const f = new BridgeRelayFlow(p, qr);
    await f.start();
    await f.sendWifi({ ssid: 'LabWiFi', security: 'wpa2-psk', psk: 'secret123' });
    expect(f.state().step).toBe('timeout');
    expect((p.getBridge as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(RELAY_ONLINE_TIMEOUT_MS / 5000 - 1);
    (p.getBridge as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ...FX_BRIDGE_PENDING, status: 'online' });
    await f.waitOnline();
    expect(f.state().step).toBe('online');
  });

  it('rescan asks the Bridge to rescan', async () => {
    const p = ports();
    const f = new BridgeRelayFlow(p, qr);
    await f.start();
    await f.rescan();
    expect(p.wifiNetworks).toHaveBeenLastCalledWith(expect.anything(), true);
  });
});

describe('sortNetworks', () => {
  it('in-use first, then strongest, one row per SSID, hidden SSIDs dropped', () => {
    expect(sortNetworks([
      { ssid: 'B', signal: 40, security: 'open' },
      { ssid: 'A', signal: 90, security: 'wpa2-psk' },
      { ssid: 'C', signal: 10, security: 'wpa2-psk', inUse: true },
      { ssid: 'A', signal: 20, security: 'wpa2-psk' },
      { ssid: '', signal: 99, security: 'open' },
    ]).map((n) => n.ssid)).toEqual(['C', 'A', 'B']);
  });
});
