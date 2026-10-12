import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
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
import { connectionSummary, fmtIst, protocolLabel, statusWord } from '../../../shared/instruments/instrument-config';

ModuleRegistry.registerModules([AllCommunityModule]);

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));

/** Band search over the instruments (name, make, model, serial, connection). */
export function searchInstruments(rows: readonly InstrumentDto[], q: string): InstrumentDto[] {
  return bandFilter(rows, q, (i) => [i.name, i.make, i.model, i.serialNumber, connectionSummary(i.config, i.transport)]);
}

/**
 * Lab settings → Instruments: the lab's analyzers. ND pattern — band (search
 * pill, quiet Refresh), the instruments grid (AG-Grid, Test Master theme) as
 * the main card and an ACTION side card on the right whose ONE primary is
 * "Add instrument". A row opens the instrument (setup wizard + live status).
 */
@Component({
  selector: 'pf-instruments-list',
  standalone: true,
  imports: [AgGridAngular, RouterLink, HeroBandComponent, ScreenHeaderComponent, SkeletonTableComponent, BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-inl pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" backTo="/lab/settings" placeholder="Search instruments — name, make, model, port…"
                      [value]="q()" (valueChange)="q.set($event)">
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" [disabled]="loading()" [pfBusy]="loading()" pfBusyLabel="Refreshing…"
                    (click)="load()" aria-label="Refresh" title="Refresh">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>
              Refresh
            </button>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only" eyebrow="Lab settings" title="Instruments" subtitle="Analyzers connected to the lab" parentRoute="/lab/settings"></pf-screen-header>

      <div class="pf-band-body pf-band-body--fill pf-inl__body">
        <div class="pf-inl__panels">
          <section class="pf-card pf-inl__main" aria-label="Instruments">
            <header class="pf-card__head">
              <span class="pf-card__icon" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 20h10M12 16v4M7 10h2l1.5-3 3 6 1.5-3h2"/></svg>
              </span>
              <h2 class="pf-card__label">Instruments</h2>
              <span class="pf-card__spacer"></span>
              <span class="pf-inl__count pf-num" aria-live="polite">{{ countLabel() }}</span>
            </header>
            <div class="pf-inl__grid-wrap">
              @if (listSkeleton()) {
                <pf-skeleton-table [rows]="5" [cols]="5" label="Loading instruments…"></pf-skeleton-table>
              } @else if (!loading() && visibleRows().length === 0) {
                <div class="pf-empty">
                  <span class="pf-empty__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 20h10M12 16v4"/></svg>
                  </span>
                  <p class="pf-empty__title">{{ q().trim() ? 'No instruments match "' + q().trim() + '"' : 'No instruments yet' }}</p>
                  <p class="pf-empty__body">{{ q().trim() ? 'Try another name or port.' : 'Add your first analyzer — the CBC counter is a good start.' }}</p>
                </div>
              } @else {
                <ag-grid-angular class="pf-inl__grid" [theme]="gridTheme()" [rowData]="visibleRows()" [columnDefs]="colDefs()"
                                 [defaultColDef]="defaultColDef" [getRowId]="getRowId" [animateRows]="true"
                                 [suppressCellFocus]="true" (cellClicked)="onCellClicked($event)"></ag-grid-angular>
              }
            </div>
          </section>

          <aside class="pf-card pf-inl__side" aria-label="Instrument actions">
            <header class="pf-card__head">
              <span class="pf-card__icon" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
              </span>
              <h2 class="pf-card__label">Connect</h2>
            </header>
            <div class="pf-card__body pf-inl__sidebody">
              <p class="pf-inl__lead">Results flow from the analyzer into result entry as a <strong>prefill</strong> — the technician still checks and submits every value.</p>
              <dl class="pf-inl__stats">
                @for (s of statusCounts(); track s.label) {
                  <div class="pf-inl__stat">
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
              <p class="pf-field__hint">Setup: basics → connection → protocol → listen to a real run → map the analyzer's codes → pair the lab PC.</p>
            </div>
            <div class="pf-card__foot">
              <button type="button" class="pf-btn pf-btn--primary pf-span press" (click)="add()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                Add instrument
              </button>
            </div>
          </aside>
        </div>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; min-height: 0; }
    .pf-inl__body { display: flex; flex-direction: column; min-height: 0; }
    .pf-inl__panels { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; flex: 1 1 auto; min-height: 0; }
    @media (max-width: 1023px) { .pf-inl__panels { grid-template-columns: minmax(0, 1fr); } }
    .pf-inl__main { min-width: 0; min-height: 0; }
    .pf-inl__count { margin-left: auto; font-size: 12.5px; font-weight: 500; color: var(--text-tertiary); white-space: nowrap; }
    .pf-inl__grid-wrap { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
    .pf-inl__grid { display: block; width: 100%; flex: 1 1 auto; min-height: 320px; height: calc(100dvh - 300px); }
    .pf-inl__main ::ng-deep .ag-root-wrapper { border: 0; border-radius: 0; }
    .pf-inl__main ::ng-deep .pf-inl-cell { line-height: 1.3; display: flex; flex-direction: column; justify-content: center; height: 100%; padding: 6px 0; }
    .pf-inl__main ::ng-deep .pf-inl-cell__sub { font-size: 11.5px; color: var(--text-tertiary); }
    .pf-inl__main ::ng-deep .pf-inl-cell__name { font-weight: 600; color: var(--text-primary); }
    .pf-inl-status, .pf-inl__main ::ng-deep .pf-inl-status { display: inline-flex; align-items: center; gap: 6px; font-weight: 500; white-space: nowrap;
      --pf-inl-tone: var(--text-secondary); color: color-mix(in srgb, var(--pf-inl-tone) 70%, var(--text-primary)); }
    .pf-inl-status[data-tone='green'], .pf-inl__main ::ng-deep .pf-inl-status[data-tone='green'] { --pf-inl-tone: var(--green-text, #15803d); }
    .pf-inl-status[data-tone='amber'], .pf-inl__main ::ng-deep .pf-inl-status[data-tone='amber'] { --pf-inl-tone: var(--amber-text, #b45309); }
    .pf-inl-status[data-tone='red'], .pf-inl__main ::ng-deep .pf-inl-status[data-tone='red'] { --pf-inl-tone: var(--red-text, #b91c1c); }
    .pf-inl-status__dot, .pf-inl__main ::ng-deep .pf-inl-status__dot { width: 7px; height: 7px; border-radius: 999px; background: var(--pf-inl-tone); flex: none; }
    .pf-inl__main ::ng-deep .ag-cell.pf-inl-actcell { padding-left: 6px; padding-right: 6px; }
    .pf-inl__main ::ng-deep .ag-row { cursor: pointer; }
    .pf-inl__sidebody { gap: 14px; }
    .pf-inl__lead { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-secondary); }
    .pf-inl__stats { margin: 0; display: grid; gap: 6px; }
    .pf-inl__stat { display: flex; align-items: center; justify-content: space-between; min-height: 32px; padding: 0 2px; border-bottom: 1px solid var(--pf-line); }
    .pf-inl__stat dd { margin: 0; font-size: 13px; color: var(--text-primary); }
    .pf-inl__stat dt { font-size: 12.5px; }
    .pf-inl__link { align-self: flex-start; text-decoration: none; }
    @media (max-width: 640px) { .pf-inl__grid { height: calc(100dvh - 380px); } }
  `],
})
export class InstrumentsListComponent {
  private readonly api = inject(InstrumentsApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  protected readonly theme = inject(ThemeService);
  protected readonly plural = plural;

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
    return (['online', 'offline', 'error', 'never'] as const).map((s) => ({ ...statusWord(s), n: live.filter((r) => (r.status ?? 'never') === s).length }));
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
      const seen = d?.lastSeenAt ? `Last seen ${fmtIst(d.lastSeenAt)}` : '';
      return `<div class="pf-inl-cell"><span class="pf-inl-status" data-tone="${st.tone}"><span class="pf-inl-status__dot" aria-hidden="true"></span>${esc(st.label)}</span>${seen ? `<span class="pf-inl-cell__sub">${esc(seen)}</span>` : ''}</div>`;
    };
    const cols: ColDef<InstrumentDto>[] = [
      { colId: 'name', headerName: 'Instrument', flex: 1.3, minWidth: 180, sort: 'asc', valueGetter: (p) => p.data?.name ?? '',
        cellRenderer: (p: { data?: InstrumentDto }) => cell(p.data?.name ?? '', [p.data?.make, p.data?.model].filter(Boolean).join(' · '), 'pf-inl-cell__name') },
      { colId: 'connection', headerName: 'Connection', flex: 1.4, minWidth: 190, valueGetter: (p) => connectionSummary(p.data?.config, p.data?.transport),
        cellRenderer: (p: { data?: InstrumentDto }) => cell(connectionSummary(p.data?.config, p.data?.transport), protocolLabel(p.data?.config)) },
      { colId: 'status', headerName: 'Status', flex: 1, minWidth: 160, valueGetter: (p) => p.data?.status ?? 'never',
        cellRenderer: (p: { data?: InstrumentDto }) => status(p.data) },
      { colId: 'unmatched', headerName: 'Unmatched', width: 120, minWidth: 110, flex: 0, type: 'rightAligned',
        valueGetter: (p) => p.data?.unmatchedCount ?? 0,
        cellRenderer: (p: { data?: InstrumentDto }) => `<span class="pf-num">${esc(p.data?.unmatchedCount ?? 0)}</span>` },
      { colId: 'actions', headerName: '', sortable: false, resizable: false, width: web ? 96 : 64, minWidth: web ? 96 : 64, flex: 0, cellClass: 'pf-inl-actcell',
        cellRenderer: (p: { data?: InstrumentDto }) =>
          `<button type="button" class="pf-rowact${web ? '' : ' pf-rowact--icon'}" data-act="open" aria-label="Open ${esc(p.data?.name)}" title="Open">` +
          `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>` +
          `<span class="pf-rowact__t">Open</span></button>` },
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

  onCellClicked(ev: CellClickedEvent<InstrumentDto>) {
    if (ev.data?.id) void this.router.navigate(['/admin/instruments', ev.data.id]);
  }
}
