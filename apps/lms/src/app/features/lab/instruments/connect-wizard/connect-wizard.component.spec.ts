import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderBandPage } from '../../../admin/admin-band.spec-helpers';
import { ApiService } from '../../../../core/services/api.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { PlatformService } from '../../../../core/services/platform.service';
import { INSTRUMENT_BRIDGE_SOURCE } from '../../../../shared/instruments/instrument-bridge.service';
import type {
  ConnectorStatus, DiagScanEvent, DiagSnapshot, ElectronInstrumentsApi, ElectronInstrumentsDiagApi,
} from '../../../../shared/instruments/instrument.models';
import { ROUTE_ACCESS } from '../../../../core/auth/route-access';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConnectWizardComponent } from './connect-wizard.component';

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
const primaries = (el: HTMLElement) => el.querySelectorAll('.pf-hb-btn--primary, .pf-btn--primary').length;
const btn = (el: HTMLElement, text: string) => Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent!.includes(text));

const SNAP: DiagSnapshot = {
  platform: 'win32', hostname: 'LAB-RECEPTION', suggestedPort: 5603,
  adapters: [
    { name: 'Ethernet', description: 'Realtek PCIe GbE Family Controller', gateway: '192.168.1.1', ipv4: [{ address: '192.168.1.8' }] },
    { name: 'Ethernet 2', description: 'ASIX AX88179 USB 3.0 to Gigabit Ethernet Adapter', gateway: null, ipv4: [{ address: '192.168.1.10' }] },
  ],
  profiles: [{ name: 'Network 3', alias: 'Ethernet', category: 'Private' }, { name: 'Unidentified network', alias: 'Ethernet 2', category: 'Public' }],
  firewall: { supported: true, blockRules: 1, ourRule: false },
  problems: [
    { code: 'two_nics_same_subnet', severity: 'warning', message: 'Two network cards — Ethernet (192.168.1.8) and Ethernet 2 (192.168.1.10) — are on the same network 192.168.1.x.' },
    { code: 'public_network', severity: 'warning', card: 'Ethernet 2', fix: 'firewall', message: 'Ethernet 2 is set as a Public network, so Windows blocks analyzers on it. Fix sets it to Private.' },
  ],
};

function fakeDiag() {
  let scan: ((e: DiagScanEvent) => void) | null = null;
  const diag: ElectronInstrumentsDiagApi = {
    snapshot: vi.fn(async () => SNAP),
    ports: vi.fn(async () => [{ port: 5603, state: 'ours' as const, name: 'Medonic M51' }]),
    nextPort: vi.fn(async () => 5603),
    fixFirewall: vi.fn(async () => ({ ok: true })),
    arp: vi.fn(async () => [{ ip: '192.168.1.30', mac: 'b8:27:eb:12:34:56', type: 'dynamic', iface: '192.168.1.8' }]),
    probe: vi.fn(async () => ({ subnet: '192.168.1.0/24', tried: 8, hosts: 1, open: [{ host: '192.168.1.30', port: 5100 }] })),
    scanStart: vi.fn(async (p: { ports: number[] }) => ({ scanId: 'scan-1', ports: p.ports.map((port) => ({ port, ok: port !== 5600, ...(port === 5600 ? { error: 'Port 5600 is used by CBCLisM51 (PID 7412). Close that program, or pick another port for this analyzer.' } : {}) })) })),
    scanStop: vi.fn(async () => ({ ports: [] })),
    onScan: vi.fn((cb: (e: DiagScanEvent) => void) => { scan = cb; return () => { scan = null; }; }),
  };
  let status: ((s: ConnectorStatus) => void) | null = null;
  const api = {
    list: vi.fn(async () => []), pair: vi.fn(async () => ({ ok: true })), unpair: vi.fn(async () => ({ ok: true })),
    status: vi.fn(async () => []), onStatus: vi.fn((cb: (s: ConnectorStatus) => void) => { status = cb; return () => { status = null; }; }),
    rawLog: vi.fn(async () => []), listSerialPorts: vi.fn(async () => []),
    listenStart: vi.fn(async () => ({ sessionId: 'l1' })), listenStop: vi.fn(async () => ({ raw: '', detect: undefined as never, messages: [] })),
    onListen: vi.fn(() => () => undefined), preview: vi.fn(async () => ({ raw: '', detect: undefined as never, messages: [] })),
    diag,
  };
  return { api, diag, emit: (e: DiagScanEvent) => scan?.(e), status: (s: ConnectorStatus) => status?.(s) };
}

