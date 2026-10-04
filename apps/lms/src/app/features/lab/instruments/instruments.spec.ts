import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderBandPage } from '../../admin/admin-band.spec-helpers';
import { PlatformService } from '../../../core/services/platform.service';
import { DialogService } from '../../../core/services/dialog.service';
import { INSTRUMENT_BRIDGE_SOURCE } from '../../../shared/instruments/instrument-bridge.service';
import type { ElectronInstrumentsApi, InstrumentDto, ListenEvent } from '../../../shared/instruments/instrument.models';
import { emptyInstrumentForm, buildInstrumentConfig } from '../../../shared/instruments/instrument-config';
import { InstrumentsListComponent, searchInstruments } from './instruments-list.component';
import { InstrumentEditorComponent } from './instrument-editor.component';
import { LabSettingsHubComponent } from '../lab-settings-hub/lab-settings-hub.component';
import { ROUTE_ACCESS } from '../../../core/auth/route-access';

const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
const primaries = (el: HTMLElement) => el.querySelectorAll('.pf-hb-btn--primary, .nd-btn--primary').length;

function instrument(extra: Partial<InstrumentDto> = {}): InstrumentDto {
  const f = emptyInstrumentForm();
  f.serial.path = 'COM3';
  return {
    id: 'i1', name: 'Sysmex XN', make: 'Sysmex', model: 'XN-550', serialNumber: 'S1', transport: 'serial',
    config: buildInstrumentConfig(f), isActive: true, status: 'online', lastSeenAt: '2026-09-30T05:00:00Z',
    hasDeviceKey: false, unmatchedCount: 2, ...extra,
  };
}

function fakeBridge() {
  let listen: ((e: ListenEvent) => void) | null = null;
  const api = {
    list: vi.fn(async () => []),
    pair: vi.fn(async () => ({ ok: true })),
    unpair: vi.fn(async () => ({ ok: true })),
    status: vi.fn(async () => []),
    onStatus: vi.fn(() => () => undefined),
    rawLog: vi.fn(async () => []),
    listSerialPorts: vi.fn(async () => [{ path: 'COM3', manufacturer: 'FTDI' }, { path: 'COM4' }]),
    listenStart: vi.fn(async () => ({ sessionId: 's1' })),
    listenStop: vi.fn(async () => ({ raw: '', detect: undefined as never, messages: [] })),
    onListen: vi.fn((cb: (e: ListenEvent) => void) => { listen = cb; return () => { listen = null; }; }),
    preview: vi.fn(async () => ({ raw: 'x', detect: undefined as never, messages: [] })),
    reload: vi.fn(async () => ({ ok: true, changed: true, restarted: false })),
  };
  return { api, emit: (e: ListenEvent) => listen?.(e) };
}

describe('Instruments — routes + hub tile', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('the settings page is gated like its lab-settings neighbours; the unmatched list on result-entry perms', () => {
    expect(ROUTE_ACCESS['/admin/instruments']).toEqual({ perms: ['manage_lab_settings'], module: 'lab' });
    expect(ROUTE_ACCESS['/admin/instruments'].perms).toEqual(ROUTE_ACCESS['/admin/microbiology'].perms);
    expect(ROUTE_ACCESS['/lab/analyzer-results']).toEqual({ perms: ['enter_result', 'edit_result'], module: 'lab' });
  });

  it('Lab settings hub shows an Instruments tile (SVG icon) → /admin/instruments', () => {
    const p = renderBandPage(LabSettingsHubComponent);
    const tile = Array.from(p.el.querySelectorAll<HTMLAnchorElement>('.pf-lsh__tile')).find((a) => a.textContent!.includes('Instruments'))!;
    expect(tile).toBeTruthy();
    expect(tile.getAttribute('href')).toBe('/admin/instruments');
    expect(tile.querySelector('svg path')).not.toBeNull();
  });
});

