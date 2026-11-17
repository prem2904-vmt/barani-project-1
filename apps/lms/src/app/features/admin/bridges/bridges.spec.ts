import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { ROUTE_ACCESS, canOpenRoute } from '../../../core/auth/route-access';
import { BRIDGE_LOCAL_SOURCE, BridgeLocalTransport } from '../../../shared/bridges/bridge-local.service';
import { BRIDGE_NEARBY_CONFIG } from '../../../shared/bridges/bridge-nearby.service';
import { BRIDGE_QR_HANDOFF_KEY } from '../../../shared/bridges/bridge-qr';
import { BRIDGE_COMMAND_CLOCK } from '../../../shared/bridges/bridge-commands';
import {
  BRANCH_SALEM, FX_BRIDGE_BIOCHEM, FX_BRIDGE_HAEM, FX_IDENTITY, FX_INSTRUMENTS, FX_MDNS_EVENT, FX_NEARBY, FX_TICKET, VECTOR_QR_URL,
  fxClaimResult, mockBridgeApi,
} from '../../../shared/bridges/testing/bridge-fixtures';
import { BridgesListComponent, searchBridges } from './bridges-list.component';
import { BridgeDetailComponent, analyzerRows } from './bridge-detail.component';
import { BridgeAddComponent } from './bridge-add.component';
import { BridgeNearbyBannerComponent } from '../../../shared/components/bridge-nearby-banner/bridge-nearby-banner.component';
import { SETTINGS_SECTIONS } from '../settings/settings-map';
import { BridgeLinkPage, handleBridgeLinkHref } from '../../bridges/bridge-link.page';

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
/** The detail's first-load skeleton is HELD 600 ms (heldFlag, ND "Loading feedback"). */
const settle = async () => { await new Promise((r) => setTimeout(r, 650)); await flush(); };
const primaries = (el: HTMLElement) => el.querySelectorAll('.pf-hb-btn--primary, .pf-btn--primary').length;

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, String(v)); }, removeItem: (k: string) => { m.delete(k); }, clear: () => m.clear() };
}

interface RenderOpts {
  perms?: string[];
  inputs?: Record<string, unknown>;
  local?: BridgeLocalTransport | null;
  dialog?: Partial<Record<'confirm' | 'prompt' | 'choose' | 'alert', (...a: unknown[]) => unknown>>;
  get?: (url: string) => unknown;
}

/** The admin band harness, with the Bridge fixtures as the API and inputs set before the first render. */
function render<T>(cmp: Type<T>, o: RenderOpts = {}) {
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  document.documentElement.classList.add('design-new');
  const perms = o.perms ?? ['manage_bridges', 'manage_lab_settings'];
  const fromMock = (m: string, u: string, b?: unknown) => {
    const r = mockBridgeApi(m, u, b);
    if (!r) return of([]);
    return r.body.success ? of(r.body.data) : throwError(() => new ApiError(r.body.message ?? 'x', r.body.error));
  };
  const api = {
    get: vi.fn((u: string) => (o.get && o.get(u) !== undefined ? of(o.get(u)) : fromMock('GET', u))),
    post: vi.fn((u: string, b: unknown) => fromMock('POST', u, b)),
    put: vi.fn((u: string, b: unknown) => fromMock('PUT', u, b)),
    patch: vi.fn((u: string, b: unknown) => fromMock('PATCH', u, b)),
    delete: vi.fn((u: string) => fromMock('DELETE', u)),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  const d = o.dialog ?? {};
  const dialog = {
    confirm: vi.fn(d.confirm ?? (async () => false)), prompt: vi.fn(d.prompt ?? (async () => null)),
    choose: vi.fn(d.choose ?? (async () => null)), alert: vi.fn(d.alert ?? (async () => undefined)),
  };
  TestBed.configureTestingModule({
    imports: [cmp],
    providers: [
      provideRouter([]),
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toasts },
      { provide: DialogService, useValue: dialog },
      { provide: AuthService, useValue: {
        user: () => ({ tenantName: 'Micro World', permissions: perms, branches: [BRANCH_SALEM, { id: 'b2', name: 'Erode' }] }),
        activeBranchId: () => BRANCH_SALEM.id,
        hasPermission: (c: string) => perms.includes('*') || perms.includes(c),
        hasAnyPermission: (c: string[]) => perms.includes('*') || c.some((x) => perms.includes(x)),
        isAuthenticated: () => true, waitForAuth: async () => undefined,
      } },
      { provide: TenantStateService, useValue: { tenant: () => null } },
      { provide: BRIDGE_LOCAL_SOURCE, useValue: () => o.local ?? null },
      { provide: BRIDGE_NEARBY_CONFIG, useValue: { pollMs: 0, snoozeMs: 86_400_000, now: () => Date.now() } },
      { provide: BRIDGE_COMMAND_CLOCK, useValue: { sleep: async () => undefined, now: () => Date.now() } },
    ],
  });
  const f = TestBed.createComponent(cmp);
  for (const [k, v] of Object.entries(o.inputs ?? {})) f.componentRef.setInput(k, v);
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, cmp: f.componentInstance as any, api, toasts, dialog };
}

