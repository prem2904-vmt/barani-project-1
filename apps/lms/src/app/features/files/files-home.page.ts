import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ViewStateService } from '../../shared/services/view-state.service';
import { GridViewStateDirective } from '../../shared/services/grid-view-state';
import { ActivatedRoute, Router } from '@angular/router';
import { AgGridAngular } from 'ag-grid-angular';
import { AllCommunityModule, ColDef, GridApi, GridReadyEvent, ICellRendererParams, ModuleRegistry } from 'ag-grid-community';
import { DialogService } from '../../core/services/dialog.service';
import { ThemeService } from '../../core/services/theme.service';
import { ToastService } from '../../core/services/toast.service';
import { SkeletonRowsComponent } from '@prefrontal/shared';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { FilesLogoComponent } from '../../shared/components/files-logo/files-logo.component';
import { FilesShareDialogComponent } from './files-share.dialog';
import { gridThemeDark, gridThemeLight } from '../admin/tests/tests/grid-theme';
import { SheetEditorService } from '../neuron/sheet-editor.service';
import { startTemplates } from './files-start';
import { FilesAccessService } from './files-access.service';
import { FilesDeviceService } from './files-device.service';
import { FILES_APPS, FILES_NAME, FilesApp, filesAppForKind, withAppExtension } from './files-registry';
import { OfficeFile, OfficeOwnTemplate, OfficeService, toApiError } from './office.service';
import { logoSvg, phiPillHtml } from './files-logo-svg';

ModuleRegistry.registerModules([AllCommunityModule]);

/** The file list sits in a card: in dark its grid takes the card's own surface (a lighter grid inside the card read as a second panel). */
export const FH_GRID_DARK = gridThemeDark.withParams({ backgroundColor: 'transparent', headerBackgroundColor: 'rgba(255, 255, 255, 0.05)', oddRowBackgroundColor: 'transparent' });

type Tab = 'all' | 'trash' | string;

/**
 * Files home (`/files`): every file of the apps this person may open, in one list, with a filter tab per app, Trash, search, New …, templates,
 * Open / Rename / Delete / Restore. A lab on the default VIEW ONLY level (and a phone) lists and opens files read-only: no New, no templates,
 * no Rename / Delete / Restore. Long names wrap (never truncated). A shield marks a file Prefrontal put patient data into.
 */
