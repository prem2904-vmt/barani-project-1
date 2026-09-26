import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { PfSelectOption, SelectComponent } from '../../../../shared/primitives/select.component';
import {
  LEVEL_LABEL, bandWho, bandZones, effectiveCriticals, fmtNum, tryValue, validateRanges,
  type FlagLevel, type InsightBand, type InsightParam, type RangeIssue,
} from '../../../../shared/utils/range-insight';

/** The four limits a band can carry, low → high. */
type Key = 'cl' | 'min' | 'max' | 'ch';
const KEYS: readonly Key[] = ['cl', 'min', 'max', 'ch'];

interface Cell { key: Key | null; value: number | null }
interface Row { level: FlagLevel; from: Cell; to: Cell; removable: Key | null; message: string | null }
interface BandView {
  index: number;
  band: InsightBand;
  sex: string;
  age: string;
  who: string;
  text: boolean;        // no numbers, only a written normal ("Negative")
  rows: Row[];
  add: Array<{ label: string; keys: Key[] }>;
  edges: string;
  oneSided: 'max' | 'min' | null;
  headerMessages: RangeIssue[];
}

export const AGE_PRESETS: ReadonlyArray<{ key: string; label: string; minAge: number | null; maxAge: number | null; ageUnit: 'years' | 'months' | 'days' }> = [
  { key: 'all', label: 'All ages', minAge: null, maxAge: null, ageUnit: 'years' },
  { key: 'newborn', label: 'Newborn (0–28 days)', minAge: 0, maxAge: 28, ageUnit: 'days' },
  { key: 'infant', label: 'Infant (under 1 year)', minAge: 0, maxAge: 1, ageUnit: 'years' },
  { key: 'child', label: 'Child (1–12 years)', minAge: 1, maxAge: 12, ageUnit: 'years' },
  { key: 'teen', label: 'Teen (12–18 years)', minAge: 12, maxAge: 18, ageUnit: 'years' },
  { key: 'adult', label: '18 years and over', minAge: 18, maxAge: null, ageUnit: 'years' },
  { key: 'senior', label: '65 years and over', minAge: 65, maxAge: null, ageUnit: 'years' },
];

/** Where each row sits between the limits (production's own zones). */
function leftOf(k: Key, has: Record<Key, boolean>): FlagLevel {
  switch (k) {
    case 'cl': return 'critical_low';
    case 'min': return 'low';
    case 'max': return 'normal';
    case 'ch': return has.max ? 'high' : 'normal';
  }
}
function rightOfLast(k: Key): FlagLevel {
  return k === 'max' ? 'high' : k === 'ch' ? 'critical_high' : 'normal';
}

/**
 * Reference ranges as a plain INTERPRETATION TABLE — one per sex/age group:
 * "Result is | From | To" with Critical low · Low · Normal · High · Critical
 * high. The limits are LINKED (a row's "To" is the next row's "From" — one
 * stored value), so gaps / overlaps can't be typed. Unused rows stay hidden
 * behind quiet "+ Add …" links. Maps 1:1 to the stored band fields
 * (min / max / criticalLow / criticalHigh + minOp / maxOp) — nothing new is
 * stored. Flags follow production exactly (range-insight.ts → flagBand).
 * Shared byte-identical by prefrontal-ui and prefrontal-admin-ui.
 */
