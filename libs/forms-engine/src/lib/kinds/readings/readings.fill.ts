import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FeDialog, PfIconComponent } from '../../kit';
import { KindFill } from '../../fill/contract';
import { NumpadComponent, numberText, parseNumber } from '../../fill/numpad.component';

/** One column the form's author defined. */
export interface ReadingColumn {
  key: string;
  label: string;
  unit: string;
  min?: number;
  max?: number;
  step: number;
  role?: 'intake' | 'output';
}
/** One row: the time (local, `yyyy-MM-ddTHH:mm`) and the values by column key. */
export interface ReadingRow {
  time: string;
  values: Record<string, number>;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-11-12T08:05" for a local Date. */
export function stamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A stamp moved by whole minutes (the calendar does the carrying: 23:45 + 30 min = 00:15 the next day). */
export function shiftStamp(s: string, minutes: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  if (!m) return s;
  return stamp(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]) + minutes));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "08:05", or "12 Nov 08:05" when the reading is not from today. */
export function stampLabel(s: string, today: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(s);
  if (!m) return s;
  return s.startsWith(today) ? m[4] : `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[4]}`;
}

export function columnsOf(config: Record<string, unknown> | undefined): ReadingColumn[] {
  const a = Array.isArray(config?.['columns']) ? (config!['columns'] as Record<string, unknown>[]) : [];
  return a.flatMap((c) =>
    c && typeof c['key'] === 'string' && typeof c['label'] === 'string'
      ? [
          {
            key: c['key'],
            label: c['label'],
            unit: typeof c['unit'] === 'string' ? c['unit'] : '',
            min: typeof c['min'] === 'number' ? c['min'] : undefined,
            max: typeof c['max'] === 'number' ? c['max'] : undefined,
            step: typeof c['step'] === 'number' && c['step'] > 0 ? c['step'] : 1,
            role: c['role'] === 'intake' || c['role'] === 'output' ? (c['role'] as 'intake' | 'output') : undefined,
          },
        ]
      : [],
  );
}

export function rowsOf(v: unknown): ReadingRow[] {
  const a = (v as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(a)) return [];
  return a.flatMap((r) => {
    const o = r as { time?: unknown; values?: unknown } | null;
    if (!o || typeof o.time !== 'string') return [];
    const values: Record<string, number> = {};
    for (const [k, x] of Object.entries((o.values ?? {}) as Record<string, unknown>)) if (typeof x === 'number' && Number.isFinite(x)) values[k] = x;
    return [{ time: o.time, values }];
  });
}

/**
 * readings: timed readings of a few columns the form defines (vitals every 4 h, a sugar chart, intake and output). "Add a reading" adds a row
 * stamped with the time now; tap the time to move it (15 minutes, an hour, a day), tap a value to type it on the in-app number pad.
 * Answer `{ rows: [{ time, values: { <column key>: number } }] }`.
 */
