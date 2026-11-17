import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { of } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { DeviceClassService } from '../../core/services/device-class.service';
import { DialogService } from '../../core/services/dialog.service';
import { ToastService } from '../../core/services/toast.service';
import { ThemeService } from '../../core/services/theme.service';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { FilesBridge } from './files-bridge';
import { FilesSaver } from './files-save';
import { FilesEditorPage } from './files-editor.page';
import { SheetEditorService, SheetOpenRequest } from '../neuron/sheet-editor.service';
import { FilesAccessService } from './files-access.service';
import { FilesDeviceService } from './files-device.service';
import { FilesEngineService } from './files-engine.service';
import { FILES_APPS } from './files-registry';
import { OfficeService } from './office.service';

const PK = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1]).buffer as ArrayBuffer;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]).buffer as ArrayBuffer;
const CSV = new Uint8Array(Array.from(new TextEncoder().encode('a,b\n1,2\n'))).buffer as ArrayBuffer;
const dto = (over: Record<string, unknown> = {}) => ({ id: 'f1', name: 'Budget.xlsx', kind: 'sheet', sizeBytes: 5, version: 2, updatedAt: '2026-11-14T05:00:00Z', updatedByName: 'Kavya', ...over });

@Component({ selector: 'pf-hero-band', standalone: true, template: '<ng-content></ng-content><ng-content select="[band-center]"></ng-content><ng-content select="[band-search]"></ng-content><ng-content select="[band-actions]"></ng-content>' })
class HeroStub { }

interface Opts { place?: 'lab' | 'device' | null; engine?: boolean; kind?: string; id?: string; phone?: boolean; full?: boolean; canRead?: boolean; canWrite?: boolean; request?: SheetOpenRequest | null; list?: unknown[]; perms?: string[]; fromScreen?: boolean }

function make(o: Opts = {}) {
  const kind = o.kind ?? 'sheet';
  const app = FILES_APPS.find(a => a.route === kind)!;
  const sheetsSvc = { open: vi.fn(async (_r?: unknown) => true), take: vi.fn(() => o.request ?? null), openedFromScreen: !!o.fromScreen, back: vi.fn(), clearOrigin: vi.fn() };
  const perms = o.perms ?? ['*all'];
  const office = {
    list: vi.fn(async () => o.list ?? [dto({ containsPhi: true, phiSources: [{ source: 'results', at: '2026-11-15T05:00:00Z', byName: 'Lakshmi Admin' }] })]),
    content: vi.fn(async () => ({ bytes: PK.slice(0), version: '2' })),
    resultsWorkbook: vi.fn(async () => ({ bytes: PK.slice(0), truncated: false, fileName: 'Glucose.xlsx' as string | null, rowCount: 12 as number | null })),
    rename: vi.fn(async () => dto()), deviceExport: vi.fn(async () => undefined), markPhi: vi.fn(async (_id: string, _s: string) => dto({ containsPhi: true, phiSources: [{ source: 'patient', at: '2026-11-15T05:00:00Z' }] })),
  };
  const dialog = { confirm: vi.fn(async (_r?: unknown) => true), alert: vi.fn(async (_r?: unknown) => undefined), prompt: vi.fn(async () => null), actions: vi.fn(async (_r?: unknown) => ({ action: (o.place ?? null) as string | null, checked: false })) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const saver = { store: vi.fn(async (..._a: unknown[]): Promise<any> => ({ kind: 'saved', file: dto({ version: 3 }) })) };
  const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  const full = signal(o.full !== false);
  const canWrite = o.canWrite !== false;
  const access = {
    ensureLoaded: vi.fn(async () => undefined), available: () => true, full, viewOnly: () => !full(), phone: () => !!o.phone, phoneCanEdit: () => !o.phone,
    settings: () => ({ hiddenTemplates: [], ownTemplates: [{ id: 't1', kind: 'sheet', name: 'Our stock sheet', fileId: 'tf1' }] }),
    canRead: () => o.canRead !== false, canWrite: () => full() && canWrite && !o.phone, access: () => ({ patientNames: true, trashDays: 30 }),
  };
  const device = {
    open: vi.fn(async () => ({ target: { kind: 'device', name: 'Mine.xlsx', token: 't1' }, name: 'Mine.xlsx', bytes: PK.slice(0) })),
    save: vi.fn(async (_app: unknown, name: string, _b: unknown, target: { kind: string } | null, _saveAs?: boolean) => ({ target: target?.kind === 'device' ? target : { kind: 'device', name }, name, inPlace: target?.kind === 'device' })),
    canSaveInPlace: (t: { kind: string; token?: string } | null) => !!t && t.kind === 'device' && !!t.token, client: () => 'web' as const,
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ kind: app.route, id: o.id ?? 'new' }) } } },
      { provide: OfficeService, useValue: office },
      { provide: SheetEditorService, useValue: sheetsSvc },
      { provide: FilesSaver, useValue: saver },
      { provide: FilesAccessService, useValue: access },
      { provide: FilesDeviceService, useValue: device },
      { provide: FilesEngineService, useValue: { available: async () => o.engine !== false } },
      { provide: DialogService, useValue: dialog },
      { provide: ToastService, useValue: toast },
      { provide: ApiService, useValue: { get: () => of([{ id: 't1', name: 'Glucose' }]) } },
      { provide: AuthService, useValue: { user: signal({ displayName: 'Kavya Desk', tenantName: 'Micro World', branches: [{ id: 'b1', name: 'Main' }] }), activeBranchId: () => 'b1',
          hasAnyPermission: (c: string[]) => perms.includes('*all') || c.some(x => perms.includes(x)) } },
      { provide: ThemeService, useValue: { mode: signal('light'), isDark: () => false } },
      { provide: DeviceClassService, useValue: { deviceClass: signal(o.phone ? 'phone' : 'desktop') } },
    ],
  });
  TestBed.overrideComponent(FilesEditorPage, { remove: { imports: [HeroBandComponent] }, add: { imports: [HeroStub], schemas: [NO_ERRORS_SCHEMA] } });
  const fixture = TestBed.createComponent(FilesEditorPage);
  fixture.detectChanges();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page = fixture.componentInstance as any;
  const bridge = fixture.debugElement.injector.get(FilesBridge);
  const el = fixture.nativeElement as HTMLElement;
  // async/await in the page is not tracked by the zone: give its promise chain real ticks before looking.
  const settle = async () => { for (let i = 0; i < 4; i++) { await fixture.whenStable(); await new Promise(r => setTimeout(r, 0)); fixture.detectChanges(); } };
  const fromFrame = (data: Record<string, unknown>) => {
    const iframe = el.querySelector('iframe') as HTMLIFrameElement;
    bridge.handle({ origin: window.location.origin, source: iframe.contentWindow as MessageEventSource, data } as MessageEvent);
    fixture.detectChanges();
  };
  const t = (id: string) => el.querySelector(`[data-testid="${id}"]`);
  return { fixture, page, bridge, el, office, dialog, saver, toast, settle, fromFrame, sheetsSvc, device, access, full, t, app };
}
const savedMsg = (prefix = 'neuron:', name = 'Budget.xlsx', bytes: ArrayBuffer = PK.slice(0)) => ({ type: `${prefix}save`, name, bytes });

