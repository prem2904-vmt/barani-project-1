import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { AllCommunityModule, CellClickedEvent, ColDef, GetRowIdParams, ModuleRegistry } from 'ag-grid-community';
import { AgGridAngular } from 'ag-grid-angular';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { WorkEventsService } from '../../../core/services/work-events.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SkeletonTableComponent } from '../../../shared/primitives/skeleton-kit.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { ndGridDark, ndGridLight } from '../../../shared/utils/nd-grid-theme';
import { bandFilter } from '../../../shared/utils/band-search';
import { plural } from '../../../shared/utils/plural';
import { spinDelay } from '../../../shared/utils/busy';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { BridgesApiService } from '../../../shared/bridges/bridges-api.service';
import { BridgeNearbyService } from '../../../shared/bridges/bridge-nearby.service';
import type { BridgeDto } from '../../../shared/bridges/bridge.models';
import { agoText, bridgeStatusWord, versionText, wifiSummary } from '../../../shared/bridges/bridge-status';

ModuleRegistry.registerModules([AllCommunityModule]);

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));

/** Band search over the Bridges (name, serial, branch, Wi-Fi, analyzers). */
export function searchBridges(rows: readonly BridgeDto[], q: string): BridgeDto[] {
  return bandFilter(rows, q, (b) => [b.name, b.serialShort, b.serial, b.branchName, b.network?.ssid, ...(b.analyzers ?? []).map((a) => a.name)]);
}

/** Status order for the side card counts and the default sort. */
const STATUS_ORDER = ['online', 'offline', 'error', 'pending', 'never'] as const;

/**
 * Lab settings → Bridges: the lab's Prefrontal Bridges (zero-touch analyzer
 * boxes). ND pattern — band (search pill, quiet Refresh), the Bridges grid
 * (AG-Grid, the ND skin) as the main card, and an ACTION side card on the
 * right whose ONE primary is "Add Bridge", with the nearby offers the server
 * found on this network. A row opens the Bridge. Live: `bridge.*` WorkEvents.
 */
