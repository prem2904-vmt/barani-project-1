import { SettingsSavebarComponent } from '../../shared/components/setting-row/settings-savebar.component';
import { HasUnsavedChanges, guardUnsavedOnUnload } from '../../shared/utils/unsaved-changes';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { ToggleComponent, TwoPanelComponent, TwoPanelGroup, injectTwoPanelCompact } from '@prefrontal/shared';
import { SettingRowComponent } from '../../shared/components/setting-row/setting-row.component';
import { SETTINGS_HOST, bindTabQuery, injectSettingsHosted } from '../../shared/utils/settings-host';
import { NgTemplateOutlet } from '@angular/common';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { DialogService } from '../../core/services/dialog.service';
import { ToastService } from '../../core/services/toast.service';
import { SkeletonRowsComponent } from '@prefrontal/shared';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { FilesLogoComponent } from '../../shared/components/files-logo/files-logo.component';
import { PfSelectOption, SelectComponent } from '../../shared/primitives/select.component';
import { NavPrefsService } from '../../layout/start-menu/nav-prefs.service';
import { RoleNav, normalizeRoleNav } from '../../layout/start-menu/nav-pins';
import { FilesAccessService } from './files-access.service';
import { FILES_APPS, FILES_NAME, FilesApp, filesAppForKind } from './files-registry';
import { OfficeFile, OfficeOwnTemplate, OfficeService, OfficeSettings, OfficeStorage, toApiError } from './office.service';

const TRASH_CHOICES: PfSelectOption<string>[] = [7, 14, 30, 60, 90, 180, 365].map(d => ({ value: String(d), label: `${d} days` }));

