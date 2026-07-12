import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef,
  input, output, signal, viewChild,
} from '@angular/core';

/** iPhone-style 4-dot PIN entry. Exactly four digits — the hidden input
 *  sanitizes to digits, caps at 4, and emits (completed) the moment the
 *  fourth digit lands (auto-submit, no button needed). Parents call clear()
 *  on a wrong PIN to shake back to empty. */
@Component({
  selector: 'pf-pin-dots',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pd-wrap" [class.pd-error]="shake()" (click)="focus()">
      @for (i of [0, 1, 2, 3]; track i) {
        <span class="pd-dot"
              [class.pd-dot--filled]="value().length > i"
              [class.pd-dot--active]="focused() && value().length === i"></span>
      }
      <input #field class="pd-input" type="password" inputmode="numeric"
             autocomplete="one-time-code" aria-label="PIN"
             (input)="onInput($any($event.target).value)"
             (focus)="focused.set(true)" (blur)="focused.set(false)"
             [disabled]="disabled()" />
    </div>
  `,
  styles: [`
    .pd-wrap {
      position: relative;
      display: inline-flex; gap: 16px; padding: 10px 6px;
      cursor: text;
    }
    .pd-dot {
      width: 16px; height: 16px; border-radius: 50%;
      border: 1.5px solid var(--glass-border);
      background: transparent;
      transition: background .12s ease, border-color .12s ease, transform .12s ease;
    }
    .pd-dot--filled {
      background: var(--text-primary, #fff);
      border-color: var(--text-primary, #fff);
      transform: scale(1.05);
    }
    .pd-dot--active { border-color: rgba(168, 85, 247, .7); }
    .pd-input {
      /* Invisible but focusable: keyboard lands here, dots render the state. */
      position: absolute; inset: 0; width: 100%; height: 100%;
      opacity: 0; border: none; outline: none; caret-color: transparent;
      font-size: 16px; /* stop iOS focus-zoom */
    }
    .pd-error { animation: pd-shake .35s ease; }
    @keyframes pd-shake {
      0%, 100% { transform: translateX(0); }
      25% { transform: translateX(-7px); }
      50% { transform: translateX(7px); }
      75% { transform: translateX(-4px); }
    }
  `],
})
export class PinDotsComponent implements AfterViewInit {
  readonly disabled = input(false);
  readonly autofocus = input(true);
  readonly completed = output<string>();

  readonly value = signal('');
  readonly focused = signal(false);
  readonly shake = signal(false);
  private field = viewChild<ElementRef<HTMLInputElement>>('field');

  ngAfterViewInit() {
    if (this.autofocus()) setTimeout(() => this.focus(), 60);
  }

  focus() { this.field()?.nativeElement.focus(); }

  onInput(raw: string) {
    const pin = raw.replace(/\D/g, '').slice(0, 4);
    this.value.set(pin);
    const el = this.field()?.nativeElement;
    if (el && el.value !== pin) el.value = pin;
    if (pin.length === 4) this.completed.emit(pin);
  }

  /** Wrong PIN: shake + reset for another try. */
  clear() {
    this.shake.set(true);
    setTimeout(() => this.shake.set(false), 380);
    this.value.set('');
    const el = this.field()?.nativeElement;
    if (el) el.value = '';
    this.focus();
  }
}
