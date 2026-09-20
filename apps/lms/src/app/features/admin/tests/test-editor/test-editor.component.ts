import { AfterViewInit, ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ReportLayoutService } from '../../../../core/services/report-layout.service';
import { ReportColumn } from '../../../../shared/models/report-layout.model';
import { ColumnsEditorState, ReportColumnsEditorComponent } from '../../report-template/report-columns-editor.component';
import { PreviewProfileMember, ReportPdfPreviewComponent } from '../../report-template/report-pdf-preview.component';
import { Department } from '../../../../shared/models/tenant.model';
import { Test, TestOptionRow, TestParameter, TestParametersBlob } from '../../../../shared/models/test.model';
import { ReferralLab } from '../../../../shared/models/referral-lab.model';
import { ApiError } from '../../../../shared/models/api-response.model';
import {
  ConditionEditorComponent,
  FieldTypePickerComponent,
  FormField,
  FormFieldType,
  ReferenceRange,
  ShowWhen,
  ValidationEditorComponent,
  ValidationPatch,
  hasOptions as registryHasOptions,
  getFieldType
} from '../../../../shared/forms';
import { parseCalc, lintExpr, evaluateCalc, CALC_CONSTANT_DEFAULTS, CalcDef } from '../../../../shared/utils/calculation';
import { NumberInputComponent } from '../../../../shared/primitives/number-input.component';
import { CurrencyInrPipe } from '../../../../shared/pipes/currency-inr.pipe';
import { SegmentedComponent, SegmentedOption } from '../../../../shared/primitives/segmented.component';
import { AgGridAngular } from 'ag-grid-angular';
import { AllCommunityModule, CellClickedEvent, CellValueChangedEvent, ColDef, ModuleRegistry } from 'ag-grid-community';
import { ThemeService } from '../../../../core/services/theme.service';
import { gridThemeDark, gridThemeLight } from '../tests/tests.component';
import { RangeSelectEditorComponent, RangeSelectOption } from './range-select-editor.component';

ModuleRegistry.registerModules([AllCommunityModule]);
import { SelectComponent, PfSelectOption } from '../../../../shared/primitives/select.component';
import { TouchButtonComponent } from '../../../../shared/primitives/touch-button.component';
import { TestLayoutEditorComponent } from '../test-layout-editor.component';
import { ReportStructureComponent } from '../report-structure.component';
import { TestNotesEditorComponent } from '../../report-template/test-notes-editor.component';
import { TestConsumablesComponent } from '../test-consumables.component';
import { AuthService } from '../../../../core/auth/auth.service';

/** A shared option-group vocabulary as served by /api/option-groups. */
interface OgGroupLite {
  code: string;
  name: string;
  values: { code: string | null; value: string; normal: boolean; active: boolean }[];
  links: { testId: string }[];
}
import { describeAllRanges, deriveRangeLabel, formatRange } from '../../../../shared/utils/reference-range';
import { NavBackService } from '../../../../core/services/nav-back.service';

const SELECTED_GROUP = 'Selected';

type TestSection = 'identity' | 'pricing' | 'sample' | 'results' | 'layout' | 'consumables';

export interface DraftTest {
  id?: string;
  name: string;
  type: 'individual' | 'profile' | 'package';
  flow: 'direct' | 'approval';
  price: number;
  taxSlab: number;
  departmentId: string;
  tatHours: number;
  sampleType: string;
  tubeColor: string;
  testCode: string;
  shortName: string;
  section: string;
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
  outsourcedVendorId: string;
  outsourcedDepartmentId: string;
}

const LEGACY_TYPE_MAP: Record<string, FormFieldType> = {
  numeric: 'number',
  text: 'text',
  options: 'select',
  multiline: 'textarea'
};
const FORWARD_TYPE_MAP: Partial<Record<FormFieldType, string>> = {
  number: 'numeric',
  text: 'text',
  select: 'options',
  multiselect: 'options',
  radio: 'options',
  checkbox: 'options',
  textarea: 'multiline',
  date: 'text',
  time: 'text'
};

