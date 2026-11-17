import { Component, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { ApiService } from '../../core/services/api.service';
import { DialogService } from '../../core/services/dialog.service';
import { ToastService } from '../../core/services/toast.service';
import { FilesAccessService } from '../../features/files/files-access.service';
import { OfficeService } from '../../features/files/office.service';
import { filesAppNav, FILES_NAV } from '../../features/files/files-nav';
import { FILES_APPS } from '../../features/files/files-registry';
import { SheetEditorService } from '../../features/neuron/sheet-editor.service';
import { NavItem } from '../nav-items';
import { NAV_PREFS_STORAGE, NavPrefsService } from './nav-prefs.service';
import { computeNavLayout } from './nav-pins';
import { StartMenuComponent } from './start-menu.component';

const item = (id: string, label: string, href = `/${id}`): NavItem => ({ id, label, href, iconPath: ['M0 0'] });
const ALL = [item('frontdesk', 'Frontdesk'), item('lab', 'Lab'), item('admin', 'Settings')];
const MORE = [item('lab-settings', 'Lab settings', '/lab/settings'), item('critical-results', 'Critical results', '/lab/critical-results')];
const FILES_ITEMS = [FILES_NAV, ...FILES_APPS.map(filesAppNav)];

class FakeStorage { data = new Map<string, string>(); getItem(k: string) { return this.data.get(k) ?? null; } setItem(k: string, v: string) { this.data.set(k, v); } }

@Component({ standalone: true, imports: [StartMenuComponent], template: `<pf-start-menu [layout]="layout()" [open]="true" homeHref="/frontdesk" [autofocusSearch]="false" />` })
class Host {
  prefs = TestBed.inject(NavPrefsService);
  files = signal<NavItem[]>(FILES_ITEMS);
  layout = computed(() => computeNavLayout({ all: ALL, more: [...MORE, ...this.files()], roleDefaults: this.prefs.roleDefaults(), userPins: this.prefs.pinned(), capacity: 10 }));
}

function setup(o: { canWrite?: boolean; roleMap?: unknown; files?: NavItem[]; stored?: unknown[] } = {}) {
  const store = new FakeStorage();
  const api = { get: vi.fn((p: string) => of(p.includes('nav-defaults') ? (o.roleMap ?? { roles: {} }) : [])), put: vi.fn(() => of({})) };
  const router = { url: '/lab', navigateByUrl: vi.fn(() => Promise.resolve(true)), navigate: vi.fn(() => Promise.resolve(true)) };
  const sheets = { open: vi.fn(async () => true) };
  const office = { list: vi.fn(async () => o.stored ?? []) };
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { user: signal({ id: 'u1', tenantId: 't1', roles: ['Technician'], displayName: 'Lakshmi Rao', tenantName: 'Micro World' }), hasPermission: () => false } },
      { provide: ApiService, useValue: api },
      { provide: Router, useValue: router },
      { provide: DialogService, useValue: { confirm: vi.fn(async () => true) } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
      { provide: NAV_PREFS_STORAGE, useValue: () => store as unknown as Storage },
      { provide: FilesAccessService, useValue: { available: () => true, canWrite: () => o.canWrite !== false, canRead: () => true, ensureLoaded: async () => undefined } },
      { provide: SheetEditorService, useValue: sheets },
      { provide: OfficeService, useValue: office },
    ],
  });
  const f = TestBed.createComponent(Host);
  if (o.files) f.componentInstance.files.set(o.files);
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, host: f.componentInstance, api, router, sheets, office, prefs: f.componentInstance.prefs };
}
const flush = async (f: { detectChanges(): void; whenStable(): Promise<unknown> }) => { f.detectChanges(); await f.whenStable(); await new Promise(r => setTimeout(r, 0)); f.detectChanges(); };
const row = (el: HTMLElement, id: string) => el.querySelector<HTMLElement>(`[data-sm-item="${id}"]`)!;
const labels = (el: HTMLElement) => Array.from(el.querySelectorAll('.sm-rows .sm-row__lbl')).map(e => e.textContent!.trim());
const rightClick = (e: HTMLElement) => e.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 80 }));
const menu = (el: HTMLElement) => el.querySelector<HTMLElement>('[data-sm-ctx]');
const acts = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLButtonElement>('[data-sm-ctx-item]')).map(b => ({ id: b.getAttribute('data-sm-ctx-act'), text: b.textContent!.replace(/\s+/g, ' ').trim(), disabled: b.disabled }));

