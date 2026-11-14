import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AgGridAngular } from 'ag-grid-angular';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { BetaFeaturesService, betaGuard } from '../../core/services/beta-features.service';
import { DeviceClassService } from '../../core/services/device-class.service';
import { DialogService } from '../../core/services/dialog.service';
import { ToastService } from '../../core/services/toast.service';
import { ThemeService } from '../../core/services/theme.service';

import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { NEURON_FAILED_MESSAGE, NeuronBridge } from './neuron-bridge';
import { NeuronSaver } from './neuron-save';
import { SheetEditorPage } from './sheet-editor.page';
import { SheetEditorService, SheetOpenRequest } from './sheet-editor.service';
import { OfficeService } from './office.service';
import { BROKEN_RESULTS_MESSAGE, TRUNCATED_NOTICE } from './results-query';
import { of } from 'rxjs';

const PK = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1]).buffer as ArrayBuffer;
const CSV = new Uint8Array(Array.from(new TextEncoder().encode('a,b\n1,2\n'))).buffer as ArrayBuffer;
const dto = (over: Record<string, unknown> = {}) => ({ id: 'f1', name: 'Budget.xlsx', kind: 'sheet', sizeBytes: 5, version: 2, updatedAt: '2026-11-14T05:00:00Z', updatedByName: 'Kavya', ...over });

@Component({ selector: 'pf-hero-band', standalone: true, template: '<ng-content></ng-content><ng-content select="[band-center]"></ng-content><ng-content select="[band-search]"></ng-content><ng-content select="[band-actions]"></ng-content>' })
class HeroStub { }
@Component({ selector: 'ag-grid-angular', standalone: true, template: '' })
class GridStub { }

