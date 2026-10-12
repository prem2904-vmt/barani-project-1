import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type TatState = 'normal' | 'dueSoon' | 'overdue';

/**
 * TAT indicator — Turn Around Time clock for specimens and orders.
 * Shows 'Overdue' (red), 'Due in 20m' (amber), or 'Due 14:30' (neutral slate).
 */
@Component({
  selector: 'pf-tat-indicator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (displayLabel()) {
      <span class="pf-tat-chip" [attr.data-tat]="computedState()" [attr.title]="detailTitle()"
            [attr.aria-label]="detailTitle()">
        <span class="pf-tat-chip__dot" aria-hidden="true"></span>{{ displayLabel() }}
      </span>
    }
  `,
  styles: [`
    :host { display: inline-flex; vertical-align: middle; }
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
  readonly remainingMinutes = input<number | null>(null);
  readonly dueAt = input<number | string | null>(null);
  readonly label = input<string | null>(null);
  readonly state = input<TatState | null>(null);

  protected readonly computedState = computed<TatState>(() => {
    if (this.state()) return this.state()!;
    const rem = this.remainingMinutes();
    if (rem == null) return 'normal';
    if (rem < 0) return 'overdue';
    if (rem <= 30) return 'dueSoon';
    return 'normal';
  });

  protected readonly displayLabel = computed<string | null>(() => {
    if (this.label()) return this.label();
    const rem = this.remainingMinutes();
    if (rem == null) return null;
    if (rem < 0) return `Overdue by ${Math.abs(rem)}m`;
    if (rem === 0) return 'Due now';
    if (rem < 60) return `Due in ${rem}m`;
    const h = Math.floor(rem / 60);
    const m = rem % 60;
    return m > 0 ? `Due in ${h}h ${m}m` : `Due in ${h}h`;
  });

  protected readonly detailTitle = computed<string>(() => {
    return `Specimen turnaround: ${this.displayLabel() ?? 'On schedule'}`;
  });
}
