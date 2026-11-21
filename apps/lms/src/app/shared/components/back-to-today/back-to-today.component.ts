import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * "You are looking at another day" chip + one-tap Back to today (owner 2026-11-21, screen view state).
 * A screen that comes back on a past (or future) date shows this next to its date control. Soft violet tint
 * (selection colour, never a second primary); only rendered while `show` is true.
 *
 *   <pf-back-to-today [show]="range() !== 'today'" [label]="rangeLabel()" (reset)="setRange('today')" />
 */
@Component({
  selector: 'pf-back-to-today',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (show()) {
      <button type="button" class="pf-btt press" data-testid="back-to-today" (click)="reset.emit()"
              [attr.aria-label]="(label() ? 'Showing ' + label() + '. ' : '') + 'Back to today'">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>
        </svg>
        @if (label()) { <span class="pf-btt__what">{{ label() }}</span><span class="pf-btt__sep" aria-hidden="true">·</span> }
        <span class="pf-btt__go">Back to today</span>
      </button>
    }
  `,
  styles: [`
    :host { display: contents; }
    .pf-btt {
      display: inline-flex; align-items: center; gap: 6px; flex: none; white-space: nowrap;
      min-height: 32px; padding: 0 12px; border-radius: 999px; cursor: pointer;
      font: inherit; font-size: 12px; font-weight: 600; line-height: 1;
      color: var(--color-violet-700, #6d28d9);
      background: color-mix(in srgb, var(--color-violet-500, #8b5cf6) 9%, transparent);
      border: 1px solid color-mix(in srgb, var(--color-violet-500, #8b5cf6) 30%, transparent);
      transition: background-color .16s ease, border-color .16s ease;
    }
    .pf-btt:hover { background: color-mix(in srgb, var(--color-violet-500, #8b5cf6) 15%, transparent); }
    .pf-btt:focus-visible { outline: 2px solid var(--color-violet-500, #8b5cf6); outline-offset: 2px; }
    .pf-btt__what { font-weight: 500; opacity: .85; }
    .pf-btt__sep { opacity: .5; }
    :host-context(.dark) .pf-btt, :host-context([data-theme="dark"]) .pf-btt { color: var(--color-violet-300, #c4b5fd); }
    @media (pointer: coarse) { .pf-btt { min-height: 44px; padding: 0 14px; } }
    @media (prefers-reduced-motion: reduce) { .pf-btt { transition: none; } }
  `],
})
export class BackToTodayComponent {
  /** Render the chip (the screen is on another day). */
  readonly show = input(false);
  /** What it is showing ("Yesterday", "12 Nov", "Last 7 days"); empty = just "Back to today". */
  readonly label = input('');
  readonly reset = output<void>();
}
