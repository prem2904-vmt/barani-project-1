import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { AllCommunityModule, CellClickedEvent, ColDef, GetRowIdParams, ModuleRegistry } from 'ag-grid-community';
import { AgGridAngular } from 'ag-grid-angular';
import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ScanService } from '../../../core/services/scan.service';
import { normalizeTubeScan } from '@prefrontal/shared';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { BarcodeScannerModalComponent } from '../../../shared/components/barcode-scanner/barcode-scanner-modal.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { ApiError } from '../../../shared/models/api-response.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SkeletonTableComponent } from '../../../shared/primitives/skeleton-kit.component';
import { bandFilter } from '../../../shared/utils/band-search';
import { spinDelay } from '../../../shared/utils/busy';
import { plural } from '../../../shared/utils/plural';
import { gridThemeDark, gridThemeLight } from '../../admin/tests/tests/grid-theme';
import { fmtIst } from '../../../shared/instruments/instrument-config';
import { MessageSummaryDto } from '../../../shared/instruments/instrument.models';
import { InstrumentsApiService } from '../../../shared/instruments/instruments-api.service';

ModuleRegistry.registerModules([AllCommunityModule]);

export type AnalyzerTab = 'unmatched' | 'qc';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));

/** "WBC 7.8 H · RBC 4.52 · …" — the first few results of a message. */
export function previewSummary(m: Pick<MessageSummaryDto, 'preview'>, max = 6): string {
  return (m.preview ?? []).slice(0, max)
    .map((p) => [p.code, p.value, (p.flags ?? []).filter(Boolean).join('')].filter(Boolean).join(' '))
    .join(' · ');
}

/** Band search over messages (sample ID as sent, instrument, codes). */
export function searchMessages(rows: readonly MessageSummaryDto[], q: string): MessageSummaryDto[] {
  return bandFilter(rows, q, (m) => [m.sampleId, m.instrumentName, previewSummary(m, 8), ...(m.unmappedCodes ?? [])]);
}

/**
 * Lab → Analyzer results: runs the analyzers sent that did not match a tube
 * (wrong / unreadable barcode) and the QC runs. ND pattern — band (search,
 * Refresh), one main card: the grid (AG-Grid, Test Master theme) with a
 * neutral Unmatched | QC segment in its header. "Attach to sample" scans /
 * types the tube barcode (the shared scanner; manual-mode tenants type) and,
 * after a confirm, re-matches the run to that tube — its values then prefill
 * result entry. QC runs are read-only.
 */