function render(bridge?: ReturnType<typeof fakeDiag>['api'], confirm = true) {
  const http = {
    get: vi.fn(() => of([])),
    post: vi.fn((url: string, body: unknown) => of(url === '/api/instruments'
      ? { id: 'new-1', name: (body as { name: string }).name, transport: 'tcp-server', config: (body as { config: unknown }).config, isActive: true, status: 'never', hasDeviceKey: false }
      : { deviceKey: 'pfi_key_1', prefix: 'pfi_', rotatedAt: '2026-10-24T10:00:00Z' })),
    put: vi.fn(() => of({})), patch: vi.fn(() => of({})), delete: vi.fn(() => of({})),
  };
  const dialog = { confirm: vi.fn(async (_req: unknown) => confirm), prompt: vi.fn(async () => null) };
  const p = renderBandPage(ConnectWizardComponent, {
    providers: [
      { provide: ApiService, useValue: http },
      { provide: DialogService, useValue: dialog },
      { provide: PlatformService, useValue: { getApiUrl: () => 'https://api.example', isElectron: () => !!bridge } },
      { provide: INSTRUMENT_BRIDGE_SOURCE, useValue: () => bridge as ElectronInstrumentsApi | undefined },
    ],
  });
  return { ...p, http, dialog };
}

describe('Connect an analyzer — wizard', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('route sits before :id and is gated like the instruments page', async () => {
    // Read as text: importing app.routes compiles every lazy screen.
    const flat = readFileSync(resolve(process.cwd(), 'apps/lms/src/app/app.routes.ts'), 'utf8');
    expect(flat).toMatch(/path: 'admin\/instruments\/connect',\s*canActivate: \[\.\.\.routeGuards\('\/admin\/instruments'\)\]/);
    expect(flat.indexOf('admin/instruments/connect')).toBeGreaterThan(-1);
    expect(flat.indexOf('admin/instruments/connect')).toBeLessThan(flat.indexOf('admin/instruments/:id'));
    expect(ROUTE_ACCESS['/admin/instruments']).toEqual({ perms: ['manage_lab_settings'], module: 'lab' });
  });

  it('web: explains it runs on the lab PC, offers the manual path, no steps', async () => {
    const p = render(undefined);
    await flush(); p.f.detectChanges();
    expect(p.el.textContent).toContain('Open this on the lab PC');
    expect(p.el.querySelectorAll('pf-hero-band .pf-tabs__item').length).toBe(0);
    expect(btn(p.el, 'Add an instrument by hand')).toBeTruthy();
  });

  it('step 1: both network cards, the straight-cable card picked, problems in plain words, ONE primary', async () => {
    const b = fakeDiag();
    const p = render(b.api);
    await flush(); p.f.detectChanges();
    const tabs = Array.from(p.el.querySelectorAll('pf-hero-band .pf-tabs__item')).map((t) => Array.from(t.children).map((c) => c.textContent!.trim()).join(' '));
    expect(tabs).toEqual(['1 This PC', '2 Find the analyzer', '3 Create & pair', '4 Checklist']);
    expect(p.el.textContent).toContain('ASIX AX88179');
    expect(p.el.textContent).toContain('No gateway');
    expect(p.cmp.card()).toBe('192.168.1.10');
    expect(p.el.textContent).toContain('are on the same network 192.168.1.x');
    expect(p.el.querySelector('.pf-cw-tag[data-tone="amber"]')!.textContent).toContain('Public');
    expect(primaries(p.el)).toBe(1);
    expect(p.el.querySelectorAll('select, datalist').length).toBe(0);
  });

  it('Fix: confirms in plain words FIRST, then one call with the picked analyzer card + the analyzer ports; No = nothing runs', async () => {
    const b = fakeDiag();
    const no = render(b.api, false);
    await flush(); no.f.detectChanges();
    btn(no.el, 'Fix with Windows permission')!.click();
    await flush();
    expect(no.dialog.confirm).toHaveBeenCalledTimes(1);
    expect(b.diag.fixFirewall).not.toHaveBeenCalled();
    TestBed.resetTestingModule();

    const b2 = fakeDiag();
    const p = render(b2.api, true);
    await flush(); p.f.detectChanges();
    btn(p.el, 'Fix with Windows permission')!.click();
    await flush();
    const req = p.dialog.confirm.mock.calls[0][0] as unknown as { items: string[]; title: string };
    expect(req.title).toBe('Let analyzers reach Prefrontal?');
    expect(req.items).toContain('Set Ethernet 2 to a Private network.');
    expect(req.items[0]).toBe('Remove the Windows Firewall rule that blocks Prefrontal.');
    expect(req.items[1]).toBe('Let analyzers on 192.168.1.x (Ethernet 2) reach Prefrontal on ports 5599, 5600, 5601, 5602, 5603, 5604, 5605, 5606, 5607, 5608, 5609, 5610 — only Prefrontal, nothing else.');
    expect(req.items.join(' ')).not.toContain('Set Ethernet to');
    // The renderer names the card; main re-reads Windows and decides what flips.
    expect(b2.diag.fixFirewall).toHaveBeenCalledWith({ ports: [5599, 5600, 5601, 5602, 5603, 5604, 5605, 5606, 5607, 5608, 5609, 5610], adapter: 'Ethernet 2' });
    expect(b2.diag.snapshot).toHaveBeenCalledTimes(2);
    expect(p.toasts.success).toHaveBeenCalled();
  });

  it('step 2 → 3 → 4: exact host/port to type, live wait, connected + recognised, create with the detected protocol, pair, checklist', async () => {
    const b = fakeDiag();
    const p = render(b.api);
    await flush(); p.f.detectChanges();
    p.cmp.primary(); await flush(); p.f.detectChanges();

    expect(p.cmp.step()).toBe('find');
    expect(b.diag.scanStart).toHaveBeenCalledWith({ ports: [5603, 5599, 5600, 5601, 5602, 5604, 5605, 5606, 5607, 5608, 5609, 5610] });
    const vals = Array.from(p.el.querySelectorAll('.pf-cw-instr__v')).map((v) => v.textContent!.trim());
    expect(vals).toEqual(['192.168.1.10', '5603']);
    expect(p.el.textContent).toContain('Waiting for the analyzer to connect');
    expect(p.el.querySelector('.pf-cw-note')!.textContent).toBe('Results sent while finding the analyzer are not saved — run a sample after pairing.');
    expect(p.el.textContent).toContain('Port 5600 is used by CBCLisM51 (PID 7412)');
    expect(btn(p.el, 'Next: create')!.disabled).toBe(true);

    // The Medonic was already set to 5601 — it connects there; we follow it.
    b.emit({ scanId: 'scan-1', kind: 'connected', port: 5601, remote: '192.168.1.21:49731', local: '192.168.1.10:5601' });
    b.emit({ scanId: 'other', kind: 'connected', port: 5602, remote: '10.0.0.1:1' });
    b.emit({ scanId: 'scan-1', kind: 'detect', port: 5601, remote: '192.168.1.21:49731', messages: 1,
      detect: { protocol: 'hl7', link: 'mllp', confidence: 0.92, reasons: ['MSH segment found (HL7 v2)'], proposed: { link: { type: 'mllp' }, parser: { type: 'hl7', hl7: { sampleIdField: 'OBR-3' } } as never } },
      guess: { make: 'Medonic', model: 'M51', profileKey: 'medonic-m51-cbc', label: 'Medonic M51' } });
    p.f.detectChanges();
    expect(p.el.querySelector('.pf-cw-hit')!.textContent!.replace(/\s+/g, ' ')).toContain('Connected from 192.168.1.21 on port 5601');
    expect(p.el.querySelector('.pf-cw-headline')!.textContent).toContain('Looks like Medonic M51 · HL7 v2 (MLLP)');
    expect(p.cmp.port()).toBe(5601);
    expect(p.cmp.name()).toBe('Medonic M51');

    p.cmp.primary(); await flush(); p.f.detectChanges();
    expect(p.cmp.step()).toBe('create');
    expect(b.diag.scanStop).toHaveBeenCalledWith('scan-1');
    expect(p.el.textContent).toContain('This PC listens on port 5601');

    p.cmp.primary(); await flush(); p.f.detectChanges();
    const create = p.http.post.mock.calls.find((c) => c[0] === '/api/instruments')!;
    const body = create[1] as { name: string; make: string; config: { transport: object; parser: { type: string }; link: { type: string } } };
    expect(body.name).toBe('Medonic M51');
    expect(body.make).toBe('Medonic');
    expect(body.config.transport).toEqual({ type: 'tcp-server', port: 5601, host: '0.0.0.0' });
    expect(body.config.parser.type).toBe('hl7');
    expect(body.config.link.type).toBe('mllp');
    expect(p.http.post).toHaveBeenCalledWith('/api/instruments/new-1/device-key', {});
    expect(b.api.pair).toHaveBeenCalledWith({ instrumentId: 'new-1', deviceKey: 'pfi_key_1', apiUrl: 'https://api.example', name: 'Medonic M51' });
    expect(p.cmp.step()).toBe('check');

    b.status({ instrumentId: 'new-1', state: 'listening', link: 'waiting' });
    await flush(); p.f.detectChanges();
    expect(p.el.textContent).toContain('Waiting for analyzer on this PC');
    const checks = Array.from(p.el.querySelectorAll('.pf-cw__main .pf-cw-check')).map((c) => [c.querySelector('.pf-cw-check__t span')!.textContent, c.getAttribute('data-ok')]);
    expect(checks).toContainEqual(['The analyzer connected', 'yes']);
    expect(checks).toContainEqual(['Its protocol was recognised', 'yes']);
    expect(checks).toContainEqual(['Windows Firewall lets the analyzer in', 'no']);
    expect(checks).toContainEqual(['The instrument is created and this PC is paired', 'yes']);
    expect(checks).toContainEqual(['The connector is running for it', 'yes']);

    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    p.cmp.primary();
    expect(nav).toHaveBeenCalledWith(['/admin/instruments', 'new-1']);
  });

  it('dial mode: devices seen, opt-in look-around (asks first), pick one', async () => {
    const b = fakeDiag();
    const p = render(b.api, true);
    await flush(); p.f.detectChanges();
    p.cmp.go('find'); await flush();
    p.cmp.setMode('dial'); await flush(); p.f.detectChanges();
    expect(b.diag.scanStop).toHaveBeenCalled();
    expect(p.el.textContent).toContain('Devices this PC has seen');
    btn(p.el, 'Look for analyzers on this network')!.click();
    await flush(); p.f.detectChanges();
    expect(p.dialog.confirm).toHaveBeenCalled();
    expect((p.dialog.confirm.mock.calls[0][0] as unknown as { title: string }).title).toBe('Look for analyzers on 192.168.1.x?');
    expect(b.diag.probe).toHaveBeenCalledWith({ address: '192.168.1.10' });
    Array.from(p.el.querySelectorAll<HTMLButtonElement>('.pf-cw-pick')).find((x) => x.textContent!.includes('port 5100'))!.click();
    p.f.detectChanges();
    expect(p.cmp.dialHost()).toBe('192.168.1.30');
    expect(p.cmp.dialPort()).toBe(5100);
    expect(p.cmp.canNext()).toBe(true);
  });
});
