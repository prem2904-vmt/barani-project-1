import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router } from '@angular/router';
import type { CellClickedEvent, ColDef, GetRowIdParams, ICellRendererParams } from 'ag-grid-community';
import { finalize } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { ThemeService } from '../../../core/services/theme.service';
import { DataGridComponent } from '../../../shared/components/data-grid/data-grid.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { KpiStripComponent } from '../../../shared/components/kpi-strip/kpi-strip.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { SkeletonRowsComponent } from '../../../shared/primitives/skeleton-kit.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { SG_ICON, SG_NARROW_MQ, SG_PHONE_MQ, sgActions, sgActionsCol, sgCell, sgMedia } from '../../../shared/settings-grid/settings-grid';
import { bandFilter } from '../../../shared/utils/band-search';
import { busyWhile } from '../../../shared/utils/busy';
import { createLoadHold } from '../../../shared/utils/min-duration';
import { plural } from '../../../shared/utils/plural';
import {
  BucketCount, DeptCount, SampleGroup, TatBucket, TatLine, TatMode,
  bucketCounts, clockWords, defaultBucket, deptCounts, dueAtOf, dueInWords, groupBySample, inBucket, lateMinutes, lateWords,
  lineHaystack, sortLines, sortSamples, statusWord, testsSummary, toLine,
} from './tat-board.logic';

interface TatApiRow {
  orderTestId: string; orderId?: string; patient?: string; test?: string; status: string; receivedAtLab?: string;
  elapsedMinutes: number; remainingMinutes: number | null; level: string;
}
interface TatSummary { total: number; urgent: number; high: number; normal: number; }
interface CatalogTest { name: string; departmentId?: string | null; parameters?: string | null; }
interface Dept { id: string; name: string; }

/** One grid row: a sample (an order's tests in one department) or, in "By test", one test line. */
export interface TatGridRow {
  id: string;
  patient: string;
  head: string;
  names: string;
  dept: string;
  receivedAt: number | null;
  dueAt: number | null;
  lateMin: number | null;
  now: string[];
  /** The test line the Open button goes to (the most late of the row). */
  openId: string;
}

const BUCKETS: { id: TatBucket; label: string; sub: string; tone: string }[] = [
  { id: 'overdue', label: 'Overdue', sub: 'Past the promised time', tone: 'rose' },
  { id: 'dueSoon', label: 'Due within 1 hour', sub: 'Act now to stay on time', tone: 'violet' },
  { id: 'onTrack', label: 'On track', sub: 'Inside the turnaround', tone: 'green' },
  { id: 'all', label: 'All in progress', sub: 'Everything in the lab now', tone: 'muted' },
];

