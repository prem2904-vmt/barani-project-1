import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { v4 as uuid } from 'uuid';
import { ToastService } from '../../../core/services/toast.service';
import {
  ConditionRule,
  FieldOption,
  FieldType,
  FieldWidth,
  ReferenceRange,
  WorkflowField
} from '../../../shared/models/workflow.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { FieldTypePickerComponent, getFieldType, hasOptions as registryHasOptions } from '../../../shared/forms';
import { ConditionBuilderComponent } from './condition-builder.component';
import { WorkflowBuilderService } from './workflow-builder.service';

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

@Component({
  selector: 'pf-field-editor',
  standalone: true,
  imports: [
    FormsModule,
    ConditionBuilderComponent,
    FieldTypePickerComponent,
    ScreenHeaderComponent,
    SelectComponent,
    TileComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10">

      <pf-screen-header
        [eyebrow]="eyebrow()"
        [title]="title()"
        [subtitle]="subtitle()">
        <pf-touch-btn actions size="sm" variant="ghost" (pressed)="cancel()">
          <span icon-left aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
          </span>
          Back
        </pf-touch-btn>
        <pf-touch-btn actions size="sm" variant="primary" [disabled]="!canSave()" (pressed)="submit()">
          {{ mode() === 'edit' ? 'Save changes' : 'Add field' }}
        </pf-touch-btn>
      </pf-screen-header>

      <!-- Basics -->
      <pf-tile tone="default" padding="lg" class="block mb-4">
        <h3 class="section-title">Basics</h3>
        <div class="mt-4 space-y-3">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label class="pf-label">Label <span class="text-red-500">*</span></label>
              <input type="text" class="pf-input"
                     [ngModel]="draft().title"
                     (ngModelChange)="setTitle($event)" />
            </div>
            <div>
              <label class="pf-label">Name
                <span style="color: var(--text-muted);" class="font-normal">(storage key — fixed)</span>
              </label>
              <input type="text" class="pf-input font-mono"
                     [ngModel]="draft().name"
                     [readonly]="!isCustom() || mode() === 'edit'"
                     (ngModelChange)="patch({ name: $event })" />
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label class="pf-label">Type <span class="text-red-500">*</span></label>
              <!-- Shared field-type picker: lists the full 27-type taxonomy
                   grouped by Input / Choice / Layout / Media / Advanced.
                   Types flipped off in field-registry.ts are filtered out.
                   Editable for standard fields too — only the storage Name
                   (the DB-column binding) stays fixed. -->
              <pf-field-type-picker
                [value]="$any(draft().type)"
                (valueChange)="setType($any($event))">
              </pf-field-type-picker>
            </div>
            <div>
              <label class="pf-label">Width</label>
              <pf-select
                [options]="widthSelectOptions"
                [value]="draft().width ?? 'full'"
                (valueChange)="patch({ width: $any($event) })"></pf-select>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            <label class="inline-flex items-center gap-2 text-sm">
              <input type="checkbox"
                     [ngModel]="!!draft().isRequired"
                     (ngModelChange)="patch({ isRequired: $event })" />
              <span>Required</span>
            </label>
            <label class="inline-flex items-center gap-2 text-sm"
                   [class.opacity-50]="mode() === 'edit'">
              <input type="checkbox"
                     [ngModel]="isCustom()"
                     [disabled]="mode() === 'edit'"
                     (ngModelChange)="setStandard(!$event)" />
              <span>Custom field <span style="color: var(--text-muted);">(stores to metadata)</span></span>
            </label>
          </div>
        </div>
      </pf-tile>

      @if (category() === 'text') {
        <pf-tile tone="default" padding="lg" class="block mb-4">
          <h3 class="section-title">Hints</h3>
          <div class="mt-4 space-y-3">
            <div>
              <label class="pf-label">Placeholder</label>
              <input type="text" class="pf-input"
                     [ngModel]="draft().placeholder"
                     (ngModelChange)="patch({ placeholder: $event })" />
            </div>
            <div>
              <label class="pf-label">Helper text</label>
              <input type="text" class="pf-input"
                     [ngModel]="draft().helperText"
                     (ngModelChange)="patch({ helperText: $event })" />
            </div>
          </div>
        </pf-tile>
      }

      @if (category() === 'numeric') {
        <pf-tile tone="default" padding="lg" class="block mb-4">
          <h3 class="section-title">Numeric config</h3>
          <div class="mt-4 space-y-4">
            <div>
              <label class="pf-label">Unit</label>
              <input type="text" class="pf-input max-w-[200px]"
                     [ngModel]="draft().unit"
                     (ngModelChange)="patch({ unit: $event })" />
            </div>

            <div>
              <p class="text-[11px] font-mono uppercase tracking-[0.16em] mb-2" style="color: var(--text-muted);">
                Reference ranges
              </p>
              @for (range of draft().referenceRanges ?? []; let i = $index; track i) {
                <div class="flex gap-2 items-end mb-2">
                  <div class="flex-1">
                    <label class="text-[11px]" style="color: var(--text-muted);">Segment</label>
                    <input type="text" class="pf-input"
                           [ngModel]="range.segment"
                           (ngModelChange)="patchRange(i, { segment: $event })"
                           placeholder="normal | adult_male | adult_female | child" />
                  </div>
                  <div class="w-24">
                    <label class="text-[11px]" style="color: var(--text-muted);">Min</label>
                    <input type="number" class="pf-input" step="any"
                           [ngModel]="range.min"
                           (ngModelChange)="patchRange(i, { min: numOrUndef($event) })" />
                  </div>
                  <div class="w-24">
                    <label class="text-[11px]" style="color: var(--text-muted);">Max</label>
                    <input type="number" class="pf-input" step="any"
                           [ngModel]="range.max"
                           (ngModelChange)="patchRange(i, { max: numOrUndef($event) })" />
                  </div>
                  <button type="button" class="field-remove" (click)="removeRange(i)" aria-label="Remove">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
                    </svg>
                  </button>
                </div>
              }
              <pf-touch-btn size="sm" variant="ghost" (pressed)="addRange()">
                <span icon-left aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 5v14"/><path d="M5 12h14"/>
                  </svg>
                </span>
                Add range
              </pf-touch-btn>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
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
        </pf-tile>
      }

      @if (category() === 'options') {
        <pf-tile tone="default" padding="lg" class="block mb-4">
          <h3 class="section-title">Options</h3>
          <div class="mt-4 space-y-3">
            @for (opt of draft().options ?? []; let i = $index; track i) {
              <div class="flex gap-2 items-end">
                <div class="flex-1">
                  <label class="text-[11px]" style="color: var(--text-muted);">Label</label>
                  <input type="text" class="pf-input"
                         [ngModel]="opt.label"
                         (ngModelChange)="patchOption(i, { label: $event, value: $event })" />
                </div>
                <div class="w-36">
                  <label class="text-[11px]" style="color: var(--text-muted);">Value</label>
                  <input type="text" class="pf-input font-mono"
                         [ngModel]="opt.value"
                         (ngModelChange)="patchOption(i, { value: $event })" />
                </div>
                <button type="button" class="field-remove" (click)="removeOption(i)" aria-label="Remove">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
                  </svg>
                </button>
              </div>
            }
            <pf-touch-btn size="sm" variant="ghost" (pressed)="addOption()">
              <span icon-left aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 5v14"/><path d="M5 12h14"/>
                </svg>
              </span>
              Add option
            </pf-touch-btn>

            <div>
              <label class="pf-label">Normal value <span class="font-normal" style="color: var(--text-muted);">(optional)</span></label>
              <pf-select
                [options]="normalValueSelectOptions()"
                [value]="(draft().normalValue ?? '') + ''"
                placeholder="—"
                (valueChange)="patch({ normalValue: $any($event) || undefined })"></pf-select>
            </div>
          </div>
        </pf-tile>
      }

      @if (category() === 'boolean') {
        <pf-tile tone="default" padding="lg" class="block mb-4">
          <h3 class="section-title">Labels</h3>
          <div class="mt-4 space-y-3">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
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
            <div class="max-w-[220px]">
              <label class="pf-label">Normal value</label>
              <pf-select
                [options]="booleanNormalSelectOptions()"
                [value]="(draft().normalValue ?? '') + ''"
                placeholder="—"
                (valueChange)="patch({ normalValue: $any($event) || undefined })"></pf-select>
            </div>
          </div>
        </pf-tile>
      }

      <pf-tile tone="default" padding="lg" class="block">
        <h3 class="section-title">Show when</h3>
        <div class="mt-4">
          <pf-condition-builder
            [rules]="draft().showWhen ?? []"
            [fields]="availableFields()"
            emptyLabel="Always visible."
            (rulesChange)="onConditionsChange($event)">
          </pf-condition-builder>
        </div>
      </pf-tile>
    </section>
  `,
  styles: [`
    .section-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
      letter-spacing: -0.01em;
      margin: 0;
    }
    .field-remove {
      width: 32px;
      height: 32px;
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      background: transparent;
      border: 1px solid transparent;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
      flex-shrink: 0;
    }
    .field-remove:hover {
      background: rgba(239, 68, 68, 0.15);
      color: #fca5a5;
      border-color: rgba(239, 68, 68, 0.3);
    }
  `]
})
export class FieldEditorComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  protected readonly builder = inject(WorkflowBuilderService);

  readonly typeMeta = TYPE_META;
  readonly widths = WIDTHS;

  readonly typeSelectOptions: PfSelectOption<FieldType>[] =
    TYPE_META.map(t => ({ value: t.type, label: t.label, hint: t.category }));
  readonly widthSelectOptions: PfSelectOption<FieldWidth>[] =
    WIDTHS.map(w => ({ value: w.value, label: w.label }));
  readonly normalValueSelectOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: '—' },
    ...((this.draft().options ?? []).map(o => ({ value: String(o.value), label: o.label })))
  ]);
  readonly booleanNormalSelectOptions = computed<PfSelectOption<string>[]>(() => {
    const opts = this.draft().options ?? [];
    return [
      { value: '', label: '—' },
      { value: String(opts[0]?.value ?? 'Yes'), label: 'Positive' },
      { value: String(opts[1]?.value ?? 'No'),  label: 'Negative' }
    ];
  });

  private readonly _screen = signal<string | null>(null);
  private readonly _stepId = signal<string | null>(null);
  private readonly _fieldId = signal<string | null>(null);
  private readonly _draft = signal<Partial<WorkflowField>>(emptyDraft());

  readonly draft = this._draft.asReadonly();
  readonly mode = computed<'create' | 'edit'>(() => this._fieldId() ? 'edit' : 'create');
  readonly title = computed(() => this.mode() === 'edit' ? 'Edit field' : 'Add field');
  readonly eyebrow = computed(() => {
    const screen = this._screen() ?? '';
    const stepName = this.builder.workflow()?.steps.find(s => s.id === this._stepId())?.title ?? '';
    return stepName ? `Workflow · ${screen} · ${stepName}` : `Workflow · ${screen}`;
  });
  readonly subtitle = computed(() =>
    this.mode() === 'edit'
      ? 'Update the label, validations, options, or conditions.'
      : 'Configure a field for lab staff to fill in at this step.'
  );
  readonly category = computed<FieldCategory>(() => {
    const t = this._draft().type;
    if (!t) return 'other';
    return TYPE_META.find(m => m.type === t)?.category ?? 'other';
  });
  readonly isCustom = computed(() => !this._draft().isStandard);
  readonly availableFields = computed<WorkflowField[]>(() => this.builder.allFields());
  readonly canSave = computed(() => {
    const d = this._draft();
    return !!(d.title && d.title.trim() && d.name && d.name.trim() && d.type);
  });

  ngOnInit() {
    const screen = this.route.snapshot.paramMap.get('screen');
    const stepId = this.route.snapshot.paramMap.get('stepId');
    const fieldId = this.route.snapshot.paramMap.get('fieldId');
    this._screen.set(screen);
    this._stepId.set(stepId);
    this._fieldId.set(fieldId);

    if (screen && !this.builder.workflow()) {
      this.builder.loadWorkflow(screen).subscribe({
        next: () => this.seedDraft(),
        error: () => this.toasts.error('Could not load workflow')
      });
    } else {
      this.seedDraft();
    }
  }

  private seedDraft() {
    const fieldId = this._fieldId();
    const stepId = this._stepId();
    if (fieldId && stepId) {
      const step = this.builder.workflow()?.steps.find(s => s.id === stepId);
      const field = step?.fields.find(f => f.id === fieldId);
      this._draft.set(field ? { ...field } : emptyDraft());
    } else {
      this._draft.set(emptyDraft());
    }
  }

  patch(updates: Partial<WorkflowField>): void {
    this._draft.set({ ...this._draft(), ...updates });
  }

  setTitle(v: string): void {
    const patch: Partial<WorkflowField> = { title: v };
    if (this.mode() === 'create' && this.isCustom()) {
      patch.name = toSnakeCase(v);
    }
    this.patch(patch);
  }

  setType(type: FieldType): void {
    const patch: Partial<WorkflowField> = { type };

    // Prefer the shared registry's category when the type is one of the
    // FormFieldType literals it knows about; otherwise fall back to the
    // legacy TYPE_META (covers workflow-only types like numeric_with_range).
    const registryEntry = getFieldType(type as never);
    const legacyCategory = TYPE_META.find(m => m.type === type)?.category;
    const needsOptions =
      registryHasOptions(type as never) || legacyCategory === 'options';

    if (needsOptions && !this._draft().options) {
      patch.options = [{ value: 'Option 1', label: 'Option 1' }];
    }
    // Boolean-style fields still get the Yes/No seed so their default
    // choices match user expectations.
    if ((legacyCategory === 'boolean' || type === 'yesno' || type === 'yesNoNa' || type === 'toggle' || type === 'checkbox')
        && !this._draft().options) {
      patch.options = [
        { value: 'Yes', label: 'Yes' },
        { value: 'No',  label: 'No'  }
      ];
    }
    const isNumeric = legacyCategory === 'numeric'
                   || registryEntry?.category === 'input' && type === 'number';
    if (isNumeric && !this._draft().referenceRanges) {
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

  onConditionsChange(rules: ConditionRule[]): void {
    this.patch({ showWhen: rules.length === 0 ? undefined : rules });
  }

  cancel() { this.backToBuilder(); }

  submit(): void {
    if (!this.canSave()) return;
    const stepId = this._stepId();
    if (!stepId) return;
    const d = this._draft();
    const isCustom = !d.isStandard;
    const name = d.name!.trim();
    const storageKey = d.storageKey ?? (isCustom ? `metadata.${name}` : name);
    const payload: Partial<WorkflowField> & { id?: string } = {
      ...d,
      name,
      isStandard: !!d.isStandard,
      storageKey,
      id: d.id ?? uuid()
    };

    if (this.mode() === 'edit' && payload.id) {
      this.builder.updateField(stepId, payload.id, payload);
    } else {
      this.builder.addField(stepId, payload);
    }
    this.backToBuilder();
  }

  private backToBuilder() {
    const screen = this._screen();
    if (screen) this.router.navigate(['/admin/workflows', screen]);
    else this.router.navigateByUrl('/admin/workflows');
  }
}

function emptyDraft(): Partial<WorkflowField> {
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

function toSnakeCase(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
