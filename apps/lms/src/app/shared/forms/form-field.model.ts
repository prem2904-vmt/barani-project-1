// Shared form-field schema. Ported from form-builder's Form.model.ts so the
// test editor + workflow builder share one vocabulary for field types,
// conditional visibility, and per-type config.
//
// Scope is narrower than form-builder's full Form/Page/Section tree — a lab
// test currently needs only a flat array of fields (parameters). When richer
// structures are required (grouped sections, multi-page narratives), lift
// Page/Section from form-builder as-is; the leaf types here will still apply.

// ── Field type taxonomy ───────────────────────────────────────────────

export type FormFieldType =
  | 'text'
  | 'number'
  | 'textarea'
  | 'voice-text'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'radio'
  | 'duration'
  | 'duration-time'
  | 'duration-period'
  | 'date'
  | 'time'
  | 'datetime'
  | 'buttonSelect'
  | 'imageSelect'
  | 'yesno'
  | 'yesNoNa'
  | 'toggle'
  | 'phone'
  | 'email'
  | 'multiTextbox'
  | 'imageGallery'
  | 'scribblePad'
  | 'imageInfo'
  | 'signature'
  | 'file-upload'
  | 'section-header'
  | 'info-text'
  | 'size'
  | 'measure'
  | 'table'
  | 'recursive'
  | 'recursivePages';

// Groups for the field-type picker UI.
export type FormFieldCategory = 'input' | 'choice' | 'layout' | 'media' | 'advanced';

// Width bucket — maps to CSS in the renderer.
export type FormFieldWidth = 'full' | 'half' | 'third' | 'quarter';

// ── Conditional visibility ────────────────────────────────────────────

export type ConditionOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEqual'
  | 'lessThanOrEqual';

export interface ConditionRule {
  fieldId: string; // Source field whose value drives the condition
  operator: ConditionOperator;
  value?: unknown;
}

export interface ShowWhen {
  logic: 'AND' | 'OR';
  visibility?: 'show' | 'hide'; // default 'show'
  conditions: ConditionRule[];
}

// ── Options (for select/multiselect/radio/buttonSelect/imageSelect) ───

export interface FieldOption {
  id: string;
  label: string;
  value: string;
  order: number;
  icon?: string | null;
  image?: string | null;
  color?: string | null;
  description?: string | null;
}

// ── Validation ────────────────────────────────────────────────────────

export interface ValidationConfig {
  minLength?: number | null;
  maxLength?: number | null;
  min?: number | null;
  max?: number | null;
  pattern?: string | null;
  errorMessage?: string | null;
}

// ── Reference ranges (lab-specific — keeps test-editor semantics) ─────

/**
 * One group of patients' reference range — the simple model (owner,
 * 2026-09-26): Who (`sex`) + Age, `min` = L, `max` = H, `criticalLow` = CL,
 * `criticalHigh` = CH, and `reportText` printed on the report exactly as
 * typed. value < L → L, > H → H, < CL / > CH → critical; on a limit = not
 * flagged. `segment`, `label`, `minOp` / `maxOp` are LEGACY: read (until the
 * data is migrated), never written by new saves.
 */
export interface ReferenceRange {
  /** Legacy free-text population ("Male adult", "0-1 yr", "prediabetes"). */
  segment?: string;
  min?: number | null;
  max?: number | null;
  /** Legacy comparators: only an explicit strict 'gt' / 'lt' still flags the
   *  limit itself; absent = on the limit is normal. Mirrors mw `RangeDef`. */
  minOp?: 'gt' | 'gte' | null;
  maxOp?: 'lt' | 'lte' | null;
  unit?: string | null;
  // Structured selectors. When present the backend picks the band by the
  // patient's sex/age instead of parsing the free-text `segment` label.
  // `sex` undefined / 'any' = applies to all sexes. Age bounds are in
  // `ageUnit` (default years); an open-ended bound is left null/undefined.
  sex?: 'M' | 'F' | 'any' | null;
  minAge?: number | null;
  maxAge?: number | null;
  ageUnit?: 'years' | 'months' | 'days' | null;
  /** Band-scoped panic limits — critical low/high FOR THIS sex/age group
   *  (owner's model, 2026-09-19: criticals depend on gender and age).
   *  Absent = fall back to the parameter-level criticalLow/High. */
  criticalLow?: number | null;
  criticalHigh?: number | null;
  /** Profile-scoped band (body fluids): only applies when the test is entered
   *  or reported UNDER the profile with this test code (e.g. CSF analysis).
   *  Mirrors mw `RangeDef.ProfileCode`. */
  profileCode?: string | null;
  /** Legacy: overrides the name printed under this range on the report. */
  label?: string | null;
  /** What the report prints as the reference range, exactly as typed.
   *  Blank = "L–H unit". */
  reportText?: string | null;
}

