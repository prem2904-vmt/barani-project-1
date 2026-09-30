import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INSTRUMENT_BRIDGE_SOURCE, InstrumentBridgeService } from './instrument-bridge.service';
import type { ElectronInstrumentsApi } from './instrument.models';

function withSource(api: Partial<ElectronInstrumentsApi> | undefined): InstrumentBridgeService {
  TestBed.configureTestingModule({ providers: [{ provide: INSTRUMENT_BRIDGE_SOURCE, useValue: () => api as ElectronInstrumentsApi | undefined }] });
  return TestBed.inject(InstrumentBridgeService);
}

describe('InstrumentBridgeService — web vs Electron', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('web (no preload bridge): unavailable, every call is a safe no-op', async () => {
    const b = withSource(undefined);
    expect(b.available).toBe(false);
    expect(await b.list()).toEqual([]);
    expect(await b.listSerialPorts()).toEqual([]);
    expect(await b.rawLog('i1')).toEqual([]);
    expect(await b.preview('x')).toBeNull();
    expect(await b.listenStart({ transport: {} })).toEqual({ error: expect.stringContaining('desktop app') });
    expect((await b.pair({ instrumentId: 'i', deviceKey: 'k', apiUrl: 'u' })).ok).toBe(false);
    const off = b.onStatus(() => undefined);
    expect(typeof off).toBe('function');
    off();
  });

  it('default source reads window.electronAPI.instruments (absent in the test DOM)', () => {
    TestBed.configureTestingModule({});
    expect(TestBed.inject(InstrumentBridgeService).available).toBe(false);
  });

  it('Electron: calls pass through; a throwing bridge degrades instead of crashing the screen', async () => {
    const unsub = vi.fn();
    const api: Partial<ElectronInstrumentsApi> = {
      list: vi.fn(async () => [{ instrumentId: 'i1', apiUrl: 'u', pairedAt: 't', status: null }]),
      listSerialPorts: vi.fn(async () => { throw new Error('no serialport'); }),
      pair: vi.fn(async () => ({ ok: true })),
      onStatus: vi.fn(() => unsub),
      listenStart: vi.fn(async () => ({ sessionId: 's1' })),
    };
    const b = withSource(api);
    expect(b.available).toBe(true);
    expect((await b.list())[0].instrumentId).toBe('i1');
    expect(await b.listSerialPorts()).toEqual([]);
    expect(await b.pair({ instrumentId: 'i1', deviceKey: 'k', apiUrl: 'https://x' })).toEqual({ ok: true });
    expect(api.pair).toHaveBeenCalledWith({ instrumentId: 'i1', deviceKey: 'k', apiUrl: 'https://x' });
    expect(await b.listenStart({ transport: { type: 'serial' } })).toEqual({ sessionId: 's1' });
    b.onStatus(() => undefined)();
    expect(unsub).toHaveBeenCalled();
  });
});
