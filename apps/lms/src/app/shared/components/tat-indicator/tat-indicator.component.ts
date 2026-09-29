import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';
import { TatState, tatDetail, tatLabel, tatStateFor } from '../../utils/lab-priority';

/**
 * The TAT chip — a CLOCK, never a priority (priority is the order's
 * Urgent / Normal; see shared/utils/lab-priority.ts). Words:
 *   "Overdue" (rose) · "Due in 20m" (amber, within the hour) · "Due 14:30"
 *   (neutral). No TAT clock (no budget / not received) → renders nothing.
 */
@Component({
  selector: 'pf-tat-indicator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (label()) {
      <span class="pf-tat-chip" [attr.data-tat]="state()" [attr.title]="detail()"
            [attr.aria-label]="detail()">
        <span class="pf-tat-chip__dot" aria-hidden="true"></span>{{ label() }}
      </span>
    }
  `,
  styles: [`
    :host { display: inline-flex; }
    .pf-tat-chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 2px 8px; border-radius: 999px;
      font-size: 12px; font-weight: 500; line-height: 18px; white-space: nowrap;
      font-variant-numeric: tabular-nums;
      color: var(--text-secondary, #475569);
      background: var(--glass-bg-subtle, rgba(148, 163, 184, 0.12));
      border: 1px solid var(--glass-border, rgba(148, 163, 184, 0.28));
    }
    .pf-tat-chip__dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.55; }
    .pf-tat-chip[data-tat='overdue'] {
      color: var(--red-text, #dc2626);
      background: color-mix(in srgb, var(--red-text, #dc2626) 10%, transparent);
      border-color: color-mix(in srgb, var(--red-text, #dc2626) 30%, transparent);
    }
    .pf-tat-chip[data-tat='dueSoon'] {
      color: var(--amber-text, #b45309);
      background: color-mix(in srgb, var(--amber-text, #b45309) 10%, transparent);
      border-color: color-mix(in srgb, var(--amber-text, #b45309) 30%, transparent);
    }
    .pf-tat-chip[data-tat='overdue'] .pf-tat-chip__dot,
    .pf-tat-chip[data-tat='dueSoon'] .pf-tat-chip__dot { opacity: 1; }
  `]
})
export class TatIndicatorComponent {
  private readonly _remaining = signal<number | null>(null);
  private readonly _dueAt = signal<number | null>(null);

  @Input() set remainingMinutes(v: number | null | undefined) {
    this._remaining.set(v == null || !Number.isFinite(v) ? null : v);
  }
  /** Epoch ms (or ISO) the test is due — shown as "Due 14:30" when not
   *  within the hour. Optional: without it, "Due in 3h" is shown. */
  @Input() set dueAt(v: number | string | null | undefined) {
    const n = typeof v === 'string' ? new Date(v).getTime() : v;
    this._dueAt.set(n == null || !Number.isFinite(n) ? null : n);
  }

  readonly state = computed<TatState>(() => tatStateFor(this._remaining()));
  readonly label = computed(() => tatLabel({ remainingMin: this._remaining(), dueAt: this._dueAt() }));
  readonly detail = computed(() => tatDetail(this._remaining()));
}
