import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ReportLayoutService } from '../../../core/services/report-layout.service';
import { Department } from '../../../shared/models/tenant.model';
import { Test, TestParameter, TestParametersBlob } from '../../../shared/models/test.model';
import { ReferralLab } from '../../../shared/models/referral-lab.model';
import { ApiError } from '../../../shared/models/api-response.model';
import {
  ConditionEditorComponent,
  FieldOption,
  FieldTypePickerComponent,
  FormField,
  FormFieldType,
  ReferenceRange,
  ShowWhen,
  ValidationEditorComponent,
  ValidationPatch,
  hasOptions as registryHasOptions
} from '../../../shared/forms';
import { NumberInputComponent } from '../../../shared/primitives/number-input.component';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { TestLayoutEditorComponent } from './test-layout-editor.component';
import { TestNotesEditorComponent } from '../report-template/test-notes-editor.component';
import { TestConsumablesComponent } from './test-consumables.component';
import { AuthService } from '../../../core/auth/auth.service';
import { describeAllRanges, deriveRangeLabel } from '../../../shared/utils/reference-range';

/** Left-rail sections. One shows at a time (progressive disclosure) instead of
 *  stacking every field card on one screen. */
/** Label of the synthetic picker group holding the already-chosen members. */
const SELECTED_GROUP = 'Selected';

type TestSection = 'identity' | 'pricing' | 'sample' | 'results' | 'layout' | 'consumables';

interface DraftTest {
  id?: string;
  name: string;
  type: 'individual' | 'profile' | 'package';
  flow: 'direct' | 'approval';
  price: number;
  taxSlab: number;
  departmentId: string;
  tatHours: number;
  sampleType: string;
  /** Tube/vial colour: '' | 'red' | 'lavender' | 'grey' | 'blue'. Drives vial
   *  grouping (one vial per space + colour). '' = fall back to dept colour. */
  tubeColor: string;
  // ── Master-data details ('' / 0 = unset) ──
  testCode: string;
  shortName: string;
  section: string;
  /** Profile-group tag from the test catalogue (e.g. "LFT", "Lipid Profile"). */
  profile: string;
  sampleVolumeMl: number | null;
  fastingRequired: boolean;
  methodology: string;
  resultType: string;
  unit: string;
  reportFormat: string;
  adultReferenceRange: string;
  criticalLow: number | null;
  criticalHigh: number | null;
  parametersJson: string;
  conditionsJson: string;
  isActive: boolean;
  /** Outsourcing: referral lab this test is subcontracted to ('' = in-house). */
  outsourcedVendorId: string;
  /** Department-at-vendor for outsourced vial grouping ('' = use the test's department). */
  outsourcedDepartmentId: string;
}

