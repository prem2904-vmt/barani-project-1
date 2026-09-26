import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { PfSelectOption, SelectComponent } from '../../../../shared/primitives/select.component';
import {
  LEVEL_LABEL, bandSex, effectiveCriticals, fmtNum, tryValue, validateRanges,
  type FlagLevel, type InsightBand, type InsightParam, type RangeField, type RangeIssue,
} from '../../../../shared/utils/range-insight';
import { bandReportText, resolveRangeAgeYears } from '../../../../shared/utils/reference-range';

export type AgeUnit = 'days' | 'months' | 'years';
const PER_YEAR: Record<AgeUnit, number> = { years: 1, months: 12, days: 365.25 };
const UNITS: readonly AgeUnit[] = ['days', 'months', 'years'];

/** A number the table edits, by its stored field (L = min, H = max). */
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

/** The age a group applies to, in natural units (stored days / months shown as stored). */
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

/** A group as the simple model stores it (owner, 2026-09-26): Who, Age,
 *  L / H / CL / CH and the Report text — nothing else. Legacy `segment`,
 *  `label`, `minOp` / `maxOp` are read, never written. */
export interface SimpleGroup {
  sex: 'any' | 'M' | 'F';
  minAge: number | null;
  maxAge: number | null;
  ageUnit: AgeUnit;
  min: number | null;
  max: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  reportText: string | null;
  profileCode?: string | null;
}

/**
 * A (possibly legacy) group → the simple stored shape. Sex / age a legacy
 * `segment` implied become structured; the parameter-level criticals fill a
 * group's blank CL / CH; a legacy authored label keeps printing by becoming
 * the Report text, so an edit never silently changes the report.
 */
export function toSimpleGroup(b: InsightBand, param?: InsightParam | null, unit?: string | null): SimpleGroup {
  const sex = bandSex(b) ?? 'any';
  let minAge = b.minAge ?? null, maxAge = b.maxAge ?? null;
  let ageUnit = ((b.ageUnit ?? 'years') as AgeUnit);
  if (minAge == null && maxAge == null) {
    const a = resolveRangeAgeYears(b);
    if (a.hasAge) { minAge = a.minY != null ? round(a.minY, 6) : null; maxAge = a.maxY != null ? round(a.maxY, 6) : null; ageUnit = 'years'; }
  }
  const crit = effectiveCriticals(b, param);
  const legacyLabel = !b.reportText?.trim() && !!b.label?.trim();
  const reportText = b.reportText?.trim() || (legacyLabel ? bandReportText({ ...b, reportText: null }, unit) : null) || null;
  const out: SimpleGroup = {
    sex, minAge, maxAge, ageUnit,
    min: b.min ?? null, max: b.max ?? null,
    criticalLow: crit.low, criticalHigh: crit.high,
    reportText,
  };
  if (b.profileCode) out.profileCode = b.profileCode;
  return out;
}

/** A new, empty group: Anyone, any age, no limits, no report text. */
export function blankGroup(): SimpleGroup {
  return {
    sex: 'any', minAge: null, maxAge: null, ageUnit: 'years',
    min: null, max: null, criticalLow: null, criticalHigh: null, reportText: null,
  };
}

/**
 * Legacy test-wide criticals (`criticalLow` / `criticalHigh` on the
 * parameter) → each group's own CL / CH (a group's own value wins), and the
 * test-wide pair is dropped. Flags are unchanged (mw reads group ?? test-wide).
 * A parameter with no groups keeps its pair. Returns the same object when
 * there is nothing to lift.
 */
export function liftParamCriticals<T extends InsightParam>(p: T): T {
  const bands = p.referenceRanges ?? [];
  if (!bands.length || (p.criticalLow == null && p.criticalHigh == null)) return p;
  const next = bands.map(b => ({
    ...b,
    criticalLow: b.criticalLow ?? p.criticalLow ?? null,
    criticalHigh: b.criticalHigh ?? p.criticalHigh ?? null,
  }));
  const out = { ...p, referenceRanges: next } as T;
  delete (out as InsightParam).criticalLow;
  delete (out as InsightParam).criticalHigh;
  return out;
}

