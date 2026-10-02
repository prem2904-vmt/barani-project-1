import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TestParameter } from '../../models/test.model';
import { FieldOption, ReferenceRange, WorkflowContext, WorkflowField } from '../../models/workflow.model';
import { PfSelectOption, SelectComponent } from '../../primitives/select.component';
import { COUNTRY_PHONE_RULES, CountryPhoneRule, getCountryPhoneRule, validatePhoneNumber } from '../../forms/validate';
import { AGE_LIMITS, AgeUnit, dobFromAge, isContactNumberField, validateAge } from '../../forms/patient-fields';
import { ageParts } from '../../utils/patient-age';
import { normalizeSex, selectReferenceRange } from '../../utils/reference-range';
import { liveFlag } from '../../utils/result-flag';
import { labToday } from '../../utils/lab-clock';
import { NdDateComponent } from '../nd-date/nd-date.component';
import { NdTimeComponent } from '../nd-time/nd-time.component';
import { NdDateTimeComponent } from '../nd-date/nd-datetime.component';

export type DynamicFieldType =
  | 'text' | 'number' | 'numeric' | 'numeric_with_range' | 'critical_numeric'
  | 'textarea' | 'email' | 'phone' | 'date' | 'datetime' | 'time'
  | 'select' | 'multiselect'
  | 'radio' | 'button_select' | 'multi_button_select' | 'image_select'
  | 'yesno' | 'yes_no_na' | 'toggle'
  | 'checkbox' | 'scan'
  | 'patient_search' | 'doctor_search' | 'test_picker'
  | 'dynamic_from_test';

export interface DynamicFieldConfig {
  name: string;
  title: string;
  type: string;
  required?: boolean;
  /** Either string options or {value,label} objects; normalised internally. */
  options?: Array<string | FieldOption>;
  unit?: string;
  defaultValue?: unknown;
  placeholder?: string;
  helperText?: string;
  referenceRanges?: ReferenceRange[];
  criticalLow?: number;
  criticalHigh?: number;
  normalValue?: unknown;
}

type Flag = 'none' | 'normal' | 'low' | 'high' | 'critical_low' | 'critical_high';

/** A number field that is really a phone number (by its name / label).
 *  Lives in shared/forms (validation uses it too); re-exported for callers. */
export { isContactNumberField };

