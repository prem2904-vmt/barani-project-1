import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BRIDGE_LOCAL_SOURCE, BridgeLocalService, BridgeLocalTransport, electronTransport, hotspotTarget, lanTarget, localErrorCode, localUrl,
  nativeTransport,
} from './bridge-local.service';
import type { BridgeMdnsEvent, ElectronBridgesApi, LocalHttpRequest, PfBridgeLocalPlugin } from './bridge.models';
import { FX_IDENTITY, FX_MDNS_EVENT, FX_TICKET, VECTOR_FP, VECTOR_SERIAL } from './testing/bridge-fixtures';

const env = (data: unknown, success = true, error?: string) => ({ status: success ? 200 : 409, body: JSON.stringify(success ? { success, data } : { success, error, message: 'm' }) });

function fakeTransport(over: Partial<BridgeLocalTransport> = {}) {
  let found: ((e: BridgeMdnsEvent) => void) | null = null;
  let lost: ((e: BridgeMdnsEvent) => void) | null = null;
  const t: BridgeLocalTransport = {
    kind: 'native',
    capabilities: vi.fn(async () => ({ discovery: true, hotspot: true })),
    startDiscovery: vi.fn(async () => undefined),
    stopDiscovery: vi.fn(async () => undefined),
    onFound: vi.fn((cb) => { found = cb; return () => { found = null; }; }),
    onLost: vi.fn((cb) => { lost = cb; return () => { lost = null; }; }),
    joinHotspot: vi.fn(async () => true),
    leaveHotspot: vi.fn(async () => undefined),
    request: vi.fn(async (_r: LocalHttpRequest) => env(FX_IDENTITY)),
    ...over,
  };
  return { t, found: (e: BridgeMdnsEvent) => found?.(e), lost: (e: BridgeMdnsEvent) => lost?.(e) };
}

function svcWith(t: BridgeLocalTransport | null) {
  TestBed.configureTestingModule({ providers: [{ provide: BRIDGE_LOCAL_SOURCE, useValue: () => t }] });
  return TestBed.inject(BridgeLocalService);
}