function make(opts: { phone?: boolean; list?: unknown[]; perms?: string[]; request?: SheetOpenRequest | null; fromScreen?: boolean } = {}) {
  const sheetsSvc = { take: vi.fn(() => opts.request ?? null), openedFromScreen: !!opts.fromScreen, back: vi.fn(), clearOrigin: vi.fn() };
  const perms = opts.perms ?? ['*all'];
  const office = {
    list: vi.fn(async () => opts.list ?? []),
    content: vi.fn(async () => ({ bytes: PK.slice(0), version: '2' })),
    resultsWorkbook: vi.fn(async () => ({ bytes: PK.slice(0), truncated: false, fileName: 'Glucose.xlsx' as string | null, rowCount: 12 as number | null })),
    rename: vi.fn(async () => dto()), remove: vi.fn(async () => undefined),
  };
  const dialog = { confirm: vi.fn(async (_r?: unknown) => true), prompt: vi.fn(async () => null), actions: vi.fn(async () => ({ action: null, checked: false })) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const saver = { store: vi.fn(async (): Promise<any> => ({ kind: 'saved', file: dto({ version: 3 }) })) };
  const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: OfficeService, useValue: office },
      { provide: SheetEditorService, useValue: sheetsSvc },
      { provide: NeuronSaver, useValue: saver },
      { provide: DialogService, useValue: dialog },
      { provide: ToastService, useValue: toast },
      { provide: ApiService, useValue: { get: () => of([{ id: 't1', name: 'Glucose' }, { id: 't2', name: 'Urea' }]) } },
      { provide: AuthService, useValue: { user: signal({ displayName: 'Kavya Desk', branches: [{ id: 'b1', name: 'Main' }] }), activeBranchId: () => 'b1',
          hasAnyPermission: (c: string[]) => perms.includes('*all') || c.some(x => perms.includes(x)) } },
      { provide: ThemeService, useValue: { mode: signal('light'), isDark: () => false } },
      { provide: DeviceClassService, useValue: { deviceClass: signal(opts.phone ? 'phone' : 'desktop') } },
    ],
  });
  TestBed.overrideComponent(SheetEditorPage, {
    remove: { imports: [HeroBandComponent, AgGridAngular] },
    add: { imports: [HeroStub, GridStub], schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(SheetEditorPage);
  fixture.detectChanges();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page = fixture.componentInstance as any;
  const bridge = fixture.debugElement.injector.get(NeuronBridge);
  const el = fixture.nativeElement as HTMLElement;
  const settle = async () => { await fixture.whenStable(); fixture.detectChanges(); };
  /** Deliver a window message the way the iframe would. */
  const fromFrame = (data: Record<string, unknown>) => {
    const iframe = el.querySelector('iframe') as HTMLIFrameElement;
    bridge.handle({ origin: window.location.origin, source: iframe.contentWindow as MessageEventSource, data } as MessageEvent);
    fixture.detectChanges();
  };
  return { fixture, page, bridge, el, office, dialog, saver, toast, settle, fromFrame, sheetsSvc };
}

describe('Neuron page', () => {
  it('shows the empty state when there are no files', async () => {
    const { el, settle } = make();
    await settle();
    expect(el.querySelector('[data-testid="neuron-empty"]')?.textContent).toContain('No spreadsheets yet');
  });

  it('a files error says so in plain words and offers Try again', async () => {
    const { el, settle, office, fixture } = make();
    office.list.mockRejectedValueOnce(new Error('Request failed'));
    await fixture.componentInstance.loadFiles();
    await settle();
    expect(el.querySelector('[data-testid="neuron-files-error"]')).toBeTruthy();
    expect(el.textContent).toContain('Try again');
  });

  it('Insert results: asks the server, opens a NEW UNSAVED sheet named from the response', async () => {
    const { page, el, office, settle } = make();
    page.pickedTests.set(['t1']);
    await page.insertResults();
    await settle();
    expect(office.resultsWorkbook).toHaveBeenCalledWith(expect.objectContaining({ testIds: ['t1'] }));
    expect(page.session().file).toEqual({ id: null, name: 'Glucose.xlsx', version: null });
    expect(page.saveState()).toBe('Unsaved changes');
    expect(el.querySelector('iframe')).toBeTruthy();
    expect(page.notice().text).toContain('12 rows inserted');
    expect(page.notice().text).toContain('Press Save');
  });

  it('Insert results: the server cut the rows at 5,000 → the notice says so', async () => {
    const { page, office, settle } = make();
    office.resultsWorkbook.mockResolvedValueOnce({ bytes: PK.slice(0), truncated: true, fileName: null, rowCount: 5000 });
    page.pickedTests.set(['t1']);
    await page.insertResults();
    await settle();
    expect(page.notice()).toEqual({ tone: 'warn', text: TRUNCATED_NOTICE });
  });

  it('Insert results: a response that is not an xlsx opens NOTHING and says why', async () => {
    const { page, el, office, settle } = make();
    office.resultsWorkbook.mockResolvedValueOnce({ bytes: CSV.slice(0), truncated: false, fileName: 'x.xlsx', rowCount: null });
    page.pickedTests.set(['t1']);
    await page.insertResults();
    await settle();
    expect(page.session()).toBeNull();
    expect(page.insertProblem()).toBe(BROKEN_RESULTS_MESSAGE);
    expect(el.querySelector('iframe')).toBeNull();
  });

  it('Insert results: a failed request shows the plain server message and opens nothing', async () => {
    const { page, office } = make();
    office.resultsWorkbook.mockRejectedValueOnce(Object.assign(new Error('Something went wrong on our side. Try again in a moment.')));
    page.pickedTests.set(['t1']);
    await page.insertResults();
    expect(page.session()).toBeNull();
    expect(page.insertProblem()).toBe('Something went wrong on our side. Try again in a moment.');
  });

  it('Insert results: nothing picked → plain message, no request', async () => {
    const { page, office } = make();
    await page.insertResults();
    expect(office.resultsWorkbook).not.toHaveBeenCalled();
    expect(page.insertProblem()).toBe('Pick at least one test.');
  });

  it('shows a loading state until ready, then the sheet', async () => {
    const { page, el, settle, fromFrame } = make();
    await page.newSheet();
    await settle();
    expect(el.querySelector('[data-testid="neuron-loading"]')).toBeTruthy();
    fromFrame({ type: 'neuron:ready' });
    expect(el.querySelector('[data-testid="neuron-loading"]')).toBeNull();
  });

  it('neuron:failed shows the plain graphics-acceleration message', async () => {
    const { page, el, settle, fromFrame } = make();
    await page.newSheet();
    await settle();
    fromFrame({ type: 'neuron:failed', error: 'no webgl' });
    const box = el.querySelector('[data-testid="neuron-failed"]');
    expect(box?.textContent).toContain(NEURON_FAILED_MESSAGE);
  });

  it('save state: Saved / Unsaved changes / Saving…', async () => {
    const { page, settle, fromFrame, saver } = make();
    await page.openStored(dto());
    await settle();
    fromFrame({ type: 'neuron:ready' });
    expect(page.saveState()).toBe('Saved');
    fromFrame({ type: 'neuron:dirty', dirty: true });
    expect(page.saveState()).toBe('Unsaved changes');
    let release!: () => void;
    saver.store.mockImplementationOnce(() => new Promise(r => { release = () => r({ kind: 'saved', file: dto({ version: 3 }) }); }));
    fromFrame({ type: 'neuron:save', name: 'Budget.xlsx', bytes: PK.slice(0) });
    await Promise.resolve();
    expect(page.saveState()).toBe('Saving…');
    release();
    await settle();
    fromFrame({ type: 'neuron:dirty', dirty: false });
    expect(page.saveState()).toBe('Saved');
  });

  it('a failed save keeps the sheet unsaved and says so (500)', async () => {
    const { page, settle, fromFrame, saver } = make();
    await page.openStored(dto());
    await settle();
    fromFrame({ type: 'neuron:ready' });
    saver.store.mockResolvedValueOnce({ kind: 'failed', message: 'Something went wrong on our side. Try again in a moment.' });
    fromFrame({ type: 'neuron:save', name: 'Budget.xlsx', bytes: PK.slice(0) });
    await settle(); await settle();
    expect(page.saveState()).toBe('Unsaved changes');
    expect(page.notice().text).toContain("couldn't save");
  });

  it('a PDF save only downloads: nothing is stored', async () => {
    const { page, settle, fromFrame, saver, toast } = make();
    const click = vi.fn();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pdf');
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const e = realCreate(tag);
      if (tag === 'a') (e as HTMLAnchorElement).click = click;
      return e;
    });
    await page.newSheet();
    await settle();
    fromFrame({ type: 'neuron:ready' });
    fromFrame({ type: 'neuron:save', name: 'Untitled.pdf', bytes: new Uint8Array(Array.from(new TextEncoder().encode('%PDF-1.7'))).buffer });
    await settle();
    expect(click).toHaveBeenCalledTimes(1);
    expect(saver.store).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('PDF downloaded');
    vi.restoreAllMocks();
  });

  it('leaving with unsaved changes asks through DialogService; clean leaves freely', async () => {
    const { page, dialog, settle, fromFrame } = make();
    expect(await page.canLeave()).toBe(true);
    await page.openStored(dto());
    await settle();
    fromFrame({ type: 'neuron:ready' });
    expect(await page.canLeave()).toBe(true);
    expect(dialog.confirm).not.toHaveBeenCalled();
    fromFrame({ type: 'neuron:dirty', dirty: true });
    dialog.confirm.mockResolvedValueOnce(false);
    expect(await page.canLeave()).toBe(false);
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Leave without saving?', tone: 'danger' }));
    dialog.confirm.mockResolvedValueOnce(true);
    expect(await page.canLeave()).toBe(true);
  });

  it('beforeunload is blocked only while dirty', async () => {
    const { page, settle, fromFrame } = make();
    await page.openStored(dto());
    await settle();
    fromFrame({ type: 'neuron:ready' });
    const clean = { preventDefault: vi.fn(), returnValue: undefined as unknown } as unknown as BeforeUnloadEvent;
    page.onBeforeUnload(clean);
    expect(clean.preventDefault).not.toHaveBeenCalled();
    fromFrame({ type: 'neuron:dirty', dirty: true });
    const dirty = { preventDefault: vi.fn(), returnValue: undefined as unknown } as unknown as BeforeUnloadEvent;
    page.onBeforeUnload(dirty);
    expect(dirty.preventDefault).toHaveBeenCalled();
  });

  it('Ctrl+S and Cmd+S call the app\'s save, not the browser\'s', async () => {
    const { page, bridge, settle, fromFrame } = make();
    await page.newSheet();
    await settle();
    fromFrame({ type: 'neuron:ready' });
    const save = vi.spyOn(bridge, 'save').mockReturnValue(true);
    for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
      const ev = Object.assign(new KeyboardEvent('keydown', { key: 's', ...mod }), {});
      const prevent = vi.spyOn(ev, 'preventDefault');
      page.onKey(ev);
      expect(prevent).toHaveBeenCalled();
    }
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('a phone gets the list and a view-only note: no New sheet, no Insert results, no Save', async () => {
    const { page, el, settle } = make({ phone: true });
    await settle();
    expect(el.querySelector('[data-testid="neuron-new"]')).toBeNull();
    expect(el.querySelector('[data-testid="neuron-insert"]')).toBeNull();
    await page.openStored(dto());
    await settle();
    expect(el.querySelector('[data-testid="neuron-viewonly"]')?.textContent).toContain('View and copy only');
    expect(el.querySelector('[data-testid="neuron-save"]')).toBeNull();
  });

  it('a stored file that is not an xlsx is refused at open', async () => {
    const { page, office, toast } = make();
    office.content.mockResolvedValueOnce({ bytes: CSV.slice(0), version: '1' });
    await page.openStored(dto());
    expect(page.session()).toBeNull();
    expect(toast.error).toHaveBeenCalled();
  });
});

describe('Neuron roles', () => {
  it('a role that may only read results: Insert + Export, but no New sheet, Save or rename; leaving never nags', async () => {
    const { page, el, settle, fromFrame, dialog } = make({ perms: ['view_report'] });
    await settle();
    expect(el.querySelector('[data-testid="neuron-new"]')).toBeNull();
    expect(el.querySelector('[data-testid="neuron-insert"]')).toBeTruthy();
    page.pickedTests.set(['t1']);
    await page.insertResults();
    await settle();
    fromFrame({ type: 'neuron:ready' });
    fromFrame({ type: 'neuron:dirty', dirty: true });
    expect(el.querySelector('[data-testid="neuron-save"]')).toBeNull();
    expect(el.querySelector('[data-testid="neuron-readonly"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="neuron-savestate"]')).toBeNull();
    expect(await page.canLeave()).toBe(true);
    expect(dialog.confirm).not.toHaveBeenCalled();
  });

  it('a read-only xlsx export downloads and stores nothing', async () => {
    const { page, settle, fromFrame, saver } = make({ perms: ['view_report'] });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    page.pickedTests.set(['t1']);
    await page.insertResults();
    await settle();
    fromFrame({ type: 'neuron:ready' });
    page.exportAfterSave = true;
    fromFrame({ type: 'neuron:save', name: 'Glucose.xlsx', bytes: PK.slice(0) });
    await settle();
    expect(saver.store).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('shows the patient-names note unless the role may export patient data', async () => {
    const hidden = make({ perms: ['enter_result'] });
    hidden.page.insertOpen.set(true);
    hidden.fixture.detectChanges();
    expect(hidden.el.querySelector('[data-testid="neuron-patient-note"]')?.textContent).toContain('Patient names are hidden for your role.');
  });
});

describe('Sheet editor beta gate: the route stays hidden until the beta is on', () => {
  it('betaGuard("neuron") sends a direct visit to "/" when the beta is off', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: BetaFeaturesService, useValue: { ensureLoaded: async () => undefined, enabled: () => false } }],
    });
    const out = await TestBed.runInInjectionContext(() => betaGuard('neuron')({} as never, {} as never));
    expect(out).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(out as UrlTree)).toBe('/');
  });

  it('betaGuard("neuron") lets it through when the beta is on', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: BetaFeaturesService, useValue: { ensureLoaded: async () => undefined, enabled: (k: string) => k === 'neuron' } }],
    });
    expect(await TestBed.runInInjectionContext(() => betaGuard('neuron')({} as never, {} as never))).toBe(true);
  });
});