/** "1.2 GB" / "340 MB" / "12 KB". */
export function bytesWords(n: number): string {
  if (!(n > 0)) return '0 KB';
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : n < 1024 ** 3 ? `${Math.round(n / 1024 / 1024)} MB` : `${(n / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * Settings → Files (`/admin/files`): per app on/off and who can edit, the templates, storage used, edit on phones, how long deleted files
 * stay in Trash, patient names, and which apps sit on each role's bottom bar (the existing role defaults; nothing new is stored for that).
 * The lab's own switches sit UNDER the platform level: a lab that is View only (not entitled to Full) sees everything here but cannot change it.
 */
@Component({
  selector: 'pf-files-settings',
  standalone: true,
  imports: [SettingsSavebarComponent, SkeletonRowsComponent, HeroBandComponent, ToggleComponent, SelectComponent, FilesLogoComponent, TwoPanelComponent, SettingRowComponent, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page fs" data-testid="files-settings">
      <!-- Test Master's frame (owner 2026-11-17): band (back, search pill, Save as the ONE primary) · LEFT side card of
           categories · RIGHT main card of rows. Only the card bodies scroll. -->
      <pf-hero-band [back]="true" [placeholder]="'Search ' + name + ' settings'" [value]="q()" (valueChange)="q.set($event)">
        <ng-container band-actions>
          @if (!full()) { <span class="fs-chip" data-testid="files-viewonly-chip">View only</span> }

        </ng-container>
      </pf-hero-band>

      <div class="pf-band-body pf-band-body--fill fs-body">
        @if (loading()) {
          <div class="fs-over" role="status"><pf-skeleton-rows [rows]="4" [avatar]="false" label="Loading…"></pf-skeleton-rows></div>
        } @else if (error()) {
          <div class="pf-empty" role="alert" data-testid="files-settings-error">
            <p class="pf-empty__title">We couldn't load these settings</p>
            <p class="pf-empty__body">{{ error() }}</p>
            <button type="button" class="pf-btn pf-btn--secondary pf-empty__action" (click)="load()">Try again</button>
          </div>
        } @else if (draft(); as d) {
          <pf-two-panel [groups]="catGroups()" [selected]="selectedCat()" [compact]="compact()" [detailOpen]="detailOpen()"
                        navLabel="Files settings" [navTitle]="name + ' settings'" [navIcon]="filesIcon" [panelNote]="null"
                        [flush]="true" [hideNav]="hosted" [bareMain]="hosted" backLabel="Back to Files settings" (pick)="pickCat($event)" (back)="phoneDetail.set(false)">
            <ng-container panel-tools>
              @if (selectedCat() === 'templates') {
                <button type="button" class="pf-hb-btn pf-hb-btn--ghost fs-add" data-testid="files-add-template" [disabled]="!full()" (click)="addOwn()">Add lab template</button>
              }
            </ng-container>
            <div class="fs-rows">
              @if (hosted && selectedCat() === 'templates') {
                <div class="fs-hostbar"><button type="button" class="pf-hb-btn pf-hb-btn--ghost fs-add" data-testid="files-add-template" [disabled]="!full()" (click)="addOwn()">Add lab template</button></div>
              }
              @if (!full()) {
                <p class="fs-note" data-testid="files-settings-viewonly">View only: Files are view only for your organization, so these settings can be read but not changed.</p>
              }
              @switch (selectedCat()) {
                @case ('apps') {
                  @for (a of apps; track a.id) {
                    @if (match(a.name + ' ' + a.blurb)) {
                      <div class="fs-app" [attr.data-testid]="'files-app-' + a.id">
                        <pf-files-logo [app]="a.id" [size]="32" />
                        <div class="fs-app__txt">
                          <span class="fs-app__name">{{ a.name }}</span>
                          <span class="fs-app__blurb">{{ a.blurb }}</span>
                        </div>
                        <div class="fs-app__who">
                          <pf-select [options]="roleOptions()" [multiple]="true" [searchable]="true" [values]="d.apps[a.kind].editRoles" [disabled]="!full()"
                                     placeholder="Everyone with a login can edit" [attr.aria-label]="'Who can edit ' + a.name" (valuesChange)="setRoles(a, $event)"></pf-select>
                        </div>
                        <pf-toggle [checked]="d.apps[a.kind].enabled" [disabled]="!full()" [attr.data-testid]="'files-toggle-' + a.id"
                                   (checkedChange)="setEnabled(a, $event)" />
                      </div>
                    }
                  }
                }
                @case ('templates') {
                  <div data-testid="files-templates-settings">
                    @for (t of builtIns; track t.id) {
                      @if (match(t.name)) {
                        <div class="fs-row">
                          <pf-files-logo [app]="t.app.id" [size]="20" />
                          <span class="fs-row__t">{{ t.name }}</span>
                          <pf-toggle size="sm" [checked]="!d.hiddenTemplates.includes(t.id)" [disabled]="!full()" [attr.data-testid]="'files-tpl-' + t.id" (checkedChange)="setTemplateShown(t.id, $event)" />
                        </div>
                      }
                    }
                    @for (o of d.ownTemplates; track o.id) {
                      @if (match(o.name)) {
                        <div class="fs-row">
                          @if (appOf(o.kind); as oa) { <pf-files-logo [app]="oa.id" [size]="20" /> }
                          <span class="fs-row__t">{{ o.name }} <span class="fs-row__s">the lab's own</span></span>
                          <button type="button" class="pf-hb-btn pf-hb-btn--ghost fs-rm" [disabled]="!full()" (click)="removeOwn(o)">Remove</button>
                        </div>
                      }
                    }
                  </div>
                }
                @case ('devices') {
                  <pf-setting-row data-testid="files-storage" label="Storage used" [hint]="storageLine()">
                    <span class="fs-line__v">{{ storage() ? bytes(storage()!.totalBytes) : '' }}</span>
                  </pf-setting-row>
                  <pf-setting-row label="Edit on phones" [hint]="d.editOnPhones ? 'Phones can edit' : 'Off: phones can view and copy only'">
                    <pf-toggle [checked]="d.editOnPhones" [disabled]="!full()" data-testid="files-phones" (checkedChange)="patch({ editOnPhones: $event })" />
                  </pf-setting-row>
                  <pf-setting-row label="Deleted files" hint="Kept in Trash, then removed">
                    <div class="fs-line__sel"><pf-select [options]="trashChoices" [value]="'' + d.trashDays" [disabled]="!full()" aria-label="Days deleted files are kept" size="sm"
                      (valueChange)="patch({ trashDays: +$event })"></pf-select></div>
                  </pf-setting-row>
                }
                @case ('patient') {
                  <pf-setting-row label="Patient names in files" hint="Only for roles allowed to export patient data">
                    <pf-toggle [checked]="d.patientNames" [disabled]="!full()" data-testid="files-names" (checkedChange)="patch({ patientNames: $event })" />
                  </pf-setting-row>
                }
                @case ('bar') {
                  <pf-setting-row data-testid="files-bar-defaults" label="On the bottom bar by default" hint="Per role; people can still pin or unpin their own">
                    <div class="fs-bar">
                      <pf-select [options]="roleOptions()" [value]="barRole()" [searchable]="true" placeholder="Pick a role" size="sm" aria-label="Role" (valueChange)="barRole.set($event)"></pf-select>
                      <pf-select [options]="appOptions" [multiple]="true" [values]="barApps()" [disabled]="!barRole()" placeholder="No Files apps" size="sm" aria-label="Apps on this role's bar"
                                 (valuesChange)="setBarApps($event)"></pf-select>
                      <button type="button" class="pf-hb-btn pf-hb-btn--ghost" data-testid="files-bar-save" [disabled]="!barRole() || !barDirty()" (click)="saveBar()">Save bar</button>
                    </div>
                  </pf-setting-row>
                }
              }
              <pf-settings-savebar saveTestId="files-settings-save" [dirty]="hasUnsavedChanges()" [saving]="saving()" (save)="save()" (discard)="discardDraft()"></pf-settings-savebar>
            </div>
          </pf-two-panel>
        }
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .fs-chip { display: inline-flex; align-items: center; height: 26px; padding: 0 10px; border-radius: 999px; font-size: 12px; font-weight: 600; color: var(--text-tertiary); background: color-mix(in srgb, var(--text-primary) 6%, transparent); }
    .fs-over { min-height: 200px; display: flex; align-items: center; justify-content: center; }
    .fs-rows { padding: 4px 18px 16px; }
    .fs-hostbar { display: flex; justify-content: flex-end; padding-top: 10px; }
    .fs-note { margin: 10px 0 4px; font-size: 12.5px; color: var(--text-tertiary); }
    .fs-app { display: grid; grid-template-columns: auto minmax(160px, 1fr) 260px auto; align-items: center; gap: 14px; min-height: 56px; padding: 10px 0; border-bottom: 1px solid var(--pf-line); }
    .fs-app:last-child { border-bottom: 0; }
    .fs-app__txt { display: flex; flex-direction: column; min-width: 0; }
    .fs-app__name { font-weight: 500; font-size: 13.5px; color: var(--text-primary); }
    .fs-app__blurb { font-size: 12.5px; color: var(--text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fs-app__who { min-width: 0; }
    .fs-row { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 6px 0; border-bottom: 1px solid var(--pf-line); }
    .fs-row:last-child { border-bottom: 0; }
    .fs-row__t { flex: 1 1 auto; font-size: 13.5px; color: var(--text-primary); overflow-wrap: anywhere; }
    .fs-row__s { font-size: 12px; color: var(--text-tertiary); margin-left: 6px; }
    .fs-add, .fs-rm { height: 30px; padding: 0 12px; font-size: 13px; }
    .fs-line__v { font-weight: 600; font-size: 14px; color: var(--text-primary); white-space: nowrap; }
    .fs-line__sel { min-width: 150px; }
    .fs-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .fs-bar pf-select { min-width: 180px; }
    @media (max-width: 760px) { .fs-app { grid-template-columns: auto 1fr auto; } .fs-app__who { grid-column: 1 / -1; } .fs-app__blurb { white-space: normal; } }
  `],
})
export class FilesSettingsPage implements HasUnsavedChanges {
  private readonly office = inject(OfficeService);
  private readonly access = inject(FilesAccessService);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly navPrefs = inject(NavPrefsService);

