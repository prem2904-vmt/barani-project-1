/**
 * Analyzer ↔ Bridge assignment (bridge-api v1, B.2 `PUT /api/instruments/{id}/bridge`
 * + the unchanged instrument config contract). A Bridge reaches analyzers over
 * its analyzer LAN only: it LISTENS on a port (`tcp-server`, the analyzer
 * connects to the Bridge) or CONNECTS out (`tcp-client`, the analyzer is the
 * server). Serial / folder stay "This computer". The server re-checks every
 * rule (`port_in_use`, `port_reserved`, `transport_not_supported_on_bridge`);
 * this mirror only lets the form say so before the round-trip.
 */
import type { InstrumentConfig, InstrumentDto, InstrumentUpsert, LinkType, ParserConfig } from '../instruments/instrument.models';
import { isIpv4 } from './bridge-mdns';

/** B.2: ports the Bridge itself uses. */
export const BRIDGE_RESERVED_PORTS: readonly number[] = [22, 53, 67, 68, 80, 443, 5353, 8443];

export type BridgeConnMode = 'listen' | 'connect';

export interface BridgeAssignForm {
  instrumentId: string;
  mode: BridgeConnMode;
  port: number | null;
  host: string;
  framing: LinkType;
}

export const FRAMING_OPTIONS: { value: LinkType; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto-detect', hint: 'Work it out from the first byte' },
  { value: 'astm-e1381', label: 'ASTM', hint: 'Most haematology / chemistry analyzers' },
  { value: 'mllp', label: 'HL7 (MLLP)', hint: 'Newer analyzers and middleware' },
  { value: 'raw', label: 'Plain text', hint: 'Printouts — one result per line' },
];

export function supportsBridge(i: Pick<InstrumentDto, 'config' | 'transport'>): boolean {
  const t = i.config?.transport?.type ?? i.transport;
  return t === 'tcp-server' || t === 'tcp-client';
}

/** The form for an instrument as it is today (sensible defaults for serial / folder). */
export function assignFormFrom(i: InstrumentDto): BridgeAssignForm {
  const t = i.config?.transport as { type?: string; port?: number; host?: string } | undefined;
  const framing = (i.config?.link?.type ?? 'auto') as LinkType;
  if (t?.type === 'tcp-client') return { instrumentId: i.id, mode: 'connect', port: t.port ?? null, host: t.host ?? '', framing };
  if (t?.type === 'tcp-server') return { instrumentId: i.id, mode: 'listen', port: t.port ?? null, host: '', framing };
  return { instrumentId: i.id, mode: 'listen', port: null, host: '', framing };
}

export interface AssignIssue { field: 'instrumentId' | 'port' | 'host'; code: string; message: string }

/** `others` = the analyzers already on this Bridge (their listen ports). */
export function validateAssign(f: BridgeAssignForm, others: readonly InstrumentDto[]): AssignIssue[] {
  const out: AssignIssue[] = [];
  if (!f.instrumentId) out.push({ field: 'instrumentId', code: 'required', message: 'Pick the analyzer.' });
  const p = f.port;
  if (p == null || !Number.isInteger(p) || p < 1 || p > 65535) {
    out.push({ field: 'port', code: 'invalid_port', message: 'Enter a port from 1 to 65535.' });
  } else if (f.mode === 'listen' && BRIDGE_RESERVED_PORTS.includes(p)) {
    out.push({ field: 'port', code: 'port_reserved', message: 'That port is reserved on the Bridge. Pick another port.' });
  } else if (f.mode === 'listen' && others.some((o) => o.id !== f.instrumentId
      && o.config?.transport?.type === 'tcp-server' && (o.config.transport as { port?: number }).port === p)) {
    out.push({ field: 'port', code: 'port_in_use', message: 'Another analyzer on this Bridge already listens on that port.' });
  }
  if (f.mode === 'connect' && !isIpv4(f.host.trim())) {
    out.push({ field: 'host', code: 'invalid_host', message: "Enter the analyzer's IP address, e.g. 192.168.50.20." });
  }
  return out;
}

function parserFor(framing: LinkType, base: ParserConfig | undefined): ParserConfig {
  const p: ParserConfig = { ...(base ?? { type: 'auto' }) };
  if (framing === 'mllp') p.type = 'hl7';
  else if (framing === 'astm-e1381') p.type = 'astm';
  if (p.type === 'hl7' && !p.hl7) p.hl7 = { sampleIdField: 'OBR-3' };
  if (p.type === 'astm' && !p.astm) p.astm = { sampleIdField: 3, sampleIdComponent: 1 };
  return p;
}

/** The new config JSON (transport + link + parser) — everything else kept. */
export function configFor(f: BridgeAssignForm, base: InstrumentConfig | undefined): InstrumentConfig {
  const transport = f.mode === 'listen'
    ? { type: 'tcp-server' as const, port: f.port as number, host: '0.0.0.0' }
    : { type: 'tcp-client' as const, host: f.host.trim(), port: f.port as number, reconnectMs: 5000 };
  return {
    ...(base ?? {}),
    transport,
    link: { ...(base?.link ?? {}), type: f.framing },
    parser: parserFor(f.framing, base?.parser),
  } as InstrumentConfig;
}

/** True when the instrument's saved config already matches the form. */
export function configUnchanged(f: BridgeAssignForm, i: InstrumentDto): boolean {
  const cur = assignFormFrom(i);
  return supportsBridge(i) && cur.mode === f.mode && cur.port === f.port && cur.framing === f.framing
    && (f.mode === 'listen' || cur.host.trim() === f.host.trim());
}

export function upsertWithConfig(i: InstrumentDto, config: InstrumentConfig): InstrumentUpsert {
  return { name: i.name, make: i.make ?? null, model: i.model ?? null, serialNumber: i.serialNumber ?? null, profileKey: i.profileKey ?? null, config, isActive: i.isActive };
}

/** "Listens on port 6661" / "Connects to 192.168.50.20:5100". */
export function bridgeConnectionText(cfg: Partial<InstrumentConfig> | null | undefined): string {
  const t = cfg?.transport as { type?: string; port?: number; host?: string } | undefined;
  if (t?.type === 'tcp-server') return `Listens on port ${t.port ?? '—'}`;
  if (t?.type === 'tcp-client') return `Connects to ${t.host || '—'}:${t.port ?? '—'}`;
  return 'Not a network connection';
}

// ── Instrument editor: "Connected through" ─────────────────────────────────

/** '' = This computer (a lab PC with the desktop app), else a Bridge id. */
export function connectedViaOptions(bridges: readonly { id: string; name: string; status?: string; branchName?: string | null }[]): { value: string; label: string; hint?: string }[] {
  return [
    { value: '', label: 'This computer', hint: 'A lab PC running the Prefrontal desktop app' },
    ...bridges.filter((b) => b.status !== 'pending').map((b) => ({ value: b.id, label: `Prefrontal Bridge · ${b.name}`, hint: b.branchName ?? undefined })),
  ];
}

/** Through a Bridge only the network transports exist (listen / connect). */
export function transportOptionsFor<T extends { value: string; label: string; hint: string }>(all: readonly T[], viaBridge: boolean): T[] {
  if (!viaBridge) return all.slice();
  return all.filter((o) => o.value === 'tcp-server' || o.value === 'tcp-client').map((o) => ({
    ...o,
    hint: o.value === 'tcp-server' ? 'The analyzer connects to the Bridge (192.168.50.1)' : 'The Bridge connects to the analyzer',
  }));
}
