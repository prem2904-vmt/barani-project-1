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
import { sortsAndFilters } from '../../../shared/utils/work-grid';
import { InstrumentsListComponent, searchInstruments } from './instruments-list.component';
import { InstrumentEditorComponent } from './instrument-editor.component';
import { SETTINGS_SECTIONS } from '../../admin/settings/settings-map';
import { ROUTE_ACCESS } from '../../../core/auth/route-access';

const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
const primaries = (el: HTMLElement) => el.querySelectorAll('.pf-hb-btn--primary, .pf-btn--primary').length;

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
    // + the Lab contributor code (Settings access, owner 2026-11-18: a contributor views it; the server refuses their writes).
    expect(ROUTE_ACCESS['/admin/instruments']).toEqual({ perms: ['manage_lab_settings', 'contribute_lab_settings'], module: 'lab' });
    expect(ROUTE_ACCESS['/admin/instruments'].perms).toEqual(ROUTE_ACCESS['/admin/lab/results'].perms);
    expect(ROUTE_ACCESS['/lab/analyzer-results']).toEqual({ perms: ['enter_result', 'edit_result'], module: 'lab' });
  });

  it('Settings › Lab › Analyzers and bridges lists Analyzers → /admin/instruments', () => {
    const lab = SETTINGS_SECTIONS.find((x) => x.id === 'lab')!;
    const item = lab.items.find((i) => i.id === 'lab-analyzers')!;
    expect(item.label).toBe('Analyzers and bridges');
    expect(item.categories.find((c) => c.id === 'analyzers')?.path).toBe('/admin/instruments');
    expect(item.iconPath.length).toBeGreaterThan(10);
  });
});

