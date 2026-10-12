/**
 * Bridge API fixtures — the ONE place the app's mocks live while
 * prefrontal-mw builds the same contract (bridge-api v1, B.2/B.3/B.5).
 * Typed against bridge.models.ts so a contract change breaks compilation
 * here first. Used by the specs and by the local screenshot harness
 * (`mockBridgeApi`), never by the app at runtime.
 *
 * Shared vectors from B.0 / B.6 live here too.
 */
import type { InstrumentDto } from '../../instruments/instrument.models';
import type {
  BridgeClaimTicket, BridgeCommandDto, BridgeDetailDto, BridgeDto, BridgeMdnsEvent, ClaimResultDto,
  DetectedSourceDto, LocalIdentity, LocalWifiNetworks, NearbyBridgeDto,
} from '../bridge.models';

export const T0 = '2026-10-11T09:00:00Z';
/** Relative to the moment the fixtures load, so "3 min ago" reads true in screenshots. */
const LOADED_AT = Date.now();
const ago = (min: number) => new Date(LOADED_AT - min * 60_000).toISOString();

/** B.0 claim-secret vector: secret "7K2Q-F9MX-RT" normalises to this. */
export const VECTOR_CLAIM_SECRET = '7K2QF9MXRT';
/** B.0: Crockford(first 10 bytes of SHA-256("x")). Used as a TLS pin. */
export const VECTOR_FP = '5NRHCGNQ4TR480B2';
export const VECTOR_SERIAL = '10000000ABCD1234';
export const VECTOR_PSK = '8F3KQ2M9XW4T';
export const VECTOR_QR_URL = `https://lab.prefrontal.health/b#1.${VECTOR_SERIAL}.${VECTOR_CLAIM_SECRET}.${VECTOR_PSK}.${VECTOR_FP}`;

export const BRANCH_SALEM = { id: 'b0000000-0000-4000-8000-000000000001', name: 'Salem' };
export const BRANCH_ERODE = { id: 'b0000000-0000-4000-8000-000000000002', name: 'Erode' };

export const FX_BRIDGE_HAEM: BridgeDto = {
  id: '6f1c2a3b-0000-4000-8000-00000000b001',
  name: 'Haematology Bridge',
  serial: VECTOR_SERIAL,
  serialShort: 'ABCD-1234',
  model: 'pi5',
  version: '0.2.0',
  latestVersion: '0.2.1',
  status: 'online',
  branchId: BRANCH_SALEM.id,
  branchName: BRANCH_SALEM.name,
  lastSeenAt: ago(0.3),
  lastMessageAt: ago(4),
  queueTotal: 0,
  quarantineTotal: 3,
  network: { mode: 'client', ssid: 'LabWiFi', signal: 72, ipv4: '192.168.1.23' },
  analyzers: [
    { instrumentId: 'i0000000-0000-4000-8000-000000000001', name: 'Sysmex XN-350', linkState: 'listening', lastMessageAt: ago(4), queueDepth: 0 },
    { instrumentId: 'i0000000-0000-4000-8000-000000000002', name: 'Erba EM-200', linkState: 'connected', lastMessageAt: ago(26), queueDepth: 0 },
  ],
  newDetectedCount: 1,
  claimMethod: 'nearby',
  claimedAt: ago(60 * 24 * 3),
  claimedByName: 'Dr Arun',
  serialConflict: false,
};

export const FX_BRIDGE_BIOCHEM: BridgeDto = {
  id: '6f1c2a3b-0000-4000-8000-00000000b002',
  name: 'Biochemistry Bridge',
  serial: '10000000BEEF5678',
  serialShort: 'BEEF-5678',
  model: 'pi4',
  version: '0.2.1',
  latestVersion: '0.2.1',
  status: 'offline',
  branchId: BRANCH_SALEM.id,
  branchName: BRANCH_SALEM.name,
  lastSeenAt: ago(47),
  lastMessageAt: ago(52),
  queueTotal: 12,
  quarantineTotal: 0,
  network: { mode: 'client', ssid: 'Hospital-Staff', signal: 31, ipv4: '10.20.4.17' },
  analyzers: [
    { instrumentId: 'i0000000-0000-4000-8000-000000000003', name: 'Mindray BS-240', linkState: 'reconnecting', lastMessageAt: ago(52), queueDepth: 12 },
  ],
  newDetectedCount: 0,
  claimMethod: 'secret',
  claimedAt: ago(60 * 24 * 20),
  claimedByName: 'Priya S',
};

