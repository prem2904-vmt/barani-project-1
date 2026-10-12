import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  signal,
  viewChildren,
} from '@angular/core';

export interface CalendarDay {
  iso: string;
  dayNumber: number;
  outside: boolean;
  today: boolean;
  disabled: boolean;
  label: string;
}

const DOW_HEADERS: ReadonlyArray<{ short: string; full: string }> = [
  { short: 'M', full: 'Monday' },
  { short: 'T', full: 'Tuesday' },
  { short: 'W', full: 'Wednesday' },
  { short: 'T', full: 'Thursday' },
  { short: 'F', full: 'Friday' },
  { short: 'S', full: 'Saturday' },
  { short: 'S', full: 'Sunday' },
];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Shared Prefrontal UI Calendar Component.
 * Supports inline card mode and dropdown popover mode.
 * Styled with pf-kit tokens (brand violet accents, neutral states, hover affordances).
 */
@Component({
  selector: 'pf-calendar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-cal" [class.pf-cal--compact]="compact()">
      <div class="pf-cal__head">
        <button type="button" class="pf-cal__nav press"
                [disabled]="isPrevMonthDisabled()"
                (click)="navMonth(-1)"
                aria-label="Previous month" title="Previous month">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6"/>
          </svg>
        </button>

        <span class="pf-cal__title" aria-live="polite">
          {{ monthYearTitle() }}
        </span>

        <button type="button" class="pf-cal__nav press"
                [disabled]="isNextMonthDisabled()"
                (click)="navMonth(1)"
                aria-label="Next month" title="Next month">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m9 18 6-6-6-6"/>
          </svg>
        </button>
      </div>

      <div class="pf-cal__grid" role="grid" [attr.aria-label]="monthYearTitle()" (keydown)="onKey($event)">
        <div class="pf-cal__dows" role="row">
          @for (dow of dows; track $index) {
            <span class="pf-cal__dow" role="columnheader" [attr.aria-label]="dow.full">{{ dow.short }}</span>
          }
        </div>

        <div class="pf-cal__weeks" role="rowgroup">
          @for (week of weeks(); track $index) {
            <div class="pf-cal__row" role="row">
              @for (day of week; track day.iso) {
                <button type="button"
                        #dayButton
                        class="pf-cal__day"
                        role="gridcell"
                        [attr.data-iso]="day.iso"
                        [class.pf-cal__day--out]="day.outside"
                        [class.pf-cal__day--today]="day.today"
                        [attr.aria-selected]="day.iso === value() ? true : null"
                        [attr.aria-disabled]="day.disabled ? true : null"
                        [attr.aria-current]="day.today ? 'date' : null"
                        [attr.aria-label]="day.label"
                        [attr.tabindex]="day.iso === rovingIso() ? 0 : -1"
                        (click)="!day.disabled && pickDay(day.iso)">
                  <span class="pf-cal__n pf-num">{{ day.dayNumber }}</span>
                </button>
              }
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .pf-cal {
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
      user-select: none;
    }
    .pf-cal__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 2px 4px;
    }
    .pf-cal__title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
      text-align: center;
      flex: 1 1 auto;
    }
    .pf-cal__nav {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: var(--pf-radius-chip, 8px);
      border: 1px solid transparent;
      background: transparent;
      color: var(--text-secondary);
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
    }
    .pf-cal__nav:hover:not(:disabled) {
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 7%, var(--pf-card-bg, #ffffff));
      border-color: var(--glass-border-hover, rgba(124, 58, 237, 0.3));
      color: var(--text-primary);
    }
    .pf-cal__nav:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }
    .pf-cal__nav:focus-visible {
      outline: 2px solid var(--color-violet-600, #7c3aed);
      outline-offset: 1px;
    }
    .pf-cal__grid {
      display: flex;
      flex-direction: column;
      gap: 4px;
      width: 100%;
    }
    .pf-cal__dows {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 3px;
    }
    .pf-cal__dow {
      padding: 4px 0;
      text-align: center;
      font-size: 11.5px;
      font-weight: 600;
      letter-spacing: 0.05em;
      color: var(--text-tertiary, #94a3b8);
    }
    .pf-cal__weeks {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .pf-cal__row {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 3px;
    }
    .pf-cal__day {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 0;
      height: 36px;
      padding: 0;
      border-radius: var(--pf-radius-chip, 8px);
      border: 1px solid transparent;
      background: transparent;
      font: inherit;
      color: var(--text-primary);
      cursor: pointer;
      transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease;
    }
    .pf-cal__n {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      font-size: 13.5px;
      font-weight: 500;
      line-height: 1;
    }
    .pf-cal__day:hover:not([aria-disabled='true']):not([aria-selected='true']) {
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 7%, var(--pf-card-bg, #ffffff));
      border-color: var(--glass-border-hover, rgba(124, 58, 237, 0.3));
    }
    .pf-cal__day:focus-visible {
      outline: 2px solid var(--color-violet-600, #7c3aed);
      outline-offset: 1px;
      z-index: 2;
    }
    .pf-cal__day--out {
      color: var(--text-tertiary, #94a3b8);
      opacity: 0.65;
    }
    .pf-cal__day--out .pf-cal__n {
      font-weight: 400;
    }
    .pf-cal__day[aria-disabled='true'] {
      cursor: not-allowed;
      color: var(--text-tertiary, #94a3b8);
      opacity: 0.35;
    }
    .pf-cal__day--today .pf-cal__n {
      color: var(--color-primary, #7c3aed);
      font-weight: 700;
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 12%, transparent);
    }
    .pf-cal__day[aria-selected='true'] {
      border-color: var(--color-primary, #7c3aed);
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 10%, var(--pf-card-bg, #fff));
      color: var(--color-primary, #7c3aed);
      box-shadow: 0 1px 3px rgba(124, 58, 237, 0.2);
    }
    .pf-cal__day[aria-selected='true'] .pf-cal__n {
      font-weight: 700;
      color: #fff;
      background: var(--color-primary, #7c3aed);
    }
    .pf-cal--compact .pf-cal__day {
      height: 32px;
    }
    .pf-cal--compact .pf-cal__n {
      width: 26px;
      height: 26px;
      font-size: 12.5px;
    }
  `]
})
export class PfCalendarComponent {
  readonly value = input<string | null>(null);
  readonly min = input<string | null>(null);
  readonly max = input<string | null>(null);
  readonly compact = input(false);

  readonly valueChange = output<string>();

  readonly dows = DOW_HEADERS;

  private readonly dayButtons = viewChildren<ElementRef<HTMLButtonElement>>('dayButton');

  // Currently viewed year and month (0-indexed month)
  readonly viewYear = signal<number>(new Date().getFullYear());
  readonly viewMonth = signal<number>(new Date().getMonth());

  readonly rovingIso = signal<string>('');

  constructor() {
    const today = new Date();
    this.rovingIso.set(this.formatIso(today.getFullYear(), today.getMonth() + 1, today.getDate()));
  }

  readonly monthYearTitle = computed(() => {
    return `${MONTH_NAMES[this.viewMonth()]} ${this.viewYear()}`;
  });

  readonly isPrevMonthDisabled = computed(() => {
    const minStr = this.min();
    if (!minStr) return false;
    // If last day of prev month is before min
    const y = this.viewYear();
    const m = this.viewMonth();
    const lastDayPrev = new Date(y, m, 0);
    const lastPrevIso = this.formatIso(lastDayPrev.getFullYear(), lastDayPrev.getMonth() + 1, lastDayPrev.getDate());
    return lastPrevIso < minStr;
  });

  readonly isNextMonthDisabled = computed(() => {
    const maxStr = this.max();
    if (!maxStr) return false;
    const y = this.viewYear();
    const m = this.viewMonth();
    const firstDayNext = new Date(y, m + 1, 1);
    const firstNextIso = this.formatIso(firstDayNext.getFullYear(), firstDayNext.getMonth() + 1, firstDayNext.getDate());
    return firstNextIso > maxStr;
  });

  readonly weeks = computed(() => {
    const y = this.viewYear();
    const m = this.viewMonth();
    const today = new Date();
    const todayIso = this.formatIso(today.getFullYear(), today.getMonth() + 1, today.getDate());
    const minVal = this.min();
    const maxVal = this.max();

    const firstOfMonth = new Date(y, m, 1);
    // Monday = 0, Sunday = 6
    const startDow = (firstOfMonth.getDay() + 6) % 7;
    const startCalDate = new Date(y, m, 1 - startDow);

    const result: CalendarDay[][] = [];
    const curr = new Date(startCalDate);

    for (let w = 0; w < 6; w++) {
      const week: CalendarDay[] = [];
      for (let d = 0; d < 7; d++) {
        const cYear = curr.getFullYear();
        const cMonth = curr.getMonth();
        const cDay = curr.getDate();
        const iso = this.formatIso(cYear, cMonth + 1, cDay);

        const outside = cMonth !== m;
        const isToday = iso === todayIso;
        let disabled = false;
        if (minVal && iso < minVal) disabled = true;
        if (maxVal && iso > maxVal) disabled = true;

        const dayName = DOW_HEADERS[d].full;
        const monthName = MONTH_NAMES[cMonth];
        const label = `${dayName}, ${cDay} ${monthName} ${cYear}`;

        week.push({
          iso,
          dayNumber: cDay,
          outside,
          today: isToday,
          disabled,
          label,
        });

        curr.setDate(curr.getDate() + 1);
      }
      result.push(week);
    }
    return result;
  });

  navMonth(delta: number): void {
    let m = this.viewMonth() + delta;
    let y = this.viewYear();
    if (m < 0) {
      m = 11;
      y--;
    } else if (m > 11) {
      m = 0;
      y++;
    }
    this.viewYear.set(y);
    this.viewMonth.set(m);
  }

  jumpToMonthOf(iso: string): void {
    const match = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      this.viewYear.set(+match[1]);
      this.viewMonth.set(+match[2] - 1);
      this.rovingIso.set(iso);
    }
  }

  pickDay(iso: string): void {
    this.rovingIso.set(iso);
    this.valueChange.emit(iso);
  }

  onKey(event: KeyboardEvent): void {
    const current = this.rovingIso();
    if (!current) return;
    const match = current.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return;

    let targetDate = new Date(+match[1], +match[2] - 1, +match[3]);
    let handled = true;

    switch (event.key) {
      case 'ArrowLeft':
        targetDate.setDate(targetDate.getDate() - 1);
        break;
      case 'ArrowRight':
        targetDate.setDate(targetDate.getDate() + 1);
        break;
      case 'ArrowUp':
        targetDate.setDate(targetDate.getDate() - 7);
        break;
      case 'ArrowDown':
        targetDate.setDate(targetDate.getDate() + 7);
        break;
      case 'PageUp':
        targetDate.setMonth(targetDate.getMonth() - 1);
        break;
      case 'PageDown':
        targetDate.setMonth(targetDate.getMonth() + 1);
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const cell = this.findDay(current);
        if (cell && !cell.disabled) {
          this.pickDay(current);
        }
        return;
      }
      default:
        handled = false;
    }

    if (handled) {
      event.preventDefault();
      const newIso = this.formatIso(targetDate.getFullYear(), targetDate.getMonth() + 1, targetDate.getDate());
      this.viewYear.set(targetDate.getFullYear());
      this.viewMonth.set(targetDate.getMonth());
      this.rovingIso.set(newIso);

      setTimeout(() => {
        const btn = this.dayButtons().find(b => b.nativeElement.getAttribute('data-iso') === newIso);
        btn?.nativeElement.focus();
      });
    }
  }

  private findDay(iso: string): CalendarDay | undefined {
    for (const week of this.weeks()) {
      for (const day of week) {
        if (day.iso === iso) return day;
      }
    }
    return undefined;
  }

  private formatIso(y: number, m: number, d: number): string {
    const mm = m < 10 ? `0${m}` : `${m}`;
    const dd = d < 10 ? `0${d}` : `${d}`;
    return `${y}-${mm}-${dd}`;
  }
}
