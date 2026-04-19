import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { TatIndicatorComponent } from '../../../shared/components/tat-indicator/tat-indicator.component';
import { OrderTest } from '../../../shared/models/order.model';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ChipComponent } from '../../../shared/primitives/chip.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { SkeletonComponent } from '../../../shared/primitives/skeleton.component';
import { TileComponent, TileTone } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

type Tab = 'mine' | 'all';
type Level = 'urgent' | 'high' | 'normal';
type Enriched = OrderTest & { _level: Level; _remainingMin: number };

interface ResultSnapshot {
  values?: Record<string, unknown>;
  note?: string;
  flags?: { critical: boolean; notifications: string[] };
}

@Component({
  selector: 'pf-pending-validation',
  standalone: true,
  imports: [
    FormsModule,
    DatePipe,
    TatIndicatorComponent,
    AvatarComponent,
    ChipComponent,
    ScreenHeaderComponent,
    SegmentedComponent,
    SkeletonComponent,
    TileComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10 max-w-6xl mx-auto">
      <pf-screen-header
        eyebrow="Validation queue"
        title="Pending validation"
        subtitle="Review entered results. Validate, reject, or reassign to another pathologist.">
        <pf-touch-btn actions size="sm" variant="secondary" (pressed)="refresh()">
          <span icon-left aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/>
              <path d="M21 3v5h-5"/>
              <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/>
              <path d="M3 21v-5h5"/>
            </svg>
          </span>
          Refresh
        </pf-touch-btn>
      </pf-screen-header>

      <div class="mb-5">
        <pf-segmented
          [options]="tabOptions"
          [value]="tab()"
          size="md"
          (valueChange)="setTab($event)">
        </pf-segmented>
      </div>

      @if (loading() && rows().length === 0) {
        <div class="space-y-2.5">
          @for (i of [0,1,2,3]; track i) {
            <pf-tile tone="default" padding="md">
              <div class="flex items-center gap-3">
                <pf-skeleton variant="circle" width="44px" height="44px"></pf-skeleton>
                <div class="flex-1 space-y-2">
                  <pf-skeleton variant="line" width="50%"></pf-skeleton>
                  <pf-skeleton variant="line" width="75%" height="10px"></pf-skeleton>
                </div>
                <pf-skeleton variant="line" width="104px" height="28px"></pf-skeleton>
              </div>
            </pf-tile>
          }
        </div>
      }

      @for (bucket of buckets(); track bucket.level) {
        @if (bucket.items.length > 0) {
          <div class="mb-7">
            <div class="flex items-center gap-2 mb-3 px-1">
              <span class="pf-urg-dot" [class]="'pf-urg-' + bucket.level"></span>
              <span class="text-[11px] font-mono uppercase tracking-[0.16em]"
                    style="color: var(--text-secondary);">
                {{ bucket.label }}
              </span>
              <span class="text-[11px] font-mono"
                    style="color: var(--text-muted);">
                · {{ bucket.items.length }}
              </span>
            </div>

            <div class="space-y-2.5">
              @for (t of bucket.items; track t.id) {
                <pf-tile [tone]="rowTone(bucket.level)" padding="md">
                  <div class="flex items-center gap-3 flex-wrap md:flex-nowrap">
                    <pf-avatar [name]="t.subOrder?.order?.patient?.name ?? '—'" [size]="44"></pf-avatar>

                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 flex-wrap">
                        <p class="font-semibold text-[15px] truncate"
                           style="color: var(--text-primary);">{{ t.test?.name }}</p>
                        @if (isCritical(t)) {
                          <pf-chip tone="rose" size="sm">CRITICAL</pf-chip>
                        }
                      </div>
                      <p class="text-[12px] mt-0.5 truncate"
                         style="color: var(--text-tertiary);">
                        {{ t.subOrder?.order?.patient?.name ?? '—' }}
                        · entered {{ t.resultedAt ? (t.resultedAt | date:'shortTime') : '—' }}
                      </p>
                    </div>

                    <pf-tat-indicator [tatLevel]="t._level" [remainingMinutes]="t._remainingMin"></pf-tat-indicator>

                    <div class="flex items-center gap-1.5 ml-auto">
                      <pf-touch-btn size="sm" variant="ghost" (pressed)="openReject(t)">Reject</pf-touch-btn>
                      <pf-touch-btn size="sm" variant="secondary" (pressed)="reassign(t)">Reassign</pf-touch-btn>
                      <pf-touch-btn size="sm" variant="primary" (pressed)="openValidate(t)">Validate</pf-touch-btn>
                    </div>
                  </div>
                </pf-tile>
              }
            </div>
          </div>
        }
      }

      @if (!loading() && rows().length === 0) {
        <pf-tile tone="default" padding="xl">
          <div class="text-center py-6">
            <p class="text-[14px]" style="color: var(--text-secondary);">
              Nothing pending. Everything is validated.
            </p>
          </div>
        </pf-tile>
      }
    </section>

  `,
  styles: [`
    .pf-urg-dot {
      width: 8px;
      height: 8px;
      border-radius: 9999px;
      display: inline-block;
    }
    .pf-urg-urgent {
      background: #ef4444;
      box-shadow: 0 0 12px rgba(239, 68, 68, 0.6);
    }
    .pf-urg-high {
      background: #f59e0b;
      box-shadow: 0 0 12px rgba(245, 158, 11, 0.55);
    }
    .pf-urg-normal {
      background: #10b981;
      box-shadow: 0 0 10px rgba(16, 185, 129, 0.5);
    }

  `]
})
export class PendingValidationComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly router = inject(Router);

  readonly tabOptions: SegmentedOption<Tab>[] = [
    { value: 'mine', label: 'My queue' },
    { value: 'all',  label: 'All pathologists' }
  ];
  private readonly _tab = signal<Tab>('all');
  readonly tab = this._tab.asReadonly();
  setTab(t: Tab) { this._tab.set(t); this.refresh(); }

  rowTone(level: Level): TileTone {
    return level === 'urgent' ? 'rose' : level === 'high' ? 'amber' : 'default';
  }

  private readonly _rows = signal<OrderTest[]>([]);
  readonly rows = this._rows.asReadonly();

  private readonly _loading = signal(false);
  readonly loading = this._loading.asReadonly();

  readonly buckets = computed(() => {
    const enriched: Enriched[] = this._rows().map(t => {
      const ral = t.subOrder?.receivedAtLab;
      const budget = (t.test?.tatHours ?? 0) * 60;
      const elapsed = ral ? (Date.now() - new Date(ral).getTime()) / 60000 : 0;
      const remaining = budget - elapsed;
      const level: Level = remaining <= 0 ? 'urgent' : remaining <= 60 ? 'high' : 'normal';
      return { ...t, _level: level, _remainingMin: remaining };
    });
    return [
      { level: 'urgent' as const, label: 'Urgent',      items: enriched.filter(e => e._level === 'urgent') },
      { level: 'high'   as const, label: 'High',        items: enriched.filter(e => e._level === 'high')   },
      { level: 'normal' as const, label: 'Within TAT',  items: enriched.filter(e => e._level === 'normal') }
    ];
  });

  isCritical(t: OrderTest): boolean {
    if (!t.currentResult) return false;
    try {
      const s = JSON.parse(t.currentResult) as ResultSnapshot;
      return !!s.flags?.critical;
    } catch { return false; }
  }

  ngOnInit() { this.refresh(); }

  refresh() {
    const mine = this._tab() === 'mine';
    this._loading.set(true);
    this.api.get<OrderTest[]>(`/api/validation/queue?mine=${mine}`).subscribe({
      next: l => { this._rows.set(l ?? []); this._loading.set(false); },
      error: () => this._loading.set(false)
    });
  }

  openValidate(t: OrderTest) {
    this.router.navigate(['/pathologist/validate', t.id]);
  }

  async openReject(t: OrderTest) {
    const reason = await this.dialog.prompt({
      title: 'Reject result?',
      message: `Reject result for ${t.test?.name}. The lab tech will be notified.`,
      placeholder: 'Reason for rejection…',
      multiline: true,
      required: true,
      tone: 'danger',
      confirmLabel: 'Reject result'
    });
    if (!reason) return;
    this.api.post<OrderTest>(`/api/validation/${t.id}/reject`, { reason }).subscribe({
      next: () => {
        this.toasts.success('Rejected — lab tech notified');
        this._rows.update(l => l.filter(x => x.id !== t.id));
      }
    });
  }

  async reassign(t: OrderTest) {
    const id = await this.dialog.prompt({
      title: 'Reassign to pathologist',
      message: 'Paste the user GUID (demo — a picker will land later).',
      placeholder: 'user id',
      required: true,
      confirmLabel: 'Reassign'
    });
    if (!id) return;
    this.api.post<OrderTest>(`/api/validation/${t.id}/reassign`, { assigneeId: id }).subscribe({
      next: () => { this.toasts.success('Reassigned'); this._rows.update(l => l.filter(x => x.id !== t.id)); }
    });
  }
}
