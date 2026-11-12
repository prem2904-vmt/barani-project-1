import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { PfIconComponent } from '../../kit';
import { KindFill } from '../../fill/contract';
import { NumpadComponent, numberText, parseNumber } from '../../fill/numpad.component';
import {
  GrowthMeasure,
  PartoReading,
  REF,
  Sex,
  actionCrossedAt,
  alertCrossedAt,
  analyseEar,
  ageWords,
  band,
  bandWords,
  earWords,
  growthLabel,
  growthRange,
  growthUnit,
  growthZ,
} from './chart-math';
import { ChartComponent } from './chart.component';
import { audiogramChart, growthCaption, growthChart, partographChart } from './chart-model';
import {
  Conduction,
  Ear,
  PlotChartValue,
  measuresOf,
  pointsOf,
  presetOf,
  readingsOf,
  sexOf,
  thresholdsOf,
  tidy,
} from './plotchart-value';

type PartoField = 'hour' | 'dilatation' | 'descent' | 'fhr' | 'contractions';
interface PartoCol {
  key: PartoField;
  label: string;
  unit: string;
  min: number;
  max: number;
  decimals: boolean;
}
export const PARTO_COLS: PartoCol[] = [
  { key: 'hour', label: 'Hour', unit: 'h', min: 0, max: 24, decimals: true },
  { key: 'dilatation', label: 'Cervix', unit: 'cm', min: 0, max: 10, decimals: true },
  { key: 'descent', label: 'Head', unit: '/5', min: 0, max: 5, decimals: false },
  { key: 'fhr', label: 'Heart rate', unit: 'bpm', min: 30, max: 260, decimals: false },
  { key: 'contractions', label: 'Contractions', unit: 'per 10 min', min: 0, max: 10, decimals: false },
];

/**
 * plotChart (three presets of one kind; the reference data is one json shared with the server):
 *  - `growth`: pick boy / girl, then add a reading (age in years and months, value) per measure; the WHO curves and the centile band show at once.
 *  - `audiogram`: pick the ear, tap a threshold (air or bone) and step it in 5 dB; the chart, the pure-tone average, the WHO grade and the type follow.
 *  - `partograph`: add a reading each time (hour, cervix, head, heart rate, contractions); the alert and action lines show where progress stands.
 * Entry is by tap and the in-app number pad (no keyboard, no native select); the chart is a picture of what was entered.
 */
