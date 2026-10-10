import { describe, expect, it } from 'vitest';
import { isIpv4, normalizeTxt, parseDiscovered, removeDiscovered, upsertDiscovered } from './bridge-mdns';
import { FX_MDNS_EVENT, VECTOR_FP, VECTOR_SERIAL } from './testing/bridge-fixtures';

describe('mDNS TXT → DiscoveredBridge (B.5)', () => {
  it('a v1 Bridge parses; the TXT ip wins over resolver addresses', () => {
    expect(parseDiscovered({ ...FX_MDNS_EVENT, addresses: ['192.168.1.99'] })).toEqual({
      serial: VECTOR_SERIAL, serialShort: 'ABCD-1234', name: 'Prefrontal Bridge 1234', host: '192.168.1.23', port: 8443,
      claimState: 'unclaimed', version: '0.2.0', model: 'pi5', fingerprint: VECTOR_FP,
    });
  });

  it('claim state letters u / p / c', () => {
    for (const [cs, want] of [['u', 'unclaimed'], ['p', 'pending'], ['c', 'claimed']] as const) {
      expect(parseDiscovered({ ...FX_MDNS_EVENT, txt: { ...FX_MDNS_EVENT.txt!, cs } })?.claimState).toBe(want);
    }
  });

  it('keys are case-insensitive; Uint8Array values decode', () => {
    expect(normalizeTxt({ SN: 'X', FP: new TextEncoder().encode('Y') as unknown as string })).toEqual({ sn: 'X', fp: 'Y' });
  });

  it('no TXT ip → first IPv4 address; IPv6-only → unreachable (null)', () => {
    const { ip, ...txt } = FX_MDNS_EVENT.txt!; void ip;
    expect(parseDiscovered({ ...FX_MDNS_EVENT, txt, addresses: ['fe80::1', '10.0.0.7'] })?.host).toBe('10.0.0.7');
    expect(parseDiscovered({ ...FX_MDNS_EVENT, txt, addresses: ['fe80::1'], host: 'bridge.local' })).toBeNull();
  });

  it.each([
    ['unknown TXT version', { v: '2' }],
    ['bad serial', { sn: 'nope' }],
    ['bad pin', { fp: 'SHORT' }],
    ['bad claim state', { cs: 'x' }],
  ])('%s → ignored', (_l, patch) => {
    expect(parseDiscovered({ ...FX_MDNS_EVENT, txt: { ...FX_MDNS_EVENT.txt!, ...patch } })).toBeNull();
  });

  it('missing port → 8443; upsert by serial; lost by serial or name', () => {
    const b = parseDiscovered({ ...FX_MDNS_EVENT, port: null })!;
    expect(b.port).toBe(8443);
    let list = upsertDiscovered([], b);
    list = upsertDiscovered(list, { ...b, version: '0.2.1' });
    expect(list).toHaveLength(1);
    expect(list[0].version).toBe('0.2.1');
    expect(removeDiscovered(list, { name: 'x', txt: { sn: VECTOR_SERIAL.toLowerCase() } })).toHaveLength(0);
    expect(removeDiscovered(list, { name: 'Prefrontal Bridge 1234' })).toHaveLength(0);
    expect(removeDiscovered(list, { name: 'Other' })).toHaveLength(1);
  });

  it('isIpv4', () => {
    expect(isIpv4('10.42.0.1')).toBe(true);
    expect(isIpv4('256.0.0.1')).toBe(false);
    expect(isIpv4('fe80::1')).toBe(false);
  });
});
