import { DestroyRef, ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ThemeService } from '../../../core/services/theme.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { LiveQueueService } from '../../../core/services/live-queue.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { TatIndicatorComponent } from '../../../shared/components/tat-indicator/tat-indicator.component';
import { OrderTest } from '../../../shared/models/order.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { formatPatientInfo } from '../../../shared/models/patient.model';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ChipComponent } from '../../../shared/primitives/chip.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { SkeletonComponent } from '../../../shared/primitives/skeleton.component';
import { TileComponent, TileTone } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { KpiStripComponent } from '../../../shared/components/kpi-strip/kpi-strip.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';

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
    TatIndicatorComponent,
    AvatarComponent,
    ChipComponent,
    ScreenHeaderComponent,
    SegmentedComponent,
    SkeletonComponent,
    TileComponent,
    TouchButtonComponent,
    KpiStripComponent,
    HeroBandComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pv-page px-4 md:px-8 pt-6">
      <!-- Common hero search (designer band): filters the validation queue
           by patient, sample ID, or test name. New design only. -->
      @if (theme.isNewDesign()) {
      <pf-hero-band
        placeholder="Search patient · sample ID · test…"
        [value]="query()"
        (valueChange)="query.set($event)">
        <ng-container band-tools>
          <!-- Queue scope toggle rides in the search bar (owner). -->
          <pf-segmented [options]="tabOptions" [value]="tab()" size="sm"
                        (valueChange)="setTab($event)"></pf-segmented>
                  <!-- Reload is ALWAYS the last tool in the bar (owner): same
               place on every screen. -->
          <!-- Reload is ALWAYS the LAST tool in the bar (owner): same
               position on every screen. -->
          <button type="button" class="pf-hb-tool press" (click)="refresh()"
                  title="Refresh" aria-label="Refresh">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/>
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>
            </svg>
          </button>
        </ng-container>
      </pf-hero-band>
      }
      <div class="pv-head">
        <pf-kpi-strip screen="pathologist"></pf-kpi-strip>
        <pf-screen-header
          eyebrow="Validation queue"
          title="Pending validation"
          subtitle="Review entered results. Validate, reject, or reassign to another pathologist.">
          <pf-touch-btn actions size="sm" variant="secondary" class="pf-classic-only" (pressed)="refresh()" aria-label="Refresh">
            <span icon-left aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/>
                <path d="M21 3v5h-5"/>
                <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/>
                <path d="M3 21v-5h5"/>
              </svg>
            </span>
            <span class="pv-refresh-label">Refresh</span>
          </pf-touch-btn>
        </pf-screen-header>

        <div class="mb-5 pf-classic-only">
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
              @for (g of sampleGroups(bucket.items); track g.key) {
                <pf-tile [tone]="rowTone(bucket.level)" padding="md" class="block">
                  <button type="button" class="w-full flex items-center gap-3 cursor-pointer text-left"
                          (click)="openOrder(g)"
                          [attr.aria-label]="'Validate ' + g.patientName + ' — ' + g.dept + ' sample'">
                    <pf-avatar [name]="g.displayName" [size]="44"></pf-avatar>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 flex-wrap">
                        <p class="font-semibold text-[15px] truncate" style="color: var(--text-primary);">{{ g.patientName }}</p>
                        <span class="pv-grp-count">{{ g.items.length }} test<span [class.hidden]="g.items.length === 1">s</span></span>
                        @if (g.mine) { <pf-chip tone="violet" size="sm">Assigned to you</pf-chip> }
                        @if (g.anyCritical) { <pf-chip tone="rose" size="sm">CRITICAL</pf-chip> }
                      </div>
                      <p class="pv-grp-meta text-[11.5px] font-mono mt-0.5 truncate" style="color: var(--text-tertiary);">
                        {{ g.dept }} · {{ g.sampleLabel }}
                        @for (lbl of g.testNames; track lbl) { <span class="ml-1">· {{ lbl }}</span> }
                      </p>
                    </div>
                    <pf-tat-indicator [tatLevel]="g.level" [remainingMinutes]="g.remainingMin"></pf-tat-indicator>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
                         style="color: var(--text-muted);">
                      <path d="m9 18 6-6-6-6"/>
                    </svg>
                  </button>
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
      color: var(--violet-text);
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
      /* Phone: Refresh is icon-only (label kept in the a11y tree). */
      :host .pv-refresh-label {
        position: absolute; width: 1px; height: 1px;
        padding: 0; margin: -1px; overflow: hidden;
        clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
      }
      /* Phone cards: just name + time — drop the test-count badge and the
         "#orderId · tests" meta line. */
      :host .pv-grp-count { display: none !important; }
      :host .pv-grp-meta { display: none !important; }

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
      /* the "entered …" timestamp gets its own full-width line so the row
         reads cleanly as name / timestamp / actions instead of relying on
         wrap order; left-aligned and tightened above the action row */
      :host .pv-result-row > span:nth-child(2) {
        flex: 1 1 100%;
        min-width: 0;
        margin-top: 0.125rem;
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
  /** Design version gate — 'new' renders the designer band/skin, 'classic' the pre-port look. */
  readonly theme = inject(ThemeService);
  private readonly auth = inject(AuthService);
  private readonly liveQ = inject(LiveQueueService);
  private readonly destroyRef = inject(DestroyRef);
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
  /** Group the queue by SAMPLE (one tube / department) so a sample with N tests
   *  is one row — opening it reviews the whole tube at once. */
  sampleGroups(items: Enriched[]): Array<{
    key: string;
    sampleLabel: string;
    dept: string;
    patientName: string;
    displayName: string;
    items: Enriched[];
    testNames: string[];
    level: Level;
    remainingMin: number;
    anyCritical: boolean;
    mine: boolean;
  }> {
    const myId = this.auth.user()?.id;
    const bySample = new Map<string, Enriched[]>();
    for (const t of items) {
      const key = t.subOrder?.id
        ?? `${t.subOrder?.order?.id ?? t.id}|${t.test?.department?.id ?? ''}`;
      if (!bySample.has(key)) bySample.set(key, []);
      bySample.get(key)!.push(t);
    }
    const rank: Record<Level, number> = { 'urgent': 0, 'high': 1, 'normal': 2 };
    return Array.from(bySample.entries()).map(([key, group]) => {
      const worst = [...group].sort((a, b) => rank[a._level] - rank[b._level])[0];
      return {
        key,
        sampleLabel: worst.subOrder?.barcode ?? worst.subOrder?.id?.slice(0, 8) ?? '—',
        dept: worst.test?.department?.name ?? '—',
        patientName: formatPatientInfo(worst.subOrder?.order?.patient),
        displayName: worst.subOrder?.order?.patient?.displayName || 'Patient',
        items: group,
        testNames: group.map(t => t.test?.name ?? 'Test').slice(0, 4),
        level: worst._level,
        remainingMin: Math.min(...group.map(t => t._remainingMin)),
        anyCritical: group.some(t => this.isCritical(t)),
        mine: !!myId && group.some(t => t.validatorAssignedTo === myId)
      };
      // Mine first, rest visible (owner): tubes auto-routed to ME lead each
      // urgency band; everything else stays right below for anyone to take.
    }).sort((a, b) => (a.mine === b.mine ? 0 : a.mine ? -1 : 1));
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

  /** Hero-band query — filters the queue by patient, sample ID, or test. */
  readonly query = signal('');

  readonly buckets = computed(() => {
    const q = this.query().trim().toLowerCase();
    const visible = !q ? this._rows() : this._rows().filter(t =>
      (t.subOrder?.order?.patient?.displayName ?? '').toLowerCase().includes(q) ||
      (t.subOrder?.barcode ?? '').toLowerCase().includes(q) ||
      (t.test?.name ?? '').toLowerCase().includes(q));
    const enriched: Enriched[] = visible.map(t => {
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

  ngOnInit() { this.refresh();
    // Live queue: refetch when the server says this area changed (no polling).
    this.liveQ.on('validation').pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refresh()); }

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
    this.goToReview(t, [t]);
  }

  /** Validation review = the SAME screen the tech entered on (?validate=1).
   *  Culture tubes keep the dedicated review (bench stage views + amend). */
  private goToReview(t: OrderTest, siblings: OrderTest[]) {
    const isCulture = siblings.some(x => (x.test?.parameters ?? '').includes('culture_sensitivity'));
    const sampleId = t.subOrder?.id;
    if (!isCulture && sampleId) {
      this.router.navigate(['/lab/sample', sampleId], { queryParams: { validate: 1 } });
    } else {
      this.router.navigate(['/pathologist/validate', t.id]);
    }
  }

  /** One-click: tapping a pending order goes straight to the validation screen
   *  for its first pending test (no expand-then-Validate step). Reject /
   *  reassign live on that screen. For a multi-test order the validator returns
   *  here after each, and the next test is one tap away. */
  openOrder(g: { items: OrderTest[] }) {
    const first = g.items[0];
    if (first) this.goToReview(first, g.items);
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
      },
      error: e => this.toasts.error(ApiError.from(e).message)
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
      next: () => { this.toasts.success('Reassigned'); this._rows.update(l => l.filter(x => x.id !== t.id)); },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }
}