  protected readonly name = FILES_NAME;

  // ── Test Master frame: categories (side card) → rows (main card); `?tab=` keeps the category ──
  protected readonly filesIcon = 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z';
  protected readonly compact = injectTwoPanelCompact();
  protected readonly q = signal('');
  protected readonly cat = signal<string | null>(null);
  protected readonly phoneDetail = signal(false);
  protected readonly catGroups = computed<TwoPanelGroup[]>(() => [{ key: 'files', heading: '', items: [
    { id: 'apps', label: 'Apps', icon: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z' },
    { id: 'templates', label: 'Templates', icon: 'M7 3h7l5 5v13H7zM14 3v5h5' },
    { id: 'devices', label: 'Files and devices', icon: 'M5 4h14v12H5zM2 20h20' },
    { id: 'patient', label: 'Patient data', icon: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2' },
    ...(this.canRoles() ? [{ id: 'bar', label: 'Bottom bar', icon: 'M3 17h18M5 21h14M7 13h10' }] : []),
  ] }]);
  protected readonly selectedCat = computed(() => this.cat() ?? (this.compact() ? null : 'apps'));
  protected readonly detailOpen = computed(() => this.phoneDetail() || (!this.compact() && true));
  private readonly followTab = bindTabQuery(['apps', 'templates', 'devices', 'patient', 'bar'] as const, (t) => { this.cat.set(t); this.phoneDetail.set(true); });
  protected pickCat(id: string): void { this.cat.set(id); this.phoneDetail.set(true); }
  /** Hosted (inline in the Settings overview): the categories go to the host — its card head shows them as a pill. */
  protected readonly hosted = injectSettingsHosted();
  private readonly settingsHost = inject(SETTINGS_HOST, { optional: true });
  private readonly publishCats = (() => {
    const host = this.settingsHost;
    if (!host) return null;
    inject(DestroyRef).onDestroy(() => host.categories.set(null));
    return effect(() => host.categories.set(this.catGroups()[0].items.map((i) => ({ id: i.id, label: i.label }))));
  })();
  /** The band pill narrows the rows (apps and templates by name). */
  protected match(text: string): boolean { const w = this.q().trim().toLowerCase(); return !w || text.toLowerCase().includes(w); }
  protected readonly apps = FILES_APPS;
  protected readonly trashChoices = TRASH_CHOICES;
  protected readonly appOptions: PfSelectOption<string>[] = FILES_APPS.map(a => ({ value: a.navId, label: a.name }));
  protected readonly builtIns = FILES_APPS.flatMap(a => a.templates.map(t => ({ id: t.id, name: t.name, app: a })));
  protected readonly full = this.access.full;
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly draft = signal<OfficeSettings | null>(null);
  private saved = '';
  protected readonly dirty = computed(() => !!this.draft() && JSON.stringify(this.draft()) !== this.saved);
  protected readonly storage = signal<OfficeStorage | null>(null);
  protected readonly roleOptions = signal<PfSelectOption<string>[]>([]);
  protected readonly files = signal<OfficeFile[]>([]);
  protected readonly canRoles = computed(() => this.auth.hasPermission('manage_roles'));
  protected readonly bytes = bytesWords;
  protected appOf = (kind: string): FilesApp | undefined => filesAppForKind(kind);

  // bottom-bar defaults (the existing role defaults; saved through NavPrefsService)
  protected readonly barRole = signal('');
  private readonly barDraft = signal<Record<string, string[]>>({});
  protected readonly barApps = computed(() => this.barDraft()[this.barRole()] ?? this.currentBar(this.barRole()));
  protected readonly barDirty = signal(false);

  protected readonly storageLine = computed(() => {
    const s = this.storage();
    if (!s) return '';
    const by = (k: string) => s.byKind.find(x => x.kind === k)?.count ?? 0;
    return FILES_APPS.map(a => `${by(a.kind)} ${by(a.kind) === 1 ? a.noun : a.nounPlural}`).join(' · ');
  });

  constructor() { void this.load(); }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const r = await this.office.settings();
      this.draft.set(clone(r.settings));
      this.saved = JSON.stringify(r.settings);
      await this.access.refresh();
      this.office.storage().then(s => this.storage.set(s)).catch(() => undefined);
      this.office.list().then(f => this.files.set(f)).catch(() => undefined);
      this.api.get<{ id: string; name: string }[]>('/api/roles/').subscribe({
        next: l => this.roleOptions.set((l ?? []).map(x => x.name).filter(Boolean).map(n => ({ value: n, label: n }))),
        error: () => undefined,
      });
      this.navPrefs.ensureDefaults();
    } catch (e) { this.error.set(toApiError(e).message); }
    finally { this.loading.set(false); }
  }