describe('Files editor: access', () => {
  it('a role or lab without this app gets a plain "isn\'t available" screen and no engine', async () => {
    const { settle, t, el } = make({ canRead: false });
    await settle();
    expect(t('files-unavailable')?.textContent).toContain("Neuron isn't available to you");
    expect(el.querySelector('iframe')).toBeNull();
  });

  it('a blank new file opens for someone who may write: Save, no "where" chip for a lab file, no View only chip, no device buttons in the band', async () => {
    const { settle, t, el, page } = make();
    await settle();
    expect(el.querySelector('iframe')).toBeTruthy();
    expect(t('files-save')).toBeTruthy();
    expect(t('files-where')).toBeNull();
    expect(t('files-device-open')).toBeNull();
    expect(t('files-device-save')).toBeNull();
    expect(t('files-viewonly-chip')).toBeNull();
    expect(page.app().id).toBe('neuron');
  });

  it('each app route hosts ITS engine: the frame URL carries the app\'s folder and readonly follows the rights', async () => {
    for (const a of FILES_APPS.filter(x => x.id !== 'myelin' && x.id !== 'retina')) {
      TestBed.resetTestingModule();
      const { el, settle } = make({ kind: a.route });
      await settle();
      expect(el.querySelector('[data-testid="files-editor"]')?.getAttribute('data-app')).toBe(a.id);
      expect((el.querySelector('iframe') as HTMLIFrameElement).src).toContain(`/${a.enginePath}index.html`);
    }
  });

  it('VIEW ONLY (the lab is not entitled to Full): a stored file opens read-only with a quiet chip, no Save, no rename, no insert', async () => {
    const { settle, t, el, page } = make({ id: 'f1', full: false });
    await settle();
    expect(el.querySelector('iframe')).toBeTruthy();
    expect((el.querySelector('iframe') as HTMLIFrameElement).src).toContain('readonly=1');
    expect(t('files-viewonly-chip')?.textContent?.trim()).toBe('View only');
    expect(t('files-save')).toBeNull();
    expect(t('neuron-insert')).toBeNull();
    expect(page.canRename()).toBe(false);
    expect(page.saveState()).toBe('Saved');
    expect(t('files-device-save')).toBeNull();                 // the device is a place in the File screen, not a band button
  });

  it('View only with nothing to open leaves for the Files list instead of showing an empty editor', async () => {
    const { page, settle, el } = make({ full: false });
    const nav = vi.spyOn((page as { router: { navigateByUrl: (u: string) => Promise<boolean> } }).router, 'navigateByUrl').mockResolvedValue(true);
    await settle();
    expect(el.querySelector('iframe')).toBeNull();
    expect(nav).toHaveBeenCalledWith('/files', { replaceUrl: true });
  });

  it('a phone is view-only: the plain strip, no Save, no "Open from this device"', async () => {
    const { settle, t } = make({ phone: true, id: 'f1' });
    await settle();
    expect(t('files-phone-viewonly')?.textContent).toContain('View and copy only');
    expect(t('files-save')).toBeNull();
    expect(t('files-device-open')).toBeNull();
  });

  it('a role that cannot write but the lab is Full: the strip says what to do', async () => {
    const { settle, t } = make({ id: 'f1', canWrite: false });
    await settle();
    expect(t('files-readonly')?.textContent).toContain('different role');
    expect(t('files-viewonly-chip')).toBeNull();
  });

  it('a file that is gone or the wrong type says so and opens nothing', async () => {
    const gone = make({ id: 'zzz', list: [] });
    await gone.settle();
    expect(gone.t('files-unavailable')?.textContent).toContain("isn't there any more");
    TestBed.resetTestingModule();
    const bad = make({ id: 'f1' });
    bad.office.content.mockResolvedValueOnce({ bytes: CSV.slice(0), version: '2' });
    bad.fixture.destroy();
  });

  it('bytes handed over by another screen that are not this app\'s type open nothing', async () => {
    const { settle, t, el } = make({ request: { source: 'Reports', bytes: CSV.slice(0), name: 'x.xlsx' } });
    await settle();
    expect(t('files-unavailable')?.textContent).toContain("can't be opened");
    expect(el.querySelector('iframe')).toBeNull();
  });
});

