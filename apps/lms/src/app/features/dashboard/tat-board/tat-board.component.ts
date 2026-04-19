import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { TatIndicatorComponent } from '../../../shared/components/tat-indicator/tat-indicator.component';

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
  imports: [DatePipe, TatIndicatorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-8 max-w-7xl">
      <header class="flex items-center justify-between mb-4">
        <div>
          <h1 class="text-2xl font-semibold">TAT Dashboard</h1>
          <p class="text-sm text-slate-600">Live turnaround — auto-refresh every 30s.</p>
        </div>
        <button class="pf-btn pf-btn-ghost text-xs" (click)="refresh()">↻ Refresh now</button>
      </header>

      <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <div class="pf-card">
          <p class="text-[11px] uppercase tracking-wider text-slate-500">Total in flight</p>
          <p class="text-2xl font-semibold">{{ summary()?.total ?? 0 }}</p>
        </div>
        <div class="pf-card">
          <p class="text-[11px] uppercase tracking-wider text-red-500">Urgent</p>
          <p class="text-2xl font-semibold text-red-600">{{ summary()?.urgent ?? 0 }}</p>
        </div>
        <div class="pf-card">
          <p class="text-[11px] uppercase tracking-wider text-orange-500">High</p>
          <p class="text-2xl font-semibold text-orange-600">{{ summary()?.high ?? 0 }}</p>
        </div>
        <div class="pf-card">
          <p class="text-[11px] uppercase tracking-wider text-emerald-600">Normal</p>
          <p class="text-2xl font-semibold text-emerald-600">{{ summary()?.normal ?? 0 }}</p>
        </div>
        <div class="pf-card">
          <p class="text-[11px] uppercase tracking-wider text-slate-500">Delivered today</p>
          <p class="text-2xl font-semibold">{{ stats()?.reportsDelivered ?? 0 }}</p>
        </div>
      </div>

      @for (level of levels; track level) {
        @let rows = rowsFor(level);
        @if (rows.length > 0) {
          <div class="mb-6">
            <h3 class="text-xs uppercase tracking-wider text-slate-500 mb-2">
              {{ emoji(level) }} {{ level }} · {{ rows.length }}
            </h3>
            <div class="pf-card p-0 overflow-hidden">
              <table class="w-full text-sm">
                <thead class="bg-slate-50">
                  <tr class="text-left">
                    <th class="px-3 py-2 font-medium">Patient</th>
                    <th class="px-3 py-2 font-medium">Test</th>
                    <th class="px-3 py-2 font-medium">Status</th>
                    <th class="px-3 py-2 font-medium">Received</th>
                    <th class="px-3 py-2 font-medium text-right">TAT</th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of rows; track r.orderTestId) {
                    <tr class="border-t border-slate-100">
                      <td class="px-3 py-2">{{ r.patient ?? '—' }}</td>
                      <td class="px-3 py-2 font-medium">{{ r.test }}</td>
                      <td class="px-3 py-2 text-slate-600">{{ r.status }}</td>
                      <td class="px-3 py-2 text-slate-600">{{ r.receivedAtLab ? (r.receivedAtLab | date:'shortTime') : '—' }}</td>
                      <td class="px-3 py-2 text-right">
                        <pf-tat-indicator [tatLevel]="r.level" [remainingMinutes]="r.remainingMinutes"></pf-tat-indicator>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }
      }

      @if (rows().length === 0) {
        <div class="pf-card text-center text-sm text-slate-500 py-10">No active tests right now.</div>
      }
    </section>
  `
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
  emoji(level: string) { return level === 'urgent' ? '🔴' : level === 'high' ? '🟠' : '🟢'; }

  refresh() {
    this.api.get<{ summary: TatSummary; rows: TatRow[] }>('/api/dashboard/tat').subscribe({
      next: r => { this._summary.set(r.summary); this._rows.set(r.rows ?? []); }
    });
    this.api.get<StatsSummary>('/api/dashboard/stats').subscribe({ next: s => this._stats.set(s) });
  }
}
