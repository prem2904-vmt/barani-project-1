import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { Department } from '../../../shared/models/tenant.model';
import { Test, TestParameter, TestParametersBlob } from '../../../shared/models/test.model';
import {
  ConditionEditorComponent,
  FieldOption,
  FieldTypePickerComponent,
  FormField,
  FormFieldType,
  ShowWhen,
  ValidationEditorComponent,
  ValidationPatch,
  hasOptions as registryHasOptions
} from '../../../shared/forms';
import { NumberInputComponent } from '../../../shared/primitives/number-input.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

interface DraftTest {
  id?: string;
  name: string;
  type: 'individual' | 'package';
  flow: 'direct' | 'approval';
  price: number;
  taxSlab: number;
  departmentId: string;
  tatHours: number;
  sampleType: string;
  parametersJson: string;
  conditionsJson: string;
  isActive: boolean;
}

function makeEmptyDraft(): DraftTest {
  return {
    name: '', type: 'individual', flow: 'direct',
    price: 0, taxSlab: 0,
    departmentId: '', tatHours: 24, sampleType: '',
    parametersJson: '', conditionsJson: '[]',
    isActive: true
  };
}

// Legacy TestParameter.type → new FormFieldType. Keeps round-tripping stable
// for tests created before the form-builder-style schema existed.
const LEGACY_TYPE_MAP: Record<string, FormFieldType> = {
  numeric:            'number',
  numeric_with_range: 'number',
  critical_numeric:   'number',
  text:               'text',
  textarea:           'textarea',
  select:             'select',
  multiselect:        'multiselect',
  radio:              'radio',
  button_select:      'buttonSelect',
  yesno:              'yesno',
  toggle:             'toggle',
  date:               'date'
};

// Back-map for save: FormFieldType → TestParameter.type. For types without a
// legacy equivalent (e.g. `section-header`, `info-text`) we fall through to
// a safe string so the JSON blob stays parseable by older clients.
const FORWARD_TYPE_MAP: Partial<Record<FormFieldType, TestParameter['type']>> = {
  number:      'numeric_with_range',
  text:        'text',
  textarea:    'textarea',
  select:      'select',
  multiselect: 'multiselect',
  radio:       'radio',
  buttonSelect:'button_select',
  yesno:       'yesno',
  toggle:      'toggle',
  date:        'date'
};

let fieldCounter = 0;
function newFieldId(): string {
  fieldCounter += 1;
  return `fld_${Date.now().toString(36)}_${fieldCounter}`;
}

