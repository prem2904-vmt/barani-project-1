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

interface Opts { engine?: boolean; kind?: string; id?: string; phone?: boolean; full?: boolean; canRead?: boolean; canWrite?: boolean; request?: SheetOpenRequest | null; list?: unknown[]; perms?: string[]; fromScreen?: boolean }

function make(o: Opts = {}) {
  const kind = o.kind ?? 'sheet';
  const app = FILES_APPS.find(a => a.route === kind)!;
  const sheetsSvc = { take: vi.fn(() => o.request ?? null), openedFromScreen: !!o.fromScreen, back: vi.fn(), clearOrigin: vi.fn() };
  const perms = o.perms ?? ['*all'];
  const office = {
    list: vi.fn(async () => o.list ?? [dto({ containsPhi: true, phiSources: [{ source: 'results', at: '2026-11-15T05:00:00Z', byName: 'Lakshmi Admin' }] })]),
    content: vi.fn(async () => ({ bytes: PK.slice(0), version: '2' })),
    resultsWorkbook: vi.fn(async () => ({ bytes: PK.slice(0), truncated: false, fileName: 'Glucose.xlsx' as string | null, rowCount: 12 as number | null })),
    rename: vi.fn(async () => dto()), deviceExport: vi.fn(async () => undefined),
  };
  const dialog = { confirm: vi.fn(async (_r?: unknown) => true), alert: vi.fn(async (_r?: unknown) => undefined), prompt: vi.fn(async () => null), actions: vi.fn(async () => ({ action: null, checked: false })) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const saver = { store: vi.fn(async (..._a: unknown[]): Promise<any> => ({ kind: 'saved', file: dto({ version: 3 }) })) };
  const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  const full = signal(o.full !== false);
  const canWrite = o.canWrite !== false;
  const access = {
    ensureLoaded: vi.fn(async () => undefined), available: () => true, full, viewOnly: () => !full(), phone: () => !!o.phone, phoneCanEdit: () => !o.phone,
    canRead: () => o.canRead !== false, canWrite: () => full() && canWrite && !o.phone, access: () => ({ patientNames: true, trashDays: 30 }),
  };
  const device = {
    open: vi.fn(async () => ({ target: { kind: 'device', name: 'Mine.xlsx', token: 't1' }, name: 'Mine.xlsx', bytes: PK.slice(0) })),
    save: vi.fn(async (_app: unknown, name: string, _b: unknown, target: { kind: string } | null) => ({ target: target?.kind === 'device' ? target : { kind: 'device', name }, name, inPlace: target?.kind === 'device' })),
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

  it('a blank new file opens for someone who may write: Save, the where-chip with the lab name, no View only chip', async () => {
    const { settle, t, el, page } = make();
    await settle();
    expect(el.querySelector('iframe')).toBeTruthy();
    expect(t('files-save')).toBeTruthy();
    expect(t('files-where')?.textContent).toContain('Micro World');
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
    expect(t('files-device-save')?.textContent?.trim()).toBe('Save a copy');
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

describe('Files editor: an engine that is not shipped yet', () => {
  it('shows the plain "can\'t open here" state for the app, with Back, and no endless loading', async () => {
    const { settle, t, el } = make({ kind: 'doc', engine: false });
    await settle();
    expect(t('files-failed')?.textContent).toContain("Synapse can't open here");
    expect(t('files-failed')?.textContent).toContain("isn't available in this build yet");
    expect(t('files-loading')).toBeNull();
    expect(el.querySelector('iframe')).toBeTruthy();
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

  it('the engine asking to Open / Save As through the bridge reaches the same device code', async () => {
    const { page, settle, bridge, device } = make();
    await settle();
    bridge.onRequest('open');
    await settle();
    expect(device.open).toHaveBeenCalled();
    expect(page.session().target).toMatchObject({ kind: 'device', token: 't1' });
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
