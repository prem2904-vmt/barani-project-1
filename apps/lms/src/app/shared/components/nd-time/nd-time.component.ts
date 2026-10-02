import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

/**
 * Kit time input (sibling of `pf-nd-date`, ND-PATTERN §15): a typed `hh:mm`
 * box (auto colon, Noto tabular numbers) + a clock button over a HIDDEN
 * native `<input type="time">`. The native control is never the visible
 * one — its look (and the AM/PM vs 24h convention) differs per OS/browser.
 *
 * Value in / out is 24-hour `HH:mm` (or null while incomplete / invalid) —
 * the same string a native `type="time"` input reads and emits, so this is
 * a drop-in replacement.
 */
@Component({
  selector: 'pf-nd-time',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="pf-ndt" [class.pf-ndt--error]="!!error()">
      <input #txt type="text" inputmode="numeric" autocomplete="off" maxlength="5"
             placeholder="hh:mm" class="nd-input nd-num pf-ndt__in"
             [class.nd-input--error]="!!error()"
             [attr.id]="inputId() || null"
             [attr.aria-label]="label()"
             [attr.aria-invalid]="error() ? true : null"
             [value]="text()" (input)="onInput(txt)" (blur)="onBlur()" />
      <button type="button" class="pf-ndt__pick" tabindex="-1" [attr.aria-label]="'Pick ' + label().toLowerCase()"
              title="Pick a time" (click)="openPicker(pick)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>
        </svg>
      </button>
      <input #pick type="time" class="pf-ndt__native" tabindex="-1" aria-hidden="true"
             [value]="value() || ''" (change)="onPicked(pick.value)" />
    </span>
    @if (error()) { <p class="pf-ndt__err" role="alert">{{ error() }}</p> }
  `,
  styles: [`
    :host { display: inline-block; min-width: 0; }
    .pf-ndt { position: relative; display: block; min-width: 0; }
    .pf-ndt__in { width: 100%; padding-right: 40px; }
    .pf-ndt__pick {
      position: absolute; top: 50%; right: 4px; transform: translateY(-50%);
      display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;
      border: 0; border-radius: 8px; background: transparent; color: var(--text-tertiary); cursor: pointer;
    }
    .pf-ndt__pick:hover { color: var(--text-primary); background: var(--nd-chip-bg); }
    .pf-ndt__native { position: absolute; right: 0; bottom: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; border: 0; padding: 0; }
    .pf-ndt__err { margin: 4px 0 0; font-size: 12px; color: var(--red-text, #dc2626); }
    @media (max-width: 640px) { .pf-ndt__in { font-size: 16px; } }
    @media (hover: none) and (pointer: coarse) { .pf-ndt__pick { width: 40px; height: 40px; right: 2px; } }
  `],
})
export class NdTimeComponent {
  /** 24h HH:mm (or null / ''). */
  readonly value = input<string | null>(null);
  /** Accessible name (also used for the clock button). */
  readonly label = input<string>('Time');
  readonly inputId = input<string | null>(null);
  readonly valueChange = output<string | null>();

  private readonly typing = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly text = computed(() => this.typing() ?? NdTimeComponent.hmToDisplay(this.value()));

  static hmToDisplay(v: unknown): string {
    const m = String(v ?? '').match(/^(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : '';
  }

  onInput(el: HTMLInputElement): void {
    const d = el.value.replace(/\D/g, '').slice(0, 4);
    const t = d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
    if (el.value !== t) el.value = t;
    this.typing.set(t);
    this.error.set(null);
    if (d.length < 4) return;
    const hh = +d.slice(0, 2), mm = +d.slice(2, 4);
    if (hh > 23 || mm > 59) { this.error.set('Not a valid time (hh:mm, 24h)'); return; }
    this.typing.set(null);
    this.valueChange.emit(`${d.slice(0, 2)}:${d.slice(2, 4)}`);
  }

  onBlur(): void {
    // A half-typed time stays on screen only while its error explains it.
    if (!this.error()) this.typing.set(null);
  }

  onPicked(v: string): void {
    this.typing.set(null);
    this.error.set(null);
    if (v) this.valueChange.emit(v.slice(0, 5));
  }

  openPicker(el: HTMLInputElement): void {
    try { (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { el.click(); }
  }
}
