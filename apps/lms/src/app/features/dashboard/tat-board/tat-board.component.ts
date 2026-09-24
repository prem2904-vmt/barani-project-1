import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { TatIndicatorComponent } from '../../../shared/components/tat-indicator/tat-indicator.component';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ChipComponent, ChipTone } from '../../../shared/primitives/chip.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent, TileTone } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { KpiStripComponent } from '../../../shared/components/kpi-strip/kpi-strip.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { ThemeService } from '../../../core/services/theme.service';
import { bandFilter } from '../../../shared/utils/band-search';

type TatLevel = 'urgent' | 'high' | 'normal';
type LevelFilter = 'all' | TatLevel;

interface TatRow {
  orderTestId: string;
  orderId?: string;
  patient?: string;
  test?: string;
  status: string;
  receivedAtLab?: string;
  elapsedMinutes: number;
  remainingMinutes: number | null;
  level: 'urgent' | 'high' | 'normal';
}
interface TatSummary { total: number; urgent: number; high: number; normal: number; }

@Component({
  selector: 'pf-tat-board',
  standalone: true,
  imports: [
    DatePipe,
    TatIndicatorComponent,
    AvatarComponent,
    ChipComponent,
    ScreenHeaderComponent,
    TileComponent,
    TouchButtonComponent,
    KpiStripComponent,
    HeroBandComponent,
    SegmentedComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tat-page pf-band-page px-4 md:px-8 pt-6">
      @if (theme.isNewDesign()) {
        <!-- Band (owner): the pill searches the in-flight tests; the
             urgency filter (dots + counts) rides inside it; Refresh is a
             quiet band action. -->
        <pf-hero-band [back]="true" placeholder="Search patient, test or status…"
                      [value]="q()" (valueChange)="q.set($event)">
          <ng-container band-tools>
            <pf-segmented size="sm" [options]="levelOptions()" [value]="levelFilter()"
                          (valueChange)="levelFilter.set($event)"></pf-segmented>
          </ng-container>
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" (click)="refresh()"
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

      <div class="tat-chrome">
        <pf-kpi-strip screen="tat_board"></pf-kpi-strip>

        <pf-screen-header class="pf-classic-only"
          eyebrow="Live dashboard"
          title="TAT Board"
          subtitle="Turnaround health across in-flight tests. Auto-refresh every 30s.">
          <pf-touch-btn actions size="sm" variant="secondary" (pressed)="refresh()">
            <span icon-left aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/>
                <path d="M21 3v5h-5"/>
                <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/>
                <path d="M3 21v-5h5"/>
              </svg>
            </span>
            Refresh
          </pf-touch-btn>
        </pf-screen-header>
      </div>

      <!-- Hard-coded KPI tiles removed — admin-configurable KPIs render
           via <pf-kpi-strip screen="tat_board"> at the top of the page. -->

      <div class="tat-scroll pf-band-body pb-10">
      @for (level of levels; track level) {
        @let rowsForLevel = rowsFor(level);
        @if (rowsForLevel.length > 0) {
          <div class="mb-7">
            <div class="flex items-center gap-2 mb-3 px-1">
              <span class="urg-dot" [class]="'urg-' + level"></span>
              <span class="text-[11px] font-mono uppercase tracking-[0.16em]"
                    style="color: var(--text-secondary);">{{ levelLabel(level) }}</span>
              <span class="text-[11px] font-mono"
                    style="color: var(--text-muted);">· {{ rowsForLevel.length }}</span>
            </div>

            <div class="space-y-2">
              @for (r of rowsForLevel; track r.orderTestId) {
                <pf-tile [tone]="rowTone(level)" padding="md">
                  <div class="flex items-center gap-3 flex-wrap md:flex-nowrap">
                    <pf-avatar [name]="r.patient ?? '—'" [size]="40"></pf-avatar>

                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 flex-wrap">
                        <p class="font-semibold text-[14.5px] truncate"
                           style="color: var(--text-primary);">{{ r.test ?? 'Test' }}</p>
                        <pf-chip [tone]="statusTone(r.status)" size="sm">{{ r.status }}</pf-chip>
                      </div>
                      <p class="text-[12px] mt-0.5 truncate"
                         style="color: var(--text-tertiary);">
                        {{ r.patient ?? '—' }}
                        · received {{ r.receivedAtLab ? (r.receivedAtLab | date:'shortTime') : '—' }}
                      </p>
                    </div>

                    <pf-tat-indicator [tatLevel]="r.level" [remainingMinutes]="r.remainingMinutes"></pf-tat-indicator>
                  </div>
                </pf-tile>
              }
            </div>
          </div>
        }
      }

      @if (rows().length > 0 && visibleCount() === 0) {
        <p class="pf-band-empty">No tests match this search / filter.</p>
      }
      @if (rows().length === 0) {
        <pf-tile tone="default" padding="xl">
          <div class="text-center py-6">
            <p class="text-[14px]" style="color: var(--text-secondary);">
              No active tests right now.
            </p>
          </div>
        </pf-tile>
      }
      </div>
    </section>
  `,
  styles: [`
    .kpi-label {
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      color: var(--text-muted);
      margin: 0 0 4px;
    }
    .kpi-value {
      margin: 0;
      font-size: 28px;
      line-height: 1;
      font-weight: 600;
      color: var(--text-primary);
      font-variant-numeric: tabular-nums;
    }

    .urg-dot {
      width: 8px;
      height: 8px;
      border-radius: 9999px;
      display: inline-block;
    }
    .urg-urgent { background: #ef4444; box-shadow: 0 0 12px rgba(239, 68, 68, 0.6); }
    .urg-high   { background: #f59e0b; box-shadow: 0 0 12px rgba(245, 158, 11, 0.55); }
    .urg-normal { background: #10b981; box-shadow: 0 0 10px rgba(16, 185, 129, 0.5); }

    /* ---- WORK page: non-scroll app layout on all sizes ----
       The page fills the shell main area exactly; the outer page never
       scrolls. The KPI strip + screen-header are fixed chrome; only the
       level groups scroll, inside .tat-scroll. Works the same at phone,
       iPad and desktop (rows already stack via flex-wrap md:flex-nowrap
       + min-w-0 + truncate, so no horizontal overflow). */
    :host {
      display: block;
      height: 100%;
    }
    .tat-page {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }
    .tat-chrome {
      flex: 0 0 auto;
    }
    .tat-scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      -webkit-overflow-scrolling: touch;
    }
    /* No bottom-nav / safe-area padding here: the shell's .shell-main
       resolves :host height against its content box (it already reserves
       --tab-nav-total-height + safe-area as its own padding-bottom), so
       this page fits exactly above the nav. The inner .pb-10 on .tat-scroll
       gives the last row breathing room without double-padding. */

    /* ---- Phone (<=640px): full-page scroll, additive override ----
       The desktop/iPad "fixed chrome + inner scroll" app layout above is
       left untouched (no rule outside this block changes). On a phone the
       pinned KPI strip + header would consume a large share of the small
       viewport and trap the list in a cramped inner scroll window. Below
       the breakpoint we let the whole page flow and scroll inside
       .shell-main (which already reserves --tab-nav-total-height so the
       last row clears the floating bottom pill), giving the list the full
       height and a natural single-pane scroll. Scoped to this page's own
       selectors so nothing global/shared is affected. */
    @media (max-width: 640px) {
      :host { height: auto; }
      .tat-page {
        height: auto;
        overflow: visible;
      }
      .tat-scroll {
        flex: 0 0 auto;
        min-height: 0;
        overflow-y: visible;
      }
    }
  `]
})
export class TatBoardComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  protected readonly theme = inject(ThemeService);

  /** Band pill: search (patient / test / status) + urgency filter. */
  readonly q = signal('');
  readonly levelFilter = signal<LevelFilter>('all');
  private readonly matched = computed(() =>
    bandFilter(this._rows(), this.q(), (r) => [r.patient, r.test, r.status, r.status?.replace(/_/g, ' ')]));
  readonly visibleCount = computed(() => {
    const f = this.levelFilter();
    return this.matched().filter((r) => f === 'all' || r.level === f).length;
  });
  readonly levelOptions = computed<SegmentedOption<LevelFilter>[]>(() => {
    const m = this.matched();
    const n = (l: TatLevel) => m.filter((r) => r.level === l).length;
    return [
      { value: 'all', label: 'All', count: m.length },
      { value: 'urgent', label: 'Urgent', dot: '#ef4444', count: n('urgent') },
      { value: 'high', label: 'High', dot: '#f59e0b', count: n('high') },
      { value: 'normal', label: 'Within TAT', dot: '#10b981', count: n('normal') },
    ];
  });

  readonly levels: Array<'urgent' | 'high' | 'normal'> = ['urgent', 'high', 'normal'];

  private readonly _summary = signal<TatSummary | null>(null);
  private readonly _rows = signal<TatRow[]>([]);
  readonly rows = this._rows.asReadonly();

  private _interval?: ReturnType<typeof setInterval>;

  ngOnInit() {
    this.refresh();
    this._interval = setInterval(() => this.refresh(), 30_000);
  }
  ngOnDestroy() { if (this._interval) clearInterval(this._interval); }

  rowsFor(level: 'urgent' | 'high' | 'normal'): TatRow[] {
    const f = this.levelFilter();
    if (f !== 'all' && f !== level) return [];
    return this.matched().filter(r => r.level === level);
  }

  levelLabel(level: 'urgent' | 'high' | 'normal'): string {
    return level === 'urgent' ? 'Urgent' : level === 'high' ? 'High' : 'Within TAT';
  }

  rowTone(level: 'urgent' | 'high' | 'normal'): TileTone {
    return level === 'urgent' ? 'rose' : level === 'high' ? 'amber' : 'default';
  }

  statusTone(status: string): ChipTone {
    switch (status) {
      case 'validated': return 'emerald';
      case 'entered':   return 'violet';
      case 'rejected':  return 'rose';
      case 'in_progress':
      case 'received':  return 'amber';
      default:          return 'default';
    }
  }

  refresh() {
    this.api.get<{ summary: TatSummary; rows: TatRow[] }>('/api/dashboard/tat').subscribe({
      next: r => { this._summary.set(r.summary); this._rows.set(r.rows ?? []); }
    });
  }
}