@Component({
  selector: 'pf-files-home',
  standalone: true,
  imports: [GridViewStateDirective, SkeletonRowsComponent, HeroBandComponent, AgGridAngular, FilesLogoComponent, FilesShareDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page fh" data-testid="files-home">
      <pf-hero-band [placeholder]="'Search ' + name.toLowerCase()" [value]="q()" (valueChange)="q.set($event)">
        <ng-container band-tools>
          <span class="pf-seg fh-tabs" role="tablist" aria-label="Type of file">
            @for (t of tabs(); track t.id) {
              <button type="button" role="tab" class="pf-seg__item" [attr.aria-selected]="tab() === t.id" [attr.aria-checked]="tab() === t.id"
                      [attr.data-testid]="'files-tab-' + t.id" (click)="setTab(t.id)">{{ t.label }}@if (t.count !== null) { <span class="fh-count"> {{ t.count }}</span> }</button>
            }
          </span>
        </ng-container>
        <ng-container band-actions>
          @if (viewOnly()) {
            <span class="fh-chip" data-testid="files-viewonly-chip" title="Your organization can open and copy files here, not change them">View only</span>
          }
          @if (!phone()) {
            <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" data-testid="files-open-device" aria-label="Open from this device" title="Open from this device" (click)="openFromDevice()">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>
              <span class="fh-bt">Open from this device</span>
            </button>
          }
          @for (a of secondaryNew(); track a.id) {
            <button type="button" class="pf-hb-btn pf-hb-btn--ghost press fh-new-sec" [attr.data-testid]="'files-new-' + a.id" (click)="newFile(a)">{{ a.newLabel }}</button>
          }
          @if (primaryNew(); as a) {
            <button type="button" class="pf-hb-btn pf-hb-btn--primary press" [attr.data-testid]="'files-new-' + a.id" (click)="newFile(a)">{{ a.newLabel }}</button>
          }
        </ng-container>
      </pf-hero-band>

      <div class="pf-body" [class.pf-body--split]="showTemplates()">
        <section class="pf-card fh-main" [attr.aria-label]="tab() === 'trash' ? 'Trash' : 'Files'">
          <header class="pf-card__head">
            <span class="pf-card__label">{{ tab() === 'trash' ? 'Trash' : 'Recent files' }}</span>
          </header>
          @if (tab() === 'trash') {
            <p class="fh-note" data-testid="files-trash-note">Deleted files are kept {{ trashDays() }} days, then removed for good.</p>
          }
          <div class="pf-card__body fh-files" data-testid="files-list">
            @if (loading()) {
              <div class="fh-over" role="status"><pf-skeleton-rows [rows]="6" [avatar]="false" label="Loading your files…"></pf-skeleton-rows></div>
            } @else if (error()) {
              <div class="pf-empty" role="alert" data-testid="files-error">
                <p class="pf-empty__title">We couldn't load your files</p>
                <p class="pf-empty__body">{{ error() }}</p>
                <button type="button" class="pf-btn pf-btn--secondary pf-empty__action" (click)="load()">Try again</button>
              </div>
            } @else if (!rows().length) {
              <div class="pf-empty" data-testid="files-empty">
                <p class="pf-empty__title">{{ emptyTitle() }}</p>
                <p class="pf-empty__body">{{ emptyBody() }}</p>
                @if (primaryNew(); as a) {
                  <button type="button" class="pf-btn pf-btn--secondary pf-empty__action" (click)="newFile(a)">{{ a.newLabel }}</button>
                }
              </div>
            } @else {
              <ag-grid-angular pfGridViewState="files" class="fh-grid" [theme]="gridTheme()" [rowData]="rows()" [columnDefs]="colDefs()" [defaultColDef]="defaultColDef"
                               [domLayout]="'normal'" [suppressCellFocus]="true" [getRowId]="rowId" (gridReady)="onGridReady($event)"
                               (rowClicked)="onRowClicked($event.data)"></ag-grid-angular>
            }
          </div>
        </section>
        @if (showTemplates()) {
          <aside class="pf-card fh-side" aria-label="Start from a template" data-testid="files-templates">
            <header class="pf-card__head"><span class="pf-card__label">Start from a template</span></header>
            <div class="pf-card__body fh-tpls">
              @for (t of templates(); track t.id) {
                <button type="button" class="fh-tpl press" [attr.data-testid]="'files-template-' + t.id" (click)="startTemplate(t)">
                  <pf-files-logo [app]="t.app.id" [size]="20" />
                  <span class="fh-tpl__t">{{ t.name }}</span>
                </button>
              }
            </div>
          </aside>
        }
      </div>
    </section>
    <pf-files-share [file]="shareFile()" (closed)="shareFile.set(null)" />
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .fh-main { min-height: 0; flex: 1 1 auto; display: flex; flex-direction: column; }
    .fh-files { padding: 0; display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; }
    .fh-grid { width: 100%; flex: 1 1 auto; min-height: 320px; }
    .fh-over { min-height: 200px; display: flex; align-items: center; justify-content: center; }
    .fh-note { margin: 0; padding: 8px 16px; font-size: 13px; color: var(--text-secondary); background: color-mix(in srgb, var(--violet-500, #7c3aed) 7%, transparent); }
    .fh-count { opacity: .65; font-weight: 500; }
    .fh-chip { display: inline-flex; align-items: center; height: 26px; padding: 0 10px; border-radius: 999px; font-size: 12px; font-weight: 600; color: var(--text-tertiary); background: color-mix(in srgb, var(--text-primary) 6%, transparent); }
    .fh-tpls { display: flex; flex-direction: column; gap: 6px; }
    .fh-tpl { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; border-radius: 10px; border: 1px solid var(--card-border, rgba(0,0,0,.08)); background: transparent; color: var(--text-primary); font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
    .fh-tpl:hover { background: color-mix(in srgb, var(--violet-500, #7c3aed) 7%, transparent); }
    .fh-tpl:focus-visible { outline: 2px solid var(--violet-500, #7c3aed); outline-offset: 1px; }
    .fh-tpl__t { overflow-wrap: anywhere; }
    @media (max-width: 1100px) { .fh-bt { display: none; } }
    @media (max-width: 640px) { .fh-new-sec { display: none; } .fh-tabs { overflow-x: auto; max-width: 100%; } }
  `],
})
export class FilesHomePage {
  private readonly office = inject(OfficeService);
  private readonly access = inject(FilesAccessService);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly theme = inject(ThemeService);
  private readonly router = inject(Router);
  private readonly sheets = inject(SheetEditorService);
  private readonly deviceFiles = inject(FilesDeviceService);
  private readonly route = inject(ActivatedRoute);
  protected readonly shareFile = signal<OfficeFile | null>(null);
  protected readonly sharedWithMe = signal<OfficeFile[]>([]);

  protected readonly name = FILES_NAME;
  protected readonly q = signal('');
  protected readonly tab = signal<Tab>('all');
  protected readonly files = signal<OfficeFile[]>([]);
  protected readonly trash = signal<OfficeFile[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly viewOnly = this.access.viewOnly;
  protected readonly phone = this.access.phone;
  protected readonly trashDays = computed(() => this.access.access()?.trashDays ?? 30);
  /** Apps this person may open (Settings → Files switches, role, sign-in). */
  private readonly apps = this.access.apps;
  /** Apps this person may create in. */
  private readonly writable = computed(() => this.apps().filter(a => this.access.canWrite(a)));
  protected readonly primaryNew = computed<FilesApp | null>(() => this.writable().find(a => a.id === 'neuron') ?? this.writable()[0] ?? null);
  protected readonly secondaryNew = computed<FilesApp[]>(() => this.writable().filter(a => a.id !== this.primaryNew()?.id && a.kind !== 'pdf' && a.kind !== 'image'));
  protected readonly canDelete = computed(() => this.access.full());

  protected readonly tabs = computed(() => {
    const all = this.visibleFiles();
    const t: { id: Tab; label: string; count: number | null }[] = [{ id: 'all', label: 'All', count: all.length }];
    for (const a of this.apps()) t.push({ id: a.kind, label: a.tab, count: all.filter(f => f.kind === a.kind).length });
    if (this.sharedWithMe().length) t.push({ id: 'shared', label: 'Shared with me', count: this.sharedWithMe().length });
    if (this.access.full() || this.trash().length) t.push({ id: 'trash', label: 'Trash', count: null });
    return t;
  });
  private readonly visibleFiles = computed(() => { const ok = new Set<string>(this.apps().map(a => a.kind)); return this.files().filter(f => ok.has(f.kind)); });
  protected readonly rows = computed<OfficeFile[]>(() => {
    const base = this.tab() === 'trash' ? this.trash() : this.tab() === 'shared' ? this.sharedWithMe() : this.tab() === 'all' ? this.visibleFiles() : this.visibleFiles().filter(f => f.kind === this.tab());
    const q = this.q().trim().toLowerCase();
    return q ? base.filter(f => f.name.toLowerCase().includes(q) || (f.updatedByName ?? '').toLowerCase().includes(q)) : base;
  });
  protected readonly emptyTitle = computed(() => this.tab() === 'trash' ? 'Trash is empty' : this.q().trim() ? 'No files match' : 'No files yet');
  protected readonly emptyBody = computed(() => this.tab() === 'trash' ? `Deleted files wait here for ${this.trashDays()} days.`
    : this.q().trim() ? 'Try a different name.' : this.primaryNew() ? 'Start a new file, or pick a template.' : 'Files made by your team will show up here.');

  /** Templates: the engines' built-in ones for apps this person can write in, then the lab's own; the lab can hide built-ins. */
  protected readonly templates = computed(() => startTemplates(this.writable(), this.access.settings()));
  protected readonly showTemplates = computed(() => this.templates().length > 0 && this.tab() !== 'trash' && !this.access.phone());

  // ── grid ──
  private gridApi: GridApi<OfficeFile> | null = null;
  protected readonly gridTheme = computed(() => (this.theme.isDark() ? FH_GRID_DARK : gridThemeLight));
  protected readonly defaultColDef: ColDef = { sortable: true, resizable: true, suppressMovable: true };
  protected readonly rowId = (p: { data: OfficeFile }): string => p.data.id;
  protected readonly colDefs = computed<ColDef<OfficeFile>[]>(() => {
    const phone = this.access.phone();
    const compact = this.access.compact();
    const trash = this.tab() === 'trash';
    const canChange = (f: OfficeFile) => { const a = filesAppForKind(f.kind); return !!a && this.access.canWrite(a); };
    void canChange;
    const actionsW = phone ? 130 : trash ? 120 : this.access.full() ? 262 : 150;
    void this.theme.isDark();                       // the name cell's logo and pill follow the theme
    return [
      { field: 'name', headerName: 'Name', flex: 1, minWidth: 200, wrapText: true, autoHeight: true, cellClass: 'fh-cell-name', cellRenderer: this.nameRenderer },
      { field: 'updatedAt', headerName: trash ? 'Deleted' : 'Last saved', width: 158, hide: phone, valueGetter: p => (trash ? p.data?.deletedAt ?? p.data?.updatedAt : p.data?.updatedAt), valueFormatter: p => formatWhen(p.value) },
      { field: 'updatedByName', headerName: 'Saved by', width: 124, hide: compact, valueFormatter: p => p.value || '' },
      { field: 'sizeBytes', headerName: 'Size', width: 82, hide: compact, type: 'numericColumn', valueFormatter: p => formatSize(p.value) },
      { colId: 'actions', headerName: '', sortable: false, resizable: false, width: actionsW, pinned: 'right', cellRenderer: this.actionsRenderer },
    ];
  });

  private readonly nameRenderer = (p: ICellRendererParams<OfficeFile>): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:flex-start;gap:9px;line-height:1.35;padding:7px 0;white-space:normal;overflow-wrap:anywhere';
    const a = p.data ? filesAppForKind(p.data.kind) : undefined;
    const dark = this.theme.isDark();
    if (a) { const l = document.createElement('span'); l.style.cssText = 'flex:none;display:inline-flex;margin-top:1px'; l.innerHTML = logoSvg(a, 20, dark); wrap.appendChild(l); }
    const t = document.createElement('span');
    t.style.cssText = 'flex:1 1 auto;min-width:0';
    t.textContent = p.data?.name ?? '';
    wrap.appendChild(t);
    if ((p.data?.commentCount ?? 0) > 0) {
      const n = p.data!.commentCount!;
      const b = document.createElement('span');
      b.setAttribute('data-comments', String(n));
      b.setAttribute('title', `${n} open ${n === 1 ? 'comment' : 'comments'}`);
      b.setAttribute('aria-label', `${n} open ${n === 1 ? 'comment' : 'comments'}`);
      b.style.cssText = 'flex:none;display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border-radius:999px;font-size:12px;font-weight:600;line-height:1;color:var(--text-secondary);background:color-mix(in srgb, var(--text-primary) 8%, transparent)';
      b.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/></svg>${n}`;
      wrap.appendChild(b);
    }
    if (p.data?.containsPhi) { const pill = document.createElement('span'); pill.style.cssText = 'flex:none;display:inline-flex'; pill.innerHTML = phiPillHtml(dark); wrap.appendChild(pill); }
    return wrap;
  };

  private readonly actionsRenderer = (p: ICellRendererParams<OfficeFile>): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:4px;align-items:center;height:100%';
    const mk = (label: string, fn: (f: OfficeFile) => void): void => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pf-btn pf-btn--tertiary';
      b.style.padding = '4px 8px';
      b.textContent = label;
      b.setAttribute('data-act', label.toLowerCase());
      b.addEventListener('click', ev => { ev.stopPropagation(); if (p.data) fn(p.data); });
      wrap.appendChild(b);
    };
    const f = p.data;
    const app = f ? filesAppForKind(f.kind) : undefined;
    const writer = !!app && this.access.canWrite(app);
    if (this.tab() === 'trash') { if (writer) mk('Restore', x => void this.restore(x)); return wrap; }
    mk('Open', x => void this.open(x));
    mk('Share', x => this.shareFile.set(x));
    if (writer) { mk('Rename', x => void this.rename(x)); mk('Delete', x => void this.remove(x)); }
    return wrap;
  };

  constructor() {
    effect(() => { if (this.access.available()) void this.access.ensureLoaded(); });
    // Screen view state (owner 2026-11-21): tab + search come back as left after in-app navigation; a `?type=`
    // link still opens its own tab.
    const restored = inject(ViewStateService).bind('files', { tab: this.tab, q: this.q });
    let first = true;
    // `/files?type=doc` (the Start menu's app rows) opens Files on that app's tab.
    this.route.queryParamMap.subscribe(q => {
      const t = q.get('type');
      const keep = first && restored && !t;
      first = false;
      if (keep) { if (this.tab() === 'trash') void this.loadTrash(); return; }
      this.tab.set(t && FILES_APPS.some(a => a.kind === t) ? t : t === 'shared' ? 'shared' : 'all');
    });
    void this.load();
  }

  protected setTab(t: Tab): void {
    this.tab.set(t);
    if (t === 'trash') void this.loadTrash();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try { await this.access.ensureLoaded(); this.files.set(await this.office.list()); this.office.list(undefined, false, true).then(l => this.sharedWithMe.set(l)).catch(() => undefined); }
    catch (e) { this.error.set(toApiError(e).message); }
    finally { this.loading.set(false); }
    if (this.tab() === 'trash') await this.loadTrash();
  }
  private async loadTrash(): Promise<void> {
    try { this.trash.set(await this.office.list(undefined, true)); } catch (e) { this.error.set(toApiError(e).message); }
  }

  protected onGridReady(e: GridReadyEvent<OfficeFile>): void { this.gridApi = e.api; this.gridApi.sizeColumnsToFit?.(); }
  protected onRowClicked(f: OfficeFile | undefined): void { if (f && this.tab() !== 'trash') void this.open(f); }

  /** "Open from this device": any of the apps' files; the app is picked by the file's extension. */
  protected async openFromDevice(): Promise<void> {
    try {
      const o = await this.deviceFiles.openAny(this.apps());
      if (!o) return;
      await this.sheets.open({ app: o.app.id, source: FILES_NAME, name: o.name, bytes: o.bytes, target: o.target });
    } catch (e) { this.toast.error(e instanceof Error ? e.message : 'That file could not be opened.'); }
  }

  protected async open(f: OfficeFile): Promise<void> {
    const a = filesAppForKind(f.kind);
    if (!a) return;
    await this.router.navigateByUrl(`/files/${a.route}/${f.id}`);
  }

  /** A new file: Neuron / Synapse / Axon start blank; Myelin and Retina open one from this device (they edit what already exists). */
  protected async newFile(a: FilesApp): Promise<void> {
    if (a.kind === 'pdf' || a.kind === 'image') {
      try {
        const o = await this.deviceFiles.open(a);
        if (!o) return;
        await this.sheets.open({ app: a.id, source: FILES_NAME, name: o.name, bytes: o.bytes, target: o.target });
      } catch (e) { this.toast.error(e instanceof Error ? e.message : 'That file could not be opened.'); }
      return;
    }
    await this.sheets.open({ app: a.id, source: FILES_NAME });
  }

  protected async startTemplate(t: { name: string; app: FilesApp; cmd?: { cmd: string; params: Record<string, unknown> }; own?: OfficeOwnTemplate }): Promise<void> {
    if (t.own) {
      try {
        const c = await this.office.content(t.own.fileId);
        await this.sheets.open({ app: t.app.id, source: FILES_NAME, name: withAppExtension(t.app, t.name), bytes: c.bytes, copyOf: t.own.fileId });
      } catch (e) { this.toast.error(toApiError(e).message); }
      return;
    }
    await this.sheets.open({ app: t.app.id, source: FILES_NAME, name: withAppExtension(t.app, t.name), template: t.cmd });
  }

  protected async rename(f: OfficeFile): Promise<void> {
    const name = await this.dialog.prompt({ title: 'Rename file', initialValue: f.name, confirmLabel: 'Rename', required: true });
    const next = (name ?? '').trim();
    if (!next || next === f.name) return;
    try {
      const dto = await this.office.rename(f.id, next);
      this.files.update(list => list.map(x => (x.id === f.id ? { ...x, ...dto } : x)));
    } catch (e) { this.toast.error(toApiError(e).message); }
  }

  protected async remove(f: OfficeFile): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Delete this file?', tone: 'danger', confirmLabel: 'Delete', cancelLabel: 'Keep it',
      message: `"${f.name}" moves to Trash and is removed for good after ${this.trashDays()} days.`,
    });
    if (!ok) return;
    try { await this.office.remove(f.id); this.files.update(list => list.filter(x => x.id !== f.id)); this.toast.success('Moved to Trash'); }
    catch (e) { this.toast.error(toApiError(e).message); }
  }

  protected async restore(f: OfficeFile): Promise<void> {
    try {
      const back = await this.office.restore(f.id);
      this.trash.update(list => list.filter(x => x.id !== f.id));
      this.files.update(list => [back, ...list]);
      this.toast.success('Restored');
    } catch (e) { this.toast.error(toApiError(e).message); }
  }
}

function formatWhen(v: unknown): string {
  const d = new Date(String(v ?? ''));
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
}
function formatSize(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
