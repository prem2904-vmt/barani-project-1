import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TestParameter } from '../../models/test.model';
import { FieldOption, ReferenceRange, WorkflowContext, WorkflowField } from '../../models/workflow.model';
import { PfSelectOption, SelectComponent } from '../../primitives/select.component';
import { COUNTRY_PHONE_RULES, CountryPhoneRule, getCountryPhoneRule, validatePhoneNumber } from '../../forms/validate';
import { normalizeSex, selectReferenceRange } from '../../utils/reference-range';
import { liveFlag } from '../../utils/result-flag';

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

@Component({
  selector: 'pf-dynamic-input',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
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
                type="tel"
                class="pf-phone__num"
                [placeholder]="activePhoneRule().placeholder"
                [ngModel]="phoneDigits()"
                (ngModelChange)="onPhoneDigitsChange($event)"
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
              <input type="date" class="pf-input" style="flex:1 1 150px" [attr.max]="todayIso"
                     [ngModel]="value" (ngModelChange)="emit($event)" />
              <span class="text-xs" style="color: var(--text-tertiary);">or</span>
              <input type="number" class="pf-input" style="flex:0 0 84px" min="0"
                     [attr.max]="ageUnit() === 'months' ? 240 : 150"
                     placeholder="Age"
                     [ngModel]="hybridAgeDisplay()" (ngModelChange)="onHybridAge($event)" />
              <div class="pf-age-unit" role="group" aria-label="Age unit">
                <button type="button" class="pf-age-unit__btn"
                        [class.pf-age-unit__btn--on]="ageUnit() === 'years'"
                        (click)="setAgeUnit('years')">Yrs</button>
                <button type="button" class="pf-age-unit__btn"
                        [class.pf-age-unit__btn--on]="ageUnit() === 'months'"
                        (click)="setAgeUnit('months')">Mo</button>
              </div>
            </div>
            <p class="text-[11px]" style="color: var(--text-tertiary);">
              Type either — an entered age stays current automatically.
            </p>
          } @else {
            <input type="date" class="pf-input" [ngModel]="value" (ngModelChange)="emit($event)" />
          }
        }
        @case ('datetime') {
          <input type="datetime-local" class="pf-input" [ngModel]="value" (ngModelChange)="emit($event)" />
        }
        @case ('time') {
          <input type="time" class="pf-input" [ngModel]="value" (ngModelChange)="emit($event)" />
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
  `]
})
export class DynamicInputComponent {
  private readonly _field = signal<DynamicFieldConfig | null>(null);
  private readonly _value = signal<unknown>(null);

  @Input({ required: true }) set field(v: DynamicFieldConfig) { this._field.set(v); }
  get field(): DynamicFieldConfig { return this._field()!; }

  @Input() set value(v: unknown) {
    this._value.set(v);
    if (this._field()?.type === 'phone' && typeof v === 'string' && v.trim()) {
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
    if (this._field()?.type !== 'phone') return null;
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

  onPhoneDigitsChange(typed: string) {
    const rule = this.activePhoneRule();
    const cleanDigits = String(typed ?? '').replace(/\D/g, '').slice(0, rule.maxDigits);
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
  readonly todayIso = new Date().toISOString().slice(0, 10);

  /** Age implied by the current DOB value (so the age box mirrors the date). */
  readonly ageFromValue = computed<number | null>(() => {
    const v = this._value();
    if (!v) return null;
    const d = new Date(String(v));
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    let a = now.getFullYear() - d.getFullYear();
    if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) a--;
    return a < 0 || a > 150 ? null : a;
  });

  /** Whole months implied by the current DOB value (for the Months unit). */
  readonly monthsFromValue = computed<number | null>(() => {
    const v = this._value();
    if (!v) return null;
    const d = new Date(String(v));
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    let m = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    if (now.getDate() < d.getDate()) m--;
    return m < 0 || m > 1800 ? null : m;
  });

  /** Age unit the user picked; null = auto (Months under 2 yrs, else Years). */
  private readonly _ageUnit = signal<'years' | 'months' | null>(null);
  readonly ageUnit = computed<'years' | 'months'>(() => {
    const chosen = this._ageUnit();
    if (chosen) return chosen;
    const m = this.monthsFromValue();
    return m !== null && m < 24 ? 'months' : 'years';
  });

  setAgeUnit(u: 'years' | 'months') { this._ageUnit.set(u); }

  /** The number shown in the age box, in the active unit. */
  readonly hybridAgeDisplay = computed<number | null>(() =>
    this.ageUnit() === 'months' ? this.monthsFromValue() : this.ageFromValue());

  /** Age typed in the hybrid → synthesize a DOB anchored to today (so the age
   *  increments over time) and emit it as the field's value (a DOB). */
  onHybridAge(raw: unknown) {
    if (raw == null || `${raw}` === '') { this.emit(null); return; }
    const age = Math.floor(Number(raw));
    const months = this.ageUnit() === 'months';
    if (!Number.isFinite(age) || age < 0 || age > (months ? 240 : 150)) return;
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (months) d.setMonth(d.getMonth() - age);
    else d.setFullYear(d.getFullYear() - age);
    this.emit(d.toISOString().slice(0, 10)); // yyyy-MM-dd for <input type=date>
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
    const age = this.context?.patientAge;
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
    const age = this.context?.patientAge;
    const lf = liveFlag(f, v, normalizeSex(this.context?.patientSex), typeof age === 'number' ? age : null);
    switch (lf?.code) {
      case 'C': return lf.critical === 'low' ? 'critical_low' : 'critical_high';
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