describe('Start menu: Files in the plain "More screens" list (no new section)', () => {
  it('Files and the five apps are ordinary rows with a small logo and "Neuron · sheets" wording, in the same list as Lab settings', () => {
    const { el } = setup();
    const l = labels(el);
    expect(l).toEqual(expect.arrayContaining(['Lab settings', 'Critical results', 'Files', 'Neuron · sheets', 'Synapse · documents', 'Axon · slides', 'Myelin · PDFs', 'Retina · images']));
    expect(el.querySelector('[data-sm-files-title]')).toBeNull();                            // no extra section
    expect(Array.from(el.querySelectorAll('.sm-sec__t')).map(e => e.textContent!.trim())).toEqual(['On your bar', 'More screens']);
    expect(row(el, 'files-neuron').querySelector('[data-files-logo="neuron"]')).toBeTruthy();
    expect(row(el, 'files').querySelector('[data-files-logo]')).toBeNull();                 // Files itself: a plain stroked icon
  });

  it('the search box says what it finds, and "sheets" / "office" / "pdf" find the apps', async () => {
    const { el, f } = setup();
    expect(el.querySelector<HTMLInputElement>('.sm-search__input')!.placeholder).toBe('Search screens and files');
    const type = (v: string) => { const i = el.querySelector<HTMLInputElement>('.sm-search__input')!; i.value = v; i.dispatchEvent(new Event('input')); };
    type('sheets'); await flush(f);
    expect(labels(el)).toContain('Neuron · sheets');
    type('office'); await flush(f);
    expect(labels(el)).toEqual(expect.arrayContaining(['Files', 'Neuron · sheets', 'Synapse · documents', 'Axon · slides']));
    type('pdf'); await flush(f);
    expect(labels(el)).toContain('Myelin · PDFs');
    expect(labels(el)).not.toContain('Neuron · sheets');
  });

  it('typing finds stored files by name (the server already filtered them to what this person may open) and opens the right editor', async () => {
    const { el, f, office, router } = setup({ stored: [
      { id: 'a1', name: 'QC log, November.xlsx', kind: 'sheet' }, { id: 'b2', name: 'Sample rejection SOP.docx', kind: 'doc' }, { id: 'c3', name: 'Mehta letter.docx', kind: 'doc' },
    ] });
    const i = el.querySelector<HTMLInputElement>('.sm-search__input')!;
    i.value = 'sop'; i.dispatchEvent(new Event('input')); await flush(f);
    expect(office.list).toHaveBeenCalledTimes(1);
    const hits = Array.from(el.querySelectorAll<HTMLElement>('[data-sm-file]'));
    expect(hits.map(h => h.textContent!.trim())).toEqual(['Sample rejection SOP.docx']);
    expect(hits[0].querySelector('[data-files-logo="synapse"]')).toBeTruthy();
    hits[0].click();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/files/doc/b2');
    i.value = 'q'; i.dispatchEvent(new Event('input')); await flush(f);
    expect(el.querySelectorAll('[data-sm-file]').length).toBe(0);                          // one letter is not a search
  });

  it('with no Files items (beta off, app off, no role) there is no trace of Files in the menu', () => {
    const { el } = setup({ files: [] });
    expect(labels(el).join('|')).not.toMatch(/Files|Neuron|Synapse|Axon|Myelin|Retina/);
  });
});

