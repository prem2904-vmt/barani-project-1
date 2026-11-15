import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { vi } from 'vitest';
import { AgGridAngular } from 'ag-grid-angular';
import { DialogService } from '../../core/services/dialog.service';
import { ThemeService } from '../../core/services/theme.service';
import { ToastService } from '../../core/services/toast.service';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { SheetEditorService } from '../neuron/sheet-editor.service';
import { FilesAccessService } from './files-access.service';
import { FilesDeviceService } from './files-device.service';
import { FILES_APPS } from './files-registry';
import { OfficeService } from './office.service';
import { FilesHomePage } from './files-home.page';

@Component({ selector: 'pf-hero-band', standalone: true, template: '<ng-content></ng-content><ng-content select="[band-center]"></ng-content><ng-content select="[band-search]"></ng-content><ng-content select="[band-actions]"></ng-content>' })
class HeroStub { }
@Component({ selector: 'ag-grid-angular', standalone: true, template: '' })
class GridStub { }

const f = (id: string, name: string, kind: string, over: Record<string, unknown> = {}) => ({ id, name, kind, sizeBytes: 2048, version: 1, updatedAt: '2026-11-15T05:00:00Z', updatedByName: 'Lakshmi Admin', ...over });
const FILES = [
  f('1', 'Results 9 to 15 Nov 2026 with a very long name that must wrap onto a second line instead of being cut off.xlsx', 'sheet', { containsPhi: true }),
  f('2', 'Sample rejection SOP.docx', 'doc'), f('3', 'Monthly quality review.pptx', 'slides'), f('4', 'Partner report.pdf', 'pdf'), f('5', 'Wound photo.png', 'image'),
];
interface Opts { full?: boolean; phone?: boolean; apps?: string[]; trash?: unknown[]; shared?: unknown[]; query?: string; writable?: string[]; fail?: boolean }

function make(o: Opts = {}) {
  const apps = FILES_APPS.filter(a => (o.apps ?? FILES_APPS.map(x => x.id)).includes(a.id));
  const writable = o.writable ?? apps.map(a => a.id);
  const full = o.full !== false;
  const office = {
    list: vi.fn(async (_k?: string, trash?: boolean, shared?: boolean) => { if (o.fail) throw new Error('boom'); return trash ? (o.trash ?? []) : shared ? (o.shared ?? []) : FILES; }),
    rename: vi.fn(async (id: string, name: string) => f(id, name, 'sheet')), remove: vi.fn(async () => undefined),
    restore: vi.fn(async (id: string) => f(id, 'Back.docx', 'doc')), content: vi.fn(async () => ({ bytes: new Uint8Array([0x50, 0x4b, 3, 4]).buffer, version: '1' })),
  };
  const dialog = { prompt: vi.fn(async () => 'New name.xlsx'), confirm: vi.fn(async (_r?: unknown) => true) };
  const toast = { success: vi.fn(), error: vi.fn() };
  const sheets = { open: vi.fn(async (_r?: unknown) => true) };
  const device = { open: vi.fn(async () => ({ target: { kind: 'device', name: 'a.pdf' }, name: 'a.pdf', bytes: new ArrayBuffer(8) })) };
  const router = { navigateByUrl: vi.fn(async () => true) };
  const access = {
    available: () => true, ensureLoaded: async () => undefined, apps: () => apps, full: () => full, viewOnly: () => !full, phone: () => !!o.phone, compact: () => !!o.phone,
    canWrite: (a: { id: string }) => full && !o.phone && writable.includes(a.id), access: () => ({ trashDays: 14 }),
    settings: () => ({ hiddenTemplates: ['neuron:stock'], ownTemplates: [{ id: 'o1', kind: 'doc', name: 'Our letter', fileId: 'f9' }] }),
  };
  const qp = new BehaviorSubject(convertToParamMap(o.query ? { type: o.query } : {}));
  TestBed.configureTestingModule({ providers: [
    { provide: OfficeService, useValue: office }, { provide: FilesAccessService, useValue: access }, { provide: DialogService, useValue: dialog }, { provide: ToastService, useValue: toast },
    { provide: ThemeService, useValue: { isDark: () => false } }, { provide: Router, useValue: router }, { provide: SheetEditorService, useValue: sheets },
    { provide: FilesDeviceService, useValue: device }, { provide: ActivatedRoute, useValue: { queryParamMap: qp } },
  ] });
  TestBed.overrideComponent(FilesHomePage, { remove: { imports: [HeroBandComponent, AgGridAngular] }, add: { imports: [HeroStub, GridStub], schemas: [NO_ERRORS_SCHEMA] } });
  const fixture = TestBed.createComponent(FilesHomePage);
  fixture.detectChanges();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page = fixture.componentInstance as any;
  const el = fixture.nativeElement as HTMLElement;
  const settle = async () => { for (let i = 0; i < 3; i++) { await fixture.whenStable(); await new Promise(r => setTimeout(r, 0)); fixture.detectChanges(); } };
  const t = (id: string) => el.querySelector(`[data-testid="${id}"]`);
  const actions = (file: unknown) => { const col = page.colDefs().find((c: { colId?: string }) => c.colId === 'actions'); return Array.from((col.cellRenderer({ data: file }) as HTMLElement).querySelectorAll('button')).map(b => (b as HTMLElement).dataset['act']); };
  const nameCell = (file: unknown) => (page.colDefs().find((c: { field?: string }) => c.field === 'name').cellRenderer({ data: file }) as HTMLElement);
  return { fixture, page, el, office, dialog, toast, sheets, device, router, settle, t, actions, nameCell, qp };
}

