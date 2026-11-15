import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, effect, inject, signal, untracked, viewChild, ElementRef } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { DialogService } from '../../core/services/dialog.service';
import { ThemeService } from '../../core/services/theme.service';
import { ToastService } from '../../core/services/toast.service';
import { ApiError } from '../../shared/models/api-response.model';
import { SkeletonRowsComponent, SkeletonDetailComponent } from '@prefrontal/shared';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { PfDateComponent } from '../../shared/components/pf-date/pf-date.component';
import { FilesLogoComponent } from '../../shared/components/files-logo/files-logo.component';
import { FilesShareDialogComponent } from './files-share.dialog';
import { PfSelectOption, SelectComponent } from '../../shared/primitives/select.component';
import { labDaysAgo, labToday } from '../../shared/utils/lab-clock';
import { PATIENT_HIDDEN_NOTE, neuronAccess } from '../neuron/neuron-access';
import { SheetEditorService, SheetOpenRequest } from '../neuron/sheet-editor.service';
import { BROKEN_RESULTS_MESSAGE, TRUNCATED_NOTICE, resultsFileName, resultsProblem } from '../neuron/results-query';
import { FilesBridge, FIT_COLUMNS, SavedFile, downloadBytes, filesFrameUrl, mimeForName, notThisKindMessage, withExtension } from './files-bridge';
import { FilesSaver, StoredRef } from './files-save';
import { FileTarget, FilesDeviceService } from './files-device.service';
import { FilesAccessService } from './files-access.service';
import { FilesEngineService, engineMissingMessage } from './files-engine.service';
import { FILES_APPS, FilesApp, bytesFit, filesAppForRoute, withAppExtension } from './files-registry';
import { OfficeFile, OfficeService, PhiSource, toApiError } from './office.service';
import { phiLine, phiSourceWords } from './phi-words';

interface Session { key: number; file: StoredRef; target: FileTarget; fromResults: boolean; phi: PhiSource[]; pendingPhi: string | null }

/**
 * The Files editor: ONE page that hosts every app's engine (Neuron, Synapse, Axon, Myelin, Retina) in a same-origin iframe, under one slim band.
 * The app is the `:kind` of the route (`/files/<kind>/<id|new>`), read from the registry; nothing here is specific to one app except the
 * sheet-only "Insert results" card. The page owns the FILES: it sends bytes in and receives every Save back, then stores them in lab
 * storage (files-save.ts: POST when new, PUT + If-Match when stored, a 409 never overwrites) or on THIS device (files-device.service.ts),
 * wherever the file lives. A lab without Full Files, a role without edit rights and a phone all open the file view-only
 * (`readonly=1`): no Save, no rename; a copy can still go to the device (the server decides first for a file with patient data).
 */
