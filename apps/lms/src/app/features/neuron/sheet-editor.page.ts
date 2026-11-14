import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, effect, inject, signal, untracked, viewChild, ElementRef } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { AgGridAngular } from 'ag-grid-angular';
import { AllCommunityModule, ColDef, GridApi, GridReadyEvent, ICellRendererParams, ModuleRegistry } from 'ag-grid-community';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/auth/auth.service';
import { DeviceClassService } from '../../core/services/device-class.service';
import { DialogService } from '../../core/services/dialog.service';
import { ThemeService } from '../../core/services/theme.service';
import { ToastService } from '../../core/services/toast.service';
import { ApiError } from '../../shared/models/api-response.model';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { PfDateComponent } from '../../shared/components/pf-date/pf-date.component';
import { LoadingLogoComponent } from '../../shared/components/loading-logo/loading-logo.component';
import { PfSelectOption, SelectComponent } from '../../shared/primitives/select.component';
import { labDaysAgo, labToday } from '../../shared/utils/lab-clock';
import { gridThemeDark, gridThemeLight } from '../admin/tests/tests/grid-theme';
import { NeuronAccess, PATIENT_HIDDEN_NOTE, neuronAccess } from './neuron-access';
import { NeuronBridge, FIT_COLUMNS, SavedFile, XLSX_MIME, mimeForName, downloadBytes, isXlsxBytes, neuronFrameUrl, withExtension, NOT_A_SPREADSHEET_MESSAGE } from './neuron-bridge';
import { NeuronSaver, StoredRef } from './neuron-save';
import { SheetEditorService, SheetOpenRequest } from './sheet-editor.service';
import { OfficeFile, OfficeService, toApiError } from './office.service';
import { BROKEN_RESULTS_MESSAGE, TRUNCATED_NOTICE, resultsFileName, resultsProblem } from './results-query';

ModuleRegistry.registerModules([AllCommunityModule]);

interface Session { key: number; file: StoredRef; fromResults: boolean }

/**
 * The sheet editor (beta `neuron`, dev only) — NOT an app of its own: a screen opens it (SheetEditorService.open) and the back
 * chevron returns to that screen. Two views, one band:
 *   • Sheets: the saved files (AG-Grid) with Open / Rename / Delete and an empty state (More menu → Sheets).
 *   • Sheet: the engine in a same-origin iframe (neuron-bridge.ts) + an optional "Insert results" side card.
 * The band carries only the file name, the save state, Save and a More menu (Export Excel / PDF, More tools, Insert results).
 * The page owns the FILES: it sends a workbook in and receives every Save back, then stores it through /api/office
 * (neuron-save.ts: POST when new, PUT + If-Match when stored, a 409 never overwrites). PDFs are only downloaded.
 * Phones show the list and a view-only sheet; editing is for tablets and computers.
 */
/** The saved-sheets list sits in a card: in dark its grid takes the card's own surface (the shared Test Master grey read as a second,
 *  lighter panel inside the card, most visibly on a phone). */
export const NR_GRID_DARK = gridThemeDark.withParams({ backgroundColor: 'transparent', headerBackgroundColor: 'rgba(255, 255, 255, 0.05)', oddRowBackgroundColor: 'transparent' });