describe('Sheet editor: opened from a screen', () => {
  it('Insert results ready for the screen\'s tests and dates; with auto it fetches at once and opens a new unsaved sheet', async () => {
    const { page, office, settle, sheetsSvc } = make({ fromScreen: true, request: { source: 'Insights', insert: { testIds: ['t1'], from: '2026-11-01', to: '2026-11-07', branchId: 'b1', auto: true } } });
    await settle(); await settle();
    expect(sheetsSvc.take).toHaveBeenCalledTimes(1);
    expect(office.resultsWorkbook).toHaveBeenCalledWith({ testIds: ['t1'], from: '2026-11-01', to: '2026-11-07', branchId: null });
    expect(page.session().file.name).toBe('Glucose.xlsx');
    expect(page.saveState()).toBe('Unsaved changes');
  });

  it('without a test it only opens the picker, pre-filled', async () => {
    const { page, el, office, settle } = make({ fromScreen: true, request: { source: 'Reports', insert: { from: '2026-11-01', to: '2026-11-07' } } });
    await settle(); await settle();
    expect(office.resultsWorkbook).not.toHaveBeenCalled();
    expect(page.from()).toBe('2026-11-01');
    expect(el.querySelector('[data-testid="neuron-insert-card"]')).toBeTruthy();
  });

  it('bytes a screen built open as a new unsaved sheet; readonly hides Save', async () => {
    const { page, el, settle } = make({ fromScreen: true, request: { source: 'Insights', name: 'Top tests.xlsx', bytes: PK.slice(0), readonly: true } });
    await settle(); await settle();
    expect(page.session().file).toEqual({ id: null, name: 'Top tests.xlsx', version: null });
    expect(el.querySelector('[data-testid="neuron-save"]')).toBeNull();
    expect(el.querySelector('iframe')!.getAttribute('src')).toContain('readonly=1');
  });

  it('bytes that are not an xlsx are refused', async () => {
    const { page, toast, settle } = make({ fromScreen: true, request: { source: 'Insights', bytes: CSV.slice(0) } });
    await settle(); await settle();
    expect(page.session()).toBeNull();
    expect(toast.error).toHaveBeenCalled();
  });

  it('a stored sheet opens by id', async () => {
    const { page, office, settle } = make({ list: [dto()], fromScreen: true, request: { source: 'Sheets', fileId: 'f1' } });
    await settle(); await settle();
    expect(office.content).toHaveBeenCalledWith('f1');
    expect(page.session().file.id).toBe('f1');
  });

  it('the back chevron returns to the screen that opened it; unsaved changes ask first and Stay keeps the sheet', async () => {
    const { page, settle, fromFrame, sheetsSvc, dialog } = make({ fromScreen: true, request: { source: 'Insights', name: 'A.xlsx', bytes: PK.slice(0) } });
    await settle(); await settle();
    fromFrame({ type: 'neuron:ready' });
    fromFrame({ type: 'neuron:dirty', dirty: true });
    dialog.confirm.mockResolvedValueOnce(false);
    await page.close();
    expect(sheetsSvc.back).not.toHaveBeenCalled();
    expect(page.session()).not.toBeNull();
    dialog.confirm.mockResolvedValueOnce(true);
    await page.close();
    expect(sheetsSvc.back).toHaveBeenCalledTimes(1);
  });

  it('renaming or a theme change never reloads the engine (the iframe src binding keeps the same value)', async () => {
    const { page, el, settle, fromFrame } = make({ fromScreen: true, request: { source: 'Insights', name: 'A.xlsx', bytes: PK.slice(0) } });
    await settle(); await settle();
    fromFrame({ type: 'neuron:ready' });
    const first = page.frameSrc();
    page.renaming.set(true);
    await page.commitRename('B');
    await settle();
    expect(page.frameSrc()).toBe(first);
    expect(el.querySelectorAll('iframe')).toHaveLength(1);
  });

  it('a redirect that re-runs the leave guard asks only once', async () => {
    const { page, settle, fromFrame, dialog } = make({ fromScreen: true, request: { source: 'Insights', name: 'A.xlsx', bytes: PK.slice(0) } });
    await settle(); await settle();
    fromFrame({ type: 'neuron:ready' });
    fromFrame({ type: 'neuron:dirty', dirty: true });
    dialog.confirm.mockResolvedValueOnce(true);
    expect(await page.canLeave()).toBe(true);
    expect(await page.canLeave()).toBe(true);
    expect(dialog.confirm).toHaveBeenCalledTimes(1);
  });

  it('from the Sheets list, back goes to the list (not off the page)', async () => {
    const { page, sheetsSvc, settle } = make({ list: [dto()] });
    await settle();
    await page.openStored(dto());
    await settle();
    await page.close();
    expect(sheetsSvc.back).not.toHaveBeenCalled();
    expect(page.session()).toBeNull();
  });

  it('the band carries the file name, the save state and Save; no menu, no app title', async () => {
    const { el, settle } = make({ fromScreen: true, request: { source: 'Insights', name: 'Top tests.xlsx', bytes: PK.slice(0) } });
    await settle(); await settle();
    expect(el.textContent).not.toMatch(/neuron/i);
    expect(el.querySelector('[data-testid="neuron-name"]')?.textContent).toContain('Top tests.xlsx');
    expect(el.querySelector('[data-testid="neuron-savestate"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="neuron-save"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="neuron-insert"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="neuron-more"]')).toBeNull();
    expect(el.querySelector('.nr-stage')).toBeTruthy();
    expect(el.querySelector('.pf-card.nr-main')).toBeNull(); // the sheet is not wrapped in a card
  });
});