export const FX_BRIDGE_PENDING: BridgeDto = {
  id: '6f1c2a3b-0000-4000-8000-00000000b003',
  name: 'Bridge 9F21-0C44',
  serial: '100000009F210C44',
  serialShort: '9F21-0C44',
  status: 'pending',
  branchId: BRANCH_ERODE.id,
  branchName: BRANCH_ERODE.name,
  queueTotal: 0,
  quarantineTotal: 0,
  analyzers: [],
  newDetectedCount: 0,
  claimMethod: 'secret',
  claimedAt: ago(8),
  claimedByName: 'Dr Arun',
};

export const FX_BRIDGES: BridgeDto[] = [FX_BRIDGE_BIOCHEM, FX_BRIDGE_PENDING, FX_BRIDGE_HAEM];

export const FX_SOURCE_XN350: DetectedSourceDto = {
  id: 'd0000000-0000-4000-8000-000000000001',
  sourceKey: 'listen:6662:00:1b:2c:3d:4e:5f',
  kind: 'listen',
  port: 6662,
  peerIp: '192.168.50.101',
  peerMac: '00:1b:2c:3d:4e:5f',
  framing: 'astm',
  protocol: 'astm',
  header: { astm: { sender: 'XN-350^00-22^11001^^^^12345678', version: 'LIS2-A2' } },
  guess: { make: 'Sysmex', model: 'XN-350', profileKey: 'sysmex-xn-cbc', label: 'Sysmex XN-350' },
  messageCount: 4,
  quarantined: 4,
  firstSeenAt: ago(9),
  lastSeenAt: ago(2),
  state: 'new',
};

export const FX_COMMANDS: BridgeCommandDto[] = [
  { id: 'c0000000-0000-4000-8000-000000000003', type: 'refresh', state: 'succeeded', summary: {}, issuedAt: ago(30), issuedByName: 'Dr Arun', completedAt: ago(29.5) },
  { id: 'c0000000-0000-4000-8000-000000000002', type: 'wifi.set', state: 'failed', summary: { ssid: 'Lab-5G' }, result: { error: 'auth_failed', message: 'Secrets were required, but not provided' }, issuedAt: ago(120), issuedByName: 'Dr Arun', completedAt: ago(119) },
  { id: 'c0000000-0000-4000-8000-000000000001', type: 'wifi.set', state: 'succeeded', summary: { ssid: 'LabWiFi' }, result: { detail: { ssid: 'LabWiFi', ipv4: '192.168.1.23' } }, issuedAt: ago(121), issuedByName: 'Dr Arun', completedAt: ago(120.5) },
];

export const FX_BRIDGE_HAEM_DETAIL: BridgeDetailDto = {
  ...FX_BRIDGE_HAEM,
  settings: {
    fallbackMinutes: 5,
    analyzerLan: { address: '192.168.50.1/24', dhcpStart: '192.168.50.100', dhcpEnd: '192.168.50.199', extraAddresses: [] },
    detect: { enabled: true, listenPorts: [5000, 5001, 6661, 6662], reportLeases: true, quarantineMaxMessages: 1000, quarantineMaxDays: 7 },
  },
  detectedSources: [FX_SOURCE_XN350],
  recentCommands: FX_COMMANDS,
  tlsFingerprint: VECTOR_FP,
};

export const FX_NEARBY: NearbyBridgeDto[] = [
  { announcementId: 'a0000000-0000-4000-8000-000000000001', serial: '10000000C0DE7788', serialShort: 'C0DE-7788', model: 'pi5', version: '0.2.1', firstSeenAt: ago(6), lastSeenAt: ago(0.5), matchedBy: 'ipv4' },
];

