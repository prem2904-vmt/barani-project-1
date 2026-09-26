import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

export type ToggleSize = 'sm' | 'md';

@Component({
  selector: 'pf-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button"
            role="switch"
            [attr.aria-checked]="checked"
            [attr.aria-label]="ariaLabel || null"
            [attr.aria-labelledby]="ariaLabelledby || null"
            [class]="rootClasses"
            [disabled]="disabled"
            (click)="toggle($event)">
      <span class="knob" [class.knob-on]="checked"></span>
    </button>
  `,
  styles: [`
    :host { display: inline-flex; }
    button {
      position: relative;
      border-radius: 9999px;
      border: 1px solid var(--border-muted);
      background: var(--surface-2);
      cursor: pointer;
      transition: background 0.2s ease, border-color 0.2s ease, transform 0.08s ease;
      padding: 0;
    }
    button:active:not(:disabled) { transform: scale(0.97); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    button:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }

    .sz-sm { width: 40px; height: 24px; }
    .sz-md { width: 52px; height: 30px; }

    button.on {
      background: var(--gradient-primary);
      border-color: transparent;
      box-shadow: 0 4px 14px rgba(124, 58, 237, 0.28);
    }
    /* New design: toggles are SLATE (ND-PATTERN §4) — never violet. */
    :host-context(.design-new) button { background: var(--nd-toggle-off); border-color: transparent; }
    :host-context(.design-new) button.on { background: var(--nd-toggle-on); box-shadow: none; }
    @media (prefers-reduced-motion: reduce) { button, .knob { transition: none; } }

    .knob {
      position: absolute;
      top: 2px;
      left: 2px;
      background: #ffffff;
      border-radius: 9999px;
      transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    }
    .sz-sm .knob { width: 18px; height: 18px; }
    .sz-md .knob { width: 24px; height: 24px; }

    .sz-sm .knob.knob-on { transform: translateX(16px); }
    .sz-md .knob.knob-on { transform: translateX(22px); }
  `]
})
export class ToggleComponent {
  @Input() checked = false;
  @Input() size: ToggleSize = 'md';
  @Input() disabled = false;
  /** Accessible name when no visible label is referenced. */
  @Input() ariaLabel = '';
  /** Id of the visible label that names this switch. */
  @Input() ariaLabelledby = '';
  @Output() checkedChange = new EventEmitter<boolean>();

  get rootClasses(): string {
    return `sz-${this.size}` + (this.checked ? ' on' : '');
  }

  toggle(ev: MouseEvent): void {
    if (this.disabled) return;
    ev.stopPropagation();
    this.checked = !this.checked;
    this.checkedChange.emit(this.checked);
  }
}