describe('Instruments list', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('band search + grid card + side card whose ONE primary is "Add instrument"', async () => {
    const p = renderBandPage(InstrumentsListComponent, { getFor: (u) => (u === '/api/instruments' ? [instrument()] : []) });
    await flush(); p.f.detectChanges();
    expect(p.bandInput()).not.toBeNull();
    expect(primaries(p.el)).toBe(1);
    expect(p.el.querySelector('.pf-inl__side .nd-btn--primary')!.textContent).toContain('Add instrument');
    expect(p.el.querySelector('.pf-inl__main.nd-card .nd-card__icon svg')).not.toBeNull();
    expect(p.cmp.statusCounts().find((s: { label: string }) => s.label === 'Online').n).toBe(1);
    expect(p.cmp.unmatchedTotal()).toBe(2);
  });

  it('search matches name, make, model and the connection summary', () => {
    const rows = [instrument(), instrument({ id: 'i2', name: 'Mindray', make: 'Mindray', model: 'BC-5150' })];
    expect(searchInstruments(rows, 'xn-550').map((r) => r.id)).toEqual(['i1']);
    expect(searchInstruments(rows, 'COM3').length).toBe(2);
  });
});

describe('Instrument editor — web vs Electron', () => {
  afterEach(() => TestBed.resetTestingModule());

  function render(opts: { id?: string; bridge?: Partial<ElectronInstrumentsApi>; dto?: InstrumentDto;
    imageMaps?: unknown[]; tests?: unknown[] } = {}) {
    const route = { snapshot: { paramMap: convertToParamMap(opts.id ? { id: opts.id } : { id: 'new' }) } };
    const dto = opts.dto ?? instrument();
    return renderBandPage(InstrumentEditorComponent, {
      getFor: (u) => {
        if (u === `/api/instruments/${dto.id}`) return dto;
        if (u.endsWith('/code-maps')) return [];
        if (u.endsWith('/image-maps')) return opts.imageMaps ?? [];
        if (u.startsWith('/api/tests')) return opts.tests ?? [];
        if (u.startsWith('/api/instruments/messages')) return { items: [], total: 0, page: 1, pageSize: 20 };
        return [];
      },
      providers: [
        { provide: ActivatedRoute, useValue: route },
        { provide: PlatformService, useValue: { getApiUrl: () => 'https://api.example', isElectron: () => !!opts.bridge } },
        { provide: INSTRUMENT_BRIDGE_SOURCE, useValue: () => opts.bridge as ElectronInstrumentsApi | undefined },
      ],
    });
  }

  it('new instrument: ONE primary (Create), the pill = name + step tabs, no Status tab', async () => {
    const p = render();
    await flush(); p.f.detectChanges();
    expect(primaries(p.el)).toBe(1);
    expect(p.el.querySelector('.pf-ie-save')!.textContent).toContain('Create instrument');
    const tabs = Array.from(p.el.querySelectorAll('pf-hero-band .nd-tabs__item')).map((b) => b.textContent!.trim());
    expect(tabs).toEqual(['Basics', 'Connection', 'Protocol', 'Listen', 'Code mapping', 'Device']);
    expect(p.el.querySelector('pf-hero-band .nd-ctx__primary')!.textContent).toContain('New instrument');
  });

  it('web: Listen explains it runs on the paired desktop app; no Start button', async () => {
    const p = render();
    await flush();
    p.cmp.go('listen'); p.f.detectChanges();
    expect(p.el.textContent).toContain('Listening runs on the paired desktop app');
    expect(Array.from(p.el.querySelectorAll('button')).some((b) => b.textContent!.includes('Start listening'))).toBe(false);
  });

  it('create: POSTs the contract config built from the wizard, then the code maps', async () => {
    const p = render();
    await flush();
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    p.api.post.mockImplementation((() => of(instrument({ id: 'new-1' }))) as never);
    p.api.put.mockImplementation((() => of([])) as never);
    p.cmp.patch({ name: 'CBC counter' });
    p.cmp.patchSerial({ path: 'COM7', baudRate: 19200 });
    p.cmp.loadCbc();
    await p.cmp.save();
    const [url, body] = p.api.post.mock.calls[0] as unknown as [string, any];
    expect(url).toBe('/api/instruments');
    expect(body.name).toBe('CBC counter');
    expect(body.config.transport).toMatchObject({ type: 'serial', path: 'COM7', baudRate: 19200 });
    expect(body.config.parser.type).toBe('auto');
    const [mapUrl, maps] = p.api.put.mock.calls[0] as unknown as [string, any[]];
    expect(mapUrl).toBe('/api/instruments/new-1/code-maps');
    // CBC_DEFAULT_MAPS: 20 ASTM-style rows (the M51/HL7-LOINC set is its own
    // preset, M51_HL7_MAPS / "Load Medonic M51" — not merged into this one).
    expect(maps).toHaveLength(20);
    expect(nav).toHaveBeenCalledWith(['/admin/instruments', 'new-1'], { replaceUrl: true });
  });

  it('Electron: ports come from the bridge; Start listening uses the wizard connection; "Use this" applies detection', async () => {
    const b = fakeBridge();
    const p = render({ bridge: b.api });
    await flush();
    expect(p.cmp.ports().map((o: { value: string }) => o.value)).toEqual(['COM3', 'COM4']);
    p.cmp.patch({ name: 'CBC' });
    p.cmp.patchSerial({ path: 'COM3' });
    p.cmp.go('listen'); p.f.detectChanges();
    await p.cmp.startListen();
    expect(b.api.listenStart).toHaveBeenCalledWith(expect.objectContaining({ transport: expect.objectContaining({ type: 'serial', path: 'COM3' }) }));
    b.emit({ sessionId: 's1', kind: 'raw', text: '\u0002R|1|^^^WBC|7.8\r' });
    b.emit({ sessionId: 's1', kind: 'detect', detect: { protocol: 'astm', link: 'astm-e1381', confidence: 0.9, reasons: ['STX framing'], proposed: { link: { type: 'astm-e1381' }, parser: { type: 'astm' } } } });
    b.emit({ sessionId: 's1', kind: 'message', message: { sampleId: '26123', results: [{ code: 'WBC', value: '7.8', unit: '10^3/uL', flags: ['H'] }] } });
    p.f.detectChanges();
    expect(p.el.querySelector('.pf-ie-raw')!.textContent).toContain('<STX>R|1|^^^WBC|7.8<CR>');
    expect(p.el.querySelector('.pf-ie-table')!.textContent).toContain('26123');
    p.cmp.useDetected();
    expect(p.cmp.form().protocol).toBe('astm');
    expect(p.cmp.unmappedCandidates()).toEqual(['WBC']);
  });

  it('Electron pairing: generate a fresh key, then pair with the environment apiUrl', async () => {
    const b = fakeBridge();
    const p = render({ id: 'i1', bridge: b.api });
    await flush();
    p.api.post.mockImplementation(((url: string) => of(url.endsWith('/device-key') ? { deviceKey: 'dk-secret', prefix: 'dk-s', rotatedAt: '2026-09-30T05:00:00Z' } : {})) as never);
    await p.cmp.pairThisPc();
    expect(p.api.post).toHaveBeenCalledWith('/api/instruments/i1/device-key', {});
    expect(b.api.pair).toHaveBeenCalledWith({ instrumentId: 'i1', deviceKey: 'dk-secret', apiUrl: 'https://api.example', name: 'Sysmex XN' });
  });

  it('save while paired on this PC live-reloads the running connector (no re-pair); not paired → no reload', async () => {
    const b = fakeBridge();
    b.api.list.mockImplementation((async () => [{ instrumentId: 'i1', apiUrl: 'https://api.example', pairedAt: 't', status: null }]) as never);
    const p = render({ id: 'i1', bridge: b.api });
    await flush();
    p.api.put.mockImplementation((() => of(instrument())) as never);
    p.cmp.patch({ name: 'Sysmex XN (lab 2)' });
    await p.cmp.save();
    expect(b.api.reload).toHaveBeenCalledWith('i1');
    expect(b.api.pair).not.toHaveBeenCalled();

    TestBed.resetTestingModule();
    const b2 = fakeBridge();
    const p2 = render({ id: 'i1', bridge: b2.api });
    await flush();
    p2.api.put.mockImplementation((() => of(instrument())) as never);
    p2.cmp.patch({ name: 'Sysmex XN (lab 3)' });
    await p2.cmp.save();
    expect(b2.api.reload).not.toHaveBeenCalled();
  });

  it('a wizard instrument with default Text settings reads "SAMPLE ID: 2609-00013" tickets', () => {
    const f = emptyInstrumentForm();
    f.protocol = 'text';
    const text = buildInstrumentConfig(f).parser.text!;
    // The connector core runs these case-insensitively.
    const m = new RegExp(text.sampleIdPattern!, 'i').exec('SAMPLE ID: 2609-00013');
    expect(m?.groups?.['id']).toBe('2609-00013');
    expect(new RegExp(text.linePattern!, 'i').exec('WBC        7.8  10^3/uL H')?.groups).toMatchObject({ code: 'WBC', value: '7.8', unit: '10^3/uL', flag: 'H' });
    expect(new RegExp(text.qcPattern!, 'i').test('QC LEVEL 1  LOT 24117')).toBe(true);
  });

  it('rotating an existing key asks first (DialogService) and stops on cancel', async () => {
    const p = render({ id: 'i1', dto: instrument({ hasDeviceKey: true, deviceKeyPrefix: 'dk-a' }) });
    await flush();
    const dialog = TestBed.inject(DialogService) as unknown as { confirm: ReturnType<typeof vi.fn> };
    const key = await p.cmp.generateKey();
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger', title: 'Rotate the device key?' }));
    expect(key).toBeNull();
    expect(p.api.post).not.toHaveBeenCalled();
  });

  it('Code mapping → Analyzer images: each graph with its thumbnail (received, else a sample) and a multi-profile picker; Save stores the mapped ones', async () => {
    const imageMaps = [
      { code: '12003', label: null, seen: 3, lastUrl: '/uploads/t/w.png', lastAt: '2026-10-02T05:00:00Z', profileKeys: ['HEM001'] },
      { code: '12053', label: null, seen: 0, lastUrl: null, lastAt: null, profileKeys: [] },
    ];
    const tests = [
      { id: 'p1', name: 'CBC Basic', type: 'profile', catalogKey: 'HEM001' },
      { id: 'p2', name: 'CBC Comprehensive', type: 'profile', catalogKey: 'HEM002' },
      { id: 't1', name: 'Haemoglobin', type: 'individual', catalogKey: 'HEM011' },
    ];
    const p = render({ id: 'i1', imageMaps, tests });
    await flush();
    p.cmp.go('mapping'); p.f.detectChanges();
    const items = p.el.querySelectorAll('.pf-ie-img');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('WBC histogram');
    expect(items[1].textContent).toContain('not received yet');
    expect(items[1].querySelector('img')!.getAttribute('src')).toBe('assets/analyzer-samples/m51-12053.png');
    expect(p.cmp.profileOptions().map((o: { value: unknown }) => o.value)).toEqual(['HEM001', 'HEM002']);   // profiles only
    expect(p.el.querySelector('select, datalist')).toBeNull();
    p.cmp.setImageProfiles(1, ['HEM001', 'HEM002']);
    p.api.put.mockImplementation(((u: string) => of(u.endsWith('/image-maps') ? imageMaps : instrument())) as never);
    await p.cmp.save();
    const call = (p.api.put.mock.calls as unknown as unknown[][]).find(c => String(c[0]).endsWith('/image-maps'))!;
    expect(call[1]).toEqual([
      { code: '12003', label: null, profileKeys: ['HEM001'] },
      { code: '12053', label: null, profileKeys: ['HEM001', 'HEM002'] },
    ]);
  });
});
