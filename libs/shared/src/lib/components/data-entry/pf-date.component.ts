import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

/**
 * Kit date input (PF-PATTERN §15, lifted out of registration's DOB field so
 * any screen can use it): a typed `dd/mm/yyyy` box (auto slashes, Noto
 * tabular numbers) + a calendar button over a HIDDEN native picker. The
 * native `<input type="date">` is never the visible control — Safari shows
 * today greyed in it and its look differs per browser.
 *
 * Value in / out is ISO `yyyy-mm-dd` (or null while incomplete / invalid).
 * An impossible date, or one outside [min, max], shows an inline error and
 * is never emitted.
 */
@Component({
  selector: 'pf-date',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-block min-w-0' },
  template: `
    <span class="relative block min-w-0">
      <input #txt type="text" inputmode="numeric" autocomplete="off" maxlength="10"
             placeholder="dd/mm/yyyy" class="pf-input pf-num w-full pr-10"
             [class.pf-input--error]="!!error()"
             [attr.id]="inputId() || null"
             [attr.aria-label]="label()"
             [attr.aria-invalid]="error() ? true : null"
             [value]="text()" (input)="onInput(txt)" (blur)="onBlur()" />
      <button type="button" class="pf-date__pick absolute right-1 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-lg border-0 bg-transparent text-[var(--text-tertiary)] hover:bg-[var(--pf-chip-bg)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500" tabindex="-1" [attr.aria-label]="'Pick ' + label().toLowerCase()"
              title="Pick a date" (click)="openPicker(pick)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
        </svg>
      </button>
      <input #pick type="date" class="pf-date__native" tabindex="-1" aria-hidden="true"
             [attr.min]="min() || null" [attr.max]="max() || null"
             [value]="value() || ''" (change)="onPicked(pick.value)" />
    </span>
    @if (error()) { <p class="pf-date__err mt-1 mb-0 text-xs text-[var(--red-text,#dc2626)]" role="alert">{{ error() }}</p> }
  `,
  styles: [`
    .pf-date__native { position: absolute; right: 0; bottom: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; border: 0; padding: 0; }
    @media (hover: none) and (pointer: coarse) { .pf-date__pick { width: 40px; height: 40px; right: 2px; } }
  `],
})
export class PfDateComponent {
  /** ISO yyyy-mm-dd (or null / ''). */
  readonly value = input<string | null>(null);
  readonly min = input<string | null>(null);
  readonly max = input<string | null>(null);
  /** Accessible name (also used for the calendar button). */
  readonly label = input<string>('Date');
  readonly inputId = input<string | null>(null);
  readonly valueChange = output<string | null>();

  private readonly typing = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly text = computed(() => this.typing() ?? PfDateComponent.isoToDmy(this.value()));

  static isoToDmy(v: unknown): string {
    const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  }

  onInput(el: HTMLInputElement): void {
    const d = el.value.replace(/\D/g, '').slice(0, 8);
    const t = d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
    if (el.value !== t) el.value = t;
    this.typing.set(t);
    this.error.set(null);
    if (d.length < 8) return;
    const day = +d.slice(0, 2), mon = +d.slice(2, 4), yr = +d.slice(4);
    const iso = `${d.slice(4)}-${d.slice(2, 4)}-${d.slice(0, 2)}`;
    const dt = new Date(yr, mon - 1, day);
    const real = yr >= 1900 && dt.getFullYear() === yr && dt.getMonth() === mon - 1 && dt.getDate() === day;
    if (!real) { this.error.set('Not a valid date (dd/mm/yyyy)'); return; }
    const max = this.max(), min = this.min();
    if (max && iso > max) { this.error.set("Can't be after " + PfDateComponent.isoToDmy(max)); return; }
    if (min && iso < min) { this.error.set("Can't be before " + PfDateComponent.isoToDmy(min)); return; }
    this.typing.set(null);
    this.valueChange.emit(iso);
  }

  onBlur(): void {
    // A half-typed date stays on screen only while its error explains it.
    if (!this.error()) this.typing.set(null);
  }

  onPicked(v: string): void {
    this.typing.set(null);
    this.error.set(null);
    if (v) this.valueChange.emit(v);
  }

  openPicker(el: HTMLInputElement): void {
    try { (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { el.click(); }
  }
}
