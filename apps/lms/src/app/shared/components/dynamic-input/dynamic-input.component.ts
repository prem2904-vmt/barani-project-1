import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TestParameter } from '../../models/test.model';
import { FieldOption, ReferenceRange, WorkflowContext, WorkflowField } from '../../models/workflow.model';
import { PfSelectOption, SelectComponent } from '../../primitives/select.component';

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
            <input type="range" class="flex-1" min="0" max="100" step="1"
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
