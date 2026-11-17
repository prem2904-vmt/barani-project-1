import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AppointmentQueueService } from '../../../core/services/appointment-queue.service';
import { LabFeaturesService } from '../../../core/services/lab-features.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { AppointmentConfig, QueueMode } from '../../../shared/models/appointment.model';
import { SkeletonCardComponent } from '../../../shared/primitives/skeleton-kit.component';

/** The queue mode that makes the appointment queue run as home-collection visits. */
export const HOME_MODE: QueueMode = 'home_collection';
/** What the queue goes back to when home collection is switched off. */
export const DEFAULT_QUEUE_MODE: QueueMode = 'token_queue';

/**
 * Lab › Home collection › on or off. Two real server facts, no new storage:
 *  - AVAILABLE = the Home collection module (switched by Prefrontal) AND the
 *    workflow's Home Visits step (`LabFeaturesService.homeCollectionEnabled`) —
 *    shown read-only with the way to change it.
 *  - RUNNING = this branch's appointment queue mode is `home_collection`
 *    (`PUT /api/appointments/config`) — the switch on this card; it used to be
 *    a tile on Appointments & queue.
 */
@Component({
  selector: 'pf-home-collection-switch-card',
  standalone: true,
  imports: [RouterLink, SkeletonCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!cfg()) {
      <pf-skeleton-card [lines]="3" label="Loading home collection…"></pf-skeleton-card>
    } @else {
      <section class="pf-card pf-hs" data-testid="hc-switch-card">
        <div class="pf-card__head">
          <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10M9 21v-6h6v6"/></svg></span>
          <h3 class="pf-card__label pf-hs__title">Home collection</h3>
          <span class="pf-hs__scope" title="Applies to the branch you are signed in to">This branch</span>
          <span class="pf-card__spacer"></span>
          <button type="button" class="pf-toggle pf-hs__switch" role="switch" data-testid="hc-switch"
                  [attr.aria-checked]="running()" aria-label="Run this branch's queue as home collection"
                  [disabled]="saving() || !canSwitch()" (click)="toggle()">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        </div>
        <div class="pf-hs__body">
          <p class="pf-hs__hint">
            When ON, this branch's appointments are home-collection visits, ordered by scheduled time rather than a
            counter queue, and the agents below are assigned to them. Turn it OFF to go back to the
            {{ backTo() }}.
          </p>
          <div class="pf-hs__facts">
            <span class="pf-chip pf-chip--static" data-testid="hc-available">
              Available — <strong>{{ available() ? 'Yes' : 'No' }}</strong>
            </span>
            <span class="pf-chip pf-chip--static" data-testid="hc-running">
              This branch — <strong>{{ running() ? 'Running as home collection' : 'Not running' }}</strong>
            </span>
          </div>
          @if (!available()) {
            <p class="pf-hs__warn" role="status" data-testid="hc-unavailable">
              Home collection is not available for your lab. It needs the Home collection module (switched on by
              Prefrontal) and the <strong>Home visits</strong> step in your
              <a class="pf-hs__link" routerLink="/admin/process">work steps</a>.
            </p>
          }
        </div>
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .pf-hs { margin-bottom: 16px; overflow: visible; }
    .pf-hs__title { margin: 0; font-size: 13px; }
    .pf-hs__scope { margin-left: 8px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--pf-line); background: var(--pf-chip-bg); font-size: 11px; font-weight: 600; color: var(--text-secondary); white-space: nowrap; }
    .pf-hs__body { padding: 14px 18px 18px; }
    .pf-hs__hint { margin: 0; font-size: 12.5px; color: var(--text-tertiary); line-height: 1.55; }
    .pf-hs__facts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .pf-hs__facts .pf-chip { height: auto; min-height: 30px; white-space: normal; }
    .pf-hs__facts strong { color: var(--text-primary); }
    .pf-hs__warn { margin: 12px 0 0; font-size: 12.5px; color: var(--text-secondary); font-style: italic; line-height: 1.55; }
    .pf-hs__link { color: var(--violet-text, #7c3aed); text-decoration: underline; text-underline-offset: 3px; font-style: normal; }
    .pf-hs__switch { flex: none; }
    @media (pointer: coarse) { :host .pf-hs__switch { min-width: 44px; min-height: 44px; justify-content: flex-end; } }
  `],
})
export class HomeCollectionSwitchCardComponent implements OnInit {
  private readonly svc = inject(AppointmentQueueService);
  private readonly features = inject(LabFeaturesService);
  private readonly toasts = inject(ToastService);

  readonly cfg = signal<AppointmentConfig | null>(null);
  readonly saving = signal(false);
  /** The module + the workflow's Home Visits step (the ONE lab-feature rule). */
  readonly available = this.features.homeCollectionEnabled;
  readonly running = computed(() => this.cfg()?.queueMode === HOME_MODE);
  /** Switching it ON needs it available; switching a running one OFF always works. */
  readonly canSwitch = computed(() => !!this.cfg() && (this.available() || this.running()));
  /** What the queue returns to (the mode used before, else the token queue). */
  private before: QueueMode = DEFAULT_QUEUE_MODE;
  protected readonly backTo = computed(() => (this.before === 'walk_up' ? 'walk-up queue' : 'token queue'));

  ngOnInit() {
    void this.features.ensureLoaded();
    this.svc.getConfig().subscribe({ next: c => this.cfg.set(c), error: () => this.cfg.set(null) });
  }

  toggle() {
    const cur = this.cfg();
    if (!cur || this.saving() || !this.canSwitch()) return;
    const on = !this.running();
    if (on && cur.queueMode !== HOME_MODE) this.before = cur.queueMode;
    const next: QueueMode = on ? HOME_MODE : this.before;
    this.saving.set(true);
    this.svc.saveConfig({ ...cur, queueMode: next }).subscribe({
      next: c => {
        this.cfg.set(c);
        this.saving.set(false);
        this.toasts.success(on ? 'Home collection is on for this branch' : 'Home collection is off — the queue is back to normal');
      },
      error: e => { this.saving.set(false); this.toasts.error(ApiError.from(e).message); },
    });
  }
}