function localDouble(over: Partial<BridgeLocalTransport> = {}) {
  let found: ((e: any) => void) | null = null;
  const env = (data: unknown) => ({ status: 200, body: JSON.stringify({ success: true, data }) });
  const t: BridgeLocalTransport = {
    kind: 'native',
    capabilities: async () => ({ discovery: true, hotspot: true }),
    startDiscovery: vi.fn(async () => { found?.(FX_MDNS_EVENT); }),
    stopDiscovery: vi.fn(async () => undefined),
    onFound: (cb) => { found = cb; return () => { found = null; }; },
    onLost: () => () => undefined,
    joinHotspot: vi.fn(async () => true),
    leaveHotspot: vi.fn(async () => undefined),
    request: vi.fn(async (r) => env(r.url.endsWith('/identity') ? FX_IDENTITY : r.url.endsWith('/claim-ticket') ? FX_TICKET : {})),
    ...over,
  };
  return t;
}

beforeEach(() => { vi.stubGlobal('localStorage', memStorage()); vi.stubGlobal('sessionStorage', memStorage()); });
afterEach(() => { TestBed.resetTestingModule(); vi.unstubAllGlobals(); });

// ── Routes + permission gating ──────────────────────────────────────────────
describe('Bridges — routes, permission, hub tile', () => {
  it('/admin/bridges needs manage_bridges (lab module); manage_lab_settings alone is not enough', () => {
    expect(ROUTE_ACCESS['/admin/bridges']).toEqual({ perms: ['manage_bridges'], module: 'lab' });
    const can = (perms: string[]) => canOpenRoute('/admin/bridges', { hasAny: (c) => c.some((x) => perms.includes(x)) });
    expect(can(['manage_bridges'])).toBe(true);
    expect(can(['manage_lab_settings'])).toBe(false);
    expect(canOpenRoute('/admin/bridges', { hasAny: () => false, isSuper: true })).toBe(true);
    // A manage_bridges-only admin still reaches Settings to find it.
    expect(canOpenRoute('/admin', { hasAny: (c) => c.includes('manage_bridges') })).toBe(true);
  });

  it('Settings › Lab › Analyzers and bridges has a Bridges category → /admin/bridges, gated by manage_bridges', () => {
    const item = SETTINGS_SECTIONS.find((x) => x.id === 'lab')!.items.find((i) => i.id === 'lab-analyzers')!;
    expect(item.categories.find((c) => c.id === 'bridges')?.path).toBe('/admin/bridges');
    expect(canOpenRoute('/admin/lab/analyzers', { hasAny: (c) => c.includes('manage_bridges') })).toBe(true);
  });
});