export interface RowView {
  index: number;
  band: InsightBand;
  sex: 'M' | 'F' | 'any';
  who: string;
  age: { from: AgeSide | null; to: AgeSide | null; text: string };
  /** What prints when the Report text is blank (the input's placeholder). */
  fallback: string;
  /** Phone line 2: the report text, else the fallback. */
  prints: string;
  /** ONE plain line — the first problem with this group (blocks Save). */
  error: string | null;
  errField: RangeField | null;
  profile: string;
}

/** The four limit columns: stored field, header, accessible name. */
export const LIMITS: ReadonlyArray<{ key: LimitKey; head: string; name: string }> = [
  { key: 'min', head: 'L', name: 'L — below this prints L (low)' },
  { key: 'max', head: 'H', name: 'H — above this prints H (high)' },
  { key: 'criticalLow', head: 'CL', name: 'CL — below this is critical' },
  { key: 'criticalHigh', head: 'CH', name: 'CH — above this is critical' },
];

let seq = 0;
const SEX_WORD = { any: 'Anyone', M: 'Male', F: 'Female' } as const;

/**
 * Reference ranges as ONE compact table (owner, 2026-09-26: "keep it very
 * simple — H, L, CL, CH and a report box"):
 *
 *   Who | Age | L | H | CL | CH | Report text | ×
 *
 * value < L → L, > H → H, < CL or > CH → critical; on a limit = not flagged;
 * blank = no flag on that side. The Report text prints on the report exactly
 * as typed; blank prints "L–H unit". Every problem is one plain line under
 * its row and blocks Save (mw refuses the same set). An untouched group is
 * never re-written; an edited group is stored in the simple shape
 * ({@link toSimpleGroup}). Phones: one card per group, tap to edit.
 * Shared byte-identical by prefrontal-ui and prefrontal-admin-ui.
 */