@Component({
  selector: 'pf-sheet-editor',
  standalone: true,
  imports: [HeroBandComponent, AgGridAngular, NgTemplateOutlet, SelectComponent, PfDateComponent, LoadingLogoComponent],
  providers: [NeuronBridge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page nr" [class.nr--sheet]="!!session()" [style.--pf-hb-bleed]="session() ? '0px' : null" data-testid="neuron-page">
      <pf-hero-band [back]="true" [backAction]="session() ? closeFn : null" [slim]="!!session()" [customSearch]="!session()" [contextBar]="!session()">
        @if (session(); as s) {
          <div band-center class="nr-center">
            @if (renaming()) {
              <input class="nr-name-input" type="text" [value]="s.file.name" maxlength="120" aria-label="File name" data-testid="neuron-name-input"
                     (keydown.enter)="commitRename($any($event.target).value)" (keydown.escape)="renaming.set(false)" (blur)="commitRename($any($event.target).value)" />
            } @else {
              <button type="button" class="pf-ctx__chip nr-name" data-testid="neuron-name" [title]="canWrite() ? 'Rename' : s.file.name" [disabled]="!canWrite()" (click)="renaming.set(true)">
                <span class="nr-name__t">{{ s.file.name }}</span>
                @if (canWrite()) {
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                }
              </button>
            }
            @if (canWrite()) {
              <span class="pf-savestate" role="status" data-testid="neuron-savestate" [attr.data-state]="saveState()">
                @if (saveState() === 'Saved') {
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                } @else if (saveState() !== 'Not saved yet') {
                  <span class="pf-savestate__dot" aria-hidden="true"></span>
                }
                {{ saveState() }}
              </span>
            }
          </div>
        }
        <ng-container band-actions>
          @if (session()) {
            @if (canInsert()) {
              <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" data-testid="neuron-insert" [attr.aria-pressed]="insertOpen()" (click)="toggleInsert()">Insert results</button>
            }
            @if (canWrite()) {
              <button type="button" class="pf-hb-btn pf-hb-btn--primary press" data-testid="neuron-save" [disabled]="!ready() || saving()" (click)="saveNow()">{{ saving() ? 'Saving…' : 'Save' }}</button>
            }
          } @else {
            @if (canInsert()) {
              <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" data-testid="neuron-insert" [attr.aria-pressed]="insertOpen()" (click)="toggleInsert()">Insert results</button>
            }
            @if (canWrite()) {
              <button type="button" class="pf-hb-btn pf-hb-btn--primary press" data-testid="neuron-new" (click)="newSheet()">New sheet</button>
            }
          }
        </ng-container>
        @if (!session()) {
          <div band-search class="pf-ctx nr-ctx"><span class="pf-ctx__primary">Sheets</span></div>
        }
      </pf-hero-band>

      @if (session()) {
        @if (!canEdit()) {
          <p class="nr-strip" data-testid="neuron-viewonly">View and copy only on this device. To edit, use a tablet or a computer.</p>
        } @else if (!canWrite()) {
          <p class="nr-strip" data-testid="neuron-readonly">You can view and copy this sheet. Saving needs a different role.</p>
        }
        @if (notice(); as n) {
          <div class="nr-notice" [class.nr-notice--warn]="n.tone === 'warn'" [attr.role]="n.tone === 'warn' ? 'alert' : 'status'" data-testid="neuron-notice">
            <span>{{ n.text }}</span>
            <button type="button" class="pf-btn pf-btn--tertiary" (click)="notice.set(null)">Dismiss</button>
          </div>
        }
        <div class="nr-stage" data-testid="neuron-stage">
          @for (k of [session()!.key]; track k) {
            <iframe #frame class="nr-frame" title="Spreadsheet" data-testid="neuron-frame"
                    [src]="frameSrc()" allow="fullscreen; clipboard-read; clipboard-write" allowfullscreen
                    sandbox="allow-scripts allow-same-origin allow-downloads allow-popups"></iframe>
          }
          @if (bridge.state() === 'failed') {
            <div class="pf-empty nr-over" role="alert" data-testid="neuron-failed">
              <span class="pf-empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg></span>
              <p class="pf-empty__title">The spreadsheet can't open here</p>
              <p class="pf-empty__body">{{ bridge.failure() }}</p>
              <button type="button" class="pf-btn pf-btn--secondary pf-empty__action" (click)="closeFn()">Back</button>
            </div>
          } @else if (bridge.state() !== 'ready') {
            <div class="nr-over" role="status" aria-live="polite" data-testid="neuron-loading">
              <pf-loading-logo size="md" [showText]="true" text="Opening the spreadsheet…"></pf-loading-logo>
              <p class="nr-over__hint">The first time can take a moment while it downloads. After that it opens fast.</p>
            </div>
          }
          @if (insertOpen() && canInsert()) {
            <div class="nr-float"><ng-container *ngTemplateOutlet="insertCard"></ng-container></div>
          }
        </div>
      } @else {
        <div class="pf-body" [class.pf-body--split]="insertOpen() && canInsert()">
          <section class="pf-card nr-main" aria-label="Saved sheets">
            <header class="pf-card__head">
              <span class="pf-card__icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/><path d="M3 10h18M3 14.5h18M9 5v14"/></svg>
              </span>
              <span class="pf-card__label">Saved sheets</span>
            </header>
            @if (notice(); as n) {
              <div class="nr-notice" [attr.role]="n.tone === 'warn' ? 'alert' : 'status'" data-testid="neuron-notice">
                <span>{{ n.text }}</span>
                <button type="button" class="pf-btn pf-btn--tertiary" (click)="notice.set(null)">Dismiss</button>
              </div>
            }
            <div class="pf-card__body nr-files" data-testid="neuron-files">
              @if (filesLoading()) {
                <div class="nr-over nr-over--flow" role="status"><pf-loading-logo size="sm" [showText]="true" text="Loading your sheets…"></pf-loading-logo></div>
              } @else if (filesError()) {
                <div class="pf-empty" role="alert" data-testid="neuron-files-error">
                  <p class="pf-empty__title">We couldn't load your sheets</p>
                  <p class="pf-empty__body">{{ filesError() }}</p>
                  <button type="button" class="pf-btn pf-btn--secondary pf-empty__action" (click)="loadFiles()">Try again</button>
                </div>
              } @else if (!files().length) {
                <div class="pf-empty" data-testid="neuron-empty">
                  <span class="pf-empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/><path d="M3 10h18M3 14.5h18M9 5v14"/></svg></span>
                  <p class="pf-empty__title">No spreadsheets yet</p>
                  <p class="pf-empty__body">{{ canWrite() ? 'Start a blank sheet, or pull in lab results for the dates and tests you pick.' : canInsert() ? 'Pull in lab results for the dates and tests you pick.' : 'Sheets made on a tablet or a computer will show up here.' }}</p>
                  @if (canWrite()) {
                    <button type="button" class="pf-btn pf-btn--secondary pf-empty__action" (click)="newSheet()">New sheet</button>
                  }
                </div>
              } @else {
                <ag-grid-angular class="nr-grid" [theme]="gridTheme()" [rowData]="files()" [columnDefs]="colDefs()" [defaultColDef]="defaultColDef"
                                 [domLayout]="'normal'" [suppressCellFocus]="true" [getRowId]="rowId" (gridReady)="onGridReady($event)" (rowClicked)="onRowClicked($event.data)"></ag-grid-angular>
              }
            </div>
          </section>
          @if (insertOpen() && canInsert()) {
            <ng-container *ngTemplateOutlet="insertCard"></ng-container>
          }
        </div>
      }
    </section>

    <ng-template #insertCard>
      <aside class="pf-card nr-side" aria-label="Insert results" data-testid="neuron-insert-card">
        <header class="pf-card__head">
          <span class="pf-card__icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg></span>
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
          @if (!access().patientNames) {
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
    .nr-center { display: flex; align-items: center; justify-content: center; gap: 12px; min-width: 0; }
    .nr-name { max-width: min(44vw, 420px); }
    .nr-name__t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .nr-name-input { height: 34px; min-width: 200px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--border-primary, rgba(124,58,237,.4)); background: var(--surface-card, #fff); color: var(--text-primary); font: inherit; font-size: 14px; font-weight: 600; }
    .nr-name-input:focus-visible { outline: 2px solid var(--color-primary, #7c3aed); outline-offset: 1px; }
    .nr-main { min-height: 0; flex: 1 1 auto; }
    /* The sheet fills the space between the band and the bottom nav: no card, no padding. */
    .nr-stage { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; background: var(--surface-card, #fff); border-top: 1px solid var(--border-subtle, rgba(0,0,0,.08)); }
    .nr-frame { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: var(--surface-card, #fff); }
    .nr-over { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 24px; text-align: center; background: color-mix(in srgb, var(--surface-card, #fff) 92%, transparent); }
    .nr-over--flow { position: static; min-height: 200px; background: transparent; }
    .nr-over__hint { margin: 0; max-width: 340px; font-size: 13px; line-height: 1.5; color: var(--text-tertiary); }
    .nr-float { position: absolute; top: 12px; right: 12px; bottom: 12px; width: min(400px, calc(100% - 24px)); display: flex; z-index: 3; }
    .nr-float .nr-side { flex: 1 1 auto; box-shadow: 0 12px 32px rgba(0,0,0,.18); }
    .nr-strip { margin: 0; padding: 8px 16px; font-size: 13px; color: var(--text-secondary); background: color-mix(in srgb, var(--color-primary, #7c3aed) 7%, transparent); }
    .nr-files { padding: 0; display: flex; flex-direction: column; min-height: 0; }
    .nr-grid { width: 100%; flex: 1 1 auto; min-height: 280px; }
    .nr-notice { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 16px; font-size: 13px; line-height: 1.45; color: var(--text-secondary); background: color-mix(in srgb, var(--color-primary, #7c3aed) 9%, transparent); border-bottom: 1px solid var(--border-subtle, rgba(0,0,0,.08)); }
    .nr-notice--warn { color: var(--text-primary); }
    .nr-form { display: flex; flex-direction: column; gap: 16px; }
    .nr-form__lead { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-tertiary); }
    .nr-dates { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .nr-form__err { margin: 0; font-size: 13px; color: var(--text-primary); border-left: 3px solid var(--color-danger, #dc2626); padding: 6px 10px; background: color-mix(in srgb, var(--color-danger, #dc2626) 8%, transparent); border-radius: 6px; }
    @media (max-width: 1023px) { .nr-side { margin-top: 12px; } .nr-float .nr-side { margin-top: 0; } }
  `],
})
export class SheetEditorPage {
  private readonly api = inject(ApiService);
  private readonly office = inject(OfficeService);
  private readonly saver = inject(NeuronSaver);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly theme = inject(ThemeService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly device = inject(DeviceClassService);
  private readonly sheets = inject(SheetEditorService);
  protected readonly bridge = inject(NeuronBridge);

  protected readonly frameRef = viewChild<ElementRef<HTMLIFrameElement>>('frame');

  // ── files ──
  protected readonly files = signal<OfficeFile[]>([]);
  protected readonly filesLoading = signal(true);
  protected readonly filesError = signal<string | null>(null);

  // ── the open sheet ──
  protected readonly session = signal<Session | null>(null);
  protected readonly saving = signal(false);
  /** A save reached us but was not stored (error, or an unresolved conflict): still unsaved. */
  private readonly pendingStore = signal(false);
  protected readonly renaming = signal(false);
  protected readonly notice = signal<{ tone: 'info' | 'warn'; text: string } | null>(null);
  private seq = 0;
  private chain: Promise<void> = Promise.resolve();

  /** What this person's role allows (the server enforces the same sets). */
  protected readonly access = computed<NeuronAccess>(() => neuronAccess(codes => this.auth.hasAnyPermission(codes)));
  /** Phones are for browsing; editing is for tablets and computers. */
  protected readonly canEdit = computed(() => this.device.deviceClass() !== 'phone');
  /** Change or store a sheet: tablet / computer AND a role that may save. */
  protected readonly forceReadonly = signal(false);
  protected readonly canWrite = computed(() => this.canEdit() && this.access().write && !this.forceReadonly());
  /** Insert results: tablet / computer AND a role that may read results. */
  protected readonly canInsert = computed(() => this.canEdit() && this.access().insert);
  protected readonly patientNote = PATIENT_HIDDEN_NOTE;
  protected readonly ready = computed(() => this.bridge.state() === 'ready');
  /** Something would be lost by leaving. */
  protected readonly unsaved = computed(() => {
    const s = this.session();
    // A read-only role has nothing to store, so nothing to lose by leaving.
    return !!s && this.canWrite() && (this.bridge.dirty() || this.pendingStore() || (s.file.id === null && s.fromResults));
  });
  protected readonly saveState = computed<'Saved' | 'Unsaved changes' | 'Saving…' | 'Not saved yet'>(() => {
    const s = this.session();
    if (this.saving()) return 'Saving…';
    if (this.unsaved()) return 'Unsaved changes';
    return s && s.file.id === null ? 'Not saved yet' : 'Saved';
  });
  /** Only a NEW session (a new file / reload) reads a new URL. Renaming, the theme and role changes must never reload the engine
   *  (it would drop the unsaved sheet): they reach it as messages instead. */
  private readonly sessionKey = computed(() => this.session()?.key ?? 0);
  protected readonly frameSrc = computed<SafeResourceUrl>(() => {
    this.sessionKey();
    return untracked(() => this.sanitizer.bypassSecurityTrustResourceUrl(
      neuronFrameUrl(document.baseURI, this.auth.user()?.displayName ?? '', this.theme.mode(), !this.canWrite())));
  });


  // ── insert results ──
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

  // ── grid ──
  private gridApi: GridApi<OfficeFile> | null = null;
  protected readonly gridTheme = computed(() => (this.theme.isDark() ? NR_GRID_DARK : gridThemeLight));
  protected readonly defaultColDef: ColDef = { sortable: true, resizable: true, suppressMovable: true };
  protected readonly rowId = (p: { data: OfficeFile }): string => p.data.id;
  protected readonly colDefs = computed<ColDef<OfficeFile>[]>(() => {
    const phone = !this.canEdit();
    const writer = this.canWrite();
    const cols: ColDef<OfficeFile>[] = [
      { field: 'name', headerName: 'Name', flex: 2, minWidth: 160, cellClass: 'nr-cell-name' },
      { field: 'updatedAt', headerName: 'Last saved', flex: 1, minWidth: 150, hide: phone, valueFormatter: p => formatWhen(p.value) },
      { field: 'updatedByName', headerName: 'Saved by', flex: 1, minWidth: 130, hide: phone, valueFormatter: p => p.value || '' },
      { field: 'sizeBytes', headerName: 'Size', width: 100, hide: phone, type: 'numericColumn', valueFormatter: p => formatSize(p.value) },
      { colId: 'actions', headerName: '', sortable: false, resizable: false, width: phone ? 96 : writer ? 250 : 110, pinned: 'right', cellRenderer: this.actionsRenderer },
    ];
    return cols;
  });

  private readonly actionsRenderer = (p: ICellRendererParams<OfficeFile>): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:4px;align-items:center;height:100%';
    const mk = (label: string, fn: (f: OfficeFile) => void, danger = false): void => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = danger ? 'pf-btn pf-btn--tertiary' : 'pf-btn pf-btn--tertiary';
      b.style.padding = '4px 10px';
      b.textContent = label;
      b.setAttribute('data-act', label.toLowerCase());
      b.addEventListener('click', ev => { ev.stopPropagation(); if (p.data) fn(p.data); });
      wrap.appendChild(b);
    };
    mk('Open', f => void this.openStored(f));
    if (this.canWrite()) { mk('Rename', f => void this.renameStored(f)); mk('Delete', f => void this.deleteStored(f), true); }
    return wrap;
  };

  /** Back chevron / Close: asks first when something would be lost. */
  readonly closeFn = (): void => { void this.close(); };

  constructor() {
    inject(DestroyRef).onDestroy(() => this.bridge.destroy());
    this.bridge.onSave = f => { this.chain = this.chain.then(() => this.handleSaved(f)); };
    effect(() => { this.bridge.attach(this.frameRef()?.nativeElement ?? null); });
    // The sheet follows the LMS light / dark toggle (sent when ready and on every change).
    effect(() => { const mode = this.theme.mode(); if (this.bridge.state() === 'ready') untracked(() => this.bridge.setTheme(mode)); });
    void this.loadFiles().then(() => this.applyRequest(this.sheets.take()));
    this.api.get<{ id: string; name: string }[]>('/api/tests?view=summary&activeOnly=true')
      .subscribe({ next: t => this.tests.set((t ?? []).map(x => ({ id: x.id, name: x.name }))), error: () => undefined });
  }

  /** What the opening screen asked for (a stored sheet, bytes it built, results to insert, or a blank sheet). */
  private async applyRequest(r: SheetOpenRequest | null): Promise<void> {
    if (!r) return;
    this.forceReadonly.set(!!r.readonly);
    if (r.fileId) {
      const f = this.files().find(x => x.id === r.fileId);
      if (f) await this.openStored(f);
      else this.toast.error("That sheet isn't in your saved sheets any more.");
    } else if (r.bytes) {
      if (!isXlsxBytes(r.bytes)) { this.toast.error(NOT_A_SPREADSHEET_MESSAGE); return; }
      this.start({ id: null, name: r.name ?? 'Sheet.xlsx', version: null }, r.bytes, true);
    } else if (r.insert) {
      const i = r.insert;
      if (i.testIds?.length) this.pickedTests.set(i.testIds);
      if (i.from) this.from.set(i.from);
      if (i.to) this.to.set(i.to);
      if (i.branchId) this.branchId.set(i.branchId);
      this.insertOpen.set(true);
      if (i.auto && i.testIds?.length) await this.insertResults();
    } else if (this.canWrite()) {
      this.start({ id: null, name: r.name ?? 'Untitled sheet.xlsx', version: null }, null, false);
    }
  }

  // ───────────────────────── files view ─────────────────────────
  async loadFiles(): Promise<void> {
    this.filesLoading.set(true);
    this.filesError.set(null);
    try { this.files.set(await this.office.list('sheet')); }
    catch (e) { this.filesError.set(toApiError(e).message); }
    finally { this.filesLoading.set(false); }
  }

  protected onGridReady(e: GridReadyEvent<OfficeFile>): void { this.gridApi = e.api; this.gridApi.sizeColumnsToFit?.(); }
  protected onRowClicked(f: OfficeFile | undefined): void { if (f) void this.openStored(f); }

  protected async openStored(f: OfficeFile): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    try {
      const c = await this.office.content(f.id);
      if (!isXlsxBytes(c.bytes)) { this.toast.error(NOT_A_SPREADSHEET_MESSAGE); return; }
      this.start({ id: f.id, name: f.name, version: c.version || f.version }, c.bytes, false);
    } catch (e) { this.toast.error(toApiError(e).message); }
  }

  protected async renameStored(f: OfficeFile): Promise<void> {
    const name = await this.dialog.prompt({ title: 'Rename file', initialValue: f.name, confirmLabel: 'Rename', required: true });
    const next = (name ?? '').trim();
    if (!next || next === f.name) return;
    try {
      const dto = await this.office.rename(f.id, next);
      this.files.update(list => list.map(x => (x.id === f.id ? { ...x, ...dto } : x)));
    } catch (e) { this.toast.error(toApiError(e).message); }
  }

  protected async deleteStored(f: OfficeFile): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Delete this file?', tone: 'danger', confirmLabel: 'Delete', cancelLabel: 'Keep it',
      message: `"${f.name}" will be removed from your files.`,
    });
    if (!ok) return;
    try { await this.office.remove(f.id); this.files.update(list => list.filter(x => x.id !== f.id)); }
    catch (e) { this.toast.error(toApiError(e).message); }
  }

  // ───────────────────────── the open sheet ─────────────────────────
  private start(file: StoredRef, bytes: ArrayBuffer | null, fromResults: boolean, fitColumns = false): void {
    this.pendingStore.set(false);
    this.renaming.set(false);
    this.bridge.prepareNewFrame();
    this.bridge.readonly = !this.canWrite();
    this.session.set({ key: ++this.seq, file, fromResults });
    if (bytes) this.bridge.open(file.name, bytes, fitColumns ? [FIT_COLUMNS] : []);
  }

  protected async newSheet(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.notice.set(null);
    this.start({ id: null, name: 'Untitled sheet.xlsx', version: null }, null, false);
  }

  /** Back chevron: to the screen that opened the editor, or (from the Sheets list) back to the list. */
  protected async close(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    if (this.sheets.openedFromScreen) { this.pendingStore.set(false); this.bridge.dirty.set(false); this.sheets.back(); return; }
    await this.showList(true);
  }

  protected async showList(skipConfirm = false): Promise<void> {
    if (!skipConfirm && !(await this.confirmDiscard())) return;
    this.sheets.clearOrigin();
    this.session.set(null);
    this.notice.set(null);
    this.pendingStore.set(false);
    void this.loadFiles();
  }

  /** True when there is nothing to lose or the person chose to leave anyway. */
  private async confirmDiscard(): Promise<boolean> {
    if (!this.unsaved()) return true;
    return this.dialog.confirm({
      title: 'Leave without saving?', message: 'This sheet has changes that are not saved yet.',
      confirmLabel: 'Leave without saving', cancelLabel: 'Stay', tone: 'danger',
    });
  }
  /** Route guard (canDeactivate). */
  async canLeave(): Promise<boolean> {
    // A redirect (the lab logo goes Home, the landing guard sends it on) re-runs this guard for the SAME leave: ask once.
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

  /** Ctrl/Cmd+S saves the sheet instead of the browser's "save page". */
  @HostListener('window:keydown', ['$event'])
  protected onKey(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's' && this.session() && this.canWrite()) {
      e.preventDefault();
      this.saveNow();
    }
  }

  protected saveNow(): void {
    if (!this.bridge.save()) this.toast.info('The spreadsheet is still opening. Try again in a moment.');
  }

  protected async commitRename(value: string): Promise<void> {
    if (!this.renaming()) return;
    this.renaming.set(false);
    const s = this.session();
    let name = (value ?? '').trim();
    if (!s || !name || name === s.file.name) return;
    if (!/\.xlsx$/i.test(name)) name += '.xlsx';
    if (s.file.id === null) { this.session.set({ ...s, file: { ...s.file, name } }); return; }
    try {
      const dto = await this.office.rename(s.file.id, name);
      this.session.update(cur => (cur ? { ...cur, file: { ...cur.file, name: dto.name ?? name } } : cur));
    } catch (e) { this.toast.error(toApiError(e).message); }
  }

  /** The app handed us a file. PDF = a download; xlsx = store it (POST new / PUT with If-Match). */
  private async handleSaved(f: SavedFile): Promise<void> {
    if (f.kind === 'pdf') {
      downloadBytes(withExtension(this.session()?.file.name ?? f.name, 'pdf'), f.bytes, 'application/pdf');
      this.toast.success('PDF downloaded');
      return;
    }
    if (f.kind === 'copy') {
      downloadBytes(f.name, f.bytes, mimeForName(f.name));
      this.toast.success(`${f.name} downloaded`);
      return;
    }
    const s = this.session();
    if (!s) return;
    // A role that cannot save has nothing to store: whatever the app's File tab produced is just downloaded.
    if (!this.canWrite()) { downloadBytes(withExtension(s.file.name, 'xlsx'), f.bytes, XLSX_MIME); return; }
    this.saving.set(true);
    this.notice.update(n => (n?.tone === 'warn' ? null : n));
    try {
      const out = await this.saver.store(s.file, f);
      switch (out.kind) {
        case 'saved':
        case 'copy':
          this.pendingStore.set(false);
          this.session.update(cur => (cur ? { ...cur, file: { id: out.file.id, name: out.file.name, version: out.file.version }, fromResults: false } : cur));
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
          this.notice.set({ tone: 'warn', text: `We couldn't save this sheet: ${out.message} Your changes are still in the sheet. Press Save to try again.` });
          break;
      }
    } finally { this.saving.set(false); }
  }

  private async reloadTheirs(file: StoredRef): Promise<void> {
    if (!file.id) return;
    try {
      const c = await this.office.content(file.id);
      if (!isXlsxBytes(c.bytes)) { this.notice.set({ tone: 'warn', text: NOT_A_SPREADSHEET_MESSAGE }); this.pendingStore.set(true); return; }
      this.start({ id: file.id, name: file.name, version: c.version }, c.bytes, false);
      this.toast.info('Showing their version');
    } catch (e) {
      this.pendingStore.set(true);
      this.notice.set({ tone: 'warn', text: `We couldn't load their version: ${toApiError(e).message}` });
    }
  }

  // ───────────────────────── insert results ─────────────────────────
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
      if (!isXlsxBytes(r.bytes)) { this.insertProblem.set(BROKEN_RESULTS_MESSAGE); return; }
      const name = resultsFileName(r.fileName, range);
      this.start({ id: null, name, version: null }, r.bytes, true, true);   // the server's workbook: columns fitted to their text
      this.insertOpen.set(false);
      const rows = r.rowCount !== null ? `${r.rowCount.toLocaleString('en-IN')} ${r.rowCount === 1 ? 'row' : 'rows'} inserted. ` : '';
      this.notice.set(r.truncated ? { tone: 'warn', text: TRUNCATED_NOTICE }
        : { tone: 'info', text: `${rows}${this.canWrite() ? 'Press Save to keep this sheet.' : 'You can export it from here.'}` });
    } catch (e) {
      this.insertProblem.set(e instanceof ApiError ? e.message : toApiError(e).message);
    } finally { this.inserting.set(false); }
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
