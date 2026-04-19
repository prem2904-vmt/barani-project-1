import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TestParameter } from '../../models/test.model';
import { FieldOption, ReferenceRange, WorkflowContext, WorkflowField } from '../../models/workflow.model';

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
  imports: [FormsModule, NgTemplateOutlet],
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
          <input type="text" class="pf-input" [placeholder]="field.placeholder ?? ''"
                 [ngModel]="value" (ngModelChange)="emit($event)" />
        }
        @case ('email') {
          <input type="email" class="pf-input" [ngModel]="value" (ngModelChange)="emit($event)" />
        }
        @case ('phone') {
          <input type="tel" class="pf-input" placeholder="+91…"
                 [ngModel]="value" (ngModelChange)="emit($event)" />
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
          <input type="date" class="pf-input" [ngModel]="value" (ngModelChange)="emit($event)" />
        }
        @case ('datetime') {
          <input type="datetime-local" class="pf-input" [ngModel]="value" (ngModelChange)="emit($event)" />
        }
        @case ('time') {
          <input type="time" class="pf-input" [ngModel]="value" (ngModelChange)="emit($event)" />
        }

        @case ('select') {
          <select class="pf-input" [ngModel]="value" (ngModelChange)="emit($event)">
            <option [ngValue]="null">— Select —</option>
            @for (o of norm; track o.value) { <option [ngValue]="o.value">{{ o.label }}</option> }
          </select>
        }

        @case ('multiselect') {
          <div class="flex flex-wrap gap-2">
            @for (o of norm; track o.value) {
              <button type="button"
                      class="rounded-full border px-3 py-1 text-xs transition"
                      [class.bg-[var(--color-accent)]]="isSelected(o.value)"
                      [class.text-white]="isSelected(o.value)"
                      [class.border-slate-300]="!isSelected(o.value)"
                      (click)="toggleMulti(o.value)">{{ o.label }}</button>
            }
          </div>
        }

        @case ('radio') {
          <div class="flex flex-col gap-1.5">
            @for (o of norm; track o.value) {
              <label class="inline-flex items-center gap-2 text-sm">
                <input type="radio" [name]="field.name" [value]="o.value"
                       [ngModel]="value" (ngModelChange)="emit($event)" />
                <span>{{ o.label }}</span>
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

        @case ('multi_button_select') {
          <div class="flex flex-wrap gap-2">
            @for (o of norm; track o.value) {
              <button type="button"
                      class="rounded-lg border px-3 py-1.5 text-sm transition"
                      [class.bg-[var(--color-primary)]]="isSelected(o.value)"
                      [class.text-white]="isSelected(o.value)"
                      [class.border-slate-300]="!isSelected(o.value)"
                      (click)="toggleMulti(o.value)">{{ o.label }}</button>
            }
          </div>
        }

        @case ('image_select') {
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
  `
})
export class DynamicInputComponent {
  private readonly _field = signal<DynamicFieldConfig | null>(null);
  private readonly _value = signal<unknown>(null);

  @Input({ required: true }) set field(v: DynamicFieldConfig) { this._field.set(v); }
  get field(): DynamicFieldConfig { return this._field()!; }

  @Input() set value(v: unknown) { this._value.set(v); }
  get value(): unknown { return this._value(); }

  @Input() context: WorkflowContext | null = null;

  @Output() valueChange = new EventEmitter<unknown>();

  emit(v: unknown) {
    this._value.set(v);
    this.valueChange.emit(v);
  }

  /** Normalise options to `{value,label}` regardless of whether strings or objects are passed. */
  normalisedOptions = computed<FieldOption[]>(() => {
    const opts = this._field()?.options;
    if (!opts) return [];
    return opts.map(o => typeof o === 'string' ? { value: o, label: o } : o);
  });

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

  /** The reference range that applies to the current patient context, or the first 'normal' range. */
  applicableRange = computed<ReferenceRange | null>(() => {
    const f = this._field();
    if (!f?.referenceRanges || f.referenceRanges.length === 0) return null;

    const sex = this.context?.patientSex?.toLowerCase();
    const age = this.context?.patientAge;
    const isMinor = typeof age === 'number' && age < 18;

    // Try context-specific segment first
    const prefer = (key: string) => f.referenceRanges!.find(r => r.segment === key);

    if (sex === 'male' && !isMinor && prefer('adult_male'))   return prefer('adult_male')!;
    if (sex === 'female' && !isMinor && prefer('adult_female')) return prefer('adult_female')!;
    if (isMinor && prefer('child')) return prefer('child')!;

    return prefer('normal') ?? prefer('adult') ?? f.referenceRanges[0];
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

  flag = computed<Flag>(() => {
    const f = this._field();
    const v = typeof this._value() === 'number' ? this._value() as number : Number(this._value());
    if (!f || Number.isNaN(v) || v === null) return 'none';
    if (f.criticalLow != null && v <= f.criticalLow) return 'critical_low';
    if (f.criticalHigh != null && v >= f.criticalHigh) return 'critical_high';
    const r = this.applicableRange();
    if (r) {
      if (r.min != null && v < r.min) return 'low';
      if (r.max != null && v > r.max) return 'high';
      return 'normal';
    }
    return 'none';
  });

  flagLabel(): string {
    switch (this.flag()) {
      case 'critical_low':  return '🔴 Critical low';
      case 'critical_high': return '🔴 Critical high';
      case 'low':           return '🟡 Low';
      case 'high':          return '🟡 High';
      case 'normal':        return '✅ Normal';
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
