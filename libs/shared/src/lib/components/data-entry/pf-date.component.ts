import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { PfCalendarComponent } from './pf-calendar.component.js';

/**
 * Kit date input (PF-PATTERN §15): a typed `dd/mm/yyyy` box (auto slashes, Noto
 * tabular numbers) + an interactive Prefrontal UI calendar picker popover.
 *
 * Value in / out is ISO `yyyy-mm-dd` (or null while incomplete / invalid).
 * An impossible date, or one outside [min, max], shows an inline error and
 * is never emitted.
 */
@Component({
  selector: 'pf-date',
  standalone: true,
  imports: [PfCalendarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-block min-w-0 relative' },
  template: `
    <span class="relative block min-w-0" #container>
      <input #txt type="text" inputmode="numeric" autocomplete="off" maxlength="10"
             placeholder="dd/mm/yyyy" class="pf-input pf-num w-full pr-10"
             [class.pf-input--error]="!!error()"
             [attr.id]="inputId() || null"
             [attr.aria-label]="label()"
             [attr.aria-invalid]="error() ? true : null"
             [value]="text()" (input)="onInput(txt)" (blur)="onBlur()"
             (keydown.enter)="onEnter()" />
      <button type="button" class="pf-date__pick absolute right-1 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-lg border-0 bg-transparent text-[var(--text-tertiary)] hover:bg-[var(--pf-chip-bg)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 cursor-pointer" tabindex="-1" [attr.aria-label]="'Pick ' + label().toLowerCase()"
              title="Pick a date" (click)="togglePicker($event)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
        </svg>
      </button>

      <!-- Native date input kept hidden for backward compatibility & headless tests -->
      <input #pick type="date" class="pf-date__native" tabindex="-1" aria-hidden="true"
             [attr.min]="min() || null" [attr.max]="max() || null"
             [value]="value() || ''" (change)="onPicked(pick.value)" />

      <!-- Prefrontal UI custom calendar popover -->
      @if (isOpen()) {
        <div class="pf-date__popover" [style.top]="popoverStyle().top || 'auto'" [style.bottom]="popoverStyle().bottom || 'auto'" [style.left]="popoverStyle().left" role="dialog" [attr.aria-label]="label() + ' calendar'" (click)="$event.stopPropagation()">
          <pf-calendar #calendar
                       [value]="value()"
                       [min]="min()"
                       [max]="max()"
                       [compact]="true"
                       (valueChange)="onCalendarPicked($event)">
          </pf-calendar>
        </div>
      }
    </span>
    @if (error()) { <p class="pf-date__err mt-1 mb-0 text-xs text-[var(--red-text,#dc2626)]" role="alert">{{ error() }}</p> }
  `,
  styles: [`
    .pf-date__native { position: absolute; right: 0; bottom: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; border: 0; padding: 0; }
    @media (hover: none) and (pointer: coarse) { .pf-date__pick { width: 40px; height: 40px; right: 2px; } }
    .pf-date__popover {
      position: fixed;
      z-index: 9999;
      min-width: 275px;
      padding: 12px;
      border-radius: var(--pf-radius, 14px);
      background: var(--pf-card-bg, #ffffff);
      border: 1px solid var(--glass-border-hover, rgba(124, 58, 237, 0.3));
      box-shadow: 0 12px 36px rgba(15, 23, 42, 0.16), 0 2px 6px rgba(15, 23, 42, 0.08);
      animation: pf-pop 200ms cubic-bezier(0.32, 0.72, 0, 1) both;
    }
    @keyframes pf-pop {
      from { opacity: 0; transform: translateY(-4px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
  `],
})
export class PfDateComponent {
  private readonly elRef = inject(ElementRef);

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
  readonly isOpen = signal(false);

  readonly calendar = viewChild<PfCalendarComponent>('calendar');

  readonly popoverStyle = signal<{ top?: string; bottom?: string; left: string }>({ left: '0px' });

  updateCoords(): void {
    const root = this.elRef.nativeElement.querySelector('.pf-date') as HTMLElement;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const popHeight = 320;
    const popWidth = 280;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    let left = Math.max(8, rect.left);
    if (left + popWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - popWidth - 8);
    }

    if (spaceBelow < popHeight && spaceAbove > spaceBelow) {
      this.popoverStyle.set({
        bottom: `${window.innerHeight - rect.top + 6}px`,
        left: `${left}px`,
      });
    } else {
      this.popoverStyle.set({
        top: `${rect.bottom + 6}px`,
        left: `${left}px`,
      });
    }
  }

  @HostListener('window:scroll')
  @HostListener('window:resize')
  onWindowChange(): void {
    if (this.isOpen()) {
      this.updateCoords();
    }
  }


  readonly text = computed(() => this.typing() ?? PfDateComponent.isoToDmy(this.value()));

  static isoToDmy(v: unknown): string {
    const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  }

  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointerDown(event: PointerEvent): void {
    if (!this.isOpen()) return;
    const target = event.target as Node;
    if (!this.elRef.nativeElement.contains(target)) {
      this.isOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen()) {
      this.isOpen.set(false);
    }
  }

  togglePicker(event: MouseEvent): void {
    event.stopPropagation();
    const nextState = !this.isOpen();
    this.isOpen.set(nextState);
    if (nextState) {
      const currentVal = this.value();
      if (currentVal) {
        setTimeout(() => this.calendar()?.jumpToMonthOf(currentVal));
      }
    }
  }

  onCalendarPicked(iso: string): void {
    this.typing.set(null);
    this.error.set(null);
    this.valueChange.emit(iso);
    this.isOpen.set(false);
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

  onEnter(): void {
    if (this.isOpen()) {
      this.isOpen.set(false);
    }
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