/** Analyzers of the lab (InstrumentDto, additive bridge fields). */
export const FX_INSTRUMENTS: InstrumentDto[] = [
  {
    id: 'i0000000-0000-4000-8000-000000000001', branchId: BRANCH_SALEM.id, name: 'Sysmex XN-350', make: 'Sysmex', model: 'XN-350',
    profileKey: 'sysmex-xn-cbc', transport: 'tcp-server', isActive: true, status: 'online', hasDeviceKey: false,
    config: { transport: { type: 'tcp-server', port: 6661, host: '0.0.0.0' }, link: { type: 'mllp' }, parser: { type: 'hl7', hl7: { sampleIdField: 'OBR-3' } } },
    bridgeId: FX_BRIDGE_HAEM.id, bridgeName: FX_BRIDGE_HAEM.name, lastMessageAt: ago(4),
  },
  {
    id: 'i0000000-0000-4000-8000-000000000002', branchId: BRANCH_SALEM.id, name: 'Erba EM-200', make: 'Erba', model: 'EM-200',
    transport: 'tcp-client', isActive: true, status: 'online', hasDeviceKey: false,
    config: { transport: { type: 'tcp-client', host: '192.168.50.20', port: 5100, reconnectMs: 5000 }, link: { type: 'astm-e1381' }, parser: { type: 'astm', astm: { sampleIdField: 3, sampleIdComponent: 1 } } },
    bridgeId: FX_BRIDGE_HAEM.id, bridgeName: FX_BRIDGE_HAEM.name, lastMessageAt: ago(26),
  },
  {
    id: 'i0000000-0000-4000-8000-000000000004', branchId: BRANCH_SALEM.id, name: 'Horiba Yumizen H500', make: 'Horiba', model: 'H500',
    transport: 'tcp-server', isActive: true, status: 'never', hasDeviceKey: false,
    config: { transport: { type: 'tcp-server', port: 5150, host: '0.0.0.0' }, link: { type: 'astm-e1381' }, parser: { type: 'astm', astm: { sampleIdField: 3, sampleIdComponent: 1 } } },
  },
  {
    id: 'i0000000-0000-4000-8000-000000000005', branchId: BRANCH_SALEM.id, name: 'Urine strip reader', make: 'Dirui', model: 'H-100',
    transport: 'serial', isActive: true, status: 'online', hasDeviceKey: true,
    config: { transport: { type: 'serial', path: 'COM3', baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1, rtscts: false, xon: false }, link: { type: 'raw' }, parser: { type: 'text' } },
  },
];

export const FX_IDENTITY: LocalIdentity = {
  v: 1, serial: VECTOR_SERIAL, serialShort: 'ABCD-1234', model: 'pi5', version: '0.2.0',
  publicKey: 'Am_wO5SSQc4drdQ1GeaWDgqFtBppoFwygQOqK84VlMoW', alg: 'ES256', tlsFingerprint: VECTOR_FP,
  claimState: 'unclaimed', network: { mode: 'hotspot', ssid: 'Prefrontal-Bridge-1234' }, serverUrl: null, serverReachable: false, iface: 'hotspot',
};

export const FX_LOCAL_NETWORKS: LocalWifiNetworks = {
  networks: [
    { ssid: 'LabWiFi', signal: 78, security: 'wpa2-psk' },
    { ssid: 'Hospital-Staff', signal: 64, security: 'wpa2-eap' },
    { ssid: 'LabWiFi', signal: 40, security: 'wpa2-psk' },
    { ssid: 'Guest', signal: 52, security: 'open' },
    { ssid: '', signal: 30, security: 'wpa2-psk' },
  ],
  scannedAt: ago(1), cached: true,
};

export const FX_TICKET: BridgeClaimTicket = {
  v: 1, serial: VECTOR_SERIAL, publicKey: FX_IDENTITY.publicKey, alg: 'ES256', nonce: 'n'.repeat(43),
  issuedAt: T0, claimState: 'unclaimed', signature: 'oNVVuDsyFQbTr1YiZJcy9oig8lGtv2g_psqti3GU04j83H9pzqr2uB1WGdCkFkO7jL0OXoOxP0xjwrAL2t63CA',
};

export const FX_MDNS_EVENT: BridgeMdnsEvent = {
  name: 'Prefrontal Bridge 1234', host: 'prefrontal-bridge-1234.local', port: 8443,
  txt: { v: '1', sn: VECTOR_SERIAL, cs: 'u', ver: '0.2.0', fp: VECTOR_FP, ip: '192.168.1.23', md: 'pi5' },
  addresses: ['192.168.1.23', 'fe80::1'],
};

export function fxClaimResult(state: ClaimResultDto['state'], bridge: BridgeDto = FX_BRIDGE_PENDING): ClaimResultDto {
  return {
    state, bridge,
    activation: { v: 1, serverUrl: 'https://med-fetch-dev.prefrontal.health', bridgeId: bridge.id, bridgeName: bridge.name, tenantName: 'Micro World', branchName: bridge.branchName ?? '' },
  };
}

