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
  /** Standard code (LOINC, e.g. "6690-2"), set on the master catalogue; null = not set. */
  standardCode?: string | null;
  /** Sub-grouping under the department. */
  section?: string | null;
  /** Profile group tag (e.g. 'LFT', 'Lipid Profile') from the test catalogue. */
  profile?: string | null;
  description?: string;
  type: "individual" | "profile" | "package";
  flow: "direct" | "approval";
  hsnSacCode?: string;
  /** EFFECTIVE price / discount / GST slab for the acting branch, derived
   *  from the per-tenant pricing table (never stored on the test row). */
  taxSlab: number;
  price: number;
  discount: number;
  /** True = nobody has priced this test yet: it bills at the ₹1 default and
   *  shows just the price ("₹1"). */
  priceIsDefault?: boolean;
  /** False = not offered at this tenant/branch: hidden from ordering
   *  (ordering it anyway → 409 `not_offered`). Absent = offered. */
  isOffered?: boolean;
  /** The Test Master Active/Inactive switch: isActive AND isOffered (see
   *  `isTestEnabled`). False = switched off — still listed in Test Master,
   *  gone from ordering and the lab. */
  isEnabled?: boolean;
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
  /** Lineage anchor shared by a master test and every lab copy of it. */
  catalogKey?: string | null;
  /** Where this row comes from (copy-on-write, see shared/utils/test-origin):
   *  'master' | 'customised' | 'branch' | 'local'. Absent on older payloads. */
  origin?: 'master' | 'customised' | 'branch' | 'local' | null;
  /** The lab's catalogue mode: 'clone' (own copy of every test — a 'master'
   *  origin means "your copy, unchanged"; no revert) | 'reference'. Null on the
   *  Admin Test Master's own rows and older payloads. */
  catalogMode?: 'clone' | 'reference' | null;
  /** Unit DERIVED from the parameters (read-only; the printed unit is the
   *  parameter's). Replaces the flat `unit` column for display. */
  derivedUnit?: string | null;
  /** Flat reference range DERIVED from the parameter bands (read-only). */
  derivedReferenceRange?: string | null;
  /** A Test Master change waiting for this lab's copy (proposal id etc.). */
  pendingProposal?: { id: string; kind?: string; createdAt?: string } | null;
}

/** A pending Test Master change offered to this lab's copy of a test
 *  (`GET /api/catalog-proposals`). Under copy-on-write there is one per
 *  override row: `targetTestId` = the lab's copy, `branchId` = the branch
 *  whose copy it is (null = the tenant-wide copy). */
export interface CatalogProposal {
  id: string;
  tenantId?: string;
  catalogKey: string;
  kind: 'new' | 'update' | (string & {});
  status?: string;
  createdAt: string;
  targetTestId?: string | null;
  branchId?: string | null;
  proposedPayloadJson?: string | null;
  /** The test it is about (server-resolved). */
  testName?: string | null;
  testCode?: string | null;
  /** When the master version on offer was made / when the lab last changed its copy. */
  masterUpdatedAt?: string | null;
  yourChangedAt?: string | null;
  /** Every differing catalogue field — the review's Field · Yours · Master table. */
  fields?: { field: string; label: string; yours?: string | null; master?: string | null }[] | null;
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
  /** `type: 'family'`: the option family this value is answered from
   *  (shared/utils/option-family.ts). */
  familyCode?: string | null;
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
  /** Per-value methodology OVERRIDE — hybrid: effective = this ?? the test's
   *  `methodology` column (see shared/utils/methodology.ts). Absent = the
   *  test-level methodology applies; a copy equal to it is stripped on save. */
  methodology?: string | null;

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
  /** @deprecated DUPLICATE of the `tests.SampleType` column — never written
   *  (writeParameters / tidyParametersJson drop it); the column is the specimen. */
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