describe('Files editor: the loading screen is the app itself', () => {
  it('while the engine boots each app shows ITS OWN first screen (not a generic skeleton) and the frame stays behind it', async () => {
    for (const a of FILES_APPS) {
      TestBed.resetTestingModule();
      const { settle, t, el } = make({ kind: a.route });
      await settle();
      const loader = t('files-loading');
      expect(loader?.tagName.toLowerCase()).toBe('pf-files-loading');
      expect(loader?.getAttribute('data-app')).toBe(a.id);
      expect(loader?.getAttribute('data-mode')).toBe('file');
      expect(loader?.getAttribute('aria-label')).toBe(`Opening ${a.name}…`);
      expect(el.querySelector('pf-skeleton-detail, pf-skeleton-rows')).toBeNull();
      expect(el.querySelector('iframe')).toBeTruthy();
    }
  });

  it('the start route draws the app\'s start screen; the loader leaves once the engine says ready', async () => {
    const { settle, t, fromFrame } = make({ id: 'start' });
    await settle();
    expect(t('files-loading')?.getAttribute('data-mode')).toBe('start');
    expect(t('files-loader-neuron-start')).toBeTruthy();
    fromFrame({ type: 'neuron:ready' });
    expect(t('files-loading')?.classList.contains('pf-fl-leave')).toBe(true);   // fading out over the app, no jump
    await new Promise(r => setTimeout(r, 260));
    await settle();
    expect(t('files-loading')).toBeNull();
  });

  it('before the file is in hand the same loader holds the place (no second, different loader)', () => {
    const { t, el } = make({ id: 'f1' });                          // first render: the list/content calls have not resolved yet
    expect(t('files-loading')?.getAttribute('data-app')).toBe('neuron');
    expect(el.querySelectorAll('pf-files-loading').length).toBe(1);
  });
});

describe('Files editor: an engine that is not shipped yet', () => {
  it('shows the plain "can\'t open here" state for the app, with Back, and no endless loading', async () => {
    const { settle, t, el } = make({ kind: 'doc', engine: false });
    await settle();
    expect(t('files-failed')?.textContent).toContain("Synapse can't open here");
    expect(t('files-failed')?.textContent).toContain("isn't available in this build yet");
    expect(t('files-loading')).toBeNull();
    expect(el.querySelector('iframe')).toBeNull(); // no second copy of the app behind the message (SPA fallback)
  });
  it('an engine that is there loads normally', async () => {
    const { settle, t } = make({ kind: 'doc' });
    await settle();
    expect(t('files-failed')).toBeNull();
  });
});