describe('BridgeLocalService — web vs native / Electron', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('plain web (no transport): unavailable, every call is a safe "local_unavailable"', async () => {
    const s = svcWith(null);
    await s.ready;
    expect(s.available).toBe(false);
    expect(s.canJoinHotspot()).toBe(false);
    expect(await s.identity(hotspotTarget(VECTOR_FP))).toEqual({ ok: false, error: 'local_unavailable' });
    expect(await s.joinHotspot('x', null)).toEqual({ ok: false, error: 'local_unavailable' });
    await s.startDiscovery();
    expect(s.discovering()).toBe(false);
    await expect(s.leaveHotspot()).resolves.toBeUndefined();
  });

  it('the default source finds nothing in the test DOM (not native, no electronAPI)', () => {
    TestBed.configureTestingModule({});
    expect(TestBed.inject(BridgeLocalService).available).toBe(false);
  });

  it('a throwing source degrades to unavailable', () => {
    TestBed.configureTestingModule({ providers: [{ provide: BRIDGE_LOCAL_SOURCE, useValue: () => { throw new Error('boom'); } }] });
    expect(TestBed.inject(BridgeLocalService).available).toBe(false);
  });

  it('capabilities drive canJoinHotspot / canDiscover', async () => {
    const s = svcWith(fakeTransport().t);
    await s.ready;
    expect(s.canJoinHotspot()).toBe(true);
    expect(s.canDiscover()).toBe(true);
  });

  it('requests go to https://host:8443/local/v1/… with the normalised pin; the envelope unwraps', async () => {
    const f = fakeTransport();
    const s = svcWith(f.t);
    const r = await s.identity(hotspotTarget('5nrh-cgnq-4tr4-8ob2'));
    expect(r).toEqual({ ok: true, data: FX_IDENTITY });
    const req = (f.t.request as ReturnType<typeof vi.fn>).mock.calls[0][0] as LocalHttpRequest;
    expect(req).toMatchObject({ url: 'https://10.42.0.1:8443/local/v1/identity', method: 'GET', pinFingerprint: VECTOR_FP, viaHotspot: true });
    (f.t.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(env(FX_TICKET));
    await s.claimTicket(lanTarget({ host: '192.168.1.23', port: 8443, fingerprint: VECTOR_FP }), 'n'.repeat(43));
    const req2 = (f.t.request as ReturnType<typeof vi.fn>).mock.calls[1][0] as LocalHttpRequest;
    expect(req2).toMatchObject({ url: 'https://192.168.1.23:8443/local/v1/claim-ticket', method: 'POST', viaHotspot: false });
    expect(JSON.parse(req2.body!)).toEqual({ nonce: 'n'.repeat(43) });
  });

  it('Bridge error envelopes and transport errors keep their codes', async () => {
    const f = fakeTransport();
    const s = svcWith(f.t);
    (f.t.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(env(null, false, 'already_claimed'));
    expect(await s.activate(hotspotTarget(VECTOR_FP), { v: 1, serverUrl: 'https://x', bridgeId: 'b', bridgeName: 'B', tenantName: 'T', branchName: 'S' }))
      .toEqual({ ok: false, error: 'already_claimed', message: 'm' });
    (f.t.request as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('pin_mismatch: nope'));
    expect(await s.wifiStatus(hotspotTarget(VECTOR_FP))).toEqual({ ok: false, error: 'pin_mismatch' });
    (f.t.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ status: 502, body: '<html>' });
    expect((await s.wifiNetworks(hotspotTarget(VECTOR_FP))).ok).toBe(false);
  });

  it('verifiedIdentity refuses a different pin or serial', async () => {
    const f = fakeTransport();
    const s = svcWith(f.t);
    expect((await s.verifiedIdentity(hotspotTarget(VECTOR_FP), VECTOR_SERIAL)).ok).toBe(true);
    (f.t.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(env({ ...FX_IDENTITY, tlsFingerprint: 'AAAAAAAAAAAAAAAA' }));
    expect(await s.verifiedIdentity(hotspotTarget(VECTOR_FP), VECTOR_SERIAL)).toEqual({ ok: false, error: 'pin_mismatch' });
    (f.t.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(env({ ...FX_IDENTITY, serial: '10000000FFFF0000' }));
    expect(await s.verifiedIdentity(hotspotTarget(VECTOR_FP), VECTOR_SERIAL)).toEqual({ ok: false, error: 'serial_mismatch' });
  });

  it('discovery: found / lost update the list; stop unsubscribes', async () => {
    const f = fakeTransport();
    const s = svcWith(f.t);
    await s.startDiscovery();
    expect(s.discovering()).toBe(true);
    f.found(FX_MDNS_EVENT);
    f.found({ ...FX_MDNS_EVENT, txt: { v: '9' } });
    expect(s.discovered().map((d) => d.serial)).toEqual([VECTOR_SERIAL]);
    f.lost({ name: 'Prefrontal Bridge 1234' });
    expect(s.discovered()).toEqual([]);
    await s.stopDiscovery();
    expect(f.t.stopDiscovery).toHaveBeenCalled();
    expect(s.discovering()).toBe(false);
  });

  it('hotspot join: success, failure, and unavailable when the device cannot', async () => {
    const f = fakeTransport();
    const s = svcWith(f.t);
    await s.ready;
    expect(await s.joinHotspot('Prefrontal-Bridge-1234', 'PSK')).toEqual({ ok: true, data: true });
    (f.t.joinHotspot as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    expect(await s.joinHotspot('x', null)).toEqual({ ok: false, error: 'hotspot_join_failed' });
    TestBed.resetTestingModule();
    const s2 = svcWith(fakeTransport({ capabilities: vi.fn(async () => ({ discovery: true, hotspot: false })) }).t);
    await s2.ready;
    expect(await s2.joinHotspot('x', null)).toEqual({ ok: false, error: 'hotspot_unavailable' });
  });

  it('native + Electron adapters', async () => {
    const remove = vi.fn();
    const plugin: PfBridgeLocalPlugin = {
      capabilities: vi.fn(async () => ({ discovery: true, hotspot: true })),
      startDiscovery: vi.fn(async () => undefined), stopDiscovery: vi.fn(async () => undefined),
      joinHotspot: vi.fn(async () => ({ joined: true })), leaveHotspot: vi.fn(async () => undefined),
      request: vi.fn(async () => ({ status: 200, body: '{}' })),
      addListener: vi.fn(async () => ({ remove })),
    };
    const n = nativeTransport(plugin);
    expect(await n.joinHotspot('S', null)).toBe(true);
    expect(plugin.joinHotspot).toHaveBeenCalledWith({ ssid: 'S', psk: '' });
    const off = n.onFound(() => undefined);
    await Promise.resolve(); await Promise.resolve();
    off();
    expect(remove).toHaveBeenCalled();

    const api: ElectronBridgesApi = {
      discoverStart: vi.fn(async () => ({ ok: true })), discoverStop: vi.fn(async () => ({ ok: true })),
      onFound: vi.fn(() => () => undefined), onLost: vi.fn(() => () => undefined),
      localRequest: vi.fn(async () => ({ status: 200, body: '{}' })),
    };
    const e = electronTransport(api);
    expect(await e.capabilities()).toEqual({ discovery: true, hotspot: false });
    expect(await e.joinHotspot('x', null)).toBe(false);
  });

  it('error-code extraction and URLs', () => {
    expect(localErrorCode(new Error('pin_mismatch: certificate'))).toBe('pin_mismatch');
    expect(localErrorCode({ code: 'hotspot_join_failed' })).toBe('hotspot_join_failed');
    expect(localErrorCode('weird thing')).toBe('local_unreachable');
    expect(localUrl(hotspotTarget(VECTOR_FP), '/wifi')).toBe('https://10.42.0.1:8443/local/v1/wifi');
  });
});
