export interface Test {
  id: string;
  tenantId: string;
  branchId?: string;
  departmentId?: string;
  name: string;
  code?: string;
  /** Human-facing test code / SKU (distinct from department code). */
  testCode?: string | null;
  /** Abbreviated display name. */
  shortName?: string | null;
  /** Sub-grouping under the department. */
  section?: string | null;
  /** Profile group tag (e.g. 'LFT', 'Lipid Profile') from the test catalogue. */
  profile?: string | null;
  description?: string;
  type: "individual" | "profile" | "package";
  flow: "direct" | "approval";
  hsnSacCode?: string;
  taxSlab: number;
  price: number;
  discount: number;
  parameters?: string;
  conditions?: string;
  sampleType?: string;
  /** Specimen volume required, in millilitres. */
  sampleVolumeMl?: number | null;
  /** Whether the patient must fast before collection. */
  fastingRequired?: boolean;
  /** Analytical method (e.g. 'ELISA'). */
  methodology?: string | null;
  /** Shape of the result — e.g. 'numeric' | 'text' | 'positive_negative'. */
  resultType?: string | null;
  /** Result unit at the test level (e.g. 'mg/dL'). */
  unit?: string | null;
  /** Report rendering format hint (e.g. 'tabular' | 'descriptive'). */
  reportFormat?: string | null;
  /** Free-text adult reference range at the test level. */
  adultReferenceRange?: string | null;
  /** Critical low panic value at the test level. */
  criticalLow?: number | null;
  /** Critical high panic value at the test level. */
  criticalHigh?: number | null;
  /** Tube/vial colour: 'red' | 'lavender' | 'grey' | 'blue' | null. */
  tubeColor?: string | null;
  tatHours: number;
  isActive: boolean;
  /** When set, this test is subcontracted to a referral lab (null = in-house). */
  outsourcedVendorId?: string | null;
  /** Department-at-vendor used for outsourced vial grouping (falls back to departmentId). */
  outsourcedDepartmentId?: string | null;
  /** Calculated-result definition (JSON CalcDef — see shared/utils/calculation):
   *  how this test's value derives from sibling results in the same profile
   *  (VLDL-C = TG/5, eGFR…). Null = conventionally measured. */
  calculation?: string | null;
  department?: { id: string; name: string; code: string };
  createdAt: string;
}

// Canonical reference-range shape (segment label + min/max + structured
// sex/age selectors). Defined once in the form-field model; re-exported here
// so result/report code can import it from the test model too.
export type { ReferenceRange } from "../forms/form-field.model";
import type { ReferenceRange } from "../forms/form-field.model";

/** One row of a test's embedded option table. */
export interface TestOptionRow {
  /** Catalogue option code (e.g. URO001) — repeated per test on purpose;
   *  admin-added rows continue the same series automatically. */
  code?: string | null;
  value: string;
  /** Normal (expected) — picking anything else flags abnormal. */
  normal?: boolean;
  /** Inactive rows are hidden from the dropdown but kept for history. */
  active?: boolean;
}

export interface TestParameter {
  id: string;
  name: string;
  title: string;
  /** What the tech enters. New saves write the editor's own vocabulary
   *  ('numeric' for numbers, 'select', 'radio', 'textarea', 'yesno', …);
   *  older catalogues also carry 'options', 'multiline', 'qualitative',
   *  'choice', … — always decide through `resolveParamEntryKind`. */
  type:
    | "numeric"
    | "text"
    | "textarea"
    | "select"
    | "multiselect"
    | "radio"
    | "button_select"
    | "yesno"
    | "toggle"
    | "date"
    | "numeric_with_range"
    | import("../forms/form-field.model").FormFieldType
    | (string & {});
  unit?: string;
  options?: string[];
  /** This test's OWN option table (per-test by design — no shared
   *  dictionaries): full rows with the doc's option code, Normal flag and
   *  Active flag. `options`/`normalValue` are derived from it on save so
   *  older readers keep working. */
  optionRows?: TestOptionRow[];
  /** Display name for the shared option group this parameter's rows form —
   *  set when the list is created in the test editor; DeriveGroups prefers
   *  it over the first linked parameter's title. */
  optionGroupName?: string | null;
  referenceRanges?: ReferenceRange[];
  normalValue?: string;
  criticalLow?: number;
  criticalHigh?: number;
  // Plausible / analytically-possible band — wider than the reference and
  // critical ranges. A value outside it is treated as a transcription error
  // and rejected at submit. Optional; unset = no plausibility check.
  validLow?: number;
  validHigh?: number;
  /** Photos & video at result entry for THIS value (per-row toggle); the
   *  Parameters-root `attachments: true` marker means every value. */
  attachments?: boolean;
  /** Per-value print switch: false = recorded at the bench, never printed. */
  printOnReport?: boolean;

  // ── Editor / entry-form properties (optional; readers that don't care
  // ignore them). These used to live ONLY on a parallel `fields[]` array —
  // `parameters[]` is now the single list of a test's result fields.
  isRequired?: boolean;
  isConditional?: boolean;
  /** Show this value only when the rule holds (rules reference parameter ids). */
  showWhen?: import("../forms/form-field.model").ShowWhen | null;
  validation?: import("../forms/form-field.model").ValidationConfig | null;
  placeholder?: string | null;
  helperText?: string | null;
  icon?: string | null;
  width?: import("../forms/form-field.model").FormFieldWidth;
  defaultValue?: unknown;
  defaultUnit?: import("../forms/form-field.model").DurationUnitType | null;
  imageGalleryConfig?: import("../forms/form-field.model").ImageGalleryConfig | null;
  scribblePadConfig?: import("../forms/form-field.model").ScribblePadConfig | null;
  sizeConfig?: import("../forms/form-field.model").SizeConfig | null;
  measureConfig?: import("../forms/form-field.model").MeasureConfig | null;
  disabled?: boolean;
}

export interface TestParametersBlob {
  sampleType?: string;
  tatHours?: number;
  /** Microbiology result format hint: 'culture_sensitivity' routes to the
   *  structured culture entry + report; others render generically. */
  microFormat?: string;
  parameters: TestParameter[];
  /** @deprecated LEGACY ONLY — a parallel editor copy older saves wrote next
   *  to `parameters`. Never write it; `readParameters` folds it into the
   *  parameters on read and the next save drops it. */
  fields?: import("../forms/form-field.model").FormField[];
}

export interface TestCondition {
  if: { parameter: string; operator: string; value: unknown };
  then: { action: string; additional?: string };
}