// ── List ────────────────────────────────────────────────────────────────────
describe('Bridges list', () => {
  it('Test Master frame: band search + Analyzers|Bridges switch, ONE primary "Add Bridge" in the band, overview side card LEFT; nearby offers listed', async () => {
    const p = render(BridgesListComponent);
    await flush(); p.f.detectChanges();
    expect(p.el.querySelector('pf-hero-band .pf-hb__input')).not.toBeNull();
    expect(primaries(p.el)).toBe(1);
    expect(p.el.querySelector('pf-hero-band .pf-hb-btn--primary')!.textContent).toContain('Add Bridge');
    expect(p.el.querySelector('pf-hero-band pf-settings-siblings')).not.toBeNull();
    // Side card comes FIRST (left), the grid card second — like Test Master.
    const panels = p.el.querySelector('.pf-sg-panels')!;
    expect(panels.firstElementChild!.classList.contains('pf-sg-side')).toBe(true);
    expect(p.el.querySelector('.pf-sg-main .pf-card__head')).not.toBeNull();
    expect(p.cmp.visibleRows()).toHaveLength(3);
    expect(p.cmp.statusCounts().find((s: any) => s.label === 'Online').n).toBe(1);
    expect(p.cmp.queuedTotal()).toBe(12);
    expect(p.el.querySelector('.pf-brl__offers')!.textContent).toContain(FX_NEARBY[0].serialShort);
    expect(p.el.querySelector('ag-grid-angular')).not.toBeNull();
    expect(p.el.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it('columns: name, branch, status, last message, queue, version, Wi-Fi', async () => {
    const p = render(BridgesListComponent);
    await flush();
    expect(p.cmp.colDefs().map((c: any) => c.colId)).toEqual(['name', 'branch', 'status', 'lastMessage', 'queue', 'version', 'wifi', 'actions']);
  });

  it('search matches name, serial, branch, Wi-Fi and analyzer names', () => {
    expect(searchBridges([FX_BRIDGE_HAEM, FX_BRIDGE_BIOCHEM], 'beef').map((b) => b.id)).toEqual([FX_BRIDGE_BIOCHEM.id]);
    expect(searchBridges([FX_BRIDGE_HAEM, FX_BRIDGE_BIOCHEM], 'xn-350').map((b) => b.id)).toEqual([FX_BRIDGE_HAEM.id]);
    expect(searchBridges([FX_BRIDGE_HAEM, FX_BRIDGE_BIOCHEM], 'hospital-staff').map((b) => b.id)).toEqual([FX_BRIDGE_BIOCHEM.id]);
  });

  it('Add / nearby Add navigate to the add screen', async () => {
    const p = render(BridgesListComponent);
    await flush(); p.f.detectChanges();
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    p.cmp.add();
    p.cmp.addNearby('a1');
    expect(nav).toHaveBeenCalledWith(['/admin/bridges', 'add']);
    expect(nav).toHaveBeenCalledWith(['/admin/bridges', 'add'], { queryParams: { nearby: 'a1' } });
  });
});

// ── Detail ──────────────────────────────────────────────────────────────────
describe('Bridge detail', () => {
  it('"Sysmex XN-350 connected on port 6662 — link it?" + analyzers + ONE primary (Assign analyzer)', async () => {
    const p = render(BridgeDetailComponent, { inputs: { id: FX_BRIDGE_HAEM.id } });
    await settle(); p.f.detectChanges();
    expect(p.el.querySelector('.pf-brd__source-t')!.textContent).toContain('Sysmex XN-350 connected on port 6662 — link it?');
    expect(primaries(p.el)).toBe(1);
    expect(p.el.querySelector('.pf-brd__main .pf-btn--primary')!.textContent).toContain('Assign analyzer');
    expect(p.cmp.rows().map((r: any) => r.connection)).toEqual(['Connects to 192.168.50.20:5100', 'Listens on port 6661']);
    expect(p.el.querySelector('pf-hero-band .pf-ctx__primary')!.textContent).toContain('Haematology Bridge');
    expect(p.el.querySelector('.pf-brd__facts')!.textContent).toContain('LabWiFi');
    expect(p.el.querySelector('.pf-brd__acts')!.textContent).toContain('Wrong Wi-Fi password');
  });

  it('without manage_bridges: read-only (no ⋮, no Assign, no Link it, no Change Wi-Fi)', async () => {
    const p = render(BridgeDetailComponent, { inputs: { id: FX_BRIDGE_HAEM.id }, perms: ['manage_lab_settings'] });
    await settle(); p.f.detectChanges();
    expect(p.el.querySelector('pf-actions-menu')).toBeNull();
    expect(primaries(p.el)).toBe(0);
    expect(p.el.querySelector('.pf-brd__source-acts')).toBeNull();
    expect(p.el.querySelector('.pf-brd__side .pf-card__foot')).toBeNull();
  });

  it('Remove asks first (DialogService) and states what is discarded; cancel = no DELETE', async () => {
    const p = render(BridgeDetailComponent, { inputs: { id: FX_BRIDGE_BIOCHEM.id } });
    await settle();
    await p.cmp.runAction('remove');
    const req = (p.dialog.confirm as any).mock.calls[0][0];
    expect(req.tone).toBe('danger');
    expect(req.message).toBe('12 results not yet sent will be lost.');
    expect(req.items.join(' ')).toContain('12 results still waiting on the Bridge are discarded');
    expect(p.api.delete).not.toHaveBeenCalled();
  });

  it('Remove confirmed → DELETE, toast with the discarded count, back to the list', async () => {
    const p = render(BridgeDetailComponent, { inputs: { id: FX_BRIDGE_BIOCHEM.id }, dialog: { confirm: async () => true } });
    await settle();
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await p.cmp.runAction('remove');
    expect(p.api.delete).toHaveBeenCalledWith(`/api/bridges/${FX_BRIDGE_BIOCHEM.id}`);
    expect(p.toasts.success).toHaveBeenCalledWith('Removed — 12 queued results discarded');
    expect(nav).toHaveBeenCalledWith(['/admin/bridges']);
  });

  it('Rename → prompt → PATCH {name}; Move → choose → PATCH {branchId}', async () => {
    const p = render(BridgeDetailComponent, {
      inputs: { id: FX_BRIDGE_HAEM.id },
      dialog: { prompt: async () => '  Haem Bridge 2 ', choose: async () => 'b2' },
    });
    await flush();
    await p.cmp.runAction('rename');
    expect(p.api.patch).toHaveBeenCalledWith(`/api/bridges/${FX_BRIDGE_HAEM.id}`, { name: 'Haem Bridge 2' });
    await p.cmp.runAction('move');
    expect(p.api.patch).toHaveBeenCalledWith(`/api/bridges/${FX_BRIDGE_HAEM.id}`, { branchId: 'b2' });
  });

  it('a server error code reaches the screen as words (bridge_has_instruments)', async () => {
    const p = render(BridgeDetailComponent, { inputs: { id: FX_BRIDGE_HAEM.id }, dialog: { choose: async () => 'b2' } });
    await settle();
    p.api.patch.mockReturnValueOnce(throwError(() => new ApiError('x', 'bridge_has_instruments')) as never);
    await p.cmp.runAction('move');
    expect(p.toasts.error).toHaveBeenCalledWith('Move its analyzers off this Bridge first, then change the branch.');
  });

  it('Ignore a source and take an analyzer off — both confirm first', async () => {
    const p = render(BridgeDetailComponent, { inputs: { id: FX_BRIDGE_HAEM.id }, dialog: { confirm: async () => true } });
    await settle(); p.f.detectChanges();
    await p.cmp.ignore(p.cmp.sources()[0]);
    expect(p.api.post).toHaveBeenCalledWith(`/api/bridges/${FX_BRIDGE_HAEM.id}/detected-sources/${p.cmp.sources()[0].id}/ignore`, {});
    await p.cmp.unassign(p.cmp.rows()[0]);
    expect(p.api.put).toHaveBeenCalledWith(`/api/instruments/${p.cmp.rows()[0].id}/bridge`, { bridgeId: null });
  });

  it('Restart and the setup hotspot are commands, after a confirm', async () => {
    const p = render(BridgeDetailComponent, { inputs: { id: FX_BRIDGE_HAEM.id }, dialog: { confirm: async () => true } });
    await settle();
    await p.cmp.runAction('reboot');
    await p.cmp.startHotspot();
    expect(p.api.post).toHaveBeenCalledWith(`/api/bridges/${FX_BRIDGE_HAEM.id}/commands`, { type: 'reboot', payload: {} });
    expect(p.api.post).toHaveBeenCalledWith(`/api/bridges/${FX_BRIDGE_HAEM.id}/commands`, { type: 'hotspot.start', payload: { minutes: 30 } });
  });

  it('Change Wi-Fi: scan → networks → wifi.set with keepPrevious → "Connected to …"', async () => {
    const p = render(BridgeDetailComponent, { inputs: { id: FX_BRIDGE_HAEM.id } });
    await settle();
    p.cmp.wifiOpen.set(true); p.f.detectChanges();
    await flush(); p.f.detectChanges();
    expect(p.api.post).toHaveBeenCalledWith(`/api/bridges/${FX_BRIDGE_HAEM.id}/commands`, { type: 'wifi.scan', payload: {} });
    const nets = Array.from(document.querySelectorAll<HTMLButtonElement>('.pf-bwf__net')).map((b) => b.textContent!.trim());
    expect(nets.some((t) => t.includes('LabWiFi'))).toBe(true);
    (Array.from(document.querySelectorAll<HTMLButtonElement>('.pf-bwf__net')).find((b) => b.textContent!.includes('LabWiFi')))!.click();
    p.f.detectChanges();
    const pw = document.querySelector<HTMLInputElement>('.pf-bwf__pw input')!;
    pw.value = 'secret123'; pw.dispatchEvent(new Event('input')); p.f.detectChanges();
    p.api.get.mockImplementation(((u: string) => u.includes('/commands/')
      ? of({ id: 'c-new', type: 'wifi.set', state: 'succeeded', issuedAt: 't', result: { detail: { ssid: 'LabWiFi', ipv4: '192.168.1.40' } } })
      : of(mockBridgeApi('GET', u)?.body.data ?? [])) as never);
    document.querySelector<HTMLFormElement>('.pf-dialog form')!.dispatchEvent(new Event('submit'));
    await flush(); p.f.detectChanges();
    expect(p.api.post).toHaveBeenCalledWith(`/api/bridges/${FX_BRIDGE_HAEM.id}/commands`,
      { type: 'wifi.set', payload: { ssid: 'LabWiFi', security: 'wpa2-psk', psk: 'secret123', keepPrevious: true } });
    expect(document.querySelector('.pf-dialog')!.textContent).toContain('Connected to LabWiFi');
    expect(document.querySelector('.pf-dialog')!.textContent).toContain('192.168.1.40');
  });

  it('analyzerRows joins instruments with the heartbeat link states', () => {
    const rows = analyzerRows(FX_BRIDGE_HAEM, FX_INSTRUMENTS);
    expect(rows.map((r) => [r.name, r.linkState])).toEqual([['Erba EM-200', 'connected'], ['Sysmex XN-350', 'listening']]);
  });
});

// ── Add ─────────────────────────────────────────────────────────────────────
describe('Add Bridge', () => {
  it('plain web: QR / code / nearby tiles only (no local options); ONE primary', async () => {
    const p = render(BridgeAddComponent);
    await flush(); p.f.detectChanges();
    expect(p.cmp.methods().map((m: any) => m.id)).toEqual(['qr', 'code', 'nearby']);
    expect(primaries(p.el)).toBe(1);
    expect(p.el.textContent).not.toContain('On this Wi-Fi');
    expect(p.el.textContent).not.toContain('set up Wi-Fi');
  });

  it('typed code: formatted as you type, claimed as a secret in the active branch', async () => {
    const p = render(BridgeAddComponent);
    await flush();
    p.cmp.choose('code'); p.f.detectChanges();
    const input = p.el.querySelector<HTMLInputElement>('.pf-bra__code-in')!;
    input.value = '7k2qf9mxrt'; input.dispatchEvent(new Event('input')); p.f.detectChanges();
    expect(input.value).toBe('7K2QF-9MXRT');
    await p.cmp.submit(); p.f.detectChanges();
    expect(p.api.post).toHaveBeenCalledWith('/api/bridges/claim', { method: 'secret', claimSecret: '7K2QF9MXRT', branchId: BRANCH_SALEM.id });
    expect(p.el.textContent).toContain('is in your lab');
  });

  it('a wrong code shows the contract copy', async () => {
    const p = render(BridgeAddComponent);
    await flush();
    p.cmp.choose('code');
    p.cmp.code.set('BADC0-DE000');
    await p.cmp.submit(); p.f.detectChanges();
    expect(p.el.querySelector('.pf-bra__err')!.textContent).toContain("Check the code. If the Bridge isn't online yet, scan its QR.");
  });

  it('scanned QR: shows serial + setup Wi-Fi, claims secret + serial', async () => {
    const p = render(BridgeAddComponent);
    await flush();
    p.cmp.onScanned(VECTOR_QR_URL); p.f.detectChanges();
    expect(p.el.querySelector('.pf-bra__facts')!.textContent).toContain('Prefrontal-Bridge-1234');
    await p.cmp.submit();
    expect(p.api.post).toHaveBeenCalledWith('/api/bridges/claim', expect.objectContaining({ method: 'secret', claimSecret: '7K2QF-9MXRT', serial: '10000000ABCD1234' }));
  });

  it('a non-Bridge QR / a newer QR version say so', async () => {
    const p = render(BridgeAddComponent);
    await flush();
    p.cmp.onScanned('LAB26001'); p.f.detectChanges();
    expect(p.el.querySelector('.pf-bra__err')!.textContent).toContain('not a Prefrontal Bridge code');
    p.cmp.onScanned('https://lab.prefrontal.health/b#7.X'); p.f.detectChanges();
    expect(p.el.querySelector('.pf-bra__err')!.textContent).toContain('Update the app to add this Bridge');
  });

  it('nearby (?nearby=): offer + admin CONFIRM, then claim nearby', async () => {
    const p = render(BridgeAddComponent, { inputs: { nearby: FX_NEARBY[0].announcementId }, dialog: { confirm: async () => true } });
    await flush(); p.f.detectChanges();
    expect(p.cmp.method()).toBe('nearby');
    await p.cmp.submit();
    expect(p.dialog.confirm).toHaveBeenCalled();
    expect(p.api.post).toHaveBeenCalledWith('/api/bridges/claim', expect.objectContaining({ method: 'nearby', announcementId: FX_NEARBY[0].announcementId }));
  });

  it('nearby declined at the confirm → nothing claimed', async () => {
    const p = render(BridgeAddComponent, { inputs: { nearby: FX_NEARBY[0].announcementId } });
    await flush();
    await p.cmp.submit();
    expect(p.api.post).not.toHaveBeenCalledWith('/api/bridges/claim', expect.anything());
  });

  it('native: "On this Wi-Fi" → pinned identity → nonce → signed ticket → claim local', async () => {
    const local = localDouble();
    const p = render(BridgeAddComponent, { local });
    await flush(); p.f.detectChanges();
    expect(p.cmp.methods().map((m: any) => m.id)).toContain('local');
    p.cmp.choose('local');
    await flush(); p.f.detectChanges();
    expect(p.el.textContent).toContain('Prefrontal Bridge 1234');
    p.cmp.localSerial.set('10000000ABCD1234');
    await p.cmp.submit();
    const urls = (local.request as any).mock.calls.map((c: any) => c[0].url);
    expect(urls).toEqual(['https://192.168.1.23:8443/local/v1/identity', 'https://192.168.1.23:8443/local/v1/claim-ticket']);
    expect(p.api.post).toHaveBeenCalledWith('/api/bridges/claim/nonce', {});
    expect(p.api.post).toHaveBeenCalledWith('/api/bridges/claim', expect.objectContaining({ method: 'local', ticket: FX_TICKET }));
  });

  it('native + QR: "Add + set up Wi-Fi" runs the hotspot relay to the network picker', async () => {
    const local = localDouble({
      request: vi.fn(async (r: any) => ({ status: 200, body: JSON.stringify({ success: true, data: r.url.endsWith('/identity') ? FX_IDENTITY : { networks: [{ ssid: 'LabWiFi', signal: 70, security: 'wpa2-psk' }] } }) })),
    });
    const p = render(BridgeAddComponent, { local });
    await flush();
    p.cmp.onScanned(VECTOR_QR_URL); p.f.detectChanges();
    expect(p.el.textContent).toContain('Add + set up Wi-Fi');
    p.cmp.startRelay(false);
    await flush(); p.f.detectChanges();
    expect(local.joinHotspot).toHaveBeenCalledWith('Prefrontal-Bridge-1234', '8F3KQ2M9XW4T');
    expect(p.cmp.relay().state().step).toBe('pick_network');
    expect(p.el.querySelector('.pf-bwf__nets')!.textContent).toContain('LabWiFi');
    expect(primaries(p.el)).toBe(1);
  });

  it('the /b page hands the QR over through sessionStorage (no secret in the URL)', async () => {
    sessionStorage.setItem(BRIDGE_QR_HANDOFF_KEY, '#' + VECTOR_QR_URL.split('#')[1]);
    const p = render(BridgeAddComponent);
    await flush(); p.f.detectChanges();
    expect(p.cmp.qr()?.serial).toBe('10000000ABCD1234');
    expect(sessionStorage.getItem(BRIDGE_QR_HANDOFF_KEY)).toBeNull();
  });
});

// ── Shell banner + public /b page ───────────────────────────────────────────
describe('"New Bridge found nearby — Add?" banner', () => {
  it('shows ONE offer for manage_bridges; Not now hides it; Add opens the add screen', async () => {
    const p = render(BridgeNearbyBannerComponent);
    await flush(); p.f.detectChanges();
    expect(p.el.querySelector('.pf-bnb')!.textContent).toContain(FX_NEARBY[0].serialShort);
    expect(primaries(p.el)).toBe(1);
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    p.cmp.add(FX_NEARBY[0].announcementId);
    expect(nav).toHaveBeenCalledWith(['/admin/bridges', 'add'], { queryParams: { nearby: FX_NEARBY[0].announcementId } });
    p.cmp.notNow(FX_NEARBY[0].announcementId); p.f.detectChanges();
    expect(p.el.querySelector('.pf-bnb')).toBeNull();
  });

  it('renders nothing (and never polls) without manage_bridges', async () => {
    const p = render(BridgeNearbyBannerComponent, { perms: ['enter_result'] });
    await flush(); p.f.detectChanges();
    expect(p.el.querySelector('.pf-bnb')).toBeNull();
    expect(p.api.get).not.toHaveBeenCalledWith('/api/bridges/nearby');
  });
});

describe('public /b page', () => {
  it('stashes the fragment, scrubs it from the address bar and goes to /admin/bridges/add', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const replace = vi.spyOn(history, 'replaceState').mockImplementation(() => undefined);
    const err = handleBridgeLinkHref('https://lab.prefrontal.health/b#' + VECTOR_QR_URL.split('#')[1], router);
    expect(err).toBeNull();
    expect(sessionStorage.getItem(BRIDGE_QR_HANDOFF_KEY)).toContain('1.10000000ABCD1234.');
    expect(nav).toHaveBeenCalledWith('/admin/bridges/add', { replaceUrl: true });
    expect(replace.mock.calls[0].slice(1)).toEqual(['', 'https://lab.prefrontal.health/b']);
    expect(handleBridgeLinkHref('https://lab.prefrontal.health/b#hello', router)).toContain('not a Prefrontal Bridge code');
    replace.mockRestore();
  });

  it('the page explains a link with no Bridge payload', () => {
    TestBed.configureTestingModule({ imports: [BridgeLinkPage], providers: [provideRouter([])] });
    const f = TestBed.createComponent(BridgeLinkPage);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).textContent).toContain('type the claim code');
  });
});

void fxClaimResult;
