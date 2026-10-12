import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Accession daily number chip: `#12`.
 * Prefixes patient names on specimen accession queues and result entry lists.
 */
@Component({
  selector: 'pf-daily-no',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (label()) {
      <span class="pf-dayno" [attr.title]="title()" [attr.aria-label]="title()">
        {{ label() }}
      </span>
    }
  `,
  styles: [`
    :host { display: inline-flex; vertical-align: middle; }
    .pf-dayno {
      display: inline-flex;
      align-items: center;
      padding: 1px 6px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      background: var(--glass-bg-subtle, rgba(148, 163, 184, 0.12));
      color: var(--text-secondary, #475569);
      border: 1px solid var(--border-muted, rgba(148, 163, 184, 0.2));
    }
  `]
})
export class DailyNoComponent {
  readonly no = input<number | string | null | undefined>(null);
  readonly day = input<string | null | undefined>(undefined);

  readonly label = computed(() => {
    const n = this.no();
    if (n == null || n === '') return null;
    return `#${n}`;
  });

  readonly title = computed(() => {
    const n = this.no();
    return n != null ? `Daily sequence: #${n}` : '';
  });
}
