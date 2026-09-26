import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { PfSelectOption, SelectComponent } from '../../../../shared/primitives/select.component';
import {
  LEVEL_LABEL, effectiveCriticals, fmtNum, tryValue, validateRanges,
  type FlagLevel, type InsightBand, type InsightParam, type RangeIssue,
} from '../../../../shared/utils/range-insight';
import { parseSegmentSex, resolveRangeAgeYears } from '../../../../shared/utils/reference-range';

export type AgeUnit = 'days' | 'months' | 'years';
const PER_YEAR: Record<AgeUnit, number> = { years: 1, months: 12, days: 365.25 };
const UNITS: readonly AgeUnit[] = ['days', 'months', 'years'];

/** A number the table edits, by its stored field. */
export type LimitKey = 'min' | 'max' | 'criticalLow' | 'criticalHigh';

/** One side of an age span in natural units ("28 days", "18 years"). */
export interface AgeSide { n: number; unit: AgeUnit }

const near = (x: number, tol: number) => Math.abs(x - Math.round(x)) <= tol;
const round = (x: number, dp: number) => +x.toFixed(dp);

/**
 * Years → the unit a person would say. 0.0767 y → 28 days, 0.5 y → 6 months,
 * 18 y → 18 years. Whole numbers count as "clean"; otherwise the largest unit
 * with a value ≥ 1, to one decimal (display only — never written back unless
 * the age itself is edited).
 */
export function naturalAge(y: number): AgeSide {
  if (y === 0) return { n: 0, unit: 'years' };
  if (near(y, 0.005)) return { n: Math.round(y), unit: 'years' };
  const mo = y * 12;
  if (near(mo, 0.02)) return { n: Math.round(mo), unit: 'months' };
  const d = y * 365.25;
  if (near(d, 0.06)) return { n: Math.round(d), unit: 'days' };
  if (y >= 1) return { n: round(y, 1), unit: 'years' };
  if (mo >= 1) return { n: round(mo, 1), unit: 'months' };
  return { n: round(d, 1), unit: 'days' };
}

/** Natural-unit age → years (exactly as the resolver converts). */
export function ageToYears(s: AgeSide): number { return s.n / PER_YEAR[s.unit]; }

const unitWord = (u: AgeUnit, n: number) => (n === 1 ? u.slice(0, -1) : u);

/** "0–28 days", "28 days – 1 year", "18 years+", "up to 1 year", "Any age". */
export function ageWords(from: AgeSide | null, to: AgeSide | null): string {
  if (!from && !to) return 'Any age';
  if (from && !to) return `${fmtNum(from.n)} ${unitWord(from.unit, from.n)}+`;
  if (!from && to) return `up to ${fmtNum(to.n)} ${unitWord(to.unit, to.n)}`;
  const f = from!, t = to!;
  if (f.unit === t.unit || f.n === 0) return `${fmtNum(f.n)}–${fmtNum(t.n)} ${unitWord(t.unit, t.n)}`;
  return `${fmtNum(f.n)} ${unitWord(f.unit, f.n)} – ${fmtNum(t.n)} ${unitWord(t.unit, t.n)}`;
}

export const AGE_PRESETS: ReadonlyArray<{ key: string; label: string; from: AgeSide | null; to: AgeSide | null }> = [
  { key: 'all', label: 'Any age', from: null, to: null },
  { key: 'newborn', label: 'Newborn 0–28 days', from: { n: 0, unit: 'days' }, to: { n: 28, unit: 'days' } },
  { key: 'infant', label: 'Infant 1–12 months', from: { n: 1, unit: 'months' }, to: { n: 12, unit: 'months' } },
  { key: 'child', label: 'Child 1–12 years', from: { n: 1, unit: 'years' }, to: { n: 12, unit: 'years' } },
  { key: 'teen', label: 'Teen 12–18 years', from: { n: 12, unit: 'years' }, to: { n: 18, unit: 'years' } },
  { key: 'adult', label: 'Adult 18 years+', from: { n: 18, unit: 'years' }, to: null },
  { key: 'senior', label: 'Senior 65 years+', from: { n: 65, unit: 'years' }, to: null },
];

/** A band's patients: structured sex first, else the legacy segment label. */
function sexOf(b: InsightBand): 'M' | 'F' | 'any' {
  if (b.sex === 'M' || b.sex === 'F') return b.sex;
  if (b.sex === 'any') return 'any';
  return parseSegmentSex(b.segment) ?? 'any';
}

/** The age a band applies to, in natural units (stored days / months shown as stored). */
export function ageOf(b: InsightBand): { from: AgeSide | null; to: AgeSide | null } {
  const u = (b.ageUnit ?? 'years') as AgeUnit;
  if ((b.minAge != null || b.maxAge != null) && (u === 'days' || u === 'months')) {
    return {
      from: b.minAge != null ? { n: b.minAge, unit: u } : null,
      to: b.maxAge != null ? { n: b.maxAge, unit: u } : null,
    };
  }
  const a = resolveRangeAgeYears(b);
  if (!a.hasAge) return { from: null, to: null };
  const to = a.maxY != null ? naturalAge(a.maxY) : null;
  let from = a.minY != null ? naturalAge(a.minY) : null;
  if (from && from.n === 0) from = { n: 0, unit: to?.unit ?? 'years' };
  return { from, to };
}