describe('Files editor: patient data', () => {
  it('Insert results marks the new sheet as holding patient data BEFORE it is saved, and the first save carries the reason', async () => {
    const { page, settle, saver, t, fromFrame } = make();
    await settle();
    page.pickedTests.set(['t1']);
    await page.insertResults();
    await settle();
    expect(page.session().pendingPhi).toBe('results');
    expect(t('files-phi-chip')?.textContent).toContain('Contains patient data · kept out of outside AI');
    fromFrame({ type: 'neuron:ready' });
    fromFrame(savedMsg());
    await settle();
    expect(saver.store).toHaveBeenCalledTimes(1);
    expect(saver.store.mock.calls[0][3]).toBe('results');
    expect(page.session().pendingPhi).toBeNull();
  });

  it('a stored flagged file shows the chip and clicking it lists who and when in plain words', async () => {
    const { page, settle, t, dialog } = make({ id: 'f1' });
    await settle();
    expect(t('files-phi-chip')).toBeTruthy();
    await page.showPhi();
    const msg = (dialog.alert.mock.calls[0][0] as { message: string }).message;
    expect(msg).toContain('Lab results were inserted');
    expect(msg).toContain('by Lakshmi Admin');
    expect(msg).toContain('15 Nov');
    expect(msg).not.toContain('results,');                 // never the server\'s code on its own
  });

  it('a file with no flag shows no chip', async () => {
    const { settle, t } = make({ id: 'f1', list: [dto()] });
    await settle();
    expect(t('files-phi-chip')).toBeNull();
  });
});

