import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ToggleComponent } from '@prefrontal/shared';
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
  imports: [SkeletonRowsComponent, HeroBandComponent, ToggleComponent, SelectComponent, FilesLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page fs" data-testid="files-settings">
      <pf-hero-band [back]="true" [slim]="true">
        <div band-center class="fs-center"><span class="pf-ctx__primary">{{ name }} settings</span></div>
        <ng-container band-actions>
          @if (!full()) { <span class="fs-chip" data-testid="files-viewonly-chip">View only</span> }
          <button type="button" class="pf-hb-btn pf-hb-btn--primary press" data-testid="files-settings-save" [disabled]="!full() || !dirty() || saving()" (click)="save()">{{ saving() ? 'Saving…' : 'Save changes' }}</button>
        </ng-container>
      </pf-hero-band>

      <div class="pf-body fs-body">
        @if (loading()) {
          <div class="fs-over" role="status"><pf-skeleton-rows [rows]="4" [avatar]="false" label="Loading…"></pf-skeleton-rows></div>
        } @else if (error()) {
          <div class="pf-empty" role="alert" data-testid="files-settings-error">
            <p class="pf-empty__title">We couldn't load these settings</p>
            <p class="pf-empty__body">{{ error() }}</p>
            <button type="button" class="pf-btn pf-btn--secondary pf-empty__action" (click)="load()">Try again</button>
          </div>
        } @else if (draft(); as d) {
          @if (!full()) {
            <p class="fs-note" data-testid="files-settings-viewonly">Files are view only for your organization, so these settings can be read but not changed.</p>
          }
          <section class="pf-card" aria-label="Apps">
            <header class="pf-card__head"><span class="pf-card__label">Apps</span></header>
            <div class="pf-card__body fs-apps">
              @for (a of apps; track a.id) {
                <div class="fs-app" [attr.data-testid]="'files-app-' + a.id">
                  <pf-files-logo [app]="a.id" [size]="40" />
                  <div class="fs-app__txt">
                    <span class="fs-app__name">{{ a.name }}</span>
                    <span class="fs-app__blurb">{{ a.blurb }}</span>
                  </div>
                  <div class="fs-app__who">
                    <span class="fs-lbl">Who can edit</span>
                    <pf-select [options]="roleOptions()" [multiple]="true" [searchable]="true" [values]="d.apps[a.kind].editRoles" [disabled]="!full()"
                               placeholder="Everyone with a login" [attr.aria-label]="'Who can edit ' + a.name" (valuesChange)="setRoles(a, $event)"></pf-select>
                  </div>
                  <pf-toggle [checked]="d.apps[a.kind].enabled" [disabled]="!full()" [attr.data-testid]="'files-toggle-' + a.id"
                             (checkedChange)="setEnabled(a, $event)" />
                </div>
              }
            </div>
          </section>

          <section class="pf-card" aria-label="Templates">
            <header class="pf-card__head"><span class="pf-card__label">Templates on File → New</span></header>
            <div class="pf-card__body fs-tpls" data-testid="files-templates-settings">
              @for (t of builtIns; track t.id) {
                <div class="fs-row">
                  <pf-files-logo [app]="t.app.id" [size]="20" />
                  <span class="fs-row__t">{{ t.name }}</span>
                  <pf-toggle size="sm" [checked]="!d.hiddenTemplates.includes(t.id)" [disabled]="!full()" [attr.data-testid]="'files-tpl-' + t.id" (checkedChange)="setTemplateShown(t.id, $event)" />
                </div>
              }
              @for (o of d.ownTemplates; track o.id) {
                <div class="fs-row">
                  @if (appOf(o.kind); as oa) { <pf-files-logo [app]="oa.id" [size]="20" /> }
                  <span class="fs-row__t">{{ o.name }} <span class="fs-row__s">the lab's own</span></span>
                  <button type="button" class="pf-btn pf-btn--tertiary" [disabled]="!full()" (click)="removeOwn(o)">Remove</button>
                </div>
              }
              <button type="button" class="pf-btn pf-btn--secondary fs-add" data-testid="files-add-template" [disabled]="!full()" (click)="addOwn()">Add the lab's own template</button>
            </div>
          </section>

          <section class="pf-card" aria-label="Files and devices">
            <header class="pf-card__head"><span class="pf-card__label">Files and devices</span></header>
            <div class="pf-card__body fs-list">
              <div class="fs-line" data-testid="files-storage">
                <div class="fs-line__txt"><span class="fs-line__t">Storage used</span>
                  <span class="fs-line__s">{{ storageLine() }}</span></div>
                <span class="fs-line__v">{{ storage() ? bytes(storage()!.totalBytes) : '' }}</span>
              </div>
              <div class="fs-line">
                <div class="fs-line__txt"><span class="fs-line__t">Edit on phones</span>
                  <span class="fs-line__s">{{ d.editOnPhones ? 'Phones can edit' : 'Off: phones can view and copy only' }}</span></div>
                <pf-toggle [checked]="d.editOnPhones" [disabled]="!full()" data-testid="files-phones" (checkedChange)="patch({ editOnPhones: $event })" />
              </div>
              <div class="fs-line">
                <div class="fs-line__txt"><span class="fs-line__t">Deleted files</span>
                  <span class="fs-line__s">Kept in Trash, then removed</span></div>
                <div class="fs-line__sel"><pf-select [options]="trashChoices" [value]="'' + d.trashDays" [disabled]="!full()" aria-label="Days deleted files are kept" size="sm"
                  (valueChange)="patch({ trashDays: +$event })"></pf-select></div>
              </div>
              <div class="fs-line">
                <div class="fs-line__txt"><span class="fs-line__t">Patient names in files</span>
                  <span class="fs-line__s">Only for roles allowed to export patient data</span></div>
                <pf-toggle [checked]="d.patientNames" [disabled]="!full()" data-testid="files-names" (checkedChange)="patch({ patientNames: $event })" />
              </div>
              @if (canRoles()) {
                <div class="fs-line fs-line--stack" data-testid="files-bar-defaults">
                  <div class="fs-line__txt"><span class="fs-line__t">On the bottom bar by default</span>
                    <span class="fs-line__s">Admins choose per role; people can still pin or unpin their own</span></div>
                  <div class="fs-bar">
                    <pf-select [options]="roleOptions()" [value]="barRole()" [searchable]="true" placeholder="Pick a role" size="sm" aria-label="Role" (valueChange)="barRole.set($event)"></pf-select>
                    <pf-select [options]="appOptions" [multiple]="true" [values]="barApps()" [disabled]="!barRole()" placeholder="No Files apps" size="sm" aria-label="Apps on this role's bar"
                               (valuesChange)="setBarApps($event)"></pf-select>
                    <button type="button" class="pf-btn pf-btn--secondary" data-testid="files-bar-save" [disabled]="!barRole() || !barDirty()" (click)="saveBar()">Save bar defaults</button>
                  </div>
                </div>
              }
            </div>
          </section>
        }
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .fs-body { display: flex; flex-direction: column; gap: 16px; }
    .fs-center { display: flex; align-items: center; justify-content: center; min-width: 0; }
    .fs-chip { display: inline-flex; align-items: center; height: 26px; padding: 0 10px; border-radius: 999px; font-size: 12px; font-weight: 600; color: var(--text-tertiary); background: color-mix(in srgb, var(--text-primary) 6%, transparent); }
    .fs-note { margin: 0; padding: 10px 14px; font-size: 13px; border-radius: 10px; color: var(--text-secondary); background: color-mix(in srgb, var(--violet-500, #7c3aed) 8%, transparent); }
    .fs-over { min-height: 200px; display: flex; align-items: center; justify-content: center; }
    .fs-apps { display: flex; flex-direction: column; gap: 4px; padding: 4px 16px 12px; }
    .fs-app { display: grid; grid-template-columns: auto minmax(160px, 1fr) minmax(220px, 320px) auto; align-items: center; gap: 14px; padding: 12px 0; border-top: 1px solid var(--card-border, rgba(0,0,0,.08)); }
    .fs-app:first-child { border-top: 0; }
    .fs-app__txt { display: flex; flex-direction: column; min-width: 0; }
    .fs-app__name { font-weight: 700; font-size: 15px; color: var(--text-primary); }
    .fs-app__blurb { font-size: 13px; color: var(--text-tertiary); overflow-wrap: anywhere; }
    .fs-app__who { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .fs-lbl { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); }
    .fs-tpls, .fs-list { padding: 4px 16px 12px; display: flex; flex-direction: column; gap: 4px; }
    .fs-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--card-border, rgba(0,0,0,.08)); }
    .fs-row:first-child { border-top: 0; }
    .fs-row__t { flex: 1 1 auto; font-size: 14px; color: var(--text-primary); overflow-wrap: anywhere; }
    .fs-row__s { font-size: 12px; color: var(--text-tertiary); margin-left: 6px; }
    .fs-add { align-self: flex-start; margin-top: 8px; }
    .fs-line { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid var(--card-border, rgba(0,0,0,.08)); }
    .fs-line:first-child { border-top: 0; }
    .fs-line--stack { flex-direction: column; align-items: stretch; }
    .fs-line__txt { display: flex; flex-direction: column; min-width: 0; }
    .fs-line__t { font-weight: 600; font-size: 14px; color: var(--text-primary); }
    .fs-line__s { font-size: 13px; color: var(--text-tertiary); overflow-wrap: anywhere; }
    .fs-line__v { font-weight: 700; font-size: 15px; color: var(--text-primary); white-space: nowrap; }
    .fs-line__sel { min-width: 130px; }
    .fs-bar { display: grid; grid-template-columns: minmax(160px, 1fr) minmax(200px, 1.4fr) auto; gap: 10px; align-items: center; }
    @media (max-width: 760px) { .fs-app { grid-template-columns: auto 1fr auto; } .fs-app__who { grid-column: 1 / -1; } .fs-bar { grid-template-columns: 1fr; } .fs-line { flex-wrap: wrap; } }
  `],
})
export class FilesSettingsPage {
  private readonly office = inject(OfficeService);
  private readonly access = inject(FilesAccessService);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly navPrefs = inject(NavPrefsService);

  protected readonly name = FILES_NAME;
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
