import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { PfIconComponent } from '../kit';

/**
 * The in-app number pad (plan §6: "keyboard-less where possible"). It opens
 * INLINE under the value it edits, so the iPad keyboard never covers the
 * page and nothing floats. 3 × 4 keys of 56px, then Clear / Done.
 *
 * It edits text (so "0." and "12.5" survive while typing); the owner turns
 * the text into a number.
 */
@Component({
  selector: 'fe-numpad',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fe-pad" role="group" [attr.aria-label]="label() + ' number pad'">
      <div class="fe-pad__keys">
        @for (k of keys(); track k) {
          @if (k === 'back') {
            <button type="button" class="fe-pad__key pf-touch" aria-label="Delete last digit" (click)="press('back')">
              <pf-icon name="delete" [size]="22" />
            </button>
          } @else if (k === '') {
            <span class="fe-pad__gap" aria-hidden="true"></span>
          } @else {
            <button
              type="button"
              class="fe-pad__key pf-touch"
              [attr.aria-label]="k === '.' ? 'decimal point' : k"
              (click)="press(k)"
            >
              {{ k }}
            </button>
          }
        }
      </div>
      <div class="fe-pad__foot">
        <button type="button" class="pf-btn pf-btn--tertiary" (click)="clear()">Clear</button>
        <button type="button" class="pf-btn pf-btn--secondary" (click)="done.emit()">Done</button>
      </div>
    </div>
  `,
})
export class NumpadComponent {
  readonly label = input<string>('');
  readonly text = input<string>('');
  readonly decimals = input<boolean>(true);
  /** Longest text accepted (digits + point). */
  readonly maxLength = input<number>(7);
  readonly textChange = output<string>();
  readonly done = output<void>();

  protected readonly keys = computed(() => [
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    this.decimals() ? '.' : '',
    '0',
    'back',
  ]);

  protected press(k: string): void {
    const t = this.text() ?? '';
    if (k === 'back') return this.textChange.emit(t.slice(0, -1));
    if (k === '.') {
      if (t.includes('.')) return;
      return this.textChange.emit((t || '0') + '.');
    }
    if (t.replace('.', '').length >= this.maxLength()) return;
    this.textChange.emit(t === '0' ? k : t + k);
  }

  protected clear(): void {
    this.textChange.emit('');
  }
}

/** '12.' → 12, '' → null. */
export function parseNumber(text: string): number | null {
  if (text === '' || text === '.') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** 12 → '12', 1.50 → '1.5', null → ''. */
export function numberText(n: unknown): string {
  if (typeof n === 'number' && Number.isFinite(n)) return String(Math.round(n * 1e6) / 1e6);
  if (typeof n === 'string' && n.trim() !== '' && Number.isFinite(Number(n))) return n.trim();
  return '';
}

/** Clamp and round to the step's decimals. */
export function stepValue(current: number | null, delta: number, min?: number, max?: number): number {
  const base = current ?? (delta > 0 ? (min ?? 0) - delta : (max ?? 0) - delta);
  let v = base + delta;
  const dec = Math.max(decimalsOf(delta), decimalsOf(base));
  v = Number(v.toFixed(Math.min(dec, 6)));
  if (min !== undefined && v < min) v = min;
  if (max !== undefined && v > max) v = max;
  return v;
}

function decimalsOf(n: number): number {
  const s = String(n);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}