@Component({
  selector: 'pf-dynamic-input',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, SelectComponent, NdDateComponent, NdTimeComponent, NdDateTimeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ndOn()) {
      <ng-container *ngTemplateOutlet="ndTpl"></ng-container>
    } @else {
      <ng-container *ngTemplateOutlet="classicTpl"></ng-container>
    }

    <!-- NEW DESIGN (ND-PATTERN §14 fields) — opt-in via [nd]. Kit fields:
         .nd-field › .nd-field__lbl (+ the amber REQUIRED dot) › .nd-input;
         choices of 2–4 (and one-tap pills) are a neutral .nd-seg driven by
         aria-pressed (never an --on class); on/off is a slate .nd-toggle.
         Noto only; ID / phone / age numbers in tabular numbers. The value
         logic (phone rules, identity grouping, DOB ⇄ age) is shared with
         the classic template below — only the markup differs. -->
    <ng-template #ndTpl>
      @let t = ndType();
      @let opts = normalisedOptions();
      @let err = error || (t === 'phone' ? phoneError() : null) || (isDobField() ? dobError() : null);
      <div class="flex flex-col gap-1.5 nd-field pf-di-nd" [attr.data-field]="field.name" [class.pf-di-nd--error]="!!err">
        @if (t !== 'checkbox' && t !== 'toggle') {
          <label class="nd-field__lbl pf-di-lbl" [attr.for]="inputId" [id]="inputId + '-l'">
            <span>{{ field.title }}</span>
            @if (field.unit) { <span class="pf-di-unit">({{ field.unit }})</span> }
            @if (field.required) {
              <span class="nd-dot-unpriced pf-di-req" role="img" aria-label="required" title="Required"></span>
            }
          </label>
        }

        @switch (t) {
          @case ('text') {
            @if (identityFormat(); as fmt) {
              <input #dinp [id]="inputId" data-pf-stop type="text" inputmode="numeric" class="nd-input nd-num"
                     [class.nd-input--error]="!!err" [attr.aria-invalid]="err ? true : null" [attr.aria-describedby]="err ? inputId + '-e' : null"
                     [attr.maxlength]="fmt.max" [placeholder]="fmt.placeholder" [attr.aria-required]="field.required || null"
                     [ngModel]="displayIdentity(value)" (ngModelChange)="emitIdentity(dinp, $event, fmt)" />
            } @else if (digitLimit(); as lim) {
              <input #dinp [id]="inputId" data-pf-stop type="text" inputmode="numeric" pattern="[0-9]*" class="nd-input nd-num"
                     [class.nd-input--error]="!!err" [attr.aria-invalid]="err ? true : null" [attr.aria-describedby]="err ? inputId + '-e' : null"
                     [attr.maxlength]="lim" [placeholder]="field.placeholder ?? ''" [attr.aria-required]="field.required || null"
                     [ngModel]="value" (ngModelChange)="emitDigits(dinp, $event, lim)" />
            } @else {
              <input [id]="inputId" data-pf-stop type="text" class="nd-input" [placeholder]="field.placeholder ?? ''"
                     [class.nd-input--error]="!!err" [attr.aria-invalid]="err ? true : null" [attr.aria-describedby]="err ? inputId + '-e' : null"
                     [attr.aria-required]="field.required || null"
                     [ngModel]="value" (ngModelChange)="emit($event)" />
            }
          }
          @case ('email') {
            <input [id]="inputId" data-pf-stop type="email" class="nd-input" [placeholder]="field.placeholder ?? ''"
                   [class.nd-input--error]="!!err" [attr.aria-invalid]="err ? true : null" [attr.aria-describedby]="err ? inputId + '-e' : null"
                   [attr.aria-required]="field.required || null" [ngModel]="value" (ngModelChange)="emit($event)" />
          }
          @case ('phone') {
            <div class="pf-di-phone" [class.pf-di-phone--err]="!!err">
              <pf-select class="pf-di-phone__cc" [options]="countrySelectOptionsNd" [searchable]="true"
                         [value]="selectedCountryCode()" (valueChange)="onCountryCodeChange($any($event))"></pf-select>
              <span class="pf-di-phone__sep" aria-hidden="true"></span>
              <input #phIn [id]="inputId" data-pf-stop type="tel" inputmode="tel" class="pf-di-phone__num nd-num"
                     [attr.aria-required]="field.required || null"
                     [attr.aria-invalid]="err ? true : null" [attr.aria-describedby]="err ? inputId + '-e' : null"
                     [attr.maxlength]="activePhoneRule().maxDigits"
                     [placeholder]="activePhoneRule().placeholder"
                     [ngModel]="phoneDigits()" (ngModelChange)="onPhoneDigitsChange($event, phIn)" />
            </div>
          }
          @case ('number') { <ng-container *ngTemplateOutlet="ndNumTpl; context: { err: err }"></ng-container> }
          @case ('numeric') { <ng-container *ngTemplateOutlet="ndNumTpl; context: { err: err }"></ng-container> }
          @case ('textarea') {
            <textarea [id]="inputId" data-pf-stop class="nd-input pf-di-area" [placeholder]="field.placeholder ?? ''"
                      [class.nd-input--error]="!!err" [attr.aria-invalid]="err ? true : null" [attr.aria-describedby]="err ? inputId + '-e' : null"
                      [ngModel]="value" (ngModelChange)="emit($event)"></textarea>
          }
          @case ('date') {
            @if (isDobField()) {
              <!-- DOB ⇄ age: an exact date OR an age (Yrs / Mo), same logic as classic. -->
              <div class="pf-di-dob">
                <!-- A typed dd/mm/yyyy (auto slashes) — EMPTY by default in every
                     browser (a native date input shows today greyed in Safari).
                     The calendar button still opens the native picker. -->
                <span class="pf-di-date pf-di-dob__date">
                  <input #dobIn [id]="inputId" data-pf-stop type="text" inputmode="numeric" autocomplete="off"
                         maxlength="10" placeholder="dd/mm/yyyy" class="nd-input nd-num pf-di-date__in"
                         [class.nd-input--error]="!!err" [attr.aria-invalid]="err ? true : null" [attr.aria-describedby]="err ? inputId + '-e' : null"
                         [attr.aria-required]="field.required || null"
                         [value]="dobText()" (input)="onDobInput(dobIn)" (blur)="onDobBlur()" />
                  <button type="button" class="pf-di-date__pick" tabindex="-1" aria-label="Pick a date" title="Pick a date"
                          (click)="openDobPicker(dobPick)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                  </button>
                  <input #dobPick type="date" class="pf-di-date__native" tabindex="-1" aria-hidden="true"
                         [attr.max]="todayIso" [value]="value || ''" (change)="onDobPicked(dobPick.value)" />
                </span>
                <span class="pf-di-dob__or">or</span>
                <input #ageIn type="text" inputmode="numeric" pattern="[0-9]*" [attr.maxlength]="ageMaxLength()" autocomplete="off"
                       class="nd-input nd-num pf-di-dob__age" [class.nd-input--error]="!!err" placeholder="Age"
                       [attr.aria-label]="'Age in ' + ageUnit()" [attr.aria-invalid]="err ? true : null"
                       [attr.aria-describedby]="err ? inputId + '-e' : null"
                       [value]="ageText() ?? hybridAgeDisplay() ?? ''" (input)="onAgeText(ageIn)" (blur)="onAgeBlur()" />
                <div class="nd-seg pf-di-seg pf-di-seg--unit" role="radiogroup" aria-label="Age unit"
                     (keydown)="onUnitKey($event)">
                  <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="ageUnit() === 'years'"
                          [attr.tabindex]="ageUnit() === 'years' ? 0 : -1" (click)="setAgeUnit('years')" title="Years (0–150)">Yrs</button>
                  <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="ageUnit() === 'months'"
                          [attr.tabindex]="ageUnit() === 'months' ? 0 : -1" (click)="setAgeUnit('months')" title="Months (0–1199)">Mo</button>
                  <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="ageUnit() === 'days'"
                          [attr.tabindex]="ageUnit() === 'days' ? 0 : -1" (click)="setAgeUnit('days')" title="Days (0–365)">Days</button>
                </div>
              </div>
              @if (!err) { <p class="nd-field__hint">Type either — an entered age stays current automatically.</p> }
            } @else {
              <pf-nd-date [inputId]="inputId" [label]="field.title" [value]="asDateStr(value)"
                          (valueChange)="emit($event)"></pf-nd-date>
            }
          }
          @case ('datetime') {
            <pf-nd-datetime [label]="field.title" [value]="asDateStr(value)"
                            (valueChange)="emit($event)"></pf-nd-datetime>
          }
          @case ('time') {
            <pf-nd-time [inputId]="inputId" [label]="field.title" [value]="asDateStr(value)"
                        (valueChange)="emit($event)"></pf-nd-time>
          }
          @case ('select') {
            @if (opts.length >= 2 && opts.length <= 4) {
              <!-- 2–4 choices (Sex, …): a neutral segmented control that fills the column. -->
              <ng-container *ngTemplateOutlet="ndSegTpl; context: { $implicit: opts, fill: true, err: err }"></ng-container>
            } @else {
              <pf-select [options]="selectOptions()" [value]="value" [searchable]="opts.length > 8"
                         [class.pf-di-select--error]="!!err"
                         [placeholder]="field.placeholder ?? 'Select…'" (valueChange)="emit($event)"></pf-select>
            }
          }
          @case ('button_select') {
            <ng-container *ngTemplateOutlet="ndSegTpl; context: { $implicit: opts, fill: opts.length <= 4, err: err }"></ng-container>
          }
          @case ('image_select') {
            <ng-container *ngTemplateOutlet="ndSegTpl; context: { $implicit: opts, fill: opts.length <= 4, err: err }"></ng-container>
          }
          @case ('radio') {
            <ng-container *ngTemplateOutlet="ndSegTpl; context: { $implicit: opts, fill: opts.length <= 4, err: err }"></ng-container>
          }
          @case ('yesno') {
            <ng-container *ngTemplateOutlet="ndSegTpl; context: { $implicit: yesNoOptions(), fill: true, err: err }"></ng-container>
          }
          @case ('yes_no_na') {
            <ng-container *ngTemplateOutlet="ndSegTpl; context: { $implicit: yesNoNaOptions, fill: true, err: err }"></ng-container>
          }
          @case ('multi_button_select') {
            <div class="pf-di-chips" role="group" [attr.aria-labelledby]="inputId + '-l'">
              @for (o of opts; track o.value; let first = $first) {
                <button type="button" class="nd-chip pf-di-chip" [attr.data-pf-stop]="first ? '' : null"
                        [attr.aria-pressed]="isSelected(o.value)" (click)="toggleMulti(o.value)">{{ o.label }}</button>
              }
            </div>
          }
          @case ('multiselect') {
            <div class="pf-di-chips" role="group" [attr.aria-labelledby]="inputId + '-l'">
              @for (o of opts; track o.value; let first = $first) {
                <button type="button" class="nd-chip pf-di-chip" [attr.data-pf-stop]="first ? '' : null"
                        [attr.aria-pressed]="isSelected(o.value)"
                        [title]="o.sublabel ?? o.label" (click)="toggleMulti(o.value)">{{ o.label }}</button>
              } @empty {
                <p class="nd-field__hint">No options available.</p>
              }
            </div>
          }
          @case ('scan') {
            <input [id]="inputId" data-pf-stop type="text" class="nd-input nd-num" placeholder="Scan or type barcode"
                   [class.nd-input--error]="!!err" [ngModel]="value" (ngModelChange)="emit($event)" />
          }
          @default {
            <!-- checkbox / toggle: a slate switch with its label beside it. -->
            <button type="button" data-pf-stop class="nd-toggle pf-di-switch" role="switch" [attr.aria-checked]="!!value"
                    (click)="emit(!value)">
              <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>
              <span class="pf-di-switch__t">
                {{ t === 'checkbox' ? (field.placeholder ?? field.title) : field.title }}
                @if (field.required) {
                  <span class="nd-dot-unpriced pf-di-req" role="img" aria-label="required" title="Required"></span>
                }
              </span>
            </button>
          }
        }

        @if (err) {
          <p class="pf-di-err" [id]="inputId + '-e'" role="alert">{{ err }}</p>
        } @else if (field.helperText && t !== 'checkbox') {
          <p class="nd-field__hint">{{ field.helperText }}</p>
        }
      </div>
    </ng-template>

    <ng-template #ndNumTpl let-err="err">
      <input [id]="inputId" data-pf-stop type="number" class="nd-input nd-num" [step]="'any'" [placeholder]="field.placeholder ?? ''"
             [class.nd-input--error]="!!err" [attr.aria-invalid]="err ? true : null"
             [ngModel]="value" (ngModelChange)="emit($event === null ? null : $event)" />
    </ng-template>

    <!-- One-of-n: a neutral segmented RADIO GROUP. Keyboard: ←/→ (↑/↓)
         move + select, Home / End, and a letter picks the option starting
         with it (M → Male; again → the next "M…"). Roving tabindex: the
         checked option (or the first) is the one Tab stop. fill → equal
         segments across the column (2–4 choices). -->
    <ng-template #ndSegTpl let-list let-fill="fill" let-err="err">
      <div class="nd-seg pf-di-seg" [class.pf-di-seg--fill]="fill" [class.pf-di-seg--error]="!!err"
           role="radiogroup" [attr.aria-labelledby]="inputId + '-l'" [attr.aria-required]="field.required || null"
           [attr.aria-invalid]="err ? true : null" [attr.aria-describedby]="err ? inputId + '-e' : null"
           (keydown)="onSegKey($event, list)">
        @for (o of list; track o.value; let i = $index) {
          <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="value === o.value"
                  [attr.tabindex]="segStop(list, i) ? 0 : -1" [attr.data-pf-stop]="segStop(list, i) ? '' : null"
                  (click)="emit(o.value)">{{ o.label }}</button>
        }
      </div>
    </ng-template>

    <ng-template #classicTpl>
    @let type = field.type;
    @let norm = normalisedOptions();
    <div class="flex flex-col gap-1.5">
      <label class="pf-label">
        {{ field.title }}
        @if (field.required) { <span class="text-red-500">*</span> }
        @if (field.unit) { <span class="text-slate-400 font-normal">({{ field.unit }})</span> }
      </label>

      @switch (type) {
        @case ('text') {
          @if (identityFormat(); as fmt) {
            <!-- ABHA / Aadhaar: digits only, auto-grouped as you type (like a
                 credit-card field); the model stores the raw digits. -->
            <input #dinp type="text" inputmode="numeric" class="pf-input"
                   [attr.maxlength]="fmt.max" [placeholder]="fmt.placeholder"
                   [ngModel]="displayIdentity(value)" (ngModelChange)="emitIdentity(dinp, $event, fmt)" />
          } @else if (digitLimit(); as lim) {
            <!-- Other identity numbers (e.g. Aadhaar last-4): digits only, capped. -->
            <input #dinp type="text" inputmode="numeric" pattern="[0-9]*" class="pf-input"
                   [attr.maxlength]="lim" [placeholder]="field.placeholder ?? ''"
                   [ngModel]="value" (ngModelChange)="emitDigits(dinp, $event, lim)" />
          } @else {
            <input type="text" class="pf-input" [placeholder]="field.placeholder ?? ''"
                   [ngModel]="value" (ngModelChange)="emit($event)" />
          }
        }
        @case ('email') {
          <input type="email" class="pf-input" [ngModel]="value" (ngModelChange)="emit($event)" />
        }
        @case ('phone') {
          <div class="flex flex-col gap-1">
            <!-- One box: country code and number share a single input shell. -->
            <div class="pf-phone" [class.pf-phone--err]="phoneError() != null">
              <pf-select
                class="pf-phone__cc"
                [options]="countrySelectOptions"
                [value]="selectedCountryCode()"
                (valueChange)="onCountryCodeChange($any($event))"
              ></pf-select>
              <span class="pf-phone__sep" aria-hidden="true"></span>
              <input
                #phInC
                type="tel"
                class="pf-phone__num"
                [attr.maxlength]="activePhoneRule().maxDigits"
                [placeholder]="activePhoneRule().placeholder"
                [ngModel]="phoneDigits()"
                (ngModelChange)="onPhoneDigitsChange($event, phInC)"
              />
            </div>
            @if (phoneError(); as err) {
              <p class="text-xs text-red-500 font-medium">{{ err }}</p>
            }
          </div>
        }
        @case ('number') { <ng-container *ngTemplateOutlet="numericTpl"></ng-container> }
        @case ('numeric') { <ng-container *ngTemplateOutlet="numericTpl"></ng-container> }

        @case ('numeric_with_range') {
          <ng-container *ngTemplateOutlet="numericTpl"></ng-container>
          <ng-container *ngTemplateOutlet="flagLineTpl"></ng-container>
        }

        @case ('critical_numeric') {
          <ng-container *ngTemplateOutlet="numericTpl"></ng-container>
          <ng-container *ngTemplateOutlet="flagLineTpl"></ng-container>
          @if (isCritical()) {
            <div class="mt-1 rounded-md border-l-4 border-red-500 bg-red-50 px-3 py-1.5 text-xs text-red-700">
              ⚠ Critical value — submitting will flag this result and notify the referring doctor.
            </div>
          }
        }

        @case ('textarea') {
          <textarea class="pf-input min-h-[88px]"
                    [placeholder]="field.placeholder ?? ''"
                    [ngModel]="value" (ngModelChange)="emit($event)"></textarea>
        }
        @case ('date') {
          @if (isDobField()) {
            <!-- Hybrid DOB / Age: enter an exact date OR just an age — both
                 sit together (no step switch). Age is anchored to today so it
                 increments over time; either way the field's value is a DOB.
                 Infants: flip the unit to Months (auto-selected under 2 yrs). -->
            <div class="flex items-center gap-2 flex-wrap">
              <span style="flex:1 1 150px"><pf-nd-date [label]="field.title" [value]="asDateStr(value)" [max]="todayIso"
                          (valueChange)="emitDob($event, false)"></pf-nd-date></span>
              <span class="text-xs" style="color: var(--text-tertiary);">or</span>
              <input type="number" class="pf-input" style="flex:0 0 84px" min="0"
                     [attr.max]="ageLimit()"
                     placeholder="Age"
                     [ngModel]="hybridAgeDisplay()" (ngModelChange)="onHybridAge($event)" />
              <div class="pf-age-unit" role="group" aria-label="Age unit">
                <button type="button" class="pf-age-unit__btn"
                        [class.pf-age-unit__btn--on]="ageUnit() === 'years'"
                        (click)="setAgeUnit('years')">Yrs</button>
                <button type="button" class="pf-age-unit__btn"
                        [class.pf-age-unit__btn--on]="ageUnit() === 'months'"
                        (click)="setAgeUnit('months')">Mo</button>
                <button type="button" class="pf-age-unit__btn"
                        [class.pf-age-unit__btn--on]="ageUnit() === 'days'"
                        (click)="setAgeUnit('days')">Days</button>
              </div>
            </div>
            @if (dobError(); as ageErr) {
              <p class="text-xs text-red-500 font-medium">{{ ageErr }}</p>
            }
            <p class="text-[11px]" style="color: var(--text-tertiary);">
              Type either — an entered age stays current automatically.
            </p>
          } @else {
            <pf-nd-date [label]="field.title" [value]="asDateStr(value)" (valueChange)="emit($event)"></pf-nd-date>
          }
        }
        @case ('datetime') {
          <pf-nd-datetime [label]="field.title" [value]="asDateStr(value)" (valueChange)="emit($event)"></pf-nd-datetime>
        }
        @case ('time') {
          <pf-nd-time [label]="field.title" [value]="asDateStr(value)" (valueChange)="emit($event)"></pf-nd-time>
        }

        @case ('select') {
          <pf-select
            [options]="selectOptions()"
            [value]="value"
            [placeholder]="field.placeholder ?? '— Select —'"
            (valueChange)="emit($event)"></pf-select>
        }

        @case ('multiselect') {
          <div class="pf-tile-grid">
            @for (o of norm; track o.value) {
              <button type="button"
                      class="pf-tile-opt"
                      [class.pf-tile-opt--on]="isSelected(o.value)"
                      (click)="toggleMulti(o.value)">
                <span class="pf-tile-opt__label">{{ o.label }}</span>
                @if (o.sublabel) {
                  <span class="pf-tile-opt__sub">{{ o.sublabel }}</span>
                }
                @if (isSelected(o.value)) {
                  <svg class="pf-tile-opt__check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                }
              </button>
            } @empty {
              <p class="pf-tile-empty">No options available.</p>
            }
          </div>
        }

        @case ('radio') {
          <div class="flex flex-col gap-1.5">
            @for (o of norm; track o.value) {
              <label class="pf-radio-row">
                <input type="radio" class="pf-radio" [name]="field.name" [value]="o.value"
                       [ngModel]="value" (ngModelChange)="emit($event)" />
                <span class="pf-radio-label">{{ o.label }}</span>
              </label>
            }
          </div>
        }

        @case ('yes_no_na') {
          <div class="flex gap-2">
            @for (o of ['Yes','No','N/A']; track o) {
              <button type="button"
                      class="px-3 py-1 rounded-lg border text-sm transition"
                      [class.bg-[var(--color-primary)]]="value === o"
                      [class.text-white]="value === o"
                      [class.border-slate-300]="value !== o"
                      (click)="emit(o)">{{ o }}</button>
            }
          </div>
        }

        @case ('yesno') {
          <div class="flex gap-2">
            @for (o of yesNoOptions(); track o.value) {
              <button type="button"
                      class="px-3 py-1 rounded-lg border text-sm transition"
                      [class.bg-[var(--color-primary)]]="value === o.value"
                      [class.text-white]="value === o.value"
                      [class.border-slate-300]="value !== o.value"
                      (click)="emit(o.value)">{{ o.label }}</button>
            }
          </div>
        }

        @case ('toggle') {
          <button type="button"
                  class="inline-flex h-6 w-11 items-center rounded-full border transition"
                  [class.bg-[var(--color-success)]]="!!value"
                  [class.bg-slate-200]="!value"
                  (click)="emit(!value)">
            <span class="inline-block h-5 w-5 transform rounded-full bg-white shadow transition"
                  [class.translate-x-5]="!!value"
                  [class.translate-x-0.5]="!value"></span>
          </button>
        }

        @case ('button_select') {
          <div class="pf-bsel">
            @for (o of norm; track o.value) {
              <button type="button"
                      class="pf-bsel__item"
                      [class.pf-bsel__item--on]="value === o.value"
                      (click)="emit(o.value)">{{ o.label }}</button>
            }
          </div>
        }

        @case ('multi_button_select') {
          <div class="pf-bsel">
            @for (o of norm; track o.value) {
              <button type="button"
                      class="pf-bsel__item"
                      [class.pf-bsel__item--on]="isSelected(o.value)"
                      (click)="toggleMulti(o.value)">{{ o.label }}</button>
            }
          </div>
        }

        @case ('image_select') {
          <div class="pf-bsel">
            @for (o of norm; track o.value) {
              <button type="button"
                      class="pf-bsel__item"
                      [class.pf-bsel__item--on]="value === o.value"
                      (click)="emit(o.value)">{{ o.label }}</button>
            }
          </div>
        }

        @case ('checkbox') {
          <label class="inline-flex items-center gap-2">
            <input type="checkbox" [ngModel]="!!value" (ngModelChange)="emit($event)" />
            <span class="text-sm">{{ field.placeholder ?? field.title }}</span>
          </label>
        }

        @case ('scan') {
          <input type="text" class="pf-input font-mono" placeholder="Scan or type barcode"
                 autofocus
                 [ngModel]="value" (ngModelChange)="emit($event)" />
        }

        @case ('yesNoNa') {
          <div class="flex gap-2">
            @for (o of ['Yes','No','N/A']; track o) {
              <button type="button"
                      class="px-3 py-1 rounded-lg border text-sm transition"
                      [class.bg-[var(--color-primary)]]="value === o"
                      [class.text-white]="value === o"
                      [class.border-slate-300]="value !== o"
                      (click)="emit(o)">{{ o }}</button>
            }
          </div>
        }

        @case ('buttonSelect') {
          <div class="flex flex-wrap gap-2">
            @for (o of norm; track o.value) {
              <button type="button"
                      class="rounded-lg border px-3 py-1.5 text-sm transition"
                      [class.bg-[var(--color-primary)]]="value === o.value"
                      [class.text-white]="value === o.value"
                      [class.border-slate-300]="value !== o.value"
                      (click)="emit(o.value)">{{ o.label }}</button>
            }
          </div>
        }

        @case ('imageSelect') {
          <div class="flex flex-wrap gap-2">
            @for (o of norm; track o.value) {
              <button type="button"
                      class="rounded-lg border px-3 py-1.5 text-sm transition"
                      [class.bg-[var(--color-primary)]]="value === o.value"
                      [class.text-white]="value === o.value"
                      [class.border-slate-300]="value !== o.value"
                      (click)="emit(o.value)">{{ o.label }}</button>
            }
          </div>
        }

        @case ('voice-text') {
          <!-- Speech-to-text is not wired in DynamicInput yet; degrade to a
               plain textarea so workflows using voice-text still capture
               content. -->
          <textarea class="pf-input min-h-[88px]"
                    [placeholder]="'Dictate or type…'"
                    [ngModel]="value" (ngModelChange)="emit($event)"></textarea>
        }

        @case ('duration') { <ng-container *ngTemplateOutlet="durationTpl; context: { $implicit: ['days','weeks','months','years'] }"></ng-container> }
        @case ('duration-time') { <ng-container *ngTemplateOutlet="durationTpl; context: { $implicit: ['seconds','minutes','hours','days'] }"></ng-container> }
        @case ('duration-period') {
          <div class="flex flex-wrap gap-2">
            @for (p of ['Morning','Afternoon','Evening','Night']; track p) {
              <button type="button"
                      class="rounded-lg border px-3 py-1.5 text-sm transition"
                      [class.bg-[var(--color-primary)]]="value === p.toLowerCase()"
                      [class.text-white]="value === p.toLowerCase()"
                      [class.border-slate-300]="value !== p.toLowerCase()"
                      (click)="emit(p.toLowerCase())">{{ p }}</button>
            }
          </div>
        }

        @case ('size') {
          <div class="flex flex-wrap items-center gap-2">
            @for (i of [0,1]; track i) {
              <input type="number" class="pf-input w-24"
                     [placeholder]="'—'"
                     [ngModel]="sizeValue(i)"
                     (ngModelChange)="setSize(i, $event)" />
            }
            <pf-select
              [options]="sizeUnitOptions"
              [value]="sizeUnit()"
              (valueChange)="setSizeUnit($any($event))"></pf-select>
          </div>
        }

        @case ('measure') {
          <div class="flex items-center gap-3">
            <input type="range" class="pf-range flex-1" min="0" max="100" step="1"
                   [ngModel]="measureVal()"
                   (ngModelChange)="setMeasure($event)" />
            <span class="text-sm font-mono min-w-[3rem] text-right">{{ measureVal() ?? '—' }}</span>
            @if (field.unit) { <span class="text-xs text-slate-400">{{ field.unit }}</span> }
          </div>
        }

        @case ('file-upload') {
          <label class="inline-flex items-center gap-2 px-3 py-2 border rounded-md cursor-pointer text-sm text-slate-700 hover:bg-slate-50">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <path d="M17 8l-5-5-5 5"/>
              <path d="M12 3v12"/>
            </svg>
            {{ fileName() ? 'Replace' : 'Choose file' }}
            <input type="file" hidden (change)="onFile($any($event.target).files)" />
          </label>
          @if (fileName()) {
            <span class="text-xs text-slate-500">{{ fileName() }}</span>
          }
        }

        @case ('imageGallery') {
          <div class="flex flex-col gap-2">
            <label class="inline-flex items-center gap-2 px-3 py-2 border rounded-md cursor-pointer text-sm text-slate-700 hover:bg-slate-50 w-fit">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="5" width="18" height="14" rx="2"/>
                <circle cx="9" cy="11" r="2"/>
                <path d="m21 15-4-4-7 7"/>
              </svg>
              Add images
              <input type="file" multiple accept="image/*" hidden (change)="onGallery($any($event.target).files)" />
            </label>
            @if (galleryItems().length > 0) {
              <div class="grid grid-cols-4 gap-1.5">
                @for (src of galleryItems(); track src; let i = $index) {
                  <span class="relative block rounded overflow-hidden aspect-square bg-slate-100">
                    <img [src]="src" alt="" class="w-full h-full object-cover" />
                    <button type="button" class="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/50 text-white text-xs leading-none"
                            (click)="removeGallery(i)">×</button>
                  </span>
                }
              </div>
            }
          </div>
        }

        @case ('signature') { <ng-container *ngTemplateOutlet="canvasTpl"></ng-container> }
        @case ('scribblePad') { <ng-container *ngTemplateOutlet="canvasTpl"></ng-container> }

        @case ('section-header') {
          <h4 class="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 border-t border-dashed border-slate-200 pt-2">
            {{ field.title }}
          </h4>
        }
        @case ('info-text') {
          <p class="text-xs text-slate-500 italic">{{ field.placeholder || field.title }}</p>
        }

        @case ('imageInfo') { <ng-container *ngTemplateOutlet="stubTpl"></ng-container> }
        @case ('multiTextbox') { <ng-container *ngTemplateOutlet="stubTpl"></ng-container> }
        @case ('table') { <ng-container *ngTemplateOutlet="stubTpl"></ng-container> }
        @case ('recursive') { <ng-container *ngTemplateOutlet="stubTpl"></ng-container> }
        @case ('recursivePages') { <ng-container *ngTemplateOutlet="stubTpl"></ng-container> }

        @default {
          <div class="rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Input type <code>{{ type }}</code> not yet implemented.
          </div>
        }
      }

      @if (field.helperText && type !== 'checkbox') {
        <p class="text-[11px] text-slate-500">{{ field.helperText }}</p>
      }
    </div>
    </ng-template>

    <ng-template #numericTpl>
      <input type="number" class="pf-input"
             [step]="'any'"
             [placeholder]="field.placeholder ?? ''"
             [ngModel]="value"
             (ngModelChange)="emit($event === null ? null : $event)" />
    </ng-template>

    <ng-template #flagLineTpl>
      @if (rangeLabel(); as r) {
        <p class="text-xs" [class]="flagClass()">{{ r }} · {{ flagLabel() }}</p>
      } @else if (flag() !== 'none') {
        <p class="text-xs" [class]="flagClass()">{{ flagLabel() }}</p>
      }
    </ng-template>

    <!-- Shared compound input for duration / duration-time — number + unit
         select with the unit list passed in via template context. -->
    <ng-template #durationTpl let-units>
      <div class="flex gap-2">
        <input type="number" class="pf-input flex-1 min-w-0"
               [placeholder]="'0'"
               [ngModel]="durationValue()"
               (ngModelChange)="setDuration({ value: $event })" />
        <pf-select
          [options]="unitsToOptions(units)"
          [value]="durationUnit(units[0])"
          (valueChange)="setDuration({ unit: $any($event) })"></pf-select>
      </div>
    </ng-template>

    <!-- Minimal canvas used by signature + scribblePad. Bitmap is persisted
         as a data URL on pointerup. -->
    <ng-template #canvasTpl>
      <div class="inline-flex flex-col gap-1.5">
        <canvas #pad
                width="320" height="140"
                class="border border-dashed border-slate-300 rounded-md bg-white touch-none cursor-crosshair max-w-[320px]"
                (pointerdown)="canvasDown($event, pad)"
                (pointermove)="canvasMove($event, pad)"
                (pointerup)="canvasUp($event, pad)"
                (pointerleave)="canvasUp($event, pad)"></canvas>
        <button type="button" class="self-start text-xs px-2 py-0.5 border border-slate-300 rounded"
                (click)="canvasClear(pad)">Clear</button>
      </div>
    </ng-template>

    <ng-template #stubTpl>
      <div class="rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500 italic">
        Preview only — interactive editor coming in a future release.
      </div>
    </ng-template>
  `,
  styles: [`
    /* Custom radio + range thumb. Native browser controls deform on
       narrow viewports (radios get squashed into ovals when a flex parent
       scales them, range thumbs render flat-oval on Android Chrome). We
       use appearance:none + explicit, square dimensions so the circles
       stay perfect regardless of viewport. */
    .pf-radio-row {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      color: var(--text-secondary);
      cursor: pointer;
      user-select: none;
      width: fit-content;       /* never stretch — even if a flex parent tries */
      max-width: 100%;
    }

    /* Button-select / multi / image-select: pill items must NEVER stretch
       to fill the row (that's where they go oval). Container wraps; items
       size to content within a min/max range. On mobile we cap to 2 per
       row so labels read at a glance instead of becoming long pills. */
    .pf-bsel {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      width: 100%;
    }
    .pf-bsel__item {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: auto;
      min-width: 80px;
      max-width: 220px;
      flex-shrink: 0;
      padding: 6px 14px;
      border-radius: 8px;
      border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.12));
      background: var(--glass-bg, rgba(255, 255, 255, 0.04));
      color: var(--text-primary, #e5e7eb);
      font-size: 13.5px;
      font-weight: 500;
      cursor: pointer;
      transition: background 160ms ease, border-color 160ms ease, color 160ms ease;
    }
    .pf-bsel__item:hover {
      background: var(--glass-bg-hover, rgba(255, 255, 255, 0.08));
      border-color: var(--text-secondary, rgba(255, 255, 255, 0.24));
    }
    .pf-bsel__item--on {
      background: var(--color-primary, #a855f7);
      border-color: var(--color-primary, #a855f7);
      color: #fff;
    }
    .pf-bsel__item--on:hover {
      background: var(--color-primary, #a855f7);
      border-color: var(--color-primary, #a855f7);
    }
    @media (max-width: 640px) {
      /* Mobile: exactly 2 per row, never a single oval pill spanning the screen. */
      .pf-bsel__item {
        flex-basis: calc(50% - 4px);
        min-width: 0;
        max-width: calc(50% - 4px);
      }
    }
    /* One control height: every box a dynamic form renders — text input,
       select trigger, phone shell, age toggle — is exactly 44px tall with
       the same 12px radius. Mixed native heights read as clutter. */
    :host input.pf-input { height: 44px; }
    :host ::ng-deep .pf-dd__trigger {
      height: 44px;
      border-radius: 12px;
    }

    /* Phone: country code + number as ONE input shell. The embedded
       pf-select loses its own chrome; the shell carries border/focus. */
    .pf-phone {
      display: flex;
      align-items: center;
      width: 100%;
      height: 44px;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      border-radius: 12px;
      transition: border-color 0.18s ease, box-shadow 0.18s ease;
    }
    .pf-phone:focus-within {
      border-color: var(--input-border-focus);
      box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.18);
    }
    .pf-phone--err { border-color: #ef4444; }
    .pf-phone__cc { flex: 0 0 96px; }
    .pf-phone__cc ::ng-deep .pf-dd__trigger {
      border: none;
      background: transparent;
      box-shadow: none;
      height: 42px;
      padding: 0 6px 0 12px;
    }
    .pf-phone__cc ::ng-deep .pf-dd__trigger:hover,
    .pf-phone__cc ::ng-deep .pf-dd__trigger:focus,
    .pf-phone__cc ::ng-deep .pf-dd--open .pf-dd__trigger {
      border: none;
      background: transparent;
      box-shadow: none;
    }
    .pf-phone__sep {
      width: 1px;
      align-self: stretch;
      margin: 8px 0;
      background: var(--input-border);
      flex-shrink: 0;
    }
    .pf-phone__num {
      flex: 1;
      min-width: 0;
      height: 42px;
      border: none;
      outline: none;
      background: transparent;
      color: var(--input-text);
      font-size: 13.5px;
      font-family: inherit;
      padding: 0 12px;
    }
    .pf-phone__num::placeholder { color: var(--input-placeholder, rgba(148, 163, 184, 0.65)); }

    /* Age-unit segmented toggle (Yrs / Mo) inside the hybrid DOB field —
       same 44px control height as every other box in the row. */
    .pf-age-unit {
      display: inline-flex;
      align-items: stretch;
      height: 44px;
      flex-shrink: 0;
      border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.12));
      border-radius: 12px;
      overflow: hidden;
    }
    .pf-age-unit__btn {
      display: inline-flex;
      align-items: center;
      padding: 0 12px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary, #94a3b8);
      background: var(--glass-bg, rgba(255, 255, 255, 0.04));
      cursor: pointer;
      border: none;
      transition: background 160ms ease, color 160ms ease;
    }
    .pf-age-unit__btn + .pf-age-unit__btn {
      border-left: 1px solid var(--glass-border, rgba(255, 255, 255, 0.12));
    }
    .pf-age-unit__btn--on {
      background: var(--color-primary, #a855f7);
      color: #fff;
    }

    .pf-radio {
      appearance: none;
      -webkit-appearance: none;
      -moz-appearance: none;
      width: 18px;
      height: 18px;
      flex: 0 0 18px;       /* never let flex squash it into an oval */
      margin: 0;
      border: 2px solid var(--border-muted, #475569);
      border-radius: 9999px;
      background: transparent;
      display: inline-grid;
      place-items: center;
      cursor: pointer;
      transition: border-color 160ms ease, background 160ms ease;
    }
    .pf-radio:hover { border-color: var(--text-secondary, #cbd5e1); }
    .pf-radio:checked {
      border-color: #a855f7;
      background: radial-gradient(circle, #a855f7 45%, transparent 47%);
      box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.18);
    }
    .pf-radio:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.35);
    }
    .pf-radio-label { color: var(--text-primary, #e5e7eb); }

    /* Range slider — flatten the track, lock the thumb to a circle. */
    .pf-range {
      appearance: none;
      -webkit-appearance: none;
      height: 4px;
      background: var(--glass-bg, rgba(255,255,255,0.08));
      border-radius: 9999px;
      outline: none;
    }
    .pf-range::-webkit-slider-thumb {
      appearance: none;
      -webkit-appearance: none;
      width: 18px;
      height: 18px;
      border-radius: 9999px;
      background: var(--gradient-primary, #a855f7);
      box-shadow: 0 4px 10px rgba(124, 58, 237, 0.45);
      cursor: pointer;
      border: none;
    }
    .pf-range::-moz-range-thumb {
      width: 18px;
      height: 18px;
      border-radius: 9999px;
      background: #a855f7;
      box-shadow: 0 4px 10px rgba(124, 58, 237, 0.45);
      cursor: pointer;
      border: none;
    }

    /* ── NEW DESIGN ([nd]) — kit fields, one 40px height (44px phones). ── */
    .pf-di-lbl { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .pf-di-unit { font-weight: 400; color: var(--text-tertiary); }
    .pf-di-err { margin: 0; font-size: 12px; line-height: 1.4; color: var(--red-text, #dc2626); }
    .pf-di-area { min-height: 88px; }
    /* The classic 44px/12px trigger rule above must not win in nd. */
    :host .pf-di-nd ::ng-deep pf-select .pf-dd:not(.pf-dd--sm) .pf-dd__trigger {
      height: 40px; border-radius: var(--nd-radius-sm);
      border-color: color-mix(in srgb, var(--text-primary) 22%, transparent);
      background: color-mix(in srgb, var(--text-primary) 4%, var(--nd-card-bg));
    }
    /* Phone: country code + number share ONE kit input shell. */
    .pf-di-phone {
      display: flex; align-items: center; width: 100%; min-height: 40px; box-sizing: border-box;
      border-radius: var(--nd-radius-sm);
      border: 1px solid color-mix(in srgb, var(--text-primary) 22%, transparent);
      background: color-mix(in srgb, var(--text-primary) 4%, var(--nd-card-bg));
      transition: border-color var(--nd-dur-fast) ease, box-shadow var(--nd-dur-fast) ease;
    }
    .pf-di-phone:hover { border-color: color-mix(in srgb, var(--text-primary) 38%, transparent); }
    .pf-di-phone:focus-within {
      border-color: var(--color-violet-600, #7c3aed);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #7c3aed) 16%, transparent);
    }
    .pf-di-phone--err, .pf-di-phone--err:hover, .pf-di-phone--err:focus-within { border-color: var(--red-border, #ef4444); }
    .pf-di-phone--err:focus-within { box-shadow: 0 0 0 3px color-mix(in srgb, var(--red-border, #ef4444) 18%, transparent); }
    .pf-di-phone__cc { flex: 0 0 92px; min-width: 0; }
    :host .pf-di-phone__cc ::ng-deep .pf-dd__trigger {
      height: 38px !important; border: 0 !important; background: transparent !important;
      box-shadow: none !important; padding: 0 6px 0 12px;
    }
    .pf-di-phone__sep { flex: none; width: 1px; align-self: stretch; margin: 8px 0; background: var(--nd-line); }
    .pf-di-phone__num {
      flex: 1 1 auto; min-width: 0; height: 38px; padding: 0 12px; border: 0; outline: 0;
      background: transparent; color: var(--text-primary);
      font: inherit; font-size: 13.5px; font-weight: 500; font-variant-numeric: tabular-nums;
    }
    .pf-di-phone__num::placeholder { color: var(--text-muted, #9ca3af); font-weight: 400; }
    /* DOB ⇄ age on one row. */
    .pf-di-dob { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .pf-di-dob__date { flex: 1 1 150px; width: auto; }
    .pf-di-dob__age { flex: 0 0 84px; width: 84px; }
    /* Typed date + a calendar button over a hidden native picker. */
    .pf-di-date { position: relative; display: block; min-width: 0; }
    .pf-di-date__in { padding-right: 40px; }
    .pf-di-date__pick {
      position: absolute; top: 50%; right: 4px; transform: translateY(-50%);
      display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;
      border: 0; border-radius: 8px; background: transparent; color: var(--text-tertiary); cursor: pointer;
    }
    .pf-di-date__pick:hover { color: var(--text-primary); background: var(--nd-chip-bg); }
    .pf-di-date__native { position: absolute; right: 0; bottom: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; border: 0; padding: 0; }
    .pf-di-dob__or { flex: none; font-size: 12px; color: var(--text-tertiary); }
    /* Segmented choices: a 40px neutral control; wraps rather than clips. */
    .pf-di-seg { box-sizing: border-box; min-height: 40px; max-width: 100%; flex-wrap: wrap; align-items: stretch; }
    .pf-di-seg .nd-seg__item { height: auto; min-height: 34px; min-width: 56px; padding: 0 14px; font-size: 13px; }
    /* Pills (5+ options, e.g. Title) keep their natural width on web. */
    .pf-di-seg:not(.pf-di-seg--fill) { align-self: flex-start; }
    .pf-di-seg--fill { display: flex; width: 100%; }
    .pf-di-seg--fill .nd-seg__item { flex: 1 1 0; }
    .pf-di-seg--unit { flex: none; }
    .pf-di-seg--unit .nd-seg__item { min-width: 44px; padding: 0 10px; }
    /* Field-level errors (new design): the control is outlined in error red. */
    .pf-di-seg--error { border-color: var(--red-border, #ef4444); }
    :host .pf-di-nd ::ng-deep pf-select.pf-di-select--error .pf-dd__trigger { border-color: var(--red-border, #ef4444) !important; }
    .pf-di-seg .nd-seg__item:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 1px; }
    .pf-di-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .pf-di-chip { height: 34px; font-size: 13px; }
    .pf-di-switch { min-height: 40px; font-size: 13.5px; white-space: normal; text-align: left; }
    .pf-di-switch__t { display: inline-flex; align-items: center; gap: 6px; }
    @media (max-width: 640px) {
      .pf-di-phone { min-height: 44px; }
      .pf-di-phone__num { height: 42px; font-size: 16px; }
      :host .pf-di-phone__cc ::ng-deep .pf-dd__trigger { height: 42px !important; }
      :host .pf-di-nd ::ng-deep pf-select .pf-dd:not(.pf-dd--sm) .pf-dd__trigger { height: 44px; }
      .pf-di-seg { min-height: 44px; }
      .pf-di-seg .nd-seg__item { min-height: 38px; }
      /* 5+ one-tap options (Title): balanced rows of three, full width. */
      .pf-di-seg:not(.pf-di-seg--fill):not(.pf-di-seg--unit) { display: grid; grid-template-columns: repeat(3, 1fr); width: 100%; }
      .pf-di-dob__date { flex-basis: 100%; }
      .pf-di-dob__age { flex: 1 1 auto; width: auto; }
      .pf-di-switch { min-height: 44px; }
    }
  `]
})
export class DynamicInputComponent {
  private static _seq = 0;
  /** Stable id so the kit label's for= points at the control (getByLabel works). */
  readonly inputId = `pf-di-${++DynamicInputComponent._seq}`;
  /** New-design markup (ND-PATTERN §14). Off by default: every existing host
   *  (result entry, workflow preview, …) keeps the classic look. */
  @Input() nd = false;
  private static readonly ND_TYPES = new Set([
    'text', 'email', 'phone', 'number', 'numeric', 'textarea', 'date', 'datetime', 'time',
    'select', 'button_select', 'image_select', 'radio', 'yesno', 'yes_no_na',
    'multi_button_select', 'multiselect', 'scan', 'checkbox', 'toggle',
  ]);
  /** nd markup only for the types it covers; anything exotic stays classic. */
  ndOn(): boolean {
    return this.nd && !!this._field() && DynamicInputComponent.ND_TYPES.has(this._field()!.type);
  }
  /** No flag emoji in the new design: the code, with the country as the hint. */
  readonly countrySelectOptionsNd: PfSelectOption<string>[] = COUNTRY_PHONE_RULES.map(r => ({
    value: r.code, label: r.code, hint: r.name,
  }));
  readonly yesNoNaOptions: FieldOption[] = ['Yes', 'No', 'N/A'].map(v => ({ value: v, label: v }));
  /** New design: a field-level error from the host's validation (outlined
   *  control + message under it). */
  @Input() error: string | null = null;
  /** New design: the tenant's dialling code — the phone field's default
   *  until a value says otherwise. */
  @Input() set defaultCountryCode(code: string | null) {
    if (!code || !COUNTRY_PHONE_RULES.some(r => r.code === code)) return;
    const v = this._value();
    if (v == null || v === '') this._selectedCountryCode.set(code);
  }

  /** Number fields that are really phone numbers ("Additional contact",
   *  "Alternate mobile" …) get the phone treatment in the new design: a
   *  tel input with the country code, never a number spinner. */
  isContactNumber(): boolean { return this.nd && isContactNumberField(this._field()); }
  private isPhoneLike(): boolean { return this._field()?.type === 'phone' || this.isContactNumber(); }
  /** The type the nd markup renders (contact numbers → phone). */
  ndType(): string { return this.isContactNumber() ? 'phone' : (this._field()?.type ?? ''); }

  // ── New-design DOB: typed dd/mm/yyyy, never prefilled ──────────────
  private readonly _dobTyping = signal<string | null>(null);
  private readonly _dobError = signal<string | null>(null);
  /** The DOB / age box's own error (bad date, future date, age out of range). */
  readonly dobError = this._dobError.asReadonly();
  /** A value this input could NOT turn into a field value (a half-typed or
   *  impossible DOB, an out-of-range age) — the value is emitted as null, so
   *  the host must also be told, or an optional field would submit blank. */
  @Output() localErrorChange = new EventEmitter<string | null>();
  /** DOB field only: true when the emitted DOB came from the age box. */
  @Output() dobEstimatedChange = new EventEmitter<boolean>();
  private _blocking: string | null = null;
  /** `show` = put it under the field now; a half-typed date blocks submit
   *  but is only SHOWN once the user leaves the box (or submits). */
  private setLocalError(msg: string | null, show = true): void {
    if (show) this._dobError.set(msg);
    if (this._blocking === msg) return;
    this._blocking = msg;
    this.localErrorChange.emit(msg);
  }
  /** The age as typed (kept on screen while it's invalid); null → derived. */
  private readonly _ageText = signal<string | null>(null);
  readonly ageText = this._ageText.asReadonly();
  /** What the box shows: the text being typed, else the value as dd/mm/yyyy
   *  (EMPTY when there is no value — nothing is ever defaulted). */
  readonly dobText = computed(() => this._dobTyping() ?? DynamicInputComponent.isoToDmy(this._value()));
  private static isoToDmy(v: unknown): string {
    const m = String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  }
  onDobInput(el: HTMLInputElement): void {
    const d = el.value.replace(/\D/g, '').slice(0, 8);
    const t = d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
    if (el.value !== t) el.value = t;
    this._dobTyping.set(t);
    this._ageText.set(null);
    if (d.length < 8) {
      // Still typing: hide any old message; a partial date blocks submit and
      // is shown on blur. Cleared box = no error.
      this._dobError.set(null);
      this.setLocalError(d.length > 0 ? 'Enter the full date (dd/mm/yyyy)' : null, false);
      if (this._value()) this.emit(null);
      return;
    }
    const day = +d.slice(0, 2), mon = +d.slice(2, 4), yr = +d.slice(4);
    const iso = `${d.slice(4)}-${d.slice(2, 4)}-${d.slice(0, 2)}`;
    const dt = new Date(yr, mon - 1, day);
    const real = yr >= 1900 && dt.getFullYear() === yr && dt.getMonth() === mon - 1 && dt.getDate() === day;
    if (!real) { this.setLocalError('Not a valid date (dd/mm/yyyy)'); this.emit(null); return; }
    if (iso > this.todayIso) { this.setLocalError("Date of birth can't be in the future"); this.emit(null); return; }
    this.setLocalError(null);
    this.emitDob(iso, false);
  }
  onDobBlur(): void {
    // A half-typed date is an error once the user leaves the box.
    const t = this._dobTyping();
    if (t && t.replace(/\D/g, '').length < 8 && this._blocking) this._dobError.set(this._blocking);
    // Keep a half-typed date on screen only while its error explains it.
    if (!this._dobError()) this._dobTyping.set(null);
  }
  onDobPicked(v: string): void {
    this._dobTyping.set(null);
    this._ageText.set(null);
    this.setLocalError(null);
    this.emitDob(v || null, false);
  }
  openDobPicker(el: HTMLInputElement): void {
    try { (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { el.click(); }
  }
  /** Age as a numeric TEXT box (no spinner): digits only, capped at the
   *  unit's width; an out-of-range age shows an error (never silently kept). */
  onAgeText(el: HTMLInputElement): void {
    const d = el.value.replace(/\D/g, '').slice(0, this.ageMaxLength());
    if (el.value !== d) el.value = d;
    this._dobTyping.set(null);
    this._ageText.set(d === '' ? null : d);
    this.onHybridAge(d === '' ? null : Number(d));
  }
  onAgeBlur(): void {
    // Keep an invalid age on screen (its error explains it); else show the
    // age derived from the DOB.
    if (!this._dobError()) this._ageText.set(null);
  }
  /** Max age in the active unit, and the box's character cap. */
  ageLimit(): number { return AGE_LIMITS[this.ageUnit()]; }
  ageMaxLength(): number { return String(this.ageLimit()).length; }

  /** Roving tabindex: the checked option is the Tab / Enter stop (the
   *  first one while nothing is checked). */
  segStop(list: FieldOption[], i: number): boolean {
    const at = list.findIndex(o => o.value === this.value);
    return at >= 0 ? at === i : i === 0;
  }

  /** Segmented keyboard: arrows / Home / End move + select; a letter picks
   *  the (next) option that starts with it — M / F / O on Sex. */
  onSegKey(e: KeyboardEvent, list: FieldOption[]): void {
    if (e.ctrlKey || e.metaKey || e.altKey || !list.length) return;
    const at = list.findIndex(o => o.value === this.value);
    let next = -1;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': next = at < 0 ? 0 : (at + 1) % list.length; break;
      case 'ArrowLeft': case 'ArrowUp': next = at < 0 ? list.length - 1 : (at - 1 + list.length) % list.length; break;
      case 'Home': next = 0; break;
      case 'End': next = list.length - 1; break;
      default:
        if (e.key.length === 1 && /[a-z0-9]/i.test(e.key)) {
          const k = e.key.toLowerCase();
          const hits = list.map((o, i) => ({ o, i }))
            .filter(x => String(x.o.label).replace(/^[^a-z0-9]+/i, '').toLowerCase().startsWith(k));
          if (!hits.length) return;
          const cur = hits.findIndex(x => x.i === at);
          next = hits[(cur + 1) % hits.length].i;
        }
    }
    if (next < 0) return;
    e.preventDefault();
    this.emit(list[next].value);
    const group = e.currentTarget as HTMLElement | null;
    setTimeout(() => group?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus());
  }

  /** Yrs / Mo / Days: arrows or Y / M / D switch the age unit. */
  onUnitKey(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    const order: AgeUnit[] = ['years', 'months', 'days'];
    const at = order.indexOf(this.ageUnit());
    let u: AgeUnit | null = null;
    if (k === 'arrowright' || k === 'arrowdown') u = order[(at + 1) % order.length];
    else if (k === 'arrowleft' || k === 'arrowup') u = order[(at + order.length - 1) % order.length];
    else if (k === 'y') u = 'years';
    else if (k === 'm') u = 'months';
    else if (k === 'd') u = 'days';
    if (!u) return;
    e.preventDefault();
    this.setAgeUnit(u);
    const group = e.currentTarget as HTMLElement | null;
    setTimeout(() => group?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  }
  private readonly _field = signal<DynamicFieldConfig | null>(null);
  private readonly _value = signal<unknown>(null);

  @Input({ required: true }) set field(v: DynamicFieldConfig) { this._field.set(v); }
  get field(): DynamicFieldConfig { return this._field()!; }

  @Input() set value(v: unknown) {
    // A DIFFERENT value from outside (ABHA prefill, edit load) replaces
    // whatever was being corrected in the DOB / age boxes.
    if (v != null && v !== '' && v !== this._value() && (this._blocking || this._dobError())) {
      this._dobTyping.set(null);
      this._ageText.set(null);
      this.setLocalError(null);
    }
    this._value.set(v);
    if (this.isPhoneLike() && typeof v === 'string' && v.trim()) {
      const matched = COUNTRY_PHONE_RULES.find(r => v.startsWith(r.code));
      if (matched && matched.code !== this._selectedCountryCode()) {
        this._selectedCountryCode.set(matched.code);
      }
    }
  }
  get value(): unknown { return this._value(); }

  @Input() context: WorkflowContext | null = null;

  @Output() valueChange = new EventEmitter<unknown>();

  emit(v: unknown) {
    this._value.set(v);
    this.valueChange.emit(v);
  }

  /** `value` is `unknown` (the field can hold any JSON shape); the kit
   * date/time/datetime inputs need a plain string or null. */
  asDateStr(v: unknown): string | null {
    return typeof v === 'string' && v ? v : null;
  }

  // ── Phone Input & Country Code Validation ─────────────────────────
  readonly countrySelectOptions: PfSelectOption<string>[] = COUNTRY_PHONE_RULES.map(r => ({
    value: r.code,
    label: `${r.flag} ${r.code}`
  }));

  private readonly _selectedCountryCode = signal<string>('+91');
  readonly selectedCountryCode = this._selectedCountryCode.asReadonly();

  readonly activePhoneRule = computed(() => getCountryPhoneRule(this._selectedCountryCode()));

  readonly phoneDigits = computed<string>(() => {
    const val = String(this._value() ?? '').trim();
    if (!val) return '';
    const currentCode = this._selectedCountryCode();
    if (val.startsWith(currentCode)) {
      return val.slice(currentCode.length).replace(/\D/g, '').slice(0, this.activePhoneRule().maxDigits);
    }
    const found = COUNTRY_PHONE_RULES.find(r => val.startsWith(r.code));
    if (found) {
      return val.slice(found.code.length).replace(/\D/g, '').slice(0, found.maxDigits);
    }
    return val.replace(/\D/g, '').slice(0, this.activePhoneRule().maxDigits);
  });

  readonly phoneError = computed<string | null>(() => {
    if (!this.isPhoneLike()) return null;
    const val = this._value();
    if (val == null || val === '') return null;
    return validatePhoneNumber(val, this._selectedCountryCode());
  });

  onCountryCodeChange(newCode: string) {
    this._selectedCountryCode.set(newCode);
    const digits = this.phoneDigits();
    if (digits) {
      this.emit(`${newCode}${digits}`);
    } else {
      this.emit('');
    }
  }

  /** Digits only, capped at the country's length — and the DOM is forced to
   *  the cleaned digits: when an extra digit doesn't change the (capped)
   *  model, ngModel wouldn't rewrite the box and the 11th digit would linger
   *  on screen, unvalidated (QA #2). */
  onPhoneDigitsChange(typed: string, el?: HTMLInputElement) {
    const rule = this.activePhoneRule();
    const cleanDigits = String(typed ?? '').replace(/\D/g, '').slice(0, rule.maxDigits);
    if (el && el.value !== cleanDigits) el.value = cleanDigits;
    const fullValue = cleanDigits ? `${rule.code}${cleanDigits}` : '';
    this.emit(fullValue);
  }

  /** Identity-number text fields → digits only with a fixed max length
   *  (ABHA = 14, Aadhaar = 12, Aadhaar last-4 = 4). null → a normal text field. */
  readonly digitLimit = computed<number | null>(() => {
    const n = (this._field()?.name ?? '').toLowerCase();
    if (n === 'aadhaar_last4' || n === 'aadhar_last4') return 4;
    if (n === 'aadhaar' || n === 'aadhar') return 12;
    if (n === 'abha_id' || n === 'abha' || n.includes('abha')) return 14;
    return null;
  });

  /** Strip non-digits, cap the length, and force the DOM value so a rejected
   *  character can't linger when it doesn't change the cleaned value. */
  emitDigits(el: HTMLInputElement, v: string, lim: number) {
    const clean = String(v ?? '').replace(/\D/g, '').slice(0, lim);
    if (el.value !== clean) el.value = clean;
    this.emit(clean);
  }

  /** Credit-card-style grouping for identity numbers: ABHA `XX-XXXX-XXXX-XXXX`,
   *  Aadhaar `XXXX XXXX XXXX`. Display is grouped; the model keeps raw digits. */
  readonly identityFormat = computed<{ groups: number[]; sep: string; max: number; placeholder: string } | null>(() => {
    const n = (this._field()?.name ?? '').toLowerCase();
    if (n === 'abha_id' || n === 'abha' || n.includes('abha'))
      return { groups: [2, 4, 4, 4], sep: '-', max: 17, placeholder: '14-1234-1234-1234' };
    if (n === 'aadhaar' || n === 'aadhar')
      return { groups: [4, 4, 4], sep: ' ', max: 14, placeholder: '1234 5678 9012' };
    return null;
  });

  private groupDigits(digits: string, groups: number[], sep: string): string {
    const parts: string[] = [];
    let i = 0;
    for (const g of groups) { if (i >= digits.length) break; parts.push(digits.slice(i, i + g)); i += g; }
    if (i < digits.length) parts.push(digits.slice(i));
    return parts.join(sep);
  }

  /** Raw stored digits → the grouped string shown in the field. */
  displayIdentity(v: unknown): string {
    const fmt = this.identityFormat();
    const digits = String(v ?? '').replace(/\D/g, '');
    return fmt ? this.groupDigits(digits, fmt.groups, fmt.sep) : digits;
  }

  /** Typed value → strip to digits, cap, re-group in the DOM, emit raw digits. */
  emitIdentity(el: HTMLInputElement, v: string, fmt: { groups: number[]; sep: string }) {
    const limit = fmt.groups.reduce((a, b) => a + b, 0);
    const clean = String(v ?? '').replace(/\D/g, '').slice(0, limit);
    const formatted = this.groupDigits(clean, fmt.groups, fmt.sep);
    if (el.value !== formatted) el.value = formatted;
    this.emit(clean);
  }

  // ── Hybrid DOB / Age ──────────────────────────────────────────────
  /** A date field that represents date-of-birth → render the DOB/Age hybrid. */
  readonly isDobField = computed(() => /(^|_)dob$|date_of_birth|birth_?date/i.test(this._field()?.name ?? ''));

  /** Today (yyyy-MM-dd) — caps the DOB picker so a future birth date can't be
   *  chosen (OPS-34). */
  readonly todayIso = labToday();   // IST (lab-clock), not UTC's date

  /** The current DOB value's calendar age — the shared patient-age helper,
   *  so the box shows exactly what every other screen shows. */
  private readonly partsFromValue = computed(() => ageParts(this._value() ? String(this._value()) : null));
  /** Age implied by the current DOB value (so the age box mirrors the date). */
  readonly ageFromValue = computed<number | null>(() => {
    const y = this.partsFromValue()?.years ?? null;
    return y == null || y > 150 ? null : y;
  });
  /** Whole months implied by the current DOB value (for the Months unit). */
  readonly monthsFromValue = computed<number | null>(() => {
    const m = this.partsFromValue()?.totalMonths ?? null;
    return m == null || m > 1800 ? null : m;
  });
  /** Whole days implied by the current DOB value (for the Days unit). */
  readonly daysFromValue = computed<number | null>(() => this.partsFromValue()?.totalDays ?? null);

  /** Age unit the user picked; null = auto (Days in the first month, Months
   *  under 2 yrs, else Years). */
  private readonly _ageUnit = signal<AgeUnit | null>(null);
  readonly ageUnit = computed<AgeUnit>(() => {
    const chosen = this._ageUnit();
    if (chosen) return chosen;
    const m = this.monthsFromValue();
    if (m === 0) return 'days';
    return m !== null && m < 24 ? 'months' : 'years';
  });

  /** Switching the unit re-reads an age still being corrected (typed 300 in
   *  Yrs → error; switch to Mo → 300 months); otherwise the box just shows
   *  the same DOB in the new unit. */
  setAgeUnit(u: AgeUnit) {
    this._ageUnit.set(u);
    const typed = this._ageText();
    if (typed != null && this._dobError()) this.onHybridAge(Number(typed));
  }

  /** The number shown in the age box, in the active unit. */
  readonly hybridAgeDisplay = computed<number | null>(() => {
    switch (this.ageUnit()) {
      case 'months': return this.monthsFromValue();
      case 'days': return this.daysFromValue();
      default: return this.ageFromValue();
    }
  });

  /** Age typed in the hybrid → synthesize a DOB anchored to today (so the age
   *  increments over time) and emit it as the field's value (a DOB). Out of
   *  range (Yrs > 150, Mo > 1199, Days > 365) → an inline error and NO value
   *  (never a silently kept stale DOB). */
  onHybridAge(raw: unknown) {
    if (raw == null || `${raw}` === '') { this.setLocalError(null); this.emit(null); return; }
    const age = Number(raw);
    const unit = this.ageUnit();
    const err = validateAge(age, unit);
    if (err) { this.setLocalError(err); this.emit(null); return; }
    this.setLocalError(null);
    this.emitDob(dobFromAge(age, unit), true); // yyyy-MM-dd (local date — no UTC shift)
  }

  /** A DOB value, plus whether it was ESTIMATED from the age box (the host
   *  sends `dobEstimated` so the server can tell a real birth date from an
   *  age-derived one). */
  emitDob(v: string | null, estimated: boolean): void {
    this.emit(v);
    if (v) this.dobEstimatedChange.emit(estimated);
  }

  /** Normalise options to `{value,label}` regardless of whether strings or objects are passed. */
  normalisedOptions = computed<FieldOption[]>(() => {
    const opts = this._field()?.options;
    if (!opts) return [];
    return opts.map(o => typeof o === 'string' ? { value: o, label: o } : o);
  });

  selectOptions = computed<PfSelectOption<unknown>[]>(() =>
    this.normalisedOptions().map(o => ({ value: o.value, label: o.label, hint: o.sublabel })));

  yesNoOptions = computed<FieldOption[]>(() => {
    const n = this.normalisedOptions();
    return n.length >= 2 ? n : [{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }];
  });

  isSelected(v: unknown): boolean {
    return Array.isArray(this._value()) && (this._value() as unknown[]).includes(v);
  }

  toggleMulti(v: unknown) {
    const arr = Array.isArray(this._value()) ? [...(this._value() as unknown[])] : [];
    const i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1); else arr.push(v);
    this.emit(arr);
  }

  // ── Composed-shape helpers ────────────────────────────
  // duration: { value: number|null, unit: string }
  durationValue(): number | null {
    const v = this._value();
    if (v && typeof v === 'object' && 'value' in (v as object)) {
      return ((v as { value: number | null }).value) ?? null;
    }
    return null;
  }
  durationUnit(fallback: string): string {
    const v = this._value();
    if (v && typeof v === 'object' && 'unit' in (v as object)) {
      return (v as { unit?: string }).unit || fallback;
    }
    return fallback;
  }
  setDuration(patch: Partial<{ value: number | null; unit: string }>) {
    const current = (this._value() ?? {}) as { value?: number | null; unit?: string };
    this.emit({ value: current.value ?? null, unit: current.unit ?? 'days', ...patch });
  }
  unitsToOptions(units: readonly string[]): PfSelectOption<string>[] {
    return units.map(u => ({ value: u, label: u }));
  }

  // size: { values: (number|null)[], unit: string }
  readonly sizeUnitOptions: PfSelectOption<string>[] = [
    { value: 'cm',    label: 'cm' },
    { value: 'mm',    label: 'mm' },
    { value: 'inch',  label: 'inch' },
    { value: 'feet',  label: 'feet' },
    { value: 'meter', label: 'meter' }
  ];
  sizeValue(i: number): number | null {
    const v = this._value() as { values?: (number | null)[] } | null;
    return v?.values?.[i] ?? null;
  }
  sizeUnit(): string {
    const v = this._value() as { unit?: string } | null;
    return v?.unit ?? 'cm';
  }
  setSize(i: number, val: number | null) {
    const current = (this._value() ?? {}) as { values?: (number | null)[]; unit?: string };
    const values = [...(current.values ?? [])];
    while (values.length <= i) values.push(null);
    values[i] = val;
    this.emit({ values, unit: current.unit ?? 'cm' });
  }
  setSizeUnit(unit: string) {
    const current = (this._value() ?? {}) as { values?: (number | null)[]; unit?: string };
    this.emit({ values: current.values ?? [], unit });
  }

  // measure: scalar number (unit is a display-only label).
  measureVal(): number | null {
    const v = this._value();
    if (typeof v === 'number') return v;
    if (v && typeof v === 'object' && 'value' in (v as object)) {
      return ((v as { value: number | null }).value) ?? null;
    }
    return null;
  }
  setMeasure(n: number | null) { this.emit(n); }

  // file-upload: { name, dataUrl }
  fileName(): string | null {
    const v = this._value() as { name?: string } | null;
    return v?.name ?? null;
  }
  onFile(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => this.emit({ name: f.name, dataUrl: String(reader.result ?? '') });
    reader.readAsDataURL(f);
  }

  // imageGallery: string[] of data URLs
  galleryItems(): string[] {
    const v = this._value();
    return Array.isArray(v) ? (v as unknown[]).map(String) : [];
  }
  onGallery(files: FileList | null) {
    if (!files || files.length === 0) return;
    const existing = this.galleryItems();
    const readers = Array.from(files).map(f => new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result ?? ''));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    }));
    Promise.all(readers).then(urls => this.emit([...existing, ...urls])).catch(() => { /* ignore */ });
  }
  removeGallery(i: number) {
    this.emit(this.galleryItems().filter((_, idx) => idx !== i));
  }

  // Canvas (signature / scribblePad) — minimal pointer-event drawing.
  private _cCtx: CanvasRenderingContext2D | null = null;
  private _cDrawing = false;
  private ensureCtx(el: HTMLCanvasElement): CanvasRenderingContext2D | null {
    if (this._cCtx) return this._cCtx;
    const ctx = el.getContext('2d');
    if (!ctx) return null;
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Restore any persisted bitmap so re-entering a step shows prior strokes.
    const existing = this._value();
    if (typeof existing === 'string' && existing.startsWith('data:')) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = existing;
    }
    this._cCtx = ctx;
    return ctx;
  }
  private cPoint(ev: PointerEvent, el: HTMLCanvasElement): { x: number; y: number } {
    const r = el.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * el.width, y: ((ev.clientY - r.top) / r.height) * el.height };
  }
  canvasDown(ev: PointerEvent, el: HTMLCanvasElement) {
    ev.preventDefault();
    const ctx = this.ensureCtx(el); if (!ctx) return;
    this._cDrawing = true;
    const p = this.cPoint(ev, el);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    el.setPointerCapture(ev.pointerId);
  }
  canvasMove(ev: PointerEvent, el: HTMLCanvasElement) {
    if (!this._cDrawing || !this._cCtx) return;
    const p = this.cPoint(ev, el);
    this._cCtx.lineTo(p.x, p.y);
    this._cCtx.stroke();
  }
  canvasUp(ev: PointerEvent, el: HTMLCanvasElement) {
    if (!this._cDrawing) return;
    this._cDrawing = false;
    try { el.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
    this.emit(el.toDataURL('image/png'));
  }
  canvasClear(el: HTMLCanvasElement) {
    const ctx = this._cCtx ?? el.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, el.width, el.height);
    this.emit('');
  }

  /** The reference band for the current patient — the ONE shared sex/age
   *  resolver (mw mirror), never a segment-string guess or `[0]`. */
  applicableRange = computed<ReferenceRange | null>(() => {
    const f = this._field();
    if (!f?.referenceRanges || f.referenceRanges.length === 0) return null;
    const age = this.context?.patientBandAge ?? this.context?.patientAge;
    return selectReferenceRange(f.referenceRanges, normalizeSex(this.context?.patientSex),
      typeof age === 'number' ? age : null) ?? null;
  });

  rangeLabel(): string | null {
    const f = this._field();
    const r = this.applicableRange();
    if (!r) return null;
    const unit = f?.unit ? ` ${f.unit}` : '';
    const min = r.min ?? '?';
    const max = r.max ?? '?';
    return `Normal ${min}–${max}${unit}`;
  }

  /** Live hint while typing — the shared rule (band → param criticals,
   *  strict; then the band's own bounds/ops). */
  flag = computed<Flag>(() => {
    const f = this._field();
    const v = typeof this._value() === 'number' ? this._value() as number : Number(this._value());
    if (!f || this._value() === null || this._value() === undefined || this._value() === '' || Number.isNaN(v)) return 'none';
    const age = this.context?.patientBandAge ?? this.context?.patientAge;
    const lf = liveFlag(f, v, normalizeSex(this.context?.patientSex), typeof age === 'number' ? age : null);
    switch (lf?.code) {
      case 'CL': return 'critical_low';
      case 'CH': return 'critical_high';
      case 'L': return 'low';
      case 'H': return 'high';
      case 'N': return 'normal';
      default:  return 'none';
    }
  });

  flagLabel(): string {
    switch (this.flag()) {
      // Plain words, no emoji (design rule) — the tone colour comes from
      // flagClass(); the words say which direction (QA 2026-09-24).
      case 'critical_low':  return 'Critical low — below the critical limit';
      case 'critical_high': return 'Critical high — above the critical limit';
      case 'low':           return 'Low (L) — below the reference range';
      case 'high':          return 'High (H) — above the reference range';
      case 'normal':        return 'Normal';
      default:              return '';
    }
  }

  flagClass(): string {
    switch (this.flag()) {
      case 'critical_low':
      case 'critical_high': return 'text-red-600 font-semibold';
      case 'low':
      case 'high':          return 'text-amber-600';
      case 'normal':        return 'text-emerald-600';
      default:              return 'text-slate-500';
    }
  }

  isCritical(): boolean {
    const f = this.flag();
    return f === 'critical_low' || f === 'critical_high';
  }

  // ── adapters ────────────────────────────────────────────────────

  static fromParameter(p: TestParameter): DynamicFieldConfig {
    return {
      name: p.name,
      title: p.title,
      type: p.type,
      unit: p.unit,
      options: p.options,
      referenceRanges: p.referenceRanges,
      criticalLow: p.criticalLow,
      criticalHigh: p.criticalHigh,
      normalValue: p.normalValue
    };
  }

  /** Convert a WorkflowField to DynamicFieldConfig for the renderer. */
  static fromWorkflowField(f: WorkflowField): DynamicFieldConfig {
    return {
      name: f.name,
      title: f.title,
      type: f.type,
      required: f.isRequired,
      unit: f.unit,
      options: f.options,
      defaultValue: f.defaultValue,
      placeholder: f.placeholder,
      helperText: f.helperText,
      referenceRanges: f.referenceRanges,
      criticalLow: f.criticalLow,
      criticalHigh: f.criticalHigh,
      normalValue: f.normalValue
    };
  }
}
