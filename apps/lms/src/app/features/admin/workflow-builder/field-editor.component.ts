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
import { ApiError } from '../../../shared/models/api-response.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { FieldTypePickerComponent, getFieldType, hasOptions as registryHasOptions } from '../../../shared/forms';
import { ConditionBuilderComponent } from './condition-builder.component';
import { WorkflowBuilderService } from './workflow-builder.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ThemeService } from '../../../core/services/theme.service';

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
    TouchButtonComponent,
    HeroBandComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10 field-editor-page" [class.pf-band-page]="theme.isNewDesign()">

      @if (theme.isNewDesign()) {
        <!-- ND "Editors": band = back (to the workflow) · tenant · the ONE
             primary; pill = CONTEXT BAR (the field + where it lives). -->
        <pf-hero-band class="pf-fe-band" [back]="true" [backAction]="backFn" [customSearch]="true" [contextBar]="true">
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--primary pf-fe-save" [disabled]="!canSave()" (click)="submit()"
                    [attr.aria-label]="mode() === 'edit' ? 'Save changes' : 'Add field'" [title]="mode() === 'edit' ? 'Save changes' : 'Add field'">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                @if (mode() === 'edit') { <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/> }
                @else { <path d="M12 5v14"/><path d="M5 12h14"/> }
              </svg>
              {{ mode() === 'edit' ? 'Save changes' : 'Add field' }}
            </button>
          </ng-container>
          <!-- The pill = the field label + a tiny muted Type badge (PF-PATTERN
               §14). Form / step / key are shown in the form itself. -->
          <div band-search class="pf-ctx pf-fe-ctx">
            <span class="pf-ctx__primary">
              <span class="pf-fe-ctx__name">{{ draft().title?.trim() || (mode() === 'edit' ? 'Edit field' : 'New field') }}</span>
              <span class="pf-fe-ctx__badge" data-k="Type" title="Field type">{{ typeLabel() }}</span>
            </span>
          </div>
        </pf-hero-band>
      }

      <pf-screen-header class="pf-classic-only"
        [eyebrow]="eyebrow()"
        [title]="title()"
        [subtitle]="subtitle()">
        <pf-touch-btn actions size="sm" variant="ghost" (pressed)="cancel()">Back</pf-touch-btn>
        <pf-touch-btn actions size="sm" variant="primary" [disabled]="!canSave()" (pressed)="submit()">
          {{ mode() === 'edit' ? 'Save changes' : 'Add field' }}
        </pf-touch-btn>
      </pf-screen-header>

      <div class="pf-fe-body" [class.pf-band-body]="theme.isNewDesign()">
      <!-- Basics -->
      <section class="pf-card pf-fe-card">
        <div class="pf-card__head">
          <span class="pf-card__icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 12 22l-8.59-8.59A2 2 0 0 1 3 12V5a2 2 0 0 1 2-2h7a2 2 0 0 1 1.41.59L22 12z"/><circle cx="7.5" cy="7.5" r=".5"/></svg></span>
          <h2 class="pf-card__label pf-fe-h">Basics</h2>
          @if (stepTitle()) { <span class="pf-card__note">{{ screenLabel() }} · step “{{ stepTitle() }}”</span> }
        </div>
        <div class="pf-card__body pf-fe-cardbody">
          <div class="pf-fe-grid2">
            <label class="pf-field">
              <span class="pf-field__lbl">Label <span class="pf-fe-req" aria-hidden="true">*</span></span>
              <input type="text" class="pf-input" [ngModel]="draft().title" (ngModelChange)="setTitle($event)" />
            </label>
            <label class="pf-field">
              <span class="pf-field__lbl">Name <span class="pf-fe-mut">(storage key — fixed)</span></span>
              <input type="text" class="pf-input pf-num"
                     [class.pf-input--error]="!!nameError()"
                     [ngModel]="draft().name"
                     [readonly]="mode() === 'edit'"
                     (ngModelChange)="nameError.set(null); patch({ name: $event })" />
              @if (nameError(); as ne) {
                <p class="pf-field-error">{{ ne }}</p>
              }
            </label>
          </div>

          <div class="pf-fe-grid2">
            <div class="pf-field">
              <span class="pf-field__lbl">Type <span class="pf-fe-req" aria-hidden="true">*</span></span>
              <!-- Shared field-type picker (full taxonomy; registry-disabled
                   types filtered out). Only the storage Name stays fixed. -->
              <pf-field-type-picker [value]="$any(draft().type)" (valueChange)="setType($any($event))"></pf-field-type-picker>
            </div>
            <div class="pf-field">
              <span class="pf-field__lbl">Width</span>
              <pf-select [options]="widthSelectOptions" [value]="draft().width ?? 'full'"
                         (valueChange)="patch({ width: $any($event) })"></pf-select>
            </div>
          </div>

          <div class="pf-fe-switches">
            <button type="button" class="pf-toggle pf-fe-toggle" role="switch" [attr.aria-checked]="!!draft().isRequired"
                    (click)="patch({ isRequired: !draft().isRequired })">
              <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
              <span>Required</span>
            </button>
            <button type="button" class="pf-toggle pf-fe-toggle" role="switch" [attr.aria-checked]="isCustom()"
                    [disabled]="mode() === 'edit'" (click)="setStandard(isCustom())">
              <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
              <span>Custom field <span class="pf-fe-mut">(stores to metadata)</span></span>
            </button>
          </div>
        </div>
      </section>

      @if (category() === 'text') {
        <section class="pf-card pf-fe-card">
          <div class="pf-card__head">
            <span class="pf-card__icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg></span>
            <h2 class="pf-card__label pf-fe-h">Hints</h2>
          </div>
          <div class="pf-card__body pf-fe-cardbody">
            <label class="pf-field">
              <span class="pf-field__lbl">Placeholder</span>
              <input type="text" class="pf-input" [ngModel]="draft().placeholder" (ngModelChange)="patch({ placeholder: $event })" />
            </label>
            <label class="pf-field">
              <span class="pf-field__lbl">Helper text</span>
              <input type="text" class="pf-input" [ngModel]="draft().helperText" (ngModelChange)="patch({ helperText: $event })" />
            </label>
          </div>
        </section>
      }

      @if (category() === 'numeric') {
        <section class="pf-card pf-fe-card">
          <div class="pf-card__head">
            <span class="pf-card__icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h16"/><path d="M4 15h16"/><path d="M10 3 8 21"/><path d="M16 3l-2 18"/></svg></span>
            <h2 class="pf-card__label pf-fe-h">Numeric config</h2>
          </div>
          <div class="pf-card__body pf-fe-cardbody">
            <label class="pf-field pf-fe-unit">
              <span class="pf-field__lbl">Unit</span>
              <input type="text" class="pf-input" [ngModel]="draft().unit" (ngModelChange)="patch({ unit: $event })" />
            </label>

            <div class="pf-fe-sub">
              <h3 class="pf-fe-h3">Reference ranges</h3>
              @for (range of draft().referenceRanges ?? []; let i = $index; track i) {
                <div class="range-row">
                  <label class="pf-field pf-fe-grow">
                    <span class="pf-field__lbl">Segment</span>
                    <input type="text" class="pf-input" [ngModel]="range.segment" (ngModelChange)="patchRange(i, { segment: $event })"
                           placeholder="normal | adult_male | adult_female | child" />
                  </label>
                  <label class="pf-field pf-fe-num">
                    <span class="pf-field__lbl">Min</span>
                    <input type="number" class="pf-input pf-num" step="any" [ngModel]="range.min" (ngModelChange)="patchRange(i, { min: numOrUndef($event) })" />
                  </label>
                  <label class="pf-field pf-fe-num">
                    <span class="pf-field__lbl">Max</span>
                    <input type="number" class="pf-input pf-num" step="any" [ngModel]="range.max" (ngModelChange)="patchRange(i, { max: numOrUndef($event) })" />
                  </label>
                  <button type="button" class="field-remove" (click)="removeRange(i)" aria-label="Remove range" title="Remove range">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                  </button>
                </div>
              }
              <button type="button" class="pf-btn pf-btn--tertiary pf-fe-add" (click)="addRange()">+ Add range</button>
            </div>

            <div class="pf-fe-grid2">
              <label class="pf-field">
                <span class="pf-field__lbl">Critical low</span>
                <input type="number" class="pf-input pf-num" step="any" [ngModel]="draft().criticalLow" (ngModelChange)="patch({ criticalLow: numOrUndef($event) })" />
              </label>
              <label class="pf-field">
                <span class="pf-field__lbl">Critical high</span>
                <input type="number" class="pf-input pf-num" step="any" [ngModel]="draft().criticalHigh" (ngModelChange)="patch({ criticalHigh: numOrUndef($event) })" />
              </label>
            </div>
          </div>
        </section>
      }

      @if (category() === 'options') {
        <section class="pf-card pf-fe-card">
          <div class="pf-card__head">
            <span class="pf-card__icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg></span>
            <h2 class="pf-card__label pf-fe-h">Options</h2>
          </div>
          <div class="pf-card__body pf-fe-cardbody">
            @for (opt of draft().options ?? []; let i = $index; track i) {
              <div class="option-row">
                <label class="pf-field pf-fe-grow">
                  <span class="pf-field__lbl">Label</span>
                  <input type="text" class="pf-input" [ngModel]="opt.label" (ngModelChange)="patchOption(i, { label: $event, value: $event })" />
                </label>
                <label class="pf-field pf-fe-val">
                  <span class="pf-field__lbl">Value</span>
                  <input type="text" class="pf-input pf-num" [ngModel]="opt.value" (ngModelChange)="patchOption(i, { value: $event })" />
                </label>
                <button type="button" class="field-remove" (click)="removeOption(i)" aria-label="Remove option" title="Remove option">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
            }
            <button type="button" class="pf-btn pf-btn--tertiary pf-fe-add" (click)="addOption()">+ Add option</button>

            <div class="pf-field pf-fe-normal">
              <span class="pf-field__lbl">Normal value <span class="pf-fe-mut">(optional)</span></span>
              <pf-select [options]="normalValueSelectOptions()" [value]="(draft().normalValue ?? '') + ''" placeholder="—"
                         (valueChange)="patch({ normalValue: $any($event) || undefined })"></pf-select>
            </div>
          </div>
        </section>
      }

      @if (category() === 'boolean') {
        <section class="pf-card pf-fe-card">
          <div class="pf-card__head">
            <span class="pf-card__icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="16" cy="12" r="3"/></svg></span>
            <h2 class="pf-card__label pf-fe-h">Labels</h2>
          </div>
          <div class="pf-card__body pf-fe-cardbody">
            <div class="pf-fe-grid2">
              <label class="pf-field">
                <span class="pf-field__lbl">Positive label</span>
                <input type="text" class="pf-input" [ngModel]="(draft().options?.[0]?.label) ?? 'Yes'" (ngModelChange)="patchOption(0, { label: $event, value: $event })" />
              </label>
              <label class="pf-field">
                <span class="pf-field__lbl">Negative label</span>
                <input type="text" class="pf-input" [ngModel]="(draft().options?.[1]?.label) ?? 'No'" (ngModelChange)="patchOption(1, { label: $event, value: $event })" />
              </label>
            </div>
            <div class="pf-field pf-fe-normal">
              <span class="pf-field__lbl">Normal value</span>
              <pf-select [options]="booleanNormalSelectOptions()" [value]="(draft().normalValue ?? '') + ''" placeholder="—"
                         (valueChange)="patch({ normalValue: $any($event) || undefined })"></pf-select>
            </div>
          </div>
        </section>
      }

      <section class="pf-card pf-fe-card">
        <div class="pf-card__head">
          <span class="pf-card__icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg></span>
          <h2 class="pf-card__label pf-fe-h">Show when</h2>
        </div>
        <div class="pf-card__body pf-fe-cardbody">
          <pf-condition-builder [rules]="draft().showWhen ?? []" [fields]="availableFields()" emptyLabel="Always visible."
            (rulesChange)="onConditionsChange($event)"></pf-condition-builder>
        </div>
      </section>
      </div>
    </section>
  `,
  styles: [`
    .pf-fe-ctx__badge { flex: none; margin-left: 6px; padding: 1px 6px; border-radius: 6px; border: 1px solid var(--pf-line);
      background: var(--pf-chip-bg); font-size: 11px; font-weight: 500; line-height: 1.4; color: var(--text-tertiary); }
    .pf-fe-body { display: flex; flex-direction: column; gap: 14px; }
    .pf-fe-card .pf-card__body { overflow: visible; }
    .pf-fe-cardbody { gap: 14px; padding: 14px 16px 16px; }
    .pf-fe-h { margin: 0; }
    .pf-fe-h3 { margin: 0; font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .pf-fe-sub { display: flex; flex-direction: column; gap: 10px; }
    .pf-fe-grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; }
    .pf-fe-switches { display: flex; flex-wrap: wrap; gap: 12px 28px; }
    .pf-fe-toggle { min-height: 40px; font-size: 13px; }
    .pf-fe-req { color: var(--red-text, #b91c1c); }
    .pf-fe-mut { color: var(--text-tertiary); font-weight: 400; }
    .pf-fe-unit { max-width: 220px; }
    .pf-fe-normal { max-width: 320px; }
    .pf-fe-add { align-self: flex-start; height: 34px; min-height: 34px; font-size: 12.5px; }
    .range-row, .option-row { display: flex; align-items: flex-end; gap: 8px; }
    .pf-fe-grow { flex: 1 1 auto; }
    .pf-fe-num { width: 110px; flex: none; }
    .pf-fe-val { width: 170px; flex: none; }
    .pf-field-error { margin: 4px 0 0; font-size: 12px; color: var(--red-text); }
    .field-remove {
      width: 40px; height: 40px; flex: none; border-radius: 8px;
      display: inline-flex; align-items: center; justify-content: center;
      color: var(--text-tertiary); background: transparent; border: 1px solid transparent; cursor: pointer;
    }
    @media (hover: hover) { .field-remove:hover { color: var(--red-text); border-color: var(--pf-line); } }
    @media (pointer: coarse) { .field-remove { width: 44px; height: 44px; } }
    @media (max-width: 640px) {
      .pf-fe-grid2 { grid-template-columns: 1fr; }
      .range-row, .option-row { flex-wrap: wrap; }
      .range-row > .pf-field, .option-row > .pf-field { flex: 1 1 8rem; width: auto; min-width: 0; }
      .range-row > .pf-field:first-child, .option-row > .pf-field:first-child { flex-basis: 100%; }
      .range-row > .field-remove, .option-row > .field-remove { margin-left: auto; }
      .pf-fe-unit, .pf-fe-normal { max-width: none; }
    }
  `]
})
export class FieldEditorComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  protected readonly builder = inject(WorkflowBuilderService);
  protected readonly theme = inject(ThemeService);
  /** Band back chevron: return to this field's workflow editor. */
  readonly backFn = () => this.backToBuilder();

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

  /** Inline error for the storage-key Name input (set when a save is
   *  rejected with field === 'name'); otherwise failures surface as a toast. */
  readonly nameError = signal<string | null>(null);

  readonly draft = this._draft.asReadonly();
  readonly mode = computed<'create' | 'edit'>(() => this._fieldId() ? 'edit' : 'create');
  readonly title = computed(() => this.mode() === 'edit' ? 'Edit field' : 'Add field');
  readonly eyebrow = computed(() => {
    const screen = this._screen() ?? '';
    const stepName = this.builder.workflow()?.steps.find(s => s.id === this._stepId())?.title ?? '';
    return stepName ? `Workflow · ${screen} · ${stepName}` : `Workflow · ${screen}`;
  });
  /** Context-bar chips: the form, the step and the field type. */
  readonly screenLabel = computed(() => {
    const t = this.builder.workflow()?.title;
    if (t) return t;
    const sc = this._screen() ?? '';
    return sc.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  });
  readonly stepTitle = computed(() =>
    this.builder.workflow()?.steps.find(s => s.id === this._stepId())?.title ?? '');
  readonly typeLabel = computed(() => {
    const t = this._draft().type;
    return TYPE_META.find(m => m.type === t)?.label ?? getFieldType(t as never)?.label ?? String(t ?? '—');
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
        error: e => this.toasts.error(ApiError.from(e).message)
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

    this.nameError.set(null);
    try {
      if (this.mode() === 'edit' && payload.id) {
        this.builder.updateField(stepId, payload.id, payload);
      } else {
        this.builder.addField(stepId, payload);
      }
    } catch (e) {
      const err = ApiError.from(e);
      // Field-named failures highlight the offending input; everything else toasts.
      if (err.field === 'name') this.nameError.set(err.message);
      else this.toasts.error(err.message);
      return;
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
