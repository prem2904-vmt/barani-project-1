import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { ReportLayoutService } from '../../../core/services/report-layout.service';
import { ReportColumn } from '../../../shared/models/report-layout.model';
import { ColumnsEditorState, ReportColumnsEditorComponent } from '../report-template/report-columns-editor.component';
import { PreviewProfileMember } from '../report-template/report-pdf-preview.component';
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
import { parseCalc, lintExpr, evaluateCalc, CALC_CONSTANT_DEFAULTS, CalcDef } from '../../../shared/utils/calculation';
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
import { describeAllRanges, deriveRangeLabel, formatRange } from '../../../shared/utils/reference-range';

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

/** One draw in a REPETITIVE profile's timed series. The same testId may appear
 *  in several rows (OGTT = Glucose at 0/60/120 min) — `key` keeps @for tracking
 *  and drag-drop stable across duplicates. Never serialised. */
interface MemberRow {
  key: string;
  testId: string;
  /** Minutes from the first draw. First group is always 0 (rebased on edit). */
  offsetMin: number;
}

let rowCounter = 0;
function newRowKey(): string {
  rowCounter += 1;
  return `row_${Date.now().toString(36)}_${rowCounter}`;
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
    TestConsumablesComponent,
    DragDropModule
  , ReportColumnsEditorComponent],
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
              <!-- The flat "Adult reference range" box used to sit here, next
                   to a Reference range section that holds the real bands. Two
                   places for one fact is how a range gets edited in one and
                   read from the other; it is now kept in step on save from the
                   bands, which are the thing the report actually uses. -->
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

        <!-- ── Calculated result (master formula, read-only) ──────────
             The formula ships with the master test master (document-verbatim)
             and auto-fills this test's field during profile result entry.
             Shown here so the admin can see WHERE a value comes from; there
             is no editor — restore-to-default would bring it back anyway. -->
        @if (section() === 'results' && calcInfo(); as calc) {
          <pf-tile tone="default" padding="lg" class="block">
            <div class="flex items-center justify-between">
              <h3 class="section-title">Calculated result</h3>
              <span class="text-[11px] text-slate-400">{{ calcKindLabel(calc.kind) }}</span>
            </div>
            <div class="mt-3 space-y-2">
              @if (calc.expr) {
                <p class="font-mono text-sm text-slate-200 rounded-lg bg-slate-800/60 border border-slate-700/60 px-3 py-2 overflow-x-auto">
                  {{ d.testCode || 'Value' }} = {{ calc.expr }}
                </p>
              }
              @if (calc.inputs?.length) {
                <p class="text-xs text-slate-400">
                  Inputs:
                  <span class="font-mono text-slate-300">{{ calc.inputs!.join(', ') }}</span>
                  — sibling tests on the same order supply these during profile entry.
                </p>
              }
              @if (calc.constants?.length) {
                <p class="text-xs text-slate-400">
                  Lab constants:
                  <span class="font-mono text-slate-300">{{ calc.constants!.join(', ') }}</span>
                  (set under Lab settings → Calculation constants).
                </p>
              }
              @if (calc.validWhen) {
                <p class="text-xs text-slate-400">
                  Only calculated when
                  <span class="font-mono text-slate-300">{{ calc.validWhen }}</span>
                  — otherwise the entry screen shows “Not calculable”.
                </p>
              }
              @if (calc.note) {
                <p class="text-xs text-slate-500">{{ calc.note }}</p>
              }
            </div>
          </pf-tile>
        }

        <!-- ── Reference range ────────────────────────────────────────
             Inside Results, between "Result & report" and the analyte details
             — reading unit → normal values → parameters. It is a tile of its
             own rather than a field buried inside a parameter accordion, which
             is what made it look missing, but it is NOT a separate rail
             section: a range belongs with the result it qualifies. -->
        @if (section() === 'results' && d.type === 'individual') {
          <pf-tile tone="default" padding="lg" class="block">
            <div class="flex items-center justify-between">
              <h3 class="section-title">Reference range</h3>
              @if (numericFields().length > 0) {
                <span class="text-[11px] text-slate-400">Normal values by sex and age</span>
              }
            </div>

            @if (numericFields().length === 0) {
              <!-- A simple test shouldn't make anyone think about "parameters"
                   first: this creates the single analyte, named after the test,
                   and drops the admin straight into its bands. -->
              <div class="mt-4 rounded-xl border border-dashed border-slate-600/50 p-6 text-center">
                <p class="text-sm text-slate-300">No reference range set for this test yet.</p>
                <p class="text-xs text-slate-500 mt-1">
                  Leave it empty for a qualitative test, or add the normal values now.
                </p>
                <div class="mt-3">
                  <pf-touch-btn size="sm" variant="secondary" (pressed)="startReferenceRange()">
                    Add a reference range
                  </pf-touch-btn>
                </div>
              </div>
            } @else {
              <div class="space-y-5 mt-4">
                @for (p of fields(); let i = $index; track i) {
                  @if (isNumericType(p.type)) {
                    <div class="pf-rr-block">
                      <!-- The analyte is named only when there is more than one:
                           a single-analyte test IS the test, and repeating its
                           name here is noise. -->
                      @if (numericFields().length > 1) {
                        <div class="flex items-baseline gap-2 mb-2">
                          <span class="text-sm font-semibold text-slate-100">{{ p.name || 'Unnamed' }}</span>
                          @if (p.unit) { <span class="text-[11px] text-slate-400">{{ p.unit }}</span> }
                        </div>
                      }
                      @if (!showAdvancedRanges(p)) {
                        <!-- DEFAULT: one range for everyone, which is what the
                             overwhelming majority of tests need. Two boxes, no
                             sex/age vocabulary to read past. -->
                        <div class="grid gap-2 grid-cols-2 md:grid-cols-3 items-end">
                          <label class="flex flex-col gap-0.5 min-w-0">
                            <span class="pf-mini-lbl">Normal min</span>
                            <pf-number-input size="sm" [allowEmpty]="true" [step]="0.1"
                                              [value]="firstBand(p).min ?? null"
                                              (valueChange)="patchRangeAt(i, 0, { min: $event ?? null })">
                            </pf-number-input>
                          </label>
                          <label class="flex flex-col gap-0.5 min-w-0">
                            <span class="pf-mini-lbl">Normal max</span>
                            <pf-number-input size="sm" [allowEmpty]="true" [step]="0.1"
                                              [value]="firstBand(p).max ?? null"
                                              (valueChange)="patchRangeAt(i, 0, { max: $event ?? null })">
                            </pf-number-input>
                          </label>
                          <div class="flex items-end pb-1">
                            <button type="button"
                                    class="text-xs font-medium text-violet-400 hover:text-violet-300"
                                    (click)="openAdvancedRanges()">
                              Different by sex or age?
                            </button>
                          </div>
                        </div>
                      } @else {
                      <div class="flex items-center justify-between mb-1">
                        <span class="pf-mini-lbl">{{ bandsCaption(p) }}</span>
                        <div class="flex items-center gap-3">
                          @if (!needsAdvancedRanges(p)) {
                            <!-- Only offered when nothing would be lost: a test
                                 that really has sex/age bands can't be shown in
                                 the two-box view without hiding them. -->
                            <button type="button"
                                    class="text-xs font-medium text-slate-400 hover:text-slate-300"
                                    (click)="closeAdvancedRanges()">Simple</button>
                          }
                          <button type="button"
                                  class="text-xs font-medium text-violet-400 hover:text-violet-300"
                                  (click)="addRange(i)">+ Add range</button>
                        </div>
                      </div>
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
                    <div class="flex items-end gap-1">
                      <!-- Lower-bound comparator. Shown value = the band's
                           EFFECTIVE op (absent = inclusive ≥ when two-sided,
                           strict > when one-sided); choosing one stores it
                           explicitly so the band no longer relies on the
                           default. -->
                      <select class="pf-input pf-input--compact w-12 shrink-0"
                              title="Lower-bound comparator"
                              [ngModel]="minOpShown(r)"
                              (ngModelChange)="patchRangeAt(i, $index, { minOp: $event })">
                        <option value="gt">&gt;</option>
                        <option value="gte">&ge;</option>
                      </select>
                      <pf-number-input size="sm" [allowEmpty]="true" [step]="0.1"
                                        [value]="r.min ?? null"
                                        (valueChange)="patchRangeAt(i, $index, { min: $event ?? null })">
                      </pf-number-input>
                    </div>
                  </label>
                  <label class="flex flex-col gap-0.5 min-w-0">
                    <span class="pf-mini-lbl">Normal max</span>
                    <div class="flex items-end gap-1">
                      <select class="pf-input pf-input--compact w-12 shrink-0"
                              title="Upper-bound comparator"
                              [ngModel]="maxOpShown(r)"
                              (ngModelChange)="patchRangeAt(i, $index, { maxOp: $event })">
                        <option value="lt">&lt;</option>
                        <option value="lte">&le;</option>
                      </select>
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
                      }
                    </div>
                  }
                }
              </div>
            }
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
                        <!-- Reference ranges moved out to their own rail
                             section: they are the thing a lab edits most, and
                             burying them two levels deep (expand parameter →
                             scroll) made them look missing. Critical and
                             plausible bands stay here — they are safety limits
                             on the analyte, not the normal range. -->
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
                  @if (repetitive()) {
                    Tick a test to add a draw — tick the SAME test again for a repeat draw (e.g. Glucose at 0 / 60 / 120 min).
                  } @else {
                    Pick the individual tests included in this profile.
                  }
                } @else {
                  Pick the tests and profiles included in this package.
                }
              </p>
            </div>
            @if (d.type === 'profile') {
              <!-- Repetitive = a TIMED SERIES profile (GTT/OGTT-style): the same
                   member list, but every row carries a minutes-from-first-draw
                   offset and duplicates are legitimate. -->
              <label class="pf-rep-toggle" [class.pf-rep-toggle--on]="repetitive()">
                <input type="checkbox"
                       [checked]="repetitive()"
                       (change)="setRepetitive($any($event.target).checked)" />
                <span>Repetitive (timed series)</span>
              </label>
            }
            <span class="pf-picker-summary" [class.pf-picker-summary--on]="packageItems().length > 0">
              <strong>{{ packageItems().length }}</strong>
              @if (repetitiveActive()) {
                {{ packageItems().length === 1 ? 'draw' : 'draws' }}
              } @else {
                {{ packageItems().length === 1 ? 'member' : 'members' }}
              }
              <span class="pf-picker-summary__sep">·</span>
              <strong>{{ packageMembersTotal() | inr }}</strong>
            </span>
          </div>

          <!-- ── What this profile computes by itself ──────────────────
               Formulas live on the MEMBER tests (document-verbatim master
               data), so any profile that includes such a member computes it
               at result entry automatically — including brand-new custom
               profiles. This card makes that visible while composing. -->
          @if (d.type === 'profile' && (calcMembers().length > 0 || packageItems().length > 1)) {
            <div class="pf-calc-members">
              <p class="pf-calc-members__hdr">Auto-calculated in this profile</p>
              @for (m of calcMembers(); track m.id) {
                <div class="pf-calc-members__row">
                  <span class="pf-calc-members__name">{{ m.name }}</span>
                  <code class="pf-calc-members__f">{{ m.line }}</code>
                  @if (m.gate) { <span class="pf-calc-members__gate">{{ m.gate }}</span> }
                  <button type="button" class="pf-calc-editlink" (click)="openCalcEditor(m.id)">Edit</button>
                </div>
              }
              @if (calcMembers().length === 0) {
                <p class="pf-calc-members__foot">None yet — pick a member below to receive a formula.</p>
              }

              @if (calcEdit(); as ce) {
                <!-- ── Formula composer ─────────────────────────────────
                     The admin's own math over the profile's member codes.
                     Saved onto the TARGET member test (kind "expr"), so it
                     computes in every profile that includes that member. -->
                <div class="pf-calc-edit">
                  <div>
                    <label class="pf-label">Calculated test — receives the value</label>
                    <select class="pf-input" [ngModel]="ce.targetId"
                            (ngModelChange)="patchCalcEdit({ targetId: $event })">
                      @for (opt of calcTargetOptions(); track opt.id) {
                        <option [value]="opt.id">{{ opt.name }}</option>
                      }
                    </select>
                  </div>
                  <div>
                    <label class="pf-label">Formula — tap a code to insert it</label>
                    <div class="pf-calc-edit__chips">
                      @for (c of calcCodeChips(); track c.code) {
                        <button type="button" class="pf-calc-chipbtn"
                                [title]="c.name" (click)="appendCalcToken(c.code)">{{ c.code }}</button>
                      }
                      <button type="button" class="pf-calc-chipbtn pf-calc-chipbtn--var"
                              title="Patient age in years" (click)="appendCalcToken('AGE')">AGE</button>
                    </div>
                    <input type="text" class="pf-input pf-calc-edit__expr" spellcheck="false"
                           placeholder="e.g. BIO153 - BIO155 - (BIO154 / 5)"
                           [ngModel]="ce.expr" (ngModelChange)="patchCalcEdit({ expr: $event })" />
                  </div>
                  <div>
                    <label class="pf-label">Only calculate when — optional gate</label>
                    <input type="text" class="pf-input" spellcheck="false"
                           placeholder="e.g. BIO154 <= 400"
                           [ngModel]="ce.validWhen" (ngModelChange)="patchCalcEdit({ validWhen: $event })" />
                  </div>
                  @if (calcEditWarning(); as warn) { <p class="pf-calc-edit__warn">{{ warn }}</p> }
                  @if (calcEditError(); as err) { <p class="pf-calc-edit__err">{{ err }}</p> }

                  <!-- ── Try it: sample values in, live result out — BEFORE saving ── -->
                  @if (ce.expr.trim() && !calcEditError() && calcTryRefs().length > 0) {
                    <div class="pf-calc-try">
                      <p class="pf-label">Try it — enter sample values and check the result</p>
                      <div class="pf-calc-try__grid">
                        @for (ref of calcTryRefs(); track ref.key) {
                          <label class="pf-calc-try__field">
                            <span class="pf-calc-try__code" [title]="ref.name">{{ ref.key }}</span>
                            <input type="number" inputmode="decimal" step="any"
                                   class="pf-input pf-input--compact"
                                   [placeholder]="ref.placeholder"
                                   [ngModel]="calcTryValues()[ref.key] ?? ''"
                                   (ngModelChange)="setCalcTryValue(ref.key, $event)" />
                          </label>
                        }
                      </div>
                      <p class="pf-calc-try__out" [class.pf-calc-try__out--na]="calcTryResult().tone !== 'ok'">
                        {{ calcTryResult().text }}
                      </p>
                    </div>
                  }
                  <div class="pf-calc-edit__actions">
                    <pf-touch-btn size="sm" variant="ghost" (pressed)="calcEdit.set(null)">Cancel</pf-touch-btn>
                    @if (calcEditHasExisting()) {
                      <pf-touch-btn size="sm" variant="ghost" (pressed)="removeCalc()">Remove formula</pf-touch-btn>
                    }
                    <pf-touch-btn size="sm"
                                  [disabled]="!ce.expr.trim() || !!calcEditError() || calcSaving()"
                                  (pressed)="saveCalc()">
                      {{ calcSaving() ? 'Saving…' : 'Save formula' }}
                    </pf-touch-btn>
                  </div>
                </div>
              } @else {
                <div class="pf-calc-edit__actions">
                  <pf-touch-btn size="sm" variant="ghost" (pressed)="openCalcEditor(null)">Compose a formula</pf-touch-btn>
                </div>
              }

              <p class="pf-calc-members__foot">
                Calculated members fill in by themselves at result entry once their input tests
                are typed (always overridable). The formula is saved on the member test itself,
                so any profile — including a brand-new one — that picks the member computes it.
              </p>
            </div>
          }

          @if (repetitiveActive()) {
            <!-- ── The timed series: the AUTHORED order of draws ─────────
                 Rows sharing an offset render inside ONE "time point" card
                 (they're drawn together and get the same offsetMin). Drag a
                 row into another card to move it there; edit any row's offset
                 to split it out into its own time point; the pin merges a row
                 into the time point ABOVE it. The first group is always the
                 0-minute draw — offsets rebase so the earliest draw reads 0. -->
            @if (memberGroups().length === 0) {
              <p class="pf-series-empty">
                No draws yet — tick tests below to build the series.
              </p>
            } @else {
              <div class="pf-series" cdkDropListGroup>
                @for (g of memberGroups(); track g.offsetMin; let gi = $index; let gFirst = $first) {
                  <div class="pf-tp">
                    <div class="pf-tp__hdr">
                      @if (gFirst) {
                        <span class="pf-tp__badge pf-tp__badge--first">First draw</span>
                      } @else {
                        <span class="pf-tp__badge">+{{ g.offsetMin }} min</span>
                      }
                      <span class="pf-tp__count">{{ g.rows.length }} {{ g.rows.length === 1 ? 'test' : 'tests' }}</span>
                    </div>
                    <ul class="pf-tp__list" cdkDropList
                        [cdkDropListData]="gi"
                        (cdkDropListDropped)="dropSeriesRow($event)">
                      @for (r of g.rows; track r.key) {
                        <li class="pf-tp-row" cdkDrag>
                          <span class="pf-tp-row__grip" cdkDragHandle aria-hidden="true">⠿</span>
                          <span class="pf-tp-row__name">{{ memberName(r.testId) }}</span>
                          <label class="pf-tp-row__off">
                            <input type="number" inputmode="numeric" min="0" step="5"
                                   class="pf-input pf-input--compact pf-tp-row__num"
                                   title="Minutes from the first draw"
                                   [value]="r.offsetMin"
                                   (change)="setRowOffset(r.key, $any($event.target).value)" />
                            <span class="pf-tp-row__unit">min</span>
                          </label>
                          @if (!gFirst) {
                            <button type="button" class="pf-tp-row__btn press"
                                    title="Pin — merge this draw into the time point above"
                                    (click)="pinRow(r.key)">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 17v5"/>
                                <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>
                              </svg>
                            </button>
                          }
                          <button type="button" class="pf-tp-row__btn pf-tp-row__btn--danger press"
                                  title="Remove this draw"
                                  (click)="removeSeriesRow(r.key)">✕</button>
                        </li>
                      }
                    </ul>
                  </div>
                }
              </div>
            }
          }

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
                            @if (memberCalc(t); as def) {
                              <span class="pf-pkg-badge pf-pkg-badge--calc"
                                    [title]="'Auto-calculated at result entry: ' + calcLine(def)">ƒ Calculated</span>
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

          <!-- ── Report columns: department default, overridable HERE for
               this one test/profile (pick + order + rename; widths auto).
               A profile's override wins for its whole printed block; a
               test's own override applies when it is ordered standalone. -->
          @if (!customizingColumns()) {
            <p class="pf-lay-cols">
              <span class="pf-lay-cols__k">Report columns</span>
              <span class="pf-lay-cols__v">
                @if (testColumnsOverride(); as o) {
                  Custom for this {{ d.type === 'individual' ? 'test' : d.type }} — {{ columnsLabel(o) }}
                } @else {
                  Uses {{ selectedDeptName() || 'department' }} columns — {{ deptColumnsLabel() || 'defaults' }}
                }
              </span>
              <button type="button" class="pf-lay-cols__a" style="background:none;border:none;cursor:pointer;"
                      (click)="startCustomizeColumns()">
                {{ testColumnsOverride() ? 'Edit columns' : 'Customize' }}
              </button>
            </p>
          } @else {
            <div class="pf-lay-colwrap">
              <pf-report-columns-editor
                [hostManaged]="true"
                [initialColumns]="columnsEditorSeed()"
                [sourceColumns]="deptColumnCfg()"
                (stateChange)="onColumnsState($event)">
              </pf-report-columns-editor>
              <div class="pf-lay-colwrap__actions">
                <pf-touch-btn size="sm" variant="ghost" (pressed)="cancelCustomizeColumns()">Cancel</pf-touch-btn>
                @if (testColumnsOverride()) {
                  <pf-touch-btn size="sm" variant="ghost" [disabled]="columnsSaving()"
                                (pressed)="revertColumnsToDepartment()">Revert to department</pf-touch-btn>
                }
                <pf-touch-btn size="sm" variant="primary" [disabled]="columnsSaving()"
                              (pressed)="saveColumnsOverride()">
                  {{ columnsSaving() ? 'Saving…' : 'Save columns' }}
                </pf-touch-btn>
              </div>
            </div>
          }

          @if (layoutView() === 'notes') {
            <pf-test-notes-editor class="block"
              [fixedTestId]="d.id || ''"
              [hidePreview]="false"
              [parameters]="parameterNames()"
              [profileMembers]="previewProfileMembers()"
              [columnsOverride]="liveColumnsOverride()">
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
    .pf-lay-colwrap { margin: 0 0 14px; }
    .pf-lay-colwrap__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
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

    /* ── Repetitive (timed series) profiles ── */
    /* Pill toggle in the picker head — same chip language as the summary. */
    .pf-rep-toggle {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 6px 14px;
      font-size: 12.5px; font-weight: 600;
      white-space: nowrap;
      border-radius: 9999px;
      border: 1px solid var(--glass-border);
      background: var(--glass-bg);
      color: var(--text-secondary);
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .pf-rep-toggle:hover { border-color: rgba(168, 85, 247, 0.45); }
    .pf-rep-toggle--on {
      background: rgba(168, 85, 247, 0.14);
      border-color: rgba(168, 85, 247, 0.5);
      color: var(--text-primary);
    }
    .pf-rep-toggle input[type="checkbox"] { width: 15px; height: 15px; accent-color: #a855f7; flex-shrink: 0; }

    .pf-series-empty {
      margin: 0 0 16px;
      padding: 18px 12px;
      text-align: center;
      font-size: 12.5px;
      color: var(--text-tertiary);
      border: 1px dashed var(--glass-border);
      border-radius: 12px;
    }
    .pf-series { display: flex; flex-direction: column; gap: 10px; margin-bottom: 18px; }

    /* One "time point" card = every draw sharing an offsetMin. */
    .pf-tp {
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.02);
      padding: 8px 10px 10px;
    }
    .pf-tp__hdr { display: flex; align-items: center; gap: 8px; padding: 2px 2px 8px; }
    .pf-tp__badge {
      padding: 2px 10px;
      font-size: 10.5px; font-weight: 800;
      letter-spacing: 0.08em; text-transform: uppercase;
      border-radius: 9999px;
      background: rgba(168, 85, 247, 0.16);
      border: 1px solid rgba(168, 85, 247, 0.4);
      color: var(--violet-text, #c4b5fd);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }
    .pf-tp__badge--first {
      background: rgba(52, 211, 153, 0.12);
      border-color: rgba(52, 211, 153, 0.4);
      color: #34d399;
    }
    .pf-tp__count { font-size: 11px; color: var(--text-tertiary); }
    .pf-tp__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; min-height: 8px; }

    .pf-tp-row {
      display: flex; align-items: center; gap: 8px;
      padding: 7px 8px;
      border-radius: 10px;
      border: 1px solid var(--glass-border);
      background: var(--glass-bg);
    }
    .pf-tp-row__grip { cursor: grab; color: var(--text-tertiary); flex-shrink: 0; user-select: none; }
    .pf-tp-row__name {
      flex: 1 1 auto; min-width: 0;
      font-size: 13px; font-weight: 600;
      color: var(--text-primary);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .pf-tp-row__off { display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0; }
    .pf-tp-row__num { width: 64px; text-align: right; margin-bottom: 0; }
    .pf-tp-row__unit { font-size: 11px; color: var(--text-tertiary); }
    .pf-tp-row__btn {
      width: 28px; height: 28px; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 8px; cursor: pointer;
      border: 1px solid var(--glass-border);
      background: transparent;
      color: var(--text-tertiary);
      font-size: 12px;
    }
    .pf-tp-row__btn:hover { color: var(--text-primary); border-color: rgba(168, 85, 247, 0.5); }
    .pf-tp-row__btn--danger:hover { color: #f87171; border-color: rgba(248, 113, 113, 0.5); }

    /* CDK drag ghosts for series rows */
    .cdk-drag-preview.pf-tp-row { opacity: 0.9; }
    .pf-tp__list .cdk-drag-placeholder { opacity: 0.25; }
    .pf-tp__list.cdk-drop-list-dragging .pf-tp-row { transition: transform 200ms ease; }

    @media (pointer: coarse) {
      .pf-tp-row__btn { width: 36px; height: 36px; }
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
    .pf-pkg-badge--calc {
      background: rgba(167, 139, 250, 0.14);
      border-color: rgba(167, 139, 250, 0.38);
      color: #c4b5fd;
      text-transform: none;
      letter-spacing: 0.04em;
    }

    /* ── "Auto-calculated in this profile" summary ── */
    .pf-calc-members {
      margin: 10px 0 14px;
      padding: 10px 12px;
      border-radius: 12px;
      background: rgba(167, 139, 250, 0.07);
      border: 1px solid rgba(167, 139, 250, 0.22);
    }
    .pf-calc-members__hdr {
      font-size: 11px; font-weight: 800;
      letter-spacing: 0.1em; text-transform: uppercase;
      color: #c4b5fd;
      margin-bottom: 6px;
    }
    .pf-calc-members__row {
      display: flex; flex-wrap: wrap; align-items: baseline;
      gap: 4px 10px;
      padding: 3px 0;
      font-size: 12.5px;
    }
    .pf-calc-members__name { font-weight: 700; color: var(--text-primary, #fff); }
    .pf-calc-members__f {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11.5px;
      color: var(--text-secondary, rgba(255,255,255,0.75));
      overflow-wrap: anywhere;
    }
    .pf-calc-members__gate { font-size: 11px; color: var(--text-tertiary, rgba(255,255,255,0.55)); }
    .pf-calc-members__foot {
      margin-top: 6px;
      font-size: 11px;
      color: var(--text-tertiary, rgba(255,255,255,0.55));
    }
    .pf-calc-editlink {
      margin-left: auto;
      background: none; border: none; cursor: pointer;
      font-size: 11px; font-weight: 700;
      color: #c4b5fd;
      padding: 2px 6px;
    }
    .pf-calc-edit {
      margin-top: 10px;
      padding: 10px;
      border-radius: 10px;
      background: var(--glass-bg, rgba(255,255,255,0.04));
      border: 1px solid var(--glass-border, rgba(255,255,255,0.1));
      display: flex; flex-direction: column; gap: 10px;
    }
    .pf-calc-edit__chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
    .pf-calc-chipbtn {
      cursor: pointer;
      padding: 3px 9px;
      border-radius: 9999px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11px; font-weight: 700;
      background: rgba(167, 139, 250, 0.12);
      border: 1px solid rgba(167, 139, 250, 0.32);
      color: #c4b5fd;
    }
    .pf-calc-chipbtn--var {
      background: rgba(56, 189, 248, 0.12);
      border-color: rgba(56, 189, 248, 0.32);
      color: #7dd3fc;
    }
    .pf-calc-edit__expr { font-family: 'JetBrains Mono', ui-monospace, monospace; }
    .pf-calc-edit__err { font-size: 11.5px; color: #fda4af; }
    .pf-calc-edit__warn { font-size: 11.5px; color: #fcd34d; }
    .pf-calc-edit__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px; }
    .pf-calc-try {
      border-top: 1px dashed var(--glass-border, rgba(255,255,255,0.12));
      padding-top: 10px;
    }
    .pf-calc-try__grid {
      display: flex; flex-wrap: wrap; gap: 8px;
      margin: 4px 0 8px;
    }
    .pf-calc-try__field { display: flex; flex-direction: column; gap: 2px; width: 110px; }
    .pf-calc-try__code {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10.5px; font-weight: 700;
      color: var(--text-tertiary, rgba(255,255,255,0.55));
    }
    .pf-calc-try__out {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 14px; font-weight: 800;
      color: #6ee7b7;
    }
    .pf-calc-try__out--na { color: var(--text-tertiary, rgba(255,255,255,0.55)); font-weight: 600; font-size: 12px; }

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

    /* Reference range section: one block per analyte. A single-analyte test
       shows no frame at all — the tile IS the block — so the common case
       reads as a plain form rather than a nested container. */
    .pf-rr-block { display: flex; flex-direction: column; gap: 6px; }
    .pf-rr-block + .pf-rr-block {
      padding-top: 14px;
      border-top: 1px dashed var(--glass-border);
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

  /** Parsed test.calculation for the read-only "Calculated result" card.
   *  Includes documentary kinds (analyzer/assay-specific) — the admin should
   *  see what the master says even when the engine doesn't compute it. */
  private readonly _calcInfo = signal<{
    kind?: string; expr?: string; inputs?: string[]; constants?: string[];
    validWhen?: string; note?: string; unit?: string;
  } | null>(null);
  readonly calcInfo = this._calcInfo.asReadonly();

  /** Friendly name for the special formula kinds. */
  calcKindLabel(kind: string | undefined): string {
    switch (kind) {
      case 'expr': case 'inr': return 'Formula';
      case 'ckdepi2021_cr': return 'CKD-EPI 2021 (creatinine)';
      case 'ckdepi2021_cr_cys': return 'CKD-EPI 2021 (creatinine + cystatin C)';
      case 'rpi': return 'Reticulocyte production index';
      case 'r_value': return 'AASLD R-value (dynamic ULNs)';
      case 'analyzer': return 'Analyzer-derived (no LIS calculation)';
      case 'assay_specific': return 'Assay-specific (no universal formula)';
      case 'clinical_excluded': return 'Needs clinical inputs (not automated)';
      default: return 'Calculated';
    }
  }

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

  /**
   * Keep the test's flat `adultReferenceRange` in step with the bands.
   *
   * That column is what the Test Master grid shows and what the backend mirrors
   * back into a single analyte on save, so leaving it stale would put two
   * different ranges on screen for the same test. One all-patients band is
   * expressible as a flat string, so it is written; conditional bands are not,
   * so the field is cleared and the grid falls back to rendering every band.
   */
  private flatRangeFromBands(current: string): string {
    const numeric = this.numericFields();
    if (numeric.length !== 1) return current;
    const bands = numeric[0].referenceRanges ?? [];
    if (bands.length !== 1) return '';
    return formatRange(bands[0]) ?? '';
  }

  /**
   * Reference ranges open in the SIMPLE two-box form — one range for everyone,
   * which is what nearly every test needs. Sex/age bands are a deliberate step
   * in, not vocabulary to read past on the way to typing 70 and 100.
   *
   * The exception is a test that already HAS conditional bands: the two-box
   * form can't show those without hiding real configuration, so
   * {@link needsAdvancedRanges} forces the full editor open and the "Simple"
   * escape is withheld. Nothing is ever silently dropped.
   */
  private readonly _advancedRanges = signal(false);
  protected openAdvancedRanges() { this._advancedRanges.set(true); }
  protected closeAdvancedRanges() { this._advancedRanges.set(false); }

  /** True when this analyte's bands can't be expressed in the two-box form. */
  protected needsAdvancedRanges(p: FormField): boolean {
    const bands = p.referenceRanges ?? [];
    if (bands.length > 1) return true;
    const b = bands[0];
    if (!b) return false;
    return !!(b.sex && b.sex !== 'any') || b.minAge != null || b.maxAge != null || !!b.label;
  }

  protected showAdvancedRanges(p: FormField): boolean {
    return this._advancedRanges() || this.needsAdvancedRanges(p);
  }

  /** The band the simple form edits. Always index 0 — `addParameter` and
   *  `startReferenceRange` both seed one, so it exists by the time this
   *  renders; the empty object is a render-time guard, not a real state. */
  protected firstBand(p: FormField): ReferenceRange {
    return (p.referenceRanges ?? [])[0] ?? { segment: 'normal', min: null, max: null };
  }

  /**
   * One line telling the admin who this analyte's ranges apply to. A single
   * band is usually the all-patients case, but not always — a lab may
   * configure one female-only band — so it reports what the band actually
   * says rather than assuming.
   */
  protected bandsCaption(p: FormField): string {
    const bands = p.referenceRanges ?? [];
    if (bands.length === 0) return 'No range set';
    if (bands.length > 1) return `${bands.length} ranges by sex / age`;
    return deriveRangeLabel(bands[0]) ?? 'Applies to every patient';
  }

  /** Analytes that can carry a numeric band — the Reference range section's
   *  subject. A qualitative test (Positive/Negative) legitimately has none. */
  protected readonly numericFields = computed(() =>
    this.fields().filter(f => this.isNumericType(f.type)));

  /**
   * Give a test its first reference range without making the admin think in
   * "parameters" first. A single-analyte test IS the test, so the analyte is
   * created named after it, carrying the unit already typed in Results, with
   * one all-patients band ready to fill in.
   */
  protected startReferenceRange(): void {
    if (this.numericFields().length > 0) return;
    this.addParameter();
    const i = this.fields().length - 1;
    const d = this._draft();
    this.patchField(i, {
      name: (d.name ?? '').trim() || 'Result',
      unit: (d.unit ?? '').trim() || undefined,
    });
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
    if (v === 'layout') {
      if (this.deptColumnCfg().length === 0) this.loadDeptColumns(this._draft().departmentId);
      this.loadTestColumns();
    }
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
  /** The DEPARTMENT's report columns — the default this test inherits, and
   *  the seed + "add back" source for the per-test override editor. */
  protected readonly deptColumnCfg = signal<ReportColumn[]>([]);
  deptColumnsLabel(): string { return this.columnsLabel(this.deptColumnCfg()); }

  /** Human "Investigation · Result · …" line for a column set. */
  columnsLabel(cols: ReportColumn[]): string {
    return (cols ?? []).map(c => c.label || c.name).filter(Boolean).join(' · ');
  }

  private loadDeptColumns(departmentId: string | null | undefined): void {
    if (!departmentId) { this.deptColumnCfg.set([]); return; }
    this.layoutSvc.getDeptColumns(departmentId)
      .then(res => this.deptColumnCfg.set(res?.columns ?? []))
      .catch(() => this.deptColumnCfg.set([]));
  }

  // ── Per-test/per-profile column override (Report layout section) ──
  // Stored on the test's report-layout row; NULL = inherit the department.
  // The editor is the SAME strip component /admin/reports uses, in its
  // host-managed pick + order + rename mode — this card does the saving.

  protected readonly testColumnsOverride = signal<ReportColumn[] | null>(null);
  protected readonly customizingColumns = signal(false);
  protected readonly columnsSaving = signal(false);
  /** Seed handed to the editor when Customize opens (a FRESH array reference
   *  each time — the editor re-seeds on reference change). */
  protected readonly columnsEditorSeed = signal<ReportColumn[] | null>(null);
  /** The editor's live (unsaved) state — drives the preview's columnsOverride
   *  so column edits show in the exact-PDF preview before Save. */
  protected readonly liveColumnsState = signal<ReportColumn[] | null>(null);
  protected readonly liveColumnsOverride = computed<ReportColumn[] | null>(() =>
    this.customizingColumns() ? this.liveColumnsState() : null);

  private loadTestColumns(): void {
    const id = this._draft().id;
    if (!id) { this.testColumnsOverride.set(null); return; }
    this.layoutSvc.getTestColumns(id)
      .then(res => this.testColumnsOverride.set(res.configured ? (res.columns ?? null) : null))
      .catch(() => this.testColumnsOverride.set(null));
  }

  startCustomizeColumns(): void {
    const seed = this.testColumnsOverride() ?? this.deptColumnCfg();
    this.columnsEditorSeed.set(seed.map(c => ({ ...c })));
    this.liveColumnsState.set(null);
    this.customizingColumns.set(true);
  }

  cancelCustomizeColumns(): void {
    this.customizingColumns.set(false);
    this.liveColumnsState.set(null);
  }

  onColumnsState(state: ColumnsEditorState): void {
    this.liveColumnsState.set(state.columns);
  }

  async saveColumnsOverride(): Promise<void> {
    const id = this._draft().id;
    const cols = this.liveColumnsState() ?? this.columnsEditorSeed();
    if (!id || !cols || cols.length === 0) return;
    this.columnsSaving.set(true);
    try {
      const payload = cols.map((c, i) => ({ ...c, order: i + 1 }));
      await this.layoutSvc.saveTestColumns(id, payload);
      this.testColumnsOverride.set(payload);
      this.customizingColumns.set(false);
      this.liveColumnsState.set(null);
      this.toasts.success('Report columns saved for this ' + (this._draft().type === 'individual' ? 'test' : this._draft().type) + '.');
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.columnsSaving.set(false);
    }
  }

  async revertColumnsToDepartment(): Promise<void> {
    const id = this._draft().id;
    if (!id) return;
    this.columnsSaving.set(true);
    try {
      await this.layoutSvc.saveTestColumns(id, null);
      this.testColumnsOverride.set(null);
      this.customizingColumns.set(false);
      this.liveColumnsState.set(null);
      this.toasts.success('Reverted to the department columns.');
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.columnsSaving.set(false);
    }
  }

  /** Members handed to the exact-PDF preview so a PROFILE previews as it
   *  prints (one row per member, profile notes + column override applied). */
  readonly previewProfileMembers = computed<PreviewProfileMember[]>(() => {
    if (this._draft().type === 'individual') return [];
    const byId = this._memberById();
    const out: PreviewProfileMember[] = [];
    for (const id of this.packageItems()) {
      const t = byId.get(id);
      if (t) out.push({ id, name: t.name, parameters: t.parameters ?? null });
    }
    return out;
  });

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
  readonly packageQuery = signal('');

  // ── Repetitive (timed series) profile state ─────────────────
  // A repetitive profile is an ORDERED series of draws: each row is one test
  // performance carrying a minutes-from-first-draw offset, and the same test
  // may appear in several rows (OGTT = Glucose at 0/60/120). When repetitive
  // is ON, `_memberRows` is the source of truth and the plain `_packageItems`
  // list (the non-repetitive path) is kept in sync as the DISTINCT ids so
  // flipping the toggle never loses members.
  readonly repetitive = signal(false);
  private readonly _memberRows = signal<MemberRow[]>([]);
  /** Repetitive semantics only apply while the draft IS a profile — packages
   *  and individuals always take the classic `_packageItems` path. */
  readonly repetitiveActive = computed(() => this._draft().type === 'profile' && this.repetitive());
  /** Effective member ids: row-per-draw when repetitive (duplicates included —
   *  each draw is one performed test), else the classic distinct-id list. */
  readonly packageItems = computed<string[]>(() =>
    this.repetitiveActive() ? this._memberRows().map(r => r.testId) : this._packageItems());

  /** Rows bucketed into "time point" cards. Rows are ALWAYS normalized (sorted
   *  by offset, earliest rebased to 0), so consecutive runs == offset groups. */
  readonly memberGroups = computed<{ offsetMin: number; rows: MemberRow[] }[]>(() => {
    const groups: { offsetMin: number; rows: MemberRow[] }[] = [];
    for (const r of this._memberRows()) {
      const last = groups[groups.length - 1];
      if (last && last.offsetMin === r.offsetMin) last.rows.push(r);
      else groups.push({ offsetMin: r.offsetMin, rows: [r] });
    }
    return groups;
  });

  /** Sort rows into series order and rebase so the earliest draw is minute 0.
   *  Array.prototype.sort is stable, so authored order within a time point is
   *  preserved. Removing the whole first draw shifts the rest back (OGTT minus
   *  its 0-min draw: 60/120 → 0/60), keeping "minutes from FIRST draw" honest. */
  private normalizeRows(rows: MemberRow[]): MemberRow[] {
    if (rows.length === 0) return rows;
    const sorted = rows.slice().sort((a, b) => a.offsetMin - b.offsetMin);
    const min = sorted[0].offsetMin;
    return min === 0 ? sorted : sorted.map(r => ({ ...r, offsetMin: r.offsetMin - min }));
  }

  /** Single write path for the series — normalizes, then mirrors the distinct
   *  ids into `_packageItems` so the non-repetitive path never goes stale. */
  private setRows(rows: MemberRow[]) {
    const normalized = this.normalizeRows(rows);
    this._memberRows.set(normalized);
    this._packageItems.set([...new Set(normalized.map(r => r.testId))]);
  }

  /** Flip the series mode. ON reconciles rows with the ticked members (kept
   *  rows preserve their offsets; new ids join the first draw); OFF collapses
   *  the rows back to a distinct member list. */
  setRepetitive(on: boolean) {
    this.repetitive.set(on);
    if (on) {
      const ids = this._packageItems();
      const wanted = new Set(ids);
      const rows = this._memberRows().filter(r => wanted.has(r.testId));
      const have = new Set(rows.map(r => r.testId));
      for (const id of ids) {
        if (!have.has(id)) rows.push({ key: newRowKey(), testId: id, offsetMin: 0 });
      }
      this._memberRows.set(this.normalizeRows(rows));
    } else {
      this._packageItems.set([...new Set(this._memberRows().map(r => r.testId))]);
    }
  }

  /** Picker-catalog name for a series row (rows store ids only). */
  memberName(testId: string): string {
    return this._memberById().get(testId)?.name ?? '(unknown test)';
  }

  // ── Calculated members (ƒ badge + the profile's auto-calculated card) ──

  /** Computable formula on a picker/member test, or null. */
  memberCalc(t: { calculation?: string | null } | undefined): CalcDef | null {
    return t ? parseCalc(t.calculation) : null;
  }

  /** One-line formula: the expression itself (codes are the admin's
   *  vocabulary here), or the friendly name of a special kind. */
  calcLine(def: CalcDef): string {
    return (def.kind === 'expr' || def.kind === 'inr') && def.expr
      ? def.expr
      : this.calcKindLabel(def.kind);
  }

  // ── Formula composer (admin-authored calculations) ─────────────────
  // The vision: every profile can define its own math — pick which member
  // receives the value, write the expression over the sibling codes. The
  // formula is PATCHed onto the target member test (kind "expr"), so the
  // runtime path is identical to the master-shipped formulas and the math
  // follows the member into any other profile.

  readonly calcEdit = signal<{ targetId: string; expr: string; validWhen: string } | null>(null);
  readonly calcSaving = signal(false);

  /** Recognised non-code identifiers: patient age + the lab constants. */
  private static readonly CALC_VARS = new Set(['AGE', 'ISI', 'MNPT', 'NORMAL_HCT']);

  readonly calcTargetOptions = computed(() => {
    const byId = this._memberById();
    return this.packageItems()
      .map(id => ({ id, name: byId.get(id)?.name ?? '(unknown test)' }));
  });

  /** Insertable code chips: every OTHER picked member that has a test code. */
  readonly calcCodeChips = computed(() => {
    const ce = this.calcEdit();
    const byId = this._memberById();
    const out: { code: string; name: string }[] = [];
    for (const id of this.packageItems()) {
      if (id === ce?.targetId) continue;
      const t = byId.get(id);
      const code = t?.testCode?.trim().toUpperCase();
      if (t && code && !out.some(c => c.code === code)) out.push({ code, name: t.name });
    }
    return out;
  });

  readonly calcEditHasExisting = computed(() => {
    const ce = this.calcEdit();
    return !!ce && !!this.memberCalc(this._memberById().get(ce.targetId));
  });

  /** Replacing a special master equation (eGFR, RPI…) with plain math is
   *  legal but worth a heads-up; restore-to-default brings the master back. */
  readonly calcEditWarning = computed(() => {
    const ce = this.calcEdit();
    if (!ce) return null;
    const def = this.memberCalc(this._memberById().get(ce.targetId));
    if (def && def.kind !== 'expr' && def.kind !== 'inr')
      return `This test currently uses the built-in ${this.calcKindLabel(def.kind)} equation — saving replaces it with your formula (Restore to default brings the master equation back).`;
    return null;
  });

  readonly calcEditError = computed(() => {
    const ce = this.calcEdit();
    if (!ce) return null;
    if (!ce.targetId) return 'Pick which test receives the calculated value.';
    const codes = new Set(this.calcCodeChips().map(c => c.code));
    const check = (src: string, what: string): string | null => {
      const lint = lintExpr(src);
      if (!lint.ok) return `The ${what} doesn't parse — check operators and brackets.`;
      const unknown = lint.refs.filter(r =>
        !codes.has(r.toUpperCase()) && !TestEditorComponent.CALC_VARS.has(r.toUpperCase()));
      if (unknown.length > 0)
        return `Unknown code${unknown.length > 1 ? 's' : ''} in the ${what}: ${unknown.join(', ')} — use the chips above (other members of this profile).`;
      return null;
    };
    if (ce.expr.trim()) {
      const e = check(ce.expr, 'formula');
      if (e) return e;
    }
    if (ce.validWhen.trim()) {
      const e = check(ce.validWhen, 'gate');
      if (e) return e;
    }
    return null;
  });

  openCalcEditor(memberId: string | null) {
    const ids = this.packageItems();
    const target = memberId ?? ids[0] ?? '';
    const def = this.memberCalc(this._memberById().get(target));
    this.calcEdit.set({
      targetId: target,
      expr: def && (def.kind === 'expr' || def.kind === 'inr') ? (def.expr ?? '') : '',
      validWhen: def?.validWhen ?? '',
    });
    this.calcTryValues.set({});
  }

  patchCalcEdit(p: Partial<{ targetId: string; expr: string; validWhen: string }>) {
    const ce = this.calcEdit();
    if (!ce) return;
    // Switching target re-seeds from that member's existing formula.
    if (p.targetId && p.targetId !== ce.targetId) { this.openCalcEditor(p.targetId); return; }
    this.calcEdit.set({ ...ce, ...p });
  }

  appendCalcToken(token: string) {
    const ce = this.calcEdit();
    if (!ce) return;
    const sep = ce.expr.length === 0 || ce.expr.endsWith(' ') || ce.expr.endsWith('(') ? '' : ' ';
    this.calcEdit.set({ ...ce, expr: ce.expr + sep + token });
  }

  /** The CalcDef the composer's current state would save — shared by Save
   *  and the try-it preview so what you test is exactly what is stored. */
  private composerDef(): CalcDef | null {
    const ce = this.calcEdit();
    if (!ce || !ce.expr.trim() || this.calcEditError()) return null;
    const target = this._memberById().get(ce.targetId);
    const refs = lintExpr(ce.expr).refs.concat(ce.validWhen.trim() ? lintExpr(ce.validWhen).refs : []);
    const allRefs = [...new Set(refs.map(s => s.toUpperCase()))];
    // Codes are inputs; ISI/MNPT/NORMAL_HCT are lab constants; AGE is
    // neither — the evaluator supplies it from the patient record.
    const inputs = allRefs.filter(r => !TestEditorComponent.CALC_VARS.has(r));
    const constants = allRefs.filter(r => TestEditorComponent.CALC_VARS.has(r) && r !== 'AGE');
    return {
      kind: 'expr',
      expr: ce.expr.trim(),
      inputs,
      constants,
      ...(ce.validWhen.trim() ? { validWhen: ce.validWhen.trim() } : {}),
      unit: target?.unit ?? undefined,
      note: 'Authored in Test Master (profile formula composer).',
    };
  }

  // ── Try-it preview: sample values → live result, before anything saves ──

  readonly calcTryValues = signal<Record<string, string>>({});

  setCalcTryValue(key: string, v: unknown) {
    this.calcTryValues.update(m => ({ ...m, [key]: String(v ?? '') }));
  }

  /** Every identifier the current formula (and gate) reads, as try-it input
   *  fields: member codes named after their tests, AGE, and lab constants
   *  (placeholder = the shipped default, so leaving one blank uses it). */
  readonly calcTryRefs = computed(() => {
    const ce = this.calcEdit();
    if (!ce?.expr.trim()) return [];
    const refs = lintExpr(ce.expr).refs.concat(ce.validWhen.trim() ? lintExpr(ce.validWhen).refs : []);
    const byCode = new Map(this.calcCodeChips().map(c => [c.code, c.name]));
    const out: { key: string; name: string; placeholder: string }[] = [];
    for (const r of [...new Set(refs.map(s => s.toUpperCase()))]) {
      if (r === 'AGE') out.push({ key: 'AGE', name: 'Patient age in years', placeholder: 'years' });
      else if (TestEditorComponent.CALC_VARS.has(r))
        out.push({ key: r, name: 'Lab constant (blank = default)', placeholder: String(CALC_CONSTANT_DEFAULTS[r] ?? '') });
      else out.push({ key: r, name: byCode.get(r) ?? r, placeholder: 'value' });
    }
    return out;
  });

  readonly calcTryResult = computed<{ tone: 'ok' | 'na'; text: string }>(() => {
    const ce = this.calcEdit();
    const def = this.composerDef();
    if (!ce || !def) return { tone: 'na', text: '' };
    const vals = this.calcTryValues();
    const num = (k: string): number | null => {
      const raw = vals[k];
      if (raw == null || raw === '') return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    };
    const res = evaluateCalc(def, {
      value: (ref) => num(ref.toUpperCase()),
      constant: (n) => num(n) ?? undefined,
      age: num('AGE'),
    });
    if (res.invalid) return { tone: 'na', text: 'Not calculable — the gate condition fails for these values.' };
    if (res.missing.length > 0) return { tone: 'na', text: `Waiting for: ${res.missing.join(', ')}` };
    const unit = this._memberById().get(ce.targetId)?.unit;
    return { tone: 'ok', text: `= ${res.value}${unit ? ' ' + unit : ''}` };
  });

  saveCalc() {
    const ce = this.calcEdit();
    const def = this.composerDef();
    if (!ce || !def) return;
    const target = this._memberById().get(ce.targetId);
    this.calcSaving.set(true);
    this.api.patch<Test>(`/api/tests/${ce.targetId}`, { calculation: JSON.stringify(def) }).subscribe({
      next: () => {
        this._allIndividualTests.update(list =>
          list.map(t => t.id === ce.targetId ? { ...t, calculation: JSON.stringify(def) } : t));
        this.calcSaving.set(false);
        this.calcEdit.set(null);
        this.toasts.success(`${target?.name ?? 'Test'} now auto-calculates.`);
      },
      error: (e) => {
        this.calcSaving.set(false);
        this.toasts.error(ApiError.from(e).message);
      },
    });
  }

  removeCalc() {
    const ce = this.calcEdit();
    if (!ce) return;
    this.calcSaving.set(true);
    this.api.patch<Test>(`/api/tests/${ce.targetId}`, { calculation: '' }).subscribe({
      next: () => {
        this._allIndividualTests.update(list =>
          list.map(t => t.id === ce.targetId ? { ...t, calculation: null } : t));
        this.calcSaving.set(false);
        this.calcEdit.set(null);
        this.toasts.success('Formula removed.');
      },
      error: (e) => {
        this.calcSaving.set(false);
        this.toasts.error(ApiError.from(e).message);
      },
    });
  }

  /** The picked members that auto-compute, with their formula lines —
   *  shown while composing so a new profile's behaviour is visible upfront. */
  readonly calcMembers = computed(() => {
    const byId = this._memberById();
    const out: { id: string; name: string; line: string; gate: string | null }[] = [];
    for (const id of this.packageItems()) {
      const t = byId.get(id);
      const def = this.memberCalc(t);
      if (!t || !def) continue;
      out.push({
        id,
        name: t.name,
        line: this.calcLine(def),
        gate: def.validWhen ? `only when ${def.validWhen}` : null,
      });
    }
    return out;
  });

  /** Commit a row's edited offset (on change, not per-keystroke, so the group
   *  re-sort doesn't yank the input mid-typing). Editing is how a draw SPLITS
   *  out of a time point — set a new offset and it becomes its own group. */
  setRowOffset(key: string, raw: unknown) {
    const n = Number(raw);
    const offsetMin = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
    this.setRows(this._memberRows().map(r => r.key === key ? { ...r, offsetMin } : r));
  }

  /** Pin = merge this draw into the time point ABOVE its own. */
  pinRow(key: string) {
    const groups = this.memberGroups();
    const gi = groups.findIndex(g => g.rows.some(r => r.key === key));
    if (gi <= 0) return; // first group has nothing above it
    const target = groups[gi - 1].offsetMin;
    this.setRows(this._memberRows().map(r => r.key === key ? { ...r, offsetMin: target } : r));
  }

  removeSeriesRow(key: string) {
    this.setRows(this._memberRows().filter(r => r.key !== key));
  }

  /** Drag-drop between/within time-point cards. Each card is a cdkDropList
   *  carrying its GROUP INDEX as data; a dropped row adopts the destination
   *  group's offset (the simple, predictable rule). */
  dropSeriesRow(ev: CdkDragDrop<number>) {
    const from = ev.previousContainer.data;
    const to = ev.container.data;
    if (from === to && ev.previousIndex === ev.currentIndex) return;
    const groups = this.memberGroups().map(g => ({ offsetMin: g.offsetMin, rows: g.rows.slice() }));
    const src = groups[from];
    const dst = groups[to];
    if (!src || !dst) return;
    const [moved] = src.rows.splice(ev.previousIndex, 1);
    if (!moved) return;
    dst.rows.splice(ev.currentIndex, 0, { ...moved, offsetMin: dst.offsetMin });
    this.setRows(groups.flatMap(g => g.rows));
  }

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
   *  admins set a sensible bundle price below the member total. Repetitive
   *  series price EVERY row — each draw is a separately performed test. */
  readonly packageMembersTotal = computed(() => {
    const by = this._memberById();
    return this.packageItems().reduce((s, id) => s + (by.get(id)?.price ?? 0), 0);
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
    const chosen = new Set(this.packageItems());
    if (chosen.size > 0) {
      const picked = this.pickerSource()
        .filter(t => chosen.has(t.id))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (picked.length > 0) out.unshift({ department: SELECTED_GROUP, tests: picked });
    }
    return out;
  });

  isInPackage(id: string): boolean { return this.packageItems().includes(id); }
  togglePackageMember(id: string) {
    if (this.repetitiveActive()) {
      // Repetitive: every tick APPENDS a draw (duplicates are legitimate — a
      // repeat draw of the same test). It joins the LAST time point; removal
      // happens only via the series row's ✕, never by unticking.
      const rows = this._memberRows();
      const offsetMin = rows.length > 0 ? rows[rows.length - 1].offsetMin : 0;
      this.setRows([...rows, { key: newRowKey(), testId: id, offsetMin }]);
      return;
    }
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
    // Master calculated-result definition — display-only (the formulas ship
    // with the master and survive restore-to-default; there is no editor).
    try {
      this._calcInfo.set(t.calculation ? JSON.parse(t.calculation) : null);
    } catch {
      this._calcInfo.set(null);
    }
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
        const ids: string[] = items
          .map((it: unknown) => typeof it === 'string' ? it : ((it as { testId?: string })?.testId ?? ''))
          .filter((id: string) => id.length > 0);
        this._packageItems.set([...new Set(ids)]);
        // Repetitive profiles additionally carry per-row offsets — rebuild the
        // ordered series (row order = authored order; offsetMin defaults to 0).
        if (t.type === 'profile' && blob.repetitive === true) {
          this.repetitive.set(true);
          this._memberRows.set(this.normalizeRows(items
            .map((it: unknown) => {
              const o = it as { testId?: string; offsetMin?: number };
              const testId = typeof it === 'string' ? it : (o?.testId ?? '');
              const n = Number(typeof it === 'string' ? 0 : o?.offsetMin);
              return { key: newRowKey(), testId, offsetMin: Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0 };
            })
            .filter((r: MemberRow) => r.testId.length > 0)));
        } else {
          this.repetitive.set(false);
          this._memberRows.set([]);
        }
      } catch {
        this._packageItems.set([]);
        this._memberRows.set([]);
        this.repetitive.set(false);
      }
    } else {
      this._packageItems.set([]);
      this._memberRows.set([]);
      this.repetitive.set(false);
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

  /**
   * The comparator the band EFFECTIVELY uses on each bound, for the ≥/> and
   * ≤/< selects. Op absent = the backward-compatible default: a two-sided
   * band is inclusive on both bounds (min ≤ v ≤ max normal), a one-sided
   * band is strict `<`/`>`. Picking a value stores it explicitly.
   */
  minOpShown(r: ReferenceRange): 'gt' | 'gte' {
    return r.minOp ?? (r.max != null ? 'gte' : 'gt');
  }
  maxOpShown(r: ReferenceRange): 'lt' | 'lte' {
    return r.maxOp ?? (r.min != null ? 'lte' : 'lt');
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
      if (this.packageItems().length === 0) {
        this.toasts.warning('Add at least one member test to the profile');
        return;
      }
      // A timed series with a single time point is just a plain profile — the
      // whole point is draws at DIFFERENT offsets (0/60/120…).
      if (this.repetitive() && new Set(this._memberRows().map(r => r.offsetMin)).size < 2) {
        this.toasts.warning('A timed series needs at least two time points');
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
    // Repetitive profiles serialise the ORDERED series with offsets — the
    // shape the backend contract reads: {"repetitive":true,"items":[{"testId",
    // "offsetMin"}]} with row order = authored order, first group at 0 and
    // offsets non-decreasing (guaranteed by normalizeRows). Everything else
    // keeps the classic { items: [{ testId }] } shape byte-for-byte.
    const parametersJson = bundle
      ? (d.type === 'profile' && this.repetitive()
          ? JSON.stringify({
              repetitive: true,
              items: this.normalizeRows(this._memberRows()).map(r => ({ testId: r.testId, offsetMin: r.offsetMin }))
            })
          : JSON.stringify({ items: this._packageItems().map(id => ({ testId: id })) }))
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
      adultReferenceRange: pkg ? undefined : this.flatRangeFromBands(d.adultReferenceRange),
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
