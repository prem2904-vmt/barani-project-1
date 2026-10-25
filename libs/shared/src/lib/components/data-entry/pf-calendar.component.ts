import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
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
        @if (viewMode() === 'days') {
          <button type="button" class="pf-cal__nav press"
                  [disabled]="isPrevMonthDisabled()"
                  (click)="navMonth(-1)"
                  aria-label="Previous month" title="Previous month">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6"/>
            </svg>
          </button>

          <div class="pf-cal__title-group">
            <button type="button" class="pf-cal__picker-trigger" (click)="setViewMode('months')" aria-label="Select month" title="Select month">
              <span>{{ monthName() }}</span>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
            </button>
            <button type="button" class="pf-cal__picker-trigger" (click)="openYearMode()" aria-label="Select year" title="Select year">
              <span class="pf-num">{{ viewYear() }}</span>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
            </button>
          </div>

          <button type="button" class="pf-cal__nav press"
                  [disabled]="isNextMonthDisabled()"
                  (click)="navMonth(1)"
                  aria-label="Next month" title="Next month">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m9 18 6-6-6-6"/>
            </svg>
          </button>
        } @else if (viewMode() === 'months') {
          <span class="pf-cal__title">Select Month</span>
          <button type="button" class="pf-cal__nav-close" (click)="setViewMode('days')" aria-label="Back to days" title="Back to calendar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        } @else {
          <button type="button" class="pf-cal__nav press" (click)="navYearDecade(-12)" aria-label="Previous 12 years" title="Previous 12 years">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <span class="pf-cal__title pf-num">{{ yearPageStart() }} – {{ yearPageStart() + 11 }}</span>
          <button type="button" class="pf-cal__nav press" (click)="navYearDecade(12)" aria-label="Next 12 years" title="Next 12 years">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        }
      </div>

      @if (viewMode() === 'days') {
        <div class="pf-cal__grid" role="grid" [attr.aria-label]="monthYearTitle()" (keydown)="onKey($event)" (mouseleave)="onGridLeave()">
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
                          [class.pf-cal__day--range-start]="isRangeStart(day.iso)"
                          [class.pf-cal__day--range-end]="isRangeEnd(day.iso)"
                          [class.pf-cal__day--in-range]="isInRange(day.iso)"
                          [attr.aria-selected]="isSelected(day.iso) ? true : null"
                          [attr.aria-disabled]="day.disabled ? true : null"
                          [attr.aria-current]="day.today ? 'date' : null"
                          [attr.aria-label]="day.label"
                          [attr.tabindex]="day.iso === rovingIso() ? 0 : -1"
                          (mouseenter)="!day.disabled && onDayHover(day.iso)"
                          (click)="!day.disabled && pickDay(day.iso)">
                    <span class="pf-cal__n pf-num">{{ day.dayNumber }}</span>
                  </button>
                }
              </div>
            }
          </div>
        </div>
      } @else if (viewMode() === 'months') {
        <div class="pf-cal__choice-grid" role="group" aria-label="Months">
          @for (m of monthShortNames; track $index) {
            <button type="button"
                    class="pf-cal__choice"
                    [class.pf-cal__choice--active]="viewMonth() === $index"
                    (click)="selectMonth($index)">
              {{ m }}
            </button>
          }
        </div>
      } @else {
        <div class="pf-cal__choice-grid" role="group" aria-label="Years">
          @for (y of yearPageList(); track y) {
            <button type="button"
                    class="pf-cal__choice"
                    [class.pf-cal__choice--active]="viewYear() === y"
                    [disabled]="isYearDisabled(y)"
                    (click)="selectYear(y)">
              <span class="pf-num">{{ y }}</span>
            </button>
          }
        </div>
      }

      <div class="pf-cal__foot">
        <button type="button" class="pf-cal__action pf-cal__action--clear" (click)="clearDate()" title="Clear date">
          Clear
        </button>
        <div class="pf-cal__foot-right">
          <button type="button" class="pf-cal__action pf-cal__action--today" (click)="pickToday()" title="Select today">
            Today
          </button>
          @if (mode() === 'range' && selectedStart()) {
            <button type="button" class="pf-cal__action pf-cal__action--apply" (click)="applyRange()" title="Apply selected date range">
              Apply
            </button>
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
    .pf-cal__title-group {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .pf-cal__picker-trigger {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      height: 28px;
      padding: 0 8px;
      border: 1px solid var(--pf-line, rgba(148, 163, 184, 0.25));
      border-radius: 7px;
      background: var(--pf-chip-bg, #f1f5f9);
      color: var(--text-primary, #0f172a);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.14s ease;
    }
    .pf-cal__picker-trigger:hover {
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 10%, var(--pf-card-bg, #ffffff));
      border-color: var(--glass-border-hover, rgba(124, 58, 237, 0.35));
      color: var(--color-primary, #7c3aed);
    }
    .pf-cal__picker-trigger svg {
      color: var(--text-tertiary, #94a3b8);
      transition: transform 0.15s ease;
    }
    .pf-cal__picker-trigger:hover svg {
      color: var(--color-primary, #7c3aed);
    }
    .pf-cal__nav-close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 6px;
      border: 0;
      background: transparent;
      color: var(--text-tertiary, #94a3b8);
      cursor: pointer;
    }
    .pf-cal__nav-close:hover {
      background: var(--pf-chip-bg, #f1f5f9);
      color: var(--text-primary);
    }
    .pf-cal__choice-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
      padding: 6px 2px;
    }
    .pf-cal__choice {
      height: 38px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      border: 1px solid transparent;
      background: transparent;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary);
      cursor: pointer;
      transition: all 0.14s ease;
    }
    .pf-cal__choice:hover:not(:disabled):not(.pf-cal__choice--active) {
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 8%, var(--pf-card-bg, #ffffff));
      border-color: var(--glass-border-hover, rgba(124, 58, 237, 0.3));
      color: var(--color-primary, #7c3aed);
    }
    .pf-cal__choice:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }
    .pf-cal__choice--active {
      background: var(--color-primary, #7c3aed) !important;
      color: #ffffff !important;
      font-weight: 600;
      box-shadow: 0 1px 3px rgba(124, 58, 237, 0.3);
    }
    .pf-cal__foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-top: 1px solid var(--pf-line, rgba(148, 163, 184, 0.2));
      padding-top: 8px;
      margin-top: 4px;
    }
    .pf-cal__foot-right {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .pf-cal__action--apply {
      background: var(--color-primary, #7c3aed);
      color: #ffffff !important;
      font-weight: 600;
      padding: 4px 12px;
      border-radius: 6px;
    }
    .pf-cal__action--apply:hover {
      background: var(--color-violet-700, #6d28d9) !important;
      color: #ffffff !important;
    }
    .pf-cal__day--range-start {
      background: var(--color-primary, #7c3aed) !important;
      color: #ffffff !important;
      border-top-left-radius: var(--pf-radius-chip, 8px) !important;
      border-bottom-left-radius: var(--pf-radius-chip, 8px) !important;
      border-top-right-radius: 0 !important;
      border-bottom-right-radius: 0 !important;
      box-shadow: 0 1px 3px rgba(124, 58, 237, 0.3);
    }
    .pf-cal__day--range-start .pf-cal__n {
      color: #ffffff !important;
      background: transparent !important;
      font-weight: 700;
    }
    .pf-cal__day--range-end {
      background: var(--color-primary, #7c3aed) !important;
      color: #ffffff !important;
      border-top-right-radius: var(--pf-radius-chip, 8px) !important;
      border-bottom-right-radius: var(--pf-radius-chip, 8px) !important;
      border-top-left-radius: 0 !important;
      border-bottom-left-radius: 0 !important;
      box-shadow: 0 1px 3px rgba(124, 58, 237, 0.3);
    }
    .pf-cal__day--range-end .pf-cal__n {
      color: #ffffff !important;
      background: transparent !important;
      font-weight: 700;
    }
    .pf-cal__day--range-start.pf-cal__day--range-end {
      border-radius: var(--pf-radius-chip, 8px) !important;
    }
    .pf-cal__day--in-range {
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, var(--pf-card-bg, #ffffff)) !important;
      color: var(--color-primary, #7c3aed) !important;
      border-radius: 0 !important;
    }
    .pf-cal__day--in-range .pf-cal__n {
      font-weight: 600;
      background: transparent !important;
      color: var(--color-primary, #7c3aed) !important;
    }
    :root.dark .pf-cal__day--in-range {
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 22%, #0f172a) !important;
      color: #c4b5fd !important;
    }
    :root.dark .pf-cal__day--in-range .pf-cal__n {
      color: #c4b5fd !important;
    }
    .pf-cal__action {
      background: transparent;
      border: 0;
      font-size: 12.5px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 6px;
      cursor: pointer;
      color: var(--text-secondary, #64748b);
      transition: all 0.15s ease;
    }
    .pf-cal__action:hover {
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 8%, transparent);
      color: var(--color-primary, #7c3aed);
    }
    .pf-cal__action--today {
      color: var(--color-primary, #7c3aed);
      font-weight: 600;
    }
    :root.dark .pf-cal__picker-trigger {
      background: rgba(30, 41, 59, 0.6);
      border-color: rgba(148, 163, 184, 0.2);
    }
    :root.dark .pf-cal__foot {
      border-color: rgba(148, 163, 184, 0.2);
    }
  `]
})
export class PfCalendarComponent {
  readonly mode = input<'single' | 'range'>('single');
  readonly value = input<string | null>(null);
  readonly rangeStart = input<string | null>(null);
  readonly rangeEnd = input<string | null>(null);
  readonly min = input<string | null>(null);
  readonly max = input<string | null>(null);
  readonly compact = input(false);

  readonly valueChange = output<string>();
  readonly rangeChange = output<{ start: string; end: string }>();

  readonly selectedStart = signal<string | null>(null);
  readonly selectedEnd = signal<string | null>(null);
  readonly hoveredIso = signal<string | null>(null);

  readonly dows = DOW_HEADERS;

  private readonly dayButtons = viewChildren<ElementRef<HTMLButtonElement>>('dayButton');

  readonly viewMode = signal<'days' | 'months' | 'years'>('days');
  readonly yearPageStart = signal<number>(Math.floor(new Date().getFullYear() / 12) * 12);
  readonly monthShortNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Currently viewed year and month (0-indexed month)
  readonly viewYear = signal<number>(new Date().getFullYear());
  readonly viewMonth = signal<number>(new Date().getMonth());

  readonly monthName = computed(() => MONTH_NAMES[this.viewMonth()]);
  readonly yearPageList = computed(() => {
    const start = this.yearPageStart();
    return Array.from({ length: 12 }, (_, i) => start + i);
  });

  readonly rovingIso = signal<string>('');

  constructor() {
    const today = new Date();
    this.rovingIso.set(this.formatIso(today.getFullYear(), today.getMonth() + 1, today.getDate()));

    effect(() => {
      if (this.mode() === 'range') {
        const s = this.rangeStart();
        const e = this.rangeEnd();
        this.selectedStart.set(s || null);
        this.selectedEnd.set(e || null);
        if (s) {
          this.jumpToMonthOf(s);
        }
      } else {
        const v = this.value();
        if (v) {
          this.jumpToMonthOf(v);
        }
      }
    }, { allowSignalWrites: true });
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

  setViewMode(mode: 'days' | 'months' | 'years'): void {
    this.viewMode.set(mode);
  }

  openYearMode(): void {
    this.yearPageStart.set(Math.floor(this.viewYear() / 12) * 12);
    this.viewMode.set('years');
  }

  navYearDecade(delta: number): void {
    this.yearPageStart.update(v => v + delta);
  }

  selectMonth(m: number): void {
    this.viewMonth.set(m);
    this.viewMode.set('days');
  }

  selectYear(y: number): void {
    this.viewYear.set(y);
    this.viewMode.set('days');
  }

  isYearDisabled(y: number): boolean {
    const minStr = this.min();
    if (minStr) {
      const minY = parseInt(minStr.slice(0, 4), 10);
      if (y < minY) return true;
    }
    const maxStr = this.max();
    if (maxStr) {
      const maxY = parseInt(maxStr.slice(0, 4), 10);
      if (y > maxY) return true;
    }
    return false;
  }

  pickToday(): void {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();
    const d = today.getDate();
    const iso = this.formatIso(y, m + 1, d);
    const minVal = this.min();
    const maxVal = this.max();
    if (minVal && iso < minVal) return;
    if (maxVal && iso > maxVal) return;
    this.viewYear.set(y);
    this.viewMonth.set(m);
    this.viewMode.set('days');
    if (this.mode() === 'range') {
      this.selectedStart.set(iso);
      this.selectedEnd.set(iso);
      this.hoveredIso.set(null);
      this.rangeChange.emit({ start: iso, end: iso });
    } else {
      this.pickDay(iso);
    }
  }

  clearDate(): void {
    if (this.mode() === 'range') {
      this.selectedStart.set(null);
      this.selectedEnd.set(null);
      this.hoveredIso.set(null);
      this.rangeChange.emit({ start: '', end: '' });
    } else {
      this.valueChange.emit('');
    }
  }

  applyRange(): void {
    const s = this.selectedStart();
    if (!s) return;
    const e = this.selectedEnd() || s;
    const start = s <= e ? s : e;
    const end = s <= e ? e : s;
    this.selectedStart.set(start);
    this.selectedEnd.set(end);
    this.rangeChange.emit({ start, end });
  }

  onDayHover(iso: string): void {
    if (this.mode() === 'range' && this.selectedStart() && !this.selectedEnd()) {
      this.hoveredIso.set(iso);
    }
  }

  onGridLeave(): void {
    if (this.mode() === 'range') {
      this.hoveredIso.set(null);
    }
  }

  isRangeStart(iso: string): boolean {
    if (this.mode() !== 'range') return false;
    const s = this.selectedStart();
    const e = this.selectedEnd() || this.hoveredIso();
    if (!s) return false;
    if (!e) return iso === s;
    return iso === (s <= e ? s : e);
  }

  isRangeEnd(iso: string): boolean {
    if (this.mode() !== 'range') return false;
    const s = this.selectedStart();
    const e = this.selectedEnd() || this.hoveredIso();
    if (!s) return false;
    if (!e) return iso === s;
    return iso === (s <= e ? e : s);
  }

  isInRange(iso: string): boolean {
    if (this.mode() !== 'range') return false;
    const s = this.selectedStart();
    const e = this.selectedEnd() || this.hoveredIso();
    if (!s || !e) return false;
    const start = s <= e ? s : e;
    const end = s <= e ? e : s;
    return iso > start && iso < end;
  }

  isSelected(iso: string): boolean {
    if (this.mode() === 'range') {
      return this.isRangeStart(iso) || this.isRangeEnd(iso) || this.isInRange(iso);
    }
    return iso === this.value();
  }

  jumpToMonthOf(iso: string): void {
    const match = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      this.viewYear.set(+match[1]);
      this.viewMonth.set(+match[2] - 1);
      this.yearPageStart.set(Math.floor(+match[1] / 12) * 12);
      this.viewMode.set('days');
      this.rovingIso.set(iso);
    }
  }

  pickDay(iso: string): void {
    this.rovingIso.set(iso);
    if (this.mode() === 'range') {
      const s = this.selectedStart();
      const e = this.selectedEnd();
      if (!s || (s && e)) {
        this.selectedStart.set(iso);
        this.selectedEnd.set(null);
        this.hoveredIso.set(null);
      } else {
        let start = s;
        let end = iso;
        if (end < start) {
          start = iso;
          end = s;
        }
        this.selectedStart.set(start);
        this.selectedEnd.set(end);
        this.hoveredIso.set(null);
        this.rangeChange.emit({ start, end });
      }
    } else {
      this.valueChange.emit(iso);
    }
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