/** A mw `ApiResponse` envelope. */
export interface MockEnvelope { status: number; body: { success: boolean; data?: unknown; error?: string; message?: string } }
const ok = (data: unknown): MockEnvelope => ({ status: 200, body: { success: true, data } });
const err = (status: number, error: string, message: string): MockEnvelope => ({ status, body: { success: false, error, message } });

/**
 * A tiny in-memory B.2 server over the fixtures, for the screenshot harness
 * (Playwright `page.route`) and component specs. Returns null for paths it
 * doesn't own so the caller falls through to the real backend.
 */
export function mockBridgeApi(method: string, url: string, body?: unknown): MockEnvelope | null {
  const u = new URL(url, 'https://x');
  const p = u.pathname;
  const m = method.toUpperCase();
  if (/\/api\/instruments$/.test(p) && m === 'GET') return ok(FX_INSTRUMENTS);
  const ib = /\/api\/instruments\/([^/]+)\/bridge$/.exec(p);
  if (ib && m === 'PUT') {
    const inst = FX_INSTRUMENTS.find((i) => i.id === ib[1]);
    if (!inst) return err(404, 'not_found', 'Instrument not found');
    const bridgeId = (body as { bridgeId?: string | null })?.bridgeId ?? null;
    return ok({ ...inst, bridgeId, bridgeName: FX_BRIDGES.find((b) => b.id === bridgeId)?.name ?? null });
  }
  if (!p.includes('/api/bridges')) return null;
  if (/\/api\/bridges$/.test(p) && m === 'GET') return ok(FX_BRIDGES);
  if (/\/api\/bridges\/nearby$/.test(p)) return ok(FX_NEARBY);
  if (/\/api\/bridges\/claim\/nonce$/.test(p)) return ok({ nonce: 'n'.repeat(43), expiresAt: T0 });
  if (/\/api\/bridges\/claim$/.test(p)) {
    const req = body as { method?: string; claimSecret?: string } | undefined;
    if (req?.method === 'secret' && (req.claimSecret ?? '').replace(/-/g, '').toUpperCase() === 'BADC0DE000') {
      return err(404, 'claim_code_not_found', "Check the code. If the Bridge isn't online yet, scan its QR.");
    }
    return ok(req?.method === 'nearby' ? fxClaimResult('claimed', { ...FX_BRIDGE_HAEM, id: 'new-bridge', name: 'Bridge C0DE-7788', serialShort: 'C0DE-7788' }) : fxClaimResult('pending_device'));
  }
  const det = /\/api\/bridges\/([^/]+)(\/.*)?$/.exec(p);
  if (!det) return null;
  const id = det[1];
  const rest = det[2] ?? '';
  const base = FX_BRIDGES.find((b) => b.id === id);
  if (!base) return err(404, 'bridge_not_found', 'Bridge not found');
  const detail: BridgeDetailDto = id === FX_BRIDGE_HAEM.id ? FX_BRIDGE_HAEM_DETAIL : { ...base, detectedSources: [], recentCommands: [], settings: FX_BRIDGE_HAEM_DETAIL.settings, tlsFingerprint: VECTOR_FP };
  if (rest === '' && m === 'GET') return ok(detail);
  if (rest === '' && m === 'PATCH') return ok({ ...base, ...(body as object) });
  if (rest === '' && m === 'DELETE') return ok({ ok: true, discardedQueue: base.queueTotal ?? 0 });
  if (rest === '/commands' && m === 'POST') {
    const b = body as { type: string; payload?: Record<string, unknown> };
    return ok({ id: 'c-new', type: b.type, state: 'queued', summary: b.payload?.['ssid'] ? { ssid: b.payload['ssid'] } : {}, issuedAt: T0, issuedByName: 'You' });
  }
  if (rest.startsWith('/commands/') && m === 'GET') {
    return ok({ id: rest.split('/')[2], type: 'wifi.scan', state: 'succeeded', issuedAt: T0, completedAt: T0, result: { detail: { networks: FX_LOCAL_NETWORKS.networks } } });
  }
  if (rest === '/commands') return ok(detail.recentCommands ?? []);
  if (rest.startsWith('/detected-sources') && m === 'GET') return ok(detail.detectedSources ?? []);
  if (/\/detected-sources\/[^/]+\/link$/.test(rest)) return ok({ source: { ...FX_SOURCE_XN350, state: 'linked' }, instrument: FX_INSTRUMENTS[0] });
  if (/\/detected-sources\/[^/]+\/ignore$/.test(rest)) return ok({ ...FX_SOURCE_XN350, state: 'ignored' });
  return null;
}
