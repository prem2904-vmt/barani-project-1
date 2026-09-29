import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnDestroy, Output, signal } from '@angular/core';
import { BusyComponent } from './skeleton-kit.component';
import { createSpinDelay } from '../utils/busy';

export type TouchBtnSize = 'sm' | 'md' | 'lg' | 'xl';
export type TouchBtnVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'accent'
  | 'danger'
  | 'success';

@Component({
  selector: 'pf-touch-btn',
  standalone: true,
  imports: [BusyComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button"
            [class]="rootClasses"
            [disabled]="disabled || isBusy()"
            [attr.aria-busy]="isBusy() ? 'true' : null"
            [class.pf-is-busy]="isBusy()"
            (click)="onClick($event)">
      <ng-content select="[icon-left]"></ng-content>
      <ng-content></ng-content>
      <ng-content select="[icon-right]"></ng-content>
      @if (dotsShown()) { <pf-busy class="pf-busy--inbtn" [label]="busyLabel"></pf-busy> }
    </button>
  `,
  styles: [`
    :host { display: inline-block; }
    :host([full='true']) { display: block; }

    button {
      width: 100%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      border: 1px solid transparent;
      cursor: pointer;
      transition: transform 0.08s ease, filter 0.15s ease, box-shadow 0.25s ease, background 0.25s ease;
      white-space: nowrap;
    }
    button:active:not(:disabled) { transform: scale(0.97); filter: brightness(1.08); }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    /* Busy (a request is running): stays readable — dimmed less than a
       plain disabled button, progress cursor, dots after 150ms. */
    button.pf-is-busy:disabled { opacity: 0.8; cursor: progress; }

    /* Sizes ---------------------------------------- */
    .sz-sm { height: 44px; padding: 0 16px; font-size: 14px;  border-radius: 14px; gap: 8px; }
    .sz-md { height: 56px; padding: 0 24px; font-size: 15px;  border-radius: 18px; gap: 10px; }
    .sz-lg { height: 64px; padding: 0 32px; font-size: 17px;  border-radius: 20px; gap: 12px; }
    .sz-xl { height: 80px; padding: 0 40px; font-size: 19px;  border-radius: 24px; gap: 12px; }

    /* Variants ------------------------------------- */
    .v-primary {
      background: var(--gradient-primary);
      color: #ffffff;
      box-shadow: 0 8px 22px rgba(124, 58, 237, 0.35);
    }
    .v-primary:hover:not(:disabled) {
      box-shadow: 0 14px 32px rgba(124, 58, 237, 0.45);
      transform: translateY(-1px);
    }

    .v-secondary {
      background: var(--glass-bg);
      color: var(--text-primary);
      border-color: var(--glass-border);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }
    .v-secondary:hover:not(:disabled) {
      background: var(--glass-bg-hover);
      border-color: var(--glass-border-hover);
    }

    .v-ghost {
      background: transparent;
      color: var(--text-secondary);
    }
    .v-ghost:hover:not(:disabled) {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .v-accent {
      background: linear-gradient(135deg, #0d9488, #10b981);
      color: #ffffff;
      box-shadow: 0 8px 22px rgba(16, 185, 129, 0.3);
    }
    .v-accent:hover:not(:disabled) {
      box-shadow: 0 14px 32px rgba(16, 185, 129, 0.42);
      transform: translateY(-1px);
    }

    .v-danger {
      background: #e11d48;
      color: #ffffff;
      box-shadow: 0 6px 18px rgba(225, 29, 72, 0.35);
    }
    .v-danger:hover:not(:disabled) { background: #be123c; }

    .v-success {
      background: #10b981;
      color: #ffffff;
      box-shadow: 0 6px 18px rgba(16, 185, 129, 0.35);
    }
    .v-success:hover:not(:disabled) { background: #059669; }
  `]
})
export class TouchButtonComponent implements OnDestroy {
  @Input() size: TouchBtnSize = 'md';
  /** The button's request is running: disabled + aria-busy at once, the
   *  kit's busy dots after 150ms (ND-PATTERN "Loading feedback"). */
  @Input() set busy(v: boolean) { this._busy.set(!!v); this.spin.set(!!v); }
  get busy(): boolean { return this._busy(); }
  /** What a screen reader hears while busy. */
  @Input() busyLabel = 'Working…';
  private readonly _busy = signal(false);
  private readonly spin = createSpinDelay();
  readonly isBusy = this._busy.asReadonly();
  readonly dotsShown = this.spin.shown;
  @Input() variant: TouchBtnVariant = 'primary';
  @Input() disabled = false;
  @Input() full = false;

  @Output() pressed = new EventEmitter<MouseEvent>();

  get rootClasses(): string {
    return `sz-${this.size} v-${this.variant}`;
  }

  onClick(ev: MouseEvent): void {
    if (this.disabled || this._busy()) return;
    this.pressed.emit(ev);
  }

  ngOnDestroy(): void { this.spin.dispose(); }
}