  protected patch(p: Partial<OfficeSettings>): void { this.draft.update(d => (d ? { ...d, ...p } : d)); }
  protected setEnabled(a: FilesApp, on: boolean): void {
    this.draft.update(d => d ? { ...d, apps: { ...d.apps, [a.kind]: { ...d.apps[a.kind], enabled: on } } } : d);
  }
  protected setRoles(a: FilesApp, roles: string[]): void {
    this.draft.update(d => d ? { ...d, apps: { ...d.apps, [a.kind]: { ...d.apps[a.kind], editRoles: roles } } } : d);
  }
  protected setTemplateShown(id: string, shown: boolean): void {
    this.draft.update(d => d ? { ...d, hiddenTemplates: shown ? d.hiddenTemplates.filter(x => x !== id) : [...new Set([...d.hiddenTemplates, id])] } : d);
  }
  protected removeOwn(o: OfficeOwnTemplate): void {
    this.draft.update(d => d ? { ...d, ownTemplates: d.ownTemplates.filter(x => x.id !== o.id) } : d);
  }

  /** "Add the lab's own template": pick one of the lab's saved files; it is copied whenever someone starts from it. */
  protected async addOwn(): Promise<void> {
    const list = this.files();
    if (!list.length) { await this.dialog.alert({ title: 'No files to use yet', message: 'Save a file first, then come back to make it a template.', confirmLabel: 'OK' }); return; }
    const pick = await this.dialog.choose({ title: 'Which file?', message: 'Pick a saved file to start new ones from.', choices: list.slice(0, 40).map(f => ({ value: f.id, label: f.name })) });
    if (!pick) return;
    const f = list.find(x => x.id === pick);
    const app = f ? filesAppForKind(f.kind) : undefined;
    if (!f || !app) return;
    const nm = await this.dialog.prompt({ title: 'Template name', initialValue: f.name.replace(/\.[A-Za-z0-9]{1,5}$/, ''), confirmLabel: 'Add', required: true });
    const clean = (nm ?? '').trim();
    if (!clean) return;
    this.draft.update(d => d ? { ...d, ownTemplates: [...d.ownTemplates, { id: '', kind: f.kind, name: clean, fileId: f.id }] } : d);
  }