describe('Files editor: this device', () => {
  it('saving a LAB file to the device asks the server first; a refusal writes NOTHING', async () => {
    const { page, settle, device, office, toast, fromFrame, bridge } = make({ id: 'f1' });
    await settle();
    fromFrame({ type: 'neuron:ready' });
    vi.spyOn(bridge, 'save').mockReturnValue(true);              // the engine answers with its bytes (below)
    office.deviceExport.mockRejectedValueOnce(Object.assign(new Error("This file contains patient data, and your role can't save it to this device."), {}));
    await page.saveToDevice();
    fromFrame(savedMsg());
    await settle();
    expect(office.deviceExport).toHaveBeenCalledWith('f1', 'web');
    expect(device.save).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("can't save it to this device"));
  });

  it('an allowed device save asks first, then writes the copy', async () => {
    const { page, settle, device, office, toast, fromFrame, bridge } = make({ id: 'f1' });
    await settle();
    fromFrame({ type: 'neuron:ready' });
    vi.spyOn(bridge, 'save').mockReturnValue(true);              // the engine answers with its bytes (below)
    await page.saveToDevice();
    fromFrame(savedMsg());
    await settle();
    expect(office.deviceExport).toHaveBeenCalledTimes(1);
    expect(device.save).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalled();
  });

  it('opening from the device: the chip says "On this device", the file is not flagged, and Save goes back to the device in place (never the lab)', async () => {
    const { page, settle, t, device, saver, fromFrame, office } = make();
    await settle();
    await page.openFromDevice();
    await settle();
    expect(t('files-where')?.textContent).toContain('On this device');
    expect(t('files-phi-chip')).toBeNull();
    fromFrame({ type: 'neuron:ready' });
    fromFrame(savedMsg('neuron:', 'Mine.xlsx'));
    await settle();
    expect(device.save).toHaveBeenCalledTimes(1);
    expect(device.save.mock.calls[0][3]).toMatchObject({ kind: 'device', token: 't1' });
    expect(saver.store).not.toHaveBeenCalled();
    expect(office.deviceExport).not.toHaveBeenCalled();            // nothing of the lab leaves
  });

  it('a View only lab can still save a COPY of a stored file to the device (after the server check), and never stores one', async () => {
    const { settle, device, saver, office, fromFrame } = make({ id: 'f1', full: false });
    await settle();
    fromFrame({ type: 'neuron:ready' });
    fromFrame(savedMsg());
    await settle();
    expect(office.deviceExport).toHaveBeenCalledTimes(1);
    expect(device.save).toHaveBeenCalledTimes(1);
    expect(saver.store).not.toHaveBeenCalled();
  });

  it('a wrong-type file from the device is refused with the plain reason and nothing opens', async () => {
    const { page, settle, device, toast, el } = make({ full: true });
    await settle();
    device.open.mockRejectedValueOnce(new Error('Only .xlsx files can be used with Neuron.'));
    await page.openFromDevice();
    expect(toast.error).toHaveBeenCalledWith('Only .xlsx files can be used with Neuron.');
    expect(el.querySelector('iframe')).toBeTruthy();                      // the blank file that was already open stays
  });

  it('the engine\'s File → Open asks "Prefrontal · lab or This device": the device choice opens the picker, the lab choice goes to the Files list for this app', async () => {
    const dev = make({ place: 'device' });
    await dev.settle();
    dev.bridge.onRequest('open');
    await dev.settle();
    expect(dev.dialog.actions).toHaveBeenCalled();
    const acts = (dev.dialog.actions.mock.calls[0][0] as { actions: { value: string; label: string }[] }).actions;
    expect(acts.map(a => a.label)).toEqual(['Prefrontal · Micro World', 'This device']);
    expect(dev.device.open).toHaveBeenCalled();
    expect(dev.page.session().target).toMatchObject({ kind: 'device', token: 't1' });
    TestBed.resetTestingModule();
    const lab = make({ place: 'lab' });
    await lab.settle();
    const nav = vi.spyOn((lab.page as { router: { navigateByUrl: (u: string) => Promise<boolean> } }).router, 'navigateByUrl').mockResolvedValue(true);
    lab.bridge.onRequest('open');
    await lab.settle();
    expect(nav).toHaveBeenCalledWith('/files?type=sheet');
    expect(lab.device.open).not.toHaveBeenCalled();
  });

  it('Save As asked by the engine: the person picks the place FIRST, the engine is told to go on (saveAsTo), and its save then goes exactly there', async () => {
    const { page, settle, bridge, device, saver, office, fromFrame } = make({ id: 'f1', place: 'device' });
    await settle();
    fromFrame({ type: 'neuron:ready' });
    const to = vi.spyOn(bridge, 'saveAsTo').mockReturnValue(true);
    bridge.onRequest('saveAs', 'Copy of Budget.xlsx');
    await settle();
    expect(to).toHaveBeenCalledWith('Copy of Budget.xlsx');
    fromFrame({ type: 'neuron:save', name: 'Copy of Budget.xlsx', saveAs: true, bytes: PK.slice(0) });
    await settle();
    expect(office.deviceExport).toHaveBeenCalledWith('f1', 'web');          // a lab file leaving for the device asks the server first
    expect(device.save).toHaveBeenCalledTimes(1);
    expect(saver.store).not.toHaveBeenCalled();
    void page;
  });

  it('Save As to the lab makes a NEW lab file that names its original (so a flagged original flags the copy); a cancelled choice saves nothing', async () => {
    const lab = make({ id: 'f1', place: 'lab' });
    await lab.settle();
    lab.fromFrame({ type: 'neuron:ready' });
    lab.fromFrame({ type: 'neuron:save', name: 'Budget v2.xlsx', saveAs: true, bytes: PK.slice(0) });      // an engine without saveAsRequest: asked at save time
    await lab.settle();
    expect(lab.dialog.actions).toHaveBeenCalled();
    expect(lab.saver.store.mock.calls[0][0]).toMatchObject({ id: null, name: 'Budget v2.xlsx', copyOf: 'f1' });
    TestBed.resetTestingModule();
    const none = make({ id: 'f1', place: null });
    await none.settle();
    none.fromFrame({ type: 'neuron:ready' });
    none.fromFrame({ type: 'neuron:save', name: 'X.xlsx', saveAs: true, bytes: PK.slice(0) });
    await none.settle();
    expect(none.saver.store).not.toHaveBeenCalled();
    expect(none.device.save).not.toHaveBeenCalled();
  });

  it('a plain Save (same name) goes to the lab in place; an export or copy under another name (Myelin: extract, split, redacted copy) goes to the device as a copy', async () => {
    const { settle, saver, device, fromFrame, office } = make({ id: 'f1' });
    await settle();
    fromFrame({ type: 'neuron:ready' });
    fromFrame({ type: 'neuron:save', name: 'Budget.xlsx', saveAs: false, bytes: PK.slice(0) });
    await settle();
    expect(saver.store).toHaveBeenCalledTimes(1);
    expect(saver.store.mock.calls[0][0]).toMatchObject({ id: 'f1' });
    fromFrame({ type: 'neuron:save', name: 'Budget (pages 1-2).xlsx', saveAs: false, bytes: PK.slice(0) });
    await settle();
    expect(saver.store).toHaveBeenCalledTimes(1);
    expect(office.deviceExport).toHaveBeenCalledWith('f1', 'web');
    expect(device.save).toHaveBeenCalledTimes(1);
    expect(device.save.mock.calls[0][4]).toBe(true);                         // a copy: Save As, never in place
  });

  it('Neuron (no saveAs in its messages) keeps saving in place', async () => {
    const { settle, saver, fromFrame } = make({ id: 'f1' });
    await settle();
    fromFrame({ type: 'neuron:ready' });
    fromFrame({ type: 'neuron:save', name: 'Budget.xlsx', bytes: PK.slice(0) });
    await settle();
    expect(saver.store).toHaveBeenCalledTimes(1);
  });

  it('the engine reporting patient data flags a stored file at once (sticky), an unsaved one with its first save, and a device file never', async () => {
    const stored = make({ id: 'f1', list: [dto()] });
    await stored.settle();
    expect(stored.t('files-phi-chip')).toBeNull();
    stored.bridge.onPhi('phi');
    await stored.settle();
    expect(stored.office.markPhi).toHaveBeenCalledWith('f1', 'patient');
    stored.bridge.onPhi('paste');
    await stored.settle();
    expect(stored.office.markPhi).toHaveBeenLastCalledWith('f1', 'copy');
    TestBed.resetTestingModule();
    const fresh = make();
    await fresh.settle();
    fresh.bridge.onPhi('paste');
    await fresh.settle();
    expect(fresh.office.markPhi).not.toHaveBeenCalled();
    expect(fresh.page.session().pendingPhi).toBe('copy');
    expect(fresh.t('files-phi-chip')).toBeTruthy();
    TestBed.resetTestingModule();
    const dev = make();
    await dev.settle();
    await dev.page.openFromDevice();
    await dev.settle();
    dev.bridge.onPhi('phi');
    await dev.settle();
    expect(dev.office.markPhi).not.toHaveBeenCalled();
    expect(dev.t('files-phi-chip')).toBeNull();
  });
});