describe('Start menu: right-click / long-press on a Files row', () => {
  it('right-click shows Open, New … and Pin to bar; the actions do what they say', async () => {
    const { el, f, router, sheets, prefs } = setup();
    rightClick(row(el, 'files-synapse')); await flush(f);
    expect(menu(el)).toBeTruthy();
    expect(acts(el).map(a => a.text)).toEqual(['Open Synapse', 'New document', 'Pin to bar']);
    el.querySelector<HTMLButtonElement>('[data-sm-ctx-act="pin"]')!.click(); await flush(f);
    expect(prefs.pinned()).toContain('files-synapse');
    expect(menu(el)).toBeNull();
    rightClick(row(el, 'files-synapse')); await flush(f);
    expect(acts(el).map(a => a.text)).toEqual(['Open Synapse', 'New document', 'Unpin from bar']);
    el.querySelector<HTMLButtonElement>('[data-sm-ctx-act="unpin"]')!.click(); await flush(f);
    expect(prefs.pinned()).not.toContain('files-synapse');
    rightClick(row(el, 'files-axon')); await flush(f);
    el.querySelector<HTMLButtonElement>('[data-sm-ctx-act="new"]')!.click(); await flush(f);
    expect(sheets.open).toHaveBeenCalledWith({ app: 'axon', source: 'Files' });
    rightClick(row(el, 'files-neuron')); await flush(f);
    el.querySelector<HTMLButtonElement>('[data-sm-ctx-act="open"]')!.click();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/files/sheet/start');
  });

  it('Myelin and Retina offer "Open a PDF" / "Open an image" (they edit what exists); All files has no New', async () => {
    const { el, f } = setup();
    rightClick(row(el, 'files-myelin')); await flush(f);
    expect(acts(el).map(a => a.text)).toContain('Open a PDF');
    rightClick(row(el, 'files-retina')); await flush(f);
    expect(acts(el).map(a => a.text)).toContain('Open an image');
    rightClick(row(el, 'files')); await flush(f);
    expect(acts(el).map(a => a.text)).toEqual(['Open All files', 'Pin to bar']);
  });

  it('View only: no New in the menu, pin and open stay', async () => {
    const { el, f } = setup({ canWrite: false });
    rightClick(row(el, 'files-neuron')); await flush(f);
    expect(acts(el).map(a => a.text)).toEqual(['Open Neuron', 'Pin to bar']);
  });

  it('an app the admin locked on the bar cannot be unpinned: the item is disabled and says why', async () => {
    const { el, f, prefs } = setup({ roleMap: { roles: { Technician: { pinned: ['files-neuron'], locked: ['files-neuron'] } } } });
    await flush(f);
    expect(prefs.roleDefaults()?.locked).toContain('files-neuron');
    rightClick(el.querySelector<HTMLElement>('.sm-tile[data-sm-item="files-neuron"]')!); await flush(f);
    const u = acts(el).find(a => a.id === 'unpin')!;
    expect(u.disabled).toBe(true);
    expect(u.text).toContain('Kept by admin');
    u.id && el.querySelector<HTMLButtonElement>('[data-sm-ctx-act="unpin"]')!.click();
    expect(prefs.pinned() ?? []).not.toContain('x');                                       // nothing was unpinned
  });

  it('a pin to an app that is no longer allowed is dropped silently (pins never grant access)', async () => {
    const { el, f, host, prefs } = setup();
    prefs.setPinned(['files-synapse', 'lab']);
    await flush(f);
    expect(Array.from(el.querySelectorAll('.sm-tile .sm-tile__lbl')).map(e => e.textContent!.trim())).toContain('Synapse');
    host.files.set(FILES_ITEMS.filter(i => i.id !== 'files-synapse'));                    // the lab switched Synapse off
    await flush(f);
    const tiles = Array.from(el.querySelectorAll('.sm-tile .sm-tile__lbl')).map(e => e.textContent!.trim());
    expect(tiles).not.toContain('Synapse');
    expect(tiles).toContain('Lab');
  });

  it('Esc closes the context menu first, an outside tap too; a long press (touch) opens it and the tap that ends it does not open the screen', async () => {
    vi.useFakeTimers();
    try {
      const { el, f, router } = setup();
      rightClick(row(el, 'files-axon')); f.detectChanges();
      expect(menu(el)).toBeTruthy();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); f.detectChanges();
      expect(menu(el)).toBeNull();
      const r = row(el, 'files-axon');
      r.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
      vi.advanceTimersByTime(600); f.detectChanges();
      expect(menu(el)).toBeTruthy();
      r.click();                                                                            // the release of the long press
      expect(router.navigateByUrl).not.toHaveBeenCalled();
      // a mouse press never starts a long press
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); f.detectChanges();
      vi.advanceTimersByTime(700);
      r.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', bubbles: true }));
      vi.advanceTimersByTime(900); f.detectChanges();
      expect(menu(el)).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});
