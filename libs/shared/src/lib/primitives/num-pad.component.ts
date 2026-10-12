import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * Touch-first numeric keypad. 3×4 grid — digits 1–9, then decimal / sign / 0 / ⌫,
 * with an optional full-width Confirm row. Desktop users can still click; phones
 * and tablets get the "no keyboard popup" experience.
 *
 * Emits `valueChange` on every keypress so the host can mirror it into a signal
 * and drive live validation (e.g. change-calculation in the cash panel, or
 * flag-badge evaluation in result entry).
 */
@Component({
  selector: 'pf-num-pad',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-pad" [class.pf-pad--compact]="compact">
      @for (k of keys(); track k.id) {
        <button type="button"
                (click)="press(k.value)"
                [disabled]="k.kind === 'spacer'"
                class="pf-key"
                [class.pf-key--util]="k.kind === 'util'"
                [class.pf-key--spacer]="k.kind === 'spacer'"
                [attr.aria-label]="k.aria">
          {{ k.label }}
        </button>
      }
      @if (showConfirm) {
        <button type="button"
                (click)="confirmed.emit()"
                class="pf-key-confirm"
                [disabled]="!value || confirmDisabled">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m5 12 4 4L19 6"/>
          </svg>
          {{ confirmLabel }}
        </button>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }

    .pf-pad {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      width: 100%;
    }
    .pf-pad--compact {
      gap: 6px;
    }

    .pf-key {
      height: 64px;
      border-radius: 18px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      font-size: 22px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      cursor: pointer;
      transition: transform 80ms ease, background 0.15s ease, border-color 0.15s ease, filter 80ms ease;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      -webkit-tap-highlight-color: transparent;
    }
    .pf-key:hover:not(:disabled) {
      background: var(--glass-bg-hover);
      border-color: var(--glass-border-hover, rgba(124, 58, 237, 0.3));
    }
    .pf-key:active:not(:disabled) {
      transform: scale(0.96);
      filter: brightness(1.08);
    }
    .pf-key:disabled { cursor: default; }

    .pf-key--util {
      font-size: 17px;
      color: var(--text-secondary);
      background: rgba(255, 255, 255, 0.02);
    }
    :root.light .pf-key--util { background: rgba(15, 23, 42, 0.03); }

    .pf-key--spacer {
      background: transparent !important;
      border-color: transparent !important;
      cursor: default;
    }

    .pf-pad--compact .pf-key { height: 46px; font-size: 18px; border-radius: 12px; }

    .pf-key-confirm {
      grid-column: 1 / -1;
      height: 60px;
      border-radius: 18px;
      background: var(--gradient-primary);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #ffffff;
      font-size: 16px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      cursor: pointer;
      box-shadow: 0 8px 22px rgba(124, 58, 237, 0.35);
      transition: transform 80ms ease, box-shadow 0.25s ease, filter 80ms ease;
    }
    .pf-key-confirm:hover:not(:disabled) {
      box-shadow: 0 14px 32px rgba(124, 58, 237, 0.45);
      transform: translateY(-1px);
    }
    .pf-key-confirm:active:not(:disabled) {
      transform: scale(0.98);
      filter: brightness(1.08);
    }
    .pf-key-confirm:disabled {
      opacity: 0.45;
      cursor: not-allowed;
      box-shadow: none;
    }
    .pf-pad--compact .pf-key-confirm { height: 44px; font-size: 14px; border-radius: 12px; }
  `]
})
export class NumPadComponent {
  @Input() value = '';
  @Input() allowDecimal = true;
  @Input() allowNegative = false;
  @Input() compact = false;
  @Input() showConfirm = false;
  @Input() confirmLabel = 'Confirm';
  @Input() confirmDisabled = false;
  @Input() maxLength = 12;

  @Output() valueChange = new EventEmitter<string>();
  @Output() confirmed = new EventEmitter<void>();

  // Using a function so the template re-computes whenever the host passes new
  // allowDecimal / allowNegative flags.
  readonly keys = (): Array<{ id: string; label: string; value: string; kind: 'digit' | 'util' | 'spacer'; aria: string }> => {
    const digit = (n: string) => ({ id: n, label: n, value: n, kind: 'digit' as const, aria: n });
    const util  = (v: string, label: string, aria: string) => ({ id: v, label, value: v, kind: 'util' as const, aria });

    const bottomLeft = this.allowDecimal
      ? util('.', '.', 'Decimal point')
      : this.allowNegative
        ? util('±', '±', 'Toggle sign')
        : util('C', 'C', 'Clear');

    return [
      digit('1'), digit('2'), digit('3'),
      digit('4'), digit('5'), digit('6'),
      digit('7'), digit('8'), digit('9'),
      bottomLeft, digit('0'), util('⌫', '⌫', 'Backspace'),
    ];
  };

  press(k: string): void {
    if (!k) return;
    const cur = this.value ?? '';
    if (k === '⌫') {
      this.valueChange.emit(cur.slice(0, -1));
      return;
    }
    if (k === 'C') {
      this.valueChange.emit('');
      return;
    }
    if (k === '±') {
      this.valueChange.emit(cur.startsWith('-') ? cur.slice(1) : ('-' + cur));
      return;
    }
    if (k === '.' && cur.includes('.')) return;
    if (cur.length >= this.maxLength) return;
    this.valueChange.emit(cur + k);
  }
}