@Component({
  selector: 'pf-range-table',
  standalone: true,
  imports: [SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rtb">
      @for (m of paramMessages(); track $index) {
        <p class="rtb__note" [class.rtb__note--err]="m.severity === 'error'">{{ m.message }}</p>
      }
      @for (b of views(); track b.index) {
        <section class="rtb__band" [attr.aria-label]="'Reference range for ' + b.who">
          <header class="rtb__head">
            <div class="rtb__who">
              <pf-select size="sm" class="rtb__sel rtb__sel--sex" [options]="sexOptions" [value]="b.sex"
                         (valueChange)="setSex(b.index, $any($event))"></pf-select>
              <span class="rtb__dotsep" aria-hidden="true">·</span>
              <pf-select size="sm" class="rtb__sel" [options]="ageOptions" [value]="b.age"
                         (valueChange)="setAge(b.index, $any($event))"></pf-select>
              @if (b.age === 'custom') {
                <span class="rtb__custom">
                  <input class="rtb__in rtb__in--age" type="text" inputmode="decimal" aria-label="From age"
                         [value]="numText(b.band.minAge)" (change)="setBand(b.index, { minAge: parse($any($event.target).value) })" />
                  <span class="rtb__muted">to</span>
                  <input class="rtb__in rtb__in--age" type="text" inputmode="decimal" aria-label="To age" placeholder="any"
                         [value]="numText(b.band.maxAge)" (change)="setBand(b.index, { maxAge: parse($any($event.target).value) })" />
                  <pf-select size="sm" class="rtb__sel rtb__sel--unit" [options]="ageUnitOptions" [value]="b.band.ageUnit || 'years'"
                             (valueChange)="setBand(b.index, { ageUnit: $any($event) })"></pf-select>
                </span>
              }
            </div>
            <span class="rtb__unit">{{ unitText() }}</span>
            @if (views().length > 1) {
              <button type="button" class="rtb__quiet" (click)="removeBand(b.index)">Remove</button>
            }
          </header>
          @for (m of b.headerMessages; track $index) {
            <p class="rtb__note" [class.rtb__note--err]="m.severity === 'error'">{{ m.message }}</p>
          }

          @if (b.text) {
            <div class="rtb__textrow">
              <span class="rtb__lvl"><span class="rtb__dot" data-level="normal" aria-hidden="true"></span>Normal value</span>
              <input class="rtb__in rtb__in--text" type="text" [value]="b.band.label || ''" aria-label="Normal value"
                     (change)="setBand(b.index, { label: $any($event.target).value.trim() || null })" />
            </div>
          } @else {
            <table class="rtb__table">
              <colgroup><col class="rtb__c1" /><col class="rtb__c2" /><col class="rtb__c2" /><col class="rtb__c3" /></colgroup>
              <thead><tr><th scope="col">Result is</th><th scope="col">From</th><th scope="col">To</th><th class="rtb__x" aria-hidden="true"></th></tr></thead>
              <tbody>
                @for (r of b.rows; track r.level) {
                  <tr [attr.data-level]="r.level" [class.rtb__row--err]="!!r.message">
                    <th scope="row"><span class="rtb__lvl"><span class="rtb__dot" [attr.data-level]="r.level" aria-hidden="true"></span>{{ label(r.level) }}</span></th>
                    <td>
                      @if (r.from.key) {
                        <input class="rtb__in" type="text" inputmode="decimal" [value]="numText(r.from.value)"
                               [attr.aria-label]="label(r.level) + ' from'" (change)="setLimit(b.index, r.from.key, $any($event.target).value)"
                               (keydown.enter)="$any($event.target).blur()" />
                      } @else { <span class="rtb__open">—</span> }
                    </td>
                    <td>
                      @if (r.to.key) {
                        <input class="rtb__in" type="text" inputmode="decimal" [value]="numText(r.to.value)"
                               [attr.aria-label]="label(r.level) + ' to'" (change)="setLimit(b.index, r.to.key, $any($event.target).value)"
                               (keydown.enter)="$any($event.target).blur()" />
                      } @else { <span class="rtb__open">—</span> }
                    </td>
                    <td class="rtb__x">
                      @if (r.removable) {
                        <button type="button" class="rtb__rm" [attr.aria-label]="'Remove ' + label(r.level)" [title]="'Remove ' + label(r.level)"
                                (click)="removeLimit(b.index, r.removable)">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                        </button>
                      }
                    </td>
                  </tr>
                  @if (r.message) {
                    <tr class="rtb__msgrow"><td colspan="4"><p class="rtb__note rtb__note--err">{{ r.message }}</p></td></tr>
                  }
                }
              </tbody>
            </table>
            <div class="rtb__foot">
              @for (a of b.add; track a.label) {
                <button type="button" class="rtb__quiet" (click)="addLimits(b.index, a.keys)">+ {{ a.label }}</button>
              }
              @if (b.edges) {
                <span class="rtb__edges">{{ b.edges }}</span>
              }
              @if (b.oneSided) {
                <button type="button" class="rtb__quiet" [attr.aria-expanded]="edgeOpen() === b.index"
                        (click)="edgeOpen.set(edgeOpen() === b.index ? null : b.index)">Edge rule</button>
              }
            </div>
            @if (b.oneSided && edgeOpen() === b.index) {
              <div class="rtb__edge" role="radiogroup" [attr.aria-label]="'A value of exactly ' + edgeValue(b) + ' counts as'">
                <span class="rtb__muted">Exactly {{ edgeValue(b) }} counts as</span>
                <div class="rtb__seg">
                  <button type="button" class="rtb__segi" role="radio" [attr.aria-checked]="edgeInclusive(b)"
                          (click)="setEdge(b, true)">Normal</button>
                  <button type="button" class="rtb__segi" role="radio" [attr.aria-checked]="!edgeInclusive(b)"
                          (click)="setEdge(b, false)">{{ b.oneSided === 'max' ? 'High' : 'Low' }}</button>
                </div>
              </div>
            }
          }
        </section>
      }
      <div class="rtb__bottom">
        <button type="button" class="rtb__quiet" (click)="addBand()">{{ views().length ? '+ Add a range for another group' : '+ Add a reference range' }}</button>
      </div>

      @if (views().length) {
        <div class="rtb__try">
          <label class="rtb__trylbl" for="rtb-try">Try a value</label>
          <input id="rtb-try" class="rtb__in rtb__in--try" type="text" inputmode="decimal" autocomplete="off"
                 [value]="tryText()" (input)="tryText.set($any($event.target).value)" placeholder="e.g. 12" />
          <div class="rtb__seg" role="radiogroup" aria-label="Patient">
            @for (s of trySexes; track s.l) {
              <button type="button" class="rtb__segi" role="radio" [attr.aria-checked]="trySex() === s.v" (click)="trySex.set(s.v)">{{ s.l }}</button>
            }
          </div>
          <span class="rtb__tage">
            <input class="rtb__in rtb__in--tage" type="text" inputmode="decimal" autocomplete="off" aria-label="Age in years"
                   [value]="tryAge()" (input)="tryAge.set($any($event.target).value)" placeholder="age" /><span class="rtb__muted">years</span>
          </span>
          @if (tried(); as t) {
            <span class="rtb__arrow" aria-hidden="true">→</span>
            <span class="rtb__verdict" [attr.data-level]="t ?? 'none'" aria-live="polite">{{ t === 'none' ? 'Not flagged' : label(t) }}</span>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; max-width: 100%; }
    .rtb {
      --rtb-crit: #d14a43; --rtb-warn: #c17a12; --rtb-ok: var(--color-primary, #7c3aed);
      --rtb-line: var(--nd-line, var(--glass-border, #e5e7eb));
      --rtb-err: #dc2626;
      display: flex; flex-direction: column; gap: 14px; font-family: inherit;
    }
    :host-context(.dark) .rtb { --rtb-crit: #f28b82; --rtb-warn: #f2b35c; --rtb-ok: #a78bfa; --rtb-err: #f87171; }
    .rtb__band { display: flex; flex-direction: column; gap: 6px; }
    .rtb__head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .rtb__who { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex: 1 1 auto; min-width: 0; }
    .rtb__sel { min-width: 150px; }
    .rtb__sel--sex { min-width: 116px; }
    .rtb__sel--unit { min-width: 100px; }
    .rtb__dotsep { color: var(--text-tertiary); }
    .rtb__custom { display: inline-flex; align-items: center; gap: 6px; }
    .rtb__unit { font-size: 12.5px; color: var(--text-tertiary); }
    .rtb__muted { font-size: 12.5px; color: var(--text-tertiary); }
    .rtb__quiet { background: none; border: 0; padding: 4px 2px; font: inherit; font-size: 12.5px; font-weight: 500;
      color: var(--text-secondary); cursor: pointer; border-radius: 6px; }
    .rtb__quiet:hover { color: var(--text-primary); text-decoration: underline; text-underline-offset: 3px; }
    .rtb__quiet:focus-visible, .rtb__rm:focus-visible, .rtb__segi:focus-visible { outline: 2px solid color-mix(in srgb, var(--color-primary, #7c3aed) 55%, transparent); outline-offset: 1px; }

    .rtb__table { width: 100%; max-width: 560px; border-collapse: collapse; table-layout: fixed; font-variant-numeric: tabular-nums; }
    .rtb__c1 { width: 40%; }
    .rtb__c2 { width: auto; }
    .rtb__c3 { width: 34px; }
    .rtb__table th, .rtb__table td { padding: 4px 8px 4px 0; text-align: left; vertical-align: middle; }
    .rtb__table thead th { font-size: 12px; font-weight: 500; color: var(--text-tertiary); padding-bottom: 6px; }
    .rtb__table tbody tr:not(.rtb__msgrow) { border-top: 1px solid var(--rtb-line); }
    .rtb__table tbody th { font-weight: 500; font-size: 13.5px; color: var(--text-primary); }
    .rtb__x { padding-right: 0 !important; }
    .rtb__lvl { display: inline-flex; align-items: center; gap: 9px; }
    .rtb__dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--text-tertiary); }
    .rtb__dot[data-level='normal'] { background: var(--rtb-ok); }
    .rtb__dot[data-level='low'], .rtb__dot[data-level='high'] { background: var(--rtb-warn); }
    .rtb__dot[data-level='critical_low'], .rtb__dot[data-level='critical_high'] { background: var(--rtb-crit); }
    .rtb__open { display: inline-block; padding: 0 10px; color: var(--text-tertiary); font-size: 13.5px; }
    .rtb__in { width: 100%; min-width: 0; max-width: 120px; height: 36px; padding: 0 10px; border-radius: 9px; box-sizing: border-box;
      font: inherit; font-size: 13.5px; font-variant-numeric: tabular-nums; color: var(--text-primary);
      background: var(--nd-card-bg, transparent); border: 1px solid var(--rtb-line); }
    .rtb__in:hover { border-color: color-mix(in srgb, var(--text-primary) 30%, transparent); }
    .rtb__in:focus { outline: none; border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 55%, transparent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent); }
    .rtb__row--err .rtb__in { border-color: var(--rtb-err); }
    .rtb__in--age { width: 64px; }
    .rtb__in--text { max-width: 280px; }
    .rtb__in--try { width: 96px; }
    .rtb__in--tage { width: 60px; }
    .rtb__rm { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 0;
      border-radius: 8px; background: transparent; color: var(--text-tertiary); cursor: pointer; }
    .rtb__rm:hover { color: var(--text-primary); background: var(--nd-chip-bg, rgba(127,127,127,.12)); }
    .rtb__msgrow td { padding: 0 0 6px; white-space: normal !important; }
    .rtb__textrow { display: flex; align-items: center; gap: 14px; }
    .rtb__textrow .rtb__lvl { font-size: 13.5px; font-weight: 500; color: var(--text-primary); }

    .rtb__note { margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--rtb-warn); }
    .rtb__note--err { color: var(--rtb-err); }
    .rtb__foot { display: flex; align-items: baseline; gap: 4px 14px; flex-wrap: wrap; }
    .rtb__edges { font-size: 12px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
    .rtb__edge { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .rtb__seg { display: inline-flex; padding: 2px; gap: 2px; border-radius: 9px; height: 36px; box-sizing: border-box;
      background: var(--nd-chip-bg, rgba(127,127,127,.1)); border: 1px solid var(--rtb-line); }
    .rtb__segi { padding: 0 11px; border: 0; border-radius: 7px; background: transparent; color: var(--text-secondary);
      font: inherit; font-size: 12.5px; cursor: pointer; }
    .rtb__segi[aria-checked='true'] { background: var(--nd-card-bg, var(--bg-secondary)); color: var(--text-primary);
      box-shadow: 0 1px 2px rgba(0,0,0,.12); font-weight: 500; }
    .rtb__bottom { margin-top: -4px; }

    .rtb__try { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 12px; border-top: 1px solid var(--rtb-line); }
    .rtb__trylbl { font-size: 13px; font-weight: 500; color: var(--text-secondary); margin-right: 2px; }
    .rtb__tage { display: inline-flex; align-items: center; gap: 6px; }
    .rtb__arrow { color: var(--text-tertiary); }
    .rtb__verdict { font-size: 13.5px; font-weight: 600; color: var(--text-secondary); }
    .rtb__verdict[data-level='normal'] { color: var(--rtb-ok); }
    .rtb__verdict[data-level='low'], .rtb__verdict[data-level='high'] { color: var(--rtb-warn); }
    .rtb__verdict[data-level='critical_low'], .rtb__verdict[data-level='critical_high'] { color: var(--rtb-crit); }

    @media (max-width: 640px) {
      /* A global phone rule turns tables into scroll blocks — this one fits. */
      .rtb__table { max-width: none; display: table !important; overflow: visible !important; }
      .rtb__c1 { width: 36%; }
      .rtb__c3 { width: 30px; }
      .rtb__table th, .rtb__table td { padding-right: 6px; }
      .rtb__note { overflow-wrap: anywhere; }
      .rtb__dotsep { display: none; }
      .rtb__table tbody th { font-size: 14px; }
      .rtb__in { height: 44px; font-size: 16px; max-width: none; }
      .rtb__in--age { width: 72px; }
      .rtb__in--try { flex: 1 1 110px; width: auto; }
      .rtb__in--tage { width: 72px; }
      .rtb__seg { height: 44px; }
      .rtb__sel, .rtb__sel--sex { flex: 1 1 140px; }
    }
  `],
})
export class RangeTableComponent {
  /** The numeric parameter (referenceRanges + criticals + unit). */
  readonly param = input<InsightParam | null>(null);
  /** Shown once per group header ("g/dL"). */
  readonly unit = input<string>('');
  /** The new band list — the host writes it to the parameter unchanged. */
  readonly bandsChange = output<InsightBand[]>();

  readonly edgeOpen = signal<number | null>(null);
  readonly tryText = signal('');
  readonly tryAge = signal('');
  readonly trySex = signal<'M' | 'F' | null>(null);
  readonly trySexes = [{ v: null, l: 'Anyone' }, { v: 'M' as const, l: 'Man' }, { v: 'F' as const, l: 'Woman' }];
  /** Limits added with "+ Add …" but not typed yet (pure UI state). */
  private readonly pending = signal<Record<string, true>>({});

  readonly sexOptions: PfSelectOption[] = [
    { value: 'any', label: 'Everyone' }, { value: 'M', label: 'Men' }, { value: 'F', label: 'Women' },
  ];
  readonly ageOptions: PfSelectOption[] = [
    ...AGE_PRESETS.map(a => ({ value: a.key, label: a.label })),
    { value: 'custom', label: 'Custom ages…' },
  ];
  readonly ageUnitOptions: PfSelectOption[] = [
    { value: 'years', label: 'years' }, { value: 'months', label: 'months' }, { value: 'days', label: 'days' },
  ];
  private readonly customAge = signal<Record<number, true>>({});

  private readonly bands = computed<InsightBand[]>(() => this.param()?.referenceRanges ?? []);
  private readonly issues = computed(() => {
    const p = this.param();
    return p ? validateRanges({ ...p, unit: p.unit || this.unit() || null }) : [];
  });
  readonly paramMessages = computed(() => this.issues().filter(i => i.band == null));
  readonly unitText = computed(() => (this.param()?.unit || this.unit() || '').trim());

  readonly views = computed<BandView[]>(() => {
    const p = this.param();
    const pend = this.pending();
    const issues = this.issues();
    return this.bands().map((band, index) => {
      const crit = effectiveCriticals(band, p);
      const val: Record<Key, number | null> = { cl: crit.low, min: band.min ?? null, max: band.max ?? null, ch: crit.high };
      const has = Object.fromEntries(KEYS.map(k => [k, val[k] != null || !!pend[`${index}:${k}`]])) as Record<Key, boolean>;
      const present = KEYS.filter(k => has[k]);
      const text = present.length === 0 && !!band.label?.trim();
      const mine = issues.filter(i => i.band === index);
      const rows: Row[] = [];
      if (!text) {
        if (present.length === 0) {
          rows.push({ level: 'normal', from: { key: null, value: null }, to: { key: null, value: null }, removable: null, message: null });
        } else {
          present.forEach((k, n) => {
            const prev = n > 0 ? present[n - 1] : null;
            rows.push({ level: leftOf(k, has), from: { key: prev, value: prev ? val[prev] : null }, to: { key: k, value: val[k] }, removable: null, message: null });
          });
          const last = present[present.length - 1];
          rows.push({ level: rightOfLast(last), from: { key: last, value: val[last] }, to: { key: null, value: null }, removable: null, message: null });
        }
        for (const r of rows) {
          if (r.level === 'critical_low') r.removable = 'cl';
          if (r.level === 'critical_high') r.removable = 'ch';
          if (r.level === 'low' && !has.cl) r.removable = 'min';
          if (r.level === 'high' && !has.ch) r.removable = 'max';
          r.message = this.rowMessage(r.level, mine, val);
        }
      }
      const add: Array<{ label: string; keys: Key[] }> = [];
      if (!text) {
        if (!has.min && !has.max) add.push({ label: 'Add low / high limits', keys: ['min', 'max'] });
        else if (!has.min) add.push({ label: 'Add a low limit', keys: ['min'] });
        else if (!has.max) add.push({ label: 'Add a high limit', keys: ['max'] });
        if (!has.cl && !has.ch) add.push({ label: 'Add critical limits', keys: ['cl', 'ch'] });
        else if (!has.cl) add.push({ label: 'Add a critical low', keys: ['cl'] });
        else if (!has.ch) add.push({ label: 'Add a critical high', keys: ['ch'] });
      }
      const oneSided = band.min != null && band.max == null ? 'min' : band.max != null && band.min == null ? 'max' : null;
      return {
        index, band, text, rows, add, oneSided,
        sex: band.sex === 'M' || band.sex === 'F' ? band.sex : 'any',
        age: this.customAge()[index] ? 'custom' : this.agePresetOf(band),
        who: bandWho(band),
        edges: this.edgeLine(band, p),
        headerMessages: mine.filter(m => !this.isRowIssue(m)),
      };
    });
  });

  /** "−" = a one-line verdict for the tester. */
  readonly tried = computed<FlagLevel | 'none' | null>(() => {
    const s = this.tryText().trim().replace(',', '.');
    const v = Number(s);
    if (!s || !Number.isFinite(v) || !this.param()) return null;
    const a = Number(this.tryAge().trim().replace(',', '.'));
    const age = this.tryAge().trim() && Number.isFinite(a) ? a : null;
    return tryValue(this.param(), v, this.trySex(), age).level ?? 'none';
  });

  label(l: FlagLevel): string { return LEVEL_LABEL[l]; }
  numText(n: number | null | undefined): string { return n == null ? '' : fmtNum(n); }
  parse(s: string): number | null {
    const t = String(s ?? '').trim().replace(',', '.');
    if (!t) return null;
    const v = Number(t);
    return Number.isFinite(v) ? v : null;
  }

  // ── Edits (every one emits the whole band list, stored shape unchanged) ──
  private emit(next: InsightBand[]) { this.bandsChange.emit(next); }
  setBand(i: number, patch: Partial<InsightBand>) {
    this.emit(this.bands().map((b, k) => (k === i ? { ...b, ...patch } : b)));
  }
  setLimit(i: number, key: Key, text: string) {
    const v = this.parse(text);
    this.pending.update(p => { const n = { ...p }; delete n[`${i}:${key}`]; return n; });
    this.setBand(i, this.limitPatch(i, key, v));
  }
  private limitPatch(i: number, key: Key, v: number | null): Partial<InsightBand> {
    switch (key) {
      case 'cl': return { criticalLow: v };
      case 'ch': return { criticalHigh: v };
      // Only the limit itself is written — a comparator op is dropped only
      // when its side is removed (two-sided bands read inclusive either way).
      case 'min': {
        const b = this.bands()[i];
        return v == null ? { min: null, ...(b.minOp != null ? { minOp: null } : {}) } : { min: v };
      }
      case 'max': {
        const b = this.bands()[i];
        return v == null ? { max: null, ...(b.maxOp != null ? { maxOp: null } : {}) } : { max: v };
      }
    }
  }
  addLimits(i: number, keys: Key[]) {
    this.pending.update(p => ({ ...p, ...Object.fromEntries(keys.map(k => [`${i}:${k}`, true as const])) }));
  }
  removeLimit(i: number, key: Key) {
    this.pending.update(p => { const n = { ...p }; delete n[`${i}:${key}`]; return n; });
    this.setBand(i, this.limitPatch(i, key, null));
  }
  setSex(i: number, v: string) { this.setBand(i, { sex: v === 'M' || v === 'F' ? v : 'any' }); }
  setAge(i: number, key: string) {
    if (key === 'custom') { this.customAge.update(c => ({ ...c, [i]: true })); return; }
    this.customAge.update(c => { const n = { ...c }; delete n[i]; return n; });
    const p = AGE_PRESETS.find(a => a.key === key);
    if (p) this.setBand(i, { minAge: p.minAge, maxAge: p.maxAge, ageUnit: p.ageUnit });
  }
  addBand() {
    const last = this.bands()[this.bands().length - 1];
    const copy: InsightBand = last
      ? { segment: 'normal', min: last.min ?? null, max: last.max ?? null,
          ...(last.minOp ? { minOp: last.minOp } : {}), ...(last.maxOp ? { maxOp: last.maxOp } : {}),
          ...(last.criticalLow != null ? { criticalLow: last.criticalLow } : {}),
          ...(last.criticalHigh != null ? { criticalHigh: last.criticalHigh } : {}) }
      : { segment: 'normal', min: null, max: null };
    this.emit([...this.bands(), copy]);
  }
  removeBand(i: number) { this.emit(this.bands().filter((_, k) => k !== i)); }

  // ── Edge rule (one-sided bands only; two-sided keep production's inclusive rule) ──
  edgeValue(b: BandView): string { return fmtNum((b.oneSided === 'max' ? b.band.max : b.band.min) as number); }
  edgeInclusive(b: BandView): boolean { return b.oneSided === 'max' ? b.band.maxOp === 'lte' : b.band.minOp === 'gte'; }
  setEdge(b: BandView, inclusive: boolean) {
    if (b.oneSided === 'max') this.setBand(b.index, { maxOp: inclusive ? 'lte' : null });
    else this.setBand(b.index, { minOp: inclusive ? 'gte' : null });
  }

  // ── Words ───────────────────────────────────────────────────────────
  /** "Exactly on a limit: 7 is Low · 9.9 is Normal · 20 is High." — from
   *  production's own zones, so the footnote can't disagree with the flag. */
  private edgeLine(b: InsightBand, p: InsightParam | null): string {
    const zones = bandZones(b, p);
    const parts: string[] = [];
    for (let k = 0; k + 1 < zones.length; k++) {
      const r = zones[k + 1];
      if (r.lo == null) continue;
      const owner = r.loIncl ? r : zones[k];
      parts.push(`${fmtNum(r.lo)} is ${owner.level ? LEVEL_LABEL[owner.level] : 'not flagged'}`);
    }
    return parts.length ? `Exactly on a limit: ${parts.join(' · ')}.` : '';
  }
  private isRowIssue(m: RangeIssue): boolean {
    return m.severity === 'error' && ['min', 'max', 'criticalLow', 'criticalHigh'].includes(m.field ?? '')
      || m.severity === 'warning' && /can never be flagged|single value/.test(m.message);
  }
  /** Validation in the table's own words, on the row it concerns. */
  private rowMessage(level: FlagLevel, issues: RangeIssue[], v: Record<Key, number | null>): string | null {
    for (const m of issues) {
      if (!this.isRowIssue(m)) continue;
      const n = (x: number | null) => (x == null ? '' : fmtNum(x));
      if (m.severity === 'warning') {
        if (/Low can never/.test(m.message) && level === 'critical_low') return `Nothing is Low — Critical low ends where Normal starts (${n(v.min)}).`;
        if (/High can never/.test(m.message) && level === 'critical_high') return `Nothing is High — Critical high starts where Normal ends (${n(v.max)}).`;
        if (/single value/.test(m.message) && level === 'normal') return `Normal is a single value (${n(v.min)}).`;
        continue;
      }
      if (m.field === 'max' && level === 'normal') return `Normal must end above where it starts (${n(v.min)}).`;
      if (m.field === 'criticalLow') {
        if (/must be below Critical high/.test(m.message) && level === 'critical_low') return `Critical low must end below Critical high (${n(v.ch)}).`;
        if (/inside the normal range/.test(m.message) && level === 'low') return `Low must end above where it starts (${n(v.cl)}) — Normal must start above Critical low.`;
        if (/nothing could be normal/.test(m.message) && level === 'normal') return `Normal must end above Critical low (${n(v.cl)}).`;
      }
      if (m.field === 'criticalHigh') {
        if (/inside the normal range/.test(m.message) && level === 'high') return `High must end above where it starts (${n(v.max)}) — Critical high must start above Normal.`;
        if (/nothing could be normal/.test(m.message) && level === 'normal') return `Normal must start below Critical high (${n(v.ch)}).`;
      }
    }
    return null;
  }
  private agePresetOf(b: InsightBand): string {
    if (b.minAge == null && b.maxAge == null) return 'all';
    const hit = AGE_PRESETS.find(p => (p.minAge ?? null) === (b.minAge ?? null) && (p.maxAge ?? null) === (b.maxAge ?? null)
      && p.ageUnit === (b.ageUnit ?? 'years'));
    return hit?.key ?? 'custom';
  }
}
