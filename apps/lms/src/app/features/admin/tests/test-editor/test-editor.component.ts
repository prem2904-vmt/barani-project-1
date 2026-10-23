import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, OnInit, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import type { LiveLayout } from '../../../../shared/utils/report-profile-layout';
import { NgTemplateOutlet } from '@angular/common';
import { HeroBandComponent } from '../../../../shared/components/hero-band/hero-band.component';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ReportLayoutService } from '../../../../core/services/report-layout.service';
import { PageLayoutBox, ReportColumn } from '../../../../shared/models/report-layout.model';
import { ColumnsEditorState, ReportColumnsEditorComponent } from '../../report-template/report-columns-editor.component';
import { PreviewProfileMember, ReportPdfPreviewComponent } from '../../report-template/report-pdf-preview.component';
import { Department } from '../../../../shared/models/tenant.model';
import { Test, TestOptionRow } from '../../../../shared/models/test.model';
import { ReferralLab } from '../../../../shared/models/referral-lab.model';
import { ApiError } from '../../../../shared/models/api-response.model';
import {
  ConditionEditorComponent,
  FieldTypePickerComponent,
  FormField,
  FormFieldType,
  ShowWhen,
  ValidationEditorComponent,
  ValidationPatch,
  hasOptions as registryHasOptions,
} from '../../../../shared/forms';
import { parseCalc, lintExpr, evaluateCalc, CALC_CONSTANT_DEFAULTS, CalcDef } from '../../../../shared/utils/calculation';
import { NumberInputComponent } from '../../../../shared/primitives/number-input.component';
import { CurrencyInrPipe } from '../../../../shared/pipes/currency-inr.pipe';
import { SegmentedOption } from '../../../../shared/primitives/segmented.component';
import { ThemeService } from '../../../../core/services/theme.service';
import { RangeTableComponent, blankGroup, liftParamCriticals } from './range-table.component';
import { validateRanges, type RangeIssue } from '../../../../shared/utils/range-insight';
import { numericParamsOf, type ChartEditorContext, type ChartParamInfo } from '../../../../shared/utils/report-chart/report-chart.sample';
import { hasLegacyFields, loadEditorFields, newFieldId, parseParametersBlob, readParameters, tidyParametersJson, writeParameters } from '../../../../shared/utils/test-parameters';

import { SelectComponent, PfSelectOption } from '../../../../shared/primitives/select.component';
import { methodologyChoices } from '../../../../shared/utils/methodology';
import { TUBE_COLORS } from '../../../../shared/utils/tube-colors';
import {
  SPECIMEN_MODE_OPTIONS, specimenModeOf, withSpecimenMode, type SpecimenMode,
} from '../../../../shared/utils/micro-specimen';
import { AllowedSpecimensComponent } from './allowed-specimens.component';
import { TouchButtonComponent } from '../../../../shared/primitives/touch-button.component';
import { TestLayoutEditorComponent } from '../test-layout-editor.component';
import { ReportStructureComponent } from '../report-structure.component';
import { TestNotesEditorComponent } from '../../report-template/test-notes-editor.component';
import { TestConsumablesComponent } from '../test-consumables.component';
import { AuthService } from '../../../../core/auth/auth.service';
import { TEST_PRICING_PERMS } from '../../../../core/auth/route-access';

