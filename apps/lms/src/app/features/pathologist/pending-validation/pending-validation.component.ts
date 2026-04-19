import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { SlideOverComponent } from '../../../shared/components/slide-over/slide-over.component';
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
    SlideOverComponent,
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

    <pf-slide-over [open]="validateOpen()" [title]="'Validate result'" (closed)="validateOpen.set(false)">
      @if (selected(); as t) {
        <div class="space-y-4">
          <div>
            <p class="font-semibold text-[16px]" style="color: var(--text-primary);">{{ t.test?.name }}</p>
            <p class="text-[12px] mt-1" style="color: var(--text-tertiary);">
              {{ t.subOrder?.order?.patient?.name }} · {{ t.test?.department?.name }}
            </p>
          </div>

          @if (snapshot()?.flags?.critical) {
            <div class="rounded-xl p-3 text-[12px] flex items-start gap-2"
                 style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.25); color: #fca5a5;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 mt-0.5">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                <path d="M12 9v4"/>
                <path d="M12 17h.01"/>
              </svg>
              <span>Flagged as critical. Validation sends this to the referring doctor.</span>
            </div>
          }

          <div class="rounded-2xl p-4"
               style="background: var(--glass-bg); border: 1px solid var(--glass-border);">
            <p class="text-[11px] font-mono uppercase tracking-[0.16em] mb-3"
               style="color: var(--text-muted);">Values</p>
            @if (valueRows().length === 0) {
              <p class="text-[12px]" style="color: var(--text-tertiary);">No values recorded.</p>
            } @else {
              <table class="w-full text-[13px]">
                <thead class="text-[11px] font-mono uppercase tracking-wider text-left"
                       style="color: var(--text-muted);">
                  <tr>
                    <th class="pb-2 font-normal">Parameter</th>
                    <th class="pb-2 font-normal">Value</th>
                    <th class="pb-2 font-normal">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of valueRows(); track r.name) {
                    <tr style="border-top: 1px solid var(--border-muted);">
                      <td class="py-2" style="color: var(--text-secondary);">{{ r.title }}</td>
                      <td class="py-2" style="color: var(--text-primary);">
                        <span class="font-medium">{{ r.value }}</span>
                        <span class="ml-1" style="color: var(--text-muted);">{{ r.unit ?? '' }}</span>
                      </td>
                      <td class="py-2">
                        <span class="pf-flag" [class]="'pf-flag-' + r.flag">
                          {{ r.flag === 'critical' ? 'CRITICAL' : r.flag === 'abnormal' ? 'abnormal' : 'normal' }}
                        </span>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </div>

          <div>
            <label class="pf-label">Clinical comment (optional)</label>
            <textarea class="pf-input min-h-[88px]"
                      [value]="comment()"
                      (input)="onComment($event)"
                      placeholder="Notes for the report or follow-up team…"></textarea>
          </div>
        </div>
      }

      @if (selected(); as t) {
        <ng-container footer>
          <div class="flex justify-end gap-2 w-full">
            <pf-touch-btn size="sm" variant="ghost" (pressed)="validateOpen.set(false)">Close</pf-touch-btn>
            <pf-touch-btn size="sm" variant="secondary" (pressed)="openReject(t)">Reject</pf-touch-btn>
            <pf-touch-btn size="sm" variant="primary" (pressed)="validate(t)">Validate</pf-touch-btn>
          </div>
        </ng-container>
      }
    </pf-slide-over>
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

    .pf-flag {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .pf-flag-normal   { background: rgba(16, 185, 129, 0.15); color: #6ee7b7; }
    .pf-flag-abnormal { background: rgba(245, 158, 11, 0.15); color: #fcd34d; }
    .pf-flag-critical { background: rgba(239, 68, 68, 0.18);  color: #fca5a5; }
  `]
})
export class PendingValidationComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);

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

  // validate slide-over
  protected readonly validateOpen = signal(false);
  private readonly _selected = signal<OrderTest | null>(null);
  readonly selected = this._selected.asReadonly();
  private readonly _comment = signal('');
  readonly comment = this._comment.asReadonly();

  readonly snapshot = computed<ResultSnapshot | null>(() => {
    const raw = this._selected()?.currentResult;
    if (!raw) return null;
    try { return JSON.parse(raw) as ResultSnapshot; } catch { return null; }
  });

  readonly valueRows = computed(() => {
    const t = this._selected();
    const snap = this.snapshot();
    if (!t?.test?.parameters || !snap?.values) return [];

    let params: Array<{ name: string; title: string; unit?: string; criticalLow?: number; criticalHigh?: number; referenceRanges?: Array<{ segment: string; min: number; max: number }> }> = [];
    try {
      const blob = JSON.parse(t.test.parameters);
      params = blob.parameters ?? [];
    } catch { return []; }

    return params.map(p => {
      const v = snap.values![p.name];
      const n = Number(v);
      let flag: 'normal' | 'abnormal' | 'critical' = 'normal';
      if (!Number.isNaN(n)) {
        if ((p.criticalLow != null && n <= p.criticalLow) || (p.criticalHigh != null && n >= p.criticalHigh)) flag = 'critical';
        else {
          const r = (p.referenceRanges ?? [])[0];
          if (r && (n < r.min || n > r.max)) flag = 'abnormal';
        }
      }
      return { name: p.name, title: p.title, value: v ?? '—', unit: p.unit, flag };
    });
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

  onComment(e: Event) { this._comment.set((e.target as HTMLTextAreaElement).value); }

  openValidate(t: OrderTest) {
    this._selected.set(t);
    this._comment.set('');
    this.validateOpen.set(true);
  }

  validate(t: OrderTest) {
    this.api.post<OrderTest>(`/api/validation/${t.id}/validate`, { note: this._comment() || null }).subscribe({
      next: () => {
        this.toasts.success('Validated');
        this.validateOpen.set(false);
        this._rows.update(l => l.filter(x => x.id !== t.id));
      }
    });
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
    this.api.post<OrderTest>(`/api/validation/${t.id}/reject`, { reason, note: this._comment() || null }).subscribe({
      next: () => {
        this.toasts.success('Rejected — lab tech notified');
        this.validateOpen.set(false);
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
