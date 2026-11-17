import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal, TemplateRef, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { AllCommunityModule, CellClickedEvent, ColDef, GetRowIdParams, ModuleRegistry } from 'ag-grid-community';
import { DataGridComponent } from '../../../shared/components/data-grid/data-grid.component';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { WorkEventsService } from '../../../core/services/work-events.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SkeletonRowsComponent, SkeletonTableComponent } from '../../../shared/primitives/skeleton-kit.component';
import { SettingsSiblingsComponent } from '../settings/settings-siblings.component';
import { SG_ICON, SG_NARROW_MQ, SG_PHONE_MQ, sgActions, sgActionsCol, sgCell, sgGridTheme, sgMedia, sgStatusWord, sgBare } from '../../../shared/settings-grid/settings-grid';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { bandFilter } from '../../../shared/utils/band-search';
import { plural } from '../../../shared/utils/plural';
import { spinDelay } from '../../../shared/utils/busy';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { BridgesApiService } from '../../../shared/bridges/bridges-api.service';
import { BridgeNearbyService } from '../../../shared/bridges/bridge-nearby.service';
import type { BridgeDto } from '../../../shared/bridges/bridge.models';
import { agoText, bridgeStatusWord, versionText, wifiSummary } from '../../../shared/bridges/bridge-status';

ModuleRegistry.registerModules([AllCommunityModule]);

/** Band search over the Bridges (name, serial, branch, Wi-Fi, analyzers). */
export function searchBridges(rows: readonly BridgeDto[], q: string): BridgeDto[] {
  return bandFilter(rows, q, (b) => [b.name, b.serialShort, b.serial, b.branchName, b.network?.ssid, ...(b.analyzers ?? []).map((a) => a.name)]);
}

/** Status order for the side card counts and the default sort. */
const STATUS_ORDER = ['online', 'offline', 'error', 'pending', 'never'] as const;

/**
 * Lab settings → Bridges: the lab's Prefrontal Bridges (zero-touch analyzer
 * boxes). Test Master's frame — band (search pill, Analyzers | Bridges switch,
 * Refresh, ONE primary "Add Bridge"), an Overview side card on the LEFT
 * (status counts + the nearby offers the server found on this network) and
 * the Bridges grid (Test Master theme). A row opens the Bridge. Live:
 * `bridge.*` WorkEvents.
 */