/** A shared option-group vocabulary as served by /api/option-groups. */
interface OgGroupLite {
  code: string;
  name: string;
  values: { code: string | null; value: string; normal: boolean; active: boolean }[];
  links: { testId: string }[];
}
import { formatRange, summarizeRanges } from '../../../../shared/utils/reference-range';
import { NavBackService } from '../../../../core/services/nav-back.service';
import { TestPricingService } from '../../../../core/services/test-pricing.service';
import { DEFAULT_TEST_PRICE, effectivePrice, isPriceDefault } from '../../../../shared/utils/test-pricing';
import { OriginBadgeComponent } from '../../../../shared/primitives/origin-badge.component';
import {
  ORIGIN_ICON_PATHS, TestOrigin, canRevertToMaster, isCloneMode, originHint, originLabel, originOf, revertToMasterPath,
} from '../../../../shared/utils/test-origin';
import {
  CODE_RANGE_EXHAUSTED_ERROR, CODE_READONLY_ERROR, CODE_READONLY_HINT, DEPARTMENT_REQUIRED_ERROR, codeDisplay,
  compareTestsByCode,
} from '../../../../shared/utils/test-code';
import { DialogService } from '../../../../core/services/dialog.service';
import { shownDepartmentName } from '../../../../shared/utils/package-department';
import { SKELETON_KIT } from '../../../../shared/primitives/skeleton-kit.component';
import { createLoadHold } from '../../../../shared/utils/min-duration';
import { BusyDirective } from '../../../../shared/directives/busy.directive';
import { printPickerDefaultOf, type PrintPickerDefault } from '../../../../shared/utils/print-picker';
import { OptionFamilyService } from '../../../../core/services/option-family.service';
import type { FamilyNode, OptionFamily } from '../../../../shared/utils/option-family';

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
  parametersJson: string;
  conditionsJson: string;
  isActive: boolean;
  outsourcedVendorId: string;
  outsourcedDepartmentId: string;
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
    price: DEFAULT_TEST_PRICE,
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
    FormsModule,
    CurrencyInrPipe,
    NumberInputComponent,
    ConditionEditorComponent,
    FieldTypePickerComponent,
    ValidationEditorComponent,
    SelectComponent,
    TouchButtonComponent,
    TestLayoutEditorComponent, ReportStructureComponent,
    TestNotesEditorComponent,
    TestConsumablesComponent,
    DragDropModule,
    ReportColumnsEditorComponent,
    ReportPdfPreviewComponent,
    OriginBadgeComponent,
    HeroBandComponent,
    RangeTableComponent,
    NgTemplateOutlet,
    ...SKELETON_KIT,
    BusyDirective,
    AllowedSpecimensComponent,
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
  /** Price + tax slab are editable only with a pricing grant (manage_tests /
   *  manage_test_pricing); the server enforces the same on the bulk price call. */
  protected canEditPrices() {
    return typeof this.auth?.hasAnyPermission !== 'function' || this.auth.hasAnyPermission(TEST_PRICING_PERMS);
  }
  private readonly router = inject(Router);
  private readonly navBack = inject(NavBackService);
  private readonly pricing = inject(TestPricingService);
  private readonly dialog = inject(DialogService);

  // ── Copy-on-write (Test Master single source, phases 3 + 5) ──────────
  /** Editor mode. 'tenant' (every LMS lab: origin badge, revert to master)
   *  or 'master' (the admin console editing the Admin Test Master). Codes are
   *  server-assigned and read-only in both (see shared/utils/test-code). */
  readonly codeMode = signal<'tenant' | 'master'>('tenant');
  setCodeMode(m: 'tenant' | 'master') { this.codeMode.set(m); }
  /** Where the loaded test comes from (Master / Customised / Branch / Own). */
  readonly origin = signal<TestOrigin | null>(null);
  /** The lab's catalogue mode on the loaded row ('clone' | 'reference'). */
  readonly catalogMode = signal<string | null>(null);
  // ── New design (PF-PATTERN "Editors") ─────────────────────────────
  /** Band + context bar + tabs row. Only in the LMS new design, never in the
   *  admin console's master mode (it hosts this editor in its own shell). */
  readonly nd = computed(() => this.themeSvc.isNewDesign() && this.codeMode() === 'tenant');
  /** Where the band's back chevron goes: Test Master on this record's view. */
  readonly backUrl = computed(() =>
    `/admin/tests?type=${this._draft().type || this.route.snapshot.queryParamMap.get('type') || 'individual'}`);
  /** Below 1024px the live preview is a sheet behind the Preview button. */
  readonly previewOpen = signal(false);
  @HostListener('document:keydown.escape', ['$event'])
  onEscape(ev?: Event): void {
    if (!this.previewOpen()) return;
    ev?.preventDefault(); // used → the desktop app stays full screen
    this.previewOpen.set(false);
  }
  /** Origin as a NEUTRAL context chip (label + glyph + hint). */
  readonly originChip = computed(() => {
    const o = this.origin();
    if (!o || this.codeMode() !== 'tenant') return null;
    const k = originOf({ origin: o });
    if (!k) return null;
    const t = { origin: o, catalogMode: this.catalogMode() };
    return { label: originLabel(t), hint: originHint(t), icon: ORIGIN_ICON_PATHS[k] };
  });
  /** The section tabs in the pill + their sliding indicator (x / width of
   *  the selected tab, measured after render; slides on --pf-spring). */
  private readonly tabsEl = viewChild<ElementRef<HTMLElement>>('tabsEl');
  readonly tabInd = signal<{ x: number; w: number }>({ x: 0, w: 0 });
  private readonly _tabIndFx = effect(() => {
    this.section(); this.sectionNav(); this.tabsEl();
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => this.measureTab());
    else this.measureTab();
  });
  @HostListener('window:resize')
  onResizeTabs(): void {
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => this.measureTab());
  }
  measureTab(): void {
    const box = this.tabsEl()?.nativeElement;
    const on = box?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!box || !on) { this.tabInd.set({ x: 0, w: 0 }); return; }
    this.tabInd.set({ x: on.offsetLeft, w: on.offsetWidth });
    // Keep the open tab visible when the strip scrolls (narrow widths).
    const l = on.offsetLeft, r = l + on.offsetWidth;
    if (l < box.scrollLeft) box.scrollLeft = Math.max(0, l - 8);
    else if (r > box.scrollLeft + box.clientWidth) box.scrollLeft = r - box.clientWidth + 8;
  }
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  /** The context bar's pencil: open Basics and put the caret in Name. */
  editName(): void {
    this.jumpToSection('identity');
    setTimeout(() => {
      const el = this.nameInput()?.nativeElement;
      if (el) { el.focus(); el.select(); }
    });
  }
  readonly canRevert = computed(() => this.codeMode() === 'tenant'
    && canRevertToMaster({ origin: this.origin(), catalogMode: this.catalogMode() }));
  readonly reverting = signal(false);
  /** The read-only code field: the assigned code, or "Assigned automatically"
   *  before the first save. */
  readonly codeText = computed(() => codeDisplay(this._draft().testCode, !!this._draft().id));
  readonly codeHint = CODE_READONLY_HINT;

  /** The price as loaded from the pricing table (effective for the acting
   *  branch). A save writes the price ONLY when the draft differs from this,
   *  through the bulk price endpoint — the test save never carries it. New
   *  test = the ₹1 default. */
  private readonly _savedPrice = signal<{ price: number; taxSlab: number; isDefault: boolean }>(
    { price: DEFAULT_TEST_PRICE, taxSlab: 0, isDefault: true });
  /** Still at the ₹1 default and not being changed (data only — no UI notice). */
  readonly priceIsDefault = computed(() => {
    const sp = this._savedPrice();
    const d = this._draft();
    return sp.isDefault && Number(d.price) === sp.price && Number(d.taxSlab) === sp.taxSlab;
  });

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
    'fL', 'pg', '×10³/µL', '×10⁶/µL', 'million/µL', '×10⁹/L', '×10¹²/L',
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

  // ── Methodology: searchable picker (never a bare text box) ──────────
  /** Standard methods (incl. "Calculated") + the tenant's own + the current
   *  value. A method not in the list is TYPED into the picker's search and
   *  chosen from its "Use “…”" row (pf-select allowCreate) — the typed text
   *  is stored as-is. Picking "Calculated" is the lab's choice — it is never
   *  auto-filled for formula tests. */
  readonly methodologyOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: '— no methodology —' },
    ...methodologyChoices(this._draft().methodology,
      this._allIndividualTests().map(t => t.methodology ?? ''))
      .map(m => ({ value: m, label: m })),
  ]);
  onMethodologyPicked(v: string | null) {
    this.patch({ methodology: String(v ?? '').trim() });
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

  onDeptPicked(name: string) {
    if (!name) { this.patch({ departmentId: '' }); return; }
    const id = this._departments().find(d => (d.name ?? '').trim() === name)?.id ?? '';
    this.patch({ departmentId: id });
    // A NEW Microbiology test asks for its specimen by default (owner
    // 2026-09-27: every micro test asks, like Culture & Sensitivity) and is
    // collected into a sterile container unless one was already picked.
    // An existing test's switches are the lab's data — never flipped here.
    const d = this._draft();
    if (!d.id && d.type === 'individual' && /micro/i.test(name)) {
      this.patch({
        parametersJson: withSpecimenMode(d.parametersJson, 'choose'),
        ...(d.tubeColor ? {} : { tubeColor: 'sterile' }),
      });
    }
  }

  /** Culture-bench mark — the ONE marker the whole culture stack keys on:
   *  `microFormat: 'culture_sensitivity'` in the Parameters wrapper. On = the
   *  test lands on the Culture Bench at intake (case auto-created), routes to
   *  the culture validation cockpit, and prints the culture report section.
   *  Offered only for Microbiology tests. */
  readonly isMicroDept = computed<boolean>(() => /micro/i.test(this.selectedDeptName()));

  /** Specimen master (blood, urine, pus, …) — for Microbiology tests the
   *  Sample-type field becomes a dropdown of these instead of free text, so
   *  every micro test picks from the same specimen vocabulary the culture
   *  stack uses. Lazy: fetched once, the first time a micro test is edited. */
  private readonly _specimens = signal<Array<{ code: string; name: string; container: string | null }>>([]);
  private specimensRequested = false;
  private readonly loadSpecimensForMicro = effect(() => {
    if (!this.isMicroDept() || this.specimensRequested) return;
    this.specimensRequested = true;
    this.api.get<Array<{ code: string; name: string; container: string | null }>>('/api/microbiology/specimens')
      .subscribe({ next: l => this._specimens.set(l ?? []), error: () => { /* free-entry fallback below */ } });
  });
  readonly specimenOptions = computed<PfSelectOption<string>[]>(() => {
    const opts: PfSelectOption<string>[] = this._specimens().map(s => ({
      value: s.name, label: s.name, hint: s.container ?? undefined
    }));
    // Never lose a stored value that isn't in the master (legacy free text).
    const current = (this._draft().sampleType ?? '').trim();
    if (current && !opts.some(o => o.value.toLowerCase() === current.toLowerCase())) {
      opts.unshift({ value: current, label: current });
    }
    return opts;
  });

  /** Specimen AT RESULT ENTRY (micro): the toggle adds/removes a real
   *  "Specimen" select parameter (options = the specimen master), so the
   *  tech records the received specimen while entering results and it
   *  prints on the report as a normal result row — no special-casing
   *  anywhere downstream. On = the parameter exists. */
  readonly specimenEntry = computed(() =>
    this._fields().some(f => (f.name ?? '').trim().toLowerCase() === 'specimen'));

  setSpecimenEntry(on: boolean) {
    if (on === this.specimenEntry()) return;
    if (on) {
      const field: FormField = {
        id: newFieldId(),
        name: 'specimen',
        label: 'Specimen',
        type: 'select',
        order: 0,
        isRequired: false,
        isConditional: false,
        options: this._specimens().map((s, i) => ({ id: newFieldId(), order: i, value: s.name, label: s.name })),
      };
      this._fields.update(list => [field, ...list].map((f, i) => ({ ...f, order: i })));
    } else {
      this._fields.update(list => list
        .filter(f => (f.name ?? '').trim().toLowerCase() !== 'specimen')
        .map((f, i) => ({ ...f, order: i })));
    }
    this.persistFieldsToDraft();
  }
  /** The test's SPECIMEN MODE (owner 2026-09-29, the one setting — the
   *  server's SpecimenRules twin): fixed = the one allowed specimen is
   *  stamped on every order (no picker); choose = the desk picks from the
   *  allowed list; none = no specimen. Stored as `specimenMode` in the
   *  Parameters wrapper and saved with the test; the allowed list itself is
   *  edited (and saved) by the Allowed specimens grid below it. */
  readonly specimenMode = computed<SpecimenMode>(() => specimenModeOf(this._draft().parametersJson));
  readonly specimenModeOptions: PfSelectOption<string>[] = SPECIMEN_MODE_OPTIONS.map(o => ({ value: o.value, label: o.label, hint: o.hint }));
  setSpecimenMode(mode: string) {
    const m = mode === 'fixed' || mode === 'choose' || mode === 'none' ? mode : 'none';
    if (m === this.specimenMode()) return;
    this.patch({ parametersJson: withSpecimenMode(this._draft().parametersJson, m) });
  }
  /** The Specimen master rows for the allowed-specimens grid's "Add" picker. */
  readonly specimenMasterRows = computed(() => this._specimens());
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
    else { delete existing.printPicker; delete existing.printPickerDefault; }
    this.patch({ parametersJson: JSON.stringify(existing) });
  }
  /** "Start with" for the picker (owner 2026-09-30): 'all' = every value
   *  starts ticked (absent key — the original behaviour); 'none' = every
   *  value starts unticked and the tech ticks what prints. Stored as
   *  `printPickerDefault: 'none'` in the same wrapper. */
  readonly printPickerStartOptions: ReadonlyArray<{ value: PrintPickerDefault; label: string }> = [
    { value: 'all', label: 'All ticked' },
    { value: 'none', label: 'None ticked' },
  ];
  readonly printPickerDefault = computed<PrintPickerDefault>(() => printPickerDefaultOf(this._draft().parametersJson));
  setPrintPickerDefault(v: PrintPickerDefault) {
    const existing = (() => {
      try { return JSON.parse(this._draft().parametersJson || '{}'); } catch { return {}; }
    })();
    if (v === 'none') existing.printPickerDefault = 'none';
    else delete existing.printPickerDefault;
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

  /** The container picker — THE shared vocabulary (shared/utils/tube-colors),
   *  so a container added there (e.g. the Blood culture bottle) is offered here. */
  readonly tubeColors = TUBE_COLORS;

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
    // The NUMBERS, never the typed report text: mw re-parses this flat text
    // into the band (SyncFlatFieldsIntoSingleParameter), so a report text
    // like "Normal: 70–99 / Diabetes: ≥126" would rewrite L / H as "≥ 70".
    return formatRange(bands[0]) || '';
  }


  protected readonly numericFields = computed(() =>
    this.fields().filter(f => this.isNumericType(f.type)));

  /** Range problems per field index (errors block Save; mw rejects the same
   *  errors — ReferenceRangeValidator). One validator: range-insight.ts. */
  readonly rangeIssues = computed<Map<number, RangeIssue[]>>(() => {
    const out = new Map<number, RangeIssue[]>();
    this.fields().forEach((f, i) => {
      if (!this.isNumericType(f.type)) return;
      out.set(i, validateRanges({ ...f, unit: f.unit || this._draft().unit || null } as never));
    });
    return out;
  });
  /** name → the value's ranges, for the report condition builders (flag
   *  choices + "which line wins" checks read the SAME ranges). */
  readonly paramDefMap = computed<Record<string, unknown>>(() => {
    const out: Record<string, unknown> = {};
    for (const f of this.fields()) {
      const n = (f.name ?? '').trim();
      if (n && this.isNumericType(f.type)) out[n] = { ...f, unit: f.unit || this._draft().unit || null };
    }
    return out;
  });
  /** The table's edit — the group list, written back unchanged. */
  setBands(i: number, bands: unknown[]) {
    if (i < 0) return;
    this.patchField(i, { referenceRanges: bands as FormField['referenceRanges'] });
  }
  /** Every range error, with the value it belongs to. */
  private readonly allRangeErrors = computed(() => {
    const out: Array<{ field: string; issue: RangeIssue; key: string }> = [];
    this.rangeIssues().forEach((list, i) => {
      const f = this.fields()[i];
      const field = (f?.label || f?.name || 'Result').trim();
      for (const issue of list) if (issue.severity === 'error')
        out.push({ field, issue, key: `${f?.name ?? i}|${issue.band}|${issue.message}` });
    });
    return out;
  });
  /** Every range problem blocks Save — including ones the test already had
   *  when it was opened (owner 2026-09-26: legacy data opens with a clear row
   *  message and must be fixed before that test saves; mw refuses the same). */
  readonly rangeErrors = this.allRangeErrors;

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
    { value: 'family', label: 'An answer with sub-choices — e.g. Present → cast types + amount' },
  ];

  // ── Option families (hierarchical answers) ─────────────────────────
  protected readonly familySvc = inject(OptionFamilyService);
  readonly familyOptions = computed<PfSelectOption<string>[]>(() =>
    this.familySvc.families().filter(f => f.active !== false).map(f => ({ value: f.code, label: f.name, hint: f.code })));
  familyOf(i: number): OptionFamily | null { return this.familySvc.find(this.fields()[i]?.familyCode); }
  setFamily(i: number, code: string) { this.patchField(i, { familyCode: code || null }); }
  /** "Absent · Present → Cast type (many)" — the family at a glance. */
  familyRootSummary(n: FamilyNode): string {
    const k = n.children;
    return k?.nodes?.length ? `${n.label} → ${k.label || 'sub-choices'}${k.multi ? ' (many)' : ''}` : n.label;
  }
  openFamilies() { this.router.navigate(['/admin/tests'], { queryParams: { view: 'families' } }); }
  readonly isSingleValue = computed(() => this.fields().length <= 1);

  private readonly themeSvc = inject(ThemeService);
  /** Left section rail hide/unhide — remembered across visits. */
  readonly railHidden = signal<boolean>(
    typeof localStorage !== 'undefined' && localStorage.getItem('pf-te2-rail') === 'hidden');
  toggleRail() {
    this.railHidden.update(v => !v);
    try { localStorage.setItem('pf-te2-rail', this.railHidden() ? 'hidden' : 'shown'); } catch { /* private mode */ }
  }
  readonly entryKind = computed<string>(() => {
    const fs = this.fields();
    if (fs.length === 0) {
      const rt = this._draft().resultType;
      return rt === 'numeric' ? 'number' : rt === 'choice' ? 'choice' : rt ? 'text' : '';
    }
    const t = fs[0].type;
    if (t === 'family') return 'family';
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
    this.patchField(0, { type: kind === 'number' ? 'number' : kind === 'choice' ? 'select' : kind === 'family' ? 'family' : 'textarea' });
    if (kind === 'family') this.familySvc.ensureLoaded();
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

  paramSummary(p: FormField): string {
    const bits: string[] = [];
    if (this.isNumericType(p.type)) {
      const bands = summarizeRanges(p.referenceRanges, p.unit);
      if (bands) {
        bits.push(bands);
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
    // A package has no department — never seed from a legacy stored one.
    const d = this._draft();
    if (this.deptColumnCfg().length === 0) this.loadDeptColumns(d.type === 'package' ? null : d.departmentId);
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
  /** The profile one-page layout as the designer has it right now (unsaved) —
   *  the Live preview renders it while the lab arranges the page. Reset when
   *  another test opens. */
  protected readonly livePageLayout = signal<LiveLayout | null>(null);
  private readonly resetLivePageLayout = effect(() => {
    void this._draft().id; // track: another test opened
    untracked(() => this.livePageLayout.set(null));
  });
  /** This profile's catalogue key (CBC-family detection in the designer). */
  protected readonly draftCatalogKey = computed(() => {
    const id = this._draft().id;
    return id ? (this._memberById().get(id)?.catalogKey ?? null) : null;
  });
  /** The effective columns for the profile one-page layout designer: this
   *  test/profile's own override, else the department set — same cascade
   *  `liveColumnsOverride`/`columnsSummary` already read for the label. */
  protected readonly resolvedColumnsForDesigner = computed<ReportColumn[]>(() =>
    this.testColumnsOverride() ?? this.deptColumnCfg());
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
    if (this.repetitiveActive()) {
      // A timed series previews one row per DRAW, with its time point — so a
      // report chart over the time points shows in the live preview.
      for (const r of this.normalizeRows(this._memberRows())) {
        const t = byId.get(r.testId);
        if (t) out.push({ id: r.testId, name: t.name, parameters: t.parameters ?? null,
                          department: shownDepartmentName(t) || null, offsetMin: r.offsetMin, catalogKey: t.catalogKey ?? null });
      }
      return out;
    }
    for (const id of this.packageItems()) {
      const t = byId.get(id);
      // Each member previews under ITS OWN department (a package has none).
      if (t) out.push({ id, name: t.name, parameters: t.parameters ?? null, department: shownDepartmentName(t) || null, catalogKey: t.catalogKey ?? null });
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

  // ── Loading feedback (PF-PATTERN "Loading feedback") ─────────────────
  /** An existing record is being fetched: true from the first frame of an
   *  `/:id/edit` route until GET /api/tests/:id answers (or fails). The
   *  editor draws its own shape (skeleton) instead of a blank "Edit test"
   *  form that later pops in; Save is not offered for a record that isn't
   *  on screen yet. New tests never load. */
  private readonly recordHold = createLoadHold(!!this.route.snapshot.paramMap.get('id'));
  /** The skeleton: from the first frame, held >= 600ms once shown so a fast
   *  load reads as one motion (skipped when the record was already there). */
  readonly recordSkeleton = this.recordHold.active;

  // ── Editorial redesign: chips, range visual, sentences, publish checklist ──

  /** Glanceable summary chips under the title; clicking scrolls to the field. */
  readonly metaChips = computed<Array<{ k: string; v: string; sec: TestSection }>>(() => {
    const d = this._draft();
    const chips: Array<{ k: string; v: string; sec: TestSection }> = [];
    const origin = originLabel({ origin: this.origin(), catalogMode: this.catalogMode() });
    if (origin) chips.push({ k: 'Origin', v: origin, sec: 'identity' });
    chips.push({ k: 'Code', v: (d.testCode ?? '').trim() || (d.id ? '—' : 'Auto'), sec: 'identity' });
    // A package carries no department (owner 2026-09-27) — no Dept chip.
    if (d.type !== 'package') chips.push({ k: 'Dept', v: this.selectedDeptName() || '—', sec: 'identity' });
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


  /** Critical/normal/high band for the visual bar. Null when there's no numeric basis. */

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

  /** "Ready to publish?" checklist — real form state, adapts to test type. */
  readonly publishChecklist = computed<Array<{ label: string; ok: boolean; action?: TestSection }>>(() => {
    const d = this._draft();
    const rows: Array<{ label: string; ok: boolean; action?: TestSection }> = [];
    const idOk = !!d.name.trim() && !this.fieldError('name')
      && (d.type === 'package' || !!d.departmentId) && (d.price ?? 0) >= 0;
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
  /** PROFILE-level "Tech picks what prints" (owner 2026-09-29): when this
   *  profile is ordered, ITS setting decides for every member — overriding
   *  each test's own. Stored as `printPicker: true` in the profile blob. */
  readonly profilePrintPicker = signal(false);
  setProfilePrintPicker(on: boolean) {
    this.profilePrintPicker.set(on);
    this.patch({});
  }
  /** The profile's "Start with" — overrides each member's when ordered as
   *  this profile (same rule as the switch). Saved only while the switch is
   *  on and only when 'none' (absent = all). */
  readonly profilePrintPickerDefault = signal<PrintPickerDefault>('all');
  setProfilePrintPickerDefault(v: PrintPickerDefault) {
    this.profilePrintPickerDefault.set(v);
    this.patch({});
  }
  private profilePickerKeys(): Record<string, unknown> {
    if (!this.profilePrintPicker()) return {};
    return this.profilePrintPickerDefault() === 'none'
      ? { printPicker: true, printPickerDefault: 'none' }
      : { printPicker: true };
  }
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

  /** pf-select options for the calculated-test target (no native select). */
  readonly calcTargetSelectOptions = computed<PfSelectOption[]>(() =>
    this.calcTargetOptions().map(o => ({ value: o.id, label: o.name })));

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
  /** A profile's printed-report blocks talk about its MEMBERS' values (it has
   *  none of its own): the miniature table lists them and a Sentence's
   *  "Prints only when…" picks from them — the report resolves the profile
   *  against its members' results (report-layouts.ts). */
  private readonly memberReportParams = computed<Array<{ name: string; title: string }>>(() => {
    const out: Array<{ name: string; title: string }> = [];
    const seen = new Set<string>();
    for (const m of this.previewProfileMembers()) {
      const params = readParameters(parseParametersBlob(m.parameters ?? null));
      for (const p of params) {
        const name = (p.name ?? '').trim();
        if (!name || seen.has(name.toLowerCase()) || (p as { printOnReport?: boolean }).printOnReport === false) continue;
        seen.add(name.toLowerCase());
        const title = ((p as { title?: string }).title || (p as { label?: string }).label || '').trim();
        out.push({ name, title: params.length === 1 ? m.name : (title || name) });
      }
    }
    return out;
  });
  /** What the report chart editor knows about this test: its time points
   *  (repetitive profile), and every numeric value with unit + reference
   *  groups (docs/REPORT-CHARTS.md). Culture tests get none. */
  readonly chartContext = computed<ChartEditorContext | null>(() => {
    const d = this._draft();
    if (!d.id || this.cultureBench()) return null;
    const numericOf = (t: Test | undefined): ChartParamInfo[] => numericParamsOf(t?.parameters ?? null, t?.unit ?? null);
    if (d.type === 'individual') {
      const params: ChartParamInfo[] = this.fields()
        .filter(f => (f.name ?? '').trim() && this.isNumericType(f.type))
        .map(f => ({ name: (f.name ?? '').trim(), title: f.label || null, unit: f.unit || d.unit || null,
                     referenceRanges: (f.referenceRanges ?? []) as ChartParamInfo['referenceRanges'] }));
      return { ownerId: d.id, series: false, timepoints: [], params };
    }
    const byId = this._memberById();
    const members = this.previewProfileMembers();
    const seen = new Set<string>();
    const params: ChartParamInfo[] = [];
    for (const m of members) for (const p of numericOf(byId.get(m.id))) {
      if (seen.has(p.name.toLowerCase())) continue;
      seen.add(p.name.toLowerCase());
      // A single-value member reads as the member test ("OGTT – 30 Minutes").
      params.push(numericOf(byId.get(m.id)).length === 1 ? { ...p, title: p.title || m.name } : p);
    }
    const timepoints = this.repetitiveActive()
      ? this.memberGroups().map(g => ({
          offsetMin: g.offsetMin,
          members: g.rows.map(r => byId.get(r.testId)).filter((t): t is Test => !!t)
            .map(t => ({ testId: t.id, name: t.name, code: t.testCode ?? null, params: numericOf(t) })),
        }))
      : [];
    return { ownerId: d.id, series: timepoints.length > 1, timepoints, params };
  });
  readonly reportParamNames = computed<string[]>(() =>
    this._draft().type === 'individual' ? this.parameterNames() : this.memberReportParams().map(p => p.name));
  readonly reportParamTitles = computed<Record<string, string>>(() =>
    this._draft().type === 'individual' ? this.parameterTitleMap()
      : Object.fromEntries(this.memberReportParams().map(p => [p.name, p.title])));
  /** Does the table this test prints in carry a Description column? With
   *  it, descriptions print in that column; without it, each prints as a
   *  full-width line under its result (the editor says so).
   *  Null = columns not loaded / engine defaults (which include it). */
  readonly descriptionColumnPrints = computed<boolean | null>(() => {
    const cols = this.liveColumnsOverride() ?? this.testColumnsOverride() ?? this.deptColumnCfg();
    if (!cols || cols.length === 0) return null;
    return cols.some(c => (c.name ?? '').trim().toLowerCase() === 'description');
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

  /** A member's effective price (₹1 when nobody priced it). */
  priceOf(t: Test): number { return effectivePrice(t); }

  readonly packageMembersTotal = computed(() => {
    const by = this._memberById();
    return this.packageItems().reduce((s, id) => s + (by.has(id) ? effectivePrice(by.get(id)) : 0), 0);
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
      if (q && !t.name.toLowerCase().includes(q) && !(t.testCode ?? '').toLowerCase().includes(q)
        && !(t.department?.name ?? '').toLowerCase().includes(q)) continue;
      const key = t.type === 'profile' ? 'Profiles' : (t.department?.name?.trim() || '(No department)');
      const arr = groups.get(key);
      if (arr) arr.push(t); else groups.set(key, [t]);
    }
    const out = Array.from(groups.entries())
      // Arranged code-wise (QA 2026-09-24): natural test-code order, name last.
      .map(([department, tests]) => ({ department, tests: tests.slice().sort(compareTestsByCode) }))
      .sort((a, b) => {
        if (a.department === 'Profiles') return 1;
        if (b.department === 'Profiles') return -1;
        return a.department.localeCompare(b.department);
      });

    const chosen = new Set(this.packageItems());
    if (chosen.size > 0) {
      const picked = this.pickerSource()
        .filter(t => chosen.has(t.id))
        .sort(compareTestsByCode);
      if (picked.length > 0) out.unshift({ department: SELECTED_GROUP, tests: picked });
    }
    return out;
  });

  // ── Member ORDER (QA 2026-09-24) — a profile prints its members in the
  // order they are stored (items[]), on result entry and on the report. The
  // editor lets the lab arrange that order: drag a row, or step it up/down.
  // Existing profiles keep their stored order as the starting point.
  readonly orderedMembers = computed<{ id: string; name: string; code: string }[]>(() => {
    const byId = this._memberById();
    return this._packageItems().map(id => {
      const t = byId.get(id);
      return { id, name: t?.name ?? '(unknown test)', code: t?.testCode ?? '' };
    });
  });

  /** Step a member one place up (-1) or down (+1). */
  moveMember(index: number, delta: -1 | 1) {
    const to = index + delta;
    const items = this._packageItems();
    if (index < 0 || index >= items.length || to < 0 || to >= items.length) return;
    const next = items.slice();
    moveItemInArray(next, index, to);
    this._packageItems.set(next);
    this.dirty.set(true);
  }

  dropMember(ev: CdkDragDrop<unknown>) {
    if (ev.previousIndex === ev.currentIndex) return;
    const next = this._packageItems().slice();
    moveItemInArray(next, ev.previousIndex, ev.currentIndex);
    this._packageItems.set(next);
    this.dirty.set(true);
  }

  // ── PRINTED REPORT order (owner 2026-09-24) — a SECOND, independent
  // sequence. The list above (items[]) is the LAB ENTRY order (Position is
  // stamped from it at order creation); this one only decides the order the
  // members print on the final report, stored as the profile's optional
  // `reportOrder` (member test ids). Starts as the stored reportOrder, else
  // the loaded lab order — so rearranging lab entry never moves the report.
  // New members join at the end; removed members drop out.
  private readonly _reportOrder = signal<string[]>([]);
  readonly reportOrderIds = computed<string[]>(() =>
    reconcileMemberOrder(this._reportOrder(), this.packageItems()));
  readonly reportOrderedMembers = computed<{ id: string; name: string; code: string }[]>(() => {
    const byId = this._memberById();
    return this.reportOrderIds().map(id => {
      const t = byId.get(id);
      return { id, name: t?.name ?? '(unknown test)', code: t?.testCode ?? '' };
    });
  });
  /** True when the printed order differs from the lab entry order. */
  readonly reportOrderCustom = computed(() => {
    const lab = [...new Set(this.packageItems())];
    const rep = this.reportOrderIds();
    return rep.length !== lab.length || rep.some((id, i) => id !== lab[i]);
  });

  moveReportMember(index: number, delta: -1 | 1) {
    const ids = this.reportOrderIds();
    const to = index + delta;
    if (index < 0 || index >= ids.length || to < 0 || to >= ids.length) return;
    const next = ids.slice();
    moveItemInArray(next, index, to);
    this._reportOrder.set(next);
    this.dirty.set(true);
  }

  dropReportMember(ev: CdkDragDrop<unknown>) {
    if (ev.previousIndex === ev.currentIndex) return;
    const next = this.reportOrderIds().slice();
    moveItemInArray(next, ev.previousIndex, ev.currentIndex);
    this._reportOrder.set(next);
    this.dirty.set(true);
  }

  /** Print in the lab entry order again. */
  resetReportOrder() {
    this._reportOrder.set([...new Set(this.packageItems())]);
    this.dirty.set(true);
  }

  /** The `reportOrder` a save writes: only when it differs from the lab entry
   *  order (a profile whose two orders agree keeps its stored blob as-is). */
  private reportOrderForSave(): string[] | undefined {
    return this._draft().type === 'profile' && this.reportOrderCustom() ? this.reportOrderIds() : undefined;
  }

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
    this.pricing.ensureLoaded();
    this.familySvc.ensureLoaded();
    this.loadOptionGroups();
    this.api.get<Department[]>('/api/tenants/departments').subscribe({
      next: l => this._departments.set(l ?? [])
    });
    this.api.get<ReferralLab[]>('/api/referral-labs').subscribe({
      next: l => this._referralLabs.set(l ?? [])
    });

    const id = this.route.snapshot.paramMap.get('id');
    // The two catalogue-wide lists (every test / profile WITH its parameters —
    // megabytes on a real catalogue) are only pickers + cross-checks for a
    // single test, so an individual test's own record goes first and they
    // follow once it is on screen; a profile / package lists its members from
    // them, so those still load together with the record.
    const type = this.route.snapshot.queryParamMap.get('type');
    if (id && type === 'individual') this._afterRecord = () => this.loadCatalogueLists();
    else this.loadCatalogueLists();

    if (id) {
      this.loadTest(id);
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
    this.recordHold.cancel();
    if (this._previewTimer) { clearTimeout(this._previewTimer); this._previewTimer = null; }
  }

  /** Runs once, right after the first record lands (see ngOnInit). */
  private _afterRecord: (() => void) | null = null;

  private loadCatalogueLists() {
    this.api.get<Test[]>('/api/tests/?type=individual').subscribe({
      next: l => this._allIndividualTests.set((l ?? []).filter(t => t.type !== 'package'))
    });
    this.api.get<Test[]>('/api/tests/?type=profile').subscribe({
      next: l => this._allProfiles.set((l ?? []).filter(t => t.type === 'profile'))
    });
  }

  private runAfterRecord() {
    const run = this._afterRecord;
    this._afterRecord = null;
    run?.();
  }

  private loadTest(id: string) {
    this.api.get<Test>(`/api/tests/${id}`).subscribe({
      next: t => { this.hydrateFrom(t); this.recordHold.done(); this.runAfterRecord(); },
      error: e => { this.recordHold.done(); this.runAfterRecord(); this.toasts.error(ApiError.from(e).message); }
    });
  }

  /** Copy-on-write moved this test to a different row (the lab's new copy
   *  after the first save of a master test, or the master again after a
   *  revert): the editor follows it — same route, so the component is
   *  reused and the URL is replaced, never pushed. */
  private followRow(t: Test | null | undefined, type: string, fresh = false) {
    if (!t?.id) return;
    this.router.navigate(['/admin/tests', t.id, 'edit'], { queryParams: { type }, replaceUrl: true });
    // `fresh` = the response IS the current row; otherwise re-read it (a
    // price written after the save must show, not the response's old one).
    if (fresh && t.name !== undefined && t.type !== undefined) this.hydrateFrom(t);
    else this.loadTest(t.id);
  }

  /** Drop this lab's (or branch's) copy: the test reads the Admin Test
   *  Master again. DialogService confirm — never window.confirm. */
  async revertToMaster() {
    const d = this._draft();
    if (!d.id || !this.canRevert() || this.reverting()) return;
    const branch = this.origin() === 'branch';
    const ok = await this.dialog.confirm({
      title: `Revert ${d.name || 'this test'} to the master?`,
      message: (branch ? 'This branch\'s' : 'Your lab\'s')
        + ' changes to this test are discarded and it reads the Admin Test Master again. Prices stay as they are.'
        + (this.dirty() ? ' Unsaved edits here are lost too.' : ''),
      confirmLabel: 'Revert to master',
      cancelLabel: 'Keep my changes',
      tone: 'danger',
    });
    if (!ok) return;
    this.reverting.set(true);
    this.api.post<Test | { id?: string; testId?: string } | null>(revertToMasterPath(d.id), {}).subscribe({
      next: r => {
        this.reverting.set(false);
        this.toasts.success('Reverted — this test now follows the Test Master');
        const nextId = (r as { id?: string } | null)?.id ?? (r as { testId?: string } | null)?.testId;
        if (nextId) this.followRow({ ...(r as Test), id: nextId }, d.type, true);
        else this.back();
      },
      error: e => { this.reverting.set(false); this.toasts.error(ApiError.from(e).message); }
    });
  }

  /** The save body as loaded (see buildSaveBody) — what an update diffs against. */
  private _baseline: Record<string, unknown> = {};
  /** The test-level methodology as loaded — per-value copies equal to it are
   *  followers of the test, stripped on save (see buildSaveBody). */
  private _loadedMethodology = '';

  private hydrateFrom(t: Test) {
    this._loadedMethodology = t.methodology ?? '';
    this.origin.set(originOf(t));
    this.catalogMode.set(t.catalogMode ?? null);
    this._savedPrice.set({ price: effectivePrice(t), taxSlab: Number(t.taxSlab) || 0, isDefault: isPriceDefault(t) });
    try {
      this._calcInfo.set(t.calculation ? JSON.parse(t.calculation) : null);
    } catch {
      this._calcInfo.set(null);
    }
    this._draft.set({
      id: t.id, name: t.name, type: t.type, flow: t.flow,
      price: effectivePrice(t), taxSlab: Number(t.taxSlab) || 0,
      departmentId: t.departmentId ?? '', tatHours: t.tatHours,
      sampleType: t.sampleType ?? '', tubeColor: t.tubeColor ?? '',
      testCode: t.testCode ?? '', shortName: t.shortName ?? '', section: t.section ?? '',
      profile: t.profile ?? '',
      sampleVolumeMl: t.sampleVolumeMl ?? null, fastingRequired: t.fastingRequired ?? false,
      methodology: t.methodology ?? '', resultType: t.resultType ?? '',
      unit: t.unit ?? '', reportFormat: t.reportFormat ?? '',
      adultReferenceRange: t.adultReferenceRange ?? '',
      parametersJson: t.parameters ?? '', conditionsJson: t.conditions ?? '[]',
      isActive: t.isActive,
      outsourcedVendorId: t.outsourcedVendorId ?? '',
      outsourcedDepartmentId: t.outsourcedDepartmentId ?? ''
    });
    // Legacy test-wide criticals become each group's CL / CH (simple model).
    this._fields.set(this.loadParameters(t.parameters ?? '').map(f => liftParamCriticals(f)));
    if (t.type === 'package' || t.type === 'profile') {
      try {
        const blob = JSON.parse(t.parameters ?? '{}');
        const items = Array.isArray(blob.items) ? blob.items : [];
        const ids: string[] = items
          .map((it: unknown) => typeof it === 'string' ? it : ((it as { testId?: string })?.testId ?? ''))
          .filter((id: string) => id.length > 0);
        this._packageItems.set([...new Set(ids)]);
        this._reportOrder.set(readReportOrder(blob) ?? [...new Set(ids)]);
        this.profilePrintPicker.set(t.type === 'profile' && blob.printPicker === true);
        this.profilePrintPickerDefault.set(t.type === 'profile' ? printPickerDefaultOf(t.parameters) : 'all');
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
        this._reportOrder.set([]);
        this._memberRows.set([]);
        this.repetitive.set(false);
        this.profilePrintPicker.set(false);
        this.profilePrintPickerDefault.set('all');
      }
    } else {
      this._packageItems.set([]);
      this._reportOrder.set([]);
      this._memberRows.set([]);
      this.repetitive.set(false);
      this.profilePrintPicker.set(false);
      this.profilePrintPickerDefault.set('all');
    }
    // One-page layout: the Report-layout card is always visible, so its columns
    // must be loaded up-front rather than on a tab switch.
    if (this.onePage()) this.ensureLayoutData();
    this._baseline = this.buildSaveBody(this._draft());
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
    return loadEditorFields(draftJson);
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

  /** The editor's value list → `parameters[]` (the ONE stored list; no
   *  `fields[]` twin is ever written). */
  private persistFieldsToDraft() {
    this.patch({ parametersJson: writeParameters(this._draft().parametersJson, this._fields()) });
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
      referenceRanges: [blankGroup()]
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
   *  the live preview through the same debounced token. Those edits are
   *  ALREADY stored (they autosave), so they never mark the draft dirty —
   *  the band's "Unsaved changes" used to light up for work that was saved. */
  refreshPreview(): void {
    if (this._previewTimer) clearTimeout(this._previewTimer);
    this._previewTimer = setTimeout(() => this._previewToken.update(v => v + 1), 700);
  }

  patch(p: Partial<DraftTest>) {
    this._draft.update(d => ({ ...d, ...p }));
    for (const k of Object.keys(p)) this.clearFieldError(k);
    this.bumpPreview();
  }

  back() {
    const t = this._draft().type || this.route.snapshot.queryParamMap.get('type') || 'individual';
    this.navBack.backTo(`/admin/tests?type=${t}`);
  }

  /** The content a save writes, built from the draft + the editor's value
   *  list. Also the load-time BASELINE: an update PATCHes only the keys whose
   *  value differs from it (see saveTest). */
  private buildSaveBody(d: DraftTest): Record<string, unknown> {
    const pkg = d.type === 'package';
    const bundle = d.type !== 'individual';

    const parametersJson = bundle
      ? (d.type === 'profile' && this.repetitive()
          ? JSON.stringify({
              repetitive: true,
              items: this.normalizeRows(this._memberRows()).map(r => ({ testId: r.testId, offsetMin: r.offsetMin })),
              ...withReportOrder(this.reportOrderForSave()),
              ...this.profilePickerKeys(),
            })
          : JSON.stringify({
              items: this._packageItems().map(id => ({ testId: id })),
              ...withReportOrder(this.reportOrderForSave()),
              // A package never carries it — the profile / test decides.
              ...(d.type === 'profile' ? this.profilePickerKeys() : {}),
            }))
      // A legacy blob still carrying the old `fields[]` twin is normalised to
      // the single parameters[] list on this save (props folded on load).
      // Single-source tidy on every save: the wrapper `sampleType` is dropped
      // (the column is the specimen) and per-value methodology copies equal
      // to the test-level one are stripped (hybrid: value ?? test).
      : (d.parametersJson
          ? tidyParametersJson(
              hasLegacyFields(d.parametersJson) ? writeParameters(d.parametersJson, this._fields()) : d.parametersJson,
              // Copies equal to the methodology AS LOADED were following the
              // test too: changing the test's methodology must carry them
              // along, never leave them behind as per-value overrides.
              d.methodology, this._loadedMethodology) ?? undefined
          : undefined);

    const outsourced = d.type !== 'package' && !!d.outsourcedVendorId;
    // No price / tax here: the pricing table owns them (saved separately
    // below through the bulk price endpoint, only when changed).
    return {
      name: d.name, type: d.type, flow: d.flow,
      departmentId: d.type === 'package' ? undefined : (d.departmentId || undefined),
      tatHours: d.tatHours, sampleType: d.type === 'package' ? undefined : (d.sampleType || undefined),
      tubeColor: d.type === 'package' ? undefined : d.tubeColor,
      // No testCode: the server assigns it on create and it never changes.
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
      parametersJson,
      conditionsJson: d.conditionsJson || undefined,
      isActive: d.isActive,
      outsourcedVendorId: outsourced ? d.outsourcedVendorId : undefined,
      outsourcedDepartmentId: outsourced ? (d.outsourcedDepartmentId || undefined) : undefined,
      clearOutsource: (d.id && !outsourced) ? true : undefined
    };
  }

  saveTest() {
    const d = this._draft();
    if (!d.name.trim()) { this.toasts.warning('Name is required'); return; }

    if (d.type === 'profile') {
      if (this.packageItems().length === 0) {
        this.toasts.warning('Add at least one member test to the profile');
        return;
      }
      if (this.repetitive() && new Set(this._memberRows().map(r => r.offsetMin)).size < 2) {
        this.toasts.warning('A timed series needs at least two time points');
        return;
      }
    }

    if (d.type === 'individual' && this.rangeErrors().length > 0) {
      const first = this.rangeErrors()[0];
      const n = this.rangeErrors().length;
      this.jumpToSection('results');
      this.toasts.warning(`Fix the reference range${n > 1 ? 's' : ''} first — ${first.field}${first.issue.band != null ? `, group ${first.issue.band + 1}` : ''}: ${first.issue.message}${n > 1 ? ` (+${n - 1} more)` : ''}`);
      return;
    }

    const body = this.buildSaveBody(d);

    this._saving.set(true);
    if (d.id) {
      // Copy-on-write: whatever the PATCH carries is what the lab changed, and
      // any change stores a whole copy of a master test (a "Branch" copy under
      // isolation). So send ONLY the keys that differ from what was loaded —
      // never the untouched rest, nor values the editor merely re-derives
      // (the flat range, a tidied value list). Nothing changed = no PATCH.
      const changed = changedKeys(body, this._baseline);
      if (Object.keys(changed).length === 0) {
        this.savePriceThen(d.id, d, () => this.toasts.success('Saved'));
        return;
      }
      this.api.patch<Test>(`/api/tests/${d.id}`, changed).subscribe({
        next: t => {
          this._baseline = body;   // saved: the next save diffs against this
          // Copy-on-write: the first save of a master test (or of the tenant
          // copy under branch isolation) creates the lab's OWN row with a new
          // id — prices and every later save go to that row.
          const moved = !!t?.id && t.id !== d.id;
          this.savePriceThen(moved ? t.id : d.id!, d, () => {
            if (moved) {
              this.toasts.success(this.codeMode() === 'tenant' && this.origin() === 'master'
                && !isCloneMode({ catalogMode: this.catalogMode() })
                ? 'Saved as your lab\'s own version of this test' : 'Saved');
              this.followRow(t, d.type);
            } else {
              if (t?.origin) this.origin.set(originOf(t));
              if (t?.catalogMode) this.catalogMode.set(t.catalogMode);
              this.toasts.success('Saved');
            }
          });
        },
        error: e => this.handleSaveError(e)
      });
    } else {
      this.api.post<Test>('/api/tests/', body).subscribe({
        next: t => this.savePriceThen(t.id, d, () => {
          const assigned = (t?.testCode ?? '').trim();
          this.toasts.success(assigned ? `Created — code ${assigned}` : 'Created');
          // Stay in the editor — future saves are updates on the new id.
          this.router.navigate(['/admin/tests', t.id, 'edit'],
            { queryParams: { type: d.type }, replaceUrl: true });
        }),
        error: e => this.handleSaveError(e)
      });
    }
  }

  /** Second half of a save: write the price to the pricing table (bulk
   *  endpoint, acting branch when isolation is ON) when it changed, then
   *  finish. A price failure keeps the editor dirty and marks the field —
   *  the test content is already saved. */
  private savePriceThen(testId: string, d: DraftTest, done: () => void) {
    const sp = this._savedPrice();
    const price = Math.max(0, Number(d.price) || 0);
    const taxSlab = Math.max(0, Number(d.taxSlab) || 0);
    const finish = () => { this._saving.set(false); this.dirty.set(false); done(); };
    if (price === sp.price && taxSlab === sp.taxSlab) { finish(); return; }
    this.pricing.save([{ testId, price, taxSlab }]).subscribe({
      next: () => {
        this._savedPrice.set({ price, taxSlab, isDefault: false });
        finish();
      },
      error: e => {
        this._saving.set(false);
        const msg = ApiError.from(e).message;
        this._fieldErrors.update(m => ({ ...m, price: msg }));
        this.toasts.error(`Test saved, but the price was not: ${msg}`);
      }
    });
  }

  private handleSaveError(e: unknown) {
    this._saving.set(false);
    const err = ApiError.from(e);
    if (err.code === CODE_READONLY_ERROR || err.code === CODE_RANGE_EXHAUSTED_ERROR) {
      this.toasts.warning(err.message);
      return;
    }
    if (err.code === DEPARTMENT_REQUIRED_ERROR) {
      this.toasts.warning(err.message);
      return;
    }
    const field = err.field ?? '';
    if (err.code === 'range_invalid' || field === 'referenceRanges') {
      // mw's ReferenceRangeValidator refused the ranges (same rules as the
      // editor's own check) — show them where they are edited.
      this.jumpToSection('results');
      this.toasts.warning(err.message);
      return;
    }
    if (field === 'name' || field === 'price' || field === 'testCode') {
      this._fieldErrors.update(m => ({ ...m, [field]: err.message }));
    } else {
      this.toasts.error(err.message);
    }
  }
}

/** The keys of `body` whose value differs from `baseline` (compared as JSON). */
export function changedKeys(body: Record<string, unknown>, baseline: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined && baseline[k] === undefined) continue;
    if (JSON.stringify(v ?? null) !== JSON.stringify(baseline[k] ?? null)) out[k] = v;
  }
  return out;
}

/** A profile's printed-report order, reconciled with its current members:
 *  the stored order's members first (dropping any no longer in the profile),
 *  then members it doesn't name yet, in lab-entry order. */
export function reconcileMemberOrder(order: readonly string[], members: readonly string[]): string[] {
  const live = [...new Set(members)];
  const have = new Set(live);
  const out = [...new Set(order)].filter(id => have.has(id));
  const placed = new Set(out);
  for (const id of live) if (!placed.has(id)) out.push(id);
  return out;
}

/** The member ids of a profile blob's `reportOrder` (id strings or
 *  `{ testId }` objects), or null when the blob has none. */
export function readReportOrder(blob: unknown): string[] | null {
  const raw = (blob as { reportOrder?: unknown } | null)?.reportOrder;
  if (!Array.isArray(raw)) return null;
  const ids = raw
    .map(e => typeof e === 'string' ? e : ((e as { testId?: string } | null)?.testId ?? ''))
    .filter(id => id.length > 0);
  return ids.length > 0 ? [...new Set(ids)] : null;
}

/** `{ reportOrder }` to spread into a saved profile blob — nothing when unset. */
function withReportOrder(order: string[] | undefined): { reportOrder?: string[] } {
  return order && order.length > 0 ? { reportOrder: order } : {};
}
