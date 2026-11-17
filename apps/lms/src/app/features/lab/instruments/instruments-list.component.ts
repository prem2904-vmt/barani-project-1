import { ChangeDetectionStrategy, Component, computed, inject, signal, TemplateRef, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { SegmentedComponent } from '../../../shared/primitives/segmented.component';
import { ANALYZER_PAGES } from '../../../shared/settings-grid/page-switch';
import { SG_ICON, SG_NARROW_MQ, sgActions, sgActionsCol, sgMedia, sgBare } from '../../../shared/settings-grid/settings-grid';
import { AllCommunityModule, CellClickedEvent, ColDef, GetRowIdParams, ModuleRegistry } from 'ag-grid-community';
import { AgGridAngular } from 'ag-grid-angular';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SkeletonTableComponent } from '../../../shared/primitives/skeleton-kit.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { gridThemeDark, gridThemeLight } from '../../admin/tests/tests/grid-theme';
import { bandFilter } from '../../../shared/utils/band-search';
import { plural } from '../../../shared/utils/plural';
import { spinDelay } from '../../../shared/utils/busy';
import { InstrumentsApiService } from '../../../shared/instruments/instruments-api.service';
import { InstrumentDto } from '../../../shared/instruments/instrument.models';
import { InstrumentBridgeService } from '../../../shared/instruments/instrument-bridge.service';
import { STATUS_ORDER, connectionSummary, protocolLabel, statusSubline, statusWord } from '../../../shared/instruments/instrument-config';
import { AssistantButtonComponent } from '../../../shared/assistant/assistant-button.component';
import { AssistantPanelComponent } from '../../../shared/assistant/assistant-panel.component';
import { AssistantPageContext, MAP_PREFILL_STATE_KEY, MappingPrefill } from '../../../shared/assistant/assistant.models';
import { SupportSessionCardComponent } from './support-session-card.component';

ModuleRegistry.registerModules([AllCommunityModule]);

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));

/** Band search over the instruments (name, make, model, serial, connection). */
export function searchInstruments(rows: readonly InstrumentDto[], q: string): InstrumentDto[] {
  return bandFilter(rows, q, (i) => [i.name, i.make, i.model, i.serialNumber, connectionSummary(i.config, i.transport)]);
}

/**
 * Lab settings → Instruments: the lab's analyzers. Test Master's frame — band
 * (search pill, Analyzers | Bridges switch, Refresh, ONE primary "Add
 * instrument"), the Connect side card on the LEFT, the instruments grid
 * (Test Master theme) as the main card. A row opens the instrument.
 */
