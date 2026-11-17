import { SettingRowComponent } from '../../../shared/components/setting-row/setting-row.component';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
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
  imports: [SettingRowComponent, RouterLink, SkeletonCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (variant() === 'strip') {
      <!-- ONE compact row above the agents grid (owner 2026-11-17): switch | Available · This branch. -->
      <section class="pf-card pf-hs-strip" data-testid="hc-switch-card">
        <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10M9 21v-6h6v6"/></svg></span>
        <button type="button" class="pf-toggle pf-hs__switch" role="switch" data-testid="hc-switch"
                [attr.aria-checked]="running()" aria-label="Run this branch's queue as home collection"
                [disabled]="!cfg() || saving() || !canSwitch()" (click)="toggle()">
          <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          <span class="pf-hs-strip__lbl">Run this branch's queue as home collection</span>
        </button>
        <span class="pf-hs-strip__facts">
          <span class="pf-hs__fact" data-testid="hc-available">Available: <strong>{{ cfg() ? (available() ? 'Yes' : 'No') : '…' }}</strong></span>
          <span aria-hidden="true">·</span>
          <span class="pf-hs__fact" data-testid="hc-running">This branch: <strong>{{ !cfg() ? '…' : running() ? 'Running as home collection' : 'Not running' }}</strong></span>
        </span>
        @if (cfg() && !available()) {
          <span class="pf-hs-strip__warn" role="status" data-testid="hc-unavailable">
            Not available: it needs the Home collection module and the <a class="pf-hs__link" routerLink="/admin/process">Home visits step</a>.
          </span>
        }
      </section>
    } @else if (!cfg()) {
      <pf-skeleton-card [lines]="2" label="Loading home collection…"></pf-skeleton-card>
    } @else {
      <div class="pf-hs" data-testid="hc-switch-card">
        <pf-setting-row label="Run this branch's queue as home collection"
                        [hint]="'Visits ordered by scheduled time, agents assigned below. Off: back to the ' + backTo() + '.'">
          <button type="button" class="pf-toggle pf-hs__switch" role="switch" data-testid="hc-switch"
                  [attr.aria-checked]="running()" aria-label="Run this branch's queue as home collection"
                  [disabled]="saving() || !canSwitch()" (click)="toggle()">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        </pf-setting-row>
        <pf-setting-row label="Status" [muted]="!available()">
          <span class="pf-hs__fact" data-testid="hc-available">Available: <strong>{{ available() ? 'Yes' : 'No' }}</strong></span>
          <span class="pf-hs__fact" data-testid="hc-running">This branch: <strong>{{ running() ? 'Running as home collection' : 'Not running' }}</strong></span>
        </pf-setting-row>
        @if (!available()) {
          <p class="pf-hs__warn" role="status" data-testid="hc-unavailable">
            Not available: it needs the Home collection module (switched on by Prefrontal) and the <strong>Home visits</strong> step in your
            <a class="pf-hs__link" routerLink="/admin/process">work steps</a>.
          </p>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .pf-hs__scope { padding: 1px 7px; border-radius: 999px; border: 1px solid var(--pf-line); background: var(--pf-chip-bg); font-size: 10.5px; font-weight: 600; color: var(--text-secondary); white-space: nowrap; }
    .pf-hs__fact { font-size: 12.5px; color: var(--text-tertiary); }
    .pf-hs__fact strong { color: var(--text-primary); font-weight: 600; }
    .pf-hs__warn { margin: 4px 0 10px; font-size: 12.5px; color: var(--text-secondary); line-height: 1.5; }
    .pf-hs__link { color: var(--violet-text, #7c3aed); text-decoration: underline; text-underline-offset: 3px; }
    .pf-hs__switch { flex: none; }
    .pf-hs-strip { flex-direction: row; align-items: center; flex-wrap: wrap; gap: 10px 14px; padding: 10px 14px; }
    .pf-hs-strip__lbl { font-size: 13px; font-weight: 500; color: var(--text-primary); white-space: normal; }
    .pf-hs-strip__facts { display: inline-flex; flex-wrap: wrap; gap: 6px; margin-left: auto; font-size: 12.5px; color: var(--text-tertiary); }
    .pf-hs-strip__warn { flex: 1 1 100%; font-size: 12px; color: var(--text-secondary); }
    @media (pointer: coarse) { :host .pf-hs__switch { min-width: 44px; min-height: 44px; justify-content: flex-end; } }
  `],
})
export class HomeCollectionSwitchCardComponent implements OnInit {
  /** 'card' (Lab › Home collection › on/off: setting rows) or 'strip' (one row above the agents grid). */
  readonly variant = input<'card' | 'strip'>('card');
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
