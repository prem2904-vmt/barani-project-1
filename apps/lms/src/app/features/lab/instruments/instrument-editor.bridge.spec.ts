import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import { renderBandPage } from '../../admin/admin-band.spec-helpers';
import { PlatformService } from '../../../core/services/platform.service';
import { INSTRUMENT_BRIDGE_SOURCE } from '../../../shared/instruments/instrument-bridge.service';
import type { InstrumentDto } from '../../../shared/instruments/instrument.models';
import { FX_BRIDGES, FX_BRIDGE_HAEM, FX_INSTRUMENTS } from '../../../shared/bridges/testing/bridge-fixtures';
import { InstrumentEditorComponent } from './instrument-editor.component';
import { InstrumentsListComponent } from './instruments-list.component';

const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };

function render(dto: InstrumentDto, bridges: unknown[] = FX_BRIDGES) {
  return renderBandPage(InstrumentEditorComponent, {
    getFor: (u) => {
      if (u === `/api/instruments/${dto.id}`) return dto;
      if (u === '/api/bridges') return bridges;
      if (u.startsWith('/api/instruments/messages')) return { items: [], total: 0, page: 1, pageSize: 20 };
      return [];
    },
    providers: [
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: dto.id }) } } },
      { provide: PlatformService, useValue: { getApiUrl: () => 'https://api.example', isElectron: () => false } },
      { provide: INSTRUMENT_BRIDGE_SOURCE, useValue: () => undefined },
    ],
  });
}

describe('Instrument editor — "Connected through: This computer | Prefrontal Bridge"', () => {
  afterEach(() => TestBed.resetTestingModule());

  const serialOne = FX_INSTRUMENTS[3];
  const horiba = FX_INSTRUMENTS[2];

  it('no Bridges in the lab → the field stays hidden (unchanged editor)', async () => {
    const p = render(serialOne, []);
    await flush();
    p.cmp.go('connection'); p.f.detectChanges();
    expect(p.cmp.showConnectedVia()).toBe(false);
    expect(p.el.textContent).not.toContain('Connected through');
    expect(p.cmp.transportOptions().map((o: { value: string }) => o.value)).toEqual(['serial', 'tcp-server', 'tcp-client', 'folder']);
  });

  it('picking a Bridge: only listen / connect transports, serial switches to listen, wording says Bridge', async () => {
    const p = render(serialOne);
    await flush();
    p.cmp.go('connection'); p.f.detectChanges();
    expect(p.el.textContent).toContain('Connected through');
    expect(p.cmp.connectedViaOptions().map((o: { label: string }) => o.label)).toContain('Prefrontal Bridge · Haematology Bridge');
    p.cmp.setConnectedVia(FX_BRIDGE_HAEM.id); p.f.detectChanges();
    expect(p.cmp.transportOptions().map((o: { value: string }) => o.value)).toEqual(['tcp-server', 'tcp-client']);
    expect(p.cmp.form().transport).toBe('tcp-server');
    expect(p.el.textContent).toContain('Port the Bridge listens on');
  });

  it('save on a Bridge calls PUT /api/instruments/{id}/bridge after the normal save; back to this computer sends null', async () => {
    const p = render(horiba);
    await flush();
    p.api.put.mockImplementation(((u: string, body: { bridgeId?: string | null }) => of(u.endsWith('/bridge') ? { ...horiba, bridgeId: body.bridgeId } : horiba)) as never);
    p.cmp.setConnectedVia(FX_BRIDGE_HAEM.id);
    await p.cmp.save();
    const calls = p.api.put.mock.calls.map((c) => (c as unknown[])[0]);
    expect(calls).toEqual([`/api/instruments/${horiba.id}`, `/api/instruments/${horiba.id}/bridge`]);
    expect((p.api.put.mock.calls[1] as unknown[])[1]).toEqual({ bridgeId: FX_BRIDGE_HAEM.id });

    TestBed.resetTestingModule();
    const onBridge = { ...horiba, bridgeId: FX_BRIDGE_HAEM.id, bridgeName: FX_BRIDGE_HAEM.name };
    const q = render(onBridge);
    await flush();
    expect(q.cmp.connectedVia()).toBe(FX_BRIDGE_HAEM.id);
    q.api.put.mockImplementation(((u: string) => of(u.endsWith('/bridge') ? { ...horiba, bridgeId: null } : onBridge)) as never);
    q.cmp.setConnectedVia('');
    await q.cmp.save();
    expect(q.api.put.mock.calls[1]).toEqual([`/api/instruments/${horiba.id}/bridge`, { bridgeId: null }]);
  });

  it('unchanged connection → no extra bridge call', async () => {
    const p = render(horiba);
    await flush();
    p.api.put.mockImplementation((() => of(horiba)) as never);
    await p.cmp.save();
    expect(p.api.put.mock.calls.map((c) => (c as unknown[])[0])).toEqual([`/api/instruments/${horiba.id}`]);
  });

  it('Instruments list says "via ‹Bridge›"', async () => {
    const p = renderBandPage(InstrumentsListComponent, { getFor: (u) => (u === '/api/instruments' ? FX_INSTRUMENTS : []) });
    await flush(); p.f.detectChanges();
    const col = p.cmp.colDefs().find((c: { colId: string }) => c.colId === 'connection');
    const html = col.cellRenderer({ data: FX_INSTRUMENTS[0] });
    expect(html).toContain('via Haematology Bridge');
  });
});
