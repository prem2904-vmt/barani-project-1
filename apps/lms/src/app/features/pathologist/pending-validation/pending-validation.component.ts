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
import { KpiStripComponent } from '../../../shared/components/kpi-strip/kpi-strip.component';

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
    TouchButtonComponent,
    KpiStripComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pv-page px-4 md:px-8 pt-6">
      <div class="pv-head">
        <pf-kpi-strip screen="pathologist"></pf-kpi-strip>
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
      </div>

      <div class="pv-scroll pb-10">
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
              @for (g of patientGroups(bucket.items); track g.orderId) {
                <pf-tile [tone]="rowTone(bucket.level)" padding="md" class="block">
                  <button type="button" class="w-full flex items-center gap-3 cursor-pointer text-left"
                          (click)="toggleExpand(g.orderId)">
                    <pf-avatar [name]="g.patientName" [size]="44"></pf-avatar>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 flex-wrap">
                        <p class="font-semibold text-[15px] truncate" style="color: var(--text-primary);">{{ g.patientName }}</p>
                        <span class="pv-grp-count">{{ g.items.length }} test<span [class.hidden]="g.items.length === 1">s</span></span>
                        @if (g.anyCritical) { <pf-chip tone="rose" size="sm">CRITICAL</pf-chip> }
                      </div>
                      <p class="text-[11.5px] font-mono mt-0.5 truncate" style="color: var(--text-tertiary);">
                        #{{ g.orderId.slice(0,8) }}
                        @for (lbl of g.testNames; track lbl) { <span class="ml-1">· {{ lbl }}</span> }
                      </p>
                    </div>
                    <pf-tat-indicator [tatLevel]="g.level" [remainingMinutes]="g.remainingMin"></pf-tat-indicator>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
                         [style.transform]="expanded(g.orderId) ? 'rotate(90deg)' : 'none'"
                         style="transition: transform 0.15s ease; color: var(--text-muted);">
                      <path d="m9 18 6-6-6-6"/>
                    </svg>
                  </button>
                  @if (expanded(g.orderId)) {
                    <ul class="pv-result-list mt-3 space-y-2 pl-12">
                      @for (t of g.items; track t.id) {
                        <li class="pv-result-row flex items-center gap-2 py-2 px-3 rounded-lg" style="background: rgba(255,255,255,0.02); border: 1px solid var(--glass-border);">
                          <span class="text-[13.5px] font-medium flex-1 truncate" style="color: var(--text-primary);">
                            {{ t.test?.name }}
                            @if (isCritical(t)) { <span class="text-[10px] ml-1" style="color:#fb7185;">CRITICAL</span> }
                          </span>
                          <span class="text-[10.5px] font-mono" style="color: var(--text-muted);">
                            entered {{ t.resultedAt ? (t.resultedAt | date:'shortTime') : '—' }}
                          </span>
                          <span class="pv-result-actions inline-flex items-center gap-2">
                            <pf-touch-btn size="sm" variant="ghost" (pressed)="openReject(t)">Reject</pf-touch-btn>
                            <pf-touch-btn size="sm" variant="secondary" (pressed)="reassign(t)">Reassign</pf-touch-btn>
                            <pf-touch-btn size="sm" variant="primary" (pressed)="openValidate(t)">Validate</pf-touch-btn>
                          </span>
                        </li>
                      }
                    </ul>
                  }
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
      </div>
    </section>

  `,
  styles: [`
    /* ===== WORK page: non-scroll app layout on all sizes =====
       :host fills the shell's main area; the page is a flex column whose
       header (KPI + title + tabs) is fixed and the queue scrolls internally,
       so there is no outer page scroll / double scrollbar. */
    :host {
      display: block;
      height: 100%;
    }
    .pv-page {
      height: 100%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .pv-head {
      flex: 0 0 auto;
    }
    .pv-scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
    }

    .pv-grp-count {
      font-size: 10.5px; font-weight: 700;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.04em;
      padding: 3px 9px; border-radius: 999px;
      background: rgba(168, 85, 247, 0.14);
      color: #c4b5fd;
      border: 1px solid rgba(168, 85, 247, 0.28);
      flex-shrink: 0;
    }
    .hidden { display: none; }
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

    /* ===== Phone (<=640): stack expanded result rows so 3 actions don't overflow ===== */
    @media (max-width: 640px) {
      :host .pv-result-list {
        /* tighten the avatar-aligned indent so result rows aren't squeezed */
        padding-left: 0.5rem;
      }
      :host .pv-result-row {
        flex-wrap: wrap;
        align-items: flex-start;
      }
      /* test name takes the first line full width */
      :host .pv-result-row > span:first-child {
        flex: 1 1 100%;
        min-width: 0;
      }
      /* action group drops to its own line and spreads the 3 buttons evenly */
      :host .pv-result-actions {
        display: flex;
        width: 100%;
        gap: 0.5rem;
      }
      :host .pv-result-actions > * {
        flex: 1 1 0;
        min-width: 0;
      }
    }

    /* ===== iPad (641-1279): keep one indented column, ensure no horizontal overflow ===== */
    @media (min-width: 641px) and (max-width: 1279px) {
      :host .pv-result-row {
        flex-wrap: wrap;
      }
      :host .pv-result-actions {
        flex-shrink: 0;
      }
    }

    /* ===== Narrow phone (<=400): 3 sm buttons crush at equal width — let them
       wrap onto a second line instead of squeezing below a tappable width ===== */
    @media (max-width: 400px) {
      :host .pv-result-actions {
        flex-wrap: wrap;
      }
      :host .pv-result-actions > * {
        flex: 1 1 calc(50% - 0.25rem);
      }
    }

    /* ===== Touch input: guarantee a 44px tap target on the patient-group toggle
       (a real <button> owned by this page) without altering pointer/desktop. The
       inline Reject/Reassign/Validate are <pf-touch-btn> shared primitives — they
       own their own coarse-pointer sizing, so we only ensure they don't collapse. */
    @media (pointer: coarse) {
      /* The only raw <button> this page renders is the patient-group toggle;
         give it a 44px tap target. The inline Reject/Reassign/Validate are
         <pf-touch-btn size="sm"> which the shared primitive already fixes at
         44px, so they need no help here. */
      :host button[type="button"] {
        min-height: 44px;
      }
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

  /**
   * Group bucket items by orderId so the doctor reads "Patient X — N tests"
   * with all results expandable inline rather than per-result floating rows.
   * The card's TAT level is the most-urgent across all the tests in that
   * order so a single critical test pulls the whole group up.
   */
  patientGroups(items: Enriched[]): Array<{
    orderId: string;
    patientName: string;
    items: Enriched[];
    testNames: string[];
    level: Level;
    remainingMin: number;
    anyCritical: boolean;
  }> {
    const byOrder = new Map<string, Enriched[]>();
    for (const t of items) {
      const oid = t.subOrder?.order?.id ?? t.id;
      if (!byOrder.has(oid)) byOrder.set(oid, []);
      byOrder.get(oid)!.push(t);
    }
    const rank: Record<Level, number> = { 'urgent': 0, 'high': 1, 'normal': 2 };
    return Array.from(byOrder.entries()).map(([orderId, group]) => {
      const worst = [...group].sort((a, b) => rank[a._level] - rank[b._level])[0];
      return {
        orderId,
        patientName: worst.subOrder?.order?.patient?.displayName ?? '—',
        items: group,
        testNames: group.map(t => t.test?.name ?? 'Test').slice(0, 4),
        level: worst._level,
        remainingMin: Math.min(...group.map(t => t._remainingMin)),
        anyCritical: group.some(t => this.isCritical(t))
      };
    });
  }

  private readonly _expanded = signal<Set<string>>(new Set());
  expanded(id: string): boolean { return this._expanded().has(id); }
  toggleExpand(id: string): void {
    const next = new Set(this._expanded());
    if (next.has(id)) next.delete(id); else next.add(id);
    this._expanded.set(next);
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
      next: l => {
        // Defence against the backend leaking past-state rows: only 'entered'
        // tests are awaiting validation. Filtering here keeps Reject / Validate
        // / Reassign from firing on already-validated or re-entry rows.
        this._rows.set((l ?? []).filter(t => t.status === 'entered'));
        this._loading.set(false);
      },
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