@Component({
  selector: 'pf-bridges-list',
  standalone: true,
  imports: [AgGridAngular, HeroBandComponent, ScreenHeaderComponent, SkeletonTableComponent, BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-brl pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" placeholder="Search Bridges — name, serial, branch, Wi-Fi, analyzer…"
                      [value]="q()" (valueChange)="q.set($event)">
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" [disabled]="loading()" [pfBusy]="loading()" pfBusyLabel="Refreshing…"
                    (click)="load()" aria-label="Refresh" title="Refresh">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>
              <span class="pf-brl__hide-phone">Refresh</span>
            </button>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" eyebrow="Lab settings" title="Bridges" subtitle="Prefrontal Bridges that connect analyzers to the lab" parentRoute="/lab/settings"></pf-screen-header>

      <div class="pf-band-body pf-band-body--fill pf-brl__body">
        <div class="pf-brl__panels">
          <section class="nd-card pf-brl__main" aria-label="Bridges">
            <header class="nd-card__head">
              <span class="nd-card__icon" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 17h.01M11 17h.01M8 9a6 6 0 0 1 8 0M5.5 6.5a10 10 0 0 1 13 0"/></svg>
              </span>
              <h2 class="nd-card__label">Bridges</h2>
              <span class="nd-card__spacer"></span>
              <span class="pf-brl__count nd-num" aria-live="polite">{{ countLabel() }}</span>
            </header>
            <div class="pf-brl__grid-wrap">
              @if (listSkeleton()) {
                <pf-skeleton-table [rows]="4" [cols]="6" label="Loading Bridges…"></pf-skeleton-table>
              } @else if (!loading() && visibleRows().length === 0) {
                <div class="nd-empty">
                  <span class="nd-empty__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M8 9a6 6 0 0 1 8 0M5.5 6.5a10 10 0 0 1 13 0"/></svg>
                  </span>
                  <p class="nd-empty__title">{{ q().trim() ? 'No Bridges match "' + q().trim() + '"' : 'No Bridges yet' }}</p>
                  <p class="nd-empty__body">{{ q().trim() ? 'Try another name or serial.' : 'Plug a Prefrontal Bridge in near your analyzers, then add it here.' }}</p>
                </div>
              } @else {
                <ag-grid-angular class="pf-brl__grid" [theme]="gridTheme()" [rowData]="visibleRows()" [columnDefs]="colDefs()"
                                 [defaultColDef]="defaultColDef" [getRowId]="getRowId" [animateRows]="true"
                                 [suppressCellFocus]="true" (cellClicked)="onCellClicked($event)"></ag-grid-angular>
              }
            </div>
          </section>

          <aside class="nd-card pf-brl__side" aria-label="Add a Bridge">
            <header class="nd-card__head">
              <span class="nd-card__icon" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
              </span>
              <h2 class="nd-card__label">Add</h2>
            </header>
            <div class="nd-card__body pf-brl__sidebody">
              <p class="pf-brl__lead">A Bridge sits next to your analyzers and sends their results to the lab over Wi-Fi. Results arrive as a <strong>prefill</strong> — the technician still checks and submits every value.</p>
              @if (nearby.offers().length) {
                <h3 class="pf-brl__sec">Found on this network</h3>
                <ul class="pf-brl__offers" aria-label="Bridges found nearby">
                  @for (n of nearby.offers(); track n.announcementId) {
                    <li class="nd-row pf-brl__offer">
                      <span class="pf-brl__offer-main">
                        <span class="pf-brl__offer-name">Prefrontal Bridge <span class="nd-num">{{ n.serialShort }}</span></span>
                        <span class="pf-brl__offer-meta nd-num">{{ [n.model, n.version].filter(isText).join(' · ') }}{{ n.lastSeenAt ? ' · seen ' + ago(n.lastSeenAt).toLowerCase() : '' }}</span>
                      </span>
                      <button type="button" class="nd-rowact press" [class.nd-rowact--icon]="!web()" (click)="addNearby(n.announcementId)"
                              [attr.aria-label]="'Add Prefrontal Bridge ' + n.serialShort" title="Add">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                        <span class="nd-rowact__t">Add</span>
                      </button>
                    </li>
                  }
                </ul>
              }
              <dl class="pf-brl__stats">
                @for (s of statusCounts(); track s.label) {
                  <div class="pf-brl__stat">
                    <dt><span class="pf-brl-status" [attr.data-tone]="s.tone"><span class="pf-brl-status__dot" aria-hidden="true"></span>{{ s.label }}</span></dt>
                    <dd class="nd-num">{{ s.n }}</dd>
                  </div>
                }
              </dl>
              @if (queuedTotal() > 0) {
                <p class="nd-field__hint">{{ plural(queuedTotal(), 'result') }} waiting on Bridges that are offline — they send them when back online.</p>
              }
            </div>
            @if (!isPhone) {
              <div class="nd-card__foot">
                <button type="button" class="nd-btn nd-btn--primary nd-span press" (click)="add()">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                  Add Bridge
                </button>
              </div>
            }
          </aside>
        </div>
      </div>
      @if (isPhone) {
        <!-- Phones: the side card's primary rides the kit's bottom bar (ND §8). -->
        <div class="nd-bottombar">
          <span class="nd-bottombar__info nd-num">{{ countLabel() }}</span>
          <button type="button" class="nd-btn nd-btn--primary press" (click)="add()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            Add Bridge
          </button>
        </div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; min-height: 0; }
    .pf-brl__body { display: flex; flex-direction: column; min-height: 0; }
    .pf-brl__panels { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 16px; flex: 1 1 auto; min-height: 0; }
    @media (max-width: 1023px) { .pf-brl__panels { grid-template-columns: minmax(0, 1fr); } }
    .pf-brl__main { min-width: 0; min-height: 0; }
    .pf-brl__count { margin-left: auto; font-size: 12.5px; font-weight: 500; color: var(--text-tertiary); white-space: nowrap; }
    .pf-brl__grid-wrap { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
    .pf-brl__grid { display: block; width: 100%; flex: 1 1 auto; min-height: 300px; height: calc(100dvh - 300px); }
    .pf-brl__main ::ng-deep .pf-brl-cell { line-height: 1.3; display: flex; flex-direction: column; justify-content: center; height: 100%; padding: 6px 0; }
    .pf-brl__main ::ng-deep .pf-brl-cell__sub { font-size: 11.5px; color: var(--text-tertiary); }
    .pf-brl__main ::ng-deep .pf-brl-cell__name { font-weight: 600; color: var(--text-primary); }
    .pf-brl-status, .pf-brl__main ::ng-deep .pf-brl-status { display: inline-flex; align-items: center; gap: 6px; font-weight: 500;
      --pf-brl-tone: var(--text-secondary); color: color-mix(in srgb, var(--pf-brl-tone) 70%, var(--text-primary)); }
    .pf-brl-status[data-tone='green'], .pf-brl__main ::ng-deep .pf-brl-status[data-tone='green'] { --pf-brl-tone: var(--green-text, #15803d); }
    .pf-brl-status[data-tone='amber'], .pf-brl__main ::ng-deep .pf-brl-status[data-tone='amber'] { --pf-brl-tone: var(--amber-text, #b45309); }
    .pf-brl-status[data-tone='red'], .pf-brl__main ::ng-deep .pf-brl-status[data-tone='red'] { --pf-brl-tone: var(--red-text, #b91c1c); }
    .pf-brl-status__dot, .pf-brl__main ::ng-deep .pf-brl-status__dot { width: 7px; height: 7px; border-radius: 999px; background: var(--pf-brl-tone); flex: none; }
    .pf-brl__main ::ng-deep .ag-cell.pf-brl-actcell { padding-left: 6px; padding-right: 6px; }
    .pf-brl__main ::ng-deep .ag-row { cursor: pointer; }
    .pf-brl__sidebody { gap: 14px; }
    .pf-brl__lead { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-secondary); }
    .pf-brl__sec { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-brl__offers { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .pf-brl__offer { display: flex; align-items: center; gap: 10px; min-height: 52px; }
    .pf-brl__offer-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .pf-brl__offer-name { font-size: 13.5px; font-weight: 500; color: var(--text-primary); }
    .pf-brl__offer-meta { font-size: 12px; color: var(--text-tertiary); }
    .pf-brl__stats { margin: 0; display: grid; gap: 6px; }
    .pf-brl__stat { display: flex; align-items: center; justify-content: space-between; min-height: 32px; padding: 0 2px; border-bottom: 1px solid var(--nd-line); }
    .pf-brl__stat dd { margin: 0; font-size: 13px; color: var(--text-primary); }
    .pf-brl__stat dt { font-size: 12.5px; }
    @media (max-width: 640px) {
      /* ND §12: card labels are 12px on phones — beat the global phone h2 cap. */
      .nd-card__label { font-size: 12px !important; line-height: 1.3 !important; }
      .pf-brl__grid { height: min(56dvh, 460px); min-height: 220px; }
      .pf-brl .pf-brl__body.pf-band-body--fill { overflow-y: auto; display: block; padding-bottom: 96px; }
      .pf-brl__hide-phone { display: none; }
    }
  `],
})
export class BridgesListComponent {
  private readonly api = inject(BridgesApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  protected readonly theme = inject(ThemeService);
  protected readonly nearby = inject(BridgeNearbyService);
  protected readonly plural = plural;
  protected readonly ago = (iso: string | null | undefined) => agoText(iso);
  protected readonly isText = (s: unknown): s is string => typeof s === 'string' && !!s;
  readonly web = webPointerSignal();

  readonly isPhone = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(max-width: 640px)').matches;

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

  readonly gridTheme = computed(() => (this.theme.isDark() ? ndGridDark : ndGridLight));
  readonly getRowId = (p: GetRowIdParams<BridgeDto>) => p.data.id;
  readonly defaultColDef: ColDef<BridgeDto> = { sortable: true, resizable: true, filter: false, minWidth: 100, autoHeight: true, wrapText: true };
  readonly colDefs = computed<ColDef<BridgeDto>[]>(() => {
    const web = this.web() && !this.isPhone;
    const cell = (main: string, sub?: string, cls = '') =>
      `<div class="pf-brl-cell"><span class="${cls}">${esc(main)}</span>${sub ? `<span class="pf-brl-cell__sub">${esc(sub)}</span>` : ''}</div>`;
    const status = (d?: BridgeDto) => {
      const st = bridgeStatusWord(d?.status);
      const seen = d?.status !== 'online' && d?.lastSeenAt ? `Last seen ${agoText(d.lastSeenAt).toLowerCase()}` : '';
      return `<div class="pf-brl-cell"><span class="pf-brl-status" data-tone="${st.tone}"><span class="pf-brl-status__dot" aria-hidden="true"></span>${esc(st.label)}</span>${seen ? `<span class="pf-brl-cell__sub">${esc(seen)}</span>` : ''}</div>`;
    };
    const cols: ColDef<BridgeDto>[] = [
      { colId: 'name', headerName: 'Bridge', flex: 1.4, minWidth: 170, sort: 'asc', valueGetter: (p) => p.data?.name ?? '',
        cellRenderer: (p: { data?: BridgeDto }) => cell(p.data?.name ?? '', [p.data?.serialShort, plural(p.data?.analyzers?.length ?? 0, 'analyzer')].filter(Boolean).join(' · '), 'pf-brl-cell__name') },
      { colId: 'branch', headerName: 'Branch', flex: 0.7, minWidth: 90, valueGetter: (p) => p.data?.branchName ?? '' },
      { colId: 'status', headerName: 'Status', flex: 1, minWidth: 140, valueGetter: (p) => STATUS_ORDER.indexOf((p.data?.status ?? 'never') as typeof STATUS_ORDER[number]),
        cellRenderer: (p: { data?: BridgeDto }) => status(p.data) },
      { colId: 'lastMessage', headerName: 'Last message', flex: 0.8, minWidth: 110, valueGetter: (p) => p.data?.lastMessageAt ?? '',
        cellRenderer: (p: { data?: BridgeDto }) => cell(agoText(p.data?.lastMessageAt) || '—') },
      { colId: 'queue', headerName: 'Queue', width: 90, minWidth: 84, flex: 0, type: 'rightAligned', valueGetter: (p) => p.data?.queueTotal ?? 0,
        cellRenderer: (p: { data?: BridgeDto }) => {
          const held = p.data?.quarantineTotal ?? 0;
          return `<div class="pf-brl-cell"><span class="nd-num">${esc(p.data?.queueTotal ?? 0)}</span>${held ? `<span class="pf-brl-cell__sub nd-num">${esc(held)} held</span>` : ''}</div>`;
        } },
      { colId: 'version', headerName: 'Version', flex: 0.8, minWidth: 100, valueGetter: (p) => p.data?.version ?? '',
        cellRenderer: (p: { data?: BridgeDto }) => cell(versionText(p.data ?? { version: null })) },
      { colId: 'wifi', headerName: 'Wi-Fi', flex: 1.1, minWidth: 130, valueGetter: (p) => p.data?.network?.ssid ?? '',
        cellRenderer: (p: { data?: BridgeDto }) => cell(wifiSummary(p.data ?? {})) },
      { colId: 'actions', headerName: '', sortable: false, resizable: false, width: web ? 96 : 64, minWidth: web ? 96 : 64, flex: 0, cellClass: 'pf-brl-actcell',
        cellRenderer: (p: { data?: BridgeDto }) =>
          `<button type="button" class="nd-rowact${web ? '' : ' nd-rowact--icon'}" data-act="open" aria-label="Open ${esc(p.data?.name)}" title="Open">` +
          `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>` +
          `<span class="nd-rowact__t">Open</span></button>` },
    ];
    if (this.isPhone) return cols.filter((c) => ['name', 'status', 'actions'].includes(c.colId ?? ''));
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

  onCellClicked(ev: CellClickedEvent<BridgeDto>) {
    if (ev.data?.id) void this.router.navigate(['/admin/bridges', ev.data.id]);
  }
}
