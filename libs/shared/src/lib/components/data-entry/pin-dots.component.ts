import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef,
  input, output, signal, viewChild,
} from '@angular/core';

/** iPhone-style 4-dot PIN entry with Prefrontal brand styling. Exactly four
 *  digits — the hidden input sanitizes to digits, caps at 4, and emits
 *  (completed) the moment the fourth digit lands (auto-submit, no button needed).
 *  Filled dots use the signature Prefrontal violet gradient (never harsh black).
 *  Parents call clear() on a wrong PIN to shake back to empty. */
@Component({
  selector: 'pf-pin-dots',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="relative inline-flex cursor-text items-center gap-3.5 px-2 py-2" [class.pd-error]="shake()" (click)="focus()">
      @for (i of [0, 1, 2, 3]; track i) {
        <span
          class="pd-dot"
          [class.pd-dot--filled]="value().length > i"
          [class.pd-dot--active]="focused() && value().length === i"></span>
      }
      <!-- type="tel" + inputmode="numeric" reliably summons the NUMERIC keypad on
           iOS + Android; a password input made iOS show the alphanumeric keyboard
           (or none). The input is opacity:0 so digits are never visible anyway —
           the dots render the masked state. -->
      <input #field class="pd-input" type="tel" inputmode="numeric" pattern="[0-9]*"
             autocomplete="off" autocorrect="off" spellcheck="false"
             maxlength="4" enterkeyhint="done" aria-label="PIN"
             (input)="onInput($any($event.target).value)"
             (focus)="focused.set(true)" (blur)="focused.set(false)"
             [disabled]="disabled()" />
    </div>
  `,
  styles: [`
    :host {
      display: inline-flex;
    }
    .pd-dot {
      width: 18px;
      height: 18px;
      border-radius: 9999px;
      border: 1.5px solid var(--pf-pin-empty-border, rgba(124, 58, 237, 0.28));
      background: var(--pf-pin-empty-bg, rgba(124, 58, 237, 0.04));
      transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
      box-sizing: border-box;
    }

    /* Dark mode empty state */
    :host-context(html.dark) .pd-dot,
    :host-context([data-theme='dark']) .pd-dot {
      --pf-pin-empty-border: rgba(255, 255, 255, 0.24);
      --pf-pin-empty-bg: rgba(255, 255, 255, 0.05);
    }

    /* Active cursor dot waiting for digit */
    .pd-dot--active {
      border-color: #8b5cf6;
      background: rgba(139, 92, 246, 0.12);
      box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.18);
      transform: scale(1.08);
    }

    /* Filled dot: Prefrontal Signature Brand Color Combination (Violet to Fuchsia gradient) */
    .pd-dot--filled {
      border-color: transparent;
      background: linear-gradient(135deg, #7c3aed 0%, #9333ea 50%, #db2777 100%);
      box-shadow: 0 2px 10px rgba(124, 58, 237, 0.42), 0 1px 3px rgba(0, 0, 0, 0.1);
      transform: scale(1.12);
    }

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