describe('Files home', () => {
  it('lists every file of every app the person may open, with one filter tab per app and counts', async () => {
    const { page, settle } = make();
    await settle();
    expect(page.tabs().map((x: { id: string; count: number | null }) => [x.id, x.count])).toEqual([['all', 5], ['sheet', 1], ['doc', 1], ['slides', 1], ['pdf', 1], ['image', 1], ['trash', null]]);
    expect(page.tabs().map((x: { label: string }) => x.label)).toEqual(['All', 'Sheets', 'Documents', 'Slides', 'PDFs', 'Images', 'Trash']);
    expect(page.rows()).toHaveLength(5);
    page.setTab('doc');
    expect(page.rows().map((r: { name: string }) => r.name)).toEqual(['Sample rejection SOP.docx']);
  });

  it('an app switched off for the lab (or not allowed to the role) has no tab and none of its files show', async () => {
    const { page, settle } = make({ apps: ['neuron', 'synapse'] });
    await settle();
    expect(page.tabs().map((x: { id: string }) => x.id)).toEqual(['all', 'sheet', 'doc', 'trash']);
    expect(page.rows().map((r: { kind: string }) => r.kind).sort()).toEqual(['doc', 'sheet']);
  });

  it('search finds by name or by who saved it; empty results say so', async () => {
    const { page, settle, el } = make();
    await settle();
    page.q.set('sop');
    expect(page.rows()).toHaveLength(1);
    page.q.set('lakshmi');
    expect(page.rows()).toHaveLength(5);
    page.q.set('zzz');
    await settle();
    expect(page.emptyTitle()).toBe('No files match');
    expect(el.querySelector('[data-testid="files-empty"]')).toBeTruthy();
  });

  it('`/files?type=doc` (the Start menu\'s app rows) opens on that app\'s tab', async () => {
    const { page, settle, qp } = make({ query: 'doc' });
    await settle();
    expect(page.tab()).toBe('doc');
    qp.next(convertToParamMap({}));
    expect(page.tab()).toBe('all');
  });

  it('long names are NOT truncated: the name cell wraps; the shield marks a file with patient data', async () => {
    const { nameCell } = make();
    const c = nameCell(FILES[0]);
    expect(c.style.whiteSpace).toBe('normal');
    expect(c.style.overflowWrap).toBe('anywhere');
    expect(c.textContent).toContain('instead of being cut off');
    expect(c.querySelector('[data-phi="true"]')?.getAttribute('title')).toContain('patient data');
    expect(nameCell(FILES[1]).querySelector('[data-phi]')).toBeNull();
  });

  it('a writer gets New sheet (primary) + New document + New slides, Open / Share / Rename / Delete, and templates', async () => {
    const { t, actions, page, settle } = make();
    await settle();
    expect(t('files-new-neuron')?.textContent?.trim()).toBe('New sheet');
    expect(t('files-new-synapse')?.textContent?.trim()).toBe('New document');
    expect(t('files-new-axon')?.textContent?.trim()).toBe('New slides');
    expect(t('files-new-myelin')).toBeNull();                          // PDFs / images are opened, not made blank
    expect(actions(FILES[1])).toEqual(['open', 'share', 'rename', 'delete']);
    expect(page.templates().map((x: { id: string }) => x.id)).toEqual(['neuron:results', 'neuron:qc', 'synapse:letter', 'synapse:sop', 'axon:case', 'axon:review', 'own:o1']);   // the stock one is hidden by the lab
    expect(t('files-templates')).toBeTruthy();
  });

  it('VIEW ONLY: a quiet chip, no New, no templates, no Rename / Delete; Open and Share stay', async () => {
    const { t, actions, page, settle } = make({ full: false });
    await settle();
    expect(t('files-viewonly-chip')?.textContent?.trim()).toBe('View only');
    expect(t('files-new-neuron')).toBeNull();
    expect(page.templates()).toEqual([]);
    expect(t('files-templates')).toBeNull();
    expect(actions(FILES[1])).toEqual(['open', 'share']);
  });

  it('a phone lists and opens only: no New, no templates card, shorter actions', async () => {
    const { t, actions, settle } = make({ phone: true });
    await settle();
    expect(t('files-new-neuron')).toBeNull();
    expect(t('files-templates')).toBeNull();
    expect(actions(FILES[1])).toEqual(['open', 'share']);
  });

  it('a role that may write only some apps sees New and Rename / Delete for those', async () => {
    const { t, actions, settle } = make({ writable: ['synapse'] });
    await settle();
    expect(t('files-new-synapse')?.textContent?.trim()).toBe('New document');       // the primary slot falls to the first app they can write
    expect(t('files-new-neuron')).toBeNull();
    expect(actions(FILES[1])).toEqual(['open', 'share', 'rename', 'delete']);
    expect(actions(FILES[0])).toEqual(['open', 'share']);
  });

  it('New opens the app\'s editor; Myelin / Retina open a file from the device first; a template carries the engine command; a lab template copies its file', async () => {
    const { page, sheets, device, office, settle } = make();
    await settle();
    await page.newFile(FILES_APPS[1]);
    expect(sheets.open).toHaveBeenLastCalledWith({ app: 'synapse', source: 'Files' });
    await page.newFile(FILES_APPS[3]);
    expect(device.open).toHaveBeenCalled();
    expect(sheets.open).toHaveBeenLastCalledWith(expect.objectContaining({ app: 'myelin', name: 'a.pdf', target: { kind: 'device', name: 'a.pdf' } }));
    await page.startTemplate(page.templates()[1]);
    expect(sheets.open).toHaveBeenLastCalledWith(expect.objectContaining({ app: 'neuron', template: { cmd: 'file.new', params: { sample: 'qc' } } }));
    await page.startTemplate(page.templates().find((x: { id: string }) => x.id === 'own:o1'));
    expect(office.content).toHaveBeenCalledWith('f9');
    expect(sheets.open).toHaveBeenLastCalledWith(expect.objectContaining({ app: 'synapse', name: 'Our letter.docx', copyOf: 'f9' }));
  });

  it('Rename and Delete go through the app\'s dialogs; Delete moves to Trash and says how long it is kept', async () => {
    const { page, dialog, office, toast, settle } = make();
    await settle();
    await page.rename(FILES[1]);
    expect(office.rename).toHaveBeenCalledWith('2', 'New name.xlsx');
    dialog.confirm.mockResolvedValueOnce(false);
    await page.remove(FILES[1]);
    expect(office.remove).not.toHaveBeenCalled();
    await page.remove(FILES[1]);
    expect((dialog.confirm.mock.calls.at(-1)![0] as { message: string }).message).toContain('after 14 days');
    expect(office.remove).toHaveBeenCalledWith('2');
    expect(page.rows().map((r: { id: string }) => r.id)).not.toContain('2');
    expect(toast.success).toHaveBeenCalledWith('Moved to Trash');
  });

  it('Trash lists the deleted files with the lab\'s days, offers Restore only, and Restore puts the file back', async () => {
    const trashed = [f('9', 'Old letter.docx', 'doc', { deletedAt: '2026-11-10T05:00:00Z' })];
    const { page, actions, settle, office, el } = make({ trash: trashed });
    await settle();
    page.setTab('trash');
    await settle();
    expect(office.list).toHaveBeenCalledWith(undefined, true);
    expect(page.rows().map((r: { id: string }) => r.id)).toEqual(['9']);
    expect(el.querySelector('[data-testid="files-trash-note"]')?.textContent).toContain('kept 14 days');
    expect(actions(trashed[0])).toEqual(['restore']);
    await page.restore(trashed[0]);
    expect(office.restore).toHaveBeenCalledWith('9');
    expect(page.rows()).toHaveLength(0);
    expect(page.files().map((r: { id: string }) => r.id)).toContain('9');
  });

  it('a "Shared with me" tab appears only when something is shared, and lists it', async () => {
    const none = make();
    await none.settle();
    expect(none.page.tabs().some((x: { id: string }) => x.id === 'shared')).toBe(false);
    TestBed.resetTestingModule();
    const { page, settle } = make({ shared: [f('7', 'Shared QC.xlsx', 'sheet', { sharedAccess: 'view' })] });
    await settle();
    expect(page.tabs().find((x: { id: string }) => x.id === 'shared')).toEqual({ id: 'shared', label: 'Shared with me', count: 1 });
    page.setTab('shared');
    expect(page.rows().map((r: { id: string }) => r.id)).toEqual(['7']);
  });

  it('a failing list says so in plain words and Try again reloads', async () => {
    const { page, settle, el, office } = make({ fail: true });
    await settle();
    expect(el.querySelector('[data-testid="files-error"]')).toBeTruthy();
    office.list.mockImplementation(async () => FILES);
    await page.load();
    await settle();
    expect(el.querySelector('[data-testid="files-error"]')).toBeNull();
    expect(page.rows()).toHaveLength(5);
  });

  it('opening a row goes to its app\'s editor route', async () => {
    const { page, router, settle } = make();
    await settle();
    await page.open(FILES[3]);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/files/pdf/4');
    await page.open(FILES[4]);
    expect(router.navigateByUrl).toHaveBeenLastCalledWith('/files/image/5');
  });
});