function newFieldId(): string {
  return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** One row in a repetitive profile's authored series. */
export interface MemberRow {
  /** Stable row identity — random string so duplicate test instances are distinct. */
  key: string;
  /** Test id of the member performed in this draw. */
  testId: string;
  /** Minutes from the first draw (0 = first draw / baseline; 60 = 1 hour post-dose). */
  offsetMin: number;
}

function newRowKey(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function makeEmptyDraft(): DraftTest {
  return {
    name: '',
    type: 'individual',
    flow: 'direct',
    price: 0,
    taxSlab: 0,
    departmentId: '',
    tatHours: 24,
    sampleType: '',
    tubeColor: '',
    testCode: '',
    shortName: '',
    section: '',
    profile: '',
    sampleVolumeMl: null,
    fastingRequired: false,
    methodology: '',
    resultType: '',
    unit: '',
    reportFormat: '',
    adultReferenceRange: '',
    criticalLow: null,
    criticalHigh: null,
    parametersJson: '',
    conditionsJson: '[]',
    isActive: true,
    outsourcedVendorId: '',
    outsourcedDepartmentId: ''
  };
}

@Component({
  selector: 'pf-test-editor',
  standalone: true,
  imports: [
    AgGridAngular,
    FormsModule,
    CurrencyInrPipe,
    NumberInputComponent,
    ConditionEditorComponent,
    FieldTypePickerComponent,
    ValidationEditorComponent,
    SegmentedComponent,
    SelectComponent,
    TouchButtonComponent,
    TestLayoutEditorComponent, ReportStructureComponent,
    TestNotesEditorComponent,
    TestConsumablesComponent,
    DragDropModule,
    ReportColumnsEditorComponent,
    ReportPdfPreviewComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './test-editor.component.html',
  styleUrl: './test-editor.component.scss'
})
export class TestEditorComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly layoutSvc = inject(ReportLayoutService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  protected canManageInventory() { return this.auth.hasPermission('manage_inventory'); }
  private readonly router = inject(Router);
  private readonly navBack = inject(NavBackService);

  // ── Shared option groups (Test Master → Option groups) ─────────────
  // A dropdown parameter picks its vocabulary from these; the values render
  // as a DISABLED preview here. Existing groups are edited ONLY in the
  // Option groups tab (owner's rule — no edit affordance from inside a
  // test); the inline editor is reserved for creating a NEW vocabulary.
  readonly ogGroups = signal<OgGroupLite[]>([]);
  /** Picker options: group name + its values as the searchable hint. */
  readonly ogGroupOptions = computed<PfSelectOption<string>[]>(() =>
    this.ogGroups().map(g => ({
      value: g.code,
      label: g.name,
      hint: g.values.map(v => v.value).join(' / '),
    })));
  private readonly _customOpt = signal<Record<number, boolean>>({});

  /** The shared group whose value list exactly matches this parameter's rows. */
  groupForField(i: number): OgGroupLite | null {
    const rows = this.rowsFor(i);
    if (!rows.length) return null;
    const sig = rows.map(r => (r.value ?? '').trim()).join('');
    return this.ogGroups().find(g =>
      g.values.map(v => v.value.trim()).join('') === sig) ?? null;
  }
  /** True while the user is authoring a NEW vocabulary for this parameter. */
  optCustom(i: number): boolean { return this._customOpt()[i] === true; }
  /** Locked = rows match a shared group and we're not in create-new mode. */
  optLocked(i: number): boolean { return !this.optCustom(i) && this.groupForField(i) !== null; }
  groupTestCount(g: OgGroupLite): number { return new Set(g.links.map(l => l.testId)).size; }

  applyOptionGroup(i: number, code: string) {
    const g = this.ogGroups().find(x => x.code === code);
    if (!g) return;
    this._customOpt.update(m => ({ ...m, [i]: false }));
    this.setOptionRows(i, g.values.map(v => ({
      code: v.code ?? null, value: v.value, normal: v.normal, active: v.active,
    })));
  }
  startCustomOption(i: number) { this._customOpt.update(m => ({ ...m, [i]: true })); }
  cancelCustomOption(i: number) {
    this._customOpt.update(m => ({ ...m, [i]: false }));
    // Snap back to the first shared group if the draft no longer matches one.
    if (!this.groupForField(i) && this.ogGroups().length) {
      const rows = this.rowsFor(i);
      if (rows.length === 0) return;
    }
  }
  // ── Units: one shared vocabulary, typeahead everywhere ──────────────
  private static readonly MEDICAL_UNITS: string[] = [
    'mg/dL', 'g/dL', 'g/L', 'mg/L', 'µg/dL', 'µg/L', 'ng/mL', 'ng/dL', 'ng/L', 'pg/mL',
    'mmol/L', 'µmol/L', 'nmol/L', 'pmol/L', 'mEq/L', 'mOsm/kg',
    'IU/L', 'U/L', 'IU/mL', 'U/mL', 'mIU/mL', 'µIU/mL', 'mIU/L',
    '%', 'ratio', 'titre', 'index',
    'fL', 'pg', '×10³/µL', '×10⁶/µL', '×10⁹/L', '×10¹²/L',
    '/µL', 'cells/µL', '/HPF', '/LPF', 'million/mL',
    'mm/hr', 'seconds', 'minutes', 'mL/min/1.73m²',
    'g/24h', 'mg/24h', 'mL/24h', 'copies/mL', 'ng/mL/hr', 'µg/g',
  ];
  /** Typeahead options — the standard list plus the current value (so a
   *  legacy or hand-entered unit survives), plus a none entry. */
  unitOptions(current: string | null | undefined): PfSelectOption<string>[] {
    const cur = (current ?? '').trim();
    const base = TestEditorComponent.MEDICAL_UNITS;
    return [
      { value: '', label: '— no unit —' },
      ...(cur && !base.includes(cur) ? [{ value: cur, label: cur }] : []),
      ...base.map(u => ({ value: u, label: u })),
    ];
  }

  // ── Creating a NAMED shared list from inside the test ───────────────
  readonly newListNames = signal<Record<number, string>>({});
  readonly creatingList = signal(false);
  listNameFor(i: number): string { return this.newListNames()[i] ?? ''; }
  setListName(i: number, v: string) { this.newListNames.update(m => ({ ...m, [i]: v })); }
  /** Name + values → save the test (rows become the shared group, the name
   *  rides the parameter as optionGroupName) → the group appears in this
   *  tenant's Test Master → Option groups immediately. */
  createOptionList(i: number) {
    const name = this.listNameFor(i).trim();
    const values = this.rowsFor(i).filter(r => (r.value ?? '').trim());
    if (!name) { this.toasts.warning('Give the option group a name'); return; }
    if (values.length === 0) { this.toasts.warning('Add at least one option value'); return; }
    this.patchField(i, { optionGroupName: name });
    this._customOpt.update(m => ({ ...m, [i]: false }));
    this.creatingList.set(true);
    this.saveTest();
    setTimeout(() => { this.loadOptionGroups(); this.creatingList.set(false); }, 1200);
  }

  private loadOptionGroups() {
    this.api.get<OgGroupLite[]>('/api/option-groups').subscribe({
      next: gs => this.ogGroups.set(gs ?? []),
      error: () => { /* picker degrades to the inline editor */ },
    });
  }

  readonly typeOptions: PfSelectOption<'individual' | 'profile' | 'package'>[] = [
    { value: 'individual', label: 'Individual' },
    { value: 'profile',    label: 'Profile' },
    { value: 'package',    label: 'Package' }
  ];
  readonly flowOptions: PfSelectOption<'direct' | 'approval'>[] = [
    { value: 'direct',   label: 'Direct',   hint: 'Result goes straight to reports' },
    { value: 'approval', label: 'Approval', hint: 'Needs pathologist validation' }
  ];
  readonly reportFormatOptions: PfSelectOption<string>[] = [
    { value: 'tabular',     label: 'Tabular — a row in the results table' },
    { value: 'descriptive', label: 'Descriptive — a written paragraph' }
  ];
  readonly fastingOptions: SegmentedOption<boolean>[] = [
    { value: false, label: 'No' },
    { value: true,  label: 'Yes' }
  ];

  private readonly _departments = signal<Department[]>([]);
  readonly departments = this._departments.asReadonly();
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

  readonly selectedDeptName = computed<string>(() => {
    const id = this._draft().departmentId;
    if (!id) return '';
    return (this._departments().find(d => d.id === id)?.name ?? '').trim();
  });

  /** The last code WE filled — a dept re-pick may overwrite it, but never a
   *  code the admin typed themselves. */
  private lastAutoCode: string | null = null;
  /** Next free code in the department's own series (CLP015 → CLP016):
   *  the dept's most common alpha prefix, max number + 1, padded, skipping
   *  anything already used anywhere in the tenant. */
  private nextCodeForDept(deptId: string): string | null {
    const all = [...this._allIndividualTests(), ...(this._allProfiles?.() ?? [])];
    const usedEverywhere = new Set(all.map(t => (t.testCode ?? '').trim().toLowerCase()).filter(Boolean));
    const freq = new Map<string, { count: number; width: number; max: number }>();
    for (const t of all) {
      if (t.departmentId !== deptId) continue;
      const m = /^([A-Za-z]+)(\d+)$/.exec((t.testCode ?? '').trim());
      if (!m) continue;
      const p = m[1].toUpperCase();
      const e = freq.get(p) ?? { count: 0, width: m[2].length, max: 0 };
      e.count++; e.width = Math.max(e.width, m[2].length); e.max = Math.max(e.max, Number(m[2]));
      freq.set(p, e);
    }
    let best: [string, { count: number; width: number; max: number }] | null = null;
    for (const en of freq.entries()) if (!best || en[1].count > best[1].count) best = en;
    if (!best) return null;
    let n = best[1].max + 1;
    let code = best[0] + String(n).padStart(best[1].width, '0');
    while (usedEverywhere.has(code.toLowerCase())) { n++; code = best[0] + String(n).padStart(best[1].width, '0'); }
    return code;
  }

  onDeptPicked(name: string) {
    if (!name) { this.patch({ departmentId: '' }); return; }
    const id = this._departments().find(d => (d.name ?? '').trim() === name)?.id ?? '';
    this.patch({ departmentId: id });
    // Creating a test: fill the next free code in this department's series.
    // Only over an empty code or one WE filled — never the admin's own typing.
    const d = this._draft();
    if (!d.id && id && (!d.testCode.trim() || d.testCode === this.lastAutoCode)) {
      const code = this.nextCodeForDept(id);
      if (code) { this.patch({ testCode: code }); this.lastAutoCode = code; }
    }
  }

  /** Test-code edit with an immediate duplicate check against the whole
   *  loaded catalogue (case-insensitive, excluding this test itself). */
  onTestCodeChanged(v: string) {
    this.patch({ testCode: v });
    const code = v.trim().toLowerCase();
    if (!code) return;
    const selfId = this._draft().id;
    const dup = [...this._allIndividualTests(), ...(this._allProfiles?.() ?? [])]
      .some(t => t.id !== selfId && (t.testCode ?? '').trim().toLowerCase() === code);
    if (dup) {
      this._fieldErrors.update(m => ({ ...m, testCode: `Code ${v.trim().toUpperCase()} is already in use — pick another.` }));
    }
  }

  /** Culture-bench mark — the ONE marker the whole culture stack keys on:
   *  `microFormat: 'culture_sensitivity'` in the Parameters wrapper. On = the
   *  test lands on the Culture Bench at intake (case auto-created), routes to
   *  the culture validation cockpit, and prints the culture report section.
   *  Offered only for Microbiology tests. */
  readonly isMicroDept = computed<boolean>(() => /micro/i.test(this.selectedDeptName()));
  readonly cultureBench = computed<boolean>(() => {
    try { return JSON.parse(this._draft().parametersJson || '{}')?.microFormat === 'culture_sensitivity'; }
    catch { return false; }
  });
  setCultureBench(on: boolean) {
    const existing = (() => {
      try { return JSON.parse(this._draft().parametersJson || '{}'); } catch { return {}; }
    })();
    if (on) existing.microFormat = 'culture_sensitivity';
    else if (existing.microFormat === 'culture_sensitivity') delete existing.microFormat;
    this.patch({ parametersJson: JSON.stringify(existing) });
  }

  /** Photos & video at result entry — opt-in per test. On = the tech's
   *  result-entry screen shows the attach button for this result; images can
   *  print on the report, videos stay bench-only. Stored as
   *  `attachments: true` in the Parameters wrapper. */
  readonly attachmentsEnabled = computed<boolean>(() => {
    try { return JSON.parse(this._draft().parametersJson || '{}')?.attachments === true; }
    catch { return false; }
  });
  setAttachmentsEnabled(on: boolean) {
    const existing = (() => {
      try { return JSON.parse(this._draft().parametersJson || '{}'); } catch { return {}; }
    })();
    if (on) existing.attachments = true;
    else delete existing.attachments;
    this.patch({ parametersJson: JSON.stringify(existing) });
  }

  /** Per-REPORT value picker (owner 2026-09-20, culture-checkbox pattern):
   *  `printPicker: true` in the Parameters wrapper puts a print checkbox on
   *  every value row at RESULT ENTRY — the tech decides per order what
   *  reaches that report. Dynamic counterpart to the fixed per-value
   *  "Prints on the report" switch. */
  readonly printPickerEnabled = computed<boolean>(() => {
    try { return JSON.parse(this._draft().parametersJson || '{}')?.printPicker === true; }
    catch { return false; }
  });
  setPrintPickerEnabled(on: boolean) {
    const existing = (() => {
      try { return JSON.parse(this._draft().parametersJson || '{}'); } catch { return {}; }
    })();
    if (on) existing.printPicker = true;
    else delete existing.printPicker;
    this.patch({ parametersJson: JSON.stringify(existing) });
  }

  private readonly _referralLabs = signal<ReferralLab[]>([]);
  readonly referralLabs = this._referralLabs.asReadonly();
  readonly referralLabOptions = computed<PfSelectOption<string>[]>(() => {
    const opts: PfSelectOption<string>[] = [{ value: '', label: '— In-house (not outsourced) —' }];
    for (const l of this._referralLabs()) opts.push({ value: l.id, label: l.code ? `${l.name} (${l.code})` : l.name });
    return opts;
  });
  readonly isOutsourced = computed(() => !!this._draft().outsourcedVendorId);

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

  private readonly _calcInfo = signal<{
    kind?: string; expr?: string; inputs?: string[]; constants?: string[];
    validWhen?: string; note?: string; unit?: string;
  } | null>(null);
  readonly calcInfo = this._calcInfo.asReadonly();

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

  private readonly _expandedParamId = signal<string | null>(null);
  readonly expandedParamId = this._expandedParamId.asReadonly();
  toggleParam(id: string) {
    this._expandedParamId.update(cur => cur === id ? null : id);
  }

  private flatRangeFromBands(current: string): string {
    const numeric = this.numericFields();
    if (numeric.length !== 1) return current;
    const bands = numeric[0].referenceRanges ?? [];
    if (bands.length !== 1) return '';
    return formatRange(bands[0]) ?? '';
  }


  protected needsAdvancedRanges(p: FormField): boolean {
    const bands = p.referenceRanges ?? [];
    if (bands.length > 1) return true;
    const b = bands[0];
    if (!b) return false;
    return !!(b.sex && b.sex !== 'any') || b.minAge != null || b.maxAge != null || !!b.label;
  }

  protected showAdvancedRanges(p: FormField): boolean {
    return this.needsAdvancedRanges(p);
  }

  protected firstBand(p: FormField): ReferenceRange {
    return (p.referenceRanges ?? [])[0] ?? { segment: 'normal', min: null, max: null };
  }

  protected bandsCaption(p: FormField): string {
    const bands = p.referenceRanges ?? [];
    if (bands.length === 0) return 'No range set';
    if (bands.length > 1) return `${bands.length} ranges by sex / age`;
    return deriveRangeLabel(bands[0]) ?? 'Applies to every patient';
  }

  protected readonly numericFields = computed(() =>
    this.fields().filter(f => this.isNumericType(f.type)));

  // ── Plain-language entry kind ─────────────────────────────────────
  // Doctors think "what will the tech enter", not "parameters". For the
  // common single-value test the ONE field is auto-managed: this control
  // sets its type, and the field list stays out of sight. resultType is
  // editor metadata only (nothing downstream consumes it) — kept in step
  // for the checklist and older drafts.
  readonly entryKindOptions: PfSelectOption<string>[] = [
    { value: '',       label: '— pick one —' },
    { value: 'number', label: 'A number — e.g. 118' },
    { value: 'choice', label: 'A choice from a list — e.g. Positive / Negative' },
    { value: 'text',   label: 'Free text — a written finding' },
  ];
  readonly isSingleValue = computed(() => this.fields().length <= 1);

  // ── Reference-range GRID (Test Master's AG-Grid language) ──────────
  private readonly themeSvc = inject(ThemeService);
  /** AG popup editors attach to <body> so they float ABOVE the panel instead
   *  of clipping inside the grid's own stacking context. */
  readonly gridPopupParent: HTMLElement | undefined =
    typeof document !== 'undefined' ? document.body : undefined;
  /** Left section rail hide/unhide — remembered across visits. */
  readonly railHidden = signal<boolean>(
    typeof localStorage !== 'undefined' && localStorage.getItem('pf-te2-rail') === 'hidden');
  toggleRail() {
    this.railHidden.update(v => !v);
    try { localStorage.setItem('pf-te2-rail', this.railHidden() ? 'hidden' : 'shown'); } catch { /* private mode */ }
  }
  readonly rangeGridTheme = computed(() =>
    (this.themeSvc.isDark() ? gridThemeDark : gridThemeLight)
      .withParams({ rowHeight: 48, headerHeight: 42, cellHorizontalPadding: 14 }));
  /** Row view-model: one reference band per row, editable in place.
   *  MUST be a computed — a method here returns a fresh array every change
   *  detection pass, which makes AG-Grid reset its rows and instantly close
   *  any editor that tries to open (the click looks dead). */
  readonly rangeRows = computed<Array<Record<string, unknown>>>(() => {
    const p = this.firstNumericField();
    if (!p) return [];
    const i = this.fields().indexOf(p);
    return (p.referenceRanges ?? []).map((r, ri) => ({
      i, ri,
      sex: r.sex ?? 'any',
      agePreset: this.agePresetFor(i, ri),
      minAge: r.minAge ?? null, maxAge: r.maxAge ?? null, ageUnit: r.ageUnit ?? 'years',
      min: r.min ?? null, max: r.max ?? null,
      criticalLow: r.criticalLow ?? null, criticalHigh: r.criticalHigh ?? null,
      prints: (r.min != null || r.max != null) ? (r.label || this.autoRangeLabel(r)) : '—',
    }));
  });
  /** Stable row identity so edits survive row-data refreshes. */
  readonly rangeRowId = (p: { data: { ri: number } }) => String(p.data.ri);
  /** Multi-value tests: one grid per numeric value — LITERALLY the same
   *  editor as the single-value grid, stacked (owner: a 2nd value is "just
   *  another row", never a different-looking editor). Same memoization rule
   *  as rangeRows: one computed map, stable arrays per change-detection. */
  private static readonly EMPTY_RANGE_ROWS: Array<Record<string, unknown>> = [];
  readonly rangeRowsByField = computed<Map<number, Array<Record<string, unknown>>>>(() => {
    const out = new Map<number, Array<Record<string, unknown>>>();
    this.fields().forEach((p, i) => {
      if (!this.isNumericType(p.type)) return;
      out.set(i, (p.referenceRanges ?? []).map((r, ri) => ({
        i, ri,
        sex: r.sex ?? 'any',
        agePreset: this.agePresetFor(i, ri),
        minAge: r.minAge ?? null, maxAge: r.maxAge ?? null, ageUnit: r.ageUnit ?? 'years',
        min: r.min ?? null, max: r.max ?? null,
        criticalLow: r.criticalLow ?? null, criticalHigh: r.criticalHigh ?? null,
        prints: (r.min != null || r.max != null) ? (r.label || this.autoRangeLabel(r)) : '—',
      })));
    });
    return out;
  });
  rangeRowsFor(i: number): Array<Record<string, unknown>> {
    return this.rangeRowsByField().get(i) ?? TestEditorComponent.EMPTY_RANGE_ROWS;
  }
  readonly rangeDefaultColDef: ColDef = {
    editable: true, sortable: false, resizable: true, suppressHeaderMenuButton: true,
  };
  private static readonly SEX_OPTS: RangeSelectOption[] = [
    { value: 'any', label: 'Everyone' }, { value: 'M', label: 'Men' }, { value: 'F', label: 'Women' },
  ];
  private static readonly AGE_UNIT_OPTS: RangeSelectOption[] = [
    { value: 'years', label: 'years' }, { value: 'months', label: 'months' }, { value: 'days', label: 'days' },
  ];
  /** Chevroned display for dropdown cells — the cell LOOKS clickable. */
  private ddCell(label: (v: unknown) => string) {
    return (p: { value: unknown }) =>
      `<span class="pf-rrgrid__dd"><span class="pf-rrgrid__dd-lbl">${label(p.value)}</span>` +
      `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></span>`;
  }
  readonly rangeColDefs: ColDef[] = [
    { field: 'sex', headerName: 'Who', minWidth: 116, flex: 1,
      cellEditor: RangeSelectEditorComponent, cellEditorPopup: true,
      cellEditorParams: { options: TestEditorComponent.SEX_OPTS },
      cellRenderer: this.ddCell(v => (({ any: 'Everyone', M: 'Men', F: 'Women' }) as Record<string, string>)[String(v ?? 'any')] ?? 'Everyone') },
    { field: 'agePreset', headerName: 'Age group', minWidth: 150, flex: 1.2,
      cellEditor: RangeSelectEditorComponent, cellEditorPopup: true,
      cellEditorParams: () => ({ options: [
        ...this.agePresets.map(a => ({ value: a.key, label: a.label })),
        { value: 'custom', label: 'Custom (edit the age cells)' },
      ] satisfies RangeSelectOption[] }),
      cellRenderer: this.ddCell(v => v === 'custom' ? 'Custom'
        : (this.agePresets.find(a => a.key === v)?.label ?? 'All ages')) },
    { field: 'minAge', headerName: 'From age', minWidth: 88, flex: .7, cellClass: 'pf-rrgrid__num', valueFormatter: p => p.value ?? '—' },
    { field: 'maxAge', headerName: 'To age', minWidth: 82, flex: .7, cellClass: 'pf-rrgrid__num', valueFormatter: p => p.value ?? '—' },
    { field: 'ageUnit', headerName: 'Age in', minWidth: 100, flex: .7,
      cellEditor: RangeSelectEditorComponent, cellEditorPopup: true,
      cellEditorParams: { options: TestEditorComponent.AGE_UNIT_OPTS },
      cellRenderer: this.ddCell(v => String(v ?? 'years')) },
    { field: 'min', headerName: 'Low', minWidth: 84, flex: .7, cellClass: 'pf-rrgrid__num', valueFormatter: p => p.value ?? '—' },
    { field: 'max', headerName: 'High', minWidth: 84, flex: .7, cellClass: 'pf-rrgrid__num', valueFormatter: p => p.value ?? '—' },
    { field: 'criticalLow', headerName: 'Critical low', minWidth: 104, flex: .8,
      cellClass: 'pf-rrgrid__num pf-rrgrid__crit', valueFormatter: p => p.value ?? '—' },
    { field: 'criticalHigh', headerName: 'Critical high', minWidth: 108, flex: .8,
      cellClass: 'pf-rrgrid__num pf-rrgrid__crit', valueFormatter: p => p.value ?? '—' },
    { field: 'prints', headerName: 'On the report', minWidth: 150, flex: 1.5,
      cellClass: 'pf-rrgrid__prints', tooltipField: 'prints',
      cellEditor: 'agTextCellEditor' },
    { colId: 'del', headerName: '', editable: false, width: 44, maxWidth: 44, resizable: false,
      cellClass: 'pf-rrgrid__del',
      cellRenderer: () => '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>' },
  ];
  onRangeCellChanged(e: CellValueChangedEvent) {
    const i = e.data.i as number, ri = e.data.ri as number;
    const f = e.colDef.field;
    if (f === 'sex') this.patchRangeAt(i, ri, { sex: e.data.sex });
    else if (f === 'ageUnit') this.patchRangeAt(i, ri, { ageUnit: e.data.ageUnit });
    else if (f === 'agePreset') this.setAgePreset(i, ri, e.data.agePreset);
    else if (f === 'prints') {
      // Editing the printed text writes the range's custom label; clearing it
      // returns to the automatic wording.
      const v = String(e.newValue ?? '').trim();
      this.patchRangeAt(i, ri, { label: v || null });
    }
    else if (f === 'minAge' || f === 'maxAge' || f === 'min' || f === 'max'
             || f === 'criticalLow' || f === 'criticalHigh') {
      this.patchRangeAt(i, ri, { [f]: this.toNum(e.data[f]) });
    }
  }
  onRangeCellClicked(e: CellClickedEvent) {
    if (e.colDef.colId === 'del') this.removeRange(e.data.i, e.data.ri);
  }
  readonly entryKind = computed<string>(() => {
    const fs = this.fields();
    if (fs.length === 0) {
      const rt = this._draft().resultType;
      return rt === 'numeric' ? 'number' : rt === 'choice' ? 'choice' : rt ? 'text' : '';
    }
    const t = fs[0].type;
    if (this.isNumericType(t)) return 'number';
    if (this.typeHasOptions(t)) return 'choice';
    return 'text';
  });
  setEntryKind(kind: string) {
    if (!kind) return;
    if (this.fields().length === 0) {
      this.addParameter();
      const d = this._draft();
      const label = (d.name ?? '').trim() || 'Result';
      this.patchField(0, { label, name: this.deriveName(label, 'result'),
                           unit: (d.unit ?? '').trim() || undefined });
    }
    this.patchField(0, { type: kind === 'number' ? 'number' : kind === 'choice' ? 'select' : 'textarea' });
    this.patch({ resultType: kind === 'number' ? 'numeric' : kind,
                 reportFormat: this._draft().reportFormat || 'tabular' });
  }

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

  autoRangeLabel(r: ReferenceRange): string {
    return deriveRangeLabel(r) ?? 'No qualifier — applies to everyone';
  }

  paramSummary(p: FormField): string {
    const bits: string[] = [];
    if (this.isNumericType(p.type)) {
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

  /** The one power-user escape hatch (old sections editor), collapsed by
   *  default; closing it reloads the simple print-order list so both stay
   *  in sync on the same stored layout. */
  protected readonly layoutAdvancedOpen = signal(false);
  protected readonly structureReload = signal(0);
  toggleAdvanced() {
    const open = !this.layoutAdvancedOpen();
    this.layoutAdvancedOpen.set(open);
    if (!open) this.structureReload.update(n => n + 1);
  }

  private readonly _section = signal<TestSection>('identity');
  readonly section = this._section.asReadonly();
  /** Single-page layout (redesign): every section renders on ONE scrolling page;
   *  the rail becomes a scroll-spy / jump nav rather than a tab switcher. */
  readonly onePage = signal(true);

  setSection(v: TestSection) {
    this._section.set(v);
    this.ensureLayoutData();
  }
  /** Rail click: highlight + smooth-scroll the section's card into view. */
  jumpToSection(v: TestSection) {
    // One task at a time: the rail switches the WORKSPACE, it doesn't scroll
    // a long page. Top of the section on every switch.
    this._section.set(v);
    this.ensureLayoutData();
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  private _layoutLoaded = false;
  /** The Report-layout columns used to lazy-load on that tab; on one page the
   *  section is always visible, so load them once (edit mode). */
  private ensureLayoutData(): void {
    if (this._layoutLoaded) return;
    this._layoutLoaded = true;
    if (this.deptColumnCfg().length === 0) this.loadDeptColumns(this._draft().departmentId);
    this.loadTestColumns();
  }
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
    const allowed = this.canManageInventory() ? all : all.filter(x => x.value !== 'consumables');
    if (individual) return allowed;
    return allowed.filter(x => x.value === 'identity' || x.value === 'pricing' || x.value === 'layout');
  });
  protected readonly deptColumnCfg = signal<ReportColumn[]>([]);
  deptColumnsLabel(): string { return this.columnsLabel(this.deptColumnCfg()); }

  columnsLabel(cols: ReportColumn[]): string {
    return (cols ?? []).map(c => c.label || c.name).filter(Boolean).join(' · ');
  }

  private loadDeptColumns(departmentId: string | null | undefined): void {
    if (!departmentId) { this.deptColumnCfg.set([]); return; }
    this.layoutSvc.getDeptColumns(departmentId)
      .then(res => this.deptColumnCfg.set(res?.columns ?? []))
      .catch(() => this.deptColumnCfg.set([]));
  }

  protected readonly testColumnsOverride = signal<ReportColumn[] | null>(null);
  protected readonly customizingColumns = signal(false);
  protected readonly columnsSaving = signal(false);
  protected readonly columnsEditorSeed = signal<ReportColumn[] | null>(null);
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
  readonly parameterNames = computed<string[]>(() =>
    this._fields()
      .map(f => (f.name ?? '').trim())
      .filter(n => n.length > 0)
  );

  private readonly _saving = signal(false);
  readonly saving = this._saving.asReadonly();

  // ── Editorial redesign: chips, range visual, sentences, publish checklist ──

  /** Glanceable summary chips under the title; clicking scrolls to the field. */
  readonly metaChips = computed<Array<{ k: string; v: string; sec: TestSection }>>(() => {
    const d = this._draft();
    const chips: Array<{ k: string; v: string; sec: TestSection }> = [];
    chips.push({ k: 'Code', v: (d.testCode ?? '').trim() || '—', sec: 'identity' });
    chips.push({ k: 'Dept', v: this.selectedDeptName() || '—', sec: 'identity' });
    if (d.type === 'individual') {
      const tube = this.tubeColors.find(c => c.key === d.tubeColor)?.label;
      const sample = [(d.sampleType ?? '').trim(), tube].filter(Boolean).join(' · ');
      chips.push({ k: 'Sample', v: sample || '—', sec: 'pricing' });
    }
    chips.push({ k: 'Price', v: '₹' + (d.price ?? 0).toFixed(2), sec: 'pricing' });
    chips.push({ k: 'TAT', v: (d.tatHours ?? 0) + ' hrs', sec: 'pricing' });
    if (d.type === 'individual') {
      chips.push({ k: 'Fasting', v: d.fastingRequired ? 'Yes' : 'No', sec: 'pricing' });
    }
    return chips;
  });

  /** The first numeric parameter drives the "how it's judged" visual + sentences. */
  private readonly firstNumericField = computed<FormField | null>(() => this.numericFields()[0] ?? null);

  /** Critical/normal/high band for the visual bar. Null when there's no numeric basis. */

  /** Reference ranges rendered as plain sentences (first numeric parameter). */
  // ── Simplified range editing (HCP-friendly) ─────────────────────────
  // Doctors think in "who + normal band", not comparators and age units.
  // Each band edits IN PLACE: sex, a life-stage preset, low/high. The
  // precise grid stays available for comparator ops / custom print labels.
  readonly agePresets: ReadonlyArray<{ key: string; label: string; minAge: number | null; maxAge: number | null; ageUnit: 'years' | 'months' | 'days' }> = [
    { key: 'all',     label: 'All ages',        minAge: null, maxAge: null, ageUnit: 'years' },
    { key: 'newborn', label: 'Newborn (0–28 d)', minAge: 0,   maxAge: 28,   ageUnit: 'days' },
    { key: 'infant',  label: 'Infant (< 1 yr)',  minAge: 0,   maxAge: 1,    ageUnit: 'years' },
    { key: 'child',   label: 'Child (1–12 yr)',  minAge: 1,   maxAge: 12,   ageUnit: 'years' },
    { key: 'teen',    label: 'Teen (12–18 yr)',  minAge: 12,  maxAge: 18,   ageUnit: 'years' },
    { key: 'adult',   label: 'Adult (18+)',      minAge: 18,  maxAge: null, ageUnit: 'years' },
    { key: 'senior',  label: 'Senior (65+)',     minAge: 65,  maxAge: null, ageUnit: 'years' },
  ];
  private readonly _customAge = signal<Record<string, boolean>>({});

  rangeAt(i: number, ri: number) { return this.fields()[i]?.referenceRanges?.[ri] ?? null; }
  addRangeToFirstNumeric() {
    const p = this.firstNumericField();
    if (p) this.addRange(this.fields().indexOf(p));
  }
  /** Loose numeric parse for the borderless sentence-bar inputs. */
  toNum(v: unknown): number | null {
    const n = parseFloat(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  rangeUnitFor(i: number): string { return this.fields()[i]?.unit || this._draft().unit || ''; }

  agePresetFor(i: number, ri: number): string {
    if (this._customAge()[`${i}:${ri}`]) return 'custom';
    const r = this.rangeAt(i, ri);
    if (!r) return 'all';
    const hit = this.agePresets.find(p =>
      (p.minAge ?? null) === (r.minAge ?? null)
      && (p.maxAge ?? null) === (r.maxAge ?? null)
      && (r.minAge == null && r.maxAge == null ? true : (p.ageUnit === (r.ageUnit ?? 'years'))));
    return hit?.key ?? 'custom';
  }
  setAgePreset(i: number, ri: number, key: string) {
    if (key === 'custom') {
      this._customAge.update(m => ({ ...m, [`${i}:${ri}`]: true }));
      return;
    }
    this._customAge.update(m => ({ ...m, [`${i}:${ri}`]: false }));
    const p = this.agePresets.find(x => x.key === key);
    if (p) this.patchRangeAt(i, ri, { minAge: p.minAge, maxAge: p.maxAge, ageUnit: p.ageUnit });
  }

  /** Sticky wayfinding for the long form: one link per visible section,
   *  with its completion state folded in from the publish checklist. */
  readonly sectionNav = computed<Array<{ id: TestSection; label: string; ok: boolean }>>(() => {
    const d = this._draft();
    const checks = this.publishChecklist();
    const okFor = (sec: TestSection) => checks.filter(c => c.action === sec).every(c => c.ok);
    const nav: Array<{ id: TestSection; label: string; ok: boolean }> = [
      { id: 'identity', label: 'Basics', ok: okFor('identity') },
      { id: 'pricing', label: 'Price & sample', ok: okFor('pricing') && okFor('sample') },
      { id: 'results', label: d.type === 'individual' ? 'Result entry'
          : d.type === 'profile' ? 'Members' : 'Package members', ok: okFor('results') },
      { id: 'layout', label: 'Printed report', ok: okFor('layout') },
    ];
    if (d.type === 'individual' && this.canManageInventory())
      nav.push({ id: 'consumables', label: 'Consumables', ok: okFor('consumables') });
    return nav;
  });

  /** For qualitative (dropdown) tests the "reference range" IS the set of
   *  Normal-marked options — and it's EDITABLE here: tap values to toggle
   *  what counts as expected. A switch flips the section between numeric
   *  bands and qualitative mode when a test carries both kinds. */
  /** Expected-value chips stay hidden (the option group below already shows
   *  the values) until the user explicitly opens the editor. */
  readonly qualEditing = signal(false);
  readonly qualFields = computed<Array<{ i: number; title: string }>>(() =>
    this.fields()
      .map((f, i) => ({ f, i }))
      .filter(x => this.typeHasOptions(x.f.type) && this.rowsFor(x.i).length > 0)
      .map(x => ({ i: x.i, title: x.f.label || x.f.name || 'Result' })));
  /** The mode FOLLOWS the entry kind — a number gets numeric ranges, a
   *  choice gets its option group's expected value. No user toggle. */
  readonly effRangeMode = computed<'numeric' | 'qualitative'>(() =>
    this.numericFields().length ? 'numeric' : this.qualFields().length ? 'qualitative' : 'numeric');

  /** The expected values, as they'll print on the report. */
  normalsSummary(i: number): string {
    return this.rowsFor(i).filter(r => r.normal === true && r.active !== false)
      .map(r => r.value).join(' / ');
  }
  /** Tap a value chip → toggle whether it counts as normal/expected.
   *  Routes through setOptionRows so options[]/normalValue stay derived. */
  toggleQualNormal(i: number, value: string) {
    this.setOptionRows(i, this.rowsFor(i).map(r =>
      r.value === value ? { ...r, normal: r.normal !== true } : r));
  }

  readonly rangeSentences = computed<Array<{ who: string; rule: string; prints: string; i: number; ri: number }>>(() => {
    const p = this.firstNumericField();
    if (!p) return [];
    const i = this.fields().indexOf(p);
    const unit = p.unit || this._draft().unit || '';
    return (p.referenceRanges ?? []).map((r, ri) => {
      const sex = r.sex && r.sex !== 'any' ? (r.sex === 'M' ? 'Male' : 'Female') : 'Any sex';
      const age = (r.minAge != null || r.maxAge != null)
        ? `${r.minAge ?? 0}–${r.maxAge ?? '∞'} ${r.ageUnit ?? 'years'}`
        : 'any age';
      const who = `${sex} · ${age} →`;
      let rule: string;
      if (r.min == null && r.max == null) {
        rule = 'no numeric range';
      } else {
        const parts: string[] = [];
        if (r.min != null) parts.push((this.minOpShown(r) === 'gte' ? '≥ ' : '> ') + r.min);
        if (r.min != null && r.max != null) parts.push('and');
        if (r.max != null) parts.push((this.maxOpShown(r) === 'lte' ? '≤ ' : '< ') + r.max);
        rule = parts.join(' ') + (unit ? ' ' + unit : '');
      }
      return { who, rule, prints: r.label || this.autoRangeLabel(r), i, ri };
    });
  });

  /** "Ready to publish?" checklist — real form state, adapts to test type. */
  readonly publishChecklist = computed<Array<{ label: string; ok: boolean; action?: TestSection }>>(() => {
    const d = this._draft();
    const rows: Array<{ label: string; ok: boolean; action?: TestSection }> = [];
    const idOk = !!d.name.trim() && !this.fieldError('name') && !this.fieldError('testCode')
      && !!d.departmentId && (d.price ?? 0) >= 0;
    rows.push({ label: 'Identity & pricing', ok: idOk, action: idOk ? undefined : 'identity' });
    if (d.type === 'individual') {
      const kindOk = !!this.entryKind() || !this.isSingleValue();
      rows.push({ label: kindOk ? 'Entry type chosen' : 'Entry type not chosen',
                  ok: kindOk, action: kindOk ? undefined : 'results' });
      const nf = this.numericFields();
      const rangesOk = nf.length > 0 && nf.every(f => (f.referenceRanges ?? []).length > 0);
      rows.push({ label: `Reference ranges${nf.length ? ' (' + nf.length + ')' : ''}`,
                  ok: rangesOk, action: rangesOk ? undefined : 'results' });
      const params = this.fields();
      const paramsOk = params.length > 0 && params.every(p => !!(p.label ?? '').trim());
      rows.push({ label: `Parameters (${params.length})`,
                  ok: paramsOk, action: paramsOk ? undefined : 'results' });
    } else {
      const n = this.packageItems().length;
      rows.push({ label: `Members (${n})`, ok: n > 0, action: n > 0 ? undefined : 'results' });
    }
    rows.push({ label: 'Report columns', ok: true });
    return rows;
  });
  readonly publishCount = computed(() => {
    const rows = this.publishChecklist();
    return { done: rows.filter(r => r.ok).length, total: rows.length };
  });
  readonly publishReady = computed(() => {
    const c = this.publishCount();
    return c.done === c.total;
  });

  /** Unsaved-changes hint (no autosave). Cleared on fresh hydrate. */
  readonly dirty = signal(false);

  /** Debounced token so the embedded live preview re-renders after edits settle. */
  private readonly _previewToken = signal(0);
  readonly previewToken = this._previewToken.asReadonly();
  private _previewTimer: ReturnType<typeof setTimeout> | null = null;
  private bumpPreview(): void {
    this.dirty.set(true);
    if (this._previewTimer) clearTimeout(this._previewTimer);
    this._previewTimer = setTimeout(() => this._previewToken.update(v => v + 1), 700);
  }

  private readonly _packageItems = signal<string[]>([]);
  readonly packageQuery = signal('');

  readonly repetitive = signal(false);
  private readonly _memberRows = signal<MemberRow[]>([]);
  readonly repetitiveActive = computed(() => this._draft().type === 'profile' && this.repetitive());
  readonly packageItems = computed<string[]>(() =>
    this.repetitiveActive() ? this._memberRows().map(r => r.testId) : this._packageItems());

  readonly memberGroups = computed<{ offsetMin: number; rows: MemberRow[] }[]>(() => {
    const groups: { offsetMin: number; rows: MemberRow[] }[] = [];
    for (const r of this._memberRows()) {
      const last = groups[groups.length - 1];
      if (last && last.offsetMin === r.offsetMin) last.rows.push(r);
      else groups.push({ offsetMin: r.offsetMin, rows: [r] });
    }
    return groups;
  });

  private normalizeRows(rows: MemberRow[]): MemberRow[] {
    if (rows.length === 0) return rows;
    const sorted = rows.slice().sort((a, b) => a.offsetMin - b.offsetMin);
    const min = sorted[0].offsetMin;
    return min === 0 ? sorted : sorted.map(r => ({ ...r, offsetMin: r.offsetMin - min }));
  }

  private setRows(rows: MemberRow[]) {
    const normalized = this.normalizeRows(rows);
    this._memberRows.set(normalized);
    this._packageItems.set([...new Set(normalized.map(r => r.testId))]);
  }

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

  memberName(testId: string): string {
    return this._memberById().get(testId)?.name ?? '(unknown test)';
  }

  memberCalc(t: { calculation?: string | null } | undefined): CalcDef | null {
    return t ? parseCalc(t.calculation) : null;
  }

  calcLine(def: CalcDef): string {
    return (def.kind === 'expr' || def.kind === 'inr') && def.expr
      ? def.expr
      : this.calcKindLabel(def.kind);
  }

  readonly calcEdit = signal<{ targetId: string; expr: string; validWhen: string } | null>(null);
  readonly calcSaving = signal(false);

  private static readonly CALC_VARS = new Set(['AGE', 'ISI', 'MNPT', 'NORMAL_HCT']);

  readonly calcTargetOptions = computed(() => {
    const byId = this._memberById();
    return this.packageItems()
      .map(id => ({ id, name: byId.get(id)?.name ?? '(unknown test)' }));
  });

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
    if (p.targetId && p.targetId !== ce.targetId) { this.openCalcEditor(p.targetId); return; }
    this.calcEdit.set({ ...ce, ...p });
  }

  appendCalcToken(token: string) {
    const ce = this.calcEdit();
    if (!ce) return;
    const sep = ce.expr.length === 0 || ce.expr.endsWith(' ') || ce.expr.endsWith('(') ? '' : ' ';
    this.calcEdit.set({ ...ce, expr: ce.expr + sep + token });
  }

  private composerDef(): CalcDef | null {
    const ce = this.calcEdit();
    if (!ce || !ce.expr.trim() || this.calcEditError()) return null;
    const target = this._memberById().get(ce.targetId);
    const refs = lintExpr(ce.expr).refs.concat(ce.validWhen.trim() ? lintExpr(ce.validWhen).refs : []);
    const allRefs = [...new Set(refs.map(s => s.toUpperCase()))];
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

  readonly calcTryValues = signal<Record<string, string>>({});

  setCalcTryValue(key: string, v: unknown) {
    this.calcTryValues.update(m => ({ ...m, [key]: String(v ?? '') }));
  }

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

  setRowOffset(key: string, raw: unknown) {
    const n = Number(raw);
    const offsetMin = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
    this.setRows(this._memberRows().map(r => r.key === key ? { ...r, offsetMin } : r));
  }

  pinRow(key: string) {
    const groups = this.memberGroups();
    const gi = groups.findIndex(g => g.rows.some(r => r.key === key));
    if (gi <= 0) return;
    const target = groups[gi - 1].offsetMin;
    this.setRows(this._memberRows().map(r => r.key === key ? { ...r, offsetMin: target } : r));
  }

  removeSeriesRow(key: string) {
    this.setRows(this._memberRows().filter(r => r.key !== key));
  }

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

  private readonly _allIndividualTests = signal<Test[]>([]);
  readonly allIndividualTests = this._allIndividualTests.asReadonly();

  private readonly _allProfiles = signal<Test[]>([]);
  readonly allProfiles = this._allProfiles.asReadonly();

  // ── Profile linkage (Basics · owner 2026-09-20): show WHICH profiles this
  // test is a member of, and add/remove membership right here. Membership is
  // the profile bundle's items[] — the real thing the order screen expands —
  // not the free-text Profile label. ─────────────────────────────────────
  private bundleItemIds(t: Test): string[] {
    try {
      const raw = (t as unknown as { parameters?: unknown }).parameters;
      const blob = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return (((blob as Record<string, unknown>)?.['items'] ?? []) as Array<{ testId?: string }>)
        .map(x => x.testId ?? '').filter(Boolean);
    } catch { return []; }
  }
  readonly linkedProfiles = computed<Test[]>(() => {
    const id = this._draft().id;
    if (!id) return [];
    return this._allProfiles().filter(pr => this.bundleItemIds(pr).includes(id));
  });
  /** Full-width tick-list under the Basics grid (owner: use the free space
   *  below to SHOW the profiles, not hide them in a dropdown). */
  readonly linkedProfileIds = computed<string[]>(() => this.linkedProfiles().map(p => p.id));

  /** name → display title for the printed-report surfaces (mini table,
   *  Description rows, condition dropdowns show titles; the stored
   *  conditions keep engine NAMES). */
  readonly parameterTitleMap = computed<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const fld of this._fields()) m[fld.name] = fld.label || fld.name;
    return m;
  });
  /** Values with "Prints on the report" switched off. */
  readonly unprintedParamNames = computed<string[]>(() =>
    this._fields().filter(fld => fld.printOnReport === false).map(fld => fld.name));
  readonly profSearch = signal('');
  readonly visibleProfiles = computed<Test[]>(() => {
    const q = this.profSearch().trim().toLowerCase();
    const all = this._allProfiles();
    if (!q) return all;
    return all.filter(p => `${p.name} ${p.testCode ?? ''}`.toLowerCase().includes(q));
  });
  isLinkedProfile(id: string): boolean { return this.linkedProfileIds().includes(id); }
  toggleProfileMembership(pr: Test, on: boolean) {
    if (on) this.addToProfile(pr.id);
    else this.removeFromProfile(pr);
  }
  private patchProfileItems(pr: Test, items: Array<{ testId: string }>) {
    const raw = (pr as unknown as { parameters?: unknown }).parameters;
    let blob: Record<string, unknown> = {};
    try { blob = (typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>)) ?? {}; }
    catch { blob = {}; }
    blob['items'] = items;
    const json = JSON.stringify(blob);
    this.api.patch<Test>(`/api/tests/${pr.id}`, { parametersJson: json }).subscribe({
      next: () => {
        (pr as unknown as { parameters?: unknown }).parameters = json;
        this._allProfiles.update(l => [...l]);
        this.toasts.success(`${pr.name} updated`);
      },
      error: () => this.toasts.error(`Could not update ${pr.name} — try again.`),
    });
  }
  addToProfile(profileId: string) {
    const selfId = this._draft().id;
    if (!profileId || !selfId) return;
    const pr = this._allProfiles().find(p => p.id === profileId);
    if (!pr) return;
    const items = this.bundleItemIds(pr).map(testId => ({ testId }));
    if (!items.some(x => x.testId === selfId)) items.push({ testId: selfId });
    this.patchProfileItems(pr, items);
  }
  removeFromProfile(pr: Test) {
    const selfId = this._draft().id;
    if (!selfId) return;
    this.patchProfileItems(pr, this.bundleItemIds(pr).filter(id => id !== selfId).map(testId => ({ testId })));
  }

  readonly pickFilter = signal<'all' | 'tests' | 'profiles'>('all');
  readonly pickFilterOptions: SegmentedOption<'all' | 'tests' | 'profiles'>[] = [
    { value: 'all',      label: 'All' },
    { value: 'tests',    label: 'Tests' },
    { value: 'profiles', label: 'Profiles' }
  ];

  readonly pickerSource = computed<Test[]>(() => {
    const d = this._draft();
    const selfId = d.id ?? '';
    const tests = this._allIndividualTests().filter(t => t.id !== selfId);
    if (d.type !== 'package') return tests;
    const profiles = this._allProfiles().filter(t => t.id !== selfId);
    return [...tests, ...profiles];
  });

  private readonly _memberById = computed<Map<string, Test>>(() => {
    const m = new Map<string, Test>();
    for (const t of this._allIndividualTests()) m.set(t.id, t);
    for (const t of this._allProfiles()) m.set(t.id, t);
    return m;
  });

  readonly packageMembersTotal = computed(() => {
    const by = this._memberById();
    return this.packageItems().reduce((s, id) => s + (by.get(id)?.price ?? 0), 0);
  });

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
      .map(([department, tests]) => ({ department, tests: tests.slice().sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => {
        if (a.department === 'Profiles') return 1;
        if (b.department === 'Profiles') return -1;
        return a.department.localeCompare(b.department);
      });

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

  readonly parentRoute = computed(() => '/admin/tests?type=' + (this.draft().type || 'individual'));

  ngOnInit() {
    this.loadOptionGroups();
    this.api.get<Department[]>('/api/tenants/departments').subscribe({
      next: l => this._departments.set(l ?? [])
    });
    this.api.get<ReferralLab[]>('/api/referral-labs').subscribe({
      next: l => this._referralLabs.set(l ?? [])
    });
    this.api.get<Test[]>('/api/tests/?type=individual').subscribe({
      next: l => this._allIndividualTests.set((l ?? []).filter(t => t.type !== 'package'))
    });
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
      const t = this.route.snapshot.queryParamMap.get('type');
      if (t === 'package' || t === 'individual' || t === 'profile') {
        this.patch({ type: t });
      }
    }
  }

  // (The old scroll-spy is gone: the rail now switches the workspace to one
  //  section at a time, so there is nothing to spy on.)
  ngAfterViewInit(): void { /* workspace tabs need no post-render wiring */ }
  ngOnDestroy(): void {
    if (this._previewTimer) { clearTimeout(this._previewTimer); this._previewTimer = null; }
  }

  private hydrateFrom(t: Test) {
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
    if (t.type === 'package' || t.type === 'profile') {
      try {
        const blob = JSON.parse(t.parameters ?? '{}');
        const items = Array.isArray(blob.items) ? blob.items : [];
        const ids: string[] = items
          .map((it: unknown) => typeof it === 'string' ? it : ((it as { testId?: string })?.testId ?? ''))
          .filter((id: string) => id.length > 0);
        this._packageItems.set([...new Set(ids)]);
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
    // One-page layout: the Report-layout card is always visible, so its columns
    // must be loaded up-front rather than on a tab switch.
    if (this.onePage()) this.ensureLayoutData();
    this.dirty.set(false);   // fresh load is clean
    this._previewToken.update(v => v + 1);
  }

  isNumericType(t: FormFieldType): boolean {
    return t === 'number';
  }
  typeHasOptions(t: FormFieldType): boolean { return registryHasOptions(t); }

  deriveName(label: string, currentName: string | undefined): string {
    if (currentName && currentName.trim() && !currentName.startsWith('new_param')) return currentName;
    return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || currentName || '';
  }

  peersFor(index: number): FormField[] {
    return this._fields().filter((_, i) => i !== index);
  }

  private loadParameters(draftJson: string): FormField[] {
    if (!draftJson) return [];
    try {
      const blob = JSON.parse(draftJson) as TestParametersBlob & { fields?: FormField[] };
      if (Array.isArray(blob.fields)) return blob.fields;
      return (blob.parameters ?? []).map((p, i) => this.legacyToField(p, i));
    } catch { return []; }
  }

  private legacyToField(p: TestParameter, order: number): FormField {
    // Prefer a legacy alias (numeric→number, options→select, …); otherwise keep
    // the stored type when it is already a valid registry type (e.g. CP/micro
    // params saved as "select" carry optionRows and must render the option
    // table — mapping an unknown type to "text" would silently hide it).
    const type = LEGACY_TYPE_MAP[p.type]
      ?? (getFieldType(p.type as FormFieldType) ? (p.type as FormFieldType) : 'text');
    return {
      id: p.id || newFieldId(),
      name: p.name,
      // Catalogue parameters often carry only `name`; falling back keeps the
      // editor from titling every seeded dropdown "Untitled parameter".
      label: p.title || p.name,
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
      optionRows: p.optionRows ?? null,
      optionGroupName: p.optionGroupName ?? null,
      attachments: p.attachments === true || undefined,
      printOnReport: p.printOnReport === false ? false : undefined,
      options: p.options?.map((label, i) => ({
        id: `opt_${i}_${(label || '').replace(/[^a-z0-9]/gi, '').slice(0, 8)}`,
        label: label ?? '',
        value: label ?? '',
        order: i
      })) ?? null
    };
  }

  /** The parameter's embedded option rows for editing. Older tests carry
   *  only options[]/normalValue — synthesize rows from those so every
   *  dropdown edits the same way; the synthesis persists on next save. */
  rowsFor(i: number): TestOptionRow[] {
    const f = this._fields()[i];
    if (!f) return [];
    if (f.optionRows && f.optionRows.length) return f.optionRows;
    const normals = new Set((f.normalValue ?? '').split('/')
      .map(x => x.trim().toLowerCase()).filter(Boolean));
    return (f.options ?? []).map(o => ({
      code: null,
      value: o.label,
      normal: normals.has(o.label.trim().toLowerCase()),
      active: true,
    }));
  }

  patchOptionRow(i: number, ri: number, change: Partial<TestOptionRow>) {
    const rows = this.rowsFor(i).map((r, ix) => (ix === ri ? { ...r, ...change } : r));
    this.setOptionRows(i, rows);
  }

  /** New rows continue the option-code series automatically — and the
   *  series (URO…, RES…) spans MANY tests, so the next number must be
   *  unused ANYWHERE in the catalogue, not just in this test. */
  addOptionRow(i: number) {
    const rows = this.rowsFor(i);
    this.setOptionRows(i, [...rows, { code: this.nextOptionCode(rows), value: '', normal: false, active: true }]);
  }

  removeOptionRow(i: number, ri: number) {
    this.setOptionRows(i, this.rowsFor(i).filter((_, ix) => ix !== ri));
  }

  moveOptionRow(i: number, ri: number, delta: -1 | 1) {
    const rows = this.rowsFor(i).slice();
    const j = ri + delta;
    if (j < 0 || j >= rows.length) return;
    [rows[ri], rows[j]] = [rows[j], rows[ri]];
    this.setOptionRows(i, rows);
  }

  /** Persist rows AND the derived legacy fields in one patch, so
   *  options/normalValue can never drift from the table. */
  private setOptionRows(i: number, rows: TestOptionRow[]) {
    const active = rows.filter(r => r.active !== false && (r.value ?? '').trim());
    const normals = active.filter(r => r.normal === true).map(r => r.value.trim());
    this.patchField(i, {
      optionRows: rows,
      options: active.map((r, ix) => ({
        id: `opt_${ix}_${r.value.replace(/[^a-z0-9]/gi, '').slice(0, 8)}`,
        label: r.value.trim(), value: r.value.trim(), order: ix,
      })),
      normalValue: normals.length ? normals.join(' / ') : null,
    });
  }

  private nextOptionCode(rows: TestOptionRow[]): string | null {
    let prefix: string | null = null;
    let width = 3;
    for (let ix = rows.length - 1; ix >= 0; ix--) {
      const m = /^([A-Za-z]+)(\d+)$/.exec((rows[ix].code ?? '').trim());
      if (m) { prefix = m[1].toUpperCase(); width = m[2].length; break; }
    }
    if (!prefix) return null;

    let max = 0;
    const scan = (code: string | null | undefined) => {
      const m = /^([A-Za-z]+)(\d+)$/.exec((code ?? '').trim());
      if (m && m[1].toUpperCase() === prefix) max = Math.max(max, Number(m[2]));
    };
    for (const r of rows) scan(r.code);
    const re = new RegExp('"code"\\s*:\\s*"(' + prefix + '\\d+)"', 'gi');
    const harvest = (t: Test) => {
      const params = (t as unknown as { parameters?: unknown }).parameters;
      const raw = typeof params === 'string' ? params : JSON.stringify(params ?? '');
      for (const m of raw.matchAll(re)) scan(m[1]);
    };
    for (const t of this._allIndividualTests()) harvest(t);
    for (const t of this._allProfiles?.() ?? []) harvest(t);
    return prefix + String(max + 1).padStart(width, '0');
  }

  private fieldToLegacy(f: FormField): TestParameter {
    const legacyType = (FORWARD_TYPE_MAP[f.type] ?? 'text') as TestParameter['type'];
    return {
      id: f.id,
      name: f.name,
      title: f.label,
      type: legacyType,
      unit: f.unit ?? undefined,
      options: f.options?.map(o => o.label) ?? undefined,
      optionRows: f.optionRows ?? undefined,
      optionGroupName: f.optionGroupName ?? undefined,
      attachments: f.attachments === true || undefined,
      printOnReport: f.printOnReport === false ? false : undefined,
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
    const cleanFields = fields.map(f => {
      const { _optionsDraft, ...rest } = f as FormField & { _optionsDraft?: string };
      void _optionsDraft;
      return rest as FormField;
    });
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

  minOpShown(r: ReferenceRange): 'gt' | 'gte' {
    return r.minOp ?? (r.max != null ? 'gte' : 'gt');
  }
  maxOpShown(r: ReferenceRange): 'lt' | 'lte' {
    return r.maxOp ?? (r.min != null ? 'lte' : 'lt');
  }

  patchRangeAt(i: number, ri: number, updates: Partial<ReferenceRange>) {
    this._fields.update(list => list.map((p, idx) => {
      if (idx !== i) return p;
      const ranges = [...(p.referenceRanges ?? [])];
      if (ri < 0 || ri >= ranges.length) return p;
      const next: ReferenceRange = { ...ranges[ri], segment: ranges[ri].segment ?? 'normal', ...updates };
      if (next.sex === 'any') next.sex = undefined;
      ranges[ri] = next;
      return { ...p, referenceRanges: ranges };
    }));
    this.persistFieldsToDraft();
  }

  addRange(i: number) {
    this._fields.update(list => list.map((p, idx) => idx === i
      ? { ...p, referenceRanges: [...(p.referenceRanges ?? []), { segment: 'normal', min: null, max: null }] }
      : p));
    this.persistFieldsToDraft();
  }

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

  private readonly _fieldErrors = signal<Record<string, string>>({});
  fieldError(f: string): string | null { return this._fieldErrors()[f] ?? null; }
  private clearFieldError(f: string) {
    this._fieldErrors.update(m => {
      if (!(f in m)) return m;
      const next = { ...m }; delete next[f]; return next;
    });
  }

  /** Any saved edit outside the draft (report structure, notes) lands in
   *  the live preview through the same debounced token. */
  refreshPreview(): void { this.bumpPreview(); }

  patch(p: Partial<DraftTest>) {
    this._draft.update(d => ({ ...d, ...p }));
    for (const k of Object.keys(p)) this.clearFieldError(k);
    this.bumpPreview();
  }

  back() {
    const t = this._draft().type || this.route.snapshot.queryParamMap.get('type') || 'individual';
    this.navBack.backTo(`/admin/tests?type=${t}`);
  }

  saveTest() {
    const d = this._draft();
    if (!d.name.trim()) { this.toasts.warning('Name is required'); return; }
    if (this.fieldError('testCode')) { this.toasts.warning(this.fieldError('testCode')!); return; }

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
      if (this.repetitive() && new Set(this._memberRows().map(r => r.offsetMin)).size < 2) {
        this.toasts.warning('A timed series needs at least two time points');
        return;
      }
    }

    const pkg = d.type === 'package';
    const bundle = d.type !== 'individual';

    const parametersJson = bundle
      ? (d.type === 'profile' && this.repetitive()
          ? JSON.stringify({
              repetitive: true,
              items: this.normalizeRows(this._memberRows()).map(r => ({ testId: r.testId, offsetMin: r.offsetMin }))
            })
          : JSON.stringify({ items: this._packageItems().map(id => ({ testId: id })) }))
      : (d.parametersJson || undefined);

    const outsourced = d.type !== 'package' && !!d.outsourcedVendorId;
    const body = {
      name: d.name, type: d.type, flow: d.flow,
      price: d.price, taxSlab: d.taxSlab,
      departmentId: d.type === 'package' ? undefined : (d.departmentId || undefined),
      tatHours: d.tatHours, sampleType: d.type === 'package' ? undefined : (d.sampleType || undefined),
      tubeColor: d.type === 'package' ? undefined : d.tubeColor,
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
        next: () => { this._saving.set(false); this.dirty.set(false); this.toasts.success('Saved'); },
        error: e => this.handleSaveError(e)
      });
    } else {
      this.api.post<Test>('/api/tests/', body).subscribe({
        next: t => {
          this._saving.set(false); this.dirty.set(false); this.toasts.success('Created');
          // Stay in the editor — future saves are updates on the new id.
          this.router.navigate(['/admin/tests', t.id, 'edit'],
            { queryParams: { type: d.type }, replaceUrl: true });
        },
        error: e => this.handleSaveError(e)
      });
    }
  }

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