@Component({
  selector: 'pf-analyzer-results',
  standalone: true,
  imports: [AgGridAngular, HeroBandComponent, ScreenHeaderComponent, SkeletonTableComponent, BusyDirective, BarcodeScannerModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-ar pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" backTo="/lab/my-work" placeholder="Search sample ID, instrument, code…"
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
      <pf-screen-header class="pf-classic-only" eyebrow="Lab" title="Analyzer results" subtitle="Runs that did not match a sample, and QC runs" parentRoute="/lab/my-work"></pf-screen-header>

      <div class="pf-band-body pf-band-body--fill pf-ar__body">
        <section class="pf-card pf-ar__main" aria-label="Analyzer results">
          <header class="pf-card__head pf-ar__head">
            <span class="pf-card__icon" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 20h10M12 16v4M7 10h2l1.5-3 3 6 1.5-3h2"/></svg>
            </span>
            <h2 class="pf-card__label">Analyzer results</h2>
            <span class="pf-seg pf-ar__seg" role="radiogroup" aria-label="Show">
              <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="tab() === 'unmatched'" (click)="setTab('unmatched')">Unmatched</button>
              <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="tab() === 'qc'" (click)="setTab('qc')">QC</button>
            </span>
            <span class="pf-ar__count pf-num" aria-live="polite">{{ countLabel() }}</span>
          </header>
          <p class="pf-ar__hint">{{ tab() === 'unmatched'
            ? 'The analyzer sent a sample ID no tube has. Attach the run to the right tube — its values then prefill result entry.'
            : 'Quality-control runs. Read only — never attached to a patient.' }}</p>
          <div class="pf-ar__grid-wrap">
            @if (listSkeleton()) {
              <pf-skeleton-table [rows]="6" [cols]="5" label="Loading analyzer results…"></pf-skeleton-table>
            } @else if (!loading() && visibleRows().length === 0) {
              <div class="pf-empty">
                <span class="pf-empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
                <p class="pf-empty__title">{{ q().trim() ? 'Nothing matches "' + q().trim() + '"' : (tab() === 'unmatched' ? 'Every analyzer run matched a sample' : 'No QC runs yet') }}</p>
                <p class="pf-empty__body">{{ q().trim() ? 'Try another sample ID or code.' : 'New runs appear here as they arrive.' }}</p>
              </div>
            } @else {
              <ag-grid-angular class="pf-ar__grid" [theme]="gridTheme()" [rowData]="visibleRows()" [columnDefs]="colDefs()"
                               [defaultColDef]="defaultColDef" [getRowId]="getRowId" [animateRows]="true"
                               [suppressCellFocus]="true" (cellClicked)="onCellClicked($event)"></ag-grid-angular>
            }
            @if (total() > rows().length) {
              <p class="pf-ar__more pf-num">Showing the latest {{ rows().length }} of {{ total() }}.</p>
            }
          </div>
        </section>
      </div>
    </section>

    @if (attachFor(); as m) {
      <pf-barcode-scanner-modal [manualOnly]="scan.manualEntry()" title="Scan the tube to attach this run"
                                (matched)="onBarcode(m, $event)" (cancelled)="attachFor.set(null)"></pf-barcode-scanner-modal>
    }
  `,
  styles: [`
    :host { display: block; min-height: 0; }
    .pf-ar__body { display: flex; flex-direction: column; min-height: 0; }
    .pf-ar__main { min-width: 0; min-height: 0; flex: 1 1 auto; }
    .pf-ar__head { flex-wrap: wrap; }
    .pf-ar__seg { flex: none; }
    .pf-ar__count { margin-left: auto; font-size: 12.5px; font-weight: 500; color: var(--text-tertiary); white-space: nowrap; }
    .pf-ar__hint { margin: 0; padding: 8px 14px; font-size: 12.5px; color: var(--text-tertiary); border-bottom: 1px solid var(--pf-line); }
    .pf-ar__grid-wrap { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
    .pf-ar__grid { display: block; width: 100%; flex: 1 1 auto; min-height: 320px; height: calc(100dvh - 320px); }
    .pf-ar__main ::ng-deep .ag-root-wrapper { border: 0; border-radius: 0; }
    .pf-ar__main ::ng-deep .pf-ar-cell { line-height: 1.3; display: flex; flex-direction: column; justify-content: center; height: 100%; padding: 6px 0; }
    .pf-ar__main ::ng-deep .pf-ar-cell__sub { font-size: 11.5px; color: var(--text-tertiary); }
    .pf-ar__main ::ng-deep .pf-ar-cell__id { font-size: 15px; font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums; }
    .pf-ar__main ::ng-deep .ag-cell.pf-ar-actcell { padding-left: 6px; padding-right: 6px; }
    .pf-ar__more { margin: 0; padding: 8px 14px; font-size: 12px; color: var(--text-tertiary); border-top: 1px solid var(--pf-line); }
    @media (max-width: 640px) {
      .pf-ar__count { margin-left: 0; }
      .pf-ar__grid { height: calc(100dvh - 360px); }
    }
  `],
})
export class AnalyzerResultsComponent {
  private readonly api = inject(InstrumentsApiService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly auth = inject(AuthService);
  protected readonly scan = inject(ScanService);
  protected readonly theme = inject(ThemeService);

  readonly isPhone = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
  readonly isCoarse = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  readonly q = signal('');
  readonly tab = signal<AnalyzerTab>('unmatched');
  readonly rows = signal<MessageSummaryDto[]>([]);
  readonly total = signal(0);
  readonly loading = signal(true);
  readonly listSkeleton = spinDelay(computed(() => this.loading() && this.rows().length === 0));
  readonly visibleRows = computed(() => searchMessages(this.rows(), this.q()));
  readonly countLabel = computed(() => plural(this.visibleRows().length, this.tab() === 'qc' ? 'QC run' : 'run'));
  readonly attachFor = signal<MessageSummaryDto | null>(null);
  private readonly attaching = new Set<string>();

  readonly gridTheme = computed(() => (this.theme.isDark() ? gridThemeDark : gridThemeLight));
  readonly getRowId = (p: GetRowIdParams<MessageSummaryDto>) => p.data.id;
  readonly defaultColDef: ColDef<MessageSummaryDto> = { sortable: true, resizable: true, filter: false, minWidth: 110, autoHeight: true, wrapText: true };
  readonly colDefs = computed<ColDef<MessageSummaryDto>[]>(() => {
    const web = !this.isCoarse && !this.isPhone;
    const qc = this.tab() === 'qc';
    const canAttach = !qc && this.auth.hasAnyPermission(['enter_result', 'edit_result']);
    const cell = (main: string, sub?: string, cls = '') =>
      `<div class="pf-ar-cell"><span class="${cls}">${esc(main)}</span>${sub ? `<span class="pf-ar-cell__sub">${esc(sub)}</span>` : ''}</div>`;
    const cols: ColDef<MessageSummaryDto>[] = [
      { colId: 'sampleId', headerName: qc ? 'Run' : 'Sample ID as sent', flex: 1, minWidth: 150,
        valueGetter: (p) => p.data?.sampleId ?? '',
        cellRenderer: (p: { data?: MessageSummaryDto }) => cell(p.data?.sampleId || (qc ? 'QC' : '(no ID)'), p.data?.instrumentName, 'pf-ar-cell__id') },
      { colId: 'receivedAt', headerName: 'Received', width: 160, minWidth: 140, flex: 0, sort: 'desc',
        valueGetter: (p) => p.data?.receivedAt ?? '',
        cellRenderer: (p: { data?: MessageSummaryDto }) => cell(fmtIst(p.data?.receivedAt), p.data?.runAt ? `Run ${fmtIst(p.data.runAt, 'h:mm a')}` : '') },
      { colId: 'results', headerName: 'Results', width: 120, minWidth: 110, flex: 0,
        valueGetter: (p) => p.data?.resultCount ?? 0,
        cellRenderer: (p: { data?: MessageSummaryDto }) => cell(plural(p.data?.resultCount ?? 0, 'result'),
          (p.data?.unmappedCodes?.length ?? 0) > 0 ? `${p.data!.unmappedCodes!.length} unmapped` : '') },
      { colId: 'preview', headerName: 'Preview', flex: 2, minWidth: 220,
        valueGetter: (p) => (p.data ? previewSummary(p.data) : ''),
        cellRenderer: (p: { data?: MessageSummaryDto }) => `<div class="pf-ar-cell"><span class="pf-num">${esc(p.data ? previewSummary(p.data) : '')}</span></div>` },
    ];
    if (canAttach) cols.push({
      colId: 'actions', headerName: '', sortable: false, resizable: false, pinned: 'right', lockPinned: true,
      width: web ? 150 : 64, minWidth: web ? 150 : 64, flex: 0, cellClass: 'pf-ar-actcell',
      cellRenderer: (p: { data?: MessageSummaryDto }) =>
        `<button type="button" class="pf-rowact${web ? '' : ' pf-rowact--icon'}" data-act="attach" aria-label="Attach to sample — ${esc(p.data?.sampleId || 'run')}" title="Attach to sample">` +
        `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>` +
        `<span class="pf-rowact__t">Attach to sample</span></button>`,
    });
    if (this.isPhone) return cols.filter((c) => c.colId !== 'results' && c.colId !== 'receivedAt');
    return cols;
  });

  constructor() {
    effect(() => { this.tab(); this.load(); });
  }

  setTab(t: AnalyzerTab) { if (t !== this.tab()) { this.q.set(''); this.tab.set(t); } }

  load() {
    this.loading.set(true);
    this.api.messages({ state: this.tab(), page: 1, pageSize: 100 }).subscribe({
      next: (page) => {
        this.rows.set(page?.items ?? []);
        this.total.set(page?.total ?? (page?.items?.length ?? 0));
        this.loading.set(false);
      },
      error: (err) => { this.loading.set(false); this.toasts.error(ApiError.from(err).message); },
    });
  }

  onCellClicked(ev: CellClickedEvent<MessageSummaryDto>) {
    const target = (ev.event?.target as HTMLElement | null)?.closest?.('[data-act]') as HTMLElement | null;
    if (target?.dataset['act'] === 'attach' && ev.data && this.tab() === 'unmatched') this.attachFor.set(ev.data);
  }

  async onBarcode(m: MessageSummaryDto, barcode: string) {
    this.attachFor.set(null);
    // A tube QR (`MRN|SampleID`) → the Sample ID.
    const code = normalizeTubeScan(barcode);
    if (!code || this.attaching.has(m.id)) return;
    const ok = await this.dialog.confirm({
      title: `Attach this run to sample ${code}?`, tone: 'primary', confirmLabel: 'Attach',
      message: `${plural(m.resultCount, 'result')} from ${m.instrumentName} (sent as “${m.sampleId || 'no ID'}”) will prefill that sample's result entry. Nothing is submitted.`,
    });
    if (!ok) return;
    this.attaching.add(m.id);
    this.api.attach(m.id, code).subscribe({
      next: (updated) => {
        this.attaching.delete(m.id);
        this.toasts.success(`Attached to sample ${code}`);
        // No longer unmatched → leaves this list.
        if (updated?.state && updated.state !== 'unmatched') {
          this.rows.update((list) => list.filter((r) => r.id !== m.id));
          this.total.update((n) => Math.max(0, n - 1));
        } else {
          this.load();
        }
      },
      error: (err) => { this.attaching.delete(m.id); this.toasts.error(ApiError.from(err).message); },
    });
  }
}