@Component({
  selector: 'pf-files-editor',
  standalone: true,
  imports: [SkeletonRowsComponent, SkeletonDetailComponent, HeroBandComponent, NgTemplateOutlet, SelectComponent, PfDateComponent, FilesLogoComponent, FilesShareDialogComponent],
  providers: [FilesBridge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page nr nr--sheet" [style.--pf-hb-bleed]="'0px'" data-testid="files-editor" [attr.data-app]="app().id">
      <pf-hero-band [back]="true" [backAction]="closeFn" [slim]="true">
        <div band-center class="nr-center">
          @if (session(); as s) {
            <pf-files-logo [app]="app().id" [size]="22" />
            @if (renaming()) {
              <input class="nr-name-input" type="text" [value]="s.file.name" maxlength="120" aria-label="File name" data-testid="files-name-input"
                     (keydown.enter)="commitRename($any($event.target).value)" (keydown.escape)="renaming.set(false)" (blur)="commitRename($any($event.target).value)" />
            } @else {
              <button type="button" class="pf-ctx__chip nr-name" data-testid="files-name" [title]="canRename() ? 'Rename' : s.file.name" [disabled]="!canRename()" (click)="renaming.set(true)">
                <span class="nr-name__t">{{ s.file.name }}</span>
                @if (canRename()) {
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                }
              </button>
            }
            @if (canWrite()) {
              <span class="pf-savestate" role="status" data-testid="files-savestate" [attr.data-state]="saveState()">
                @if (saveState() === 'Saved') {
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                } @else if (saveState() !== 'Not saved yet') {
                  <span class="pf-savestate__dot" aria-hidden="true"></span>
                }
                {{ saveState() }}
              </span>
            }
            <span class="nr-chip" data-testid="files-where" [attr.data-where]="s.target.kind">{{ where() }}</span>
            @if (viewOnlyLevel()) {
              <span class="nr-chip nr-chip--quiet" data-testid="files-viewonly-chip" title="Your organization can open and copy files here, not change them">View only</span>
            }
            @if (hasPhi()) {
              <button type="button" class="nr-chip nr-chip--phi" data-testid="files-phi-chip" (click)="showPhi()"
                      title="Prefrontal put patient data in this file. It stays out of outside assistants.">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 2.9 8.3 7 10 4.1-1.7 7-5.5 7-10V6l-7-3Z"/></svg>
                <span class="nr-chip__t">Contains patient data · kept out of outside AI</span>
              </button>
            }
          }
        </div>
        <ng-container band-actions>
          @if (session()) {
            @if (canInsert()) {
              <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" data-testid="neuron-insert" [attr.aria-pressed]="insertOpen()" (click)="toggleInsert()">Insert results</button>
            }
            @if (shareable()) {
              <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" data-testid="files-share-open" (click)="openShare()">Share</button>
            }
            @if (!phone()) {
              <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" data-testid="files-device-open" (click)="openFromDevice()">Open from this device</button>
            }
            <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" data-testid="files-device-save" [disabled]="!ready()" (click)="saveToDevice()">
              {{ phone() || !canWrite() ? 'Save a copy' : 'Save to this device' }}
            </button>
            @if (canWrite()) {
              <button type="button" class="pf-hb-btn pf-hb-btn--primary press" data-testid="files-save" [disabled]="!ready() || saving()" (click)="saveNow()">{{ saving() ? 'Saving…' : 'Save' }}</button>
            }
          }
        </ng-container>
      </pf-hero-band>

      @if (unavailable(); as u) {
        <div class="pf-empty nr-over nr-over--flow" role="alert" data-testid="files-unavailable">
          <p class="pf-empty__title">{{ u.title }}</p>
          <p class="pf-empty__body">{{ u.body }}</p>
          <button type="button" class="pf-btn pf-btn--secondary pf-empty__action" (click)="closeFn()">Back</button>
        </div>
      } @else if (session()) {
        @if (phone() && !phoneCanEdit()) {
          <p class="nr-strip" data-testid="files-phone-viewonly">View and copy only on this device. To edit, use a tablet or a computer.</p>
        } @else if (!canWrite() && !viewOnlyLevel()) {
          <p class="nr-strip" data-testid="files-readonly">You can view and copy this {{ app().noun }}. Changing it needs a different role.</p>
        }
        @if (notice(); as n) {
          <div class="nr-notice" [attr.role]="n.tone === 'warn' ? 'alert' : 'status'" data-testid="files-notice">
            <span>{{ n.text }}</span>
            <button type="button" class="pf-btn pf-btn--tertiary" (click)="notice.set(null)">Dismiss</button>
          </div>
        }
        <div class="nr-stage" data-testid="files-stage">
          @for (k of [session()!.key]; track k) {
            <iframe #frame class="nr-frame" [title]="app().name" data-testid="files-frame"
                    [src]="frameSrc()" allow="fullscreen; clipboard-read; clipboard-write" allowfullscreen
                    sandbox="allow-scripts allow-same-origin allow-downloads allow-popups"></iframe>
          }
          @if (bridge.state() === 'failed') {
            <div class="pf-empty nr-over" role="alert" data-testid="files-failed">
              <p class="pf-empty__title">{{ app().name }} can't open here</p>
              <p class="pf-empty__body">{{ bridge.failure() }}</p>
              <button type="button" class="pf-btn pf-btn--secondary pf-empty__action" (click)="closeFn()">Back</button>
            </div>
          } @else if (bridge.state() !== 'ready') {
            <div class="nr-over" role="status" aria-live="polite" data-testid="files-loading">
              <pf-skeleton-detail [label]="'Opening ' + app().name + '…'"></pf-skeleton-detail>
              <p class="nr-over__hint">The first time can take a moment while it downloads. After that it opens fast.</p>
            </div>
          }
          @if (insertOpen() && canInsert()) {
            <div class="nr-float"><ng-container *ngTemplateOutlet="insertCard"></ng-container></div>
          }
        </div>
      } @else if (loading()) {
        <div class="nr-over nr-over--flow" role="status"><pf-skeleton-rows [rows]="4" [avatar]="false" label="Opening…"></pf-skeleton-rows></div>
      }
    </section>

    <pf-files-share [file]="shareTarget()" (closed)="shareTarget.set(null)" />

    <ng-template #insertCard>
      <aside class="pf-card nr-side" aria-label="Insert results" data-testid="neuron-insert-card">
        <header class="pf-card__head">
          <span class="pf-card__label">Insert results</span>
          <span class="pf-card__spacer"></span>
          <button type="button" class="pf-btn pf-btn--icon" aria-label="Close" title="Close" (click)="insertOpen.set(false)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </header>
        <div class="pf-card__body nr-form">
          <p class="nr-form__lead">Opens a new sheet with the results for the tests and dates you pick. Nothing is saved until you press Save.</p>
          <div class="pf-field">
            <span class="pf-field__lbl" id="nr-tests-l">Tests</span>
            <pf-select [options]="testOptions()" [multiple]="true" [searchable]="true" [values]="pickedTests()" placeholder="Pick one or more tests"
                       aria-label="Tests" (valuesChange)="pickedTests.set($event)"></pf-select>
          </div>
          <div class="nr-dates">
            <div class="pf-field"><span class="pf-field__lbl">From</span>
              <pf-date label="From date" [value]="from()" [max]="to()" (valueChange)="from.set($event ?? '')"></pf-date></div>
            <div class="pf-field"><span class="pf-field__lbl">To</span>
              <pf-date label="To date" [value]="to()" [min]="from()" [max]="today" (valueChange)="to.set($event ?? '')"></pf-date></div>
          </div>
          @if (branchOptions().length > 1) {
            <div class="pf-field">
              <span class="pf-field__lbl">Branch</span>
              <pf-select [options]="branchOptions()" [value]="branchId()" aria-label="Branch" (valueChange)="branchId.set($event)"></pf-select>
            </div>
          }
          @if (!patientNames()) {
            <p class="nr-form__lead" data-testid="neuron-patient-note">{{ patientNote }}</p>
          }
          @if (insertProblem(); as p) {
            <p class="nr-form__err" role="alert" data-testid="neuron-insert-error">{{ p }}</p>
          }
        </div>
        <footer class="pf-card__foot">
          <button type="button" class="pf-btn pf-btn--secondary" (click)="insertOpen.set(false)">Cancel</button>
          <button type="button" class="pf-btn pf-btn--primary" data-testid="neuron-insert-go" [disabled]="inserting()" (click)="insertResults()">{{ inserting() ? 'Getting results…' : 'Insert results' }}</button>
        </footer>
      </aside>
    </ng-template>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .nr-center { display: flex; align-items: center; justify-content: center; gap: 10px; min-width: 0; flex-wrap: wrap; }
    .nr-name { max-width: min(36vw, 360px); }
    .nr-name__t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .nr-name-input { height: 34px; min-width: 200px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--border-primary, rgba(124,58,237,.4)); background: var(--surface-card, #fff); color: var(--text-primary); font: inherit; font-size: 14px; font-weight: 600; }
    .nr-name-input:focus-visible { outline: 2px solid var(--color-primary, #7c3aed); outline-offset: 1px; }
    .nr-chip { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; border-radius: 999px; font: inherit; font-size: 12px; font-weight: 600; line-height: 1; white-space: nowrap;
      color: var(--text-secondary); background: color-mix(in srgb, var(--text-primary) 7%, transparent); border: 0; }
    .nr-chip--quiet { color: var(--text-tertiary); background: color-mix(in srgb, var(--text-primary) 5%, transparent); }
    .nr-chip--phi { cursor: pointer; color: var(--text-primary); background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent); }
    .nr-chip--phi:hover { background: color-mix(in srgb, var(--color-primary, #7c3aed) 22%, transparent); }
    .nr-chip--phi:focus-visible { outline: 2px solid var(--color-primary, #7c3aed); outline-offset: 1px; }
    @media (max-width: 640px) { .nr-chip__t { max-width: 16ch; overflow: hidden; text-overflow: ellipsis; } .nr-name { max-width: 40vw; } }
    .nr-stage { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; background: var(--surface-card, #fff); border-top: 1px solid var(--border-subtle, rgba(0,0,0,.08)); }
    .nr-frame { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: var(--surface-card, #fff); }
    .nr-over { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 24px; text-align: center; background: color-mix(in srgb, var(--surface-card, #fff) 92%, transparent); }
    .nr-over--flow { position: static; min-height: 200px; background: transparent; }
    .nr-over__hint { margin: 0; max-width: 340px; font-size: 13px; line-height: 1.5; color: var(--text-tertiary); }
    .nr-float { position: absolute; top: 12px; right: 12px; bottom: 12px; width: min(400px, calc(100% - 24px)); display: flex; z-index: 3; }
    .nr-float .nr-side { flex: 1 1 auto; box-shadow: 0 12px 32px rgba(0,0,0,.18); }
    .nr-strip { margin: 0; padding: 8px 16px; font-size: 13px; color: var(--text-secondary); background: color-mix(in srgb, var(--color-primary, #7c3aed) 7%, transparent); }
    .nr-notice { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 16px; font-size: 13px; line-height: 1.45; color: var(--text-secondary); background: color-mix(in srgb, var(--color-primary, #7c3aed) 9%, transparent); }
    .nr-notice--warn { color: var(--text-primary); }
    .nr-form { display: flex; flex-direction: column; gap: 16px; }
    .nr-form__lead { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-tertiary); }
    .nr-dates { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .nr-form__err { margin: 0; font-size: 13px; color: var(--text-primary); border-left: 3px solid var(--color-danger, #dc2626); padding: 6px 10px; background: color-mix(in srgb, var(--color-danger, #dc2626) 8%, transparent); border-radius: 6px; }
    @media (max-width: 1023px) { .nr-side { margin-top: 12px; } .nr-float .nr-side { margin-top: 0; } }
  `],
})
export class FilesEditorPage {
  private readonly api = inject(ApiService);
  private readonly office = inject(OfficeService);
  private readonly saver = inject(FilesSaver);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly theme = inject(ThemeService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly files = inject(FilesAccessService);
  private readonly deviceFiles = inject(FilesDeviceService);
  private readonly engines = inject(FilesEngineService);
  private readonly sheets = inject(SheetEditorService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly bridge = inject(FilesBridge);

  protected readonly frameRef = viewChild<ElementRef<HTMLIFrameElement>>('frame');

  /** The app of this route (`/files/<kind>/…`); an unknown kind shows the "can't open" state. */
  protected readonly app = signal<FilesApp>(filesAppForRoute(this.route.snapshot.paramMap.get('kind') ?? '') ?? FILES_APPS[0]);
  protected readonly unavailable = signal<{ title: string; body: string } | null>(null);
  protected readonly loading = signal(true);
  protected readonly session = signal<Session | null>(null);
  protected readonly saving = signal(false);
  private readonly pendingStore = signal(false);
  protected readonly renaming = signal(false);
  protected readonly notice = signal<{ tone: 'info' | 'warn'; text: string } | null>(null);
  private seq = 0;
  private chain: Promise<void> = Promise.resolve();
  /** Where the NEXT save from the engine goes when a band button asked for it ('device'); otherwise where the file lives. */
  private saveDest: 'file' | 'device' = 'file';

  protected readonly phone = this.files.phone;
  protected readonly phoneCanEdit = this.files.phoneCanEdit;
  protected readonly forceReadonly = signal(false);
  /** Change or store this file: Full Files, the role, the app on, the device class AND not opened read-only. */
  protected readonly canWrite = computed(() => this.files.canWrite(this.app()) && !this.forceReadonly());
  protected readonly canRename = computed(() => this.canWrite() && this.session()?.target.kind === 'lab');
  /** The lab is on the default View only level (the platform has not entitled it to Full). */
  protected readonly viewOnlyLevel = this.files.viewOnly;
  protected readonly access = computed(() => neuronAccess(codes => this.auth.hasAnyPermission(codes)));
  protected readonly canInsert = computed(() => this.app().id === 'neuron' && this.canWrite() && this.access().insert);
  protected readonly patientNames = computed(() => this.files.access()?.patientNames ?? this.access().patientNames);
  protected readonly patientNote = PATIENT_HIDDEN_NOTE;
  protected readonly ready = computed(() => this.bridge.state() === 'ready');
  protected readonly hasPhi = computed(() => { const s = this.session(); return !!s && (s.phi.length > 0 || !!s.pendingPhi); });
  protected readonly where = computed(() => {
    const s = this.session();
    return s?.target.kind === 'device' ? 'On this device' : (this.auth.user()?.tenantName || 'Prefrontal');
  });

  /** Share is for a file that is stored in the lab (a device file or an unsaved one has nobody to share with yet). */
  protected readonly shareable = computed(() => { const s = this.session(); return !!s && s.target.kind === 'lab' && !!s.file.id; });
  protected readonly shareTarget = signal<OfficeFile | null>(null);
  protected openShare(): void {
    const s = this.session();
    if (!s || !s.file.id) return;
    this.shareTarget.set({ id: s.file.id, name: s.file.name, kind: this.app().kind, sizeBytes: 0, version: s.file.version ?? 1, updatedAt: '', updatedByName: null, containsPhi: s.phi.length > 0 });
  }
  protected readonly unsaved = computed(() => {
    const s = this.session();
    return !!s && this.canWrite() && (this.bridge.dirty() || this.pendingStore() || (s.file.id === null && s.fromResults));
  });
  protected readonly saveState = computed<'Saved' | 'Unsaved changes' | 'Saving…' | 'Not saved yet'>(() => {
    const s = this.session();
    if (this.saving()) return 'Saving…';
    if (this.unsaved()) return 'Unsaved changes';
    return s && s.file.id === null && s.target.kind === 'lab' ? 'Not saved yet' : 'Saved';
  });
  private readonly sessionKey = computed(() => this.session()?.key ?? 0);
  protected readonly frameSrc = computed<SafeResourceUrl>(() => {
    this.sessionKey();
    return untracked(() => this.sanitizer.bypassSecurityTrustResourceUrl(
      filesFrameUrl(this.app(), document.baseURI, this.auth.user()?.displayName ?? '', this.theme.mode(), !this.canWrite())));
  });

  // ── insert results (Neuron) ──
  protected readonly today = labToday();
  protected readonly insertOpen = signal(false);
  protected readonly inserting = signal(false);
  protected readonly insertProblem = signal<string | null>(null);
  protected readonly tests = signal<{ id: string; name: string }[]>([]);
  protected readonly testOptions = computed<PfSelectOption<string>[]>(() => this.tests().map(t => ({ value: t.id, label: t.name })));
  protected readonly pickedTests = signal<string[]>([]);
  protected readonly from = signal(labDaysAgo(6));
  protected readonly to = signal(labToday());
  protected readonly branchId = signal<string>(this.auth.activeBranchId() ?? this.auth.user()?.branches?.[0]?.id ?? '');
  protected readonly branchOptions = computed<PfSelectOption<string>[]>(() =>
    (this.auth.user()?.branches ?? []).map(b => ({ value: b.id, label: b.name })));

  readonly closeFn = (): void => { void this.close(); };

  constructor() {
    inject(DestroyRef).onDestroy(() => this.bridge.destroy());
    this.bridge.configure(this.app());
    this.bridge.onSave = f => { this.chain = this.chain.then(() => this.handleSaved(f)); };
    this.bridge.onRequest = r => { void (r === 'open' ? this.openFromDevice() : this.saveToDevice(true)); };
    effect(() => { this.bridge.attach(this.frameRef()?.nativeElement ?? null); });
    effect(() => { const mode = this.theme.mode(); if (this.bridge.state() === 'ready') untracked(() => this.bridge.setTheme(mode)); });
    void this.init();
    if (this.app().id === 'neuron') {
      this.api.get<{ id: string; name: string }[]>('/api/tests?view=summary&activeOnly=true')
        .subscribe({ next: t => this.tests.set((t ?? []).map(x => ({ id: x.id, name: x.name }))), error: () => undefined });
    }
  }

  // ───────────────────────── opening ─────────────────────────
  private async init(): Promise<void> {
    const app = this.app();
    await this.files.ensureLoaded();
    this.loading.set(false);
    if (!this.files.available() || !this.files.canRead(app)) {
      this.unavailable.set({ title: `${app.name} isn't available to you`, body: `Your role or your organization's settings don't include ${app.name}. Ask your admin if you need it.` });
      return;
    }
    const id = this.route.snapshot.paramMap.get('id') ?? 'new';
    if (id !== 'new') { await this.openStored(id, this.sheets.take()); return; }
    const req = this.sheets.take();
    if (!req) {
      if (!this.canWrite()) { await this.router.navigateByUrl('/files', { replaceUrl: true }); return; }
      this.start({ id: null, name: withAppExtension(app, app.newName), version: null }, null, false);
      return;
    }
    await this.applyRequest(req);
  }

  private async openStored(id: string, req: SheetOpenRequest | null): Promise<void> {
    this.forceReadonly.set(!!req?.readonly);
    try {
      const f = (await this.office.list(this.app().kind)).find(x => x.id === id);
      if (!f) { this.unavailable.set({ title: "That file isn't there any more", body: 'It may have been deleted or moved to Trash.' }); return; }
      const c = await this.office.content(f.id);
      if (!bytesFit(this.app(), c.bytes)) { this.unavailable.set({ title: "This file can't be opened", body: notThisKindMessage(this.app()) }); return; }
      this.start({ id: f.id, name: f.name, version: c.version || f.version }, c.bytes, false, false, { kind: 'lab', id: f.id }, f.phiSources ?? []);
    } catch (e) { this.unavailable.set({ title: "We couldn't open this file", body: toApiError(e).message }); }
  }

  private async applyRequest(r: SheetOpenRequest): Promise<void> {
    const app = this.app();
    this.forceReadonly.set(!!r.readonly);
    if (r.bytes) {
      if (!bytesFit(app, r.bytes)) { this.unavailable.set({ title: "This file can't be opened", body: notThisKindMessage(app) }); return; }
      this.start({ id: null, name: r.name ?? withAppExtension(app, app.newName), version: null, copyOf: r.copyOf ?? null }, r.bytes, !r.target && !r.copyOf, false, r.target, [], r.phi ?? null);
    } else if (r.insert) {
      const i = r.insert;
      if (i.testIds?.length) this.pickedTests.set(i.testIds);
      if (i.from) this.from.set(i.from);
      if (i.to) this.to.set(i.to);
      if (i.branchId) this.branchId.set(i.branchId);
      this.start({ id: null, name: withAppExtension(app, app.newName), version: null }, null, false);
      this.insertOpen.set(true);
      if (i.auto && i.testIds?.length) await this.insertResults();
    } else {
      this.start({ id: null, name: r.name ?? withAppExtension(app, app.newName), version: null }, null, false);
      // A built-in template: the engine builds it (file.new with the template's own parameters) once it is ready.
      if (r.template) { const t = r.template; this.bridge.whenReady(() => this.bridge.runCommand(t.cmd, t.params)); }
    }
  }

  /** Open a file from THIS device (our button, or the engine's File → Open asking through the bridge). */
  protected async openFromDevice(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    try {
      const o = await this.deviceFiles.open(this.app());
      if (!o) return;
      this.start({ id: null, name: o.name, version: null }, o.bytes, false, false, o.target, []);
    } catch (e) { this.toast.error(e instanceof Error ? e.message : 'That file could not be opened.'); }
  }

  // ───────────────────────── the open file ─────────────────────────
  private start(file: StoredRef, bytes: ArrayBuffer | null, fromResults: boolean, fitColumns = false, target?: FileTarget, phi: PhiSource[] = [], pendingPhi: string | null = null): void {
    this.pendingStore.set(false);
    this.renaming.set(false);
    this.bridge.prepareNewFrame();
    this.bridge.readonly = !this.canWrite();
    const t: FileTarget = target && !(target.kind === 'lab' && !target.id) ? target : { kind: 'lab', id: file.id ?? '' };
    this.session.set({ key: ++this.seq, file, target: t, fromResults, phi, pendingPhi });
    if (bytes) this.bridge.open(file.name, bytes, fitColumns ? [FIT_COLUMNS] : []);
    // An app whose engine is not shipped yet (Synapse, Axon, Myelin, Retina arrive one by one) shows the plain "can't open here" state.
    const key = this.seq;
    void this.engines.available(this.app()).then(ok => { if (!ok && this.seq === key) this.bridge.markUnavailable(engineMissingMessage(this.app())); });
  }

  protected async close(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.pendingStore.set(false); this.bridge.dirty.set(false);
    if (this.sheets.openedFromScreen) { this.sheets.back(); return; }
    this.sheets.clearOrigin();
    await this.router.navigateByUrl('/files');
  }

  private async confirmDiscard(): Promise<boolean> {
    if (!this.unsaved()) return true;
    return this.dialog.confirm({
      title: 'Leave without saving?', message: `This ${this.app().noun} has changes that are not saved yet.`,
      confirmLabel: 'Leave without saving', cancelLabel: 'Stay', tone: 'danger',
    });
  }
  /** Route guard (canDeactivate). */
  async canLeave(): Promise<boolean> {
    if (this.leaveApproved) return true;
    const ok = await this.confirmDiscard();
    if (ok && this.unsaved()) { this.leaveApproved = true; setTimeout(() => { this.leaveApproved = false; }, 3000); }
    return ok;
  }
  private leaveApproved = false;

  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(e: BeforeUnloadEvent): void {
    if (!this.unsaved()) return;
    e.preventDefault();
    e.returnValue = '';
  }

  /** Ctrl/Cmd+S saves instead of the browser's "save page". */
  @HostListener('window:keydown', ['$event'])
  protected onKey(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's' && this.session() && this.canWrite()) {
      e.preventDefault();
      this.saveNow();
    }
  }

  protected saveNow(): void {
    this.saveDest = 'file';
    if (!this.bridge.save()) this.toast.info(`${this.app().name} is still opening. Try again in a moment.`);
  }

  /** "Save to this device" / "Save a copy": ask the engine for its bytes, then route them to the device (after the server's patient-data check). */
  protected async saveToDevice(saveAs = false): Promise<void> {
    this.saveDest = 'device';
    this.deviceSaveAs = saveAs || !this.deviceFiles.canSaveInPlace(this.session()?.target);
    if (!this.bridge.save()) { this.saveDest = 'file'; this.toast.info(`${this.app().name} is still opening. Try again in a moment.`); }
  }
  private deviceSaveAs = true;

  protected async commitRename(value: string): Promise<void> {
    if (!this.renaming()) return;
    this.renaming.set(false);
    const s = this.session();
    const name = withAppExtension(this.app(), (value ?? '').trim());
    if (!s || !(value ?? '').trim() || name === s.file.name) return;
    if (s.file.id === null) { this.session.set({ ...s, file: { ...s.file, name } }); return; }
    try {
      const dto = await this.office.rename(s.file.id, name);
      this.session.update(cur => (cur ? { ...cur, file: { ...cur.file, name: dto.name ?? name } } : cur));
    } catch (e) { this.toast.error(toApiError(e).message); }
  }

  /** Why the file is flagged, in plain words, with who and when. */
  protected async showPhi(): Promise<void> {
    const s = this.session();
    if (!s) return;
    const lines = [...s.phi.map(phiLine), ...(s.pendingPhi ? [phiSourceWords(s.pendingPhi) + ' (not saved yet)'] : [])];
    await this.dialog.alert({
      title: 'Contains patient data',
      message: `${lines.join('\n')}\n\nThis file is kept out of outside assistants, and it can be saved to a device only by roles allowed to export patient data. Anything you type yourself is not flagged.`,
      confirmLabel: 'Got it',
    });
  }

  /** The app handed us a file. Routed by where the person asked it to go, then by where the file lives. */
  private async handleSaved(f: SavedFile): Promise<void> {
    const app = this.app();
    const s = this.session();
    if (f.kind === 'pdf') {
      downloadBytes(withExtension(s?.file.name ?? f.name, 'pdf'), f.bytes, 'application/pdf');
      this.toast.success('PDF downloaded');
      return;
    }
    if (f.kind === 'copy') {
      downloadBytes(f.name, f.bytes, mimeForName(f.name), document);
      this.toast.success(`${f.name} downloaded`);
      return;
    }
    if (!s) return;
    const dest = this.saveDest;
    this.saveDest = 'file';
    // Device: a band button asked for it, the file lives there, or this person cannot store in the lab (a copy goes to the device).
    if (dest === 'device' || s.target.kind === 'device' || !this.canWrite()) { await this.saveOnDevice(s, f, dest === 'device' ? this.deviceSaveAs : false); return; }
    this.saving.set(true);
    this.notice.update(n => (n?.tone === 'warn' ? null : n));
    try {
      const out = await this.saver.store(s.file, f, app, s.pendingPhi);
      switch (out.kind) {
        case 'saved':
        case 'copy':
          this.pendingStore.set(false);
          this.session.update(cur => (cur ? { ...cur, file: { id: out.file.id, name: out.file.name, version: out.file.version }, target: { kind: 'lab', id: out.file.id }, fromResults: false, phi: out.file.phiSources ?? cur.phi, pendingPhi: null } : cur));
          this.toast.success(out.kind === 'copy' ? `Saved as a copy: ${out.file.name}` : 'Saved');
          break;
        case 'reload':
          await this.reloadTheirs(out.file);
          break;
        case 'kept':
          this.pendingStore.set(true);
          this.notice.set({ tone: 'warn', text: 'Your changes are not saved. Press Save to try again.' });
          break;
        case 'failed':
          this.pendingStore.set(true);
          this.notice.set({ tone: 'warn', text: `We couldn't save this ${app.noun}: ${out.message} Your changes are still here. Press Save to try again.` });
          break;
      }
    } finally { this.saving.set(false); }
  }

  /** Bytes to THIS device. A lab file asks the server first (a flagged file may leave only for roles allowed to export patient data): refused = nothing is written. */
  private async saveOnDevice(s: Session, f: SavedFile, saveAs: boolean): Promise<void> {
    const app = this.app();
    try {
      if (s.target.kind === 'lab' && s.file.id) await this.office.deviceExport(s.file.id, this.deviceFiles.client());
      else if (s.target.kind === 'lab' && (s.phi.length || s.pendingPhi) && !this.auth.hasAnyPermission(['export_patient_data'])) {
        this.toast.error("This file contains patient data, and your role can't save it to this device.");
        return;
      }
      const name = withAppExtension(app, s.file.name || f.name);
      const out = await this.deviceFiles.save(app, name, f.bytes, s.target, saveAs);
      if (!out) return;
      if (s.target.kind === 'device') this.session.update(cur => (cur ? { ...cur, target: out.target, file: { ...cur.file, name: out.name } } : cur));
      this.bridge.dirty.set(false);
      this.toast.success(out.inPlace ? `Saved to ${out.name}` : `${out.name} saved to this device`);
    } catch (e) {
      this.toast.error(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'That file could not be saved to this device.');
    }
  }

  private async reloadTheirs(file: StoredRef): Promise<void> {
    if (!file.id) return;
    try {
      const c = await this.office.content(file.id);
      if (!bytesFit(this.app(), c.bytes)) { this.notice.set({ tone: 'warn', text: notThisKindMessage(this.app()) }); this.pendingStore.set(true); return; }
      this.start({ id: file.id, name: file.name, version: c.version }, c.bytes, false, false, { kind: 'lab', id: file.id }, this.session()?.phi ?? []);
      this.toast.info('Showing their version');
    } catch (e) {
      this.pendingStore.set(true);
      this.notice.set({ tone: 'warn', text: `We couldn't load their version: ${toApiError(e).message}` });
    }
  }

  // ───────────────────────── insert results (Neuron) ─────────────────────────
  protected toggleInsert(): void {
    this.insertOpen.update(v => !v);
    this.insertProblem.set(null);
  }

  protected async insertResults(): Promise<void> {
    const range = { testIds: this.pickedTests(), from: this.from(), to: this.to(), branchId: this.branchOptions().length > 1 ? this.branchId() : null };
    const bad = resultsProblem(range);
    this.insertProblem.set(bad);
    if (bad) return;
    if (!(await this.confirmDiscard())) return;
    this.inserting.set(true);
    try {
      const r = await this.office.resultsWorkbook(range);
      if (!bytesFit(this.app(), r.bytes)) { this.insertProblem.set(BROKEN_RESULTS_MESSAGE); return; }
      const name = resultsFileName(r.fileName, range);
      // Prefrontal's own code filled this sheet with lab results: it will be flagged as holding patient data when it is first saved.
      this.start({ id: null, name, version: null }, r.bytes, true, true, undefined, [], 'results');
      this.insertOpen.set(false);
      const rows = r.rowCount !== null ? `${r.rowCount.toLocaleString('en-IN')} ${r.rowCount === 1 ? 'row' : 'rows'} inserted. ` : '';
      this.notice.set(r.truncated ? { tone: 'warn', text: TRUNCATED_NOTICE }
        : { tone: 'info', text: `${rows}${this.canWrite() ? 'Press Save to keep this sheet.' : 'You can save a copy from here.'}` });
    } catch (e) {
      this.insertProblem.set(e instanceof ApiError ? e.message : toApiError(e).message);
    } finally { this.inserting.set(false); }
  }
}