@Component({
  selector: 'pf-range-table',
  standalone: true,
  imports: [SelectComponent, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rtb">
      @if (!phone()) {
        <table class="rtb__table">
          <colgroup>
            <col class="rtb__c-who" /><col class="rtb__c-age" />
            <col class="rtb__c-lim" /><col class="rtb__c-lim" /><col class="rtb__c-lim" /><col class="rtb__c-lim" />
            <col class="rtb__c-txt" /><col class="rtb__c-x" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Who</th>
              <th scope="col">Age</th>
              @for (l of limits; track l.key; let first = $first) {
                <th scope="col" class="rtb__num" [title]="l.name">{{ l.head }}@if (first && unitText()) {<span class="rtb__unit">{{ unitText() }}</span>}</th>
              }
              <th scope="col">Report text</th>
              <th scope="col"><span class="rtb__sr">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.index) {
              <tr class="rtb__row" [class.rtb__row--err]="!!r.error" [attr.data-who]="r.who + ' · ' + r.age.text">
                <td>
                  <pf-select size="sm" class="rtb__sel" [options]="sexOptions" [value]="r.sex"
                             [class.rtb__sel--err]="r.errField === 'sex'"
                             (valueChange)="setSex(r.index, $any($event))"></pf-select>
                  @if (r.profile) { <span class="rtb__tag">only in {{ r.profile }}</span> }
                </td>
                <td>
                  <button type="button" class="rtb__agebtn" [class.rtb__in--err]="r.errField === 'age' || r.errField === 'sex'"
                          [attr.aria-expanded]="ageOpen() === r.index" [attr.aria-label]="'Age: ' + r.age.text + '. Change'"
                          (click)="toggleAge(r.index)">
                    <span>{{ r.age.text }}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                  </button>
                </td>
                @for (l of limits; track l.key) {
                  <td><ng-container *ngTemplateOutlet="limitBox; context: { $implicit: r, l: l }"></ng-container></td>
                }
                <td><ng-container *ngTemplateOutlet="textBox; context: { $implicit: r }"></ng-container></td>
                <td class="rtb__acts">
                  <button type="button" class="rtb__rm" [attr.aria-label]="'Remove group ' + r.who + ' · ' + r.age.text"
                          title="Remove group" (click)="removeBand(r.index)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                  </button>
                </td>
              </tr>
              @if (ageOpen() === r.index) {
                <tr class="rtb__subrow"><td colspan="8">
                  <ng-container *ngTemplateOutlet="ageEditor; context: { $implicit: r }"></ng-container>
                </td></tr>
              }
              @if (r.error) {
                <tr class="rtb__subrow"><td colspan="8"><p class="rtb__msg" role="alert">{{ r.error }}</p></td></tr>
              }
            }
          </tbody>
          <tfoot>
            <tr><td colspan="8">
              <button type="button" class="rtb__add" (click)="addBand()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                Add group
              </button>
            </td></tr>
          </tfoot>
        </table>
      } @else {
        @if (unitText()) { <p class="rtb__note">L · H · CL · CH in {{ unitText() }}</p> }
        <ul class="rtb__cards">
          @for (r of rows(); track r.index) {
            <li class="rtb__card" [class.rtb__card--open]="cardOpen() === r.index" [class.rtb__row--err]="!!r.error">
              <button type="button" class="rtb__cardhead" [attr.aria-expanded]="cardOpen() === r.index"
                      (click)="cardOpen.set(cardOpen() === r.index ? null : r.index)">
                <span class="rtb__cardtxt">
                  <span class="rtb__l1">{{ r.who }} · {{ r.age.text }}@if (r.profile) { <span class="rtb__tag">only in {{ r.profile }}</span> }</span>
                  <span class="rtb__l2">{{ r.prints }}</span>
                </span>
                <svg class="rtb__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              @if (r.error) { <p class="rtb__msg" role="alert">{{ r.error }}</p> }
              @if (cardOpen() === r.index) {
                <div class="rtb__cardbody">
                  <div class="rtb__seg" role="radiogroup" aria-label="Who">
                    @for (s of sexOptions; track s.value) {
                      <button type="button" class="rtb__segi" role="radio" [attr.aria-checked]="r.sex === s.value"
                              (click)="setSex(r.index, $any(s.value))">{{ s.label }}</button>
                    }
                  </div>
                  <ng-container *ngTemplateOutlet="ageEditor; context: { $implicit: r }"></ng-container>
                  <div class="rtb__grid2">
                    @for (l of limits; track l.key) {
                      <label class="rtb__fld"><span class="rtb__muted">{{ l.head }}</span>
                        <ng-container *ngTemplateOutlet="limitBox; context: { $implicit: r, l: l }"></ng-container></label>
                    }
                  </div>
                  <label class="rtb__fld"><span class="rtb__muted">Report text</span>
                    <ng-container *ngTemplateOutlet="textBox; context: { $implicit: r }"></ng-container></label>
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

      @if (paramMessage(); as m) { <p class="rtb__msg" role="alert">{{ m }}</p> }

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
            <span class="rtb__verdict" [attr.data-level]="t" aria-live="polite">→ {{ t === 'none' ? 'Not flagged' : label(t) }}</span>
          }
        </div>
      }
    </div>

    <ng-template #limitBox let-r let-l="l">
      <input class="rtb__in rtb__in--lim" type="text" inputmode="decimal" autocomplete="off"
             [attr.aria-label]="l.name" [title]="l.name"
             [class.rtb__in--err]="r.errField === l.key || (r.errField === 'max' && l.key === 'min')"
             [value]="num(r.band[l.key] ?? inherited(r.band, l.key))"
             (change)="setLimit(r.index, l.key, $any($event.target))" (keydown.enter)="$any($event.target).blur()" />
    </ng-template>

    <ng-template #textBox let-r>
      <input class="rtb__in rtb__in--text" type="text" autocomplete="off" aria-label="Report text — prints exactly as typed"
             [value]="r.band.reportText || ''" [placeholder]="r.fallback" [title]="r.band.reportText || r.fallback"
             (change)="setText(r.index, $any($event.target).value)" (keydown.enter)="$any($event.target).blur()" />
    </ng-template>

    <ng-template #ageEditor let-r>
      <div class="rtb__ageed" role="group" [attr.aria-label]="'Age for ' + r.who">
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
    </ng-template>
  `,
  styles: [`
    :host { display: block; min-width: 0; max-width: 100%; }
    .rtb {
      --rtb-line: var(--nd-line, var(--glass-border, #e5e7eb));
      --rtb-err: var(--red-border, #dc2626);
      --rtb-field: color-mix(in srgb, var(--text-primary) 22%, transparent);
      display: flex; flex-direction: column; gap: 10px; font-family: inherit; font-variant-numeric: tabular-nums;
    }
    :host-context(.dark) .rtb { --rtb-err: #f87171; }
    .rtb__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .rtb__muted { font-size: 12.5px; color: var(--text-tertiary); white-space: nowrap; }
    .rtb__unit { margin-left: 6px; font-weight: 400; color: var(--text-tertiary); }
    .rtb__tag { display: block; margin-top: 2px; font-size: 11.5px; font-weight: 400; color: var(--text-tertiary); }

    /* ── Desktop table ─────────────────────────────────────────────── */
    .rtb__table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .rtb__c-who { width: 108px; }
    .rtb__c-age { width: 182px; }
    .rtb__c-lim { width: 70px; }
    .rtb__c-txt { width: auto; }
    .rtb__c-x { width: 40px; }
    .rtb__table th, .rtb__table td { padding: 6px 8px 6px 0; text-align: left; vertical-align: middle; }
    .rtb__table thead th { font-size: 12px; font-weight: 500; color: var(--text-secondary); padding-bottom: 8px; vertical-align: bottom; white-space: nowrap; }
    .rtb__row { border-top: 1px solid var(--rtb-line); }
    .rtb__table tfoot tr { border-top: 1px solid var(--rtb-line); }
    .rtb__table tfoot td { padding: 6px 0 0; }
    .rtb__subrow td { padding: 0 0 10px; white-space: normal !important; }
    .rtb__acts { padding-right: 0 !important; text-align: right !important; white-space: nowrap; }
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
    .rtb__in--lim { padding: 0 8px; }
    .rtb__in--text { font-weight: 400; text-overflow: ellipsis; }

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
    .rtb__agebtn:focus-visible, .rtb__rm:focus-visible, .rtb__add:focus-visible,
    .rtb__segi:focus-visible, .rtb__cardhead:focus-visible {
      outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }

    .rtb__rm { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 0; vertical-align: middle;
      border-radius: 8px; background: transparent; color: var(--text-tertiary); cursor: pointer; }
    .rtb__rm:hover { color: var(--text-primary); background: var(--nd-chip-bg, rgba(127,127,127,.12)); }

    .rtb__add { display: inline-flex; align-items: center; gap: 6px; align-self: flex-start; height: 32px; padding: 0 10px 0 6px;
      border: 0; border-radius: 8px; background: transparent; font: inherit; font-size: 13px; font-weight: 500;
      color: var(--text-secondary); cursor: pointer; }
    .rtb__add:hover { color: var(--text-primary); background: var(--nd-chip-bg, rgba(127,127,127,.12)); }
    .rtb__add--rm { color: var(--text-tertiary); padding-left: 0; }

    .rtb__msg { margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--rtb-err); }
    .rtb__note { margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--text-tertiary); }

    /* Age editor (desktop: a row under the group; phone: inside the card). */
    .rtb__ageed { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 10px; border-radius: 10px;
      background: var(--nd-chip-bg, rgba(127,127,127,.08)); }
    .rtb__in--age { width: 72px; }
    .rtb__sel--unit { width: 112px; }

    /* Try a value — one small line. */
    .rtb__try { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .rtb__trylbl { font-size: 12.5px; font-weight: 500; color: var(--text-secondary); }
    .rtb__try .rtb__in { height: 32px; font-size: 13px; }
    .rtb__in--try { width: 84px; }
    .rtb__in--tage { width: 60px; }
    .rtb__sel--try { width: 112px; }
    .rtb__verdict { font-size: 13px; font-weight: 600; color: var(--text-primary); }
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
    .rtb__l2 { font-size: 14px; color: var(--text-secondary); line-height: 1.35; overflow-wrap: anywhere; }
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
      .rtb__in, .rtb__agebtn, .rtb__try .rtb__in { height: 44px; font-size: 16px; }
      .rtb__rm, .rtb__add, .rtb__segi { min-height: 44px; }
      .rtb__ageed { display: grid; grid-template-columns: auto 1fr 1fr; padding: 10px; }
      .rtb__ageed > .rtb__muted:nth-of-type(2) { grid-column: 1; }
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
  /** Shown once, in the table header ("g/dL"). */
  readonly unit = input<string>('');
  /** The new group list — the host writes it to the parameter unchanged. */
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
  readonly limits = LIMITS;
  readonly uid = `rtb-try-${++seq}`;

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
  private readonly issues = computed<RangeIssue[]>(() => validateRanges(this.param()));
  readonly unitText = computed(() => (this.param()?.unit || this.unit() || '').trim());
  /** A test-wide problem (legacy criticals with no groups) — one line. */
  readonly paramMessage = computed(() => this.issues().find(i => i.band == null)?.message ?? null);

  readonly rows = computed<RowView[]>(() => {
    const issues = this.issues();
    const unit = this.unitText();
    return this.bands().map((band, index) => {
      const first = issues.find(i => i.band === index) ?? null;
      const age = ageOf(band);
      const sex = bandSex(band) ?? 'any';
      const fallback = bandReportText({ ...band, reportText: null }, unit) ?? '';
      return {
        index, band, sex,
        who: SEX_WORD[sex],
        age: { ...age, text: ageWords(age.from, age.to) },
        fallback,
        prints: band.reportText?.trim() || fallback || 'No limits set',
        error: first?.message ?? null,
        errField: first?.field ?? null,
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
  /** A legacy test-wide critical shows in a group's CL / CH box (it applies there). */
  inherited(b: InsightBand, key: LimitKey): number | null {
    const p = this.param();
    if (key === 'criticalLow') return p?.criticalLow ?? null;
    if (key === 'criticalHigh') return p?.criticalHigh ?? null;
    void b;
    return null;
  }
  parse(s: string | null | undefined): number | null {
    const t = String(s ?? '').trim().replace(',', '.');
    if (!t) return null;
    const v = Number(t);
    return Number.isFinite(v) ? v : null;
  }

  // ── Edits: each rewrites ONE group in the simple shape; others keep their object ──
  private emit(next: InsightBand[]) { this.bandsChange.emit(next); }
  private patch(i: number, patch: Partial<SimpleGroup>) {
    const b = this.bands()[i];
    if (!b) return;
    const simple = toSimpleGroup(b, this.param(), this.unitText());
    const cur = simple as unknown as Record<string, unknown>;
    const p = patch as Record<string, unknown>;
    const changed = Object.keys(p).some(k => cur[k] !== p[k] && !(cur[k] == null && p[k] == null));
    if (!changed) return;
    this.emit(this.bands().map((x, k) => (k === i ? ({ ...simple, ...patch } as InsightBand) : x)));
  }

  /** A typed limit. Not a number → the box is restored, nothing is stored. */
  setLimit(i: number, key: LimitKey, el: HTMLInputElement | { value: string }) {
    const raw = String(el.value ?? '').trim();
    const v = this.parse(raw);
    const b = this.bands()[i];
    if (!b) return;
    if (raw && v == null) { el.value = this.num((b[key] as number | null | undefined) ?? this.inherited(b, key)); return; }
    this.patch(i, { [key]: v });
  }
  setText(i: number, text: string) { this.patch(i, { reportText: String(text ?? '').trim() || null }); }

  setSex(i: number, v: 'M' | 'F' | 'any') {
    const b = this.bands()[i];
    if (!b || (bandSex(b) ?? 'any') === v) return;
    this.patch(i, { sex: v });
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
   * Mixed ("28 days – 1 year") → stored in years; a side the user did not
   * change keeps its exact stored value.
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
    const n = this.bands().length;
    this.emit([...this.bands(), blankGroup() as InsightBand]);
    if (this.phone()) this.cardOpen.set(n);
    else this.ageOpen.set(n);
  }

  removeBand(i: number) {
    this.ageOpen.set(null);
    this.cardOpen.set(null);
    this.emit(this.bands().filter((_, k) => k !== i));
  }
}
