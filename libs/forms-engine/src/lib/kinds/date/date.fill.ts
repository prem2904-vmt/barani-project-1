import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { PfIconComponent, PfSelectOption, SelectComponent } from '../../kit';
import { KindFill } from '../../fill/contract';
import { NumpadComponent, parseNumber } from '../../fill/numpad.component';
import {
  MONTHS,
  Ymd,
  addDays,
  compare,
  daysIn,
  approxBirth,
  display,
  fromDate,
  isBirthDate,
  leadingBlanks,
  parseIso,
  same,
  spoken,
  toIso,
} from './date-math';

interface Chip {
  label: string;
  date: Ymd;
}

/**
 * date — two shapes, chosen by the field:
 *  - a DATE OF BIRTH (isBirthDate): year first on the number pad, then the
 *    month as 12 chips, then the day; or "Only know the age?" → an
 *    approximate date. No "today / yesterday" chips (they make no sense).
 *  - an EVENT date (onset, visit, last period): quick chips
 (Today / Yesterday / 1 week ago) and "Pick a date",
 * which opens an INLINE month calendar (no native date input, no overlay).
 * Month and year are searchable pf-selects, so a date of birth decades back
 * is two taps. Value 'yyyy-mm-dd'; shown as dd/mm/yyyy.
 */
