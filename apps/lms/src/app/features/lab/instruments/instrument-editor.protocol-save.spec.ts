import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import { renderBandPage } from '../../admin/admin-band.spec-helpers';
import { PlatformService } from '../../../core/services/platform.service';
import { INSTRUMENT_BRIDGE_SOURCE } from '../../../shared/instruments/instrument-bridge.service';
import type { InstrumentDto } from '../../../shared/instruments/instrument.models';
import { InstrumentEditorComponent } from './instrument-editor.component';

const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
const T = { ackTimeoutMs: 15000, frameTimeoutMs: 30000, idleMs: 1500 };
const BASE = {
  astm: { sampleIdField: 3, sampleIdComponent: 1 }, hl7: { sampleIdField: 'OBR-3' },
  text: { linePattern: 'a', sampleIdPattern: 'b', qcPattern: 'c', fixedColumns: null },
};
const mk = (config: unknown): InstrumentDto => ({
  id: 'i1', name: 'Analyzer', make: null, model: null, serialNumber: null, isActive: true, transport: 'tcp-server', profileKey: null, config,
}) as unknown as InstrumentDto;
const TCP = { type: 'tcp-server', port: 5001, host: '0.0.0.0' };

const PRESETS: Record<string, unknown> = {
  hbpro: { transport: TCP, link: { type: 'stx-etx', ...T }, parser: { ...BASE, type: 'lifedx-hbpro',
    hbpro: { fields: [{ code: 'HbA1c', start: 63, end: 69, unit: '%', decimals: 1 }], sampleIdStart: 4, sampleIdEnd: 12, sampleIdPath: 'r[0]' } } },
  sinocare: { transport: TCP, link: { type: 'sinocare-sn', ...T, replyMode: 'echo', ackJson: '{"code":0}' }, parser: { ...BASE, type: 'sinocare-fhir',
    sinocare: { sampleIdField: 'position', sampleIdPath: 'patient.id' } } },
  hl7: { transport: TCP, link: { type: 'mllp', ...T }, parser: { ...BASE, type: 'hl7', hl7: { sampleIdField: 'PID-3', sampleIdPath: 'OBX[1]-3' } } },
};

describe('Instrument editor — Code mapping save keeps the protocol', () => {
  afterEach(() => TestBed.resetTestingModule());

  for (const [name, config] of Object.entries(PRESETS)) {
    it(`${name}: load → Code mapping step → save PUTs the identical config`, async () => {
      const dto = mk(config);
      const p = renderBandPage(InstrumentEditorComponent, {
        getFor: (u) => (u === '/api/instruments/i1' ? dto : u.startsWith('/api/instruments/messages') ? { items: [], total: 0, page: 1, pageSize: 20 } : []),
        providers: [
          { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'i1' }) } } },
          { provide: PlatformService, useValue: { getApiUrl: () => 'https://api.example', isElectron: () => false } },
          { provide: INSTRUMENT_BRIDGE_SOURCE, useValue: () => undefined },
        ],
      });
      await flush();
      p.api.put.mockImplementation(((u: string, body: { config: unknown }) => of(u.endsWith('/code-maps') ? [] : { ...dto, config: body.config })) as never);
      p.cmp.go('mapping'); p.f.detectChanges();
      p.cmp.dirty.set(true);
      await p.cmp.save();
      const put = p.api.put.mock.calls.find((c) => (c as unknown[])[0] === '/api/instruments/i1') as unknown[];
      expect(JSON.parse(JSON.stringify((put[1] as { config: unknown }).config))).toEqual(JSON.parse(JSON.stringify(config)));
      // a second save (from the freshly applied saved dto) is stable too
      await p.cmp.save();
      const last = p.api.put.mock.calls.filter((c) => (c as unknown[])[0] === '/api/instruments/i1').pop() as unknown[];
      expect(JSON.parse(JSON.stringify((last[1] as { config: unknown }).config))).toEqual(JSON.parse(JSON.stringify(config)));
    });
  }
});