@Component({
  selector: 'pf-instruments-list',
  standalone: true,
  imports: [AgGridAngular, RouterLink, NgTemplateOutlet, SegmentedComponent, HeroBandComponent, ScreenHeaderComponent, SkeletonTableComponent, BusyDirective, AssistantButtonComponent, AssistantPanelComponent, SupportSessionCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../../shared/settings-grid/settings-grid.scss'],
  template: `
    <section class="pf-inl pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Test Master frame: search in the band pill, Analyzers | Bridges
             switch in band-tools, Refresh + ONE primary (Add instrument). -->
        <pf-hero-band [back]="true" placeholder="Search instruments — name, make, model, port…"
                      [value]="q()" (valueChange)="q.set($event)">
          <ng-container band-tools>
            @if (narrow()) {
              <button type="button" class="pf-chip pf-sg-chip press" (click)="sheetOpen.set(true)" aria-haspopup="dialog"
                      [attr.aria-expanded]="sheetOpen()" title="Connect">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 7V3M15 7V3M7 7h10v5a5 5 0 0 1-10 0V7ZM12 17v4"/></svg>
                Connect
              </button>
            }
            <pf-segmented class="pf-inl__switch" size="sm" [options]="pages" value="/admin/instruments"
                          (valueChange)="goPage($event)" aria-label="Analyzers and bridges"></pf-segmented>
          </ng-container>
          <ng-container band-actions>
            <pf-assistant-button [expanded]="assistantOpen()" (pressed)="assistantOpen.set(!assistantOpen())"></pf-assistant-button>
            <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" [disabled]="loading()" [pfBusy]="loading()" pfBusyLabel="Refreshing…"
                    (click)="load()" aria-label="Refresh" title="Refresh">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>
              <span class="pf-inl__hide-phone">Refresh</span>
            </button>
            <button type="button" class="pf-hb-btn pf-hb-btn--primary press" (click)="add()" aria-label="Add instrument" title="Add instrument">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
              Add instrument
            </button>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" eyebrow="Lab settings" title="Instruments" subtitle="Analyzers connected to the lab" parentRoute="/lab/settings">
        <button actions type="button" class="pf-btn pf-btn--secondary press" (click)="add()">Add instrument</button>
      </pf-screen-header>

      <div class="pf-band-body pf-band-body--fill">
        <div class="pf-sg-panels" [class.pf-sg-panels--narrow]="narrow()">
          <!-- SIDE card (LEFT, like Test Master's Departments). -->
          @if (narrow()) {
            @if (sheetOpen()) {
              <div class="pf-sheet-backdrop" (click)="sheetOpen.set(false)"></div>
              <aside class="pf-card pf-sg-side pf-sg-side--sheet pf-inl__side" role="dialog" aria-modal="true" aria-label="Connect"
                     (keydown.escape)="sheetOpen.set(false)">
                <span class="pf-sg-sheet-handle" aria-hidden="true"></span>
                <ng-container *ngTemplateOutlet="sideCard; context: { sheet: true }"></ng-container>
              </aside>
            }
          } @else {
            <div class="pf-sg-sidecol pf-inl__sidecol">
              <aside class="pf-card pf-sg-side pf-inl__side" aria-label="Connect">
                <ng-container *ngTemplateOutlet="sideCard; context: { sheet: false }"></ng-container>
              </aside>
              <!-- Beta 'support': renders nothing unless pf.support() + server + dev. -->
              <pf-support-session-card></pf-support-session-card>
            </div>
          }

          <section class="pf-card pf-sg-main pf-sg-main--clickable pf-inl__main" [class.pf-sg-main--bare]="bare" aria-label="Instruments">
            <header class="pf-card__head pf-sg-main__head">
              <span class="pf-card__icon" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 20h10M12 16v4M7 10h2l1.5-3 3 6 1.5-3h2"/></svg>
              </span>
              <span class="pf-card__label">Instruments</span>
              <span class="pf-card__note pf-sg-hint">Click a row to open setup and live status</span>
              <ng-container *ngTemplateOutlet="headTools"></ng-container>
            </header>
            <div class="pf-sg-main__body">
              @if (listSkeleton()) {
                <pf-skeleton-table class="pf-sg-skel" [rows]="6" [cols]="5" label="Loading instruments…"></pf-skeleton-table>
              }
              <ag-grid-angular class="pf-sg-grid pf-inl__grid" [theme]="gridTheme()" [rowData]="visibleRows()" [columnDefs]="colDefs()"
                               [defaultColDef]="defaultColDef" [getRowId]="getRowId" [animateRows]="true"
                               [suppressNoRowsOverlay]="true" [suppressCellFocus]="true" (cellClicked)="onCellClicked($event)"></ag-grid-angular>
              @if (!listSkeleton() && !loading() && visibleRows().length === 0) {
                <div class="pf-sg-empty">
                  <p class="pf-sg-empty__title">{{ q().trim() ? 'No instruments match "' + q().trim() + '"' : 'No instruments yet' }}</p>
                  <p class="pf-sg-empty__body">{{ q().trim() ? 'Try another name or port.' : 'Add your first analyzer — the CBC counter is a good start.' }}</p>
                </div>
              }
            </div>
          </section>
        </div>
      </div>
      <pf-assistant-panel [open]="assistantOpen()" [context]="assistantContext()"
                          (closed)="assistantOpen.set(false)" (addMapping)="onAssistantMapping($event)"></pf-assistant-panel>
    </section>

    <ng-template #sideCard let-sheet="sheet">
      <header class="pf-card__head">
        <span class="pf-card__icon" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7V3M15 7V3M7 7h10v5a5 5 0 0 1-10 0V7ZM12 17v4"/></svg>
        </span>
        <span class="pf-card__label">Connect</span>
        <span class="pf-card__spacer"></span>
        @if (sheet) {
          <button type="button" class="pf-btn pf-btn--icon" (click)="sheetOpen.set(false)" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        }
      </header>
      <div class="pf-card__body">
        <dl class="pf-sg-stats">
          @for (s of statusCounts(); track s.label) {
            <div class="pf-sg-stat">
              <dt><span class="pf-inl-status" [attr.data-tone]="s.tone"><span class="pf-inl-status__dot" aria-hidden="true"></span>{{ s.label }}</span></dt>
              <dd class="pf-num">{{ s.n }}</dd>
            </div>
          }
        </dl>
        @if (unmatchedTotal() > 0) {
          <a routerLink="/lab/analyzer-results" class="pf-btn pf-btn--quiet pf-inl__link">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>
            {{ plural(unmatchedTotal(), 'unmatched result') }} to attach
          </a>
        }
        <p class="pf-sg-side__lead">Results flow from the analyzer into result entry as a <strong>prefill</strong> — the technician still checks and submits every value.</p>
        <p class="pf-field__hint">Setup: basics → connection → protocol → listen to a real run → map the analyzer's codes → pair the lab PC.</p>
      </div>
      @if (canConnect) {
        <div class="pf-card__foot">
          <button type="button" class="pf-btn pf-btn--secondary pf-span press" (click)="connect()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 7V3M15 7V3M7 7h10v5a5 5 0 0 1-10 0V7ZM12 17v4"/></svg>
            Connect an analyzer
          </button>
        </div>
      }
    </ng-template>

    <!-- The grid card's head tools (count + status filter): exposed so a host can project them into its own head. -->
    <ng-template #headTools>
              <span class="pf-sg-count pf-num" aria-live="polite">{{ countLabel() }}</span>
    </ng-template>
  `,
  styles: [`
    .pf-inl { overflow-x: clip; }
    .pf-inl__switch { flex-shrink: 0; }
    .pf-inl__main ::ng-deep .pf-inl-cell { line-height: 1.3; display: flex; flex-direction: column; justify-content: center; height: 100%; padding: 6px 0; }
    .pf-inl__main ::ng-deep .pf-inl-cell__sub { font-size: 11.5px; color: var(--text-tertiary); }
    .pf-inl__main ::ng-deep .pf-inl-cell__sub--err { color: var(--red-text, #b91c1c); }
    .pf-inl__main ::ng-deep .pf-inl-cell__name { font-weight: 600; color: var(--text-primary); }
    .pf-inl-status, .pf-inl__main ::ng-deep .pf-inl-status { display: inline-flex; align-items: center; gap: 6px; font-weight: 500; white-space: nowrap;
      --pf-inl-tone: var(--text-secondary); color: color-mix(in srgb, var(--pf-inl-tone) 70%, var(--text-primary)); }
    .pf-inl-status[data-tone='green'], .pf-inl__main ::ng-deep .pf-inl-status[data-tone='green'] { --pf-inl-tone: var(--green-text, #15803d); }
    .pf-inl-status[data-tone='amber'], .pf-inl__main ::ng-deep .pf-inl-status[data-tone='amber'] { --pf-inl-tone: var(--amber-text, #b45309); }
    .pf-inl-status[data-tone='red'], .pf-inl__main ::ng-deep .pf-inl-status[data-tone='red'] { --pf-inl-tone: var(--red-text, #b91c1c); }
    .pf-inl-status__dot, .pf-inl__main ::ng-deep .pf-inl-status__dot { width: 7px; height: 7px; border-radius: 999px; background: var(--pf-inl-tone); flex: none; }
    .pf-inl__link { align-self: flex-start; text-decoration: none; }
    @media (max-width: 640px) { .pf-inl__hide-phone { display: none; } }
  `],
})
export class InstrumentsListComponent {
  /** Hosted in the Settings shell: the grid card renders BARE (ONE card, ONE head). */
  protected readonly bare = sgBare();
  /** Count + status filter, for a host that projects head tools into its own head. */
  readonly headTools = viewChild<TemplateRef<unknown>>('headTools');
  private readonly api = inject(InstrumentsApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly bridge = inject(InstrumentBridgeService);
  protected readonly theme = inject(ThemeService);
  /** The setup helper needs this PC (desktop app ≥ 1.1.1 with netdiag). */
  readonly canConnect = this.bridge.diagAvailable;
  protected readonly plural = plural;

  /** Narrow widths: the Connect side card is a sheet opened from the band. */
  readonly narrow = sgMedia(SG_NARROW_MQ);
  readonly sheetOpen = signal(false);
  readonly pages = ANALYZER_PAGES;

  readonly isPhone = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
  readonly isCoarse = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  readonly q = signal('');
  readonly rows = signal<InstrumentDto[]>([]);
  readonly loading = signal(true);
  readonly listSkeleton = spinDelay(computed(() => this.loading() && this.rows().length === 0));
  readonly visibleRows = computed(() => searchInstruments(this.rows().filter((r) => r.isActive !== false), this.q()));
  readonly countLabel = computed(() => plural(this.visibleRows().length, 'instrument'));
  readonly unmatchedTotal = computed(() => this.rows().reduce((n, r) => n + (r.unmatchedCount ?? 0), 0));
  readonly statusCounts = computed(() => {
    const live = this.rows().filter((r) => r.isActive !== false);
    // Online always shows (even 0); every other status only when it occurs.
    return STATUS_ORDER
      .map((s) => ({ status: s, ...statusWord(s), n: live.filter((r) => (r.status ?? 'never') === s).length }))
      .filter((x) => x.status === 'online' || x.n > 0);
  });

  readonly gridTheme = computed(() => (this.theme.isDark() ? gridThemeDark : gridThemeLight));
  readonly getRowId = (p: GetRowIdParams<InstrumentDto>) => p.data.id;
  readonly defaultColDef: ColDef<InstrumentDto> = { sortable: true, resizable: true, filter: false, minWidth: 110, autoHeight: true, wrapText: true };
  readonly colDefs = computed<ColDef<InstrumentDto>[]>(() => {
    const web = !this.isCoarse && !this.isPhone;
    const cell = (main: string, sub?: string, cls = '') =>
      `<div class="pf-inl-cell"><span class="${cls}">${esc(main)}</span>${sub ? `<span class="pf-inl-cell__sub">${esc(sub)}</span>` : ''}</div>`;
    const status = (d?: InstrumentDto) => {
      const st = statusWord(d?.status);
      const sub = statusSubline(d);
      const err = d?.status === 'error';
      return `<div class="pf-inl-cell"><span class="pf-inl-status" data-tone="${st.tone}"><span class="pf-inl-status__dot" aria-hidden="true"></span>${esc(st.label)}</span>${sub ? `<span class="pf-inl-cell__sub${err ? ' pf-inl-cell__sub--err' : ''}">${esc(sub)}</span>` : ''}</div>`;
    };
    const cols: ColDef<InstrumentDto>[] = [
      { colId: 'name', headerName: 'Instrument', flex: 1.3, minWidth: 180, sort: 'asc', valueGetter: (p) => p.data?.name ?? '',
        cellRenderer: (p: { data?: InstrumentDto }) => cell(p.data?.name ?? '', [p.data?.make, p.data?.model].filter(Boolean).join(' · '), 'pf-inl-cell__name') },
      { colId: 'connection', headerName: 'Connection', flex: 1.4, minWidth: 190, valueGetter: (p) => connectionSummary(p.data?.config, p.data?.transport),
        cellRenderer: (p: { data?: InstrumentDto }) => cell(connectionSummary(p.data?.config, p.data?.transport),
          [p.data?.bridgeId ? `via ${p.data.bridgeName || 'Prefrontal Bridge'}` : '', protocolLabel(p.data?.config)].filter(Boolean).join(' · ')) },
      { colId: 'status', headerName: 'Status', flex: 1.3, minWidth: 200, valueGetter: (p) => p.data?.status ?? 'never',
        cellRenderer: (p: { data?: InstrumentDto }) => status(p.data) },
      { colId: 'unmatched', headerName: 'Unmatched', width: 120, minWidth: 110, flex: 0, type: 'rightAligned',
        valueGetter: (p) => p.data?.unmatchedCount ?? 0,
        cellRenderer: (p: { data?: InstrumentDto }) => `<span class="pf-num">${esc(p.data?.unmatchedCount ?? 0)}</span>` },
      sgActionsCol<InstrumentDto>(web, [], 1, (p) => sgActions(web, [
        { label: 'Open', aria: `Open ${p.data?.name ?? 'instrument'}`, path: SG_ICON.open, icon: true, run: () => this.open(p.data) },
      ])),
    ];
    if (this.isPhone) return cols.filter((c) => c.colId !== 'connection' && c.colId !== 'unmatched');
    return cols;
  });

  constructor() { this.load(); }

  load() {
    this.loading.set(true);
    this.api.list().subscribe({
      next: (list) => { this.rows.set(Array.isArray(list) ? list : []); this.loading.set(false); },
      error: (err) => { this.loading.set(false); this.toasts.error(ApiError.from(err).message); },
    });
  }

  add() { void this.router.navigate(['/admin/instruments', 'new']); }

  connect() { void this.router.navigate(['/admin/instruments', 'connect']); }

  // ── Assistant (beta) ─────────────────────────────────────────────────
  readonly assistantOpen = signal(false);
  readonly assistantContext = computed<AssistantPageContext>(() => ({
    page: 'instruments', subject: 'All instruments',
    instruments: this.rows().filter((r) => r.isActive !== false).map((r) => ({ id: r.id, name: r.name })),
  }));

  /** "Add to mapping": open that instrument's Code mapping with the row
   *  prefilled (navigation state, never the URL) — the person saves there. */
  onAssistantMapping(p: MappingPrefill) {
    if (!p.instrumentId) return;
    void this.router.navigate(['/admin/instruments', p.instrumentId], { state: { [MAP_PREFILL_STATE_KEY]: p } });
  }

  goPage(path: string) { if (path && path !== '/admin/instruments') void this.router.navigateByUrl(path); }

  open(i: InstrumentDto | undefined) { if (i?.id) void this.router.navigate(['/admin/instruments', i.id]); }

  onCellClicked(ev: CellClickedEvent<InstrumentDto>) {
    if (ev.colDef.colId === 'actions') return;
    this.open(ev.data);
  }
}