@Component({
  selector: 'fe-readings-fill',
  standalone: true,
  imports: [NumpadComponent, PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fe-rd" role="group" [attr.aria-labelledby]="labelId()">
      @for (row of rows(); track $index; let i = $index) {
        <section class="fe-row fe-rd__row" [attr.data-row]="i" [attr.aria-label]="'Reading at ' + label(row.time)">
          <header class="fe-row__head">
            <button
              type="button"
              class="fe-chip fe-rd__time"
              data-act="time"
              [attr.aria-expanded]="timing() === i"
              [attr.aria-label]="'Time of reading ' + (i + 1) + ': ' + label(row.time) + '. Tap to change.'"
              [disabled]="disabled()"
              (click)="toggleTime(i)"
            >
              {{ label(row.time) }}
            </button>
            <span class="fe-row__title"></span>
            <button type="button" class="fe-iconbtn" [attr.aria-label]="'Remove the reading at ' + label(row.time)" [disabled]="disabled()" (click)="remove(i)">
              <pf-icon name="trash" [size]="20" />
            </button>
          </header>
          @if (timing() === i) {
            <div class="fe-chips fe-rd__shift" role="group" aria-label="Move the time">
              @for (s of shifts; track s.label) {
                <button type="button" class="fe-chip" [attr.data-shift]="s.minutes" (click)="shift(i, s.minutes)">{{ s.label }}</button>
              }
            </div>
          }
          <div class="fe-rd__cells">
            @for (c of columns(); track c.key) {
              <div class="fe-rd__cell">
                <span class="fe-rd__lab">{{ c.label }}</span>
                <button
                  type="button"
                  class="fe-numbox"
                  [attr.data-cell]="i + '-' + c.key"
                  [class.fe-numbox--empty]="valueOf(row, c.key) === null"
                  [attr.aria-expanded]="isOpen(i, c.key)"
                  [attr.aria-label]="c.label + (c.unit ? ', ' + c.unit : '') + ', reading ' + (i + 1) + ': ' + (valueOf(row, c.key) ?? 'not set') + '. Tap to type.'"
                  [disabled]="disabled()"
                  (click)="toggleCell(i, c.key)"
                >
                  <span class="fe-numbox__v">{{ shownText(row, i, c.key) || 'Tap' }}</span>
                  @if (c.unit) {
                    <span class="fe-numbox__u">{{ c.unit }}</span>
                  }
                </button>
              </div>
            }
          </div>
          @if (open(); as o) {
            @if (o.row === i) {
              <fe-numpad [label]="colOf(o.key).label" [text]="typing() ?? shownText(row, i, o.key)" [decimals]="decimalsOf(o.key)" (textChange)="type($event)" (done)="close()" />
            }
          }
        </section>
      }
      @if (rows().length < maxRows) {
        <button type="button" class="pf-btn pf-btn--secondary fe-add" data-act="add" [disabled]="disabled()" (click)="add()">
          <pf-icon name="plus" [size]="18" />
          {{ rows().length ? 'Add a reading' : 'Add the first reading' }}
        </button>
      }
    </div>
  `,
})
export class ReadingsFill extends KindFill {
  private readonly dialog = inject(FeDialog);
  protected readonly maxRows = 200;
  protected readonly columns = computed(() => columnsOf(this.config()));
  protected readonly rows = computed(() => rowsOf(this.value()));
  protected readonly timing = signal<number | null>(null);
  protected readonly open = signal<{ row: number; key: string } | null>(null);
  protected readonly typing = signal<string | null>(null);
  protected readonly shifts = [
    { label: 'A day earlier', minutes: -1440 },
    { label: 'An hour earlier', minutes: -60 },
    { label: '15 min earlier', minutes: -15 },
    { label: '15 min later', minutes: 15 },
    { label: 'An hour later', minutes: 60 },
    { label: 'A day later', minutes: 1440 },
  ];

  /** The time now, as a stamp; specs override it. */
  protected now(): string {
    return stamp(new Date());
  }

  protected label(time: string): string {
    return stampLabel(time, this.now().slice(0, 10));
  }

  protected colOf(key: string): ReadingColumn {
    return this.columns().find((c) => c.key === key)!;
  }
  protected decimalsOf(key: string): boolean {
    return !Number.isInteger(this.colOf(key).step);
  }
  protected valueOf(row: ReadingRow, key: string): number | null {
    return row.values[key] ?? null;
  }
  protected shownText(row: ReadingRow, i: number, key: string): string {
    return this.isOpen(i, key) && this.typing() !== null ? this.typing()! : numberText(this.valueOf(row, key));
  }
  protected isOpen(i: number, key: string): boolean {
    const o = this.open();
    return !!o && o.row === i && o.key === key;
  }

  protected add(): void {
    if (this.rows().length >= this.maxRows) return;
    this.close();
    this.timing.set(null);
    this.emit({ rows: this.sorted([...this.rows(), { time: this.now(), values: {} }]) });
  }

  protected toggleTime(i: number): void {
    this.close();
    if (this.timing() === i) {
      // closing the time editor puts the readings back in time order
      this.timing.set(null);
      this.emit({ rows: this.sorted(this.rows()) });
      return;
    }
    this.timing.set(i);
  }

  protected shift(i: number, minutes: number): void {
    this.emit({ rows: this.rows().map((r, j) => (j === i ? { ...r, time: shiftStamp(r.time, minutes) } : r)) });
  }

  protected toggleCell(i: number, key: string): void {
    this.timing.set(null);
    this.typing.set(null);
    this.open.set(this.isOpen(i, key) ? null : { row: i, key });
  }

  protected close(): void {
    this.typing.set(null);
    this.open.set(null);
  }

  protected type(t: string): void {
    const o = this.open();
    if (!o) return;
    this.typing.set(t);
    const n = parseNumber(t);
    const col = this.colOf(o.key);
    // never a value the question could not hold: the pad may pass through "1" on the way to "140"
    const v = n === null ? undefined : Math.min(col.max ?? Number.POSITIVE_INFINITY, Math.max(col.min ?? Number.NEGATIVE_INFINITY, n));
    this.emit({
      rows: this.rows().map((r, j) => {
        if (j !== o.row) return r;
        const values = { ...r.values };
        if (v === undefined) delete values[o.key];
        else values[o.key] = v;
        return { ...r, values };
      }),
    });
  }

  protected async remove(i: number): Promise<void> {
    const row = this.rows()[i];
    if (Object.keys(row.values).length) {
      const ok = await this.dialog.confirm({
        title: 'Remove this reading?',
        message: `The reading at ${this.label(row.time)} will be removed from this case sheet.`,
        confirmLabel: 'Remove',
        cancelLabel: 'Keep',
        tone: 'danger',
      });
      if (!ok) return;
    }
    this.close();
    this.timing.set(null);
    const rows = this.rows().filter((_, j) => j !== i);
    this.emit(rows.length ? { rows } : undefined);
  }

  private sorted(rows: ReadingRow[]): ReadingRow[] {
    return [...rows].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0)); // stable
  }
}
