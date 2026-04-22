import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { TatIndicatorComponent } from '../../../shared/components/tat-indicator/tat-indicator.component';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ChipComponent, ChipTone } from '../../../shared/primitives/chip.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent, TileTone } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

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
interface StatsSummary { ordersToday: number; patientsToday: number; pendingValidations: number; reportsDelivered: number; }

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
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10">

      <pf-screen-header
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

      <!-- KPI strip -->
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <pf-tile tone="violet" padding="md">
          <p class="kpi-label">In flight</p>
          <p class="kpi-value">{{ summary()?.total ?? 0 }}</p>
        </pf-tile>
        <pf-tile tone="rose" padding="md">
          <p class="kpi-label">Urgent</p>
          <p class="kpi-value">{{ summary()?.urgent ?? 0 }}</p>
        </pf-tile>
        <pf-tile tone="amber" padding="md">
          <p class="kpi-label">High</p>
          <p class="kpi-value">{{ summary()?.high ?? 0 }}</p>
        </pf-tile>
        <pf-tile tone="emerald" padding="md">
          <p class="kpi-label">Normal</p>
          <p class="kpi-value">{{ summary()?.normal ?? 0 }}</p>
        </pf-tile>
        <pf-tile tone="sky" padding="md">
          <p class="kpi-label">Delivered</p>
          <p class="kpi-value">{{ stats()?.reportsDelivered ?? 0 }}</p>
        </pf-tile>
      </div>

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

      @if (rows().length === 0) {
        <pf-tile tone="default" padding="xl">
          <div class="text-center py-6">
            <p class="text-[14px]" style="color: var(--text-secondary);">
              No active tests right now.
            </p>
          </div>
        </pf-tile>
      }
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
  `]
})
export class TatBoardComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);

  readonly levels: Array<'urgent' | 'high' | 'normal'> = ['urgent', 'high', 'normal'];

  private readonly _summary = signal<TatSummary | null>(null);
  private readonly _rows = signal<TatRow[]>([]);
  private readonly _stats = signal<StatsSummary | null>(null);
  readonly summary = this._summary.asReadonly();
  readonly rows = this._rows.asReadonly();
  readonly stats = this._stats.asReadonly();

  private _interval?: ReturnType<typeof setInterval>;

  ngOnInit() {
    this.refresh();
    this._interval = setInterval(() => this.refresh(), 30_000);
  }
  ngOnDestroy() { if (this._interval) clearInterval(this._interval); }

  rowsFor(level: 'urgent' | 'high' | 'normal'): TatRow[] {
    return this._rows().filter(r => r.level === level);
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
    this.api.get<StatsSummary>('/api/dashboard/stats').subscribe({ next: s => this._stats.set(s) });
  }
}
