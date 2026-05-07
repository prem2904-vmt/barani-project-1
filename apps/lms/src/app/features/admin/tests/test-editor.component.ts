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
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { TestLayoutEditorComponent } from './test-layout-editor.component';

type TestEditorTab = 'parameters' | 'layout';

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
    SegmentedComponent,
    SelectComponent,
    TileComponent,
    TouchButtonComponent,
    TestLayoutEditorComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10 mx-auto w-full" style="max-width: 1440px;">

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

      <!-- General + Pricing side-by-side on wide screens so the top of the
           form uses horizontal space instead of stacking two short cards. -->
      <div class="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 mb-4">

        <!-- General -->
        <pf-tile tone="default" padding="lg" class="block">
          <h3 class="section-title">General</h3>
          <div class="space-y-3 mt-4">
            <div><label class="pf-label">Name</label>
              <input type="text" class="pf-input"
                     [ngModel]="d.name" (ngModelChange)="patch({ name: $event })" /></div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div><label class="pf-label">Type</label>
                <pf-select [options]="typeOptions" [value]="d.type" (valueChange)="patch({ type: $event })"></pf-select>
              </div>
              <div><label class="pf-label">Flow</label>
                <pf-select [options]="flowOptions" [value]="d.flow" (valueChange)="patch({ flow: $event })"></pf-select>
              </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
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

        <!-- Pricing + TAT — 1-col on lg (it's narrower), 3-col on smaller. -->
        <pf-tile tone="default" padding="lg" class="block">
          <h3 class="section-title">Pricing & TAT</h3>
          <div class="grid grid-cols-3 lg:grid-cols-1 gap-3 mt-4">
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
      </div>

      <!-- Tab strip — sits between Pricing & TAT and the Parameters / Report
           Layout content so admins don't have to scroll to find the layout
           editor, but General + Pricing stay always visible up top. -->
      <div class="mb-4">
        <pf-segmented
          [options]="tabOptions()"
          [value]="tab()"
          size="md"
          (valueChange)="setTab($event)">
        </pf-segmented>
        @if (!d.id && tab() === 'layout') {
          <p class="mt-2 text-[12px]" style="color: var(--text-tertiary);">
            Save the test first — the report layout editor needs an id to attach to.
          </p>
        }
      </div>

      @if (tab() === 'parameters') {

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
          <ul class="flex flex-col gap-2 list-none p-0 m-0">
            @for (p of fields(); let i = $index; track p.id) {
              @let open = expandedParamId() === p.id;
              <li class="param-row" [class.param-row--open]="open">
                <!-- Collapsed summary: one-line scan view. Click anywhere on
                     the header to toggle; remove button is the only action
                     that doesn't bubble through to the toggle. -->
                <button type="button" class="param-row__summary"
                        (click)="toggleParam(p.id)">
                  <span class="param-row__chev" [class.param-row__chev--open]="open">▸</span>
                  <span class="param-row__name">{{ p.label || 'Untitled parameter' }}</span>
                  <span class="param-row__type-pill">{{ p.type }}</span>
                  @if (paramSummary(p)) {
                    <span class="param-row__meta">{{ paramSummary(p) }}</span>
                  }
                  @if (p.isRequired) {
                    <span class="param-row__pill param-row__pill--req" title="Required">REQ</span>
                  }
                  @if (p.showWhen) {
                    <span class="param-row__pill param-row__pill--cond" title="Conditional visibility">IF</span>
                  }
                  <span class="grow"></span>
                  <span class="param-remove" role="button" aria-label="Remove parameter"
                        (click)="$event.stopPropagation(); removeField(i)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M18 6 6 18"/>
                      <path d="m6 6 12 12"/>
                    </svg>
                  </span>
                </button>

                @if (open) {
                  <div class="param-row__body">
                    <!-- Top row: Label / Type / Unit. Tailwind utilities so
                         the responsive layout doesn't fight Angular's view
                         encapsulation. Stacks on phones, side-by-side on
                         tablets+. -->
                    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1.2fr_1fr] items-end">
                      <label class="flex flex-col gap-1 min-w-0">
                        <span class="pf-mini-lbl">Label</span>
                        <input type="text" class="pf-input pf-input--compact"
                               [ngModel]="p.label"
                               (ngModelChange)="patchField(i, { label: $event, name: deriveName($event, p.name) })" />
                      </label>
                      <label class="flex flex-col gap-1 min-w-0">
                        <span class="pf-mini-lbl">Type</span>
                        <pf-field-type-picker
                          [value]="p.type"
                          (valueChange)="patchField(i, { type: $event })">
                        </pf-field-type-picker>
                      </label>
                      <label class="flex flex-col gap-1 min-w-0">
                        <span class="pf-mini-lbl">Unit</span>
                        <input type="text" class="pf-input pf-input--compact"
                               [ngModel]="p.unit"
                               [disabled]="!isNumericType(p.type)"
                               (ngModelChange)="patchField(i, { unit: $event })"
                               placeholder="—" />
                      </label>
                    </div>

                    @if (isNumericType(p.type)) {
                      <div class="param-row__ranges">
                        <span class="pf-mini-lbl pf-mini-lbl--strong">Range</span>
                        <div class="grid gap-2 grid-cols-2 md:grid-cols-4">
                          <label class="flex flex-col gap-0.5 min-w-0">
                            <span class="pf-mini-lbl">Normal min</span>
                            <pf-number-input size="sm" [allowEmpty]="true" [step]="0.1"
                                              [value]="(p.referenceRanges ?? [])[0]?.min ?? null"
                                              (valueChange)="patchRange(i, { min: $event ?? undefined })">
                            </pf-number-input>
                          </label>
                          <label class="flex flex-col gap-0.5 min-w-0">
                            <span class="pf-mini-lbl">Normal max</span>
                            <pf-number-input size="sm" [allowEmpty]="true" [step]="0.1"
                                              [value]="(p.referenceRanges ?? [])[0]?.max ?? null"
                                              (valueChange)="patchRange(i, { max: $event ?? undefined })">
                            </pf-number-input>
                          </label>
                          <label class="flex flex-col gap-0.5 min-w-0">
                            <span class="pf-mini-lbl">Critical low</span>
                            <pf-number-input size="sm" [allowEmpty]="true" [step]="0.1"
                                              [value]="p.criticalLow ?? null"
                                              (valueChange)="patchField(i, { criticalLow: $event ?? undefined })">
                            </pf-number-input>
                          </label>
                          <label class="flex flex-col gap-0.5 min-w-0">
                            <span class="pf-mini-lbl">Critical high</span>
                            <pf-number-input size="sm" [allowEmpty]="true" [step]="0.1"
                                              [value]="p.criticalHigh ?? null"
                                              (valueChange)="patchField(i, { criticalHigh: $event ?? undefined })">
                            </pf-number-input>
                          </label>
                        </div>
                      </div>
                    }

                    @if (typeHasOptions(p.type)) {
                      <label class="flex flex-col gap-1 min-w-0">
                        <span class="pf-mini-lbl">
                          Options (comma-separated)
                          @if ((p.options ?? []).length > 0) {
                            <span class="pf-option-count">{{ (p.options ?? []).length }}</span>
                          }
                        </span>
                        <input type="text" class="pf-input pf-input--compact"
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
                      </label>
                    }

                    <div class="grid gap-2 sm:grid-cols-2">
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
              </li>
            }
          </ul>
        }
      </pf-tile>

      } @else if (tab() === 'layout') {
        <!-- Report Layout — gated until the test has an id (the layout
             endpoints all key off testId). -->
        @if (d.id) {
          <pf-test-layout-editor class="block"
            [testId]="d.id || ''"
            [departmentId]="d.departmentId || ''"
            [parameters]="parameterNames()">
          </pf-test-layout-editor>
        } @else {
          <pf-tile tone="default" padding="lg" class="block">
            <p class="text-[13px]" style="color: var(--text-tertiary);">
              <strong style="color: var(--text-secondary);">Report Layout</strong>
              — save this test first, then come back to this tab to design how the
              test's results render in the patient report.
            </p>
          </pf-tile>
        }
      }
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

    /* ── Parameter row ── */
    .param-row {
      border-radius: 10px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      transition: border-color 0.15s ease, background 0.15s ease;
      overflow: hidden;
    }
    .param-row:hover { border-color: rgba(168, 85, 247, 0.3); }
    .param-row--open {
      border-color: rgba(168, 85, 247, 0.45);
      background: rgba(168, 85, 247, 0.04);
    }

    .param-row__summary {
      width: 100%;
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      padding: 10px 12px;
      background: transparent;
      border: 0;
      cursor: pointer;
      color: var(--text-primary);
      text-align: left;
      transition: background 0.12s ease;
    }
    .param-row__summary:hover { background: rgba(168, 85, 247, 0.06); }
    .param-row__summary > .grow { flex: 1 1 auto; }

    .param-row__chev {
      display: inline-block;
      font-size: 11px;
      color: var(--text-muted);
      transition: transform 0.18s ease, color 0.18s ease;
      flex-shrink: 0;
    }
    .param-row__chev--open { transform: rotate(90deg); color: #c4b5fd; }

    .param-row__name {
      font-size: 13.5px; font-weight: 600;
      color: var(--text-primary);
      max-width: 100%;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .param-row__type-pill {
      padding: 2px 8px;
      font-size: 9.5px; font-weight: 800;
      letter-spacing: 0.14em; text-transform: uppercase;
      border-radius: 9999px;
      background: rgba(168, 85, 247, 0.16);
      border: 1px solid rgba(168, 85, 247, 0.36);
      color: #c4b5fd;
      flex-shrink: 0;
    }
    .param-row__meta {
      font-size: 11.5px;
      color: var(--text-tertiary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      max-width: 320px;
    }
    .param-row__pill {
      padding: 2px 7px;
      font-size: 9px; font-weight: 800;
      letter-spacing: 0.14em; text-transform: uppercase;
      border-radius: 9999px;
      flex-shrink: 0;
    }
    .param-row__pill--req {
      background: rgba(244, 63, 94, 0.14);
      border: 1px solid rgba(244, 63, 94, 0.3);
      color: #fda4af;
    }
    .param-row__pill--cond {
      background: rgba(245, 158, 11, 0.14);
      border: 1px solid rgba(245, 158, 11, 0.3);
      color: #fcd34d;
    }

    .param-row__body {
      display: flex; flex-direction: column;
      gap: 12px;
      padding: 4px 12px 12px;
      border-top: 1px dashed rgba(168, 85, 247, 0.3);
    }

    /* Compact remove button — dimmed, brightens on row hover. */
    .param-remove {
      width: 28px; height: 28px;
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      background: transparent;
      border: 1px solid transparent;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease, opacity 0.15s ease;
      opacity: 0.45;
      flex-shrink: 0;
    }
    .param-row:hover .param-remove { opacity: 0.85; }
    .param-remove:hover {
      background: rgba(239, 68, 68, 0.16);
      color: #fca5a5;
      border-color: rgba(239, 68, 68, 0.36);
      opacity: 1;
    }

    .pf-input--compact { padding: 7px 10px; font-size: 13px; }

    .pf-mini-lbl {
      font-size: 10px; font-weight: 700;
      letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--text-muted);
    }
    .pf-mini-lbl--strong {
      color: var(--text-secondary);
    }

    /* ── Range row card ── */
    .param-row__ranges {
      display: flex; flex-direction: column; gap: 6px;
      padding: 10px;
      border-radius: 10px;
      background: rgba(0, 0, 0, 0.18);
      border: 1px dashed var(--glass-border);
    }

    /* ── Option chips ── */
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
      display: flex; flex-wrap: wrap; gap: 4px;
      margin-top: 4px;
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

  // Parameter rows collapse to a one-line summary by default — admins
  // browse the list, expand the row they care about, edit, collapse. Cuts
  // vertical sprawl on long tests dramatically. Single-open per editor so
  // expanding one row collapses the previously-open one.
  private readonly _expandedParamId = signal<string | null>(null);
  readonly expandedParamId = this._expandedParamId.asReadonly();
  toggleParam(id: string) {
    this._expandedParamId.update(cur => cur === id ? null : id);
  }

  /** Compact one-line description used by collapsed param rows. */
  paramSummary(p: FormField): string {
    const bits: string[] = [];
    if (this.isNumericType(p.type)) {
      const r = (p.referenceRanges ?? [])[0];
      if (r && (r.min != null || r.max != null)) {
        bits.push(`${r.min ?? '–'} – ${r.max ?? '–'}${p.unit ? ' ' + p.unit : ''}`);
      } else if (p.unit) {
        bits.push(p.unit);
      }
    } else if (this.typeHasOptions(p.type)) {
      const opts = (p.options ?? []).slice(0, 3).map(o => o.label).join(' · ');
      if (opts) bits.push(opts + ((p.options ?? []).length > 3 ? '…' : ''));
    } else if (p.unit) {
      bits.push(p.unit);
    }
    return bits.join(' · ');
  }

  // Tabs gate the lower half of the editor (Parameters vs Report layout).
  // General + Pricing & TAT live ABOVE the tabs and are always visible.
  // Layout is the secondary tab so first-time creates land on parameters —
  // admins can't fill the layout until the test has an id anyway.
  private readonly _tab = signal<TestEditorTab>('parameters');
  readonly tab = this._tab.asReadonly();
  setTab(t: TestEditorTab) { this._tab.set(t); }
  readonly tabOptions = computed<SegmentedOption<TestEditorTab>[]>(() => [
    { value: 'parameters', label: 'Parameters' },
    { value: 'layout',     label: 'Report layout' }
  ]);

  private readonly _fields = signal<FormField[]>([]);
  readonly fields = this._fields.asReadonly();
  /** Flat list of parameter machine names — used by the report layout editor
   *  for parameter-pickers + sample-value inputs in the live preview. */
  readonly parameterNames = computed<string[]>(() =>
    this._fields()
      .map(f => (f.name ?? '').trim())
      .filter(n => n.length > 0)
  );

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