@Component({
  selector: 'pf-test-editor',
  standalone: true,
  imports: [
    FormsModule,
    ConditionEditorComponent,
    FieldTypePickerComponent,
    NumberInputComponent,
    ValidationEditorComponent,
    ScreenHeaderComponent,
    SelectComponent,
    TileComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10">

      <pf-screen-header
        eyebrow="Admin · Tests"
        [title]="draft().id ? 'Edit test' : 'Create test'"
        [subtitle]="subtitle()">
        <pf-touch-btn actions size="sm" variant="ghost" (pressed)="back()">
          <span icon-left aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
          </span>
          Back
        </pf-touch-btn>
        <pf-touch-btn actions size="sm" variant="primary" [disabled]="saving()" (pressed)="saveTest()">
          {{ saving() ? 'Saving…' : 'Save' }}
        </pf-touch-btn>
      </pf-screen-header>

      @let d = draft();

      <!-- General -->
      <pf-tile tone="default" padding="lg" class="block mb-4">
        <h3 class="section-title">General</h3>
        <div class="space-y-3 mt-4">
          <div><label class="pf-label">Name</label>
            <input type="text" class="pf-input"
                   [ngModel]="d.name" (ngModelChange)="patch({ name: $event })" /></div>
          <div class="grid grid-cols-2 gap-2">
            <div><label class="pf-label">Type</label>
              <pf-select [options]="typeOptions" [value]="d.type" (valueChange)="patch({ type: $event })"></pf-select>
            </div>
            <div><label class="pf-label">Flow</label>
              <pf-select [options]="flowOptions" [value]="d.flow" (valueChange)="patch({ flow: $event })"></pf-select>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div><label class="pf-label">Department</label>
              <pf-select [options]="departmentOptions()" [value]="d.departmentId"
                         placeholder="— Select department —"
                         (valueChange)="patch({ departmentId: $event })"></pf-select>
            </div>
            <div><label class="pf-label">Sample type</label>
              <input type="text" class="pf-input" [ngModel]="d.sampleType"
                     (ngModelChange)="patch({ sampleType: $event })" /></div>
          </div>
        </div>
      </pf-tile>

      <!-- Pricing + TAT -->
      <pf-tile tone="default" padding="lg" class="block mb-4">
        <h3 class="section-title">Pricing & TAT</h3>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          <div><label class="pf-label">Price</label>
            <pf-number-input [value]="d.price" [min]="0" [step]="50" suffix="₹"
                             (valueChange)="patch({ price: $event ?? 0 })"></pf-number-input>
          </div>
          <div><label class="pf-label">Tax slab</label>
            <pf-number-input [value]="d.taxSlab" [min]="0" [max]="50" [step]="0.5" suffix="%"
                             (valueChange)="patch({ taxSlab: $event ?? 0 })"></pf-number-input>
          </div>
          <div><label class="pf-label">TAT</label>
            <pf-number-input [value]="d.tatHours" [min]="1" [step]="1" suffix="hrs"
                             (valueChange)="patch({ tatHours: $event ?? 1 })"></pf-number-input>
          </div>
        </div>
      </pf-tile>

      <!-- Parameters -->
      <pf-tile tone="default" padding="lg" class="block">
        <div class="flex items-center justify-between mb-3">
          <h3 class="section-title">Parameters ({{ fields().length }})</h3>
          <pf-touch-btn size="sm" variant="ghost" (pressed)="addParameter()">
            <span icon-left aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 5v14"/>
                <path d="M5 12h14"/>
              </svg>
            </span>
            Add parameter
          </pf-touch-btn>
        </div>

        @if (fields().length === 0) {
          <p class="text-[13px]" style="color: var(--text-tertiary);">
            No parameters yet. Add one to let lab staff enter results.
          </p>
        } @else {
          <div class="space-y-3">
            @for (p of fields(); let i = $index; track p.id) {
              <div class="param-row space-y-2">
                <div class="grid grid-cols-12 gap-2">
                  <div class="col-span-12 md:col-span-4">
                    <label class="text-[11px] font-mono" style="color: var(--text-muted);">Label</label>
                    <input type="text" class="pf-input text-sm"
                           [ngModel]="p.label"
                           (ngModelChange)="patchField(i, { label: $event, name: deriveName($event, p.name) })" />
                  </div>
                  <div class="col-span-6 md:col-span-3">
                    <label class="text-[11px] font-mono" style="color: var(--text-muted);">Type</label>
                    <pf-field-type-picker
                      [value]="p.type"
                      (valueChange)="patchField(i, { type: $event })">
                    </pf-field-type-picker>
                  </div>
                  <div class="col-span-5 md:col-span-3">
                    <label class="text-[11px] font-mono" style="color: var(--text-muted);">Unit</label>
                    <input type="text" class="pf-input text-sm"
                           [ngModel]="p.unit"
                           [disabled]="!isNumericType(p.type)"
                           (ngModelChange)="patchField(i, { unit: $event })" />
                  </div>
                  <div class="col-span-1 md:col-span-2 flex items-end justify-end">
                    <button type="button" class="param-remove"
                            (click)="removeField(i)" aria-label="Remove">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 6 6 18"/>
                        <path d="m6 6 12 12"/>
                      </svg>
                    </button>
                  </div>
                </div>

                @if (isNumericType(p.type)) {
                  <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div>
                      <label class="text-[11px] font-mono" style="color: var(--text-muted);">Normal min</label>
                      <pf-number-input size="sm" [allowEmpty]="true" [step]="0.1"
                                        [value]="(p.referenceRanges ?? [])[0]?.min ?? null"
                                        (valueChange)="patchRange(i, { min: $event ?? undefined })">
                      </pf-number-input>
                    </div>
                    <div>
                      <label class="text-[11px] font-mono" style="color: var(--text-muted);">Normal max</label>
                      <pf-number-input size="sm" [allowEmpty]="true" [step]="0.1"
                                        [value]="(p.referenceRanges ?? [])[0]?.max ?? null"
                                        (valueChange)="patchRange(i, { max: $event ?? undefined })">
                      </pf-number-input>
                    </div>
                    <div>
                      <label class="text-[11px] font-mono" style="color: var(--text-muted);">Critical low</label>
                      <pf-number-input size="sm" [allowEmpty]="true" [step]="0.1"
                                        [value]="p.criticalLow ?? null"
                                        (valueChange)="patchField(i, { criticalLow: $event ?? undefined })">
                      </pf-number-input>
                    </div>
                    <div>
                      <label class="text-[11px] font-mono" style="color: var(--text-muted);">Critical high</label>
                      <pf-number-input size="sm" [allowEmpty]="true" [step]="0.1"
                                        [value]="p.criticalHigh ?? null"
                                        (valueChange)="patchField(i, { criticalHigh: $event ?? undefined })">
                      </pf-number-input>
                    </div>
                  </div>
                }

                @if (typeHasOptions(p.type)) {
                  <div>
                    <label class="text-[11px] font-mono" style="color: var(--text-muted);">
                      Options (comma-separated)
                      @if ((p.options ?? []).length > 0) {
                        <span class="pf-option-count">{{ (p.options ?? []).length }}</span>
                      }
                    </label>
                    <input type="text" class="pf-input text-sm"
                           [ngModel]="optionsAsString(p)"
                           (ngModelChange)="onOptionsTyped(i, $event)"
                           placeholder="Positive, Negative, Equivocal" />
                    @if ((p.options ?? []).length > 0) {
                      <div class="pf-option-chips">
                        @for (opt of p.options ?? []; track opt.id) {
                          <span class="pf-option-chip">{{ opt.label }}</span>
                        }
                      </div>
                    }
                  </div>
                }

                <div class="pf-param-footer">
                  <pf-validation-editor
                    [type]="p.type"
                    [isRequired]="p.isRequired"
                    [validation]="p.validation ?? null"
                    (change)="patchValidation(i, $event)">
                  </pf-validation-editor>

                  <pf-condition-editor
                    [peers]="peersFor(i)"
                    [value]="p.showWhen ?? null"
                    (valueChange)="patchCondition(i, $event)"
                    (remove)="patchCondition(i, null)">
                  </pf-condition-editor>
                </div>
              </div>
            }
          </div>
        }
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
    .param-row {
      border-radius: 14px;
      padding: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
    }
    .param-remove {
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
    }
    .param-remove:hover {
      background: rgba(239, 68, 68, 0.15);
      color: #fca5a5;
      border-color: rgba(239, 68, 68, 0.3);
    }

    .pf-option-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 16px;
      padding: 0 5px;
      margin-left: 6px;
      border-radius: 9999px;
      background: rgba(168, 85, 247, 0.18);
      color: #c4b5fd;
      font-size: 10px;
      font-weight: 600;
    }
    .pf-option-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 6px;
    }
    .pf-option-chip {
      display: inline-flex;
      align-items: center;
      padding: 2px 10px;
      border-radius: 9999px;
      background: rgba(168, 85, 247, 0.12);
      color: var(--text-primary);
      font-size: 11px;
      font-weight: 500;
      border: 1px solid rgba(168, 85, 247, 0.25);
    }
    .pf-param-footer {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: flex-start;
    }
    .pf-param-footer > * { flex: 0 0 auto; }
  `]
})
export class TestEditorComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly typeOptions: PfSelectOption<'individual' | 'package'>[] = [
    { value: 'individual', label: 'Individual' },
    { value: 'package',    label: 'Package' }
  ];
  readonly flowOptions: PfSelectOption<'direct' | 'approval'>[] = [
    { value: 'direct',   label: 'Direct',   hint: 'Result goes straight to reports' },
    { value: 'approval', label: 'Approval', hint: 'Needs pathologist validation' }
  ];

  private readonly _departments = signal<Department[]>([]);
  readonly departments = this._departments.asReadonly();
  readonly departmentOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: '— None —' },
    ...this._departments().map(d => ({ value: d.id, label: d.name }))
  ]);

  private readonly _draft = signal<DraftTest>(makeEmptyDraft());
  readonly draft = this._draft.asReadonly();

  private readonly _fields = signal<FormField[]>([]);
  readonly fields = this._fields.asReadonly();

  private readonly _saving = signal(false);
  readonly saving = this._saving.asReadonly();

  readonly subtitle = computed(() =>
    this._draft().id
      ? 'Update name, pricing, parameters, or flow.'
      : 'Define what the lab collects, how it\'s priced, and the parameters captured.'
  );

  ngOnInit() {
    this.api.get<Department[]>('/api/tenants/departments').subscribe({
      next: l => this._departments.set(l ?? [])
    });

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.api.get<Test>(`/api/tests/${id}`).subscribe({
        next: t => this.hydrateFrom(t),
        error: () => this.toasts.error('Could not load test')
      });
    }
  }

  private hydrateFrom(t: Test) {
    this._draft.set({
      id: t.id, name: t.name, type: t.type, flow: t.flow,
      price: t.price, taxSlab: t.taxSlab,
      departmentId: t.departmentId ?? '', tatHours: t.tatHours,
      sampleType: t.sampleType ?? '',
      parametersJson: t.parameters ?? '', conditionsJson: t.conditions ?? '[]',
      isActive: t.isActive
    });
    this._fields.set(this.loadParameters(t.parameters ?? ''));
  }

  // Is this a numeric field (shows reference-range row)?
  isNumericType(t: FormFieldType): boolean {
    return t === 'number';
  }
  // Does the registry say this type has an options editor?
  typeHasOptions(t: FormFieldType): boolean { return registryHasOptions(t); }

  // Parse is lossy (it strips empty segments so "A, " normalises to [A]),
  // which used to eat trailing commas as the user typed. We keep the raw
  // string alongside the parsed FieldOption[] so the input stays stable
  // mid-type and only parses on write.
  protected optionsAsString(f: FormField): string {
    const draft = (f as FormField & { _optionsDraft?: string })._optionsDraft;
    if (typeof draft === 'string') return draft;
    return (f.options ?? []).map(o => o.label).join(', ');
  }
  protected parseOptions(s: string): FieldOption[] {
    return s.split(',').map(x => x.trim()).filter(Boolean).map((label, i) => ({
      id: `opt_${i}_${label.replace(/[^a-z0-9]/gi, '').slice(0, 8)}`,
      label,
      value: label,
      order: i
    }));
  }
  protected onOptionsTyped(i: number, raw: string) {
    this._fields.update(list => list.map((p, idx) => idx === i
      ? ({ ...p, _optionsDraft: raw, options: this.parseOptions(raw) } as FormField)
      : p));
    this.persistFieldsToDraft();
  }

  deriveName(label: string, currentName: string | undefined): string {
    if (currentName && currentName.trim() && !currentName.startsWith('new_param')) return currentName;
    return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || currentName || '';
  }

  // Peers available as condition sources — every OTHER field.
  peersFor(index: number): FormField[] {
    return this._fields().filter((_, i) => i !== index);
  }

  private loadParameters(draftJson: string): FormField[] {
    if (!draftJson) return [];
    try {
      const blob = JSON.parse(draftJson) as TestParametersBlob & { fields?: FormField[] };
      // New-format blobs carry `fields`; legacy blobs have `parameters`.
      if (Array.isArray(blob.fields)) return blob.fields;
      return (blob.parameters ?? []).map((p, i) => this.legacyToField(p, i));
    } catch { return []; }
  }

  private legacyToField(p: TestParameter, order: number): FormField {
    const type = LEGACY_TYPE_MAP[p.type] ?? 'text';
    return {
      id: p.id || newFieldId(),
      name: p.name,
      label: p.title,
      type,
      order,
      isRequired: false,
      isConditional: false,
      unit: p.unit,
      referenceRanges: p.referenceRanges ?? null,
      criticalLow: p.criticalLow ?? null,
      criticalHigh: p.criticalHigh ?? null,
      normalValue: p.normalValue ?? null,
      options: p.options?.map((label, i) => ({
        id: `opt_${i}_${(label || '').replace(/[^a-z0-9]/gi, '').slice(0, 8)}`,
        label: label ?? '',
        value: label ?? '',
        order: i
      })) ?? null
    };
  }

  private fieldToLegacy(f: FormField): TestParameter {
    const legacyType = FORWARD_TYPE_MAP[f.type] ?? 'text';
    return {
      id: f.id,
      name: f.name,
      title: f.label,
      type: legacyType,
      unit: f.unit ?? undefined,
      options: f.options?.map(o => o.label) ?? undefined,
      referenceRanges: (f.referenceRanges ?? undefined) as TestParameter['referenceRanges'],
      normalValue: f.normalValue ?? undefined,
      criticalLow: f.criticalLow ?? undefined,
      criticalHigh: f.criticalHigh ?? undefined
    };
  }

  private persistFieldsToDraft() {
    const fields = this._fields();
    // Strip transient UI state (e.g., _optionsDraft) so it never persists.
    const cleanFields = fields.map(f => {
      const { _optionsDraft, ...rest } = f as FormField & { _optionsDraft?: string };
      void _optionsDraft;
      return rest as FormField;
    });
    // Dual-write: keep `parameters` (legacy) in sync for older consumers,
    // add `fields` (new shape) so conditional visibility round-trips.
    const existing = (() => {
      try { return JSON.parse(this._draft().parametersJson || '{}'); } catch { return {}; }
    })();
    const blob = {
      ...existing,
      parameters: cleanFields.map(f => this.fieldToLegacy(f)),
      fields: cleanFields
    };
    this.patch({ parametersJson: JSON.stringify(blob) });
  }

  addParameter() {
    const idx = this._fields().length + 1;
    const field: FormField = {
      id: newFieldId(),
      name: `new_param_${idx}`,
      label: `New parameter ${idx}`,
      type: 'number',
      order: idx - 1,
      isRequired: false,
      isConditional: false,
      unit: '',
      referenceRanges: [{ segment: 'normal', min: null, max: null }]
    };
    this._fields.update(list => [...list, field]);
    this.persistFieldsToDraft();
  }

  patchField(i: number, updates: Partial<FormField>) {
    this._fields.update(list =>
      list.map((p, idx) => idx === i ? { ...p, ...updates } : p)
    );
    this.persistFieldsToDraft();
  }

  patchRange(i: number, updates: Partial<{ min: number | undefined; max: number | undefined }>) {
    this._fields.update(list => list.map((p, idx) => {
      if (idx !== i) return p;
      const ranges = [...(p.referenceRanges ?? [{ segment: 'normal' }])];
      ranges[0] = {
        ...ranges[0],
        segment: ranges[0].segment ?? 'normal',
        ...('min' in updates ? { min: updates.min ?? null } : {}),
        ...('max' in updates ? { max: updates.max ?? null } : {})
      };
      return { ...p, referenceRanges: ranges };
    }));
    this.persistFieldsToDraft();
  }

  patchCondition(i: number, showWhen: ShowWhen | null) {
    this._fields.update(list => list.map((p, idx) => idx === i
      ? { ...p, showWhen, isConditional: !!showWhen }
      : p));
    this.persistFieldsToDraft();
  }

  patchValidation(i: number, v: ValidationPatch) {
    this._fields.update(list => list.map((p, idx) => idx === i
      ? { ...p, isRequired: v.isRequired, validation: v.validation }
      : p));
    this.persistFieldsToDraft();
  }

  removeField(i: number) {
    this._fields.update(list => list.filter((_, idx) => idx !== i));
    this.persistFieldsToDraft();
  }

  patch(p: Partial<DraftTest>) { this._draft.update(d => ({ ...d, ...p })); }

  back() { this.router.navigateByUrl('/admin/tests'); }

  saveTest() {
    const d = this._draft();
    if (!d.name.trim()) { this.toasts.warning('Name is required'); return; }

    const body = {
      name: d.name, type: d.type, flow: d.flow,
      price: d.price, taxSlab: d.taxSlab,
      departmentId: d.departmentId || undefined,
      tatHours: d.tatHours, sampleType: d.sampleType || undefined,
      parametersJson: d.parametersJson || undefined,
      conditionsJson: d.conditionsJson || undefined,
      isActive: d.isActive
    };

    this._saving.set(true);
    if (d.id) {
      this.api.patch<Test>(`/api/tests/${d.id}`, body).subscribe({
        next: () => { this._saving.set(false); this.toasts.success('Updated'); this.back(); },
        error: e => { this._saving.set(false); this.toasts.error(e.message ?? 'Save failed'); }
      });
    } else {
      this.api.post<Test>('/api/tests/', body).subscribe({
        next: () => { this._saving.set(false); this.toasts.success('Created'); this.back(); },
        error: e => { this._saving.set(false); this.toasts.error(e.message ?? 'Save failed'); }
      });
    }
  }
}