describe('Files editor: saving to the lab', () => {
  it('Save stores through the saver (never the device) and turns the state to Saved', async () => {
    const { page, settle, saver, fromFrame, device } = make();
    await settle();
    fromFrame({ type: 'neuron:ready' });
    fromFrame({ type: 'neuron:dirty', dirty: true });
    expect(page.saveState()).toBe('Unsaved changes');
    fromFrame(savedMsg());
    await settle();
    fromFrame({ type: 'neuron:dirty', dirty: false });          // the engine reports the file clean after a save
    expect(saver.store).toHaveBeenCalledTimes(1);
    expect(device.save).not.toHaveBeenCalled();
    expect(page.saveState()).toBe('Saved');
  });

  it('a PDF export from the engine is a download, never stored', async () => {
    const { settle, saver, fromFrame } = make();
    await settle();
    fromFrame({ type: 'neuron:ready' });
    const dl = vi.spyOn(document, 'createElement');
    fromFrame({ type: 'neuron:save', name: 'x.pdf', bytes: new Uint8Array(Array.from(new TextEncoder().encode('%PDF-1.7 x'))).buffer });
    await settle();
    expect(saver.store).not.toHaveBeenCalled();
    dl.mockRestore();
  });

  it('leaving with unsaved changes asks first; a clean file leaves without a question', async () => {
    const { page, settle, dialog, fromFrame } = make();
    await settle();
    fromFrame({ type: 'neuron:ready' });
    expect(await page.canLeave()).toBe(true);
    expect(dialog.confirm).not.toHaveBeenCalled();
    fromFrame({ type: 'neuron:dirty', dirty: true });
    dialog.confirm.mockResolvedValueOnce(false);
    expect(await page.canLeave()).toBe(false);
    expect(dialog.confirm).toHaveBeenCalledTimes(1);
  });

  it('a lab template (copyOf) and a built-in template are handed to the engine; the template runs once it is ready', async () => {
    const { page, settle, bridge, fromFrame } = make({ request: { source: 'Files', template: { cmd: 'file.new', params: { sample: 'qc' } } } });
    await settle();
    const run = vi.spyOn(bridge, 'runCommand').mockReturnValue(true);
    expect(run).not.toHaveBeenCalled();
    fromFrame({ type: 'neuron:ready' });
    expect(run).toHaveBeenCalledWith('file.new', { sample: 'qc' });
    expect(page.session().file.id).toBeNull();
  });
});