function makeEmptyDraft(): DraftTest {
  return {
    name: '', type: 'individual', flow: 'direct',
    price: 0, taxSlab: 0,
    departmentId: '', tatHours: 24, sampleType: '', tubeColor: '',
    testCode: '', shortName: '', section: '', profile: '',
    sampleVolumeMl: null, fastingRequired: false,
    methodology: '', resultType: '', unit: '', reportFormat: '',
    adultReferenceRange: '', criticalLow: null, criticalHigh: null,
    parametersJson: '', conditionsJson: '[]',
    isActive: true,
    outsourcedVendorId: '', outsourcedDepartmentId: ''
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
    RouterLink,
    FormsModule,
    ConditionEditorComponent,
    CurrencyInrPipe,
    FieldTypePickerComponent,
    NumberInputComponent,
    ValidationEditorComponent,
    ScreenHeaderComponent,
    SegmentedComponent,
    SelectComponent,
    TileComponent,
    TouchButtonComponent,
    TestLayoutEditorComponent,
    TestNotesEditorComponent,
    TestConsumablesComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10 mx-auto w-full" style="max-width: 1440px;">

      <pf-screen-header
        eyebrow="Admin · Tests"
        [title]="(draft().id ? 'Edit ' : 'Create ') + (draft().type === 'package' ? 'package' : draft().type === 'profile' ? 'profile' : 'test')"
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

      <!-- Rail + single content column. The page used to stack FIVE field cards
           (Identity, Pricing, Outsourcing, Details, Result & report) all at
           once and then drop a tab strip halfway down for Parameters/Layout —
           so the first screen was a wall of ~30 inputs and the tabs were easy
           to miss. Progressive disclosure (Nielsen): show one section at a
           time, defer the rare fields. The rail mirrors /admin/reports so the
           two admin editors read the same way. -->
      <div class="pf-te">
        <nav class="pf-te__rail" aria-label="Test sections">
          @for (sec of visibleSections(); track sec.value) {
            <button type="button" class="pf-te__nav press"
                    [class.pf-te__nav--on]="section() === sec.value"
                    [attr.aria-current]="section() === sec.value ? 'true' : null"
                    (click)="setSection(sec.value)">
              <span class="pf-te__nav-l">{{ sec.label }}</span>
              <span class="pf-te__nav-d">{{ sec.desc }}</span>
            </button>
          }
        </nav>

        <div class="pf-te__body">

        <!-- Identity — the core "what is this" fields: name, type, flow, the
             department it sits under, and (for individual tests + profiles) its
             unique code. Sample-collection descriptors live below for individual
             tests only. -->
        @if (section() === 'identity') {
        <pf-tile tone="default" padding="lg" class="block">
          <h3 class="section-title">Identity</h3>
          <div class="space-y-3 mt-4">
            <div><label class="pf-label">Name</label>
              <input type="text" class="pf-input"
                     [class.pf-input--error]="fieldError('name')"
                     [ngModel]="d.name" (ngModelChange)="patch({ name: $event })" />
              @if (fieldError('name')) { <p class="pf-field-err">{{ fieldError('name') }}</p> }
            </div>
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
                <pf-select [options]="departmentOptions()" [value]="selectedDeptName()"
                           placeholder="— Select department —"
                           (valueChange)="onDeptPicked($event)"></pf-select>
              </div>
              <!-- Code shows for individual tests AND profiles (a profile REQUIRES
                   its own unique code). Packages carry no code. -->
              @if (d.type === 'individual' || d.type === 'profile') {
                <div><label class="pf-label">{{ d.type === 'profile' ? 'Profile code' : 'Test code' }}</label>
                  <input type="text" class="pf-input"
                         [class.pf-input--error]="fieldError('testCode')"
                         [ngModel]="d.testCode"
                         (ngModelChange)="patch({ testCode: $event })"
                         [placeholder]="d.type === 'profile' ? 'e.g. LIPID01' : 'e.g. CBC001'" />
                  @if (fieldError('testCode')) { <p class="pf-field-err">{{ fieldError('testCode') }}</p> }
                </div>
              }
            </div>
            <!-- Short name applies to EVERY type. It used to sit in
                 "Sample & handling", which is gated to individual tests — so a
                 profile could never be given one and the grid column stayed
                 blank. -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div><label class="pf-label">Short name</label>
                <input type="text" class="pf-input" [ngModel]="d.shortName"
                       (ngModelChange)="patch({ shortName: $event })"
                       placeholder="e.g. CBC" /></div>
            </div>
            <!-- Sample type is an individual-test concern; bundles (profiles /
                 packages) inherit collection from their member tests. -->
            @if (d.type === 'individual') {
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><label class="pf-label">Sample type</label>
                  <input type="text" class="pf-input" [ngModel]="d.sampleType"
                         (ngModelChange)="patch({ sampleType: $event })" /></div>
              </div>
            }
            <!-- Tube colour: drives vial grouping (one vial per space + colour).
                 Individual tests only — bundles don't draw their own sample. -->
            @if (d.type === 'individual') {
            <div class="mt-1">
              <label class="pf-label">Tube colour</label>
              <div class="pf-tube-swatches">
                @for (c of tubeColors; track c.key) {
                  <button type="button" class="pf-tube" [class.pf-tube--on]="d.tubeColor === c.key"
                          (click)="patch({ tubeColor: d.tubeColor === c.key ? '' : c.key })"
                          [attr.aria-pressed]="d.tubeColor === c.key" [title]="c.label">
                    <span class="pf-tube__dot" [style.background]="c.hex"></span>
                    <span class="pf-tube__lbl">{{ c.label }}</span>
                  </button>
                }
              </div>
              <p class="pf-hint mt-1">The vial colour this test is drawn into. Leave unset to use the department's container colour.</p>
            </div>
            }
          </div>
        </pf-tile>

        }

        @if (section() === 'pricing') {
        <pf-tile tone="default" padding="lg" class="block">
          <h3 class="section-title">Pricing &amp; TAT</h3>
          <div class="pf-pricing-grid grid grid-cols-3 gap-3 mt-4">
            <div><label class="pf-label">Price</label>
              <pf-number-input [value]="d.price" [min]="0" [step]="50" suffix="₹"
                               (valueChange)="patch({ price: $event ?? 0 })"></pf-number-input>
              @if (fieldError('price')) { <p class="pf-field-err">{{ fieldError('price') }}</p> }
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

        <!-- Outsourcing — subcontract this test to a referral lab. Outsourced
             tests form their own vials per (lab + department) at collection.
             Individual tests only — bundles outsource via their members. -->
        @if (d.type === 'individual') {
          <!-- Deferred: most tests are run in-house, so subcontracting is
               collapsed rather than occupying the main path. -->
          <pf-tile tone="default" padding="lg" class="block">
            <details class="pf-te__adv">
              <summary class="pf-te__adv-s">Outsourcing <span>optional</span></summary>
            <div class="space-y-3 mt-4">
              <div><label class="pf-label">Outsource to</label>
                <pf-select [options]="referralLabOptions()" [value]="d.outsourcedVendorId"
                           placeholder="— In-house (not outsourced) —"
                           (valueChange)="patch({ outsourcedVendorId: $event, outsourcedDepartmentId: '' })"></pf-select>
              </div>
              @if (isOutsourced()) {
                <div><label class="pf-label">Department at vendor</label>
                  <pf-select [options]="outsourcedDeptOptions()" [value]="selectedOutsourcedDeptName()"
                             placeholder="— Same as test department —"
                             (valueChange)="onOutsourcedDeptPicked($event)"></pf-select>
                  <p class="text-[11px] mt-1" style="color: var(--text-tertiary);">
                    Used to group the outsourced sample into its own vial. Leave blank to use the test's department above.
                  </p>
                </div>
              }
            </div>
            </details>
          </pf-tile>
        }
        }

        <!-- Sample & handling — how the specimen is taken and carried. -->
        @if (section() === 'sample' && d.type === 'individual') {
          <pf-tile tone="default" padding="lg" class="block">
            <h3 class="section-title">Sample &amp; handling</h3>
            <div class="space-y-3 mt-4">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><label class="pf-label">Section</label>
                  <input type="text" class="pf-input" [ngModel]="d.section"
                         (ngModelChange)="patch({ section: $event })"
                         placeholder="Sub-group under the department" /></div>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><label class="pf-label">Profile</label>
                  <input type="text" class="pf-input" [ngModel]="d.profile"
                         (ngModelChange)="patch({ profile: $event })"
                         placeholder="e.g. LFT, Lipid Profile" /></div>
                <div><label class="pf-label">Methodology</label>
                  <input type="text" class="pf-input" [ngModel]="d.methodology"
                         (ngModelChange)="patch({ methodology: $event })"
                         placeholder="e.g. Photometry" /></div>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 items-end">
                <div><label class="pf-label">Sample volume (mL)</label>
                  <pf-number-input [value]="d.sampleVolumeMl" [allowEmpty]="true" [min]="0" [step]="0.5" suffix="mL"
                                   (valueChange)="patch({ sampleVolumeMl: $event ?? null })"></pf-number-input>
                </div>
                <div><label class="pf-label">Fasting required</label>
                  <pf-segmented [options]="fastingOptions" [value]="d.fastingRequired" size="md"
                                (valueChange)="patch({ fastingRequired: $event })"></pf-segmented>
                </div>
              </div>
            </div>
          </pf-tile>
        }

        <!-- Result & report — how the result is captured and rendered, plus
             test-level reference/critical limits. Individual tests only. -->
        @if (section() === 'results' && d.type === 'individual') {
          <pf-tile tone="default" padding="lg" class="block">
            <h3 class="section-title">Result &amp; report</h3>
            <div class="space-y-3 mt-4">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><label class="pf-label">Result type</label>
                  <pf-select [options]="resultTypeOptions" [value]="d.resultType"
                             (valueChange)="patch({ resultType: $event })"></pf-select>
                </div>
                <div><label class="pf-label">Unit</label>
                  <input type="text" class="pf-input" [ngModel]="d.unit"
                         (ngModelChange)="patch({ unit: $event })"
                         placeholder="e.g. mg/dL" /></div>
              </div>
              <div><label class="pf-label">Report format</label>
                <pf-select [options]="reportFormatOptions" [value]="d.reportFormat"
                           (valueChange)="patch({ reportFormat: $event })"></pf-select>
              </div>
              <div><label class="pf-label">Adult reference range</label>
                <input type="text" class="pf-input" [ngModel]="d.adultReferenceRange"
                       (ngModelChange)="patch({ adultReferenceRange: $event })"
                       placeholder="e.g. 13.0 – 17.0 g/dL" /></div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 items-end">
                <div><label class="pf-label">Critical low</label>
                  <pf-number-input [value]="d.criticalLow" [allowEmpty]="true" [step]="0.1"
                                   (valueChange)="patch({ criticalLow: $event ?? null })"></pf-number-input>
                </div>
                <div><label class="pf-label">Critical high</label>
                  <pf-number-input [value]="d.criticalHigh" [allowEmpty]="true" [step]="0.1"
                                   (valueChange)="patch({ criticalHigh: $event ?? null })"></pf-number-input>
                </div>
              </div>
            </div>
          </pf-tile>
        }

        <!-- Bundles (packages AND profiles) have a different body — a member
             picker instead of parameters/report-layout — so we branch on type.
             The old mid-page tab strip is gone: the rail on the left is the
             single place sections are chosen. -->
        @if (d.type === 'individual') {

        @if (section() === 'results') {

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
                        <div class="flex items-center justify-between">
                          <span class="pf-mini-lbl pf-mini-lbl--strong">Reference ranges</span>
                          <button type="button"
                                  class="text-xs font-medium text-violet-400 hover:text-violet-300"
                                  (click)="addRange(i)">+ Add range</button>
                        </div>
                        <!-- One band per sex/age segment. Sex/age select which band
                             a given patient is flagged against; leave Sex = Any and
                             ages blank for a single all-patients range. -->
                        @for (r of (p.referenceRanges ?? []); track $index) {
                          <div class="grid gap-2 grid-cols-2 md:grid-cols-6 items-end">
                            <label class="flex flex-col gap-0.5 min-w-0">
                              <span class="pf-mini-lbl">Sex</span>
                              <select class="pf-input pf-input--compact"
                                      [ngModel]="r.sex ?? 'any'"
                                      (ngModelChange)="patchRangeAt(i, $index, { sex: $event })">
                                <option value="any">Any</option>
                                <option value="M">Male</option>
                                <option value="F">Female</option>
                              </select>
                            </label>
                            <label class="flex flex-col gap-0.5 min-w-0">
                              <span class="pf-mini-lbl">Min age</span>
                              <pf-number-input size="sm" [allowEmpty]="true" [step]="1"
                                                [value]="r.minAge ?? null"
                                                (valueChange)="patchRangeAt(i, $index, { minAge: $event ?? null })">
                              </pf-number-input>
                            </label>
                            <label class="flex flex-col gap-0.5 min-w-0">
                              <span class="pf-mini-lbl">Max age</span>
                              <pf-number-input size="sm" [allowEmpty]="true" [step]="1"
                                                [value]="r.maxAge ?? null"
                                                (valueChange)="patchRangeAt(i, $index, { maxAge: $event ?? null })">
                              </pf-number-input>
                            </label>
                            <label class="flex flex-col gap-0.5 min-w-0">
                              <span class="pf-mini-lbl">Age unit</span>
                              <select class="pf-input pf-input--compact"
                                      [ngModel]="r.ageUnit ?? 'years'"
                                      (ngModelChange)="patchRangeAt(i, $index, { ageUnit: $event })">
                                <option value="years">Years</option>
                                <option value="months">Months</option>
                                <option value="days">Days</option>
                              </select>
                            </label>
                            <label class="flex flex-col gap-0.5 min-w-0">
                              <span class="pf-mini-lbl">Normal min</span>
                              <pf-number-input size="sm" [allowEmpty]="true" [step]="0.1"
                                                [value]="r.min ?? null"
                                                (valueChange)="patchRangeAt(i, $index, { min: $event ?? null })">
                              </pf-number-input>
                            </label>
                            <label class="flex flex-col gap-0.5 min-w-0">
                              <span class="pf-mini-lbl">Normal max</span>
                              <div class="flex items-end gap-1">
                                <pf-number-input size="sm" [allowEmpty]="true" [step]="0.1"
                                                  [value]="r.max ?? null"
                                                  (valueChange)="patchRangeAt(i, $index, { max: $event ?? null })">
                                </pf-number-input>
                                @if ((p.referenceRanges ?? []).length > 1) {
                                  <button type="button" title="Remove range"
                                          class="shrink-0 px-1 text-rose-400 hover:text-rose-300"
                                          (click)="removeRange(i, $index)">×</button>
                                }
                              </div>
                            </label>
                          </div>
                          <!-- The name printed under this range on the report.
                               Left blank it is composed from Sex + age above,
                               so the whole catalogue reads the same way; the
                               placeholder shows exactly what will print. -->
                          <label class="flex flex-col gap-0.5 min-w-0 -mt-1 mb-1">
                            <span class="pf-mini-lbl">Prints as</span>
                            <input type="text" class="pf-input pf-input--compact"
                                   [ngModel]="r.label ?? ''"
                                   [placeholder]="autoRangeLabel(r)"
                                   (ngModelChange)="patchRangeAt(i, $index, { label: $event || null })" />
                          </label>
                        }
                        <div class="grid gap-2 grid-cols-2 md:grid-cols-4 mt-1">
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
                          <!-- Plausible band: a value outside this is rejected
                               at submit as a likely transcription error. Leave
                               blank to skip the check. -->
                          <label class="flex flex-col gap-0.5 min-w-0">
                            <span class="pf-mini-lbl">Plausible low</span>
                            <pf-number-input size="sm" [allowEmpty]="true" [step]="0.1"
                                              [value]="p.validLow ?? null"
                                              (valueChange)="patchField(i, { validLow: $event ?? undefined })">
                            </pf-number-input>
                          </label>
                          <label class="flex flex-col gap-0.5 min-w-0">
                            <span class="pf-mini-lbl">Plausible high</span>
                            <pf-number-input size="sm" [allowEmpty]="true" [step]="0.1"
                                              [value]="p.validHigh ?? null"
                                              (valueChange)="patchField(i, { validHigh: $event ?? undefined })">
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

        }

        @if (section() === 'consumables') {
        @if (d.id) {
          <pf-test-consumables class="block" [testId]="d.id || null"></pf-test-consumables>
        } @else {
          <pf-tile tone="default" padding="lg" class="block">
            <p class="text-[13px]" style="color: var(--text-tertiary);">Save the test first, then add the inventory items it consumes here.</p>
          </pf-tile>
        }
        }

        } @else {
        <!-- Bundle member picker (packages + profiles). A profile bundles
             individual tests; a package bundles tests AND profiles (exploded
             recursively backend-side). Checkboxes write the selected ids into
             the bundle's member list. The pill filter + search + live summary
             sit in one toolbar so admins can sanity-check as they tick. -->
        <pf-tile tone="default" padding="lg" class="block">
          <div class="pf-picker-head">
            <div class="min-w-0">
              <h3 class="section-title">{{ d.type === 'profile' ? 'Profile' : 'Package' }} members</h3>
              <p class="pf-picker-sub">
                @if (d.type === 'profile') {
                  Pick the individual tests included in this profile.
                } @else {
                  Pick the tests and profiles included in this package.
                }
              </p>
            </div>
            <span class="pf-picker-summary" [class.pf-picker-summary--on]="packageItems().length > 0">
              <strong>{{ packageItems().length }}</strong>
              {{ packageItems().length === 1 ? 'member' : 'members' }}
              <span class="pf-picker-summary__sep">·</span>
              <strong>{{ packageMembersTotal() | inr }}</strong>
            </span>
          </div>

          <div class="pf-picker-toolbar">
            @if (d.type === 'package') {
              <pf-segmented [options]="pickFilterOptions" [value]="pickFilter()" size="sm"
                            (valueChange)="pickFilter.set($event)"></pf-segmented>
            }
            <input type="text" class="pf-input pf-picker-search"
                   placeholder="Search by name or department…"
                   [ngModel]="packageQuery()" (ngModelChange)="packageQuery.set($event)" />
          </div>

          @if (filteredPackageCatalogByDept().length === 0) {
            <p class="pf-picker-empty">
              @if (pickerSource().length === 0) {
                @if (d.type === 'profile') {
                  No individual tests configured yet — create a few tests first, then build the profile.
                } @else {
                  No tests or profiles configured yet — create a few first, then build the package.
                }
              } @else {
                Nothing matches your filter{{ packageQuery() ? ' "' + packageQuery() + '"' : '' }}.
              }
            </p>
          } @else {
            <div class="flex flex-col gap-5">
              @for (group of filteredPackageCatalogByDept(); track group.department) {
                <div>
                  <div class="pf-pkg-dept-hdr"
                       [class.pf-pkg-dept-hdr--sel]="group.department === 'Selected'">
                    <span class="pf-pkg-dept-hdr__name">{{ group.department }}</span>
                    <span class="pf-pkg-dept-hdr__count">{{ group.tests.length }}</span>
                  </div>
                  <div class="pf-pick-grid">
                    @for (t of group.tests; track t.id) {
                      <label class="pf-pkg-pick"
                             [class.pf-pkg-pick--on]="isInPackage(t.id)">
                        <input type="checkbox"
                               [checked]="isInPackage(t.id)"
                               (change)="togglePackageMember(t.id)" />
                        <span class="pf-pkg-pick__body">
                          <span class="pf-pkg-pick__title">
                            <span class="pf-pkg-pick__name">{{ t.name }}</span>
                            @if (t.type === 'profile') {
                              <span class="pf-pkg-badge">Profile</span>
                            }
                          </span>
                          <span class="pf-pkg-pick__meta">
                            @if (t.testCode) { <span>{{ t.testCode }}</span><span class="pf-pkg-pick__dot">·</span> }
                            <span>TAT {{ t.tatHours }}h</span>
                          </span>
                        </span>
                        <span class="pf-pkg-pick__price">{{ t.price | inr }}</span>
                      </label>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </pf-tile>
      }
        <!-- Report layout sits OUTSIDE the type branch: profiles need it too,
             because a profile carries its own notes and those are what print
             when the profile is ordered. -->
        @if (section() === 'layout') {
        <!-- Report Layout — gated until the test has an id (the layout
             endpoints all key off testId). -->
        @if (d.id) {
          <!-- Two views over the SAME per-test layout store
               (/api/report-layout/test/:id). "Notes & description" is the
               everyday content pass — the text that prints beside each
               parameter — and used to live on /admin/reports, which meant a
               second screen to finish a test. "Advanced structure" is the
               section/grid builder for the rare test that needs it. -->
          <div class="pf-lay-switch">
            <button type="button" class="pf-lay-switch__btn"
                    [class.pf-lay-switch__btn--on]="layoutView() === 'notes'"
                    (click)="layoutView.set('notes')">Notes &amp; description</button>
            <button type="button" class="pf-lay-switch__btn"
                    [class.pf-lay-switch__btn--on]="layoutView() === 'advanced'"
                    (click)="layoutView.set('advanced')">Advanced structure</button>
          </div>

          <!-- Read-only: the column structure is a DEPARTMENT-wide setting, so
               it is shown here for context but edited where it applies to all
               of the department's tests. -->
          @if (deptColumnsLabel(); as cols) {
            <p class="pf-lay-cols">
              <span class="pf-lay-cols__k">{{ selectedDeptName() || 'This department' }} prints</span>
              <span class="pf-lay-cols__v">{{ cols }}</span>
              <a class="pf-lay-cols__a" routerLink="/admin/reports">Change columns</a>
            </p>
          }

          @if (layoutView() === 'notes') {
            <pf-test-notes-editor class="block"
              [fixedTestId]="d.id || ''"
              [hidePreview]="false">
            </pf-test-notes-editor>
          } @else {
            <pf-test-layout-editor class="block"
              [testId]="d.id || ''"
              [departmentId]="d.departmentId || ''"
              [parameters]="parameterNames()">
            </pf-test-layout-editor>
          }
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


        </div><!-- /pf-te__body -->
      </div><!-- /pf-te -->
    </section>
  `,
  styles: [`
    /* The pinned "Selected" group reads as a summary, not another dept. */
    .pf-pkg-dept-hdr--sel .pf-pkg-dept-hdr__name { color: var(--violet-text); }
    .pf-pkg-dept-hdr--sel .pf-pkg-dept-hdr__count {
      background: rgba(139, 92, 246, 0.2); color: var(--violet-text);
    }

    /* ── Editor shell: sticky section rail + one content column ──────────
       Replaces the old "five stacked cards + a tab strip halfway down" page.
       Same rail idiom as /admin/reports so both admin editors read alike. */
    .pf-te { display: grid; grid-template-columns: 232px minmax(0, 1fr); gap: 22px; align-items: start; }
    .pf-te__rail { position: sticky; top: 14px; display: flex; flex-direction: column; gap: 4px; }
    .pf-te__nav {
      display: flex; flex-direction: column; gap: 2px;
      padding: 9px 12px; border-radius: 10px; text-align: left; cursor: pointer;
      background: transparent; border: 1px solid transparent;
      transition: background .15s ease, border-color .15s ease;
    }
    .pf-te__nav:hover { background: var(--glass-bg); }
    .pf-te__nav--on { background: rgba(139, 92, 246, 0.14); border-color: rgba(139, 92, 246, 0.34); }
    .pf-te__nav-l { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
    .pf-te__nav--on .pf-te__nav-l { color: var(--text-primary); }
    .pf-te__nav-d { font-size: 11px; line-height: 1.3; color: var(--text-muted); }
    .pf-te__body { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

    /* Deferred blocks (e.g. Outsourcing) — present but out of the main path. */
    .pf-te__adv > summary {
      list-style: none; cursor: pointer;
      display: flex; align-items: center; gap: 8px;
      font-size: 14px; font-weight: 600; color: var(--text-secondary);
    }
    .pf-te__adv > summary::-webkit-details-marker { display: none; }
    .pf-te__adv > summary::before {
      content: '›'; display: inline-block; font-size: 16px; line-height: 1;
      color: var(--text-muted); transition: transform .15s ease;
    }
    .pf-te__adv[open] > summary::before { transform: rotate(90deg); }
    .pf-te__adv > summary span {
      font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
      color: var(--text-muted);
    }
    .pf-te__adv > summary:hover { color: var(--text-primary); }

    @media (max-width: 900px) {
      .pf-te { grid-template-columns: 1fr; gap: 14px; }
      /* Rail becomes a horizontal scroller on narrow screens — same control,
         no separate mobile design. */
      .pf-te__rail { position: static; flex-direction: row; overflow-x: auto; gap: 6px; padding-bottom: 4px; }
      .pf-te__nav { flex: 0 0 auto; min-width: 132px; }
      .pf-te__nav-d { display: none; }
    }
    @media (pointer: coarse) { .pf-te__nav { min-height: 44px; justify-content: center; } }

    /* Report Layout tab: notes vs advanced structure. */
    .pf-lay-switch { display: inline-flex; gap: 2px; padding: 3px; border-radius: 10px;
      background: var(--glass-bg); border: 1px solid var(--glass-border); margin-bottom: 12px; }
    .pf-lay-switch__btn { padding: 6px 13px; border: 0; border-radius: 8px; cursor: pointer;
      font-size: 12.5px; font-weight: 600; color: var(--text-tertiary); background: transparent;
      transition: color .15s ease, background .15s ease; }
    .pf-lay-switch__btn:hover { color: var(--text-primary); }
    .pf-lay-switch__btn--on { color: var(--text-primary); background: rgba(139, 92, 246, 0.18); }

    /* Read-only department columns context. */
    .pf-lay-cols { display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
      margin: 0 0 14px; padding: 9px 12px; border-radius: 10px;
      background: var(--glass-bg); border: 1px solid var(--glass-border);
      font-size: 12px; }
    .pf-lay-cols__k { color: var(--text-muted); text-transform: uppercase;
      letter-spacing: 0.08em; font-size: 10px; font-weight: 700; }
    .pf-lay-cols__v { color: var(--text-secondary); font-weight: 500; }
    .pf-lay-cols__a { margin-left: auto; color: var(--violet-text); font-weight: 600;
      text-decoration: none; font-size: 11.5px; }
    .pf-lay-cols__a:hover { text-decoration: underline; }
    .section-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
      letter-spacing: -0.01em;
      margin: 0;
    }
    /* Tube colour swatch picker */
    .pf-tube-swatches { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
    .pf-tube {
      display: inline-flex; align-items: center; gap: 7px; padding: 7px 12px 7px 9px;
      border-radius: 999px; cursor: pointer; font-size: 12.5px; color: var(--text-secondary);
      background: var(--glass-bg, rgba(255,255,255,0.04));
      border: 1px solid var(--glass-border, rgba(255,255,255,0.12)); transition: border-color .15s, color .15s, background .15s;
    }
    .pf-tube:hover { border-color: rgba(168,85,247,.4); }
    .pf-tube--on { border-color: rgba(168,85,247,.7); color: var(--text-primary); background: rgba(168,85,247,.1); font-weight: 600; }
    .pf-tube__dot { width: 15px; height: 15px; border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,.25) inset; flex-shrink: 0; }
    .pf-hint { font-size: 11.5px; color: var(--text-muted); line-height: 1.45; }

    /* ── Package / profile member picker ── */
    .pf-pkg-chip {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 4px 10px;
      font-size: 12px;
      border-radius: 9999px;
      background: rgba(168, 85, 247, 0.14);
      border: 1px solid rgba(168, 85, 247, 0.32);
      color: var(--text-primary);
    }

    /* Picker header: title + subtitle on the left, live summary chip right. */
    .pf-picker-head {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 12px; flex-wrap: wrap; margin-bottom: 14px;
    }
    .pf-picker-sub {
      margin-top: 3px;
      font-size: 12px;
      color: var(--text-tertiary);
    }
    .pf-picker-summary {
      display: inline-flex; align-items: baseline; gap: 6px;
      padding: 6px 14px;
      font-size: 12.5px;
      white-space: nowrap;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .pf-picker-summary strong { color: var(--text-primary); font-weight: 700; }
    .pf-picker-summary__sep { color: var(--text-muted); }
    .pf-picker-summary--on {
      background: rgba(168, 85, 247, 0.12);
      border-color: rgba(168, 85, 247, 0.4);
      color: var(--text-primary);
    }

    /* Toolbar: pill filter + search on one row (wraps on narrow widths). */
    .pf-picker-toolbar {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      margin-bottom: 18px;
    }
    .pf-picker-search { flex: 1 1 220px; min-width: 0; margin-bottom: 0; }
    .pf-picker-empty {
      text-align: center;
      padding: 28px 8px;
      font-size: 13px;
      color: var(--text-tertiary);
    }

    .pf-pkg-dept-hdr {
      display: flex; align-items: center; gap: 8px;
      padding: 4px 4px 8px;
      border-bottom: 1px dashed var(--glass-border);
      margin-bottom: 10px;
    }
    .pf-pkg-dept-hdr__name {
      font-size: 11px; font-weight: 800;
      letter-spacing: 0.16em; text-transform: uppercase;
      color: var(--text-secondary);
    }
    .pf-pkg-dept-hdr__count {
      padding: 1px 8px;
      font-size: 10.5px; font-weight: 700;
      border-radius: 9999px;
      background: rgba(168, 85, 247, 0.16);
      color: var(--violet-text);
    }

    /* Equal-height pick cards in an auto-fill grid so rows align cleanly. */
    .pf-pick-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 8px;
    }
    .pf-pkg-pick {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid var(--glass-border);
      background: var(--glass-bg);
      cursor: pointer;
      height: 100%;
      transition: background 0.12s, border-color 0.12s, box-shadow 0.12s;
    }
    .pf-pkg-pick:hover { border-color: rgba(168, 85, 247, 0.45); }
    .pf-pkg-pick--on {
      background: rgba(168, 85, 247, 0.10);
      border-color: rgba(168, 85, 247, 0.55);
      box-shadow: inset 0 0 0 1px rgba(168, 85, 247, 0.25);
    }
    .pf-pkg-pick input[type="checkbox"] { width: 16px; height: 16px; accent-color: #a855f7; flex-shrink: 0; }
    .pf-pkg-pick__body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .pf-pkg-pick__title { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .pf-pkg-pick__name {
      font-weight: 600; font-size: 13px;
      color: var(--text-primary);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .pf-pkg-pick__meta {
      display: flex; align-items: center; gap: 5px;
      font-size: 11px;
      color: var(--text-tertiary);
    }
    .pf-pkg-pick__dot { color: var(--text-muted); }
    .pf-pkg-pick__price {
      font-size: 12.5px; font-weight: 600;
      color: var(--text-primary);
      flex-shrink: 0;
    }
    /* PROFILE tag on profile member rows — distinct from the violet package UI. */
    .pf-pkg-badge {
      flex-shrink: 0;
      padding: 1px 7px;
      font-size: 8.5px; font-weight: 800;
      letter-spacing: 0.12em; text-transform: uppercase;
      border-radius: 9999px;
      background: rgba(56, 189, 248, 0.16);
      border: 1px solid rgba(56, 189, 248, 0.38);
      color: #7dd3fc;
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
    .param-row__chev--open { transform: rotate(90deg); color: var(--violet-text); }

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
      color: var(--violet-text);
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
      color: var(--rose-text);
    }
    .param-row__pill--cond {
      background: rgba(245, 158, 11, 0.14);
      border: 1px solid rgba(245, 158, 11, 0.3);
      color: var(--amber-text);
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
      color: var(--red-text);
      border-color: rgba(239, 68, 68, 0.36);
      opacity: 1;
    }

    .pf-input--compact { padding: 7px 10px; font-size: 13px; }

    /* Field-level API error (e.g. duplicate name) — red border + message. */
    .pf-input--error { border-color: rgba(244, 63, 94, 0.7) !important; }
    .pf-field-err {
      margin-top: 4px;
      font-size: 11.5px;
      color: var(--rose-text);
    }

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
      color: var(--violet-text);
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

    /* ─────────────────────────────────────────────────────────────
       CROSS-PLATFORM OVERRIDES — additive only. Desktop-web (>=1280)
       and the base rules above are left byte-for-byte unchanged.
       iOS zoom (16px inputs) + 44px tap targets are already enforced
       globally at @media (max-width:640px) in styles.scss, so this
       page only needs: (a) neutralise sticky :hover on touch devices,
       (b) make a couple of icon-only affordances finger-friendly on
       coarse pointers, (c) drop the dense range grid to fewer columns
       on phones so 6 number inputs don't get crushed.
       ───────────────────────────────────────────────────────────── */

    /* (a) Touch devices keep no pointer to rest on, so the component's
       hover states would stick after a tap. Re-assert resting visuals
       when the primary pointer can't hover. */
    @media (hover: none) {
      .param-row:hover { border-color: var(--glass-border); }
      .param-row--open:hover { border-color: rgba(168, 85, 247, 0.45); }
      .param-row__summary:hover { background: transparent; }
      .param-row:hover .param-remove { opacity: 0.45; }
      .param-remove:hover {
        background: transparent;
        color: var(--text-muted);
        border-color: transparent;
        opacity: 0.45;
      }
      .pf-pkg-pick:hover { border-color: var(--glass-border); }
      .pf-pkg-pick--on:hover { border-color: rgba(168, 85, 247, 0.55); }

      /* The reference-range "+ Add range" and "×" remove buttons use Tailwind
         hover: text-colour utilities, which can stick after a tap on a touch
         device. Re-assert the resting colour when the pointer can't hover.
         (Targeted by their Tailwind classes so no markup change is needed.) */
      .text-violet-400.hover\\:text-violet-300:hover { color: rgb(167 139 250); }
      .text-rose-400.hover\\:text-rose-300:hover { color: rgb(251 113 133); }
    }

    /* (b) On coarse pointers the dimmed remove icon is easy to miss and
       hard to hit — keep it fully visible and give it a real touch box.
       (Global rule already sets min-height:44px on role=button.) */
    @media (pointer: coarse) {
      .param-remove { opacity: 0.85; min-width: 44px; }
    }

    /* (c) Phone: the reference-range editor packs 6 inputs across at the
       md breakpoint; on a phone that's far too tight. The Tailwind
       grid-cols-2 base already kicks in below md (768px), but reinforce
       a comfortable 2-up here and let the critical/plausible row match.
       This rule only applies <=640px so iPad/desktop are untouched. */
    @media (max-width: 640px) {
      .param-row__body { padding-left: 10px; padding-right: 10px; }
      .param-row__meta { max-width: 100%; }

      /* Pricing & TAT is 3 number-inputs across at the grid-cols-3 base.
         On a phone each cell shrinks to ~50px of usable field once the
         stepper column + suffix are subtracted — legible but cramped and
         awkward to type into. Stack them so each row gets full width.
         (lg:grid-cols-1 already covers desktop; this only touches <=640px,
         leaving iPad's 3-up untouched.) */
      .pf-pricing-grid { grid-template-columns: 1fr; }

      /* The tab strip (pf-segmented) is display:inline-flex and never wraps,
         so with 3 tabs (Parameters / Report layout / Consumables) it can be
         wider than a small phone and force horizontal PAGE scroll. Let the
         strip itself scroll horizontally instead, hiding the scrollbar. The
         negative margin lets it bleed to the section's px-4 edges so the full
         width is swipeable. Phone-only, so iPad/desktop stay byte-identical. */
      .tab-strip {
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
        margin-inline: -16px;
        padding-inline: 16px;
        scrollbar-width: none;
      }
      .tab-strip::-webkit-scrollbar { display: none; }
    }

    /* (d) WEB-BELOW-DESKTOP band (641–1279px: iPad + any browser narrower
       than 1280). The reference-range editor uses Tailwind md:grid-cols-6
       (kicks in at 768px), so from 768–1279 it packs SIX pf-number-inputs —
       each with its own +/- stepper column — across one parameter row that
       sits inside the full-width Parameters tile minus the 64px rail. At the
       lower half of this band the cells crush to an unusable width. Drop the
       six-up to a comfortable 3-up and the critical/plausible four-up to 2-up
       so nothing overflows or squishes. Targeted by the literal Tailwind
       column classes inside .param-row__ranges so no markup changes and the
       grid-cols-2 phone base (<640) and md:grid-cols-6/4 desktop (>=1280)
       both stay byte-identical. */
    @media (min-width: 641px) and (max-width: 1279px) {
      .param-row__ranges .md\\:grid-cols-6 {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .param-row__ranges .md\\:grid-cols-4 {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
  `]
})
export class TestEditorComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly layoutSvc = inject(ReportLayoutService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  /** Consumables tab only for users who manage inventory. */
  protected canManageInventory() { return this.auth.hasPermission('manage_inventory'); }
  private readonly router = inject(Router);

  readonly typeOptions: PfSelectOption<'individual' | 'profile' | 'package'>[] = [
    { value: 'individual', label: 'Individual' },
    { value: 'profile',    label: 'Profile' },
    { value: 'package',    label: 'Package' }
  ];
  readonly flowOptions: PfSelectOption<'direct' | 'approval'>[] = [
    { value: 'direct',   label: 'Direct',   hint: 'Result goes straight to reports' },
    { value: 'approval', label: 'Approval', hint: 'Needs pathologist validation' }
  ];
  // Test-level result shape. Blank = unset (fall back to per-parameter types).
  readonly resultTypeOptions: PfSelectOption<string>[] = [
    { value: '',                  label: '— Not set —' },
    { value: 'numeric',           label: 'Numeric' },
    { value: 'text',              label: 'Text' },
    { value: 'positive_negative', label: 'Positive / Negative' }
  ];
  readonly reportFormatOptions: PfSelectOption<string>[] = [
    { value: '',            label: '— Not set —' },
    { value: 'tabular',     label: 'Tabular' },
    { value: 'descriptive', label: 'Descriptive' }
  ];
  // Fasting requirement — segmented Yes/No toggle bound to a boolean.
  readonly fastingOptions: SegmentedOption<boolean>[] = [
    { value: false, label: 'No' },
    { value: true,  label: 'Yes' }
  ];

  private readonly _departments = signal<Department[]>([]);
  readonly departments = this._departments.asReadonly();
  // Departments are stored per-branch, so the same name repeats across
  // branches. The picker is keyed by NAME (deduped) so admins see each
  // department once instead of "Bio · Bio · Bio".
  readonly departmentOptions = computed<PfSelectOption<string>[]>(() => {
    const seen = new Set<string>();
    const opts: PfSelectOption<string>[] = [{ value: '', label: '— None —' }];
    for (const d of this._departments()) {
      const name = (d.name ?? '').trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      opts.push({ value: name, label: name });
    }
    return opts;
  });

  /** The picker value is the department NAME; map the test's stored
   *  departmentId (a specific per-branch row) to its name for display. */
  readonly selectedDeptName = computed<string>(() => {
    const id = this._draft().departmentId;
    if (!id) return '';
    return (this._departments().find(d => d.id === id)?.name ?? '').trim();
  });

  /** User picked a department by name → resolve to a canonical id for that
   *  name. (Leaving it untouched preserves the original per-branch id, so we
   *  never silently re-route an existing test's samples.) */
  onDeptPicked(name: string) {
    if (!name) { this.patch({ departmentId: '' }); return; }
    const id = this._departments().find(d => (d.name ?? '').trim() === name)?.id ?? '';
    this.patch({ departmentId: id });
  }

  // ── Outsourcing ───────────────────────────────────────────────
  private readonly _referralLabs = signal<ReferralLab[]>([]);
  readonly referralLabs = this._referralLabs.asReadonly();
  readonly referralLabOptions = computed<PfSelectOption<string>[]>(() => {
    const opts: PfSelectOption<string>[] = [{ value: '', label: '— In-house (not outsourced) —' }];
    for (const l of this._referralLabs()) opts.push({ value: l.id, label: l.code ? `${l.name} (${l.code})` : l.name });
    return opts;
  });
  readonly isOutsourced = computed(() => !!this._draft().outsourcedVendorId);

  /** Department picker for the outsourced lab. Scoped to the selected lab's
   *  declared department codes when present; otherwise all departments. */
  readonly outsourcedDeptOptions = computed<PfSelectOption<string>[]>(() => {
    const lab = this._referralLabs().find(l => l.id === this._draft().outsourcedVendorId);
    let codes: string[] = [];
    if (lab?.departmentCodesJson) {
      try { const a = JSON.parse(lab.departmentCodesJson); if (Array.isArray(a)) codes = a; } catch { /* ignore */ }
    }
    const seen = new Set<string>();
    const opts: PfSelectOption<string>[] = [{ value: '', label: '— Same as test department —' }];
    for (const d of this._departments()) {
      const name = (d.name ?? '').trim();
      const code = (d.code ?? '').trim().toUpperCase();
      if (!name || seen.has(name.toLowerCase())) continue;
      if (codes.length > 0 && code && !codes.includes(code)) continue;
      seen.add(name.toLowerCase());
      opts.push({ value: name, label: name });
    }
    return opts;
  });
  readonly selectedOutsourcedDeptName = computed<string>(() => {
    const id = this._draft().outsourcedDepartmentId;
    if (!id) return '';
    return (this._departments().find(d => d.id === id)?.name ?? '').trim();
  });
  onOutsourcedDeptPicked(name: string) {
    if (!name) { this.patch({ outsourcedDepartmentId: '' }); return; }
    const id = this._departments().find(d => (d.name ?? '').trim() === name)?.id ?? '';
    this.patch({ outsourcedDepartmentId: id });
  }

  private readonly _draft = signal<DraftTest>(makeEmptyDraft());
  readonly draft = this._draft.asReadonly();

  /** The four vacutainer tube colours used for vial grouping. */
  // NABL / standard vacutainer cap colours (order-of-draw). The key is stored
  // on the test as `tubeColor`; the legacy keys red/lavender/grey/blue still
  // resolve in sample-collection's colour map for older tests.
  readonly tubeColors = [
    { key: 'sst',      label: 'SST · Gold',              hex: '#eab308' },
    { key: 'plain',    label: 'Plain · Red',             hex: '#ef4444' },
    { key: 'edta',     label: 'EDTA · Lavender',         hex: '#a855f7' },
    { key: 'fluoride', label: 'Fluoride · Grey',         hex: '#9ca3af' },
    { key: 'heparin',  label: 'Lithium Heparin · Green', hex: '#22c55e' },
    { key: 'citrate',  label: 'Sodium Citrate · Blue',   hex: '#38bdf8' },
    { key: 'esr',      label: 'ESR · Black',             hex: '#1f2937' },
    { key: 'trace',    label: 'Trace metal · Royal blue',hex: '#1d4ed8' },
    { key: 'sterile',  label: 'Sterile Container',       hex: '#e5e7eb' },
    { key: 'urine',    label: 'Urine Bottle · Yellow',   hex: '#facc15' },
    { key: 'multiple', label: 'Multiple',                hex: '#6366f1' },
  ];

  // Parameter rows collapse to a one-line summary by default — admins
  // browse the list, expand the row they care about, edit, collapse. Cuts
  // vertical sprawl on long tests dramatically. Single-open per editor so
  // expanding one row collapses the previously-open one.
  private readonly _expandedParamId = signal<string | null>(null);
  readonly expandedParamId = this._expandedParamId.asReadonly();
  toggleParam(id: string) {
    this._expandedParamId.update(cur => cur === id ? null : id);
  }

  /** What this band will print as on the report if the admin types nothing —
   *  shown as the Label placeholder so the naming rule is visible, not
   *  guessed at. */
  autoRangeLabel(r: ReferenceRange): string {
    return deriveRangeLabel(r) ?? 'No qualifier — applies to everyone';
  }

  /** Compact one-line description used by collapsed param rows. */
  paramSummary(p: FormField): string {
    const bits: string[] = [];
    if (this.isNumericType(p.type)) {
      // Every band, labelled — the chip showed referenceRanges[0] alone, so a
      // test with male and female bands looked like it only had the male one.
      const bands = describeAllRanges(p.referenceRanges);
      if (bands.length) {
        bits.push(bands.join(' · ') + (p.unit ? ' ' + p.unit : ''));
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

  /** Which half of the Report Layout tab is showing. Notes leads: it is the
   *  pass every test needs, while the section builder serves the few that need
   *  bespoke structure. */
  protected readonly layoutView = signal<'notes' | 'advanced'>('notes');

  /** Which rail section is open. */
  private readonly _section = signal<TestSection>('identity');
  readonly section = this._section.asReadonly();
  setSection(v: TestSection) {
    this._section.set(v);
    if (v === 'layout' && !this.deptColumns()) this.loadDeptColumns(this._draft().departmentId);
  }
  /** Rail entries. Bundles (profile/package) have no sample, results, layout or
   *  consumables of their own — those belong to their member tests — so the
   *  rail collapses to what actually applies. */
  readonly visibleSections = computed<Array<{ value: TestSection; label: string; desc: string }>>(() => {
    const individual = this._draft().type === 'individual';
    const all: Array<{ value: TestSection; label: string; desc: string }> = [
      { value: 'identity',    label: 'Identity',        desc: 'Name, code, department, type' },
      { value: 'pricing',     label: 'Pricing & TAT',   desc: 'Price, tax, turnaround' },
      { value: 'sample',      label: 'Sample & handling', desc: 'Specimen, tube, volume, fasting' },
      { value: 'results',     label: 'Results',         desc: 'Parameters, units, reference ranges' },
      { value: 'layout',      label: 'Report layout',   desc: 'Notes, description, structure' },
      { value: 'consumables', label: 'Consumables',     desc: 'Inventory used per test' },
    ];
    // Consumables was permission-gated when it was a tab — keep that gate.
    const allowed = this.canManageInventory() ? all : all.filter(x => x.value !== 'consumables');
    if (individual) return allowed;
    // Bundles: no sample handling, parameters or consumables of their own —
    // those belong to their member tests. They DO get Report layout, because a
    // profile carries its own notes, and when a profile is ordered those notes
    // are what print (never the members'). See the notes rule in the renderer.
    return allowed.filter(x => x.value === 'identity' || x.value === 'pricing' || x.value === 'layout');
  });
  /** Human list of the DEPARTMENT's report columns — read-only context only.
   *  Editing lives on /admin/reports because one change hits every test in the
   *  department, which is exactly the blast radius a per-test screen hides. */
  protected readonly deptColumns = signal<string>('');
  deptColumnsLabel(): string { return this.deptColumns(); }

  /** Fetch the department's column labels for the read-only strip. Best-effort:
   *  the strip simply stays hidden when the department has no custom set. */
  private loadDeptColumns(departmentId: string | null | undefined): void {
    if (!departmentId) { this.deptColumns.set(''); return; }
    this.layoutSvc.getDeptColumns(departmentId)
      .then(res => this.deptColumns.set(
        (res?.columns ?? []).map(c => c.label || c.name).filter(Boolean).join(' · ')))
      .catch(() => this.deptColumns.set(''));
  }

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

  // ── Package state ─────────────────────────────────────────
  // Packages bundle individual tests. Storage shape lives in the same
  // `parameters` JSONB blob as individual tests, but under an `items`
  // key holding test ids. The picker reads/writes this signal which
  // serialise into `parametersJson` at save time.
  private readonly _packageItems = signal<string[]>([]);
  readonly packageItems = this._packageItems.asReadonly();
  readonly packageQuery = signal('');

  /** All individual tests in the catalog — feeds the package picker. */
  private readonly _allIndividualTests = signal<Test[]>([]);
  readonly allIndividualTests = this._allIndividualTests.asReadonly();

  /** All profiles in the catalog. A PACKAGE may bundle profiles too (the
   *  backend explodes them recursively); a PROFILE bundles individual tests
   *  only, so this feeds the package picker exclusively. */
  private readonly _allProfiles = signal<Test[]>([]);
  readonly allProfiles = this._allProfiles.asReadonly();

  /** Package-only pill filter narrowing the picker to tests / profiles / all.
   *  (Profiles being edited pick individual tests only, so no filter shows.) */
  readonly pickFilter = signal<'all' | 'tests' | 'profiles'>('all');
  readonly pickFilterOptions: SegmentedOption<'all' | 'tests' | 'profiles'>[] = [
    { value: 'all',      label: 'All' },
    { value: 'tests',    label: 'Tests' },
    { value: 'profiles', label: 'Profiles' }
  ];

  /** The member candidates for the current bundle, minus the bundle itself:
   *   • profile  → individual tests only
   *   • package  → individual tests + profiles (exploded recursively backend-side)
   *  Excluding `d.id` stops a package/profile from listing (and picking) itself. */
  readonly pickerSource = computed<Test[]>(() => {
    const d = this._draft();
    const selfId = d.id ?? '';
    const tests = this._allIndividualTests().filter(t => t.id !== selfId);
    if (d.type !== 'package') return tests;
    const profiles = this._allProfiles().filter(t => t.id !== selfId);
    return [...tests, ...profiles];
  });

  /** Every pickable member (tests + profiles) keyed by id — used to price the
   *  current selection regardless of the active filter. */
  private readonly _memberById = computed<Map<string, Test>>(() => {
    const m = new Map<string, Test>();
    for (const t of this._allIndividualTests()) m.set(t.id, t);
    for (const t of this._allProfiles()) m.set(t.id, t);
    return m;
  });

  /** Sum of the prices of ALL picked members (tests AND profiles). Helps
   *  admins set a sensible bundle price below the member total. */
  readonly packageMembersTotal = computed(() => {
    const by = this._memberById();
    return this._packageItems().reduce((s, id) => s + (by.get(id)?.price ?? 0), 0);
  });

  /** Group the picker's candidates by dept (profiles cluster under a synthetic
   *  "Profiles" group), applying the package pill filter then the search. */
  readonly filteredPackageCatalogByDept = computed(() => {
    const d = this._draft();
    const q = this.packageQuery().trim().toLowerCase();
    const filter = this.pickFilter();
    let source = this.pickerSource();
    if (d.type === 'package' && filter !== 'all') {
      source = source.filter(t => filter === 'profiles' ? t.type === 'profile' : t.type !== 'profile');
    }
    const groups = new Map<string, Test[]>();
    for (const t of source) {
      if (q && !t.name.toLowerCase().includes(q) && !(t.department?.name ?? '').toLowerCase().includes(q)) continue;
      const key = t.type === 'profile' ? 'Profiles' : (t.department?.name?.trim() || '(No department)');
      const arr = groups.get(key);
      if (arr) arr.push(t); else groups.set(key, [t]);
    }
    const out = Array.from(groups.entries())
      // Keep the Profiles cluster last so individual-test departments read first.
      .map(([department, tests]) => ({ department, tests: tests.slice().sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => {
        if (a.department === 'Profiles') return 1;
        if (b.department === 'Profiles') return -1;
        return a.department.localeCompare(b.department);
      });

    // Everything already chosen collects into a "Selected" group pinned at the
    // TOP. With ~280 candidates the ticks were scattered across departments and
    // there was no way to see what the bundle actually contained without
    // scrolling the whole catalogue. Members still appear in their own
    // department below, so unticking works from either place.
    const chosen = new Set(this._packageItems());
    if (chosen.size > 0) {
      const picked = this.pickerSource()
        .filter(t => chosen.has(t.id))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (picked.length > 0) out.unshift({ department: SELECTED_GROUP, tests: picked });
    }
    return out;
  });

  isInPackage(id: string): boolean { return this._packageItems().includes(id); }
  togglePackageMember(id: string) {
    this._packageItems.update(arr => arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id]);
  }

  readonly subtitle = computed(() =>
    this._draft().id
      ? 'Update name, pricing, parameters, or flow.'
      : 'Define what the lab collects, how it\'s priced, and the parameters captured.'
  );

  ngOnInit() {
    this.api.get<Department[]>('/api/tenants/departments').subscribe({
      next: l => this._departments.set(l ?? [])
    });
    this.api.get<ReferralLab[]>('/api/referral-labs').subscribe({
      next: l => this._referralLabs.set(l ?? [])
    });
    // Load the full individual-test catalog so the package picker has
    // something to pick from. Filter happens client-side via the search box.
    this.api.get<Test[]>('/api/tests/?type=individual').subscribe({
      next: l => this._allIndividualTests.set((l ?? []).filter(t => t.type !== 'package'))
    });
    // Profiles are also pickable members of a PACKAGE (backend explodes them
    // recursively), so load them too — the picker source switches on bundle type.
    this.api.get<Test[]>('/api/tests/?type=profile').subscribe({
      next: l => this._allProfiles.set((l ?? []).filter(t => t.type === 'profile'))
    });

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.api.get<Test>(`/api/tests/${id}`).subscribe({
        next: t => this.hydrateFrom(t),
        error: e => this.toasts.error(ApiError.from(e).message)
      });
    } else {
      // Honour `?type=package` from the admin tests list, so the "Create
      // package" button lands on this editor with the package type pre-
      // selected instead of defaulting to individual.
      const t = this.route.snapshot.queryParamMap.get('type');
      if (t === 'package' || t === 'individual' || t === 'profile') {
        this.patch({ type: t });
      }
    }
  }

  private hydrateFrom(t: Test) {
    this._draft.set({
      id: t.id, name: t.name, type: t.type, flow: t.flow,
      price: t.price, taxSlab: t.taxSlab,
      departmentId: t.departmentId ?? '', tatHours: t.tatHours,
      sampleType: t.sampleType ?? '', tubeColor: t.tubeColor ?? '',
      testCode: t.testCode ?? '', shortName: t.shortName ?? '', section: t.section ?? '',
      profile: t.profile ?? '',
      sampleVolumeMl: t.sampleVolumeMl ?? null, fastingRequired: t.fastingRequired ?? false,
      methodology: t.methodology ?? '', resultType: t.resultType ?? '',
      unit: t.unit ?? '', reportFormat: t.reportFormat ?? '',
      adultReferenceRange: t.adultReferenceRange ?? '',
      criticalLow: t.criticalLow ?? null, criticalHigh: t.criticalHigh ?? null,
      parametersJson: t.parameters ?? '', conditionsJson: t.conditions ?? '[]',
      isActive: t.isActive,
      outsourcedVendorId: t.outsourcedVendorId ?? '',
      outsourcedDepartmentId: t.outsourcedDepartmentId ?? ''
    });
    this._fields.set(this.loadParameters(t.parameters ?? ''));
    // Bundles (packages AND profiles) store member-test ids under `items` in
    // the same JSON blob — load them into the shared member picker.
    if (t.type === 'package' || t.type === 'profile') {
      try {
        const blob = JSON.parse(t.parameters ?? '{}');
        // Accept BOTH member shapes: canonical [{ testId }] (what the backend
        // exploder + order-create parse) and the legacy plain-string array this
        // editor used to write (which the backend read as ZERO members — so
        // packages saved here never exploded at order time).
        const items = Array.isArray(blob.items) ? blob.items : [];
        this._packageItems.set(items
          .map((it: unknown) => typeof it === 'string' ? it : ((it as { testId?: string })?.testId ?? ''))
          .filter((id: string) => id.length > 0));
      } catch { this._packageItems.set([]); }
    } else {
      this._packageItems.set([]);
    }
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
      validLow: p.validLow ?? null,
      validHigh: p.validHigh ?? null,
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
      criticalHigh: f.criticalHigh ?? undefined,
      validLow: f.validLow ?? undefined,
      validHigh: f.validHigh ?? undefined
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

  /** Patch one reference-range band (by index) of parameter `i`. */
  patchRangeAt(i: number, ri: number, updates: Partial<ReferenceRange>) {
    this._fields.update(list => list.map((p, idx) => {
      if (idx !== i) return p;
      const ranges = [...(p.referenceRanges ?? [])];
      if (ri < 0 || ri >= ranges.length) return p;
      // Normalize 'any' sex back to undefined so the persisted JSON stays
      // clean (a band with no sex constraint = applies to everyone).
      const next: ReferenceRange = { ...ranges[ri], segment: ranges[ri].segment ?? 'normal', ...updates };
      if (next.sex === 'any') next.sex = undefined;
      ranges[ri] = next;
      return { ...p, referenceRanges: ranges };
    }));
    this.persistFieldsToDraft();
  }

  /** Append an empty reference-range band to parameter `i`. */
  addRange(i: number) {
    this._fields.update(list => list.map((p, idx) => idx === i
      ? { ...p, referenceRanges: [...(p.referenceRanges ?? []), { segment: 'normal', min: null, max: null }] }
      : p));
    this.persistFieldsToDraft();
  }

  /** Remove reference-range band `ri` from parameter `i`. */
  removeRange(i: number, ri: number) {
    this._fields.update(list => list.map((p, idx) => {
      if (idx !== i) return p;
      const ranges = (p.referenceRanges ?? []).filter((_, k) => k !== ri);
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

  // Field-level API errors (backend `field` → offending input). Rendered
  // inline as a red border + message and cleared as soon as the admin edits
  // that field, so a duplicate name/price lands on the input, not a toast.
  private readonly _fieldErrors = signal<Record<string, string>>({});
  fieldError(f: string): string | null { return this._fieldErrors()[f] ?? null; }
  private clearFieldError(f: string) {
    this._fieldErrors.update(m => {
      if (!(f in m)) return m;
      const next = { ...m }; delete next[f]; return next;
    });
  }

  patch(p: Partial<DraftTest>) {
    this._draft.update(d => ({ ...d, ...p }));
    for (const k of Object.keys(p)) this.clearFieldError(k);
  }

  back() { this.router.navigateByUrl('/admin/tests'); }

  saveTest() {
    const d = this._draft();
    if (!d.name.trim()) { this.toasts.warning('Name is required'); return; }

    // Profiles are bundles (member picker + a required unique code). Guard the
    // two profile-specific invariants before we build the body; the backend
    // also 409s on a duplicate code, which handleSaveError routes to the input.
    if (d.type === 'profile') {
      if (!d.testCode.trim()) {
        this._fieldErrors.update(m => ({ ...m, testCode: 'Profile code is required' }));
        this.toasts.warning('Profile code is required');
        return;
      }
      if (this._packageItems().length === 0) {
        this.toasts.warning('Add at least one member test to the profile');
        return;
      }
    }

    const pkg = d.type === 'package';
    // Bundles (packages + profiles) serialise their member-test ids, not the
    // individual-test parameter/field schema.
    const bundle = d.type !== 'individual';

    // Packages: serialise member-test ids into the same JSON blob as
    // `{items: [...]}` so the order-create picker + admin list both
    // recognise the bundle without a separate column. The individual-
    // test parametersJson (fields/parameters) isn't relevant for
    // packages — overwrite it.
    // Canonical member shape { items: [{ testId }] } — the ONLY shape the
    // backend exploder (ParsePackageChildIds) and order-create's
    // parsePackageMembers read. The previous plain-string array parsed as zero
    // members, so editor-saved packages silently never exploded at order time.
    const parametersJson = bundle
      ? JSON.stringify({ items: this._packageItems().map(id => ({ testId: id })) })
      : (d.parametersJson || undefined);

    // Outsourcing: only individual tests can be outsourced. When a vendor is
    // set we send it + the department-at-vendor; when cleared on an existing
    // test we send clearOutsource so the PATCH detaches it.
    const outsourced = d.type !== 'package' && !!d.outsourcedVendorId;
    const body = {
      name: d.name, type: d.type, flow: d.flow,
      price: d.price, taxSlab: d.taxSlab,
      departmentId: d.type === 'package' ? undefined : (d.departmentId || undefined),
      tatHours: d.tatHours, sampleType: d.type === 'package' ? undefined : (d.sampleType || undefined),
      // '' clears it on PATCH (back to dept colour); a colour name sets it.
      tubeColor: d.type === 'package' ? undefined : d.tubeColor,
      // Master-data details — individual tests only. Strings send '' so a PATCH
      // clears them; numbers send undefined when blank (a null would read as
      // "unchanged" on PATCH — clearing a number isn't supported here).
      testCode: pkg ? undefined : d.testCode,
      shortName: pkg ? undefined : d.shortName,
      section: pkg ? undefined : d.section,
      profile: pkg ? undefined : d.profile,
      sampleVolumeMl: pkg ? undefined : (d.sampleVolumeMl ?? undefined),
      fastingRequired: pkg ? undefined : d.fastingRequired,
      methodology: pkg ? undefined : d.methodology,
      resultType: pkg ? undefined : d.resultType,
      unit: pkg ? undefined : d.unit,
      reportFormat: pkg ? undefined : d.reportFormat,
      adultReferenceRange: pkg ? undefined : d.adultReferenceRange,
      criticalLow: pkg ? undefined : (d.criticalLow ?? undefined),
      criticalHigh: pkg ? undefined : (d.criticalHigh ?? undefined),
      parametersJson,
      conditionsJson: d.conditionsJson || undefined,
      isActive: d.isActive,
      outsourcedVendorId: outsourced ? d.outsourcedVendorId : undefined,
      outsourcedDepartmentId: outsourced ? (d.outsourcedDepartmentId || undefined) : undefined,
      clearOutsource: (d.id && !outsourced) ? true : undefined
    };

    this._saving.set(true);
    if (d.id) {
      this.api.patch<Test>(`/api/tests/${d.id}`, body).subscribe({
        next: () => { this._saving.set(false); this.toasts.success('Updated'); this.back(); },
        error: e => this.handleSaveError(e)
      });
    } else {
      this.api.post<Test>('/api/tests/', body).subscribe({
        next: () => { this._saving.set(false); this.toasts.success('Created'); this.back(); },
        error: e => this.handleSaveError(e)
      });
    }
  }

  /** Surface the real backend failure: route field-named errors (e.g. a
   *  duplicate name/price) to the offending input; everything else to a toast. */
  private handleSaveError(e: unknown) {
    this._saving.set(false);
    const err = ApiError.from(e);
    const field = err.field ?? '';
    if (field === 'name' || field === 'price' || field === 'testCode') {
      this._fieldErrors.update(m => ({ ...m, [field]: err.message }));
    } else {
      this.toasts.error(err.message);
    }
  }
}