interface FieldIssue { text: string; fields: Array<LimitKey | 'age'> }
export interface RowView {
  index: number;
  band: InsightBand;
  sex: 'M' | 'F' | 'any';
  who: string;
  age: { from: AgeSide | null; to: AgeSide | null; text: string };
  text: boolean;                  // a written normal ("Negative") — no numbers
  inherited: { criticalLow: number | null; criticalHigh: number | null };
  boxes: LimitBox[];              // Low · High · Critical low · Critical high, in column order
  summary: string;                // phone line 2
  error: FieldIssue | null;       // a NEW error: red outline + one line
  quiet: string[];                // pre-existing errors + warnings: a subtle icon
  profile: string;
}

/** One limit box as shown: its header words and the flag chip inside it. */
export interface LimitBox {
  key: LimitKey;
  head: string;                   // column header = the box's accessible name
  chip: string;                   // "L <", "H >", "C <", "C >" (≤ / ≥ on a one-sided strict Normal)
  tone: 'l' | 'h' | 'c';
  placeholder: string;            // blank = "none" (or the test-wide critical, grey)
  title: string;
}

/** The column headers — also each box's accessible name. */
export const LIMIT_HEAD: Record<LimitKey, string> = {
  min: 'Low (L) if below', max: 'High (H) if above',
  criticalLow: 'Critical if below', criticalHigh: 'Critical if above',
};

/**
 * The comparison each Normal limit prints with — production's rule
 * (reference-range `flagAgainst`): two-sided Normal is inclusive (L < low,
 * H > high); one-sided is strict unless the band carries ≥ / ≤, so "Normal
 * below 200" prints H at 200 (H ≥ 200). Display only.
 */
export function normalOps(b: InsightBand): { low: '<' | '≤'; high: '>' | '≥' } {
  const lowIncl = b.minOp === 'gte' || (b.minOp == null && b.max != null);
  const highIncl = b.maxOp === 'lte' || (b.maxOp == null && b.min != null);
  return {
    low: b.min != null && !lowIncl ? '≤' : '<',
    high: b.max != null && !highIncl ? '≥' : '>',
  };
}

const EMPTY_GROUP = 'Nothing set for this group — add limits or remove it';

let seq = 0;
const SEX_WORD = { any: 'Anyone', M: 'Male', F: 'Female' } as const;

/**
 * Reference ranges as ONE compact table (the LIS standard — OpenELIS result
 * limits, OpenMRS concept numeric): one row per group of patients.
 *
 *   Who | Age | Low (L) if below (unit) | High (H) if above | Critical if below | Critical if above | ×
 *
 * The two Normal limits ARE the L / H flags — each box carries the flag it
 * prints as a chip ("L <", "H >", "C <", "C >"); blank = none. Criticals are strict
 * (below / above), two-sided Normal is inclusive, one-sided strict unless the
 * band carries ≤ / ≥ — production's rule (range-insight → flagBand = mw
 * FlagOne); the comparator itself lives only in Advanced. Maps 1:1 to the
 * stored band fields (min / max / criticalLow / criticalHigh / sex / minAge /
 * maxAge / ageUnit / label); an untouched band is never re-written. Phones get
 * one compact card per group (tap to edit).
 * Shared byte-identical by prefrontal-ui and prefrontal-admin-ui.
 */