const NOW_TONE: Record<string, string> = {
  'Waiting for result': 'muted', 'In progress': 'violet', 'Waiting to validate': 'violet', 'Culture incubating': 'muted',
  'Result being re-entered': 'violet', 'Rejected, needs a new sample': 'rose',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Samples as grid rows. */
export function sampleRows(groups: readonly SampleGroup[]): TatGridRow[] {
  return groups.map((g) => {
    const t = testsSummary(g.lines);
    const lead = g.lines.slice().sort((a, b) => (lateMinutes(b) ?? -Infinity) - (lateMinutes(a) ?? -Infinity))[0];
    return { id: g.key, patient: g.patient || '—', head: t.head, names: t.names, dept: g.deptName ?? '—', receivedAt: g.receivedAt,
      dueAt: g.dueAt, lateMin: g.lateMin, now: g.nowWords, openId: lead.orderTestId };
  });
}
/** Test lines as grid rows ("By test": today's per-test granularity). */
export function testRows(lines: readonly TatLine[], now: number): TatGridRow[] {
  return lines.map((l) => ({ id: l.orderTestId, patient: l.patient || '—', head: l.test || 'Test', names: '', dept: l.deptName ?? '—',
    receivedAt: l.receivedAtLab ? new Date(l.receivedAtLab).getTime() : null, dueAt: dueAtOf(l, now), lateMin: lateMinutes(l),
    now: [statusWord(l.status, l.culture)], openId: l.orderTestId }));
}

/**
 * Turnaround (the TAT board). Test Master's frame: the band (lab logo + name, search pill, Refresh), the TURNAROUND
 * side card on the LEFT (Overdue / Due within 1 hour / On track / All in progress, then the departments with their
 * late counts) and the SAMPLES main card on the right: a pf-data-grid by sample or by test. "Now" speaks plain
 * words, never the raw status. The data, the 30 s poll and the Refresh are the board's own, unchanged; the
 * department and culture flag come from a best-effort read of the Test Master (blank when it isn't readable).
 */
@Component({
  selector: 'pf-tat-board',
  standalone: true,
  imports: [NgTemplateOutlet, DataGridComponent, HeroBandComponent, KpiStripComponent, ScreenHeaderComponent, SegmentedComponent,
    SkeletonRowsComponent, TouchButtonComponent, BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../../shared/settings-grid/settings-grid.scss'],
  template: `
    <section class="pf-tat pf-band-page px-4 md:px-8 pt-6 pb-10" data-testid="tat-page">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" placeholder="Search patient, sample number or test…"
                      [value]="q()" (valueChange)="q.set($event)">
          <ng-container band-tools>
            @if (narrow()) {
              <button type="button" class="pf-chip pf-sg-chip press" (click)="sheetOpen.set(true)" aria-haspopup="dialog"
                      [attr.aria-expanded]="sheetOpen()" title="Turnaround" data-testid="tat-sheet-chip">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                {{ bucketLabel() }}
              </button>
            }
          </ng-container>
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" [disabled]="refreshing()"
                    [pfBusy]="refreshing()" pfBusyLabel="Refreshing…" (click)="refresh(true)"
                    aria-label="Refresh" title="Refresh">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/>
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>
              </svg>
              Refresh
            </button>
          </ng-container>
        </pf-hero-band>
      }

      <pf-kpi-strip screen="tat_board"></pf-kpi-strip>

      <pf-screen-header class="pf-classic-only"
        eyebrow="Live dashboard"
        title="Turnaround"
        subtitle="Turnaround health across in-flight tests. Auto-refresh every 30s.">
        <pf-touch-btn actions size="sm" variant="secondary" [busy]="refreshing()" busyLabel="Refreshing…" (pressed)="refresh(true)">
          <span icon-left aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/><path d="M3 21v-5h5"/>
            </svg>
          </span>
          Refresh
        </pf-touch-btn>
      </pf-screen-header>

      <div class="pf-band-body pf-band-body--fill">
        <div class="pf-sg-panels" [class.pf-sg-panels--narrow]="narrow()">
          @if (narrow()) {
            @if (sheetOpen()) {
              <div class="pf-sheet-backdrop" (click)="sheetOpen.set(false)"></div>
              <aside class="pf-card pf-sg-side pf-sg-side--sheet pf-tat__side" role="dialog" aria-modal="true" aria-label="Turnaround"
                     data-testid="tat-side" (keydown.escape)="sheetOpen.set(false)">
                <span class="pf-sg-sheet-handle" aria-hidden="true"></span>
                <ng-container *ngTemplateOutlet="sideCard; context: { sheet: true }"></ng-container>
              </aside>
            }
          } @else {
            <aside class="pf-card pf-sg-side pf-tat__side" aria-label="Turnaround" data-testid="tat-side">
              <ng-container *ngTemplateOutlet="sideCard; context: { sheet: false }"></ng-container>
            </aside>
          }

          <section class="pf-card pf-sg-main pf-tat__main" aria-label="Samples" data-testid="tat-main">
            <header class="pf-card__head pf-sg-main__head">
              <span class="pf-card__icon" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/></svg>
              </span>
              <span class="pf-card__label">{{ mode() === 'sample' ? 'Samples' : 'Tests' }}</span>
              <span class="pf-card__note pf-tat__summary" data-testid="tat-summary">{{ summary() }}</span>
              <span class="pf-card__spacer"></span>
              <pf-segmented class="pf-sg-status-filter" size="sm" [options]="modeOptions" [value]="mode()"
                            ariaLabel="Group by" (valueChange)="mode.set($event)"></pf-segmented>
            </header>
            <div class="pf-sg-main__body">
              <pf-data-grid [rowData]="gridRows()" [columnDefs]="colDefs()" [getRowId]="rowId" [clickable]="true"
                            [loading]="firstLoad() && lines().length === 0" loadingLabel="Loading the board…"
                            [emptyTitle]="emptyTitle()" [emptyBody]="emptyBody()"
                            (cellClicked)="onCell($event)"></pf-data-grid>
            </div>
          </section>
        </div>
      </div>
    </section>

    <ng-template #sideCard let-sheet="sheet">
      <header class="pf-card__head">
        <span class="pf-card__icon" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
        </span>
        <span class="pf-card__label">Turnaround</span>
        <span class="pf-card__spacer"></span>
        @if (sheet) {
          <button type="button" class="pf-btn pf-btn--icon" (click)="sheetOpen.set(false)" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        }
      </header>
      <div class="pf-card__body pf-tat__sidebody">
        @if (firstLoad() && lines().length === 0) {
          <pf-skeleton-rows [rows]="4" [avatar]="false" [trailing]="true" label="Loading the board…"></pf-skeleton-rows>
        } @else {
          <ul class="pf-side-list pf-tat__buckets" aria-label="Turnaround buckets">
            @for (b of bucketRows(); track b.id) {
              <li>
                <button type="button" class="pf-side-item pf-tat__bucket" [attr.aria-pressed]="bucket() === b.id" [attr.data-testid]="'tat-bucket-' + b.id"
                        (click)="pickBucket(b.id); sheetOpen.set(false)">
                  <span class="pf-tat__dot" [attr.data-tone]="b.tone" aria-hidden="true"></span>
                  <span class="pf-tat__btext">
                    <span class="pf-tat__blabel">{{ b.label }}</span>
                    <span class="pf-tat__bsub">{{ b.sub }}</span>
                  </span>
                  <span class="pf-tat__bcount pf-num">{{ b.count }}</span>
                </button>
              </li>
            }
          </ul>
          @if (depts().length > 0) {
            <h3 class="pf-sg-side__sec pf-tat__sec">Department</h3>
            <ul class="pf-side-list pf-tat__depts" aria-label="Departments">
              @for (d of depts(); track d.id) {
                <li>
                  <button type="button" class="pf-side-item pf-tat__dept" [attr.aria-pressed]="dept() === d.id" [attr.data-testid]="'tat-dept-' + d.id"
                          (click)="pickDept(d.id); sheetOpen.set(false)">
                    <span class="pf-tat__dname">{{ d.name }}</span>
                    @if (d.late > 0) { <span class="pf-tat__late">{{ d.late }} late</span> }
                    <span class="pf-tat__dcount pf-num">{{ d.samples }}</span>
                  </button>
                </li>
              }
            </ul>
          }
        }
      </div>
    </ng-template>
  `,
  styles: [`
    .pf-tat__summary { min-width: 0; overflow-wrap: anywhere; color: var(--text-tertiary); }
    @media (max-width: 640px) { .pf-tat__summary { display: none; } }
    .pf-tat__sidebody { padding: 8px !important; gap: 4px !important; }
    .pf-tat__sidebody .pf-side-list { padding: 0; }
    .pf-tat__bucket { min-height: 52px; }
    .pf-tat__btext { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; text-align: left; }
    .pf-tat__blabel { overflow-wrap: anywhere; }
    .pf-tat__bsub { font-size: 11.5px; font-weight: 400; color: var(--text-tertiary); }
    .pf-tat__bcount { flex: none; font-size: 13px; color: var(--text-secondary); font-variant-numeric: tabular-nums; text-align: right; }
    .pf-tat__dot { flex: none; width: 8px; height: 8px; border-radius: 999px; background: var(--text-muted); }
    .pf-tat__dot[data-tone='rose'] { background: var(--rose-text); }
    .pf-tat__dot[data-tone='violet'] { background: var(--violet-text); }
    .pf-tat__dot[data-tone='green'] { background: var(--green-text); }
    .pf-tat__sec { padding: 12px 10px 4px; border-top: 1px solid var(--pf-line); margin-top: 6px !important; }
    .pf-tat__dept { min-height: 44px; }
    .pf-tat__dname { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; text-align: left; }
    .pf-tat__late { flex: none; font-size: 11.5px; color: var(--rose-text); }
    .pf-tat__dcount { flex: none; min-width: 28px; text-align: right; font-size: 12px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }

    :host ::ng-deep .pf-tat-late { color: var(--rose-text); font-weight: 600; font-variant-numeric: tabular-nums; }
    :host ::ng-deep .pf-tat-num { font-variant-numeric: tabular-nums; color: var(--text-secondary); }
    :host ::ng-deep .pf-tat-now { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; padding: 6px 0; min-width: 0; }
    :host ::ng-deep .pf-tat-now__more { white-space: normal; overflow-wrap: anywhere; }
    :host ::ng-deep .pf-tat-pill {
      display: inline-flex; align-items: center; gap: 6px; min-height: 26px; padding: 2px 10px; border-radius: 999px;
      border: 1px solid var(--pf-line); background: var(--pf-chip-bg); color: var(--text-secondary); font-size: 12px; line-height: 1.3; white-space: nowrap;
    }
    :host ::ng-deep .pf-tat-pill__dot { flex: none; width: 7px; height: 7px; border-radius: 999px; background: var(--text-muted); }
    :host ::ng-deep .pf-tat-pill__dot[data-tone='violet'] { background: var(--violet-text); }
    :host ::ng-deep .pf-tat-pill__dot[data-tone='rose'] { background: var(--rose-text); }
  `],
})
export class TatBoardComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  protected readonly theme = inject(ThemeService);

  readonly narrow = sgMedia(SG_NARROW_MQ);
  private readonly phone = sgMedia(SG_PHONE_MQ);
  /** iPad landscape and narrower: Department and Received step aside so the row fits without a sideways scroll. */
  private readonly mid = sgMedia('(max-width: 1280px)');
  private readonly web = typeof window === 'undefined' || !window.matchMedia || !window.matchMedia('(pointer: coarse)').matches;
  readonly sheetOpen = signal(false);

  /** Band pill search: patient, sample, test, department, plain-words status. */
  readonly q = signal('');
  readonly mode = signal<TatMode>('sample');
  readonly modeOptions: SegmentedOption<TatMode>[] = [{ value: 'sample', label: 'By sample' }, { value: 'test', label: 'By test' }];
  private readonly picked = signal<TatBucket | null>(null);
  readonly dept = signal<string | null>(null);

  private readonly _summary = signal<TatSummary | null>(null);
  private readonly _rows = signal<TatApiRow[]>([]);
  /** Test Master lookup by test name (best-effort; empty when unreadable). */
  private readonly catalog = signal<Map<string, { deptId: string | null; culture: boolean }>>(new Map());
  private readonly deptNames = signal<Map<string, string>>(new Map());
  /** The clock the derived words use; ticks with every refresh. */
  private readonly now = signal(Date.now());

  /** Every in-flight line, enriched. */
  readonly lines = computed<TatLine[]>(() => {
    const cat = this.catalog();
    const names = this.deptNames();
    return this._rows().map((r) => {
      const hit = cat.get((r.test ?? '').trim().toLowerCase());
      const id = hit?.deptId ?? null;
      return { ...toLine(r), deptId: id, deptName: id ? names.get(id) ?? null : null, culture: hit?.culture ?? false };
    });
  });
  private readonly matched = computed(() => bandFilter(this.lines(), this.q(), lineHaystack));
  readonly counts = computed(() => bucketCounts(this.matched(), this.now()));
  /** The bucket on show: the person's pick, else Overdue when anything is late, else everything. */
  readonly bucket = computed<TatBucket>(() => this.picked() ?? defaultBucket(this.counts()));
  readonly depts = computed<DeptCount[]>(() => deptCounts(this.matched(), this.now()));
  private readonly shown = computed(() => {
    const d = this.dept();
    const inB = inBucket(this.matched(), this.bucket());
    return d ? inB.filter((l) => (l.deptId ?? l.deptName) === d) : inB;
  });
  readonly gridRows = computed<TatGridRow[]>(() => this.mode() === 'sample'
    ? sampleRows(sortSamples(groupBySample(this.shown(), this.now())))
    : testRows(sortLines(this.shown()), this.now()));

  readonly bucketRows = computed(() => BUCKETS.map((b) => {
    const c: BucketCount = this.counts()[b.id];
    return { ...b, count: c.tests === 0 ? '0' : `${c.samples} · ${plural(c.tests, 'test')}` };
  }));
  /** The narrow screens' chip names the bucket on show (its card is a sheet there). */
  readonly bucketLabel = computed(() => BUCKETS.find((x) => x.id === this.bucket())!.label);
  readonly summary = computed(() => {
    const b = BUCKETS.find((x) => x.id === this.bucket())!;
    const d = this.dept() ? this.depts().find((x) => x.id === this.dept())?.name : null;
    const rows = this.shown();
    const samples = groupBySample(rows, this.now()).length;
    const tail = this.mode() === 'sample' ? `${plural(samples, 'sample')} · ${plural(rows.length, 'test')}` : plural(rows.length, 'test');
    return `${b.label}${d ? ' · ' + d : ''} · ${tail} · latest first`;
  });
  readonly emptyTitle = computed(() => (this.lines().length === 0 ? 'No active tests right now' : 'Nothing here'));
  readonly emptyBody = computed(() => (this.lines().length === 0 ? '' : this.q().trim() ? 'No samples match this search.' : 'No tests in this bucket.'));

  readonly rowId = (p: GetRowIdParams<TatGridRow>) => `${this.mode()}:${p.data.id}`;

  readonly colDefs = computed<ColDef<TatGridRow>[]>(() => {
    const phone = this.phone();
    const now = this.now();
    const web = this.web && !phone;
    const mid = this.mid();
    const blank = () => el('span', '');
    const nowCell = (r: TatGridRow): HTMLElement => {
      const wrap = el('div', 'pf-tat-now');
      const pill = el('span', 'pf-tat-pill');
      const dot = el('span', 'pf-tat-pill__dot');
      dot.setAttribute('data-tone', NOW_TONE[r.now[0]] ?? 'muted');
      dot.setAttribute('aria-hidden', 'true');
      pill.append(dot, document.createTextNode(r.now[0] ?? 'In progress'));
      wrap.append(pill);
      // A sample whose tests sit at different steps: the other steps as a quiet line under the pill.
      if (r.now.length > 1) wrap.append(el('span', 'pf-sg-cell__sub pf-tat-now__more', 'Also: ' + r.now.slice(1).join(', ').toLowerCase()));
      return wrap;
    };
    const actions = sgActionsCol<TatGridRow>(web, ['Open'], 0, (p) => sgActions(web, p.data ? [
      { label: 'Open', aria: `Open ${p.data.patient}`, path: SG_ICON.open, run: () => this.open(p.data!) },
    ] : []));
    // Phones: two columns. The patient with the tests under it, then how late it is with the plain-words step under it.
    if (phone) {
      return [
        { headerName: 'Sample · patient', colId: 'patient', field: 'patient', flex: 1, minWidth: 130,
          cellRenderer: (p: ICellRendererParams<TatGridRow>) => (p.data ? sgCell(p.data.patient, [p.data.head, p.data.names].filter(Boolean).join(': '), true) : blank()) },
        { headerName: 'Late by · now', colId: 'late', valueGetter: (p) => p.data?.lateMin ?? -Infinity, flex: 0, width: 132,
          cellRenderer: (p: ICellRendererParams<TatGridRow>) => {
            if (!p.data) return blank();
            const wrap = el('div', 'pf-sg-cell');
            const late = p.data.lateMin != null && p.data.lateMin >= 0;
            wrap.append(el('span', late ? 'pf-tat-late' : 'pf-tat-num', late ? `Late ${lateWords(p.data.lateMin)}` : dueInWords(p.data.lateMin) ? `Due ${dueInWords(p.data.lateMin)}` : '—'),
              el('span', 'pf-sg-cell__sub', p.data.now.join(', ')));
            return wrap;
          } },
        actions,
      ];
    }
    const cols: ColDef<TatGridRow>[] = [
      { headerName: 'Sample · patient', colId: 'patient', field: 'patient', flex: 1, minWidth: 152,
        cellRenderer: (p: ICellRendererParams<TatGridRow>) => (p.data ? sgCell(p.data.patient, null, true) : blank()) },
      { headerName: 'Tests', colId: 'tests', field: 'head', flex: 1.6, minWidth: 160,
        cellRenderer: (p: ICellRendererParams<TatGridRow>) => (p.data ? sgCell(p.data.head, p.data.names || null, true) : blank()) },
      { headerName: 'Department', colId: 'dept', field: 'dept', flex: 0, width: 125, hide: mid,
        cellRenderer: (p: ICellRendererParams<TatGridRow>) => (p.data ? el('span', 'pf-tat-num', p.data.dept) : blank()) },
      { headerName: 'Received', colId: 'received', valueGetter: (p) => p.data?.receivedAt ?? 0, flex: 0, width: 105, hide: mid,
        cellRenderer: (p: ICellRendererParams<TatGridRow>) => (p.data ? el('span', 'pf-tat-num', clockWords(p.data.receivedAt, now)) : blank()) },
      { headerName: 'Due', colId: 'due', valueGetter: (p) => p.data?.dueAt ?? 0, flex: 0, width: 110,
        cellRenderer: (p: ICellRendererParams<TatGridRow>) => (p.data ? sgCell(clockWords(p.data.dueAt, now), dueInWords(p.data.lateMin) || null) : blank()) },
      { headerName: 'Late by', colId: 'late', valueGetter: (p) => p.data?.lateMin ?? -Infinity, flex: 0, width: 88,
        cellRenderer: (p: ICellRendererParams<TatGridRow>) => (p.data ? el('span', 'pf-tat-late', lateWords(p.data.lateMin)) : blank()) },
      { headerName: 'Now', colId: 'now', valueGetter: (p) => p.data?.now.join(', ') ?? '', flex: 0, width: 180,
        cellRenderer: (p: ICellRendererParams<TatGridRow>) => (p.data ? nowCell(p.data) : blank()) },
      actions,
    ];
    return cols;
  });

  private _interval?: ReturnType<typeof setInterval>;

  ngOnInit() {
    this.refresh();
    this.loadCatalog();
    this._interval = setInterval(() => this.refresh(), 30_000);
  }
  ngOnDestroy() { if (this._interval) clearInterval(this._interval); }

  pickBucket(b: TatBucket) { this.picked.set(b); }
  pickDept(id: string) { this.dept.update((d) => (d === id ? null : id)); }

  open(r: TatGridRow) { void this.router.navigate(['/lab/result', r.openId]); }
  onCell(e: CellClickedEvent<TatGridRow>) {
    if (!e.data || e.column.getColId() === 'actions') return;
    this.open(e.data);
  }

  /** Refresh button pressed: the button is busy until the board answers. */
  readonly refreshing = signal(false);
  /** First load: the board as a skeleton, not "No active tests". */
  private readonly firstHold = createLoadHold(true);
  readonly firstLoad = this.firstHold.active;
  /** `manual` = the Refresh button (the 30s poll stays silent). */
  refresh(manual = false) {
    const req = this.api.get<{ summary: TatSummary; rows: TatApiRow[] }>('/api/dashboard/tat');
    (manual ? req.pipe(busyWhile(this.refreshing)) : req).pipe(finalize(() => this.firstHold.done())).subscribe({
      next: r => {
        this._summary.set(r.summary);
        this._rows.set(r.rows ?? []);
        this.now.set(Date.now());
      }
    });
  }

  /** Department + culture flag by test name: read once, quietly. The board works without them. */
  private loadCatalog() {
    this.api.get<Dept[]>('/api/tenants/departments').subscribe({
      next: (d) => this.deptNames.set(new Map((d ?? []).map((x) => [x.id, x.name]))), error: () => undefined,
    });
    this.api.get<CatalogTest[]>('/api/tests?view=summary').subscribe({
      next: (list) => {
        const m = new Map<string, { deptId: string | null; culture: boolean }>();
        for (const t of list ?? []) {
          let culture = false;
          try { culture = (JSON.parse(t.parameters ?? '{}') as { microFormat?: string }).microFormat === 'culture_sensitivity'; } catch { /* not JSON */ }
          m.set((t.name ?? '').trim().toLowerCase(), { deptId: t.departmentId ?? null, culture });
        }
        this.catalog.set(m);
      },
      error: () => undefined,
    });
  }
}