@Component({
  selector: 'pf-bridges-list',
  standalone: true,
  imports: [SettingsSiblingsComponent, DataGridComponent, HeroBandComponent, ScreenHeaderComponent, SkeletonTableComponent, SkeletonRowsComponent, BusyDirective, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../../shared/settings-grid/settings-grid.scss'],
  template: `
    <section class="pf-brl pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Test Master frame: search in the band pill, the Analyzers | Bridges
             switch in band-tools, Refresh + ONE primary (Add Bridge) top-right. -->
        <pf-hero-band [back]="true" placeholder="Search Bridges — name, serial, branch, Wi-Fi, analyzer…"
                      [value]="q()" (valueChange)="q.set($event)">
          <ng-container band-tools>
            @if (narrow()) {
              <button type="button" class="pf-chip pf-sg-chip press" (click)="sheetOpen.set(true)" aria-haspopup="dialog"
                      [attr.aria-expanded]="sheetOpen()" title="Overview">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M8 9a6 6 0 0 1 8 0M5.5 6.5a10 10 0 0 1 13 0"/></svg>
                Overview
              </button>
            }
            <pf-settings-siblings></pf-settings-siblings>
          </ng-container>
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" [disabled]="loading()" [pfBusy]="loading()" pfBusyLabel="Refreshing…"
                    (click)="load()" aria-label="Refresh" title="Refresh">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>
              <span class="pf-brl__hide-phone">Refresh</span>
            </button>
            <button type="button" class="pf-hb-btn pf-hb-btn--primary press" (click)="add()" aria-label="Add Bridge" title="Add Bridge">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
              Add Bridge
            </button>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" eyebrow="Lab settings" title="Bridges" subtitle="Prefrontal Bridges that connect analyzers to the lab" parentRoute="/lab/settings">
        <button actions type="button" class="pf-btn pf-btn--secondary press" (click)="add()">Add Bridge</button>
      </pf-screen-header>

      <div class="pf-band-body pf-band-body--fill">
        <div class="pf-sg-panels" [class.pf-sg-panels--narrow]="narrow()">
          <!-- SIDE card (LEFT, like Test Master's Departments): status + nearby offers. -->
          @if (narrow()) {
            @if (sheetOpen()) {
              <div class="pf-sheet-backdrop" (click)="sheetOpen.set(false)"></div>
              <aside class="pf-card pf-sg-side pf-sg-side--sheet pf-brl__side" role="dialog" aria-modal="true" aria-label="Bridges overview"
                     (keydown.escape)="sheetOpen.set(false)">
                <span class="pf-sg-sheet-handle" aria-hidden="true"></span>
                <ng-container *ngTemplateOutlet="sideCard; context: { sheet: true }"></ng-container>
              </aside>
            }
          } @else {
            <aside class="pf-card pf-sg-side pf-brl__side" aria-label="Bridges overview">
              <ng-container *ngTemplateOutlet="sideCard; context: { sheet: false }"></ng-container>
            </aside>
          }

          <section class="pf-card pf-sg-main pf-sg-main--clickable pf-brl__main" [class.pf-sg-main--bare]="bare" aria-label="Bridges">
            <header class="pf-card__head pf-sg-main__head">
              <span class="pf-card__icon" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 17h.01M11 17h.01M8 9a6 6 0 0 1 8 0M5.5 6.5a10 10 0 0 1 13 0"/></svg>
              </span>
              <span class="pf-card__label">Bridges</span>
              <span class="pf-card__note pf-sg-hint">Click a row to open the Bridge</span>
              <ng-container *ngTemplateOutlet="headTools"></ng-container>
            </header>
            <div class="pf-sg-main__body">
              @if (listSkeleton()) {
                <pf-skeleton-table class="pf-sg-skel" [rows]="6" [cols]="6" label="Loading Bridges…"></pf-skeleton-table>
              }
              <pf-data-grid [clickable]="true" [rowData]="visibleRows()" [columnDefs]="colDefs()" [defaultColDef]="defaultColDef" [getRowId]="getRowId" [suppressCellFocus]="true" (cellClicked)="onCellClicked($event)"></pf-data-grid>
              @if (!listSkeleton() && !loading() && visibleRows().length === 0) {
                <div class="pf-sg-empty">
                  <p class="pf-sg-empty__title">{{ q().trim() ? 'No Bridges match "' + q().trim() + '"' : 'No Bridges yet' }}</p>
                  <p class="pf-sg-empty__body">{{ q().trim() ? 'Try another name or serial.' : 'Plug a Prefrontal Bridge in near your analyzers, then Add Bridge.' }}</p>
                </div>
              }
            </div>
          </section>
        </div>
      </div>
    </section>

    <ng-template #sideCard let-sheet="sheet">
      <header class="pf-card__head">
        <span class="pf-card__icon" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>
        </span>
        <span class="pf-card__label">Overview</span>
        <span class="pf-card__spacer"></span>
        @if (sheet) {
          <button type="button" class="pf-btn pf-btn--icon" (click)="sheetOpen.set(false)" aria-label="Close overview">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        }
      </header>
      <div class="pf-card__body">
        @if (listSkeleton()) {
          <pf-skeleton-rows [rows]="4" [avatar]="false" [dense]="true" [trailing]="false" label="Loading…"></pf-skeleton-rows>
        } @else {
          <dl class="pf-sg-stats">
            @for (s of statusCounts(); track s.label) {
              <div class="pf-sg-stat">
                <dt><span class="pf-sg-status" [attr.data-tone]="s.tone"><span class="pf-sg-status__dot" aria-hidden="true"></span>{{ s.label }}</span></dt>
                <dd class="pf-num">{{ s.n }}</dd>
              </div>
            }
          </dl>
          @if (queuedTotal() > 0) {
            <p class="pf-field__hint">{{ plural(queuedTotal(), 'result') }} waiting on Bridges that are offline — they send them when back online.</p>
          }
          @if (nearby.offers().length) {
            <h3 class="pf-sg-side__sec">Found on this network</h3>
            <ul class="pf-brl__offers" aria-label="Bridges found nearby">
              @for (n of nearby.offers(); track n.announcementId) {
                <li class="pf-brl__offer">
                  <span class="pf-brl__offer-main">
                    <span class="pf-brl__offer-name">Prefrontal Bridge <span class="pf-num">{{ n.serialShort }}</span></span>
                    <span class="pf-brl__offer-meta pf-num">{{ [n.model, n.version].filter(isText).join(' · ') }}{{ n.lastSeenAt ? ' · seen ' + ago(n.lastSeenAt).toLowerCase() : '' }}</span>
                  </span>
                  <button type="button" class="pf-rowact press" [class.pf-rowact--icon]="!web()" (click)="addNearby(n.announcementId)"
                          [attr.aria-label]="'Add Prefrontal Bridge ' + n.serialShort" title="Add">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                    <span class="pf-rowact__t">Add</span>
                  </button>
                </li>
              }
            </ul>
          }
          <p class="pf-sg-side__lead">A Bridge sits next to your analyzers and sends their results to the lab over Wi-Fi. Results arrive as a <strong>prefill</strong> — the technician still checks and submits every value.</p>
        }
      </div>
    </ng-template>

    <!-- The grid card's head tools (count + status filter): exposed so a host can project them into its own head. -->
    <ng-template #headTools>
              <span class="pf-sg-count pf-num" aria-live="polite">{{ countLabel() }}</span>
    </ng-template>
  `,
  styles: [`
    .pf-brl { overflow-x: clip; }
    .pf-brl__switch { flex-shrink: 0; }
    .pf-brl__offers { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .pf-brl__offer { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 6px 0; border-bottom: 1px solid var(--pf-line); }
    .pf-brl__offer-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .pf-brl__offer-name { font-size: 13px; font-weight: 500; color: var(--text-primary); }
    .pf-brl__offer-meta { font-size: 12px; color: var(--text-tertiary); }
    @media (max-width: 640px) { .pf-brl__hide-phone { display: none; } }
  `],
})
export class BridgesListComponent {
  /** Hosted in the Settings shell: the grid card renders BARE (ONE card, ONE head). */
  protected readonly bare = sgBare();
  /** Count + status filter, for a host that projects head tools into its own head. */
  readonly headTools = viewChild<TemplateRef<unknown>>('headTools');
  private readonly api = inject(BridgesApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  protected readonly theme = inject(ThemeService);
  protected readonly nearby = inject(BridgeNearbyService);
  protected readonly plural = plural;
  protected readonly ago = (iso: string | null | undefined) => agoText(iso);
  protected readonly isText = (s: unknown): s is string => typeof s === 'string' && !!s;
  readonly web = webPointerSignal();

  /** Narrow widths: the overview side card is a sheet opened from the band. */
  readonly narrow = sgMedia(SG_NARROW_MQ);
  readonly phone = sgMedia(SG_PHONE_MQ);
  readonly sheetOpen = signal(false);

  readonly q = signal('');
  readonly rows = signal<BridgeDto[]>([]);
  readonly loading = signal(true);
  readonly listSkeleton = spinDelay(computed(() => this.loading() && this.rows().length === 0));
  readonly visibleRows = computed(() => searchBridges(this.rows(), this.q()));
  readonly countLabel = computed(() => plural(this.visibleRows().length, 'Bridge'));
  readonly queuedTotal = computed(() => this.rows().filter((r) => r.status !== 'online').reduce((n, r) => n + (r.queueTotal ?? 0), 0));
  readonly statusCounts = computed(() => STATUS_ORDER
    .map((s) => ({ ...bridgeStatusWord(s), n: this.rows().filter((r) => (r.status ?? 'never') === s).length }))
    .filter((s, i) => s.n > 0 || i < 2));

  readonly gridTheme = sgGridTheme();
  readonly getRowId = (p: GetRowIdParams<BridgeDto>) => p.data.id;
  readonly defaultColDef: ColDef<BridgeDto> = { sortable: true, resizable: true, filter: false, minWidth: 100, autoHeight: true, wrapText: true };
  readonly colDefs = computed<ColDef<BridgeDto>[]>(() => {
    const web = this.web() && !this.phone();
    const cols: ColDef<BridgeDto>[] = [
      { colId: 'name', headerName: 'Bridge', flex: 1.4, minWidth: 170, sort: 'asc', valueGetter: (p) => p.data?.name ?? '',
        cellRenderer: (p: { data?: BridgeDto }) => sgCell(p.data?.name ?? '', [p.data?.serialShort, plural(p.data?.analyzers?.length ?? 0, 'analyzer')].filter(Boolean).join(' · '), true) },
      { colId: 'branch', headerName: 'Branch', flex: 0.7, minWidth: 90, valueGetter: (p) => p.data?.branchName ?? '' },
      { colId: 'status', headerName: 'Status', flex: 1, minWidth: 140, valueGetter: (p) => STATUS_ORDER.indexOf((p.data?.status ?? 'never') as typeof STATUS_ORDER[number]),
        cellRenderer: (p: { data?: BridgeDto }) => {
          const st = bridgeStatusWord(p.data?.status);
          const seen = p.data?.status !== 'online' && p.data?.lastSeenAt ? `Last seen ${agoText(p.data.lastSeenAt).toLowerCase()}` : '';
          return sgStatusWord(st.label, st.tone, seen);
        } },
      { colId: 'lastMessage', headerName: 'Last message', flex: 0.8, minWidth: 110, valueGetter: (p) => p.data?.lastMessageAt ?? '',
        cellRenderer: (p: { data?: BridgeDto }) => sgCell(agoText(p.data?.lastMessageAt) || '—') },
      { colId: 'queue', headerName: 'Queue', width: 90, minWidth: 84, flex: 0, type: 'rightAligned', valueGetter: (p) => p.data?.queueTotal ?? 0,
        cellRenderer: (p: { data?: BridgeDto }) => {
          const held = p.data?.quarantineTotal ?? 0;
          const el = sgCell(String(p.data?.queueTotal ?? 0), held ? `${held} held` : null);
          el.classList.add('pf-num');
          return el;
        } },
      { colId: 'version', headerName: 'Version', flex: 0.8, minWidth: 100, valueGetter: (p) => p.data?.version ?? '',
        cellRenderer: (p: { data?: BridgeDto }) => sgCell(versionText(p.data ?? { version: null })) },
      { colId: 'wifi', headerName: 'Wi-Fi', flex: 1.1, minWidth: 130, valueGetter: (p) => p.data?.network?.ssid ?? '',
        cellRenderer: (p: { data?: BridgeDto }) => sgCell(wifiSummary(p.data ?? {})) },
      sgActionsCol<BridgeDto>(web, [], 1, (p) => sgActions(web, [
        { label: 'Open', aria: `Open ${p.data?.name ?? 'Bridge'}`, path: SG_ICON.open, icon: true, run: () => this.open(p.data) },
      ])),
    ];
    if (this.phone()) return cols.filter((c) => ['name', 'status', 'actions'].includes(c.colId ?? ''));
    return cols;
  });

  constructor() {
    this.load();
    this.nearby.start();
    void this.nearby.poll();
    inject(WorkEventsService).on('bridges').pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(() => this.load(true));
  }

  load(quiet = false) {
    if (!quiet) this.loading.set(true);
    this.api.list().subscribe({
      next: (list) => { this.rows.set(Array.isArray(list) ? list : []); this.loading.set(false); },
      error: (err) => { this.loading.set(false); if (!quiet) this.toasts.error(ApiError.from(err).message); },
    });
  }

  add() { void this.router.navigate(['/admin/bridges', 'add']); }
  addNearby(announcementId: string) { void this.router.navigate(['/admin/bridges', 'add'], { queryParams: { nearby: announcementId } }); }

  open(b: BridgeDto | undefined) { if (b?.id) void this.router.navigate(['/admin/bridges', b.id]); }

  onCellClicked(ev: CellClickedEvent<BridgeDto>) {
    if (ev.colDef.colId === 'actions') return;
    this.open(ev.data);
  }
}