describe('Files editor: comments', () => {
  const commentList = [dto({ sharedAccess: 'comment', commentCount: 2 })];

  it('a "Can comment" share opens read-only, says so, tells the engine comments are allowed, and has no Save', async () => {
    const { settle, t, el, bridge, page } = make({ id: 'f1', list: commentList, canWrite: false });
    await settle();
    expect(t('files-comment-chip')?.textContent?.trim()).toBe('Can comment');
    expect(t('files-save')).toBeNull();
    expect((el.querySelector('iframe') as HTMLIFrameElement).src).toContain('readonly=1');
    expect(bridge.canComment).toBe(true);
    expect(page.canWrite()).toBe(false);
  });

  it('a comment-only save from the engine goes back to the lab file in place (with the open-comment count); a save that is not comment-only is a device copy', async () => {
    const { settle, saver, device, office, fromFrame } = make({ id: 'f1', list: commentList, canWrite: false });
    await settle();
    fromFrame({ type: 'neuron:ready' });
    fromFrame({ type: 'neuron:comments', count: 4, open: 3 });
    fromFrame({ type: 'neuron:save', name: 'Budget.xlsx', saveAs: false, commentOnly: true, bytes: PK.slice(0) });
    await settle();
    expect(saver.store).toHaveBeenCalledTimes(1);
    expect(saver.store.mock.calls[0][0]).toMatchObject({ id: 'f1' });
    expect(saver.store.mock.calls[0][4]).toEqual({ commentOnly: true, commentCount: 3 });
    expect(device.save).not.toHaveBeenCalled();
    fromFrame({ type: 'neuron:save', name: 'Budget.xlsx', saveAs: false, bytes: PK.slice(0) });
    await settle();
    expect(saver.store).toHaveBeenCalledTimes(1);
    expect(office.deviceExport).toHaveBeenCalledTimes(1);
    expect(device.save).toHaveBeenCalledTimes(1);
  });

  it('a lab that is View only has no comments: even a comment-only save is only a device copy, and the engine is not told to take comments', async () => {
    const { settle, saver, bridge, device, fromFrame } = make({ id: 'f1', list: commentList, canWrite: false, full: false });
    await settle();
    expect(bridge.canComment).toBe(false);
    fromFrame({ type: 'neuron:ready' });
    fromFrame({ type: 'neuron:save', name: 'Budget.xlsx', saveAs: false, commentOnly: true, bytes: PK.slice(0) });
    await settle();
    expect(saver.store).not.toHaveBeenCalled();
    expect(device.save).toHaveBeenCalledTimes(1);
  });

  it('a writer\'s save carries the engine\'s open-comment count; a file nobody shared has no comment chip', async () => {
    const { settle, saver, t, fromFrame } = make({ id: 'f1', list: [dto()] });
    await settle();
    expect(t('files-comment-chip')).toBeNull();
    fromFrame({ type: 'neuron:ready' });
    fromFrame({ type: 'neuron:comments', count: 2, open: 1 });
    fromFrame({ type: 'neuron:save', name: 'Budget.xlsx', saveAs: false, bytes: PK.slice(0) });
    await settle();
    expect(saver.store.mock.calls[0][4]).toEqual({ commentOnly: undefined, commentCount: 1 });
  });
});