// ── Per-type config blocks (stubs where complex renders aren't needed yet) ─

export type ImageGalleryLayout = '1x1' | '1x2' | '2x1' | '2x2' | '2x3' | '3x2';

export interface ImageGalleryConfig {
  layout: ImageGalleryLayout;
  maxImages: number;
  maxSizeMB: number;
  allowCamera: boolean;
  allowUpload: boolean;
  compressImages: boolean;
  compressionQuality: number;
  requireDescription: boolean;
  descriptionPlaceholder?: string;
}

export interface ScribblePadConfig {
  width: number;
  height: number;
  strokeColor: string;
  strokeWidth: number;
  backgroundColor: string;
  showDescription: boolean;
  descriptionPlaceholder?: string;
  descriptionRequired: boolean;
}

export type SizeUnitType = 'cm' | 'mm' | 'inch' | 'feet' | 'meter';

export interface SizeConfig {
  boxCount: number;
  defaultUnit: SizeUnitType;
}

export interface MeasureConfig {
  min: number;
  max: number;
  step: number;
  defaultUnit: string;
}

export type DurationUnitType = 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years';

// ── Conditional link (set/copy value when conditions fire) ────────────

export type LinkConditionOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'isSelected'
  | 'hasValue'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'greaterThan'
  | 'lessThan';

export interface LinkTriggerCondition {
  sourceRef: string; // fieldId or composite ref
  operator: LinkConditionOperator;
  value?: unknown;
}

export type LinkActionType = 'setValue' | 'copyValue' | 'makeRequired' | 'makeOptional' | 'show' | 'hide';

export interface LinkTriggerAction {
  targetRef: string;
  actionType: LinkActionType;
  value?: unknown;
  sourceRef?: string;
}

export interface ConditionalLinkTrigger {
  id: string;
  name: string;
  conditions: LinkTriggerCondition[];
  conditionLogic: 'AND' | 'OR';
  actions: LinkTriggerAction[];
  enabled: boolean;
}

// ── FormField — the leaf interface that replaces test-editor's ParameterRow ─

export interface FormField {
  id: string;
  name: string;          // machine name, snake_case
  label: string;         // display label
  type: FormFieldType;
  order: number;

  placeholder?: string | null;
  helperText?: string | null;
  icon?: string | null;
  width?: FormFieldWidth;

  isRequired: boolean;
  isConditional: boolean;
  showWhen?: ShowWhen | null;

  defaultValue?: unknown;
  validation?: ValidationConfig | null;
  options?: FieldOption[] | null;

  // Lab-specific extras (preserved from existing test-editor ParameterRow)
  unit?: string | null;
  referenceRanges?: ReferenceRange[] | null;
  criticalLow?: number | null;
  criticalHigh?: number | null;
  // Plausible / analytically-possible band (wider than reference + critical).
  // A value outside it is rejected at submit as a likely transcription error.
  validLow?: number | null;
  validHigh?: number | null;
  normalValue?: string | null;
  /** The test's own embedded option table rows ({code, value, normal,
   *  active}); `options`/`normalValue` derive from it on save. */
  optionRows?: import('../models/test.model').TestOptionRow[] | null;
  /** Name for the shared option group formed by optionRows (see TestParameter). */
  optionGroupName?: string | null;
  /** Photos & video at result entry for THIS value (per-row toggle);
   *  the Parameters-root `attachments: true` marker means every value. */
  attachments?: boolean;
  /** Per-value print switch: false = recorded at the bench, never printed. */
  printOnReport?: boolean;

  // Per-type configs (only populated for the matching type)
  defaultUnit?: DurationUnitType | null;
  imageGalleryConfig?: ImageGalleryConfig | null;
  scribblePadConfig?: ScribblePadConfig | null;
  sizeConfig?: SizeConfig | null;
  measureConfig?: MeasureConfig | null;

  disabled?: boolean;
}

// Convenience bundle used where a single test stores many fields + triggers.
export interface FormFieldBundle {
  fields: FormField[];
  conditionalLinks?: ConditionalLinkTrigger[] | null;
}
