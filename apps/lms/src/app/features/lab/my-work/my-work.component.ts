import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { TatIndicatorComponent } from '../../../shared/components/tat-indicator/tat-indicator.component';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent } from '../../../shared/primitives/segmented.component';
import { SkeletonComponent } from '../../../shared/primitives/skeleton.component';
import { TileComponent, TileTone } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { OrderTest } from '../../../shared/models/order.model';

type Tab = 'my_work' | 'service_queue' | 'rejected';
type Level = 'urgent' | 'high' | 'normal';
type Bucket = { level: Level; items: Enriched[] };
type Enriched = OrderTest & { _level: Level; _remainingMin: number };

@Component({
  selector: 'pf-my-work',
  standalone: true,
  imports: [
    DatePipe, TatIndicatorComponent,
    AvatarComponent, ScreenHeaderComponent, SegmentedComponent, SkeletonComponent, TileComponent, TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-5 md:px-8 pt-5 pb-10 max-w-6xl mx-auto">

      <pf-screen-header eyebrow="Lab workbench"
                        subtitle="Your queue, the unassigned pool, and rejected samples.">
        Lab <span class="text-gradient">my work</span>
        <div actions>
          <pf-touch-btn variant="secondary" size="md" (pressed)="refresh()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" icon-left>
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
              <path d="M21 3v5h-5"/>
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
              <path d="M3 21v-5h5"/>
            </svg>
            Refresh
          </pf-touch-btn>
        </div>
      </pf-screen-header>

      <div class="flex items-center justify-between mb-5 flex-wrap gap-3">
        <pf-segmented [options]="tabOptions" [value]="tab()" (valueChange)="setTab($event)"/>
        <p class="text-[11px] font-mono uppercase tracking-[0.14em]"
           style="color: var(--text-muted);">
          {{ rows().length }} items · {{ countFor('my_work') }} mine · {{ countFor('service_queue') }} pool · {{ countFor('rejected') }} rejected
        </p>
      </div>

      @if (loading() && rows().length === 0) {
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          @for (i of [0,1,2,3]; track i) {
            <pf-tile tone="default" padding="md">
              <div class="flex items-start gap-3">
                <pf-skeleton variant="circle" width="40px" height="40px"></pf-skeleton>
                <div class="flex-1 space-y-2">
                  <pf-skeleton variant="line" width="60%"></pf-skeleton>
                  <pf-skeleton variant="line" width="85%" height="10px"></pf-skeleton>
                </div>
              </div>
              <div class="mt-4 flex justify-end">
                <pf-skeleton variant="line" width="96px" height="28px"></pf-skeleton>
              </div>
            </pf-tile>
          }
        </div>
      }

      @for (bucket of buckets(); track bucket.level) {
        @if (bucket.items.length > 0) {
          <div class="mb-6">
            <div class="flex items-center gap-3 mb-3 px-1">
              <span class="pf-dot" [attr.data-level]="bucket.level"></span>
              <h3 class="text-[11px] font-mono uppercase tracking-[0.18em]"
                  style="color: var(--text-secondary);">
                {{ bucket.level }} · {{ bucket.items.length }}
              </h3>
            </div>

            <ul class="grid grid-cols-1 md:grid-cols-2 gap-3">
              @for (t of bucket.items; track t.id) {
                <li>
                  <pf-tile [tone]="toneFor(bucket.level)" padding="md">
                    <div class="flex items-start gap-3">
                      <pf-avatar [name]="t.subOrder?.order?.patient?.name ?? 'Patient'" [size]="40"></pf-avatar>
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                          <p class="text-[15px] font-semibold truncate"
                             style="color: var(--text-primary);">{{ t.test?.name ?? 'Test' }}</p>
                          <pf-tat-indicator [tatLevel]="t._level" [remainingMinutes]="t._remainingMin"/>
                        </div>
                        <p class="text-[12px] font-mono mt-0.5"
                           style="color: var(--text-tertiary);">
                          {{ t.subOrder?.order?.patient?.name ?? '—' }}
                          · {{ t.test?.department?.name ?? '—' }}
                          · rec'd {{ t.subOrder?.receivedAtLab ? (t.subOrder?.receivedAtLab | date:'shortTime') : '—' }}
                        </p>
                      </div>
                    </div>
                    <div class="mt-4 flex justify-end">
                      @switch (tab()) {
                        @case ('service_queue') {
                          <pf-touch-btn variant="secondary" size="sm" (pressed)="pickUp(t)">Pick up</pf-touch-btn>
                        }
                        @case ('rejected') {
                          <pf-touch-btn variant="primary" size="sm" (pressed)="enter(t)">Re-enter</pf-touch-btn>
                        }
                        @default {
                          <pf-touch-btn variant="primary" size="sm" (pressed)="enter(t)">Enter result</pf-touch-btn>
                        }
                      }
                    </div>
                  </pf-tile>
                </li>
              }
            </ul>
          </div>
        }
      }

      @if (!loading() && rows().length === 0) {
        <pf-tile tone="default" padding="xl">
          <p class="text-center text-sm" style="color: var(--text-tertiary);">Nothing in the queue.</p>
        </pf-tile>
      }
    </section>
  `,
  styles: [`
    .pf-dot {
      width: 10px;
      height: 10px;
      border-radius: 9999px;
      flex-shrink: 0;
    }
    .pf-dot[data-level='urgent'] { background: #ef4444; box-shadow: 0 0 12px rgba(239, 68, 68, 0.7); }
    .pf-dot[data-level='high']   { background: #f59e0b; box-shadow: 0 0 10px rgba(245, 158, 11, 0.65); }
    .pf-dot[data-level='normal'] { background: #10b981; box-shadow: 0 0 8px rgba(16, 185, 129, 0.55); }
  `]
})
export class MyWorkComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  readonly tabOptions = [
    { value: 'my_work'       as Tab, label: 'My Work' },
    { value: 'service_queue' as Tab, label: 'Service Queue' },
    { value: 'rejected'      as Tab, label: 'Rejected' }
  ];

  private readonly _tab = signal<Tab>('my_work');
  readonly tab = this._tab.asReadonly();
  setTab(t: Tab) { this._tab.set(t); this.refresh(); }

  private readonly _rows = signal<OrderTest[]>([]);
  readonly rows = this._rows.asReadonly();

  private readonly _loading = signal(false);
  readonly loading = this._loading.asReadonly();

  private readonly _counts = signal<Record<Tab, number>>({ my_work: 0, service_queue: 0, rejected: 0 });
  countFor(t: Tab): number { return this._counts()[t]; }

  readonly buckets = computed<Bucket[]>(() => {
    const enriched: Enriched[] = this._rows().map(t => {
      const ral = t.subOrder?.receivedAtLab;
      const budget = (t.test?.tatHours ?? 0) * 60;
      const elapsed = ral ? (Date.now() - new Date(ral).getTime()) / 60000 : 0;
      const remaining = budget - elapsed;
      const level: Level = remaining <= 0 ? 'urgent' : remaining <= 60 ? 'high' : 'normal';
      return { ...t, _level: level, _remainingMin: remaining };
    });
    return [
      { level: 'urgent' as const, items: enriched.filter(e => e._level === 'urgent') },
      { level: 'high'   as const, items: enriched.filter(e => e._level === 'high') },
      { level: 'normal' as const, items: enriched.filter(e => e._level === 'normal') }
    ];
  });

  toneFor(level: Level): TileTone {
    return level === 'urgent' ? 'rose' : level === 'high' ? 'amber' : 'default';
  }

  ngOnInit() { this.refresh(); this.refreshAllCounts(); }

  refresh() {
    const url = this.endpointFor(this._tab());
    this._loading.set(true);
    this.api.get<OrderTest[]>(url).subscribe({
      next: l => { this._rows.set((l ?? []).filter(t => this.matchesTab(t, this._tab()))); this._loading.set(false); },
      error: () => this._loading.set(false)
    });
  }

  private refreshAllCounts() {
    for (const t of ['my_work', 'service_queue', 'rejected'] as Tab[]) {
      this.api.get<OrderTest[]>(this.endpointFor(t)).subscribe({
        next: l => {
          const count = (l ?? []).filter(x => this.matchesTab(x, t)).length;
          this._counts.update(c => ({ ...c, [t]: count }));
        }
      });
    }
  }

  private endpointFor(t: Tab): string {
    if (t === 'service_queue') return '/api/results/service-queue';
    return '/api/results/my-work';
  }
  private matchesTab(t: OrderTest, tab: Tab): boolean {
    if (tab === 'rejected') return t.status === 're_entry';
    if (tab === 'my_work')  return t.status !== 're_entry';
    return true;
  }

  pickUp(t: OrderTest) {
    this.api.post<OrderTest>(`/api/results/${t.id}/assign`, {}).subscribe({
      next: () => { this.toasts.success('Assigned to you'); this.enter(t); }
    });
  }
  enter(t: OrderTest) { this.router.navigate(['/lab/result', t.id]); }
}