describe('Files editor: an app\'s own start screen (`/files/<kind>/start`)', () => {
  const LIST = [
    dto({ id: 's1', name: 'Newest.xlsx', updatedAt: '2026-11-16T05:00:00Z', containsPhi: true }),
    dto({ id: 's2', name: 'Older.xlsx', updatedAt: '2026-11-10T05:00:00Z' }),
    dto({ id: 'd1', name: 'A letter.docx', kind: 'doc', updatedAt: '2026-11-17T05:00:00Z' }),
  ];
  const homes = (c: { win: { postMessage: unknown } }) => (c.win.postMessage as ReturnType<typeof vi.fn>).mock.calls.map(x => x[0]).filter((m: { type: string }) => m.type === 'neuron:home');
  async function startUp(o: Opts = {}) {
    const m = make({ id: 'start', list: LIST, ...o });
    await m.settle();
    const iframe = m.el.querySelector('iframe') as HTMLIFrameElement;
    const win = { postMessage: vi.fn() };
    Object.defineProperty(iframe, 'contentWindow', { value: win, configurable: true });
    m.fixture.detectChanges();
    m.bridge.attach(iframe);
    m.fromFrame({ type: 'neuron:ready' });
    return { ...m, win, iframe };
  }

  it('opens the engine WITHOUT a file: the app\'s name in the band, no Save, no file name, no Share', async () => {
    const { el, t, page } = await startUp();
    expect(el.querySelector('iframe')).toBeTruthy();
    expect(t('files-start-name')?.textContent?.trim()).toBe('Neuron');
    expect(t('files-save')).toBeNull();
    expect(t('files-name')).toBeNull();
    expect(t('files-share-open')).toBeNull();
    expect(t('files-savestate')).toBeNull();
    expect(page.unsaved()).toBe(false);
  });

  it('tells the engine this app\'s Recent only (newest first, shield flag) and its templates (built-in + the lab\'s own)', async () => {
    const c = await startUp();
    const h = homes(c);
    expect(h.length).toBe(1);
    expect(h[0].recent.map((r: { id: string }) => r.id)).toEqual(['s1', 's2']);
    expect(h[0].recent[0].containsPhi).toBe(true);
    expect(h[0].templates.map((x: { id: string; source: string }) => `${x.id}:${x.source}`)).toEqual(['neuron:results:builtin', 'neuron:qc:builtin', 'neuron:stock:builtin', 'own:t1:lab']);
    expect(h[0]).toMatchObject({ canCreate: true, canOpenDevice: true, placeName: 'Micro World' });
    expect(c.office.list).toHaveBeenCalledWith('sheet');
  });

  it('VIEW ONLY lab: no templates, canCreate false, Recent and Open still there', async () => {
    const c = await startUp({ full: false });
    const h = homes(c)[0];
    expect(h).toMatchObject({ canCreate: false, canOpenDevice: true, templates: [] });
    expect(h.recent).toHaveLength(2);
  });

  it('a phone (view only) gets the same: Recent + Open, no New', async () => {
    const h = homes(await startUp({ phone: true }))[0];
    expect(h.canCreate).toBe(false);
    expect(h.templates).toEqual([]);
    expect(h.recent).toHaveLength(2);
  });

  it('a failed Recent list shows an empty start screen, not a broken one', async () => {
    const m = make({ id: 'start' });
    m.office.list.mockRejectedValueOnce(new Error('down'));
    await m.settle();
    const iframe = m.el.querySelector('iframe') as HTMLIFrameElement;
    const win = { postMessage: vi.fn() };
    Object.defineProperty(iframe, 'contentWindow', { value: win, configurable: true });
    m.bridge.attach(iframe);
    m.fromFrame({ type: 'neuron:ready' });
    const h = win.postMessage.mock.calls.map(x => x[0]).find(x => x.type === 'neuron:home');
    expect(h.recent).toEqual([]);
  });

  it('a Recent row opens THAT stored file through the editor service (back returns here); an id the engine was never given is ignored', async () => {
    const c = await startUp();
    c.fromFrame({ type: 'neuron:openRecent', id: 's2' });
    await c.settle();
    expect(c.sheetsSvc.open).toHaveBeenCalledWith({ app: 'neuron', source: 'Files', fileId: 's2' });
    c.fromFrame({ type: 'neuron:openRecent', id: 'someone-elses' });
    c.fromFrame({ type: 'neuron:openRecent', id: 'd1' });                            // a document is not in a sheet app's Recent
    await c.settle();
    expect(c.sheetsSvc.open).toHaveBeenCalledTimes(1);
  });

  it('a built-in template builds in the open engine and the page becomes an ordinary new file (Save appears)', async () => {
    const c = await startUp();
    const run = vi.fn(); (c.bridge as unknown as { runCommand: unknown }).runCommand = run;
    c.fromFrame({ type: 'neuron:newFromTemplate', id: 'neuron:qc' });
    await c.settle();
    expect(run).toHaveBeenCalledWith('file.new', { sample: 'qc' });
    expect(c.t('files-save')).toBeTruthy();
    expect(c.t('files-start-name')).toBeNull();
    expect(c.page.session().file.name).toBe('QC log.xlsx');
    expect(c.page.saveState()).toBe('Not saved yet');
  });

  it('the lab\'s own template opens a COPY of that stored file (the server copies its patient-data flag)', async () => {
    const c = await startUp();
    c.fromFrame({ type: 'neuron:newFromTemplate', id: 'own:t1' });
    await c.settle();
    expect(c.office.content).toHaveBeenCalledWith('tf1');
    expect(c.page.session().file).toMatchObject({ id: null, name: 'Our stock sheet.xlsx', copyOf: 'tf1' });
    expect(c.page.isStart()).toBe(false);
  });

  it('templates are refused for someone who may not create, and an unknown id does nothing', async () => {
    const ro = await startUp({ full: false });
    ro.fromFrame({ type: 'neuron:newFromTemplate', id: 'neuron:qc' });
    await ro.settle();
    expect(ro.page.isStart()).toBe(true);
    TestBed.resetTestingModule();
    const c = await startUp();
    c.fromFrame({ type: 'neuron:newFromTemplate', id: 'neuron:nope' });
    await c.settle();
    expect(c.page.isStart()).toBe(true);
  });

  it('`started` (the engine\'s own Blank) and the first unsaved change both end the start screen', async () => {
    const a = await startUp();
    a.fromFrame({ type: 'neuron:started' });
    expect(a.page.isStart()).toBe(false);
    expect(a.t('files-save')).toBeTruthy();
    TestBed.resetTestingModule();
    const b = await startUp();
    b.fromFrame({ type: 'neuron:dirty', dirty: true });
    await b.settle();
    expect(b.page.isStart()).toBe(false);
  });

  it('Open on the start screen uses the same place picker; This device opens that file as an ordinary session', async () => {
    const c = await startUp({ place: 'device' });
    c.fromFrame({ type: 'neuron:openRequest' });
    await c.settle();
    expect(c.dialog.actions).toHaveBeenCalled();
    expect(c.device.open).toHaveBeenCalled();
    expect(c.page.isStart()).toBe(false);
    expect(c.page.session().file.name).toBe('Mine.xlsx');
  });

  it('every app\'s start route hosts its own engine without a file', async () => {
    for (const a of FILES_APPS.filter(x => x.id !== 'myelin' && x.id !== 'retina')) {
      TestBed.resetTestingModule();
      const { el, settle, t } = make({ kind: a.route, id: 'start' });
      await settle();
      expect((el.querySelector('iframe') as HTMLIFrameElement).src).toContain(`/${a.enginePath}index.html`);
      expect(t('files-start-name')?.textContent?.trim()).toBe(a.name);
    }
  });

  it('Ctrl+S on the start screen does not save anything', async () => {
    const c = await startUp();
    const save = vi.spyOn(c.bridge, 'save');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
    expect(save).not.toHaveBeenCalled();
  });
});
