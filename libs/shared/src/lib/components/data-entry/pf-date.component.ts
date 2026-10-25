import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EmbeddedViewRef,
  HostListener,
  OnDestroy,
  TemplateRef,
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
 *
 * Popover attaches to document.body to ensure it is never clipped by card
 * overflow, dialogs, drawers, or CSS transforms.
 */
@Component({
  selector: 'pf-date',
  standalone: true,
  imports: [PfCalendarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-block min-w-0 relative w-full' },
  template: `
    <span class="relative block min-w-0" #container>
      <input #txt type="text" inputmode="numeric" autocomplete="off" maxlength="10"
             placeholder="dd/mm/yyyy" class="pf-input pf-num w-full pr-10"
             [class.pf-input--error]="!!error() || !!externalError()"
             [attr.id]="inputId() || null"
             [attr.aria-label]="label()"
             [attr.aria-invalid]="(error() || externalError()) ? true : null"
             [attr.disabled]="disabled() ? true : null"
             [value]="text()" (input)="onInput(txt)" (blur)="onBlur()"
             (keydown.enter)="onEnter()" />
      <button type="button" class="pf-date__pick absolute right-1 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-lg border-0 bg-transparent text-[var(--text-tertiary)] hover:bg-[var(--pf-chip-bg)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 cursor-pointer" tabindex="-1" [attr.aria-label]="'Pick ' + label().toLowerCase()"
              [disabled]="disabled()"
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

      <!-- Prefrontal UI custom calendar popover (portal to document.body) -->
      <ng-template #datePanelTpl>
        <div class="pf-date__popover"
             [class.pf-date__popover--above]="popoverStyle().above"
             [style.top.px]="popoverStyle().top"
             [style.left.px]="popoverStyle().left"
             role="dialog"
             [attr.aria-label]="label() + ' calendar'"
             (click)="$event.stopPropagation()">
          <pf-calendar #calendar
                       [value]="value()"
                       [min]="min()"
                       [max]="max()"
                       [compact]="true"
                       (valueChange)="onCalendarPicked($event)">
          </pf-calendar>
        </div>
      </ng-template>
    </span>
    @if (error() || externalError()) {
      <p class="pf-date__err mt-1 mb-0 text-xs text-[var(--red-text,#dc2626)]" role="alert">{{ error() || externalError() }}</p>
    }
  `,
  styles: [`
    .pf-date__native { position: absolute; right: 0; bottom: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; border: 0; padding: 0; }
    @media (hover: none) and (pointer: coarse) { .pf-date__pick { width: 40px; height: 40px; right: 2px; } }
    .pf-date__popover {
      position: fixed;
      z-index: 99999;
      width: 285px;
      box-sizing: border-box;
      padding: 12px;
      border-radius: var(--pf-radius, 14px);
      background: var(--pf-card-bg, #ffffff);
      border: 1px solid var(--glass-border-hover, rgba(124, 58, 237, 0.3));
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.18), 0 2px 8px rgba(15, 23, 42, 0.08);
      animation: pf-pop 160ms cubic-bezier(0.32, 0.72, 0, 1) both;
    }
    .pf-date__popover--above {
      transform: translateY(-100%);
      animation-name: pf-pop-above;
    }
    :root.dark .pf-date__popover {
      background: var(--pf-card-bg, #0f172a);
      border-color: rgba(148, 163, 184, 0.25);
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
    }
    @keyframes pf-pop {
      from { opacity: 0; transform: translateY(-4px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes pf-pop-above {
      from { opacity: 0; transform: translateY(calc(-100% + 4px)) scale(0.97); }
      to { opacity: 1; transform: translateY(-100%) scale(1); }
    }
  `],
})
export class PfDateComponent implements OnDestroy {
  private readonly elRef = inject(ElementRef);
  private readonly appRef = inject(ApplicationRef);

  /** ISO yyyy-mm-dd (or null / ''). */
  readonly value = input<string | null>(null);
  readonly min = input<string | null>(null);
  readonly max = input<string | null>(null);
  /** Accessible name (also used for the calendar button). */
  readonly label = input<string>('Date');
  readonly inputId = input<string | null>(null);
  readonly disabled = input<boolean>(false);
  readonly externalError = input<string | null>(null, { alias: 'error' });
  readonly valueChange = output<string | null>();
  readonly hasPopup = input<boolean>(true);

  private readonly typing = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly isOpen = signal(false);

  readonly datePanelTpl = viewChild<TemplateRef<void>>('datePanelTpl');
  private datePanelRef?: EmbeddedViewRef<void>;
  readonly calendar = viewChild<PfCalendarComponent>('calendar');

  readonly popoverStyle = signal<{ top: number; left: number; above: boolean }>({ top: 0, left: 0, above: false });

  updateCoords(): void {
    const root = (this.elRef.nativeElement.querySelector('span') || this.elRef.nativeElement) as HTMLElement;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const popHeight = 360;
    const popWidth = 285;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    let left = Math.max(12, rect.left);
    if (left + popWidth > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - popWidth - 12);
    }

    let top: number;
    let above = false;
    if (spaceBelow >= popHeight || spaceBelow >= spaceAbove) {
      top = rect.bottom + 6;
      above = false;
    } else if (spaceAbove >= popHeight) {
      top = rect.top - 6;
      above = true;
    } else {
      top = Math.max(12, Math.min(window.innerHeight - popHeight - 12, rect.bottom + 6));
      above = false;
    }

    this.popoverStyle.set({ top, left, above });
  }

  openPicker(): void {
    if (this.isOpen() || this.disabled()) return;
    this.updateCoords();
    this.isOpen.set(true);

    const tpl = this.datePanelTpl();
    if (tpl) {
      this.datePanelRef = tpl.createEmbeddedView(null as unknown as void);
      this.appRef.attachView(this.datePanelRef);
      this.datePanelRef.detectChanges();
      const panelEl = this.datePanelRef.rootNodes.find(
        (n: Node) => n.nodeType === Node.ELEMENT_NODE
      ) as HTMLElement | undefined;
      if (panelEl) {
        document.body.appendChild(panelEl);
      }
    }

    const currentVal = this.value();
    if (currentVal) {
      setTimeout(() => this.calendar()?.jumpToMonthOf(currentVal));
    }
  }

  closePicker(): void {
    if (!this.isOpen()) return;
    if (this.datePanelRef) {
      const panelEl = this.datePanelRef.rootNodes.find(
        (n: Node) => n.nodeType === Node.ELEMENT_NODE
      ) as HTMLElement | undefined;
      if (panelEl && panelEl.parentElement === document.body) {
        document.body.removeChild(panelEl);
      }
      this.appRef.detachView(this.datePanelRef);
      this.datePanelRef.destroy();
      this.datePanelRef = undefined;
    }
    this.isOpen.set(false);
  }

  togglePicker(event: MouseEvent): void {
    event.stopPropagation();
    if (!this.hasPopup()) {
      const inputEl = this.elRef.nativeElement.querySelector('input') as HTMLInputElement;
      inputEl?.focus();
      return;
    }
    if (this.isOpen()) {
      this.closePicker();
    } else {
      this.openPicker();
    }
  }

  onCalendarPicked(iso: string): void {
    this.typing.set(null);
    this.error.set(null);
    this.valueChange.emit(iso);
    this.closePicker();
  }

  ngOnDestroy(): void {
    this.closePicker();
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
    const panelEl = this.datePanelRef?.rootNodes.find(
      (n: Node) => n.nodeType === Node.ELEMENT_NODE
    ) as HTMLElement | undefined;
    if (!this.elRef.nativeElement.contains(target) && (!panelEl || !panelEl.contains(target))) {
      this.closePicker();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen()) {
      this.closePicker();
    }
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
      this.closePicker();
    }
  }

  onBlur(): void {
    if (!this.error()) this.typing.set(null);
  }

  onPicked(v: string): void {
    this.typing.set(null);
    this.error.set(null);
    if (v) this.valueChange.emit(v);
  }

  openPickerNative(el: HTMLInputElement): void {
    try { (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { el.click(); }
  }
}