@Component({
  selector: 'fe-plotchart-fill',
  standalone: true,
  imports: [ChartComponent, NumpadComponent, PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fe-pc" role="group" [attr.aria-labelledby]="labelId()" [attr.data-preset]="preset()">
      @switch (preset()) {
        @case ('growth') {
          <div class="fe-chips" role="group" aria-label="Sex">
            @for (s of sexes; track s.key) {
              <button type="button" class="fe-chip" [attr.data-sex]="s.key" [attr.aria-pressed]="sex() === s.key" [disabled]="disabled()" (click)="setSex(s.key)">{{ s.label }}</button>
            }
          </div>
          @if (measures().length > 1) {
            <div class="fe-chips" role="group" aria-label="What to plot">
              @for (m of measures(); track m) {
                <button type="button" class="fe-chip" [attr.data-measure]="m" [attr.aria-pressed]="measure() === m" (click)="measureChoice.set(m)">{{ label(m) }}</button>
              }
            </div>
          }
          @if (growth(); as g) {
            <fe-chart [spec]="g.spec" [summary]="g.title" />
            <p class="fe-field__hint">{{ g.note }}</p>
          } @else {
            <p class="fe-field__hint" data-hint="growth">
              {{ sex() ? 'Add a reading to see the ' + label(measure()).toLowerCase() + ' curves.' : 'Choose boy or girl, then add a reading to see the curves.' }}
            </p>
          }
          <div class="fe-pc__entry" role="group" [attr.aria-label]="'New ' + label(measure()).toLowerCase() + ' reading'">
            <div class="fe-pc__fields">
              <div class="fe-pc__cell">
                <span class="fe-pc__lab">Years</span>
                <button type="button" class="fe-numbox" data-entry="years" [class.fe-numbox--empty]="!years()" [attr.aria-expanded]="entry() === 'years'" [attr.aria-label]="'Age, years: ' + (years() || 'not set') + '. Tap to type.'" [disabled]="disabled()" (click)="openEntry('years')">
                  <span class="fe-numbox__v">{{ years() || '0' }}</span>
                </button>
              </div>
              <div class="fe-pc__cell">
                <span class="fe-pc__lab">Months</span>
                <button type="button" class="fe-numbox" data-entry="months" [class.fe-numbox--empty]="!months()" [attr.aria-expanded]="entry() === 'months'" [attr.aria-label]="'Age, months: ' + (months() || 'not set') + '. Tap to type.'" [disabled]="disabled()" (click)="openEntry('months')">
                  <span class="fe-numbox__v">{{ months() || '0' }}</span>
                </button>
              </div>
              <div class="fe-pc__cell">
                <span class="fe-pc__lab">{{ label(measure()) }}</span>
                <button type="button" class="fe-numbox" data-entry="value" [class.fe-numbox--empty]="!draft()" [attr.aria-expanded]="entry() === 'value'" [attr.aria-label]="label(measure()) + ': ' + (draft() || 'not set') + ' ' + unit(measure()) + '. Tap to type.'" [disabled]="disabled()" (click)="openEntry('value')">
                  <span class="fe-numbox__v">{{ draft() || 'Tap' }}</span>
                  <span class="fe-numbox__u">{{ unit(measure()) }}</span>
                </button>
              </div>
            </div>
            @if (entry(); as e) {
              <fe-numpad [label]="entryLabel()" [text]="entryText()" [decimals]="e === 'value'" [maxLength]="e === 'value' ? 6 : 2" (textChange)="typeEntry($event)" (done)="entry.set(null)" />
            }
            <button type="button" class="pf-btn pf-btn--primary fe-add" data-act="add-point" [disabled]="disabled() || !canAddPoint()" (click)="addPoint()">
              <pf-icon name="plus" [size]="18" />
              Add reading
            </button>
          </div>
          @if (shownPoints().length) {
            <ul class="fe-pc__list" aria-label="Readings plotted">
              @for (p of shownPoints(); track $index) {
                <li class="fe-pc__item" [attr.data-point]="$index">
                  <span class="fe-pc__item-text">{{ p.text }}</span>
                  <button type="button" class="fe-iconbtn" [attr.aria-label]="'Remove ' + p.text" [disabled]="disabled()" (click)="removePoint(p.index)">
                    <pf-icon name="trash" [size]="20" />
                  </button>
                </li>
              }
            </ul>
          }
        }
        @case ('audiogram') {
          <div class="fe-chips" role="group" aria-label="Ear">
            @for (e of ears; track e.key) {
              <button type="button" class="fe-chip" [attr.data-ear]="e.key" [attr.aria-pressed]="ear() === e.key" (click)="earChoice.set(e.key)">{{ e.label }}</button>
            }
          </div>
          <fe-chart [spec]="audiogram()" [summary]="earName() + ' audiogram'" />
          <p class="fe-pc__result" data-result="ear" [class.fe-pc__result--none]="!earSummary()">{{ earSummary() || 'The average and grade appear when air conduction is entered at 500, 1000, 2000 and 4000 Hz.' }}</p>
          <div class="fe-pc__aud" role="group" [attr.aria-label]="earName() + ' thresholds, dB HL'">
            <span class="fe-pc__aud-corner" aria-hidden="true"></span>
            @for (f of freqs; track f) {
              <span class="fe-pc__aud-head" aria-hidden="true">{{ freqLabel(f) }}</span>
            }
            @for (c of conductions; track c.key) {
              <span class="fe-pc__aud-row" aria-hidden="true">{{ c.short }}</span>
              @for (f of freqs; track f) {
                <button
                  type="button"
                  class="fe-chip fe-pc__tcell"
                  [attr.data-cell]="c.key + '-' + f"
                  [attr.aria-pressed]="isCell(c.key, f)"
                  [attr.aria-label]="earName() + ', ' + c.name + ' conduction, ' + f + ' Hz: ' + (threshold(c.key, f) ?? 'not tested')"
                  [disabled]="disabled()"
                  (click)="pickCell(c.key, f)"
                >
                  {{ threshold(c.key, f) ?? '–' }}
                </button>
              }
            }
          </div>
          @if (cell(); as c) {
            <div class="fe-pc__step" role="group" [attr.aria-label]="'Adjust ' + c.name + ' ' + c.freq + ' Hz'">
              <span class="fe-pc__step-name">{{ earName() }}, {{ c.name }} conduction, {{ c.freq }} Hz</span>
              <button type="button" class="fe-chip" data-act="less" [disabled]="disabled()" (click)="stepCell(-5)">−5 dB</button>
              <span class="fe-pc__step-v" aria-live="polite">{{ threshold(c.key, c.freq) ?? '–' }} dB</span>
              <button type="button" class="fe-chip" data-act="more" [disabled]="disabled()" (click)="stepCell(5)">+5 dB</button>
              <button type="button" class="fe-chip" data-act="clear-cell" [disabled]="disabled() || threshold(c.key, c.freq) === null" (click)="clearCell()">Clear</button>
            </div>
          }
          <p class="fe-field__hint">Tap a box, then lower or raise it in steps of 5 dB. O and &lt; are the right ear, X and &gt; the left. Air conduction is the solid line, bone conduction the dashed one.</p>
        }
        @default {
          <fe-chart [spec]="partograph()" summary="Partograph" />
          @if (partoSummary().length) {
            <ul class="fe-pc__flags" aria-label="Progress">
              @for (s of partoSummary(); track s.text) {
                <li class="fe-pc__flag" [class.fe-pc__flag--warn]="s.warn">{{ s.text }}</li>
              }
            </ul>
          }
          @for (r of partoRows(); track $index; let i = $index) {
            <section class="fe-row fe-pc__reading" [attr.data-row]="i" [attr.aria-label]="'Reading at hour ' + (r.hour)">
              <header class="fe-row__head">
                <span class="fe-row__title">Reading {{ i + 1 }}</span>
                <button type="button" class="fe-iconbtn" [attr.aria-label]="'Remove reading ' + (i + 1)" [disabled]="disabled()" (click)="removeReading(i)">
                  <pf-icon name="trash" [size]="20" />
                </button>
              </header>
              <div class="fe-pc__fields">
                @for (c of partoCols; track c.key) {
                  <div class="fe-pc__cell">
                    <span class="fe-pc__lab">{{ c.label }}</span>
                    <button type="button" class="fe-numbox" [attr.data-cell]="i + '-' + c.key" [class.fe-numbox--empty]="partoValue(i, c.key) === null" [attr.aria-expanded]="isPartoOpen(i, c.key)" [attr.aria-label]="c.label + ', reading ' + (i + 1) + ': ' + (partoValue(i, c.key) ?? 'not set') + ' ' + c.unit + '. Tap to type.'" [disabled]="disabled()" (click)="openParto(i, c.key)">
                      <span class="fe-numbox__v">{{ partoText(i, c.key) || 'Tap' }}</span>
                      <span class="fe-numbox__u">{{ c.unit }}</span>
                    </button>
                  </div>
                }
              </div>
              @if (partoOpen(); as o) {
                @if (o.row === i) {
                  <fe-numpad [label]="partoLabel(o.key)" [text]="typing() ?? partoText(i, o.key)" [decimals]="partoDecimals(o.key)" [maxLength]="5" (textChange)="typeParto($event)" (done)="closeParto()" />
                }
              }
            </section>
          }
          <button type="button" class="pf-btn pf-btn--secondary fe-add" data-act="add-reading" [disabled]="disabled() || partoRows().length >= 60" (click)="addReading()">
            <pf-icon name="plus" [size]="18" />
            {{ partoRows().length ? 'Add a reading' : 'Add the first reading' }}
          </button>
        }
      }
    </div>
  `,
})
export class PlotChartFill extends KindFill {
  protected readonly preset = computed(() => presetOf(this.config()));
  protected readonly val = computed<PlotChartValue>(() => (this.value() && typeof this.value() === 'object' ? (this.value() as PlotChartValue) : {}));

  // ================= growth =================
  protected readonly sexes: { key: Sex; label: string }[] = [
    { key: 'boy', label: 'Boy' },
    { key: 'girl', label: 'Girl' },
  ];
  protected readonly measures = computed(() => measuresOf(this.config()));
  protected readonly measureChoice = signal<GrowthMeasure | null>(null);
  protected readonly measure = computed<GrowthMeasure>(() => {
    const c = this.measureChoice();
    return c && this.measures().includes(c) ? c : this.measures()[0];
  });
  protected readonly sex = computed(() => sexOf(this.val()));
  protected readonly years = signal('0');
  protected readonly months = signal('0');
  protected readonly draft = signal('');
  protected readonly entry = signal<'years' | 'months' | 'value' | null>(null);

  protected label = growthLabel;
  protected unit = growthUnit;

  protected readonly growth = computed(() => {
    const sex = this.sex();
    if (!sex) return null;
    const spec = growthChart(this.measure(), sex, pointsOf(this.val()));
    if (!spec) return null;
    return { spec, ...growthCaption(this.measure(), sex, spec) };
  });

  protected readonly shownPoints = computed(() => {
    const sex = this.sex();
    const m = this.measure();
    return pointsOf(this.val())
      .map((p, index) => ({ p, index }))
      .filter((x) => x.p.measure === m)
      .sort((a, b) => a.p.age - b.p.age)
      .map(({ p, index }) => {
        const z = growthZ(m, sex, p.age, p.value);
        return { index, text: `${ageWords(p.age)}: ${numberText(p.value)} ${growthUnit(m)}${z === null ? '' : ', ' + bandWords(band(z))}` };
      });
  });

  protected entryLabel(): string {
    const e = this.entry();
    return e === 'years' ? 'Age in years' : e === 'months' ? 'Age in months' : this.label(this.measure());
  }
  protected entryText(): string {
    const e = this.entry();
    return e === 'years' ? this.years() : e === 'months' ? this.months() : this.draft();
  }
  protected openEntry(e: 'years' | 'months' | 'value'): void {
    this.entry.set(this.entry() === e ? null : e);
  }
  protected typeEntry(t: string): void {
    const e = this.entry();
    if (e === 'years') this.years.set(t);
    else if (e === 'months') this.months.set(t);
    else this.draft.set(t);
  }
  protected ageMonths(): number {
    return (parseNumber(this.years()) ?? 0) * 12 + (parseNumber(this.months()) ?? 0);
  }
  protected canAddPoint(): boolean {
    const v = parseNumber(this.draft());
    const age = this.ageMonths();
    return v !== null && v > 0 && age >= 0 && age <= 228;
  }
  protected setSex(s: Sex): void {
    this.write({ ...this.val(), sex: this.sex() === s ? undefined : s });
  }
  protected addPoint(): void {
    if (!this.canAddPoint()) return;
    const point = { measure: this.measure(), age: this.ageMonths(), value: parseNumber(this.draft())! };
    this.draft.set('');
    this.entry.set(null);
    this.write({ ...this.val(), points: [...pointsOf(this.val()), point] });
  }
  protected removePoint(index: number): void {
    this.write({ ...this.val(), points: pointsOf(this.val()).filter((_, i) => i !== index) });
  }
  /** The oldest age this measure's reference reaches, for the hint under the age boxes (specs). */
  rangeOf(m: GrowthMeasure): { from: number; to: number } {
    return growthRange(m);
  }

  // ================= audiogram =================
  protected readonly ears: { key: Ear; label: string }[] = [
    { key: 'right', label: 'Right ear' },
    { key: 'left', label: 'Left ear' },
  ];
  protected readonly conductions: { key: Conduction; name: string; short: string }[] = [
    { key: 'air', name: 'air', short: 'Air' },
    { key: 'bone', name: 'bone', short: 'Bone' },
  ];
  protected readonly freqs = REF.audiogram.frequencies;
  protected readonly earChoice = signal<Ear>('right');
  protected readonly ear = computed(() => this.earChoice());
  protected readonly cellChoice = signal<{ key: Conduction; freq: number } | null>(null);
  protected readonly cell = computed(() => {
    const c = this.cellChoice();
    return c ? { ...c, name: c.key } : null;
  });
  protected earName = () => (this.ear() === 'right' ? 'Right ear' : 'Left ear');
  protected freqLabel = (f: number) => (f >= 1000 ? `${f / 1000}k` : String(f));
  protected readonly air = computed(() => thresholdsOf(this.val(), this.ear(), 'air'));
  protected readonly bone = computed(() => thresholdsOf(this.val(), this.ear(), 'bone'));
  protected readonly audiogram = computed(() => audiogramChart(this.ear(), this.air(), this.bone()));
  protected readonly earSummary = computed(() => {
    const r = analyseEar(this.air(), this.bone());
    const words = earWords(r);
    if (!words || r.pta === null) return '';
    const note = r.grade !== 'normal hearing' && !r.type ? ', type not assessed (not enough bone conduction)' : '';
    return `${this.earName()}: ${words} (PTA ${r.pta} dB)${note}`;
  });
  protected threshold(c: Conduction, f: number): number | null {
    return (c === 'air' ? this.air() : this.bone())[f] ?? null;
  }
  protected isCell(c: Conduction, f: number): boolean {
    const x = this.cellChoice();
    return !!x && x.key === c && x.freq === f;
  }
  protected pickCell(c: Conduction, f: number): void {
    this.cellChoice.set(this.isCell(c, f) ? null : { key: c, freq: f });
  }
  protected stepCell(delta: number): void {
    const c = this.cellChoice();
    if (!c) return;
    const a = REF.audiogram;
    const cur = this.threshold(c.key, c.freq);
    // an empty box starts at 20 dB, the edge of normal hearing, whichever way it is stepped
    const next = cur === null ? 20 : Math.min(a.maxDb, Math.max(a.minDb, cur + delta));
    this.setThreshold(c, next);
  }
  protected clearCell(): void {
    const c = this.cellChoice();
    if (c) this.setThreshold(c, null);
  }
  private setThreshold(c: { key: Conduction; freq: number }, dB: number | null): void {
    const ear = this.ear();
    const v = this.val();
    const e = v[ear] ?? {};
    const side = { ...(e[c.key] ?? {}) };
    if (dB === null) delete side[String(c.freq)];
    else side[String(c.freq)] = dB;
    this.write({ ...v, [ear]: { ...e, [c.key]: side } });
  }

  // ================= partograph =================
  protected readonly partoCols = PARTO_COLS;
  protected readonly partoRows = computed(() => readingsOf(this.val()));
  protected readonly partograph = computed(() => partographChart(this.partoRows()));
  protected readonly partoOpen = signal<{ row: number; key: PartoField } | null>(null);
  protected readonly typing = signal<string | null>(null);
  protected readonly partoSummary = computed(() => {
    const rs = this.partoRows();
    const out: { text: string; warn: boolean }[] = [];
    if (!rs.some((r) => typeof r.dilatation === 'number')) return out;
    const alert = alertCrossedAt(rs);
    const action = actionCrossedAt(rs);
    out.push(alert === null ? { text: 'Has not crossed the alert line', warn: false } : { text: `Crossed the alert line at ${alert} h`, warn: true });
    if (action !== null) out.push({ text: `Crossed the action line at ${action} h`, warn: true });
    return out;
  });
  protected partoValue(i: number, key: PartoField): number | null {
    const v = this.partoRows()[i]?.[key];
    return typeof v === 'number' ? v : null;
  }
  protected partoText(i: number, key: PartoField): string {
    return numberText(this.partoValue(i, key));
  }
  protected partoLabel(key: PartoField): string {
    return PARTO_COLS.find((c) => c.key === key)!.label;
  }
  protected partoDecimals(key: PartoField): boolean {
    return PARTO_COLS.find((c) => c.key === key)!.decimals;
  }
  protected isPartoOpen(i: number, key: PartoField): boolean {
    const o = this.partoOpen();
    return !!o && o.row === i && o.key === key;
  }
  protected openParto(i: number, key: PartoField): void {
    this.typing.set(null);
    this.partoOpen.set(this.isPartoOpen(i, key) ? null : { row: i, key });
  }
  protected closeParto(): void {
    this.typing.set(null);
    this.partoOpen.set(null);
  }
  protected typeParto(t: string): void {
    const o = this.partoOpen();
    if (!o) return;
    this.typing.set(t);
    const col = PARTO_COLS.find((c) => c.key === o.key)!;
    const n = parseNumber(t);
    const clamped = n === null ? undefined : Math.min(col.max, Math.max(col.min, col.decimals ? n : Math.round(n)));
    this.setReading(o.row, o.key, clamped);
  }
  protected addReading(): void {
    const rs = this.partoRows();
    const next = rs.length ? Math.min(24, Math.max(...rs.map((r) => r.hour)) + 1) : 0;
    this.closeParto();
    this.write({ ...this.val(), readings: [...rs, { hour: next }] });
  }
  protected removeReading(i: number): void {
    this.closeParto();
    this.write({ ...this.val(), readings: this.partoRows().filter((_, j) => j !== i) });
  }
  private setReading(i: number, key: PartoField, v: number | undefined): void {
    const rs = this.partoRows().map((r, j) => (j === i ? ({ ...r, [key]: v } as PartoReading) : r));
    if (key === 'hour' && v === undefined) return; // an hour is always needed
    this.write({ ...this.val(), readings: rs });
  }

  private write(v: PlotChartValue): void {
    this.emit(tidy(v));
  }
}
