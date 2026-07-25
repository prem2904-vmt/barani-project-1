import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';
import { AppointmentQueueService } from '../../../core/services/appointment-queue.service';
import { ToastService } from '../../../core/services/toast.service';
import { Patient } from '../../../shared/models/patient.model';
import { QueueItem, QueueMode } from '../../../shared/models/appointment.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { PatientSearchComponent } from '../../../shared/components/patient-search/patient-search.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { LoadingLogoComponent } from '../../../shared/components/loading-logo/loading-logo.component';

const MODE_LABEL: Record<QueueMode, string> = {
  token_queue: 'Token queue — patients called by priority',
  walk_up: 'Walk-up — served first-come',
  home_collection: 'Home collection — by scheduled visit time'
};

const TYPE_COLOR: Record<string, string> = {
  urgent: '#ef4444', emergency: '#ef4444',
  appointment: '#f59e0b', walkin: '#eab308', followup: '#22c55e'
};

@Component({
  selector: 'pf-collection-queue',
  standalone: true,
  imports: [NgTemplateOutlet, PatientSearchComponent, ScreenHeaderComponent, TileComponent, TouchButtonComponent, LoadingLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-page px-4 md:px-8 pt-6">
      <pf-screen-header
        class="pf-page__header"
        eyebrow="Front desk"
        title="Collection Queue"
        [subtitle]="modeLabel()">
        <div actions class="flex items-center gap-2 flex-wrap justify-end">
          <span class="text-[12px] font-mono" style="color: var(--text-tertiary);">
            {{ waitingCount() }} waiting · ~{{ avgWait() }}m avg
          </span>
          <pf-touch-btn size="sm" variant="ghost" (pressed)="load()">Refresh</pf-touch-btn>
          <pf-touch-btn size="sm" variant="primary" (pressed)="toggleWalkIn()">
            {{ walkInOpen() ? 'Close' : '+ Walk-in' }}
          </pf-touch-btn>
        </div>
      </pf-screen-header>

      <div class="pf-page__body">
      @if (walkInOpen()) {
        <pf-tile tone="violet" padding="lg" class="block mb-4">
          <h3 class="pf-section-title mb-2">Add a walk-in to the queue</h3>
          <pf-patient-search (picked)="addWalkIn($event)"
            placeholder="Search patient to add as walk-in…"></pf-patient-search>
          <p class="text-[11px] mt-2" style="color: var(--text-tertiary);">
            Adds the patient as checked-in with a token. Mark urgent from the row if it's a STAT sample.
          </p>
        </pf-tile>
      }

      @if (loading() && items().length === 0) {
        <pf-tile tone="default" padding="lg" class="block">
          <div class="flex justify-center py-6">
            <pf-loading-logo size="lg" color="purple" [showDna]="true" [showText]="true" text="Loading queue…"></pf-loading-logo>
          </div>
        </pf-tile>
      } @else {
        @if (inProgress().length) {
          <h3 class="pf-queue-hdr">Now collecting</h3>
          <div class="space-y-2 mb-4">
            @for (q of inProgress(); track q.id) {
              <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ q }"></ng-container>
            }
          </div>
        }

        <h3 class="pf-queue-hdr">Waiting <span class="pf-queue-count">{{ waiting().length }}</span></h3>
        @if (waiting().length === 0) {
          <pf-tile tone="default" padding="lg" class="block mb-4">
            <p class="text-center text-[13px]" style="color: var(--text-tertiary);">No one waiting.</p>
          </pf-tile>
        } @else {
          <div class="space-y-2 mb-4">
            @for (q of waiting(); track q.id) {
              <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ q }"></ng-container>
            }
          </div>
        }

        @if (upcoming().length) {
          <h3 class="pf-queue-hdr">Upcoming (not arrived) <span class="pf-queue-count">{{ upcoming().length }}</span></h3>
          <div class="space-y-2 mb-4">
            @for (q of upcoming(); track q.id) {
              <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ q }"></ng-container>
            }
          </div>
        }

        @if (done().length) {
          <h3 class="pf-queue-hdr pf-queue-hdr--muted">Done today <span class="pf-queue-count">{{ done().length }}</span></h3>
          <div class="space-y-2 opacity-70">
            @for (q of done(); track q.id) {
              <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ q }"></ng-container>
            }
          </div>
        }
      }
      </div>
    </section>

    <!-- ── Row template ── -->
    <ng-template #row let-q="q">
      <pf-tile tone="default" padding="md" class="block">
        <div class="pf-row flex items-center gap-3 flex-wrap md:flex-nowrap">
          <div class="pf-token" [style.borderColor]="typeColor(q.type)">
            <span class="text-[10px] uppercase" style="color: var(--text-tertiary);">Token</span>
            <span class="text-[18px] font-bold leading-none">{{ q.tokenNumber ?? '—' }}</span>
          </div>

          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="w-2.5 h-2.5 rounded-full shrink-0" [style.background]="typeColor(q.type)"></span>
              <p class="font-semibold text-[15px] truncate" style="color: var(--text-primary);">{{ q.patientName }}</p>
              <span class="text-[11px] uppercase font-medium" style="color: var(--text-tertiary);">{{ q.type }}</span>
              @if (q.isLate) { <span class="pf-badge-late">late</span> }
            </div>
            <p class="text-[12px] mt-0.5" style="color: var(--text-tertiary);">
              @if (q.status === 'checked_in') {
                Waiting {{ waitLabel(q.waitMinutes) }} · ~{{ q.estimatedWaitMinutes }}m to go
              } @else if (q.status === 'in_progress') {
                Collecting now
              } @else if (q.status === 'booked') {
                Scheduled {{ q.slotTime || '—' }}
              } @else {
                {{ statusLabel(q.status) }}
              }
              @if (q.phone) { · {{ q.phone }} }
            </p>
          </div>

          @if (showScore() && (q.status === 'checked_in' || q.status === 'in_progress')) {
            <div class="pf-score" title="Priority score — higher is called sooner. Base by type + minutes waited − late penalty; urgent jumps to the top.">
              <span class="pf-score__n">{{ q.score }}</span>
              <span class="pf-score__l">priority</span>
            </div>
          }

          <div class="pf-row-actions flex items-center gap-1.5 flex-wrap justify-end">
            @switch (q.status) {
              @case ('booked') {
                <pf-touch-btn size="sm" variant="primary" (pressed)="act(svc.checkIn(q.id))">Check in</pf-touch-btn>
                <pf-touch-btn size="sm" variant="ghost" (pressed)="act(svc.noShow(q.id))">No-show</pf-touch-btn>
              }
              @case ('checked_in') {
                <pf-touch-btn size="sm" variant="primary" (pressed)="act(svc.start(q.id))">Call</pf-touch-btn>
                @if (q.type !== 'urgent' && q.type !== 'emergency') {
                  <pf-touch-btn size="sm" variant="ghost" (pressed)="act(svc.markUrgent(q.id))">Urgent</pf-touch-btn>
                }
                <pf-touch-btn size="sm" variant="ghost" (pressed)="act(svc.skip(q.id))">Skip</pf-touch-btn>
                <pf-touch-btn size="sm" variant="ghost" (pressed)="act(svc.noShow(q.id))">No-show</pf-touch-btn>
              }
              @case ('in_progress') {
                <pf-touch-btn size="sm" variant="primary" (pressed)="act(svc.complete(q.id))">Complete</pf-touch-btn>
              }
              @default {
                <span class="text-[12px] font-medium" style="color: var(--text-tertiary);">{{ statusLabel(q.status) }}</span>
              }
            }
          </div>
        </div>
      </pf-tile>
    </ng-template>
  `,
  styles: [`
    /* ── Non-scroll WORK layout: the page fills the shell main area and the
       scroll happens INSIDE the body, not on the page itself. ── */
    :host { display: block; height: 100%; }
    .pf-page {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }
    .pf-page__header { flex: 0 0 auto; }
    .pf-page__body {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      /* breathing room at the bottom of the inner scroll, + safe-area for
         this page's own scroll edge on notched devices. */
      padding-bottom: calc(40px + env(safe-area-inset-bottom, 0px));
      -webkit-overflow-scrolling: touch;
    }

    .pf-token {
      width: 60px; min-height: 48px; border-radius: 12px;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      border: 2px solid var(--border-subtle); flex-shrink: 0;
      background: var(--surface-2, rgba(255,255,255,0.03));
    }
    .pf-queue-hdr { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
      color: var(--text-secondary); margin: 0 0 8px; }
    .pf-queue-hdr--muted { color: var(--text-tertiary); }
    .pf-queue-count { font-weight: 600; color: var(--text-tertiary); margin-left: 4px; }
    .pf-badge-late { font-size: 10px; font-weight: 700; text-transform: uppercase;
      color: var(--red-text); background: rgba(239,68,68,.15); padding: 1px 6px; border-radius: 999px; }
    .pf-score {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      min-width: 52px; padding: 3px 8px; border-radius: 10px; flex-shrink: 0; cursor: help;
      background: rgba(124,58,237,0.14); border: 1px solid rgba(124,58,237,0.32);
    }
    .pf-score__n { font-size: 15px; font-weight: 700; line-height: 1; color: var(--violet-text); }
    .pf-score__l { font-size: 9px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-tertiary); }

    /* ── Phone (<=640): keep the row legible & tappable.
       Additive only — desktop/iPad rows are untouched. ── */
    @media (max-width: 640px) {
      /* The name block keeps its line; the action cluster drops onto its
         own full-width row and left-aligns so buttons get real estate
         instead of crowding into the right gutter. */
      :host .pf-row { row-gap: 10px; }
      :host .pf-row-actions {
        flex-basis: 100%;
        justify-content: flex-start;
        gap: 8px;
      }
      /* On the dropped full-width action line the small buttons would
         otherwise crowd into the left gutter. Let each grow to share the
         width as a comfortable 2-up grid (a lone action goes full-width),
         giving bigger, easier tap targets without changing button height. */
      :host .pf-row-actions pf-touch-btn {
        flex: 1 1 calc(50% - 4px);
        min-width: calc(50% - 4px);
      }
      /* The priority chip should never push the name block to nothing. */
      :host .pf-score { min-width: 48px; }
    }

    /* Touch devices of any width: ensure the help-cursor chip isn't
       relying on a hover tooltip to be understood (label already shown). */
    @media (pointer: coarse) {
      :host .pf-score { cursor: default; }
    }
  `]
})
export class CollectionQueueComponent implements OnInit {
  readonly svc = inject(AppointmentQueueService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _items = signal<QueueItem[]>([]);
  private readonly _mode = signal<QueueMode>('token_queue');
  private readonly _avg = signal(5);
  private readonly _loading = signal(false);
  private readonly _walkInOpen = signal(false);

  readonly items = this._items.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly walkInOpen = this._walkInOpen.asReadonly();
  readonly avgWait = this._avg.asReadonly();
  readonly modeLabel = computed(() => MODE_LABEL[this._mode()] ?? '');

  readonly inProgress = computed(() => this._items().filter(q => q.status === 'in_progress'));
  readonly waiting = computed(() => this._items().filter(q => q.status === 'checked_in'));
  readonly upcoming = computed(() => this._items().filter(q => q.status === 'booked'));
  readonly done = computed(() => this._items().filter(q => ['completed', 'no_show', 'skipped'].includes(q.status)));
  readonly waitingCount = computed(() => this.waiting().length + this.inProgress().length);
  // The score only drives ordering in token_queue mode — hide it elsewhere
  // (walk-up is FIFO, home-collection is by scheduled time) to avoid noise.
  readonly showScore = computed(() => this._mode() === 'token_queue');

  ngOnInit() {
    this.load();
    // Live refresh every 20s so wait-times + priority order stay current.
    interval(20_000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load());
  }

  load() {
    this._loading.set(true);
    this.svc.getQueue().subscribe({
      next: r => {
        this._items.set(r.items ?? []);
        this._mode.set(r.mode);
        this._avg.set(r.avgCollectionMinutes);
        this._loading.set(false);
      },
      error: () => { this._loading.set(false); this.toast.error('Could not load the queue.'); }
    });
  }

  toggleWalkIn() { this._walkInOpen.update(v => !v); }

  addWalkIn(p: Patient) {
    this.svc.addWalkIn(p.id).subscribe({
      next: () => { this.toast.success('Added to queue.'); this._walkInOpen.set(false); this.load(); },
      error: e => this.toast.error(ApiError.from(e).message)
    });
  }

  /** Run a transition observable, then refresh; surface failures as a toast. */
  act(obs: { subscribe: (o: { next: () => void; error: (e: unknown) => void }) => void }) {
    obs.subscribe({
      next: () => this.load(),
      error: (e) => { this.toast.error(ApiError.from(e).message); this.load(); }
    });
  }

  typeColor(type: string): string { return TYPE_COLOR[type] ?? '#94a3b8'; }
  waitLabel(min: number): string {
    if (min < 60) return `${min}m`;
    return `${Math.floor(min / 60)}h ${min % 60}m`;
  }
  statusLabel(s: string): string {
    return s === 'no_show' ? 'No-show' : s === 'in_progress' ? 'In progress'
      : s.charAt(0).toUpperCase() + s.slice(1);
  }
}