@Component({
  selector: 'fe-date-fill',
  standalone: true,
  imports: [PfIconComponent, SelectComponent, NumpadComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (birth()) {
      <div class="fe-date fe-dob" role="group" [attr.aria-labelledby]="labelId()">
        @if (chosen() && !editing()) {
          <div class="fe-chips">
            <span class="fe-date__value" aria-live="polite">{{ shown() }}</span>
            @if (!disabled()) {
              <button type="button" class="pf-btn pf-btn--secondary" (click)="startEdit()">Change</button>
              <button type="button" class="pf-btn pf-btn--tertiary" (click)="clearBirth()">Clear</button>
            }
          </div>
        } @else if (ageMode()) {
          <div class="fe-sub">
            <span class="fe-sub__lbl">Age in years</span>
            <button
              type="button"
              class="fe-numbox"
              [class.fe-numbox--empty]="!ageText()"
              [attr.aria-label]="'Age in years: ' + (ageText() || 'not set') + '. Tap to type.'"
              [disabled]="disabled()"
            >
              <span class="fe-numbox__v">{{ ageText() || 'Tap to enter' }}</span>
              <span class="fe-numbox__u">years</span>
            </button>
          </div>
          <fe-numpad
            label="Age in years"
            [text]="ageText()"
            [decimals]="false"
            [maxLength]="3"
            (textChange)="ageText.set($event)"
            (done)="useAge()"
          />
          <div class="fe-chips">
            <button type="button" class="pf-btn pf-btn--tertiary" (click)="ageMode.set(false)">
              Enter the date instead
            </button>
          </div>
        } @else {
          <div class="fe-sub">
            <span class="fe-sub__lbl">Year</span>
            <div class="fe-chips">
              <button
                type="button"
                class="fe-numbox"
                data-dob="year"
                [class.fe-numbox--empty]="!yearText()"
                [attr.aria-expanded]="yearPad()"
                [attr.aria-label]="'Year of birth: ' + (yearText() || 'not set') + '. Tap to type.'"
                [disabled]="disabled()"
                (click)="yearPad.set(!yearPad())"
              >
                <span class="fe-numbox__v">{{ yearText() || 'Tap to enter' }}</span>
              </button>
              <button type="button" class="pf-btn pf-btn--tertiary" [disabled]="disabled()" (click)="ageMode.set(true)">
                Only know the age?
              </button>
            </div>
            @if (yearProblem()) {
              <p class="fe-field__err">{{ yearProblem() }}</p>
            }
          </div>
          @if (yearPad() && !disabled()) {
            <fe-numpad
              label="Year of birth"
              [text]="yearText()"
              [decimals]="false"
              [maxLength]="4"
              (textChange)="typeYear($event)"
              (done)="yearPad.set(false)"
            />
          }
          @if (dobY()) {
            <div class="fe-sub">
              <span class="fe-sub__lbl">Month</span>
              <div class="fe-months" role="radiogroup" aria-label="Month">
                @for (m of shortMonths; track $index; let i = $index) {
                  <button
                    type="button"
                    class="fe-chip"
                    role="radio"
                    [attr.aria-checked]="dobM() === i + 1"
                    [attr.aria-label]="months[i]"
                    [disabled]="disabled() || monthInFuture(i + 1)"
                    (click)="dobM.set(i + 1)"
                  >
                    {{ m }}
                  </button>
                }
              </div>
            </div>
          }
          @if (dobY() && dobM()) {
            <div class="fe-sub">
              <span class="fe-sub__lbl">Day</span>
              <div class="fe-cal__grid fe-cal__grid--plain">
                @for (d of dobDays(); track d.d) {
                  <button
                    type="button"
                    class="fe-cal__day pf-touch"
                    [attr.aria-label]="label(d)"
                    [attr.aria-pressed]="isSel(d)"
                    [disabled]="isFuture(d)"
                    (click)="pickBirthDay(d)"
                  >
                    {{ d.d }}
                  </button>
                }
              </div>
            </div>
          }
        }
      </div>
    } @else {
      <div class="fe-date" role="group" [attr.aria-labelledby]="labelId()">
        <div class="fe-chips">
          @if (quickChips()) {
            @for (c of chips(); track c.label) {
              <button
                type="button"
                class="fe-chip"
                [attr.aria-pressed]="isSel(c.date)"
                [disabled]="disabled() || isFuture(c.date)"
                (click)="toggle(c.date)"
              >
                <span class="fe-chip__check"><pf-icon name="check" [size]="16" [stroke]="2.4" /></span>
                {{ c.label }}
              </button>
            }
          }
          <button
            type="button"
            class="fe-chip"
            data-pick
            [attr.aria-expanded]="open()"
            [disabled]="disabled()"
            (click)="toggleCalendar()"
          >
            <pf-icon name="calendar" [size]="18" />
            Pick a date
          </button>
          @if (chosen() && !disabled()) {
            <button type="button" class="pf-btn pf-btn--tertiary" (click)="emit(undefined)">Clear</button>
          }
        </div>
        @if (chosen()) {
          <p class="fe-date__value" aria-live="polite">{{ shown() }}</p>
        }
        @if (open() && !disabled()) {
          <div class="fe-cal" role="group" aria-label="Calendar">
            <div class="fe-cal__head">
              <button type="button" class="fe-iconbtn" aria-label="Previous month" (click)="shift(-1)">
                <pf-icon name="chevron-left" [size]="22" />
              </button>
              <div class="fe-cal__month">
                <pf-select
                  [options]="monthOptions"
                  [value]="viewM()"
                  [searchable]="true"
                  placeholder="Month"
                  (valueChange)="setMonth($event)"
                />
              </div>
              <div class="fe-cal__year">
                <pf-select
                  [options]="yearOptions()"
                  [value]="viewY()"
                  [searchable]="true"
                  placeholder="Year"
                  (valueChange)="setYear($event)"
                />
              </div>
              <button
                type="button"
                class="fe-iconbtn"
                aria-label="Next month"
                [disabled]="!canNext()"
                (click)="shift(1)"
              >
                <pf-icon name="chevron-right" [size]="22" />
              </button>
            </div>
            <div class="fe-cal__grid">
              @for (w of weekdays; track w) {
                <span class="fe-cal__wd" aria-hidden="true">{{ w }}</span>
              }
              @for (b of blanks(); track $index) {
                <span aria-hidden="true"></span>
              }
              @for (d of days(); track d.d) {
                <button
                  type="button"
                  class="fe-cal__day pf-touch"
                  [attr.aria-label]="label(d)"
                  [attr.aria-pressed]="isSel(d)"
                  [attr.aria-current]="isToday(d) ? 'date' : null"
                  [disabled]="isFuture(d)"
                  (click)="pickDay(d)"
                >
                  {{ d.d }}
                </button>
              }
            </div>
          </div>
        }
      </div>
    }
  `,
})
export class DateFill extends KindFill {
  /** Today, read once per control (a spec may replace it before the first render). */
  today: Ymd = fromDate(new Date());

  protected readonly weekdays = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  protected readonly monthOptions: PfSelectOption<number>[] = MONTHS.map((m, i) => ({ value: i + 1, label: m }));

  protected readonly open = signal(false);
  protected readonly birth = computed(() =>
    isBirthDate(this.field().key, this.field().label, this.config()['purpose']),
  );
  protected readonly months = MONTHS;
  protected readonly shortMonths = MONTHS.map((m) => m.slice(0, 3));
  // year-first entry for a date of birth
  protected readonly editing = signal(false);
  protected readonly yearPad = signal(false);
  protected readonly yearText = signal('');
  protected readonly dobM = signal<number | null>(null);
  protected readonly ageMode = signal(false);
  protected readonly ageText = signal('');
  protected readonly dobY = computed(() => {
    const y = parseNumber(this.yearText());
    return y !== null && y >= this.today.y - 130 && y <= this.today.y ? y : null;
  });
  protected readonly yearProblem = computed(() => {
    const t = this.yearText();
    if (t.length < 4) return '';
    return this.dobY() ? '' : `Use a year between ${this.today.y - 130} and ${this.today.y}.`;
  });
  protected readonly dobDays = computed<Ymd[]>(() => {
    const y = this.dobY();
    const m = this.dobM();
    if (!y || !m) return [];
    return Array.from({ length: daysIn(y, m) }, (_, i) => ({ y, m, d: i + 1 }));
  });
  protected readonly quickChips = computed(() => this.config()['quickChips'] !== false);
  private readonly allowFuture = computed(() => this.config()['allowFuture'] === true);
  protected readonly chosen = computed(() => parseIso(this.value()));
  protected readonly shown = computed(() => (this.chosen() ? display(this.chosen()!) : ''));
  protected readonly chips = computed<Chip[]>(() => [
    { label: 'Today', date: this.today },
    { label: 'Yesterday', date: addDays(this.today, -1) },
    { label: '1 week ago', date: addDays(this.today, -7) },
  ]);

  private readonly view = signal<{ y: number; m: number } | null>(null);
  protected readonly viewY = computed(() => this.view()?.y ?? this.chosen()?.y ?? this.today.y);
  protected readonly viewM = computed(() => this.view()?.m ?? this.chosen()?.m ?? this.today.m);
  protected readonly yearOptions = computed<PfSelectOption<number>[]>(() => {
    const top = this.allowFuture() ? this.today.y + 10 : this.today.y;
    const out: PfSelectOption<number>[] = [];
    for (let y = top; y >= this.today.y - 120; y--) out.push({ value: y, label: String(y) });
    return out;
  });
  protected readonly blanks = computed(() => Array.from({ length: leadingBlanks(this.viewY(), this.viewM()) }));
  protected readonly days = computed<Ymd[]>(() =>
    Array.from({ length: daysIn(this.viewY(), this.viewM()) }, (_, i) => ({
      y: this.viewY(),
      m: this.viewM(),
      d: i + 1,
    })),
  );
  protected readonly canNext = computed(
    () =>
      this.allowFuture() ||
      this.viewY() < this.today.y ||
      (this.viewY() === this.today.y && this.viewM() < this.today.m),
  );

  protected isSel(d: Ymd): boolean {
    return same(d, this.chosen());
  }

  protected isToday(d: Ymd): boolean {
    return same(d, this.today);
  }

  protected isFuture(d: Ymd): boolean {
    return !this.allowFuture() && compare(d, this.today) > 0;
  }

  protected label(d: Ymd): string {
    return spoken(d) + (this.isToday(d) ? ', today' : '');
  }

  protected toggle(d: Ymd): void {
    this.emit(this.isSel(d) ? undefined : toIso(d));
  }

  protected pickDay(d: Ymd): void {
    if (this.isFuture(d)) return;
    if (this.isSel(d)) return this.emit(undefined);
    this.emit(toIso(d));
    this.open.set(false);
  }

  protected toggleCalendar(): void {
    this.view.set(null);
    this.open.set(!this.open());
  }

  protected shift(n: number): void {
    let m = this.viewM() + n;
    let y = this.viewY();
    if (m < 1) {
      m = 12;
      y--;
    } else if (m > 12) {
      m = 1;
      y++;
    }
    this.view.set({ y, m });
  }

  protected setMonth(m: number | null): void {
    if (m) this.view.set({ y: this.viewY(), m });
  }

  protected startEdit(): void {
    const c = this.chosen();
    this.yearText.set(c ? String(c.y) : '');
    this.dobM.set(c?.m ?? null);
    this.yearPad.set(!c);
    this.editing.set(true);
  }

  protected clearBirth(): void {
    this.yearText.set('');
    this.dobM.set(null);
    this.editing.set(true);
    this.yearPad.set(true);
    this.emit(undefined);
  }

  protected typeYear(t: string): void {
    this.yearText.set(t);
    if (t.length === 4 && this.dobY()) this.yearPad.set(false);
  }

  protected monthInFuture(m: number): boolean {
    return !this.allowFuture() && this.dobY() === this.today.y && m > this.today.m;
  }

  protected pickBirthDay(d: Ymd): void {
    if (this.isFuture(d)) return;
    this.emit(toIso(d));
    this.editing.set(false);
  }

  protected useAge(): void {
    const n = parseNumber(this.ageText());
    if (n === null || n < 0 || n > 130) return;
    this.emit(toIso(approxBirth(this.today, n)));
    this.ageMode.set(false);
    this.editing.set(false);
  }

  protected setYear(y: number | null): void {
    if (y) this.view.set({ y, m: this.viewM() });
  }
}