@Component({
  selector: 'pf-range-table',
  standalone: true,
  imports: [SelectComponent, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rtb">
      <p class="rtb__lead">Below <b>Low</b> prints <b>L</b> · above <b>High</b> prints <b>H</b> · past a <b>Critical</b> limit alerts the doctor.</p>

      @if (!phone()) {
        <table class="rtb__table">
          <colgroup>
            <col class="rtb__c-who" /><col class="rtb__c-age" /><col class="rtb__c-lim" /><col class="rtb__c-lim" />
            <col class="rtb__c-crit" /><col class="rtb__c-crit" /><col class="rtb__c-x" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Who</th>
              <th scope="col">Age</th>
              <th scope="col">{{ heads.min }} @if (unitText()) {<span class="rtb__unit">{{ unitText() }}</span>}</th>
              <th scope="col">{{ heads.max }}</th>
              <th scope="col">{{ heads.criticalLow }}</th>
              <th scope="col">{{ heads.criticalHigh }}</th>
              <th scope="col"><span class="rtb__sr">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.index) {
              <tr class="rtb__row" [class.rtb__row--err]="!!r.error" [attr.data-who]="r.who + ' · ' + r.age.text">
                <td>
                  <pf-select size="sm" class="rtb__sel" [options]="sexOptions" [value]="r.sex"
                             (valueChange)="setSex(r.index, $any($event))"></pf-select>
                  @if (r.profile) { <span class="rtb__tag">only in {{ r.profile }}</span> }
                </td>
                <td>
                  <button type="button" class="rtb__agebtn" [class.rtb__in--err]="hasErr(r, 'age')"
                          [attr.aria-expanded]="ageOpen() === r.index" [attr.aria-label]="'Age: ' + r.age.text + '. Change'"
                          (click)="toggleAge(r.index)">
                    <span>{{ r.age.text }}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                  </button>
                </td>
                @if (r.text) {
                  <td colspan="4">
                    <span class="rtb__pair">
                      <span class="rtb__muted">Normal value</span>
                      <input class="rtb__in rtb__in--text" type="text" [value]="r.band.label || ''" aria-label="Normal value"
                             (change)="setLabel(r.index, $any($event.target).value)" (keydown.enter)="$any($event.target).blur()" />
                    </span>
                  </td>
                } @else {
                  @for (b of r.boxes; track b.key) {
                    <td><ng-container *ngTemplateOutlet="limitBox; context: { $implicit: r, b: b }"></ng-container></td>
                  }
                }
                <td class="rtb__acts">
                  @if (r.quiet.length) {
                    <span class="rtb__warn" role="img" tabindex="0" [attr.aria-label]="r.quiet.join(' ')" [title]="r.quiet.join('\\n')">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>
                    </span>
                  }
                  <button type="button" class="rtb__rm" [attr.aria-label]="'Remove group ' + r.who + ' · ' + r.age.text"
                          title="Remove group" (click)="removeBand(r.index)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                  </button>
                </td>
              </tr>
              @if (ageOpen() === r.index) {
                <tr class="rtb__subrow"><td colspan="7">
                  <ng-container *ngTemplateOutlet="ageEditor; context: { $implicit: r }"></ng-container>
                </td></tr>
              }
              @if (r.error) {
                <tr class="rtb__subrow"><td colspan="7"><p class="rtb__msg" role="alert">{{ r.error.text }}</p></td></tr>
              }
            }
          </tbody>
          <tfoot>
            <tr><td colspan="7">
              <button type="button" class="rtb__add" (click)="addBand()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                Add group
              </button>
            </td></tr>
          </tfoot>
        </table>
      } @else {
        @if (unitText()) { <p class="rtb__note">Values in {{ unitText() }}</p> }
        <ul class="rtb__cards">
          @for (r of rows(); track r.index) {
            <li class="rtb__card" [class.rtb__card--open]="cardOpen() === r.index" [class.rtb__row--err]="!!r.error">
              <button type="button" class="rtb__cardhead" [attr.aria-expanded]="cardOpen() === r.index"
                      (click)="cardOpen.set(cardOpen() === r.index ? null : r.index)">
                <span class="rtb__cardtxt">
                  <span class="rtb__l1">{{ r.who }} · {{ r.age.text }}@if (r.profile) { <span class="rtb__tag">only in {{ r.profile }}</span> }</span>
                  <span class="rtb__l2">{{ r.summary }}</span>
                </span>
                @if (r.quiet.length) {
                  <span class="rtb__warn" role="img" [attr.aria-label]="r.quiet.join(' ')" [title]="r.quiet.join('\\n')">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>
                  </span>
                }
                <svg class="rtb__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              @if (r.error) { <p class="rtb__msg" role="alert">{{ r.error.text }}</p> }
              @if (cardOpen() === r.index) {
                <div class="rtb__cardbody">
                  <div class="rtb__seg" role="radiogroup" aria-label="Who">
                    @for (s of sexOptions; track s.value) {
                      <button type="button" class="rtb__segi" role="radio" [attr.aria-checked]="r.sex === s.value"
                              (click)="setSex(r.index, $any(s.value))">{{ s.label }}</button>
                    }
                  </div>
                  <ng-container *ngTemplateOutlet="ageEditor; context: { $implicit: r }"></ng-container>
                  @if (r.text) {
                    <label class="rtb__fld"><span class="rtb__muted">Normal value</span>
                      <input class="rtb__in" type="text" [value]="r.band.label || ''" (change)="setLabel(r.index, $any($event.target).value)" />
                    </label>
                  } @else {
                    <div class="rtb__grid2">
                      @for (b of r.boxes; track b.key) {
                        <label class="rtb__fld"><span class="rtb__muted">{{ b.head }}</span>
                          <ng-container *ngTemplateOutlet="limitBox; context: { $implicit: r, b: b }"></ng-container></label>
                      }
                    </div>
                  }
                  <button type="button" class="rtb__add rtb__add--rm" (click)="removeBand(r.index)">Remove this group</button>
                </div>
              }
            </li>
          }
        </ul>
        <button type="button" class="rtb__add" (click)="addBand()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          Add group
        </button>
      }

      @if (inheritsCritical()) {
        <p class="rtb__note">Grey critical limits are set once for the whole test. Type in a box to use a different limit for that group.</p>
      }
      @for (m of paramMessages(); track $index) {
        <p class="rtb__note">{{ m }}</p>
      }

      @if (rows().length) {
        <div class="rtb__try">
          <label class="rtb__trylbl" [attr.for]="uid">Try a value</label>
          <input [id]="uid" class="rtb__in rtb__in--try" type="text" inputmode="decimal" autocomplete="off"
                 [value]="tryText()" (input)="tryText.set($any($event.target).value)" placeholder="e.g. 12" />
          <span class="rtb__muted">for</span>
          <pf-select size="sm" class="rtb__sel rtb__sel--try" [options]="sexOptions" [value]="trySex()"
                     (valueChange)="trySex.set($any($event))"></pf-select>
          <span class="rtb__muted">aged</span>
          <input class="rtb__in rtb__in--tage" type="text" inputmode="decimal" autocomplete="off" aria-label="Age"
                 [value]="tryAge()" (input)="tryAge.set($any($event.target).value)" placeholder="age" />
          <pf-select size="sm" class="rtb__sel rtb__sel--unit" [options]="unitOptions" [value]="tryUnit()"
                     (valueChange)="tryUnit.set($any($event))"></pf-select>
          @if (tried(); as t) {
            <span class="rtb__verdict" [attr.data-level]="t" aria-live="polite">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
              <span class="rtb__vtext">{{ t === 'none' ? 'Not flagged' : label(t) }}</span>
            </span>
          }
        </div>
      }
    </div>

    <!-- One limit box: the flag it prints sits inside, on the left ("L <"). -->
    <ng-template #limitBox let-r let-b="b">
      <span class="rtb__lim" [attr.data-tone]="b.tone">
        <span class="rtb__flag" aria-hidden="true">{{ b.chip }}</span>
        <input class="rtb__in rtb__in--lim" type="text" inputmode="decimal" autocomplete="off"
               [placeholder]="b.placeholder" [title]="b.title" [attr.aria-label]="b.head"
               [class.rtb__in--err]="hasErr(r, b.key)" [value]="num(r.band[b.key])"
               (change)="setLimit(r.index, b.key, $any($event.target))" (keydown.enter)="$any($event.target).blur()" />
      </span>
    </ng-template>

    <ng-template #ageEditor let-r>
      <div class="rtb__ageed" role="group" [attr.aria-label]="'Age for ' + r.who">
        <div class="rtb__agefields">
          <span class="rtb__muted">From</span>
          <input class="rtb__in rtb__in--age" type="text" inputmode="decimal" autocomplete="off" aria-label="Age from" placeholder="0"
                 [value]="r.age.from ? num(r.age.from.n) : ''" (change)="setAgeSide(r, 'from', $any($event.target).value, null)" />
          <pf-select size="sm" class="rtb__sel rtb__sel--unit" [options]="unitOptions" [value]="r.age.from?.unit || r.age.to?.unit || 'years'"
                     (valueChange)="setAgeSide(r, 'from', null, $any($event))"></pf-select>
          <span class="rtb__muted">to</span>
          <input class="rtb__in rtb__in--age" type="text" inputmode="decimal" autocomplete="off" aria-label="Age to" placeholder="and over"
                 [value]="r.age.to ? num(r.age.to.n) : ''" (change)="setAgeSide(r, 'to', $any($event.target).value, null)" />
          <pf-select size="sm" class="rtb__sel rtb__sel--unit" [options]="unitOptions" [value]="r.age.to?.unit || r.age.from?.unit || 'years'"
                     (valueChange)="setAgeSide(r, 'to', null, $any($event))"></pf-select>
        </div>
        <div class="rtb__presets" role="group" aria-label="Quick ages">
          @for (p of presets; track p.key) {
            <button type="button" class="rtb__chip" [attr.aria-pressed]="presetOn(p, r)"
                    (click)="setAge(r.index, p.from, p.to)">{{ p.label }}</button>
          }
        </div>
      </div>
    </ng-template>
  `,
  styles: [`
    :host { display: block; min-width: 0; max-width: 100%; }
    .rtb {
      --rtb-line: var(--nd-line, var(--glass-border, #e5e7eb));
      --rtb-err: var(--red-border, #dc2626);
      --rtb-field: color-mix(in srgb, var(--text-primary) 22%, transparent);
      display: flex; flex-direction: column; gap: 12px; font-family: inherit; font-variant-numeric: tabular-nums;
    }
    :host-context(.dark) .rtb { --rtb-err: #f87171; }
    .rtb__lead { margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--text-tertiary); }
    .rtb__lead b { font-weight: 600; color: var(--text-secondary); }
    .rtb__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .rtb__muted { font-size: 12.5px; color: var(--text-tertiary); white-space: nowrap; }
    .rtb__unit { margin-left: 6px; font-weight: 400; color: var(--text-tertiary); }
    .rtb__tag { display: block; margin-top: 2px; font-size: 11.5px; font-weight: 400; color: var(--text-tertiary); }

    /* ── Desktop table ─────────────────────────────────────────────── */
    .rtb__table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .rtb__c-who { width: 124px; }
    .rtb__c-age { width: auto; }
    .rtb__c-lim { width: 136px; }
    .rtb__c-crit { width: 124px; }
    .rtb__c-x { width: 64px; }
    .rtb__table th, .rtb__table td { padding: 6px 10px 6px 0; text-align: left; vertical-align: middle; }
    .rtb__table thead th { font-size: 12px; font-weight: 500; color: var(--text-secondary); padding-bottom: 8px; vertical-align: bottom; }
    .rtb__row { border-top: 1px solid var(--rtb-line); }
    .rtb__table tfoot tr { border-top: 1px solid var(--rtb-line); }
    .rtb__table tfoot td { padding: 6px 0 0; }
    .rtb__subrow td { padding: 0 0 10px; white-space: normal !important; }
    .rtb__acts { padding-right: 0 !important; text-align: right !important; white-space: nowrap; }
    .rtb__pair { display: flex; align-items: center; gap: 6px; }
    .rtb__dash { color: var(--text-tertiary); flex: none; }
    .rtb__sel { display: block; min-width: 0; }

    .rtb__in {
      display: block; width: 100%; min-width: 0; height: 36px; padding: 0 10px; box-sizing: border-box; border-radius: 9px;
      font: inherit; font-size: 13.5px; font-weight: 500; font-variant-numeric: tabular-nums; color: var(--text-primary);
      background: color-mix(in srgb, var(--text-primary) 4%, var(--nd-card-bg, transparent)); border: 1px solid var(--rtb-field);
      transition: border-color .2s ease, box-shadow .2s ease;
    }
    .rtb__in::placeholder { color: var(--text-muted, #9ca3af); font-weight: 400; }
    .rtb__in:hover { border-color: color-mix(in srgb, var(--text-primary) 38%, transparent); }
    .rtb__in:focus { outline: none; border-color: var(--color-violet-600, #7c3aed);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #7c3aed) 16%, transparent); }
    .rtb__in--err, .rtb__in--err:hover { border-color: var(--rtb-err); }
    .rtb__in--text { max-width: 260px; }

    /* A limit box: the flag it prints sits inside, on the left — "L <", "H >",
       "C <", "C >". The app's result-flag tones (L blue, H amber, C red) at
       low strength; palette tokens, so light and dark both follow the theme. */
    .rtb__lim { position: relative; display: block; min-width: 0; }
    .rtb__lim[data-tone='l'] { --rtb-tone: var(--blue-text, #2563eb); }
    .rtb__lim[data-tone='h'] { --rtb-tone: var(--amber-text, #b45309); }
    .rtb__lim[data-tone='c'] { --rtb-tone: var(--red-text, #dc2626); }
    .rtb__flag {
      position: absolute; left: 7px; top: 50%; transform: translateY(-50%); pointer-events: none;
      padding: 1px 5px; border-radius: 5px; font-size: 11px; font-weight: 600; line-height: 16px; white-space: nowrap;
      font-variant-numeric: tabular-nums; color: color-mix(in srgb, var(--rtb-tone) 85%, var(--text-tertiary));
      background: color-mix(in srgb, var(--rtb-tone) 10%, transparent);
    }
    .rtb__in--lim { padding-left: 42px; }

    .rtb__agebtn {
      display: flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%; height: 36px; padding: 0 8px 0 10px;
      box-sizing: border-box; border-radius: 9px; border: 1px solid var(--rtb-field); cursor: pointer;
      background: color-mix(in srgb, var(--text-primary) 4%, var(--nd-card-bg, transparent));
      font: inherit; font-size: 13.5px; font-weight: 500; color: var(--text-primary); text-align: left;
    }
    .rtb__agebtn > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rtb__agebtn > svg { flex: none; color: var(--text-tertiary); transition: transform .2s ease; }
    .rtb__agebtn[aria-expanded='true'] > svg { transform: rotate(180deg); }
    .rtb__agebtn:hover { border-color: color-mix(in srgb, var(--text-primary) 38%, transparent); }
    .rtb__agebtn:focus-visible, .rtb__rm:focus-visible, .rtb__add:focus-visible, .rtb__chip:focus-visible,
    .rtb__segi:focus-visible, .rtb__cardhead:focus-visible, .rtb__warn:focus-visible {
      outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }

    .rtb__rm { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 0; vertical-align: middle;
      border-radius: 8px; background: transparent; color: var(--text-tertiary); cursor: pointer; }
    .rtb__rm:hover { color: var(--text-primary); background: var(--nd-chip-bg, rgba(127,127,127,.12)); }
    .rtb__warn { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 30px; vertical-align: middle;
      color: var(--text-tertiary); cursor: help; border-radius: 6px; }

    .rtb__add { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; height: 32px; padding: 0 10px 0 6px;
      border: 0; border-radius: 8px; background: transparent; font: inherit; font-size: 13px; font-weight: 500;
      color: var(--text-secondary); cursor: pointer; }
    .rtb__add:hover { color: var(--text-primary); background: var(--nd-chip-bg, rgba(127,127,127,.12)); }
    .rtb__add--rm { color: var(--text-tertiary); padding-left: 0; }

    .rtb__msg { margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--rtb-err); }
    .rtb__note { margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--text-tertiary); }

    /* Age editor (desktop: a row under the group; phone: inside the card). */
    .rtb__ageed { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-radius: 10px;
      background: var(--nd-chip-bg, rgba(127,127,127,.08)); }
    .rtb__agefields { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .rtb__in--age { width: 72px; }
    .rtb__sel--unit { width: 112px; }
    .rtb__presets { display: flex; gap: 6px; flex-wrap: wrap; }
    .rtb__chip { height: 28px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--rtb-line); cursor: pointer;
      background: var(--nd-card-bg, transparent); color: var(--text-secondary); font: inherit; font-size: 12px; }
    .rtb__chip:hover { color: var(--text-primary); border-color: var(--nd-sel-border, #9aa4ae); }
    .rtb__chip[aria-pressed='true'] { color: var(--text-primary); border-color: var(--nd-sel-border, #9aa4ae); font-weight: 500; }

    /* Try a value — one line. */
    .rtb__try { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 12px; border-top: 1px solid var(--rtb-line); }
    .rtb__trylbl { font-size: 13px; font-weight: 500; color: var(--text-secondary); margin-right: 2px; }
    .rtb__in--try { width: 96px; }
    .rtb__in--tage { width: 64px; }
    .rtb__sel--try { width: 120px; }
    .rtb__verdict { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
    .rtb__verdict > svg { color: var(--text-tertiary); }
    .rtb__verdict[data-level='critical_low'], .rtb__verdict[data-level='critical_high'] { color: var(--rtb-err); }

    /* ── Phone cards ───────────────────────────────────────────────── */
    .rtb__cards { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .rtb__card { border: 1px solid var(--rtb-line); border-radius: 12px; background: var(--nd-card-bg, transparent); }
    .rtb__card.rtb__row--err { border-color: var(--rtb-err); }
    .rtb__card > .rtb__msg { padding: 0 14px 10px; }
    .rtb__cardhead { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 56px; padding: 10px 12px 10px 14px;
      box-sizing: border-box; border: 0; background: transparent; cursor: pointer; font: inherit; text-align: left; color: var(--text-primary);
      border-radius: 12px; }
    .rtb__cardtxt { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .rtb__l1 { font-size: 15px; font-weight: 600; line-height: 1.3; }
    .rtb__l2 { font-size: 14px; color: var(--text-secondary); line-height: 1.35; }
    .rtb__chev { flex: none; color: var(--text-tertiary); transition: transform .2s ease; }
    .rtb__card--open .rtb__chev { transform: rotate(180deg); }
    .rtb__cardbody { display: flex; flex-direction: column; gap: 12px; padding: 4px 14px 12px; }
    .rtb__grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .rtb__fld { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .rtb__seg { display: flex; padding: 2px; gap: 2px; border-radius: 10px; background: var(--nd-chip-bg, rgba(127,127,127,.1));
      border: 1px solid var(--rtb-line); }
    .rtb__segi { flex: 1 1 0; height: 40px; border: 0; border-radius: 8px; background: transparent; color: var(--text-secondary);
      font: inherit; font-size: 14px; cursor: pointer; }
    .rtb__segi[aria-checked='true'] { background: var(--nd-card-bg, var(--bg-secondary)); color: var(--text-primary);
      box-shadow: 0 1px 2px rgba(0,0,0,.12); font-weight: 500; }

    @media (max-width: 640px) {
      .rtb__in, .rtb__agebtn { height: 44px; font-size: 16px; }
      .rtb__in--lim { padding-left: 46px; }
      .rtb__flag { font-size: 12px; }
      .rtb__rm, .rtb__add { min-height: 44px; }
      .rtb__chip { height: 36px; font-size: 13px; }
      .rtb__ageed { padding: 10px; }
      .rtb__agefields { display: grid; grid-template-columns: auto 1fr 1fr; }
      .rtb__agefields > .rtb__muted:nth-of-type(2) { grid-column: 1; }
      .rtb__in--age { width: 100%; }
      .rtb__sel--unit { width: auto; }
      .rtb__in--try { flex: 1 1 110px; width: auto; }
      .rtb__in--tage { width: 72px; }
      .rtb__note, .rtb__msg { overflow-wrap: anywhere; }
    }
    @media (prefers-reduced-motion: reduce) {
      .rtb__agebtn > svg, .rtb__chev, .rtb__in { transition: none; }
    }
  `],
})
export class RangeTableComponent {
  /** The numeric parameter (referenceRanges + criticals + unit). */
  readonly param = input<InsightParam | null>(null);
  /** Shown once, in the Normal range header ("g/dL"). */
  readonly unit = input<string>('');
  /** The new band list — the host writes it to the parameter unchanged. */
  readonly bandsChange = output<InsightBand[]>();

  /** Phones (≤640px) get one card per group instead of the table. */
  readonly phone = signal(false);
  readonly ageOpen = signal<number | null>(null);
  readonly cardOpen = signal<number | null>(null);
  readonly tryText = signal('');
  readonly tryAge = signal('');
  readonly tryUnit = signal<AgeUnit>('years');
  readonly trySex = signal<'M' | 'F' | 'any'>('any');

  readonly sexOptions: PfSelectOption[] = [
    { value: 'any', label: 'Anyone' }, { value: 'M', label: 'Male' }, { value: 'F', label: 'Female' },
  ];
  readonly unitOptions: PfSelectOption[] = UNITS.map(u => ({ value: u, label: u }));
  readonly presets = AGE_PRESETS;
  readonly heads = LIMIT_HEAD;
  readonly uid = `rtb-try-${++seq}`;

  /** Error keys the test already had when it was opened (legacy catalogue
   *  data) — a quiet icon, never red; like the host, they don't block Save.
   *  Keyed band|field|message; shifted when a group is removed. */
  private baseline: Set<string> | null = null;
  private baselineFor: string | null = null;

  constructor() {
    const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 640px)') : null;
    if (mq) {
      this.phone.set(!!mq.matches);
      const on = (e: MediaQueryListEvent) => this.phone.set(e.matches);
      mq.addEventListener?.('change', on);
      inject(DestroyRef).onDestroy(() => mq.removeEventListener?.('change', on));
    }
  }

  private readonly bands = computed<InsightBand[]>(() => this.param()?.referenceRanges ?? []);
  private readonly issues = computed<RangeIssue[]>(() => {
    const p = this.param();
    if (!p) return [];
    const list = validateRanges({ ...p, unit: p.unit || this.unit() || null });
    const id = `${p.name ?? ''}`;
    if (this.baseline == null || this.baselineFor !== id) {
      this.baselineFor = id;
      this.baseline = new Set(list.filter(i => i.severity === 'error').map(issueKey));
    }
    return list;
  });
  readonly unitText = computed(() => (this.param()?.unit || this.unit() || '').trim());
  /** Some group shows the test-wide critical limit as a grey placeholder. */
  readonly inheritsCritical = computed(() => !!this.param()?.referenceRanges?.length && this.rows().some(r => !r.text
    && (r.inherited.criticalLow != null || r.inherited.criticalHigh != null)));
  /** Test-wide notes (coverage gaps, unit) — one quiet line each. */
  readonly paramMessages = computed(() => this.issues().filter(i => i.band == null).map(i => i.message));

  readonly rows = computed<RowView[]>(() => {
    const p = this.param();
    const issues = this.issues();
    const base = this.baseline ?? new Set<string>();
    return this.bands().map((band, index) => {
      const own = issues.filter(i => i.band === index);
      const fresh = own.filter(i => i.severity === 'error' && !base.has(issueKey(i)));
      const quiet = own.filter(i => !fresh.includes(i))
        .map(i => (i.severity === 'error' ? `Saved like this before — please check: ${i.message}`
          : /^Empty range/.test(i.message) ? EMPTY_GROUP : i.message));
      const age = ageOf(band);
      const sex = sexOf(band);
      const hasNum = band.min != null || band.max != null || band.criticalLow != null || band.criticalHigh != null;
      const crit = effectiveCriticals(band, p);
      const ops = normalOps(band);
      const inherited = {
        criticalLow: band.criticalLow == null ? p?.criticalLow ?? null : null,
        criticalHigh: band.criticalHigh == null ? p?.criticalHigh ?? null : null,
      };
      const inh = (k: 'criticalLow' | 'criticalHigh', word: string): Pick<LimitBox, 'placeholder' | 'title'> =>
        inherited[k] != null ? { placeholder: fmtNum(inherited[k]!), title: `From the test-wide critical ${word}` }
          : { placeholder: 'none', title: '' };
      const boxes: LimitBox[] = [
        { key: 'min', head: LIMIT_HEAD.min, chip: `L ${ops.low}`, tone: 'l', placeholder: 'none', title: '' },
        { key: 'max', head: LIMIT_HEAD.max, chip: `H ${ops.high}`, tone: 'h', placeholder: 'none', title: '' },
        { key: 'criticalLow', head: LIMIT_HEAD.criticalLow, chip: 'C <', tone: 'c', ...inh('criticalLow', 'low') },
        { key: 'criticalHigh', head: LIMIT_HEAD.criticalHigh, chip: 'C >', tone: 'c', ...inh('criticalHigh', 'high') },
      ];
      return {
        index, band, sex, quiet,
        who: SEX_WORD[sex],
        age: { ...age, text: ageWords(age.from, age.to) },
        text: !hasNum && !!band.label?.trim(),
        inherited, boxes,
        summary: summaryOf(band, crit, ops),
        error: fresh.length ? explain(fresh[0], band, crit) : null,
        profile: (band.profileCode ?? '').trim(),
      };
    });
  });

  /** What result entry would flag for this value / patient. */
  readonly tried = computed<FlagLevel | 'none' | null>(() => {
    const v = this.parse(this.tryText());
    if (v == null || !this.param()) return null;
    const a = this.parse(this.tryAge());
    const age = a == null ? null : ageToYears({ n: a, unit: this.tryUnit() });
    const sex = this.trySex();
    return tryValue(this.param(), v, sex === 'any' ? null : sex, age).level ?? 'none';
  });

  label(l: FlagLevel): string { return LEVEL_LABEL[l]; }
  num(n: number | null | undefined): string { return n == null ? '' : fmtNum(n); }
  hasErr(r: RowView, f: LimitKey | 'age'): boolean { return !!r.error?.fields.includes(f); }
  presetOn(p: (typeof AGE_PRESETS)[number], r: RowView): boolean {
    return ageWords(p.from, p.to) === r.age.text;
  }
  parse(s: string | null | undefined): number | null {
    const t = String(s ?? '').trim().replace(',', '.');
    if (!t) return null;
    const v = Number(t);
    return Number.isFinite(v) ? v : null;
  }

  // ── Edits: each replaces ONE band; every other band keeps its object ──
  private emit(next: InsightBand[]) { this.bandsChange.emit(next); }
  private patch(i: number, patch: Partial<InsightBand>) {
    const b = this.bands()[i] as Record<string, unknown> | undefined;
    if (!b) return;
    const p = patch as Record<string, unknown>;
    const changed = Object.keys(p).some(k => b[k] !== p[k] && !(b[k] == null && p[k] == null));
    if (!changed) return;
    this.emit(this.bands().map((x, k) => (k === i ? { ...x, ...patch } : x)));
  }

  /** A typed limit. Not a number → the box is restored, nothing is stored. */
  setLimit(i: number, key: LimitKey, el: HTMLInputElement | { value: string }) {
    const raw = String(el.value ?? '').trim();
    const v = this.parse(raw);
    const b = this.bands()[i];
    if (!b) return;
    if (raw && v == null) { el.value = this.num(b[key] as number | null | undefined); return; }
    if (key === 'min') this.patch(i, v == null ? { min: null, ...(b.minOp != null ? { minOp: null } : {}) } : { min: v });
    else if (key === 'max') this.patch(i, v == null ? { max: null, ...(b.maxOp != null ? { maxOp: null } : {}) } : { max: v });
    else this.patch(i, { [key]: v });
  }
  setLabel(i: number, text: string) { this.patch(i, { label: String(text ?? '').trim() || null }); }

  setSex(i: number, v: 'M' | 'F' | 'any') {
    const b = this.bands()[i];
    if (!b || sexOf(b) === v) return;
    const patch: Partial<InsightBand> = { sex: v };
    // A structured sex stops the resolver reading the age out of the legacy
    // segment label — carry that age over as structured fields.
    if (v !== 'any' && b.minAge == null && b.maxAge == null) {
      const a = resolveRangeAgeYears(b);
      if (a.hasAge) Object.assign(patch, { minAge: a.minY, maxAge: a.maxY, ageUnit: 'years' });
    }
    this.patch(i, patch);
  }

  toggleAge(i: number) { this.ageOpen.set(this.ageOpen() === i ? null : i); }

  /** One side of the age changed (a number, or its unit). */
  setAgeSide(r: RowView, side: 'from' | 'to', text: string | null, unit: AgeUnit | null) {
    const cur = { from: r.age.from, to: r.age.to };
    const old = cur[side];
    let next: AgeSide | null;
    if (text != null) {
      const v = this.parse(text);
      if (text.trim() && v == null) return;
      next = v == null ? null : { n: v, unit: old?.unit ?? cur[side === 'from' ? 'to' : 'from']?.unit ?? 'years' };
    } else {
      if (!old) return;              // a unit alone for an empty side means nothing yet
      next = { n: old.n, unit: unit ?? old.unit };
    }
    this.setAge(r.index, side === 'from' ? next : cur.from, side === 'to' ? next : cur.to, cur);
  }

  /**
   * Write an age. One unit both sides → stored in that unit ("0–28 days").
   * Mixed ("28 days – 1 year") → stored in years like today's catalogue; a
   * side the user did not change keeps its exact stored value.
   */
  setAge(i: number, from: AgeSide | null, to: AgeSide | null, was?: { from: AgeSide | null; to: AgeSide | null }) {
    const b = this.bands()[i];
    if (!b) return;
    if (!from && !to) { this.patch(i, { minAge: null, maxAge: null }); return; }
    const unit = from && to ? (from.n === 0 ? to.unit : from.unit) : (from ?? to)!.unit;
    const oneUnit = !from || !to || from.n === 0 || from.unit === to.unit;
    if (oneUnit) {
      const inUnit = (s: AgeSide | null) => (s == null ? null : s.unit === unit ? s.n : round(s.n * PER_YEAR[unit] / PER_YEAR[s.unit], 6));
      this.patch(i, { minAge: inUnit(from), maxAge: inUnit(to), ageUnit: unit });
      return;
    }
    const exact = resolveRangeAgeYears(b);
    const same = (a: AgeSide | null, c: AgeSide | null | undefined) => !!a && !!c && a.n === c.n && a.unit === c.unit;
    const years = (s: AgeSide | null, prev: AgeSide | null | undefined, stored: number | null) =>
      s == null ? null : same(s, prev) && stored != null ? stored : round(ageToYears(s), 6);
    this.patch(i, {
      minAge: years(from, was?.from, exact.minY),
      maxAge: years(to, was?.to, exact.maxY),
      ageUnit: 'years',
    });
  }

  addBand() {
    const last = this.bands()[this.bands().length - 1];
    const copy: InsightBand = last
      ? { segment: 'normal', sex: 'any', min: last.min ?? null, max: last.max ?? null,
          ...(last.minOp ? { minOp: last.minOp } : {}), ...(last.maxOp ? { maxOp: last.maxOp } : {}),
          ...(last.criticalLow != null ? { criticalLow: last.criticalLow } : {}),
          ...(last.criticalHigh != null ? { criticalHigh: last.criticalHigh } : {}) }
      : { segment: 'normal', sex: 'any', min: null, max: null };
    const n = this.bands().length;
    this.emit([...this.bands(), copy]);
    if (this.phone()) this.cardOpen.set(n);
  }

  removeBand(i: number) {
    if (this.baseline) {
      const shifted = new Set<string>();
      for (const k of this.baseline) {
        const [band, ...rest] = k.split('|');
        const n = band === '' ? null : Number(band);
        if (n === i) continue;
        shifted.add([n != null && n > i ? String(n - 1) : band, ...rest].join('|'));
      }
      this.baseline = shifted;
    }
    this.ageOpen.set(null);
    this.cardOpen.set(null);
    this.emit(this.bands().filter((_, k) => k !== i));
  }
}

const issueKey = (i: RangeIssue) => `${i.band ?? ''}|${i.field ?? ''}|${i.message}`;

/** Phone line 2: "L < 12 · H > 16 · Critical < 7 · > 20". */
function summaryOf(b: InsightBand, crit: { low: number | null; high: number | null },
  ops: { low: string; high: string }): string {
  const n = fmtNum;
  const parts: string[] = [];
  const nb = (t: string) => t.replace(/ /g, '\u00a0');
  if (b.min != null) parts.push(`L ${ops.low} ${n(b.min)}`);
  if (b.max != null) parts.push(`H ${ops.high} ${n(b.max)}`);
  if (!parts.length && b.label?.trim()) parts.push(`Normal: ${b.label.trim()}`);
  const c = [crit.low != null ? `< ${n(crit.low)}` : '', crit.high != null ? `> ${n(crit.high)}` : ''].filter(Boolean);
  if (c.length) parts.push(`Critical ${c.join(' · ')}`);
  if (!parts.length) parts.push('Nothing set');
  // Each piece stays on one line ("Critical < 7" never breaks after "<").
  return parts.map(p => p.split(' · ').map(nb).join(' · ')).join(' · ');
}

/** A new error, in the table's own words, with the boxes it concerns. */
function explain(i: RangeIssue, b: InsightBand, crit: { low: number | null; high: number | null }): FieldIssue {
  const n = (x: number | null | undefined) => (x == null ? '' : fmtNum(x));
  const m = i.message;
  if (i.field === 'max') return { text: `Normal runs backwards: ${n(b.min)} is above ${n(b.max)}.`, fields: ['min', 'max'] };
  if (i.field === 'maxAge' || i.field === 'minAge') return { text: 'Age “from” is after age “to”.', fields: ['age'] };
  if (i.field === 'criticalLow') {
    if (/must be below Critical high/.test(m)) return { text: `Critical below (${n(crit.low)}) must be less than critical above (${n(crit.high)}).`, fields: ['criticalLow', 'criticalHigh'] };
    if (/inside the normal range/.test(m)) return { text: `Critical below (${n(crit.low)}) can’t be inside Normal — make it ${n(b.min)} or less.`, fields: ['criticalLow', 'min'] };
    return { text: `Critical below (${n(crit.low)}) must be less than the top of Normal (${n(b.max)}).`, fields: ['criticalLow', 'max'] };
  }
  if (i.field === 'criticalHigh') {
    if (/inside the normal range/.test(m)) return { text: `Critical above (${n(crit.high)}) can’t be inside Normal — make it ${n(b.max)} or more.`, fields: ['criticalHigh', 'max'] };
    return { text: `Critical above (${n(crit.high)}) must be more than the bottom of Normal (${n(b.min)}).`, fields: ['criticalHigh', 'min'] };
  }
  return { text: m, fields: [] };
}
