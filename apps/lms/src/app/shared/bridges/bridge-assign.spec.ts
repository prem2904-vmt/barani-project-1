import { describe, expect, it } from 'vitest';
import {
  BRIDGE_RESERVED_PORTS, assignFormFrom, bridgeConnectionText, configFor, configUnchanged, connectedViaOptions, supportsBridge,
  transportOptionsFor, upsertWithConfig, validateAssign,
} from './bridge-assign';
import { TRANSPORT_OPTIONS } from '../instruments/instrument-config';
import { FX_BRIDGES, FX_BRIDGE_HAEM, FX_INSTRUMENTS } from './testing/bridge-fixtures';

const [xn, erba, horiba, serial] = FX_INSTRUMENTS;

describe('analyzer ↔ Bridge assignment', () => {
  it('form from the saved config (listen / connect / serial default)', () => {
    expect(assignFormFrom(xn)).toEqual({ instrumentId: xn.id, mode: 'listen', port: 6661, host: '', framing: 'mllp' });
    expect(assignFormFrom(erba)).toEqual({ instrumentId: erba.id, mode: 'connect', port: 5100, host: '192.168.50.20', framing: 'astm-e1381' });
    expect(assignFormFrom(serial)).toMatchObject({ mode: 'listen', port: null });
    expect(supportsBridge(serial)).toBe(false);
    expect(supportsBridge(horiba)).toBe(true);
  });

  it('validation mirrors the server: port range, reserved, port_in_use, IPv4 host', () => {
    const others = FX_INSTRUMENTS.filter((i) => i.bridgeId === FX_BRIDGE_HAEM.id);
    expect(validateAssign({ ...assignFormFrom(horiba) }, others)).toEqual([]);
    expect(validateAssign({ ...assignFormFrom(horiba), port: 6661 }, others).map((i) => i.code)).toEqual(['port_in_use']);
    expect(validateAssign({ ...assignFormFrom(xn), port: 6661 }, others)).toEqual([]); // its own port
    for (const p of BRIDGE_RESERVED_PORTS) expect(validateAssign({ ...assignFormFrom(horiba), port: p }, others).map((i) => i.code)).toEqual(['port_reserved']);
    expect(validateAssign({ ...assignFormFrom(horiba), port: 70000 }, others).map((i) => i.code)).toEqual(['invalid_port']);
    expect(validateAssign({ ...assignFormFrom(erba), host: 'analyzer.local' }, others).map((i) => i.code)).toEqual(['invalid_host']);
    expect(validateAssign({ instrumentId: '', mode: 'listen', port: 5000, host: '', framing: 'auto' }, others).map((i) => i.code)).toEqual(['required']);
  });

  it('config keeps the rest and matches the parser to the framing', () => {
    const c = configFor({ instrumentId: serial.id, mode: 'listen', port: 5200, host: '', framing: 'mllp' }, serial.config);
    expect(c.transport).toEqual({ type: 'tcp-server', port: 5200, host: '0.0.0.0' });
    expect(c.link.type).toBe('mllp');
    expect(c.parser).toMatchObject({ type: 'hl7', hl7: { sampleIdField: 'OBR-3' } });
    const k = configFor({ instrumentId: erba.id, mode: 'connect', port: 5100, host: ' 192.168.50.21 ', framing: 'astm-e1381' }, erba.config);
    expect(k.transport).toEqual({ type: 'tcp-client', host: '192.168.50.21', port: 5100, reconnectMs: 5000 });
    expect(k.parser).toEqual(erba.config.parser);
    expect(configUnchanged(assignFormFrom(xn), xn)).toBe(true);
    expect(configUnchanged({ ...assignFormFrom(xn), port: 6663 }, xn)).toBe(false);
    expect(upsertWithConfig(xn, k)).toMatchObject({ name: xn.name, profileKey: 'sysmex-xn-cbc', config: k, isActive: true });
  });

  it('words + "Connected through" options', () => {
    expect(bridgeConnectionText(xn.config)).toBe('Listens on port 6661');
    expect(bridgeConnectionText(erba.config)).toBe('Connects to 192.168.50.20:5100');
    const opts = connectedViaOptions(FX_BRIDGES);
    expect(opts[0]).toMatchObject({ value: '', label: 'This computer' });
    expect(opts.map((o) => o.value)).not.toContain(FX_BRIDGES.find((b) => b.status === 'pending')!.id);
    expect(transportOptionsFor(TRANSPORT_OPTIONS, true).map((o) => o.value)).toEqual(['tcp-server', 'tcp-client']);
    expect(transportOptionsFor(TRANSPORT_OPTIONS, false)).toHaveLength(4);
  });
});
