import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { v4 as uuid } from 'uuid';
import { SlideOverComponent } from '../../../shared/components/slide-over/slide-over.component';
import {
  ConditionRule,
  FieldOption,
  FieldType,
  FieldWidth,
  ReferenceRange,
  WorkflowField
} from '../../../shared/models/workflow.model';
import { ConditionBuilderComponent } from './condition-builder.component';

type FieldCategory =
  | 'text' | 'numeric' | 'options' | 'boolean'
  | 'date' | 'file' | 'other';

const TYPE_META: Array<{ type: FieldType; label: string; category: FieldCategory }> = [
  { type: 'text',                label: 'Text',                   category: 'text' },
  { type: 'textarea',            label: 'Long text',              category: 'text' },
  { type: 'email',               label: 'Email',                  category: 'text' },
  { type: 'phone',               label: 'Phone',                  category: 'text' },
  { type: 'number',              label: 'Number',                 category: 'numeric' },
  { type: 'numeric_with_range',  label: 'Numeric w/ range',       category: 'numeric' },
  { type: 'critical_numeric',    label: 'Numeric w/ critical',    category: 'numeric' },
  { type: 'select',              label: 'Dropdown',               category: 'options' },
  { type: 'multiselect',         label: 'Multi-select',           category: 'options' },
  { type: 'radio',               label: 'Radio buttons',          category: 'options' },
  { type: 'button_select',       label: 'Button select',          category: 'options' },
  { type: 'multi_button_select', label: 'Multi button select',    category: 'options' },
  { type: 'toggle',              label: 'Toggle',                 category: 'boolean' },
  { type: 'yesno',               label: 'Yes / No',               category: 'boolean' },
  { type: 'checkbox',            label: 'Checkbox',               category: 'boolean' },
  { type: 'date',                label: 'Date',                   category: 'date' },
  { type: 'file',                label: 'File upload',            category: 'file' },
  { type: 'signature',           label: 'Signature',              category: 'file' }
];

const WIDTHS: Array<{ value: FieldWidth; label: string }> = [
  { value: 'full',    label: 'Full'    },
  { value: 'half',    label: 'Half'    },
  { value: 'third',   label: '⅓'       },
  { value: 'quarter', label: '¼'       }
];

export interface FieldEditorResult {
  field: Partial<WorkflowField> & { id?: string };
  mode: 'create' | 'edit';
}