describe('Instruments list', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('band search + grid card + side card; "Add instrument" in the card head (no band buttons)', async () => {
    const p = renderBandPage(InstrumentsListComponent, { getFor: (u) => (u === '/api/instruments' ? [instrument()] : []) });
    await flush(); p.f.detectChanges();
    expect(p.bandInput()).not.toBeNull();
    expect(primaries(p.el)).toBe(0);
    expect(p.el.querySelector('pf-hero-band .pf-hb__actions button')).toBeNull();
    expect(Array.from(p.el.querySelectorAll('.pf-inl__main .pf-sg-act')).map((b) => b.textContent!.trim())).toEqual(['Refresh', 'Add instrument']);
    expect(p.el.querySelector('pf-hero-band pf-settings-siblings')).not.toBeNull();
    // Side card LEFT (first), grid card second — like Test Master.
    expect(p.el.querySelector('.pf-sg-panels')!.firstElementChild!.querySelector('.pf-inl__side')).not.toBeNull();
    expect(p.el.querySelector('.pf-inl__main.pf-card .pf-card__icon svg')).not.toBeNull();
    expect(p.cmp.statusCounts().find((s: { label: string }) => s.label === 'Online').n).toBe(1);
    expect(p.cmp.unmatchedTotal()).toBe(2);
  });

  it('true status: counts per status (Online always, others only when present) and the "connected from" line', async () => {
    const rows = [
      instrument({ id: 'a', name: 'Medonic M51', status: 'online', sessions: [{ remote: '192.168.1.21:49731', since: '2026-10-24T09:00:00Z' }], lastRxAt: new Date(Date.now() - 2 * 60_000).toISOString() }),
      instrument({ id: 'b', name: 'Snibe Maglumi', status: 'waiting', listenPort: 5604 }),
      instrument({ id: 'c', name: 'Old LIS clash', status: 'error', errorDetail: 'Port 5600 is used by CBCLisM51 (PID 7412). Close that program, or pick another port for this analyzer.' }),
      instrument({ id: 'd', name: 'Old desktop', status: 'running' }),
    ];
    const p = renderBandPage(InstrumentsListComponent, { getFor: (u) => (u === '/api/instruments' ? rows : []) });
    await flush(); p.f.detectChanges();
    expect(p.cmp.statusCounts().map((s: { label: string; n: number; tone: string }) => [s.label, s.n, s.tone])).toEqual([
      ['Online', 1, 'green'], ['Waiting for analyzer', 1, 'amber'], ['Error', 1, 'red'], ['Connector running', 1, 'neutral'],
    ]);
    // Status = two lines of words (design D): "Online" / "connected from …".
    const cells = Array.from(p.el.querySelectorAll('.pf-inl__main pf-status-words'))
      .map((c) => Array.from(c.children).map((x) => x.textContent!.trim()).join(' '));
    expect(cells).toContain('Online connected from 192.168.1.21 · last data 2 min ago');
    expect(cells).toContain('Waiting for analyzer listening on port 5604');
    expect(cells.find((c) => c.startsWith('Error'))).toContain('Port 5600 is used by CBCLisM51 (PID 7412)');
    // No green dot for anything that isn't really connected.
    expect(p.el.querySelectorAll('.pf-inl__main pf-status-words[data-tone="done"]').length).toBe(1);
  });

  it('"Connect an analyzer" shows on the desktop app with the setup helper (a secondary — no violet primary in Settings)', async () => {
    const b = fakeBridge();
    const withDiag = { ...b.api, diag: { snapshot: vi.fn(async () => ({})) } };
    const p = renderBandPage(InstrumentsListComponent, {
      getFor: (u) => (u === '/api/instruments' ? [instrument()] : []),
      providers: [{ provide: INSTRUMENT_BRIDGE_SOURCE, useValue: () => withDiag as unknown as ElectronInstrumentsApi }],
    });
    await flush(); p.f.detectChanges();
    const c = Array.from(p.el.querySelectorAll<HTMLButtonElement>('.pf-inl__side button')).find((x) => x.textContent!.includes('Connect an analyzer'))!;
    expect(c.classList.contains('pf-btn--secondary')).toBe(true);
    expect(primaries(p.el)).toBe(0);
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    c.click();
    expect(nav).toHaveBeenCalledWith(['/admin/instruments', 'connect']);
    TestBed.resetTestingModule();
    // Web / an older desktop (no diag): not offered.
    const web = renderBandPage(InstrumentsListComponent, { getFor: (u) => (u === '/api/instruments' ? [instrument()] : []) });
    await flush(); web.f.detectChanges();
    expect(web.el.textContent).not.toContain('Connect an analyzer');
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
    const tabs = Array.from(p.el.querySelectorAll('pf-hero-band .pf-tabs__item')).map((b) => b.textContent!.trim());
    expect(tabs).toEqual(['Basics', 'Connection', 'Protocol', 'Listen', 'Code mapping', 'Two-way', 'Device']);
    expect(p.el.querySelector('pf-hero-band .pf-ctx__primary')!.textContent).toContain('New instrument');
  });

  it('side card on this PC: the TRUE link word, who is connected, the port; a port problem in plain words', async () => {
    const b = fakeBridge();
    b.api.status = vi.fn(async () => [{ instrumentId: 'i1', state: 'connected', link: 'connected', listenPort: 5601,
      sessions: [{ remote: '192.168.1.21:49731', since: '2026-10-24T09:00:00Z' }], lastRxAt: new Date(Date.now() - 2 * 60_000).toISOString() }]) as never;
    const p = render({ id: 'i1', bridge: b.api });
    await flush(); p.f.detectChanges();
    const side = p.el.querySelector('.pf-ie__side')!.textContent!.replace(/\s+/g, ' ');
    expect(side).toContain('Analyzer connected on this PC');
    expect(side).toContain('connected from 192.168.1.21 · last data 2 min ago');
    expect(side).toMatch(/Port\s*5601/);
    expect(p.el.querySelector('.pf-ie__side .pf-ie-status')!.getAttribute('data-tone')).toBe('green');
    TestBed.resetTestingModule();

    const b2 = fakeBridge();
    b2.api.status = vi.fn(async () => [{ instrumentId: 'i1', state: 'listening', link: 'waiting', listenPort: 5604, sessions: [] }]) as never;
    const w = render({ id: 'i1', bridge: b2.api });
    await flush(); w.f.detectChanges();
    expect(w.el.querySelector('.pf-ie__side .pf-ie-status')!.textContent).toContain('Waiting for analyzer on this PC');
    expect(w.el.querySelector('.pf-ie__side .pf-ie-status')!.getAttribute('data-tone')).toBe('amber');
    TestBed.resetTestingModule();

    const b3 = fakeBridge();
    b3.api.status = vi.fn(async () => [{ instrumentId: 'i1', state: 'error', link: 'error', sessions: [], lastError: 'TCP server 0.0.0.0:5600: …',
      errorDetail: 'Port 5600 is used by CBCLisM51 (PID 7412). Close that program, or pick another port for this analyzer.' }]) as never;
    const e = render({ id: 'i1', bridge: b3.api });
    await flush(); e.f.detectChanges();
    expect(e.el.querySelector('.pf-ie__side .pf-ie-err')!.textContent).toContain('Port 5600 is used by CBCLisM51 (PID 7412)');
  });

  it('web: the server view says "Waiting for analyzer" (amber) with the port — never green while only listening', async () => {
    const p = render({ id: 'i1', dto: instrument({ status: 'waiting', listenPort: 5604, lastStatus: { status: 'listening', link: 'waiting', host: 'LAB-RECEPTION' } }) });
    await flush(); p.f.detectChanges();
    const st = p.el.querySelector('.pf-ie__side .pf-ie-status')!;
    expect(st.textContent).toContain('Waiting for analyzer');
    expect(st.getAttribute('data-tone')).toBe('amber');
    const side = p.el.querySelector('.pf-ie__side')!.textContent!.replace(/\s+/g, ' ');
    expect(side).toContain('listening on port 5604');
    expect(side).toContain('Waiting for analyzer · LAB-RECEPTION');
    expect(side).not.toContain('listening ·');
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

  it('Code mapping → Analyzer images: each graph with its thumbnail (received only — never a sample) and a multi-profile picker; Save stores the mapped ones', async () => {
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
    expect(items[1].querySelector('img')).toBeNull();                      // no built-in sample graph
    expect(items[1].querySelector('.pf-ie-img__thumb--none')).not.toBeNull();
    expect(items[1].textContent).not.toContain('sample');
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

  it('Analyzer images: nothing received → empty note, no sample graphs', async () => {
    const p = render({ id: 'i1', imageMaps: [], tests: [] });
    await flush();
    p.cmp.go('mapping'); p.f.detectChanges();
    expect(p.el.querySelectorAll('.pf-ie-img').length).toBe(0);
    expect(p.el.querySelector('.pf-ie-imgs__empty')!.textContent).toContain('No graphs received');
    expect(p.el.querySelector('img[src*="analyzer-samples"]')).toBeNull();
  });
});

describe('Instruments grid — every data column sorts and filters on its real value', () => {
  afterEach(() => TestBed.resetTestingModule());
  it('name / connection / status / unmatched sort + filter; actions is exempt', async () => {
    const p = renderBandPage(InstrumentsListComponent, { getFor: (u) => (u === '/api/instruments' ? [instrument()] : []) });
    await flush(); p.f.detectChanges();
    const cols = p.cmp.colDefs() as any[];
    const data = cols.filter((c) => c.colId !== 'actions');
    expect(data.map((c) => c.colId)).toEqual(['name', 'connection', 'status', 'unmatched']);
    for (const c of data) expect(sortsAndFilters(c), c.colId).toBe(true);
    expect(cols.find((c) => c.colId === 'actions').sortable).toBe(false);
  });
});