  // ── Unsaved changes (ask before leaving; the browser asks on tab close) ──
  readonly unsavedLabel = 'Files settings';
  hasUnsavedChanges(): boolean { return this.full() && this.dirty(); }
  async saveChanges(): Promise<boolean> { await this.save(); return !this.dirty(); }
  /** The card's Save bar Discard: back to what was saved. */
  discardDraft(): void { if (this.saved) this.draft.set(JSON.parse(this.saved)); }
  private readonly _unload = guardUnsavedOnUnload(this);

  async save(): Promise<void> {
    const d = this.draft();
    if (!d || this.saving()) return;
    this.saving.set(true);
    try {
      const r = await this.office.saveSettings(d);
      this.draft.set(clone(r.settings));
      this.saved = JSON.stringify(r.settings);
      await this.access.refresh();
      this.toast.success('Saved');
    } catch (e) { this.toast.error(toApiError(e).message); }
    finally { this.saving.set(false); }
  }

  // ── bar defaults ──
  private currentBar(role: string): string[] {
    const nav = this.navPrefs.roleMap()?.[role];
    return (nav?.pinned ?? []).filter(id => this.appOptions.some(o => o.value === id));
  }
  protected setBarApps(ids: string[]): void {
    this.barDraft.update(m => ({ ...m, [this.barRole()]: ids }));
    this.barDirty.set(true);
  }
  protected saveBar(): void {
    const role = this.barRole();
    const map: Record<string, RoleNav> = { ...(this.navPrefs.roleMap() ?? {}) };
    const cur = map[role] ?? { pinned: [], locked: [] };
    const files = new Set(this.appOptions.map(o => o.value));
    const keep = cur.pinned.filter(id => !files.has(id));
    const n = normalizeRoleNav([...keep, ...(this.barDraft()[role] ?? [])], cur.locked);
    if (n.pinned.length) map[role] = n; else delete map[role];
    this.navPrefs.saveRoleDefaults(map).subscribe({
      next: () => { this.barDirty.set(false); this.toast.success('Bar defaults saved'); },
      error: (e: unknown) => this.toast.error((e as { message?: string })?.message || "Couldn't save the bar defaults."),
    });
  }
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
