import { ChangeDetectionStrategy, Component, EventEmitter, HostListener, Input, OnDestroy, Output } from '@angular/core';

export type PfNumberSize = 'sm' | 'md';

/**
 * Themed numeric input with scroll + stepper controls.
 *
 * UX:
 *  - Type or paste digits directly.
 *  - Hover the input, scroll wheel to increment/decrement by `step`.
 *  - Hold ▲/▼ to repeat; first click steps immediately, then 350ms delay,
 *    then every 70ms.
 *  - Shift+wheel or shift+arrow multiplies step by 10 for fast adjustment.
 *  - Respects `min` / `max`. Blur clamps to range.
 */
@Component({
  selector: 'pf-number-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="root" [attr.data-size]="size" [class.is-focused]="_focused" [class.is-disabled]="disabled">
      <input type="text"
             inputmode="decimal"
             class="field"
             [value]="displayValue()"
             [placeholder]="placeholder"
             [disabled]="disabled"
             (input)="onInput($event)"
             (wheel)="onWheel($event)"
             (keydown)="onKey($event)"
             (focus)="_focused = true"
             (blur)="onBlur()" />

      @if (!disabled) {
        <div class="steppers" aria-hidden="true">
          <button type="button"
                  class="step step-up"
                  [disabled]="atMax()"
                  (pointerdown)="startRepeat(1, $event)"
                  (pointerup)="stopRepeat()"
                  (pointerleave)="stopRepeat()"
                  (pointercancel)="stopRepeat()"
                  tabindex="-1"
                  aria-label="Increment">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <path d="m6 15 6-6 6 6"/>
            </svg>
          </button>
          <button type="button"
                  class="step step-down"
                  [disabled]="atMin()"
                  (pointerdown)="startRepeat(-1, $event)"
                  (pointerup)="stopRepeat()"
                  (pointerleave)="stopRepeat()"
                  (pointercancel)="stopRepeat()"
                  tabindex="-1"
                  aria-label="Decrement">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <path d="m6 9 6 6 6-6"/>
            </svg>
          </button>
        </div>
      }

      @if (suffix) {
        <span class="suffix">{{ suffix }}</span>
      }
    </div>
  `,
  styles: [`
    :host { display: inline-block; width: 100%; }

    .root {
      position: relative;
      display: flex;
      align-items: stretch;
      height: 38px;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      border-radius: 10px;
      transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
      overflow: hidden;
      box-sizing: border-box;
    }
    .root[data-size='sm'] { height: 34px; border-radius: 8px; }
    .root:not(.is-disabled):hover {
      border-color: var(--input-border-focus);
    }
    .root.is-focused {
      border-color: var(--input-border-focus);
      box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.18);
      background: var(--input-bg);
    }
    .root.is-disabled { opacity: 0.55; }

    .field {
      flex: 1;
      min-width: 0;
      background: transparent;
      border: none;
      outline: none;
      color: var(--text-primary);
      font-size: 13.5px;
      line-height: 36px;
      font-variant-numeric: tabular-nums;
      padding: 0 12px;
      height: 36px;
    }
    .root[data-size='sm'] .field { height: 32px; line-height: 32px; font-size: 13px; padding: 0 10px; }
    .field::placeholder { color: var(--text-muted); }

    .suffix {
      display: inline-flex;
      align-items: center;
      padding: 0 10px 0 0;
      color: var(--text-muted);
      font-size: 12px;
      font-variant-numeric: tabular-nums;   /* Noto, never a mono face */
      pointer-events: none;
    }

    .steppers {
      display: flex;
      flex-direction: column;
      border-left: 1px solid var(--input-border);
      width: 22px;
      flex-shrink: 0;
    }
    .root[data-size='sm'] .steppers { width: 20px; }

    .step {
      flex: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease;
      padding: 0;
    }
    .step:not(:disabled):hover {
      background: rgba(168, 85, 247, 0.18);
      color: var(--text-primary);
    }
    .step:not(:disabled):active {
      background: var(--gradient-primary);
      color: #ffffff;
    }
    .step:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }
    .step-up { border-bottom: 1px solid var(--glass-border); }

    /* Hide native number spinners if type ever becomes number */
    input[type='number']::-webkit-outer-spin-button,
    input[type='number']::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    input[type='number'] { -moz-appearance: textfield; }
  `]
})
export class NumberInputComponent implements OnDestroy {
  @Input() value: number | null = 0;
  @Input() min?: number;
  @Input() max?: number;
  @Input() step = 1;
  @Input() fastMultiplier = 10;
  @Input() size: PfNumberSize = 'md';
  @Input() placeholder = '';
  @Input() suffix?: string;
  @Input() disabled = false;
  @Input() allowEmpty = false;

  @Output() valueChange = new EventEmitter<number | null>();

  protected _focused = false;
  private _repeatTimer?: ReturnType<typeof setTimeout>;
  private _repeatInterval?: ReturnType<typeof setInterval>;
  private _rawInput: string | null = null;

  displayValue(): string {
    if (this._rawInput !== null) return this._rawInput;
    const v = this.value;
    return v === null || v === undefined || (Number.isNaN(v) && !this.allowEmpty) ? '' : String(v);
  }

  atMin(): boolean {
    return this.min !== undefined && this.value !== null && this.value !== undefined && this.value <= this.min;
  }
  atMax(): boolean {
    return this.max !== undefined && this.value !== null && this.value !== undefined && this.value >= this.max;
  }

  onInput(ev: Event) {
    const raw = (ev.target as HTMLInputElement).value;
    // Allow intermediate states like "-" or "." while typing.
    this._rawInput = raw;
    if (raw === '' || raw === '-' || raw === '.' || raw === '-.') {
      if (this.allowEmpty && raw === '') this.emit(null);
      return;
    }
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    this.emit(n);
  }

  onBlur() {
    this._focused = false;
    this._rawInput = null;
    // Clamp on blur.
    if (this.value !== null && this.value !== undefined && !Number.isNaN(this.value)) {
      const clamped = this.clamp(this.value);
      if (clamped !== this.value) this.emit(clamped);
    }
  }

  onWheel(ev: WheelEvent) {
    if (!this._focused) return; // Only scroll when focused to avoid hijacking page scroll.
    ev.preventDefault();
    const dir = ev.deltaY < 0 ? 1 : -1;
    const step = ev.shiftKey ? this.step * this.fastMultiplier : this.step;
    this.nudge(dir * step);
  }

  onKey(ev: KeyboardEvent) {
    if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      this.nudge(ev.shiftKey ? this.step * this.fastMultiplier : this.step);
    } else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      this.nudge(-(ev.shiftKey ? this.step * this.fastMultiplier : this.step));
    }
  }

  startRepeat(direction: 1 | -1, ev: PointerEvent) {
    ev.preventDefault();
    (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
    this.nudge(direction * this.step);
    // After 350ms, start repeating every 70ms.
    this._repeatTimer = setTimeout(() => {
      this._repeatInterval = setInterval(() => this.nudge(direction * this.step), 70);
    }, 350);
  }

  stopRepeat() {
    if (this._repeatTimer) { clearTimeout(this._repeatTimer); this._repeatTimer = undefined; }
    if (this._repeatInterval) { clearInterval(this._repeatInterval); this._repeatInterval = undefined; }
  }

  private nudge(delta: number) {
    const current = this.value ?? 0;
    const next = this.clamp(this.round(current + delta));
    if (next === this.value) return;
    this._rawInput = null;
    this.emit(next);
  }

  private clamp(v: number): number {
    if (this.min !== undefined && v < this.min) v = this.min;
    if (this.max !== undefined && v > this.max) v = this.max;
    return v;
  }

  private round(v: number): number {
    // Guard against binary-float drift (0.1 + 0.2 === 0.30000…).
    const decimals = (this.step.toString().split('.')[1] ?? '').length;
    if (!decimals) return v;
    const factor = Math.pow(10, decimals);
    return Math.round(v * factor) / factor;
  }

  private emit(v: number | null) {
    this.value = v;
    this.valueChange.emit(v);
  }

  @HostListener('document:pointerup')
  onDocPointerUp() { this.stopRepeat(); }

  ngOnDestroy() { this.stopRepeat(); }
}