@Component({
  selector: 'pf-field-editor',
  standalone: true,
  imports: [FormsModule, SlideOverComponent, ConditionBuilderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pf-slide-over [open]="open()" [title]="title()" (closed)="cancelled.emit()">
      <div class="space-y-4">

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="pf-label">Label <span class="text-red-500">*</span></label>
            <input type="text" class="pf-input"
                  [ngModel]="draft().title"
                  (ngModelChange)="setTitle($event)" />
          </div>
          <div>
            <label class="pf-label">Name <span class="text-slate-400 font-normal">(auto)</span></label>
            <input type="text" class="pf-input font-mono"
                  [ngModel]="draft().name"
                  [readonly]="!isCustom() || mode() === 'edit'"
                  (ngModelChange)="patch({ name: $event })" />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="pf-label">Type <span class="text-red-500">*</span></label>
            <select class="pf-input"
                    [ngModel]="draft().type"
                    [disabled]="!isCustom()"
                    (ngModelChange)="setType($event)">
              @for (opt of typeMeta; track opt.type) {
                <option [ngValue]="opt.type">{{ opt.label }}</option>
              }
            </select>
          </div>
          <div>
            <label class="pf-label">Width</label>
            <select class="pf-input"
                    [ngModel]="draft().width ?? 'full'"
                    (ngModelChange)="patch({ width: $event })">
              @for (w of widths; track w.value) {
                <option [ngValue]="w.value">{{ w.label }}</option>
              }
            </select>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <label class="inline-flex items-center gap-2 text-sm">
            <input type="checkbox"
                  [ngModel]="!!draft().isRequired"
                  (ngModelChange)="patch({ isRequired: $event })" />
            <span>Required</span>
          </label>
          <label class="inline-flex items-center gap-2 text-sm"
                 [class.opacity-50]="!isCustom()">
            <input type="checkbox"
                  [ngModel]="isCustom()"
                  [disabled]="mode() === 'edit'"
                  (ngModelChange)="setStandard(!$event)" />
            <span>Custom field <span class="text-slate-400">(stores to metadata)</span></span>
          </label>
        </div>

        @if (category() === 'text') {
          <div class="border-t border-slate-100 pt-3">
            <label class="pf-label">Placeholder</label>
            <input type="text" class="pf-input"
                  [ngModel]="draft().placeholder"
                  (ngModelChange)="patch({ placeholder: $event })" />
            <label class="pf-label mt-2">Helper text</label>
            <input type="text" class="pf-input"
                  [ngModel]="draft().helperText"
                  (ngModelChange)="patch({ helperText: $event })" />
          </div>
        }

        @if (category() === 'numeric') {
          <div class="border-t border-slate-100 pt-3 space-y-3">
            <div>
              <label class="pf-label">Unit</label>
              <input type="text" class="pf-input max-w-[160px]"
                    [ngModel]="draft().unit"
                    (ngModelChange)="patch({ unit: $event })" />
            </div>

            <div>
              <p class="text-xs uppercase tracking-wider text-slate-500 mb-1">Reference ranges</p>
              @for (range of draft().referenceRanges ?? []; let i = $index; track i) {
                <div class="flex gap-2 items-end mb-1">
                  <div class="flex-1">
                    <label class="text-[11px] text-slate-500">Segment</label>
                    <input type="text" class="pf-input"
                          [ngModel]="range.segment"
                          (ngModelChange)="patchRange(i, { segment: $event })"
                          placeholder="normal | adult_male | adult_female | child" />
                  </div>
                  <div class="w-20">
                    <label class="text-[11px] text-slate-500">Min</label>
                    <input type="number" class="pf-input" step="any"
                          [ngModel]="range.min"
                          (ngModelChange)="patchRange(i, { min: numOrUndef($event) })" />
                  </div>
                  <div class="w-20">
                    <label class="text-[11px] text-slate-500">Max</label>
                    <input type="number" class="pf-input" step="any"
                          [ngModel]="range.max"
                          (ngModelChange)="patchRange(i, { max: numOrUndef($event) })" />
                  </div>
                  <button type="button" class="text-slate-400 hover:text-red-500 pb-1.5"
                          (click)="removeRange(i)">✕</button>
                </div>
              }
              <button type="button" class="text-xs text-[var(--color-primary)] hover:underline"
                      (click)="addRange()">+ Add range</button>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="pf-label">Critical low</label>
                <input type="number" class="pf-input" step="any"
                      [ngModel]="draft().criticalLow"
                      (ngModelChange)="patch({ criticalLow: numOrUndef($event) })" />
              </div>
              <div>
                <label class="pf-label">Critical high</label>
                <input type="number" class="pf-input" step="any"
                      [ngModel]="draft().criticalHigh"
                      (ngModelChange)="patch({ criticalHigh: numOrUndef($event) })" />
              </div>
            </div>
          </div>
        }

        @if (category() === 'options') {
          <div class="border-t border-slate-100 pt-3 space-y-3">
            <p class="text-xs uppercase tracking-wider text-slate-500">Options</p>
            @for (opt of draft().options ?? []; let i = $index; track i) {
              <div class="flex gap-2 items-end">
                <div class="flex-1">
                  <label class="text-[11px] text-slate-500">Label</label>
                  <input type="text" class="pf-input"
                        [ngModel]="opt.label"
                        (ngModelChange)="patchOption(i, { label: $event, value: $event })" />
                </div>
                <div class="w-32">
                  <label class="text-[11px] text-slate-500">Value</label>
                  <input type="text" class="pf-input font-mono"
                        [ngModel]="opt.value"
                        (ngModelChange)="patchOption(i, { value: $event })" />
                </div>
                <button type="button" class="text-slate-400 hover:text-red-500 pb-1.5"
                        (click)="removeOption(i)">✕</button>
              </div>
            }
            <button type="button" class="text-xs text-[var(--color-primary)] hover:underline"
                    (click)="addOption()">+ Add option</button>

            <div>
              <label class="pf-label">Normal value <span class="text-slate-400 font-normal">(optional)</span></label>
              <select class="pf-input"
                      [ngModel]="draft().normalValue ?? ''"
                      (ngModelChange)="patch({ normalValue: $event || undefined })">
                <option [ngValue]="''">—</option>
                @for (opt of draft().options ?? []; track opt.value) {
                  <option [ngValue]="opt.value">{{ opt.label }}</option>
                }
              </select>
            </div>
          </div>
        }

        @if (category() === 'boolean') {
          <div class="border-t border-slate-100 pt-3 space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="pf-label">Positive label</label>
                <input type="text" class="pf-input"
                      [ngModel]="(draft().options?.[0]?.label) ?? 'Yes'"
                      (ngModelChange)="patchOption(0, { label: $event, value: $event })" />
              </div>
              <div>
                <label class="pf-label">Negative label</label>
                <input type="text" class="pf-input"
                      [ngModel]="(draft().options?.[1]?.label) ?? 'No'"
                      (ngModelChange)="patchOption(1, { label: $event, value: $event })" />
              </div>
            </div>
            <div>
              <label class="pf-label">Normal value</label>
              <select class="pf-input max-w-[200px]"
                      [ngModel]="draft().normalValue ?? ''"
                      (ngModelChange)="patch({ normalValue: $event || undefined })">
                <option [ngValue]="''">—</option>
                <option [ngValue]="(draft().options?.[0]?.value) ?? 'Yes'">Positive</option>
                <option [ngValue]="(draft().options?.[1]?.value) ?? 'No'">Negative</option>
              </select>
            </div>
          </div>
        }

        <div class="border-t border-slate-100 pt-3">
          <p class="text-xs uppercase tracking-wider text-slate-500 mb-2">Show when</p>
          <pf-condition-builder
            [rules]="draft().showWhen ?? []"
            [fields]="availableFields()"
            emptyLabel="Always visible."
            (rulesChange)="patch({ showWhen: $event.length === 0 ? undefined : $event })">
          </pf-condition-builder>
        </div>

      </div>

      <div footer class="flex justify-end gap-2">
        <button type="button" class="pf-btn pf-btn-ghost" (click)="cancelled.emit()">Cancel</button>
        <button type="button" class="pf-btn pf-btn-primary"
                [disabled]="!canSave()"
                (click)="submit()">
          {{ mode() === 'edit' ? 'Save changes' : 'Add field' }}
        </button>
      </div>
    </pf-slide-over>
  `
})
export class FieldEditorComponent {
  readonly open = input<boolean>(false);
  readonly mode = input<'create' | 'edit'>('create');
  readonly initial = input<WorkflowField | null>(null);
  readonly availableFields = input<WorkflowField[]>([]);

  readonly saved = output<FieldEditorResult>();
  readonly cancelled = output<void>();

  readonly typeMeta = TYPE_META;
  readonly widths = WIDTHS;

  private readonly _draft = signal<Partial<WorkflowField>>(this.emptyDraft());
  readonly draft = this._draft.asReadonly();

  readonly category = computed<FieldCategory>(() => {
    const t = this._draft().type;
    if (!t) return 'other';
    return TYPE_META.find(m => m.type === t)?.category ?? 'other';
  });

  readonly title = computed(() => this.mode() === 'edit' ? 'Edit field' : 'Add field');
  readonly isCustom = computed(() => !this._draft().isStandard);

  readonly canSave = computed(() => {
    const d = this._draft();
    return !!(d.title && d.title.trim() && d.name && d.name.trim() && d.type);
  });

  constructor() {
    effect(() => {
      // Re-seed when the slide-over opens.
      if (this.open()) {
        const src = this.initial();
        if (src) {
          this._draft.set({ ...src });
        } else {
          this._draft.set(this.emptyDraft());
        }
      }
    });
  }

  patch(updates: Partial<WorkflowField>): void {
    this._draft.set({ ...this._draft(), ...updates });
  }

  setTitle(v: string): void {
    const patch: Partial<WorkflowField> = { title: v };
    // auto-derive name for new custom fields only
    if (this.mode() === 'create' && this.isCustom()) {
      patch.name = this.toSnakeCase(v);
    }
    this.patch(patch);
  }

  setType(type: FieldType): void {
    const patch: Partial<WorkflowField> = { type };
    // seed sensible defaults per category
    const category = TYPE_META.find(m => m.type === type)?.category;
    if (category === 'options' && !this._draft().options) {
      patch.options = [{ value: 'Option 1', label: 'Option 1' }];
    }
    if (category === 'boolean' && !this._draft().options) {
      patch.options = [
        { value: 'Yes', label: 'Yes' },
        { value: 'No',  label: 'No'  }
      ];
    }
    if (category === 'numeric' && !this._draft().referenceRanges) {
      patch.referenceRanges = [{ segment: 'normal', min: undefined, max: undefined }];
    }
    this.patch(patch);
  }

  setStandard(isStandard: boolean): void {
    const isCustom = !isStandard;
    const d = this._draft();
    const storageKey = isCustom && d.name ? `metadata.${d.name}` : d.name;
    this.patch({ isStandard, storageKey });
  }

  // Options ------------------------------------------------------
  addOption(): void {
    const list = [...(this._draft().options ?? [])];
    const n = list.length + 1;
    list.push({ value: `option_${n}`, label: `Option ${n}` });
    this.patch({ options: list });
  }
  patchOption(i: number, updates: Partial<FieldOption>): void {
    const list = [...(this._draft().options ?? [])];
    if (i >= list.length) {
      for (let j = list.length; j <= i; j++) list.push({ value: '', label: '' });
    }
    list[i] = { ...list[i], ...updates };
    this.patch({ options: list });
  }
  removeOption(i: number): void {
    const list = (this._draft().options ?? []).filter((_, idx) => idx !== i);
    this.patch({ options: list });
  }

  // Reference ranges --------------------------------------------
  addRange(): void {
    const list = [...(this._draft().referenceRanges ?? [])];
    list.push({ segment: 'normal', min: undefined, max: undefined });
    this.patch({ referenceRanges: list });
  }
  patchRange(i: number, updates: Partial<ReferenceRange>): void {
    const list = [...(this._draft().referenceRanges ?? [])];
    list[i] = { ...list[i], ...updates };
    this.patch({ referenceRanges: list });
  }
  removeRange(i: number): void {
    const list = (this._draft().referenceRanges ?? []).filter((_, idx) => idx !== i);
    this.patch({ referenceRanges: list });
  }

  numOrUndef(v: unknown): number | undefined {
    if (v === null || v === '' || v === undefined) return undefined;
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
  }

  submit(): void {
    if (!this.canSave()) return;
    const d = this._draft();
    const isCustom = !d.isStandard;
    const name = d.name!.trim();
    const storageKey = d.storageKey ?? (isCustom ? `metadata.${name}` : name);
    this.saved.emit({
      field: {
        ...d,
        name,
        isStandard: !!d.isStandard,
        storageKey,
        id: d.id ?? uuid()
      },
      mode: this.mode()
    });
  }

  private emptyDraft(): Partial<WorkflowField> {
    return {
      title: '',
      name: '',
      type: 'text',
      isStandard: false,
      isRequired: false,
      isEditable: true,
      width: 'full',
      storageKey: ''
    };
  }

  private toSnakeCase(str: string): string {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  /** Condition rule change is handled by nested component which emits unknown
      value shape; we normalise here. */
  _onConditionsChange(rules: ConditionRule[]): void {
    this.patch({ showWhen: rules.length === 0 ? undefined : rules });
  }
}
